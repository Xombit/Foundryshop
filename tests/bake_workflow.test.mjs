import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prepareReviewedBackgroundBake, prepareReviewedTileBake, prepareReviewedConsolidation } from '../scripts/layers/bake_workflow.js';
import { readOptimizationJournal } from '../scripts/layers/optimization_journal.js';
import { readStoredOptimizationArchive, encodeOptimizationArchive, prepareOptimizationArchiveFile, optimizationArchiveDescriptor } from '../scripts/layers/optimization_recovery.js';
import { inspectOptimizationImage } from '../scripts/optimization_media.js';
import { promptReviewedBackgroundBake, promptResumeBackgroundBake, promptRestoreBackgroundBake,
	promptResumeTileBake, promptRestoreTileBake, promptTakeOverBackgroundBake,
	promptReviewedTileBake,
	promptReviewedConsolidation, promptRestoreConsolidation, promptResumeConsolidation,
	promptTakeOverConsolidation } from '../scripts/layers/bake_entry.js';

let scene, level, files, approvals, options, closed, paint, current;
const root = 'worlds/test/recovery';
const doc = source => ({ id: source._id, toObject: () => structuredClone(source) });
function png(width, height) {
	const bytes = new Uint8Array(58), view = new DataView(bytes.buffer);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); view.setUint32(8, 13);
	bytes.set([... 'IHDR'].map(c => c.charCodeAt()), 12);
	view.setUint32(16, width); view.setUint32(20, height);
	view.setUint32(33, 1); bytes.set([... 'IDAT'].map(c => c.charCodeAt()), 37);
	bytes.set([... 'IEND'].map(c => c.charCodeAt()), 50);
	return new Blob([bytes], { type: 'image/png' });
}
const vector = (x = 0, y = 0) => ({ x, y, set(x, y) { this.x = x; this.y = y; } });

beforeEach(() => {
	files = new Map(); approvals = []; closed = 0; paint = []; current = true;
	level = { _id: 'level001', elevation: { bottom: 0, top: 10 }, flags: {},
		background: { src: null, color: '#334455', tint: '#ffffff', alphaThreshold: 0.5 },
		textures: { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0,
			fit: 'fill', scaleX: 1, scaleY: 1, rotation: 0 } };
	const source = { _id: 'stroke001', name: '', author: 'gm001', levels: ['level001'], flags: {},
		x: 2, y: 1, elevation: 0, sort: 0, rotation: 0, bezierFactor: 0, strokeWidth: 0,
		shape: { type: 'r', width: 4, height: 2, radius: null, points: [] },
		fillType: 1, fillColor: '#ff0000', fillAlpha: 1, strokeColor: '#000000', strokeAlpha: 1,
		fontSize: 48, fontFamily: '', text: '', textColor: '#ffffff', textAlpha: 1, texture: null,
		hidden: false, locked: false, interface: false };
	scene = { id: 'scene001', width: 8, height: 4, padding: 0,
		grid: { toObject: () => ({ size: 100 }) }, flags: {}, tiles: new Map(),
		levels: new Map([['level001', doc(level)]]), drawings: new Map([['stroke001', doc(source)]]),
		getDimensions: () => ({ sceneRect: { x: 0, y: 0, width: 8, height: 4 } }),
		getFlag(ns, key) { return this.flags[key]; }, canUserModify: () => true,
		async update(patch) { this.flags.optimizationJournal = structuredClone(patch['flags.foundryshop.optimizationJournal']); },
		async updateEmbeddedDocuments(type, updates) {
			const collection = { Level: this.levels, Drawing: this.drawings, Tile: this.tiles }[type];
			for (const update of updates) {
				const before = collection.get(update._id).toObject();
				collection.set(update._id, doc({ ...before, ...structuredClone(update) }));
			}
		},
		async createEmbeddedDocuments(type, sources) {
			const collection = type === 'Drawing' ? this.drawings : this.tiles;
			for (const source of sources) {
				assert.equal(collection.has(source._id), false);
				collection.set(source._id, doc(source));
			}
		},
		async deleteEmbeddedDocuments(type, ids) {
			assert.ok(['Drawing', 'Tile'].includes(type));
			const collection = type === 'Drawing' ? this.drawings : this.tiles;
			ids.forEach(id => collection.delete(id));
		},
	};
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.game = { user: { id: 'gm001', isGM: true, can: () => true },
		users: { activeGM: { id: 'gm001' } }, scenes: new Map([[scene.id, scene]]),
		settings: { get: () => ({ version: 1, scenes: {} }) },
		i18n: { localize: key => key, format: key => key } };
	globalThis.Hooks = { on: () => 1, off() {} };
	globalThis.ui = { notifications: { info() {}, warn() {} } };
	globalThis.getDocumentClass = type => class {
		constructor(input) { this.source = structuredClone(type === 'Drawing' ? { ...source, ...input } : input); }
		toObject() { return structuredClone(this.source); }
	};
	globalThis.foundry = { canvas: { containers: {} }, applications: { apps: { FilePicker: { implementation: {
		browse: async () => ({ target: root, files: [...files.keys()], dirs: [], private: false }),
		upload: async (type, folder, file) => {
			const path = `${folder}/${file.name}`;
			files.set(path, new Uint8Array(await file.arrayBuffer())); return { path };
		},
	} } } } };
	globalThis.fetch = async url => {
		const path = decodeURIComponent(new URL(url).pathname).slice(1);
		return new Response(files.get(path), { status: files.has(path) ? 200 : 404 });
	};
	globalThis.createImageBitmap = async blob => {
		const { width, height } = inspectOptimizationImage(new Uint8Array(await blob.arrayBuffer()));
		return { width, height, close() { closed++; } };
	};
	globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
	globalThis.document = { createElement: () => {
		const surface = { width: 0, height: 0, toBlob: callback => callback(png(surface.width, surface.height)),
			getContext: () => ({ save() {}, restore() {}, putImageData() {},
				drawImage(...args) { paint.push(['image', ...args]); },
				fillRect(...args) { paint.push(['color', ...args]); },
			}) };
		return surface;
	} };
	class Container {
		constructor() {
			this.children = []; this.parent = null; this.rotation = 0; this.alpha = 1;
			this.scale = vector(1, 1); this.pivot = vector(); this.position = vector();
		}
		addChild(child) { this.children.push(child); child.parent = this; }
		destroy({ children } = {}) { if (children) this.children.forEach(c => c.destroy()); this.destroyed = true; }
	}
	class Graphics extends Container {
		constructor() { super(); this.line = { reset() {} }; }
		lineStyle() {} beginTextureFill() {} endFill() {}
		drawRect(x, y, width, height) { this.bounds = { x, y, width, height }; }
		drawSmoothedPolygon() {} drawSmoothedPath() {}
		getBounds() { return { ...this.bounds, x: this.position.x - this.pivot.x, y: this.position.y - this.pivot.y }; }
	}
	globalThis.PIXI = { Container, Graphics, ALPHA_MODES: { NPM: 0 },
		Matrix: class { scale() { return this; } },
		BaseTexture: class { constructor(bitmap) { this.width = bitmap.width; this.height = bitmap.height; } destroy() {} },
		Texture: class {
			constructor(base) { this.width = base.width; this.height = base.height; this.valid = true; this.baseTexture = base; }
			destroy(all) { this.valid = false; if (all) this.baseTexture.destroy(); }
		},
		RenderTexture: { create: size => ({ ...size, baseTexture: { alphaMode: 1 }, destroy() {} }) } };
	globalThis.canvas = { ready: true, scene, level: { id: 'level001' },
		drawings: { get controlled() { return scene.drawings.has('stroke001') ? [{ document: { id: 'stroke001' } }] : []; } },
		app: { renderer: {
		gl: { MAX_TEXTURE_SIZE: 1, MAX_RENDERBUFFER_SIZE: 2, MAX_VIEWPORT_DIMS: 3,
			isContextLost: () => false, getParameter: key => key === 3 ? [16, 16] : 16 },
		render() {}, extract: { pixels: target => new Uint8Array(target.width * target.height * 4) },
	} } };
	options = { token: 'background001', root, levelId: 'level001', kind: 'all', audience: 'player',
		format: 'png', isCurrent: () => current,
		approveScope: async r => {
			approvals.push(r); return { excludedIds: r.excluded.map(e => e.id), flattenToGround: true };
		},
		approveRender: async r => {
			approvals.push(r); return { proceed: true, width: r.width, height: r.height,
				format: r.format, quality: r.quality, croppedSourceIds: r.croppedSourceIds };
		},
		approvePlacement: async r => {
			approvals.push(r); return { [r.action === 'restore' ? 'restorePlacement' : 'flattenToGround']: true, overlappingTileIds: r.overlappingTileIds };
		},
		approvePreview: async () => true,
		verifyDisplay: async input => { assert.equal(input.replacement.type, 'LevelBackground'); return true; },
	};
});

