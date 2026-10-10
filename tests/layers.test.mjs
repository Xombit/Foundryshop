import { test, beforeEach, afterEach } from 'node:test';
import { setAppearanceOverride, clearAppearanceOverride } from '../scripts/appearance_state.js';
import assert from 'node:assert/strict';
import {
	emptyLayerTree, validateLayerTree, orderedLayerNodes, moveLayerNode, effectiveLayerGate,
	layerSubtreeIds, layerVisibilitySummary, UNASSIGNED,
	validatePresentationPresets, lockedLayerIds,
} from '../scripts/layers/layer_tree_store.js';
import { planDrawingOrder, layerDrawingStack, newDrawingSort } from '../scripts/layers/drawing_order_service.js';
import {
	LAYER_WORKSPACE, LAYER_OPERATION, readLayerTree, readLayerWorkspace, createLayer, renameLayer,
	reorderLayer, setActiveLayer, toggleWorkspaceVisibility, setPlayerPresentation, assignDrawings,
	reconcileDrawingOrder, onPreCreateLayerDrawing, applyDrawingVisibility, initLayerManager,
	teardownLayerManager, layerMembershipIndex, saveLayerDefaults, clearLayerDefaults,
	setSubtreePresentation, setSubtreeWorkspaceVisibility, toggleGroupCollapsed, deleteLayerSubtree,
	setLayerLocked, isDrawingLayerLocked, onPreUpdateLayerDrawing, onPreDeleteLayerDrawing, activeLayer,
	duplicateLayer, DELETE_ARTWORK,
} from '../scripts/layers/layer_manager.js';
import {
	analyzePresentationPreset, capturePresentationPreset, recapturePresentationPreset,
	renamePresentationPreset, removePresentationPreset, applyPresentationPreset,
} from '../scripts/layers/presentation_service.js';

function layer(id, overrides = {}) {
	return { id, kind: 'layer', name: id, parentId: null, playerAllowed: false, locked: false, defaults: {}, ...overrides };
}
const tree = (...nodes) => ({ ...emptyLayerTree(), nodes });

class Drawing {
	constructor(id, layerId, sort = 0, overrides = {}) {
		Object.assign(this, { id, sort, elevation: 0, interface: false, locked: false, hidden: false,
			flags: { foundryshop: { layerId } }, ...overrides });
	}
	getFlag(namespace, key) { return this.flags[namespace]?.[key]; }
	canUserModify() { return true; }
	toObject() {
		const { parent, ...data } = this;
		return { ...structuredClone(data), _id: this.id };
	}
	updateSource(patch) { applyPatch(this, patch); }
}

function applyPatch(target, patch) {
	for (const [key, value] of Object.entries(patch)) {
		const parts = key.split('.');
		let parent = target;
		for (const part of parts.slice(0, -1)) parent = parent[part] ??= {};
		if (value instanceof foundry.data.operators.ForcedDeletion) delete parent[parts.at(-1)];
		else parent[parts.at(-1)] = structuredClone(value);
	}
}

class Scene {
	constructor(data, drawings = [], id = 'scene1') {
		this.id = id;
		this.name = 'Test Scene';
		this.flags = data === undefined ? {} : { foundryshop: { layers: structuredClone(data) } };
		this.drawings = new Map(drawings.map(drawing => {
			drawing.parent = this;
			return [drawing.id, drawing];
		}));
		this.writes = [];
		this.embeddedWrites = [];
	}
	getFlag(namespace, key) { return this.flags[namespace]?.[key]; }
	async update(patch, options) {
		if (this.failUpdate) throw new Error('Scene write failed');
		if (this.skipUpdate) return this;
		this.writes.push({ patch, options });
		applyPatch(this, patch);
		Hooks.callAll('updateScene', this, patch, options, game.user.id);
		return this;
	}
	async updateEmbeddedDocuments(type, patches, options) {
		if (this.failEmbedded) throw new Error('Drawing batch failed');
		if (this.skipEmbedded) return [];
		this.embeddedWrites.push({ type, patches, options });
		const updated = [];
		for (const patch of patches) {
			const drawing = this.drawings.get(patch._id);
			if (Hooks.call('preUpdateDrawing', drawing, patch, options, game.user.id) === false) continue;
			applyPatch(drawing, patch);
			Hooks.callAll('updateDrawing', drawing, patch, options, game.user.id);
			updated.push(drawing);
		}
		return updated;
	}
	async createEmbeddedDocuments(type, data, options) {
		this.embeddedWrites.push({ type, create: data, options });
		return data.map(source => {
			const { _id, id, ...rest } = structuredClone(source);
			const drawing = new Drawing(foundry.utils.randomID(), null, 0, rest);
			drawing.parent = this;
			if (Hooks.call('preCreateDrawing', drawing, source, options, game.user.id) === false) return null;
			this.drawings.set(drawing.id, drawing);
			return drawing;
		}).filter(Boolean);
	}
	async deleteEmbeddedDocuments(type, ids, options) {
		this.embeddedWrites.push({ type, delete: ids, options });
		const deleted = [];
		for (const id of ids) {
			const drawing = this.drawings.get(id);
			if (!drawing || Hooks.call('preDeleteDrawing', drawing, options, game.user.id) === false) continue;
			this.drawings.delete(id);
			deleted.push(drawing);
		}
		return deleted;
	}
}

class App {
	static DEFAULT_OPTIONS = {};
	constructor() { this.rendered = false; this.element = { querySelectorAll: () => [] }; }
	async render() { this.context = await this._prepareContext(); this.rendered = true; return this; }
	async close() { this.rendered = false; }
	async _onRender() {}
}

let hooks, settings, errors, registrations, nextId;
globalThis.foundry = {
	data: { operators: { ForcedDeletion: class {} } },
	applications: {
		api: { ApplicationV2: App, HandlebarsApplicationMixin: base => base, DialogV2: { prompt: async () => null } },
		sheets: { palette: { DrawingPalette: class { static SETTING_KEY = 'drawingPalette'; } } },
	},
	utils: { randomID: () => `id${++nextId}`, deepClone: structuredClone },
};
const { LayerPanel } = await import('../scripts/layers/layer_panel.js');

beforeEach(() => {
	hooks = new Map();
	let hookId = 0;
	globalThis.Hooks = {
		on(name, fn) { hooks.set(++hookId, { name, fn }); return hookId; },
		off(name, id) { hooks.delete(id); },
		callAll(name, ...args) { for (const entry of [...hooks.values()]) if (entry.name === name) entry.fn(...args); },
		call(name, ...args) {
			for (const entry of [...hooks.values()]) {
				if (entry.name === name && entry.fn(...args) === false) return false;
			}
			return true;
		},
	};
	settings = {
		[`foundryshop.${LAYER_WORKSPACE}`]: { version: 1, scenes: {} },
		'core.drawingPalette': { strokeColor: '#123456', fillColor: '#abcdef', strokeAlpha: 1,
			fillAlpha: 0.5, strokeWidth: 4, fillType: 0, text: 'Not a brush default' },
	};
	errors = [];
	registrations = [];
	nextId = 0;
	globalThis.game = {
		user: { id: 'gm', isGM: true },
		i18n: { localize: key => key, format: (key, args) => `${key}: ${args.message}` },
		settings: {
			get(namespace, key) { return settings[`${namespace}.${key}`]; },
			async set(namespace, key, value) { settings[`${namespace}.${key}`] = structuredClone(value); },
			register(namespace, key, data) { registrations.push({ namespace, key, data }); },
		},
	};
	globalThis.ui = { notifications: { error: message => errors.push(message) } };
	globalThis.canvas = {
		ready: true, scene: new Scene(), level: { background: { src: 'parchment.webp' } },
		drawings: { placeables: [], controlled: [] },
	};
	LayerPanel.instance = null;
	LayerPanel.opening = null;
	LayerPanel.openInToolbox = null;
	foundry.applications.api.DialogV2.confirm = async () => false;
	foundry.applications.api.DialogV2.prompt = async () => null;
	globalThis.document = {
		createElement(tag) {
			return {
				tagName: tag.toUpperCase(), attributes: {}, children: [], textContent: '',
				setAttribute(key, value) { this.attributes[key] = value; },
				append(child) { this.children.push(child); },
			};
		},
	};
	initLayerManager();
});

test('layer recovery context and template expose unfinished path recovery to the GM', async () => {
	canvas.scene.flags.foundryshop = { layers: tree(layer('ink')), pathJournal: { token: 'pending' } };
	const app = new LayerPanel();
	assert.equal((await app._prepareContext()).hasPathJournal, true);
	assert.equal(typeof LayerPanel.DEFAULT_OPTIONS.actions.recoverPath, 'function');
	delete canvas.scene.flags.foundryshop.pathJournal;
	assert.equal((await app._prepareContext()).hasPathJournal, false);
});

test('embedded layer controller shares commands and captures fresh revision for each toolbox body', async () => {
	await createLayer(canvas.scene, 'Ink');
	let rendered = 0;
	const contexts = [];
	foundry.applications.handlebars = { renderTemplate: async (path, context) => {
		contexts.push(context);
		return 'panel';
	} };
	const embedded = LayerPanel.embedded({ render: async () => { rendered++; } });
	await embedded.render('layers');
	assert.equal(contexts.at(-1).showLayers, true);
	assert.equal(contexts.at(-1).showPresets, false);
	assert.equal(contexts.at(-1).showExchange, false);
	const id = readLayerTree(canvas.scene).nodes[0].id;
	await embedded.action({}, { dataset: { action: 'present', id } });
	assert.equal(readLayerTree(canvas.scene).nodes[0].playerAllowed, true);
	assert.equal(rendered, 1);
	await embedded.render('presentation');
	assert.equal(contexts.at(-1).showPresets, true);
	assert.equal(contexts.at(-1).showLayers, false);
	await embedded.action({}, { dataset: { action: 'lock', id } });
	assert.equal(readLayerTree(canvas.scene).nodes[0].locked, true);
	await embedded.render('library');
	assert.equal(contexts.at(-1).showExchange, true);
	assert.equal(contexts.at(-1).showLayers, false);
	assert.equal(errors.length, 0);
});

test('legacy layer launcher redirects into toolbox instead of creating a second application', async () => {
	let tab;
	LayerPanel.openInToolbox = async value => { tab = value; };
	await LayerPanel.toggle();
	assert.equal(tab, 'layers');
	assert.equal(LayerPanel.instance, null);
});

afterEach(() => teardownLayerManager());

test('fresh Scene has no persisted tree and initialization registers per-user workspace', () => {
	assert.deepEqual(readLayerTree(), emptyLayerTree());
	assert.equal(canvas.scene.writes.length, 0);
	assert.equal(registrations[0].data.scope, 'user');
});

test('schema normalizes names/defaults and rejects unsupported versions, duplicate IDs and invalid flags', () => {
	assert.equal(validateLayerTree(tree(layer('ink', { name: ' Ink ' }))).nodes[0].name, 'Ink');
	for (const invalid of [
		{ ...tree(), version: 2 }, { ...tree(), revision: -1 },
		tree(layer('ink'), layer('ink')), tree(layer(UNASSIGNED)),
		tree(layer('ink', { playerAllowed: 'yes' })), tree(layer('ink', { defaults: { sort: 2 } })),
		tree(layer('ink', { name: '' })), tree(layer('ink', { name: 'a'.repeat(81) })),
	]) assert.throws(() => validateLayerTree(invalid));
});

test('schema rejects missing parents, layer parents and cycles without repairing silently', () => {
	for (const invalid of [
		tree(layer('a', { parentId: 'missing' })),
		tree(layer('a'), layer('b', { parentId: 'a' })),
		tree(layer('a', { kind: 'group', parentId: 'b' }), layer('b', { kind: 'group', parentId: 'a' })),
	]) assert.throws(() => validateLayerTree(invalid));
});

test('tree traversal is top-first and subtree reparent preserves stable IDs', () => {
	const model = tree(layer('g', { kind: 'group' }), layer('a', { parentId: 'g' }), layer('b'));
	assert.deepEqual(orderedLayerNodes(model).map(({ node, depth }) => [node.id, depth]),
		[['g', 0], ['a', 1], ['b', 0]]);
	moveLayerNode(model, 'b', 'g', 'inside');
	assert.deepEqual(orderedLayerNodes(model).map(({ node }) => node.id), ['g', 'b', 'a']);
	assert.equal(model.nodes.find(node => node.id === 'b').parentId, 'g');
	assert.throws(() => moveLayerNode(model, 'g', 'a', 'before'), /InvalidDrop/);
	assert.throws(() => moveLayerNode(model, 'a', 'a', 'before'), /InvalidDrop/);
});

test('ancestor gates suppress children without changing their stored settings', () => {
	const model = tree(layer('g', { kind: 'group' }), layer('a', { parentId: 'g', playerAllowed: true }));
	assert.equal(effectiveLayerGate(model, 'a', node => node.playerAllowed), false);
	assert.equal(model.nodes[1].playerAllowed, true);
	model.nodes[0].playerAllowed = true;
	assert.equal(effectiveLayerGate(model, 'a', node => node.playerAllowed), true);
	assert.equal(effectiveLayerGate(model, 'missing', node => node.playerAllowed), false);
});

test('Drawing stack preserves within-layer order and ignores Unassigned native drawings', () => {
	const drawings = [new Drawing('a2', 'a', 20), new Drawing('unknown', 'missing', 500),
		new Drawing('b1', 'b', 30), new Drawing('a1', 'a', 10)];
	assert.deepEqual(layerDrawingStack(tree(layer('a'), layer('b')), drawings).map(d => d.id),
		['b1', 'a1', 'a2']);
});

