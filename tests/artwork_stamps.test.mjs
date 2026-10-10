import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	copySelectedStamp, transformStamp, placeStampAt, imageHeader, validateAssetFolder,
	installImageStampRenderer, importImageStamp, armCopiedStamp, cancelStamp, getStampState,
	onStampMove, onStampPointer, onStampPaste, onStampWheel, initArtworkStamps, teardownArtworkStamps, loadShapeStamp, prepareSelectedShape,
} from '../scripts/artwork_stamps.js';
import { starterShape } from '../scripts/starter_shapes.js';
import { discardInterruptedProjectImport } from '../scripts/layers/project_transfer_service.js';
import { armPath, cancelPath, configurePath, getPathState, onPathPointer, onPathMove, onPathKey, finishPath, initPathPlacement, teardownPathPlacement } from '../scripts/path_placement.js';
import { createPathRecipe } from '../scripts/path_schema.js';
import { readPathRegistry, inspectPathIntegrity, pathConflictSnapshot } from '../scripts/path_store.js';
import { createRetainedPath, updateRetainedPath, deleteRetainedPath, duplicateRetainedPath, detachRetainedPath, recoverRetainedPathOperation, promptRetainedPathRecovery,
	undoRetainedPath, redoRetainedPath, detachConflictingPath } from '../scripts/path_transactions.js';
import { getPathHistoryState, clearPathHistory } from '../scripts/path_history.js';
import { withPathWrite, isAuthorizedPathWrite, isPendingPathDrawing } from '../scripts/path_operation_guard.js';
import { onPreCreateLayerDrawing, onPreUpdateLayerDrawing, onPreDeleteLayerDrawing, onPreUpdatePathScene, applyDrawingVisibility } from '../scripts/layers/layer_manager.js';
import { publicationSnapshot } from '../scripts/artwork_publication.js';
import { layerArtworkSnapshot } from '../scripts/artwork_renderer.js';
import { exportDrawingProject, exportDrawingSelection, exportDrawingSubtree, prepareProjectImport, importDrawingProject } from '../scripts/layers/project_transfer_service.js';
import { validateProjectPackage } from '../scripts/layers/project_package.js';
import { transformPathRecipe } from '../scripts/path_portability.js';
import { beginPathEdit, cancelPathEdit, getPathEditorState, selectedRetainedPath, selectPathWaypoint, setPathWaypoint,
	deletePathWaypoint, togglePathInsertion, applyPathEdit, onPathEditorPointer, onPathEditorMove, onPathEditorUp,
	onPathEditorKey, initPathEditor, teardownPathEditor, setPathPointMode, setPathHandle, onPathEditorBlur,
	configurePathEdit, rerollPathEdit, translatePathEdit, undoPathDraft } from '../scripts/path_editor.js';

const base = () => ({
	_id: 'originalDrawing', author: 'old', name: 'Shape', x: 10, y: 20, elevation: 0,
	levels: ['oldLevel'], sort: 1024, rotation: 10, bezierFactor: 0, shape: { type: 'r', width: 40, height: 20, radius: 0, points: [] },
	fillType: 1, fillColor: '#123456', fillAlpha: 0.5, strokeWidth: 4, strokeColor: '#abcdef', strokeAlpha: 1,
	texture: null, text: '', fontFamily: 'Signika', fontSize: 48, textColor: '#ffffff', textAlpha: 1,
	hidden: false, locked: false, interface: false, flags: { foundryshop: { layerId: 'ink' } },
});
class Drawing {
	static metadata = { schemaVersion: '14.355' };
	constructor(data, { parent } = {}) {
		this.data = { ...base(), ...structuredClone(data) }; this.parent = parent;
		if (Drawing.clampFontSize) this.data.fontSize = Math.min(256, this.data.fontSize);
	}
	get id() { return this.data._id; }
	get sort() { return this.data.sort; }
	get elevation() { return this.data.elevation; }
	get interface() { return this.data.interface; }
	get name() { return this.data.name; }
	get shape() { return this.data.shape; }
	get flags() { return this.data.flags; }
	get texture() { return this.data.texture; }
	get fillType() { return this.data.fillType; }
	getFlag(namespace, key) { return this.data.flags[namespace]?.[key]; }
	toObject() { return structuredClone(this.data); }
	updateSource(data) { Object.assign(this.data, data); }
}
let workspace, scene, id, ghostObjects, uploadResult;
beforeEach(() => {
	Drawing.clampFontSize = false;
	id = 0; ghostObjects = [];
	workspace = { version: 1, scenes: { dest: { activeLayerId: 'ink', hiddenIds: [], collapsedIds: [] } } };
	scene = { id: 'dest', name: 'Destination', canUserModify: () => true, levels: new Map([['ground', {}]]), drawings: new Map(),
		flags: { foundryshop: { layers: { version: 1, revision: 0, presets: [], nodes: [
			{ id: 'ink', name: 'Ink', kind: 'layer', parentId: null, locked: false, playerAllowed: false, defaults: { strokeColor: '#000000' } },
		] } } }, getFlag(namespace, key) { return this.flags[namespace]?.[key]; } };
	const patch = (object, changes) => {
		for (const [key, value] of Object.entries(changes)) {
			const parts = key.split('.');
			let target = object;
			for (const part of parts.slice(0, -1)) target = target[part] ??= {};
			const field = parts.at(-1);
			if (value instanceof foundry.data.operators.ForcedDeletion) delete target[field];
			else if (field.startsWith('-=')) delete target[field.slice(2)];
			else target[field] = structuredClone(value);
		}
	};
	scene.update = async changes => patch(scene, changes);
	scene.unsetFlag = async (namespace, key) => { delete scene.flags[namespace][key]; };
	scene.createEmbeddedDocuments = async (type, sources) => {
		for (const data of sources) scene.drawings.set(data._id, new Drawing(data, { parent: scene }));
	};
	scene.updateEmbeddedDocuments = async (type, changes) => {
		for (const change of changes) patch(scene.drawings.get(change._id).data, change);
	};
	scene.deleteEmbeddedDocuments = async (type, ids) => { for (const id of ids) scene.drawings.delete(id); };
	globalThis.game = { version: '14.365', user: { id: 'me', isGM: true, can: () => true }, modules: new Map(),
		i18n: { localize: key => key, format: (key, { message }) => message },
		settings: { get: (namespace, key) => key === 'layerWorkspace' ? workspace : 'worlds/test/artwork' } };
	globalThis.ui = { notifications: { info() {}, error() {}, warn() {} } };
	globalThis.canvas = { ready: true, scene, level: { id: 'ground' }, app: { view: {} },
		drawings: { active: true, addChild() {}, controlled: [{ document: new Drawing(base(), { parent: scene }) }],
			paletteCreateData: base(), preview: { addChild() {} } },
		canvasCoordinatesFromClient: point => point };
	globalThis.getDocumentClass = () => Drawing;
	globalThis.loadTexture = async () => ({ valid: true });
	const callbacks = new Map();
	globalThis.Hooks = { on(name, fn) { const id = Symbol(); callbacks.set(id, { name, fn }); return id; },
		callAll(name, ...args) { for (const entry of callbacks.values()) if (entry.name === name) entry.fn(...args); },
		off(name, id) { callbacks.delete(id); } };
	globalThis.window = { addEventListener() {}, removeEventListener() {} };
	uploadResult = { path: 'worlds/test/artwork/stamp-id1.png' };
	globalThis.foundry = { utils: { randomID: () => `id${++id}`,
		expandObject: data => {
			const result = {};
			for (const [key, value] of Object.entries(data)) {
				const parts = key.split('.'); let target = result;
				for (const part of parts.slice(0, -1)) target = target[part] ??= {};
				target[parts.at(-1)] = value;
			}
			return result;
		},
		fetchWithTimeout: async () => ({
		ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => png().buffer,
	}) }, data: { operators: { ForcedDeletion: class {
		toJSON() { return { '__$OPERATOR$__': 'ForcedDeletion' }; }
	} } }, applications: { settings: { menus: { FontConfig: { getAvailableFonts: () => ['Signika'] } } },
		apps: { FilePicker: { implementation: { browse: async () => ({}), upload: async () => uploadResult } } } } };
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.CONFIG = { Drawing: { objectClass: class {
		constructor(document) {
			this.document = document; this.texture = { valid: true, width: 10, height: 20, clone() { return { ...this }; } };
			this.shape = {}; this.renderFlags = { set() {} }; ghostObjects.push(this);
		}
		_getFillStyle() { return { color: 123, alpha: 0.5 }; }
		get previewType() { return this._previewType; }
		async draw() {}
		destroy() { this.destroyed = true; }
	} } };
	globalThis.PIXI = { Matrix: class { scale(x, y) { this.x = x; this.y = y; return this; } } };
});
afterEach(() => { teardownPathEditor(); teardownPathPlacement(); teardownArtworkStamps(); });

function setupPaths() {
	canvas.grid = { size: 100 };
	canvas.level.elevation = { bottom: 0 };
	PIXI.Graphics = class {
		clear() {}
		lineStyle() {}
		moveTo() {}
		lineTo() {}
		destroy() { this.destroyed = true; }
	};
	storedBrush = { ...base(), strokeColor: '#abcdef', strokeAlpha: 0.75 };
	const original = game.settings.get;
	game.settings.get = (namespace, key) => namespace === 'core' ? storedBrush
		: key === 'materialRepeat' ? undefined : original(namespace, key);
	foundry.applications.sheets = { palette: { DrawingPalette: { SETTING_KEY: 'drawingPalette' } } };
	foundry.utils.deepClone = structuredClone;
	configurePath({ style: 'railway', curve: 'smooth', smoothing: 1, meander: 0, bendSpacing: 4, width: 0.6, spacing: 0.35 });
}
let storedBrush;
const pathEvent = (x, y, extra = {}) => ({
	target: canvas.app.view, clientX: x, clientY: y, button: 0, isPrimary: true,
	preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...extra,
});

const retainedRecipe = (style = 'plain') => createPathRecipe([{ x: 100, y: 100 }, { x: 220, y: 100 }], { style });
const retainedTarget = () => ({ layerId: 'ink', levelId: 'ground', elevation: 0, name: 'Test route' });

function enablePathNativeHooks() {
	const update = scene.update, create = scene.createEmbeddedDocuments, replace = scene.updateEmbeddedDocuments,
		remove = scene.deleteEmbeddedDocuments;
	scene.update = async (changes, options = {}) => {
		if (onPreUpdatePathScene(scene, changes, structuredClone(options)) !== false) return update(changes, options);
	};
	scene.createEmbeddedDocuments = async (type, sources, options = {}) => create(type, sources.filter(source =>
		onPreCreateLayerDrawing(new Drawing(source, { parent: scene }), source, structuredClone(options), game.user.id) !== false), options);
	scene.updateEmbeddedDocuments = async (type, patches, options = {}) => replace(type, patches.filter(patch =>
		onPreUpdateLayerDrawing(scene.drawings.get(patch._id), patch, structuredClone(options)) !== false), options);
	scene.deleteEmbeddedDocuments = async (type, ids, options = {}) => remove(type, ids.filter(id =>
		onPreDeleteLayerDrawing(scene.drawings.get(id), structuredClone(options)) !== false), options);
}

function setupEditor() {
	setupPaths();
	PIXI.Graphics.prototype.beginFill = function () {};
	PIXI.Graphics.prototype.endFill = function () {};
	PIXI.Graphics.prototype.drawCircle = function () {};
}

test('any retained component discovers its complete path; mixed and damaged selection is explicit', async () => {
	const route = await createRetainedPath(scene, retainedRecipe('railway'), retainedTarget());
	canvas.drawings.controlled = [{ document: scene.drawings.get(route.components.at(-1).drawingId) }];
	assert.equal(selectedRetainedPath().route.id, route.id);
	const copy = await duplicateRetainedPath(scene, route.id, { expectedRevision: 0, dx: 20 });
	canvas.drawings.controlled.push({ document: scene.drawings.get(copy.components[0].drawingId) });
	assert.throws(() => selectedRetainedPath(), /SelectOnePath/);
	canvas.drawings.controlled.pop();
	scene.drawings.get(route.components[0].drawingId).data.x++;
	assert.equal(selectedRetainedPath().intact, false);
	assert.throws(() => beginPathEdit(route.id), /EditorDamaged/);
	assert.equal(getPathEditorState().active, false);
});

test('full/subtree/whole-selection JSON retains all styles, remaps identities and translations without mutating source artwork',async()=>{
	enablePathNativeHooks();
	for(const style of ['plain','road','river','railway']){
		const route=await createRetainedPath(scene,createPathRecipe([{x:100,y:100},{x:220,y:180},{x:340,y:100}],{style,meander:0.2},100),retainedTarget());
		const ids=route.components.map(c=>c.drawingId),flags=structuredClone(scene.flags);
		const project=exportDrawingSelection(scene,ids);
		assert.equal(project.paths.routes.length,1);assert.deepEqual(project.paths.routes[0].recipe,route.recipe);
		assert.equal(project.pathWarnings.length,0);
		assert.deepEqual(scene.flags,flags);
		const plan=await importDrawingProject(scene,project,{mode:'additive',levelId:'ground',dx:500,dy:50});
		const imported=readPathRegistry(scene).routes.find(r=>r.name===route.name&&r.recipe.waypoints[0].x===600&&r.recipe.options.style===style);
		assert.ok(imported);assert.notEqual(imported.id,route.id);
		assert.equal(imported.recipe.waypoints[0].y,150);
		assert.deepEqual(imported.recipe.options,route.recipe.options);
		assert.equal(imported.recipe.gridSize,100);
		assert.equal(inspectPathIntegrity(scene,imported.id).intact,true);
		assert.ok(imported.components.every(c=>!ids.includes(c.drawingId)));
		assert.equal(plan.beforePaths.routes.length+1,plan.paths.routes.length);
		assert.equal(scene.getFlag('foundryshop','projectImportJournal'),undefined);
	}
	assert.equal(exportDrawingProject(scene).paths.routes.length,8);
	assert.equal(exportDrawingSubtree(scene,'ink').paths.routes.length,4);
});

