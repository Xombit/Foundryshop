import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync } from '../scripts/vendor/fflate.js';
import { encodeRecoveryFileBundle, decodeRecoveryFileBundle, prepareRecoveryFileBundle } from '../scripts/layers/recovery_file_bundle.js';
import { fileFingerprint } from '../scripts/verified_file_storage.js';
import { canonicalJson } from '../scripts/layers/project_package.js';
import { optimizationArchiveDescriptor } from '../scripts/layers/optimization_recovery.js';

const limits = { maxBytes: 1024 * 1024, maxEntries: 20 };
const png = new Uint8Array(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
const reference = async (name, bytes) => ({
	version: 1, root: 'worlds/test/recovery', path: `worlds/test/recovery/${name}`,
	bytes: bytes.length, fingerprint: await fileFingerprint(bytes),
});
async function fixture(type = 'Drawing', parent = null) {
	const output = { reference: await reference(`output-${type}.png`, png), bytes: png.slice() };
	const level = { _id: 'level001', background: { src: null, color: '#335544' }, flags: {} };
	const original = { _id: 'stroke001', author: 'gm001', levels: [level._id],
		shape: { type: 'r', width: 10, height: 10, points: [] }, flags: {} };
	const after = type === 'LevelBackground' ? { ...level, background: { ...level.background, src: output.reference.path } }
		: { ...original, _id: `replacement${type}`, hidden: false,
			texture: type === 'Drawing' ? output.reference.path : { src: output.reference.path } };
	const payload = {
		format: 'foundryshop-optimization-recovery', version: 1, id: `apply${type}`, sceneId: 'scene001',
		levelId: level._id, scope: { kind: 'selection', layerId: null },
		context: { scene: { width: 640, height: 400, padding: 0, grid: {} },
			layers: { version: 1, revision: 0, nodes: [], presets: [] }, level },
		originals: [parent ? parent.payload.replacement.after : original],
		replacement: { type, id: after._id, before: type === 'LevelBackground' ? level : null,
			staged: type === 'LevelBackground' ? null : { ...after, hidden: true }, after },
		output: output.reference, originalBackground: null,
		parent: parent ? { file: parent.file.reference, checksum: parent.checksum } : null,
	};
	if (type === 'LevelBackground') payload.replacement.id = level._id;
	const checksum = await fileFingerprint(new TextEncoder().encode(canonicalJson(payload)));
	const bytes = new TextEncoder().encode(JSON.stringify({ payload, checksum }));
	const file = { reference: await reference(`recovery-${type}.json`, bytes), bytes };
	return { payload, checksum, file, output, files: [file, output] };
}
const unpack = bytes => unzipSync(bytes);
const repack = entries => zipSync(entries, { level: 0 });

test('Drawing, Tile and color-background files round-trip with exact binary bytes and immutable source references', async () => {
	for (const type of ['Drawing', 'Tile', 'LevelBackground']) {
		const { files } = await fixture(type), before = structuredClone(files);
		const result = await decodeRecoveryFileBundle(await encodeRecoveryFileBundle(files, limits), limits);
		assert.deepEqual(result, before);
		assert.deepEqual(files, before);
	}
});

test('retains Drawing ancestor archive/output bytes for a Tile child and refuses omitted ancestors', async () => {
	const parent = await fixture(), child = await fixture('Tile', parent), files = [...parent.files, ...child.files];
	assert.deepEqual(await decodeRecoveryFileBundle(await encodeRecoveryFileBundle(files, limits), limits), files);
	await assert.rejects(encodeRecoveryFileBundle(child.files, limits), /ancestry/);
});

test('requires explicit budgets and rejects sizes before producing or reading a ZIP', async () => {
	const { files } = await fixture(), bytes = await encodeRecoveryFileBundle(files, limits);
	for (const options of [undefined, { maxBytes: 0, maxEntries: 5 }, { maxBytes: 100, maxEntries: 65535 }]) {
		await assert.rejects(encodeRecoveryFileBundle(files, options), /budgets/);
		await assert.rejects(decodeRecoveryFileBundle(bytes, options), /budgets/);
	}
	await assert.rejects(encodeRecoveryFileBundle(files, { ...limits, maxBytes: 100 }), /budget/);
	await assert.rejects(decodeRecoveryFileBundle(bytes, { ...limits, maxBytes: 100 }), /budget/);
});

test('refuses changed hashes, missing outputs, duplicate references and unrelated image files', async () => {
	const { files } = await fixture(), altered = structuredClone(files);
	altered[1].bytes[0] ^= 1;
	await assert.rejects(encodeRecoveryFileBundle(altered, limits), /verified bytes/);
	await assert.rejects(encodeRecoveryFileBundle([files[0]], limits), /missing an exact output/);
	await assert.rejects(encodeRecoveryFileBundle([...files, files[0]], limits), /duplicated/);
	const extra = { reference: await reference('unrelated.png', png), bytes: png };
	await assert.rejects(encodeRecoveryFileBundle([...files, extra], limits), /unreferenced/);
});

test('refuses ZIP compression, truncation, trailing bytes and local/directory disagreement', async () => {
	const bytes = await encodeRecoveryFileBundle((await fixture()).files, limits);
	await assert.rejects(decodeRecoveryFileBundle(zipSync(unpack(bytes), { level: 6 }), limits), /compression/);
	await assert.rejects(decodeRecoveryFileBundle(bytes.slice(0, -1), limits), /complete/);
	await assert.rejects(decodeRecoveryFileBundle(new Uint8Array([...bytes, 0]), limits), /complete/);
	const changed = bytes.slice(); new DataView(changed.buffer).setUint32(18, 123, true);
	await assert.rejects(decodeRecoveryFileBundle(changed, limits), /local entry/);
});

test('rejects undeclared entries, traversal names and redirected manifest references', async () => {
	const bytes = await encodeRecoveryFileBundle((await fixture()).files, limits);
	let entries = unpack(bytes);
	entries[`files/${'a'.repeat(64)}.png`] = png;
	await assert.rejects(decodeRecoveryFileBundle(repack(entries), limits), /undeclared/);
	entries = unpack(bytes); entries['../outside.png'] = png;
	await assert.rejects(decodeRecoveryFileBundle(repack(entries), limits), /unsafe/);
	entries = unpack(bytes);
	const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']));
	manifest.files[0].entry = '../outside.json';
	entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
	await assert.rejects(decodeRecoveryFileBundle(repack(entries), limits), /exact file inventory/);
});

test('rejects duplicate ZIP names before decompression rather than allowing last-entry replacement', async () => {
	const name = `files/${'a'.repeat(64)}.png`, alias = `files/${'b'.repeat(64)}.png`;
	const bytes = zipSync({ 'manifest.json': new TextEncoder().encode('{}'), [name]: png, [alias]: png }, { level: 0 });
	const from = new TextEncoder().encode(alias), to = new TextEncoder().encode(name);
	for (let i = 0; i <= bytes.length - from.length; i++) {
		if (from.every((byte, offset) => bytes[i + offset] === byte)) bytes.set(to, i);
	}
	await assert.rejects(decodeRecoveryFileBundle(bytes, limits), /duplicate entry names/);
});

test('refuses image container mismatch and typed-archive checksum corruption even with a refreshed file hash', async () => {
	const { files } = await fixture(), image = { reference: await reference('output.webp', png), bytes: png };
	await assert.rejects(encodeRecoveryFileBundle([files[0], image], limits), /extension/);
	const envelope = JSON.parse(new TextDecoder().decode(files[0].bytes));
	envelope.payload.originals[0].shape.width = 11;
	const bytes = new TextEncoder().encode(JSON.stringify(envelope));
	await assert.rejects(encodeRecoveryFileBundle([
		{ reference: await reference('recovery-mutated.json', bytes), bytes }, files[1],
	], limits), /checksum/);
});

test('retains verified original-background byte copy and refuses its omission', async () => {
	const data = await fixture('LevelBackground'), backup = { reference: await reference('original-copy.png', png), bytes: png };
	data.payload.context.level.background.src = 'maps/original.png';
	data.payload.originalBackground = { src: 'maps/original.png', file: backup.reference };
	const checksum = await fileFingerprint(new TextEncoder().encode(canonicalJson(data.payload)));
	const bytes = new TextEncoder().encode(JSON.stringify({ payload: data.payload, checksum }));
	const file = { reference: await reference('recovery-image-background.json', bytes), bytes };
	const files = [file, data.output, backup];
	assert.deepEqual(await decodeRecoveryFileBundle(await encodeRecoveryFileBundle(files, limits), limits), files);
	await assert.rejects(encodeRecoveryFileBundle([file, data.output], limits), /original-background/);
});

test('read-only collector verifies journal descriptors and refuses stale context without native or file writes', async () => {
	const data = await fixture(), archiveText = new TextDecoder().decode(data.file.bytes),
		descriptor = await optimizationArchiveDescriptor(archiveText);
	const entry = { ...descriptor, token: data.payload.id, sceneId: 'scene001', levelId: 'level001',
		ownerId: 'gm001', action: 'apply', phase: 'complete', archive: data.file.reference, parentToken: null };
	const state = { journal: { version: 1, revision: 1, entries: [entry] }, drawings: ['liveComposite'] };
	const scene = { id: 'scene001', levels: new Map([['level001', {}]]),
		getFlag: (namespace, key) => key === 'optimizationJournal' ? state.journal : undefined,
		toObject: () => structuredClone(state) };
	const old = { game: globalThis.game, location: globalThis.location, fetch: globalThis.fetch };
	globalThis.game = { user: { id: 'gm001', isGM: true, can: () => true }, scenes: new Map([[scene.id, scene]]) };
	globalThis.location = { href: 'http://localhost:30000/game' };
	const byPath = new Map(data.files.map(file => [file.reference.path, file.bytes]));
	let change = false;
	globalThis.fetch = async url => {
		if (change) state.drawings.push('unrelatedEdit');
		const bytes = byPath.get(decodeURIComponent(url.pathname).slice(1));
		return new Response(bytes, { status: bytes ? 200 : 404 });
	};
	try {
		const result = await prepareRecoveryFileBundle(scene, { ...limits, levelId: 'level001', isCurrent: () => true });
		assert.deepEqual(await decodeRecoveryFileBundle(result.bytes, limits), data.files);
		assert.deepEqual(result.review.operationTokens, ['applyDrawing']);
		assert.deepEqual(state.drawings, ['liveComposite']);
		change = true;
		await assert.rejects(prepareRecoveryFileBundle(scene, { ...limits, levelId: 'level001', isCurrent: () => true }), /context changed/);
		change = false;
		entry.archiveChecksum = 'f'.repeat(64);
		await assert.rejects(prepareRecoveryFileBundle(scene, { ...limits, levelId: 'level001', isCurrent: () => true }), /journal operation/);
		entry.phase = 'intent';
		await assert.rejects(prepareRecoveryFileBundle(scene, { ...limits, levelId: 'level001', isCurrent: () => true }), /unfinished/);
	} finally {
		globalThis.game = old.game; globalThis.location = old.location; globalThis.fetch = old.fetch;
	}
});