test('sort plan reorders whole layers, preserves strokes, and keeps largest possible anchors', () => {
	const drawings = [new Drawing('a1', 'a', 100), new Drawing('a2', 'a', 200),
		new Drawing('b1', 'b', 300), new Drawing('b2', 'b', 400)];
	const model = tree(layer('a'), layer('b'));
	const updates = planDrawingOrder(model, drawings);
	assert.equal(updates.length, 2);
	for (const update of updates) drawings.find(d => d.id === update._id).sort = update.sort;
	const stack = layerDrawingStack(model, drawings);
	assert.deepEqual(stack.map(d => d.id), ['b1', 'b2', 'a1', 'a2']);
	assert.ok(stack.every((drawing, i) => !i || stack[i - 1].sort < drawing.sort));
	assert.deepEqual(planDrawingOrder(model, drawings), []);
});

test('sort normalization handles duplicate/dense values and rejects mixed elevation/render mode', () => {
	const model = tree(layer('a'), layer('b'));
	const drawings = [new Drawing('a', 'a', 0), new Drawing('b', 'b', 0)];
	const updates = planDrawingOrder(model, drawings);
	assert.ok(updates.length > 0);
	drawings[1].elevation = 10;
	assert.throws(() => planDrawingOrder(model, drawings), /MixedRenderOrder/);
	drawings[1].elevation = 0;
	drawings[1].interface = true;
	assert.throws(() => planDrawingOrder(model, drawings), /MixedRenderOrder/);
	drawings[1].interface = false;
	drawings[1].sort = NaN;
	assert.throws(() => planDrawingOrder(model, drawings), /InvalidSort/);
});

test('new stroke sort goes above existing strokes but below the next higher layer', () => {
	const model = tree(layer('top'), layer('bottom'));
	const drawings = [new Drawing('top', 'top', 1000), new Drawing('bottom', 'bottom', 200)];
	const sort = newDrawingSort(model, drawings, 'bottom');
	assert.ok(sort > 200 && sort < 1000);
	assert.ok(newDrawingSort(model, drawings, 'top') > 1000);
});

test('creating a layer is player-hidden, GM-visible, stable and active without changing existing artwork', async () => {
	const scene = canvas.scene = new Scene(undefined, [new Drawing('old', null, 47)]);
	await createLayer(scene, 'Map Ink');
	const model = readLayerTree(scene);
	assert.equal(model.revision, 1);
	assert.equal(model.nodes[0].playerAllowed, false);
	assert.equal(readLayerWorkspace(scene).activeLayerId, model.nodes[0].id);
	assert.deepEqual(readLayerWorkspace(scene).hiddenIds, []);
	assert.equal(scene.drawings.get('old').sort, 47);
	assert.equal(scene.embeddedWrites.length, 0);
});

test('workspace activation opens only local ancestor gates and preserves presentation', async () => {
	const scene = canvas.scene = new Scene(tree(layer('g', { kind: 'group' }),
		layer('a', { parentId: 'g' }), layer('b')));
	await toggleWorkspaceVisibility(scene, 'g');
	await toggleWorkspaceVisibility(scene, 'a');
	await toggleWorkspaceVisibility(scene, 'b');
	await setActiveLayer(scene, 'a');
	assert.deepEqual(readLayerWorkspace(scene).hiddenIds, ['b']);
	assert.ok(readLayerTree(scene).nodes.every(node => !node.playerAllowed));
	assert.equal(scene.writes.length, 0);
});

test('workspace state is partitioned by Scene and changing presentation leaves workspace untouched', async () => {
	const first = new Scene(tree(layer('a')));
	const second = new Scene(tree(layer('a')), [], 'scene2');
	await toggleWorkspaceVisibility(first, 'a');
	await setActiveLayer(second, 'a');
	const before = structuredClone(settings[`foundryshop.${LAYER_WORKSPACE}`]);
	await setPlayerPresentation(first, 'a', true);
	assert.deepEqual(settings[`foundryshop.${LAYER_WORKSPACE}`], before);
	assert.equal(readLayerTree(first).nodes[0].playerAllowed, true);
	assert.deepEqual(readLayerWorkspace(first).hiddenIds, ['a']);
	assert.deepEqual(readLayerWorkspace(second).hiddenIds, []);
});

test('rename and reorder preserve membership; stale commands reject before persistence', async () => {
	const scene = new Scene(tree(layer('a'), layer('b')), [new Drawing('d1', 'a', 100), new Drawing('d2', 'b', 200)]);
	await renameLayer(scene, 'a', 'Labels', 0);
	assert.equal(scene.drawings.get('d1').getFlag('foundryshop', 'layerId'), 'a');
	await assert.rejects(renameLayer(scene, 'a', 'Stale', 0), /Changed/);
	await reorderLayer(scene, 'b', 'a', 'before', 1);
	assert.deepEqual(readLayerTree(scene).nodes.map(node => node.id), ['b', 'a']);
	assert.equal(scene.writes.length, 2);
});

test('mixed native ordering prevents reorder before saving the tree', async () => {
	const scene = new Scene(tree(layer('a'), layer('b')),
		[new Drawing('d1', 'a', 10), new Drawing('d2', 'b', 20, { elevation: 2 })]);
	await assert.rejects(reorderLayer(scene, 'b', 'a', 'before', 0), /MixedRenderOrder/);
	assert.equal(scene.writes.length, 0);
});

test('failed sort batch leaves an explicit repairable error and does not poison subsequent commands', async () => {
	const scene = new Scene(tree(layer('a'), layer('b')), [new Drawing('d1', 'a', 200), new Drawing('d2', 'b', 100)]);
	scene.failEmbedded = true;
	await assert.rejects(reorderLayer(scene, 'b', 'a', 'before', 0), /OrderIncomplete.*Drawing batch failed/);
	assert.deepEqual(readLayerTree(scene).nodes.map(node => node.id), ['b', 'a']);
	scene.failEmbedded = false;
	await reconcileDrawingOrder(scene);
	assert.equal(scene.embeddedWrites.length, 1);
});

test('Scene write errors are surfaced and do not modify Drawing sorts', async () => {
	const scene = new Scene(tree(layer('a'), layer('b')), [new Drawing('d1', 'a', 200), new Drawing('d2', 'b', 100)]);
	scene.failUpdate = true;
	await assert.rejects(reorderLayer(scene, 'b', 'a', 'before', 0), /Scene write failed/);
	assert.equal(scene.embeddedWrites.length, 0);
});

test('non-GM service calls cannot modify layers, workspace, defaults, membership or sort', async () => {
	const scene = canvas.scene = new Scene(tree(layer('a')), [new Drawing('d1', 'a')]);
	game.user.isGM = false;
	await assert.rejects(setPlayerPresentation(scene, 'a', true), /GMOnly/);
	await assert.rejects(setActiveLayer(scene, 'a'), /GMOnly/);
	await assert.rejects(assignDrawings(scene, ['d1'], UNASSIGNED), /GMOnly/);
	await assert.rejects(reconcileDrawingOrder(scene), /GMOnly/);
	assert.throws(() => createLayer(scene, 'No'), /GMOnly/);
	assert.throws(() => saveLayerDefaults(scene, 'a'), /GMOnly/);
	assert.equal(scene.writes.length, 0);
	assert.equal(scene.embeddedWrites.length, 0);
});

test('membership assignment batches flags and sorts; missing-layer drawings are Unassigned', async () => {
	const scene = new Scene(tree(layer('a'), layer('b')), [new Drawing('d1', 'missing', 30), new Drawing('d2', 'b', 100)]);
	assert.equal(layerMembershipIndex(scene).get(UNASSIGNED).length, 1);
	await assignDrawings(scene, ['d1'], 'a', 0);
	assert.equal(scene.embeddedWrites.length, 1);
	assert.equal(scene.drawings.get('d1').getFlag('foundryshop', 'layerId'), 'a');
	assert.ok(scene.drawings.get('d1').sort > scene.drawings.get('d2').sort);
	await assignDrawings(scene, ['d1'], UNASSIGNED, 0);
	assert.equal(layerMembershipIndex(scene).get(UNASSIGNED).length, 1);
});

test('assignment rejects native locks, layer locks, missing selection and stale revisions', async () => {
	const scene = new Scene(tree(layer('a'), layer('b', { locked: true })),
		[new Drawing('d1', 'a', 0, { locked: true })]);
	await assert.rejects(assignDrawings(scene, ['d1'], 'a'), /Locked/);
	await assert.rejects(assignDrawings(scene, ['d1'], 'b'), /Locked/);
	await assert.rejects(assignDrawings(scene, [], 'a'), /NoSelection/);
	await assert.rejects(assignDrawings(scene, ['d1'], 'a', 99), /Changed/);
	assert.equal(scene.embeddedWrites.length, 0);
});

test('new local GM drawings receive active membership, remembered defaults and in-layer order', async () => {
	const scene = canvas.scene = new Scene(tree(layer('top'), layer('ink', { defaults: { strokeWidth: 7 } })),
		[new Drawing('top', 'top', 1000), new Drawing('old', 'ink', 100)]);
	await setActiveLayer(scene, 'ink');
	const drawing = new Drawing('new', null, 0, { strokeWidth: 2, parent: scene });
	onPreCreateLayerDrawing(drawing, {}, {}, 'gm');
	assert.equal(drawing.getFlag('foundryshop', 'layerId'), 'ink');
	assert.equal(drawing.strokeWidth, 7);
	assert.ok(drawing.sort > 100 && drawing.sort < 1000);
});

test('precreation ignores players, other users, undo and explicit membership', () => {
	const scene = canvas.scene = new Scene(tree(layer('a')));
	for (const [options, userId, existingId, isGM] of [
		[{}, 'other', null, true], [{ isUndo: true }, 'gm', null, true],
		[{ keepId: true }, 'gm', null, true], [{}, 'gm', 'a', true], [{}, 'gm', null, false],
	]) {
		game.user.isGM = isGM;
		const drawing = new Drawing('new', existingId, 5, { parent: scene });
		onPreCreateLayerDrawing(drawing, {}, options, userId);
		assert.equal(drawing.getFlag('foundryshop', 'layerId'), existingId);
		assert.equal(drawing.sort, 5);
	}
});

test('precreation blocks a hidden active layer or unsupported elevation with explicit errors', async () => {
	const scene = canvas.scene = new Scene(tree(layer('a')), [new Drawing('old', 'a', 10)]);
	await toggleWorkspaceVisibility(scene, 'a');
	const drawing = new Drawing('new', null, 0, { parent: scene });
	assert.equal(onPreCreateLayerDrawing(drawing, {}, {}, 'gm'), false);
	await setActiveLayer(scene, 'a');
	drawing.elevation = 5;
	assert.equal(onPreCreateLayerDrawing(drawing, {}, {}, 'gm'), false);
	assert.equal(errors.length, 2);
	assert.equal(drawing.getFlag('foundryshop', 'layerId'), null);
});

function placeable(drawing, visible = true) {
	return { document: drawing, visible, shape: { visible }, text: { visible }, controlled: true,
		release() { this.controlled = false; } };
}

test('players are suppressed by persisted presentation on Drawing, primary shape and text', () => {
	const scene = new Scene(tree(layer('a')), [new Drawing('d1', 'a')]);
	game.user.isGM = false;
	const object = placeable(scene.drawings.get('d1'));
	applyDrawingVisibility(object);
	assert.equal(object.visible, false);
	assert.equal(object.shape.visible, false);
	assert.equal(object.text.visible, false);
	assert.equal(object.controlled, false);
	assert.equal(scene.writes.length, 0);
});

test('allowed player presentation does not reveal a natively invisible Drawing', () => {
	const scene = new Scene(tree(layer('a', { playerAllowed: true })), [new Drawing('d1', 'a', 0, { hidden: true })]);
	game.user.isGM = false;
	const object = placeable(scene.drawings.get('d1'), false);
	applyDrawingVisibility(object);
	assert.equal(object.visible, false);
	assert.equal(object.shape.visible, false);
});

test('GM visibility is independent from player visibility and persists locally', async () => {
	const scene = new Scene(tree(layer('a')), [new Drawing('d1', 'a')]);
	let object = placeable(scene.drawings.get('d1'));
	applyDrawingVisibility(object);
	assert.equal(object.visible, true);
	await toggleWorkspaceVisibility(scene, 'a');
	object = placeable(scene.drawings.get('d1'));
	applyDrawingVisibility(object);
	assert.equal(object.visible, false);
	assert.equal(readLayerTree(scene).nodes[0].playerAllowed, false);
});

test('external Scene updates invalidate cached presentation without sockets', async () => {
	const scene = new Scene(tree(layer('a')), [new Drawing('d1', 'a')]);
	game.user.isGM = false;
	applyDrawingVisibility(placeable(scene.drawings.get('d1')));
	const changed = tree(layer('a', { playerAllowed: true }));
	await scene.update({ 'flags.foundryshop.layers': changed }, {});
	const object = placeable(scene.drawings.get('d1'));
	applyDrawingVisibility(object);
	assert.equal(object.visible, true);
});

test('orphaned membership is exposed to the GM as Unassigned but suppressed for players', () => {
	const scene = new Scene(tree(layer('a')), [new Drawing('orphan', 'missing')]);
	game.user.isGM = false;
	const object = placeable(scene.drawings.get('orphan'));
	applyDrawingVisibility(object);
	assert.equal(object.visible, false);
	assert.equal(scene.drawings.get('orphan').getFlag('foundryshop', 'layerId'), 'missing');
});

test('ordinary unmanaged drawings keep native visibility without silently reassigning', () => {
	const scene = new Scene(tree(layer('a')), [new Drawing('native', null)]);
	game.user.isGM = false;
	const object = placeable(scene.drawings.get('native'));
	applyDrawingVisibility(object);
	assert.equal(object.visible, true);
	assert.equal(scene.drawings.get('native').getFlag('foundryshop', 'layerId'), null);
});

test('Place Text keeps its explicit no-stroke/no-fill style while receiving membership', () => {
	const scene = canvas.scene = new Scene(tree(layer('a', { defaults: { strokeWidth: 7, fillType: 1 } })));
	const drawing = new Drawing('text', null, 0, { parent: scene, strokeWidth: 0, fillType: 0 });
	onPreCreateLayerDrawing(drawing, {}, { foundryshopPlaceText: true }, 'gm');
	assert.equal(drawing.getFlag('foundryshop', 'layerId'), 'a');
	assert.equal(drawing.strokeWidth, 0);
	assert.equal(drawing.fillType, 0);
});

