import test from 'node:test';
import assert from 'node:assert/strict';
import { admitDrawingCacheStack, DrawingCacheBudget, capturePrimaryDrawingCacheStack } from '../scripts/render_cache_admission.js';

const entry = (id, extra = {}) => ({ id, kind: 'drawing', cacheable: true, editing: false,
	depth: false, interface: false, elevation: 0, sortLayer: 600, sort: 0, zIndex: 0, ...extra });
const options = { width: 256, height: 256, resolution: 1, maxBytes: 786432, maxAxis: 4096, reserveBytes: 262144 };
const stack = [entry('a'), entry('b'), entry('tile', { kind: 'tile' }), entry('c'), entry('d')];

test('aggregate admission counts every ordered run plus reserved output and scratch', () => {
	let result = admitDrawingCacheStack(stack, options);
	assert.equal(result.strategy, 'candidate');
	assert.equal(result.runs.length, 2);
	assert.equal(result.totalBytes, 786432);
	assert.equal(admitDrawingCacheStack(stack, { ...options, scratchBytes: 1 }).reason, 'aggregate-memory');
	result = admitDrawingCacheStack(stack, { ...options, resolution: 2 });
	assert.equal(result.reason, 'aggregate-memory');
	assert.equal(result.perRunBytes, 1048576);
	assert.equal(admitDrawingCacheStack(stack, { ...options, maxAxis: 255 }).reason, 'gpu-axis');
});

test('editing, interface and mixed elevation reject before any allocation', () => {
	for (const [extra, reason] of [
		[{ editing: true }, 'editing'], [{ interface: true }, 'interface-unverified'],
		[{ elevation: 1 }, 'mixed-elevation-unverified'],
	]) {
		const modified = stack.map((e, i) => i >= 3 ? { ...e, ...extra } : e);
		assert.equal(admitDrawingCacheStack(modified, options).reason, reason);
	}
	assert.equal(admitDrawingCacheStack([entry('single')], options).reason, 'no-compatible-runs');
	assert.throws(() => admitDrawingCacheStack(stack, { ...options, width: Number.MAX_SAFE_INTEGER }), RangeError);
});

test('native infinite-sort barriers remain barriers and NaN remains an explicit error', () => {
	const sorted = [entry('background', { kind: 'barrier', elevation: -Infinity, sort: -Infinity }),
		...stack, entry('overhead', { kind: 'barrier', elevation: Infinity })];
	assert.equal(admitDrawingCacheStack(sorted, options).strategy, 'candidate');
	assert.throws(() => admitDrawingCacheStack([entry('bad', { kind: 'barrier', elevation: NaN })], options));
});

test('reservations enforce exact aggregate limits and cannot be double-released or forged', () => {
	const budget = new DrawingCacheBudget(100);
	const first = budget.reserve(60), second = budget.reserve(40);
	assert.deepEqual(budget.stats, { limitBytes: 100, reservedBytes: 100, reservations: 2 });
	assert.throws(() => budget.reserve(1), /exhausted/);
	assert.throws(() => budget.release({}), /Unknown/);
	budget.release(first);
	assert.throws(() => budget.release(first), /released/);
	const third = budget.reserve(60);
	budget.release(second);
	budget.release(third);
	assert.equal(budget.stats.reservedBytes, 0);
	assert.throws(() => budget.reserve(NaN), RangeError);
});

test('read-only primary capture excludes custom shapes/effects and defers dirty sorting', () => {
	class Graphics {}
	class CustomGraphics extends Graphics {}
	const primary = { children: [], sortDirty: false };
	for (const Type of [Graphics, Graphics, CustomGraphics]) {
		const shape = new Type();
		shape.parent = primary;
		shape.children = [];
		shape.object = { document: { documentName: 'Drawing', interface: false }, shape };
		primary.children.push(shape);
	}
	primary.children[1].children = [{ filters: [{}] }];
	primary.children[0].object.controlled = true;
	const stack = capturePrimaryDrawingCacheStack(primary, Graphics);
	assert.equal(stack[0].editing, true);
	assert.equal(stack[1].cacheable, false);
	assert.equal(stack[2].kind, 'barrier');
	const unowned = new Graphics();
	unowned.children = [];
	unowned.parent = primary;
	primary.children.push(unowned);
	assert.equal(capturePrimaryDrawingCacheStack(primary, Graphics).at(-1).editing, false);
	assert.ok(primary.children.every(shape => shape.parent === primary));
	primary.sortDirty = true;
	assert.throws(() => capturePrimaryDrawingCacheStack(primary, Graphics), /not sorted/);
	assert.throws(() => admitDrawingCacheStack([entry('a', { sort: 2 }), entry('b')], options), /native-sorted/);
});
