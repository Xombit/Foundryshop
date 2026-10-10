import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSurfaceBudget, runDrawingRenderProbe } from '../tools/drawing-render-probe.mjs';

test('surface budgets include physical resolution and every explicit RGBA target', () => {
	assert.deepEqual(renderSurfaceBudget(512, 512, 1), {
		physicalWidth: 512, physicalHeight: 512, surfaces: 2, bytes: 2097152,
	});
	assert.equal(renderSurfaceBudget(1485, 787, 2, 2).bytes, 37398240);
	assert.equal(renderSurfaceBudget(8000, 6000, 1, 2).bytes, 384000000);
	assert.deepEqual(renderSurfaceBudget(65, 67, 1.5, 1), {
		physicalWidth: 98, physicalHeight: 101, surfaces: 1, bytes: 39592,
	});
});

test('surface budgets refuse invalid dimensions and unsafe arithmetic', () => {
	for (const args of [[0, 1, 1], [1.5, 1, 1], [1, 1, NaN], [1, 1, 0], [1, 1, 1, 0],
		[Number.MAX_SAFE_INTEGER, 2, 1]]) {
		assert.throws(() => renderSurfaceBudget(...args), RangeError);
	}
});

test('detached probes refuse excessive work before touching the renderer', async () => {
	for (const options of [{ width: 8192 }, { counts: [1001] }, { rounds: 100 }, { frames: 100 }]) {
		await assert.rejects(runDrawingRenderProbe({ PIXI: {}, renderer: {}, ...options }), RangeError);
	}
});

test('partial render-target allocation is disposed when the next allocation fails', async () => {
	let allocations = 0, disposed = 0;
	const PIXI = {
		RenderTexture: { create() {
			if (++allocations === 2) throw new Error('GPU allocation failed.');
			return { destroy(destroyBase) { assert.equal(destroyBase, true); disposed++; } };
		} },
		MSAA_QUALITY: { NONE: 0 }, SCALE_MODES: { NEAREST: 0 },
	};
	await assert.rejects(runDrawingRenderProbe({ PIXI, renderer: {} }), /GPU allocation failed/);
	assert.equal(allocations, 2);
	assert.equal(disposed, 1);
});