test('a Scene with only locked ordinary layers blocks creation instead of bypassing locks', () => {
	const scene = canvas.scene = new Scene(tree(layer('a', { locked: true })));
	const drawing = new Drawing('new', null, 0, { parent: scene });
	assert.equal(onPreCreateLayerDrawing(drawing, {}, {}, 'gm'), false);
	assert.equal(drawing.getFlag('foundryshop', 'layerId'), null);
	assert.equal(errors.length, 1);
});

test('invalid persisted state suppresses managed player artwork and reports the error once', () => {
	const scene = new Scene({ ...tree(layer('a')), version: 99 }, [new Drawing('d1', 'a')]);
	game.user.isGM = false;
	const first = placeable(scene.drawings.get('d1'));
	const second = placeable(scene.drawings.get('d1'));
	Hooks.callAll('refreshDrawing', first);
	Hooks.callAll('refreshDrawing', second);
	assert.equal(first.visible, false);
	assert.equal(second.shape.visible, false);
	assert.equal(errors.length, 1);
});

test('persisted presentation schedules a native visibility refresh and reapplies layer gates', async () => {
	const scene = canvas.scene = new Scene(tree(layer('a')), [new Drawing('d1', 'a')]);
	const object = placeable(scene.drawings.get('d1'));
	const flags = [];
	object.renderFlags = { set(patch) {
		flags.push(patch);
		object.visible = object.shape.visible = object.text.visible = !object.document.hidden;
		Hooks.callAll('refreshDrawing', object);
	} };
	canvas.drawings.placeables = [object];
	await setPlayerPresentation(scene, 'a', true);
	game.user.isGM = false;
	await new Promise(resolve => setTimeout(resolve, 50));
	assert.equal(object.visible, true);
	assert.deepEqual(flags.at(-1), { refreshVisibility: true });
	game.user.isGM = true;
	await setPlayerPresentation(scene, 'a', false);
	game.user.isGM = false;
	await new Promise(resolve => setTimeout(resolve, 50));
	assert.equal(object.visible, false);
	object.document.hidden = true;
	game.user.isGM = true;
	await setPlayerPresentation(scene, 'a', true);
	game.user.isGM = false;
	await new Promise(resolve => setTimeout(resolve, 50));
	assert.equal(object.visible, false, 'native hidden remains hidden');
});

test('routine Drawing events refresh the UI without refreshing every placeable', async () => {
	const scene = canvas.scene = new Scene(tree(layer('a')), [new Drawing('d1', 'a')]);
	let refreshes = 0;
	canvas.drawings.placeables = [{ renderFlags: { set: () => refreshes++ } }];
	Hooks.callAll('updateDrawing', scene.drawings.get('d1'), { sort: 12 }, {}, 'gm');
	await new Promise(resolve => setTimeout(resolve, 50));
	assert.equal(refreshes, 0);
});

test('native flag deletion requests a visibility refresh for the affected Drawing', () => {
	const scene = canvas.scene = new Scene(tree(layer('a')), [new Drawing('d1', 'a')]);
	const drawing = scene.drawings.get('d1');
	const object = placeable(drawing);
	drawing.object = object;
	let refreshes = 0;
	object.renderFlags = { set(patch) {
		assert.deepEqual(patch, { refreshVisibility: true });
		refreshes++;
		object.visible = object.shape.visible = object.text.visible = true;
		Hooks.callAll('refreshDrawing', object);
	} };
	game.user.isGM = false;
	applyDrawingVisibility(object);
	assert.equal(object.visible, false);
	delete drawing.flags.foundryshop.layerId;
	Hooks.callAll('updateDrawing', drawing, { flags: { foundryshop: { '-=layerId': null } } }, {}, 'gm');
	assert.equal(refreshes, 1);
	assert.equal(object.visible, true);
});

test('unassign action requires confirmation before restoring native presentation', async () => {
	canvas.scene = new Scene(tree(layer('a')), [new Drawing('d1', 'a')]);
	canvas.drawings.controlled = [{ document: canvas.scene.drawings.get('d1') }];
	const panel = new LayerPanel();
	await panel._prepareContext();
	const target = { dataset: { action: 'assign', id: UNASSIGNED } };
	await LayerPanel.onAction.call(panel, {}, target);
	assert.equal(canvas.scene.drawings.get('d1').getFlag('foundryshop', 'layerId'), 'a');
	foundry.applications.api.DialogV2.confirm = async () => true;
	await LayerPanel.onAction.call(panel, {}, target);
	assert.equal(canvas.scene.drawings.get('d1').getFlag('foundryshop', 'layerId'), null);
});

test('a Scene switch during unassign confirmation cannot change artwork in the old Scene', async () => {
	const scene = canvas.scene = new Scene(tree(layer('a')), [new Drawing('d1', 'a')]);
	canvas.drawings.controlled = [{ document: scene.drawings.get('d1') }];
	const panel = new LayerPanel();
	await panel._prepareContext();
	foundry.applications.api.DialogV2.confirm = async () => { canvas.scene = new Scene(); return true; };
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'assign', id: UNASSIGNED } });
	assert.equal(scene.embeddedWrites.length, 0);
	assert.equal(errors.length, 1);
});

test('sort planning remains correct across deterministic shuffled stacks and dense integers', () => {
	let seed = 37;
	const random = () => { seed = (seed * 16807) % 2147483647; return seed; };
	const model = tree(...Array.from({ length: 5 }, (_, i) => layer(`l${i}`)));
	for (let trial = 0; trial < 100; trial++) {
		const drawings = Array.from({ length: 40 }, (_, i) =>
			new Drawing(`d${i}`, `l${random() % 5}`, random() % 40 - 20));
		const before = layerDrawingStack(model, drawings).map(d => d.id);
		const updates = planDrawingOrder(model, drawings);
		for (const update of updates) drawings.find(d => d.id === update._id).sort = update.sort;
		const after = layerDrawingStack(model, drawings);
		assert.deepEqual(after.map(d => d.id), before);
		assert.ok(after.every((drawing, i) => !i || after[i - 1].sort < drawing.sort));
		assert.deepEqual(planDrawingOrder(model, drawings), []);
	}
});
test('remembered brush defaults exclude unrelated native creation fields', async () => {
	const scene = new Scene(tree(layer('a')));
	settings['core.drawingPalette'].texture = 'worlds/test/stone.webp';
	settings['core.drawingPalette'].fillType = 2;
	settings['foundryshop.materialRepeat'] = 2;
	await saveLayerDefaults(scene, 'a');
	const defaults = readLayerTree(scene).nodes[0].defaults;
	assert.equal(defaults.strokeColor, '#123456');
	assert.equal(defaults.strokeWidth, 4);
	assert.equal(defaults.text, undefined);
	assert.equal(defaults.texture, 'worlds/test/stone.webp');
	assert.equal(defaults.fillType, 2);
	assert.equal(defaults.materialRepeat, 2);
	canvas.scene = scene;
	await setActiveLayer(scene, 'a');
	const drawing = new Drawing('new', null, 0, { parent: scene });
	onPreCreateLayerDrawing(drawing, {}, {}, 'gm');
	assert.equal(drawing.texture, 'worlds/test/stone.webp');
	assert.equal(drawing.getFlag('foundryshop', 'materialRepeat'), 200);
});

test('explicit pair wins appearance over active-layer defaults only for native interactive creation', async () => {
	const scene = canvas.scene = new Scene(tree(layer('a', { defaults: {
		strokeColor: '#000000', fillColor: '#ffffff', strokeWidth: 7, strokeAlpha: 0.3, fillAlpha: 0.8,
		fillType: 2, texture: 'old.png', materialRepeat: 3,
	} })));
	scene.grid = { type: 1, size: 100 };
	await setActiveLayer(scene, 'a');
	try {
		setAppearanceOverride('Pair', { strokeColor: '#112233', fillColor: '#aabbcc', fillType: 2,
			texture: 'stone.png', materialRepeat: 2 });
		const interactive = new Drawing('interactive', null, 0, { parent: scene });
		onPreCreateLayerDrawing(interactive, {}, { controlObject: false }, 'gm');
		assert.equal(interactive.strokeColor, '#112233');
		assert.equal(interactive.fillColor, '#aabbcc');
		assert.equal(interactive.texture, 'stone.png');
		assert.equal(interactive.getFlag('foundryshop', 'materialRepeat'), 200);
		assert.equal(interactive.strokeWidth, 7);
		assert.equal(interactive.strokeAlpha, 0.3);
		assert.equal(interactive.fillAlpha, 0.8);
		const programmatic = new Drawing('programmatic', null, 0, { parent: scene });
		onPreCreateLayerDrawing(programmatic, {}, {}, 'gm');
		assert.equal(programmatic.strokeColor, '#000000');
		const label = new Drawing('label', null, 0, { parent: scene, strokeColor: '#445566' });
		onPreCreateLayerDrawing(label, {}, { controlObject: true, foundryshopPlaceText: true }, 'gm');
		assert.equal(label.strokeColor, '#445566');
		setAppearanceOverride('Solid', { strokeColor: '#112233', fillColor: '#aabbcc', fillType: 1,
			texture: null, materialRepeat: 1 });
		const solid = new Drawing('solid', null, 0, { parent: scene, flags: { foundryshop: { materialRepeat: 600 } } });
		onPreCreateLayerDrawing(solid, {}, { controlObject: false }, 'gm');
		assert.equal(solid.texture, null);
		assert.equal(solid.getFlag('foundryshop', 'materialRepeat'), undefined);
		assert.equal(scene.embeddedWrites.length, 0);
		assert.equal(readLayerTree(scene).nodes[0].defaults.texture, 'old.png');
		const unmanagedScene = canvas.scene = new Scene(tree());
		unmanagedScene.grid = { type: 1, size: 100 };
		settings['foundryshop.materialRepeat'] = 4;
		setAppearanceOverride('Pair', { strokeColor: '#112233', fillColor: '#aabbcc', fillType: 2,
			texture: 'stone.png', materialRepeat: 2 });
		const authored = new Drawing('authored', null, 0, { parent: unmanagedScene, texture: 'authored.png', fillType: 2 });
		onPreCreateLayerDrawing(authored, {}, {}, 'gm');
		assert.equal(authored.texture, 'authored.png');
		assert.equal(authored.getFlag('foundryshop', 'materialRepeat'), 400);
	} finally { clearAppearanceOverride(); }
});

test('forgetting layer defaults returns creation to the ordinary palette without editing artwork', async () => {
	const scene = new Scene(tree(layer('a', { defaults: { strokeWidth: 7 } })), [new Drawing('old', 'a')]);
	await clearLayerDefaults(scene, 'a', 0);
	assert.deepEqual(readLayerTree(scene).nodes[0].defaults, {});
	assert.equal(scene.embeddedWrites.length, 0);
});

test('ordinary unmanaged drawing creation records gridless material size without changing existing artwork', () => {
	settings['foundryshop.materialRepeat'] = 1.5;
	const scene = canvas.scene = new Scene(tree());
	scene.grid = { type: 0, size: 300 };
	const doc = new Drawing('new', null, 0, { parent: scene, texture: 'stone.png', fillType: 2 });
	onPreCreateLayerDrawing(doc, {}, {}, 'gm');
	assert.equal(doc.getFlag('foundryshop', 'materialRepeat'), 150);
	assert.equal(doc.materialRepeat, undefined, 'virtual brush field never reaches the native document');
	assert.equal(scene.embeddedWrites.length, 0);
});

test('ignored Scene updates and skipped Drawing batches are not reported as success', async () => {
	const scene = new Scene(tree(layer('a'), layer('b')), [new Drawing('a', 'a', 200), new Drawing('b', 'b', 100)]);
	scene.skipUpdate = true;
	await assert.rejects(reorderLayer(scene, 'b', 'a', 'before', 0), /OrderIncomplete/);
	assert.equal(readLayerTree(scene).revision, 0);
	scene.skipUpdate = false;
	scene.skipEmbedded = true;
	await assert.rejects(reorderLayer(scene, 'b', 'a', 'before', 0), /DrawingUpdateIncomplete/);
	await assert.rejects(reconcileDrawingOrder(scene), /DrawingUpdateIncomplete/);
	await assert.rejects(assignDrawings(scene, ['a'], UNASSIGNED), /DrawingUpdateIncomplete/);
});

test('queued stale presentation edits are rejected and cannot overwrite the newer revision', async () => {
	const scene = new Scene(tree(layer('a')));
	const results = await Promise.allSettled([
		setPlayerPresentation(scene, 'a', true, 0), setPlayerPresentation(scene, 'a', false, 0),
	]);
	assert.equal(results[0].status, 'fulfilled');
	assert.equal(results[1].status, 'rejected');
	assert.equal(readLayerTree(scene).nodes[0].playerAllowed, true);
});

test('player clients do not open the panel through Drawing action dispatch', async () => {
	canvas.scene = new Scene(tree(layer('a')));
	const panel = new LayerPanel();
	await panel._prepareContext();
	game.user.isGM = false;
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'present', id: 'a' } });
	assert.equal(readLayerTree().nodes[0].playerAllowed, false);
	assert.equal(errors.length, 1);
});

