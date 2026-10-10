import test from 'node:test';
import assert from 'node:assert/strict';
import { planDrawingCacheRuns, withDetachedDrawingRuns } from '../tools/drawing-cache-runs.mjs';

const entry = (id, extra = {}) => ({ id, kind: 'drawing', cacheable: true, editing: false, depth: false,
	elevation: 0, sortLayer: 600, sort: 0, zIndex: 0, interface: false, ...extra });

test('runs retain complete-stack barriers and compatibility boundaries', () => {
	const stack = [entry('a'), entry('b'), entry('tile', { kind: 'tile' }), entry('c'), entry('d'),
		entry('edit', { editing: true }), entry('e'), entry('f', { elevation: 1 }),
		entry('g', { elevation: 1 }), entry('interface', { interface: true }),
		entry('depth', { depth: true }), entry('unsupported', { cacheable: false })];
	assert.deepEqual(planDrawingCacheRuns(stack).map(run => [run.start, run.ids]),
		[[0, ['a', 'b']], [3, ['c', 'd']], [7, ['f', 'g']]]);
	assert.throws(() => planDrawingCacheRuns(stack, { maxRuns: 2 }), /limit exceeded/);
	assert.throws(() => planDrawingCacheRuns([entry('a'), entry('a')]), /unique IDs/);
});

function fixture() {
	const root = {
		children: ['a', 'b', 'barrier', 'c', 'd'].map(name => ({ name, renderable: name !== 'b' })),
		addChildAt(child, i) { this.children.splice(i, 0, child); child.parent = this; },
		removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; },
		sortChildren() {},
	};
	for (const child of root.children) child.parent = root;
	const runs = planDrawingCacheRuns(root.children.map(c => entry(c.name, { kind: c.name === 'barrier' ? 'tile' : 'drawing' })));
	return { root, runs, replacements: [{}, {}] };
}

test('temporary replacements preserve source parents, restore disabled state and remove replacements on errors', () => {
	const { root, runs, replacements } = fixture();
	const sources = [...root.children], states = sources.map(c => c.renderable);
	assert.throws(() => withDetachedDrawingRuns(root, runs, replacements, () => {
		assert.deepEqual(root.children.map(c => c.name ?? 'cache'), ['cache', 'a', 'b', 'barrier', 'cache', 'c', 'd']);
		assert.ok(sources.every(source => source.parent === root));
		assert.equal(sources[2].renderable, true);
		assert.ok(sources.filter((_, i) => i !== 2).every(source => !source.renderable));
		throw new Error('GPU failure');
	}), /GPU failure/);
	assert.deepEqual(root.children, sources);
	assert.deepEqual(sources.map(c => c.renderable), states);
	assert.ok(replacements.every(r => !r.parent));
});

test('live and stale/overlapping replacement requests fail before suppression', () => {
	const { root, runs, replacements } = fixture();
	root.inPrimary = true;
	assert.throws(() => withDetachedDrawingRuns(root, runs, replacements, () => {}), /detached/);
	root.inPrimary = false;
	assert.throws(() => withDetachedDrawingRuns(root, [runs[0], runs[0]], replacements, () => {}), /overlapping/);
	root.children.reverse();
	assert.throws(() => withDetachedDrawingRuns(root, runs, replacements, () => {}), /stale/);
});

test('unsupported interface/elevation, reentrancy and insertion failure restore fixtures', () => {
	const { root, runs, replacements } = fixture();
	assert.throws(() => withDetachedDrawingRuns(root, [{ ...runs[0], interface: true }], [{}], () => {}), /Invalid/);
	assert.throws(() => withDetachedDrawingRuns(root, [{ ...runs[0], elevation: 1 }], [{}], () => {}), /Invalid/);
	assert.throws(() => withDetachedDrawingRuns(root, runs, replacements, () =>
		withDetachedDrawingRuns(root, runs, replacements, () => {})), /reenter/);
	const originals = [...root.children];
	const insert = root.addChildAt;
	root.addChildAt = function(child, index) {
		insert.call(this, child, index);
		throw new Error('Native added event failed');
	};
	assert.throws(() => withDetachedDrawingRuns(root, runs, replacements, () => {}), /added event/);
	assert.deepEqual(root.children, originals);
	assert.ok(replacements.every(r => !r.parent));
});
