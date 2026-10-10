import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { prepareArtworkSnapshot, fitArtworkBounds, buildArtworkDisplay, layerArtworkSnapshot,
	renderArtworkPreview, clearArtworkPreviewCache, PREVIEW_LIMITS, renderArtworkWebp, publicationDimensions,
	unpremultiplyPublicationPixels } from '../scripts/artwork_renderer.js';
const background = () => ({ rect: { x: 100, y: 200, width: 400, height: 300 }, elevation: 0,
	texture: { src: null, color: '#112233', tint: '#ffffff' },
	transform: { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0, fit: 'fill' } });

const drawing = (id = 'ink') => ({
	id, layerId: null, data: {
		name: 'Ink', shape: { type: 'r', width: 40, height: 20, points: [], radius: null },
		x: 10, y: 20, elevation: 0, levels: ['ground'], sort: 1, rotation: 30, bezierFactor: 0,
		fillType: 1, fillColor: '#123456', fillAlpha: 0.5, strokeWidth: 4, strokeColor: '#abcdef', strokeAlpha: 1,
		texture: null, text: '', fontFamily: 'Signika', fontSize: 48, textColor: '#ffffff', textAlpha: 1,
		hidden: true, locked: true, interface: false, flags: {},
	},
});
const node = (id, kind = 'layer', parentId = null) => ({ id, kind, parentId, name: id,
	locked: false, playerAllowed: false, defaults: {} });
let objects, renders, destroyedTargets, closedBitmaps, fetches, resourceCalls, failEncode;
class Container {
	constructor() {
		objects.push(this); this.children = [];
		for (const key of ['position', 'pivot', 'scale', 'anchor']) this[key] = { set: (...values) => { this[key].values = values; } };
	}
	addChild(child) { this.children.push(child); return child; }
	getLocalBounds() { return { x: 10, y: 20, width: 40, height: 20 }; }
	destroy({ children } = {}) { this.destroyed = true; if (children) this.children.forEach(child => child.destroy({ children: true })); }
}
class Graphics extends Container {
	constructor() { super(); this.calls = []; this.line = { reset() {} }; }
	lineStyle(value) { this.stroke = value; }
	beginTextureFill(value) { this.fill = value; }
	drawRect(...values) { this.calls.push(['rectangle', ...values]); return this; }
	drawEllipse(...values) { this.calls.push(['ellipse', ...values]); }
	drawSmoothedPolygon(...values) { this.calls.push(['polygon', ...values]); }
	drawSmoothedPath(...values) { this.calls.push(['path', ...values]); }
	endFill() {}
	beginFill(color) { this.color = color; return this; }
}
beforeEach(() => {
	objects = []; renders = 0; destroyedTargets = 0; closedBitmaps = 0; fetches = 0; resourceCalls = 0; failEncode = false;
	clearArtworkPreviewCache();
	if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
	globalThis.location = { href: 'https://table.example/game' };
	globalThis.game = { version: '14.365', user: { isGM: true }, i18n: { localize: key => key } };
	globalThis.getDocumentClass = () => ({ metadata: { schemaVersion: '14.355' } });
	globalThis.foundry = {
		canvas: { containers: { PreciseText: class extends Container { constructor(text, style) { super(); this.text = text; this.style = style; } } } },
		applications: { settings: { menus: { FontConfig: { getAvailableFonts: () => ['Signika'] } } } },
		utils: { fetchWithTimeout: async () => { resourceCalls++; return { ok: true, headers: new Headers({ 'content-type': 'image/png' }) }; } },
	};
	globalThis.document = { fonts: { check: () => true } };
	globalThis.CONFIG = { defaultFontFamily: 'Signika', Drawing: { objectClass: class {
		_getTextStyle() { return { family: this.document.fontFamily, width: this.document.shape.width }; }
	} } };
	globalThis.PIXI = { Container, Graphics, Matrix: class { scale(x, y) { this.x = x; this.y = y; return this; } },
		RenderTexture: { create: () => ({ destroy() { destroyedTargets++; } }) },
		BaseTexture: class { constructor(bitmap) { this.width = bitmap.width; this.height = bitmap.height; } },
		Texture: class {
			constructor(base) { this.baseTexture = base; this.valid = true; this.width = base.width; this.height = base.height; }
			destroy() { this.destroyed = true; }
		},
	};
	globalThis.canvas = { app: { renderer: {
		render() { renders++; },
		extract: { canvas: () => ({ toBlob(callback) { callback(failEncode ? null : new Blob(['WEBP'], { type: 'image/webp' })); } }) },
	} } };
	globalThis.createImageBitmap = async () => ({ width: 10, height: 20, close() { closedBitmaps++; } });
	globalThis.fetch = async () => {
		fetches++;
		const png = new Uint8Array(33); png[0] = 137; png.set([80, 78, 71], 1); png.set([73, 72, 68, 82], 12);
		const view = new DataView(png.buffer); view.setUint32(8, 13); view.setUint32(16, 10); view.setUint32(20, 20);
		return new Response(png, { headers: { 'content-type': 'image/png' } });
	};
});

