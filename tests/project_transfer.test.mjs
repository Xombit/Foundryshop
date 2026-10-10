import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	exportDrawingProject, exportDrawingSubtree, exportDrawingSelection, prepareProjectImport, importDrawingProject, discardInterruptedProjectImport, commitDrawingStamp,
} from '../scripts/layers/project_transfer_service.js';
import {
	PROJECT_FORMAT, canonicalJson, validateProjectPackage, parseProjectPackage, PROJECT_LIMITS,
} from '../scripts/layers/project_package.js';
import {
	initLayerManager, teardownLayerManager, readLayerTree, applyDrawingVisibility, PROJECT_IMPORT,
} from '../scripts/layers/layer_manager.js';
import { applyPresentationPreset } from '../scripts/layers/presentation_service.js';
import { starterProjects } from '../scripts/starter_projects.js';
import { downloadDrawingProject, promptProjectExport, promptProjectImport, promptDiscardProjectImport } from '../scripts/layers/project_dialogs.js';

function node(id, overrides = {}) {
	return { id, name: id, kind: 'layer', parentId: null, playerAllowed: true, locked: false, defaults: {}, ...overrides };
}

function drawingData(id = 'sourceDrawing001', overrides = {}) {
	return {
		_id: id, name: '', author: 'oldGM', shape: { type: 'p', width: 50, height: 30, radius: 0, points: [0, 0, 20, 30, 50, 0] },
		x: 12, y: 24, elevation: 0, levels: ['sourceLevel001'], sort: 1024, rotation: 30, bezierFactor: 0.25,
		fillType: 0, fillColor: '#ffffff', fillAlpha: 0.5, strokeWidth: 4, strokeColor: '#123456', strokeAlpha: 1,
		texture: null, text: 'Quarry', fontFamily: 'Signika', fontSize: 48, textColor: '#abcdef', textAlpha: 1,
		hidden: false, locked: false, interface: false, flags: { foundryshop: { layerId: 'ink' } }, ...overrides,
	};
}

function patch(target, changes) {
	for (const [key, value] of Object.entries(changes)) {
		const parts = key.split('.');
		let parent = target;
		for (const part of parts.slice(0, -1)) parent = parent[part] ??= {};
		const field = parts.at(-1);
		if (field.startsWith('-=')) delete parent[field.slice(2)];
		else parent[field] = structuredClone(value);
	}
}

class Drawing {
	static metadata = { schemaVersion: '14.355' };
	constructor(data, { parent } = {}) {
		if (data.fontSize < 8 || data.fontSize > 256) throw new Error('Native font size validation');
		this.data = structuredClone(data);
		this.parent = parent;
		if (Drawing.alter) this.data.strokeWidth = 9;
	}
	get id() { return this.data._id; }
	get sort() { return this.data.sort; }
	get elevation() { return this.data.elevation; }
	get interface() { return this.data.interface; }
	get locked() { return this.data.locked; }
	get hidden() { return this.data.hidden; }
	getFlag(namespace, key) { return this.data.flags[namespace]?.[key]; }
	toObject() { return structuredClone(this.data); }
}

class Scene {
	constructor(drawings = [], tree = { version: 1, revision: 0, nodes: [], presets: [] }) {
		this.id = 'destination'; this.name = 'Quarry';
		this.flags = { foundryshop: { layers: structuredClone(tree) } };
		this.levels = new Map([['destLevel000001', { id: 'destLevel000001', name: 'Ground' }]]);
		this.drawings = new Map(drawings.map(data => [data._id, new Drawing(data, { parent: this })]));
		this.writes = []; this.created = []; this.deleted = [];
	}
	getFlag(namespace, key) { return this.flags[namespace]?.[key]; }
	async unsetFlag(namespace, key) {
		if (this.failJournalRemoval) throw new Error('Journal removal failed');
		delete this.flags[namespace][key];
	}
	async update(changes, options) {
		if (this.failStage && changes['flags.foundryshop.layers']?.nodes.length) throw new Error('Stage write failed');
		this.writes.push({ changes, options });
		patch(this, changes);
		Hooks.callAll('updateScene', this);
	}
	async createEmbeddedDocuments(type, data, options) {
		assert.equal(type, 'Drawing'); assert.equal(options.keepId, true);
		for (const source of data) {
			const drawing = new Drawing(source, { parent: this });
			if (!Hooks.call('preCreateDrawing', drawing, source, options, game.user.id)) continue;
			this.drawings.set(drawing.id, drawing);
			this.created.push(drawing.id);
			const object = { document: drawing, visible: true, shape: { visible: true }, text: { visible: true } };
			applyDrawingVisibility(object);
			assert.equal(object.visible, false, 'staging never renders on the GM or player canvas');
			if (this.failCreate) throw new Error('Interrupted creation');
			if (this.alterCreated) drawing.data.strokeWidth++;
		}
		if (this.onCreate) await this.onCreate();
		return [...this.drawings.values()];
	}
	async updateEmbeddedDocuments(type, changes, options) {
		if (this.failRelease) throw new Error('Release failed');
		for (const update of changes) {
			const drawing = this.drawings.get(update._id);
			if (!Hooks.call('preUpdateDrawing', drawing, update, options, game.user.id)) continue;
			patch(drawing.data, update);
		}
	}
	async deleteEmbeddedDocuments(type, ids, options) {
		if (this.failDelete) throw new Error('Cleanup deletion failed');
		for (const id of ids) {
			const drawing = this.drawings.get(id);
			if (!Hooks.call('preDeleteDrawing', drawing, options, game.user.id)) continue;
			this.deleted.push(id);
			this.drawings.delete(id);
		}
	}
}

function stampSources(token) {
	return [drawingData('stampDrawing001', { author: 'importingGM', levels: ['destLevel000001'],
		flags: { foundryshop: { layerId: 'ink', importStaging: token, provenance: { importId: token } } } })];
}

test('stamp transaction stages and verifies artwork without changing layer metadata or existing Drawings', async () => {
	const scene = new Scene([drawingData('existing000001')], { version: 1, revision: 8, nodes: [node('ink')], presets: [] });
	const original = scene.drawings.get('existing000001').toObject(), tree = structuredClone(readLayerTree(scene));
	await commitDrawingStamp(scene, async token => stampSources(token));
	assert.equal(scene.drawings.size, 2);
	assert.deepEqual(scene.drawings.get('existing000001').toObject(), original);
	assert.deepEqual(readLayerTree(scene), tree);
	assert.equal(scene.writes.some(write => Object.hasOwn(write.changes, 'flags.foundryshop.layers')), false);
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
	assert.equal(scene.drawings.get('stampDrawing001').getFlag('foundryshop', 'importStaging'), undefined);
});

test('stamp transaction compensates partial creation and retains journal when cleanup is blocked', async () => {
	const scene = new Scene([], { version: 1, revision: 2, nodes: [node('ink')], presets: [] });
	scene.failCreate = true;
	await assert.rejects(commitDrawingStamp(scene, async token => stampSources(token)), /own changes were removed/);
	assert.equal(scene.drawings.size, 0);
	assert.equal(readLayerTree(scene).revision, 2);
	scene.failDelete = true;
	await assert.rejects(commitDrawingStamp(scene, async token => stampSources(token)), /journal is retained/);
	assert.ok(scene.getFlag('foundryshop', 'projectImportJournal'));
	scene.failDelete = false;
	await discardInterruptedProjectImport(scene);
	assert.equal(scene.drawings.size, 0);
});

test('stamp transaction rejects a changed destination before releasing staged artwork', async () => {
	const scene = new Scene([], { version: 1, revision: 2, nodes: [node('ink')], presets: [] });
	let current = true;
	scene.onCreate = () => { current = false; };
	await assert.rejects(commitDrawingStamp(scene, async token => stampSources(token), { isCurrent: () => current }), /destination changed|Destination changed/);
	assert.equal(scene.drawings.size, 0);
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
});

test('image stamp marker and asset path round-trip through strict project JSON without raster bytes', async () => {
	const source = new Scene([drawingData('sourceImage0001', {
		shape: { type: 'r', width: 100, height: 60, points: [], radius: 0 },
		texture: 'artwork/stamp.webp', flags: { foundryshop: { imageStamp: 1 } }, text: '',
	})]);
	const project = exportDrawingProject(source);
	assert.equal(project.drawings[0].data.flags.foundryshop.imageStamp, 1);
	assert.deepEqual(project.dependencies.assets, ['artwork/stamp.webp']);
	const target = new Scene();
	await importDrawingProject(target, project, { levelId: 'destLevel000001' });
	const result = [...target.drawings.values()][0];
	assert.equal(result.getFlag('foundryshop', 'imageStamp'), 1);
	assert.equal(result.toObject().texture, 'artwork/stamp.webp');
	project.drawings[0].data.flags.foundryshop.imageStamp = 2;
	assert.throws(() => validateProjectPackage(project), /Invalid image stamp/);
});

let counter, hooks;
beforeEach(() => {
	counter = 0; hooks = new Map(); Drawing.alter = false;
	globalThis.foundry = { utils: { randomID: () => `fresh${String(++counter).padStart(11, '0')}` } };
	foundry.utils.fetchWithTimeout = async () => ({ ok: true, status: 200, headers: { get: () => 'image/webp' } });
	foundry.applications = { settings: { menus: { FontConfig: { getAvailableFonts: () => ['Signika', 'Arial'] } } } };
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.getDocumentClass = () => Drawing;
	globalThis.game = {
		version: '14.368', user: { id: 'importingGM', isGM: true },
		modules: new Map([['extension', { active: true }]]),
		i18n: { localize: key => key, format: (key, { message }) => message ?? key },
		settings: { register() {}, get: () => ({ version: 1, scenes: {} }) },
	};
	globalThis.ui = { notifications: { error() {} } };
	globalThis.canvas = { ready: true, drawings: { placeables: [] } };
	globalThis.Hooks = {
		on(name, fn) { const id = hooks.size + 1; hooks.set(id, { name, fn }); return id; },
		off(name, id) { hooks.delete(id); },
		callAll(name, ...args) { for (const hook of hooks.values()) if (hook.name === name) hook.fn(...args); },
		call(name, ...args) { for (const hook of hooks.values()) if (hook.name === name && hook.fn(...args) === false) return false; return true; },
	};
	initLayerManager();
});
afterEach(() => teardownLayerManager());

function source() {
	return new Scene([drawingData(), drawingData('unassigned000001', {
		sort: 2000, locked: true, hidden: true, flags: { extension: { value: 'preserved' } },
	})], {
		version: 1, revision: 7, nodes: [node('location', { kind: 'group' }), node('ink', {
			parentId: 'location', locked: true, defaults: { strokeWidth: 4 },
		})],
		presets: [{ id: 'preset', name: 'Location', entries: [
			{ nodeId: 'location', playerAllowed: true }, { nodeId: 'ink', playerAllowed: true },
		] }],
	});
}

const importOptions = () => ({ levelId: 'destLevel000001', expectedRevision: 0 });

