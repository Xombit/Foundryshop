import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { inspectBakeDrawing, prepareBakeDrawingDisplay, withBakeDrawingResources } from '../scripts/bake_drawings.js';
import { prepareOptimizationScope } from '../scripts/layers/optimization_scope.js';
import { renderReviewedBake } from '../scripts/bake_render_review.js';
import { fileFingerprint } from '../scripts/verified_file_storage.js';
import { canonicalJson } from '../scripts/layers/project_package.js';
import { prepareReviewedTileBake } from '../scripts/layers/bake_workflow.js';
import { reviewOptimizationExecution } from '../scripts/layers/optimization_execution_review.js';
import { resumeOptimizationOperation } from '../scripts/layers/optimization_executor.js';
import { beginOptimizationOperation, readOptimizationJournal } from '../scripts/layers/optimization_journal.js';
import { optimizationOutputVerifier } from '../scripts/optimization_media.js';
import { assertOptimizationNativeSchemas } from '../scripts/layers/optimization_native.js';
import { readStoredOptimizationArchive } from '../scripts/layers/optimization_recovery.js';
import { BAKE_RECOVERY_FOLDER } from '../scripts/layers/bake_storage.js';
import { promptReviewedTileBake, promptResumeTileBake, promptRestoreTileBake, promptTakeOverTileBake } from '../scripts/layers/bake_entry.js';
import { BakeReviewCancelledError } from '../scripts/layers/bake_dialogs.js';
import { monitorOptimizationConflicts } from '../scripts/layers/optimization_conflict_monitor.js';

let current, renderer, objects, metrics, fontReady, textAxis, images, textures, requests;
const drawing = (id = 'ink', patch = {}) => ({
	_id: id, author: 'gm', name: 'Ink',
	shape: { type: 'r', width: 40, height: 20, points: [], radius: null },
	x: 10, y: 20, elevation: 0, levels: ['ground'], sort: 1, rotation: 30, bezierFactor: 0,
	fillType: 1, fillColor: '#123456', fillAlpha: 0.5, strokeWidth: 4, strokeColor: '#abcdef', strokeAlpha: 1,
	texture: null, text: '', fontFamily: 'Signika', fontSize: 48, textColor: '#ffffff', textAlpha: 1,
	hidden: false, locked: false, interface: false, flags: {}, ...patch,
});
class Container {
	constructor() {
		objects.push(this); this.children = []; this.parent = null; this.rotation = 0; this.alpha = 1;
		for (const key of ['position', 'pivot', 'scale', 'anchor']) this[key] = {
			x: key === 'scale' ? 1 : 0, y: key === 'scale' ? 1 : 0,
			set(x, y = x) { this.x = x; this.y = y; },
		};
	}
	addChild(child) { this.children.push(child); child.parent = this; return child; }
	destroy({ children } = {}) {
		this.destroyed = true;
		if (children) this.children.forEach(child => child.destroy({ children: true }));
	}
}
class Graphics extends Container {
	constructor() { super(); this.calls = []; this.line = { reset() {} }; }
	lineStyle(style) { this.stroke = style; }
	beginTextureFill(style) { this.fill = style; }
	drawRect(...args) { this.calls.push(['rect', ...args]); }
	drawEllipse(...args) { this.calls.push(['ellipse', ...args]); }
	drawSmoothedPolygon(...args) { this.calls.push(['polygon', ...args]); }
	drawSmoothedPath(...args) { this.calls.push(['path', ...args]); }
	endFill() {}
}
beforeEach(() => {
	current = true; objects = []; images = []; textures = []; requests = [];
	metrics = { width: 300, height: 60 }; fontReady = true; textAxis = 300;
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.game = { user: { isGM: true }, i18n: { localize: key => key }, settings: { get: () => ({ version: 1, scenes: {} }) } };
	globalThis.CONFIG = { defaultFontFamily: 'Signika', Drawing: { objectClass: class {
		_getTextStyle() { return { fontFamily: this.document.fontFamily, wordWrapWidth: this.document.shape.width, padding: 2 }; }
	} } };
	globalThis.document = { fonts: { check: () => fontReady } };
	globalThis.foundry = {
		applications: { settings: { menus: { FontConfig: { getAvailableFonts: () => ['Signika'] } } } },
		canvas: { containers: { PreciseText: class extends Container {
			constructor(text, style) { super(); this.text = text; this.style = style; this.resolution = 2; }
			updateText() { this.texture = { baseTexture: { realWidth: textAxis, realHeight: 60 } }; }
		} } },
	};
	globalThis.PIXI = { Container, Graphics, TextMetrics: { measureText: () => metrics },
		Matrix: class { scale(x, y) { this.x = x; this.y = y; return this; } },
		BaseTexture: class { constructor(bitmap) { this.bitmap = bitmap; } destroy() { this.destroyed = true; } },
		Texture: class {
			constructor(base) { this.base = base; this.width = base.bitmap.width; this.height = base.bitmap.height; this.valid = true; textures.push(this); }
			destroy(all) { this.destroyed = true; this.valid = false; if (all) this.base.destroy(); }
		},
	};
	globalThis.fetch = async url => { requests.push(url); return new Response(png(16, 8)); };
	globalThis.createImageBitmap = async blob => {
		const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
		const image = { width: view.getUint32(16), height: view.getUint32(20), close() { this.closed = true; } };
		images.push(image); return image;
	};
	renderer = { gl: { MAX_TEXTURE_SIZE: 1, MAX_RENDERBUFFER_SIZE: 2, MAX_VIEWPORT_DIMS: 3,
		isContextLost: () => false, getParameter: key => key === 3 ? [16384, 16384] : 16384 },
		render() {}, extract: { pixels() {} } };
	globalThis.canvas = { app: { renderer } };
});
const options = () => ({ isCurrent: () => current });
const prepare = sources => prepareBakeDrawingDisplay(sources, options());

function png(width, height) {
	const bytes = new Uint8Array(58), view = new DataView(bytes.buffer);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
	view.setUint32(8, 13); bytes.set([... 'IHDR'].map(c => c.charCodeAt()), 12);
	view.setUint32(16, width); view.setUint32(20, height);
	view.setUint32(33, 1); bytes.set([... 'IDAT'].map(c => c.charCodeAt()), 37);
	bytes.set([... 'IEND'].map(c => c.charCodeAt()), 50);
	return bytes;
}

test('uncapped preparation captures exact sorted sources and uses native inset/center rotation/alpha geometry', () => {
	const a = drawing('a', { sort: 2 }), b = drawing('b'), prepared = prepare([a, b]);
	a.x = 999; b.fillAlpha = 0;
	const root = prepared.buildDisplay();
	assert.equal(root.parent, null); assert.equal(root.alpha, 1);
	assert.deepEqual([root.scale.x, root.scale.y], [1, 1]);
	assert.equal(prepared.review.sourceCount, 2);
	assert.deepEqual(root.children[0].calls[0], ['rect', 2, 2, 36, 16]);
	assert.equal(root.children[0].fill.alpha, 0.5);
	assert.deepEqual([root.children[1].position.x, root.children[1].position.y], [30, 30]);
	assert.equal(root.children[1].angle, 30);
	root.destroy({ children: true });
	assert.equal(root.children.every(graphic => graphic.destroyed), true);
});

test('more than preview Drawing/point/text limits and large finite coordinates do not invent a bake budget', () => {
	const sources = Array.from({ length: 1001 }, (_, i) => drawing(`d${i}`, { x: 20000000 }));
	assert.equal(prepare(sources).review.sourceCount, 1001);
	const polygon = drawing('p', { shape: { type: 'p', width: 20000000, height: 20, points: Array(100002).fill(0) } });
	assert.equal(prepare([polygon]).review.pointCount, 100002);
	const label = drawing('label', { text: 'x'.repeat(8193), fontSize: 300 });
	const root = prepare([label]).buildDisplay(), text = root.children[0].children[0];
	assert.equal(text.resolution, 2);
	assert.equal(text.text.length, 8193);
	root.destroy({ children: true });
});

test('ellipse, open paths and filled smoothed polygons reuse existing native geometry behavior', () => {
	const ellipse = drawing('e', { shape: { type: 'e', width: 40, height: 20, points: [] } });
	const path = drawing('p', { fillType: 0, bezierFactor: 0.4, shape: { type: 'p', width: 40, height: 20, points: [0, 0, 40, 20] } });
	const root = prepare([ellipse, path]).buildDisplay();
	assert.deepEqual(root.children[0].calls[0], ['ellipse', 20, 10, 18, 8]);
	assert.deepEqual(root.children[1].calls[0], ['path', [0, 0, 40, 20], 0.8]);
	root.destroy({ children: true });
	path.fillType = 1;
	const closed = prepare([path]).buildDisplay();
	assert.equal(closed.children[0].calls[0][0], 'polygon');
	closed.destroy({ children: true });
});

test('texture fills, stamps, foreign metadata and unrecognized native fields are actionable exclusions', () => {
	for (const [patch, reason] of [
		[{ fillType: 2, texture: 'map.png' }, 'texture-fill'],
		[{ fillType: 2, texture: 'map.png', flags: { foundryshop: { imageStamp: 1 } } }, 'texture-fill'],
		[{ fillType: 2, texture: 'map.png', flags: { foundryshop: { materialRepeat: 100 } } }, 'texture-fill'],
		[{ flags: { foreign: { renderer: 'custom' } } }, 'module-rendering'],
		[{ flags: { foundryshop: { importStaging: 'pending' } } }, 'module-rendering'],
		[{ extra: true }, 'native-fields'],
	]) {
		const source = drawing('ink', patch), capability = inspectBakeDrawing(source);
		assert.equal(capability.supported, false);
		assert.match(capability.reason, new RegExp(reason));
		assert.throws(() => prepare([source]), new RegExp(reason));
	}
	assert.equal(inspectBakeDrawing(drawing('ink', { texture: 'unused.png' })).supported, true);
});