test('partial/damaged exports and stamps explicitly lose editability without dangling memberships; malformed full packages refuse',async()=>{
	const route=await createRetainedPath(scene,retainedRecipe('road'),retainedTarget());
	const partial=exportDrawingSelection(scene,[route.components[0].drawingId]);
	assert.equal(partial.paths.routes.length,0);assert.deepEqual(partial.pathWarnings,[{name:route.name,reason:'partial'}]);
	assert.equal(partial.drawings[0].data.flags.foundryshop.path,undefined);
	const copy=copySelectedStamp([{document:scene.drawings.get(route.components[0].drawingId)}]);
	assert.equal(copy.paths.routes.length,0);assert.equal(copy.pathWarnings[0].reason,'partial');
	const whole=exportDrawingProject(scene),bad=structuredClone(whole);
	bad.paths.routes[0].components.pop();
	assert.throws(()=>validateProjectPackage(bad),/style/);
	const dangling=structuredClone(whole);delete dangling.paths;
	assert.throws(()=>validateProjectPackage(dangling),/dangling/);
	const foreign=structuredClone(whole);foreign.drawings[0].data.flags.foundryshop.path.id='foreign';
	assert.throws(()=>validateProjectPackage(foreign),/match/);
	scene.drawings.get(route.components[0].drawingId).data.x+=7;
	const damaged=exportDrawingProject(scene);
	assert.equal(damaged.paths.routes.length,0);assert.equal(damaged.pathWarnings[0].reason,'damaged');
	assert.ok(damaged.drawings.every(d=>d.data.flags.foundryshop.path===undefined));
});

test('scaled/rotated complete path stamps and saved shapes preserve recipes/handles and independent native IDs',async()=>{
	setupEditor();enablePathNativeHooks();
	const route=await createRetainedPath(scene,createPathRecipe([{x:100,y:100},{x:220,y:180},{x:340,y:100}],{style:'railway',meander:0.2}),retainedTarget());
	beginPathEdit(route.id);selectPathWaypoint(1);setPathPointMode('corner');await applyPathEdit();
	canvas.drawings.controlled=readPathRegistry(scene).routes[0].components.map(c=>({document:scene.drawings.get(c.drawingId)}));
	const stamp=copySelectedStamp();
	assert.equal(stamp.paths.routes.length,1);
	const expected=transformPathRecipe(stamp.paths.routes[0].recipe,{x:700,y:600,scale:1.5,rotation:90});
	await placeStampAt(stamp,{x:700,y:600},{scale:1.5,rotation:90});
	const placed=readPathRegistry(scene).routes.find(r=>r.id!==route.id);
	assert.deepEqual(placed.recipe,expected);assert.equal(placed.recipe.gridSize,150);
	assert.equal(inspectPathIntegrity(scene,placed.id).intact,true);
	assert.equal(inspectPathIntegrity(scene,route.id).intact,true);
	scene.grid={type:1,size:100};
	const saved=prepareSelectedShape({id:'saved-path',name:'Path Shape',category:'Paths',tags:[]});
	assert.equal(saved.shape.project.paths.routes.length,1);assert.equal(saved.isCurrent(),true);
	const loaded=loadShapeStamp(saved.shape,{gridSize:200});
	assert.equal(loaded.paths.routes[0].recipe.gridSize,200);
	await placeStampAt(loaded,{x:1300,y:500},{scale:1,rotation:0});
	assert.equal(readPathRegistry(scene).routes.length,3);
	assert.ok(readPathRegistry(scene).routes.every(r=>inspectPathIntegrity(scene,r.id).intact));
});

test('retained import registry/release failures compensate, interrupted cleanup preserves existing routes and refuses conflicts',async()=>{
	enablePathNativeHooks();
	const route=await createRetainedPath(scene,retainedRecipe('road'),retainedTarget());
	const project=exportDrawingProject(scene),before=structuredClone(scene.flags),sources=[...scene.drawings.values()].map(d=>d.toObject());
	const update=scene.updateEmbeddedDocuments;let once=true;
	scene.updateEmbeddedDocuments=async(...args)=>{
		if(once&&args[1].some(p=>Object.hasOwn(p,'flags.foundryshop.-=importStaging'))){once=false;throw Error('release failure');}
		return update(...args);
	};
	await assert.rejects(importDrawingProject(scene,project,{mode:'additive',levelId:'ground'}),/own changes were removed/);
	assert.deepEqual(scene.flags,before);assert.deepEqual([...scene.drawings.values()].map(d=>d.toObject()),sources);
	const remove=scene.deleteEmbeddedDocuments;
	scene.updateEmbeddedDocuments=async()=>{throw Error('interrupted release');};
	scene.deleteEmbeddedDocuments=async()=>{throw Error('cleanup unavailable');};
	await assert.rejects(importDrawingProject(scene,project,{mode:'additive',levelId:'ground'}),/Cleanup incomplete/);
	assert.equal(scene.getFlag('foundryshop','projectImportJournal').version,5);
	const staged=structuredClone(scene.flags);
	scene.flags.foundryshop.paths.revision++;
	await assert.rejects(discardInterruptedProjectImport(scene),/paths changed/);
	scene.flags=staged;scene.deleteEmbeddedDocuments=remove;scene.updateEmbeddedDocuments=update;
	await discardInterruptedProjectImport(scene);
	assert.deepEqual(scene.flags,before);assert.equal(inspectPathIntegrity(scene,route.id).intact,true);
});

test('conflict detach preserves changed artwork/missing components, refuses stale review and compensates failures exactly',async()=>{
	enablePathNativeHooks();
	const route=await createRetainedPath(scene,retainedRecipe('road'),retainedTarget());
	scene.drawings.get(route.components[0].drawingId).data.x+=12;
	scene.drawings.delete(route.components[1].drawingId);
	let snapshot=pathConflictSnapshot(scene,route.id);
	assert.ok(snapshot.issues.some(i=>i.kind==='changed-artwork'));assert.ok(snapshot.issues.some(i=>i.kind==='missing-component'));
	scene.drawings.get(route.components[0].drawingId).data.x++;
	await assert.rejects(detachConflictingPath(scene,route.id,{expectedSnapshot:snapshot}),/changed after review/);
	snapshot=pathConflictSnapshot(scene,route.id);
	const before=structuredClone(scene.flags),sources=[...scene.drawings.values()].map(d=>d.toObject());
	const update=scene.update;let once=true;
	scene.update=async(changes,options)=>{
		if(once&&Object.hasOwn(changes,'flags.foundryshop.paths')){once=false;throw Error('conflict save failure');}
		return update(changes,options);
	};
	await assert.rejects(detachConflictingPath(scene,route.id,{expectedSnapshot:snapshot}),/conflict save failure/);
	assert.deepEqual(scene.flags,before);assert.deepEqual([...scene.drawings.values()].map(d=>d.toObject()),sources);
	await detachConflictingPath(scene,route.id,{expectedSnapshot:snapshot});
	assert.equal(readPathRegistry(scene).routes.length,0);
	const remaining=scene.drawings.get(route.components[0].drawingId).toObject(),original=sources[0];
	delete original.flags.foundryshop.path;assert.deepEqual(remaining,original);
	assert.equal(scene.drawings.size,1);assert.equal(getPathHistoryState(scene).undo,false);
});

test('conflict detach handles fully missing paths without resurrection and respects locks on remaining artwork',async()=>{
	enablePathNativeHooks();
	const route=await createRetainedPath(scene,retainedRecipe('plain'),retainedTarget());
	const drawing=scene.drawings.get(route.components[0].drawingId);
	drawing.data.x++;drawing.data.locked=true;
	await assert.rejects(detachConflictingPath(scene,route.id,{expectedSnapshot:pathConflictSnapshot(scene,route.id)}),/Unlock/);
	assert.equal(readPathRegistry(scene).routes.length,1);
	scene.drawings.clear();
	await detachConflictingPath(scene,route.id,{expectedSnapshot:pathConflictSnapshot(scene,route.id)});
	assert.equal(scene.drawings.size,0);assert.equal(readPathRegistry(scene).routes.length,0);
	assert.equal(scene.getFlag('foundryshop','pathJournal'),undefined);
});

test('waypoint draft supports exact coordinates, endpoints and deletion with read-only Cancel', async () => {
	setupEditor();
	const route = await createRetainedPath(scene, createPathRecipe([{x:100,y:100},{x:160,y:180},{x:220,y:100}],{style:'plain'}), retainedTarget());
	const before = structuredClone(scene.flags), artwork = [...scene.drawings.values()].map(d => d.toObject());
	beginPathEdit(route.id);
	selectPathWaypoint(1); setPathWaypoint({ x: 170, y: 190 });
	assert.deepEqual(getPathEditorState().recipe.waypoints[1], {x:170,y:190,mode:'automatic',incoming:null,outgoing:null});
	deletePathWaypoint(); assert.equal(getPathEditorState().recipe.waypoints.length, 2);
	assert.throws(() => deletePathWaypoint(), /waypoint count/);
	assert.deepEqual(scene.flags, before); assert.deepEqual([...scene.drawings.values()].map(d => d.toObject()), artwork);
	cancelPathEdit(); assert.equal(getPathEditorState().active, false);
	assert.deepEqual(scene.flags, before);
});

test('pointer drag, insertion and Apply use the retained transaction and preserve saved appearance', async () => {
	setupEditor(); enablePathNativeHooks();
	const route = await createRetainedPath(scene, retainedRecipe(), retainedTarget());
	beginPathEdit(route.id);
	onPathEditorPointer(pathEvent(100,100,{pointerId:7}));
	onPathEditorMove(pathEvent(110,120,{pointerId:8}));
	assert.equal(getPathEditorState().recipe.waypoints[0].x, 100);
	onPathEditorMove(pathEvent(110,120,{pointerId:7}));
	onPathEditorUp(pathEvent(110,120,{pointerId:7}));
	assert.equal(getPathEditorState().recipe.waypoints[0].x, 110);
	togglePathInsertion();
	onPathEditorPointer(pathEvent(165,110,{pointerId:9}));
	assert.equal(getPathEditorState().recipe.waypoints.length, 3);
	assert.equal(getPathEditorState().insert, false);
	assert.equal(readPathRegistry(scene).routes[0].recipe.waypoints.length, 2);
	await applyPathEdit();
	const updated = readPathRegistry(scene).routes[0];
	assert.equal(updated.revision, 1); assert.equal(updated.recipe.waypoints.length, 3);
	assert.deepEqual(updated.recipe.options, route.recipe.options);
	assert.equal(inspectPathIntegrity(scene, route.id).intact, true);
	assert.equal(getPathEditorState().active, false);
});

test('editor rejects locks, stale external edits and changed Levels without replacing native artwork', async () => {
	setupEditor();
	const route = await createRetainedPath(scene, retainedRecipe(), retainedTarget());
	beginPathEdit(route.id);
	scene.drawings.get(route.components[0].drawingId).data.x++;
	await assert.rejects(applyPathEdit(), /EditorChanged/);
	assert.equal(scene.getFlag('foundryshop','pathJournal'), undefined);
	cancelPathEdit(); scene.drawings.get(route.components[0].drawingId).data.x--;
	scene.drawings.get(route.components[0].drawingId).data.locked = true;
	assert.throws(() => beginPathEdit(route.id), /EditorLocked/);
	scene.drawings.get(route.components[0].drawingId).data.locked = false;
	canvas.level.id = 'other';
	assert.throws(() => beginPathEdit(route.id), /EditorChanged/);
});

test('pen handle drag links Smooth, ignores other pointers, restores cancelled gesture and persists manual controls', async () => {
	setupEditor(); enablePathNativeHooks();
	const recipe=createPathRecipe([{x:100,y:100},{x:200,y:160},{x:320,y:100}],{style:'plain'});
	const route=await createRetainedPath(scene,recipe,retainedTarget());
	beginPathEdit(route.id);selectPathWaypoint(1);setPathPointMode('smooth');
	const before=getPathEditorState().recipe, handle=before.waypoints[1].outgoing;
	onPathEditorPointer(pathEvent(handle.x,handle.y,{pointerId:31,pointerType:'pen'}));
	onPathEditorMove(pathEvent(handle.x+20,handle.y+40,{pointerId:31,pointerType:'pen'}));
	assert.notDeepEqual(getPathEditorState().recipe,before);
	onPathEditorUp(pathEvent(handle.x,handle.y,{pointerId:32,pointerType:'touch',type:'pointercancel'}));
	onPathEditorMove(pathEvent(handle.x+25,handle.y+45,{pointerId:31,pointerType:'pen'}));
	assert.equal(getPathEditorState().recipe.waypoints[1].outgoing.x,handle.x+25);
	onPathEditorUp(pathEvent(handle.x,handle.y,{pointerId:31,pointerType:'pen',type:'pointercancel'}));
	assert.deepEqual(getPathEditorState().recipe,before);
	setPathPointMode('corner');setPathHandle('incoming',{x:160,y:210});
	const committed=getPathEditorState().recipe;
	await applyPathEdit();
	assert.deepEqual(readPathRegistry(scene).routes[0].recipe,committed);
	assert.equal(inspectPathIntegrity(scene,route.id).intact,true);
	beginPathEdit(route.id);
	assert.deepEqual(getPathEditorState().recipe,committed);
	cancelPathEdit();
});

