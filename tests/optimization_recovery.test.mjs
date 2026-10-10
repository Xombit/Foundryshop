import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	createOptimizationArchive, readOptimizationArchive, optimizationArchiveDescriptor,
	prepareOptimizationArchiveFile, persistOptimizationArchive, readStoredOptimizationArchive,
	inspectOptimizationRecovery, validateOptimizationArchive, OptimizationRecoveryConflictError,
} from '../scripts/layers/optimization_recovery.js';
import { inspectJournaledOptimization, verifyJournaledOptimizationPhase } from '../scripts/layers/optimization_reconciliation.js';
import { fileFingerprint } from '../scripts/verified_file_storage.js';
import { advanceOptimizationOperation, readOptimizationJournal } from '../scripts/layers/optimization_journal.js';
import { resumeOptimizationOperation, InterruptedOptimizationError } from '../scripts/layers/optimization_executor.js';
import { optimizationOutputVerifier } from '../scripts/optimization_media.js';
import { optimizationNativeVerifier } from '../scripts/layers/optimization_native.js';
import { optimizationSceneGrid } from '../scripts/layers/optimization_scene_data.js';

const file = name => ({ version: 1, root: 'worlds/test/recovery', path: `worlds/test/recovery/${name}`,
	bytes: 4, fingerprint: 'a'.repeat(64) });
let scene, level, original, replacement, options, files, writes;
const doc = data => ({ toObject: () => structuredClone(data), id: data._id });

test('Scene grid snapshots serialize Foundry Color values without structured-clone number coercion', () => {
	class FoundryColor extends Number {
		toString() { return '#123abc'; }
	}
	const color = new FoundryColor(0x123abc);
	const grid = { type: 0, size: 100, color, alpha: 0.2 };
	const snapshot = optimizationSceneGrid({ grid });
	assert.deepEqual(snapshot, { type: 0, size: 100, color: '#123abc', alpha: 0.2 });
	assert.equal(JSON.stringify(snapshot), '{"type":0,"size":100,"color":"#123abc","alpha":0.2}');
});

beforeEach(() => {
	globalThis.game = { user: { id: 'gm001', isGM: true, can: () => true }, i18n: { localize: key => key } };
	globalThis.location = { href: 'http://localhost:30000/game' };
	original = {
		_id: 'stroke001', author: 'gm001', levels: ['level001'], name: '', text: '',
		x: 10, y: 20, shape: { type: 'p', width: 50, height: 30, points: [0, 0, 50, 30] },
		flags: { foundryshop: { layerId: 'ink' }, other: { retained: [1, 2] } }, hidden: false,
	};
	level = {
		_id: 'level001', name: 'Ground', background: { src: 'maps/original.jpg', tint: '#ffffff', color: '#000000', alphaThreshold: 0.5 },
		foreground: { src: 'maps/overhead.png' }, fog: { retained: true },
		textures: { fit: 'fill', rotation: 0 }, elevation: { bottom: 0, top: 10 }, flags: {},
	};
	const tree = { version: 1, revision: 0, nodes: [
		{ id: 'ink', kind: 'layer', name: 'Ink', parentId: null, locked: false, playerAllowed: true, defaults: {} },
	], presets: [] };
	scene = {
		id: 'scene001', width: 8000, height: 6000, padding: 0, grid: { toObject: () => ({ type: 1, size: 100 }) },
		levels: new Map([['level001', doc(level)]]), drawings: new Map([['stroke001', doc(original)]]), tiles: new Map(),
		flags: { layers: tree }, getFlag(namespace, key) { return this.flags[key]; },
	};
	const after = {
		...structuredClone(original), _id: 'composite001', texture: file('baked.webp').path,
		flags: { foundryshop: { imageStamp: 1 } },
	};
	replacement = { type: 'Drawing', id: after._id, before: null, staged: { ...after, hidden: true }, after };
	options = { token: 'operation001', levelId: 'level001', scope: { kind: 'layer', layerId: 'ink' }, output: file('baked.webp') };
	files = new Map(); writes = [];
	globalThis.foundry = { applications: { apps: { FilePicker: { implementation: {
		browse: async () => ({ files: [...files.keys()] }),
		upload: async (source, root, blob) => {
			const path = `${root}/${blob.name}`; writes.push(path); files.set(path, await blob.text()); return { path };
		},
	} } } } };
	globalThis.fetch = async url => {
		const path = decodeURIComponent(url.pathname).slice(1);
		return new Response(files.get(path), { status: files.has(path) ? 200 : 404 });
	};
});
const create = () => createOptimizationArchive(scene, ['stroke001'], replacement, options);
function tile() {
	const after = {
		_id: 'tile001', texture: { src: options.output.path }, levels: ['level001'], flags: {},
		x: 0, y: 0, width: 8000, height: 6000, alpha: 1, locked: true, hidden: false,
	};
	replacement = { type: 'Tile', id: after._id, before: null, staged: { ...after, hidden: true }, after };
}
function background() {
	const after = structuredClone(level); after.background.src = options.output.path;
	replacement = { type: 'LevelBackground', id: level._id, before: structuredClone(level), staged: null, after };
	options.originalBackground = { src: level.background.src, file: file('original-copy.jpg') };
}
async function payload() { return (await readOptimizationArchive((await create()).text)).payload; }

