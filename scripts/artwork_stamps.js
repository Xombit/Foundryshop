import { MODULE } from './constants.js';
import { assertNoPendingPathOperation } from './path_operation_guard.js';
import { materialFillStyle, materialCreationPatch, validateMaterialRepeat } from './material_fill.js';
import { readDrawingConfig } from './drawing_config.js';
import { disarmLabel } from './label_placement.js';
import {
	readLayerTree, readLayerWorkspace,
} from './layers/layer_manager.js';
import { effectiveLayerGate, lockedLayerIds } from './layers/layer_tree_store.js';
import { planDrawingOrder, planStampSorts } from './layers/drawing_order_service.js';
import { exportProjectDrawing, commitDrawingStamp } from './layers/project_transfer_service.js';
import { PROJECT_FORMAT, PROJECT_VERSION, validateProjectPackage, canonicalJson } from './layers/project_package.js';
import { inspectProjectResources, assertProjectResources } from './layers/project_resources.js';
import { imageHeader, IMAGE_LIMITS } from './image_header.js';
import { validateShapePackage, createShapePackage } from './shape_package.js';
import { exportPortablePaths, transformPortablePaths, remapPortablePaths } from './path_portability.js';
import { readPathRegistry } from './path_store.js';
import { validatePathRegistry } from './path_schema.js';
export { imageHeader } from './image_header.js';

export const STAMP_CHANGED = 'foundryshopStampChanged';
export const STAMP_FOLDER = 'stampAssetFolder';
export const STAMP_LIMITS = { drawings: 100, points: 100000, packageBytes: 4 * 1024 * 1024,
	bytes: 16 * 1024 * 1024, ...IMAGE_LIMITS };
let copied = null;
let armed = null;
let ghosts = [];
let pending = false;
let preparing = 0;
let hooks = [];
const wrapped = new WeakSet();
const loc = key => game.i18n.localize(`FOUNDRYSHOP.Stamps.${key}`);
const fail = key => { throw new Error(loc(key)); };

function requireEditor() {
	if (!game.user?.isGM || !game.user.can('DRAWING_CREATE') || !canvas.ready || !canvas.drawings?.active) fail('NoAccess');
}

export function getStampState() {
	return { copied: copied?.name ?? '', armed: armed?.stamp.name ?? '', repeat: armed?.repeat ?? false, busy: pending,
		...(armed ? { scale: armed.scale, rotation: armed.rotation } : {}) };
}

export function copiedStampSnapshot() {
	if (!copied) fail('NoCopy');
	return structuredClone(copied.drawings);
}

function notify() { Hooks.callAll(STAMP_CHANGED, getStampState()); }
function report(error) {
	console.error('Foundryshop stamps:', error);
	ui.notifications.error(game.i18n.format('FOUNDRYSHOP.Error', { message: error.message }));
}

function stampProject(entries, name, paths, pathWarnings = []) {
	const project = validateProjectPackage({
		format: PROJECT_FORMAT, version: PROJECT_VERSION, scope: 'full', coordinateSpace: 'scene-pixels',
		name, source: { foundry: game.version, drawingSchema: getDocumentClass('Drawing').metadata.schemaVersion },
		tree: { version: 1, revision: 0, nodes: [], presets: [] },
		drawings: entries.map(entry => ({ ...entry, layerId: null })), recovery: [], bounds: null, dependencies: {},
		...(paths ? { paths } : {}), ...(pathWarnings.length ? { pathWarnings } : {}),
	});
	if (project.drawings.length > STAMP_LIMITS.drawings
		|| project.drawings.reduce((total, entry) => total + entry.data.shape.points.length, 0) > STAMP_LIMITS.points
		|| new TextEncoder().encode(JSON.stringify(project)).length > STAMP_LIMITS.packageBytes) fail('SelectionLimit');
	return project;
}