const prepare = extra => prepareReviewedBackgroundBake(scene, { ...options, ...extra });
const apply = workflow => workflow.apply({
	approveExecution: async r => ({ resumeOperation: true, sourceIds: r.sourceIds }),
});

test('background workflow composes full Scene, persists separately and applies native Level without a Tile', async () => {
	const workflow = await prepare();
	assert.equal(approvals[0].destination, 'background');
	assert.deepEqual(workflow.review.render.bounds, { x: 0, y: 0, width: 8, height: 4 });
	assert.equal(files.size, 0); assert.equal(scene.drawings.size, 1);
	assert.equal(scene.levels.get('level001').toObject().background.src, null);
	assert.ok(paint.some(entry => entry[0] === 'color'));
	await assert.rejects(apply(workflow), /Persist verified assets/);
	await workflow.persistAssets({ approvedPaths: workflow.review.paths });
	assert.equal(files.size, 2); assert.equal(scene.drawings.size, 1);
	await apply(workflow);
	assert.equal(scene.drawings.size, 0); assert.equal(scene.tiles.size, 0);
	assert.equal(readOptimizationJournal(scene).entries.at(-1).phase, 'complete');
	assert.equal(scene.levels.get('level001').toObject().background.src, `${root}/bake-background001.png`);
});

function consolidationOptions(extra = {}) {
	return { ...options, kind: 'selection', replacementId: 'abcdefghijklmnop',
		readSelection: () => canvas.drawings.controlled.map(drawing => drawing.document.id),
		verifyDisplay: async input => { assert.equal(input.replacement.type, 'Drawing'); return true; }, ...extra };
}

test('public Consolidate retains Drawing ownership, non-ground elevation and exact recovery with later artwork', async () => {
	const original = scene.drawings.get('stroke001').toObject();
	original.elevation = 5;
	scene.drawings.set(original._id, doc(original));
	const before = scene.levels.get('level001').toObject();
	const result = await promptReviewedConsolidation(scene, consolidationOptions(), { reviewDialogs: dialogs() });
	assert.equal(result.status, 'complete');
	assert.equal(scene.drawings.size, 1); assert.equal(scene.tiles.size, 0);
	const composite = scene.drawings.get('abcdefghijklmnop').toObject();
	assert.equal(composite.elevation, 5); assert.equal(composite.sort, original.sort);
	assert.equal(composite.flags.foundryshop.imageStamp, 1);
	assert.equal(composite.hidden, false); assert.equal(composite.locked, false);
	assert.deepEqual(composite.shape, { type: 'r', width: 4, height: 2, points: [] });
	assert.deepEqual(scene.levels.get('level001').toObject(), before);
	const later = { ...original, _id: 'later001', sort: 1024, x: 5 };
	scene.drawings.set(later._id, doc(later));
	await assert.rejects(promptRestoreTileBake(scene, options.token), /RestoreInvalid/);
	const restored = await promptRestoreConsolidation(scene, options.token, { token: 'restore001' },
		{ reviewDialogs: dialogs() });
	assert.equal(restored.status, 'complete');
	assert.deepEqual(scene.drawings.get(original._id).toObject(), original);
	assert.deepEqual(scene.drawings.get(later._id).toObject(), later);
	assert.equal(scene.drawings.has(composite._id), false);
	assert.deepEqual(scene.levels.get('level001').toObject(), before);
});

