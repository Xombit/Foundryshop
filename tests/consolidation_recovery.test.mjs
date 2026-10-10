import test from 'node:test';
import assert from 'node:assert/strict';
import { createConsolidationArchive, readConsolidationArchive, prepareConsolidationRestore } from '../scripts/layers/consolidation_recovery.js';
import {
	prepareConsolidationPersistence, persistConsolidationArchive, readStoredConsolidationArchive,
} from '../scripts/layers/consolidation_storage.js';

function fixture() {
	globalThis.game = { version: '14.365', user: { isGM: true }, i18n: { localize: k => k } };
	globalThis.getDocumentClass = () => ({ metadata: { schemaVersion: '14.355' } });
	const data = {
		name: '', x: 10, y: 20, elevation: 0, sort: 1, levels: ['ground'], rotation: 0, bezierFactor: 0.5,
		shape: { type: 'p', width: 50, height: 30, points: [0, 0, 20, 30, 50, 0], radius: null },
		fillType: 0, fillColor: '#ffffff', fillAlpha: 0.5, strokeWidth: 8, strokeColor: '#8040ff', strokeAlpha: 0.7,
		texture: null, text: '', fontFamily: '', fontSize: 48, textColor: '#ffffff', textAlpha: 1,
		hidden: false, locked: false, interface: false, flags: { custom: { kept: true } },
	};
	const document = (id, source) => ({ id, getFlag: (n, k) => source.flags[n]?.[k], toObject: () => structuredClone(source), source });
	const original = document('original', { ...structuredClone(data), _id: 'original', author: 'author' });
	const scene = { id: 'scene', name: 'Map', levels: new Set(['ground']), drawings: new Map([['original', original]]),
		flags: { layers: { version: 1, revision: 0, nodes: [], presets: [] } },
		getFlag(n, k) { return this.flags[k]; } };
	original.parent = scene;
	const replacement = { id: 'composite', layerId: null, data: { ...structuredClone(data),
		shape: { type: 'r', width: 50, height: 30, points: [], radius: null },
		fillType: 2, texture: 'maps/composite.webp', flags: { foundryshop: { imageStamp: 1 } },
	} };
	const create = () => createConsolidationArchive(scene, ['original'], replacement, { id: 'archive', levelId: 'ground' });
	const consolidateFixture = () => {
		scene.drawings.delete('original');
		scene.drawings.set('composite', document('composite', { ...structuredClone(replacement.data), _id: 'composite', author: 'gm' }));
		scene.drawings.set('newer', document('newer', { ...structuredClone(data), _id: 'newer', author: 'gm' }));
	};
	return { scene, original, replacement, create, consolidateFixture };
}
test('archive round-trip verifies checksum and preserves full original sources without writing the Scene', async () => {
	const f = fixture(), before = f.original.toObject();
	const created = await f.create(), read = await readConsolidationArchive(created.text);
	assert.equal(created.sourceCount, 1);
	assert.equal(created.checksum.length, 64);
	assert.deepEqual(read.payload.originals, [before]);
	assert.deepEqual(f.original.toObject(), before);
	assert.equal(f.scene.drawings.size, 1);
});
test('restoration preview preserves original IDs/authors/flags and leaves newer strokes untouched', async () => {
	const f = fixture(), created = await f.create(), before = f.original.toObject();
	f.consolidateFixture();
	const newer = f.scene.drawings.get('newer').toObject();
	const plan = await prepareConsolidationRestore(f.scene, created.text);
	assert.equal(plan.strategy, 'restore-preview-only');
	assert.deepEqual(plan.create, [before]);
	assert.equal(plan.removeCompositeId, 'composite');
	assert.deepEqual(f.scene.drawings.get('newer').toObject(), newer);
	assert.equal(f.scene.drawings.size, 2);
});
test('archive corruption, unknown metadata, source conflicts and oversize input refuse restoration', async () => {
	const f = fixture(), created = await f.create(), archive = JSON.parse(created.text);
	archive.payload.originals[0].strokeWidth++;
	await assert.rejects(readConsolidationArchive(JSON.stringify(archive)), /match/);
	archive.payload.originals[0].strokeWidth--;
	archive.checksum = '0'.repeat(64);
	await assert.rejects(readConsolidationArchive(JSON.stringify(archive)), /checksum/);
	await assert.rejects(readConsolidationArchive(' '.repeat(5 * 1024 * 1024 + 1)), /limits/);
	f.consolidateFixture();
	f.scene.drawings.get('composite').source.x++;
	await assert.rejects(prepareConsolidationRestore(f.scene, created.text), /edited/);
	f.scene.drawings.get('composite').source.x--;
	f.scene.drawings.set('original', f.original);
	await assert.rejects(prepareConsolidationRestore(f.scene, created.text), /occupied/);
});
test('archive creation detects source changes during digest and denies unsupported replacement', async () => {
	const f = fixture();
	const pending = f.create();
	f.original.source.x++;
	await assert.rejects(pending, /changed during/);
	f.replacement.data.flags.foundryshop.imageStamp = 2;
	await assert.rejects(f.create(), /image stamp/);
});
test('restore rejects wrong Scene, missing Level and lost GM authority', async () => {
	const f = fixture(), created = await f.create();
	f.consolidateFixture();
	f.scene.id = 'different';
	await assert.rejects(prepareConsolidationRestore(f.scene, created.text), /mismatch/);
	f.scene.id = 'scene';
	f.scene.levels.clear();
	await assert.rejects(prepareConsolidationRestore(f.scene, created.text), /mismatch/);
	game.user.isGM = false;
	await assert.rejects(prepareConsolidationRestore(f.scene, created.text), /GM/);
});