test('typed archive preserves exact native sources/context at full 8000x6000 without project conversion', async () => {
	const before = structuredClone(original), archive = await create(), read = await readOptimizationArchive(archive.text);
	assert.deepEqual(read.payload.originals, [before]);
	assert.deepEqual(read.payload.context.level, level);
	assert.equal(read.payload.context.scene.width, 8000);
	assert.equal(read.payload.context.scene.height, 6000);
	assert.equal(archive.sourceCount, 1);
	assert.equal(archive.sourceDigest.length, 64);
	assert.deepEqual(original, before);
	assert.equal(writes.length, 0);
});

test('Drawing, Tile and Level-background payloads produce matching typed journal digests', async () => {
	for (const convert of [() => {}, tile, background]) {
		convert();
		const archive = await create(), descriptor = await optimizationArchiveDescriptor(archive.text);
		assert.equal(descriptor.replacement.type, replacement.type);
		assert.equal(descriptor.sourceDigest, archive.sourceDigest);
		assert.equal(descriptor.archiveChecksum, archive.checksum);
		assert.deepEqual(descriptor.asset, options.output);
		assert.equal(descriptor.replacement.beforeDigest === null, replacement.type !== 'LevelBackground');
		assert.equal(descriptor.replacement.stagedDigest === null, replacement.type === 'LevelBackground');
	}
});

test('background recovery retains original bytes reference and forbids unrelated Level changes', async () => {
	background();
	const read = await payload();
	assert.deepEqual(read.originalBackground, options.originalBackground);
	replacement.after.foreground.src = 'maps/changed.png';
	await assert.rejects(create(), /unrelated/);
	replacement.after.foreground = structuredClone(level.foreground);
	options.originalBackground = null;
	await assert.rejects(create(), /preserved original/);
});

test('color-only background has exact settings and explicitly no original image copy', async () => {
	level.background.src = null;
	background();
	options.originalBackground = null;
	const archive = await create();
	assert.equal((await readOptimizationArchive(archive.text)).payload.originalBackground, null);
	options.originalBackground = { src: 'unused', file: file('unused.png') };
	await assert.rejects(create(), /Color-only/);
});

test('archive rejects unsupported versions, metadata, identities, layers and invalid staging', async () => {
	const p = await payload();
	for (const modify of [
		value => value.version = 2, value => value.extra = true,
		value => value.originals.push(structuredClone(value.originals[0])),
		value => value.originals[0].flags.foundryshop.layerId = 'missing',
		value => value.originals[0].levels.push('other'),
		value => value.replacement.staged.hidden = false,
		value => value.replacement.staged.x++,
		value => value.replacement.after.texture = 'maps/other.webp',
		value => value.scope.layerId = 'other', value => value.scope.kind = 'scene',
		value => value.replacement.id = 'stroke001',
	]) {
		const changed = structuredClone(p); modify(changed);
		assert.throws(() => validateOptimizationArchive(changed));
	}
});

test('JSON-lossy native values are refused rather than silently normalized', async () => {
	for (const value of [undefined, NaN, Infinity, new Date(), [1, , 3]]) {
		original.flags.other.retained = value;
		await assert.rejects(create(), /round-trip|Sparse/);
	}
});

test('checksum corruption and invalid envelopes refuse recovery', async () => {
	const archive = await create(), envelope = JSON.parse(archive.text);
	envelope.payload.originals[0].x++;
	await assert.rejects(readOptimizationArchive(JSON.stringify(envelope)), /checksum mismatch/);
	envelope.extra = true;
	await assert.rejects(readOptimizationArchive(JSON.stringify(envelope)), /envelope/);
});

test('Selection and All allow Unassigned strokes without layer conversion; Layer does not', async () => {
	delete original.flags.foundryshop.layerId;
	for (const kind of ['selection', 'all']) {
		options.scope = { kind, layerId: null };
		assert.equal((await payload()).scope.kind, kind);
	}
	options.scope = { kind: 'layer', layerId: 'ink' };
	await assert.rejects(create(), /scope/);
});

test('original sources or full native context changing during hashing refuse archive creation', async () => {
	let pending = create(); original.x++;
	await assert.rejects(pending, /changed/);
	pending = create(); level.textures.rotation++;
	await assert.rejects(pending, /changed/);
	pending = create(); game.user.isGM = false;
	await assert.rejects(pending, /GM/);
});

test('prepared file reference persists/reloads typed originals without Scene document writes', async () => {
	const created = await create(), reference = await prepareOptimizationArchiveFile(created.text, 'worlds/test/recovery');
	assert.equal(files.size, 0);
	assert.equal(reference.path, 'worlds/test/recovery/recovery-operation001.json');
	const saved = await persistOptimizationArchive(scene, created.text, reference, { isCurrent: () => true });
	assert.deepEqual(saved, reference);
	const loaded = await readStoredOptimizationArchive(JSON.parse(JSON.stringify(saved)));
	assert.deepEqual(loaded.payload.originals, [original]);
	assert.equal(scene.drawings.size, 1);
	assert.equal(writes.length, 1);
	files.set(saved.path, files.get(saved.path).replace('"x":10', '"x":11'));
	await assert.rejects(readStoredOptimizationArchive(saved), /fingerprint/);
});