test('Consolidate preserves leaf membership and private player gate rather than native hiding', async () => {
	scene.flags.layers = { version: 1, revision: 0, presets: [], nodes: [
		{ id: 'ink001', name: 'Ink', parentId: null, kind: 'layer', playerAllowed: false, locked: false, defaults: {} },
	] };
	const source = scene.drawings.get('stroke001').toObject();
	source.flags = { foundryshop: { layerId: 'ink001' } };
	scene.drawings.set(source._id, doc(source));
	const extra = consolidationOptions({ kind: 'layer', layerId: 'ink001', audience: 'gm' });
	const workflow = await prepareReviewedConsolidation(scene, extra);
	await workflow.persistAssets({ approvedPaths: workflow.review.paths });
	await apply(workflow);
	const composite = scene.drawings.get(extra.replacementId).toObject();
	assert.equal(composite.flags.foundryshop.layerId, 'ink001');
	assert.equal(composite.hidden, false);
	assert.equal(scene.flags.layers.nodes[0].playerAllowed, false);
});

function recoveryLayer(playerAllowed = false) {
	scene.flags.layers = { version: 1, revision: 0, presets: [], nodes: [
		{ id: 'ink001', name: 'Ink', parentId: null, kind: 'layer', playerAllowed, locked: false, defaults: {} },
	] };
	const source = scene.drawings.get('stroke001').toObject();
	source.flags = { foundryshop: { layerId: 'ink001' } };
	scene.drawings.set(source._id, doc(source));
	return source;
}

for (const [destination, applyCommand, restoreCommand] of [
	['Drawing', promptReviewedConsolidation, promptRestoreConsolidation],
	['Tile', promptReviewedTileBake, promptRestoreTileBake],
	['LevelBackground', promptReviewedBackgroundBake, promptRestoreBackgroundBake],
]) {
	test(`${destination} Restore accepts reviewed revision-only advancement and preserves current tree`, async () => {
		const original = recoveryLayer(destination !== 'Drawing'), before = scene.levels.get('level001').toObject();
		const settings = destination === 'Drawing' ? consolidationOptions({ audience: 'gm' })
			: { ...options, replacementId: destination === 'Tile' ? 'abcdefghijklmnop' : undefined,
				...(destination === 'Tile' ? { sort: 0 } : {}),
				verifyDisplay: async input => { assert.equal(input.replacement.type, destination); return true; } };
		await applyCommand(scene, settings, { reviewDialogs: dialogs() });
		scene.flags.layers.nodes[0].playerAllowed = !scene.flags.layers.nodes[0].playerAllowed;
		scene.flags.layers.revision++;
		scene.flags.layers.nodes[0].playerAllowed = !scene.flags.layers.nodes[0].playerAllowed;
		scene.flags.layers.revision++;
		const tree = structuredClone(scene.flags.layers), reviews = dialogs(), revisions = [];
		reviews.approveRestoreIntent = async r => { revisions.push(r.layerRevisionChange); return true; };
		reviews.approveExecution = async r => {
			revisions.push(r.layerRevisionChange);
			return { resumeOperation: true, sourceIds: r.sourceIds };
		};
		const later = { ...original, _id: 'later001', sort: 1024, x: 5 };
		scene.drawings.set(later._id, doc(later));
		const restored = await restoreCommand(scene, options.token, { token: 'restore001' }, { reviewDialogs: reviews });
		assert.equal(restored.status, 'complete');
		assert.deepEqual(revisions, [{ archived: 0, current: 2 }, { archived: 0, current: 2 }]);
		assert.deepEqual(scene.flags.layers, tree);
		assert.deepEqual(scene.drawings.get(original._id).toObject(), original);
		assert.deepEqual(scene.drawings.get(later._id).toObject(), later);
		assert.deepEqual(scene.levels.get('level001').toObject(), before);
		assert.equal(scene.tiles.size, 0);
		assert.equal(readOptimizationJournal(scene).entries.every(e => e.phase === 'complete'), true);
	});
}

test('Restore still refuses actual presentation differences before intent', async () => {
	recoveryLayer();
	await promptReviewedConsolidation(scene, consolidationOptions({ audience: 'gm' }), { reviewDialogs: dialogs() });
	const composite = scene.drawings.get('abcdefghijklmnop').toObject();
	scene.flags.layers.nodes[0].playerAllowed = true; scene.flags.layers.revision++;
	await assert.rejects(promptRestoreConsolidation(scene, options.token, { token: 'restore001' },
		{ reviewDialogs: dialogs() }), /layer context/);
	assert.equal(readOptimizationJournal(scene).entries.length, 1);
	assert.deepEqual(scene.drawings.get(composite._id).toObject(), composite);
});

for (const stage of ['approveRestoreIntent', 'approveExecution']) {
	test(`revision changes during ${stage} invalidate Restore rather than silently rebasing`, async () => {
		recoveryLayer();
		await promptReviewedConsolidation(scene, consolidationOptions({ audience: 'gm' }), { reviewDialogs: dialogs() });
		scene.flags.layers.revision = 2;
		const reviews = dialogs();
		reviews[stage] = async r => {
			scene.flags.layers.revision++;
			return stage === 'approveRestoreIntent' ? true : { resumeOperation: true, sourceIds: r.sourceIds };
		};
		await assert.rejects(promptRestoreConsolidation(scene, options.token, { token: 'restore001' },
			{ reviewDialogs: reviews }), /Stale|changed/i);
		assert.equal(scene.drawings.has('stroke001'), false);
		assert.equal(scene.drawings.has('abcdefghijklmnop'), true);
		assert.equal(readOptimizationJournal(scene).entries.length, stage === 'approveRestoreIntent' ? 1 : 2);
	});
}