test('complete starter projects import empty and additively with fresh IDs, hidden wrappers and retained styling', async () => {
	foundry.applications.settings.menus.FontConfig.getAvailableFonts = () => ['Signika', 'Amiri', 'Modesto Condensed'];
	for (const { project } of starterProjects()) {
		const destination = new Scene();
		const result = await importDrawingProject(destination, project, importOptions());
		assert.equal(destination.drawings.size, project.drawings.length);
		assert.equal(result.tree.nodes[0].playerAllowed, false);
		assert.equal(result.tree.presets.length, 4);
		const before = [...destination.drawings.values()].map(drawing => drawing.toObject());
		const baseline = structuredClone(readLayerTree(destination));
		const second = await importDrawingProject(destination, project, {
			...importOptions(), mode: 'additive', expectedRevision: baseline.revision, dx: 1500, dy: 0,
		});
		assert.equal(destination.drawings.size, project.drawings.length * 2);
		assert.equal(second.tree.nodes[0].playerAllowed, false);
		for (const original of before) assert.deepEqual(destination.drawings.get(original._id).toObject(), original);
		assert.equal(new Set([...destination.drawings.keys()]).size, destination.drawings.size);
		for (const [index, source] of project.drawings.entries()) {
			const data = destination.drawings.get(second.data[index]._id).toObject();
			assert.equal(data.x, source.data.x + 1500);
			assert.equal(data.texture, source.data.texture);
			assert.equal(data.flags.foundryshop.materialRepeat, source.data.flags.foundryshop?.materialRepeat);
			assert.equal(data.text, source.data.text);
			assert.equal(data.fontFamily, source.data.fontFamily);
			assert.equal(data.author, game.user.id);
			assert.deepEqual(data.levels, ['destLevel000001']);
			assert.notEqual(data._id, source.id);
		}
		assert.equal(destination.getFlag('foundryshop', 'projectImportJournal'), undefined);
	}
});

test('full export includes canonical geometry, defaults, native fields, presets and inventory but no author or GM state', () => {
	const scene = source();
	const project = exportDrawingProject(scene);
	assert.equal(project.format, PROJECT_FORMAT);
	assert.equal(project.tree.presets[0].name, 'Location');
	assert.deepEqual(project.tree.nodes[1].defaults, { strokeWidth: 4 });
	assert.equal(project.drawings[1].layerId, null);
	assert.equal(project.drawings[1].data.locked, true);
	assert.equal(project.drawings[1].data.hidden, true);
	assert.equal(project.drawings[0].data.author, undefined);
	assert.equal(project.drawings[0].data._id, undefined);
	assert.equal(project.drawings[0].data.flags.foundryshop, undefined);
	assert.deepEqual(project.dependencies, { assets: [], fonts: ['Signika'], modules: ['extension'] });
	assert.ok(project.bounds.width >= 50);
	assert.deepEqual(parseProjectPackage(JSON.stringify(project)), project);
	assert.equal(scene.writes.length, 0);
});

test('unset native Drawing name and text export as empty strings and round-trip without changing source artwork', async () => {
	const scene = source();
	const drawing = scene.drawings.get('sourceDrawing001');
	drawing.data.name = undefined;
	drawing.data.text = undefined;
	const before = drawing.toObject();
	const project = exportDrawingProject(scene);
	assert.equal(project.drawings[0].data.name, '');
	assert.equal(project.drawings[0].data.text, '');
	assert.deepEqual(parseProjectPackage(JSON.stringify(project)), project);
	assert.deepEqual(drawing.toObject(), before);
	assert.equal(scene.writes.length, 0);
	const destination = new Scene();
	const result = await importDrawingProject(destination, project, importOptions());
	const imported = destination.drawings.get(result.data[0]._id).toObject();
	assert.equal(imported.name, '');
	assert.equal(imported.text, '');
});

test('optional native string normalization does not discard invalid values or undefined module metadata', () => {
	for (const field of ['name', 'text', 'metadata']) {
		const scene = source();
		const drawing = scene.drawings.get('sourceDrawing001');
		if (field === 'metadata') drawing.data.flags.extension = { value: undefined };
		else drawing.data[field] = null;
		assert.throws(() => exportDrawingProject(scene), /Foundryshop JSON:/);
		assert.equal(scene.writes.length, 0);
	}
});

test('empty-Scene import remaps every ID/author/Level and round-trips supported Drawing data', async () => {
	const project = exportDrawingProject(source());
	const destination = new Scene();
	const result = await importDrawingProject(destination, project, { ...importOptions(), dx: 100, dy: -20 });
	assert.equal(destination.drawings.size, 2);
	assert.equal(destination.flags.foundryshop.projectImportJournal, undefined);
	assert.equal(readLayerTree(destination).nodes[0].kind, 'group');
	assert.equal(readLayerTree(destination).nodes[0].playerAllowed, false);
	assert.equal(readLayerTree(destination).nodes.at(-1).name, 'Imported Unassigned');
	for (const [index, document] of [...destination.drawings.values()].entries()) {
		const actual = document.toObject(), expected = structuredClone(project.drawings[index].data);
		assert.notEqual(actual._id, project.drawings[index].id);
		assert.equal(actual.author, 'importingGM');
		assert.deepEqual(actual.levels, ['destLevel000001']);
		assert.equal(actual.flags.foundryshop.importStaging, undefined);
		delete actual._id; delete actual.author;
		actual.x -= 100; actual.y += 20;
		actual.levels = expected.levels;
		actual.sort = expected.sort;
		delete actual.flags.foundryshop;
		assert.equal(canonicalJson(actual), canonicalJson(expected));
		assert.equal(document.locked, expected.locked);
		assert.equal(document.hidden, expected.hidden);
	}
	assert.equal(readLayerTree(destination).nodes.find(node => node.name === 'ink').locked, true);
	game.user.isGM = false;
	for (const document of destination.drawings.values()) {
		const object = { document, visible: true, shape: { visible: true } };
		applyDrawingVisibility(object);
		assert.equal(object.visible, false);
	}
	game.user.isGM = true;
	await applyPresentationPreset(destination, result.presentationId, 1);
	assert.equal(readLayerTree(destination).nodes[0].playerAllowed, true);
	assert.equal(readLayerTree(destination).nodes.find(node => node.name === 'ink').playerAllowed, true);
	assert.equal(destination.drawings.values().next().value.locked, false);
});

test('export rejects unresolved membership, incomplete presets and unsupported recovery/metadata', () => {
	for (const variant of ['membership', 'preset', 'recovery', 'drawingMetadata', 'unknownField']) {
		const scene = source();
		if (variant === 'membership') scene.drawings.values().next().value.data.flags.foundryshop.layerId = 'missing';
		if (variant === 'preset') scene.flags.foundryshop.layers.presets[0].entries.push({ nodeId: 'missing', playerAllowed: false });
		if (variant === 'recovery') scene.flags.foundryshop.recovery = {};
		if (variant === 'drawingMetadata') scene.drawings.values().next().value.data.flags.foundryshop.flatten = {};
		if (variant === 'unknownField') scene.drawings.values().next().value.data.system = {};
		assert.throws(() => exportDrawingProject(scene));
	}
});

test('Drawing-only exports refuse optimization journals rather than silently dropping baked outputs/recovery', () => {
	const scene = source(), drawingId = scene.drawings.values().next().value.id;
	const nodeId = scene.flags.foundryshop.layers.nodes[0].id;
	for (const journal of [{ version: 1, revision: 0, entries: [] }, { malformed: true }]) {
		scene.flags.foundryshop.optimizationJournal = journal;
		assert.throws(() => exportDrawingProject(scene), /portable baked-output/);
		assert.throws(() => exportDrawingSubtree(scene, nodeId), /portable baked-output/);
		assert.throws(() => exportDrawingSelection(scene, [drawingId]), /portable baked-output/);
	}
});

test('package validation rejects malformed formats, fields, geometry, references and unsafe metadata', () => {
	const project = exportDrawingProject(source());
	const mutations = [
		p => p.version = 2, p => p.source.foundry = '13.0', p => p.scope = 'selection',
		p => p.coordinateSpace = 'screen', p => p.drawings.push(p.drawings[0]),
		p => p.drawings[0].data.x = Infinity, p => p.drawings[0].data.x = 10000001,
		p => p.drawings[0].data.shape.points.push(1),
		p => p.drawings[0].data.shape.points[0] = '1',
		p => p.drawings[0].data.hidden = 'false', p => p.drawings[0].data.author = 'oldGM',
		p => p.recovery.push({}), p => p.tree.nodes[0].unknown = true,
		p => p.drawings[0].data.shape.unknown = 1, p => p.source.credentials = 'not allowed',
		p => p.drawings[0].data.flags = JSON.parse('{"__proto__":{"polluted":true}}'),
		p => p.drawings[0].data.flags.bad = new Date(),
	];
	for (const mutate of mutations) {
		const invalid = structuredClone(project); mutate(invalid);
		assert.throws(() => validateProjectPackage(invalid));
	}
	assert.throws(() => parseProjectPackage('{'));
	assert.throws(() => parseProjectPackage(' '.repeat(PROJECT_LIMITS.bytes + 1)), /20 MiB/);
});

test('multiple source Levels and mixed managed render constraints are rejected before writes', () => {
	const project = exportDrawingProject(source());
	project.drawings[1].data.levels = ['anotherLevel'];
	assert.equal(validateProjectPackage(project).drawings.length, 2);
	assert.throws(() => prepareProjectImport(new Scene(), project, importOptions()), /Choose one source Level/);
	const other = exportDrawingProject(source());
	other.drawings[1].data.interface = true;
	assert.throws(() => prepareProjectImport(new Scene(), other, importOptions()), /MixedRenderOrder/);
});

test('active-Level exports filter artwork without dropping layer/preset context or altering sources', () => {
	const scene = source(), before = [...scene.drawings.values()].map(d => d.toObject());
	scene.levels.set('sourceLevel001', { id: 'sourceLevel001' });
	scene.drawings.get('unassigned000001').data.levels = ['upperLevel'];
	scene.levels.set('upperLevel', { id: 'upperLevel' });
	const all = exportDrawingProject(scene), scoped = exportDrawingProject(scene, { levelId: 'sourceLevel001' });
	assert.equal(all.drawings.length, 2);
	assert.deepEqual(scoped.drawings.map(d => d.id), ['sourceDrawing001']);
	assert.deepEqual(scoped.tree, all.tree);
	assert.equal(exportDrawingSubtree(scene, 'ink', { levelId: 'upperLevel' }).drawings.length, 0);
	assert.deepEqual(exportDrawingSelection(scene, [...scene.drawings.keys()], { levelId: 'upperLevel' }).drawings.map(d => d.id),
		['unassigned000001']);
	assert.throws(() => exportDrawingProject(scene, { levelId: 'missing' }), /existing export Level/);
	assert.deepEqual(scene.drawings.get('sourceDrawing001').toObject(), before[0]);
	assert.equal(scene.writes.length, 0);
});

test('multi-Level single import selects one floor and retains original numeric elevation', async () => {
	const project = exportDrawingProject(source());
	project.drawings[1].data.levels = ['upperLevel']; project.drawings[1].data.elevation = 20;
	const scene = new Scene();
	const result = await importDrawingProject(scene, project, { ...importOptions(), sourceLevelId: 'upperLevel' });
	assert.equal(result.data.length, 1);
	assert.equal(result.data[0].elevation, 20);
	assert.deepEqual(result.data[0].levels, ['destLevel000001']);
	assert.equal(result.data[0].flags.foundryshop.provenance.sourceDrawingId, project.drawings[1].id);
	assert.equal(result.tree.nodes[0].playerAllowed, false);
	assert.equal(scene.drawings.size, 1);
	assert.throws(() => prepareProjectImport(new Scene(), project, { ...importOptions(), sourceLevelId: 'missing' }),
		/existing package source Level/);
});