test('saved appearance, variation and closed-loop changes are draft-only until verified Apply across all styles',async()=>{
	setupEditor();enablePathNativeHooks();
	for(const style of ['plain','road','river','railway']){
		const recipe=createPathRecipe([{x:100,y:100},{x:300,y:100},{x:300,y:300},{x:100,y:300}],{style,spacing:1});
		const route=await createRetainedPath(scene,recipe,retainedTarget());
		const before=structuredClone(scene.flags),artwork=[...scene.drawings.values()].map(d=>d.toObject());
		beginPathEdit(route.id);
		configurePathEdit({closed:true,color:'#aabbcc',alpha:0.3,width:0.03,meander:0.1});
		const seed=getPathEditorState().recipe.options.seed;
		rerollPathEdit();assert.notEqual(getPathEditorState().recipe.options.seed,seed);
		assert.deepEqual(scene.flags,before);assert.deepEqual([...scene.drawings.values()].map(d=>d.toObject()),artwork);
		const draft=getPathEditorState().recipe;
		assert.throws(()=>configurePathEdit({width:0}),/Invalid/);
		assert.deepEqual(getPathEditorState().recipe,draft);
		cancelPathEdit();assert.deepEqual(scene.flags,before);
		beginPathEdit(route.id);configurePathEdit({...draft.options,closed:true});await applyPathEdit();
		const saved=readPathRegistry(scene).routes.find(p=>p.id===route.id);
		assert.deepEqual(saved.recipe,draft);assert.equal(inspectPathIntegrity(scene,route.id).intact,true);
		beginPathEdit(route.id);assert.deepEqual(getPathEditorState().recipe,draft);cancelPathEdit();
	}
});

test('whole-path translation, create/edit/duplicate/delete/detach undo and redo restore recipes and native identities together',async()=>{
	setupEditor();enablePathNativeHooks();
	const route=await createRetainedPath(scene,createPathRecipe([{x:100,y:100},{x:200,y:150},{x:300,y:100}],{style:'plain'}),retainedTarget());
	beginPathEdit(route.id);selectPathWaypoint(1);setPathPointMode('corner');
	const original=getPathEditorState().recipe;
	translatePathEdit(20,-10);
	const draft=getPathEditorState().recipe;
	assert.equal(draft.waypoints[1].x,220);assert.equal(draft.waypoints[1].incoming.x,original.waypoints[1].incoming.x+20);
	assert.equal(readPathRegistry(scene).routes[0].recipe.waypoints[0].x,100);
	await applyPathEdit();
	const sources=[...scene.drawings.values()].map(d=>d.toObject());
	await undoRetainedPath(scene);
	assert.deepEqual(readPathRegistry(scene).routes[0].recipe,route.recipe);
	assert.equal(inspectPathIntegrity(scene,route.id).intact,true);
	await redoRetainedPath(scene);
	assert.deepEqual(readPathRegistry(scene).routes[0].recipe,draft);
	assert.deepEqual([...scene.drawings.values()].map(d=>d.toObject()),sources);
	let current=readPathRegistry(scene).routes[0];
	const copy=await duplicateRetainedPath(scene,current.id,{expectedRevision:current.revision,dx:100,dy:20});
	assert.notEqual(copy.components[0].drawingId,current.components[0].drawingId);
	await undoRetainedPath(scene);assert.equal(scene.drawings.size,1);
	await redoRetainedPath(scene);assert.equal(scene.drawings.size,2);assert.equal(inspectPathIntegrity(scene,copy.id).intact,true);
	current=readPathRegistry(scene).routes.find(r=>r.id===copy.id);
	await detachRetainedPath(scene,copy.id,{expectedRevision:current.revision});
	assert.equal(readPathRegistry(scene).routes.length,1);
	await undoRetainedPath(scene);assert.equal(inspectPathIntegrity(scene,copy.id).intact,true);
	await redoRetainedPath(scene);assert.equal(readPathRegistry(scene).routes.length,1);
	await undoRetainedPath(scene);
	current=readPathRegistry(scene).routes.find(r=>r.id===copy.id);
	await deleteRetainedPath(scene,copy.id,{expectedRevision:current.revision});
	assert.equal(scene.drawings.size,1);
	await undoRetainedPath(scene);assert.equal(inspectPathIntegrity(scene,copy.id).intact,true);
	await redoRetainedPath(scene);assert.equal(scene.drawings.size,1);
	assert.equal(getPathHistoryState(scene).redo,false);
	assert.equal(scene.getFlag('foundryshop','pathJournal'),undefined);
});

test('draft undo groups a drag, restores handles/settings, ignores cancelled gestures and clears redo on a new change',async()=>{
	setupEditor();
	const route=await createRetainedPath(scene,retainedRecipe('plain'),retainedTarget());
	const before=structuredClone(scene.flags),sources=[...scene.drawings.values()].map(d=>d.toObject());
	beginPathEdit(route.id);
	setPathPointMode('corner');const manual=getPathEditorState().recipe;
	translatePathEdit(20,-10);const moved=getPathEditorState().recipe;
	configurePathEdit({width:0.4});
	undoPathDraft();assert.deepEqual(getPathEditorState().recipe,moved);
	undoPathDraft();assert.deepEqual(getPathEditorState().recipe,manual);
	undoPathDraft(true);assert.deepEqual(getPathEditorState().recipe,moved);
	setPathWaypoint({x:150,y:150});assert.equal(getPathEditorState().redo,false);
	undoPathDraft();assert.deepEqual(getPathEditorState().recipe,moved);
	const p=moved.waypoints[0];
	onPathEditorPointer(pathEvent(p.x,p.y,{pointerId:41}));
	onPathEditorMove(pathEvent(p.x+10,p.y+10,{pointerId:41}));
	onPathEditorMove(pathEvent(p.x+20,p.y+20,{pointerId:41}));
	assert.throws(()=>translatePathEdit(1,1),/EditorChanged/);
	onPathEditorUp(pathEvent(p.x+20,p.y+20,{pointerId:41}));
	undoPathDraft();assert.deepEqual(getPathEditorState().recipe,moved);
	assert.equal(getPathEditorState().redo,true);
	onPathEditorPointer(pathEvent(p.x,p.y,{pointerId:42}));
	onPathEditorMove(pathEvent(p.x+30,p.y+30,{pointerId:42}));
	onPathEditorUp(pathEvent(p.x,p.y,{pointerId:42,type:'pointercancel'}));
	assert.deepEqual(getPathEditorState().recipe,moved);assert.equal(getPathEditorState().redo,true);
	onPathEditorKey(pathEvent(0,0,{key:'z',ctrlKey:true,target:{tagName:'INPUT'}}));
	assert.deepEqual(getPathEditorState().recipe,moved);
	onPathEditorKey(pathEvent(0,0,{key:'z',ctrlKey:true,target:{}}));
	assert.deepEqual(getPathEditorState().recipe,manual);
	onPathEditorKey(pathEvent(0,0,{key:'z',ctrlKey:true,shiftKey:true,target:{}}));
	assert.deepEqual(getPathEditorState().recipe,moved);
	assert.deepEqual(scene.flags,before);assert.deepEqual([...scene.drawings.values()].map(d=>d.toObject()),sources);
	cancelPathEdit();beginPathEdit(route.id);assert.equal(getPathEditorState().undo,false);cancelPathEdit();
});

test('create history replays to empty and back, keeping IDs and increasing resurrected route revisions',async()=>{
	enablePathNativeHooks();
	const route=await createRetainedPath(scene,retainedRecipe('plain'),retainedTarget());
	const sources=[...scene.drawings.values()].map(d=>d.toObject());let revision=route.revision;
	for(let i=0;i<3;i++){
		await undoRetainedPath(scene);assert.equal(scene.drawings.size,0);assert.equal(readPathRegistry(scene).routes.length,0);
		await redoRetainedPath(scene);
		const restored=readPathRegistry(scene).routes[0];
		assert.ok(restored.revision>revision);revision=restored.revision;
		assert.deepEqual(restored.components,route.components);assert.deepEqual([...scene.drawings.values()].map(d=>d.toObject()),sources);
		assert.equal(inspectPathIntegrity(scene,route.id).intact,true);
	}
	await assert.rejects(updateRetainedPath(scene,route.id,retainedRecipe('road'),{expectedRevision:route.revision}),/Path changed/);
});

test('draft history retains exactly the latest 20 changes and preserves native artwork',async()=>{
	setupEditor();
	const route=await createRetainedPath(scene,retainedRecipe('plain'),retainedTarget());
	beginPathEdit(route.id);
	for(let i=1;i<=22;i++)setPathWaypoint({x:100+i,y:100});
	let count=0;
	while(getPathEditorState().undo){undoPathDraft();count++;}
	assert.equal(count,20);assert.equal(getPathEditorState().recipe.waypoints[0].x,102);
	assert.throws(()=>undoPathDraft(),/HistoryEmpty/);
	count=0;while(getPathEditorState().redo){undoPathDraft(true);count++;}
	assert.equal(count,20);assert.equal(getPathEditorState().recipe.waypoints[0].x,122);
	assert.equal(readPathRegistry(scene).routes[0].recipe.waypoints[0].x,100);
	cancelPathEdit();
});

test('history refuses new native sort collisions and native undo membership injection variants',async()=>{
	enablePathNativeHooks();
	const route=await createRetainedPath(scene,retainedRecipe('plain'),retainedTarget());
	await deleteRetainedPath(scene,route.id,{expectedRevision:0});
	const peer=new Drawing({...base(),_id:'peer',sort:1024,levels:['ground'],flags:{foundryshop:{layerId:'ink'}}},{parent:scene});
	scene.drawings.set(peer.id,peer);
	const before=structuredClone(scene.flags);
	await assert.rejects(undoRetainedPath(scene),/stack position/);
	assert.deepEqual(scene.flags,before);assert.equal(scene.drawings.size,1);
	const membership={version:1,id:route.id,role:'stroke'};
	for(const changes of [{[`flags.foundryshop`]:{path:membership}},{[`flags.foundryshop.path.id`]:route.id},{flags:{foundryshop:{path:membership}}}]){
		assert.equal(onPreUpdateLayerDrawing(peer,changes,{isUndo:true}),false);
	}
});

test('path history refuses affected external edits, locks and native retained undo; unrelated artwork stays edited',async()=>{
	setupEditor();enablePathNativeHooks();
	const route=await createRetainedPath(scene,retainedRecipe('plain'),retainedTarget());
	await updateRetainedPath(scene,route.id,createPathRecipe([{x:110,y:110},{x:230,y:110}],{style:'plain'}),{expectedRevision:0});
	const drawing=scene.drawings.get(route.components[0].drawingId);
	drawing.data.x++;
	await assert.rejects(undoRetainedPath(scene),/HistoryConflict/);
	assert.equal(getPathHistoryState(scene).undo,true);
	drawing.data.x--;
	assert.equal(onPreUpdateLayerDrawing(drawing,{x:10},{isUndo:true}),false);
	assert.equal(onPreDeleteLayerDrawing(drawing,{isUndo:true}),false);
	drawing.data.locked=true;
	await assert.rejects(undoRetainedPath(scene),/HistoryConflict|Unlock/);
	drawing.data.locked=false;
	const unrelated=new Drawing({...base(),_id:'unrelated',x:44,sort:9999,levels:['ground'],flags:{foundryshop:{layerId:'ink'}}},{parent:scene});
	scene.drawings.set(unrelated.id,unrelated);
	unrelated.data.x=55;
	await undoRetainedPath(scene);
	assert.equal(scene.drawings.get('unrelated').data.x,55);
	assert.equal(inspectPathIntegrity(scene,route.id).intact,true);
	const state=getPathHistoryState(scene);
	await assert.rejects(redoRetainedPath(scene,{isCurrent:()=>false}),/destination changed/);
	assert.deepEqual(getPathHistoryState(scene),state);
	assert.equal(scene.getFlag('foundryshop','pathJournal'),undefined);
});

test('history replay failure compensates exactly, preserves cursor and new success discards redo',async()=>{
	setupEditor();enablePathNativeHooks();
	const route=await createRetainedPath(scene,retainedRecipe('plain'),retainedTarget());
	await updateRetainedPath(scene,route.id,retainedRecipe('road'),{expectedRevision:0});
	const before=structuredClone(scene.flags),sources=[...scene.drawings.values()].map(d=>d.toObject());
	const remove=scene.deleteEmbeddedDocuments;let once=true;
	scene.deleteEmbeddedDocuments=async(...args)=>{if(once){once=false;throw new Error('history delete failure');}return remove(...args);};
	await assert.rejects(undoRetainedPath(scene),/history delete failure/);
	assert.deepEqual(scene.flags,before);assert.deepEqual([...scene.drawings.values()].map(d=>d.toObject()),sources);
	assert.equal(getPathHistoryState(scene).redo,false);
	await undoRetainedPath(scene);assert.equal(getPathHistoryState(scene).redo,true);
	const current=readPathRegistry(scene).routes[0];
	await updateRetainedPath(scene,route.id,retainedRecipe('river'),{expectedRevision:current.revision});
	assert.equal(getPathHistoryState(scene).redo,false);
	clearPathHistory(scene);assert.equal(getPathHistoryState(scene).undo,false);
	await assert.rejects(undoRetainedPath(scene),/HistoryEmpty/);
});

