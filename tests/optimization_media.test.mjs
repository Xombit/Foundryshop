import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	inspectOptimizationImage, acceptOptimizationImage, optimizationOutputVerifier,
} from '../scripts/optimization_media.js';
import { fileFingerprint } from '../scripts/verified_file_storage.js';

function png(width, height, animation = false) {
	const chunks = [['IHDR', new Uint8Array(13)], ...(animation ? [['acTL', new Uint8Array(8)]] : []),
		['IDAT', new Uint8Array([1])], ['IEND', new Uint8Array()]];
	new DataView(chunks[0][1].buffer).setUint32(0, width);
	new DataView(chunks[0][1].buffer).setUint32(4, height);
	const bytes = new Uint8Array(8 + chunks.reduce((sum, [, data]) => sum + data.length + 12, 0));
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
	let offset = 8;
	for (const [type, data] of chunks) {
		new DataView(bytes.buffer).setUint32(offset, data.length);
		bytes.set([...type].map(value => value.charCodeAt(0)), offset + 4);
		bytes.set(data, offset + 8); offset += data.length + 12;
	}
	return bytes;
}
function webp(width, height, animation = false) {
	const bytes = new Uint8Array(animation ? 46 : 38), view = new DataView(bytes.buffer);
	for (const [offset, text] of [[0, 'RIFF'], [8, 'WEBP'], [12, 'VP8X'], [30, 'VP8 '], ...(animation ? [[38, 'ANIM']] : [])]) {
		bytes.set([...text].map(value => value.charCodeAt(0)), offset);
	}
	view.setUint32(4, bytes.length - 8, true); view.setUint32(16, 10, true);
	for (const [offset, value] of [[24, width - 1], [27, height - 1]]) {
		bytes[offset] = value & 255; bytes[offset + 1] = value >> 8 & 255; bytes[offset + 2] = value >> 16 & 255;
	}
	return bytes;
}
function jpeg(width, height) {
	const bytes = new Uint8Array([255, 216, 255, 192, 0, 8, 8, 0, 0, 0, 0, 0, 255, 217]);
	const view = new DataView(bytes.buffer); view.setUint16(7, height); view.setUint16(9, width);
	return bytes;
}
let decoded, closed, current;
beforeEach(() => {
	decoded = []; closed = 0; current = true;
	globalThis.game = { user: { isGM: true }, i18n: { localize: key => key } };
	globalThis.createImageBitmap = async (blob, options) => {
		decoded.push({ blob, options });
		const header = inspectOptimizationImage(new Uint8Array(await blob.arrayBuffer()));
		return { width: header.width, height: header.height, close: () => closed++ };
	};
});
const reference = async (bytes, extension = 'png') => ({
	version: 1, root: 'worlds/test/recovery', path: `worlds/test/recovery/output.${extension}`,
	bytes: bytes.length, fingerprint: await fileFingerprint(bytes),
});
const options = () => ({ isCurrent: () => current });

test('accepts reviewed 48MP and long-axis headers without stamp/publication budgets', async () => {
	for (const [width, height] of [[8000, 6000], [20000, 1000]]) {
		const bytes = png(width, height), file = await reference(bytes);
		assert.equal(await acceptOptimizationImage(bytes, file, { width, height }, options()), true);
	}
	assert.equal(closed, 2);
	assert.deepEqual(decoded[0].options, { imageOrientation: 'none' });
	assert.equal(decoded[0].blob.type, 'image/png');
});

test('static WEBP container dimensions and format are accepted through actual decoder adapter', async () => {
	const bytes = webp(8000, 6000);
	assert.equal(await acceptOptimizationImage(bytes, await reference(bytes, 'webp'), { width: 8000, height: 6000 }, options()), true);
	assert.equal(decoded[0].blob.type, 'image/webp');
	assert.equal(closed, 1);
});

test('static JPEG output accepts jpg/jpeg filenames and refuses a missing end marker', async () => {
	const bytes = jpeg(8000, 6000);
	for (const extension of ['jpg', 'jpeg']) {
		assert.equal(await acceptOptimizationImage(bytes, await reference(bytes, extension), { width: 8000, height: 6000 }, options()), true);
	}
	assert.equal(closed, 2);
	assert.throws(() => inspectOptimizationImage(bytes.slice(0, -2)), /incomplete/);
});

