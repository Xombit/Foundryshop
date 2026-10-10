import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadBakeImage, visitBakeImageTiles, paintBakeImage, acquireBakeImageTexture } from '../scripts/bake_resources.js';
import { inspectOptimizationImage } from '../scripts/optimization_media.js';
import { fileFingerprint } from '../scripts/verified_file_storage.js';

function png(width, height, payload = 1, animation = false) {
	const chunks = [['IHDR', new Uint8Array(13)], ...(animation ? [['acTL', new Uint8Array(8)]] : []),
		['IDAT', new Uint8Array(payload)], ['IEND', new Uint8Array()]];
	new DataView(chunks[0][1].buffer).setUint32(0, width);
	new DataView(chunks[0][1].buffer).setUint32(4, height);
	const bytes = new Uint8Array(8 + chunks.reduce((sum, [, data]) => sum + data.length + 12, 0));
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
	let offset = 8;
	for (const [type, data] of chunks) {
		new DataView(bytes.buffer).setUint32(offset, data.length);
		bytes.set([...type].map(c => c.charCodeAt(0)), offset + 4);
		bytes.set(data, offset + 8); offset += data.length + 12;
	}
	return bytes;
}
let bytes, requests, bitmaps, bases, textures, current, decode, renderer, headers;
beforeEach(() => {
	bytes = png(9, 6); requests = []; bitmaps = []; bases = []; textures = []; current = true; decode = null; headers = {};
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.game = { user: { isGM: true } };
	globalThis.fetch = async (url, options) => {
		requests.push({ url, options });
		return new Response(bytes, { headers });
	};
	globalThis.createImageBitmap = async (...args) => {
		let size;
		if (args[0] instanceof Blob) size = inspectOptimizationImage(new Uint8Array(await args[0].arrayBuffer()));
		else size = { width: args[3], height: args[4] };
		const bitmap = { width: size.width, height: size.height, closed: 0, close() { this.closed++; } };
		bitmaps.push(bitmap); decode?.(bitmap, args);
		return bitmap;
	};
	globalThis.PIXI = {
		BaseTexture: class { constructor(bitmap) { this.bitmap = bitmap; bases.push(this); } destroy() { this.destroyed = true; } },
		Texture: class {
			constructor(base) { this.base = base; this.valid = true; this.width = base.bitmap.width; this.height = base.bitmap.height; textures.push(this); }
			destroy(all) { this.destroyed = true; if (all) this.base.destroy(); }
		},
	};
	renderer = { gl: { MAX_TEXTURE_SIZE: 1, MAX_RENDERBUFFER_SIZE: 2, MAX_VIEWPORT_DIMS: 3,
		isContextLost: () => false, getParameter: key => key === 3 ? [4, 4] : 4 },
		render() {}, extract: { pixels() {} } };
	globalThis.canvas = { app: { renderer } };
});
const options = () => ({ isCurrent: () => current });
const load = extra => loadBakeImage('worlds/test/map.png', { ...options(), ...extra });

test('retains exact original bytes and fingerprint for 48MP and long-axis images without preview budgets', async () => {
	for (const [width, height] of [[8000, 6000], [20000, 1000]]) {
		bytes = png(width, height);
		const image = await load();
		try {
			assert.equal(image.width, width); assert.equal(image.height, height);
			assert.deepEqual(new Uint8Array(await image.blob.arrayBuffer()), bytes);
			assert.equal(image.blob.type, 'image/png');
			assert.equal(image.fingerprint, await fileFingerprint(bytes));
			assert.equal(image.estimate.decodedRgbaBytes, width * height * 4);
			assert.equal(Object.isFrozen(image), true);
		} finally { image.destroy(); image.destroy(); }
	}
	assert.equal(bitmaps.every(bitmap => bitmap.closed === 1), true);
});

test('image byte size above the stamp cap is accepted rather than silently constrained', async () => {
	bytes = png(9, 6, 17 * 1024 * 1024);
	const image = await load();
	assert.equal(image.bytes, bytes.length);
	image.destroy();
});

