import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	persistVerifiedFile, readVerifiedFile, validateStoredFile, UnverifiedFileError,
} from '../scripts/verified_file_storage.js';

let files, uploads, fetchOptions, current;
const root = 'worlds/test/internal recovery', filename = 'originals-token.json';
beforeEach(() => {
	files = new Map(); uploads = []; fetchOptions = []; current = true;
	globalThis.game = { user: { isGM: true, can: () => true }, i18n: { localize: key => key } };
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.foundry = { applications: { apps: { FilePicker: { implementation: {
		browse: async () => ({ files: [...files.keys()] }),
		upload: async (source, folder, file) => {
			const path = `${folder}/${file.name}`;
			uploads.push(path); files.set(path, new Uint8Array(await file.arrayBuffer()));
			return { path };
		},
	} } } } };
	globalThis.fetch = async (url, options) => {
		fetchOptions.push(options);
		const path = decodeURIComponent(url.pathname).slice(1);
		return new Response(files.get(path), { status: files.has(path) ? 200 : 404 });
	};
});
const save = (options = {}) => persistVerifiedFile(new Blob(['{"originals":[]}'], { type: 'application/json' }),
	{ root, filename, isCurrent: () => current, ...options });

test('persistent byte reference survives JSON round-trip and fresh read without upload state', async () => {
	const reference = await save();
	assert.equal(reference.bytes, 16);
	assert.equal(reference.fingerprint.length, 64);
	assert.deepEqual(new TextDecoder().decode(await readVerifiedFile(JSON.parse(JSON.stringify(reference)))), '{"originals":[]}');
	assert.deepEqual(uploads, [`${root}/${filename}`]);
	assert.equal(fetchOptions[0].cache, 'no-store');
	assert.equal(fetchOptions[0].redirect, 'error');
	assert.equal(fetchOptions[0].credentials, 'same-origin');
});

test('byte storage preserves original-format files without implying image decode support', async () => {
	const blob = new Blob([new Uint8Array([0, 255, 128, 42])], { type: 'image/avif' });
	const reference = await persistVerifiedFile(blob, { root, filename: 'background-original.avif', isCurrent: () => true });
	assert.deepEqual(await readVerifiedFile(reference, { timeout: 0 }), new Uint8Array([0, 255, 128, 42]));
});

test('collision, unsafe paths and invalid listing refuse before upload', async () => {
	files.set(`${root}/${filename.toUpperCase()}`, new Uint8Array([1]));
	await assert.rejects(save(), /occupied/);
	assert.equal(uploads.length, 0);
	for (const options of [{ root: '../escape' }, { root: 'modules/foundryshop' }, { filename: '../escape.json' }]) {
		await assert.rejects(save(options));
	}
	foundry.applications.apps.FilePicker.implementation.browse = async () => ({ files: null });
	await assert.rejects(save(), /listing/);
	assert.equal(uploads.length, 0);
});

test('authority, cancellation and explicit currentness guard are required', async () => {
	await assert.rejects(save({ isCurrent: undefined }), /explicit/);
	current = false;
	await assert.rejects(save(), /changed/);
	current = true;
	await assert.rejects(save({ signal: AbortSignal.abort() }), /cancelled/);
	game.user.can = permission => permission !== 'FILES_UPLOAD';
	await assert.rejects(save(), /permissions/);
	assert.equal(uploads.length, 0);
});

test('context or permission changes after browsing prevent upload', async () => {
	const picker = foundry.applications.apps.FilePicker.implementation;
	picker.browse = async () => { current = false; return { files: [] }; };
	await assert.rejects(save(), /changed/);
	current = true;
	picker.browse = async () => { game.user.isGM = false; return { files: [] }; };
	await assert.rejects(save(), /permissions/);
	assert.equal(uploads.length, 0);
});

test('denied/ambiguous uploads expose intended path and never remove a possibly written file', async () => {
	const picker = foundry.applications.apps.FilePicker.implementation;
	picker.upload = async () => { throw new Error('Server upload denied'); };
	await assert.rejects(save(), error => error instanceof UnverifiedFileError
		&& error.path === `${root}/${filename}` && /denied/.test(error.message));
	picker.upload = async () => ({ path: 'worlds/elsewhere/originals.json' });
	await assert.rejects(save(), /exact requested path/);
});

test('changed readback and lost authority after upload retain unverified file path', async () => {
	globalThis.fetch = async () => new Response('{"originals":{}}');
	await assert.rejects(save(), error => error instanceof UnverifiedFileError && /fingerprint/.test(error.message));
	assert.equal(files.size, 1);
	const picker = foundry.applications.apps.FilePicker.implementation;
	files.clear();
	picker.upload = async () => { current = false; return { path: `${root}/${filename}` }; };
	await assert.rejects(save(), error => error instanceof UnverifiedFileError && /changed/.test(error.message));
});

test('truncated, oversized, header-mismatched, missing and same-size modified files are refused', async () => {
	const reference = await save();
	for (const [text, pattern] of [['tiny', /truncated/], ['x'.repeat(17), /exceeds/], ['x'.repeat(16), /fingerprint/]]) {
		files.set(reference.path, new TextEncoder().encode(text));
		await assert.rejects(readVerifiedFile(reference), pattern);
	}
	globalThis.fetch = async () => new Response('tiny', { headers: { 'content-length': '4' } });
	await assert.rejects(readVerifiedFile(reference), /size differs/);
	globalThis.fetch = async () => new Response(null, { status: 404 });
	await assert.rejects(readVerifiedFile(reference), /HTTP 404/);
});

test('compressed content-length is not mistaken for decoded byte count', async () => {
	const reference = await save();
	globalThis.fetch = async () => new Response(files.get(reference.path), {
		headers: { 'content-encoding': 'gzip', 'content-length': '12' },
	});
	assert.equal((await readVerifiedFile(reference)).length, reference.bytes);
});

test('read currentness/cancellation are checked after asynchronous fetch', async () => {
	const reference = await save(), controller = new AbortController();
	globalThis.fetch = async () => { controller.abort(); return new Response(files.get(reference.path)); };
	await assert.rejects(readVerifiedFile(reference, { signal: controller.signal }), /cancelled/);
	globalThis.fetch = async () => { game.user.isGM = false; return new Response(files.get(reference.path)); };
	await assert.rejects(readVerifiedFile(reference), /permissions/);
});

test('references reject path traversal, foreign roots, malformed sizes and unknown metadata', async () => {
	const reference = await save();
	for (const patch of [{ path: `${root}/../escape.json` }, { root: 'worlds/elsewhere' }, { root: null },
		{ bytes: -1 }, { bytes: Infinity }, { fingerprint: 'x'.repeat(64) }, { extra: true }]) {
		assert.throws(() => validateStoredFile({ ...reference, ...patch }));
	}
});

test('in-flight same-path writes are refused and lock releases after failure', async () => {
	const picker = foundry.applications.apps.FilePicker.implementation;
	let release, started;
	const entered = new Promise(resolve => { started = resolve; });
	picker.browse = () => { started(); return new Promise(resolve => { release = resolve; }); };
	const first = save();
	await entered;
	await assert.rejects(save(), /already being written/);
	release({ files: null });
	await assert.rejects(first, /listing/);
	picker.browse = async () => ({ files: [] });
	await save();
	assert.equal(uploads.length, 1);
});