test('persistence refuses missing journal guards, mismatched intent bytes and stale sources', async () => {
	const created = await create(), reference = await prepareOptimizationArchiveFile(created.text, 'worlds/test/recovery');
	await assert.rejects(persistOptimizationArchive(scene, created.text, reference), /explicit/);
	await assert.rejects(persistOptimizationArchive(scene, created.text,
		{ ...reference, fingerprint: '0'.repeat(64) }, { isCurrent: () => true }), /differ/);
	await assert.rejects(persistOptimizationArchive(scene, created.text, reference, { isCurrent: () => false }), /changed/);
	original.x++;
	await assert.rejects(persistOptimizationArchive(scene, created.text, reference, { isCurrent: () => true }), /changed/);
	assert.equal(writes.length, 0);
});

test('partial deletion is reconciled read-only and preserves newer/unrelated strokes', async () => {
	const created = await create();
	scene.drawings.set(replacement.id, doc(replacement.staged));
	scene.drawings.set('newer001', doc({ ...original, _id: 'newer001' }));
	let preview = await inspectOptimizationRecovery(scene, created.text);
	assert.deepEqual(preview.originals, { present: ['stroke001'], missing: [] });
	assert.equal(preview.replacementState, 'staged');
	assert.equal(preview.canResumeApply, true);
	scene.drawings.delete('stroke001');
	preview = await inspectOptimizationRecovery(scene, created.text);
	assert.deepEqual(preview.originals, { present: [], missing: ['stroke001'] });
	assert.equal(preview.canResumeRestore, false);
	assert.equal(scene.drawings.has('newer001'), true);
	assert.equal(writes.length, 0);
});

test('replacement edits and occupied original IDs report explicit conflicts rather than overwriting', async () => {
	tile();
	const created = await create();
	replacement.after.x++;
	scene.tiles.set(replacement.id, doc(replacement.after));
	original.x++;
	await assert.rejects(inspectOptimizationRecovery(scene, created.text),
		error => error instanceof OptimizationRecoveryConflictError && error.conflicts.length === 2);
});

test('missing replacement with missing originals requires replacement recovery, never silent success', async () => {
	const created = await create();
	scene.drawings.delete('stroke001');
	const preview = await inspectOptimizationRecovery(scene, created.text);
	assert.equal(preview.replacementState, 'absent');
	assert.equal(preview.requiresReplacementRecovery, true);
	assert.equal(preview.canResumeApply, false);
});

test('background before/after reconciliation protects shared foreground/fog/settings', async () => {
	background();
	const created = await create();
	assert.equal((await inspectOptimizationRecovery(scene, created.text)).replacementState, 'before');
	scene.levels.set('level001', doc(replacement.after));
	scene.drawings.delete('stroke001');
	assert.equal((await inspectOptimizationRecovery(scene, created.text)).replacementState, 'after');
	replacement.after.fog.retained = false;
	await assert.rejects(inspectOptimizationRecovery(scene, created.text), /Level background/);
});

test('Scene grid/dimensions, layers, Levels and archive Scene identity are guarded', async () => {
	const created = await create();
	scene.width++;
	await assert.rejects(inspectOptimizationRecovery(scene, created.text), /dimensions/);
	scene.width--;
	scene.flags.layers.nodes[0].playerAllowed = false;
	await assert.rejects(inspectOptimizationRecovery(scene, created.text), /layer context/);
	scene.flags.layers.nodes[0].playerAllowed = true;
	scene.id = 'other';
	await assert.rejects(inspectOptimizationRecovery(scene, created.text), /another Scene/);
	scene.id = 'scene001';
	scene.levels.clear();
	await assert.rejects(inspectOptimizationRecovery(scene, created.text), /existing Level/);
});

test('reviewed Restore may accept only a newer layer revision with every other value exact', async () => {
	const created = await create(), baseline = structuredClone(scene.flags.layers);
	scene.flags.layers.revision = 2;
	await assert.rejects(inspectOptimizationRecovery(scene, created.text), /layer context/);
	const report = await inspectOptimizationRecovery(scene, created.text, { allowLayerRevisionChange: true });
	assert.deepEqual(report.layerRevisionChange, { archived: 0, current: 2 });
	assert.equal(scene.flags.layers.revision, 2);
	assert.deepEqual((await readOptimizationArchive(created.text)).payload.context.layers, baseline);
	for (const change of [
		tree => { tree.nodes[0].playerAllowed = false; },
		tree => { tree.nodes[0].locked = true; },
		tree => { tree.nodes[0].name = 'Renamed'; },
		tree => { tree.nodes[0].defaults = { fillColor: '#ff0000' }; },
		tree => { tree.nodes.push({ ...tree.nodes[0], id: 'other' }); },
	]) {
		scene.flags.layers = { ...structuredClone(baseline), revision: 2 };
		change(scene.flags.layers);
		await assert.rejects(inspectOptimizationRecovery(scene, created.text, { allowLayerRevisionChange: true }), /layer context/);
	}
	scene.flags.layers = { ...baseline, revision: 2 };
	scene.width++;
	await assert.rejects(inspectOptimizationRecovery(scene, created.text, { allowLayerRevisionChange: true }), /dimensions/);
});

test('Restore revision tolerance refuses revision rollback and reports no change on exact context', async () => {
	scene.flags.layers.revision = 3;
	const created = await create();
	assert.equal((await inspectOptimizationRecovery(scene, created.text, { allowLayerRevisionChange: true })).layerRevisionChange, null);
	scene.flags.layers.revision = 2;
	await assert.rejects(inspectOptimizationRecovery(scene, created.text, { allowLayerRevisionChange: true }), /layer context/);
});

test('immutable parent reference carries ancestry without overwriting or embedding prior archive', async () => {
	options.parent = { file: file('recovery-earlier.json'), checksum: 'b'.repeat(64) };
	const read = await payload();
	assert.deepEqual(read.parent, options.parent);
	options.parent.checksum = 'invalid';
	await assert.rejects(create(), /lineage/);
});