test('archive validation rejects source metadata that cannot survive durable JSON round-trip', async () => {
	const f = fixture();
	f.original.source.name = undefined;
	await assert.rejects(f.create(), /round-trip/);
});

test('restoration authority is rechecked after asynchronous checksum verification', async () => {
	const f = fixture(), created = await f.create();
	f.consolidateFixture();
	const pending = prepareConsolidationRestore(f.scene, created.text);
	game.user.isGM = false;
	await assert.rejects(pending, /authority changed/);
});

function storageFixture() {
	const f = fixture(), files = new Map(), uploads = [];
	game.user.can = () => true;
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.foundry = { applications: { apps: { FilePicker: { implementation: {
		browse: async () => ({ files: [...files.keys()] }),
		upload: async (source, root, file) => {
			const path = `${root}/${file.name}`;
			uploads.push(path); files.set(path, await file.text()); return { path };
		},
	} } } } };
	globalThis.fetch = async url => {
		const path = decodeURIComponent(url.pathname).slice(1);
		return new Response(files.get(path), { status: files.has(path) ? 200 : 404 });
	};
	const prepare = text => prepareConsolidationPersistence(f.scene, text, { root: 'worlds/test/recovery', token: 'operation001' });
	const persist = (text, reference, options = {}) => persistConsolidationArchive(f.scene, text, reference,
		{ isCurrent: () => true, ...options });
	return { ...f, files, uploads, prepare, persist };
}

test('durable archive persistence verifies readback without any Scene writes and reloads for restore', async () => {
	const f = storageFixture(), original = f.original.toObject(), created = await f.create();
	const reference = await f.prepare(created.text);
	assert.equal(f.files.size, 0);
	assert.equal(reference.archiveId, 'archive');
	const saved = await f.persist(created.text, reference);
	assert.deepEqual(saved, reference);
	assert.deepEqual(f.original.toObject(), original);
	assert.equal(f.scene.drawings.size, 1);
	f.consolidateFixture();
	const loaded = await readStoredConsolidationArchive(JSON.parse(JSON.stringify(saved)));
	const plan = await prepareConsolidationRestore(f.scene, loaded.text);
	assert.deepEqual(plan.create, [original]);
	assert.equal(f.scene.drawings.has('newer'), true);
	assert.equal(f.uploads.length, 1);
});

test('archive identity, byte reference, journal guard and changed originals refuse persistence', async () => {
	const f = storageFixture(), created = await f.create(), reference = await f.prepare(created.text);
	await assert.rejects(f.persist(created.text, { ...reference, archiveId: 'other' }), /does not match/);
	await assert.rejects(f.persist(created.text, { ...reference, file: { ...reference.file, fingerprint: '0'.repeat(64) } }), /bytes differ/);
	await assert.rejects(f.persist(created.text, reference, { isCurrent: undefined }), /explicit/);
	await assert.rejects(f.persist(created.text, reference, { isCurrent: () => false }), /journal/);
	f.original.source.strokeWidth++;
	await assert.rejects(f.persist(created.text, reference), /changed during/);
	assert.equal(f.uploads.length, 0);
	assert.equal(f.scene.drawings.size, 1);
});

test('missing or replaced stored archives and forged reference identity refuse reload', async () => {
	const f = storageFixture(), created = await f.create(), reference = await f.prepare(created.text);
	await f.persist(created.text, reference);
	await assert.rejects(readStoredConsolidationArchive({ ...reference, sceneId: 'other' }), /identity/);
	f.files.set(reference.file.path, f.files.get(reference.file.path).replace('"author"', '"edited"'));
	await assert.rejects(readStoredConsolidationArchive(reference), /fingerprint/);
	f.files.clear();
	await assert.rejects(readStoredConsolidationArchive(reference), /HTTP 404/);
});

test('source edits during upload leave originals intact and retain an unverified file for reconciliation', async () => {
	const f = storageFixture(), created = await f.create(), reference = await f.prepare(created.text);
	const picker = foundry.applications.apps.FilePicker.implementation, upload = picker.upload;
	picker.upload = async (...args) => {
		const result = await upload(...args);
		f.original.source.x++;
		return result;
	};
	await assert.rejects(f.persist(created.text, reference), error => error.path === reference.file.path && /changed/.test(error.message));
	assert.equal(f.files.size, 1);
	assert.equal(f.scene.drawings.has('original'), true);
});

test('unfinished import refuses archive preparation/persistence before file writes', async () => {
	const f = storageFixture(), created = await f.create();
	f.scene.flags.projectImportJournal = { token: 'unfinished' };
	await assert.rejects(f.prepare(created.text), /changed during/);
	assert.equal(f.files.size, 0);
});