test('invalid draft motion is recoverable, focused-input keys are ignored and tool lifecycle cancels read-only', async () => {
	setupEditor(); initPathEditor();
	const route = await createRetainedPath(scene, retainedRecipe(), retainedTarget());
	beginPathEdit(route.id);
	assert.throws(() => setPathWaypoint({x:NaN,y:20}), /coordinates/);
	assert.equal(getPathEditorState().recipe.waypoints[0].x, 100);
	onPathEditorKey({key:'Escape',target:{tagName:'INPUT'}});
	assert.equal(getPathEditorState().active, true);
	onPathEditorBlur({target:{tagName:'INPUT'}});
	assert.equal(getPathEditorState().active, true);
	onPathEditorBlur({target:window});
	assert.equal(getPathEditorState().active, false);
	beginPathEdit(route.id);
	Hooks.callAll('deactivateDrawingsLayer');
	assert.equal(getPathEditorState().active, false);
	assert.equal(readPathRegistry(scene).routes[0].revision, 0);
});

test('failed Apply keeps its draft for review and cannot claim success', async () => {
	setupEditor();
	const route = await createRetainedPath(scene, retainedRecipe(), retainedTarget());
	beginPathEdit(route.id);setPathWaypoint({x:110,y:110});
	scene.updateEmbeddedDocuments = async () => { throw new Error('QA editor update failed'); };
	await assert.rejects(applyPathEdit(), /QA editor update failed/);
	assert.equal(getPathEditorState().active, true);
	assert.equal(getPathEditorState().pending, false);
	assert.match(getPathEditorState().error, /QA editor update failed/);
	assert.equal(readPathRegistry(scene).routes[0].revision, 0);
});

test('scoped path writes pass native hooks for create, update, duplicate, detach and delete', async () => {
	enablePathNativeHooks();
	const route = await createRetainedPath(scene, retainedRecipe(), retainedTarget());
	await updateRetainedPath(scene, route.id, retainedRecipe('road'), { expectedRevision: 0 });
	const copy = await duplicateRetainedPath(scene, route.id, { expectedRevision: 1, dx: 20 });
	await detachRetainedPath(scene, copy.id, { expectedRevision: 0 });
	await deleteRetainedPath(scene, route.id, { expectedRevision: 1 });
	assert.equal(readPathRegistry(scene).routes.length, 0);
	assert.equal(scene.drawings.size, 2);
	assert.equal(scene.getFlag('foundryshop', 'pathJournal'), undefined);
});

test('pending path transaction blocks unrelated native writes, copy/export/publication and import preparation', async () => {
	const unrelated = new Drawing({ ...base(), _id: 'peer', levels: ['ground'] }, { parent: scene });
	scene.drawings.set(unrelated.id, unrelated);
	const create = scene.createEmbeddedDocuments;
	scene.createEmbeddedDocuments = async (...args) => {
		assert.equal(onPreCreateLayerDrawing(new Drawing(base(), { parent: scene }), base(), {}, game.user.id), false);
		assert.equal(onPreUpdateLayerDrawing(unrelated, { _id: unrelated.id, x: 99 }, {}), false);
		assert.equal(onPreDeleteLayerDrawing(unrelated, {}), false);
		assert.equal(onPreUpdatePathScene(scene, { name: 'Changed' }, {}), false);
		for (const action of [
			() => copySelectedStamp([{ document: unrelated }]),
			() => exportDrawingProject(scene),
			() => exportDrawingSelection(scene, ['peer']),
			() => publicationSnapshot(scene, 'ground', { audience: 'gm', nodeId: null }),
			() => layerArtworkSnapshot(scene, 'ink', 'ground'),
			() => prepareProjectImport(scene, {}),
		]) assert.throws(action, /PendingOperation/);
		return create(...args);
	};
	const route = await createRetainedPath(scene, retainedRecipe(), retainedTarget());
	assert.equal(inspectPathIntegrity(scene, route.id).intact, true);
});

test('path staging suppresses only changed path components for both audiences, then releases after commit', async () => {
	const peer = new Drawing({ ...base(), _id: 'peer', levels: ['ground'] }, { parent: scene });
	scene.drawings.set(peer.id, peer);
	const create = scene.createEmbeddedDocuments;
	scene.createEmbeddedDocuments = async (...args) => {
		await create(...args);
		for (const isGM of [true, false]) {
			game.user.isGM = isGM;
			for (const drawing of scene.drawings.values()) {
				const object = { document: drawing, visible: true, shape: { visible: true }, text: { visible: true } };
				if (drawing.id === 'peer') { assert.equal(isPendingPathDrawing(drawing), false); continue; }
				applyDrawingVisibility(object);
				assert.equal(object.visible, false); assert.equal(object.shape.visible, false);
			}
		}
		game.user.isGM = true;
	};
	const route = await createRetainedPath(scene, retainedRecipe('railway'), retainedTarget());
	assert.ok(route.components.every(c => !isPendingPathDrawing(scene.drawings.get(c.drawingId))));
	for (const c of route.components) {
		const object = { document: scene.drawings.get(c.drawingId), visible: true };
		applyDrawingVisibility(object); assert.equal(object.visible, true);
	}
});

test('path native permission expires, refuses altered patches/ownership and does not bypass layer locks', async () => {
	const drawing = new Drawing({ ...base(), _id: 'peer', levels: ['ground'] }, { parent: scene });
	scene.drawings.set(drawing.id, drawing);
	scene.flags.foundryshop.pathJournal = { token: 'journal' };
	const patch = { _id: drawing.id, x: 15 };
	let saved;
	await withPathWrite(scene, 'update', [patch], {}, async options => {
		saved = structuredClone(options);
		assert.equal(isAuthorizedPathWrite(drawing, 'update', patch, saved), true);
		assert.equal(isAuthorizedPathWrite(drawing, 'update', { ...patch, x: 30 }, saved), false);
		assert.equal(isAuthorizedPathWrite(drawing, 'delete', null, saved), false);
		scene.flags.foundryshop.layers = { ...scene.flags.foundryshop.layers,
			nodes: scene.flags.foundryshop.layers.nodes.map(node => ({ ...node, locked: true })) };
		assert.equal(onPreUpdateLayerDrawing(drawing, patch, saved), false);
		scene.flags.foundryshop.pathJournal = { token: 'other' };
		assert.equal(isAuthorizedPathWrite(drawing, 'update', patch, saved), false);
	});
	scene.flags.foundryshop.pathJournal = { token: 'journal' };
	assert.equal(isAuthorizedPathWrite(drawing, 'update', patch, saved), false);
});

test('recovery prompt cancels without writes and refuses a changed journal after confirmation', async () => {
	const create = scene.createEmbeddedDocuments;
	scene.createEmbeddedDocuments = async (type, sources, options) => {
		await create(type, sources.slice(0, 1), options); throw new Error('interrupted create');
	};
	scene.deleteEmbeddedDocuments = async () => { throw new Error('interrupted compensation'); };
	await assert.rejects(createRetainedPath(scene, retainedRecipe(), retainedTarget()), /Recovery incomplete/);
	const before = structuredClone(scene.flags);
	globalThis.document = { createElement: tag => ({ tagName: tag.toUpperCase(), textContent: '' }) };
	foundry.applications.api = { DialogV2: { confirm: async options => {
		assert.ok(options.classes.includes('fshop-dialog')); assert.ok(options.content.textContent);
		assert.equal(options.content.tagName, 'DIV');
		return false;
	} } };
	await promptRetainedPathRecovery(scene);
	assert.deepEqual(scene.flags, before);
	foundry.applications.api.DialogV2.confirm = async () => {
		scene.flags.foundryshop.pathJournal.token = 'changedJournal'; return true;
	};
	await assert.rejects(promptRetainedPathRecovery(scene), /changed after review/);
	assert.equal(scene.drawings.size, 1);
});

test('retained path creation commits native membership and one registry recipe without unrelated changes', async () => {
	const unrelated = new Drawing({ ...base(), _id: 'peer', elevation: 0, levels: ['ground'] }, { parent: scene });
	scene.drawings.set(unrelated.id, unrelated);
	const before = unrelated.toObject();
	const route = await createRetainedPath(scene, retainedRecipe('railway'), retainedTarget());
	assert.equal(route.components.length, 6);
	assert.deepEqual(scene.drawings.get('peer').toObject(), before);
	assert.equal(readPathRegistry(scene).routes.length, 1);
	assert.equal(inspectPathIntegrity(scene, route.id).intact, true);
	assert.equal(scene.getFlag('foundryshop', 'pathJournal'), undefined);
	assert.ok(route.components.every(c => scene.drawings.get(c.drawingId).getFlag('foundryshop', 'path').id === route.id));
});

test('retained path replacement preserves identity and verifies shrinking/growing component sets', async () => {
	const route = await createRetainedPath(scene, retainedRecipe(), retainedTarget());
	const originalId = route.components[0].drawingId;
	const changed = await updateRetainedPath(scene, route.id, retainedRecipe('railway'), { expectedRevision: 0 });
	assert.equal(changed.id, route.id);
	assert.equal(changed.revision, 1);
	assert.ok(changed.components.every(component => component.drawingId !== originalId));
	assert.equal(scene.drawings.size, 6);
	assert.equal(inspectPathIntegrity(scene, route.id).intact, true);
	const shrunk = await updateRetainedPath(scene, route.id, retainedRecipe(), { expectedRevision: 1 });
	assert.equal(shrunk.revision, 2);
	assert.equal(scene.drawings.size, 1);
	assert.equal(inspectPathIntegrity(scene, route.id).intact, true);
	await deleteRetainedPath(scene, route.id, { expectedRevision: 2 });
	assert.equal(scene.drawings.size, 0);
	assert.equal(readPathRegistry(scene).routes.length, 0);
	assert.equal(scene.getFlag('foundryshop', 'pathJournal'), undefined);
});

test('retained duplicates have independent recipe/component identities and preserve original artwork', async () => {
	const route = await createRetainedPath(scene, retainedRecipe(), retainedTarget());
	const duplicate = await duplicateRetainedPath(scene, route.id, { expectedRevision: 0, dx: 50, dy: 100 });
	assert.notEqual(duplicate.id, route.id);
	assert.notEqual(duplicate.components[0].drawingId, route.components[0].drawingId);
	assert.deepEqual(duplicate.recipe.waypoints.map(p => [p.x,p.y]), [[150,200],[270,200]]);
	assert.deepEqual(readPathRegistry(scene).routes[0].recipe, route.recipe);
	assert.equal(inspectPathIntegrity(scene, route.id).intact, true);
	assert.equal(inspectPathIntegrity(scene, duplicate.id).intact, true);
	await deleteRetainedPath(scene, duplicate.id, { expectedRevision: 0 });
	assert.equal(scene.drawings.size, 1);
	assert.equal(readPathRegistry(scene).routes[0].id, route.id);
});

test('detaching keeps exactly the native artwork and layer membership without retained references', async () => {
	const route = await createRetainedPath(scene, retainedRecipe('railway'), retainedTarget());
	const expected = [...scene.drawings.values()].map(d => {
		const source = d.toObject(); delete source.flags.foundryshop.path; return source;
	});
	await detachRetainedPath(scene, route.id, { expectedRevision: 0 });
	assert.deepEqual([...scene.drawings.values()].map(d => d.toObject()), expected);
	assert.equal(readPathRegistry(scene).routes.length, 0);
	assert.equal(scene.getFlag('foundryshop', 'pathJournal'), undefined);
});

test('path destination gates and native cleaning refuse before journaling', async () => {
	for (const options of [
		{ ...retainedTarget(), layerId: 'missing' }, { ...retainedTarget(), levelId: 'missing' },
		{ ...retainedTarget(), elevation: NaN },
	]) await assert.rejects(createRetainedPath(scene, retainedRecipe(), options), /unavailable/);
	workspace.scenes.dest.hiddenIds = ['ink'];
	await assert.rejects(createRetainedPath(scene, retainedRecipe(), retainedTarget()), /unavailable/);
	workspace.scenes.dest.hiddenIds = [];
	game.user.can = () => false;
	await assert.rejects(createRetainedPath(scene, retainedRecipe(), retainedTarget()), /permission/);
	game.user.can = () => true;
	globalThis.getDocumentClass = () => class extends Drawing {
		constructor(...args) { super(...args); this.data.strokeWidth = 999; }
	};
	await assert.rejects(createRetainedPath(scene, retainedRecipe(), retainedTarget()), /validation changed/);
	assert.equal(scene.getFlag('foundryshop', 'pathJournal'), undefined);
	assert.equal(scene.drawings.size, 0);
});

test('hidden path grows without turning its newly generated components visible', async () => {
	const route = await createRetainedPath(scene, retainedRecipe(), retainedTarget());
	scene.drawings.get(route.components[0].drawingId).data.hidden = true;
	const changed = await updateRetainedPath(scene, route.id, retainedRecipe('railway'), { expectedRevision: 0 });
	assert.equal(changed.components.length, 6);
	assert.ok([...scene.drawings.values()].every(d => d.data.hidden));
});