test('drag/drop reorders using a captured Scene/revision and rejects cross-Scene payloads', async () => {
	canvas.scene = new Scene(tree(layer('a'), layer('b')));
	const panel = new LayerPanel();
	await panel._prepareContext();
	const rowEvents = {}, handleEvents = {};
	const row = { dataset: { layerId: 'a' }, getBoundingClientRect: () => ({ top: 10, height: 40 }),
		addEventListener: (name, callback) => { rowEvents[name] = callback; } };
	const handle = { dataset: { layerDrag: 'b' }, addEventListener: (name, callback) => { handleEvents[name] = callback; } };
	panel.element = { querySelectorAll: selector => selector === '[data-layer-drag]' ? [handle] : [row] };
	await panel._onRender({}, {});
	let payload;
	handleEvents.dragstart({ dataTransfer: { setData: (type, value) => { payload = value; } } });
	const event = { preventDefault() {}, clientY: 15, dataTransfer: { getData: () => payload } };
	await rowEvents.drop(event);
	assert.deepEqual(readLayerTree().nodes.map(node => node.id), ['b', 'a']);
	payload = JSON.stringify({ sceneId: 'other', revision: 1, id: 'b' });
	await rowEvents.drop(event);
	assert.equal(errors.length, 1);
});

test('panel context contains layer membership and fixed background, and denies players', async () => {
	canvas.scene = new Scene(tree(layer('a')), [new Drawing('a1', 'a'), new Drawing('old', null)]);
	const panel = new LayerPanel();
	const context = await panel._prepareContext();
	assert.equal(context.rows[0].active, true);
	assert.equal(context.rows[0].count, 1);
	assert.equal(context.rows[0].playerAllowed, false);
	assert.equal(context.unassignedCount, 1);
	assert.equal(context.background, 'parchment.webp');
	game.user.isGM = false;
	await assert.rejects(panel._prepareContext(), /GMOnly/);
	await LayerPanel.toggle();
	assert.equal(LayerPanel.instance, null);
});

test('layer naming dialogs use an attribute-free DIV and preserve rename values through serialization', async () => {
	globalThis.document = {
		createElement(tag) {
			return {
				tagName: tag.toUpperCase(), attributes: {}, children: [], textContent: '',
				setAttribute(key, value) { this.attributes[key] = value; },
				append(child) { this.children.push(child); },
			};
		},
	};
	for (const [title, value] of [['Add', ''], ['Rename', '<Ink> & details']]) {
		foundry.applications.api.DialogV2.prompt = async config => {
			assert.equal(config.content.tagName, 'DIV');
			assert.deepEqual(config.content.attributes, {});
			const label = config.content.children[0];
			assert.equal(label.tagName, 'LABEL');
			const input = label.children[0];
			assert.equal(input.attributes.value, value);
			assert.equal(input.attributes.name, 'layerName');
			assert.equal(input.attributes.required, '');
			return config.ok.callback(null, null, {
				element: { querySelector: selector => {
					assert.equal(selector, '[name="layerName"]');
					return { value: 'Submitted layer' };
				} },
			});
		};
		assert.equal(await LayerPanel.promptName(title, value), 'Submitted layer');
	}
});

test('background label uses the displayed v14 Level without touching deprecated Scene fields', async () => {
	canvas.scene = new Scene(tree(layer('a')));
	Object.defineProperty(canvas.scene, 'background', {
		get() { throw new Error('Deprecated Scene#background must not be accessed'); },
	});
	const panel = new LayerPanel();
	canvas.level = { background: { src: 'upper-gallery.webp' } };
	assert.equal((await panel._prepareContext()).background, 'upper-gallery.webp');
	canvas.level = { background: { src: '' } };
	assert.equal((await panel._prepareContext()).background, 'FOUNDRYSHOP.Layers.NoBackground');
	canvas.level = null;
	assert.equal((await panel._prepareContext()).background, 'FOUNDRYSHOP.Layers.NoBackground');
});

test('layer toolbar registration is GM-only', () => {
	LayerPanel.init();
	const controls = { drawings: { tools: {} } };
	game.user.isGM = false;
	Hooks.callAll('getSceneControlButtons', controls);
	assert.deepEqual(controls.drawings.tools, {});
	game.user.isGM = true;
	Hooks.callAll('getSceneControlButtons', controls);
	assert.equal(controls.drawings.tools['foundryshop-layers'].button, true);
});

test('panel presentation actions leave drawing configuration and workspace untouched', async () => {
	canvas.scene = new Scene(tree(layer('a')));
	const panel = new LayerPanel();
	await panel._prepareContext();
	const before = structuredClone(settings);
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'present', id: 'a' } });
	assert.equal(readLayerTree().nodes[0].playerAllowed, true);
	assert.deepEqual(settings, before);
});

test('panel rejects stale rendered revision and Scene changes before action', async () => {
	canvas.scene = new Scene(tree(layer('a')));
	const panel = new LayerPanel();
	await panel._prepareContext();
	await renameLayer(canvas.scene, 'a', 'new', 0);
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'present', id: 'a' } });
	assert.equal(readLayerTree().nodes[0].playerAllowed, false);
	assert.equal(errors.length, 1);
	await panel._prepareContext();
	canvas.scene = new Scene();
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'workspace', id: 'a' } });
	assert.equal(errors.length, 2);
});

test('repair is a no-op when managed drawing order is already reconciled', async () => {
	const scene = new Scene(tree(layer('a'), layer('b')), [new Drawing('a', 'a', 200), new Drawing('b', 'b', 100)]);
	await reconcileDrawingOrder(scene);
	assert.equal(scene.embeddedWrites.length, 0);
});

test('several thousand drawings reorder as one batch without rewriting every stroke', async () => {
	const drawings = Array.from({ length: 3000 }, (_, i) =>
		new Drawing(`d${String(i).padStart(4, '0')}`, i < 1500 ? 'a' : 'b', (i + 1) * 1024));
	const scene = new Scene(tree(layer('b'), layer('a')), drawings);
	await reorderLayer(scene, 'a', 'b', 'before', 0);
	assert.equal(scene.embeddedWrites.length, 1);
	assert.equal(scene.embeddedWrites[0].patches.length, 1500);
	assert.ok(scene.embeddedWrites[0].options[LAYER_OPERATION]);
});

test('nested creation preserves IDs, activates only layers, and rejects stale/invalid parents', async () => {
	const scene = canvas.scene = new Scene();
	await createLayer(scene, 'Location', 'group', null, 0);
	const parentId = readLayerTree(scene).nodes[0].id;
	assert.equal(readLayerWorkspace(scene).activeLayerId, null);
	await createLayer(scene, 'Ink', 'layer', parentId, 1);
	const ink = readLayerTree(scene).nodes[1];
	assert.equal(ink.parentId, parentId);
	assert.equal(ink.playerAllowed, false);
	assert.equal(readLayerWorkspace(scene).activeLayerId, ink.id);
	await assert.rejects(createLayer(scene, 'Stale', 'group', parentId, 1), /Changed/);
	await assert.rejects(createLayer(scene, 'Wrong', 'layer', ink.id), /InvalidDrop/);
	assert.equal(readLayerTree(scene).nodes.length, 2);
});

test('moving a group moves its subtree without changing membership, child settings or IDs', async () => {
	const scene = new Scene(tree(layer('g', { kind: 'group' }),
		layer('a', { parentId: 'g', playerAllowed: true }), layer('h', { kind: 'group' }), layer('b')),
		[new Drawing('d1', 'a', 100), new Drawing('d2', 'b', 200)]);
	await reorderLayer(scene, 'g', 'h', 'inside', 0);
	assert.deepEqual(orderedLayerNodes(readLayerTree(scene)).map(({ node }) => node.id), ['h', 'g', 'a', 'b']);
	assert.equal(readLayerTree(scene).nodes.find(node => node.id === 'a').playerAllowed, true);
	assert.equal(scene.drawings.get('d1').getFlag('foundryshop', 'layerId'), 'a');
	await assert.rejects(reorderLayer(scene, 'h', 'a', 'before', 1), /InvalidDrop/);
	await reorderLayer(scene, 'g', null, 'root', 1);
	assert.deepEqual(orderedLayerNodes(readLayerTree(scene)).map(({ node }) => node.id), ['h', 'b', 'g', 'a']);
});

test('tri-state visibility reflects effective leaves, nested gates and empty groups separately per audience', () => {
	const model = tree(
		layer('g', { kind: 'group', playerAllowed: true }),
		layer('a', { parentId: 'g', playerAllowed: true }),
		layer('h', { kind: 'group', parentId: 'g', playerAllowed: true }),
		layer('b', { parentId: 'h' }),
		layer('empty', { kind: 'group', playerAllowed: true }),
	);
	const summaries = layerVisibilitySummary(model, node => node.playerAllowed);
	assert.equal(summaries.get('g').state, 'mixed');
	assert.equal(summaries.get('h').state, 'hidden');
	assert.equal(summaries.get('empty').state, 'visible');
	const workspace = layerVisibilitySummary(model, () => true);
	assert.equal(workspace.get('g').state, 'visible');
	model.nodes[0].playerAllowed = false;
	const suppressed = layerVisibilitySummary(model, node => node.playerAllowed);
	assert.equal(suppressed.get('g').state, 'hidden');
	assert.equal(suppressed.get('a').ancestorBlocked, true);
	assert.equal(suppressed.get('a').gateEnabled, true);
	assert.deepEqual([...layerSubtreeIds(model, 'h')], ['h', 'b']);
});

test('group eye restores mixed child presentation without overwriting descendants', async () => {
	const scene = new Scene(tree(layer('g', { kind: 'group', playerAllowed: true }),
		layer('a', { parentId: 'g', playerAllowed: true }), layer('b', { parentId: 'g' })));
	await setPlayerPresentation(scene, 'g', false, 0);
	await setPlayerPresentation(scene, 'g', true, 1);
	const model = readLayerTree(scene);
	assert.equal(model.nodes.find(node => node.id === 'a').playerAllowed, true);
	assert.equal(model.nodes.find(node => node.id === 'b').playerAllowed, false);
	assert.equal(layerVisibilitySummary(model, node => node.playerAllowed).get('g').state, 'mixed');
});

test('recursive operations include only the selected subtree and do not open outside ancestor gates', async () => {
	const scene = new Scene(tree(layer('outer', { kind: 'group' }),
		layer('inner', { kind: 'group', parentId: 'outer' }),
		layer('a', { parentId: 'inner' }), layer('outside')));
	await setSubtreePresentation(scene, 'inner', true, 0);
	assert.equal(readLayerTree(scene).nodes.find(node => node.id === 'outer').playerAllowed, false);
	assert.equal(readLayerTree(scene).nodes.find(node => node.id === 'outside').playerAllowed, false);
	assert.equal(layerVisibilitySummary(readLayerTree(scene), node => node.playerAllowed).get('inner').state, 'hidden');
	await toggleWorkspaceVisibility(scene, 'outer');
	await setSubtreeWorkspaceVisibility(scene, 'inner', false, 1);
	await setSubtreeWorkspaceVisibility(scene, 'inner', true, 1);
	assert.deepEqual(readLayerWorkspace(scene).hiddenIds, ['outer']);
	assert.equal(scene.drawings.size, 0);
});

test('collapse is per-Scene workspace-only and activation unfolds all local ancestors', async () => {
	const scene = new Scene(tree(layer('g', { kind: 'group' }),
		layer('h', { kind: 'group', parentId: 'g' }), layer('a', { parentId: 'h' })));
	await toggleGroupCollapsed(scene, 'g');
	await toggleGroupCollapsed(scene, 'h');
	assert.deepEqual(readLayerWorkspace(scene).collapsedIds, ['g', 'h']);
	assert.equal(scene.writes.length, 0);
	await setActiveLayer(scene, 'a');
	assert.deepEqual(readLayerWorkspace(scene).collapsedIds, []);
	await assert.rejects(toggleGroupCollapsed(scene, 'a'), /Changed/);
});

test('workspace validation accepts missing optional collapse preferences but rejects malformed data', () => {
	settings[`foundryshop.${LAYER_WORKSPACE}`].scenes.scene1 = { activeLayerId: null, hiddenIds: [] };
	assert.deepEqual(readLayerWorkspace().collapsedIds, []);
	settings[`foundryshop.${LAYER_WORKSPACE}`].scenes.scene1.collapsedIds = [42];
	assert.throws(() => readLayerWorkspace(), /InvalidWorkspace/);
});

test('safe group removal transfers all artwork, cleans local state and never deletes Drawing documents', async () => {
	const scene = canvas.scene = new Scene(tree(layer('g', { kind: 'group' }),
		layer('a', { parentId: 'g' }), layer('h', { kind: 'group', parentId: 'g' }),
		layer('b', { parentId: 'h' }), layer('dest')),
		[new Drawing('a1', 'a', 300), new Drawing('b1', 'b', 200), new Drawing('dest1', 'dest', 100)]);
	await setActiveLayer(scene, 'a');
	await toggleGroupCollapsed(scene, 'g');
	await toggleWorkspaceVisibility(scene, 'h');
	const ids = [...scene.drawings.keys()];
	await deleteLayerSubtree(scene, 'g', 'dest', 0);
	assert.deepEqual([...scene.drawings.keys()], ids);
	assert.ok([...scene.drawings.values()].every(drawing => drawingLayerIdForTest(drawing) === 'dest'));
	assert.deepEqual(readLayerTree(scene).nodes.map(node => node.id), ['dest']);
	assert.equal(readLayerWorkspace(scene).activeLayerId, 'dest');
	assert.deepEqual(readLayerWorkspace(scene).collapsedIds, []);
	assert.deepEqual(readLayerWorkspace(scene).hiddenIds, []);
	assert.equal(scene.embeddedWrites.length, 1);
	assert.equal(scene.writes.length, 1);
	assert.deepEqual(layerDrawingStack(readLayerTree(scene), [...scene.drawings.values()]).map(drawing => drawing.id),
		['dest1', 'b1', 'a1']);
});

const drawingLayerIdForTest = drawing => drawing.getFlag('foundryshop', 'layerId');