test('explicit combine preserves layer hierarchy then elevation/sort/stable tie order without touching existing artwork', async () => {
	const sourceScene = new Scene([
		drawingData('high', { elevation: 30, sort: 1024, levels: ['upperLevel'] }),
		drawingData('low', { elevation: 0, sort: 2048 }),
		drawingData('tie', { elevation: 30, sort: 1024, levels: ['upperLevel'] }),
		drawingData('higherSort', { elevation: 30, sort: 4096, levels: ['upperLevel'] }),
	], { version: 1, revision: 0, nodes: [node('ink')], presets: [] });
	const project = exportDrawingProject(sourceScene);
	const existing = drawingData('existing', { flags: { foundryshop: { layerId: 'existingInk' } },
		levels: ['destLevel000001'], elevation: 7, sort: 100 });
	const destination = new Scene([existing], { version: 1, revision: 0, nodes: [node('existingInk')], presets: [] });
	destination.levels.get('destLevel000001').elevation = { bottom: 7, top: 50 };
	const result = await importDrawingProject(destination, project, { ...importOptions(), levelMode: 'combine', mode: 'additive' });
	assert.deepEqual(result.data.slice().sort((a, b) => a.sort - b.sort).map(d => d.flags.foundryshop.provenance.sourceDrawingId),
		['low', 'high', 'tie', 'higherSort']);
	assert.ok(result.data.every(d => d.elevation === 7 && d.sort > existing.sort));
	assert.deepEqual(destination.drawings.get(existing._id).toObject(), existing);
	assert.equal(result.tree.nodes[0].playerAllowed, false);
	assert.deepEqual(destination.levels.get('destLevel000001').elevation, { bottom: 7, top: 50 });
	assert.equal(destination.getFlag('foundryshop', 'projectImportJournal'), undefined);
});

test('combine requires finite native ground and never accepts implicit or conflicting Level choices', () => {
	const project = exportDrawingProject(source()), destination = new Scene();
	assert.throws(() => prepareProjectImport(destination, project, { ...importOptions(), levelMode: 'combine' }), /finite destination/);
	destination.levels.get('destLevel000001').elevation = { bottom: 0 };
	assert.throws(() => prepareProjectImport(destination, project, { ...importOptions(), levelMode: 'combine', sourceLevelId: 'sourceLevel001' }),
		/cannot also select/);
	assert.throws(() => prepareProjectImport(destination, project, { ...importOptions(), levelMode: 'guess' }), /explicitly combine/);
	assert.equal(destination.writes.length, 0);
});

test('combine ground changes after staged creation compensate only imported artwork', async () => {
	const destination = new Scene(), project = exportDrawingProject(source());
	destination.levels.get('destLevel000001').elevation = { bottom: 0 };
	destination.onCreate = async () => { destination.levels.get('destLevel000001').elevation.bottom = 10; };
	await assert.rejects(importDrawingProject(destination, project, { ...importOptions(), levelMode: 'combine' }),
		/own changes were removed/);
	assert.equal(destination.drawings.size, 0);
	assert.equal(readLayerTree(destination).revision, 0);
	assert.equal(destination.levels.get('destLevel000001').elevation.bottom, 10);
});

test('combine honors drawing-layer hierarchy before source elevation ordering', () => {
	const scene = new Scene([
		drawingData('upperLayerLow', { elevation: 0, flags: { foundryshop: { layerId: 'top' } } }),
		drawingData('lowerLayerHigh', { elevation: 100, levels: ['upperLevel'], flags: { foundryshop: { layerId: 'bottom' } } }),
	], { version: 1, revision: 0, nodes: [node('top'), node('bottom')], presets: [] });
	const destination = new Scene();
	destination.levels.get('destLevel000001').elevation = { bottom: 0 };
	const plan = prepareProjectImport(destination, exportDrawingProject(scene), { ...importOptions(), levelMode: 'combine' });
	assert.deepEqual(plan.data.slice().sort((a, b) => a.sort - b.sort).map(d => d.flags.foundryshop.provenance.sourceDrawingId),
		['lowerLayerHigh', 'upperLayerLow']);
	assert.equal(destination.writes.length, 0);
});

test('multi-Level dialog requires explicit source selection or combine and exposes the composition warning', async () => {
	const project = exportDrawingProject(source());
	project.drawings[1].data.levels = ['upperLevel'];
	for (const choice of ['upperLevel', ':combine', null]) {
		const destination = new Scene(), dialogs = dialogEnvironment(destination);
		destination.levels.get('destLevel000001').elevation = { bottom: 9 };
		let prompts = 0, confirmations = 0;
		dialogs.prompt = async config => {
			if (++prompts === 1) return { dx: 0, dy: 0, assets: {}, fonts: {} };
			assert.ok(config.content.children.some(child => child.textContent === 'FOUNDRYSHOP.Project.CombineLevelsWarning'));
			return choice;
		};
		dialogs.confirm = async config => {
			confirmations++;
			assert.ok(config.content.children.some(child => child.textContent === 'FOUNDRYSHOP.Project.LevelImportCounts'));
			return true;
		};
		await promptProjectImport(destination, 0, project);
		assert.equal(prompts, 2);
		assert.equal(confirmations, choice === null ? 0 : 1);
		assert.equal(destination.drawings.size, choice === null ? 0 : choice === ':combine' ? 2 : 1);
		if (choice === ':combine') assert.ok([...destination.drawings.values()].every(d => d.elevation === 9));
	}
});

test('export dialog defaults to active Level and explicitly allows full-project export', async () => {
	const scene = source(), dialogs = dialogEnvironment(scene);
	scene.drawings.get('unassigned000001').data.levels = ['upperLevel'];
	scene.levels.set('upperLevel', { id: 'upperLevel' });
	let saved;
	foundry.utils.saveDataToFile = text => { saved = parseProjectPackage(text); };
	for (const choice of ['active', 'all']) {
		dialogs.prompt = async config => {
			const field = config.content.children.find(child => child.children?.some(e => e.attributes?.name === 'levelScope'));
			assert.deepEqual(field.children[0].children.map(option => option.attributes.value), ['active', 'all']);
			return config.ok.callback(null, { form: { elements: {
				nodeId: { value: '' }, levelScope: { value: choice },
				thumbnail: { checked: false }, acknowledgeExternal: { checked: false },
			} } });
		};
		await promptProjectExport(scene, 7);
		assert.equal(saved.drawings.length, choice === 'active' ? 1 : 2);
	}
	assert.equal(scene.writes.length, 0);
});

test('import rejects nonempty projects, missing Levels, modules and invalid translation/mappings', () => {
	const project = exportDrawingProject(source());
	assert.throws(() => prepareProjectImport(source(), project, importOptions()), /empty Drawing project/);
	for (const options of [
		{ levelId: 'missing' }, { ...importOptions(), dx: NaN },
		{ ...importOptions(), assets: [] }, { ...importOptions(), assets: { unknown: 'replacement.webp' } },
	]) assert.throws(() => prepareProjectImport(new Scene(), project, options));
	game.modules.clear();
	assert.throws(() => prepareProjectImport(new Scene(), project, importOptions()), /extension/);
	game.user.isGM = false;
	assert.throws(() => exportDrawingProject(source()), /requires a GM/);
	assert.throws(() => prepareProjectImport(new Scene(), project, importOptions()), /requires a GM/);
});

test('textures are inventoried and explicit mappings replace only matching references', () => {
	const scene = source();
	scene.drawings.values().next().value.data.texture = 'art/quarry.webp';
	const project = exportDrawingProject(scene);
	assert.deepEqual(project.dependencies.assets, ['art/quarry.webp']);
	const plan = prepareProjectImport(new Scene(), project, {
		...importOptions(), assets: { 'art/quarry.webp': 'shared/quarry.webp' },
	});
	assert.equal(plan.data[0].texture, 'shared/quarry.webp');
	assert.equal(project.drawings[0].data.texture, 'art/quarry.webp');
});

test('layer-default-only textures are inventoried, mapped and preserved independently of artwork', () => {
	const scene = source();
	scene.flags.foundryshop.layers.nodes.find(entry => entry.id === 'ink').defaults = { texture: 'art/floor.webp', fillType: 2 };
	const project = exportDrawingProject(scene);
	assert.deepEqual(project.dependencies.assets, ['art/floor.webp']);
	const plan = prepareProjectImport(new Scene(), project, {
		...importOptions(), assets: { 'art/floor.webp': 'shared/floor.webp' },
	});
	assert.equal(plan.tree.nodes.find(entry => entry.name === 'ink').defaults.texture, 'shared/floor.webp');
	assert.equal(project.tree.nodes.find(entry => entry.id === 'ink').defaults.texture, 'art/floor.webp');
	assert.equal(plan.data[0].texture, null);
});

test('material repeat metadata survives package remapping and refuses invalid or image-stamp combinations', () => {
	const scene = source();
	const drawing = scene.drawings.values().next().value;
	drawing.data.texture = 'art/floor.png';
	drawing.data.flags.foundryshop.materialRepeat = 125;
	const project = exportDrawingProject(scene);
	const plan = prepareProjectImport(new Scene(), project, {
		...importOptions(), assets: { 'art/floor.png': 'shared/floor.png' },
	});
	assert.equal(plan.data[0].flags.foundryshop.materialRepeat, 125);
	assert.equal(plan.data[0].texture, 'shared/floor.png');
	for (const repeat of [0, -1, '125', 10000001]) {
		const invalid = structuredClone(project);
		invalid.drawings[0].data.flags.foundryshop.materialRepeat = repeat;
		assert.throws(() => validateProjectPackage(invalid), /Invalid material/);
	}
	const image = structuredClone(project);
	image.drawings[0].data.shape.type = 'r';
	image.drawings[0].data.flags.foundryshop.imageStamp = 1;
	assert.throws(() => validateProjectPackage(image), /material metadata/);
});

test('native field validation and normalization changes are rejected before persistence', () => {
	const project = exportDrawingProject(source());
	project.drawings[0].data.fontSize = 999;
	assert.throws(() => prepareProjectImport(new Scene(), project, importOptions()), /Native font/);
	project.drawings[0].data.fontSize = 48;
	Drawing.alter = true;
	assert.throws(() => prepareProjectImport(new Scene(), project, importOptions()), /would alter/);
});

test('partial creation, staging and verification failures compensate only their own changes', async () => {
	const project = exportDrawingProject(source());
	for (const failure of ['failCreate', 'failStage', 'alterCreated', 'failRelease']) {
		const scene = new Scene(); scene[failure] = true;
		await assert.rejects(importDrawingProject(scene, project, importOptions()), /own changes were removed/);
		assert.equal(scene.drawings.size, 0);
		assert.deepEqual(readLayerTree(scene), { version: 1, revision: 0, nodes: [], presets: [] });
		assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
	}
});

test('failed cleanup retains a durable journal and can be explicitly discarded later', async () => {
	const scene = new Scene(); scene.failCreate = true; scene.failDelete = true;
	await assert.rejects(importDrawingProject(scene, exportDrawingProject(source()), importOptions()), /Cleanup incomplete/);
	assert.equal(scene.drawings.size, 1);
	assert.ok(scene.getFlag('foundryshop', 'projectImportJournal'));
	assert.throws(() => exportDrawingProject(scene), /unfinished project import/);
	scene.failDelete = false;
	await discardInterruptedProjectImport(scene);
	assert.equal(scene.drawings.size, 0);
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
});

test('unrelated new artwork or tree edits stop compensation instead of deleting others work', async () => {
	for (const variant of ['drawing', 'tree']) {
		const scene = new Scene();
		scene.onCreate = async () => {
			if (variant === 'drawing') scene.drawings.set('unrelated', new Drawing(drawingData('unrelated'), { parent: scene }));
			else { scene.flags.foundryshop.layers.nodes[0].name = 'Other GM edit'; Hooks.callAll('updateScene', scene); }
			throw new Error('Concurrent change');
		};
		await assert.rejects(importDrawingProject(scene, exportDrawingProject(source()), importOptions()), /cleanup refused|Cleanup incomplete/i);
		assert.ok(scene.getFlag('foundryshop', 'projectImportJournal'));
		if (variant === 'drawing') assert.ok(scene.drawings.has('unrelated'));
		assert.equal(scene.deleted.length, 0);
	}
});