test('revision-only Restore remains resumable after interruption with fresh disclosure', async () => {
	const original = recoveryLayer();
	await promptReviewedConsolidation(scene, consolidationOptions({ audience: 'gm' }), { reviewDialogs: dialogs() });
	scene.flags.layers.revision = 2;
	const native = scene.createEmbeddedDocuments;
	scene.createEmbeddedDocuments = async (...args) => {
		await native.apply(scene, args); throw new Error('restore response lost');
	};
	await assert.rejects(promptRestoreConsolidation(scene, options.token, { token: 'restore001' },
		{ reviewDialogs: dialogs() }), /restore response lost/);
	scene.createEmbeddedDocuments = native;
	scene.flags.layers.revision = 4;
	const reviews = dialogs();
	reviews.approveExecution = async r => {
		assert.deepEqual(r.layerRevisionChange, { archived: 0, current: 4 });
		return { resumeOperation: true, sourceIds: r.sourceIds };
	};
	const resumed = await promptResumeConsolidation(scene, 'restore001', {}, { reviewDialogs: reviews });
	assert.equal(resumed.status, 'complete');
	assert.equal(scene.flags.layers.revision, 4);
	assert.deepEqual(scene.drawings.get(original._id).toObject(), original);
});

test('Consolidate scope refuses intervening stack barriers before rendering', async () => {
	const source = scene.drawings.get('stroke001').toObject();
	scene.drawings.set('last001', doc({ ...source, _id: 'last001', sort: 20 }));
	scene.drawings.set('barrier001', doc({ ...source, _id: 'barrier001', sort: 10 }));
	await assert.rejects(prepareReviewedConsolidation(scene, consolidationOptions({
		readSelection: () => ['stroke001', 'last001'],
	})), /stack barrier/);
	assert.equal(files.size, 0);
	assert.equal(approvals.length, 1);
});

test('Consolidate selection cannot merge different leaf layers even when their native sorts are contiguous', async () => {
	scene.flags.layers = { version: 1, revision: 0, presets: [], nodes: ['upper001', 'lower001'].map(id => ({
		id, name: id, parentId: null, kind: 'layer', playerAllowed: true, locked: false, defaults: {},
	})) };
	const source = scene.drawings.get('stroke001').toObject();
	source.flags = { foundryshop: { layerId: 'lower001' } };
	scene.drawings.set(source._id, doc(source));
	scene.drawings.set('upperstroke', doc({ ...source, _id: 'upperstroke', sort: 1024,
		flags: { foundryshop: { layerId: 'upper001' } } }));
	await assert.rejects(prepareReviewedConsolidation(scene, consolidationOptions({
		readSelection: () => ['stroke001', 'upperstroke'],
	})), /one Drawing layer/);
	assert.equal(files.size, 0);
});

test('Consolidate tied sorts, custom bounds/sort and broad scopes refuse without writes', async () => {
	const source = scene.drawings.get('stroke001').toObject();
	scene.drawings.set('tie001', doc({ ...source, _id: 'tie001' }));
	await assert.rejects(prepareReviewedConsolidation(scene, consolidationOptions()), /stack ties/);
	scene.drawings.delete('tie001');
	for (const extra of [{ kind: 'all' }, { bounds: { x: 0, y: 0, width: 8, height: 4 } }, { sort: 1 }]) {
		await assert.rejects(prepareReviewedConsolidation(scene, consolidationOptions(extra)), /one leaf layer.*retained native sort/);
	}
	assert.equal(files.size, 0);
});

test('Consolidate stale selection invalidates preparation and exact membership remains unchanged', async () => {
	let selection = ['stroke001'];
	await assert.rejects(prepareReviewedConsolidation(scene, consolidationOptions({
		readSelection: () => selection,
		approveRender: async review => {
			selection = [];
			return { proceed: true, width: review.width, height: review.height, format: review.format,
				quality: review.quality, croppedSourceIds: review.croppedSourceIds };
		},
	})), /unique Drawing IDs|stale|context/);
	assert.equal(files.size, 0); assert.equal(scene.drawings.size, 1);
});

test('Consolidate partial source deletion resumes without duplicating its Drawing replacement', async () => {
	const native = scene.deleteEmbeddedDocuments;
	const original = scene.drawings.get('stroke001').toObject();
	scene.drawings.set('stroke002', doc({ ...original, _id: 'stroke002', sort: 10 }));
	scene.drawings.set('stroke003', doc({ ...original, _id: 'stroke003', sort: 20 }));
	const ids = ['stroke001', 'stroke002', 'stroke003'];
	scene.deleteEmbeddedDocuments = async (...args) => {
		await native.call(scene, args[0], args[1].slice(0, 1), args[2]);
		throw new Error('source deletion completion lost');
	};
	await assert.rejects(promptReviewedConsolidation(scene, consolidationOptions({
		readSelection: () => ids.filter(id => scene.drawings.has(id)),
	}), { reviewDialogs: dialogs() }),
		/source deletion completion lost/);
	scene.deleteEmbeddedDocuments = native;
	assert.equal(scene.drawings.size, 3);
	assert.equal(readOptimizationJournal(scene).entries.at(-1).phase, 'replacement-staged');
	const resumed = await promptResumeConsolidation(scene, options.token,
		{ verifyDisplay: consolidationOptions().verifyDisplay }, { reviewDialogs: dialogs() });
	assert.equal(resumed.status, 'complete');
	assert.equal(scene.drawings.size, 1);
	assert.equal(scene.drawings.get('abcdefghijklmnop').toObject().hidden, false);
});

