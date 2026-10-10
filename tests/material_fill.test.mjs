import { test } from 'node:test';
import assert from 'node:assert/strict';
import { materialFillStyle, materialCreationPatch, validateMaterialRepeat } from '../scripts/material_fill.js';

test('repeat width uses grid units at creation and retains rectangular texture aspect ratio', () => {
	globalThis.PIXI = { Matrix: class { scale(x, y) { this.x = x; this.y = y; return this; } } };
	const patch = materialCreationPatch({ materialRepeat: 2, fillType: 2, texture: 'wood.png' }, { grid: { size: 100, type: 1 } });
	assert.deepEqual(patch, { fillType: 2, texture: 'wood.png', 'flags.foundryshop.materialRepeat': 200 });
	const data = { fillType: 2, texture: 'wood.png', flags: { foundryshop: { materialRepeat: 200 } } };
	const style = materialFillStyle(data, { valid: true, width: 400, height: 200 }, { alpha: 0.6, color: '#abcdef' });
	assert.equal(style.matrix.x, 0.5); assert.equal(style.matrix.y, 0.5);
	assert.equal(style.alpha, 0.6);
	assert.equal(materialCreationPatch({ materialRepeat: 2, fillType: 2, texture: 'wood.png' },
		{ grid: { size: 300, type: 0 } })['flags.foundryshop.materialRepeat'], 200);
	assert.equal(materialCreationPatch({ materialRepeat: 2, fillType: 2, texture: 'wood.png' },
		{ grid: { size: 300, type: 1 } })['flags.foundryshop.materialRepeat'], 600);
});

test('ordinary patterns and fitted image stamps remain untouched and invalid metadata fails explicitly', () => {
	const style = { alpha: 1 };
	assert.equal(materialFillStyle({ fillType: 2, texture: 'stone.png', flags: {} }, {}, style), style);
	assert.equal(materialFillStyle({ fillType: 2, texture: 'stone.png',
		flags: { foundryshop: { imageStamp: 1, materialRepeat: 100 } } }, {}, style), style);
	assert.deepEqual(materialCreationPatch({ materialRepeat: 1, fillType: 1, texture: null }, {}), { fillType: 1, texture: null });
	for (const size of [0, -1, NaN, Infinity, '1', 10000001]) assert.throws(() => validateMaterialRepeat(size), /Invalid/);
	for (const size of [0.01, 101]) assert.throws(() => validateMaterialRepeat(size, { squares: true }), /Invalid/);
	assert.throws(() => materialFillStyle({ fillType: 2, texture: 'stone.png', flags: { foundryshop: { materialRepeat: 100 } } }, {}, style), /unavailable/);
});
