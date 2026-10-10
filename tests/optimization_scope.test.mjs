import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prepareOptimizationScope } from '../scripts/layers/optimization_scope.js';
import { readOptimizationArchive } from '../scripts/layers/optimization_recovery.js';

let scene, workspace, selected, current, options;
const document = source => ({ id: source._id, toObject: () => structuredClone(source), source });
function add(id, layerId = 'ink', patch = {}) {
	const source = { _id: id, author: 'gm', levels: ['level'], elevation: 0, sort: 1,
		hidden: false, locked: false, interface: false, shape: { type: 'p' }, flags: {},
		...structuredClone(patch) };
	if (layerId !== null) { source.flags.foundryshop ??= {}; source.flags.foundryshop.layerId = layerId; }
	scene.drawings.set(id, document(source));
	return source;
}
beforeEach(() => {
	current = true; selected = ['one'];
	workspace = { version: 1, scenes: { scene: { activeLayerId: 'ink', hiddenIds: [], collapsedIds: [] } } };
	globalThis.game = { user: { isGM: true }, i18n: { localize: key => key },
		settings: { get: () => workspace } };
	scene = { id: 'scene', width: 8000, height: 6000, padding: 0,
		grid: { toObject: () => ({ size: 100 }) }, levels: new Map([['level', document({ _id: 'level' })]]),
		drawings: new Map(), tiles: new Map(),
		flags: { layers: { version: 1, revision: 0, nodes: [
			{ id: 'group', kind: 'group', name: 'Maps', parentId: null, playerAllowed: true, locked: false, defaults: {} },
			{ id: 'ink', kind: 'layer', name: 'Ink', parentId: 'group', playerAllowed: true, locked: false, defaults: {} },
			{ id: 'private', kind: 'layer', name: 'Private', parentId: null, playerAllowed: false, locked: false, defaults: {} },
		], presets: [] } },
		getFlag(namespace, key) { return this.flags[key]; },
	};
	add('one'); add('two', 'private'); add('unassigned', null); add('other', 'ink', { levels: ['otherLevel'] });
	options = { layerId: 'ink', audience: 'player', destination: 'tile', isCurrent: () => current,
		readSelection: () => selected, inspectSource: () => ({ supported: true }) };
});
const prepare = patch => prepareOptimizationScope(scene, 'level', { ...options, ...patch });
const approve = prepared => prepared.approve({ excludedIds: prepared.review.excluded.map(entry => entry.id), flattenToGround: true });

test('Layer is default and preserves exact native sources without including other layers/Levels or writing', () => {
	const p = prepare(), manifest = approve(p);
	assert.deepEqual(p.review.scope, { kind: 'layer', layerId: 'ink' });
	assert.deepEqual(manifest.sourceIds, ['one']);
	assert.equal(p.review.removalCount, 1);
	assert.deepEqual(manifest.sources, [scene.drawings.get('one').source]);
	assert.equal(scene.drawings.size, 4);
	manifest.sources[0].sort = 100;
	assert.equal(scene.drawings.get('one').source.sort, 1);
});

test('Selection includes Unassigned without moving membership and reports foreign Levels explicitly', () => {
	selected = ['unassigned', 'one', 'other'];
	const p = prepare({ kind: 'selection', layerId: null });
	assert.equal(p.review.includesUnassigned, true);
	assert.deepEqual(p.review.excluded, [{ id: 'other', layerId: 'ink', reasons: ['other-or-multiple-levels'] }]);
	assert.deepEqual(approve(p).sourceIds, ['one', 'unassigned']);
});

test('All is displayed-Level only and requires exact acknowledgement of private/unsupported exclusions', () => {
	const p = prepare({ kind: 'all', layerId: null });
	assert.equal(p.review.includedCount, 2);
	assert.equal(p.review.excludedCount, 1);
	assert.equal(p.review.excluded[0].id, 'two');
	assert.deepEqual(p.review.excluded[0].reasons, ['gm-private']);
	assert.throws(() => p.approve({ excludedIds: [], flattenToGround: true }), /exact listed/);
	assert.throws(() => p.approve({ excludedIds: ['two', 'two'], flattenToGround: true }), /exact listed/);
	assert.throws(() => p.approve({ excludedIds: ['two'], flattenToGround: false }), /stacking/);
	assert.equal(approve(p).removalCount, 2);
});

test('group selection is not silently expanded; selected IDs must exist and be unique', () => {
	assert.throws(() => prepare({ layerId: 'group' }), /leaf layer/);
	assert.throws(() => prepare({ kind: 'selection', layerId: null, readSelection: undefined }), /reader/);
	for (const ids of [[], ['one', 'one'], ['missing']]) {
		selected = ids;
		assert.throws(() => prepare({ kind: 'selection', layerId: null }));
	}
});

test('locked/hidden/interface/staging/invalid membership/native order all get explicit exclusions', () => {
	add('hidden', 'ink', { hidden: true });
	add('locked', 'ink', { locked: true });
	add('interface', 'ink', { interface: true });
	add('staging', 'ink', { flags: { foundryshop: { importStaging: 'pending' } } });
	add('badOrder', 'ink', { elevation: NaN, sort: 1.5 });
	add('orphan', 'missing');
	const p = prepare({ kind: 'all', layerId: null });
	const reasons = new Map(p.review.excluded.map(entry => [entry.id, entry.reasons]));
	assert.deepEqual(reasons.get('hidden'), ['native-hidden']);
	assert.deepEqual(reasons.get('locked'), ['locked']);
	assert.deepEqual(reasons.get('interface'), ['interface-artwork']);
	assert.deepEqual(reasons.get('staging'), ['unfinished-staging']);
	assert.deepEqual(reasons.get('badOrder'), ['invalid-native-order']);
	assert.deepEqual(reasons.get('orphan'), ['invalid-membership']);
});

