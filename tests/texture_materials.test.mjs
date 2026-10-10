import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { verifyLocalMaterial } from '../scripts/texture_materials.js';

beforeEach(() => {
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.game = { i18n: { localize: key => key } };
});

test('material verification uses bounded shared loading and releases all owned resources', async () => {
	const calls = [];
	const asset = { bitmap: { width: 256, height: 512, close: () => calls.push('bitmap') },
		texture: { destroy: base => calls.push(base) } };
	const result = await verifyLocalMaterial('worlds/test/stone.webp', {}, async (path, signal) => {
		assert.equal(path, 'worlds/test/stone.webp'); assert.equal(signal, undefined); return asset;
	});
	assert.deepEqual(result, { path: 'worlds/test/stone.webp', width: 256, height: 512 });
	assert.deepEqual(calls, [true, 'bitmap']);
});

test('material picker refuses external and transient paths before any resource request', async () => {
	for (const path of ['https://external.example/stone.png', '//external.example/a.png', 'blob:temporary',
		'data:image/png;base64,abc', '', ' padded.png ', 'a\\b.png', 'a'.repeat(2049)]) {
		await assert.rejects(verifyLocalMaterial(path, {}, () => assert.fail('Unexpected request')), /LocalOnly/);
	}
});

test('decode failures surface and cancelled results dispose rather than being selected', async () => {
	await assert.rejects(verifyLocalMaterial('stone.png', {}, async () => { throw new Error('Decode failure'); }), /Decode failure/);
	const controller = new AbortController();
	let closed = 0;
	await assert.rejects(verifyLocalMaterial('stone.png', { signal: controller.signal }, async () => {
		controller.abort();
		return { texture: { destroy: () => closed++ }, bitmap: { close: () => closed++ } };
	}), { name: 'AbortError' });
	assert.equal(closed, 2);
});