test('stale expected revision prevents import and separate imports generate different IDs', async () => {
	const project = exportDrawingProject(source());
	const scene = new Scene();
	await assert.rejects(importDrawingProject(scene, project, { ...importOptions(), expectedRevision: 5 }), /changed/);
	assert.equal(scene.writes.length, 0);
	const first = await importDrawingProject(scene, project, importOptions());
	const second = await importDrawingProject(new Scene(), project, importOptions());
	assert.notEqual(first.data[0]._id, second.data[0]._id);
	await assert.rejects(importDrawingProject(scene, project, { ...importOptions(), expectedRevision: 1 }), /empty Drawing project/);
});

test('import staging bypass is restricted to matching journal IDs and only staging-release updates', () => {
	const scene = source();
	const drawing = scene.drawings.values().next().value;
	drawing.data.flags.foundryshop.importStaging = 'token';
	scene.flags.foundryshop.projectImportJournal = { token: 'token', ids: [drawing.id] };
	assert.equal(Hooks.call('preUpdateDrawing', drawing, { text: 'Edit' }, { [PROJECT_IMPORT]: 'token' }), false);
	assert.equal(Hooks.call('preCreateDrawing', drawing, drawing.toObject(), { [PROJECT_IMPORT]: 'wrong' }, 'importingGM'), false);
	assert.equal(Hooks.call('preUpdateDrawing', drawing, {
		'flags.foundryshop.-=importStaging': null,
	}, { [PROJECT_IMPORT]: 'token' }), true);
});

function dialogEnvironment(scene) {
	const dialogs = { prompt: async () => null, confirm: async () => false };
	foundry.applications.api = { DialogV2: dialogs };
	canvas.scene = scene; canvas.level = scene.levels.values().next().value;
	if (scene.drawings.size && [...scene.drawings.values()].every(d => d.toObject().levels.includes('sourceLevel001'))) {
		scene.levels.set('sourceLevel001', { id: 'sourceLevel001', name: 'Source ground' });
		canvas.level = scene.levels.get('sourceLevel001');
	}
	ui.notifications.info = () => {};
	globalThis.document = { createElement: tag => ({
		tagName: tag.toUpperCase(), attributes: {}, children: [], textContent: '',
		setAttribute(key, value) { this.attributes[key] = value; },
		append(child) { this.children.push(child); },
	}) };
	return dialogs;
}

test('download uses native file helper, safe filename, exact package shape and no scene writes', () => {
	let saved;
	foundry.utils.saveDataToFile = (...args) => saved = args;
	const scene = source(); scene.name = '../<Quarry>';
	downloadDrawingProject(scene);
	assert.equal(saved[1], 'application/json');
	assert.match(saved[2], /^[a-zA-Z0-9_-]+\.foundryshop\.json$/);
	assert.equal(parseProjectPackage(saved[0]).drawings.length, 2);
	assert.equal(scene.writes.length, 0);
});

test('export confirmation warns about withheld artwork and cancellation does not download', async () => {
	let saved = false;
	foundry.utils.saveDataToFile = () => saved = true;
	const scene = source(), dialogs = dialogEnvironment(scene);
	dialogs.prompt = async config => {
		assert.equal(config.content.tagName, 'DIV');
		assert.deepEqual(config.content.attributes, {});
		assert.match(config.content.children[0].textContent, /ExportHint/);
		const options = config.ok.callback(null, { form: { elements: {
			nodeId: { value: '' },
			thumbnail: { checked: true }, acknowledgeExternal: { checked: false },
		} } });
		assert.deepEqual(options, { nodeId: null, levelScope: 'active', thumbnail: true, acknowledgeExternal: false });
		return null;
	};
	await promptProjectExport(scene, 7);
	assert.equal(saved, false);
	dialogs.prompt = async () => ({ thumbnail: false, acknowledgeExternal: false });
	await promptProjectExport(scene, 7);
	assert.equal(saved, true);
});

test('thumbnail export failures require deliberate fallback and stale artwork never downloads', async () => {
	const scene = source(), dialogs = dialogEnvironment(scene);
	let saved = 0, fallback = 0;
	foundry.utils.saveDataToFile = () => saved++;
	dialogs.prompt = async () => ({ thumbnail: true, acknowledgeExternal: false });
	dialogs.confirm = async config => {
		assert.match(config.content.children[0].textContent, /ThumbnailFailed.*Missing texture/);
		fallback++;
		return false;
	};
	const fail = async (entries, options) => {
		assert.equal(options.width, 256); assert.equal(options.height, 192);
		assert.equal(options.acknowledgeExternal, false);
		assert.equal(entries.length, 2);
		throw new Error('Missing texture');
	};
	await promptProjectExport(scene, 7, fail);
	assert.equal(saved, 0); assert.equal(fallback, 1);
	dialogs.confirm = async () => true;
	await promptProjectExport(scene, 7, fail);
	assert.equal(saved, 1);
	await assert.rejects(promptProjectExport(scene, 7, async () => {
		scene.drawings.values().next().value.data.text = 'Changed while rendering';
		throw new Error('Cancelled');
	}), /Changed/);
	assert.equal(saved, 1);
});

test('successful thumbnail export embeds only preview metadata; import persists only authoritative artwork', async () => {
	const scene = source(), dialogs = dialogEnvironment(scene);
	const data = 'UklGRlwAAABXRUJQVlA4WAoAAAAQAAAAHwAAHwAAQUxQSA8AAAABBxAREQASwv/vekT/Uw8AVlA4ICYAAADQAgCdASogACAAPm00lkekIyIhKAgAgA2JaQAAPaOgAP77nMAAAA==';
	let saved, renders = 0;
	foundry.utils.saveDataToFile = text => saved = text;
	dialogs.prompt = async () => ({ thumbnail: true, acknowledgeExternal: true });
	await promptProjectExport(scene, 7, async (entries, options) => {
		renders++;
		assert.equal(entries.length, 2);
		assert.equal(options.acknowledgeExternal, true);
		return { src: `data:image/webp;base64,${data}`, width: 32, height: 32 };
	});
	assert.equal(renders, 1);
	const project = parseProjectPackage(saved);
	assert.equal(project.thumbnail.data, data);
	assert.equal(project.thumbnail.scope, 'full-artwork');
	const destination = new Scene();
	await importDrawingProject(destination, project, importOptions());
	assert.equal(destination.drawings.size, 2);
	assert.equal(destination.getFlag('foundryshop', 'thumbnail'), undefined);
	assert.equal(Object.hasOwn(exportDrawingProject(destination), 'thumbnail'), false);
	assert.deepEqual(exportDrawingProject(destination).drawings.map(entry => entry.data.shape),
		project.drawings.map(entry => entry.data.shape));
	assert.equal(scene.writes.length, 0);
	dialogs.prompt = async () => ({ thumbnail: false, acknowledgeExternal: false });
	await promptProjectExport(scene, 7, async () => { throw new Error('Should not render'); });
	assert.equal(Object.hasOwn(parseProjectPackage(saved), 'thumbnail'), false);
});

test('empty projects and all native shape types round-trip without changing geometry', async () => {
	const empty = exportDrawingProject(new Scene());
	const target = new Scene();
	await importDrawingProject(target, empty, importOptions());
	assert.equal(target.drawings.size, 0);
	assert.equal(readLayerTree(target).nodes.length, 1);
	for (const type of ['r', 'e', 'p', 'c']) {
		const scene = source();
		scene.drawings.values().next().value.data.shape.type = type;
		scene.drawings.values().next().value.data.shape.radius = 20;
		const project = exportDrawingProject(scene), destination = new Scene();
		await importDrawingProject(destination, project, importOptions());
		assert.deepEqual(destination.drawings.values().next().value.toObject().shape, project.drawings[0].data.shape);
	}
});

test('file prompt is an attribute-free DIV and enforces selection/size before dry run', async () => {
	const scene = new Scene(), dialogs = dialogEnvironment(scene);
	dialogs.prompt = async config => {
		assert.equal(config.content.tagName, 'DIV');
		assert.deepEqual(config.content.attributes, {});
		const callback = config.ok.callback;
		const form = { elements: { project: { files: [] } } };
		assert.throws(() => callback(null, { form }), /ChooseFile/);
		form.elements.project.files = [{ size: PROJECT_LIMITS.bytes + 1 }];
		assert.throws(() => callback(null, { form }), /FileTooLarge/);
		return null;
	};
	await promptProjectImport(scene, 0);
	assert.equal(scene.writes.length, 0);
});

test('dry run displays dependencies and cancellation creates no metadata or artwork', async () => {
	const scene = new Scene(), dialogs = dialogEnvironment(scene);
	const project = exportDrawingProject(source());
	dialogs.prompt = async () => ({
		file: { text: async () => JSON.stringify(project) }, dx: 0, dy: 0, assets: {},
	});

	dialogs.confirm = async config => {
		assert.equal(config.content.tagName, 'DIV');
		assert.deepEqual(config.content.attributes, {});
		const text = config.content.children.map(child => child.textContent).join('\n');
		assert.match(text, /Signika/);
		assert.match(text, /extension/);
		assert.match(text, /PresentationHint/);
		assert.match(text, /ConfirmResources/);
		assert.ok(config.content.children.some(child => 'data-project-preview' in child.attributes));
		assert.equal(typeof config.render, 'function');
		assert.equal(typeof config.close, 'function');
		return false;
	};
	await promptProjectImport(scene, 0);
	assert.equal(scene.writes.length, 0);
	assert.equal(scene.drawings.size, 0);
});

test('library-supplied projects reuse mode/resource review without a file input or automatic import', async () => {
	const scene = new Scene(), dialogs = dialogEnvironment(scene);
	const project = exportDrawingProject(source());
	dialogs.prompt = async config => {
		assert.equal(config.content.children.some(child => child.children.some(input => input.attributes.name === 'project')), false);
		const selected = config.ok.callback(null, { form: { elements: {
			mode: { value: 'additive' }, targetGroupId: { value: '' }, dx: { valueAsNumber: 0 }, dy: { valueAsNumber: 0 },
			assets: { value: '{}' }, fonts: { value: '{}' },
		} } });
		assert.equal(selected.file, null);
		return selected;
	};
	let reviewed = false;
	dialogs.confirm = async config => {
		reviewed = true;
		assert.equal(typeof config.render, 'function');
		return false;
	};
	await promptProjectImport(scene, 0, project);
	assert.equal(reviewed, true);
	assert.equal(scene.writes.length, 0);
	assert.equal(scene.drawings.size, 0);
});

test('subtree package retains ancestor locks/gates/defaults and scoped presets without sibling or Unassigned artwork', () => {
	const scene = source();
	scene.flags.foundryshop.layers.nodes.unshift(node('other'));
	scene.flags.foundryshop.layers.nodes[1].playerAllowed = false;
	scene.flags.foundryshop.layers.nodes[1].locked = true;
	scene.drawings.set('sibling', new Drawing(drawingData('sibling', {
		texture: 'maps/excluded.png', flags: { foundryshop: { layerId: 'other' } },
	}), { parent: scene }));
	const before = canonicalJson({ tree: scene.flags.foundryshop.layers, drawings: [...scene.drawings.values()].map(d => d.toObject()) });
	const project = exportDrawingSubtree(scene, 'ink');
	assert.equal(project.scope, 'subtree'); assert.equal(project.name, 'ink');
	assert.deepEqual(project.tree.nodes.map(node => node.id), ['location', 'ink']);
	assert.equal(project.tree.nodes[0].locked, true); assert.equal(project.tree.nodes[0].playerAllowed, false);
	assert.deepEqual(project.drawings.map(entry => entry.id), ['sourceDrawing001']);
	assert.deepEqual(project.dependencies.assets, []);
	assert.deepEqual(project.tree.presets[0].entries.map(entry => entry.nodeId), ['location', 'ink']);
	assert.deepEqual(parseProjectPackage(JSON.stringify(project)), project);
	assert.equal(canonicalJson({ tree: scene.flags.foundryshop.layers, drawings: [...scene.drawings.values()].map(d => d.toObject()) }), before);
	assert.throws(() => exportDrawingSubtree(scene, 'missing'));
});