test('native nested defaults and absent optional names do not reject valid generated paths', async () => {
	globalThis.getDocumentClass = () => class extends Drawing {
		constructor(...args) { super(...args); this.data.shape.radius ??= null; }
	};
	const peer = new Drawing({ ...base(), _id: 'peer', name: undefined }, { parent: scene });
	scene.drawings.set(peer.id, peer);
	const route = await createRetainedPath(scene, retainedRecipe(), retainedTarget());
	assert.equal(inspectPathIntegrity(scene, route.id).intact, true);
	assert.equal(scene.drawings.get(route.components[0].drawingId).data.shape.radius, null);
	assert.equal(peer.data.name, undefined);
});

test('growing a crowded path preserves its position between surrounding artwork', async () => {
	const route = await createRetainedPath(scene, retainedRecipe(), retainedTarget());
	const member = scene.drawings.get(route.components[0].drawingId);
	member.data.sort = 2;
	for (const [id, sort] of [['below', 1], ['above', 3]]) {
		scene.drawings.set(id, new Drawing({ ...base(), _id: id, sort, levels: ['ground'] }, { parent: scene }));
	}
	const changed = await updateRetainedPath(scene, route.id, retainedRecipe('railway'), { expectedRevision: 0 });
	const sorts = changed.components.map(c => scene.drawings.get(c.drawingId).sort);
	assert.ok(sorts.every(sort => sort > scene.drawings.get('below').sort && sort < scene.drawings.get('above').sort));
	assert.equal(new Set([...scene.drawings.values()].map(d => d.sort)).size, scene.drawings.size);
	assert.equal(inspectPathIntegrity(scene, route.id).intact, true);
});

test('malformed or cross-scene recovery journals refuse without native mutations', async () => {
	for (const journal of [
		{ version: 1 },
		{ version: 1, sceneId: 'elsewhere', token: 'token', beforeRegistry: null,
			afterRegistry: { version: 1, revision: 0, routes: [] }, before: [], after: [] },
		{ version: 1, sceneId: 'dest', token: 'token', beforeRegistry: null,
			afterRegistry: { version: 1, revision: 0, routes: [] }, before: [null], after: [] },
	]) {
		scene.flags.foundryshop.pathJournal = journal;
		await assert.rejects(recoverRetainedPathOperation(scene), /Invalid/);
		assert.equal(scene.drawings.size, 0);
		assert.deepEqual(scene.getFlag('foundryshop', 'pathJournal'), journal);
	}
});

test('silent registry write and journal removal failures cannot report a successful path commit', async () => {
	const update = scene.update;
	scene.update = async changes => {
		if (!Object.hasOwn(changes, 'flags.foundryshop.paths')) await update(changes);
	};
	await assert.rejects(createRetainedPath(scene, retainedRecipe(), retainedTarget()), /registry write/);
	assert.equal(scene.drawings.size, 0);
	assert.equal(scene.getFlag('foundryshop', 'pathJournal'), undefined);
	scene.update = update;
	scene.update = async changes => {
		if (!(changes['flags.foundryshop.pathJournal'] instanceof foundry.data.operators.ForcedDeletion)) await update(changes);
	};
	await assert.rejects(createRetainedPath(scene, retainedRecipe(), retainedTarget()), /Recovery incomplete/);
	assert.ok(scene.getFlag('foundryshop', 'pathJournal'));
});

test('retained path refuses stale edits, damaged components and locks before document work', async () => {
	const route = await createRetainedPath(scene, retainedRecipe(), retainedTarget());
	await assert.rejects(updateRetainedPath(scene, route.id, retainedRecipe(), { expectedRevision: 1 }), /Path changed/);
	const drawing = scene.drawings.get(route.components[0].drawingId);
	drawing.data.x++;
	await assert.rejects(updateRetainedPath(scene, route.id, retainedRecipe(), { expectedRevision: 0 }), /Path changed/);
	drawing.data.x--; drawing.data.locked = true;
	await assert.rejects(deleteRetainedPath(scene, route.id, { expectedRevision: 0 }), /Unlock/);
	assert.equal(scene.getFlag('foundryshop', 'pathJournal'), undefined);
	assert.equal(scene.drawings.size, 1);
});

test('failed retained creation compensates partial writes and restores absent registry', async () => {
	const create = scene.createEmbeddedDocuments;
	scene.createEmbeddedDocuments = async (type, sources, options) => {
		await create(type, sources.slice(0, 1), options);
		throw new Error('partial creation rejected');
	};
	await assert.rejects(createRetainedPath(scene, retainedRecipe('railway'), retainedTarget()), /partial creation rejected/);
	assert.equal(scene.drawings.size, 0);
	assert.equal(scene.getFlag('foundryshop', 'paths'), undefined);
	assert.equal(scene.getFlag('foundryshop', 'pathJournal'), undefined);
});

test('failed retained replacement restores exact original native artwork and registry', async () => {
	const route = await createRetainedPath(scene, retainedRecipe('railway'), retainedTarget());
	const before = [...scene.drawings.values()].map(d => d.toObject());
	const registry = structuredClone(scene.getFlag('foundryshop', 'paths'));
	const remove = scene.deleteEmbeddedDocuments;
	let failOnce = true;
	scene.deleteEmbeddedDocuments = async (type, ids, options) => {
		if (failOnce) { failOnce = false; await remove(type, ids.slice(0, 1), options); throw new Error('partial deletion rejected'); }
		return remove(type, ids, options);
	};
	await assert.rejects(updateRetainedPath(scene, route.id, retainedRecipe(), { expectedRevision: 0 }), /partial deletion rejected/);
	assert.deepEqual([...scene.drawings.values()].map(d => d.toObject()).sort((a,b) => a._id.localeCompare(b._id)),
		before.sort((a,b) => a._id.localeCompare(b._id)));
	assert.deepEqual(scene.getFlag('foundryshop', 'paths'), registry);
	assert.equal(scene.getFlag('foundryshop', 'pathJournal'), undefined);
	assert.equal(inspectPathIntegrity(scene, route.id).intact, true);
});

test('silent incomplete writes are detected and compensated', async () => {
	const create = scene.createEmbeddedDocuments;
	scene.createEmbeddedDocuments = async (type, sources, options) => create(type, sources.slice(0, 1), options);
	await assert.rejects(createRetainedPath(scene, retainedRecipe('railway'), retainedTarget()), /changed during/);
	assert.equal(scene.drawings.size, 0);
	assert.equal(scene.getFlag('foundryshop', 'pathJournal'), undefined);
});

test('incomplete cleanup retains recovery and explicit retry restores the pre-operation state', async () => {
	const create = scene.createEmbeddedDocuments, remove = scene.deleteEmbeddedDocuments;
	scene.createEmbeddedDocuments = async (type, sources, options) => {
		await create(type, sources.slice(0, 1), options); throw new Error('creation failed');
	};
	scene.deleteEmbeddedDocuments = async () => { throw new Error('cleanup blocked'); };
	await assert.rejects(createRetainedPath(scene, retainedRecipe('railway'), retainedTarget()), /Recovery incomplete/);
	assert.ok(scene.getFlag('foundryshop', 'pathJournal'));
	await assert.rejects(createRetainedPath(scene, retainedRecipe(), retainedTarget()), /recovery/);
	scene.deleteEmbeddedDocuments = remove;
	await recoverRetainedPathOperation(scene);
	assert.equal(scene.drawings.size, 0);
	assert.equal(scene.getFlag('foundryshop', 'paths'), undefined);
	assert.equal(scene.getFlag('foundryshop', 'pathJournal'), undefined);
});

test('external edits during transaction are not overwritten by compensation', async () => {
	const create = scene.createEmbeddedDocuments;
	scene.createEmbeddedDocuments = async (type, sources, options) => {
		await create(type, sources.slice(0, 1), options);
		scene.drawings.get(sources[0]._id).data.x++;
		throw new Error('external edit occurred');
	};
	await assert.rejects(createRetainedPath(scene, retainedRecipe(), retainedTarget()), /Recovery incomplete.*externally/);
	const saved = [...scene.drawings.values()].map(d => d.toObject());
	await assert.rejects(recoverRetainedPathOperation(scene), /externally/);
	assert.deepEqual([...scene.drawings.values()].map(d => d.toObject()), saved);
	assert.ok(scene.getFlag('foundryshop', 'pathJournal'));
});

test('queued concurrent path edits reject stale revision and lost destination cancels with rollback', async () => {
	const route = await createRetainedPath(scene, retainedRecipe(), retainedTarget());
	const results = await Promise.allSettled([
		updateRetainedPath(scene, route.id, retainedRecipe('road'), { expectedRevision: 0 }),
		updateRetainedPath(scene, route.id, retainedRecipe('river'), { expectedRevision: 0 }),
	]);
	assert.equal(results[0].status, 'fulfilled');
	assert.equal(results[1].status, 'rejected');
	const registry = structuredClone(scene.getFlag('foundryshop', 'paths'));
	const sources = [...scene.drawings.values()].map(d => d.toObject());
	let current = true;
	const create = scene.createEmbeddedDocuments;
	scene.createEmbeddedDocuments = async (...args) => { await create(...args); current = false; };
	await assert.rejects(updateRetainedPath(scene, route.id, retainedRecipe('railway'),
		{ expectedRevision: 1, isCurrent: () => current }), /destination changed/);
	assert.deepEqual(scene.getFlag('foundryshop', 'paths'), registry);
	assert.deepEqual([...scene.drawings.values()].map(d => d.toObject()), sources);
});

test('waypoint railway commits ordered retained parts through the verified path transaction', async () => {
	setupPaths();
	storedBrush.strokeColor = new String('#abcdef');
	armPath();
	onPathPointer(pathEvent(100, 100));
	onPathMove(pathEvent(220, 100));
	assert.equal(scene.drawings.size, 0, 'preview never persists');
	onPathPointer(pathEvent(220, 100));
	onPathPointer(pathEvent(220, 100));
	assert.equal(getPathState().count, 2, 'double-click endpoint does not duplicate waypoint');
	const route = await finishPath();
	assert.equal(getPathState().armed, false);
	assert.equal(scene.drawings.size, 6);
	const sources = [...scene.drawings.values()].map(drawing => drawing.toObject());
	assert.ok(sources.every(source => source.flags.foundryshop.layerId === 'ink' && source.levels[0] === 'ground'));
	assert.ok(sources.every(source => !source.flags.foundryshop.importStaging));
	assert.ok(sources.slice(-2).every(source => source.strokeColor === '#abcdef' && source.strokeAlpha === 0.75));
	assert.deepEqual(sources.slice(-2).map(source => [source.x, source.y, source.shape.points]),
		[[100, 70, [0, 0, 120, 0]], [100, 130, [0, 0, 120, 0]]], 'save preserves scene coordinates and rail separation');
	assert.ok(sources.every((source, index) => !index || source.sort > sources[index - 1].sort));
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
	assert.equal(scene.getFlag('foundryshop', 'pathJournal'), undefined);
	assert.equal(readPathRegistry(scene).routes.length, 1);
	assert.equal(inspectPathIntegrity(scene, route.id).intact, true);
	assert.deepEqual(route.recipe.waypoints.map(({x,y})=>({x,y})), [{x:100,y:100},{x:220,y:100}]);
	assert.ok(sources.every(source => source.flags.foundryshop.path.id === route.id));
	assert.equal(getPathHistoryState(scene).undo, true);
});

test('path Backspace/Escape and scene/layer changes cannot leave unintended artwork', async () => {
	setupPaths();
	armPath();
	onPathPointer(pathEvent(0, 0));
	onPathPointer(pathEvent(100, 0));
	onPathKey(pathEvent(0, 0, { key: 'Backspace' }));
	assert.equal(getPathState().count, 1);
	await assert.rejects(finishPath(), /TwoPoints/);
	onPathKey(pathEvent(0, 0, { key: 'Escape' }));
	assert.equal(getPathState().armed, false);
	assert.equal(scene.drawings.size, 0);
	armPath();
	onPathPointer(pathEvent(0, 0));
	onPathPointer(pathEvent(100, 0));
	workspace.scenes.dest.hiddenIds = ['ink'];
	await assert.rejects(finishPath(), /Changed/);
	assert.equal(scene.drawings.size, 0);
	assert.throws(armPath, /NoLayer/);
	workspace.scenes.dest.hiddenIds = [];
	game.user.isGM = false;
	assert.throws(armPath, /NoLayer/);
});

test('normal placement retains all styles, exports exact artwork and replays creation as a complete operation',async()=>{
	setupPaths();enablePathNativeHooks();
	for(const style of ['plain','railway','road','river']){
		configurePath({style,closed:false,meander:0.2,spacing:0.5,color:'#13579b',alpha:0.4});
		armPath();
		for(const [x,y] of [[100,100],[240,180],[400,100]])onPathPointer(pathEvent(x,y));
		const seed=getPathState().seed,prior=[...scene.drawings.values()].map(d=>d.toObject());
		const route=await finishPath(),sources=route.components.map(c=>scene.drawings.get(c.drawingId).toObject());
		assert.equal(route.recipe.options.style,style);assert.equal(route.recipe.options.seed,seed);
		assert.equal(route.recipe.gridSize,100);assert.equal(inspectPathIntegrity(scene,route.id).intact,true);
		const exported=exportDrawingSelection(scene,route.components.map(c=>c.drawingId));
		assert.deepEqual(exported.paths.routes[0].recipe,route.recipe);
		assert.deepEqual(exported.drawings.map(d=>d.data.shape),sources.map(d=>d.shape));
		const published=publicationSnapshot(scene,'ground',{audience:'gm',nodeId:'ink'});
		for(const source of sources)assert.deepEqual(published.entries.find(d=>d.id===source._id).data.shape,source.shape);
		await undoRetainedPath(scene);
		assert.deepEqual([...scene.drawings.values()].map(d=>d.toObject()),prior);
		assert.ok(!readPathRegistry(scene).routes.some(r=>r.id===route.id));
		await redoRetainedPath(scene);
		assert.equal(inspectPathIntegrity(scene,route.id).intact,true);
		assert.deepEqual(route.components.map(c=>scene.drawings.get(c.drawingId).toObject()),sources);
	}
});