async function journalFixture() {
	const outputBytes = new TextEncoder().encode('test');
	options.output.fingerprint = await fileFingerprint(outputBytes);
	if (options.originalBackground) options.originalBackground.file.fingerprint = await fileFingerprint(outputBytes);
	// Replacement paths are unchanged by updating output fingerprints.
	const created = await create(), archive = await prepareOptimizationArchiveFile(created.text, 'worlds/test/recovery');
	await persistOptimizationArchive(scene, created.text, archive, { isCurrent: () => true });
	files.set(options.output.path, 'test');
	if (options.originalBackground) files.set(options.originalBackground.file.path, 'test');
	const descriptor = await optimizationArchiveDescriptor(created.text);
	const entry = {
		token: options.token, sceneId: scene.id, levelId: options.levelId, ownerId: game.user.id,
		action: 'apply', phase: 'intent', archive, ...descriptor, parentToken: null,
	};
	scene.flags.optimizationJournal = { version: 1, revision: 1, entries: [entry] };
	return { entry, created, archive };
}
const review = () => ({ isCurrent: () => true, verifyOutput: async bytes => new TextDecoder().decode(bytes) === 'test' });

test('journal-bound reconciliation verifies archive/output bytes and refuses altered journal digests', async () => {
	const { entry } = await journalFixture();
	const report = await inspectJournaledOptimization(scene, entry.token, { isCurrent: () => true });
	assert.equal(report.verifiedFiles, true);
	assert.equal(report.outputAccepted, false);
	assert.equal(report.replacementState, 'absent');
	entry.sourceDigest = 'b'.repeat(64);
	await assert.rejects(inspectJournaledOptimization(scene, entry.token, review()), /digests/);
});

test('journal reconciliation tolerates revision-only changes only for Restore, not Apply', async () => {
	const { entry } = await journalFixture();
	scene.flags.layers.revision = 2;
	await assert.rejects(inspectJournaledOptimization(scene, entry.token, review()), /layer context/);
	entry.phase = 'complete';
	scene.drawings.delete(original._id);
	scene.drawings.set(replacement.id, doc(replacement.after));
	const restore = { ...structuredClone(entry), token: 'restore001', action: 'restore', phase: 'intent', parentToken: entry.token };
	scene.flags.optimizationJournal.entries.push(restore);
	const inspected = await inspectJournaledOptimization(scene, restore.token, review());
	assert.deepEqual(inspected.layerRevisionChange, { archived: 0, current: 2 });
	scene.flags.layers.nodes[0].playerAllowed = false;
	await assert.rejects(inspectJournaledOptimization(scene, restore.token, review()), /layer context/);
});

test('actual native states gate every apply phase; decoder acceptance cannot be omitted', async () => {
	const { entry } = await journalFixture();
	const verify = phase => verifyJournaledOptimizationPhase(scene, { ...entry, phase }, review());
	await assert.rejects(verifyJournaledOptimizationPhase(scene, { ...entry, phase: 'assets-verified' }, { isCurrent: () => true }), /decode/);
	assert.equal(await verify('assets-verified'), true);
	await assert.rejects(verify('replacement-staged'), /Native recovery state/);
	scene.drawings.set(replacement.id, doc(replacement.staged));
	assert.equal(await verify('replacement-staged'), true);
	await assert.rejects(verify('sources-removed'), /Native recovery state/);
	scene.drawings.delete('stroke001');
	assert.equal(await verify('sources-removed'), true);
	await assert.rejects(verify('complete'), /Native recovery state/);
	scene.drawings.set(replacement.id, doc(replacement.after));
	assert.equal(await verify('complete'), true);
});

test('restore evidence requires exact originals before reverting replacement, preserves later strokes', async () => {
	const { entry } = await journalFixture();
	entry.phase = 'complete';
	const restoring = { ...structuredClone(entry), token: 'restore001', action: 'restore', phase: 'intent', parentToken: entry.token };
	scene.flags.optimizationJournal.entries.push(restoring);
	scene.drawings.set(replacement.id, doc(replacement.after)); scene.drawings.delete('stroke001');
	scene.drawings.set('newer001', doc({ ...original, _id: 'newer001' }));
	const verify = phase => verifyJournaledOptimizationPhase(scene, { ...restoring, phase }, review());
	assert.equal(await verify('assets-verified'), true);
	await assert.rejects(verify('originals-staged'), /Native recovery state/);
	scene.drawings.set('stroke001', doc(original));
	assert.equal(await verify('originals-staged'), true);
	await assert.rejects(verify('replacement-reverted'), /Native recovery state/);
	scene.drawings.delete(replacement.id);
	assert.equal(await verify('replacement-reverted'), true);
	assert.equal(await verify('complete'), true);
	assert.equal(scene.drawings.has('newer001'), true);
});

test('background phase evidence verifies preserved original bytes and native background application', async () => {
	background();
	const { entry } = await journalFixture();
	const verify = phase => verifyJournaledOptimizationPhase(scene, { ...entry, phase }, review());
	assert.equal(await verify('assets-verified'), true);
	await assert.rejects(verify('replacement-staged'), /Native recovery state/);
	scene.levels.set('level001', doc(replacement.after));
	assert.equal(await verify('replacement-staged'), true);
	scene.drawings.delete('stroke001');
	assert.equal(await verify('complete'), true);
	files.delete(options.originalBackground.file.path);
	await assert.rejects(verify('complete'), /HTTP 404/);
});