test('safe removal to Unassigned preserves native Drawing properties and clears the last active layer', async () => {
	const scene = canvas.scene = new Scene(tree(layer('a')),
		[new Drawing('d1', 'a', 31, { text: 'Hall', hidden: true, strokeWidth: 7 })]);
	await setActiveLayer(scene, 'a');
	await deleteLayerSubtree(scene, 'a', UNASSIGNED, 0);
	const drawing = scene.drawings.get('d1');
	assert.equal(drawingLayerIdForTest(drawing), null);
	assert.equal(drawing.sort, 31);
	assert.equal(drawing.text, 'Hall');
	assert.equal(drawing.hidden, true);
	assert.equal(drawing.strokeWidth, 7);
	assert.equal(scene.drawings.size, 1);
	assert.equal(readLayerWorkspace(scene).activeLayerId, null);
	assert.deepEqual(readLayerTree(scene).nodes, []);
});

test('safe removal rejects descendant destination, locks, stale revisions and incompatible ordering before writes', async () => {
	const scene = new Scene(tree(layer('g', { kind: 'group' }), layer('a', { parentId: 'g' }), layer('dest')),
		[new Drawing('d1', 'a', 10), new Drawing('d2', 'dest', 20)]);
	await assert.rejects(deleteLayerSubtree(scene, 'g', 'a', 0), /InvalidDestination/);
	await assert.rejects(deleteLayerSubtree(scene, 'g', 'dest', 99), /Changed/);
	scene.drawings.get('d1').locked = true;
	await assert.rejects(deleteLayerSubtree(scene, 'g', 'dest', 0), /Locked/);
	scene.drawings.get('d1').locked = false;
	scene.drawings.get('d1').elevation = 10;
	await assert.rejects(deleteLayerSubtree(scene, 'g', 'dest', 0), /MixedRenderOrder/);
	assert.equal(scene.embeddedWrites.length, 0);
	assert.equal(scene.writes.length, 0);
});

test('failed or ignored membership batches keep the entire source subtree and surface a recoverable error', async () => {
	const scene = new Scene(tree(layer('a'), layer('dest')), [new Drawing('d1', 'a', 10)]);
	scene.failEmbedded = true;
	await assert.rejects(deleteLayerSubtree(scene, 'a', 'dest', 0), /DeleteIncomplete.*Drawing batch failed/);
	assert.equal(readLayerTree(scene).nodes.length, 2);
	assert.equal(scene.writes.length, 0);
	scene.failEmbedded = false;
	scene.skipEmbedded = true;
	await assert.rejects(deleteLayerSubtree(scene, 'a', 'dest', 0), /DeleteIncomplete.*DrawingUpdateIncomplete/);
	assert.equal(readLayerTree(scene).nodes.length, 2);
});

test('failed Scene removal after membership transfer retains artwork and permits a safe retry', async () => {
	const scene = new Scene(tree(layer('a'), layer('dest')), [new Drawing('d1', 'a', 10)]);
	scene.failUpdate = true;
	await assert.rejects(deleteLayerSubtree(scene, 'a', 'dest', 0), /DeleteIncomplete.*Scene write failed/);
	assert.equal(drawingLayerIdForTest(scene.drawings.get('d1')), 'dest');
	assert.equal(readLayerTree(scene).nodes.length, 2);
	scene.failUpdate = false;
	await deleteLayerSubtree(scene, 'a', 'dest', 0);
	assert.deepEqual(readLayerTree(scene).nodes.map(node => node.id), ['dest']);
	assert.equal(scene.drawings.size, 1);
});

test('new artwork referencing the removed subtree during a batch prevents metadata removal', async () => {
	const scene = new Scene(tree(layer('a'), layer('dest')), [new Drawing('d1', 'a', 10)]);
	const update = scene.updateEmbeddedDocuments.bind(scene);
	scene.updateEmbeddedDocuments = async (...args) => {
		const result = await update(...args);
		const newcomer = new Drawing('new', 'a', 20, { parent: scene });
		scene.drawings.set(newcomer.id, newcomer);
		return result;
	};
	await assert.rejects(deleteLayerSubtree(scene, 'a', 'dest', 0), /DeleteIncomplete.*Changed/);
	assert.equal(scene.writes.length, 0);
	assert.equal(scene.drawings.size, 2);
});

test('non-GMs cannot create groups, collapse, recursively change visibility or remove subtrees', async () => {
	const scene = new Scene(tree(layer('g', { kind: 'group' }), layer('a', { parentId: 'g' })));
	game.user.isGM = false;
	assert.throws(() => createLayer(scene, 'No', 'group'), /GMOnly/);
	await assert.rejects(toggleGroupCollapsed(scene, 'g'), /GMOnly/);
	await assert.rejects(setSubtreeWorkspaceVisibility(scene, 'g', false), /GMOnly/);
	await assert.rejects(setSubtreePresentation(scene, 'g', true), /GMOnly/);
	await assert.rejects(deleteLayerSubtree(scene, 'g', UNASSIGNED), /GMOnly/);
	assert.equal(scene.writes.length, 0);
});

test('nested panel displays aggregate counts/tri-state and omits collapsed descendants only from UI', async () => {
	const scene = canvas.scene = new Scene(tree(layer('g', { kind: 'group', playerAllowed: true }),
		layer('a', { parentId: 'g', playerAllowed: true }), layer('b', { parentId: 'g' })),
		[new Drawing('a1', 'a'), new Drawing('b1', 'b'), new Drawing('b2', 'b')]);
	const panel = new LayerPanel();
	let context = await panel._prepareContext();
	assert.equal(context.rows[0].count, 3);
	assert.equal(context.rows[0].playerAria, 'mixed');
	assert.equal(context.rows[0].localAria, 'true');
	assert.deepEqual(context.rows.map(row => row.depth), [0, 1, 1]);
	await toggleGroupCollapsed(scene, 'g');
	context = await panel._prepareContext();
	assert.deepEqual(context.rows.map(row => row.id), ['g']);
	assert.equal(context.rows[0].collapsed, true);
	assert.equal(readLayerTree(scene).nodes.length, 3);
	assert.equal(layerVisibilitySummary(readLayerTree(scene), node => node.playerAllowed).get('a').state, 'visible');
});

test('group drag middle reparents and edge drops reorder among siblings', async () => {
	canvas.scene = new Scene(tree(layer('g', { kind: 'group' }), layer('a'), layer('h', { kind: 'group' })));
	const panel = new LayerPanel();
	await panel._prepareContext();
	const listeners = {};
	const row = { dataset: { layerId: 'g', layerKind: 'group' },
		getBoundingClientRect: () => ({ top: 10, height: 100 }),
		addEventListener: (name, callback) => { listeners[name] = callback; } };
	panel.element = { querySelectorAll: selector => selector === '[data-layer-id]' ? [row] : [] };
	await panel._onRender({}, {});
	const drop = (id, revision, clientY) => listeners.drop({
		preventDefault() {}, clientY,
		dataTransfer: { getData: () => JSON.stringify({ sceneId: canvas.scene.id, revision, id }) },
	});
	await drop('a', 0, 60);
	assert.equal(readLayerTree().nodes.find(node => node.id === 'a').parentId, 'g');
	await panel._prepareContext();
	await panel._onRender({}, {});
	await drop('h', 1, 12);
	assert.deepEqual(orderedLayerNodes(readLayerTree()).map(({ node }) => node.id), ['h', 'g', 'a']);
});

test('cyclical group drag is rejected without saving or losing the subtree', async () => {
	canvas.scene = new Scene(tree(layer('g', { kind: 'group' }), layer('h', { kind: 'group', parentId: 'g' }),
		layer('a', { parentId: 'h' })));
	const panel = new LayerPanel();
	await panel._prepareContext();
	const listeners = {};
	const row = { dataset: { layerId: 'h', layerKind: 'group' },
		getBoundingClientRect: () => ({ top: 0, height: 100 }),
		addEventListener: (name, callback) => { listeners[name] = callback; } };
	panel.element = { querySelectorAll: selector => selector === '[data-layer-id]' ? [row] : [] };
	await panel._onRender({}, {});
	await listeners.drop({ preventDefault() {}, clientY: 50,
		dataTransfer: { getData: () => JSON.stringify({ sceneId: canvas.scene.id, revision: 0, id: 'g' }) } });
	assert.equal(errors.length, 1);
	assert.equal(canvas.scene.writes.length, 0);
	assert.deepEqual(orderedLayerNodes(readLayerTree()).map(({ node }) => node.id), ['g', 'h', 'a']);
});

test('destination dialog obeys DialogV2 DIV/serialization contract', async () => {
	foundry.applications.api.DialogV2.prompt = async config => {
		assert.equal(config.content.tagName, 'DIV');
		assert.deepEqual(config.content.attributes, {});
		const label = config.content.children[1];
		const select = label.children[0];
		assert.equal(select.attributes.name, 'destinationId');
		assert.equal(select.children[0].attributes.value, '');
		assert.equal(select.children[1].textContent, '<Group>');
		assert.equal(select.children[1].attributes.selected, '');
		return config.ok.callback(null, null, {
			element: { querySelector: () => ({ value: 'g' }) },
		});
	};
	assert.equal(await LayerPanel.promptDestination('Move',
		[{ id: '', name: 'Root' }, { id: 'g', name: '<Group>' }], 'g', 'MoveHint'), 'g');
});

test('group actions open child creation at the captured parent and revision', async () => {
	canvas.scene = new Scene(tree(layer('g', { kind: 'group' })));
	const panel = new LayerPanel();
	await panel._prepareContext();
	foundry.applications.api.DialogV2.prompt = async () => 'Nested';
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'addGroup', id: 'g' } });
	const child = readLayerTree().nodes.find(node => node.name === 'Nested');
	assert.equal(child.kind, 'group');
	assert.equal(child.parentId, 'g');
	assert.equal(readLayerWorkspace().activeLayerId, null);
});

test('recursive player Show All requires confirmation and leaves GM workspace unchanged', async () => {
	canvas.scene = new Scene(tree(layer('g', { kind: 'group' }), layer('a', { parentId: 'g' })));
	const panel = new LayerPanel();
	await panel._prepareContext();
	const action = { dataset: { action: 'showPlayersAll', id: 'g' } };
	const workspace = structuredClone(settings[`foundryshop.${LAYER_WORKSPACE}`]);
	await LayerPanel.onAction.call(panel, {}, action);
	assert.ok(readLayerTree().nodes.every(node => !node.playerAllowed));
	foundry.applications.api.DialogV2.confirm = async () => true;
	await LayerPanel.onAction.call(panel, {}, action);
	assert.ok(readLayerTree().nodes.every(node => node.playerAllowed));
	assert.deepEqual(settings[`foundryshop.${LAYER_WORKSPACE}`], workspace);
});

test('safe deletion UI cancellation/stale confirmations do not remove metadata or artwork', async () => {
	const scene = canvas.scene = new Scene(tree(layer('g', { kind: 'group' }), layer('a', { parentId: 'g' })),
		[new Drawing('d1', 'a')]);
	const panel = new LayerPanel();
	await panel._prepareContext();
	foundry.applications.api.DialogV2.prompt = async () => UNASSIGNED;
	const action = { dataset: { action: 'deleteNode', id: 'g' } };
	await LayerPanel.onAction.call(panel, {}, action);
	assert.equal(scene.writes.length, 0);
	foundry.applications.api.DialogV2.confirm = async () => {
		await renameLayer(scene, 'g', 'Changed', 0);
		return true;
	};
	await LayerPanel.onAction.call(panel, {}, action);
	assert.equal(scene.embeddedWrites.length, 0);
	assert.equal(readLayerTree(scene).nodes.length, 2);
	assert.equal(errors.length, 1);
});

test('Move to Group permits root reparenting and excludes descendant destinations in its dialog', async () => {
	canvas.scene = new Scene(tree(layer('g', { kind: 'group' }), layer('h', { kind: 'group', parentId: 'g' }),
		layer('a', { parentId: 'h' }), layer('outside', { kind: 'group' })));
	const panel = new LayerPanel();
	await panel._prepareContext();
	foundry.applications.api.DialogV2.prompt = async config => {
		const select = config.content.children[1].children[0];
		assert.deepEqual(select.children.map(option => option.attributes.value), ['', 'g', 'outside']);
		return '';
	};
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'move', id: 'h' } });
	assert.equal(readLayerTree().nodes.find(node => node.id === 'h').parentId, null);
	assert.equal(readLayerTree().nodes.find(node => node.id === 'a').parentId, 'h');
	assert.equal(errors.length, 0);
});

test('Scene switches during move or group Show All confirmation reject stale actions', async () => {
	const scene = canvas.scene = new Scene(tree(layer('g', { kind: 'group' }), layer('a', { parentId: 'g' })));
	const panel = new LayerPanel();
	await panel._prepareContext();
	foundry.applications.api.DialogV2.prompt = async () => { canvas.scene = new Scene(); return ''; };
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'move', id: 'a' } });
	assert.equal(scene.writes.length, 0);
	canvas.scene = scene;
	await panel._prepareContext();
	foundry.applications.api.DialogV2.confirm = async () => { canvas.scene = new Scene(); return true; };
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'showPlayersAll', id: 'g' } });
	assert.equal(scene.writes.length, 0);
	assert.equal(errors.length, 2);
});

test('safe removal handles partial membership application without dropping the source layer', async () => {
	const scene = new Scene(tree(layer('a'), layer('dest')),
		[new Drawing('d1', 'a', 10), new Drawing('d2', 'a', 20)]);
	const update = scene.updateEmbeddedDocuments.bind(scene);
	scene.updateEmbeddedDocuments = (type, patches, options) => update(type, patches.slice(0, 1), options);
	await assert.rejects(deleteLayerSubtree(scene, 'a', 'dest', 0), /DeleteIncomplete.*DrawingUpdateIncomplete/);
	assert.equal(scene.writes.length, 0);
	assert.equal(scene.drawings.size, 2);
	assert.equal(readLayerTree(scene).nodes.length, 2);
	assert.equal(drawingLayerIdForTest(scene.drawings.get('d1')), 'dest');
	assert.equal(drawingLayerIdForTest(scene.drawings.get('d2')), 'a');
});