test('malformed geometry, nonfinite styles, hidden/interface/multiple-Level sources refuse rather than normalize', () => {
	for (const patch of [
		{ shape: { type: 'c', radius: 20, points: [], width: 40, height: 40 } },
		{ shape: { type: 'p', width: 40, height: 20, points: [0, 0, 1] } },
		{ shape: { type: 'r', width: NaN, height: 20, points: [] } },
		{ strokeWidth: -1 }, { fillAlpha: 2 }, { strokeColor: 'red' }, { rotation: Infinity },
		{ hidden: true }, { interface: true }, { levels: ['ground', 'upper'] }, { text: null },
	]) assert.equal(inspectBakeDrawing(drawing('ink', patch)).supported, false);
	assert.equal(objects.length, 0);
});

test('finite JavaScript coordinates that overflow actual GPU float representation refuse explicitly', () => {
	assert.match(inspectBakeDrawing(drawing('overflow', { x: 1e100 })).reason, /gpu-float-representation/);
	assert.match(inspectBakeDrawing(drawing('overflow', {
		shape: { type: 'p', width: 40, height: 20, points: [0, 0, 1e100, 0] },
	})).reason, /gpu-float-representation/);
	assert.equal(inspectBakeDrawing(drawing('large', { x: 20000000 })).supported, true);
});

test('optional native empty text is rendered without altering the raw source', () => {
	const source = drawing(); source.text = undefined; source.name = undefined;
	const root = prepare([source]).buildDisplay();
	assert.equal(root.children[0].children.length, 0);
	assert.equal(source.text, undefined);
	root.destroy({ children: true });
});

test('font availability and measured/actual text bitmap axes use GPU capabilities rather than preview text limits', () => {
	const label = drawing('label', { text: 'Hello' });
	fontReady = false;
	assert.match(inspectBakeDrawing(label).reason, /font-unavailable/);
	fontReady = true; metrics.width = 16384;
	assert.match(inspectBakeDrawing(label).reason, /exceeds-gpu/);
	metrics.width = 10000;
	const prepared = prepare([label]);
	textAxis = 20000;
	assert.throws(() => prepared.buildDisplay(), /actual GPU/);
	assert.equal(objects.every(object => object.destroyed), true);
	textAxis = 10000;
	const root = prepared.buildDisplay();
	assert.equal(root.children[0].children[0].texture.baseTexture.realWidth, 10000);
	root.destroy({ children: true });
});

test('invalid measured text results refuse; native API errors are surfaced rather than silently excluded', () => {
	const label = drawing('label', { text: 'Hello' });
	metrics.height = NaN;
	assert.match(inspectBakeDrawing(label).reason, /metrics-unverified/);
	PIXI.TextMetrics.measureText = () => { throw new Error('native measurement failed'); };
	assert.throws(() => inspectBakeDrawing(label), /native measurement failed/);
});

test('duplicate identities and mixed ordering scopes refuse; captured membership/provenance remain unchanged', () => {
	assert.throws(() => prepare([drawing(), drawing()]), /duplicate/);
	assert.throws(() => prepare([drawing(), drawing('other', { elevation: 1 })]), /one Level/);
	const source = drawing('ink', { flags: { foundryshop: { layerId: 'ink', provenance: { library: 'source' } } } });
	assert.equal(inspectBakeDrawing(source).supported, true);
	const root = prepare([source]).buildDisplay();
	assert.deepEqual(source.flags, { foundryshop: { layerId: 'ink', provenance: { library: 'source' } } });
	root.destroy({ children: true });
});

test('cancelled, stale, lost renderer and unavailable fonts fail before borrowed/live resources are touched', () => {
	const prepared = prepare([drawing('label', { text: 'Hello' })]);
	current = false; assert.throws(() => prepared.buildDisplay(), /context changed/);
	current = true; fontReady = false; assert.throws(() => prepared.buildDisplay(), /resources changed/);
	fontReady = true; canvas.app.renderer = {};
	assert.throws(() => prepared.buildDisplay(), /context changed/);
	canvas.app.renderer = renderer; renderer.gl.isContextLost = () => true;
	assert.throws(() => prepared.buildDisplay(), /lost/);
	assert.equal(objects.length, 0);
	const controller = new AbortController(); controller.abort();
	renderer.gl.isContextLost = () => false;
	assert.throws(() => prepareBakeDrawingDisplay([drawing()], { ...options(), signal: controller.signal }), /cancelled/);
});

test('real inspector drives All-scope exclusions and approved manifest renders only captured eligible sources', () => {
	const sources = [drawing('plain'), drawing('textured', { fillType: 2, texture: 'map.png' })];
	const scene = { id: 'scene', width: 8000, height: 6000, padding: 0,
		grid: { toObject: () => ({ size: 100 }) }, tiles: new Map(),
		levels: new Map([['ground', { toObject: () => ({ _id: 'ground' }) }]]),
		drawings: new Map(sources.map(source => [source._id, { id: source._id, toObject: () => structuredClone(source) }])),
		getFlag: () => undefined };
	const scope = prepareOptimizationScope(scene, 'ground', { kind: 'all', audience: 'player', destination: 'tile',
		isCurrent: () => current, inspectSource: inspectBakeDrawing });
	assert.deepEqual(scope.review.excluded, [{ id: 'textured', layerId: null, reasons: ['bake-texture-fill-preparation-required'] }]);
	const manifest = scope.approve({ excludedIds: ['textured'], flattenToGround: true });
	const root = prepareBakeDrawingDisplay(manifest.sources, { isCurrent: manifest.assertCurrent }).buildDisplay();
	assert.equal(root.children.length, 1);
	assert.equal(scene.drawings.size, 2);
	root.destroy({ children: true });
});

test('shared texture loads once and native ordinary/stamp/material matrices remain exact through awaited rendering', async () => {
	const sources = [
		drawing('ordinary', { fillType: 2, texture: 'map.png', sort: 1 }),
		drawing('stamp', { fillType: 2, texture: 'map.png', sort: 2, flags: { foundryshop: { imageStamp: 1 } } }),
		drawing('material', { fillType: 2, texture: 'map.png', sort: 3, flags: { foundryshop: { materialRepeat: 64 } } }),
	];
	let root, retained;
	const result = await withBakeDrawingResources(sources, async prepared => {
		retained = prepared;
		assert.equal(prepared.review.textureCount, 1);
		root = prepared.buildDisplay();
		assert.equal(root.children[0].fill.texture, textures[0]);
		assert.equal(root.children[0].fill.matrix, undefined);
		assert.equal(root.children[1].fill.color, 0xffffff);
		assert.deepEqual([root.children[1].fill.matrix.x, root.children[1].fill.matrix.y], [2.5, 2.5]);
		assert.deepEqual([root.children[2].fill.matrix.x, root.children[2].fill.matrix.y], [4, 4]);
		await Promise.resolve();
		assert.equal(textures[0].destroyed, undefined);
		return 'rendered';
	}, options());
	assert.equal(result, 'rendered'); assert.equal(requests.length, 1);
	assert.equal(root.destroyed, true); assert.equal(textures[0].destroyed, true); assert.equal(images[0].closed, true);
	assert.throws(() => retained.buildDisplay(), /closed/);
});

test('texture resource failure cleans earlier assets and oversized inputs refuse without downsampling', async () => {
	const sources = [drawing('one', { fillType: 2, texture: 'one.png' }), drawing('two', { fillType: 2, texture: 'two.png' })];
	globalThis.fetch = async url => { requests.push(url); return new Response(png(requests.length === 1 ? 16 : 20000, 8)); };
	await assert.rejects(withBakeDrawingResources(sources, () => assert.fail('must not render'), options()), /actual GPU texture axes/);
	assert.equal(images.every(image => image.closed), true);
	assert.equal(textures.length, 1); assert.equal(textures[0].destroyed, true);
});

test('consent and complete source validation precede all texture network requests', async () => {
	const sources = [drawing('local', { fillType: 2, texture: 'local.png' }),
		drawing('remote', { fillType: 2, texture: 'https://example.org/map.png' })];
	await assert.rejects(withBakeDrawingResources(sources, () => {}, options()), /before any contact/);
	assert.equal(requests.length, 0);
	sources[1].flags = { foundryshop: { materialRepeat: -1 } };
	await assert.rejects(withBakeDrawingResources(sources, () => {}, { ...options(), acknowledgeExternal: true }), /invalid-texture-metadata/);
	assert.equal(requests.length, 0);
	sources[1].flags = {};
	await withBakeDrawingResources(sources, () => {}, { ...options(), acknowledgeExternal: true });
	assert.equal(requests.length, 2);
});

test('render exceptions and post-render cancellation clean graphs before shared textures and release bitmaps', async () => {
	const source = drawing('stamp', { fillType: 2, texture: 'map.png', flags: { foundryshop: { imageStamp: 1 } } });
	let root;
	await assert.rejects(withBakeDrawingResources([source], prepared => {
		root = prepared.buildDisplay(); throw new Error('render failed');
	}, options()), /render failed/);
	assert.equal(root.destroyed, true); assert.equal(textures[0].destroyed, true); assert.equal(images[0].closed, true);
	await assert.rejects(withBakeDrawingResources([source], prepared => {
		prepared.buildDisplay(); current = false;
	}, options()), /cancelled after rendering/);
	assert.equal(images.every(image => image.closed), true);
});