async function checkStampResources(stamp) {
	assertProjectResources(await inspectProjectResources(stamp));
	const missing = stamp.dependencies.modules.filter(id => !game.modules.get(id)?.active);
	if (missing.length) throw new Error(`Enable required Drawing metadata modules first: ${missing.join(', ')}.`);
	for (const path of stamp.dependencies.assets) {
		const texture = await loadTexture(path);
		if (!texture?.valid) fail('Renderer');
	}
}

function selectedStamp(selected) {
	requireEditor();
	assertNoPendingPathOperation(canvas.scene);
	if (!selected.length || selected.length > STAMP_LIMITS.drawings) fail('SelectionLimit');
	if (canvas.scene.getFlag(MODULE, 'projectImportJournal')) fail('Unfinished');
	const entries = selected.map(object => {
		const entry = exportProjectDrawing(object.document);
		if (entry.data.flags?.[MODULE]) {
			delete entry.data.flags[MODULE].provenance;
			delete entry.data.flags[MODULE].importStaging;
		}

		return entry;
	}).sort((a, b) => a.data.sort - b.data.sort || a.id.localeCompare(b.id));
	const portable = exportPortablePaths(canvas.scene, entries);
	const project = stampProject(entries, loc('CopiedShape'), portable.paths, portable.pathWarnings);
	if (project.drawings.some(({ data }) => data.hidden || data.locked)) fail('HiddenLocked');
	if (new Set(project.drawings.map(({ data }) => `${data.elevation}:${data.interface}`)).size !== 1) fail('MixedOrder');
	const { x, y, width, height } = project.bounds;
	for (const { data } of project.drawings) { data.x -= x + width / 2; data.y -= y + height / 2; }
	return stampProject(project.drawings, project.name,
		transformPortablePaths(project.paths, { x: -x - width / 2, y: -y - height / 2 }), project.pathWarnings);
}

export function copySelectedStamp(selected = canvas.drawings.controlled ?? []) {
	const project = selectedStamp(selected);
	cancelStamp();
	copied = project;
	if (project.pathWarnings?.length) ui.notifications.warn(game.i18n.localize('FOUNDRYSHOP.Paths.PartialCopy'));
	notify();
	return structuredClone(copied);
}

export function prepareSelectedShape(metadata) {
	requireEditor();
	const scene = canvas.scene, levelId = canvas.level?.id;
	if (!scene || !levelId || !scene.levels?.has(levelId)) fail('Destination');
	const selected = [...(canvas.drawings.controlled ?? [])];
	if (selected.some(object => scene.drawings.get(object.document.id) !== object.document)) fail('Changed');
	const source = canonicalJson(selected.map(object => object.document.toObject()));
	const pathSource = canonicalJson(scene.getFlag(MODULE, 'paths'));
	const grid = canonicalJson({ type: scene?.grid?.type ?? 0, size: scene?.grid?.size ?? 100 });
	const project = selectedStamp(selected);
	const gridSize = scene.grid?.type === 0 ? 100 : Number(scene.grid?.size ?? 100);
	if (!Number.isFinite(gridSize) || gridSize < 5 || gridSize > 2000) fail('Transform');
	const scaled = transformStamp(project, { x: 0, y: 0 }, { scale: 100 / gridSize });
	const shape = createShapePackage({ ...metadata, footprint: {
		width: project.bounds.width / gridSize, height: project.bounds.height / gridSize,
	} }, project.drawings.map((entry, index) => ({
		...entry, data: { ...scaled[index], levels: [], elevation: 0 },
	})), transformPortablePaths(project.paths, { scale: 100 / gridSize }), project.pathWarnings);
	const isCurrent = () => game.user.isGM && game.user.can('DRAWING_CREATE') && canvas.ready && canvas.drawings?.active
		&& canvas.scene === scene && canvas.level?.id === levelId
		&& !scene.getFlag(MODULE, 'projectImportJournal')
		&& scene.getFlag(MODULE, 'pathJournal') === undefined
		&& canonicalJson(scene.getFlag(MODULE, 'paths')) === pathSource
		&& selected.every(object => scene.drawings.get(object.document.id) === object.document)
		&& canonicalJson({ type: scene.grid?.type ?? 0, size: scene.grid?.size ?? 100 }) === grid
		&& canonicalJson((canvas.drawings.controlled ?? []).map(object => object.document.toObject())) === source;
	return { shape, isCurrent };
}