test('validates snapshots, detaches references and preserves hidden artwork and deterministic sort', () => {
	const a = drawing('a'), b = drawing('b'); a.data.sort = 2; a.layerId = 'old';
	const result = prepareArtworkSnapshot([a, b]);
	assert.deepEqual(result.drawings.map(entry => entry.id), ['b', 'a']);
	assert.equal(result.drawings[1].layerId, null); assert.equal(result.drawings[1].data.hidden, true);
	result.drawings[1].data.x = 0; assert.equal(a.data.x, 10);
});

test('HTTP previews work and cache exact content without secure-context Web Crypto', async () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
	try {
		Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
		globalThis.location.href = 'http://table.example/game';
		const source = drawing();
		const first = await renderArtworkPreview([source]);
		assert.deepEqual(await renderArtworkPreview([source]), first);
		assert.equal(renders, 1);
		source.data.strokeAlpha = 0.25;
		assert.notEqual((await renderArtworkPreview([source])).fingerprint, first.fingerprint);
		assert.equal(renders, 2);
		Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
		clearArtworkPreviewCache();
		await renderArtworkPreview([source]);
		assert.equal(renders, 3);
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
		else delete globalThis.crypto;
	}
});

test('oversized exact preview cache keys render without exceeding cache admission limits', async () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
	try {
		Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
		CONFIG.canvasTextStyle = { toJSON: () => 'x'.repeat(PREVIEW_LIMITS.cacheBytes / 2) };
		await renderArtworkPreview([drawing()]);
		await renderArtworkPreview([drawing()]);
		assert.equal(renders, 2);
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
		else delete globalThis.crypto;
	}
});

test('fit measures the view box, keeps aspect ratio and gives padding to rotated/negative bounds', () => {
	const fit = fitArtworkBounds({ x: -100, y: 50, width: 200, height: 100 }, 96, 96);
	assert.equal(fit.scale, 0.44); assert.equal(fit.x, 48); assert.equal(fit.y, 4);
	assert.throws(() => fitArtworkBounds({ x: NaN, y: 0, width: 1, height: 1 }, 96, 96), /Bounds/);
});

test('Drawing snapshots reject unsupported, oversized or semantically ambiguous content', () => {
	const source = drawing();
	source.data.shape.type = 'c'; source.data.shape.radius = 10;
	assert.throws(() => prepareArtworkSnapshot([source]), /Geometry/);
	source.data.shape.type = 'p';
	assert.throws(() => prepareArtworkSnapshot([source]), /Geometry/);
	const second = drawing('second'); second.data.elevation = 1;
	assert.throws(() => prepareArtworkSnapshot([drawing(), second]), /MixedOrder/);
	source.data = drawing().data; source.data.strokeColor = 'red';
	assert.throws(() => prepareArtworkSnapshot([source]), /Style/);
	source.data = drawing().data; source.data.text = 'x'.repeat(8193);
	assert.throws(() => prepareArtworkSnapshot([source]), /TextLimit/);
	assert.throws(() => prepareArtworkSnapshot(Array.from({ length: 1001 }, (_, i) => drawing(`d${i}`))), /Limit/);
	source.data = drawing().data; source.data.shape.points = Array(100002).fill(0);
	assert.throws(() => prepareArtworkSnapshot([source]), /Limit/);
});