test('capability opt-in reports texture preparation support but never establishes decode or GPU acceptance', () => {
	const source = drawing('stamp', { fillType: 2, texture: 'map.png', flags: { foundryshop: { imageStamp: 1 } } });
	assert.equal(inspectBakeDrawing(source).supported, false);
	assert.equal(inspectBakeDrawing(source, { allowTextureFills: true }).supported, true);
	source.texture = 'data:image/png;base64,x';
	assert.match(inspectBakeDrawing(source, { allowTextureFills: true }).reason, /invalid-texture-path/);
});

function rasterFixture() {
	Graphics.prototype.getBounds = function () { return { x: this.position.x - this.pivot.x,
		y: this.position.y - this.pivot.y, width: 40, height: 20 }; };
	PIXI.ALPHA_MODES = { NPM: 0 };
	PIXI.RenderTexture = { create: size => ({ ...size, baseTexture: { alphaMode: 1 }, destroy() { this.destroyed = true; } }) };
	renderer.extract.pixels = target => new Uint8Array(target.width * target.height * 4);
	globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
	document.createElement = () => {
		const surface = { width: 0, height: 0,
			getContext: () => ({ putImageData() {}, save() {}, restore() {}, drawImage() {}, fillRect() {} }),
			toBlob: callback => callback(new Blob([png(surface.width, surface.height)], { type: 'image/png' })) };
		return surface;
	};
}
const approve = review => ({ proceed: true, width: review.width, height: review.height,
	format: review.format, quality: review.quality, croppedSourceIds: review.croppedSourceIds });

test('reviewed bake wires captured geometry through exact approval into encoded output', async () => {
	rasterFixture();
	let review;
	const result = await renderReviewedBake([drawing()], { ...options(), format: 'png',
		approveReview: candidate => { review = candidate; return approve(candidate); } });
	assert.deepEqual(result.bounds, { x: 10, y: 20, width: 40, height: 20 });
	assert.equal(result.width, 40); assert.equal(result.height, 20);
	assert.deepEqual(review.sourceIds, ['ink']);
	assert.equal(result.review.destination, 'tile');
	assert.equal(result.sourceDigest, await fileFingerprint(new TextEncoder().encode(canonicalJson([drawing()]))));
	assert.equal(objects.every(object => object.destroyed), true);
});

test('rendered source digest uses archive code-unit identity ordering, not locale collation', async () => {
	rasterFixture();
	const sources = [drawing('lowercase'), drawing('Uppercase')];
	const result = await renderReviewedBake(sources, { ...options(), format: 'png', approveReview: approve });
	assert.equal(result.sourceDigest, await fileFingerprint(new TextEncoder().encode(canonicalJson(
		[sources[1], sources[0]]))));
});

test('crop acknowledgement cannot be omitted, duplicated or forged by mutating the public review', async () => {
	rasterFixture();
	for (const acknowledge of [() => [], () => ['ink', 'ink'], () => ['different']]) {
		await assert.rejects(renderReviewedBake([drawing()], { ...options(), format: 'png',
			bounds: { x: 0, y: 0, width: 10, height: 10 }, approveReview: review => {
				review.croppedSourceIds = []; return { ...approve(review), croppedSourceIds: acknowledge() };
			} }), /exact output/);
	}
	const result = await renderReviewedBake([drawing()], { ...options(), format: 'png',
		bounds: { x: 0, y: 0, width: 10, height: 10 }, approveReview: approve });
	assert.deepEqual(result.review.fullyOutsideSourceIds, ['ink']);
});

test('review cancellation, stale context and changed bounds release graphs and refuse encoding', async () => {
	rasterFixture();
	await assert.rejects(renderReviewedBake([drawing()], { ...options(), approveReview: () => ({ proceed: false }) }), /Approve exact/);
	await assert.rejects(renderReviewedBake([drawing()], { ...options(), approveReview: review => {
		current = false; return approve(review);
	} }), /context changed/);
	current = true;
	await assert.rejects(renderReviewedBake([drawing()], { ...options(), approveReview: review => {
		Graphics.prototype.getBounds = () => ({ x: 100, y: 100, width: 40, height: 20 });
		return approve(review);
	} }), /bounds changed/);
	assert.equal(objects.every(object => object.destroyed), true);
});

test('background review uses full rectangle and retains original color-only semantics', async () => {
	rasterFixture();
	const background = { rect: { x: 0, y: 0, width: 100, height: 100 }, elevation: 0,
		texture: { src: null, color: '#204060', tint: '#ffffff' },
		transform: { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0, fit: 'fill', scaleX: 1, scaleY: 1, rotation: 0 } };
	const result = await renderReviewedBake([drawing()], { ...options(), background, format: 'png', approveReview: approve });
	assert.equal(result.review.destination, 'background');
	assert.equal(result.width, 100);
	await assert.rejects(renderReviewedBake([drawing()], { ...options(), background, approveReview: approve,
		bounds: { x: 0, y: 0, width: 50, height: 50 } }), /exact full Scene/);
});

function workflowFixture() {
	rasterFixture();
	const events = [], files = new Map(), source = drawing('ink', { rotation: 0 });
	const listeners = new Map(); let nextHook = 0;
	globalThis.Hooks = {
		on(event, callback) { const id = ++nextHook; listeners.set(id, { event, callback }); return id; },
		off(event, id) { if (listeners.get(id)?.event === event) listeners.delete(id); },
		callAll(event, ...args) {
			for (const listener of listeners.values()) if (listener.event === event) listener.callback(...args);
		},
	};
	const doc = data => ({ id: data._id, toObject: () => structuredClone(data) });
	const level = { _id: 'ground', elevation: { bottom: 0, top: 10 }, flags: {},
		background: { src: null, color: '#ffffff', tint: '#ffffff', alphaThreshold: 0.75 },
		textures: { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0, fit: 'fill', scaleX: 1, scaleY: 1, rotation: 0 } };
	const scene = { id: 'scene', width: 100, height: 100, padding: 0, flags: {},
		drawings: new Map([['ink', doc(source)]]), tiles: new Map(), levels: new Map([['ground', doc(level)]]),
		grid: { toObject: () => ({ size: 100 }) }, getFlag(ns, key) { return this.flags[key]; },
		getDimensions: () => ({ sceneRect: { x: 0, y: 0, width: 100, height: 100 } }),
		canUserModify: () => true,
		async update(patch) { this.flags.optimizationJournal = structuredClone(patch['flags.foundryshop.optimizationJournal']);
			Hooks.callAll('updateScene', this, patch, {}, game.user.id);
			events.push(`journal:${this.flags.optimizationJournal.entries.at(-1).phase}`); },
	};
	const collections = { Drawing: scene.drawings, Tile: scene.tiles };
	scene.createEmbeddedDocuments = async (type, data) => {
		events.push(`create:${type}`); for (const input of data) collections[type].set(input._id, doc(input));
	};
	scene.deleteEmbeddedDocuments = async (type, ids) => {
		events.push(`delete:${type}`); for (const id of ids) collections[type].delete(id);
	};
	scene.updateEmbeddedDocuments = async (type, patches) => {
		events.push(`update:${type}`);
		for (const patch of patches) collections[type].set(patch._id, doc({ ...collections[type].get(patch._id).toObject(), ...patch }));
	};
	game.user.id = 'gm'; game.user.can = () => true;
	game.users = { activeGM: { id: 'gm' } }; game.scenes = new Map([[scene.id, scene]]);
	globalThis.getDocumentClass = type => class {
		constructor(input) {
			this.source = structuredClone(input);
			if (type === 'Tile') {
				this.source.texture.alphaThreshold ??= 0.75;
				this.source.video ??= { loop: true, autoplay: true, volume: 0 };
			}
		}
		toObject() { return structuredClone(this.source); }
	};
	foundry.applications.apps = { FilePicker: { implementation: {
		browse: async (type, root) => ({ target: root, private: false, dirs: [], files: [...files.keys()] }),
		upload: async (type, root, file) => {
			const path = `${root}/${file.name}`; events.push(`upload:${path}`);
			files.set(path, new Uint8Array(await file.arrayBuffer())); return { path };
		},
	} } };
	globalThis.fetch = async url => {
		const path = decodeURIComponent(url.pathname).slice(1);
		return new Response(files.get(path), { status: files.has(path) ? 200 : 404 });
	};
	const callbacks = [];
	const options = { token: 'workflow001', root: 'worlds/test', levelId: 'ground', kind: 'all', audience: 'player',
		replacementId: 'BakeTile00000001', sort: 0, format: 'png', isCurrent: () => current,
		approveScope: review => { callbacks.push('scope'); return { excludedIds: review.excluded.map(entry => entry.id), flattenToGround: true }; },
		approveRender: review => { callbacks.push('render'); return approve(review); },
		approvePlacement: review => { callbacks.push('placement'); return { [review.action === 'restore' ? 'restorePlacement' : 'flattenToGround']: true, overlappingTileIds: review.overlappingTileIds }; },
		verifyDisplay: async () => { callbacks.push('display'); return true; },
	};
	return { scene, source, options, events, files, callbacks };
}
const approveExecution = review => ({ sourceIds: review.sourceIds, resumeOperation: true });