export function loadShapeStamp(input, { gridSize = 100 } = {}) {
	requireEditor();
	const shape = validateShapePackage(input);
	const scaled = transformStamp(shape.project, { x: 0, y: 0 }, { scale: gridSize / 100 });
	const project = stampProject(shape.project.drawings.map((entry, index) => ({ ...entry, data: scaled[index] })), shape.name,
		transformPortablePaths(shape.project.paths, { scale: gridSize / 100 }), shape.project.pathWarnings);
	cancelStamp();
	copied = project;
	notify();
	return structuredClone(copied);
}

export function transformStamp(stamp, point, { scale = 1, rotation = 0 } = {}) {
	if (!Number.isFinite(scale) || scale < 0.05 || scale > 20 || !Number.isFinite(rotation)
		|| Math.abs(rotation) > 360 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) fail('Transform');
	const angle = rotation * Math.PI / 180;
	return stamp.drawings.map(({ data: source }) => {
		const data = structuredClone(source);
		const w = source.shape.width, h = source.shape.height;
		const cx = (source.x + w / 2) * scale, cy = (source.y + h / 2) * scale;
		data.shape.width *= scale; data.shape.height *= scale;
		if (data.shape.radius !== undefined && data.shape.radius !== null) data.shape.radius *= scale;
		data.shape.points = data.shape.points.map(value => value * scale);
		data.x = point.x + cx * Math.cos(angle) - cy * Math.sin(angle) - data.shape.width / 2;
		data.y = point.y + cx * Math.sin(angle) + cy * Math.cos(angle) - data.shape.height / 2;
		data.rotation = ((source.rotation + rotation) % 360 + 360) % 360;
		data.strokeWidth = Math.round(source.strokeWidth * scale);
		if (data.text) data.fontSize = Math.round(source.fontSize * scale);
		if (data.flags.foundryshop?.materialRepeat !== undefined) {
			data.flags.foundryshop.materialRepeat = validateMaterialRepeat(data.flags.foundryshop.materialRepeat * scale);
		}
		return data;
	});
}

function destination() {
	requireEditor();
	const scene = canvas.scene;
	assertNoPendingPathOperation(scene);
	if (!scene || !canvas.level?.id || !scene.levels.has(canvas.level.id)) fail('Destination');
	if (scene.getFlag(MODULE, 'projectImportJournal')) fail('Unfinished');
	const tree = readLayerTree(scene), workspace = readLayerWorkspace(scene);
	const layerId = workspace.activeLayerId;
	if (tree.nodes.some(node => node.kind === 'layer') && !tree.nodes.some(node => node.id === layerId && node.kind === 'layer')) fail('Destination');
	if (layerId && (lockedLayerIds(tree).has(layerId)
		|| !effectiveLayerGate(tree, layerId, node => !workspace.hiddenIds.includes(node.id)))) fail('Destination');
	return { scene, levelId: canvas.level.id, tree: canonicalJson(tree), workspace: canonicalJson(workspace), layerId };
}

function isCurrent(target) {
	if (target.scene.getFlag(MODULE, 'pathJournal') !== undefined) return false;
	if (!game.user.isGM || !game.user.can('DRAWING_CREATE') || !canvas.ready || !canvas.drawings.active
		|| canvas.scene !== target.scene || canvas.level?.id !== target.levelId
		|| !target.scene.levels.has(target.levelId)) return false;
	const journal = target.scene.getFlag(MODULE, 'projectImportJournal');
	if (journal && journal.token !== target.token) return false;
	return canonicalJson(readLayerTree(target.scene)) === target.tree
		&& canonicalJson(readLayerWorkspace(target.scene)) === target.workspace;
}