test('native geometry, alpha, centered rotation and text metrics are used without native hidden dimming', () => {
	const source = drawing(); source.data.text = 'Text';
	const root = buildArtworkDisplay(prepareArtworkSnapshot([source]));
	const graphic = root.children[0];
	assert.deepEqual(graphic.calls[0], ['rectangle', 2, 2, 36, 16]);
	assert.equal(graphic.fill.alpha, 0.5); assert.equal(graphic.stroke.alpha, 1);
	assert.equal(graphic.angle, 30); assert.deepEqual(graphic.position.values, [30, 30]); assert.deepEqual(graphic.pivot.values, [20, 10]);
	assert.equal(graphic.children[0].style.width, 40); assert.deepEqual(graphic.children[0].anchor.values, [0.5]);
	root.destroy({ children: true }); assert.equal(graphic.children[0].destroyed, true);
});

test('ellipse and open/closed polygons use native stroke insets and smoothing factors', () => {
	const source = drawing(); source.data.shape.type = 'e';
	assert.deepEqual(buildArtworkDisplay(prepareArtworkSnapshot([source])).children[0].calls[0], ['ellipse', 20, 10, 18, 8]);
	source.data.shape = { type: 'p', width: 40, height: 20, points: [0, 0, 40, 20] };
	source.data.fillType = 0; source.data.bezierFactor = 0.4;
	assert.equal(buildArtworkDisplay(prepareArtworkSnapshot([source])).children[0].calls[0][0], 'path');
	source.data.fillType = 1;
	assert.equal(buildArtworkDisplay(prepareArtworkSnapshot([source])).children[0].calls[0][2], 0.8);
	source.data.fillType = 0; source.data.shape.points.push(0, 0);
	assert.equal(buildArtworkDisplay(prepareArtworkSnapshot([source])).children[0].calls[0][0], 'polygon');
});

test('ordinary textures stay tiled while imageStamp textures fit independently on both axes', () => {
	const source = drawing(); source.data.fillType = 2; source.data.texture = 'image.png';
	const textures = new Map([['image.png', { valid: true, width: 10, height: 20 }]]);
	assert.equal(buildArtworkDisplay(prepareArtworkSnapshot([source]), textures).children[0].fill.matrix, undefined);
	source.data.flags.foundryshop = { imageStamp: 1 };
	const root = buildArtworkDisplay(prepareArtworkSnapshot([source]), textures);
	assert.equal(root.children[0].fill.color, 0xffffff); assert.equal(root.children[0].fill.matrix.x, 4);
	assert.equal(root.children[0].fill.matrix.y, 1);
	source.data.fillType = 1;
	assert.equal(buildArtworkDisplay(prepareArtworkSnapshot([source]), textures).children[0].fill.texture, textures.get('image.png'));
	source.data.fillType = 0;
	assert.equal(buildArtworkDisplay(prepareArtworkSnapshot([source]), textures).children[0].fill.alpha, 0);
	assert.throws(() => buildArtworkDisplay(prepareArtworkSnapshot([source])), /Renderer/);
	assert.equal(objects.at(-1).destroyed, true);
});

test('cache evicts least-recent previews, expires resources and does not let a caller mutate stored bounds', async () => {
	const first = await renderArtworkPreview([drawing()]);
	first.bounds.width = 999;
	assert.equal((await renderArtworkPreview([drawing()])).bounds.width, 40);
	for (let i = 0; i < PREVIEW_LIMITS.cacheEntries; i++) {
		const source = drawing(); source.data.x = i + 100;
		await renderArtworkPreview([source]);
	}
	const previous = renders;
	await renderArtworkPreview([drawing()]); assert.equal(renders, previous + 1);
	const nativeNow = Date.now;
	try {
		const now = nativeNow();
		Date.now = () => now + PREVIEW_LIMITS.cacheMs + 1;
		await renderArtworkPreview([drawing()]); assert.equal(renders, previous + 2);
	} finally { Date.now = nativeNow; }
});

test('complex smoothing and texture-count limits reject before construction or resource requests', () => {
	const source = drawing(); source.data.shape.type = 'p'; source.data.bezierFactor = 1;
	source.data.shape.points = Array.from({ length: 400 }, (_, i) => i % 4 < 2 ? 0 : 1000000);
	assert.throws(() => prepareArtworkSnapshot([source]), /Limit/);
	const textures = Array.from({ length: 17 }, (_, i) => {
		const entry = drawing(`drawing${i}`); entry.data.texture = `texture${i}.png`; return entry;
	});
	assert.throws(() => prepareArtworkSnapshot(textures), /Limit/);
	assert.equal(fetches, 0); assert.equal(objects.length, 0);
});