test('GM Tile workflow wires real reviewed renderer through durable apply, then reload-style exact restore', async () => {
	const fixture = workflowFixture(), { scene, source, options, events, files, callbacks } = fixture;
	const workflow = await prepareReviewedTileBake(scene, options);
	assert.deepEqual(callbacks.slice(0, 3), ['scope', 'render', 'placement']);
	assert.deepEqual(events, []); assert.equal(files.size, 0);
	assert.ok(workflow.preview instanceof Blob);
	await assert.rejects(workflow.apply({ approveExecution }), /Persist verified assets/);
	await workflow.persistAssets({ approvedPaths: workflow.review.paths });
	assert.equal(events[0], 'journal:intent'); assert.equal(scene.drawings.size, 1); assert.equal(scene.tiles.size, 0);
	await workflow.apply({ approveExecution });
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'complete');
	assert.equal(scene.drawings.size, 0); assert.equal(scene.tiles.get(options.replacementId).toObject().hidden, false);
	assert.ok(events.indexOf('journal:assets-verified') < events.indexOf('create:Tile'));
	assert.ok(events.indexOf('create:Tile') < events.indexOf('delete:Drawing'));
	await assert.rejects(workflow.apply({ approveExecution }), /completed/);
	const applied = readOptimizationJournal(scene), entry = applied.entries[0];
	const later = { ...source, _id: 'later', x: 80 };
	scene.drawings.set('later', { id: 'later', toObject: () => structuredClone(later) });
	await beginOptimizationOperation(scene, applied, { ...entry, token: 'restore001', action: 'restore',
		phase: 'intent', parentToken: entry.token }, { isCurrent: () => current, verifyIntent: async () => true });
	const verifyOutput = optimizationOutputVerifier(entry.asset, { width: 40, height: 20 }, { isCurrent: () => current });
	const review = await reviewOptimizationExecution(scene, 'restore001', { isCurrent: () => current, verifyOutput });
	const archive = await readStoredOptimizationArchive(entry.archive, { isCurrent: () => current });
	await resumeOptimizationOperation(scene, 'restore001', {
		isCurrent: () => current, verifyOutput, approvedExecution: review.approve(approveExecution(review.review)),
		verifyNative: payload => {
			assert.deepEqual(payload, archive.payload);
			return assertOptimizationNativeSchemas(scene, payload);
		},
	});
	assert.deepEqual(scene.drawings.get('ink').toObject(), source);
	assert.deepEqual(scene.drawings.get('later').toObject(), later); assert.equal(scene.tiles.size, 0);
	assert.equal(files.size, 2);
});

test('workflow refuses wrong GM and absent native display acceptance before any rendering or writes', async () => {
	const { scene, options, events, callbacks } = workflowFixture();
	await assert.rejects(prepareReviewedTileBake(scene, { ...options, verifyDisplay: null }), /native display acceptance/);
	game.users.activeGM.id = 'otherGM';
	await assert.rejects(prepareReviewedTileBake(scene, options), /designated GM/);
	assert.deepEqual(callbacks, []); assert.deepEqual(events, []);
});

test('invalid storage/identities/options refuse before resource work or approval callbacks', async () => {
	const { scene, options, events, callbacks } = workflowFixture();
	for (const [patch, message] of [
		[{ root: '../worlds' }, /Folder|folder/],
		[{ replacementId: 'short' }, /unique operation, valid destination options and valid timeout/],
		[{ token: '../token' }, /unique operation, valid destination options and valid timeout/],
		[{ sort: undefined }, /unique operation, valid destination options and valid timeout/],
		[{ timeout: -1 }, /unique operation, valid destination options and valid timeout/],
	]) {
		await assert.rejects(prepareReviewedTileBake(scene, { ...options, ...patch }), message);
	}
	assert.deepEqual(callbacks, []); assert.deepEqual(events, []);
});

test('each rejected review or stale callback prevents durable workflow writes', async () => {
	for (const patch of [
		{ approveScope: () => ({ excludedIds: [], flattenToGround: false }) },
		{ approveRender: () => ({ proceed: false }) },
		{ approvePlacement: () => ({ flattenToGround: false, overlappingTileIds: [] }) },
		{ verifyDisplay: async () => false },
		{ approveRender: review => { current = false; return approve(review); } },
	]) {
		current = true;
		const { scene, options, events } = workflowFixture();
		await assert.rejects(prepareReviewedTileBake(scene, { ...options, ...patch }), /Approve|approve|accepted|context|changed/);
		assert.deepEqual(events, []); assert.equal(scene.drawings.size, 1);
	}
	current = true;
});

test('public reports cannot redirect persistence or bypass exact execution approval', async () => {
	const { scene, options, events, files } = workflowFixture();
	const workflow = await prepareReviewedTileBake(scene, options), paths = [...workflow.review.paths];
	workflow.review.paths.push('worlds/test/forged.png'); workflow.review.intent.asset.path = 'worlds/test/forged.png';
	await assert.rejects(workflow.persistAssets({ approvedPaths: workflow.review.paths }), /exactly the listed/);
	assert.deepEqual(events, []);
	await workflow.persistAssets({ approvedPaths: paths });
	await assert.rejects(workflow.apply({ approveExecution: review => {
		review.sourceIds = []; return approveExecution(review);
	} }), /all archived source/);
	assert.equal(scene.tiles.size, 0); assert.equal(scene.drawings.size, 1);
	await workflow.apply({ approveExecution });
	assert.equal(files.has('worlds/test/forged.png'), false);
});

test('workflow retains lost-upload intent and reconciles an exact retry before apply', async () => {
	const { scene, options, files } = workflowFixture();
	const workflow = await prepareReviewedTileBake(scene, options), picker = foundry.applications.apps.FilePicker.implementation;
	const upload = picker.upload; let fail = true, count = 0;
	picker.upload = async (...args) => { count++; const result = await upload(...args);
		if (fail) { fail = false; throw new Error('upload response lost'); } return result; };
	await assert.rejects(workflow.persistAssets({ approvedPaths: workflow.review.paths }), /unverified/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'intent'); assert.equal(files.size, 1);
	await workflow.persistAssets({ approvedPaths: workflow.review.paths });
	assert.equal(count, 2);
	await workflow.apply({ approveExecution }); assert.equal(scene.drawings.size, 0);
});

test('workflow rejects new strokes between review and durable preparation, and before native apply', async () => {
	const { scene, source, options, events } = workflowFixture();
	const workflow = await prepareReviewedTileBake(scene, options);
	scene.drawings.set('new', { id: 'new', toObject: () => ({ ...source, _id: 'new' }) });
	await assert.rejects(workflow.persistAssets({ approvedPaths: workflow.review.paths }), /context changed/);
	assert.deepEqual(events, []); scene.drawings.delete('new');
	await workflow.persistAssets({ approvedPaths: workflow.review.paths });
	await assert.rejects(workflow.apply({ approveExecution: review => {
		scene.drawings.set('new', { id: 'new', toObject: () => ({ ...source, _id: 'new' }) }); return approveExecution(review);
	} }), /changed during evidence/);
	assert.equal(scene.tiles.size, 0);
});

test('workflow excludes simultaneous preparation and writes on the same Scene and releases failed leases', async () => {
	const { scene, options } = workflowFixture();
	let release, entered;
	const started = new Promise(resolve => { entered = resolve; });
	const first = prepareReviewedTileBake(scene, { ...options, approveScope: async review => {
		entered(); await new Promise(resolve => { release = resolve; }); return options.approveScope(review);
	} });
	await started;
	await assert.rejects(prepareReviewedTileBake(scene, options), /already preparing/);
	release(); const workflow = await first;
	const picker = foundry.applications.apps.FilePicker.implementation, upload = picker.upload;
	let uploadEntered, uploadRelease;
	const uploading = new Promise(resolve => { uploadEntered = resolve; });
	picker.upload = async (...args) => {
		uploadEntered(); await new Promise(resolve => { uploadRelease = resolve; }); picker.upload = upload;
		return upload(...args);
	};
	const persist = workflow.persistAssets({ approvedPaths: workflow.review.paths });
	await uploading;
	await assert.rejects(workflow.persistAssets({ approvedPaths: workflow.review.paths }), /already preparing/);
	await assert.rejects(workflow.apply({ approveExecution }), /already preparing/);
	uploadRelease(); await persist;
	await workflow.apply({ approveExecution });
});

test('connected workflow re-reviews partial native state after lost source deletion acknowledgement', async () => {
	const { scene, source, options } = workflowFixture();
	const workflow = await prepareReviewedTileBake(scene, options);
	await workflow.persistAssets({ approvedPaths: workflow.review.paths });
	const remove = scene.deleteEmbeddedDocuments;
	scene.deleteEmbeddedDocuments = async (...args) => { await remove(...args); throw new Error('deletion response lost'); };
	await assert.rejects(workflow.apply({ approveExecution }), /deletion response lost/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'replacement-staged');
	assert.equal(scene.tiles.get(options.replacementId).toObject().hidden, true);
	scene.deleteEmbeddedDocuments = remove;
	const later = { ...source, _id: 'later', x: 80 };
	scene.drawings.set('later', { id: 'later', toObject: () => structuredClone(later) });
	let review;
	await workflow.apply({ approveExecution: candidate => { review = candidate; return approveExecution(candidate); } });
	assert.deepEqual(review.missingSourceIds, ['ink']);
	assert.deepEqual(scene.drawings.get('later').toObject(), later);
	assert.equal(scene.tiles.get(options.replacementId).toObject().hidden, false);
});

test('native display acceptance is required again before staging, not just during preview', async () => {
	const { scene, options } = workflowFixture();
	let displayAccepted = true;
	const workflow = await prepareReviewedTileBake(scene, { ...options, verifyDisplay: async () => displayAccepted });
	await workflow.persistAssets({ approvedPaths: workflow.review.paths });
	displayAccepted = false;
	await assert.rejects(workflow.apply({ approveExecution }), /display capability/);
	assert.equal(scene.drawings.size, 1); assert.equal(scene.tiles.size, 0);
	displayAccepted = true;
	await workflow.apply({ approveExecution });
	assert.equal(scene.drawings.size, 0);
});

