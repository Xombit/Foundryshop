import { MODULE } from './constants.js';
import { canonicalJson } from './layers/project_package.js';
import { readLayerTree, readLayerWorkspace } from './layers/layer_manager.js';
import { effectiveLayerGate, lockedLayerIds } from './layers/layer_tree_store.js';
import { inspectPathIntegrity, buildPathRecipeComponents } from './path_store.js';
import { validatePathMembership } from './path_schema.js';
import { assertNoPendingPathOperation } from './path_operation_guard.js';
import { updateRetainedPath } from './path_transactions.js';
import { changePathWaypoint, removePathWaypoint, insertPathWaypoint, changePathPointMode, changePathHandle,
	changePathSettings, nextPathSeed, translatePathRecipe } from './path_draft.js';
import { cancelPath, getPathState } from './path_placement.js';
import { cancelStamp } from './artwork_stamps.js';
import { disarmLabel } from './label_placement.js';

export const PATH_EDITOR_CHANGED = 'foundryshopPathEditorChanged';
let session = null, overlay = null, drag = null, installed = false, hooks = [];
const loc = key => game.i18n.localize(`FOUNDRYSHOP.Paths.${key}`);
const report = error => { console.error('Foundryshop Path editor:', error); ui.notifications.error(error.message); };
const notify = () => Hooks.callAll(PATH_EDITOR_CHANGED, getPathEditorState());

export function selectedRetainedPath(scene = canvas.scene, selected = canvas.drawings?.controlled ?? []) {
	const documents = selected.map(object => object.document);
	if (!documents.some(document => document.getFlag(MODULE, 'path') !== undefined)) return null;
	if (!documents.length || documents.some(document => scene.drawings.get(document.id) !== document)) throw new Error(loc('EditorChanged'));
	const members = documents.map(document => validatePathMembership(document.getFlag(MODULE, 'path')));
	if (new Set(members.map(member => member.id)).size !== 1) throw new Error(loc('SelectOnePath'));
	return inspectPathIntegrity(scene, members[0].id);
}

export function getPathEditorState() {
	return session ? { active: true, id: session.original.id, name: session.original.name, recipe: structuredClone(session.recipe),
		selected: session.selected, pending: session.pending, error: session.error, insert: session.insert,
		undo: session.past.length > 0, redo: session.future.length > 0 }
		: { active: false, pending: false };
}

function assertContext(target, saving = false) {
	const scene = target.scene, original = target.original;
	if (!game.user.isGM || !game.user.can('DRAWING_CREATE') || !canvas.ready || canvas.scene !== scene
		|| !canvas.drawings.active || canvas.level?.id !== original.levelId || !scene.canUserModify(game.user, 'update')) throw new Error(loc('EditorChanged'));
	if (!saving) {
		assertNoPendingPathOperation(scene);
		const integrity = inspectPathIntegrity(scene, original.id);
		if (!integrity.intact || canonicalJson(integrity.route) !== canonicalJson(original)) throw new Error(loc('EditorChanged'));
	}
	const tree = readLayerTree(scene), workspace = readLayerWorkspace(scene);
	if (lockedLayerIds(tree).has(original.layerId)
		|| !effectiveLayerGate(tree, original.layerId, node => !workspace.hiddenIds.includes(node.id))
		|| original.components.some(component => scene.drawings.get(component.drawingId)?.locked
			|| scene.drawings.get(component.drawingId)?.toObject().locked)) throw new Error(loc('EditorLocked'));
}

export function beginPathEdit(id) {
	if (session?.pending) throw new Error(loc('Pending'));
	const scene = canvas.scene, integrity = inspectPathIntegrity(scene, id);
	if (!integrity.intact) throw new Error(loc('EditorDamaged'));
	const target = { scene, original: integrity.route, recipe: structuredClone(integrity.route.recipe),
		selected: 0, pending: false, error: null, insert: false, past: [], future: [] };
	assertContext(target);
	buildPathRecipeComponents(target.recipe);
	cancelStamp(); disarmLabel(); cancelPath(); cancelPathEdit();
	session = target;
	overlay = new PIXI.Graphics(); overlay.eventMode = 'none';
	canvas.drawings.addChild(overlay);
	refresh(); notify();
}