test('optional reviewed byte budget bounds declared and streamed images before decode', async () => {
	for (const maxBytes of [0, -1, 1.5]) await assert.rejects(load({ maxBytes }), /Invalid/);
	assert.equal(requests.length, 0);
	headers = { 'content-length': String(bytes.length) };
	await assert.rejects(load({ maxBytes: bytes.length - 1 }), /byte budget/);
	headers = {};
	let cancelled = false;
	globalThis.fetch = async () => ({
		ok: true, headers: new Headers(), body: new ReadableStream({
			start(controller) { controller.enqueue(bytes.subarray(0, 20)); controller.enqueue(bytes.subarray(20)); },
			cancel() { cancelled = true; },
		}),
	});
	await assert.rejects(load({ maxBytes: bytes.length - 1 }), /byte budget/);
	assert.equal(cancelled, true);
	assert.equal(bitmaps.length, 0);
	globalThis.fetch = async () => new Response(bytes);
	const image = await load({ maxBytes: bytes.length });
	assert.equal(image.bytes, bytes.length); image.destroy();
});
test('external consent precedes contact and external requests omit credentials and refuse redirects', async () => {
	await assert.rejects(loadBakeImage('https://example.org/map.png', options()), /acknowledgement/);
	for (const path of ['data:image/png;base64,x', 'file:///private.png', 'https://u:p@example.org/map.png']) {
		await assert.rejects(loadBakeImage(path, options()), /invalid/);
	}
	assert.equal(requests.length, 0);
	const image = await loadBakeImage('https://example.org/map.png', { ...options(), acknowledgeExternal: true });
	assert.equal(requests[0].options.credentials, 'omit');
	assert.equal(requests[0].options.redirect, 'error');
	image.destroy();
});

test('unknown and animated media are refused before decode, not baked as first frames', async () => {
	for (const input of [new TextEncoder().encode('GIF89a'), png(9, 6, 1, true)]) {
		bytes = input;
		await assert.rejects(load(), /unsupported|static|Animated/);
	}
	assert.equal(bitmaps.length, 0);
});

test('HTTP errors and declared length mismatches fail; compressed length is not compared to decoded bytes', async () => {
	headers = { 'content-length': '1' };
	await assert.rejects(load(), /declared byte length/);
	headers = { 'content-length': '1', 'content-encoding': 'gzip' };
	const image = await load(); image.destroy();
	globalThis.fetch = async () => new Response(null, { status: 404 });
	await assert.rejects(load(), /HTTP 404/);
});

test('decode mismatch, lost currentness and cancellation close the decoded bitmap', async () => {
	decode = bitmap => bitmap.width--;
	await assert.rejects(load(), /header dimensions/);
	decode = () => { current = false; };
	await assert.rejects(load(), /changed/);
	current = true;
	const controller = new AbortController();
	decode = () => controller.abort();
	await assert.rejects(load({ signal: controller.signal }), /cancelled/);
	assert.equal(bitmaps.every(bitmap => bitmap.closed === 1), true);
});

test('streams close on cancellation and fetch timeout is not success-shaped', async () => {
	let cancelled = false;
	globalThis.fetch = async () => ({
		ok: true, headers: new Headers(),
		body: new ReadableStream({ pull(controller) { controller.enqueue(bytes); current = false; },
			cancel() { cancelled = true; } }),
	});
	await assert.rejects(load(), /changed/);
	assert.equal(cancelled, true);
	current = true;
	globalThis.fetch = async (url, { signal }) => new Promise((resolve, reject) =>
		signal.addEventListener('abort', () => reject(new Error('fetch aborted')), { once: true }));
	await assert.rejects(load({ timeout: 5 }), /fetch aborted/);
});

test('GPU-bounded input crops preserve coordinates and release each texture before the next visit', async () => {
	const image = await load(), seen = [];
	try {
		await visitBakeImageTiles(image, tile => {
			assert.equal(textures.slice(0, -1).every(texture => texture.destroyed), true);
			seen.push([tile.x, tile.y, tile.width, tile.height]);
		}, options());
		assert.deepEqual(seen, [[0, 0, 4, 4], [4, 0, 4, 4], [8, 0, 1, 4], [0, 4, 4, 2], [4, 4, 4, 2], [8, 4, 1, 2]]);
		assert.equal(textures.every(texture => texture.destroyed), true);
		assert.equal(bitmaps.slice(1).every(bitmap => bitmap.closed === 1), true);
		assert.equal(bitmaps[0].closed, 0);
	} finally { image.destroy(); }
});