test('mutated output, failed decode, concurrent journal change and lost authority refuse phase evidence', async () => {
	const { entry } = await journalFixture();
	const proposed = { ...entry, phase: 'assets-verified' };
	files.set(entry.asset.path, 'edit');
	await assert.rejects(verifyJournaledOptimizationPhase(scene, proposed, review()), /fingerprint/);
	files.set(entry.asset.path, 'test');
	await assert.rejects(verifyJournaledOptimizationPhase(scene, proposed, {
		isCurrent: () => true, verifyOutput: async () => false,
	}), /acceptance/);
	await assert.rejects(verifyJournaledOptimizationPhase(scene, proposed, {
		isCurrent: () => true, verifyOutput: async () => { scene.flags.optimizationJournal.revision++; return true; },
	}), /changed/);
	await assert.rejects(verifyJournaledOptimizationPhase(scene, proposed, {
		isCurrent: () => true, verifyOutput: async () => { game.user.isGM = false; return true; },
	}), /changed/);
});

test('GM hidden final outputs matching staged state can still complete without player exposure', async () => {
	replacement.after.hidden = true;
	const { entry } = await journalFixture();
	scene.drawings.delete('stroke001'); scene.drawings.set(replacement.id, doc(replacement.after));
	assert.equal(await verifyJournaledOptimizationPhase(scene, { ...entry, phase: 'complete' }, review()), true);
});

test('typed archive does not inherit the old 1000-source archive or 8192-axis limits', async () => {
	scene.width = 20000;
	const ids = [];
	for (let index = 0; index < 1001; index++) {
		const source = { ...structuredClone(original), _id: `stroke${index}` };
		scene.drawings.set(source._id, doc(source)); ids.push(source._id);
	}
	const archive = await createOptimizationArchive(scene, ids, replacement, options);
	assert.equal(archive.sourceCount, 1001);
	assert.equal((await readOptimizationArchive(archive.text)).payload.context.scene.width, 20000);
});

test('phase adapter integrates with durable journal updates rather than synthetic always-true evidence', async () => {
	const { entry } = await journalFixture();
	game.users = { activeGM: { id: game.user.id } }; game.scenes = new Map([[scene.id, scene]]);
	scene.canUserModify = () => true;
	scene.update = async patch => {
		scene.flags.optimizationJournal = structuredClone(patch['flags.foundryshop.optimizationJournal']);
	};
	const advance = phase => advanceOptimizationOperation(scene, readOptimizationJournal(scene), entry.token, phase, {
		isCurrent: () => true,
		verifyPhase: proposed => verifyJournaledOptimizationPhase(scene, proposed, review()),
	});
	await advance('assets-verified');
	await assert.rejects(advance('replacement-staged'), /Native recovery state/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'assets-verified');
	scene.drawings.set(replacement.id, doc(replacement.staged));
	await advance('replacement-staged');
	scene.drawings.delete('stroke001');
	await advance('sources-removed');
	scene.drawings.set(replacement.id, doc(replacement.after));
	await advance('complete');
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'complete');
});

test('background original URL alone is not a preserved byte copy and archives cannot point to themselves', async () => {
	background();
	options.originalBackground.file.path = level.background.src;
	options.originalBackground.file.root = 'maps';
	await assert.rejects(create(), /preserved original/);
	options.originalBackground.file = file('original-copy.jpg');
	options.parent = { file: file('recovery-operation001.json'), checksum: 'b'.repeat(64) };
	const created = await create();
	await assert.rejects(prepareOptimizationArchiveFile(created.text, 'worlds/test/recovery'), /distinct/);
});

function nativeExecutorFixture() {
	const nativeWrites = [];
	game.users = { activeGM: { id: game.user.id } }; game.scenes = new Map([[scene.id, scene]]);
	scene.canUserModify = () => true;
	scene.update = async patch => {
		scene.flags.optimizationJournal = structuredClone(patch['flags.foundryshop.optimizationJournal']);
	};
	const collection = type => ({ Drawing: scene.drawings, Tile: scene.tiles, Level: scene.levels })[type];
	scene.createEmbeddedDocuments = async (type, sources, operation) => {
		nativeWrites.push({ kind: 'create', type, sources: structuredClone(sources), operation });
		for (const source of sources) {
			assert.equal(collection(type).has(source._id), false);
			collection(type).set(source._id, doc(structuredClone(source)));
		}
	};
	scene.deleteEmbeddedDocuments = async (type, ids, operation) => {
		nativeWrites.push({ kind: 'delete', type, ids: [...ids], operation });
		for (const id of ids) collection(type).delete(id);
	};
	scene.updateEmbeddedDocuments = async (type, updates, operation) => {
		nativeWrites.push({ kind: 'update', type, updates: structuredClone(updates), operation });
		for (const patch of updates) {
			const before = collection(type).get(patch._id).toObject();
			collection(type).set(patch._id, doc({ ...before, ...structuredClone(patch) }));
		}
	};
	const execute = (token, overrides = {}) => resumeOptimizationOperation(scene, token, {
		...review(), verifyNative: async () => true, ...overrides,
	});
	return { nativeWrites, execute };
}