function rememberDraft(recipe = session.recipe, selected = session.selected) {
	session.past.push({ recipe: structuredClone(recipe), selected });
	if (session.past.length > 20) session.past.shift();
	session.future = [];
}

function acceptDraft(recipe) {
	if (canonicalJson(recipe) !== canonicalJson(session.recipe) && !drag) rememberDraft();
	session.recipe = recipe;
}

export function undoPathDraft(redo = false) {
	if (!session || session.pending || drag) throw new Error(loc('EditorChanged'));
	assertContext(session);
	const from = redo ? session.future : session.past, to = redo ? session.past : session.future;
	if (!from.length) throw new Error(loc('HistoryEmpty'));
	to.push({ recipe: structuredClone(session.recipe), selected: session.selected });
	const previous = from.pop();
	session.recipe = previous.recipe; session.selected = previous.selected;
	session.insert = false; session.error = null; refresh(); notify();
}

export function cancelPathEdit() {
	if (session?.pending) return;
	session = null; drag = null;
	overlay?.destroy({ children: true }); overlay = null;
	notify();
}

const radius = () => 10 / (canvas.stage?.scale?.x || 1);
function refresh() {
	if (!session || !overlay) return;
	overlay.clear();
	for (const { data } of buildPathRecipeComponents(session.recipe)) {
		overlay.lineStyle(data.strokeWidth, parseInt(data.strokeColor.slice(1), 16), Math.max(0.25, data.strokeAlpha) * 0.65);
		const values = data.shape.points;
		overlay.moveTo(data.x + values[0], data.y + values[1]);
		for (let i = 2; i < values.length; i += 2) overlay.lineTo(data.x + values[i], data.y + values[i + 1]);
	}
	for (const [index, point] of session.recipe.waypoints.entries()) {
		overlay.lineStyle(radius() / 5, 0xffffff, 1);
		overlay.beginFill(index === session.selected ? 0xffaa00 : 0x2266cc, 1);
		overlay.drawCircle(point.x, point.y, radius() * 0.65); overlay.endFill();
	}
	const selected = session.recipe.waypoints[session.selected];
	for (const side of ['incoming', 'outgoing']) if (selected[side]) {
		const handle = selected[side];
		overlay.lineStyle(radius() / 6, 0xffaa00, 1);
		overlay.moveTo(selected.x, selected.y); overlay.lineTo(handle.x, handle.y);
		overlay.beginFill(0xffffff, 1); overlay.drawCircle(handle.x, handle.y, radius() * 0.5); overlay.endFill();
	}
}

export function setPathPointMode(mode) {
	if (!session || session.pending) throw new Error(loc('EditorChanged'));
	assertContext(session);
	acceptDraft(changePathPointMode(session.recipe, session.selected, mode));
	session.error = null; refresh(); notify();
}

export function configurePathEdit(patch) {
	if (!session || session.pending || drag) throw new Error(loc('EditorChanged'));
	assertContext(session);
	acceptDraft(changePathSettings(session.recipe, patch));
	session.error = null; drag = null; refresh(); notify();
}

export function rerollPathEdit() {
	if (!session || session.pending) throw new Error(loc('EditorChanged'));
	configurePathEdit({ seed: nextPathSeed(session.recipe.options.seed) });
}

export function translatePathEdit(dx, dy) {
	if (!session || session.pending || drag) throw new Error(loc('EditorChanged'));
	assertContext(session);
	acceptDraft(translatePathRecipe(session.recipe, dx, dy));
	session.error = null; drag = null; refresh(); notify();
}
export function setPathHandle(side, position) {
	if (!session || session.pending) throw new Error(loc('EditorChanged'));
	assertContext(session);
	acceptDraft(changePathHandle(session.recipe, session.selected, side, position));
	session.error = null; refresh(); notify();
}