test('Consolidate partially staged Restore resumes exact originals and preserves later artwork', async () => {
	const first = scene.drawings.get('stroke001').toObject();
	const originals = [first, { ...first, _id: 'stroke002', sort: 10 }];
	scene.drawings.set('stroke002', doc(originals[1]));
	await promptReviewedConsolidation(scene, consolidationOptions({
		readSelection: () => originals.map(source => source._id).filter(id => scene.drawings.has(id)),
	}), { reviewDialogs: dialogs() });
	const later = { ...first, _id: 'later001', sort: 100 };
	scene.drawings.set(later._id, doc(later));
	const native = scene.createEmbeddedDocuments;
	scene.createEmbeddedDocuments = async (type, sources, operation) => {
		await native.call(scene, type, sources.slice(0, 1), operation);
		throw new Error('original staging interrupted');
	};
	await assert.rejects(promptRestoreConsolidation(scene, options.token, { token: 'restore001' },
		{ reviewDialogs: dialogs() }), /original staging interrupted/);
	assert.equal(scene.drawings.get(first._id).toObject().hidden, true);
	scene.createEmbeddedDocuments = native;
	const result = await promptResumeConsolidation(scene, 'restore001', {}, { reviewDialogs: dialogs() });
	assert.equal(result.status, 'complete');
	for (const original of originals) assert.deepEqual(scene.drawings.get(original._id).toObject(), original);
	assert.deepEqual(scene.drawings.get(later._id).toObject(), later);
	assert.equal(scene.drawings.has('abcdefghijklmnop'), false);
});
test('Consolidate edited or reassigned composite refuses Restore before intent writes', async () => {
	await promptReviewedConsolidation(scene, consolidationOptions(), { reviewDialogs: dialogs() });
	const before = readOptimizationJournal(scene);
	const composite = scene.drawings.get('abcdefghijklmnop').toObject();
	scene.drawings.set(composite._id, doc({ ...composite, x: composite.x + 1 }));
	await assert.rejects(promptRestoreConsolidation(scene, options.token, { token: 'restore001' },
		{ reviewDialogs: dialogs() }), /conflict|changed|edited|matching|RestoreConflict/);
	assert.deepEqual(readOptimizationJournal(scene), before);
});

test('Consolidate player attempts and cross-destination resume refuse without writes', async () => {
	game.user.isGM = false;
	await assert.rejects(promptReviewedConsolidation(scene, consolidationOptions(), { reviewDialogs: dialogs() }), /Changed/);
	assert.equal(files.size, 0); assert.equal(readOptimizationJournal(scene).entries.length, 0);
});

test('repeat Consolidate retains immutable parent lineage and supports successive exact expansion', async () => {
	const original = scene.drawings.get('stroke001').toObject();
	await promptReviewedConsolidation(scene, consolidationOptions(), { reviewDialogs: dialogs() });
	const first = scene.drawings.get('abcdefghijklmnop').toObject();
	const later = { ...original, _id: 'later001', sort: 1024, x: 5 };
	scene.drawings.set(later._id, doc(later));
	const secondToken = 'consolidation002';
	await promptReviewedConsolidation(scene, consolidationOptions({
		token: secondToken, replacementId: 'qrstuvwxyzABCDEF',
		readSelection: () => ['abcdefghijklmnop', 'later001'].filter(id => scene.drawings.has(id)),
	}), { reviewDialogs: dialogs() });
	const entry = readOptimizationJournal(scene).entries.at(-1);
	assert.equal(entry.parentToken, options.token);
	const { payload } = await readStoredOptimizationArchive(entry.archive, { isCurrent: () => true });
	assert.deepEqual(payload.parent, {
		file: readOptimizationJournal(scene).entries[0].archive,
		checksum: readOptimizationJournal(scene).entries[0].archiveChecksum,
	});
	await promptRestoreConsolidation(scene, secondToken, { token: 'restore002' }, { reviewDialogs: dialogs() });
	assert.deepEqual(scene.drawings.get(first._id).toObject(), first);
	assert.deepEqual(scene.drawings.get(later._id).toObject(), later);
	await promptRestoreConsolidation(scene, options.token, { token: 'restore001' }, { reviewDialogs: dialogs() });
	assert.deepEqual(scene.drawings.get(original._id).toObject(), original);
	assert.deepEqual(scene.drawings.get(later._id).toObject(), later);
	assert.equal(scene.drawings.size, 2);
});

test('Bake to Tile from a consolidated Drawing retains original-stroke lineage through both Restore stages', async () => {
	const original = scene.drawings.get('stroke001').toObject();
	await promptReviewedConsolidation(scene, consolidationOptions(), { reviewDialogs: dialogs() });
	const composite = scene.drawings.get('abcdefghijklmnop').toObject();
	const tileOptions = { ...consolidationOptions(), token: 'tile002', replacementId: 'qrstuvwxyzABCDEF', sort: 0,
		readSelection: () => ['abcdefghijklmnop'].filter(id => scene.drawings.has(id)),
		verifyDisplay: async input => { assert.equal(input.replacement.type, 'Tile'); return true; } };
	const nativeDelete = scene.deleteEmbeddedDocuments;
	scene.deleteEmbeddedDocuments = async (type, ids, operation) => {
		if (type === 'Tile') ids.forEach(id => scene.tiles.delete(id));
		else await nativeDelete.call(scene, type, ids, operation);
	};
	await promptReviewedTileBake(scene, tileOptions, { reviewDialogs: dialogs() });
	assert.equal(readOptimizationJournal(scene).entries.at(-1).parentToken, options.token);
	assert.equal(scene.drawings.size, 0);
	await promptRestoreTileBake(scene, tileOptions.token, { token: 'tilerestore002' }, { reviewDialogs: dialogs() });
	assert.deepEqual(scene.drawings.get(composite._id).toObject(), composite);
	await promptRestoreConsolidation(scene, options.token, { token: 'restore001' }, { reviewDialogs: dialogs() });
	assert.deepEqual(scene.drawings.get(original._id).toObject(), original);
	assert.equal(scene.tiles.size, 0);
});

