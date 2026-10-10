import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	OPTIMIZATION_JOURNAL, readOptimizationJournal, validateOptimizationJournal,
	beginOptimizationOperation, advanceOptimizationOperation, takeOverOptimizationOperation,
	UnverifiedOptimizationJournalError,
} from '../scripts/layers/optimization_journal.js';

const hash = 'a'.repeat(64);
let scene, flags, writes, intent;
const file = name => ({
	version: 1, root: 'worlds/test/recovery', path: `worlds/test/recovery/${name}`,
	bytes: 100, fingerprint: hash,
});
beforeEach(() => {
	flags = {}; writes = [];
	globalThis.game = {
		user: { id: 'gm001', isGM: true },
		users: { activeGM: { id: 'gm001' }, get: id => ({ id, active: false }) },
		i18n: { localize: key => key },
	};
	scene = {
		id: 'scene001', levels: new Set(['level001']), canUserModify: () => true,
		getFlag: (namespace, key) => flags[key],
		update: async (patch, options) => {
			writes.push({ patch: structuredClone(patch), options });
			flags[OPTIMIZATION_JOURNAL] = structuredClone(patch[`flags.foundryshop.${OPTIMIZATION_JOURNAL}`]);
		},
	};
	game.scenes = new Map([[scene.id, scene]]);
	intent = {
		token: 'operation001', sceneId: scene.id, levelId: 'level001', ownerId: game.user.id,
		action: 'apply', phase: 'intent', archive: file('originals-operation001.json'), archiveChecksum: hash,
		asset: file('baked-operation001.webp'), sourceCount: 500, sourceDigest: hash,
		replacement: { type: 'Drawing', id: 'composite001', beforeDigest: null, stagedDigest: hash, afterDigest: hash },
		parentToken: null,
	};
});
const options = () => ({ isCurrent: () => true, verifyIntent: async () => true, verifyPhase: async () => true });
const begin = (overrides = {}) => beginOptimizationOperation(scene, readOptimizationJournal(scene), intent, { ...options(), ...overrides });
const advance = (phase, overrides = {}) => advanceOptimizationOperation(scene, readOptimizationJournal(scene), intent.token,
	phase, { ...options(), ...overrides });

test('intent is persisted before work; JSON-round-tripped journal resumes every ordered phase', async () => {
	const started = await begin();
	assert.equal(started.revision, 1);
	assert.equal(started.entries[0].phase, 'intent');
	assert.equal(writes.length, 1);
	assert.equal(writes[0].options.diff, false);
	assert.equal(writes[0].options.foundryshopLayerOperation, true);
	for (const phase of ['assets-verified', 'replacement-staged', 'sources-removed', 'complete']) {
		flags[OPTIMIZATION_JOURNAL] = JSON.parse(JSON.stringify(readOptimizationJournal(scene)));
		const next = await advance(phase);
		assert.equal(next.entries[0].phase, phase);
	}
	assert.equal(readOptimizationJournal(scene).revision, 5);
	assert.equal(writes.length, 5);
	assert.equal(Object.hasOwn(readOptimizationJournal(scene).entries[0], 'originals'), false);
});

test('Drawing, Tile and Level-background descriptors validate distinct before/staged states', () => {
	for (const type of ['Drawing', 'Tile', 'LevelBackground']) {
		const entry = structuredClone(intent);
		entry.replacement = type === 'LevelBackground'
			? { type, id: 'level001', beforeDigest: hash, stagedDigest: null, afterDigest: hash }
			: { type, id: 'composite001', beforeDigest: null, stagedDigest: hash, afterDigest: hash };
		assert.equal(validateOptimizationJournal({ version: 1, revision: 0, entries: [entry] }, scene.id).entries[0].replacement.type, type);
		entry.replacement.beforeDigest = type === 'LevelBackground' ? null : hash;
		assert.throws(() => validateOptimizationJournal({ version: 1, revision: 0, entries: [entry] }, scene.id), /typed/);
	}
});

test('malformed/foreign/unknown journal records fail closed instead of defaulting to empty', () => {
	for (const patch of [{ version: 2 }, { revision: -1 }, { entries: null }, { extra: true }]) {
		flags[OPTIMIZATION_JOURNAL] = { version: 1, revision: 0, entries: [], ...patch };
		assert.throws(() => readOptimizationJournal(scene), /Invalid/);
	}
	for (const patch of [{ sceneId: 'another' }, { token: '' }, { sourceCount: 0 }, { sourceDigest: 'bad' },
		{ phase: 'unknown' }, { action: 'constructor' }, { action: ['apply'] }, { extra: true },
		{ archive: file('originals.png') }, { asset: intent.archive }, { parentToken: 'missing' }]) {
		assert.throws(() => validateOptimizationJournal({ version: 1, revision: 0, entries: [{ ...intent, ...patch }] }, scene.id));
	}
});