test('APNG, flagged/chunked animated WEBP, unknown/video media and malformed containers refuse before decode', () => {
	assert.throws(() => inspectOptimizationImage(png(100, 100, true)), /Animated/);
	assert.throws(() => inspectOptimizationImage(webp(100, 100, true)), /Animated/);
	const flagged = webp(100, 100); flagged[20] = 2;
	assert.throws(() => inspectOptimizationImage(flagged), /Animated/);
	for (const bytes of [new Uint8Array([1, 2]), new TextEncoder().encode('GIF89a'),
		new TextEncoder().encode('<svg/>'), png(100, 100).slice(0, -1), webp(100, 100).slice(0, -1)]) {
		assert.throws(() => inspectOptimizationImage(bytes));
	}
	assert.equal(decoded.length, 0);
});

test('PNG signature, chunk order and WEBP container lengths are validated', () => {
	const wrongSignature = png(10, 10); wrongSignature[4] = 0;
	assert.throws(() => inspectOptimizationImage(wrongSignature), /signature/);
	const wrongLength = webp(10, 10); wrongLength[4]++;
	assert.throws(() => inspectOptimizationImage(wrongLength), /size/);
	const extra = new Uint8Array(png(10, 10).length + 1); extra.set(png(10, 10));
	assert.throws(() => inspectOptimizationImage(extra), /end chunk/);
});

test('byte identity, file format and reviewed dimensions must all match before decode', async () => {
	const bytes = png(8000, 6000), file = await reference(bytes);
	await assert.rejects(acceptOptimizationImage(bytes, { ...file, fingerprint: '0'.repeat(64) }, { width: 8000, height: 6000 }, options()), /persisted reference/);
	await assert.rejects(acceptOptimizationImage(bytes, file, { width: 4000, height: 3000 }, options()), /reviewed/);
	await assert.rejects(acceptOptimizationImage(bytes, { ...file, path: file.path.replace('.png', '.webp') },
		{ width: 8000, height: 6000 }, options()), /filename/);
	assert.equal(decoded.length, 0);
});

test('decode size mismatch, lost authority/currentness or cancellation always close returned bitmap', async () => {
	const bytes = png(10, 10), file = await reference(bytes);
	globalThis.createImageBitmap = async () => ({ width: 9, height: 10, close: () => closed++ });
	await assert.rejects(acceptOptimizationImage(bytes, file, { width: 10, height: 10 }, options()), /Browser-decoded/);
	globalThis.createImageBitmap = async () => {
		current = false;
		return { width: 10, height: 10, close: () => closed++ };
	};
	await assert.rejects(acceptOptimizationImage(bytes, file, { width: 10, height: 10 }, options()), /changed/);
	current = true;
	const controller = new AbortController();
	globalThis.createImageBitmap = async () => {
		controller.abort();
		return { width: 10, height: 10, close: () => closed++ };
	};
	await assert.rejects(acceptOptimizationImage(bytes, file, { width: 10, height: 10 }, {
		...options(), signal: controller.signal,
	}), /cancelled/);
	assert.equal(closed, 3);
});

test('decoder errors propagate and unavailable API does not invent success', async () => {
	const bytes = png(10, 10), file = await reference(bytes);
	globalThis.createImageBitmap = async () => { throw new Error('allocation failed'); };
	await assert.rejects(acceptOptimizationImage(bytes, file, { width: 10, height: 10 }, options()), /allocation failed/);
	delete globalThis.createImageBitmap;
	await assert.rejects(acceptOptimizationImage(bytes, file, { width: 10, height: 10 }, options()), /decode API/);
	assert.equal(closed, 0);
});

test('verifier snapshots file and dimensions; another reference cannot reuse it', async () => {
	const bytes = png(10, 10), file = await reference(bytes), size = { width: 10, height: 10 };
	const verify = optimizationOutputVerifier(file, size, options());
	size.width = 20;
	assert.equal(await verify(bytes, file), true);
	assert.equal(await verify(bytes, { fingerprint: file.fingerprint, bytes: file.bytes, path: file.path,
		root: file.root, version: file.version }), true);
	assert.throws(() => verify(bytes, { ...file, path: file.path.replace('output', 'other') }), /different file/);
	file.fingerprint = '0'.repeat(64);
	assert.throws(() => verify(bytes, file), /different file/);
});

test('invalid dimensions, cancelled jobs and missing review guard refuse', async () => {
	const bytes = png(10, 10), file = await reference(bytes);
	for (const size of [{ width: 0, height: 10 }, { width: 1.5, height: 10 }, { width: 1e10, height: 1e10 }]) {
		await assert.rejects(acceptOptimizationImage(bytes, file, size, options()), /safe-integer/);
	}
	await assert.rejects(acceptOptimizationImage(bytes, file, { width: 10, height: 10 }), /guard/);
	await assert.rejects(acceptOptimizationImage(bytes, file, { width: 10, height: 10 }, {
		...options(), signal: AbortSignal.abort(),
	}), /cancelled/);
	assert.equal(decoded.length, 0);
});
