import test from 'node:test';
import assert from 'node:assert/strict';
import { runDrawingOrderedReplayProbe } from '../tools/drawing-ordered-replay-probe.mjs';
import { compareRenderPixels } from '../tools/drawing-render-probe.mjs';

function fixture() {
	const targets = [], objects = [];
	const point = () => ({ x: 0, y: 0, set(x, y = x) { this.x = x; this.y = y; } });
	class Container {
		constructor() {
			this.children = [];
			this.position = point();
			this.scale = point();
			this.pivot = point();
			this.renderable = true;
			this.alpha = 1;
			this.elevation = this.sortLayer = this.sort = this.zIndex = 0;
			objects.push(this);
		}
		get x() { return this.position.x; }
		get y() { return this.position.y; }
		addChild(child) { return this.addChildAt(child, this.children.length); }
		addChildAt(child, index) { this.children.splice(index, 0, child); child.parent = this; return child; }
		removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; }
		sortChildren() { this.children.sort((a, b) => a.sortLayer - b.sortLayer || a.sort - b.sort || a.zIndex - b.zIndex); }
		destroy({ children = false } = {}) {
			if (children) for (const child of [...this.children]) child.destroy();
			this.parent?.removeChild(this);
			this.destroyed = true;
		}
	}
	class Graphics extends Container {
		constructor() { super(); this.line = { reset() {} }; }
		lineStyle() { return this; }
		beginFill() { return this; }
		beginTextureFill() { return this; }
		drawRect() { return this; }
		endFill() { return this; }
	}
	class Sprite extends Container { constructor(texture) { super(); this.texture = texture; } }
	class Text extends Container {}
	class ColorMatrixFilter {
		brightness() {}
		saturate() {}
		destroy() { this.destroyed = true; }
	}
	const PIXI = { Container, Graphics, Sprite, filters: { ColorMatrixFilter }, BLEND_MODES: { MULTIPLY: 2 },
		ALPHA_MODES: { NPM: 0 }, SCALE_MODES: { NEAREST: 0 },
		RenderTexture: { create() {
			const texture = { baseTexture: { alphaMode: 1 }, destroy() { this.destroyed = true; } };
			targets.push(texture);
			return texture;
		} } };
	globalThis.PIXI = PIXI;
	globalThis.game = { version: '14.365', i18n: { localize: key => key } };
	globalThis.getDocumentClass = () => ({ metadata: { schemaVersion: '14.355' } });
	globalThis.foundry = { canvas: { containers: {} } };
	const renderer = { render() {}, extract: { pixels: () => new Uint8Array(4) } };
	return { input: { PIXI, renderer, GraphicsClass: Graphics, ContainerClass: Container, TextClass: Text },
		targets, objects, renderer };
}

test('ordered fixture exercises three runs, barriers, editing fallback and releases owned resources', async () => {
	const f = fixture();
	const result = await runDrawingOrderedReplayProbe(f.input);
	assert.equal(result.results.length, 7);
	for (const sample of result.results.slice(0, 6)) {
		assert.deepEqual(sample.runs, [['a', 'b'], ['c', 'd'], ['e', 'f']]);
		assert.equal(sample.restored, true);
		assert.equal(sample.failureRestored, true);
	}
	assert.equal(result.results.at(-1).strategy, 'native');
	assert.equal(result.results.at(-1).reason, 'editing');
	assert.equal(result.reservedBytesAfterTeardown, 0);
	assert.ok(f.targets.every(t => t.destroyed));
	assert.ok(f.objects.every(o => o.destroyed));
});

test('pixel extraction failure restores alpha mode and disposes fixture allocations', async () => {
	const f = fixture();
	f.renderer.extract.pixels = texture => {
		if (texture.baseTexture.alphaMode === 0) throw new Error('readback');
		return new Uint8Array(4);
	};
	await assert.rejects(runDrawingOrderedReplayProbe(f.input), /readback/);
	assert.ok(f.targets.every(t => t.baseTexture.alphaMode === 1 && t.destroyed));
	assert.ok(f.objects.every(o => o.destroyed));
});

test('ordered probe limits reject before allocating', async () => {
	const f = fixture();
	await assert.rejects(runDrawingOrderedReplayProbe({ ...f.input, resolution: 4 }), RangeError);
	assert.equal(f.targets.length, 0);
	assert.equal(f.objects.length, 0);
});

test('shared pixel comparison preserves the one-channel threshold without hiding larger errors', () => {
	const actual = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
	const expected = new Uint8Array([11, 21, 31, 41, 52, 60, 70, 80]);
	assert.deepEqual(compareRenderPixels(actual, expected), { changedPixels: 1, maxChannelError: 2, meanChannelError: 0.75 });
	assert.throws(() => compareRenderPixels(actual, new Uint8Array(4)), /dimensions/);
});