test('non-designated GM, missing permissions, changed Scene and unfinished imports refuse all writes', async () => {
	game.users.activeGM.id = 'anotherGM';
	await assert.rejects(begin(), /designated/);
	game.users.activeGM.id = game.user.id;
	scene.canUserModify = () => false;
	await assert.rejects(begin(), /permission/);
	scene.canUserModify = () => true;
	game.scenes.delete(scene.id);
	await assert.rejects(begin(), /identity/);
	game.scenes.set(scene.id, scene);
	flags.projectImportJournal = { token: 'unfinished' };
	await assert.rejects(begin(), /unfinished import/);
	assert.equal(writes.length, 0);
});

test('source/context and evidence guards are mandatory; mutation after async verification refuses', async () => {
	await assert.rejects(begin({ isCurrent: undefined }), /context/);
	await assert.rejects(begin({ verifyIntent: undefined }), /evidence/);
	await assert.rejects(begin({ verifyIntent: async () => ({ verified: true }) }), /evidence/);
	await assert.rejects(begin({ verifyIntent: async () => { game.users.activeGM.id = 'other'; return true; } }), /designated/);
	game.users.activeGM.id = game.user.id;
	await assert.rejects(begin({ verifyIntent: async () => { scene.levels.clear(); return true; } }), /removed/);
	assert.equal(writes.length, 0);
});

test('stale expected revision/record and simultaneous same-client intents cannot overwrite each other', async () => {
	const expected = readOptimizationJournal(scene), second = { ...intent, token: 'operation002' };
	const results = await Promise.allSettled([
		beginOptimizationOperation(scene, expected, intent, options()),
		beginOptimizationOperation(scene, expected, second, options()),
	]);
	assert.equal(results[0].status, 'fulfilled');
	assert.equal(results[1].status, 'rejected');
	assert.match(results[1].reason.message, /stale/);
	await assert.rejects(begin(), /unfinished/);
	await assert.rejects(advanceOptimizationOperation(scene, expected, intent.token, 'assets-verified', options()), /stale/);
	assert.equal(writes.length, 1);
});

test('phases cannot skip, regress, repeat or overwrite immutable intent fields', async () => {
	await begin();
	await assert.rejects(advance('sources-removed'), /next/);
	await advance('assets-verified');
	await assert.rejects(advance('assets-verified'), /next/);
	await assert.rejects(advance('intent'), /next/);
	await assert.rejects(advance('replacement-staged', { verifyPhase: async () => false }), /evidence/);
	const before = readOptimizationJournal(scene);
	await assert.rejects(advance('replacement-staged', {
		verifyPhase: async () => {
			flags[OPTIMIZATION_JOURNAL].entries[0].asset.fingerprint = 'b'.repeat(64);
			return true;
		},
	}), /stale/);
	assert.equal(writes.length, 2);
	flags[OPTIMIZATION_JOURNAL] = before;
	await advance('replacement-staged');
	assert.deepEqual(readOptimizationJournal(scene).entries[0].asset, intent.asset);
});

test('successful server write with lost response remains recoverable and cannot be blindly retried', async () => {
	const update = scene.update;
	scene.update = async (...args) => { await update(...args); throw new Error('response lost'); };
	await assert.rejects(begin(), error => error instanceof UnverifiedOptimizationJournalError
		&& error.token === intent.token && /response lost/.test(error.message));
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'intent');
	scene.update = update;
	await assert.rejects(begin(), /unfinished/);
	await advance('assets-verified');
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'assets-verified');
});

test('unverified readback and post-write context loss expose uncertainty and retain the record', async () => {
	scene.update = async () => {};
	await assert.rejects(begin(), error => error instanceof UnverifiedOptimizationJournalError && /stale/.test(error.message));
	assert.equal(readOptimizationJournal(scene).entries.length, 0);
	scene.update = async patch => {
		flags[OPTIMIZATION_JOURNAL] = structuredClone(patch[`flags.foundryshop.${OPTIMIZATION_JOURNAL}`]);
		game.user.isGM = false;
	};
	await assert.rejects(begin(), error => error instanceof UnverifiedOptimizationJournalError);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'intent');
});

test('interruption during deletion retains last verified phase; false evidence cannot mark success', async () => {
	await begin();
	await advance('assets-verified');
	await advance('replacement-staged');
	const documents = new Set(['original001', 'original002']);
	documents.delete('original001');
	await assert.rejects(advance('sources-removed', { verifyPhase: async () => documents.size === 0 }), /evidence/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'replacement-staged');
	documents.delete('original002');
	await advance('sources-removed', { verifyPhase: async () => documents.size === 0 });
	await assert.rejects(advance('complete', { verifyPhase: async () => { throw new Error('output changed'); } }), /output changed/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'sources-removed');
});