test('connected workflow uses the concrete isolated display adapter when no override is supplied', async () => {
	const { scene, options } = workflowFixture();
	let uploads = 0, destroyed = 0;
	PIXI.Sprite = class {
		constructor(texture) { this.texture = texture; }
		destroy() {}
	};
	PIXI.Renderer = class {
		constructor() {
			this.gl = { ...renderer.gl, NO_ERROR: 0, getError: () => 0 };
			this.extract = { pixels: () => new Uint8Array(4) };
		}
		render(sprite) { assert.equal(sprite.texture.width, 40); assert.equal(sprite.texture.height, 20); uploads++; }
		destroy() { destroyed++; }
	};
	const workflow = await prepareReviewedTileBake(scene, { ...options, verifyDisplay: undefined });
	await workflow.persistAssets({ approvedPaths: workflow.review.paths });
	await workflow.apply({ approveExecution });
	assert.ok(uploads >= 3); assert.equal(uploads, destroyed);
	assert.equal(scene.drawings.size, 0);
	assert.ok(images.every(image => image.closed));
});

test('encoded preview approval is read-only, exact and cannot admit changed sources before writes', async () => {
	const { scene, options, events, source } = workflowFixture();
	await assert.rejects(prepareReviewedTileBake(scene, { ...options, approvePreview: async () => false }), /preview was not accepted/);
	assert.deepEqual(events, []);
	await assert.rejects(prepareReviewedTileBake(scene, { ...options, approvePreview: async (blob, review) => {
		assert.ok(blob instanceof Blob); assert.equal(review.render.width, 40);
		source.x++; return true;
	} }), /stale/);
	assert.deepEqual(events, []); source.x--;
	const workflow = await prepareReviewedTileBake(scene, { ...options, approvePreview: async () => true });
	assert.ok(workflow.preview instanceof Blob); assert.deepEqual(events, []);
});

test('configured Bake folder is bound through preview/persistence and changes refuse before any uploads', async () => {
	const { scene, options, events } = workflowFixture();
	let configuredRoot = options.root;
	const get = game.settings.get;
	game.settings.get = (module, key) => key === BAKE_RECOVERY_FOLDER ? configuredRoot : get(module, key);
	const workflow = await prepareReviewedTileBake(scene, { ...options, root: undefined });
	assert.equal(workflow.review.storage.root, configuredRoot);
	configuredRoot = 'worlds/test/changed';
	await assert.rejects(workflow.persistAssets({ approvedPaths: workflow.review.paths }), /unchanged context/);
	assert.deepEqual(events, []);
	configuredRoot = options.root;
	await workflow.persistAssets({ approvedPaths: workflow.review.paths });
	configuredRoot = 'worlds/test/changed';
	await assert.rejects(workflow.apply({ approveExecution }), /unchanged context/);
	assert.equal(scene.tiles.size, 0);
});

test('workflow storage failures precede scope/render and a folder changed after preview blocks intent', async () => {
	const { scene, options, callbacks, events } = workflowFixture();
	const picker = foundry.applications.apps.FilePicker.implementation, browse = picker.browse;
	picker.browse = async () => ({ target: 'worlds', files: [], dirs: [], private: false });
	await assert.rejects(prepareReviewedTileBake(scene, options), /StorageListingInvalid/);
	assert.deepEqual(callbacks, []); assert.deepEqual(events, []);
	picker.browse = browse;
	const workflow = await prepareReviewedTileBake(scene, options);
	picker.browse = async () => { throw new Error('folder disappeared'); };
	await assert.rejects(workflow.persistAssets({ approvedPaths: workflow.review.paths }), /folder disappeared/);
	assert.deepEqual(events, []);
});

function entryFixture() {
	const fixture = workflowFixture(), { scene, options } = fixture;
	canvas.ready = true; canvas.scene = scene; canvas.level = { id: 'ground' };
	let id = 0;
	foundry.utils = { randomID: () => `BakeEntry${String(++id).padStart(7, '0')}` };
	const notices = [];
	globalThis.ui = { notifications: { info: message => notices.push(['info', message]),
		warn: message => notices.push(['warn', message]) } };
	game.i18n.format = (key, data) => `${key} ${JSON.stringify(data)}`;
	const dialogs = {
		approveScope: options.approveScope, approveRender: options.approveRender,
		approvePlacement: options.approvePlacement, approvePreview: async () => true,
		approvePersistence: async review => ({ approvedPaths: review.paths }),
		approveExecution: async review => approveExecution(review),
		approveRestoreIntent: async () => true,
		approveTakeover: async () => true,
	};
	return { ...fixture, dialogs, notices };
}

test('opt-in entry completes real connected workflow with all approvals and generated native identities', async () => {
	const { scene, options, dialogs, notices } = entryFixture();
	const result = await promptReviewedTileBake(scene, { ...options, token: undefined, replacementId: undefined },
		{ reviewDialogs: dialogs });
	assert.equal(result.status, 'complete');
	assert.equal(result.token, 'BakeEntry0000001');
	assert.equal(scene.tiles.has('BakeEntry0000002'), true);
	assert.equal(scene.drawings.size, 0); assert.equal(notices[0][0], 'info');
	assert.equal(result.journal.entries[0].phase, 'complete');
});

test('entry cancellation at every pre-write review leaves originals and no files/journal', async () => {
	for (const key of ['approveScope', 'approveRender', 'approvePlacement', 'approvePreview', 'approvePersistence']) {
		const { scene, options, dialogs, events, notices } = entryFixture();
		dialogs[key] = async () => { throw new BakeReviewCancelledError(); };
		const result = await promptReviewedTileBake(scene, options, { reviewDialogs: dialogs });
		assert.equal(result.status, 'cancelled'); assert.equal(result.recovery, null);
		assert.deepEqual(events, []); assert.equal(scene.drawings.size, 1); assert.equal(notices[0][0], 'warn');
	}
});

test('entry cancellation after persistence reports exact retained recovery without rollback', async () => {
	const { scene, options, dialogs, files, notices } = entryFixture();
	dialogs.approveExecution = async () => { throw new BakeReviewCancelledError(); };
	const result = await promptReviewedTileBake(scene, options, { reviewDialogs: dialogs });
	assert.equal(result.status, 'cancelled'); assert.equal(result.stage, 'execution');
	assert.equal(result.recovery.phase, 'assets-verified'); assert.equal(files.size, 2);
	assert.equal(scene.drawings.size, 1); assert.equal(scene.tiles.size, 0);
	assert.ok(notices[0][1].includes('EntryCancelledRetained'));
	result.recovery.asset.path = 'forged';
	assert.notEqual(readOptimizationJournal(scene).entries[0].asset.path, 'forged');
});

test('entry surfaces unexpected failures and partial native writes, never labels them cancelled', async () => {
	const { scene, options, dialogs, notices } = entryFixture();
	dialogs.approveRender = async () => { throw new Error('render dialog failed'); };
	await assert.rejects(promptReviewedTileBake(scene, options, { reviewDialogs: dialogs }), /render dialog failed/);
	assert.deepEqual(notices, []);
	dialogs.approveRender = options.approveRender;
	scene.deleteEmbeddedDocuments = async () => { throw new Error('native deletion failed'); };
	await assert.rejects(promptReviewedTileBake(scene, options, { reviewDialogs: dialogs }), /native deletion failed/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'replacement-staged');
	assert.equal(scene.drawings.size, 1); assert.deepEqual(notices, []);
});

test('entry guards displayed context and excludes overlapping dialog lifetimes, releasing cancelled reviews', async () => {
	const { scene, options, dialogs, events } = entryFixture();
	canvas.level.id = 'other';
	await assert.rejects(promptReviewedTileBake(scene, options, { reviewDialogs: dialogs }), /Changed/);
	canvas.level.id = 'ground';
	let release, entered;
	const started = new Promise(resolve => { entered = resolve; });
	dialogs.approveScope = async () => { entered(); await new Promise(resolve => { release = resolve; });
		throw new BakeReviewCancelledError(); };
	const first = promptReviewedTileBake(scene, options, { reviewDialogs: dialogs });
	await started;
	await assert.rejects(promptReviewedTileBake(scene, options, { reviewDialogs: dialogs }), /EntryBusy/);
	release(); assert.equal((await first).status, 'cancelled');
	dialogs.approveScope = options.approveScope;
	dialogs.approvePreview = async () => { canvas.scene = {}; return true; };
	await assert.rejects(promptReviewedTileBake(scene, options, { reviewDialogs: dialogs }), /context/);
	assert.deepEqual(events, []);
});

test('default entry wires real localized dialogs and decoded preview to connected rendering and apply', async () => {
	const { scene, options, events } = entryFixture(), create = document.createElement, prompts = [];
	document.createElement = tag => {
		if (tag === 'canvas') return create(tag);
		return { tag, children: [], attributes: {}, append(child) { this.children.push(child); },
			setAttribute(key, value) { this.attributes[key] = value; },
			async decode() { this.naturalWidth = 40; this.naturalHeight = 20; } };
	};
	foundry.applications.api = { DialogV2: { prompt: async candidate => {
		prompts.push(candidate);
		if (prompts.length <= 5) assert.deepEqual(events, []);
		if (prompts.length === 6) assert.equal(scene.tiles.size, 0);
		return candidate.ok.callback(null, { form: { elements: { acknowledge: { checked: true } } } });
	} } };
	const result = await promptReviewedTileBake(scene, options);
	assert.equal(result.status, 'complete');
	assert.deepEqual(prompts.map(prompt => prompt.window.title), [
		'FOUNDRYSHOP.Bake.ReviewScope', 'FOUNDRYSHOP.Bake.ReviewRender', 'FOUNDRYSHOP.Bake.ReviewPlacement',
		'FOUNDRYSHOP.Bake.ReviewPreview', 'FOUNDRYSHOP.Bake.ReviewPersistence', 'FOUNDRYSHOP.Bake.ReviewApply',
	]);
	assert.equal(scene.drawings.size, 0);
	assert.equal(scene.tiles.size, 1);
});

