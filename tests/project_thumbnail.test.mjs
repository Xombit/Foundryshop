import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectThumbnail, thumbnailFromPreview, THUMBNAIL_LIMITS } from '../scripts/layers/project_thumbnail.js';
import { validateProjectPackage, PROJECT_FORMAT, PROJECT_VERSION, canonicalJson } from '../scripts/layers/project_package.js';

function thumbnail(width = 256, height = 192) {
	const bytes = new Uint8Array(30), view = new DataView(bytes.buffer);
	for (const [offset, text] of [[0, 'RIFF'], [8, 'WEBP'], [12, 'VP8 ']]) {
		bytes.set([...text].map(char => char.charCodeAt(0)), offset);
	}
	view.setUint32(4, 22, true); view.setUint32(16, 10, true);
	bytes.set([157, 1, 42], 23);
	view.setUint16(26, width, true); view.setUint16(28, height, true);
	return { mime: 'image/webp', scope: 'full-artwork', width, height, data: Buffer.from(bytes).toString('base64') };
}
const project = () => ({
	format: PROJECT_FORMAT, version: PROJECT_VERSION, name: 'Empty', scope: 'full', coordinateSpace: 'scene-pixels',
	source: { foundry: '14.365', drawingSchema: '14.355' }, tree: { version: 1, revision: 0, nodes: [], presets: [] },
	drawings: [], recovery: [], bounds: null, dependencies: {},
});
beforeEach(() => { globalThis.game = { i18n: { localize: key => key } }; });

test('optional bounded thumbnail metadata preserves older packages and canonical artwork', () => {
	const old = validateProjectPackage(project());
	assert.equal(Object.hasOwn(old, 'thumbnail'), false);
	const embedded = validateProjectPackage({ ...old, thumbnail: thumbnail() });
	assert.deepEqual(embedded.thumbnail, thumbnail());
	delete embedded.thumbnail;
	assert.equal(canonicalJson(embedded), canonicalJson(old));
	assert.deepEqual(thumbnailFromPreview({
		src: `data:image/webp;base64,${thumbnail().data}`, width: 256, height: 192,
	}), thumbnail());
});

test('embedded metadata rejects URLs, unsupported MIME/scope/keys, dimensions, base64 and byte overruns', () => {
	for (const change of [
		{ mime: 'image/png' }, { scope: 'player-view' }, { url: 'https://example.test/image.webp' },
		{ width: 513 }, { height: 0 }, { width: 1.5 }, { width: 255 },
		{ data: 'data:image/webp;base64,abc' }, { data: 'http://example.test' }, { data: 'AA=A' },
		{ data: 'A'.repeat(4 * Math.ceil(THUMBNAIL_LIMITS.bytes / 3) + 4) },
	]) assert.throws(() => validateProjectPackage({ ...project(), thumbnail: { ...thumbnail(), ...change } }));
	for (const invalid of [null, [], {}, 'thumbnail']) {
		assert.throws(() => validateProjectPackage({ ...project(), thumbnail: invalid }));
	}
});

test('WEBP validation rejects truncated/forged RIFF, no image, animation and bad chunks before any decoding', () => {
	for (const mutate of [
		bytes => bytes[0] = 0,
		bytes => bytes[4] = 0,
		bytes => bytes[16] = 255,
		bytes => bytes.set([...Buffer.from('ANIM')], 12),
		bytes => bytes.set([...Buffer.from('JUNK')], 12),
		bytes => bytes[23] = 0,
	]) {
		const value = thumbnail(), bytes = Buffer.from(value.data, 'base64');
		mutate(bytes); value.data = bytes.toString('base64');
		assert.throws(() => validateProjectThumbnail(value));
	}
});

test('VP8X dimensions must agree with actual image bitstream and animation is rejected', () => {
	const value = thumbnail(), bytes = new Uint8Array(48), view = new DataView(bytes.buffer);
	bytes.set(Buffer.from(value.data, 'base64').subarray(0, 12));
	bytes.set(Buffer.from('VP8X'), 12); view.setUint32(16, 10, true);
	bytes[24] = 255; bytes[27] = 191;
	bytes.set(Buffer.from(value.data, 'base64').subarray(12), 30);
	view.setUint32(4, 40, true);
	value.data = Buffer.from(bytes).toString('base64');
	assert.deepEqual(validateProjectThumbnail(value), value);
	bytes[20] = 2; value.data = Buffer.from(bytes).toString('base64');
	assert.throws(() => validateProjectThumbnail(value), /Animated/);
	bytes[20] = 0; bytes[44] = 1; value.data = Buffer.from(bytes).toString('base64');
	assert.throws(() => validateProjectThumbnail(value));
});

test('exact encoded-byte and dimension ceilings are accepted; oversized decoded dimensions are not', () => {
	const value = thumbnail(512, 512);
	const bytes = new Uint8Array(THUMBNAIL_LIMITS.bytes), view = new DataView(bytes.buffer);
	bytes.set(Buffer.from(value.data, 'base64'));
	bytes.set(Buffer.from('JUNK'), 30);
	view.setUint32(34, bytes.length - 38, true);
	view.setUint32(4, bytes.length - 8, true);
	value.data = Buffer.from(bytes).toString('base64');
	assert.deepEqual(validateProjectThumbnail(value), value);
	assert.throws(() => validateProjectThumbnail(thumbnail(513, 512)));
});
