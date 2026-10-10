import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { bakeRasterDimensions, bakeRasterCapabilities, renderBakeRaster } from '../scripts/bake_raster.js';
import { renderBakeBackground } from '../scripts/bake_background.js';
import { loadBakeImage } from '../scripts/bake_resources.js';

let renderer, surfaces, targets, roots, writes, current, encodeFailure, closes, composites;
function encodedPng(width, height) {
	const bytes = new Uint8Array(58), view = new DataView(bytes.buffer);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
	view.setUint32(8, 13); bytes.set([... 'IHDR'].map(c => c.charCodeAt()), 12);
	view.setUint32(16, width); view.setUint32(20, height);
	view.setUint32(33, 1); bytes.set([... 'IDAT'].map(c => c.charCodeAt()), 37);
	bytes.set([... 'IEND'].map(c => c.charCodeAt()), 50);
	return new Blob([bytes], { type: 'image/png' });
}
beforeEach(() => {
	surfaces = []; targets = []; roots = []; writes = []; composites = []; current = true; encodeFailure = null; closes = 0;
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.game = { user: { isGM: true }, i18n: { localize: key => key } };
	renderer = {
		gl: { MAX_TEXTURE_SIZE: 1, MAX_RENDERBUFFER_SIZE: 2, MAX_VIEWPORT_DIMS: 3,
			isContextLost: () => false, getParameter: key => key === 3 ? [4, 4] : 4 },
		render: (root, options) => { options.renderTexture.position = { ...root.position }; },
		extract: { pixels: target => new Uint8Array(target.width * target.height * 4).fill(255) },
	};
	globalThis.canvas = { app: { renderer } };
	globalThis.PIXI = { ALPHA_MODES: { NPM: 0 }, RenderTexture: { create: size => {
		const target = { ...size, baseTexture: { alphaMode: 1 }, destroy() { this.destroyed = true; } };
		targets.push(target); return target;
	} } };
	globalThis.document = { createElement: () => {
		const context = {
			putImageData: (image, x, y) => writes.push({ image, x, y }),
			globalCompositeOperation: 'source-over',
			save() { this.saved = this.globalCompositeOperation; },
			restore() { this.globalCompositeOperation = this.saved; },
			drawImage(...args) { composites.push({ type: 'draw', mode: this.globalCompositeOperation, args }); },
			fillRect(...args) { composites.push({ type: 'fill', mode: this.globalCompositeOperation, color: this.fillStyle, args }); },
			getImageData(x, y, width, height) { return new ImageData(new Uint8ClampedArray(width * height * 4).fill(128), width, height); },
		};
		const surface = { width: 0, height: 0, getContext: () => context,
			toBlob: callback => callback(encodeFailure ?? encodedPng(surface.width, surface.height)) };
		surfaces.push(surface); return surface;
	} };
	globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
	globalThis.createImageBitmap = async () => ({ width: 9, height: 6, close: () => closes++ });
});
const build = async () => {
	const root = { parent: null, children: [], rotation: 0, alpha: 1, scale: { x: 1, y: 1 },
		pivot: { x: 0, y: 0 }, position: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } },
		destroy() { this.destroyed = true; } };
	roots.push(root); return root;
};
const render = patch => renderBakeRaster({ bounds: { x: 10, y: 20, width: 9, height: 6 },
	format: 'png', tileAxis: 4, isCurrent: () => current, buildDisplay: build, ...patch });

test('48MP and long-axis sizing have advisory memory, no publication cap', () => {
	assert.deepEqual(bakeRasterDimensions({ x: 0, y: 0, width: 8000, height: 6000 }),
		{ width: 8000, height: 6000, pixels: 48000000, rgbaBytes: 192000000 });
	assert.equal(bakeRasterDimensions({ x: 0, y: 0, width: 20000, height: 1000 }).width, 20000);
	assert.throws(() => bakeRasterDimensions({ x: 0, y: 0, width: Infinity, height: 1 }), /finite/);
	assert.throws(() => bakeRasterDimensions({ x: 0, y: 0, width: 9.5, height: 1 }), /integer reviewed/);
});