test('safe removal detects an ignored metadata write after verified membership transfer', async () => {
	const scene = new Scene(tree(layer('a'), layer('dest')), [new Drawing('d1', 'a')]);
	scene.skipUpdate = true;
	await assert.rejects(deleteLayerSubtree(scene, 'a', 'dest', 0), /DeleteIncomplete.*Changed/);
	assert.equal(scene.drawings.size, 1);
	assert.equal(readLayerTree(scene).nodes.length, 2);
	assert.equal(drawingLayerIdForTest(scene.drawings.get('d1')), 'dest');
});

test('empty group removal rejects destination groups/locked layers and preserves outside groups', async () => {
	const scene = new Scene(tree(layer('g', { kind: 'group' }), layer('h', { kind: 'group' }),
		layer('dest', { locked: true })));
	await assert.rejects(deleteLayerSubtree(scene, 'g', 'h', 0), /InvalidDestination/);
	await assert.rejects(deleteLayerSubtree(scene, 'g', 'dest', 0), /InvalidDestination/);
	await deleteLayerSubtree(scene, 'g', UNASSIGNED, 0);
	assert.equal(scene.embeddedWrites.length, 0);
	assert.deepEqual(readLayerTree(scene).nodes.map(node => node.id), ['h', 'dest']);
});

test('hierarchy traversals support deep nesting without recursive call-stack dependence', () => {
	const nodes = Array.from({ length: 300 }, (_, index) => layer(`g${index}`, {
		kind: 'group', parentId: index ? `g${index - 1}` : null, playerAllowed: true,
	}));
	nodes.push(layer('ink', { parentId: 'g299', playerAllowed: true }));
	const model = validateLayerTree(tree(...nodes));
	assert.equal(orderedLayerNodes(model).at(-1).depth, 300);
	assert.equal(layerSubtreeIds(model, 'g0').size, 301);
	assert.equal(layerVisibilitySummary(model, node => node.playerAllowed).get('g0').state, 'visible');
});

test('a 3,000-Drawing nested map reorders a whole location with a single affected-subtree batch', async () => {
	const nodes = [];
	const drawings = [];
	for (let groupIndex = 0; groupIndex < 10; groupIndex++) {
		const groupId = `g${groupIndex}`;
		nodes.push(layer(groupId, { kind: 'group', playerAllowed: true }));
		for (let layerIndex = 0; layerIndex < 3; layerIndex++) {
			const layerId = `${groupId}l${layerIndex}`;
			nodes.push(layer(layerId, { parentId: groupId, playerAllowed: true }));
			for (let stroke = 0; stroke < 100; stroke++) {
				drawings.push(new Drawing(`d${drawings.length}`, layerId, (3000 - drawings.length) * 1024));
			}
		}
	}
	const scene = canvas.scene = new Scene(tree(...nodes), drawings);
	const membership = drawings.map(drawingLayerIdForTest);
	await reorderLayer(scene, 'g9', 'g0', 'before', 0);
	assert.equal(scene.embeddedWrites.length, 1);
	assert.equal(scene.embeddedWrites[0].patches.length, 300);
	assert.deepEqual(drawings.map(drawingLayerIdForTest), membership);
	const stack = layerDrawingStack(readLayerTree(scene), drawings);
	assert.ok(stack.every((drawing, index) => !index || stack[index - 1].sort < drawing.sort));
	const panel = new LayerPanel();
	const context = await panel._prepareContext();
	assert.equal(context.rows[0].id, 'g9');
	assert.equal(context.rows[0].count, 300);
});

test('tree preserves validated presets and accepts foundation state without the optional collection', () => {
	const model = tree(layer('a'));
	delete model.presets;
	assert.deepEqual(validateLayerTree(model).presets, []);
	model.presets = [{ id: 'p1', name: ' Quarry ', entries: [{ nodeId: 'a', playerAllowed: true }] }];
	assert.deepEqual(validateLayerTree(model).presets, [
		{ id: 'p1', name: 'Quarry', entries: [{ nodeId: 'a', playerAllowed: true }] },
	]);
});

test('preset validation rejects invalid IDs, duplicate names/references, nonboolean gates and malformed collections', () => {
	const preset = { id: 'p1', name: 'Quarry', entries: [{ nodeId: 'a', playerAllowed: true }] };
	for (const invalid of [
		null, {}, [null], [{ ...preset, id: UNASSIGNED }], [{ ...preset, id: '' }],
		[preset, { ...preset, name: 'Other' }], [preset, { ...preset, id: 'p2', name: 'quarry' }],
		[{ ...preset, name: ' ' }], [{ ...preset, name: 'x'.repeat(81) }],
		[{ ...preset, entries: {} }], [{ ...preset, entries: [preset.entries[0], preset.entries[0]] }],
		[{ ...preset, entries: [{ nodeId: 'a', playerAllowed: 'true' }] }],
		[{ ...preset, entries: [{ nodeId: UNASSIGNED, playerAllowed: false }] }],
	]) assert.throws(() => validatePresentationPresets(invalid));
});

test('capture stores every own gate including ancestor-hidden children, with stable ID and no workspace data', async () => {
	const scene = canvas.scene = new Scene(tree(layer('g', { kind: 'group' }),
		layer('a', { parentId: 'g', playerAllowed: true }), layer('b')));
	await setActiveLayer(scene, 'a');
	await toggleWorkspaceVisibility(scene, 'b');
	await toggleGroupCollapsed(scene, 'g');
	const workspace = structuredClone(settings);
	await capturePresentationPreset(scene, 'Surface', 0);
	const preset = readLayerTree(scene).presets[0];
	assert.equal(preset.id, 'id1');
	assert.deepEqual(preset.entries, [
		{ nodeId: 'g', playerAllowed: false }, { nodeId: 'a', playerAllowed: true }, { nodeId: 'b', playerAllowed: false },
	]);
	assert.deepEqual(Object.keys(preset).sort(), ['entries', 'id', 'name']);
	assert.deepEqual(settings, workspace);
	assert.equal(scene.embeddedWrites.length, 0);
	assert.ok(readLayerTree(scene).nodes.find(node => node.id === 'a').playerAllowed);
});

test('preset apply replaces all gates in a single verified Scene write without touching workspace, brush or Drawings', async () => {
	const scene = canvas.scene = new Scene(tree(
		layer('g', { kind: 'group', playerAllowed: true }),
		layer('a', { parentId: 'g', playerAllowed: true, defaults: { strokeWidth: 7 } }),
		layer('b', { parentId: 'g' }),
	), [new Drawing('d1', 'a', 50, { text: 'Hall', hidden: true, locked: true })]);
	await capturePresentationPreset(scene, 'Surface', 0);
	const id = readLayerTree(scene).presets[0].id;
	await setSubtreePresentation(scene, 'g', false, 1);
	await setActiveLayer(scene, 'a');
	await toggleWorkspaceVisibility(scene, 'b');
	await toggleGroupCollapsed(scene, 'g');
	canvas.drawings.controlled = [{ document: scene.drawings.get('d1') }];
	const workspace = structuredClone(settings);
	const drawing = structuredClone({ ...scene.drawings.get('d1'), parent: undefined });
	const selection = canvas.drawings.controlled;
	const beforeWrites = scene.writes.length;
	await applyPresentationPreset(scene, id, 2);
	assert.equal(scene.writes.length - beforeWrites, 1);
	assert.deepEqual(readLayerTree(scene).nodes.map(node => node.playerAllowed), [true, true, false]);
	assert.deepEqual(settings, workspace);
	assert.deepEqual({ ...scene.drawings.get('d1'), parent: undefined }, drawing);
	assert.equal(canvas.drawings.controlled, selection);
	assert.equal(scene.embeddedWrites.length, 0);
	assert.deepEqual(readLayerTree(scene).nodes[1].defaults, { strokeWidth: 7 });
});

test('older presets hide every new node even if it is currently presented', async () => {
	const scene = new Scene(tree(layer('a', { playerAllowed: true })));
	await capturePresentationPreset(scene, 'Original', 0);
	const presetId = readLayerTree(scene).presets[0].id;
	await createLayer(scene, 'New location', 'group', null, 1);
	const groupId = readLayerTree(scene).nodes[1].id;
	await createLayer(scene, 'New ink', 'layer', groupId, 2);
	const layerId = readLayerTree(scene).nodes[2].id;
	await setSubtreePresentation(scene, groupId, true, 3);
	assert.equal(analyzePresentationPreset(readLayerTree(scene), readLayerTree(scene).presets[0]).newIds.length, 2);
	await applyPresentationPreset(scene, presetId, 4);
	assert.deepEqual(readLayerTree(scene).nodes.map(node => node.playerAllowed), [true, false, false]);
	assert.equal(analyzePresentationPreset(readLayerTree(scene), readLayerTree(scene).presets[0]).matches, true);
});

test('rename/reorder of layers does not break preset stable-ID references', async () => {
	const scene = new Scene(tree(layer('a', { playerAllowed: true }), layer('b')));
	await capturePresentationPreset(scene, 'Original', 0);
	const presetId = readLayerTree(scene).presets[0].id;
	const entries = structuredClone(readLayerTree(scene).presets[0].entries);
	await renameLayer(scene, 'a', 'Different name', 1);
	await reorderLayer(scene, 'a', 'b', 'after', 2);
	await setPlayerPresentation(scene, 'a', false, 3);
	await applyPresentationPreset(scene, presetId, 4);
	assert.equal(readLayerTree(scene).nodes.find(node => node.id === 'a').playerAllowed, true);
	assert.deepEqual(readLayerTree(scene).presets[0].entries, entries);
});

test('deleted node references stay explicit, block apply, and are repaired only by confirmed recapture', async () => {
	const scene = new Scene(tree(layer('a', { playerAllowed: true }), layer('b')));
	await capturePresentationPreset(scene, 'Original', 0);
	const presetId = readLayerTree(scene).presets[0].id;
	await deleteLayerSubtree(scene, 'a', UNASSIGNED, 1);
	const before = readLayerTree(scene);
	assert.deepEqual(analyzePresentationPreset(before, before.presets[0]).missingIds, ['a']);
	await assert.rejects(applyPresentationPreset(scene, presetId, 2), /PresetMissingNodes/);
	assert.equal(readLayerTree(scene), before);
	await recapturePresentationPreset(scene, presetId, 2);
	assert.deepEqual(readLayerTree(scene).presets[0].entries, [{ nodeId: 'b', playerAllowed: false }]);
	await applyPresentationPreset(scene, presetId, 3);
	assert.equal(readLayerTree(scene).revision, 3, 'already-matching apply is a no-op');
});

test('preset recapture preserves ID/name and does not alter live presentation or workspace', async () => {
	const scene = new Scene(tree(layer('a')));
	await capturePresentationPreset(scene, 'Original', 0);
	const presetId = readLayerTree(scene).presets[0].id;
	await setPlayerPresentation(scene, 'a', true, 1);
	const workspace = structuredClone(settings);
	await recapturePresentationPreset(scene, presetId, 2);
	assert.deepEqual(readLayerTree(scene).presets[0], {
		id: presetId, name: 'Original', entries: [{ nodeId: 'a', playerAllowed: true }],
	});
	assert.equal(readLayerTree(scene).nodes[0].playerAllowed, true);
	assert.deepEqual(settings, workspace);
});

test('preset rename and remove preserve artwork, tree and live gates', async () => {
	const scene = new Scene(tree(layer('a', { playerAllowed: true })), [new Drawing('d1', 'a')]);
	await capturePresentationPreset(scene, 'Original', 0);
	const id = readLayerTree(scene).presets[0].id;
	await renamePresentationPreset(scene, id, ' Updated ', 1);
	assert.equal(readLayerTree(scene).presets[0].name, 'Updated');
	await removePresentationPreset(scene, id, 2);
	assert.deepEqual(readLayerTree(scene).presets, []);
	assert.equal(scene.drawings.size, 1);
	assert.equal(readLayerTree(scene).nodes[0].playerAllowed, true);
	assert.equal(scene.embeddedWrites.length, 0);
});

test('duplicate names and empty captures reject before persistence and leave the queue usable', async () => {
	const scene = new Scene();
	await assert.rejects(capturePresentationPreset(scene, 'Empty', 0), /NoPresetNodes/);
	await createLayer(scene, 'Ink');
	await capturePresentationPreset(scene, 'First', 1);
	const id = readLayerTree(scene).presets[0].id;
	await assert.rejects(capturePresentationPreset(scene, 'first', 2), /DuplicatePresetName/);
	await capturePresentationPreset(scene, 'Second', 2);
	await assert.rejects(renamePresentationPreset(scene, id, ' SECOND ', 3), /DuplicatePresetName/);
	await renamePresentationPreset(scene, id, 'Third', 3);
	assert.equal(readLayerTree(scene).presets[0].name, 'Third');
});

test('preset commands all enforce authority and stale revisions', async () => {
	const scene = new Scene(tree(layer('a')));
	await capturePresentationPreset(scene, 'First', 0);
	const id = readLayerTree(scene).presets[0].id;
	const commands = [
		() => capturePresentationPreset(scene, 'Second', 0),
		() => recapturePresentationPreset(scene, id, 0),
		() => renamePresentationPreset(scene, id, 'Renamed', 0),
		() => removePresentationPreset(scene, id, 0),
		() => applyPresentationPreset(scene, id, 0),
	];
	for (const command of commands) await assert.rejects(command(), /Changed/);
	game.user.isGM = false;
	for (const command of commands) await assert.rejects(command(), /GMOnly/);
	assert.equal(scene.writes.length, 1);
});