test('executor applies and restores Drawing/Tile/background with exact IDs/authors and newer strokes intact', async () => {
	for (const type of ['Drawing', 'Tile', 'LevelBackground']) {
		// Each iteration uses a distinct Scene instance, avoiding any retained per-Scene executor state.
		if (type === 'Tile') tile();
		if (type === 'LevelBackground') background();
		files.clear();
		scene.flags.optimizationJournal = undefined;
		scene.drawings = new Map([['stroke001', doc(original)]]);
		scene.tiles = new Map(); scene.levels = new Map([['level001', doc(level)]]);
		const { entry } = await journalFixture(), { nativeWrites, execute } = nativeExecutorFixture();
		const newer = { ...structuredClone(original), _id: 'newer001', x: 123 };
		scene.drawings.set(newer._id, doc(newer));
		const applied = await execute(entry.token);
		assert.equal(applied.entries[0].phase, 'complete');
		assert.equal(scene.drawings.has('stroke001'), false);
		assert.deepEqual(scene.drawings.get('newer001').toObject(), newer);
		const collection = type === 'Drawing' ? scene.drawings : type === 'Tile' ? scene.tiles : scene.levels;
		assert.deepEqual(collection.get(replacement.id).toObject(), replacement.after);
		const count = nativeWrites.length;
		await execute(entry.token);
		assert.equal(nativeWrites.length, count);
		const restore = { ...structuredClone(applied.entries[0]), token: 'restore001', action: 'restore',
			phase: 'intent', parentToken: entry.token };
		scene.flags.optimizationJournal.entries.push(restore);
		await execute(restore.token);
		assert.deepEqual(scene.drawings.get('stroke001').toObject(), original);
		assert.deepEqual(scene.drawings.get('newer001').toObject(), newer);
		if (type === 'LevelBackground') assert.deepEqual(scene.levels.get(level._id).toObject(), level);
		else assert.equal(collection.has(replacement.id), false);
		const create = nativeWrites.find(write => write.kind === 'create' && write.sources[0]._id === 'stroke001');
		assert.equal(create.sources[0].hidden, true);
		assert.equal(create.operation.keepId, true);
		assert.equal(create.operation.foundryshopLayerOperation, true);
	}
});

test('executor resumes partial deletion after reload without recreating output or touching newer strokes', async () => {
	scene.drawings.set('stroke002', doc({ ...structuredClone(original), _id: 'stroke002' }));
	const bytes = new TextEncoder().encode('test');
	options.output.fingerprint = await fileFingerprint(bytes);
	const actual = await createOptimizationArchive(scene, ['stroke001', 'stroke002'], replacement, options);
	const reference = await prepareOptimizationArchiveFile(actual.text, 'worlds/test/recovery');
	await persistOptimizationArchive(scene, actual.text, reference, { isCurrent: () => true });
	files.set(options.output.path, 'test');
	const entry = { token: options.token, sceneId: scene.id, levelId: options.levelId, ownerId: game.user.id,
		action: 'apply', phase: 'intent', archive: reference, ...await optimizationArchiveDescriptor(actual.text), parentToken: null };
	scene.flags.optimizationJournal = { version: 1, revision: 1, entries: [entry] };
	const { execute, nativeWrites } = nativeExecutorFixture();
	const remove = scene.deleteEmbeddedDocuments;
	scene.deleteEmbeddedDocuments = async (type, ids, operation) => {
		await remove(type, ids.slice(0, 1), operation);
		throw new Error('connection lost after partial deletion');
	};
	await assert.rejects(execute(entry.token), error => error instanceof InterruptedOptimizationError && /partial deletion/.test(error.message));
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'replacement-staged');
	assert.equal(scene.drawings.has('stroke001'), false);
	assert.equal(scene.drawings.has('stroke002'), true);
	scene.flags.optimizationJournal = JSON.parse(JSON.stringify(scene.flags.optimizationJournal));
	scene.deleteEmbeddedDocuments = remove;
	scene.drawings.set('newer001', doc({ ...original, _id: 'newer001' }));
	await execute(entry.token);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'complete');
	assert.equal(scene.drawings.has('newer001'), true);
	assert.equal(nativeWrites.filter(write => write.kind === 'create').length, 1);
});

test('lost staging/exposure responses resume from native state without duplicate replacement IDs', async () => {
	const { entry } = await journalFixture(), { execute, nativeWrites } = nativeExecutorFixture();
	const create = scene.createEmbeddedDocuments, update = scene.updateEmbeddedDocuments;
	scene.createEmbeddedDocuments = async (...args) => { await create(...args); throw new Error('create response lost'); };
	await assert.rejects(execute(entry.token), /create response lost/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'assets-verified');
	scene.createEmbeddedDocuments = create;
	scene.updateEmbeddedDocuments = async (...args) => { await update(...args); throw new Error('exposure response lost'); };
	await assert.rejects(execute(entry.token), /exposure response lost/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'sources-removed');
	scene.updateEmbeddedDocuments = update;
	await execute(entry.token);
	assert.equal(nativeWrites.filter(write => write.kind === 'create').length, 1);
	assert.equal(nativeWrites.filter(write => write.kind === 'delete').length, 1);
});

