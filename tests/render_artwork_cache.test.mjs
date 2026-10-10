import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DrawingArtworkCache } from '../scripts/render_artwork_cache.js';
import { DrawingCacheBudget } from '../scripts/render_cache_admission.js';
import { DrawingCacheHost } from '../scripts/render_cache_host.js';

let renders, allocations, destroyed, built;
class Container {
	constructor() {
		this.children = [];
		this.scale = this.position = this.pivot = { set() {} };
	}
	addChild(child) { this.children.push(child); }
	destroy() { this.children.forEach(child => child.destroy()); }
}
class Graphics extends Container {
	constructor() { super(); built.push(this); this.line = { reset() {} }; }
	lineStyle() {}
	beginTextureFill(fill) { this.fill = fill; }
	drawRect() {}
	endFill() {}
}
const entry = id => ({ id, layerId: null, data: {
	name: id, shape: { type: 'r', width: 40, height: 20, points: [], radius: null },
	x: 10, y: 20, elevation: 0, levels: ['ground'], sort: 1, rotation: 0, bezierFactor: 0,
	fillType: 1, fillColor: '#123456', fillAlpha: 0.5, strokeWidth: 4, strokeColor: '#abcdef', strokeAlpha: 1,
	texture: null, text: '', fontFamily: 'Signika', fontSize: 48, textColor: '#ffffff', textAlpha: 1,
	hidden: false, locked: false, interface: false, flags: {},
} });
const stack = ['b', 'a'].map(id => ({ id, kind: 'drawing', cacheable: true, editing: false, depth: false,
	interface: false, elevation: 0, sortLayer: 600, sort: 1, zIndex: 0 }));
const options = { width: 64, height: 64, resolution: 1, maxBytes: 32768, reserveBytes: 16384, maxAxis: 4096 };
const context = { scene: 'scene', level: 'ground', assets: '1', renderer: '14.365:7.4.3',
	nativeHidden: true, x: 0, y: 0, scale: 1 };
beforeEach(() => {
	renders = allocations = destroyed = 0;
	built = [];
	globalThis.game = { version: '14.365', i18n: { localize: key => key } };
	globalThis.getDocumentClass = () => ({ metadata: { schemaVersion: '14.355' } });
	globalThis.foundry = { canvas: { containers: {} } };
	globalThis.PIXI = { Container, Graphics, SCALE_MODES: { NEAREST: 0 },
		RenderTexture: { create() { allocations++; return { destroy() { destroyed++; } }; } } };
});
const create = () => {
	const budget = new DrawingCacheBudget(32768);
	const cache = new DrawingArtworkCache({ budget, renderer: { render() { renders++; } } });
	const artwork = new Map(['a', 'b'].map(id => [id, entry(id)]));
	return { cache, artwork, budget };
};

test('derived artwork fingerprints reuse unchanged textures and rebuild for source/context changes', async () => {
	const { cache, artwork, budget } = create();
	artwork.get('a').data.fillColor = '#ff0000';
	artwork.get('b').data.fillColor = '#0000ff';
	const first = await cache.prepare(stack, artwork, options, context);
	assert.deepEqual(built.map(g => g.fill.color), ['#0000ff', '#ff0000']);
	assert.equal(renders, 1);
	assert.equal(allocations, 1);
	assert.equal(cache.use(first.sourceKey, entries => entries.length), 1);
	const reused = await cache.prepare(stack, artwork, options, context);
	assert.equal(reused.reused, true);
	assert.equal(renders, 1);
	artwork.get('a').data.fillAlpha = 0.25;
	const changed = await cache.prepare(stack, artwork, options, context);
	assert.notEqual(changed.sourceKey, first.sourceKey);
	assert.equal(destroyed, 1);
	assert.equal(renders, 2);
	const zoomed = await cache.prepare(stack, artwork, options, { ...context, scale: 2 });
	assert.notEqual(zoomed.sourceKey, changed.sourceKey);
	cache.destroy();
	cache.destroy();
	assert.equal(budget.stats.reservedBytes, 0);
});

test('borrowed texture updates invalidate fingerprints without destroying caller assets', async () => {
	const { cache, artwork } = create();
	artwork.get('a').data.fillType = 2;
	artwork.get('a').data.texture = 'assets/reference.png';
	let assetDestroy = 0;
	const texture = { valid: true, width: 32, height: 32,
		baseTexture: { uid: 10, _updateID: 1 }, destroy() { assetDestroy++; } };
	const textures = new Map([['assets/reference.png', texture]]);
	const first = await cache.prepare(stack, artwork, options, context, textures);
	texture.baseTexture._updateID++;
	const next = await cache.prepare(stack, artwork, options, context, textures);
	assert.notEqual(first.sourceKey, next.sourceKey);
	cache.destroy();
	assert.equal(assetDestroy, 0);
});