test('failed or ignored preset writes do not produce success-shaped results', async () => {
	const scene = new Scene(tree(layer('a', { playerAllowed: true })));
	await capturePresentationPreset(scene, 'First', 0);
	const id = readLayerTree(scene).presets[0].id;
	await setPlayerPresentation(scene, 'a', false, 1);
	scene.failUpdate = true;
	await assert.rejects(applyPresentationPreset(scene, id, 2), /Scene write failed/);
	assert.equal(readLayerTree(scene).nodes[0].playerAllowed, false);
	scene.failUpdate = false;
	scene.skipUpdate = true;
	await assert.rejects(applyPresentationPreset(scene, id, 2), /StateIncomplete.*Changed/);
	assert.equal(readLayerTree(scene).nodes[0].playerAllowed, false);
	scene.skipUpdate = false;
	await applyPresentationPreset(scene, id, 2);
	assert.equal(readLayerTree(scene).nodes[0].playerAllowed, true);
});

test('presets survive Scene reload as data and an already-matching apply needs no new write', async () => {
	const scene = new Scene(tree(layer('a', { playerAllowed: true })));
	await capturePresentationPreset(scene, 'First', 0);
	const persisted = structuredClone(scene.getFlag('foundryshop', 'layers'));
	const reloaded = new Scene(persisted);
	const id = readLayerTree(reloaded).presets[0].id;
	await applyPresentationPreset(reloaded, id, 1);
	assert.equal(reloaded.writes.length, 0);
	assert.equal(readLayerTree(reloaded).presets[0].name, 'First');
});

test('manual presentation changes invalidate the matching indicator without altering snapshots', async () => {
	const scene = canvas.scene = new Scene(tree(layer('a', { playerAllowed: true })));
	await capturePresentationPreset(scene, 'First', 0);
	const panel = new LayerPanel();
	assert.equal((await panel._prepareContext()).presets[0].matches, true);
	await setPlayerPresentation(scene, 'a', false, 1);
	assert.equal((await panel._prepareContext()).presets[0].matches, false);
	assert.equal(readLayerTree(scene).presets[0].entries[0].playerAllowed, true);
});

test('panel flags missing preset nodes and shows safe behavior for newly added nodes', async () => {
	const model = tree(layer('a'), layer('new', { playerAllowed: true }));
	model.presets = [{ id: 'p1', name: 'Saved', entries: [
		{ nodeId: 'a', playerAllowed: false }, { nodeId: 'missing', playerAllowed: true },
	] }];
	canvas.scene = new Scene(model);
	const preset = (await new LayerPanel()._prepareContext()).presets[0];
	assert.equal(preset.canApply, false);
	assert.equal(preset.missingCount, 1);
	assert.equal(preset.newCount, 1);
	assert.equal(preset.matches, false);
});

test('preset capture/rename dialogs use the preset label and escape names via DOM text/attributes', async () => {
	canvas.scene = new Scene(tree(layer('a')));
	const panel = new LayerPanel();
	await panel._prepareContext();
	foundry.applications.api.DialogV2.prompt = async config => {
		assert.equal(config.content.tagName, 'DIV');
		assert.equal(config.content.children[0].textContent, 'FOUNDRYSHOP.Layers.PresetName');
		return '<Quarry> & Ink';
	};
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'presetCapture' } });
	assert.equal(readLayerTree().presets[0].name, '<Quarry> & Ink');
	const id = readLayerTree().presets[0].id;
	foundry.applications.api.DialogV2.prompt = async config => {
		assert.equal(config.content.children[0].children[0].attributes.value, '<Quarry> & Ink');
		return 'Deep Quarry';
	};
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'presetRename', id } });
	assert.equal(readLayerTree().presets[0].name, 'Deep Quarry');
});

test('preset apply, recapture and removal all require confirmation; cancellation changes nothing', async () => {
	canvas.scene = new Scene(tree(layer('a', { playerAllowed: true })));
	await capturePresentationPreset(canvas.scene, '<Quarry>', 0);
	const id = readLayerTree().presets[0].id;
	await setPlayerPresentation(canvas.scene, 'a', false, 1);
	const panel = new LayerPanel();
	await panel._prepareContext();
	const before = JSON.stringify(readLayerTree());
	for (const action of ['presetApply', 'presetRecapture', 'presetRemove']) {
		foundry.applications.api.DialogV2.confirm = async config => {
			assert.equal(config.content.tagName, 'DIV');
			assert.deepEqual(config.content.attributes, {});
			assert.equal(config.content.children[0].textContent, '<Quarry>');
			return false;
		};
		await LayerPanel.onAction.call(panel, {}, { dataset: { action, id } });
		assert.equal(JSON.stringify(readLayerTree()), before);
	}
	foundry.applications.api.DialogV2.confirm = async () => true;
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'presetApply', id } });
	assert.equal(readLayerTree().nodes[0].playerAllowed, true);
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'presetRemove', id } });
	assert.equal(readLayerTree().presets.length, 0);
	assert.equal(readLayerTree().nodes[0].playerAllowed, true);
});

test('Scene changes during preset dialogs prevent changes to the old Scene', async () => {
	const scene = canvas.scene = new Scene(tree(layer('a')));
	await capturePresentationPreset(scene, 'Saved', 0);
	const id = readLayerTree(scene).presets[0].id;
	const panel = new LayerPanel();
	await panel._prepareContext();
	foundry.applications.api.DialogV2.confirm = async () => { canvas.scene = new Scene(); return true; };
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'presetRemove', id } });
	assert.equal(readLayerTree(scene).presets.length, 1);
	canvas.scene = scene;
	await panel._prepareContext();
	foundry.applications.api.DialogV2.prompt = async () => { canvas.scene = new Scene(); return 'New'; };
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'presetCapture' } });
	assert.equal(readLayerTree(scene).presets.length, 1);
	assert.equal(errors.length, 2);
});

test('presentation changes during confirmation reject a stale preset command', async () => {
	const scene = canvas.scene = new Scene(tree(layer('a', { playerAllowed: true })));
	await capturePresentationPreset(scene, 'Saved', 0);
	const id = readLayerTree(scene).presets[0].id;
	const panel = new LayerPanel();
	await panel._prepareContext();
	foundry.applications.api.DialogV2.confirm = async () => {
		await setPlayerPresentation(scene, 'a', false, 1);
		return true;
	};
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'presetApply', id } });
	assert.equal(readLayerTree(scene).nodes[0].playerAllowed, false);
	assert.equal(errors.length, 1);
});

test('player action dispatch cannot capture, apply, rename or remove presets', async () => {
	canvas.scene = new Scene(tree(layer('a')));
	await capturePresentationPreset(canvas.scene, 'Saved', 0);
	const panel = new LayerPanel();
	await panel._prepareContext();
	game.user.isGM = false;
	for (const action of ['presetCapture', 'presetApply', 'presetRecapture', 'presetRename', 'presetRemove']) {
		await LayerPanel.onAction.call(panel, {}, { dataset: { action, id: 'id1' } });
	}
	assert.equal(errors.length, 5);
	assert.equal(canvas.scene.writes.length, 1);
});

test('removal dialog warns about affected presets before preserving their missing references', async () => {
	canvas.scene = new Scene(tree(layer('a'), layer('b')));
	await capturePresentationPreset(canvas.scene, 'Saved', 0);
	const panel = new LayerPanel();
	await panel._prepareContext();
	foundry.applications.api.DialogV2.prompt = async () => UNASSIGNED;
	foundry.applications.api.DialogV2.confirm = async config => {
		assert.equal(config.content.tagName, 'DIV');
		assert.deepEqual(config.content.attributes, {});
		assert.equal(config.content.children.length, 2);
		assert.match(config.content.children[1].textContent, /DeletePresetHint/);
		return true;
	};
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'deleteNode', id: 'a' } });
	assert.equal(errors.length, 0);
	assert.equal(readLayerTree().presets.length, 1);
	assert.equal((await panel._prepareContext()).presets[0].canApply, false);
});

test('duplicate layer copies metadata and artwork above the source and activates the copy', async () => {
	const scene = canvas.scene = new Scene(tree(layer('a', { playerAllowed: true, defaults: { strokeWidth: 9 } }), layer('b')),
		[new Drawing('d1', 'a', 2, { strokeColor: '#ff0000', flags: { foundryshop: { layerId: 'a', provenance: { importId: 'x' } } } }),
			new Drawing('d2', 'b', 1)]);
	await duplicateLayer(scene, 'a', 'a copy', 0);
	const nodes = readLayerTree(scene).nodes;
	const copy = nodes[0];
	assert.deepEqual(nodes.map(node => node.id), [copy.id, 'a', 'b']);
	assert.equal(copy.name, 'a copy');
	assert.equal(copy.playerAllowed, true);
	assert.deepEqual(copy.defaults, { strokeWidth: 9 });
	const copies = [...scene.drawings.values()].filter(drawing => drawing.getFlag('foundryshop', 'layerId') === copy.id);
	assert.equal(copies.length, 1);
	assert.equal(copies[0].strokeColor, '#ff0000');
	assert.equal(copies[0].getFlag('foundryshop', 'provenance'), undefined);
	assert.equal(scene.drawings.get('d1').getFlag('foundryshop', 'layerId'), 'a');
	assert.equal(readLayerWorkspace(scene).activeLayerId, copy.id);
	assert.ok(copies[0].sort > scene.drawings.get('d1').sort);
	await assert.rejects(duplicateLayer(scene, 'missing', 'x'));
});

test('duplicate refuses groups and locked layers', async () => {
	const scene = canvas.scene = new Scene(tree(layer('g', { kind: 'group' }), layer('a', { locked: true })));
	await assert.rejects(duplicateLayer(scene, 'g', 'copy', 0), /DuplicateGroup/);
	await assert.rejects(duplicateLayer(scene, 'a', 'copy', 0), /Locked/);
	assert.equal(scene.writes.length, 0);
});

test('delete with artwork removes the subtree Drawings and metadata, keeping other artwork', async () => {
	const scene = canvas.scene = new Scene(tree(layer('g', { kind: 'group' }), layer('a', { parentId: 'g' }), layer('b')),
		[new Drawing('d1', 'a'), new Drawing('d2', 'b')]);
	await deleteLayerSubtree(scene, 'g', DELETE_ARTWORK, 0);
	assert.deepEqual([...scene.drawings.keys()], ['d2']);
	assert.deepEqual(readLayerTree(scene).nodes.map(node => node.id), ['b']);
	const locked = new Scene(tree(layer('a')), [new Drawing('d1', 'a', 0, { locked: true })]);
	await assert.rejects(deleteLayerSubtree(locked, 'a', DELETE_ARTWORK, 0), /Locked/);
	assert.equal(locked.drawings.size, 1);
});

test('row menu toggles per row and delete dialog offers the delete-artwork option with a count', async () => {
	canvas.scene = new Scene(tree(layer('a'), layer('b')), [new Drawing('d1', 'a'), new Drawing('d2', 'a')]);
	const panel = new LayerPanel();
	await panel._prepareContext();
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'rowMenu', id: 'a' } });
	assert.deepEqual(panel.context.rows.map(row => row.menuOpen), [true, false]);
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'rowMenu', id: 'a' } });
	assert.deepEqual(panel.context.rows.map(row => row.menuOpen), [false, false]);
	foundry.applications.api.DialogV2.prompt = async config => {
		const select = config.content.children[1].children[0];
		assert.equal(select.children.at(-1).attributes.value, DELETE_ARTWORK);
		return DELETE_ARTWORK;
	};
	foundry.applications.api.DialogV2.confirm = async config => {
		assert.match(config.content.children[0].textContent, /DeleteArtworkPrompt/);
		return true;
	};
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'deleteNode', id: 'a' } });
	assert.equal(errors.length, 0);
	assert.equal(canvas.scene.drawings.size, 0);
	assert.deepEqual(readLayerTree().nodes.map(node => node.id), ['b']);
});

test('tracing reference uploads a snapshot Tile, replaces it on refresh and removes it without touching artwork', async () => {
	const { createTracingTile, removeTracingTile, tracingTiles, TRACING_FOLDER } = await import('../scripts/layers/tracing_tile.js');
	const scene = canvas.scene = new Scene(tree(layer('a'), layer('b')), [new Drawing('d1', 'a', 0, { elevation: 0 }), new Drawing('d2', 'b')]);
	const tiles = scene.tiles = new Map();
	scene.createEmbeddedDocuments = async (type, data) => data.map(source => {
		const tile = { ...structuredClone(source), id: `t${tiles.size + 1}${nextId}`,
			getFlag: (namespace, key) => source.flags?.[namespace]?.[key] };
		tiles.set(tile.id, tile);
		return tile;
	});
	scene.deleteEmbeddedDocuments = async (type, ids) => ids.map(id => { const tile = tiles.get(id); tiles.delete(id); return tile; });
	settings['foundryshop.stampAssetFolder'] = '';
	game.user.can = () => true;
	const uploads = [];
	globalThis.File = class { constructor(parts, name, options) { Object.assign(this, { parts, name, ...options }); } };
	foundry.applications.apps = { FilePicker: { implementation: {
		browse: async () => ({ files: [] }), createDirectory: async () => {},
		upload: async (source, folder, file) => { uploads.push({ folder, file }); return { path: `${folder}/${file.name}` }; },
	} } };
	const render = async entries => ({ blob: { entries }, bounds: { x: 10, y: 20, width: 30, height: 40 } });
	const exportDrawing = drawing => ({ id: drawing.id });
	const tile = await createTracingTile(scene, 'a', { render, exportDrawing });
	assert.equal(uploads[0].folder, TRACING_FOLDER);
	assert.deepEqual(uploads[0].file.parts[0].entries, [{ id: 'd1' }]);
	assert.equal(tile.hidden, true);
	assert.equal(tile.locked, true);
	assert.equal(tile.alpha, 0.5);
	assert.deepEqual([tile.x, tile.y, tile.width, tile.height], [10, 20, 30, 40]);
	assert.ok(readLayerWorkspace(scene).hiddenIds.includes('a'));
	const refreshed = await createTracingTile(scene, 'a', { render, exportDrawing });
	assert.deepEqual(tracingTiles(scene, 'a').map(entry => entry.id), [refreshed.id]);
	assert.ok(readLayerWorkspace(scene).hiddenIds.includes('a'));
	assert.equal(await removeTracingTile(scene, 'a'), 1);
	assert.equal(tiles.size, 0);
	assert.ok(!readLayerWorkspace(scene).hiddenIds.includes('a'));
	assert.equal(scene.drawings.size, 2);
	await assert.rejects(createTracingTile(scene, 'missing', { render, exportDrawing }));
	scene.drawings.delete('d2');
	await assert.rejects(createTracingTile(scene, 'b', { render, exportDrawing }), /TracingEmpty/);
	delete game.user.can;
});