test('repeat Consolidate refuses a missing original-stroke ancestor before rendering or new journal writes', async () => {
	await promptReviewedConsolidation(scene, consolidationOptions(), { reviewDialogs: dialogs() });
	const before = readOptimizationJournal(scene), source = scene.drawings.get('abcdefghijklmnop').toObject();
	files.delete(before.entries[0].archive.path);
	await assert.rejects(promptReviewedConsolidation(scene, consolidationOptions({
		token: 'consolidation002', replacementId: 'qrstuvwxyzABCDEF',
		readSelection: () => ['abcdefghijklmnop'],
	}), { reviewDialogs: dialogs() }), /404|read|fetch|missing/i);
	assert.deepEqual(readOptimizationJournal(scene), before);
	assert.deepEqual(scene.drawings.get(source._id).toObject(), source);
});

test('repeat Consolidate rechecks ancestor recovery after execution approval before removing its composite', async () => {
	await promptReviewedConsolidation(scene, consolidationOptions(), { reviewDialogs: dialogs() });
	const parent = readOptimizationJournal(scene).entries[0];
	const reviewDialogs = dialogs();
	reviewDialogs.approveExecution = async review => {
		files.delete(parent.archive.path);
		return { resumeOperation: true, sourceIds: review.sourceIds };
	};
	await assert.rejects(promptReviewedConsolidation(scene, consolidationOptions({
		token: 'consolidation002', replacementId: 'qrstuvwxyzABCDEF',
		readSelection: () => ['abcdefghijklmnop'].filter(id => scene.drawings.has(id)),
	}), { reviewDialogs }), /404|read|fetch|missing/i);
	assert.equal(scene.drawings.has('abcdefghijklmnop'), true);
	assert.equal(scene.drawings.has('qrstuvwxyzABCDEF'), false);
});

test('Consolidate disconnected-owner takeover shares reviewed resume and cannot use the Tile command', async () => {
	const native = scene.createEmbeddedDocuments;
	scene.createEmbeddedDocuments = async () => { throw new Error('staged creation interrupted'); };
	await assert.rejects(promptReviewedConsolidation(scene, consolidationOptions(), { reviewDialogs: dialogs() }),
		/staged creation interrupted/);
	scene.createEmbeddedDocuments = native;
	game.users.get = id => id === 'gm001' ? { id, active: false } : null;
	game.user.id = 'gm002'; game.users.activeGM.id = 'gm002';
	const resumed = await promptTakeOverConsolidation(scene, options.token,
		{ verifyDisplay: consolidationOptions().verifyDisplay }, { reviewDialogs: dialogs() });
	assert.equal(resumed.status, 'complete');
	assert.equal(readOptimizationJournal(scene).entries[0].ownerId, 'gm002');
	assert.equal(scene.drawings.size, 1);
});

test('existing image bytes are backed up, included in exact path approval and archived for Restore', async () => {
	level.background.src = 'maps/original.png'; scene.levels.set(level._id, doc(level));
	files.set(level.background.src, new Uint8Array(await png(8, 4).arrayBuffer()));
	const workflow = await prepare();
	const backup = `${root}/background-original-background001.png`;
	assert.ok(workflow.review.paths.includes(backup));
	assert.ok(paint.some(entry => entry[0] === 'image'));
	assert.ok(closed > 0);
	await assert.rejects(workflow.persistAssets({ approvedPaths: workflow.review.paths.filter(p => p !== backup) }), /exactly/);
	assert.equal(readOptimizationJournal(scene).entries.length, 0);
	await workflow.persistAssets({ approvedPaths: workflow.review.paths });
	const entry = readOptimizationJournal(scene).entries[0];
	const { payload } = await readStoredOptimizationArchive(entry.archive, { isCurrent: () => true });
	assert.equal(payload.originalBackground.src, level.background.src);
	assert.deepEqual(files.get(backup), files.get(level.background.src));
	await apply(workflow);
});

test('private audience, custom bounds and Tile-only options refuse before rendering or writes', async () => {
	for (const extra of [{ audience: 'gm' }, { bounds: { x: 0, y: 0, width: 8, height: 4 } },
		{ sort: 0 }, { replacementId: 'abcdefghijklmnop' }]) {
		await assert.rejects(prepare(extra), /public audience, full Scene bounds/);
	}
	assert.equal(files.size, 0); assert.equal(approvals.length, 0);
});

test('shared nonidentity background transforms and declined native acceptance fail before persistence', async () => {
	level.textures.rotation = 10; scene.levels.set(level._id, doc(level));
	await assert.rejects(prepare(), /identity shared/);
	level.textures.rotation = 0; scene.levels.set(level._id, doc(level));
	await assert.rejects(prepare({ verifyDisplay: async () => false }), /display capability/);
	assert.equal(files.size, 0); assert.equal(readOptimizationJournal(scene).entries.length, 0);
});

test('Tile workflow cannot opt into background by passing a destination option', async () => {
	await assert.rejects(prepareReviewedTileBake(scene, { ...options, destination: 'background' }), /valid destination options/);
	assert.equal(files.size, 0);
});

test('shared workflow preserves transparent Tile preparation and native apply behavior', async () => {
	const before = scene.levels.get('level001').toObject();
	const workflow = await prepareReviewedTileBake(scene, { ...options, replacementId: 'abcdefghijklmnop', sort: 0,
		verifyDisplay: async input => { assert.equal(input.replacement.type, 'Tile'); return true; } });
	assert.equal(workflow.review.scope.destination, 'tile');
	assert.deepEqual(workflow.review.render.bounds, { x: 2, y: 1, width: 4, height: 2 });
	assert.equal(workflow.review.paths.length, 2);
	await workflow.persistAssets({ approvedPaths: workflow.review.paths });
	await apply(workflow);
	assert.equal(scene.tiles.size, 1);
	assert.equal(scene.tiles.get('abcdefghijklmnop').toObject().hidden, false);
	assert.deepEqual(scene.levels.get('level001').toObject(), before);
});

function dialogs() {
	return { ...options, approvePersistence: async r => ({ approvedPaths: r.paths }),
		approveExecution: async r => ({ resumeOperation: true, sourceIds: r.sourceIds }),
		approveRestoreIntent: async () => true, approveTakeover: async () => true };
}