test('same-base texture frame changes rebuild without changing dimensions or destroying borrowed textures', async () => {
	const { cache, artwork } = create();
	artwork.get('a').data.fillType = 2;
	artwork.get('a').data.texture = 'atlas.webp';
	const texture = { valid: true, width: 32, height: 32, _updateID: 1,
		frame: { x: 0, y: 0, width: 32, height: 32 }, baseTexture: { uid: 1, _updateID: 1 } };
	const textures = new Map([['atlas.webp', texture]]);
	const first = await cache.prepare(stack, artwork, options, context, textures);
	texture.frame.x = 32;
	texture._updateID++;
	const second = await cache.prepare(stack, artwork, options, context, textures);
	assert.notEqual(first.sourceKey, second.sourceKey);
	assert.equal(renders, 2);
	cache.destroy();
});

test('texture-view changes during digest and malformed frames fail before cache publication', async () => {
	const { cache, artwork, budget } = create();
	artwork.get('a').data.fillType = 2;
	artwork.get('a').data.texture = 'atlas.webp';
	const texture = { valid: true, width: 32, height: 32, _updateID: 1,
		frame: { x: 0, y: 0, width: 32, height: 32 }, baseTexture: { uid: 1, _updateID: 1 } };
	const textures = new Map([['atlas.webp', texture]]);
	const pending = cache.prepare(stack, artwork, options, context, textures);
	texture.frame.x++;
	await assert.rejects(pending, /changed during/);
	assert.equal(cache.stats.ready, false);
	assert.equal(budget.stats.reservedBytes, 0);
	texture.frame.width = NaN;
	await assert.rejects(cache.prepare(stack, artwork, options, context, textures), /rectangle is invalid/);
	cache.destroy();
});

test('missing artwork and mismatched native modes fail closed', async () => {
	const { cache, artwork, budget } = create();
	await cache.prepare(stack, artwork, options, context);
	artwork.delete('a');
	await assert.rejects(cache.prepare(stack, artwork, options, context), /Missing cache artwork/);
	assert.equal(budget.stats.reservedBytes, 0);
	artwork.set('a', entry('a'));
	artwork.get('a').data.elevation = 1;
	await assert.rejects(cache.prepare(stack, artwork, options, context), /MixedOrder|disagree/);
	assert.equal(cache.stats.ready, false);
	cache.destroy();
});

test('text refusal and editing fallback release resources without changing input artwork', async () => {
	const { cache, artwork, budget } = create();
	await cache.prepare(stack, artwork, options, context);
	artwork.get('a').data.text = 'not admitted';
	await assert.rejects(cache.prepare(stack, artwork, options, context), /Text cache/);
	assert.equal(budget.stats.reservedBytes, 0);
	artwork.get('a').data.text = '';
	const result = await cache.prepare(stack.map(e => ({ ...e, editing: true })), artwork, options, context);
	assert.equal(result.reason, 'editing');
	assert.equal(artwork.get('a').data.fillAlpha, 0.5);
	cache.destroy();
});

test('concurrent preparation and invalidation are refused while hashing', async () => {
	const { cache, artwork } = create();
	const pending = cache.prepare(stack, artwork, options, context);
	assert.throws(() => cache.invalidate(), /progress/);
	await assert.rejects(cache.prepare(stack, artwork, options, context), /progress/);
	await pending;
	cache.invalidate();
	assert.equal(cache.stats.ready, false);
	cache.destroy();
});

test('serialized host rejects mid-digest source changes with the real derived adapter and releases its budget', async () => {
	const { cache, artwork, budget } = create();
	let captured, captures = 0;
	const firstCapture = new Promise(resolve => { captured = resolve; });
	const host = new DrawingCacheHost({ adapter: cache, capture: () => {
		captures++;
		captured();
		return { stack, artwork, options, context };
	} });
	const pending = host.prepare();
	await firstCapture;
	assert.equal(cache.stats.preparing, true);
	artwork.get('a').data.fillAlpha = 0.2;
	const invalidation = host.invalidate();
	assert.throws(() => host.use(() => {}), /current frame/);
	await pending;
	await invalidation;
	assert.equal(captures, 2);
	assert.equal(host.use(entries => entries.length), 1);
	assert.equal(allocations, 2);
	assert.equal(destroyed, 1);
	await host.destroy();
	assert.equal(budget.stats.reservedBytes, 0);
	assert.equal(destroyed, 2);
});