test('ancestor presentation/workspace and locks apply to included leaf members', () => {
	scene.flags.layers.nodes[0].locked = true;
	scene.flags.layers.nodes[0].playerAllowed = false;
	workspace.scenes.scene.hiddenIds = ['group'];
	const p = prepare();
	assert.deepEqual(p.review.excluded[0].reasons, ['locked', 'workspace-hidden', 'gm-private']);
	assert.equal(p.review.includedCount, 0);
	assert.throws(() => approve(p), /No eligible/);
});

test('renderer capability requires actionable unsupported reason and never mutates original sources', () => {
	const p = prepare({ inspectSource: source => { source.sort = 99; return { supported: false, reason: 'missing-font' }; } });
	assert.deepEqual(p.review.excluded[0].reasons, ['missing-font']);
	assert.equal(scene.drawings.get('one').source.sort, 1);
	for (const result of [null, true, { supported: false }, { supported: false, reason: '' }]) {
		assert.throws(() => prepare({ inspectSource: () => result }), /actionable/);
	}
});

test('mixed elevations and private background destination block approval, not silent ground conversion', () => {
	add('elevated', 'ink', { elevation: 10 });
	const p = prepare();
	assert.match(p.review.blockers[0], /Mixed elevations/);
	assert.throws(() => approve(p), /Mixed elevations/);
	scene.drawings.delete('elevated');
	const privateBackground = prepare({ audience: 'gm', destination: 'background' });
	assert.throws(() => approve(privateBackground), /GM-private/);
});

test('scope remains stale after source membership, selection, new strokes, Tile, Level or workspace changes', () => {
	const mutations = [
		() => scene.drawings.get('one').source.sort++,
		() => scene.drawings.get('one').source.flags.foundryshop.layerId = 'private',
		() => add('newer'),
		() => scene.tiles.set('tile', document({ _id: 'tile', sort: 1 })),
		() => scene.levels.get('level').source.name = 'changed',
		() => workspace.scenes.scene.hiddenIds.push('ink'),
		() => scene.grid.toObject = () => ({ size: 200 }),
	];
	for (const mutate of mutations) {
		const p = prepare();
		mutate();
		assert.throws(() => p.assertCurrent(), /stale/);
		assert.throws(() => approve(p), /stale/);
	}
});

test('selection reordering is equivalent but changing selected IDs invalidates review', () => {
	selected = ['one', 'unassigned'];
	const p = prepare({ kind: 'selection', layerId: null });
	selected.reverse();
	assert.equal(p.assertCurrent(), true);
	selected = ['one'];
	assert.throws(() => p.assertCurrent(), /stale/);
});

test('authority, pending import/journal and context changes refuse review and approval', () => {
	const p = prepare();
	current = false;
	assert.throws(() => p.assertCurrent(), /context/);
	current = true; game.user.isGM = false;
	assert.throws(() => prepare(), /context/);
	game.user.isGM = true; scene.flags.projectImportJournal = { token: 'pending' };
	assert.throws(() => prepare(), /unfinished/);
	delete scene.flags.projectImportJournal;
	scene.flags.optimizationJournal = { malformed: true };
	assert.throws(() => prepare(), /journal/);
});

test('renderer inspection changing sources immediately refuses preparation', () => {
	assert.throws(() => prepare({ inspectSource: () => {
		scene.drawings.get('one').source.sort++;
		return { supported: true };
	} }), /changed during/);
});

test('returned preview cannot be altered to change the authoritative deletion manifest/exclusion approval', () => {
	const p = prepare({ kind: 'all', layerId: null });
	p.review.excluded.length = 0;
	p.review.included.push({ id: 'two', layerId: 'private' });
	assert.throws(() => p.approve({ excludedIds: [], flattenToGround: true }), /exact listed/);
	const manifest = p.approve({ excludedIds: ['two'], flattenToGround: true });
	assert.deepEqual(manifest.sourceIds, ['one', 'unassigned']);
});

test('approved manifest directly creates typed recovery for exact sources/scope, ignoring tampered public IDs', async () => {
	const p = prepare(), manifest = approve(p);
	const output = { version: 1, root: 'worlds/test/recovery', path: 'worlds/test/recovery/baked.webp',
		bytes: 10, fingerprint: 'a'.repeat(64) };
	const after = { _id: 'tile', levels: ['level'], flags: {}, hidden: false, texture: { src: output.path } };
	const replacement = { type: 'Tile', id: 'tile', before: null, staged: { ...after, hidden: true }, after };
	manifest.sourceIds.push('two');
	manifest.sources.length = 0;
	const created = await manifest.createArchive(replacement, {
		token: 'operation', output, levelId: 'other', scope: { kind: 'all', layerId: null },
	});
	const archive = await readOptimizationArchive(created.text);
	assert.deepEqual(archive.payload.originals.map(source => source._id), ['one']);
	assert.deepEqual(archive.payload.scope, { kind: 'layer', layerId: 'ink' });
	assert.equal(archive.payload.levelId, 'level');
	add('newer');
	await assert.rejects(manifest.createArchive(replacement, { token: 'operation', output }), /stale/);
});

test('selected foreign-level originals are excluded, never silently reassigned to displayed Level', () => {
	selected = ['other'];
	const p = prepare({ kind: 'selection', layerId: null });
	assert.equal(p.review.removalCount, 0);
	assert.equal(p.review.excludedCount, 1);
	assert.throws(() => approve(p), /No eligible/);
	assert.deepEqual(scene.drawings.get('other').source.levels, ['otherLevel']);
});
