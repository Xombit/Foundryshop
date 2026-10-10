import test from 'node:test';
import assert from 'node:assert/strict';
import { planDrawingRegions } from '../tools/drawing-region-cache.mjs';
import { rebuildCoalescedDrawingRegions, copyDrawingScratchTile } from '../tools/drawing-coalesced-rebuild.mjs';

const plan = planDrawingRegions({ width: 256, height: 256, tileSize: 64, reserveBytes: 262144 });
const budget = { maxBytes: 786432 };
const ids = plan.tiles.map(t => t.id);

test('coalesced rendering copies exact constituent tiles with one sequential scratch allocation', () => {
	const calls = [], result = rebuildCoalescedDrawingRegions(plan, ids, budget, {
		allocate: region => { calls.push('allocate'); return { region }; },
		render: () => calls.push('render'),
		copy: (resource, region, tile) => calls.push(tile.id),
		dispose: () => calls.push('dispose'),
	});
	assert.equal(result.copiedTiles, 16);
	assert.deepEqual(calls, ['allocate', 'render', ...ids, 'dispose']);
});

test('memory fallback does not allocate; failed copy disposes scratch and refuses success', () => {
	let allocated = 0, disposed = 0;
	const callbacks = {
		allocate: () => { allocated++; return {}; }, render: () => {},
		copy: () => { throw new Error('GPU copy failed'); }, dispose: () => { disposed++; },
	};
	assert.equal(rebuildCoalescedDrawingRegions(plan, ids, { maxBytes: 524288 }, callbacks).strategy, 'tiles');
	assert.equal(allocated, 0);
	assert.throws(() => rebuildCoalescedDrawingRegions(plan, ids, budget, callbacks), /GPU copy failed/);
	assert.equal(allocated, 1);
	assert.equal(disposed, 1);
});

test('copy views dispose wrappers but never destroy the shared scratch base', () => {
	const destroyed = [];
	const PIXI = {
		Rectangle: class { constructor(...args) { this.args = args; } },
		Texture: class {
			constructor(base, frame) { assert.equal(base.width, 128); assert.deepEqual(frame.args, [64, 0, 64, 64]); }
			destroy(base) { destroyed.push(base); }
		},
		Sprite: class { destroy() { destroyed.push('sprite'); } },
	};
	assert.throws(() => copyDrawingScratchTile(PIXI, { render() { throw new Error('Render failed'); } },
		{ baseTexture: { width: 128, height: 64, resolution: 1 } }, { x: 0, y: 0 }, {},
		{ x: 64, y: 0, width: 64, height: 64 }), /Render failed/);
	assert.deepEqual(destroyed, ['sprite', false]);
});

test('render and cleanup failures both remain visible', () => {
	assert.throws(() => rebuildCoalescedDrawingRegions(plan, ids, budget, {
		allocate: () => ({}), render: () => { throw new Error('Render failed'); },
		copy: () => {}, dispose: () => { throw new Error('Dispose failed'); },
	}), error => error instanceof AggregateError
		&& error.errors.map(e => e.message).join(',') === 'Render failed,Dispose failed');
});

test('fractional copy edges never overflow shared texture dimensions', () => {
	const base = { width: 128 / 1.5, height: 128 / 1.5, resolution: 1.5 };
	let frame;
	const PIXI = {
		Rectangle: class { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } },
		Texture: class { constructor(b, f) { frame = f; } destroy() {} },
		Sprite: class { destroy() {} },
	};
	copyDrawingScratchTile(PIXI, { render() {} }, { baseTexture: base },
		{ x: 64 / 1.5, y: 64 / 1.5 }, {},
		{ x: 64 / 1.5, y: 128 / 1.5, width: 64 / 1.5, height: 64 / 1.5 });
	assert.ok(frame.y + frame.height <= base.height);
	assert.equal(Math.round(frame.height * 1.5), 64);
	assert.throws(() => copyDrawingScratchTile(PIXI, { render() {} }, { baseTexture: base },
		{ x: 0, y: 0 }, {}, { x: 0, y: 0, width: 500, height: 10 }), RangeError);
});