test('entry refuses non-GMs and journaled token reuse without opening reviews or starting resource work', async () => {
	const { scene, options, dialogs, callbacks } = entryFixture();
	game.user.isGM = false;
	await assert.rejects(promptReviewedTileBake(scene, options, { reviewDialogs: dialogs }), /Changed/);
	assert.deepEqual(callbacks, []);
	game.user.isGM = true;
	await promptReviewedTileBake(scene, options, { reviewDialogs: dialogs });
	const count = callbacks.length;
	await assert.rejects(promptReviewedTileBake(scene, options, { reviewDialogs: dialogs }), /EntryTokenUsed/);
	assert.equal(callbacks.length, count);
});

test('entry without code-supplied scope/audience/sort uses options UI before all six mandatory reviews', async () => {
	const { scene, options, dialogs, events } = entryFixture(), prompts = [];
	const create = document.createElement;
	document.createElement = tag => tag === 'canvas' ? create(tag) : {
		children: [], append(child) { this.children.push(child); }, setAttribute() {},
	};
	foundry.applications.api = { DialogV2: { prompt: async candidate => {
		prompts.push(candidate); assert.deepEqual(events, []);
		const fields = { kind: 'all', layerId: '', audience: 'gm', sort: '-1', format: 'png', quality: '1', crop: 'automatic',
			acknowledgeExternal: false };
		return candidate.ok.callback(null, { form: { elements: Object.fromEntries(Object.entries(fields)
			.map(([key, value]) => [key, { value, checked: value === true }])) } });
	} } };
	canvas.drawings = { controlled: [] };
	const result = await promptReviewedTileBake(scene, { ...options, kind: undefined, audience: undefined, sort: undefined },
		{ reviewDialogs: dialogs });
	assert.equal(result.status, 'complete'); assert.equal(prompts[0].window.title, 'FOUNDRYSHOP.Bake.OptionsTitle');
	assert.equal(scene.tiles.get(options.replacementId).toObject().sort, -1);
	assert.equal(scene.tiles.get(options.replacementId).toObject().hidden, true);
});

test('entry options cancellation returns a no-write cancellation and releases review lifetime', async () => {
	const { scene, options, dialogs, events } = entryFixture();
	const create = document.createElement;
	document.createElement = tag => tag === 'canvas' ? create(tag) : { append() {}, setAttribute() {} };
	canvas.drawings = { controlled: [] };
	foundry.applications.api = { DialogV2: { prompt: async () => null } };
	for (let attempt = 0; attempt < 2; attempt++) {
		const result = await promptReviewedTileBake(scene, { ...options, audience: undefined, sort: undefined }, { reviewDialogs: dialogs });
		assert.equal(result.stage, 'options'); assert.equal(result.status, 'cancelled'); assert.equal(result.recovery, null);
	}
	assert.deepEqual(events, []);
});

async function persistedEntry(fixture) {
	const { scene, options, dialogs } = fixture;
	const approve = dialogs.approveExecution;
	dialogs.approveExecution = async () => { throw new BakeReviewCancelledError(); };
	await promptReviewedTileBake(scene, options, { reviewDialogs: dialogs });
	dialogs.approveExecution = approve;
}

test('fresh reload entry resumes persisted apply using retained paths regardless of changed folder setting', async () => {
	const fixture = entryFixture(), { scene, options, dialogs, files, source } = fixture;
	await persistedEntry(fixture);
	const later = { ...source, _id: 'later' };
	scene.drawings.set('later', { id: 'later', toObject: () => structuredClone(later) });
	const get = game.settings.get;
	game.settings.get = (module, key) => key === BAKE_RECOVERY_FOLDER ? 'worlds/changed' : get(module, key);
	const paths = [...files.keys()], count = files.size;
	const result = await promptResumeTileBake(scene, options.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: dialogs });
	assert.equal(result.status, 'complete'); assert.equal(result.journal.entries[0].phase, 'complete');
	assert.deepEqual([...files.keys()], paths); assert.equal(files.size, count);
	assert.deepEqual(scene.drawings.get('later').toObject(), later); assert.equal(scene.drawings.has('ink'), false);
});

test('fresh reload resume completes interrupted source deletion and a separate restore intent', async () => {
	const fixture = entryFixture(), { scene, options, dialogs, source } = fixture;
	const remove = scene.deleteEmbeddedDocuments;
	scene.deleteEmbeddedDocuments = async (...args) => { await remove(...args); throw new Error('source deletion response lost'); };
	await assert.rejects(promptReviewedTileBake(scene, options, { reviewDialogs: dialogs }), /response lost/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'replacement-staged');
	scene.deleteEmbeddedDocuments = remove;
	await promptResumeTileBake(scene, options.token, { verifyDisplay: options.verifyDisplay }, { reviewDialogs: dialogs });
	const journal = readOptimizationJournal(scene), applied = journal.entries[0];
	await beginOptimizationOperation(scene, journal, { ...applied, token: 'restoreReload',
		action: 'restore', phase: 'intent', parentToken: applied.token },
	{ isCurrent: () => current, verifyIntent: async () => true });
	const result = await promptResumeTileBake(scene, 'restoreReload', {
		verifyDisplay: () => assert.fail('restore must not require allocating the removed Tile texture'),
	}, { reviewDialogs: dialogs });
	assert.equal(result.status, 'complete');
	assert.deepEqual(scene.drawings.get('ink').toObject(), source); assert.equal(scene.tiles.size, 0);
});

test('resume cancellation at each review retains exact durable intent and no native writes', async () => {
	for (const key of ['approvePreview', 'approvePlacement', 'approveExecution']) {
		const fixture = entryFixture(), { scene, options, dialogs, events, files } = fixture;
		await persistedEntry(fixture);
		const count = events.length;
		dialogs[key] = async () => { throw new BakeReviewCancelledError(); };
		const result = await promptResumeTileBake(scene, options.token, { verifyDisplay: options.verifyDisplay }, { reviewDialogs: dialogs });
		assert.equal(result.status, 'cancelled'); assert.equal(result.recovery.phase, 'assets-verified');
		assert.equal(events.length, count); assert.equal(files.size, 2); assert.equal(scene.drawings.size, 1);
		assert.equal(scene.tiles.size, 0);
	}
});

test('resume corrupted/missing evidence and display refusal never invent bytes or report completion', async () => {
	const fixture = entryFixture(), { scene, options, dialogs, files } = fixture;
	await persistedEntry(fixture);
	const output = readOptimizationJournal(scene).entries[0].asset, bytes = files.get(output.path);
	files.delete(output.path);
	await assert.rejects(promptResumeTileBake(scene, options.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: dialogs }), /HTTP 404/);
	files.set(output.path, new Uint8Array([1]));
	await assert.rejects(promptResumeTileBake(scene, options.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: dialogs }), /truncated|size/);
	files.set(output.path, bytes);
	await assert.rejects(promptResumeTileBake(scene, options.token, { verifyDisplay: async () => false },
		{ reviewDialogs: dialogs }), /ResumeDisplayFailed/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'assets-verified');
	assert.equal(scene.drawings.size, 1); assert.equal(scene.tiles.size, 0);
});

test('resume snapshot rejects preview/placement/native-callback changes and wrong ownership or token', async () => {
	const fixture = entryFixture(), { scene, options, dialogs, source } = fixture;
	await persistedEntry(fixture);
	await assert.rejects(promptResumeTileBake(scene, 'other', {}, { reviewDialogs: dialogs }), /ResumeInvalid/);
	game.users.activeGM.id = 'other';
	await assert.rejects(promptResumeTileBake(scene, options.token, {}, { reviewDialogs: dialogs }), /Changed/);
	game.users.activeGM.id = 'gm';
	const approve = dialogs.approvePreview;
	dialogs.approvePreview = async () => { source.x++; return true; };
	await assert.rejects(promptResumeTileBake(scene, options.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: dialogs }), /ResumeStale/);
	source.x--; dialogs.approvePreview = approve;
	await assert.rejects(promptResumeTileBake(scene, options.token, { verifyDisplay: async () => {
		scene.drawings.set('foreign', { id: 'foreign', toObject: () => ({ ...source, _id: 'foreign' }) }); return true;
	} }, { reviewDialogs: dialogs }), /stale/);
	assert.equal(scene.tiles.size, 0); assert.equal(scene.drawings.has('ink'), true);
});

test('resume shares the entry review lease and refuses completed operations', async () => {
	const fixture = entryFixture(), { scene, options, dialogs } = fixture;
	await persistedEntry(fixture);
	let release, entered;
	const started = new Promise(resolve => { entered = resolve; });
	dialogs.approvePreview = async () => { entered(); await new Promise(resolve => { release = resolve; }); return true; };
	const resume = promptResumeTileBake(scene, options.token, { verifyDisplay: options.verifyDisplay }, { reviewDialogs: dialogs });
	await started;
	await assert.rejects(promptReviewedTileBake(scene, { ...options, token: 'anotherToken' }, { reviewDialogs: dialogs }), /EntryBusy/);
	await assert.rejects(promptResumeTileBake(scene, options.token, { verifyDisplay: options.verifyDisplay }, { reviewDialogs: dialogs }), /EntryBusy/);
	release(); assert.equal((await resume).status, 'complete');
	await assert.rejects(promptResumeTileBake(scene, options.token, {}, { reviewDialogs: dialogs }), /ResumeInvalid/);
});