test('selected export preserves only requested managed and Unassigned strokes with required ancestry', () => {
	const scene = source();
	scene.flags.foundryshop.layers.nodes.push(node('sibling'));
	scene.drawings.set('excluded', new Drawing(drawingData('excluded', {
		texture: 'maps/excluded.png', flags: { foundryshop: { layerId: 'ink' } },
	}), { parent: scene }));
	const before = canonicalJson({ tree: scene.flags.foundryshop.layers,
		drawings: [...scene.drawings.values()].map(d => d.toObject()) });
	const project = exportDrawingSelection(scene, ['unassigned000001', 'sourceDrawing001']);
	assert.deepEqual(project.drawings.map(d => d.id), ['sourceDrawing001', 'unassigned000001']);
	assert.deepEqual(project.tree.nodes.map(n => n.id), ['location', 'ink']);
	assert.deepEqual(project.tree.presets[0].entries.map(e => e.nodeId), ['location', 'ink']);
	assert.equal(project.drawings[1].layerId, null);
	assert.equal(project.drawings[1].data.hidden, true);
	assert.equal(project.drawings[1].data.locked, true);
	assert.deepEqual(project.drawings[1].data.flags.extension, { value: 'preserved' });
	assert.deepEqual(project.dependencies.assets, []);
	assert.deepEqual(parseProjectPackage(JSON.stringify(project)), project);
	assert.equal(canonicalJson({ tree: scene.flags.foundryshop.layers,
		drawings: [...scene.drawings.values()].map(d => d.toObject()) }), before);
	const unassigned = exportDrawingSelection(scene, ['unassigned000001']);
	assert.deepEqual(unassigned.tree.nodes, []);
	assert.deepEqual(unassigned.tree.presets, []);
	assert.equal(scene.writes.length, 0);
});

test('selected export refuses invalid identity, membership, journal, recovery and unsupported selected fields', () => {
	const scene = source();
	for (const ids of [[], ['missing'], ['sourceDrawing001', 'sourceDrawing001'], 'sourceDrawing001']) {
		assert.throws(() => exportDrawingSelection(scene, ids), /Select existing/);
	}
	scene.drawings.get('unassigned000001').data.unsupported = 'outside';
	assert.equal(exportDrawingSelection(scene, ['sourceDrawing001']).drawings.length, 1);
	assert.throws(() => exportDrawingSelection(scene, ['unassigned000001']), /unsupported fields/);
	scene.drawings.get('sourceDrawing001').data.flags.foundryshop.layerId = 'missing';
	assert.throws(() => exportDrawingSelection(scene, ['sourceDrawing001']), /membership/);
	scene.drawings.get('sourceDrawing001').data.flags.foundryshop.layerId = 'ink';
	scene.flags.foundryshop.projectImportJournal = {};
	assert.throws(() => exportDrawingSelection(scene, ['sourceDrawing001']), /unfinished/);
	delete scene.flags.foundryshop.projectImportJournal;
	scene.flags.foundryshop.recovery = {};
	assert.throws(() => exportDrawingSelection(scene, ['sourceDrawing001']), /Recovery/);
	delete scene.flags.foundryshop.recovery;
	game.user.isGM = false;
	assert.throws(() => exportDrawingSelection(scene, ['sourceDrawing001']), /GM/);
});

test('selected stroke transfer imports with offsets and fresh IDs while preserving both source and destination originals', async () => {
	const scene = source(), sourceBefore = [...scene.drawings.values()].map(d => d.toObject());
	const project = exportDrawingSelection(scene, ['sourceDrawing001', 'unassigned000001']);
	const destination = new Scene([drawingData('existing', { flags: {} })]);
	const before = destination.drawings.get('existing').toObject();
	const result = await importDrawingProject(destination, project, {
		...importOptions(), mode: 'additive', dx: -100, dy: 200,
	});
	assert.equal(destination.drawings.size, 3);
	assert.deepEqual(destination.drawings.get('existing').toObject(), before);
	assert.deepEqual([...scene.drawings.values()].map(d => d.toObject()), sourceBefore);
	for (const entry of project.drawings) {
		const imported = [...destination.drawings.values()].find(d => d.toObject().name === entry.data.name
			&& d.id !== 'existing' && d.toObject().hidden === entry.data.hidden);
		assert.ok(imported);
		const data = imported.toObject();
		assert.notEqual(data._id, entry.id);
		assert.equal(data.x, entry.data.x - 100);
		assert.equal(data.y, entry.data.y + 200);
		assert.deepEqual(data.shape, entry.data.shape);
		assert.equal(data.bezierFactor, entry.data.bezierFactor);
		assert.equal(data.strokeAlpha, entry.data.strokeAlpha);
		assert.deepEqual(data.levels, ['destLevel000001']);
	}
	assert.equal(result.tree.nodes[0].playerAllowed, false);
	assert.equal(scene.writes.length, 0);
});

test('selection export dialog offers selected scope and refuses selection changes before download', async () => {
	const scene = source(), dialogs = dialogEnvironment(scene);
	const selected = scene.drawings.get('sourceDrawing001');
	canvas.drawings.controlled = [{ id: selected.id, document: selected }];
	let saved;
	foundry.utils.saveDataToFile = text => { saved = parseProjectPackage(text); };
	dialogs.prompt = async config => {
		const field = config.content.children.find(child => child.children?.some(e => e.attributes?.name === 'nodeId'));
		assert.ok(field.children[0].children.some(option => option.attributes.value === ':selection'));
		return config.ok.callback(null, { form: { elements: {
			nodeId: { value: ':selection' }, thumbnail: { checked: false }, acknowledgeExternal: { checked: false },
		} } });
	};
	await promptProjectExport(scene, 7);
	assert.deepEqual(saved.drawings.map(d => d.id), [selected.id]);
	saved = null;
	dialogs.prompt = async () => {
		canvas.drawings.controlled = [];
		return { nodeId: ':selection', thumbnail: false };
	};
	await assert.rejects(promptProjectExport(scene, 7), /Changed/);
	assert.equal(saved, null);
});

test('selected export thumbnails contain only selected artwork and recheck selection after rendering', async () => {
	const scene = source(), dialogs = dialogEnvironment(scene), selected = scene.drawings.get('sourceDrawing001');
	canvas.drawings.controlled = [{ id: selected.id, document: selected }];
	ui.notifications.info = () => {};
	let saved = false;
	foundry.utils.saveDataToFile = () => { saved = true; };
	dialogs.prompt = async () => ({ nodeId: ':selection', thumbnail: true, acknowledgeExternal: false });
	await assert.rejects(promptProjectExport(scene, 7, async entries => {
		assert.deepEqual(entries.map(e => e.id), [selected.id]);
		canvas.drawings.controlled = [];
		return { src: 'data:image/webp;base64,UklGRgAAAABXRUJQVlA4WAoAAAAQAAAA/wAAvwAA', width: 256, height: 192 };
	}), /Changed/);
	assert.equal(saved, false);
});

test('selection dialog refuses preview or foreign Scene objects rather than exporting ambiguous sources', async () => {
	const scene = source(), selected = scene.drawings.get('sourceDrawing001');
	dialogEnvironment(scene);
	for (const extra of [{ isPreview: true }, { _original: {} }, { document: new Drawing(drawingData(), { parent: new Scene() }) }]) {
		canvas.drawings.controlled = [{ id: selected.id, document: selected, ...extra }];
		await assert.rejects(promptProjectExport(scene, 7), /Changed/);
	}
});

test('subtree export ignores unsupported outside artwork but refuses unsupported included fields and recovery', () => {
	const scene = source();
	scene.drawings.get('unassigned000001').data.unsupported = 'outside';
	assert.equal(exportDrawingSubtree(scene, 'location').drawings.length, 1);
	assert.throws(() => exportDrawingProject(scene), /unsupported fields/);
	scene.drawings.get('sourceDrawing001').data.unsupported = 'inside';
	assert.throws(() => exportDrawingSubtree(scene, 'location'), /unsupported fields/);
	delete scene.drawings.get('sourceDrawing001').data.unsupported;
	scene.flags.foundryshop.recovery = {};
	assert.throws(() => exportDrawingSubtree(scene, 'location'), /Recovery/);
});

function targetedDestination(lower = 100, upper = 10000) {
	return new Scene([
		drawingData('above', { sort: upper, flags: { foundryshop: { layerId: 'aboveLayer' } } }),
		drawingData('within', { sort: lower, flags: { foundryshop: { layerId: 'child' } } }),
	], { version: 1, revision: 4, nodes: [
		node('aboveLayer'), node('outer', { kind: 'group', playerAllowed: false }),
		node('target', { kind: 'group', parentId: 'outer' }), node('child', { parentId: 'target' }),
	], presets: [] });
}

test('targeted additive subtree import inserts a hidden wrapper above group children without changing any existing Drawing/node', async () => {
	const scene = targetedDestination(), before = readLayerTree(scene), existing = [...scene.drawings.values()].map(d => d.toObject());
	const project = exportDrawingSubtree(source(), 'ink');
	const result = await importDrawingProject(scene, project, { ...importOptions(), mode: 'additive', targetGroupId: 'target', expectedRevision: 4 });
	const wrapper = result.tree.nodes.find(node => node.parentId === 'target' && node.id !== 'child');
	assert.equal(wrapper.playerAllowed, false);
	const children = result.tree.nodes.filter(node => node.parentId === 'target');
	assert.deepEqual(children.map(node => node.id), [wrapper.id, 'child']);
	for (const node of before.nodes) assert.deepEqual(result.tree.nodes.find(other => other.id === node.id), node);
	for (const data of existing) assert.deepEqual(scene.drawings.get(data._id).toObject(), data);
	assert.ok(result.data[0].sort > 100 && result.data[0].sort < 10000);
	assert.equal(result.data[0].author, game.user.id);
	assert.notEqual(result.data[0]._id, project.drawings[0].id);
	assert.equal(result.tree.presets.find(preset => preset.id === result.presentationId).entries.find(entry => entry.nodeId === 'outer').playerAllowed, false);
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
});

test('target import refuses wrong/missing/locked/ancestor-locked targets and insufficient sort space without writes', () => {
	const project = exportDrawingSubtree(source(), 'ink');
	for (const variant of ['missing', 'layer', 'empty', 'locked', 'ancestor', 'capacity']) {
		const scene = targetedDestination(100, variant === 'capacity' ? 101 : 10000);
		if (variant === 'locked') scene.flags.foundryshop.layers.nodes.find(n => n.id === 'target').locked = true;
		if (variant === 'ancestor') scene.flags.foundryshop.layers.nodes.find(n => n.id === 'outer').locked = true;
		assert.throws(() => prepareProjectImport(scene, project, { ...importOptions(),
			mode: variant === 'empty' ? 'empty' : 'additive',
			targetGroupId: variant === 'missing' ? 'missing' : variant === 'layer' ? 'child' : 'target',
		}));
		assert.equal(scene.writes.length, 0); assert.equal(scene.created.length, 0);
	}
});

test('targeted interrupted creation restores exact destination tree/artwork and lock changes before commit refuse writes', async () => {
	const scene = targetedDestination(), tree = structuredClone(readLayerTree(scene)), originals = [...scene.drawings.values()].map(d => d.toObject());
	const project = exportDrawingSubtree(source(), 'ink');
	scene.failCreate = true;
	await assert.rejects(importDrawingProject(scene, project, { ...importOptions(), mode: 'additive', targetGroupId: 'target', expectedRevision: 4 }), /own changes were removed/);
	assert.deepEqual(readLayerTree(scene), tree);
	for (const data of originals) assert.deepEqual(scene.drawings.get(data._id).toObject(), data);
	assert.equal(scene.drawings.size, originals.length);
	scene.failCreate = false;
	const locked = structuredClone(readLayerTree(scene));
	locked.revision++; locked.nodes.find(n => n.id === 'target').locked = true;
	await scene.update({ 'flags.foundryshop.layers': locked });
	const writes = scene.writes.length;
	await assert.rejects(importDrawingProject(scene, project, { ...importOptions(), mode: 'additive', targetGroupId: 'target', expectedRevision: locked.revision }), /unlocked/);
	assert.equal(scene.writes.length, writes);
});