test('partial original recreation resumes hidden staged sources before replacement removal/exposure', async () => {
	const { entry } = await journalFixture(), { execute } = nativeExecutorFixture();
	await execute(entry.token);
	const applied = readOptimizationJournal(scene).entries[0];
	const restoring = { ...structuredClone(applied), token: 'restore001', action: 'restore', phase: 'intent', parentToken: entry.token };
	scene.flags.optimizationJournal.entries.push(restoring);
	const create = scene.createEmbeddedDocuments;
	scene.createEmbeddedDocuments = async (...args) => { await create(...args); throw new Error('restoration response lost'); };
	await assert.rejects(execute(restoring.token), /restoration response lost/);
	assert.equal(scene.drawings.get('stroke001').toObject().hidden, true);
	assert.equal(scene.drawings.has(replacement.id), true);
	assert.equal(readOptimizationJournal(scene).entries[1].phase, 'assets-verified');
	scene.createEmbeddedDocuments = create;
	await execute(restoring.token);
	assert.deepEqual(scene.drawings.get('stroke001').toObject(), original);
	assert.equal(scene.drawings.has(replacement.id), false);
});

test('edited sources/output, denied native writes and rejected acceptance never delete original Drawings', async () => {
	const { entry } = await journalFixture(), { execute, nativeWrites } = nativeExecutorFixture();
	await assert.rejects(execute(entry.token, { verifyNative: undefined }), /requires/);
	await assert.rejects(execute(entry.token, { verifyNative: async () => false }), /acceptance/);
	assert.equal(nativeWrites.length, 0);
	scene.createEmbeddedDocuments = async () => { throw new Error('native create denied'); };
	await assert.rejects(execute(entry.token), /native create denied/);
	assert.equal(scene.drawings.has('stroke001'), true);
	original.x++;
	await assert.rejects(execute(entry.token), /edited/);
	assert.equal(scene.drawings.has('stroke001'), true);
});

test('native normalization mismatch is detected before removal; originals remain intact', async () => {
	const { entry } = await journalFixture(), { execute } = nativeExecutorFixture();
	const create = scene.createEmbeddedDocuments;
	scene.createEmbeddedDocuments = async (type, sources, operation) => {
		await create(type, sources.map(source => ({ ...source, x: source.x + 1 })), operation);
	};
	await assert.rejects(execute(entry.token), /replacement was edited/);
	assert.equal(scene.drawings.has('stroke001'), true);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'assets-verified');
});

test('cancelled context, GM election changes and locked layers stop execution before deletion', async () => {
	const { entry } = await journalFixture(), { execute, nativeWrites } = nativeExecutorFixture();
	await assert.rejects(execute(entry.token, { signal: AbortSignal.abort() }), /cancelled/);
	await assert.rejects(execute(entry.token, { isCurrent: () => false }), /context/);
	game.users.activeGM.id = 'otherGM';
	await assert.rejects(execute(entry.token), /authority/);
	game.users.activeGM.id = game.user.id;
	await assert.rejects(execute(entry.token, { verifyNative: async () => { game.users.activeGM.id = 'otherGM'; return true; } }), /authority/);
	game.users.activeGM.id = game.user.id;
	scene.flags.layers.nodes[0].locked = true;
	await assert.rejects(execute(entry.token), /layer context/);
	assert.equal(nativeWrites.length, 0);
	assert.equal(scene.drawings.has('stroke001'), true);
});

test('restore resumes a lost replacement-removal response and partial hidden-state publication', async () => {
	const { entry } = await journalFixture(), { execute, nativeWrites } = nativeExecutorFixture();
	await execute(entry.token);
	const parent = readOptimizationJournal(scene).entries[0];
	const restoring = { ...structuredClone(parent), token: 'restore001', action: 'restore',
		phase: 'intent', parentToken: entry.token };
	scene.flags.optimizationJournal.entries.push(restoring);
	const remove = scene.deleteEmbeddedDocuments, update = scene.updateEmbeddedDocuments;
	scene.deleteEmbeddedDocuments = async (...args) => { await remove(...args); throw new Error('remove response lost'); };
	await assert.rejects(execute(restoring.token), /remove response lost/);
	assert.equal(readOptimizationJournal(scene).entries[1].phase, 'originals-staged');
	assert.equal(scene.drawings.has(replacement.id), false);
	assert.equal(scene.drawings.get('stroke001').toObject().hidden, true);
	scene.deleteEmbeddedDocuments = remove;
	scene.updateEmbeddedDocuments = async (...args) => { await update(...args); throw new Error('original exposure response lost'); };
	await assert.rejects(execute(restoring.token), /original exposure response lost/);
	assert.equal(readOptimizationJournal(scene).entries[1].phase, 'replacement-reverted');
	assert.deepEqual(scene.drawings.get('stroke001').toObject(), original);
	scene.updateEmbeddedDocuments = update;
	await execute(restoring.token);
	assert.equal(readOptimizationJournal(scene).entries[1].phase, 'complete');
	assert.equal(nativeWrites.filter(write => write.kind === 'delete' && write.ids[0] === replacement.id).length, 1);
});

test('background apply/undo lost responses resume without altering foreground or other native fields', async () => {
	background();
	const { entry } = await journalFixture(), { execute, nativeWrites } = nativeExecutorFixture();
	const update = scene.updateEmbeddedDocuments;
	scene.updateEmbeddedDocuments = async (...args) => { await update(...args); throw new Error('background response lost'); };
	await assert.rejects(execute(entry.token), /background response lost/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'assets-verified');
	assert.equal(scene.drawings.has('stroke001'), true);
	scene.updateEmbeddedDocuments = update;
	await execute(entry.token);
	const parent = readOptimizationJournal(scene).entries[0];
	scene.flags.optimizationJournal.entries.push({ ...structuredClone(parent), token: 'restore001',
		action: 'restore', phase: 'intent', parentToken: entry.token });
	scene.updateEmbeddedDocuments = async (...args) => { await update(...args); throw new Error('undo background response lost'); };
	await assert.rejects(execute('restore001'), /undo background response lost/);
	assert.equal(readOptimizationJournal(scene).entries[1].phase, 'originals-staged');
	assert.deepEqual(scene.levels.get(level._id).toObject(), level);
	scene.updateEmbeddedDocuments = update;
	await execute('restore001');
	assert.deepEqual(scene.drawings.get('stroke001').toObject(), original);
	for (const write of nativeWrites.filter(write => write.type === 'Level')) {
		assert.deepEqual(Object.keys(write.updates[0]).sort(), ['_id', 'background', 'textures']);
		assert.equal(write.operation.recursive, false);
	}
});