test('reload entry default localized dialogs review actual persisted image, placement and exact sources', async () => {
	const fixture = entryFixture(), { scene, options, files } = fixture;
	await persistedEntry(fixture);
	const create = document.createElement, prompts = [], paths = [...files.keys()];
	document.createElement = tag => tag === 'canvas' ? create(tag) : {
		children: [], attributes: {}, append(child) { this.children.push(child); },
		setAttribute(key, value) { this.attributes[key] = value; },
		async decode() { this.naturalWidth = 40; this.naturalHeight = 20; },
	};
	foundry.applications.api = { DialogV2: { prompt: async candidate => {
		prompts.push(candidate); assert.equal(scene.tiles.size, 0); assert.equal(scene.drawings.size, 1);
		return candidate.ok.callback(null, { form: { elements: { acknowledge: { checked: true } } } });
	} } };
	const result = await promptResumeTileBake(scene, options.token, { verifyDisplay: options.verifyDisplay });
	assert.equal(result.status, 'complete');
	assert.deepEqual(prompts.map(prompt => prompt.window.title), [
		'FOUNDRYSHOP.Bake.ReviewPreview', 'FOUNDRYSHOP.Bake.ReviewPlacement', 'FOUNDRYSHOP.Bake.ReviewApply',
	]);
	assert.deepEqual([...files.keys()], paths);
});

test('reload entry refuses changed displayed Level and abort signals without opening any review', async () => {
	const fixture = entryFixture(), { scene, options, dialogs, callbacks } = fixture;
	await persistedEntry(fixture);
	const count = callbacks.length;
	canvas.level.id = 'other';
	await assert.rejects(promptResumeTileBake(scene, options.token, {}, { reviewDialogs: dialogs }), /Changed/);
	canvas.level.id = 'ground';
	const controller = new AbortController(); controller.abort();
	await assert.rejects(promptResumeTileBake(scene, options.token, { signal: controller.signal }, { reviewDialogs: dialogs }), /Changed/);
	assert.equal(callbacks.length, count); assert.equal(scene.tiles.size, 0);
});

async function completeParentBake(fixture) {
	const { scene, options, dialogs } = fixture;
	const result = await promptReviewedTileBake(scene, options, { reviewDialogs: dialogs });
	assert.equal(result.status, 'complete');
	return result;
}

test('restore entry creates exact durable lineage intent then resumes to originals without removing later strokes', async () => {
	const fixture = entryFixture(), { scene, options, dialogs, source, files } = fixture;
	await completeParentBake(fixture);
	const later = { ...source, _id: 'later', x: 75 };
	scene.drawings.set('later', { id: 'later', toObject: () => structuredClone(later) });
	const existing = readOptimizationJournal(scene), parent = existing.entries[0], paths = [...files.keys()];
	const restored = await promptRestoreTileBake(scene, parent.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: dialogs });
	assert.equal(restored.status, 'complete'); assert.equal(restored.parentToken, parent.token);
	assert.equal(restored.journal.entries.at(-1).action, 'restore');
	assert.equal(restored.journal.entries.at(-1).phase, 'complete');
	assert.deepEqual(restored.journal.entries.at(-1).archive, parent.archive);
	assert.deepEqual(restored.journal.entries.at(-1).asset, parent.asset);
	assert.deepEqual(scene.drawings.get('ink').toObject(), source);
	assert.deepEqual(scene.drawings.get('later').toObject(), later);
	assert.equal(scene.tiles.size, 0); assert.deepEqual([...files.keys()], paths);
});

test('full Tile Bake and restore support Foundry Scenes whose grid is a plain data object', async () => {
	const fixture = entryFixture(), { scene, options, dialogs, source } = fixture;
	scene.grid = { type: 0, size: 100, sizeX: 100, sizeY: 100, distance: 5, units: 'ft',
		style: 'solidLines', thickness: 1, color: '#000000', alpha: 0.2 };
	const applied = await completeParentBake(fixture);
	assert.equal(applied.journal.entries[0].phase, 'complete');
	assert.equal(scene.drawings.size, 0); assert.equal(scene.tiles.size, 1);
	const restored = await promptRestoreTileBake(scene, applied.token,
		{ verifyDisplay: options.verifyDisplay }, { reviewDialogs: dialogs });
	assert.equal(restored.status, 'complete');
	assert.deepEqual(scene.drawings.get('ink').toObject(), source);
	assert.equal(scene.tiles.size, 0);
});

test('restore intent cancellation and evidence/native conflicts do not create journal or touch documents', async () => {
	for (const outcome of ['cancel', 'missing', 'edited-original-id', 'edited-tile', 'missing-output']) {
		const fixture = entryFixture(), { scene, options, dialogs, files } = fixture;
		await completeParentBake(fixture);
		const journal = readOptimizationJournal(scene), parent = journal.entries[0], before = structuredClone(journal);
		if (outcome === 'missing') scene.drawings.set('ink', { id: 'ink', toObject: () => structuredClone(fixture.source) });
		if (outcome === 'edited-original-id') scene.drawings.set('ink', { id: 'ink', toObject: () => ({ ...fixture.source, x: 12 }) });
		if (outcome === 'edited-tile') {
			const tile = scene.tiles.get(options.replacementId), document = tile.toObject();
			scene.tiles.set(options.replacementId, { id: options.replacementId, toObject: () => ({ ...document, x: 99 }) });
		}
		if (outcome === 'missing-output') files.delete(parent.asset.path);
		if (outcome === 'cancel') dialogs.approveRestoreIntent = async () => { throw new BakeReviewCancelledError(); };
		if (outcome === 'cancel') {
			const result = await promptRestoreTileBake(scene, parent.token, { verifyDisplay: options.verifyDisplay },
				{ reviewDialogs: dialogs });
			assert.equal(result.status, 'cancelled'); assert.equal(result.recovery, null);
		} else {
			await assert.rejects(promptRestoreTileBake(scene, parent.token, { verifyDisplay: options.verifyDisplay },
				{ reviewDialogs: dialogs }), outcome === 'missing-output' ? /HTTP 404/
					: /RestoreConflict|original ink was edited|Tile replacement was edited|Recovery source\/context changed/);
		}
		assert.deepEqual(readOptimizationJournal(scene), before);
		assert.equal(scene.tiles.size, 1);
		assert.equal(scene.drawings.has('ink'), outcome === 'missing' || outcome === 'edited-original-id');
	}
});

test('restore only accepts latest completed Tile apply, rejects duplicates and protects cross-operation identity', async () => {
	const fixture = entryFixture(), { scene, options, dialogs } = fixture;
	await completeParentBake(fixture);
	const parent = readOptimizationJournal(scene).entries[0];
	game.users.activeGM.id = 'other';
	await assert.rejects(promptRestoreTileBake(scene, parent.token, {}, { reviewDialogs: dialogs }), /Changed/);
	game.users.activeGM.id = 'gm';
	const created = await promptRestoreTileBake(scene, parent.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: dialogs });
	assert.equal(created.status, 'complete');
	await assert.rejects(promptRestoreTileBake(scene, parent.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: dialogs }), /RestoreInvalid/);
	await assert.rejects(promptRestoreTileBake(scene, 'missing', {}, { reviewDialogs: dialogs }), /RestoreInvalid/);
});

test('restore approval binds parent, reviewer, exact files and full native snapshot across dialog', async () => {
	const fixture = entryFixture(), { scene, options, dialogs, files } = fixture;
	await completeParentBake(fixture);
	const parent = readOptimizationJournal(scene).entries[0], before = structuredClone(readOptimizationJournal(scene));
	const approve = dialogs.approveRestoreIntent;
	dialogs.approveRestoreIntent = async review => {
		assert.deepEqual(review.sourceIds, ['ink']); assert.equal(review.token, parent.token);
		assert.deepEqual(readOptimizationJournal(scene), before);
		scene.tiles.set('foreign', { id: 'foreign', toObject: () => ({ _id: 'foreign' }) });
		return approve(review);
	};
	await assert.rejects(promptRestoreTileBake(scene, parent.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: dialogs }), /ResumeStale/);
	assert.deepEqual(readOptimizationJournal(scene), before);
	assert.equal(files.size, 2); assert.equal(scene.drawings.size, 0);
});

test('restore interruption retains one intent and can be reviewed and resumed after reload', async () => {
	const fixture = entryFixture(), { scene, options, dialogs } = fixture;
	await completeParentBake(fixture);
	const parent = readOptimizationJournal(scene).entries[0];
	dialogs.approvePreview = async () => { throw new BakeReviewCancelledError(); };
	const interrupted = await promptRestoreTileBake(scene, parent.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: dialogs });
	assert.equal(interrupted.status, 'cancelled');
	assert.equal(interrupted.recovery.action, 'restore');
	assert.equal(interrupted.recovery.parentToken, parent.token);
	assert.equal(readOptimizationJournal(scene).entries.filter(entry => entry.action === 'restore').length, 1);
	const resumed = await promptResumeTileBake(scene, interrupted.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: { ...dialogs, approvePreview: async () => true } });
	assert.equal(resumed.status, 'complete');
	assert.equal(readOptimizationJournal(scene).entries.filter(entry => entry.action === 'restore').length, 1);
	assert.equal(scene.drawings.has('ink'), true); assert.equal(scene.tiles.size, 0);
});

test('restore rejects a corrupt parent archive before confirmation or journal writes', async () => {
	const fixture = entryFixture(), { scene, options, dialogs, files } = fixture;
	await completeParentBake(fixture);
	const journal = readOptimizationJournal(scene), parent = journal.entries[0];
	files.set(parent.archive.path, new Uint8Array([1, 2, 3]));
	await assert.rejects(promptRestoreTileBake(scene, parent.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: dialogs }), /size|truncated|checksum|Invalid/);
	assert.deepEqual(readOptimizationJournal(scene), journal);
	assert.equal(scene.drawings.size, 0); assert.equal(scene.tiles.size, 1);
});