test('normal placement refuses changed elevation and Scene permissions before persisting',async()=>{
	setupPaths();armPath();
	onPathPointer(pathEvent(100,100));onPathPointer(pathEvent(220,100));
	canvas.level.elevation.bottom=10;
	await assert.rejects(finishPath(),/Changed/);
	assert.equal(scene.drawings.size,0);assert.equal(scene.getFlag('foundryshop','paths'),undefined);
	armPath();onPathPointer(pathEvent(100,100));onPathPointer(pathEvent(220,100));
	scene.canUserModify=()=>false;
	await assert.rejects(finishPath(),/Changed/);
	assert.equal(scene.drawings.size,0);assert.equal(getPathState().armed,false);
});

test('focused button Enter preserves native activation rather than globally finishing or applying a path',async()=>{
	setupEditor();armPath();
	onPathPointer(pathEvent(100,100));onPathPointer(pathEvent(220,100));
	let consumed=0;
	const event=pathEvent(0,0,{key:'Enter',target:{tagName:'BUTTON'},preventDefault:()=>consumed++});
	onPathKey(event);await new Promise(resolve=>setImmediate(resolve));
	assert.equal(consumed,0);assert.equal(scene.drawings.size,0);assert.equal(getPathState().armed,true);
	const route=await finishPath();beginPathEdit(route.id);
	setPathWaypoint({x:130,y:100});
	onPathEditorKey(event);await new Promise(resolve=>setImmediate(resolve));
	assert.equal(consumed,0);assert.equal(getPathEditorState().pending,false);
	assert.equal(readPathRegistry(scene).routes[0].recipe.waypoints[0].x,100);
	cancelPathEdit();
	assert.equal(readPathRegistry(scene).routes[0].recipe.waypoints[0].x,100);
});

test('raw path overlays remain outside the native Drawing preview collection and clean up on deactivation',async()=>{
	setupEditor();initPathPlacement();initPathEditor();
	const overlays=[];
	canvas.drawings.addChild=object=>overlays.push(object);
	canvas.drawings.preview.addChild=()=>assert.fail('Raw graphics must not enter native document preview collection');
	try{
		armPath();assert.equal(overlays.length,1);
		Hooks.callAll('deactivateDrawingsLayer');
		assert.equal(overlays[0].destroyed,true);assert.equal(getPathState().armed,false);
		const route=await createRetainedPath(scene,retainedRecipe(),retainedTarget());
		beginPathEdit(route.id);assert.equal(overlays.length,2);
		Hooks.callAll('deactivateDrawingsLayer');
		assert.equal(overlays[1].destroyed,true);assert.equal(getPathEditorState().active,false);
		assert.equal(inspectPathIntegrity(scene,route.id).intact,true);
	}finally{teardownPathPlacement();teardownPathEditor();}
});

test('normal placement compensates a destination change after native creation without leaving a recipe or history',async()=>{
	setupPaths();enablePathNativeHooks();armPath();
	onPathPointer(pathEvent(100,100));onPathPointer(pathEvent(220,100));
	const create=scene.createEmbeddedDocuments;
	scene.createEmbeddedDocuments=async(...args)=>{await create(...args);canvas.level.elevation.bottom=10;};
	await assert.rejects(finishPath(),/destination changed/);
	assert.equal(scene.drawings.size,0);assert.equal(scene.getFlag('foundryshop','paths'),undefined);
	assert.equal(scene.getFlag('foundryshop','pathJournal'),undefined);
	assert.equal(getPathHistoryState(scene).undo,false);assert.equal(getPathState().pending,false);
});

test('ordinary closed placement requires three points, preserves explicit preset appearance and produces an unfilled loop',async()=>{
	setupPaths();
	configurePath({style:'plain',closed:true,color:'#ff00aa',alpha:0.3,width:0.03});
	armPath();
	assert.equal(getPathState().color,'#ff00aa');assert.equal(getPathState().alpha,0.3);
	onPathPointer(pathEvent(100,100));onPathPointer(pathEvent(300,100));
	await assert.rejects(finishPath(),/ThreePoints/);
	onPathPointer(pathEvent(200,250));await finishPath();
	const data=[...scene.drawings.values()][0].toObject();
	assert.equal(data.fillType,0);assert.equal(data.strokeWidth,3);
	assert.deepEqual(data.shape.points.slice(0,2),data.shape.points.slice(-2));
	assert.equal(inspectPathIntegrity(scene,data.flags.foundryshop.path.id).intact,true);
	assert.equal(readPathRegistry(scene).routes[0].recipe.closed,true);
	configurePath({closed:false});
});

test('path settings validate while armed and tool inputs do not create waypoints', () => {
	setupPaths();
	armPath();
	onPathPointer(pathEvent(10, 20, { target: { tagName: 'INPUT' } }));
	assert.equal(getPathState().count, 0);
	configurePath({ style: 'river', width: 2 });
	assert.equal(getPathState().style, 'river');
	assert.throws(() => configurePath({ width: NaN }), /Invalid/);
	assert.equal(getPathState().width, 2);
});

test('generic meandering line keeps its variation seed while editing and saves ordinary native geometry', async () => {
	setupPaths();
	configurePath({ style: 'plain', width: 0.05, meander: 0.3, bendSpacing: 2 });
	armPath();
	const seed = getPathState().seed;
	onPathPointer(pathEvent(100, 100));
	onPathMove(pathEvent(800, 100));
	onPathMove(pathEvent(850, 100));
	configurePath({ bendSpacing: 3 });
	assert.equal(getPathState().seed, seed);
	assert.equal(scene.drawings.size, 0);
	onPathPointer(pathEvent(800, 100));
	await finishPath();
	assert.equal(scene.drawings.size, 1);
	const source = scene.drawings.values().next().value.toObject();
	assert.ok(source.shape.points.length > 4);
	assert.equal(source.strokeWidth, 5);
	assert.equal(source.bezierFactor, 0);
	assert.equal(source.flags.foundryshop.layerId, 'ink');
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
	assert.equal(readPathRegistry(scene).routes[0].recipe.options.seed,seed);
	assert.equal(inspectPathIntegrity(scene,source.flags.foundryshop.path.id).intact,true);
});

test('oversized preview preserves waypoints for Backspace and spacing correction', async () => {
	setupPaths();
	const errors = [];
	ui.notifications.error = message => errors.push(message);
	const log = console.error;
	console.error = () => {};
	try {
		armPath();
		onPathPointer(pathEvent(0, 0));
		onPathMove(pathEvent(3500, 0));
		onPathMove(pathEvent(3600, 0));
		assert.equal(getPathState().armed, true);
		assert.equal(getPathState().count, 1);
		assert.equal(errors.length, 1, 'same invalid preview does not spam notifications');
		onPathPointer(pathEvent(3500, 0));
		await assert.rejects(finishPath(), /sleepers/);
		configurePath({ spacing: 0.5 });
		await finishPath();
		assert.equal(scene.drawings.size, 73);
	} finally { console.error = log; }
});

test('double-click consumes native events and completes exactly one path', async () => {
	setupPaths();
	const listeners = new Map();
	window.addEventListener = (name, callback) => listeners.set(name, callback);
	window.removeEventListener = (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); };
	initPathPlacement();
	armPath();
	let consumed = 0;
	const event = (x, y) => pathEvent(x, y, { stopImmediatePropagation: () => consumed++ });
	for (const [x, y] of [[0, 0], [100, 0], [100, 0]]) {
		listeners.get('pointerdown')(event(x, y));
		listeners.get('pointerup')(event(x, y));
		listeners.get('click')(event(x, y));
	}
	listeners.get('dblclick')(event(100, 0));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(consumed, 10);
	assert.equal(scene.drawings.size, 5);
	assert.equal(getPathState().pending, false);
	assert.equal(getPathState().armed, false);
	teardownPathPlacement();
	assert.equal(listeners.size, 0);
});

test('path transaction failure cleans partial creations and concurrent finish does not duplicate', async () => {
	setupPaths();
	armPath();
	onPathPointer(pathEvent(0, 0));
	onPathPointer(pathEvent(100, 0));
	scene.createEmbeddedDocuments = async (type, sources) => {
		scene.drawings.set(sources[0]._id, new Drawing(sources[0], { parent: scene }));
		throw new Error('path save rejected');
	};
	const first = finishPath();
	await finishPath();
	await assert.rejects(first, /path save rejected/);
	assert.equal(scene.drawings.size, 0);
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
	assert.equal(scene.getFlag('foundryshop', 'pathJournal'), undefined);
	assert.equal(scene.getFlag('foundryshop', 'paths'), undefined);
	assert.equal(getPathState().pending, false);
});

test('path refuses inherited locks, changed Levels and lost creation permission', async () => {
	setupPaths();
	const tree = scene.flags.foundryshop.layers;
	tree.nodes.unshift({ id: 'group', name: 'Group', kind: 'group', parentId: null, locked: true, playerAllowed: false, defaults: {} });
	tree.nodes[1].parentId = 'group';
	assert.throws(armPath, /NoLayer/);
	tree.nodes[0].locked = false;
	scene.flags.foundryshop.layers = structuredClone(tree);
	armPath();
	onPathPointer(pathEvent(0, 0));
	onPathPointer(pathEvent(100, 0));
	canvas.level.id = 'another';
	await assert.rejects(finishPath(), /Changed/);
	canvas.level.id = 'ground';
	armPath();
	onPathPointer(pathEvent(0, 0));
	onPathPointer(pathEvent(100, 0));
	game.user.can = () => false;
	await assert.rejects(finishPath(), /Changed/);
	assert.equal(scene.drawings.size, 0);
});

test('copies editable artwork into independent normalized session stamp and transforms collective layout/styles', () => {
	const source = canvas.drawings.controlled[0].document.toObject();
	const stamp = copySelectedStamp();
	assert.equal(stamp.drawings.length, 1);
	assert.equal(stamp.drawings[0].layerId, null);
	assert.deepEqual(canvas.drawings.controlled[0].document.toObject(), source);
	const result = transformStamp(stamp, { x: 200, y: 300 }, { scale: 2, rotation: 90 })[0];
	assert.deepEqual([result.shape.width, result.shape.height, result.strokeWidth, result.rotation], [80, 40, 8, 100]);
	assert.equal(result.x, 160); assert.equal(result.y, 280);
	assert.equal(result.fillColor, '#123456');
	assert.throws(() => transformStamp(stamp, { x: 0, y: 0 }, { scale: 0 }), /Transform/);
	assert.throws(() => transformStamp(stamp, { x: NaN, y: 0 }), /Transform/);
});

test('selected library shape normalizes grid geometry/materials without changing source or copied stamp and detects stale input', () => {
	scene.grid = { type: 1, size: 200 };
	const drawing = canvas.drawings.controlled[0].document;
	scene.drawings.set(drawing.id, drawing);
	drawing.data.texture = 'modules/foundryshop/assets/materials/flagstone.png';
	drawing.data.fillType = 2;
	drawing.data.flags.foundryshop.materialRepeat = 150;
	drawing.data.flags.foundryshop.provenance = { sceneId: 'old' };
	const before = drawing.toObject(), stampBefore = getStampState();
	const prepared = prepareSelectedShape({ id: 'saved', name: 'My shape', category: 'Custom', tags: ['stone'] });
	const data = prepared.shape.project.drawings[0].data;
	assert.equal(data.shape.width, 20);
	assert.equal(data.flags.foundryshop.materialRepeat, 75);
	assert.equal(data.flags.foundryshop.provenance, undefined);
	assert.equal(data.elevation, 0);
	assert.deepEqual(data.levels, []);
	assert.deepEqual(drawing.toObject(), before);
	assert.deepEqual(getStampState(), stampBefore);
	assert.equal(prepared.isCurrent(), true);
	scene.grid.size = 100;
	assert.equal(prepared.isCurrent(), false);
	scene.grid.size = 200;
	drawing.data.fillColor = '#000000';
	assert.equal(prepared.isCurrent(), false);
	drawing.data = before;
	assert.equal(prepared.isCurrent(), true);
	scene.drawings.delete(drawing.id);
	assert.equal(prepared.isCurrent(), false);
	scene.drawings.set(drawing.id, drawing);
	canvas.drawings.controlled = [];
	assert.equal(prepared.isCurrent(), false);
});

test('library shape preparation enforces footprint, native-lock and grid limits before writing', () => {
	const metadata = { id: 'saved', name: 'My shape', category: 'Custom', tags: [] };
	const drawing = canvas.drawings.controlled[0].document;
	scene.drawings.set(drawing.id, drawing);
	drawing.data.locked = true;
	assert.throws(() => prepareSelectedShape(metadata), /HiddenLocked/);
	drawing.data.locked = false;
	scene.grid = { type: 1, size: 1 };
	assert.throws(() => prepareSelectedShape(metadata), /Transform/);
	scene.grid.size = 100;
	drawing.data.shape.width = 2100;
	assert.throws(() => prepareSelectedShape(metadata), /metadata/);
});