test('same-client executor refuses overlapping jobs and releases its lock after failure', async () => {
	const { entry } = await journalFixture(), { execute } = nativeExecutorFixture();
	let release, entered;
	const started = new Promise(resolve => { entered = resolve; });
	const pending = execute(entry.token, { verifyNative: async () => {
		entered();
		await new Promise(resolve => { release = resolve; });
		return false;
	} });
	await started;
	await assert.rejects(execute(entry.token), /already running/);
	release();
	await assert.rejects(pending, /acceptance/);
	await execute(entry.token);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'complete');
});

test('native edits during async acceptance stop writes, including edits made before deletion', async () => {
	const { entry } = await journalFixture(), { execute, nativeWrites } = nativeExecutorFixture();
	await assert.rejects(execute(entry.token, { verifyNative: async () => { original.x++; return true; } }), /changed during/);
	assert.equal(nativeWrites.length, 0);
	original.x--;
	await assert.rejects(execute(entry.token, { verifyNative: async (payload, context) => {
		if (context.phase === 'replacement-staged') {
			const live = scene.drawings.get(replacement.id).toObject();
			scene.drawings.set(replacement.id, doc({ ...live, rotation: 30 }));
		}
		return true;
	} }), /changed during/);
	assert.equal(scene.drawings.has('stroke001'), true);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'replacement-staged');
});

test('hidden final output is never unintentionally exposed during apply or restore', async () => {
	replacement.after.hidden = true;
	const { entry } = await journalFixture(), { execute, nativeWrites } = nativeExecutorFixture();
	await execute(entry.token);
	assert.equal(scene.drawings.get(replacement.id).toObject().hidden, true);
	assert.equal(nativeWrites.some(write => write.kind === 'update' && write.type === 'Drawing'), false);
});

test('executor uses the persisted-image acceptance adapter instead of an always-true output callback', async () => {
	const bytes = new Uint8Array(Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHbkAAAAASUVORK5CYII=', 'base64'));
	options.output = { ...file('baked.png'), bytes: bytes.length, fingerprint: await fileFingerprint(bytes) };
	replacement.staged.texture = replacement.after.texture = options.output.path;
	const created = await create(), archive = await prepareOptimizationArchiveFile(created.text, 'worlds/test/recovery');
	await persistOptimizationArchive(scene, created.text, archive, { isCurrent: () => true });
	const fetch = globalThis.fetch;
	globalThis.fetch = async (url, request) => decodeURIComponent(url.pathname).slice(1) === options.output.path
		? new Response(bytes) : fetch(url, request);
	const entry = { token: options.token, sceneId: scene.id, levelId: options.levelId, ownerId: game.user.id,
		action: 'apply', phase: 'intent', archive, ...await optimizationArchiveDescriptor(created.text), parentToken: null };
	scene.flags.optimizationJournal = { version: 1, revision: 1, entries: [entry] };
	const { execute } = nativeExecutorFixture();
	const previous = globalThis.createImageBitmap;
	let decodes = 0, closes = 0;
	globalThis.createImageBitmap = async () => { decodes++; return { width: 1, height: 1, close: () => closes++ }; };
	try {
		await execute(entry.token, {
			verifyOutput: optimizationOutputVerifier(options.output, { width: 1, height: 1 }, { isCurrent: () => true }),
		});

		assert.equal(readOptimizationJournal(scene).entries[0].phase, 'complete');
		assert.equal(decodes > 0, true);
		assert.equal(closes, decodes);
		assert.equal(scene.drawings.has('stroke001'), false);
	} finally {
		if (previous === undefined) delete globalThis.createImageBitmap;
		else globalThis.createImageBitmap = previous;
	}
});

test('executor integrates strict reviewed native schema checks before replacement creation and source deletion', async () => {
	const { entry, created } = await journalFixture(), { execute, nativeWrites } = nativeExecutorFixture();
	const previous = globalThis.getDocumentClass;
	let checks = 0;
	globalThis.getDocumentClass = () => class {
		constructor(source, context) {
			assert.equal(context.parent, scene); assert.equal(context.strict, true);
			this.source = structuredClone(source); checks++;
		}
		toObject() { return structuredClone(this.source); }
	};
	try {
		const verifyNative = await optimizationNativeVerifier(scene, created.text, {
			isCurrent: () => true, verifyPlacement: async () => true,
		});
		await execute(entry.token, { verifyNative });
		assert.equal(checks >= 15, true);
		assert.equal(scene.drawings.has('stroke001'), false);
		assert.equal(nativeWrites.filter(write => write.kind === 'delete').length, 1);
	} finally {
		if (previous === undefined) delete globalThis.getDocumentClass;
		else globalThis.getDocumentClass = previous;
	}
});