test('public background apply and Restore preserve exact Level settings, archived strokes and later artwork', async () => {
	const original = scene.drawings.get('stroke001').toObject();
	const before = scene.levels.get('level001').toObject();
	const result = await promptReviewedBackgroundBake(scene, { ...options, kind: 'selection' },
		{ reviewDialogs: dialogs() });
	assert.equal(result.status, 'complete');
	await assert.rejects(promptRestoreTileBake(scene, options.token), /RestoreInvalid/);
	const later = { ...original, _id: 'later001', x: 5 };
	scene.drawings.set(later._id, doc(later));
	const restored = await promptRestoreBackgroundBake(scene, options.token, {
		token: 'restore001', verifyDisplay: async () => { assert.fail('Restore must not depend on GPU acceptance'); },
	}, { reviewDialogs: dialogs() });
	assert.equal(restored.status, 'complete');
	assert.deepEqual(scene.drawings.get(original._id).toObject(), original);
	assert.deepEqual(scene.drawings.get(later._id).toObject(), later);
	assert.deepEqual(scene.levels.get('level001').toObject(), before);
	assert.equal(scene.tiles.size, 0);
	assert.equal(readOptimizationJournal(scene).entries.every(e => e.phase === 'complete'), true);
});

for (const recovery of ['restore', 'resume', 'takeover']) {
	test(`rebound background ${recovery} verifies retained image dimensions separately from destination Scene mapping`, async () => {
		const original = scene.drawings.get('stroke001').toObject(), before = structuredClone(level);
		await promptReviewedBackgroundBake(scene, options, { reviewDialogs: dialogs() });
		const entry = readOptimizationJournal(scene).entries[0];
		const { payload } = await readStoredOptimizationArchive(entry.archive, { isCurrent: () => current });
		scene.width = 10; scene.height = 7;
		scene.getDimensions = () => ({ sceneRect: { x: 0, y: 0, width: 10, height: 7 } });
		payload.context.scene.width = 10; payload.context.scene.height = 7;
		const { text } = await encodeOptimizationArchive(payload), reference = await prepareOptimizationArchiveFile(text, root);
		files.set(reference.path, new TextEncoder().encode(text));
		scene.flags.optimizationJournal.entries[0] = { ...entry,
			...await optimizationArchiveDescriptor(text), archive: reference };
		const assetBytes = files.get(entry.asset.path);
		assert.equal(inspectOptimizationImage(assetBytes).width, 8);
		const reviews = dialogs(), previews = [];
		reviews.approvePreview = async (blob, review) => { previews.push(review.render); return true; };
		const native = scene.createEmbeddedDocuments;
		if (recovery !== 'restore') scene.createEmbeddedDocuments = async () => { throw new Error('Restore interrupted'); };
		const restore = () => promptRestoreBackgroundBake(scene, options.token, { token: 'restore001' },
			{ reviewDialogs: reviews });
		let result;
		if (recovery === 'restore') result = await restore();
		else {
			await assert.rejects(restore(), /Restore interrupted/);
			scene.createEmbeddedDocuments = native;
			if (recovery === 'takeover') {
				game.user = { id: 'gm002', isGM: true, can: () => true };
				game.users = { activeGM: { id: 'gm002' }, get: id => ({ id, active: false }) };
				result = await promptTakeOverBackgroundBake(scene, 'restore001', {}, { reviewDialogs: reviews });
			} else result = await promptResumeBackgroundBake(scene, 'restore001', {}, { reviewDialogs: reviews });
		}
		assert.equal(result.status, 'complete');
		assert.deepEqual(scene.drawings.get(original._id).toObject(), original);
		assert.deepEqual(scene.levels.get(level._id).toObject(), before);
		assert.deepEqual(files.get(entry.asset.path), assetBytes);
		assert.ok(previews.length > 0);
		assert.equal(previews.every(r => r.width === 8 && r.height === 4
			&& r.bounds.width === 10 && r.bounds.height === 7), true);
	});
}

test('public resume reconciles a persisted background update with a lost response', async () => {
	const native = scene.updateEmbeddedDocuments;
	scene.updateEmbeddedDocuments = async (...args) => {
		await native.apply(scene, args); throw new Error('background update response lost');
	};
	await assert.rejects(promptReviewedBackgroundBake(scene, options, { reviewDialogs: dialogs() }),
		/background update response lost/);
	assert.equal(readOptimizationJournal(scene).entries.at(-1).phase, 'assets-verified');
	assert.equal(scene.drawings.size, 1);
	scene.updateEmbeddedDocuments = native;
	await assert.rejects(promptResumeTileBake(scene, options.token), /ResumeInvalid/);
	const resumed = await promptResumeBackgroundBake(scene, options.token,
		{ verifyDisplay: options.verifyDisplay }, { reviewDialogs: dialogs() });
	assert.equal(resumed.status, 'complete');
	assert.equal(scene.drawings.size, 0);
});

test('background disconnected-owner takeover uses verified evidence and ordinary resume', async () => {
	const native = scene.updateEmbeddedDocuments;
	scene.updateEmbeddedDocuments = async () => { throw new Error('native update interrupted'); };
	await assert.rejects(promptReviewedBackgroundBake(scene, options, { reviewDialogs: dialogs() }), /interrupted/);
	scene.updateEmbeddedDocuments = native;
	game.user = { id: 'gm002', isGM: true, can: () => true };
	game.users = { activeGM: { id: 'gm002' }, get: id => ({ id, active: false }) };
	const result = await promptTakeOverBackgroundBake(scene, options.token,
		{ verifyDisplay: options.verifyDisplay }, { reviewDialogs: dialogs() });
	assert.equal(result.status, 'complete');
	assert.equal(result.ownershipTransferred, true);
	assert.equal(readOptimizationJournal(scene).entries.at(-1).ownerId, 'gm002');
});