test('a 3,000-Drawing presentation switch uses one Scene write and zero embedded writes', async () => {
	const scene = new Scene(tree(layer('a', { playerAllowed: true }), layer('b')),
		Array.from({ length: 3000 }, (_, index) => new Drawing(`d${index}`, index % 2 ? 'a' : 'b', index)));
	await capturePresentationPreset(scene, 'First', 0);
	const id = readLayerTree(scene).presets[0].id;
	await setPlayerPresentation(scene, 'a', false, 1);
	await setPlayerPresentation(scene, 'b', true, 2);
	const writes = scene.writes.length;
	await applyPresentationPreset(scene, id, 3);
	assert.equal(scene.writes.length - writes, 1);
	assert.equal(scene.embeddedWrites.length, 0);
	assert.equal(scene.drawings.size, 3000);
	assert.deepEqual(readLayerTree(scene).nodes.map(node => node.playerAllowed), [true, false]);
});

test('group locks inherit without overwriting child lock settings', async () => {
	const scene = new Scene(tree(layer('g', { kind: 'group' }),
		layer('nested', { kind: 'group', parentId: 'g' }),
		layer('a', { parentId: 'nested' }), layer('b', { parentId: 'g', locked: true }), layer('c')));
	await setLayerLocked(scene, 'g', true, 0);
	assert.deepEqual([...lockedLayerIds(readLayerTree(scene))], ['g', 'nested', 'a', 'b']);
	assert.equal(readLayerTree(scene).nodes[2].locked, false);
	await setLayerLocked(scene, 'g', false, 1);
	assert.deepEqual([...lockedLayerIds(readLayerTree(scene))], ['b']);
});

test('locking and unlocking never writes native Drawing locks, presentation or workspace', async () => {
	const scene = canvas.scene = new Scene(tree(layer('a', { playerAllowed: true })), [
		new Drawing('nativeLocked', 'a', 0, { locked: true }),
		new Drawing('nativeUnlocked', 'a', 1),
	]);
	await setActiveLayer(scene, 'a');
	const workspace = structuredClone(settings);
	await capturePresentationPreset(scene, 'Saved', 0);
	const preset = structuredClone(readLayerTree(scene).presets);
	await setLayerLocked(scene, 'a', true, 1);
	await setLayerLocked(scene, 'a', false, 2);
	assert.equal(scene.drawings.get('nativeLocked').locked, true);
	assert.equal(scene.drawings.get('nativeUnlocked').locked, false);
	assert.equal(scene.embeddedWrites.length, 0);
	assert.equal(readLayerTree(scene).nodes[0].playerAllowed, true);
	assert.deepEqual(readLayerTree(scene).presets, preset);
	assert.deepEqual(settings, workspace);
});

test('active layer excludes inherited locks, falls back to an available layer, and blocks when none remain', async () => {
	const scene = canvas.scene = new Scene(tree(layer('g', { kind: 'group' }), layer('a', { parentId: 'g' }), layer('b')));
	await setActiveLayer(scene, 'a');
	await setLayerLocked(scene, 'g', true, 0);
	assert.equal(activeLayer(readLayerTree(scene), readLayerWorkspace(scene)).id, 'b');
	await assert.rejects(setActiveLayer(scene, 'a'), /Locked/);
	const drawing = new Drawing('new', null, 0, { parent: scene });
	onPreCreateLayerDrawing(drawing, {}, {}, 'gm');
	assert.equal(drawingLayerIdForTest(drawing), 'b');
	await setLayerLocked(scene, 'b', true, 1);
	assert.equal(activeLayer(readLayerTree(scene), readLayerWorkspace(scene)), null);
	assert.equal(onPreCreateLayerDrawing(new Drawing('blocked', null, 0, { parent: scene }), {}, {}, 'gm'), false);
});

test('supplied membership cannot bypass a locked ancestor through paste, undo or another user', () => {
	const scene = new Scene(tree(layer('g', { kind: 'group', locked: true }), layer('a', { parentId: 'g' })));
	for (const options of [{}, { isUndo: true }, { keepId: true }]) {
		for (const gm of [true, false]) {
			game.user.isGM = gm;
			const drawing = new Drawing('new', 'a', 0, { parent: scene });
			assert.equal(onPreCreateLayerDrawing(drawing, {}, options, gm ? 'gm' : 'player'), false);
		}
	}
	assert.equal(errors.length, 6);
});

test('native edits, deletion and membership escapes are blocked for inherited locks with explicit errors', () => {
	const scene = new Scene(tree(layer('g', { kind: 'group', locked: true }), layer('a', { parentId: 'g' })),
		[new Drawing('d1', 'a')]);
	const drawing = scene.drawings.get('d1');
	for (const patch of [
		{ x: 10 }, { text: 'Edited' }, { shape: { points: [0, 0, 5, 5] } },
		{ locked: false }, { 'flags.foundryshop.layerId': null }, { sort: 12 },
		{ 'flags.foundryshop.layerId': 'elsewhere' }, { flags: { foundryshop: { layerId: null } } },
	]) assert.equal(onPreUpdateLayerDrawing(drawing, patch, {}), false);
	assert.equal(onPreDeleteLayerDrawing(drawing), false);
	assert.equal(errors.length, 9);
	assert.equal(drawing.sort, 0);
});

test('only sort-only internal maintenance may update a locked member', () => {
	const scene = new Scene(tree(layer('a', { locked: true })), [new Drawing('d1', 'a')]);
	const drawing = scene.drawings.get('d1');
	assert.equal(onPreUpdateLayerDrawing(drawing, { _id: 'd1', sort: 12 }, { [LAYER_OPERATION]: true }), undefined);
	assert.equal(onPreUpdateLayerDrawing(drawing, { sort: 12, text: 'Not allowed' }, { [LAYER_OPERATION]: true }), false);
	assert.equal(onPreUpdateLayerDrawing(drawing, { 'flags.foundryshop.layerId': null }, { [LAYER_OPERATION]: true }), false);
});

test('direct membership updates into a locked subtree are blocked in dotted and nested forms', () => {
	const scene = new Scene(tree(layer('g', { kind: 'group', locked: true }), layer('a', { parentId: 'g' })),
		[new Drawing('d1', null)]);
	for (const changes of [{ 'flags.foundryshop.layerId': 'a' },
		{ flags: { foundryshop: { layerId: 'a' } } }, { 'flags.foundryshop': { layerId: 'a' } }]) {
		assert.equal(onPreUpdateLayerDrawing(scene.drawings.get('d1'), changes, {}), false);
	}
});

test('assignment and removal enforce inherited source and destination locks', async () => {
	const scene = new Scene(tree(layer('g', { kind: 'group', locked: true }), layer('a', { parentId: 'g' }), layer('b')),
		[new Drawing('locked', 'a'), new Drawing('free', 'b')]);
	await assert.rejects(assignDrawings(scene, ['locked'], 'b', 0), /Locked/);
	await assert.rejects(assignDrawings(scene, ['locked'], UNASSIGNED, 0), /Locked/);
	await assert.rejects(assignDrawings(scene, ['free'], 'a', 0), /Locked/);
	await assert.rejects(deleteLayerSubtree(scene, 'a', 'b', 0), /Locked/);
	await assert.rejects(deleteLayerSubtree(scene, 'b', 'a', 0), /InvalidDestination/);
	assert.equal(scene.embeddedWrites.length, 0);
	assert.equal(scene.writes.length, 0);
});

test('locking releases selected members without hiding artwork and control hook refuses reselection', async () => {
	const scene = canvas.scene = new Scene(tree(layer('g', { kind: 'group' }), layer('a', { parentId: 'g' })),
		[new Drawing('d1', 'a')]);
	const object = placeable(scene.drawings.get('d1'));
	object.controlled = true;
	object.renderFlags = { set: () => Hooks.callAll('refreshDrawing', object) };
	canvas.drawings.placeables = [object];
	await setLayerLocked(scene, 'g', true, 0);
	await new Promise(resolve => setTimeout(resolve, 50));
	assert.equal(object.controlled, false);
	assert.equal(object.visible, true);
	object.controlled = true;
	Hooks.callAll('controlDrawing', object, true);
	assert.equal(object.controlled, false);
	assert.equal(errors.length, 1);
	await setLayerLocked(scene, 'g', false, 1);
	object.controlled = true;
	Hooks.callAll('controlDrawing', object, true);
	assert.equal(object.controlled, true);
});

test('locked layers still support reorder, presentation changes and presets', async () => {
	const scene = new Scene(tree(layer('a', { locked: true }), layer('b')), [
		new Drawing('d1', 'a', 2048), new Drawing('d2', 'b', 1024),
	]);
	await capturePresentationPreset(scene, 'Hidden', 0);
	const id = readLayerTree(scene).presets[0].id;
	await reorderLayer(scene, 'a', 'b', 'after', 1);
	await setPlayerPresentation(scene, 'a', true, 2);
	await applyPresentationPreset(scene, id, 3);
	assert.equal(readLayerTree(scene).nodes.find(node => node.id === 'a').locked, true);
	assert.equal(readLayerTree(scene).nodes.find(node => node.id === 'a').playerAllowed, false);
	assert.equal(errors.length, 0);
	assert.equal(scene.drawings.size, 2);
});

test('reparenting recomputes inherited locks without mutating child gates or native locks', async () => {
	const scene = new Scene(tree(layer('g', { kind: 'group', locked: true }), layer('a'), layer('b')),
		[new Drawing('d1', 'a')]);
	await reorderLayer(scene, 'a', 'g', 'inside', 0);
	assert.equal(isDrawingLayerLocked(scene.drawings.get('d1')), true);
	assert.equal(readLayerTree(scene).nodes.find(node => node.id === 'a').locked, false);
	await reorderLayer(scene, 'a', null, 'root', 1);
	assert.equal(isDrawingLayerLocked(scene.drawings.get('d1')), false);
	assert.equal(scene.drawings.get('d1').locked, false);
});

test('lock commands reject stale revisions, invalid input, players and failed writes', async () => {
	const scene = new Scene(tree(layer('a')));
	await assert.rejects(setLayerLocked(scene, 'a', 'yes', 0), /InvalidState/);
	await setLayerLocked(scene, 'a', true, 0);
	await assert.rejects(setLayerLocked(scene, 'a', false, 0), /Changed/);
	game.user.isGM = false;
	await assert.rejects(setLayerLocked(scene, 'a', false, 1), /GMOnly/);
	game.user.isGM = true;
	scene.failUpdate = true;
	await assert.rejects(setLayerLocked(scene, 'a', false, 1), /Scene write failed/);
	assert.equal(readLayerTree(scene).nodes[0].locked, true);
	scene.failUpdate = false;
	scene.skipUpdate = true;
	await assert.rejects(setLayerLocked(scene, 'a', false, 1), /StateIncomplete/);
	assert.equal(readLayerTree(scene).nodes[0].locked, true);
});

test('GM panel distinguishes own and inherited locks and toggles only the selected gate', async () => {
	canvas.scene = new Scene(tree(layer('g', { kind: 'group', locked: true }), layer('a', { parentId: 'g' })));
	const panel = new LayerPanel();
	let context = await panel._prepareContext();
	assert.equal(context.rows[1].effectiveLocked, true);
	assert.equal(context.rows[1].locked, false);
	assert.match(context.rows[1].lockTitle, /InheritedLock/);
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'lock', id: 'a' } });
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'lock', id: 'g' } });
	context = await panel._prepareContext();
	assert.equal(context.rows[0].locked, false);
	assert.equal(context.rows[1].locked, true);
	assert.equal(context.rows[1].effectiveLocked, true);
	game.user.isGM = false;
	await LayerPanel.onAction.call(panel, {}, { dataset: { action: 'lock', id: 'a' } });
	assert.equal(readLayerTree().nodes[1].locked, true);
	assert.equal(errors.length, 1);
});

test('unmanaged Drawings and unlocked members retain native edit/delete behavior', () => {
	const scene = new Scene(tree(layer('a')), [new Drawing('native', null), new Drawing('managed', 'a')]);
	for (const drawing of scene.drawings.values()) {
		assert.equal(onPreUpdateLayerDrawing(drawing, { text: 'Allowed' }, {}), undefined);
		assert.equal(onPreDeleteLayerDrawing(drawing), undefined);
	}
	assert.equal(errors.length, 0);
});

test('native pre-update cancellation leaves persisted artwork unchanged in an embedded batch', async () => {
	const scene = new Scene(tree(layer('a', { locked: true }), layer('b')),
		[new Drawing('protected', 'a'), new Drawing('editable', 'b')]);
	const result = await scene.updateEmbeddedDocuments('Drawing', [
		{ _id: 'protected', text: 'Do not edit' }, { _id: 'editable', text: 'Allowed' },
	], {});
	assert.deepEqual(result.map(drawing => drawing.id), ['editable']);
	assert.equal(scene.drawings.get('protected').text, undefined);
	assert.equal(scene.drawings.get('editable').text, 'Allowed');
	assert.equal(errors.length, 1);
});

test('managed artwork with invalid layer state rejects edits/deletion rather than ignoring locks', () => {
	const scene = new Scene({ ...tree(layer('a')), version: 99 }, [new Drawing('d1', 'a')]);
	assert.equal(onPreUpdateLayerDrawing(scene.drawings.get('d1'), { text: 'Bad state' }, {}), false);
	assert.equal(onPreDeleteLayerDrawing(scene.drawings.get('d1')), false);
	assert.equal(errors.length, 2);
});