test('tiles GPU targets at verified limits without shrinking full output, handles edge tiles and offsets', async () => {
	const progress = [];
	const result = await render({ onProgress: state => progress.push(state) });
	assert.equal(result.width, 9); assert.equal(result.height, 6);
	assert.deepEqual(writes.map(({ x, y, image }) => [x, y, image.width, image.height]),
		[[0, 0, 4, 4], [4, 0, 4, 4], [8, 0, 1, 4], [0, 4, 4, 2], [4, 4, 4, 2], [8, 4, 1, 2]]);
	assert.deepEqual(targets.map(target => [target.position.x, target.position.y]),
		[[-10, -20], [-14, -20], [-18, -20], [-10, -24], [-14, -24], [-18, -24]]);
	assert.equal(targets.every(target => target.destroyed && target.baseTexture.alphaMode === 1), true);
	assert.equal(roots[0].destroyed, true);
	assert.equal(closes, 1);
	assert.equal(surfaces[0].width, 1);
	assert.equal(progress.at(-1).completed, 6);
});

test('capabilities clamp working tiles only and refuse unavailable/context-lost GPU', () => {
	assert.equal(bakeRasterCapabilities(renderer, 1024).tileAxis, 4);
	renderer.gl.getParameter = () => 0;
	assert.throws(() => bakeRasterCapabilities(renderer), /verified/);
	renderer.gl.isContextLost = () => true;
	assert.throws(() => bakeRasterCapabilities(renderer), /available/);
});

test('cancellation after tile progress cleans graph/targets and never starts encoding', async () => {
	const controller = new AbortController();
	await assert.rejects(render({ signal: controller.signal, onProgress: () => controller.abort() }), /cancelled/);
	assert.equal(writes.length, 1);
	assert.equal(targets.every(target => target.destroyed), true);
	assert.equal(roots[0].destroyed, true);
	assert.equal(closes, 0);
	assert.equal(surfaces[0].width, 1);
	await render();
});

test('extraction and encoder failures release owned resources and do not fake smaller output', async () => {
	renderer.extract.pixels = () => new Uint8Array(3);
	await assert.rejects(render(), /incomplete pixels/);
	assert.equal(targets[0].destroyed, true);
	assert.equal(roots[0].destroyed, true);
	renderer.extract.pixels = target => new Uint8Array(target.width * target.height * 4);
	encodeFailure = new Blob(['bad'], { type: 'image/webp' });
	await assert.rejects(render(), /substituted/);
	assert.equal(surfaces.every(surface => surface.width === 1), true);
});

test('decode mismatch closes bitmap and fails exact output acceptance', async () => {
	globalThis.createImageBitmap = async () => ({ width: 8, height: 6, close: () => closes++ });
	await assert.rejects(render(), /dimension\/decode/);
	assert.equal(closes, 1);
	assert.equal(roots[0].destroyed, true);
});

test('neutral detached graph and explicit guards are mandatory', async () => {
	await assert.rejects(render({ isCurrent: undefined }), /explicit/);
	await assert.rejects(render({ buildDisplay: async () => {
		const root = await build(); root.alpha = 0.5; return root;
	} }), /neutral/);
	assert.equal(roots[0].destroyed, true);
	current = false;
	await assert.rejects(render(), /context/);
});

test('overlapping jobs refuse, lock releases after failed display construction', async () => {
	let entered, release;
	const started = new Promise(resolve => entered = resolve);
	const pending = render({ buildDisplay: async () => {
		entered(); await new Promise(resolve => release = resolve); throw new Error('display unavailable');
	} });
	await started;
	await assert.rejects(render(), /already/);
	release(); await assert.rejects(pending, /display unavailable/);
	await render();
});

test('borrowed attached canvas containers are refused without destroying or moving them', async () => {
	let borrowed;
	await assert.rejects(render({ buildDisplay: async () => {
		borrowed = await build(); borrowed.parent = { live: true }; return borrowed;
	} }), /attached live/);
	assert.equal(borrowed.destroyed, undefined);
	assert.deepEqual([borrowed.position.x, borrowed.position.y], [0, 0]);
});

test('GPU context loss during rendering cleans targets and refuses partial success', async () => {
	renderer.render = () => { renderer.gl.isContextLost = () => true; };
	await assert.rejects(render(), /lost its GPU/);
	assert.equal(targets[0].destroyed, true);
	assert.equal(writes.length, 0);
	assert.equal(roots[0].destroyed, true);
});

test('alpha extraction is clamped and applied without changing pixel output coordinates', async () => {
	renderer.extract.pixels = target => {
		const pixels = new Uint8Array(target.width * target.height * 4);
		for (let i = 0; i < pixels.length; i += 4) pixels.set([128, 64, 0, 128], i);
		return pixels;
	};
	await render();
	assert.deepEqual([...writes[0].image.data.slice(0, 4)], [255, 128, 0, 128]);
});