test('layer snapshots include descendants and hidden content only on the displayed Level, never staged artwork', () => {
	const sources = [drawing('one'), drawing('two'), drawing('other'), drawing('staged')];
	const ids = ['ink', 'child', 'elsewhere', 'ink'];
	const docs = sources.map((entry, index) => {
		entry.data.flags.foundryshop = { layerId: ids[index] };
		if (index === 3) entry.data.flags.foundryshop.importStaging = 'journal';
		return { id: entry.id, levels: new Set(index === 2 ? ['upstairs'] : ['ground']),
			getFlag: (namespace, key) => entry.data.flags[namespace]?.[key], toObject: () => ({ _id: entry.id, author: 'me', ...entry.data }) };
	});
	const scene = { levels: new Map([['ground', {}]]), drawings: new Map(docs.map(doc => [doc.id, doc])),
		getFlag: (namespace, key) => key === 'layers' ? ({ version: 1, revision: 0, nodes: [node('group', 'group'), node('ink', 'layer', 'group'), node('child', 'layer', 'group'), node('elsewhere')], presets: [] }) : undefined };
	assert.deepEqual(layerArtworkSnapshot(scene, 'group', 'ground').map(entry => entry.id), ['one', 'two']);
	assert.equal(layerArtworkSnapshot(scene, 'ink', 'ground').length, 1);
	game.user.isGM = false; assert.throws(() => layerArtworkSnapshot(scene, 'group', 'ground'), /NoAccess/);
});

test('renders bounded WEBP, caches identical content and re-renders changed alpha/options or refresh', async () => {
	const source = drawing();
	const first = await renderArtworkPreview([source]);
	assert.match(first.src, /^data:image\/webp;base64,/); assert.equal(first.width, 96); assert.equal(first.scope, 'full-artwork');
	assert.equal(first.empty, false); assert.equal(first.bytes, 4); assert.equal(destroyedTargets, 1);
	assert.equal(objects.every(obj => obj.destroyed), true);
	assert.deepEqual(await renderArtworkPreview([source]), first); assert.equal(renders, 1);
	source.data.fillAlpha = 0.25;
	assert.notEqual((await renderArtworkPreview([source])).fingerprint, first.fingerprint);
	await renderArtworkPreview([source], { width: 128 }); assert.equal(renders, 3);
	clearArtworkPreviewCache(); await renderArtworkPreview([source]); assert.equal(renders, 4);
});

test('rejects oversize output/invalid options and cancellation without rendering or poisoning later work', async () => {
	await assert.rejects(renderArtworkPreview([], { width: 513 }), /Options/);
	await assert.rejects(renderArtworkPreview([], { acknowledgeExternal: 'yes' }), /Options/);
	const abort = new AbortController(); abort.abort();
	await assert.rejects(renderArtworkPreview([], { signal: abort.signal }), { name: 'AbortError' });
	assert.equal(renders, 0);
	assert.equal((await renderArtworkPreview([])).empty, true);
	failEncode = true; clearArtworkPreviewCache();
	await assert.rejects(renderArtworkPreview([drawing()]), /Encoding/);
	assert.equal(objects.every(obj => obj.destroyed), true);
	failEncode = false; await renderArtworkPreview([drawing()]);
	assert.equal(destroyedTargets, 3);
});

test('external texture preflight blocks contact without acknowledgement; local decode owns and releases its resources', async () => {
	const source = drawing(); source.data.fillType = 2; source.data.texture = 'https://elsewhere.example/texture.png';
	await assert.rejects(renderArtworkPreview([source]), /ResourcesBlocked/); assert.equal(fetches, 0);
	source.data.texture = 'artwork/texture.png';
	await renderArtworkPreview([source]); assert.equal(fetches, 1); assert.equal(closedBitmaps, 1); assert.equal(resourceCalls, 1);
	assert.equal(renders, 1);
});