test('serialized custom shapes reload onto another grid and place through the existing guarded transaction', async () => {
	scene.grid = { type: 1, size: 200 };
	const source = canvas.drawings.controlled[0].document;
	scene.drawings.set(source.id, source);
	const original = source.toObject();
	const { shape } = prepareSelectedShape({ id: 'saved-shape', name: 'Saved shape', category: 'Custom', tags: [] });
	const persisted = JSON.parse(JSON.stringify(shape));
	const copied = loadShapeStamp(persisted, { gridSize: 200 });
	assert.equal(copied.drawings[0].data.shape.width, original.shape.width);
	assert.equal(copied.drawings[0].data.shape.height, original.shape.height);
	assert.equal(copied.drawings[0].data.strokeWidth, original.strokeWidth);
	await placeStampAt(copied, { x: 300, y: 400 }, { scale: 1, rotation: 0 });
	assert.equal(scene.drawings.size, 2);
	assert.deepEqual(scene.drawings.get(source.id).toObject(), original);
	const placed = [...scene.drawings.values()].find(drawing => drawing.id !== source.id).toObject();
	assert.equal(placed.author, game.user.id);
	assert.deepEqual(placed.levels, ['ground']);
	assert.equal(placed.flags.foundryshop.layerId, 'ink');
});

test('starter prefabs use Scene-grid units, preserve colors on rearm and place editable fresh-ID components', async () => {
	const shape = starterShape('round-tree'), before = structuredClone(shape);
	const stamp = loadShapeStamp(shape, { gridSize: 150 });
	assert.equal(stamp.drawings[0].data.shape.width, 300);
	assert.equal(stamp.drawings[0].data.x, -150);
	assert.equal(stamp.drawings[0].data.fillColor, '#74834d');
	assert.deepEqual(shape, before);
	assert.equal(scene.drawings.size, 0, 'loading never creates Scene artwork');
	await armCopiedStamp({ scale: 1, rotation: 90 });
	assert.equal(ghostObjects.length, 3);
	assert.equal(ghostObjects[0].document.data.shape.width, 300);
	cancelStamp();
	await armCopiedStamp({ scale: 0.5 });
	assert.equal(ghostObjects.at(-3).document.data.shape.width, 150);
	cancelStamp();
	await placeStampAt(stamp, { x: 500, y: 600 }, { scale: 1, rotation: 90 });
	assert.equal(scene.drawings.size, 3);
	const placed = [...scene.drawings.values()];
	assert.ok(placed.every(doc => !shape.project.drawings.some(entry => entry.id === doc.id)));
	assert.ok(placed.every(doc => doc.data.author === 'me' && doc.data.levels[0] === 'ground'));
	assert.ok(placed.every(doc => doc.getFlag('foundryshop', 'layerId') === 'ink'));
	assert.equal(placed[0].data.fillColor, '#74834d');
	assert.throws(() => loadShapeStamp(shape, { gridSize: 0 }), /Transform/);
	game.user.isGM = false;
	assert.throws(() => loadShapeStamp(shape), /NoAccess/);
});

test('copy rejects empty, hidden/locked, oversized and mixed-render selections explicitly', () => {
	canvas.drawings.controlled = [];
	assert.throws(copySelectedStamp, /SelectionLimit/);
	canvas.drawings.controlled = [{ document: new Drawing({ ...base(), locked: true }) }];
	assert.throws(copySelectedStamp, /HiddenLocked/);
	canvas.drawings.controlled = [{ document: new Drawing(base()) }, { document: new Drawing({ ...base(), _id: 'other', elevation: 10 }) }];
	assert.throws(copySelectedStamp, /MixedOrder/);
	game.user.isGM = false;
	assert.throws(copySelectedStamp, /NoAccess/);
});

test('saved material repeat scales with copied geometry and survives placement', async () => {
	const doc = canvas.drawings.controlled[0].document;
	doc.data.texture = 'stone.png'; doc.data.fillType = 2;
	doc.data.flags.foundryshop.materialRepeat = 80;
	const stamp = copySelectedStamp();
	const transformed = transformStamp(stamp, { x: 0, y: 0 }, { scale: 2 });
	assert.equal(transformed[0].flags.foundryshop.materialRepeat, 160);
	assert.equal(stamp.drawings[0].data.flags.foundryshop.materialRepeat, 80);
	await placeStampAt(stamp, { x: 100, y: 100 }, { scale: 2 });
	assert.equal([...scene.drawings.values()][0].getFlag('foundryshop', 'materialRepeat'), 160);
});

test('stamp ghosts use the shared material matrix while image fitting stays separate', async () => {
	initArtworkStamps();
	const doc = canvas.drawings.controlled[0].document;
	doc.data.texture = 'stone.png'; doc.data.fillType = 2;
	doc.data.flags.foundryshop.materialRepeat = 80;
	copySelectedStamp();
	await armCopiedStamp({ scale: 2 });
	const fill = ghostObjects[0]._getFillStyle();
	assert.equal(fill.matrix.x, 16);
	assert.equal(fill.matrix.y, 16);
	assert.equal(fill.color, 123);
});

test('new material preview resolves client/layer width without changing Scene or text/image stamps', () => {
	ui.notifications.error = message => { throw new Error(message); };
	foundry.utils.deepClone = structuredClone;
	foundry.applications = { sheets: { palette: { DrawingPalette: { SETTING_KEY: 'drawingPalette' } } } };
	const originalGet = game.settings.get;
	game.settings.get = (namespace, key) => key === 'materialRepeat' ? 3
		: key === 'drawingPalette' ? base() : originalGet(namespace, key);
	scene.grid = { size: 100, type: 1 };
	initArtworkStamps();
	const doc = new Drawing({ _id: undefined, texture: 'stone.png', fillType: 2 }, { parent: scene });
	let refreshes = 0;
	const object = { document: doc, previewType: 'creation',
		renderFlags: { set(flags) { assert.equal(flags.refreshShape, true); refreshes++; } } };
	Hooks.callAll('drawDrawing', object);
	assert.equal(doc.data['flags.foundryshop.materialRepeat'], 300);
	scene.flags.foundryshop.layers = structuredClone(scene.flags.foundryshop.layers);
	scene.flags.foundryshop.layers.nodes.find(node => node.id === 'ink').defaults = { materialRepeat: 2 };
	Hooks.callAll('drawDrawing', object);
	assert.equal(doc.data['flags.foundryshop.materialRepeat'], 200);
	game.activeTool = 'text';
	Hooks.callAll('drawDrawing', object);
	game.activeTool = 'rectangle';
	doc.data.flags.foundryshop.imageStamp = 1;
	Hooks.callAll('drawDrawing', object);
	assert.equal(refreshes, 2);
	assert.equal(scene.drawings.size, 0);
});

test('arming constructs all ghosts, move offsets them and cancellation releases them', async () => {
	copySelectedStamp();
	await armCopiedStamp({ repeat: true });
	assert.equal(getStampState().repeat, true);
	assert.equal(ghostObjects[0].visible, false);
	onStampMove({ target: canvas.app.view, clientX: 100, clientY: 200 });
	assert.equal(ghostObjects[0].document.data.x, 80);
	assert.equal(ghostObjects[0].visible, true);
	cancelStamp();
	assert.equal(ghostObjects[0].destroyed, true);
	assert.equal(getStampState().armed, '');
	assert.ok(getStampState().copied);
});

test('placement preserves editable multi-Drawing styles/order and active layer without changing source or metadata', async () => {
	const second = new Drawing({ ...base(), _id: 'secondShape', x: 90, sort: 2048, fillColor: '#ff0000' }, { parent: scene });
	canvas.drawings.controlled.push({ document: second });
	const stamp = copySelectedStamp();
	const tree = structuredClone(scene.flags.foundryshop.layers);
	await placeStampAt(stamp, { x: 200, y: 300 }, { scale: 2, rotation: 90 });
	assert.equal(scene.drawings.size, 2);
	const docs = [...scene.drawings.values()].map(d => d.toObject());
	assert.deepEqual(docs.map(d => d.fillColor), ['#123456', '#ff0000']);
	assert.ok(docs[0].sort < docs[1].sort);
	assert.equal(Math.round(docs[1].y - docs[0].y), 160);
	assert.ok(docs.every(d => d.author === 'me' && d.levels[0] === 'ground'
		&& d.flags.foundryshop.layerId === 'ink' && !d.flags.foundryshop.importStaging));
	assert.deepEqual(scene.flags.foundryshop.layers, tree);
	assert.equal(second.data.x, 90);
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
	await placeStampAt(stamp, { x: 400, y: 300 }, {});
	assert.equal(scene.drawings.size, 4, 'repeat placement uses fresh IDs and does not replace earlier impressions');
});

test('placement safely re-spaces exhausted sort values rather than running out of room', async () => {
	const stamp = copySelectedStamp();
	scene.drawings.set('other', new Drawing({ ...base(), _id: 'other', sort: Number.MAX_SAFE_INTEGER }, { parent: scene }));
	await placeStampAt(stamp, { x: 0, y: 0 }, {});
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
	assert.equal(scene.drawings.size, 2);
	assert.equal(scene.drawings.get('other').sort, 1024);
});

function upperLayer() {
	scene.flags.foundryshop.layers.nodes.unshift({ id: 'above', name: 'Above', kind: 'layer',
		parentId: null, playerAllowed: false, locked: false, defaults: {} });
	scene.drawings.set('upper', new Drawing({ ...base(), _id: 'upper', sort: 4,
		flags: { foundryshop: { layerId: 'above' } } }, { parent: scene }));
	scene.drawings.set('lower', new Drawing({ ...base(), _id: 'lower', sort: 3 }, { parent: scene }));
}

test('repeated multi-component placement reserves a whole batch and preserves upper layer order', async () => {
	upperLayer();
	const stamp = loadShapeStamp(starterShape('wagon'));
	await placeStampAt(stamp, { x: 0, y: 200 }, {});
	const upperSort = scene.drawings.get('upper').sort;
	for (let i = 1; i < 20; i++) await placeStampAt(stamp, { x: i * 100, y: 200 }, {});
	assert.equal(scene.drawings.get('upper').sort, upperSort, 'successive batches consume only needed integers, not the remaining gap');
	const lower = [...scene.drawings.values()].filter(doc => doc.getFlag('foundryshop', 'layerId') === 'ink');
	assert.equal(lower.length, 201);
	assert.ok(lower.every(doc => doc.sort < scene.drawings.get('upper').sort));
	assert.equal(new Set([...scene.drawings.values()].map(doc => doc.sort)).size, scene.drawings.size);
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
});

test('failed rebalance/create restores exact original sort values; interrupted cleanup is recoverable', async () => {
	upperLayer();
	const stamp = loadShapeStamp(starterShape('wagon'));
	const before = [...scene.drawings.values()].map(doc => doc.toObject());
	scene.createEmbeddedDocuments = async () => { throw new Error('Failed create'); };
	await assert.rejects(placeStampAt(stamp, { x: 0, y: 0 }, {}), /own changes were removed/);
	assert.deepEqual([...scene.drawings.values()].map(doc => doc.toObject()), before);
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
	const update = scene.updateEmbeddedDocuments;
	let calls = 0;
	scene.updateEmbeddedDocuments = async (...args) => {
		calls++;
		if (calls === 2) throw new Error('Restore unavailable');
		return update(...args);
	};
	await assert.rejects(placeStampAt(stamp, { x: 0, y: 0 }, {}), /Cleanup incomplete/);
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').version, 3);
	scene.updateEmbeddedDocuments = update;
	await discardInterruptedProjectImport(scene);
	assert.deepEqual([...scene.drawings.values()].map(doc => doc.toObject()), before);
});

test('Unassigned collisions trigger maintenance without changing pre-existing visual order', async () => {
	upperLayer();
	scene.drawings.get('upper').data.sort = 100;
	for (let sort = 4; sort < 100; sort++) scene.drawings.set(`unassigned${sort}`, new Drawing({
		...base(), _id: `unassigned${sort}`, sort, flags: {} }, { parent: scene }));
	const before = [...scene.drawings.values()].sort((a, b) => a.sort - b.sort).map(doc => doc.id);
	await placeStampAt(loadShapeStamp(starterShape('wagon')), { x: 0, y: 0 }, {});
	const after = [...scene.drawings.values()].filter(doc => before.includes(doc.id))
		.sort((a, b) => a.sort - b.sort).map(doc => doc.id);
	assert.deepEqual(after, before);
	assert.equal(new Set([...scene.drawings.values()].map(doc => doc.sort)).size, scene.drawings.size);
	assert.ok([...scene.drawings.values()].filter(doc => doc.getFlag('foundryshop', 'layerId') === 'ink')
		.every(doc => doc.sort < scene.drawings.get('upper').sort));
});

test('partially applied sort maintenance rolls back even when native updates fail mid-batch', async () => {
	upperLayer();
	const before = [...scene.drawings.values()].map(doc => doc.toObject());
	const update = scene.updateEmbeddedDocuments;
	let first = true;
	scene.updateEmbeddedDocuments = async (type, changes, options) => {
		if (first) {
			first = false;
			await update(type, changes.slice(0, 1), options);
			throw new Error('Partial maintenance failure');
		}
		return update(type, changes, options);
	};
	await assert.rejects(placeStampAt(loadShapeStamp(starterShape('wagon')), { x: 0, y: 0 }, {}), /own changes were removed/);
	assert.deepEqual([...scene.drawings.values()].map(doc => doc.toObject()), before);
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
});