function nativeStampData(source, scene) {
	const result = new (getDocumentClass('Drawing'))(source, { parent: scene, strict: true }).toObject();
	for (const field of ['name', 'text']) if (result[field] === undefined) result[field] = '';
	if (Object.keys(source).some(key => canonicalJson(result[key]) !== canonicalJson(source[key]))) fail('NativeChanged');
	return result;
}

export async function placeStampAt(stamp, point, transform, target = destination()) {
	if (!isCurrent(target)) fail('Changed');
	return commitDrawingStamp(target.scene, async token => {
		target.token = token;
		if (!isCurrent(target)) fail('Changed');
		await checkStampResources(stamp);
		if (!isCurrent(target)) fail('Changed');
		const data = transformStamp(stamp, point, transform);
		const peers = [...target.scene.drawings.values()];
		if (peers.length + data.length > 10000) fail('SelectionLimit');
		if (planDrawingOrder(readLayerTree(target.scene), peers).length) fail('SortSpace');
		const ids = new Set([...peers.map(doc => doc.id), ...stamp.drawings.map(d => d.id),
			...(stamp.paths?.routes ?? []).map(r => r.id)]);
		const allocation = planStampSorts(readLayerTree(target.scene), peers, target.layerId, data.length);
		const registry = readPathRegistry(target.scene), drawingIds = new Map(), routeIds = new Map();
		for (const route of stamp.paths?.routes ?? []) {
			const id = foundry.utils.randomID();
			if (ids.has(id) || registry.routes.some(r => r.id === id)) fail('Collision');
			ids.add(id); routeIds.set(route.id, id);
		}
		const prepared = data.map((source, index) => {
			const id = foundry.utils.randomID();
			if (ids.has(id)) fail('Collision');
			ids.add(id);
			drawingIds.set(stamp.drawings[index].id, id);
			source._id = id; source.author = game.user.id; source.levels = [target.levelId];
			source.flags ??= {};
			source.flags[MODULE] = { ...source.flags[MODULE], layerId: target.layerId,
				importStaging: token, provenance: { importId: token } };
			if (peers.some(doc => doc.elevation !== source.elevation || !!doc.interface !== source.interface)) fail('MixedOrder');
			source.sort = allocation.sorts[index];
			const result = nativeStampData(source, target.scene);
			// Validate native cleaning and portable geometry before any write.
			const entry = exportProjectDrawing({ id, toObject: () => result });
			delete entry.data.flags[MODULE].importStaging;
			delete entry.data.flags[MODULE].path;
			stampProject([entry], stamp.name);
			return result;
		});
		if (stamp.paths?.routes.length && !target.layerId) fail('Destination');
		const paths = transformPortablePaths(stamp.paths, { x: point.x, y: point.y, ...transform });
		const routes = remapPortablePaths(paths, prepared, drawingIds, routeIds);
		const next = routes.length ? validatePathRegistry({ ...registry, revision: registry.revision + 1,
			routes: [...registry.routes, ...routes] }) : undefined;
		return { data: prepared, sortUpdates: allocation.updates, paths: next };
	}, { isCurrent: () => isCurrent(target) });
}

export function cancelStamp() {
	preparing++;
	armed = null;
	for (const ghost of ghosts) ghost.destroy({ children: true });
	ghosts = [];
	notify();
}