test('failed tile callback and crop mismatch clean all transient resources and allow retry', async () => {
	const image = await load();
	try {
		await assert.rejects(visitBakeImageTiles(image, () => { throw new Error('visitor failed'); }, options()), /visitor failed/);
		assert.equal(textures[0].destroyed, true);
		decode = bitmap => bitmap.height--;
		await assert.rejects(visitBakeImageTiles(image, () => {}, options()), /crop dimensions/);
		assert.equal(bitmaps.at(-1).closed, 1);
		decode = null;
		await visitBakeImageTiles(image, () => {}, options());
	} finally { image.destroy(); }
});

test('tile cancellation, GPU loss and renderer replacement refuse incomplete input visits', async () => {
	for (const change of [() => { current = false; }, () => { renderer.gl.isContextLost = () => true; },
		() => { canvas.app.renderer = {}; }]) {
		current = true; renderer.gl.isContextLost = () => false; canvas.app.renderer = renderer;
		const image = await load();
		try {
			await assert.rejects(visitBakeImageTiles(image, change, options()), /changed|lost/);
			assert.equal(textures.at(-1).destroyed, true);
			assert.equal(bitmaps.at(-1).closed, 1);
		} finally { image.destroy(); }
	}
});

test('owned images refuse overlapping visits, closed or fabricated resources and missing guards', async () => {
	await assert.rejects(load({ isCurrent: undefined }), /explicit/);
	const image = await load();
	try {
		await visitBakeImageTiles(image, async () => {
			await assert.rejects(visitBakeImageTiles(image, () => {}, options()), /exclusive/);
		}, options());
		await assert.rejects(visitBakeImageTiles({ ...image }, () => {}, options()), /owned/);
	} finally { image.destroy(); }
	await assert.rejects(visitBakeImageTiles(image, () => {}, options()), /open/);
});

test('texture construction failure releases its base and crop bitmap; closing during visit invalidates success', async () => {
	const image = await load(), Texture = PIXI.Texture;
	try {
		PIXI.Texture = class { constructor() { throw new Error('GPU allocation failed'); } };
		await assert.rejects(visitBakeImageTiles(image, () => {}, options()), /GPU allocation failed/);
		assert.equal(bases[0].destroyed, true);
		assert.equal(bitmaps.at(-1).closed, 1);
		PIXI.Texture = Texture;
		await assert.rejects(visitBakeImageTiles(image, () => image.destroy(), options()), /resource changed/);
		assert.equal(textures.at(-1).destroyed, true);
	} finally { image.destroy(); PIXI.Texture = Texture; }
});

test('cancellation during the final yield is still a failed visit', async () => {
	bytes = png(1, 1);
	const image = await load();
	try {
		await assert.rejects(visitBakeImageTiles(image, () => {
			setTimeout(() => { current = false; }, 0);
		}, options()), /changed/);
	} finally { image.destroy(); }
});

test('CPU image painting preserves full-source mapping and refuses invalid or concurrently visited resources', async () => {
	const image = await load(), calls = [], context = { drawImage: (...args) => calls.push(args) };
	const destination = { x: -4, y: -2, width: 18, height: 12 };
	try {
		paintBakeImage(image, context, destination, options());
		assert.deepEqual(calls[0].slice(1), [-4, -2, 18, 12]);
		assert.equal(calls[0][0], bitmaps[0]);
		assert.throws(() => paintBakeImage(image, context, { ...destination, width: 0 }, options()), /finite positive/);
		await visitBakeImageTiles(image, () => {
			assert.throws(() => paintBakeImage(image, context, destination, options()), /exclusive/);
		}, options());
		current = false;
		assert.throws(() => paintBakeImage(image, context, destination, options()), /changed/);
	} finally { image.destroy(); }
	current = true;
	assert.throws(() => paintBakeImage(image, context, destination, options()), /owned open/);
});

test('full-image texture leases enforce GPU axes, exact dimensions, ownership and idempotent cleanup', async () => {
	bytes = png(4, 4);
	const image = await load(), lease = acquireBakeImageTexture(image, options());
	assert.equal(lease.assertCurrent(), true);
	lease.destroy(); lease.destroy();
	assert.equal(lease.texture.destroyed, true);
	assert.equal(bitmaps[0].closed, 0);
	assert.throws(() => lease.assertCurrent(), /closed/);
	image.destroy();
	assert.throws(() => acquireBakeImageTexture(image, options()), /owned open/);
	assert.throws(() => acquireBakeImageTexture({ ...image }, options()), /owned open/);
	bytes = png(5, 4);
	const large = await load();
	try { assert.throws(() => acquireBakeImageTexture(large, options()), /actual GPU texture axes/); }
	finally { large.destroy(); }
});