test('decoded texture/header mismatch is never rendered and missing fonts never silently fall back', async () => {
	const source = drawing(); source.data.fillType = 2; source.data.texture = 'texture.png';
	globalThis.createImageBitmap = async () => ({ width: 4097, height: 1, close() { closedBitmaps++; } });
	await assert.rejects(renderArtworkPreview([source]), /Texture/); assert.equal(closedBitmaps, 1); assert.equal(renders, 0);
	source.data.texture = null; source.data.text = 'Text'; document.fonts.check = () => false;
	await assert.rejects(renderArtworkPreview([source]), /Font/); assert.equal(renders, 0);
});

test('bounded queue rejects overload and cancelled waiting work does not render', async () => {
	const abort = new AbortController();
	const pending = Array.from({ length: PREVIEW_LIMITS.queue }, () => renderArtworkPreview([], { signal: abort.signal }));
	const overload = renderArtworkPreview([]);
	abort.abort();
	await assert.rejects(overload, /Queue/);
	for (const task of pending) await assert.rejects(task, { name: 'AbortError' });
	assert.equal(renders, 0);
	await renderArtworkPreview([]); assert.equal(renders, 1);
});

const publicationOptions = () => ({ audience: 'gm', crop: 'artwork', scale: 1, quality: 0.9, acknowledgeExternal: false });
function publicationEncoder({ mime = 'image/webp', mismatch = false, cancel } = {}) {
	let dimensions;
	PIXI.RenderTexture.create = options => { dimensions = options; return { baseTexture: { alphaMode: 1 }, destroy() { destroyedTargets++; } }; };
	PIXI.ALPHA_MODES = { NPM: 0 };
	globalThis.ImageData = class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };
	canvas.app.renderer.gl = { MAX_TEXTURE_SIZE: 3379, getParameter: () => 8192 };
	canvas.app.renderer.extract.pixels = target => {
		assert.equal(target.baseTexture.alphaMode, 0);
		return new Uint8Array(dimensions.width * dimensions.height * 4);
	};
	document.createElement = () => ({
		getContext: () => ({ putImageData() {} }),
		toBlob(callback, type, quality) {
			assert.equal(type, 'image/webp'); assert.equal(quality, 0.9);
			const bytes = new Uint8Array(30), view = new DataView(bytes.buffer);
			for (const [offset, text] of [[0, 'RIFF'], [8, 'WEBP'], [12, 'VP8 ']]) bytes.set([...text].map(c => c.charCodeAt(0)), offset);
			view.setUint32(4, 22, true); view.setUint32(16, 10, true); bytes.set([157, 1, 42], 23);
			view.setUint16(26, dimensions.width + Number(mismatch), true); view.setUint16(28, dimensions.height, true);
			cancel?.(); callback(new Blob([bytes], { type: mime }));
		},
	});
}
test('publication alpha conversion clamps saturated channels instead of PIXI Uint8 overflow', () => {
	assert.deepEqual([...unpremultiplyPublicationPixels(new Uint8Array([128, 0, 0, 127, 64, 32, 0, 128, 255, 255, 255, 0]))],
		[255, 0, 0, 127, 128, 64, 0, 128, 0, 0, 0, 0]);
});
test('publication dimensions preserve requested scale and enforce axis/pixel bounds, not preview limits', () => {
	assert.deepEqual(publicationDimensions({ x: -40, y: 5, width: 1024, height: 512 }, 2), { width: 2048, height: 1024 });
	assert.throws(() => publicationDimensions({ x: 0, y: 0, width: 4001, height: 4000 }, 1), /Limit/);
	assert.throws(() => publicationDimensions({ x: 0, y: 0, width: 8193, height: 1 }, 1), /Limit/);
	for (const scale of [0, NaN, 4.1]) assert.throws(() => publicationDimensions({ x: 0, y: 0, width: 10, height: 10 }, scale), /Options/);
});
test('publication renders an uncached full-size blob with measured/custom crop and native GM hidden geometry alpha', async () => {
	publicationEncoder();
	const result = await renderArtworkWebp([drawing()], publicationOptions());
	assert.equal(result.blob.type, 'image/webp'); assert.equal(result.width, 42); assert.equal(result.height, 22);
	assert.deepEqual(result.bounds, { x: 9, y: 19, width: 42, height: 22 });
	assert.equal(objects.find(object => object.stroke).stroke.alpha, 0.5);
	assert.equal(objects.find(object => object.fill).fill.alpha, 0.25);
	await renderArtworkWebp([drawing()], { ...publicationOptions(), crop: 'custom', bounds: { x: -100, y: 200, width: 1024, height: 512 }, scale: 2 });
	assert.equal(renders, 2); assert.equal(destroyedTargets, 2);
	assert.equal(objects.every(object => object.destroyed), true);
});
test('publication refuses unsupported encoder MIME, wrong encoded dimensions, GPU limits and cancellation and releases resources', async () => {
	publicationEncoder({ mime: 'image/png' });
	await assert.rejects(renderArtworkWebp([drawing()], publicationOptions()), /Encoding/);
	publicationEncoder({ mismatch: true });
	await assert.rejects(renderArtworkWebp([drawing()], publicationOptions()), /Encoding/);
	publicationEncoder(); canvas.app.renderer.gl.getParameter = () => 16;
	await assert.rejects(renderArtworkWebp([drawing()], publicationOptions()), /Limit/);
	const controller = new AbortController();
	publicationEncoder({ cancel: () => controller.abort() });
	await assert.rejects(renderArtworkWebp([drawing()], { ...publicationOptions(), signal: controller.signal }), { name: 'AbortError' });
	assert.equal(objects.every(object => object.destroyed), true);
	publicationEncoder(); await renderArtworkWebp([drawing()], publicationOptions());
	assert.equal(destroyedTargets, 4);
});
test('publication requires explicit valid options and resources before rendering and refuses empty artwork', async () => {
	for (const patch of [{ audience: '' }, { quality: 0 }, { crop: 'other' }, { acknowledgeExternal: 'yes' }]) {
		await assert.rejects(renderArtworkWebp([drawing()], { ...publicationOptions(), ...patch }), /Options/);
	}
	await assert.rejects(renderArtworkWebp([], publicationOptions()), /Empty/);
	publicationEncoder(); const source = drawing(); source.data.texture = 'https://elsewhere.example/a.png';
	await assert.rejects(renderArtworkWebp([source], publicationOptions()), /ResourcesBlocked/);
	assert.equal(fetches, 0); assert.equal(renders, 0);
});
test('publication rechecks authority while queued and refuses native-hidden entries in player render inputs', async () => {
	publicationEncoder();
	await assert.rejects(renderArtworkWebp([drawing()], { ...publicationOptions(), audience: 'player' }), /Options/);
	const task = renderArtworkWebp([drawing()], publicationOptions());
	game.user.isGM = false;
	await assert.rejects(task, /NoAccess/);
	assert.equal(renders, 0);
	game.user.isGM = true; await renderArtworkWebp([drawing()], publicationOptions());
});
test('publication verifies encoded axes beyond stamp/preview limits without changing imported-image limits', async () => {
	publicationEncoder();
	const result = await renderArtworkWebp([drawing()], { ...publicationOptions(),
		crop: 'custom', bounds: { x: 0, y: 0, width: 8192, height: 1 } });
	assert.equal(result.width, 8192); assert.equal(result.height, 1);
});
test('publication owns texture resources and preserves native-hidden text opacity at export resolution', async () => {
	publicationEncoder();
	const source = drawing(); source.data.fillType = 2; source.data.texture = 'artwork/texture.png';
	source.data.text = 'Label';
	foundry.canvas.containers.PreciseText = class extends Container {
		constructor(text, style) { super(); this.text = text; this.style = style; this.width = 40; this.height = 20; }
	};
	await renderArtworkWebp([source], { ...publicationOptions(), scale: 2 });
	const text = objects.find(object => object.text === 'Label');
	assert.equal(text.alpha, source.data.textAlpha); assert.equal(text.resolution, 2);
	assert.equal(closedBitmaps, 1); assert.equal(fetches, 1);
	assert.equal(objects.every(object => object.destroyed), true);
});
test('background-only scene crop uses exact map bounds, retains color and leaves transparency available', async () => {
	publicationEncoder();
	const result = await renderArtworkWebp([], { ...publicationOptions(), background: background(), crop: 'scene' });
	assert.deepEqual(result.bounds, background().rect);
	assert.equal(result.width, 400); assert.equal(result.height, 300); assert.equal(result.drawings, 0);
	assert.equal(objects.find(object => object.color).color, '#112233');
	assert.equal(objects.every(object => object.destroyed), true);
	await assert.rejects(renderArtworkWebp([], { ...publicationOptions(), crop: 'scene' }), /Options/);
});
test('background resources require consent and own decoded textures; artwork stays above composed background', async () => {
	publicationEncoder();
	PIXI.Sprite = class extends Container { constructor(texture) { super(); this.texture = texture; } };
	const input = background(); input.texture.src = 'https://external.example/bg.webp';
	await assert.rejects(renderArtworkWebp([drawing()], { ...publicationOptions(), background: input }), /ResourcesBlocked/);
	assert.equal(fetches, 0);
	input.texture.src = 'maps/bg.png';
	await renderArtworkWebp([drawing()], { ...publicationOptions(), background: input, crop: 'scene' });
	assert.equal(fetches, 1); assert.equal(closedBitmaps, 1);
	const sprite = objects.find(object => object.texture);
	assert.deepEqual(sprite.position.values, [300, 350]); assert.deepEqual(sprite.scale.values, [40, 15]);
	assert.equal(objects.every(object => object.destroyed), true);
});
test('below-background primary artwork and malformed background refuse composition before resource requests', async () => {
	publicationEncoder();
	const input = background(); input.elevation = 1;
	await assert.rejects(renderArtworkWebp([drawing()], { ...publicationOptions(), background: input }), /BackgroundOrder/);
	input.transform.scaleX = 0;
	await assert.rejects(renderArtworkWebp([drawing()], { ...publicationOptions(), background: input }), /BackgroundInvalid/);
	assert.equal(fetches, 0); assert.equal(renders, 0);
});
test('shared background/artwork texture is loaded once and background-only images may exceed stamp axes', async () => {
	publicationEncoder();
	PIXI.Sprite = class extends Container { constructor(texture) { super(); this.texture = texture; } };
	const input = background(), entry = drawing(); input.texture.src = entry.data.texture = 'maps/shared.png';
	await renderArtworkWebp([entry], { ...publicationOptions(), background: input, crop: 'scene' });
	assert.equal(fetches, 1); assert.equal(closedBitmaps, 1);
	const original = fetch;
	globalThis.fetch = async (...args) => {
		const bytes = new Uint8Array(await (await original(...args)).arrayBuffer()), view = new DataView(bytes.buffer);
		view.setUint32(16, 5000); view.setUint32(20, 2); return new Response(bytes);
	};
	globalThis.createImageBitmap = async () => ({ width: 5000, height: 2, close() { closedBitmaps++; } });
	await renderArtworkWebp([], { ...publicationOptions(), background: input, crop: 'scene' });
	assert.equal(fetches, 2); assert.equal(closedBitmaps, 2);
	await assert.rejects(renderArtworkWebp([entry], publicationOptions()), /Stamps.Image/);
});
test('background and artwork obey combined decoded budget and GPU input axes, releasing prior resources on refusal', async () => {
	publicationEncoder();
	const original = fetch, entry = drawing(), input = background(); entry.data.texture = 'maps/ink.png';
	input.texture.src = 'maps/large.png';
	// 63,995,904 background pixels alone fit, but not alongside a 10x500 artwork texture.
	globalThis.fetch = async (...args) => {
		const bytes = new Uint8Array(await (await original(...args)).arrayBuffer()), view = new DataView(bytes.buffer);
		view.setUint32(16, String(args[0]).includes('large.png') ? 8192 : 10);
		view.setUint32(20, String(args[0]).includes('large.png') ? 7812 : 500);
		return new Response(bytes);
	};
	globalThis.createImageBitmap = async () => ({ width: 10, height: 500, close() { closedBitmaps++; } });
	await assert.rejects(renderArtworkWebp([entry], { ...publicationOptions(), background: input }), /Preview.Texture/);
	assert.equal(closedBitmaps, 1); assert.equal(renders, 0); assert.equal(objects.every(object => object.destroyed), true);
	canvas.app.renderer.gl.getParameter = () => 4096;
	await assert.rejects(renderArtworkWebp([], { ...publicationOptions(), background: input }), /Stamps.Image/);
});