export async function armCopiedStamp({ scale = 1, rotation = 0, repeat = false } = {}) {
	requireEditor();
	if (!copied) fail('NoCopy');
	cancelStamp();
	disarmLabel();
	const epoch = preparing;
	const target = destination();
	const stamp = structuredClone(copied);
	await checkStampResources(stamp);
	if (epoch !== preparing || !isCurrent(target)) fail('Changed');
	const transformed = transformStamp(stamp, { x: 0, y: 0 }, { scale, rotation });
	const preview = [];
	try {
		for (const source of transformed) {
			const data = nativeStampData({ ...source, _id: foundry.utils.randomID(), hidden: true, author: game.user.id,
				levels: [target.levelId] }, target.scene);
			const document = new (getDocumentClass('Drawing'))(data, { parent: target.scene, strict: true });
			const ghost = new CONFIG.Drawing.objectClass(document);
			ghost._previewType = 'creation';
			preview.push(ghost);
			await ghost.draw();
			// Native Drawing destruction disposes its texture; previews must not dispose the shared asset cache.
			if (ghost.texture) ghost.texture = ghost.texture.clone();
			if (epoch !== preparing || !isCurrent(target)) fail('Changed');
			canvas.drawings.preview.addChild(ghost);
			ghost.eventMode = 'none';
			ghost.alpha = 0.45;
			if (ghost.shape) ghost.shape.alpha = 0.45;
			if (ghost.frame) ghost.frame.visible = false;
			if (ghost.controls) ghost.controls.visible = false;
		}
		ghosts = preview;
		armed = { stamp, scale, rotation, repeat: !!repeat, target, transformed };
		for (const ghost of ghosts) {
			ghost.visible = false;
			if (ghost.shape) ghost.shape.visible = false;
		}
		notify();
	} catch (error) {
		for (const ghost of preview) ghost.destroy({ children: true });
		throw error;
	}
}

export function onStampMove(event) {
	if (!armed || event.target !== canvas.app?.view) return;
	try {
		if (!isCurrent(armed.target)) { cancelStamp(); return; }
		const point = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
		for (let index = 0; index < ghosts.length; index++) {
			const ghost = ghosts[index], source = armed.transformed[index];
			ghost.document.updateSource({ x: source.x + point.x, y: source.y + point.y });
			ghost.renderFlags.set({ refreshPosition: true });
			ghost.visible = true;
			if (ghost.shape) ghost.shape.visible = true;
		}
	} catch (error) { cancelStamp(); report(error); }
}

export function onStampPointer(event) {
	if (!armed || event.button !== 0 || !event.isPrimary || event.target !== canvas.app?.view) return;
	event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
	if (pending) return;
	const current = armed;
	const point = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
	pending = true; notify();
	placeStampAt(current.stamp, point, current, current.target).then(() => {
		if (armed === current && !current.repeat) cancelStamp();
	}).catch(error => { cancelStamp(); report(error); }).finally(() => { pending = false; notify(); });
}

export function onStampWheel(event) {
	if (!armed || event.target !== canvas.app?.view || event.altKey
		|| (!event.shiftKey && !event.ctrlKey) || event.shiftKey && event.ctrlKey) return;
	const delta = event.deltaY || event.deltaX;
	if (!delta) return;
	event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
	if (pending) return;
	try {
		if (!isCurrent(armed.target)) { cancelStamp(); return; }
		const direction = delta < 0 ? 1 : -1;
		const scale = event.ctrlKey ? Math.max(0.05, Math.min(20, Math.round(armed.scale * (direction > 0 ? 1.1 : 1 / 1.1) * 1000) / 1000)) : armed.scale;
		const rotation = event.shiftKey ? (armed.rotation + direction * 15 + 360) % 360 : armed.rotation;
		const transformed = transformStamp(armed.stamp, { x: 0, y: 0 }, { scale, rotation });
		const point = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
		const sources = transformed.map((source, index) => nativeStampData({
			...ghosts[index].document.toObject(), ...source,
			x: source.x + point.x, y: source.y + point.y,
			hidden: true, levels: [armed.target.levelId],
		}, armed.target.scene));
		for (const [index, ghost] of ghosts.entries()) {
			ghost.document.updateSource(sources[index]);
			ghost.renderFlags.set({ refresh: true });
			ghost.visible = true;
			if (ghost.shape) ghost.shape.visible = true;
		}
		Object.assign(armed, { scale, rotation, transformed });
		notify();
	} catch (error) { cancelStamp(); report(error); }
}

