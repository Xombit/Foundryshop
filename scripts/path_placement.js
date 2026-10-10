import { MODULE } from './constants.js';
import { buildPathDrawings, pathOptions, PATH_LIMITS, PathGeometryError } from './path_geometry.js';
import { readDrawingConfig } from './drawing_config.js';
import { readLayerTree, readLayerWorkspace } from './layers/layer_manager.js';
import { effectiveLayerGate, lockedLayerIds } from './layers/layer_tree_store.js';
import { cancelStamp } from './artwork_stamps.js';
import { disarmLabel } from './label_placement.js';
import { nextPathSeed } from './path_draft.js';
import { createPathRecipe, validatePathRecipe } from './path_schema.js';
import { createRetainedPath } from './path_transactions.js';

export const PATH_CHANGED = 'foundryshopPathChanged';
let settings = pathOptions(), closed = false, session = null, preview = null, installed = false, pending = false;
let explicitAppearance = false;
let hooks = [], previewError = null;
const loc = key => game.i18n.localize(`FOUNDRYSHOP.Paths.${key}`);
const notify = () => Hooks.callAll(PATH_CHANGED, getPathState());
const report = error => { console.error('Foundryshop | Path:', error); ui.notifications.error(error.message); };
export function getPathState() { return { ...settings, closed, armed: !!session, count: session?.points.length ?? 0, pending }; }
export function configurePath(options) {
	const previous = settings, previousClosed = closed;
	const { closed: closure, ...patch } = options;
	if (Object.keys(patch).some(key => !Object.hasOwn(settings, key))) throw new PathGeometryError('Invalid path setting.');
	if (Object.hasOwn(options, 'closed') && typeof closure !== 'boolean') throw new PathGeometryError('Invalid path closure.');
	settings = pathOptions({ ...settings, ...patch });
	if (Object.hasOwn(options, 'closed')) closed = closure;
	try { refreshPreview(true); } catch (error) { settings = previous; closed = previousClosed; refreshPreview(); throw error; }
	if (Object.hasOwn(patch, 'color') || Object.hasOwn(patch, 'alpha')) explicitAppearance = true;
	notify();
}
export function rerollPath() { configurePath({ seed: nextPathSeed(settings.seed) }); }

function current(target, saving = false) {
	if (!target || !game.user.isGM || !game.user.can('DRAWING_CREATE') || !canvas.ready || !canvas.drawings?.active
		|| canvas.scene !== target.scene || canvas.level?.id !== target.levelId
		|| !target.scene.canUserModify(game.user, 'update')
		|| !Number.isFinite(target.elevation) || canvas.level?.elevation?.bottom !== target.elevation
		|| !target.scene.levels.has(target.levelId) || target.scene.getFlag(MODULE, 'projectImportJournal')
		|| (!saving && target.scene.getFlag(MODULE, 'pathJournal') !== undefined)) return false;
	return JSON.stringify(readLayerTree(target.scene)) === target.tree
		&& JSON.stringify(readLayerWorkspace(target.scene)) === target.workspace
		&& canvas.grid.size === target.grid;
}

export function cancelPath() {
	session = null;
	previewError = null;
	preview?.destroy({ children: true }); preview = null;
	notify();
}

export function armPath() {
	if (pending) throw new Error(loc('Pending'));
	if (!game.user.isGM || !game.user.can('DRAWING_CREATE') || !canvas.ready || !canvas.drawings?.active) throw new Error(loc('NoLayer'));
	const tree = readLayerTree(canvas.scene), workspace = readLayerWorkspace(canvas.scene);
	const layer = tree.nodes.find(node => node.kind === 'layer' && node.id === workspace.activeLayerId);
	if (!layer || lockedLayerIds(tree).has(layer.id)
		|| !effectiveLayerGate(tree, layer.id, node => !workspace.hiddenIds.includes(node.id))) throw new Error(loc('NoLayer'));
	cancelStamp(); disarmLabel(); cancelPath();
	const brush = readDrawingConfig();
	settings = pathOptions({ ...settings, ...(!explicitAppearance && ['plain', 'railway'].includes(settings.style) ? { color: String(brush.strokeColor), alpha: brush.strokeAlpha } : {}),
		seed: Math.floor(Math.random() * 0x100000000) });
	session = { scene: canvas.scene, levelId: canvas.level?.id, elevation: canvas.level?.elevation?.bottom, layerId: layer.id,
		tree: JSON.stringify(tree), workspace: JSON.stringify(workspace), grid: canvas.grid.size, points: [], cursor: null };
	if (!current(session)) { cancelPath(); throw new Error(loc('Changed')); }
	preview = new PIXI.Graphics(); preview.eventMode = 'none';
	canvas.drawings.addChild(preview);
	notify();
}