test('export dialog scopes subtree thumbnail and package; outside source mutation prevents download', async () => {
	const scene = source(), dialogs = dialogEnvironment(scene);
	let saved, rendered;
	foundry.utils.saveDataToFile = text => saved = parseProjectPackage(text);
	dialogs.prompt = async config => config.ok.callback(null, { form: { elements: {
		nodeId: { value: 'ink' }, thumbnail: { checked: false }, acknowledgeExternal: { checked: false },
	} } });
	await promptProjectExport(scene, 7);
	assert.equal(saved.scope, 'subtree'); assert.equal(saved.drawings.length, 1);
	saved = null;
	dialogs.prompt = async () => ({ nodeId: 'ink', thumbnail: true, acknowledgeExternal: false });
	await assert.rejects(promptProjectExport(scene, 7, async entries => {
		rendered = entries;
		scene.drawings.get('unassigned000001').data.x++;
		throw new Error('Preview interrupted');
	}), /Changed/);
	assert.equal(rendered.length, 1); assert.equal(saved, null);
});

test('targeted import dialog forwards chosen group through review and requires final confirmation', async () => {
	const scene = targetedDestination(), dialogs = dialogEnvironment(scene);
	let reviewed = false;
	dialogs.prompt = async config => config.ok.callback(null, { form: { elements: {
		mode: { value: 'additive' }, targetGroupId: { value: 'target' }, dx: { valueAsNumber: 0 }, dy: { valueAsNumber: 0 },
		assets: { value: '{}' }, fonts: { value: '{}' },
	} } });
	dialogs.confirm = async config => {
		reviewed = true;
		assert.ok(config.content.children.some(child => child.textContent.includes('target')));
		return false;
	};
	await promptProjectImport(scene, 4, exportDrawingSubtree(source(), 'ink'));
	assert.equal(reviewed, true); assert.equal(scene.writes.length, 0); assert.equal(scene.created.length, 0);
});

test('empty target groups receive imports below negative upper sorts without modifying existing artwork', () => {
	const scene = new Scene([drawingData('above', { sort: -100, flags: { foundryshop: { layerId: 'aboveLayer' } } })],
		{ version: 1, revision: 0, nodes: [node('aboveLayer'), node('target', { kind: 'group' })], presets: [] });
	const plan = prepareProjectImport(scene, exportDrawingSubtree(source(), 'ink'), {
		...importOptions(), mode: 'additive', targetGroupId: 'target',
	});
	assert.ok(plan.data[0].sort < -100); assert.equal(scene.drawings.get('above').sort, -100);
});

test('target import presentation preserves a closed destination ancestor after explicit preset application', async () => {
	const scene = targetedDestination();
	const plan = await importDrawingProject(scene, exportDrawingSubtree(source(), 'ink'), {
		...importOptions(), mode: 'additive', targetGroupId: 'target', expectedRevision: 4,
	});
	await applyPresentationPreset(scene, plan.presentationId, plan.tree.revision);
	assert.equal(readLayerTree(scene).nodes.find(n => n.id === 'outer').playerAllowed, false);
	assert.equal(readLayerTree(scene).nodes.find(n => n.id === 'target').playerAllowed, true);
	assert.equal(scene.drawings.get('within').sort, 100);
});

test('dialog confirmation imports only after explicit review and rejects Scene/Level switches', async () => {
	const project = exportDrawingProject(source());
	for (const variant of ['scene', 'level', 'confirmed']) {
		const scene = new Scene(), dialogs = dialogEnvironment(scene);
		dialogs.prompt = async () => ({ file: { text: async () => JSON.stringify(project) }, dx: 10, dy: 20, assets: {} });
		dialogs.confirm = async () => {
			if (variant === 'scene') canvas.scene = new Scene();
			if (variant === 'level') canvas.level = { id: 'different' };
			return true;
		};
		if (variant === 'confirmed') {
			await promptProjectImport(scene, 0);
			assert.equal(scene.drawings.size, 2);
			assert.equal(scene.drawings.values().next().value.toObject().x, 22);
		} else {
			await assert.rejects(promptProjectImport(scene, 0), /Changed/);
			assert.equal(scene.writes.length, 0);
		}
	}
});

test('interrupted import discard is confirmed and cancellation preserves its durable journal', async () => {
	const scene = new Scene(); scene.failCreate = true; scene.failDelete = true;
	await assert.rejects(importDrawingProject(scene, exportDrawingProject(source()), importOptions()), /Cleanup incomplete/);
	const dialogs = dialogEnvironment(scene);
	await promptDiscardProjectImport(scene);
	assert.equal(scene.drawings.size, 1);
	assert.ok(scene.getFlag('foundryshop', 'projectImportJournal'));
	scene.failDelete = false;
	dialogs.confirm = async () => true;
	await promptDiscardProjectImport(scene);
	assert.equal(scene.drawings.size, 0);
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
});

test('empty Drawing project import preserves unrelated Scene configuration and embedded collections', async () => {
	const scene = new Scene();
	scene.tokens = { sentinel: true }; scene.walls = { sentinel: true };
	scene.background = { src: 'destination.webp' }; scene.width = 4000; scene.grid = { size: 100 };
	const before = structuredClone({ tokens: scene.tokens, walls: scene.walls, background: scene.background, width: scene.width, grid: scene.grid });
	await importDrawingProject(scene, exportDrawingProject(source()), importOptions());
	assert.deepEqual({ tokens: scene.tokens, walls: scene.walls, background: scene.background, width: scene.width, grid: scene.grid }, before);
	for (const write of scene.writes) assert.ok(Object.keys(write.changes).every(key => key.startsWith('flags.foundryshop.')));
});

test('journal removal failure is explicit and later discard never deletes unrelated content', async () => {
	const scene = new Scene(); scene.failJournalRemoval = true;
	await assert.rejects(importDrawingProject(scene, exportDrawingProject(source()), importOptions()), /Cleanup incomplete.*journal/i);
	assert.equal(scene.drawings.size, 0);
	assert.ok(scene.getFlag('foundryshop', 'projectImportJournal'));
	scene.failJournalRemoval = false;
	await discardInterruptedProjectImport(scene);
	assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
});

test('package resource/depth limits are enforced and duplicate fresh IDs reject without writes', () => {
	const project = exportDrawingProject(source());
	const deeplyNested = structuredClone(project);
	let flags = deeplyNested.drawings[0].data.flags;
	for (let index = 0; index < 65; index++) flags = flags.child = {};
	assert.throws(() => validateProjectPackage(deeplyNested), /nesting/);
	const tooMany = structuredClone(project);
	tooMany.tree.nodes = Array.from({ length: PROJECT_LIMITS.nodes + 1 }, (_, index) => node(`layer${index}`));
	assert.throws(() => validateProjectPackage(tooMany), /Too many layers/);
	foundry.utils.randomID = () => 'duplicate';
	const scene = new Scene();
	assert.throws(() => prepareProjectImport(scene, project, importOptions()), /collision/);
	assert.equal(scene.writes.length, 0);
});

test('pending operation checks current Scene before writing, and re-exported imports remain portable', async () => {
	const project = exportDrawingProject(source());
	const scene = new Scene();
	await assert.rejects(importDrawingProject(scene, project, { ...importOptions(), isCurrent: () => false }), /before import/);
	assert.equal(scene.writes.length, 0);
	await importDrawingProject(scene, project, importOptions());
	const reexported = exportDrawingProject(scene);
	assert.equal(reexported.drawings.length, project.drawings.length);
	assert.equal(reexported.tree.nodes.length, 4);
	assert.ok(reexported.drawings.every(entry => entry.data.flags.foundryshop?.provenance));
	await importDrawingProject(new Scene(), reexported, importOptions());
});

test('point-coordinate limit accepts the exact boundary and rejects the next complete point', () => {
	const project = exportDrawingProject(source());
	project.drawings[0].data.shape.points = Array(PROJECT_LIMITS.points - project.drawings[1].data.shape.points.length).fill(0);
	assert.equal(validateProjectPackage(project).drawings[0].data.shape.points.length, PROJECT_LIMITS.points - 6);
	project.drawings[0].data.shape.points.push(0, 0);
	assert.throws(() => validateProjectPackage(project), /point limit/);
});

test('Drawing count limit rejects oversized collections before accepting duplicate records', () => {
	const project = exportDrawingProject(source());
	project.drawings = Array(PROJECT_LIMITS.drawings + 1).fill(project.drawings[0]);
	assert.throws(() => validateProjectPackage(project), /Too many Drawings/);
});

test('font mappings alter only requested families and persist through native verification and re-export', async () => {
	const project = exportDrawingProject(source());
	project.drawings[0].data.fontFamily = 'MissingFont';
	const destination = new Scene();
	await importDrawingProject(destination, project, { ...importOptions(), fonts: { MissingFont: 'Arial' } });
	const imported = [...destination.drawings.values()];
	assert.equal(imported[0].toObject().fontFamily, 'Arial');
	assert.equal(imported[1].toObject().fontFamily, 'Signika');
	assert.equal(project.drawings[0].data.fontFamily, 'MissingFont');
	assert.deepEqual(exportDrawingProject(destination).dependencies.fonts, ['Arial', 'Signika']);
});

test('missing texture/font resources block all Scene writes without creating an import journal', async () => {
	for (const kind of ['font', 'texture']) {
		const project = exportDrawingProject(source());
		if (kind === 'font') project.drawings[0].data.fontFamily = 'MissingFont';
		else project.drawings[0].data.texture = 'missing.webp';
		foundry.utils.fetchWithTimeout = async () => { throw new Error('HTTP 404'); };
		const destination = new Scene();
		await assert.rejects(importDrawingProject(destination, project, importOptions()), /ResourcesBlocked/);
		assert.equal(destination.writes.length, 0);
		assert.equal(destination.drawings.size, 0);
		assert.equal(destination.getFlag('foundryshop', 'projectImportJournal'), undefined);
	}
});

test('external texture URLs are never preflight-requested and import requires explicit acknowledgement', async () => {
	const project = exportDrawingProject(source());
	project.drawings[0].data.texture = 'https://example.invalid/map.webp';
	let requests = 0;
	foundry.utils.fetchWithTimeout = async () => { requests++; throw new Error('Should not request external URL'); };
	const destination = new Scene();
	await assert.rejects(importDrawingProject(destination, project, importOptions()), /ResourcesBlocked/);
	assert.equal(destination.writes.length, 0);
	await importDrawingProject(destination, project, { ...importOptions(), acknowledgeExternal: true });
	assert.equal(destination.drawings.values().next().value.toObject().texture, project.drawings[0].data.texture);
	assert.equal(requests, 0);
});