test('rebalance cleanup never overwrites external edits to baseline artwork', async () => {
	upperLayer();
	const stamp = loadShapeStamp(starterShape('wagon'));
	scene.createEmbeddedDocuments = async () => {
		scene.drawings.get('upper').data.text = 'External edit';
		throw new Error('Failed create');
	};
	await assert.rejects(placeStampAt(stamp, { x: 0, y: 0 }, {}), /Cleanup incomplete/);
	await assert.rejects(discardInterruptedProjectImport(scene), /Existing artwork changed/);
	assert.equal(scene.drawings.get('upper').data.text, 'External edit');
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').version, 3);
});

test('native cleaning cannot silently clamp scaled text style during preview or placement', async () => {
	canvas.drawings.controlled[0].document.data.text = 'Label';
	const stamp = copySelectedStamp();
	Drawing.clampFontSize = true;
	await assert.rejects(armCopiedStamp({ scale: 20 }), /NativeChanged/);
	await assert.rejects(placeStampAt(stamp, { x: 0, y: 0 }, { scale: 20 }), /NativeChanged/);
	assert.equal(scene.drawings.size, 0);
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
});

test('placement refuses an inconsistent existing managed stack instead of reordering original artwork', async () => {
	const stamp = copySelectedStamp();
	scene.flags.foundryshop.layers.nodes.push({ id: 'under', name: 'Under', kind: 'layer',
		parentId: null, playerAllowed: false, locked: false, defaults: {} });
	scene.drawings.set('upper', new Drawing({ ...base(), _id: 'upper', sort: 1024 }, { parent: scene }));
	scene.drawings.set('lower', new Drawing({ ...base(), _id: 'lower', sort: 2048,
		flags: { foundryshop: { layerId: 'under' } } }, { parent: scene }));
	await assert.rejects(placeStampAt(stamp, { x: 0, y: 0 }, {}), /SortSpace/);
	assert.equal(scene.drawings.size, 2);
	assert.equal(scene.drawings.get('upper').sort, 1024);
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
});

test('Shift wheel rotates and Ctrl wheel scales existing ghosts at the cursor without writes or recreation', async () => {
	loadShapeStamp(starterShape('round-tree'));
	await armCopiedStamp({ repeat: true });
	const wheel = extra => ({ target: canvas.app.view, clientX: 500, clientY: 600, deltaY: -100,
		preventDefault() { this.consumed = true; }, stopPropagation() {}, stopImmediatePropagation() {}, ...extra });
	const shift = wheel({ shiftKey: true });
	onStampWheel(shift);
	assert.equal(shift.consumed, true); assert.equal(getStampState().rotation, 15);
	assert.equal(ghostObjects[0].document.data.rotation, 15);
	const ctrl = wheel({ ctrlKey: true });
	onStampWheel(ctrl);
	assert.equal(getStampState().scale, 1.1);
	assert.equal(ghostObjects[0].document.data.shape.width, 220.00000000000003);
	assert.equal(ghostObjects.length, 3); assert.equal(scene.drawings.size, 0);
	const plain = wheel({});
	onStampWheel(plain); assert.equal(plain.consumed, undefined);
	const elsewhere = wheel({ shiftKey: true, target: {} });
	onStampWheel(elsewhere); assert.equal(elsewhere.consumed, undefined);
	const both = wheel({ shiftKey: true, ctrlKey: true });
	onStampWheel(both); assert.equal(both.consumed, undefined);
	for (const modifiers of [{ altKey: true }, { altKey: true, shiftKey: true }, { altKey: true, ctrlKey: true }]) {
		const native = wheel(modifiers);
		onStampWheel(native);
		assert.equal(native.consumed, undefined, 'Alt combinations remain available to Foundry');
	}
	assert.equal(getStampState().rotation, 15);
	assert.equal(getStampState().scale, 1.1);
	onStampMove({ target: canvas.app.view, clientX: 700, clientY: 800 });
	assert.equal(ghostObjects[0].document.data.x, 590);
	cancelStamp();
	const cancelled = wheel({ ctrlKey: true });
	onStampWheel(cancelled); assert.equal(cancelled.consumed, undefined);
});

test('wheel transforms clamp scale, normalize rotation and retain chosen transform when rearmed', async () => {
	copySelectedStamp();
	await armCopiedStamp({ scale: 20, rotation: 355, repeat: true });
	const wheel = { target: canvas.app.view, clientX: 200, clientY: 300, deltaY: -100,
		preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
	onStampWheel({ ...wheel, ctrlKey: true });
	assert.equal(getStampState().scale, 20);
	onStampWheel({ ...wheel, shiftKey: true });
	assert.equal(getStampState().rotation, 10);
	const { scale, rotation, repeat } = getStampState();
	cancelStamp();
	await armCopiedStamp({ scale, rotation, repeat });
	assert.equal(getStampState().rotation, 10);
	assert.equal(getStampState().repeat, true);
	await armCopiedStamp({ scale: 0.05 });
	onStampWheel({ ...wheel, deltaY: 100, ctrlKey: true });
	assert.equal(getStampState().scale, 0.05);
	const empty = { ...wheel, deltaY: 0, shiftKey: true, preventDefault() { throw new Error('Zero delta consumed'); } };
	onStampWheel(empty);
	assert.equal(scene.drawings.size, 0);
});

test('one-shot pointer placement consumes one primary event and repeat mode does not duplicate in-flight taps', async () => {
	copySelectedStamp(); await armCopiedStamp({ repeat: true });
	const event = { target: canvas.app.view, button: 0, isPrimary: true, clientX: 200, clientY: 300,
		preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
	onStampPointer(event); onStampPointer(event);
	const wheel = { ...event, ctrlKey: true, deltaY: -1 };
	onStampWheel(wheel);
	assert.equal(getStampState().scale, 1, 'wheel cannot transform an in-flight placement');
	await new Promise(resolve => setTimeout(resolve, 20));
	assert.equal(scene.drawings.size, 1);
	assert.ok(getStampState().armed);
	cancelStamp(); await armCopiedStamp();
	onStampPointer(event);
	await new Promise(resolve => setTimeout(resolve, 20));
	assert.equal(scene.drawings.size, 2);
	assert.equal(getStampState().armed, '');
});

test('locked/hidden/changed Level destinations block arming and cancel active preview', async () => {
	copySelectedStamp();
	workspace.scenes.dest.hiddenIds = ['ink'];
	await assert.rejects(armCopiedStamp(), /Destination/);
	workspace.scenes.dest.hiddenIds = [];
	await armCopiedStamp();
	canvas.level.id = 'changed';
	onStampMove({ target: canvas.app.view });
	assert.equal(getStampState().armed, '');
	await assert.rejects(placeStampAt(copySelectedStamp(), { x: 0, y: 0 }, {}), /Destination/);
});

test('tool changes, authority changes and Scene teardown cancel the transient stamp without discarding copied artwork', async () => {
	initArtworkStamps();
	copySelectedStamp(); await armCopiedStamp();
	Hooks.callAll('activateSceneControls');
	assert.equal(getStampState().armed, '');
	assert.ok(getStampState().copied);
	await armCopiedStamp();
	game.user.isGM = false; Hooks.callAll('updateUser');
	assert.equal(getStampState().armed, '');
	game.user.isGM = true; await armCopiedStamp();
	Hooks.callAll('canvasTearDown');
	assert.equal(getStampState().armed, '');
});

test('image renderer fits only flagged rectangular Drawings and preserves ordinary pattern fills', () => {
	installImageStampRenderer();
	const normal = new CONFIG.Drawing.objectClass(new Drawing(base()));
	assert.deepEqual(normal._getFillStyle(), { color: 123, alpha: 0.5 });
	const stamp = new CONFIG.Drawing.objectClass(new Drawing({ ...base(), flags: { foundryshop: { imageStamp: 1 } } }));
	const style = stamp._getFillStyle();
	assert.equal(style.color, 0xffffff); assert.equal(style.alpha, 0.5);
	assert.deepEqual([style.matrix.x, style.matrix.y], [4, 1]);
	stamp.document.data.shape.width = 80;
	assert.equal(stamp._getFillStyle().matrix.x, 8);
	stamp.texture.valid = false;
	assert.throws(() => stamp._getFillStyle(), /Renderer/);
});

function png(width = 10, height = 20, animated = false) {
	const data = new Uint8Array(animated ? 45 : 33);
	data.set([137, 80, 78, 71, 13, 10, 26, 10]);
	const view = new DataView(data.buffer);
	view.setUint32(8, 13); data.set(new TextEncoder().encode('IHDR'), 12);
	view.setUint32(16, width); view.setUint32(20, height);
	if (animated) data.set(new TextEncoder().encode('acTL'), 37);
	return data;
}
test('image header limits run before decoding and reject animation, oversized or invalid data', () => {
	assert.deepEqual(imageHeader(png()), { width: 10, height: 20, extension: 'png' });
	assert.throws(() => imageHeader(png(4097, 10)), /Image/);
	assert.throws(() => imageHeader(png(4096, 4096)), /Image/);
	assert.throws(() => imageHeader(png(10, 20, true)), /Animated/);
	assert.throws(() => imageHeader(new Uint8Array(3)), /Image/);
	assert.equal(validateAssetFolder('worlds/my-world/artwork'), 'worlds/my-world/artwork');
	for (const folder of ['', '../assets', 'worlds/../assets', '/assets', 'modules/foo', 'https://example.com', 'x\\y']) {
		assert.throws(() => validateAssetFolder(folder), /Folder/);
	}
});

test('JPEG and all three WebP header variants expose bounded dimensions and reject animated extended WebP', () => {
	const jpeg = new Uint8Array([255, 216, 255, 192, 0, 8, 8, 0, 20, 0, 10, 1]);
	assert.deepEqual(imageHeader(jpeg), { width: 10, height: 20, extension: 'jpg' });
	for (const kind of ['VP8X', 'VP8L', 'VP8 ']) {
		const bytes = new Uint8Array(30);
		bytes.set(new TextEncoder().encode('RIFF'), 0);
		bytes.set(new TextEncoder().encode('WEBP'), 8);
		bytes.set(new TextEncoder().encode(kind), 12);
		if (kind === 'VP8X') { bytes[24] = 9; bytes[27] = 19; }
		if (kind === 'VP8L') { bytes[20] = 47; bytes[21] = 9; bytes[22] = 192; bytes[23] = 4; }
		if (kind === 'VP8 ') { bytes[23] = 157; bytes[24] = 1; bytes[25] = 42; bytes[26] = 10; bytes[28] = 20; }
		assert.deepEqual(imageHeader(bytes), { width: 10, height: 20, extension: 'webp' });
		if (kind === 'VP8X') { bytes[20] = 2; assert.throws(() => imageHeader(bytes), /Animated/); }
	}
});

test('missing modules and failed texture decoding block stamp previews rather than drawing fallback placeholders', async () => {
	canvas.drawings.controlled[0].document.data.flags.extension = { test: true };
	copySelectedStamp();
	await assert.rejects(armCopiedStamp(), /Enable required/);
	delete canvas.drawings.controlled[0].document.data.flags.extension;
	canvas.drawings.controlled[0].document.data.texture = 'assets/image.png';
	copySelectedStamp();
	globalThis.loadTexture = async () => null;
	await assert.rejects(armCopiedStamp(), /Renderer/);
	assert.equal(ghostObjects.length, 0);
});

test('image upload stores a verified persistent path and white image-stamp Drawing; failed upload does not arm', async () => {
	let closed = false;
	globalThis.createImageBitmap = async () => ({ width: 10, height: 20, close() { closed = true; } });
	const file = new File([png()], 'image.png', { type: 'image/png' });
	const stamp = await importImageStamp(file);
	assert.equal(closed, true);
	assert.equal(stamp.drawings[0].data.texture, 'worlds/test/artwork/stamp-id1.png');
	assert.equal(stamp.drawings[0].data.fillColor, '#ffffff');
	assert.equal(stamp.drawings[0].data.flags.foundryshop.imageStamp, 1);
	assert.equal(getStampState().armed, '');
	const fetch = foundry.utils.fetchWithTimeout;
	foundry.utils.fetchWithTimeout = async (...args) => ({ ...await fetch(...args), arrayBuffer: async () => new Uint8Array(5).buffer });
	uploadResult.path = 'worlds/test/artwork/stamp-id3.png';
	await assert.rejects(importImageStamp(file), /Upload/, 'stored bytes must match upload input');
	foundry.utils.fetchWithTimeout = fetch;
	uploadResult = {};
	await assert.rejects(importImageStamp(file), /Upload/);
});

test('clipboard handler ignores text fields and unrelated clipboard payloads; pointer ignores secondary clicks', async () => {
	let prevented = 0;
	const event = { target: { tagName: 'INPUT' }, clipboardData: { files: [{ type: 'image/png' }] }, preventDefault() { prevented++; } };
	onStampPaste(event);
	event.target = {};
	event.clipboardData.files = [];
	onStampPaste(event);
	assert.equal(prevented, 0);
	copySelectedStamp(); await armCopiedStamp();
	onStampPointer({ target: canvas.app.view, button: 2, isPrimary: true, preventDefault() { prevented++; } });
	assert.equal(prevented, 0);
});