export function selectPathWaypoint(index) {
	if (!session || session.pending || !Number.isInteger(index) || !session.recipe.waypoints[index]) throw new Error(loc('EditorChanged'));
	assertContext(session);
	session.selected = index; refresh(); notify();
}

export function setPathWaypoint(point) {
	if (!session || session.pending) throw new Error(loc('EditorChanged'));
	assertContext(session);
	acceptDraft(changePathWaypoint(session.recipe, session.selected, point));
	session.error = null; refresh(); notify();
}

export function deletePathWaypoint() {
	if (!session || session.pending) throw new Error(loc('EditorChanged'));
	assertContext(session);
	acceptDraft(removePathWaypoint(session.recipe, session.selected));
	session.selected = Math.min(session.selected, session.recipe.waypoints.length - 1);
	session.error = null; refresh(); notify();
}

export function togglePathInsertion() {
	if (!session || session.pending) throw new Error(loc('EditorChanged'));
	assertContext(session); session.insert = !session.insert; notify();
}

export async function applyPathEdit() {
	if (!session || session.pending) return;
	const target = session;
	assertContext(target);
	target.pending = true; target.error = null; drag = null; notify();
	try {
		await updateRetainedPath(target.scene, target.original.id, target.recipe,
			{ expectedRevision: target.original.revision, isCurrent: () => {
				assertContext(target, true); return true;
			} });
		target.pending = false; cancelPathEdit();
		ui.notifications.info(loc('EditorApplied'));
	} catch (error) {
		target.pending = false;
		if (!canvas.ready || canvas.scene !== target.scene || canvas.level?.id !== target.original.levelId
			|| !canvas.drawings.active) cancelPathEdit();
		else { target.error = error.message; notify(); }
		throw error;
	}
}

export function selectWholePath(id) {
	const target = inspectPathIntegrity(canvas.scene, id);
	if (!target.intact) throw new Error(loc('EditorDamaged'));
	assertContext({ scene: canvas.scene, original: target.route });
	if (target.route.components.some(component => !canvas.scene.drawings.get(component.drawingId)?.object)) throw new Error(loc('EditorChanged'));
	canvas.drawings.releaseAll();
	for (const component of target.route.components) {
		const object = canvas.scene.drawings.get(component.drawingId)?.object;
		if (!object || !object.control({ releaseOthers: false })) throw new Error(loc('EditorLocked'));
	}
}