test('resource repair dialog shows failures, accepts explicit mappings, rechecks and imports only verified targets', async () => {
	const project = exportDrawingProject(source());
	project.drawings[0].data.texture = 'missing.webp';
	project.drawings[0].data.fontFamily = 'MissingFont';
	const destination = new Scene(), dialogs = dialogEnvironment(destination);
	const requests = [];
	foundry.utils.fetchWithTimeout = async url => {
		requests.push(url);
		if (url.endsWith('missing.webp')) throw new Error('HTTP 404');
		return { ok: true, status: 200, headers: { get: () => 'image/webp' } };
	};
	let prompts = 0;
	dialogs.prompt = async config => {
		if (++prompts === 1) return { file: { text: async () => JSON.stringify(project) }, dx: 0, dy: 0, assets: {}, fonts: {} };
		assert.equal(config.content.tagName, 'DIV');
		assert.deepEqual(config.content.attributes, {});
		const text = config.content.children.map(node => node.textContent).join(' ');
		assert.match(text, /MissingFont/);
		assert.match(text, /missing.webp/);
		assert.match(text, /Arial/);
		return config.ok.callback(null, { form: { elements: {
			assets: { value: '{"missing.webp":"shared.webp"}' },
			fonts: { value: '{"MissingFont":"Arial"}' },
			acknowledgeExternal: { checked: false },
		} } });
	};
	dialogs.confirm = async config => {
		const text = config.content.children.map(node => node.textContent).join(' ');
		assert.match(text, /shared.webp/); assert.match(text, /Arial/);
		assert.match(text, /ResourceStatus.available/);
		return true;
	};
	await promptProjectImport(destination, 0);
	assert.equal(prompts, 2);
	assert.equal(requests.filter(url => url.endsWith('shared.webp')).length, 2, 'checked on review and again before writing');
	const drawing = destination.drawings.values().next().value.toObject();
	assert.equal(drawing.texture, 'shared.webp'); assert.equal(drawing.fontFamily, 'Arial');
});

test('cancelling resource repair leaves destination untouched and never reaches confirmation', async () => {
	const project = exportDrawingProject(source());
	project.drawings[0].data.fontFamily = 'MissingFont';
	const destination = new Scene(), dialogs = dialogEnvironment(destination);
	let prompts = 0;
	dialogs.prompt = async () => ++prompts === 1
		? { file: { text: async () => JSON.stringify(project) }, dx: 0, dy: 0, assets: {} } : null;
	dialogs.confirm = async () => { assert.fail('Unresolved resources must not reach confirmation'); };
	await promptProjectImport(destination, 0);
	assert.equal(prompts, 2);
	assert.equal(destination.writes.length, 0);
});

test('external acknowledgement is unchecked by default and explicitly shown in final review', async () => {
	const project = exportDrawingProject(source());
	project.drawings[0].data.texture = 'https://example.invalid/map.webp';
	const destination = new Scene(), dialogs = dialogEnvironment(destination);
	let prompts = 0;
	dialogs.prompt = async config => {
		if (++prompts === 1) return { file: { text: async () => JSON.stringify(project) }, dx: 0, dy: 0, assets: {} };
		const checkbox = config.content.children.at(-1).children[0];
		assert.equal(checkbox.attributes.name, 'acknowledgeExternal');
		assert.equal(checkbox.attributes.checked, undefined);
		return { assets: {}, fonts: {}, acknowledgeExternal: true };
	};
	dialogs.confirm = async config => {
		assert.ok(config.content.children.some(node => node.textContent?.includes('ExternalAcknowledged')));
		return true;
	};
	await promptProjectImport(destination, 0);
	assert.equal(destination.drawings.size, 2);
});

test('resource failures discovered after final review still block before journaling', async () => {
	const project = exportDrawingProject(source());
	project.drawings[0].data.texture = 'shared.webp';
	const destination = new Scene(), dialogs = dialogEnvironment(destination);
	dialogs.prompt = async () => ({ file: { text: async () => JSON.stringify(project) }, dx: 0, dy: 0, assets: {} });
	dialogs.confirm = async () => {
		foundry.utils.fetchWithTimeout = async () => { throw new Error('Resource removed'); };
		return true;
	};
	await assert.rejects(promptProjectImport(destination, 0), /ResourcesBlocked.*Resource removed/);
	assert.equal(destination.writes.length, 0);
});

test('Scene changes, Level deletion and required module changes during requests reject before writing', async () => {
	for (const kind of ['scene', 'level', 'module', 'authority']) {
		const project = exportDrawingProject(source());
		project.drawings[0].data.texture = 'shared.webp';
		const destination = new Scene();
		foundry.utils.fetchWithTimeout = async () => {
			if (kind === 'scene') {
				destination.flags.foundryshop.layers.nodes.push(node('otherGM'));
				Hooks.callAll('updateScene', destination);
			}
			if (kind === 'level') destination.levels.clear();
			if (kind === 'module') game.modules.get('extension').active = false;
			if (kind === 'authority') game.user.isGM = false;
			return { ok: true, status: 200, headers: { get: () => 'image/webp' } };
		};
		await assert.rejects(importDrawingProject(destination, project, importOptions()));
		assert.equal(destination.writes.length, 0);
		game.modules.get('extension').active = true;
		game.user.isGM = true;
	}
});

function additiveOptions(scene, overrides = {}) {
	return { ...importOptions(), mode: 'additive', expectedRevision: readLayerTree(scene).revision, ...overrides };
}

test('additive import preserves existing Drawing data, membership, order, native locks, layers and presets exactly', async () => {
	const destination = source(), project = exportDrawingProject(source());
	const before = structuredClone(readLayerTree(destination));
	const artwork = [...destination.drawings.values()].map(drawing => drawing.toObject());
	const plan = await importDrawingProject(destination, project, additiveOptions(destination));
	assert.equal(destination.drawings.size, 4);
	for (const data of artwork) assert.deepEqual(destination.drawings.get(data._id).toObject(), data);
	const tree = readLayerTree(destination);
	assert.deepEqual(tree.nodes.slice(-before.nodes.length), before.nodes);
	assert.deepEqual(tree.presets.slice(0, before.presets.length), before.presets);
	assert.equal(tree.nodes[0].id, plan.tree.nodes[0].id);
	assert.equal(tree.nodes[0].playerAllowed, false);
	assert.ok(plan.data.every(data => data.sort > artwork[0].sort));
	assert.equal(destination.getFlag('foundryshop', 'projectImportJournal'), undefined);
	assert.ok(new Set(tree.presets.map(preset => preset.name.toLowerCase())).size === tree.presets.length);
	assert.equal(tree.presets.find(preset => preset.id === plan.presentationId).entries[0].nodeId, before.nodes[0].id);
});

test('imported presets preserve captured existing gates while existing presets hide all imported nodes', async () => {
	const destination = source();
	destination.flags.foundryshop.layers.nodes[0].playerAllowed = false;
	destination.flags.foundryshop.layers.presets[0].entries[0].playerAllowed = false;
	const before = structuredClone(readLayerTree(destination));
	const plan = await importDrawingProject(destination, exportDrawingProject(source()), additiveOptions(destination));
	await applyPresentationPreset(destination, plan.presentationId, 8);
	let tree = readLayerTree(destination);
	assert.equal(tree.nodes.find(node => node.id === 'location').playerAllowed, false);
	assert.equal(tree.nodes.find(node => node.id === 'ink').playerAllowed, true);
	assert.equal(tree.nodes[0].playerAllowed, true);
	await applyPresentationPreset(destination, before.presets[0].id, 9);
	tree = readLayerTree(destination);
	const existingIds = new Set(before.nodes.map(node => node.id));
	assert.ok(tree.nodes.filter(node => !existingIds.has(node.id)).every(node => !node.playerAllowed));
	assert.equal(tree.nodes.find(node => node.id === 'ink').locked, true);
});

test('repeated additive imports have disjoint IDs and case-insensitively unique preset names', async () => {
	const destination = source(), project = exportDrawingProject(source());
	const first = await importDrawingProject(destination, project, additiveOptions(destination));
	const firstArtwork = [...destination.drawings.values()].map(drawing => drawing.toObject());
	const second = await importDrawingProject(destination, project, additiveOptions(destination));
	assert.equal(destination.drawings.size, 6);
	for (const data of firstArtwork) assert.deepEqual(destination.drawings.get(data._id).toObject(), data);
	assert.ok(first.data.every(data => !second.data.some(other => other._id === data._id)));
	assert.ok(second.data.every(data => data.sort > Math.max(...first.data.map(data => data.sort))));
	const names = readLayerTree(destination).presets.map(preset => preset.name.toLowerCase());
	assert.equal(new Set(names).size, names.length);
	assert.equal(readLayerTree(destination).nodes[0].id, second.tree.nodes[0].id);
});

test('additive failures compensate only imported artwork and restore the exact prior project', async () => {
	for (const failure of ['failCreate', 'failStage', 'alterCreated', 'failRelease']) {
		const destination = source(), project = exportDrawingProject(source());
		const before = structuredClone(readLayerTree(destination));
		const artwork = [...destination.drawings.values()].map(drawing => drawing.toObject());
		destination[failure] = true;
		await assert.rejects(importDrawingProject(destination, project, additiveOptions(destination)), /own changes were removed/);
		assert.deepEqual(readLayerTree(destination), before);
		assert.equal(destination.drawings.size, artwork.length);
		for (const data of artwork) assert.deepEqual(destination.drawings.get(data._id).toObject(), data);
		assert.ok(destination.deleted.every(id => !artwork.some(data => data._id === id)));
		assert.equal(destination.getFlag('foundryshop', 'projectImportJournal'), undefined);
	}
});

test('durable additive journal discard after reload restores baseline without deleting existing Drawings', async () => {
	const destination = source(), project = exportDrawingProject(source());
	const before = structuredClone(readLayerTree(destination));
	const artwork = [...destination.drawings.values()].map(drawing => drawing.toObject());
	destination.failCreate = true; destination.failDelete = true;
	await assert.rejects(importDrawingProject(destination, project, additiveOptions(destination)), /Cleanup incomplete/);
	const journal = structuredClone(destination.getFlag('foundryshop', 'projectImportJournal'));
	assert.equal(journal.version, 2);
	assert.equal(journal.baseline.length, 2);
	assert.ok(journal.baseline.every(entry => /^[a-f0-9]{64}$/.test(entry.digest)));
	destination.flags.foundryshop.projectImportJournal = JSON.parse(JSON.stringify(journal));
	destination.failDelete = false;
	await discardInterruptedProjectImport(destination);
	assert.deepEqual(readLayerTree(destination), before);
	assert.equal(destination.drawings.size, 2);
	for (const data of artwork) assert.deepEqual(destination.drawings.get(data._id).toObject(), data);
});

test('existing-artwork edits or removal during additive creation retain journal and refuse cleanup', async () => {
	for (const variant of ['edit', 'remove', 'add']) {
		const destination = source(), project = exportDrawingProject(source());
		destination.onCreate = async () => {
			if (variant === 'edit') destination.drawings.get('sourceDrawing001').data.text = 'Other GM edit';
			if (variant === 'remove') destination.drawings.delete('sourceDrawing001');
			if (variant === 'add') destination.drawings.set('newArtwork', new Drawing(drawingData('newArtwork'), { parent: destination }));
			throw new Error('Concurrent change');
		};
		await assert.rejects(importDrawingProject(destination, project, additiveOptions(destination)), /Cleanup incomplete/);
		assert.equal(destination.deleted.length, 0);
		assert.ok(destination.getFlag('foundryshop', 'projectImportJournal'));
		await assert.rejects(discardInterruptedProjectImport(destination), /artwork.*during import/i);
		assert.equal(destination.deleted.length, 0);
	}
});

test('existing Drawing edits during resource checks abort additive import before journaling', async () => {
	const destination = source(), project = exportDrawingProject(source());
	project.drawings[0].data.texture = 'shared.webp';
	foundry.utils.fetchWithTimeout = async () => {
		destination.drawings.get('sourceDrawing001').data.text = 'Concurrent edit';
		return { ok: true, status: 200, headers: { get: () => 'image/webp' } };
	};
	await assert.rejects(importDrawingProject(destination, project, additiveOptions(destination)), /Existing artwork changed/);
	assert.equal(destination.writes.length, 0);
	assert.equal(destination.drawings.size, 2);
});