test('malformed graphs and null encodes report explicit errors and release the busy guard', async () => {
	await assert.rejects(render({ buildDisplay: async () => ({ children: [] }) }), /neutral/);
	const create = document.createElement;
	document.createElement = () => {
		const surface = create();
		surface.toBlob = callback => callback(null);
		return surface;
	};
	await assert.rejects(render(), /encoder returned no image/);
	assert.equal(roots[0].destroyed, true);
	document.createElement = create;
	await render();
});

const background = () => ({
	rect: { x: 10, y: 20, width: 9, height: 6 }, elevation: 0,
	texture: { src: null, color: '#204060', tint: '#ffffff' },
	transform: { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0, fit: 'fill', scaleX: 1, scaleY: 1, rotation: 0 },
});
const backgroundRender = patch => renderBakeBackground({
	background: background(), buildDisplay: build, format: 'png', tileAxis: 4, isCurrent: () => current, ...patch,
});

test('color-only background paints below drawings using source-over tile composition and releases scratch canvases', async () => {
	const result = await backgroundRender();
	assert.equal(result.originalImage, null);
	assert.equal(result.estimate.compositingRgbaBytes, 128);
	assert.equal(composites.filter(item => item.type === 'fill').length, 6);
	assert.equal(composites.filter(item => item.type === 'draw').every(item => item.mode === 'source-over'), true);
	assert.equal(composites.filter(item => item.type === 'fill').every(item =>
		item.mode === 'destination-over' && item.color === '#204060'), true);
	assert.equal(surfaces.every(surface => surface.width === 1 && surface.height === 1), true);
	assert.deepEqual(writes.map(item => [item.x, item.y]), Array(6).fill([0, 0]));
});

test('background image samples the full original with tile offsets, applies RGB tint and retains caller ownership', async () => {
	globalThis.fetch = async () => new Response(encodedPng(9, 6));
	const image = await loadBakeImage('map.png', { isCurrent: () => current });
	try {
		const input = background(); input.texture.src = 'map.png'; input.texture.tint = '#80ff00';
		const result = await backgroundRender({ background: input, image });
		assert.equal(result.originalImage, image);
		const draws = composites.filter(item => item.type === 'draw' && item.args.length === 5);
		assert.deepEqual(draws.map(item => item.args.slice(1)),
			[[0, 0, 9, 6], [-4, 0, 9, 6], [-8, 0, 9, 6], [0, -4, 9, 6], [-4, -4, 9, 6], [-8, -4, 9, 6]]);
		assert.deepEqual([...writes[0].image.data.slice(0, 4)], [64, 128, 0, 128]);
		assert.equal(closes, 1);
	} finally { image.destroy(); }
	assert.equal(closes, 2);
});

test('background refuses shared transforms, wrong image binding and fractional reviewed output before rendering', async () => {
	const input = background(); input.transform.rotation = 1;
	await assert.rejects(backgroundRender({ background: input }), /identity/);
	input.transform.rotation = 0; input.texture.src = 'map.png';
	await assert.rejects(backgroundRender({ background: input }), /exact reviewed/);
	await assert.rejects(backgroundRender({ image: { path: 'map.png' } }), /color-only/);
	input.texture.src = null; input.rect.width = 9.5;
	await assert.rejects(backgroundRender({ background: input }), /integer/);
	assert.equal(targets.length, 0);
});

test('failed or stale underlay refuses output and releases graph, GPU target and all canvases', async () => {
	await assert.rejects(render({ paintUnderlay: () => { throw new Error('underlay failed'); } }), /underlay failed/);
	assert.equal(roots[0].destroyed, true);
	assert.equal(targets[0].destroyed, true);
	assert.equal(surfaces.every(surface => surface.width === 1), true);
	await assert.rejects(render({ paintUnderlay: async () => { current = false; } }), /context changed/);
	current = true;
	await render();
});

test('closed and forged images cannot paint a background', async () => {
	globalThis.fetch = async () => new Response(encodedPng(9, 6));
	const image = await loadBakeImage('map.png', { isCurrent: () => current });
	const input = background(); input.texture.src = 'map.png';
	await assert.rejects(backgroundRender({ background: input, image: { ...image } }), /owned open/);
	image.destroy();
	await assert.rejects(backgroundRender({ background: input, image }), /owned open/);
});