const consume = event => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };
const canvasEvent = event => session && event.target === canvas.app?.view;
const point = event => canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
export function onPathEditorPointer(event) {
	if (!canvasEvent(event) || event.button !== 0 || event.isPrimary === false) return;
	if (drag) { consume(event); return; }
	consume(event); globalThis.document?.activeElement?.blur?.();
	if (session.pending) return;
	try {
		assertContext(session);
		const position = point(event);
		if (session.insert) {
			const inserted = insertPathWaypoint(session.recipe, position, radius() * 2);
			acceptDraft(inserted.recipe); session.selected = inserted.index; session.insert = false;
		} else {
			const selected = session.recipe.waypoints[session.selected];
			const side = ['incoming', 'outgoing'].find(key => selected[key]
				&& Math.hypot(position.x - selected[key].x, position.y - selected[key].y) <= radius()
				&& Math.hypot(position.x - selected.x, position.y - selected.y) > radius() * 0.65);
			if (side) {
				drag = { pointerId: event.pointerId, start: position, waypoint: { ...selected[side] },
					side, recipe: structuredClone(session.recipe) };
				return;
			}
			const distances = session.recipe.waypoints.map(p => Math.hypot(position.x - p.x, position.y - p.y));
			const nearest = distances.indexOf(Math.min(...distances));
			if (distances[nearest] > radius() * 1.5) return;
			session.selected = nearest;
			drag = { pointerId: event.pointerId, start: position, waypoint: { ...session.recipe.waypoints[nearest] },
				recipe: structuredClone(session.recipe) };
		}
		session.error = null; refresh(); notify();
	} catch (error) { session.error = error.message; notify(); report(error); }
}
export function onPathEditorMove(event) {
	if (!session || !drag || event.pointerId !== drag.pointerId) return;
	consume(event);
	try {
		assertContext(session);
		const p = point(event);
		const position = { x: drag.waypoint.x + p.x - drag.start.x, y: drag.waypoint.y + p.y - drag.start.y };
		if (drag.side) setPathHandle(drag.side, position);
		else setPathWaypoint(position);
	} catch (error) {
		if (!session) return;
		if (session.error !== error.message) report(error);
		session.error = error.message; notify();
	}
}
export function onPathEditorUp(event) {
	if (drag && event.pointerId !== drag.pointerId) return;
	if ((canvasEvent(event) && event.button === 0) || (drag && event.pointerId === drag.pointerId)) {
		consume(event);
		if (event.type === 'pointercancel' && session && drag) {
			session.recipe = drag.recipe; session.error = null; refresh(); notify();
		} else if (session && drag && canonicalJson(session.recipe) !== canonicalJson(drag.recipe)) {
			rememberDraft(drag.recipe); notify();
		}
		drag = null;
	}
}
function suppress(event) { if (canvasEvent(event) && event.button === 0) consume(event); }
export function onPathEditorKey(event) {
	if (!session || event.target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
	if (event.key === 'Enter' && event.target?.tagName === 'BUTTON') return;
	if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
		consume(event);
		if (session.pending) return;
		try { undoPathDraft(event.key.toLowerCase() === 'y' || !!event.shiftKey); } catch (error) { report(error); }
		return;
	}
	if (!['Escape', 'Enter', 'Delete', 'Backspace'].includes(event.key)) return;
	consume(event);
	if (session.pending) return;
	try {
		if (event.key === 'Escape') cancelPathEdit();
		else if (event.key === 'Enter') applyPathEdit().catch(report);
		else deletePathWaypoint();
	} catch (error) { report(error); }
}
function checkSession() {
	if (!session || session.pending) return;
	try { assertContext(session); } catch (error) { cancelPathEdit(); report(error); }
}
export function onPathEditorBlur(event) {
	if (event.target === window) cancelPathEdit();
}
export function initPathEditor() {
	if (installed) return;
	installed = true;
	const add = (name, callback) => hooks.push([name, Hooks.on(name, callback)]);
	for (const name of ['canvasTearDown', 'deactivateDrawingsLayer', 'activateSceneControls']) add(name, cancelPathEdit);
	for (const name of ['updateScene', 'updateDrawing', 'deleteDrawing', 'createDrawing', 'updateUser', 'foundryshopLayersChanged']) add(name, checkSession);
	add('foundryshopPathChanged', () => { if (getPathState().armed) cancelPathEdit(); });
	add('foundryshopLabelStateChanged', state => { if (state.mode !== 'off') cancelPathEdit(); });
	add('foundryshopStampChanged', state => { if (state.armed) cancelPathEdit(); });
	add('canvasPan', () => { if (session) { try { refresh(); } catch (error) { report(error); } } });
	for (const [name, callback] of listeners) window.addEventListener(name, callback, { capture: true });
}
const listeners = [['pointerdown', onPathEditorPointer], ['pointermove', onPathEditorMove], ['pointerup', onPathEditorUp],
	['pointercancel', onPathEditorUp], ['click', suppress], ['dblclick', suppress], ['keydown', onPathEditorKey], ['blur', onPathEditorBlur]];
export function teardownPathEditor() {
	cancelPathEdit();
	for (const [name, id] of hooks) Hooks.off(name, id);
	hooks = []; installed = false;
	for (const [name, callback] of listeners) window.removeEventListener(name, callback, { capture: true });
}