test('unsafe sort capacity, inconsistent existing order, render constraints and unresolved membership refuse additive preflight', () => {
	for (const variant of ['sort', 'order', 'elevation', 'interface', 'membership']) {
		const destination = source(), project = exportDrawingProject(source());
		if (variant === 'sort') destination.drawings.get('sourceDrawing001').data.sort = Number.MAX_SAFE_INTEGER;
		if (variant === 'elevation') destination.drawings.get('sourceDrawing001').data.elevation = 5;
		if (variant === 'interface') destination.drawings.get('sourceDrawing001').data.interface = true;
		if (variant === 'membership') destination.drawings.get('sourceDrawing001').data.flags.foundryshop.layerId = 'missing';
		if (variant === 'order') {
			destination.flags.foundryshop.layers.nodes.push(node('bottom'));
			destination.drawings.set('bottom', new Drawing(drawingData('bottom', {
				sort: 10000, flags: { foundryshop: { layerId: 'bottom' } },
			}), { parent: destination }));
		}
		assert.throws(() => prepareProjectImport(destination, project, additiveOptions(destination)));
		assert.equal(destination.writes.length, 0);
	}
});

test('ID generation rejects collisions with existing Drawings, layers and presets', () => {
	const destination = source(), project = exportDrawingProject(source());
	for (const collision of ['sourceDrawing001', 'location', 'preset']) {
		foundry.utils.randomID = () => collision;
		assert.throws(() => prepareProjectImport(destination, project, additiveOptions(destination)), /collision/);
	}
});

test('additive import dialog explicitly selects mode and describes stack and presentation policy', async () => {
	const destination = source(), project = exportDrawingProject(source());
	const dialogs = dialogEnvironment(destination);
	dialogs.prompt = async config => {
		const selector = config.content.children.find(child => child.children?.[0]?.attributes?.name === 'mode').children[0];
		assert.equal(selector.children[0].attributes.selected, '');
		assert.equal(selector.children[1].attributes.value, 'additive');
		return { mode: 'additive', file: { text: async () => JSON.stringify(project) }, dx: 0, dy: 0, assets: {} };
	};
	dialogs.confirm = async config => {
		assert.ok(config.content.children.some(node => node.textContent?.includes('AdditiveReview')));
		return true;
	};
	await promptProjectImport(destination, 7);
	assert.equal(destination.drawings.size, 4);
});

test('empty import replaces retained metadata only with explicit permission and no Drawings', async () => {
	const destination = source(), project = exportDrawingProject(source());
	destination.drawings.clear();
	const before = readLayerTree(destination);
	assert.throws(() => prepareProjectImport(destination, project, importOptions()), /Confirm replacement/);
	assert.throws(() => prepareProjectImport(destination, project, {
		...importOptions(), replaceEmptyMetadata: 'true',
	}), /Confirm replacement/);
	assert.equal(destination.writes.length, 0);
	const options = { ...importOptions(), expectedRevision: before.revision, replaceEmptyMetadata: true };
	const plan = prepareProjectImport(destination, project, options);
	assert.deepEqual(plan.before, before);
	assert.deepEqual(readLayerTree(destination), before, 'preview must not clear metadata');
	assert.ok(plan.tree.nodes.every(node => !before.nodes.some(old => old.id === node.id)));
	assert.ok(plan.tree.presets.every(preset => !before.presets.some(old => old.id === preset.id)));
	assert.equal(plan.tree.presets[0].name, project.tree.presets[0].name, 'replaced names do not need suffixes');
	assert.ok(plan.tree.presets.every(preset => preset.entries.every(entry => !before.nodes.some(node => node.id === entry.nodeId))));
	await importDrawingProject(destination, project, options);
	assert.equal(destination.drawings.size, project.drawings.length);
	assert.equal(readLayerTree(destination).nodes.length, 4);
	assert.equal(readLayerTree(destination).presets.length, 2);
	assert.equal(destination.getFlag('foundryshop', 'projectImportJournal'), undefined);
	assert.throws(() => prepareProjectImport(source(), project, options), /empty Drawing project/);
});

test('failed empty metadata replacement restores the exact old project, including interrupted discard', async () => {
	for (const interrupted of [false, true]) {
		const destination = source(), project = exportDrawingProject(source());
		destination.drawings.clear();
		const before = readLayerTree(destination);
		destination.failCreate = true;
		destination.failDelete = interrupted;
		const options = { ...importOptions(), expectedRevision: before.revision, replaceEmptyMetadata: true };
		await assert.rejects(importDrawingProject(destination, project, options),
			interrupted ? /Cleanup incomplete/ : /own changes were removed/);
		if (interrupted) {
			assert.deepEqual(destination.getFlag('foundryshop', 'projectImportJournal').before, before);
			destination.failDelete = false;
			await discardInterruptedProjectImport(destination);
		}
		assert.deepEqual(readLayerTree(destination), before);
		assert.equal(destination.drawings.size, 0);
		assert.equal(destination.getFlag('foundryshop', 'projectImportJournal'), undefined);
	}
});

test('metadata replacement permission never bypasses late artwork or stale revision checks', async () => {
	for (const variant of ['artwork', 'revision']) {
		const destination = source(), project = exportDrawingProject(source());
		destination.drawings.clear();
		const options = {
			...importOptions(), expectedRevision: 7, replaceEmptyMetadata: true,
			isCurrent: () => {
				if (variant === 'artwork') destination.drawings.set('lateDrawing', new Drawing(drawingData('lateDrawing'), { parent: destination }));
				else destination.flags.foundryshop.layers = {
					...destination.flags.foundryshop.layers, revision: destination.flags.foundryshop.layers.revision + 1,
				};
				return true;
			},
		};
		await assert.rejects(importDrawingProject(destination, project, options), /empty Drawing project|changed/);
		assert.equal(destination.writes.length, 0);
	}
});

test('empty import dialog separately confirms metadata replacement, final review, and cancellation', async () => {
	for (const cancelAt of [1, 2, 0]) {
		const destination = source(), project = exportDrawingProject(source());
		destination.drawings.clear();
		const before = readLayerTree(destination);
		const dialogs = dialogEnvironment(destination);
		dialogs.prompt = async () => ({
			mode: 'empty', file: { text: async () => JSON.stringify(project) }, dx: 0, dy: 0, assets: {},
		});
		let confirmations = 0;
		dialogs.confirm = async config => {
			confirmations++;
			assert.equal(config.content.tagName, 'DIV');
			assert.deepEqual(config.content.attributes, {});
			if (confirmations === 1) assert.match(config.window.title, /ReplaceEmptyMetadata$/);
			else assert.ok(config.content.children.some(node => node.textContent?.includes('ReplaceEmptyMetadataReview')));
			return confirmations !== cancelAt;
		};
		await promptProjectImport(destination, 7);
		assert.equal(confirmations, cancelAt === 1 ? 1 : 2);
		if (cancelAt) {
			assert.equal(destination.writes.length, 0);
			assert.deepEqual(readLayerTree(destination), before);
			assert.equal(destination.drawings.size, 0);
		} else {
			assert.equal(destination.drawings.size, 2);
			assert.equal(readLayerTree(destination).nodes.length, 4);
		}
	}
});

test('equal-sort source Drawing order uses original stable IDs, not randomly generated destination IDs', () => {
	const pkg = exportDrawingProject(source());
	pkg.drawings = [
		{ ...structuredClone(pkg.drawings[0]), id: 'z-last' },
		{ ...structuredClone(pkg.drawings[0]), id: 'a-first' },
	];
	const plan = prepareProjectImport(new Scene(), pkg, importOptions());
	assert.ok(plan.data[0].sort > plan.data[1].sort);
});

test('additive combined node, preset and Drawing limits reject before any writes', () => {
	const pkg = exportDrawingProject(source());
	for (const variant of ['nodes', 'presets', 'drawings']) {
		const destination = new Scene();
		if (variant === 'nodes') destination.flags.foundryshop.layers.nodes = Array.from({ length: 1999 }, (_, index) => node(`n${index}`));
		if (variant === 'presets') destination.flags.foundryshop.layers.presets = Array.from({ length: 199 }, (_, index) => ({
			id: `p${index}`, name: `Preset ${index}`, entries: [],
		}));
		if (variant === 'drawings') {
			for (let index = 0; index < 9999; index++) {
				const id = `existing${index}`;
				destination.drawings.set(id, new Drawing(drawingData(id, { flags: {} }), { parent: destination }));
			}
		}
		assert.throws(() => prepareProjectImport(destination, pkg, additiveOptions(destination)), /limits/);
		assert.equal(destination.writes.length, 0);
	}
});

test('additive import with only Unassigned existing artwork preserves its native order and visibility', async () => {
	const destination = new Scene([drawingData('unmanaged', { flags: {}, sort: 999999 })]);
	const before = destination.drawings.get('unmanaged').toObject();
	await importDrawingProject(destination, exportDrawingProject(source()), additiveOptions(destination));
	assert.deepEqual(destination.drawings.get('unmanaged').toObject(), before);
	assert.equal(destination.drawings.size, 3);
});

test('old empty-import journal remains discardable and malformed v2 baselines refuse destructive cleanup', async () => {
	const destination = new Scene();
	destination.failCreate = true; destination.failDelete = true;
	await assert.rejects(importDrawingProject(destination, exportDrawingProject(source()), importOptions()), /Cleanup incomplete/);
	const journal = destination.getFlag('foundryshop', 'projectImportJournal');
	journal.baseline = [{ id: 'bad', digest: 'not-a-digest' }];
	await assert.rejects(discardInterruptedProjectImport(destination), /Invalid import journal/);
	assert.equal(destination.deleted.length, 0);
	journal.version = 1;
	delete journal.baseline;
	destination.failDelete = false;
	await discardInterruptedProjectImport(destination);
	assert.equal(destination.drawings.size, 0);
});

test('baseline edits while staging is released retain the journal instead of claiming success', async () => {
	const destination = source(), project = exportDrawingProject(source());
	const nativeUpdate = destination.updateEmbeddedDocuments.bind(destination);
	destination.updateEmbeddedDocuments = async (...args) => {
		await nativeUpdate(...args);
		destination.drawings.get('sourceDrawing001').data.text = 'Changed while staging released';
	};
	await assert.rejects(importDrawingProject(destination, project, additiveOptions(destination)), /Cleanup incomplete.*Existing artwork changed/);
	assert.equal(destination.deleted.length, 0);
	assert.ok(destination.getFlag('foundryshop', 'projectImportJournal'));
});

test('preset name collision suffixes stay within the maximum name length', () => {
	const destination = source(), project = exportDrawingProject(source());
	const name = 'x'.repeat(80);
	destination.flags.foundryshop.layers.presets[0].name = name;
	project.tree.presets[0].name = name;
	const plan = prepareProjectImport(destination, project, additiveOptions(destination));
	assert.ok(plan.tree.presets.every(preset => preset.name.length <= 80));
	assert.equal(new Set(plan.tree.presets.map(preset => preset.name)).size, plan.tree.presets.length);
});

test('baseline changes during compensation tree restoration retain the import journal', async () => {
	const destination = source(), project = exportDrawingProject(source());
	const before = readLayerTree(destination);
	const nativeUpdate = destination.update.bind(destination);
	destination.failCreate = true;
	destination.update = async (changes, options) => {
		await nativeUpdate(changes, options);
		if (changes['flags.foundryshop.layers'] && canonicalJson(changes['flags.foundryshop.layers']) === canonicalJson(before)) {
			destination.drawings.get('sourceDrawing001').data.text = 'Changed during restoration';
		}
	};
	await assert.rejects(importDrawingProject(destination, project, additiveOptions(destination)), /Cleanup incomplete.*Existing artwork changed/);
	assert.ok(destination.getFlag('foundryshop', 'projectImportJournal'));
	assert.equal(destination.drawings.get('sourceDrawing001').data.text, 'Changed during restoration');
});
