import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOptimizationArchive, readOptimizationArchive } from '../scripts/layers/optimization_recovery.js';
import { assertOptimizationNativeSchemas, optimizationNativeVerifier } from '../scripts/layers/optimization_native.js';

let scene, original, replacement, options, calls, normalize, failType, current;
beforeEach(() => {
	calls = []; normalize = false; failType = null; current = true;
	globalThis.game = { user: { isGM: true }, i18n: { localize: key => key } };
	original = { _id: 'original', author: 'gm', levels: ['level'], flags: {}, shape: { type: 'p' }, hidden: false };
	const level = { _id: 'level', background: { src: null }, textures: {}, flags: {} };
	scene = { id: 'scene', width: 8000, height: 6000, padding: 0, grid: { toObject: () => ({ size: 100 }) },
		levels: new Map([['level', { toObject: () => structuredClone(level) }]]),
		drawings: new Map([['original', { toObject: () => structuredClone(original) }]]), tiles: new Map(),
		getFlag: () => undefined };
	const output = { version: 1, root: 'worlds/test', path: 'worlds/test/output.webp', bytes: 10, fingerprint: 'a'.repeat(64) };
	const after = { _id: 'tile', levels: ['level'], flags: {}, texture: { src: output.path }, hidden: false };
	replacement = { type: 'Tile', id: 'tile', before: null, staged: { ...after, hidden: true }, after };
	options = { token: 'operation', levelId: 'level', scope: { kind: 'selection', layerId: null }, output };
	globalThis.getDocumentClass = type => class {
		constructor(source, context) {
			calls.push({ type, source: structuredClone(source), context });
			if (failType === type) throw new Error(`Native ${type} validation failed`);
			this.source = structuredClone(source);
			if (normalize) this.source.normalized = true;
		}
		toObject() { return structuredClone(this.source); }
	};
});
const archive = () => createOptimizationArchive(scene, ['original'], replacement, options);
const operation = { action: 'apply', phase: 'assets-verified' };

test('strict detached schema checks include exact originals, hidden restore sources and replacement states', async () => {
	const { payload } = await readOptimizationArchive((await archive()).text);
	assert.equal(assertOptimizationNativeSchemas(scene, payload), true);
	assert.deepEqual(calls.map(call => call.type), ['Level', 'Drawing', 'Drawing', 'Tile', 'Tile']);
	assert.equal(calls[1].source.hidden, false);
	assert.equal(calls[2].source.hidden, true);
	assert.equal(calls.every(call => call.context.parent === scene && call.context.strict === true), true);
	assert.equal(scene.drawings.size, 1);
	assert.equal(scene.tiles.size, 0);
});

test('Drawing and Level-background replacements select their native document classes', async () => {
	replacement.type = 'Drawing';
	for (const state of [replacement.staged, replacement.after]) {
		state.author = 'gm'; state.shape = { type: 'r' }; state.texture = options.output.path;
	}
	assertOptimizationNativeSchemas(scene, (await readOptimizationArchive((await archive()).text)).payload);
	assert.equal(calls.filter(call => call.type === 'Drawing').length, 4);
	calls = [];
	const before = scene.levels.get('level').toObject(), after = structuredClone(before);
	after.background.src = options.output.path;
	replacement = { type: 'LevelBackground', id: 'level', before, staged: null, after };
	assertOptimizationNativeSchemas(scene, (await readOptimizationArchive((await archive()).text)).payload);
	assert.equal(calls.filter(call => call.type === 'Level').length, 3);
});

test('schema failures and normalization changes refuse instead of silently changing originals/output', async () => {
	const { payload } = await readOptimizationArchive((await archive()).text);
	normalize = true;
	assert.throws(() => assertOptimizationNativeSchemas(scene, payload), /normalization/);
	normalize = false; failType = 'Tile';
	assert.throws(() => assertOptimizationNativeSchemas(scene, payload), /validation failed/);
	assert.equal(scene.tiles.size, 0);
});

test('bound verifier combines archive identity, strict schema and explicit placement review', async () => {
	const created = await archive(), { payload } = await readOptimizationArchive(created.text);
	let placementCalls = 0;
	const verify = await optimizationNativeVerifier(scene, created.text, {
		isCurrent: () => current, verifyPlacement: async candidate => {
			placementCalls++; candidate.originals.length = 0; return true;
		},
	});
	assert.equal(await verify(payload, operation), true);
	assert.equal(placementCalls, 1);
	assert.equal(payload.originals.length, 1);
	payload.originals[0].name = 'changed';
	await assert.rejects(verify(payload, operation), /checksum/);
	assert.equal(placementCalls, 1);
});

test('missing/false placement checks, stale context, wrong Scene or lost authority cannot pass', async () => {
	const created = await archive(), { payload } = await readOptimizationArchive(created.text);
	await assert.rejects(optimizationNativeVerifier(scene, created.text, { isCurrent: () => true }), /explicit/);
	const verify = await optimizationNativeVerifier(scene, created.text, {
		isCurrent: () => current, verifyPlacement: async () => false,
	});
	await assert.rejects(verify(payload, operation), /acceptance failed/);
	current = false;
	await assert.rejects(verify(payload, operation), /context/);
	current = true; scene.id = 'other';
	await assert.rejects(verify(payload, operation), /Scene/);
	scene.id = 'scene'; game.user.isGM = false;
	await assert.rejects(verify(payload, operation), /authority/);
});

test('async placement authority loss and invalid operation steps refuse acceptance', async () => {
	const created = await archive(), { payload } = await readOptimizationArchive(created.text);
	const verify = await optimizationNativeVerifier(scene, created.text, {
		isCurrent: () => current, verifyPlacement: async () => { current = false; return true; },
	});
	await assert.rejects(verify(payload, { action: 'apply', phase: 'complete' }), /supported/);
	await assert.rejects(verify(payload, operation), /context/);
});
