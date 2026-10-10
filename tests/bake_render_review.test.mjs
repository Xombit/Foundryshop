import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewBakeBounds } from '../scripts/bake_render_review.js';

test('automatic crop encloses negative/fractional rendered bounds at full integer resolution', () => {
	const result = reviewBakeBounds([
		{ id: 'text', bounds: { x: -10.5, y: 2.2, width: 30.8, height: 10 } },
		{ id: 'rotated', bounds: { x: 15, y: -3.7, width: 10, height: 20 } },
	]);
	assert.deepEqual(result.bounds, { x: -11, y: -4, width: 36, height: 21 });
	assert.deepEqual(result.croppedSourceIds, []);
	assert.equal(result.outputRgbaBytes, 36 * 21 * 4);
});

test('custom crop lists partly clipped and completely outside identities exactly', () => {
	const result = reviewBakeBounds([
		{ id: 'inside', bounds: { x: 0, y: 0, width: 10, height: 10 } },
		{ id: 'part', bounds: { x: 8, y: 0, width: 10, height: 10 } },
		{ id: 'outside', bounds: { x: 100, y: 0, width: 10, height: 10 } },
	], { x: 0, y: 0, width: 10, height: 10 });
	assert.deepEqual(result.croppedSourceIds, ['outside', 'part']);
	assert.deepEqual(result.fullyOutsideSourceIds, ['outside']);
});

test('48MP and long axes have no publication budgets and supplied crop is detached', () => {
	const bounds = { x: 0, y: 0, width: 20000, height: 1000 };
	const result = reviewBakeBounds([{ id: 'ink', bounds }], bounds);
	bounds.width = 1;
	assert.equal(result.width, 20000);
	assert.equal(reviewBakeBounds([{ id: 'ink', bounds: { x: 0, y: 0, width: 8000, height: 6000 } }]).outputRgbaBytes, 192000000);
});

test('invalid/duplicate sources and fractional or empty output dimensions refuse', () => {
	for (const entries of [[], [{ id: 'bad', bounds: { x: NaN, y: 0, width: 10, height: 10 } }],
		Array(2).fill({ id: 'same', bounds: { x: 0, y: 0, width: 10, height: 10 } })]) {
		assert.throws(() => reviewBakeBounds(entries), /unique sources/);
	}
	assert.throws(() => reviewBakeBounds([{ id: 'ink', bounds: { x: 0, y: 0, width: 0, height: 0 } }]), /integer/);
	assert.throws(() => reviewBakeBounds([{ id: 'ink', bounds: { x: 0, y: 0, width: 9.5, height: 10 } }],
		{ x: 0, y: 0, width: 9.5, height: 10 }), /integer/);
});
