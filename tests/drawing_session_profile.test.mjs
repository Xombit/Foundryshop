import test from 'node:test';
import assert from 'node:assert/strict';
import { DrawingSessionProfile } from '../tools/drawing-session-profile.mjs';

function fixture() {
	const state = { created: [], deleted: [], batches: [], source: { name: 'Original' } };
	const viewPosition = { x: 20, y: 30, scale: 0.75 };
	const original = {
		_viewPosition: viewPosition,
		toObject: () => structuredClone(state.source),
		async view() { canvas.scene = original; },
	};
	const layer = { controlled: [], activate() { canvas.activeLayer = this; } };
	const drawings = { activate() { canvas.activeLayer = this; } };
	const scene = {
		drawings: new Map(),
		async view() { canvas.scene = this; },
		async delete() { state.deleted.push(this); },
		async createEmbeddedDocuments(type, sources) {
			assert.equal(type, 'Drawing');
			state.batches.push(sources);
			if (state.failBatch === state.batches.length) throw new Error('Batch failed');
			for (const source of sources) this.drawings.set(this.drawings.size, source);
		},
	};
	globalThis.game = { user: { isGM: true } };
	globalThis.canvas = {
		ready: true, scene: original, activeLayer: layer, drawings, level: { id: 'level' },
		stage: { pivot: { x: 20, y: 30 }, scale: { x: 0.75 } },
		pan({ x, y, scale }) {
			Object.assign(this.stage.pivot, { x, y });
			this.stage.scale.x = scale;
			this.scene._viewPosition = { x, y, scale };
		},
	};
	globalThis.document = { visibilityState: 'visible' };
	globalThis.requestAnimationFrame = callback => queueMicrotask(() => callback(performance.now()));
	globalThis.getDocumentClass = () => ({
		async create(source) { state.created.push(source); return scene; },
	});
	const profile = new DrawingSessionProfile();
	const nativeSample = profile.sample;
	profile.sample = async count => ({ count });
	return { state, original, scene, layer, viewPosition, profile, nativeSample };
}

test('profile requires a new, deselected, ready GM canvas and a known workload', async () => {
	const f = fixture();
	for (const profile of ['unknown', null]) await assert.rejects(f.profile.start(profile), /idle GM/);
	game.user.isGM = false;
	await assert.rejects(f.profile.start('map'), /idle GM/);
	game.user.isGM = true;
	canvas.ready = false;
	await assert.rejects(f.profile.start('map'), /idle GM/);
	canvas.ready = true;
	f.layer.controlled.push({});
	await assert.rejects(f.profile.start('map'), /Deselect/);
	assert.equal(f.state.created.length, 0);
});

test('cleanup deletes only the fixture and restores source, layer, pan and client view identity', async () => {
	const f = fixture();
	await f.profile.start('map');
	assert.equal(canvas.scene, f.scene);
	assert.equal(f.state.created[0].width, 1600);
	assert.equal(f.state.created[0].grid.type, 0);
	const result = await f.profile.cleanup();
	assert.equal(result.cleaned, true);
	assert.equal(result.clientRestored, true);
	assert.equal(result.originalUnchanged, true);
	assert.deepEqual(f.state.deleted, [f.scene]);
	assert.equal(canvas.scene, f.original);
	assert.equal(canvas.activeLayer, f.layer);
	assert.deepEqual(canvas.stage.pivot, { x: 20, y: 30 });
	assert.equal(f.original._viewPosition, f.viewPosition);
	await f.profile.cleanup();
	assert.equal(f.state.deleted.length, 1);
	await assert.rejects(f.profile.start('detail'), /new map\/detail fixture/);
});

test('checkpoints refuse invalid bounds, hidden browser, altered fixture and wrong Scene', async () => {
	const f = fixture();
	await assert.rejects(f.nativeSample.call(f.profile, 0), /Invalid profile/);
	await f.profile.start('detail');
	for (const count of [-1, 0.5, 2001, NaN]) {
		await assert.rejects(f.nativeSample.call(f.profile, count), /Invalid profile/);
	}
	document.visibilityState = 'hidden';
	await assert.rejects(f.nativeSample.call(f.profile, 0), /Invalid profile/);
	document.visibilityState = 'visible';
	f.scene.drawings.set('unrelated', {});
	await assert.rejects(f.nativeSample.call(f.profile, 100), /Invalid profile/);
	f.scene.drawings.clear();
	canvas.scene = f.original;
	await assert.rejects(f.nativeSample.call(f.profile, 100), /Invalid profile/);
	assert.equal(f.state.batches.length, 0);
	await f.profile.cleanup();
});

test('partial batch failure retains progress and bounded map sources without touching originals', async () => {
	const f = fixture();
	await f.profile.start('map');
	f.state.failBatch = 2;
	await assert.rejects(f.nativeSample.call(f.profile, 250), /Batch failed/);
	assert.equal(f.scene.drawings.size, 100);
	assert.deepEqual(f.state.batches.map(batch => batch.length), [100, 100]);
	const source = f.state.batches[0][0];
	assert.equal(source.shape.points.length, 24);
	assert.equal(source.strokeWidth, 6);
	assert.deepEqual(source.levels, ['level']);
	assert.equal(source.bezierFactor, 0.5);
	await assert.rejects(f.nativeSample.call(f.profile, 50), /Invalid profile/);
	assert.equal((await f.profile.cleanup()).originalUnchanged, true);
});

test('concurrent checkpoints and cleanup cannot race an outstanding creation', async () => {
	const f = fixture();
	await f.profile.start('detail');
	let rejectBatch;
	f.scene.createEmbeddedDocuments = async (_type, sources) => {
		assert.equal(sources.length, 100);
		assert.equal(sources[0].shape.points.length, 64);
		assert.equal(sources[0].strokeWidth, 2);
		await new Promise((_resolve, reject) => { rejectBatch = reject; });
	};
	const pending = f.nativeSample.call(f.profile, 100);
	await assert.rejects(f.nativeSample.call(f.profile, 100), /Invalid profile/);
	await assert.rejects(f.profile.cleanup(), /Wait for/);
	rejectBatch(new Error('Stopped'));
	await assert.rejects(pending, /Stopped/);
	assert.equal((await f.profile.cleanup()).cleaned, true);
});

test('failed view restoration still deletes the owned fixture and reports failure', async () => {
	const f = fixture();
	await f.profile.start('map');
	f.original.view = async () => { throw new Error('View failed'); };
	await assert.rejects(f.profile.cleanup(), error => {
		assert.equal(error.errors[0].message, 'View failed');
		return true;
	});
	assert.deepEqual(f.state.deleted, [f.scene]);
});

test('cleanup reports original source changes after removing its fixture', async () => {
	const f = fixture();
	await f.profile.start('map');
	f.state.source.name = 'Changed externally';
	await assert.rejects(f.profile.cleanup(), error => {
		assert.match(error.errors[0].message, /Original Scene source changed/);
		return true;
	});
	assert.deepEqual(f.state.deleted, [f.scene]);
	assert.equal(f.state.source.name, 'Changed externally');
});

test('cleanup preserves an independently selected Scene and exposes that the view was not restored', async () => {
	const f = fixture();
	await f.profile.start('map');
	const other = {};
	canvas.scene = other;
	const result = await f.profile.cleanup();
	assert.equal(result.clientRestored, false);
	assert.equal(canvas.scene, other);
	assert.deepEqual(f.state.deleted, [f.scene]);
});