export function onStampKey(event) {
	if (!armed || event.key !== 'Escape' || event.target?.isContentEditable
		|| ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
	event.preventDefault(); event.stopPropagation(); cancelStamp();
}

export function installImageStampRenderer() {
	const prototype = CONFIG.Drawing.objectClass.prototype;
	if (wrapped.has(prototype)) return;
	const native = prototype._getFillStyle;
	if (typeof native !== 'function') fail('Renderer');
	prototype._getFillStyle = function(...args) {
		const style = native.apply(this, args);
		if (this.document.getFlag(MODULE, 'imageStamp') !== 1) return materialFillStyle(this.document, this.texture, style);
		return imageStampFillStyle(this.document.shape, this.texture, style);
	};
	wrapped.add(prototype);
}

export function imageStampFillStyle(shape, texture, style) {
	if (!texture?.valid || shape.type !== 'r') fail('Renderer');
	return { ...style, color: 0xffffff, texture,
		matrix: new PIXI.Matrix().scale(shape.width / texture.width, shape.height / texture.height) };
}

export function validateAssetFolder(value) {
	if (typeof value !== 'string' || !value || value.length > 240
		|| !/^[a-zA-Z0-9 _/-]+$/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')
		|| /^(modules|systems)(\/|$)/i.test(value)) fail('Folder');
	return value;
}

export async function importImageStamp(file) {
	requireEditor();
	cancelStamp();
	const epoch = preparing;
	const target = destination();
	const folder = validateAssetFolder(game.settings.get(MODULE, STAMP_FOLDER));
	if (!game.user.can('FILES_UPLOAD') || !file || file.size <= 0 || file.size > STAMP_LIMITS.bytes) fail('Upload');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const header = imageHeader(bytes);
	const bitmap = await createImageBitmap(file);
	try {
		if (bitmap.width !== header.width || bitmap.height !== header.height) fail('Image');
	} finally { bitmap.close(); }
	if (epoch !== preparing || !isCurrent(target)) fail('Changed');
	const picker = foundry.applications.apps.FilePicker.implementation;
	const directory = await picker.browse('data', folder);
	const id = foundry.utils.randomID();
	if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) fail('Collision');
	const name = `stamp-${id}.${header.extension}`;
	if (directory.files?.some(path => decodeURIComponent(path) === `${folder}/${name}`)) fail('Collision');
	const upload = await picker.upload('data', folder, new File([file], name,
		{ type: header.extension === 'jpg' ? 'image/jpeg' : `image/${header.extension}` }), {}, { notify: false });
	if (!upload?.path || decodeURIComponent(upload.path) !== `${folder}/${name}`) fail('Upload');
	const response = await foundry.utils.fetchWithTimeout(new URL(upload.path, location.href).href,
		{ credentials: 'same-origin', cache: 'no-store', redirect: 'error' }, { timeoutMs: 5000 });
	if (!response.ok || Number(response.headers.get('content-length')) > STAMP_LIMITS.bytes) fail('Upload');
	const saved = new Uint8Array(await response.arrayBuffer());
	if (saved.length !== bytes.length || saved.some((byte, index) => byte !== bytes[index])) fail('Upload');
	const Document = getDocumentClass('Drawing');
	const source = new Document({ ...structuredClone(canvas.drawings.paletteCreateData), _id: foundry.utils.randomID(),
		name: file.name?.slice(0, 80) || loc('ImageStamp'),
		x: -header.width / 2, y: -header.height / 2, author: game.user.id,
		shape: { type: 'r', width: header.width, height: header.height, points: [] },
		strokeWidth: 0, fillType: 2, fillColor: '#ffffff', fillAlpha: 1, text: '',
		texture: upload.path, hidden: false, locked: false, flags: { [MODULE]: { imageStamp: 1 } },
	}, { parent: target.scene, strict: true });
	const stamp = stampProject([exportProjectDrawing(source)], source.name || loc('ImageStamp'));
	assertProjectResources(await inspectProjectResources(stamp));
	if (epoch !== preparing || !isCurrent(target)) throw new Error(`${loc('Changed')} ${loc('AssetRetained')}`);
	copied = stamp;
	notify();
	ui.notifications.info(loc('AssetRetained'));
	return stamp;
}