test('completed recovery stays immutable; fresh outputs require unique paths and valid lineage', async () => {
	await begin();
	for (const phase of ['assets-verified', 'replacement-staged', 'sources-removed', 'complete']) await advance(phase);
	await assert.rejects(advance('intent'), /next/);
	const first = readOptimizationJournal(scene).entries[0];
	intent = { ...intent, token: 'operation002', parentToken: first.token };
	await assert.rejects(begin(), /overwrite/);
	intent.archive = file('originals-operation002.json'); intent.asset = file('baked-operation002.webp');
	await begin();
	assert.deepEqual(readOptimizationJournal(scene).entries[0], first);
	assert.equal(readOptimizationJournal(scene).entries.length, 2);
});

test('restore intent uses exact applied recovery and its own ordered restore phases', async () => {
	await begin();
	for (const phase of ['assets-verified', 'replacement-staged', 'sources-removed', 'complete']) await advance(phase);
	const parent = readOptimizationJournal(scene).entries[0];
	intent = { ...parent, token: 'restore001', action: 'restore', phase: 'intent', parentToken: parent.token };
	await assert.rejects(beginOptimizationOperation(scene, readOptimizationJournal(scene),
		{ ...intent, sourceCount: 1 }, options()), /exact applied/);
	await begin();
	await assert.rejects(advance('replacement-staged'), /next/);
	for (const phase of ['assets-verified', 'originals-staged', 'replacement-reverted', 'complete']) await advance(phase);
	assert.equal(readOptimizationJournal(scene).entries[1].phase, 'complete');
	assert.deepEqual(readOptimizationJournal(scene).entries[0], parent);
	intent.token = 'restore002';
	await assert.rejects(begin(), /already has a restore/);
});

test('unfinished records must be last and repeated/foreign-Level lineage is refused', () => {
	const completed = { ...structuredClone(intent), phase: 'complete' };
	assert.throws(() => validateOptimizationJournal({
		version: 1, revision: 0, entries: [intent, { ...completed, token: 'operation002' }],
	}, scene.id), /final journal entry/);
	assert.throws(() => validateOptimizationJournal({
		version: 1, revision: 0, entries: [completed, { ...intent, token: 'operation002', levelId: 'other', parentToken: completed.token }],
	}, scene.id), /same Level/);
	assert.throws(() => validateOptimizationJournal({
		version: 1, revision: 0, entries: [completed, completed],
	}, scene.id), /Duplicate/);
});

test('phase evidence receives a detached copy and cannot mutate retained intent', async () => {
	await begin();
	await advance('assets-verified', { verifyPhase: async entry => {
		entry.asset.path = 'worlds/test/recovery/other.webp';
		entry.sourceCount = 1;
		return true;
	} });
	const stored = readOptimizationJournal(scene).entries[0];
	assert.deepEqual(stored.asset, intent.asset);
	assert.equal(stored.sourceCount, 500);
});

test('Level removal during evidence leaves last verified phase unchanged', async () => {
	await begin();
	await assert.rejects(advance('assets-verified', { verifyPhase: async () => {
		scene.levels.clear();
		return true;
	} }), /removed/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'intent');
	assert.equal(writes.length, 1);
});

test('reviewed owner handoff is allowed only for disconnected owners and does not advance phase', async () => {
	await begin();
	await advance('assets-verified');
	game.user = { id: 'gm002', isGM: true }; game.users.activeGM = { id: 'gm002' };
	const takeover = opts => takeOverOptimizationOperation(scene, readOptimizationJournal(scene), intent.token,
		{ isCurrent: () => true, verifyRecovery: async () => true, ...opts });
	game.users.get = () => ({ active: true });
	await assert.rejects(takeover(), /still active/);
	game.users.get = () => ({ active: false });
	await assert.rejects(takeover({ verifyRecovery: undefined }), /evidence/);
	await takeover();
	const entry = readOptimizationJournal(scene).entries[0];
	assert.equal(entry.ownerId, 'gm002');
	assert.equal(entry.phase, 'assets-verified');
	await advance('replacement-staged');
	await assert.rejects(takeover(), /no handoff/);
});

test('owner reconnect or active-GM election change during recovery prevents handoff', async () => {
	await begin();
	game.user = { id: 'gm002', isGM: true }; game.users.activeGM = { id: 'gm002' };
	const before = readOptimizationJournal(scene);
	await assert.rejects(takeOverOptimizationOperation(scene, before, intent.token, {
		isCurrent: () => true, verifyRecovery: async () => { game.users.get = () => ({ active: true }); return true; },
	}), /reconnected/);
	game.users.get = () => ({ active: false });
	await assert.rejects(takeOverOptimizationOperation(scene, before, intent.token, {
		isCurrent: () => true, verifyRecovery: async () => { game.users.activeGM.id = 'other'; return true; },
	}), /designated/);
	assert.equal(writes.length, 1);
});
