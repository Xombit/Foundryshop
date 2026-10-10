import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { verifyBakeTileDisplay, verifyBakeBackgroundDisplay, verifyConsolidationDisplay } from '../scripts/bake_display.js';
import { prepareBakeOutputFile } from '../scripts/layers/bake_replacement.js';

let input, current, events, gpuError, axis, readback, decodeHook;
function png() {
	const bytes = new Uint8Array(58), view = new DataView(bytes.buffer);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); view.setUint32(8, 13);
	bytes.set([... 'IHDR'].map(c => c.charCodeAt()), 12); view.setUint32(16, 8); view.setUint32(20, 4);
	view.setUint32(33, 1); bytes.set([... 'IDAT'].map(c => c.charCodeAt()), 37);
	bytes.set([... 'IEND'].map(c => c.charCodeAt()), 50); return bytes;
}
beforeEach(async () => {
	current = true; events = []; gpuError = 0; axis = 16; readback = new Uint8Array(4); decodeHook = null;
	globalThis.game = { user: { isGM: true } };
	const gl = () => ({ MAX_TEXTURE_SIZE: 1, MAX_RENDERBUFFER_SIZE: 2, MAX_VIEWPORT_DIMS: 3, NO_ERROR: 0,
		getParameter: key => key === 3 ? [16, 16] : axis, isContextLost: () => false, getError: () => gpuError });
	globalThis.canvas = { app: { renderer: { gl: gl(), render() { assert.fail('live renderer touched'); },
		extract: { pixels() { assert.fail('live renderer touched'); } } } } };
	globalThis.createImageBitmap = async () => {
		const bitmap = { width: 8, height: 4, close() { events.push('bitmap-close'); } };
		decodeHook?.(bitmap); return bitmap;
	};
	globalThis.PIXI = {
		Renderer: class {
			constructor(options) { events.push('renderer-create'); assert.equal(options.width, 1); this.gl = gl();
				this.extract = { pixels: () => readback }; }
			render(sprite) { events.push('render'); assert.equal(sprite.texture.width, 8); assert.equal(sprite.width, 1); }
			destroy() { events.push('renderer-destroy'); }
		},
		BaseTexture: class { constructor(bitmap) { this.bitmap = bitmap; } destroy() { events.push('base-destroy'); } },
		Texture: class {
			constructor(base) { this.base = base; this.width = base.bitmap.width; this.height = base.bitmap.height; this.valid = true; }
			destroy(all) { events.push('texture-destroy'); if (all) this.base.destroy(); }
		},
		Sprite: class { constructor(texture) { this.texture = texture; } destroy() { events.push('sprite-destroy'); } },
	};
	const blob = new Blob([png()], { type: 'image/png' }), output = await prepareBakeOutputFile(blob, 'worlds/test', 'display');
	const after = { width: 8, height: 4, texture: { src: output.path, anchorX: 0, anchorY: 0,
		scaleX: 1, scaleY: 1, fit: 'fill' } };
	input = { blob, output, width: 8, height: 4, replacement: { type: 'Tile', staged: structuredClone(after), after } };
});
const verify = options => verifyBakeTileDisplay(input, { isCurrent: () => current, ...options });

test('Consolidate full-image Drawing mapping shares isolated full-resolution GPU acceptance', async () => {
	const after = { texture: input.output.path, shape: { type: 'r', width: 8, height: 4 },
		flags: { foundryshop: { imageStamp: 1 } }, fillType: 2, fillColor: '#ffffff', fillAlpha: 1,
		strokeWidth: 0, rotation: 0, text: '' };
	input.replacement = { type: 'Drawing', staged: structuredClone(after), after };
	assert.equal(await verifyConsolidationDisplay(input, { isCurrent: () => current }), true);
	after.shape.width = 7;
	await assert.rejects(verifyConsolidationDisplay(input, { isCurrent: () => current }), /full-image Drawing mapping/);
});

test('uploads full-resolution owned texture and samples isolated target without touching live renderer', async () => {
	assert.equal(await verify(), true);
	assert.deepEqual(events, ['bitmap-close', 'renderer-create', 'render', 'sprite-destroy',
		'texture-destroy', 'base-destroy', 'renderer-destroy', 'bitmap-close']);
});
test('actual live GPU axis refuses oversized native images before decode or allocation', async () => {
	axis = 4; await assert.rejects(verify(), /exceeds.*GPU texture axis/); assert.deepEqual(events, []);
});
test('different output/native mapping and corrupt bytes refuse', async () => {
	input.replacement.after.texture.src = 'wrong.png';
	await assert.rejects(verify(), /exact neutral/);
	input.replacement.after.texture.src = input.output.path;
	input.blob = new Blob([1, 2, 3]); await assert.rejects(verify(), /persisted reference/);
	assert.deepEqual(events, []);
});
test('center-anchored Tile sources refuse the top-left reviewed output mapping', async () => {
	input.replacement.after.texture.anchorX = 0.5;
	await assert.rejects(verify(), /exact neutral/);
	assert.deepEqual(events, []);
});
test('GPU initialization errors and failed readback surface and release all owned resources', async () => {
	gpuError = 1285; await assert.rejects(verify(), /initialization/);
	assert.ok(events.includes('renderer-destroy')); assert.equal(events.at(-1), 'bitmap-close');
	gpuError = 0; events = []; readback = new Uint8Array(0);
	await assert.rejects(verify(), /readback/);
	assert.ok(events.indexOf('texture-destroy') < events.indexOf('renderer-destroy'));
	assert.equal(events.at(-1), 'bitmap-close');
});
test('context changes during decode and cancellation refuse without leaking bitmaps', async () => {
	decodeHook = () => { current = false; };
	await assert.rejects(verify(), /context changed/); assert.equal(events.at(-1), 'bitmap-close');
	current = true; decodeHook = null;
	const controller = new AbortController(); controller.abort();
	await assert.rejects(verify({ signal: controller.signal }), /cancelled/);
});

function backgroundInput() {
	return { ...input, replacement: { type: 'LevelBackground', after: {
		background: { src: input.output.path, color: '#ffffff', tint: '#ffffff' },
		textures: { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0,
			fit: 'fill', scaleX: 1, scaleY: 1, rotation: 0 },
	} } };
}

test('neutral Level background uses the same full-resolution isolated GPU acceptance', async () => {
	assert.equal(await verifyBakeBackgroundDisplay(backgroundInput(), { isCurrent: () => current }), true);
	assert.ok(events.includes('render'));
	assert.equal(events.at(-1), 'bitmap-close');
});

test('background display rejects wrong path, tint or shared transform before allocation', async () => {
	for (const mutate of [
		data => { data.replacement.after.background.src = 'wrong.png'; },
		data => { data.replacement.after.background.tint = '#ff0000'; },
		data => { data.replacement.after.textures.rotation = 45; },
		data => { data.replacement.after.textures.extra = 1; },
	]) {
		const data = backgroundInput(); mutate(data);
		await assert.rejects(verifyBakeBackgroundDisplay(data, { isCurrent: () => current }), /neutral Level/);
	}
	assert.deepEqual(events, []);
});

test('background GPU limits and context changes fail closed', async () => {
	axis = 4;
	await assert.rejects(verifyBakeBackgroundDisplay(backgroundInput(), { isCurrent: () => current }), /GPU texture axis/);
	axis = 16; decodeHook = () => { current = false; };
	await assert.rejects(verifyBakeBackgroundDisplay(backgroundInput(), { isCurrent: () => current }), /context changed/);
	assert.equal(events.at(-1), 'bitmap-close');
});