function refreshPreview(strict = false) {
	if (!session || !preview) return;
	preview.clear();
	const points = [...session.points];
	if (session.cursor && (!points.length || Math.hypot(session.cursor.x - points.at(-1).x, session.cursor.y - points.at(-1).y) > 0.01)) {
		points.push(session.cursor);
	}
	if (points.length < (closed ? 3 : 2)) { previewError = null; return; }
	let drawings;
	try {
		drawings = buildPathDrawings(points, settings, session.grid, closed);
		previewError = null;
	} catch (error) {
		if (!(error instanceof PathGeometryError)) throw error;
		if (strict) throw error;
		if (previewError !== error.message) report(error);
		previewError = error.message;
		return;
	}
	for (const data of drawings) {
		preview.lineStyle(data.strokeWidth, Number.parseInt(data.strokeColor.slice(1), 16), Math.max(0.2, data.strokeAlpha) * 0.65);
		const values = data.shape.points;
		preview.moveTo(data.x + values[0], data.y + values[1]);
		for (let index = 2; index < values.length; index += 2) preview.lineTo(data.x + values[index], data.y + values[index + 1]);
	}
}

export async function finishPath() {
	if (pending || !session) return;
	const target = session;
	if (!current(target)) { cancelPath(); throw new Error(loc('Changed')); }
	if (target.points.length < (closed ? 3 : 2)) throw new Error(loc(closed ? 'ThreePoints' : 'TwoPoints'));
	const recipe = validatePathRecipe({ ...createPathRecipe(target.points, settings, target.grid), closed });
	buildPathDrawings(target.points, settings, target.grid, closed);
	pending = true; cancelPath();
	try {
		if (!current(target)) throw new Error(loc('Changed'));
		const route = await createRetainedPath(target.scene, recipe, {
			layerId: target.layerId, levelId: target.levelId, elevation: target.elevation,
			name: loc(`Style.${recipe.options.style}`), isCurrent: () => current(target, true),
		});
		ui.notifications.info(loc('Created'));
		return route;
	} finally { pending = false; notify(); }
}

const canvasEvent = event => session && event.target === canvas.app?.view;
const consume = event => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };
export function onPathPointer(event) {
	if (!canvasEvent(event) || event.button !== 0 || event.isPrimary === false) return;
	globalThis.document?.activeElement?.blur?.();
	consume(event);
	try {
		if (!current(session)) throw new Error(loc('Changed'));
		if (session.points.length >= PATH_LIMITS.waypoints) throw new Error(loc('Limit'));
		const point = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
		if (!session.points.length || Math.hypot(point.x - session.points.at(-1).x, point.y - session.points.at(-1).y) > 1) session.points.push(point);
		session.cursor = point; refreshPreview(); notify();
	} catch (error) { cancelPath(); report(error); }
}
export function onPathMove(event) {
	if (!canvasEvent(event)) { if (preview) preview.visible = false; return; }
	try {
		if (!current(session)) throw new Error(loc('Changed'));
		preview.visible = true;
		session.cursor = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
		refreshPreview();
	} catch (error) { cancelPath(); report(error); }
}
export function onPathKey(event) {
	if (!session || event.target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName)) return;
	if (event.key === 'Enter' && event.target?.tagName === 'BUTTON') return;
	if (!['Escape', 'Enter', 'Backspace'].includes(event.key)) return;
	consume(event);
	if (event.key === 'Escape') cancelPath();
	else if (event.key === 'Enter') finishPath().catch(report);
	else { session.points.pop(); refreshPreview(); notify(); }
}
function onDoubleClick(event) { if (canvasEvent(event)) { consume(event); finishPath().catch(report); } }
function suppress(event) { if (canvasEvent(event) && event.button === 0) consume(event); }
export function initPathPlacement() {
	if (installed) return;
	installed = true;
	for (const name of ['canvasTearDown', 'deactivateDrawingsLayer', 'activateSceneControls']) hooks.push([name, Hooks.on(name, cancelPath)]);
	for (const name of ['canvasReady', 'updateScene', 'updateUser', 'foundryshopLayersChanged']) {
		hooks.push([name, Hooks.on(name, () => { if (session && !current(session)) cancelPath(); })]);
	}
	hooks.push(['foundryshopLabelStateChanged', Hooks.on('foundryshopLabelStateChanged', state => { if (state.mode !== 'off' && session) cancelPath(); })]);
	hooks.push(['foundryshopStampChanged', Hooks.on('foundryshopStampChanged', () => { if (session) cancelPath(); })]);
	window.addEventListener('pointerdown', onPathPointer, { capture: true });
	window.addEventListener('pointermove', onPathMove, { capture: true });
	window.addEventListener('pointerup', suppress, { capture: true });
	window.addEventListener('click', suppress, { capture: true });
	window.addEventListener('dblclick', onDoubleClick, { capture: true });
	window.addEventListener('keydown', onPathKey, { capture: true });
	window.addEventListener('blur', cancelPath);
}

export function teardownPathPlacement() {
	cancelPath();
	for (const [name, id] of hooks) Hooks.off(name, id);
	hooks = []; installed = false;
	for (const [name, callback] of [['pointerdown', onPathPointer], ['pointermove', onPathMove],
		['pointerup', suppress], ['click', suppress], ['dblclick', onDoubleClick], ['keydown', onPathKey]]) {
		window.removeEventListener(name, callback, { capture: true });
	}
	window.removeEventListener('blur', cancelPath);
}