export async function pasteImageStamp() {
	requireEditor();
	if (!navigator.clipboard?.read) fail('Clipboard');
	const items = await navigator.clipboard.read();
	const item = items.find(entry => entry.types.some(type => ['image/png', 'image/jpeg', 'image/webp'].includes(type)));
	if (!item) fail('Clipboard');
	const type = item.types.find(type => ['image/png', 'image/jpeg', 'image/webp'].includes(type));
	await importImageStamp(await item.getType(type));
}

export function onStampPaste(event) {
	if (!game.user?.isGM || !canvas.ready || !canvas.drawings?.active || event.target?.isContentEditable
		|| ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
	const files = [...(event.clipboardData?.files ?? [])];
	const file = files.find(entry => ['image/png', 'image/jpeg', 'image/webp'].includes(entry.type));
	if (!file) return;
	event.preventDefault(); event.stopImmediatePropagation();
	importImageStamp(file).then(() => armCopiedStamp()).catch(report);
}

export function initArtworkStamps() {
	if (hooks.length) return;
	installImageStampRenderer();
	hooks.push(['drawDrawing', Hooks.on('drawDrawing', object => {
		if (!game.user.isGM || game.activeTool === 'text' || object.previewType !== 'creation' || object.document.id
			|| object.document.getFlag(MODULE, 'imageStamp') === 1) return;
		try {
			const scene = object.document.parent;
			const workspace = readLayerWorkspace(scene);
			const node = readLayerTree(scene).nodes.find(entry => entry.id === workspace.activeLayerId);
			const repeat = node?.defaults?.materialRepeat ?? readDrawingConfig().materialRepeat;
			if (repeat === undefined) return;
			const patch = materialCreationPatch({ fillType: object.document.fillType,
				texture: object.document.texture, materialRepeat: repeat }, scene);
			if (patch['flags.foundryshop.materialRepeat'] === undefined) return;
			object.document.updateSource({ 'flags.foundryshop.materialRepeat': patch['flags.foundryshop.materialRepeat'] });
			object.renderFlags.set({ refreshShape: true });
		} catch (error) { report(error); }
	})]);
	for (const name of ['canvasTearDown', 'deactivateDrawingsLayer', 'activateSceneControls']) {
		hooks.push([name, Hooks.on(name, cancelStamp)]);
	}
	for (const name of ['canvasReady', 'updateScene', 'updateUser', 'foundryshopLayersChanged']) {
		hooks.push([name, Hooks.on(name, () => { if (armed && !isCurrent(armed.target)) cancelStamp(); })]);
	}
	hooks.push(['foundryshopLabelStateChanged', Hooks.on('foundryshopLabelStateChanged', state => {
		if (state.mode !== 'off') cancelStamp();
	})]);
	window.addEventListener('pointermove', onStampMove, { capture: true });
	window.addEventListener('pointerdown', onStampPointer, { capture: true });
	window.addEventListener('keydown', onStampKey, { capture: true });
	window.addEventListener('paste', onStampPaste, { capture: true });
	window.addEventListener('wheel', onStampWheel, { capture: true, passive: false });
	window.addEventListener('blur', cancelStamp);
}

export function teardownArtworkStamps() {
	cancelStamp(); copied = null;
	for (const [name, id] of hooks) Hooks.off(name, id);
	hooks = [];
	window.removeEventListener('pointermove', onStampMove, { capture: true });
	window.removeEventListener('pointerdown', onStampPointer, { capture: true });
	window.removeEventListener('keydown', onStampKey, { capture: true });
	window.removeEventListener('paste', onStampPaste, { capture: true });
	window.removeEventListener('wheel', onStampWheel, { capture: true });
	window.removeEventListener('blur', cancelStamp);
}