test('restore creation commit permits only its exact own intent write before reload-resume', async () => {
	const fixture = entryFixture(), { scene, options, dialogs } = fixture;
	await completeParentBake(fixture);
	const parent = readOptimizationJournal(scene).entries[0], update = scene.update.bind(scene);
	let intentWritten = false;
	scene.update = async patch => {
		await update(patch);
		const last = patch['flags.foundryshop.optimizationJournal'].entries.at(-1);
		if (last.action === 'restore' && last.phase === 'intent') {
			assert.equal(readOptimizationJournal(scene).entries.at(-1).phase, 'intent');
			intentWritten = true;
		}
	};
	const result = await promptRestoreTileBake(scene, parent.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: dialogs });
	assert.equal(result.status, 'complete'); assert.equal(intentWritten, true); assert.equal(scene.tiles.size, 0);
});

function takeoverAsNewGM() {
	game.user.id = 'gm2';
	game.users = { activeGM: { id: 'gm2' }, get: id => ({ id, active: false }) };
}

test('takeover verifies disconnected-owner evidence, transfers exact journal ownership, then resumes normally', async () => {
	const fixture = entryFixture(), { scene, options, dialogs, source } = fixture;
	await persistedEntry(fixture);
	takeoverAsNewGM();
	const reviewed = [];
	dialogs.approveTakeover = async review => {
		reviewed.push(structuredClone(review));
		return true;
	};
	const result = await promptTakeOverTileBake(scene, options.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: dialogs });
	assert.equal(result.status, 'complete'); assert.equal(result.ownershipTransferred, true);
	assert.equal(result.previousOwner, 'gm');
	assert.equal(reviewed.length, 1); assert.equal(reviewed[0].phase, 'assets-verified');
	assert.equal(reviewed[0].previousOwner, 'gm'); assert.deepEqual(reviewed[0].sourceIds, ['ink']);
	assert.equal(result.journal.entries[0].ownerId, 'gm2');
	assert.equal(result.journal.entries[0].phase, 'complete');
	assert.equal(scene.drawings.size, 0); assert.equal(scene.tiles.size, 1);
	assert.deepEqual(scene.tiles.get(options.replacementId).toObject().texture.src, result.journal.entries[0].asset.path);
});

test('takeover refuses same owner, non-designated GM and an owner that is still connected', async () => {
	const fixture = entryFixture(), { scene, options, dialogs } = fixture;
	await persistedEntry(fixture);
	await assert.rejects(promptTakeOverTileBake(scene, options.token, {}, { reviewDialogs: dialogs }), /TakeoverUnavailable/);
	takeoverAsNewGM();
	game.users.get = () => undefined;
	await assert.rejects(promptTakeOverTileBake(scene, options.token, {}, { reviewDialogs: dialogs }), /TakeoverUnavailable/);
	game.users.get = id => ({ id, active: id === 'gm' });
	const before = structuredClone(readOptimizationJournal(scene));
	await assert.rejects(promptTakeOverTileBake(scene, options.token, {}, { reviewDialogs: dialogs }), /TakeoverUnavailable/);
	game.users.get = id => ({ id, active: false });
	game.users.activeGM.id = 'other';
	await assert.rejects(promptTakeOverTileBake(scene, options.token, {}, { reviewDialogs: dialogs }), /TakeoverUnavailable/);
	assert.deepEqual(readOptimizationJournal(scene), before);
});

test('takeover cancellation, missing/corrupt files and changed native state never transfer ownership', async () => {
	for (const outcome of ['cancel', 'missing', 'corrupt', 'native-change']) {
		const fixture = entryFixture(), { scene, options, dialogs, files } = fixture;
		await persistedEntry(fixture);
		takeoverAsNewGM();
		const before = structuredClone(readOptimizationJournal(scene)), entry = before.entries[0];
		if (outcome === 'cancel') dialogs.approveTakeover = async () => { throw new BakeReviewCancelledError(); };
		if (outcome === 'missing') files.delete(entry.asset.path);
		if (outcome === 'corrupt') files.set(entry.archive.path, new Uint8Array([1, 2, 3]));
		if (outcome === 'native-change') dialogs.approveTakeover = async () => {
			scene.drawings.set('foreign', { id: 'foreign', toObject: () => drawing('foreign') });
			return true;
		};
		if (outcome === 'cancel') {
			const result = await promptTakeOverTileBake(scene, options.token, { verifyDisplay: options.verifyDisplay },
				{ reviewDialogs: dialogs });
			assert.equal(result.status, 'cancelled'); assert.equal(result.ownershipTransferred, false);
		} else {
			await assert.rejects(promptTakeOverTileBake(scene, options.token, { verifyDisplay: options.verifyDisplay },
				{ reviewDialogs: dialogs }), /HTTP 404|checksum|size|truncated|recovery conflicts|original|ResumeStale/);
		}
		assert.deepEqual(readOptimizationJournal(scene), before);
		assert.equal(readOptimizationJournal(scene).entries[0].ownerId, 'gm');
	}
});

test('takeover permits interruption after the durable ownership transfer and resume by the new owner', async () => {
	const fixture = entryFixture(), { scene, options, dialogs } = fixture;
	await persistedEntry(fixture);
	takeoverAsNewGM();
	dialogs.approvePreview = async () => { throw new BakeReviewCancelledError(); };
	const result = await promptTakeOverTileBake(scene, options.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: dialogs });
	assert.equal(result.status, 'cancelled'); assert.equal(result.ownershipTransferred, true);
	assert.equal(result.recovery.ownerId, 'gm2'); assert.equal(result.recovery.phase, 'assets-verified');
	assert.equal(readOptimizationJournal(scene).entries[0].ownerId, 'gm2');
	dialogs.approvePreview = async () => true;
	const resumed = await promptResumeTileBake(scene, options.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: dialogs });
	assert.equal(resumed.status, 'complete'); assert.equal(scene.drawings.size, 0);
});

test('takeover review binds owner disconnect and native/workspace snapshot while dialog is open', async () => {
	const fixture = entryFixture(), { scene, options, dialogs } = fixture;
	await persistedEntry(fixture);
	takeoverAsNewGM();
	const before = structuredClone(readOptimizationJournal(scene));
	dialogs.approveTakeover = async () => {
		game.users.get = id => ({ id, active: id === 'gm' });
		return true;
	};
	await assert.rejects(promptTakeOverTileBake(scene, options.token, { verifyDisplay: options.verifyDisplay },
		{ reviewDialogs: dialogs }), /TakeoverUnavailable/);
	assert.deepEqual(readOptimizationJournal(scene), before);
	assert.equal(scene.tiles.size, 0); assert.equal(scene.drawings.size, 1);
});

test('conflict monitor allows the reviewed token but permanently invalidates a competing journal update', async () => {
	const fixture = entryFixture(), { scene } = fixture;
	const competitor = entryFixture();
	await completeParentBake(competitor);
	const foreign = structuredClone(readOptimizationJournal(competitor.scene).entries[0]);
	foreign.token = 'foreignoperation';
	const baseline = readOptimizationJournal(scene);
	const monitor = monitorOptimizationConflicts(scene, { baseline, allowedTokens: ['localoperation'],
		ownerTransfers: { localoperation: 'gm' } });
	try {
		scene.flags.optimizationJournal = { version: 1, revision: 1, entries: [{
			...foreign, token: 'localoperation', phase: 'intent',
		}] };
		Hooks.callAll('updateScene', scene, {}, {}, 'gm');
		assert.equal(monitor.assertCurrent(), true);
		scene.flags.optimizationJournal = { version: 1, revision: 2, entries: [foreign] };
		Hooks.callAll('updateScene', scene, {}, {}, 'gm');
		assert.throws(monitor.assertCurrent, /conflict detected/);
		scene.flags.optimizationJournal = baseline;
		Hooks.callAll('updateScene', scene, {}, {}, 'gm');
		assert.throws(monitor.assertCurrent, /conflict detected/);
	} finally { monitor.close(); }
	assert.equal(Hooks.callAll('updateScene', scene, {}, {}, 'gm'), undefined);
});

test('conflict monitor rejects changed immutable descriptors and removes its update hook on close', async () => {
	const fixture = entryFixture(), { scene } = fixture;
	await completeParentBake(fixture);
	const baseline = readOptimizationJournal(scene), monitor = monitorOptimizationConflicts(scene, { baseline });
	try {
		const changed = structuredClone(baseline);
		changed.entries[0].sourceDigest = 'f'.repeat(64);
		changed.revision++;
		scene.flags.optimizationJournal = changed;
		Hooks.callAll('updateScene', scene, {}, {}, 'gm');
		assert.throws(monitor.assertCurrent, /descriptor changed/);
	} finally { monitor.close(); }
	scene.flags.optimizationJournal = baseline;
	assert.throws(monitor.assertCurrent, /closed/);
});

test('Tile Bake stops after an unexpected persisted Scene journal update during review', async () => {
	const fixture = entryFixture(), { scene, options, dialogs, events } = fixture;
	const competitor = entryFixture();
	await completeParentBake(competitor);
	const competingJournal = structuredClone(readOptimizationJournal(competitor.scene));
	competingJournal.entries[0].token = 'foreignoperation';
	game.scenes = new Map([[scene.id, scene]]);
	canvas.scene = scene; canvas.level = { id: 'ground' }; canvas.ready = true;
	dialogs.approveScope = async review => {
		scene.flags.optimizationJournal = competingJournal;
		Hooks.callAll('updateScene', scene, {}, {}, 'gm');
		return { excludedIds: review.excluded.map(entry => entry.id), flattenToGround: true };
	};
	await assert.rejects(promptReviewedTileBake(scene, options, { reviewDialogs: dialogs }), /conflict detected/);
	assert.deepEqual(events, []);
	assert.equal(scene.drawings.size, 1); assert.equal(scene.tiles.size, 0);
	assert.deepEqual(readOptimizationJournal(scene), competingJournal);
});