test('background Restore refuses changed original URL bytes before intent, then restores after exact file recovery', async () => {
	level.background.src = 'maps/original.png'; scene.levels.set(level._id, doc(level));
	const originalBytes = new Uint8Array(await png(8, 4).arrayBuffer());
	files.set(level.background.src, originalBytes);
	await promptReviewedBackgroundBake(scene, options, { reviewDialogs: dialogs() });
	files.set(level.background.src, new Uint8Array(await png(4, 2).arrayBuffer()));
	await assert.rejects(promptRestoreBackgroundBake(scene, options.token, { token: 'restore001' },
		{ reviewDialogs: dialogs() }), /BackgroundOriginalChanged/);
	assert.equal(readOptimizationJournal(scene).entries.length, 1);
	assert.equal(scene.drawings.size, 0);
	files.set(level.background.src, originalBytes);
	const result = await promptRestoreBackgroundBake(scene, options.token, { token: 'restore001' },
		{ reviewDialogs: dialogs() });
	assert.equal(result.status, 'complete');
	assert.deepEqual(scene.levels.get('level001').toObject(), level);
});

test('original background changing after Restore intent is rechecked before replacement reversion', async () => {
	level.background.src = 'maps/original.png'; scene.levels.set(level._id, doc(level));
	files.set(level.background.src, new Uint8Array(await png(8, 4).arrayBuffer()));
	await promptReviewedBackgroundBake(scene, options, { reviewDialogs: dialogs() });
	const reviews = dialogs();
	reviews.approveExecution = async r => {
		files.set(level.background.src, new Uint8Array(await png(4, 2).arrayBuffer()));
		return { resumeOperation: true, sourceIds: r.sourceIds };
	};
	await assert.rejects(promptRestoreBackgroundBake(scene, options.token, { token: 'restore001' },
		{ reviewDialogs: reviews }), /BackgroundOriginalChanged/);
	assert.equal(readOptimizationJournal(scene).entries.at(-1).phase, 'originals-staged');
	assert.equal(scene.levels.get('level001').toObject().background.src, `${root}/bake-background001.png`);
	assert.equal(scene.drawings.get('stroke001').toObject().hidden, true);
});

test('public background apply and Restore wait for owned canvas redraw and accept its selection clear', async () => {
	const view = canvas, native = scene.updateEmbeddedDocuments;
	let controlled = ['stroke001'], redraws = 0;
	Object.defineProperty(view.drawings, 'controlled', {
		get: () => controlled.filter(id => scene.drawings.has(id)).map(id => ({ document: { id } })),
	});
	scene.updateEmbeddedDocuments = async (...args) => {
		await native.apply(scene, args);
		if (args[0] !== 'Level') return;
		view.ready = false; controlled = [];
		setTimeout(() => { redraws++; view.ready = true; }, 40);
	};
	const result = await promptReviewedBackgroundBake(scene, { ...options, kind: 'selection' },
		{ reviewDialogs: dialogs() });
	assert.equal(result.status, 'complete'); assert.equal(redraws, 1);
	assert.equal(scene.drawings.size, 0);
	const restored = await promptRestoreBackgroundBake(scene, options.token, { token: 'restore001' },
		{ reviewDialogs: dialogs() });
	assert.equal(restored.status, 'complete'); assert.equal(redraws, 2);
	assert.equal(scene.drawings.get('stroke001').toObject().hidden, false);
});

test('background redraw timeout retains the updated background and every original', async () => {
	const native = scene.updateEmbeddedDocuments;
	scene.updateEmbeddedDocuments = async (...args) => { await native.apply(scene, args); canvas.ready = false; };
	await assert.rejects(promptReviewedBackgroundBake(scene, { ...options, timeout: 100 },
		{ reviewDialogs: dialogs() }), /redraw timed out/);
	assert.equal(scene.drawings.size, 1);
	assert.equal(readOptimizationJournal(scene).entries.at(-1).phase, 'assets-verified');
});

test('unrelated native edits or unexpected selection during background redraw refuse source removal', async () => {
	for (const mode of ['native', 'selection']) {
		const view = canvas, native = scene.updateEmbeddedDocuments;
		let controlled = ['stroke001'];
		Object.defineProperty(view.drawings, 'controlled', {
			configurable: true, get: () => controlled.map(id => ({ document: { id } })),
		});

		scene.updateEmbeddedDocuments = async (...args) => {
			await native.apply(scene, args); view.ready = false;
			setTimeout(() => {
				if (mode === 'native') scene.width = 9;
				else controlled = ['unexpected001'];
				view.ready = true;
			}, 5);
		};
		await assert.rejects(promptReviewedBackgroundBake(scene, { ...options, kind: 'selection' },
			{ reviewDialogs: dialogs() }), mode === 'native' ? /stale|context|native state/ : /Unexpected selection/);
		assert.equal(scene.drawings.size, 1);
		assert.equal(readOptimizationJournal(scene).entries.at(-1).phase, 'assets-verified');
		scene.width = 8; scene.flags.optimizationJournal = undefined;
		scene.levels.set(level._id, doc(level)); files.clear();
		scene.updateEmbeddedDocuments = native;
	}
});

test('background redraw cancellation or designated GM change retains originals without advancing the journal', async () => {
	for (const mode of ['cancel', 'authority']) {
		const controller = new AbortController(), native = scene.updateEmbeddedDocuments;
		scene.updateEmbeddedDocuments = async (...args) => {
			await native.apply(scene, args); canvas.ready = false;
			setTimeout(() => {
				if (mode === 'cancel') controller.abort();
				else game.users.activeGM.id = 'gm002';
			}, 5);
		};
		await assert.rejects(promptReviewedBackgroundBake(scene, { ...options, signal: controller.signal },
			{ reviewDialogs: dialogs() }), /redraw authority/);
		assert.equal(scene.drawings.size, 1);
		assert.equal(readOptimizationJournal(scene).entries.at(-1).phase, 'assets-verified');
		canvas.ready = true; game.users.activeGM.id = 'gm001';
		scene.flags.optimizationJournal = undefined; scene.levels.set(level._id, doc(level)); files.clear();
		scene.updateEmbeddedDocuments = native;
	}
});
