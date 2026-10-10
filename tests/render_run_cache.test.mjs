import test from 'node:test';
import assert from 'node:assert/strict';
import { DrawingRunCache } from '../scripts/render_run_cache.js';
import { DrawingCacheBudget } from '../scripts/render_cache_admission.js';

const entry = (id, kind = 'drawing') => ({ id, kind, cacheable: true, editing: false,
	depth: false, interface: false, elevation: 0, sortLayer: 600, sort: 0, zIndex: 0 });
const stack = [entry('a'), entry('b'), entry('barrier', 'tile'), entry('c'), entry('d')];
const options = { width: 64, height: 64, resolution: 1, maxBytes: 49152, reserveBytes: 16384, maxAxis: 4096 };

test('shared budget is reserved before allocation, unchanged resources reuse and changed keys dispose first', () => {
	const budget = new DrawingCacheBudget(49152);
	let allocations = 0, disposals = 0;
	const cache = new DrawingRunCache({ budget,
		allocate: () => { assert.equal(budget.stats.reservedBytes, 49152); allocations++; return {}; },
		dispose: () => { disposals++; },
	});
	cache.prepare(stack, options, 'source:1');
	assert.throws(() => cache.use('source:1', () => {}), /unfinished/);
	cache.rebuild(() => {});
	assert.equal(cache.use('source:1', entries => entries.length), 2);
	assert.equal(cache.prepare(stack, options, 'source:1').reused, true);
	assert.equal(cache.stats.ready, true);
	assert.equal(allocations, 2);
	cache.rebuild(() => {});
	assert.throws(() => cache.use('different', () => {}), /Stale/);
	cache.prepare(stack, options, 'source:2');
	assert.equal(disposals, 2);
	assert.equal(allocations, 4);
	cache.destroy();
	cache.destroy();
	assert.equal(budget.stats.reservedBytes, 0);
	assert.throws(() => cache.prepare(stack, options, 'source:3'), /disposed/);
});

test('failed allocation cleans partial resources and never returns ready output', () => {
	const budget = new DrawingCacheBudget(49152);
	let allocations = 0, disposed = 0;
	const cache = new DrawingRunCache({ budget,
		allocate: () => { if (++allocations === 2) throw new Error('Allocation failed'); return {}; },
		dispose: () => { disposed++; },
	});
	assert.throws(() => cache.prepare(stack, options, 'one'), /Allocation failed/);
	assert.equal(disposed, 1);
	assert.equal(budget.stats.reservedBytes, 0);
	assert.equal(cache.stats.ready, false);
	cache.destroy();
});

test('failed disposal retains ownership and budget until successful retry', () => {
	const budget = new DrawingCacheBudget(49152);
	let fail = true, disposed = 0;
	const cache = new DrawingRunCache({ budget, allocate: () => ({}),
		dispose: () => { if (fail) throw new Error('GPU disposal failed'); disposed++; },
	});
	cache.prepare(stack, options, 'one');
	assert.throws(() => cache.destroy(), AggregateError);
	assert.equal(cache.stats.destroyed, false);
	assert.equal(cache.stats.resources, 2);
	assert.equal(budget.stats.reservedBytes, 49152);
	fail = false;
	cache.destroy();
	assert.equal(disposed, 2);
	assert.equal(budget.stats.reservedBytes, 0);
});

test('render/replay failure and reentrancy block publication; editing releases existing resources', () => {
	const budget = new DrawingCacheBudget(49152);
	const cache = new DrawingRunCache({ budget, allocate: () => ({}), dispose: () => {} });
	cache.prepare(stack, options, 'one');
	assert.throws(() => cache.rebuild(() => { throw new Error('Render failed'); }), /Render failed/);
	assert.equal(cache.stats.ready, false);
	cache.rebuild(() => {});
	assert.throws(() => cache.use('one', () => cache.evict()), /reenter/);
	assert.equal(cache.stats.ready, false);
	const edited = stack.map(e => ({ ...e, editing: e.id === 'a' }));
	assert.equal(cache.prepare(edited, options, 'two').reason, 'editing');
	assert.equal(budget.stats.reservedBytes, 0);
	cache.destroy();
});

test('aggregate owners cannot overcommit and invalid preparation fails closed', () => {
	const budget = new DrawingCacheBudget(49152);
	const create = () => new DrawingRunCache({ budget, allocate: () => ({}), dispose: () => {} });
	const first = create(), second = create();
	first.prepare(stack, options, 'one');
	first.rebuild(() => {});
	assert.throws(() => second.prepare(stack, options, 'two'), /exhausted/);
	assert.throws(() => first.prepare(stack, options, ''), /fingerprint/);
	assert.equal(first.stats.ready, false);
	first.destroy();
	second.prepare(stack, options, 'two');
	second.destroy();
	assert.equal(budget.stats.reservedBytes, 0);
});

test('partial cleanup releases successful resources once and retries failed resources only', () => {
	const budget = new DrawingCacheBudget(49152);
	let count = 0, fail = true;
	const calls = [];
	const cache = new DrawingRunCache({ budget, allocate: () => ({ id: ++count }),
		dispose: resource => {
			calls.push(resource.id);
			if (resource.id === 2 && fail) throw new Error('Dispose failed');
		},
	});
	cache.prepare(stack, options, 'one');
	assert.throws(() => cache.evict(), AggregateError);
	assert.equal(cache.stats.resources, 1);
	assert.equal(budget.stats.reservedBytes, 49152);
	fail = false;
	cache.evict();
	assert.deepEqual(calls, [1, 2, 2]);
	assert.equal(budget.stats.reservedBytes, 0);
	cache.destroy();
});

test('asynchronous render/replay callbacks are refused and never publish a ready frame', () => {
	const budget = new DrawingCacheBudget(49152);
	const cache = new DrawingRunCache({ budget, allocate: () => ({}), dispose: () => {} });
	cache.prepare(stack, options, 'one');
	assert.throws(() => cache.rebuild(() => Promise.resolve()), /synchronous/);
	assert.equal(cache.stats.ready, false);
	cache.rebuild(() => {});
	assert.throws(() => cache.use('one', () => Promise.resolve()), /synchronous/);
	assert.equal(cache.stats.ready, false);
	cache.destroy();
});
