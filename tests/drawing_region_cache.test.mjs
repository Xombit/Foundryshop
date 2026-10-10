import test from 'node:test';
import assert from 'node:assert/strict';
import { DrawingRegionCache, planDrawingRegions } from '../tools/drawing-region-cache.mjs';

const options = { width: 512, height: 512 };
function fixture(extra = {}) {
	const disposed = [], rendered = [];
	const cache = new DrawingRegionCache({ ...options, ...extra }, {
		allocate: tile => ({ id: tile.id }), dispose: resource => disposed.push(resource.id),
	});
	cache.setContext('scene:level:zoom:resolution:font:asset');
	const rebuild = () => cache.rebuild((resource, tile) => rendered.push(tile.id));
	rebuild();
	rendered.length = 0;
	return { cache, disposed, rendered, rebuild };
}

test('plans exact physical coverage, including fractional resolution and edge tiles', () => {
	const plan = planDrawingRegions({ width: 65, height: 67, resolution: 1.5, tileSize: 32 });
	assert.equal(plan.bytes, 98 * 101 * 4);
	assert.equal(plan.tiles.reduce((sum, tile) => sum + tile.bytes, 0), plan.bytes);
	assert.equal(plan.tiles.at(-1).physicalWidth, 2);
	assert.equal(plan.tiles.at(-1).physicalHeight, 5);
	assert.ok(Object.isFrozen(plan.tiles[0]));
});

test('refuses over-budget work before allocating and accounts for output reserve', () => {
	for (const extra of [{ maxBytes: 1048575 }, { maxBytes: 1048576, reserveBytes: 1 },
		{ maxTiles: 15 }, { maxAxis: 127 }, { resolution: NaN }, { width: 0 }]) {
		assert.throws(() => planDrawingRegions({ ...options, ...extra }), RangeError);
	}
	assert.equal(planDrawingRegions({ ...options, maxBytes: 2097152, reserveBytes: 1048576 }).bytes, 1048576);
});

test('movement invalidates old and new regions but preserves unaffected tiles', () => {
	const { cache, rebuild, rendered } = fixture();
	cache.invalidate([{ x: 10, y: 10, width: 20, height: 20 }, { x: 300, y: 300, width: 20, height: 20 }]);
	assert.equal(cache.stats.dirtyTiles, 2);
	assert.throws(() => cache.replay(() => {}), /not ready/);
	assert.equal(rebuild(), 2);
	assert.deepEqual(rendered, ['0:0', '256:256']);
	assert.equal(cache.stats.residentBytes, 1048576);
	cache.destroy();
});

test('effect padding crosses boundaries; deletes, offscreen and invalid batches are explicit', () => {
	const { cache, rebuild } = fixture();
	cache.invalidate([{ x: 127, y: 127, width: 1, height: 1 }], 2);
	assert.equal(rebuild(), 4);
	cache.invalidate([{ x: -100, y: -100, width: 1, height: 1 }]);
	assert.equal(rebuild(), 0);
	cache.invalidate([{ x: 2, y: 2, width: 1, height: 1 }]);
	assert.equal(rebuild(), 1);
	assert.throws(() => cache.invalidate([{ x: 1, y: 1, width: 2, height: 2 }, null]), RangeError);
	assert.equal(cache.stats.dirtyTiles, 0);
	cache.destroy();
});

test('context changes invalidate everything; eviction releases every resource and admits rebuild', () => {
	const { cache, rebuild, disposed } = fixture();
	assert.equal(cache.setContext('scene:level:zoom:resolution:font:asset'), false);
	assert.equal(cache.setContext('different-zoom'), true);
	assert.equal(rebuild(), 16);
	cache.evict();
	assert.equal(disposed.length, 16);
	assert.equal(cache.stats.residentBytes, 0);
	assert.equal(cache.stats.ready, false);
	assert.equal(rebuild(), 16);
	cache.destroy();
	cache.destroy();
	assert.equal(disposed.length, 32);
	assert.throws(() => cache.rebuild(() => {}), /disposed/);
});

test('failed renders never expose a partially updated frame and can recover', () => {
	const { cache, rebuild } = fixture();
	cache.invalidateAll();
	assert.throws(() => cache.rebuild(() => { throw new Error('GPU failure'); }), /GPU failure/);
	assert.equal(cache.stats.dirtyTiles, 16);
	assert.throws(() => cache.replay(() => {}), /not ready/);
	assert.equal(rebuild(), 16);
	assert.throws(() => cache.replay(() => cache.invalidateAll()), /reenter/);
	cache.destroy();
});

test('partial allocation failure stays bounded and cleanup continues after disposal errors', () => {
	let allocated = 0, disposed = 0;
	const cache = new DrawingRegionCache(options, {
		allocate: () => { if (++allocated === 3) throw new Error('Allocation failed'); return {}; },
		dispose: () => { disposed++; throw new Error('Disposal failed'); },
	});
	cache.setContext('test');
	assert.throws(() => cache.rebuild(() => {}), /Allocation failed/);
	assert.equal(cache.stats.residentTiles, 2);
	assert.throws(() => cache.destroy(), AggregateError);
	assert.equal(disposed, 2);
	assert.equal(cache.stats.residentBytes, 0);
});

test('dirty tiles agree with exhaustive intersection at fractional resolution', () => {
	const { cache, rebuild, rendered } = fixture({ width: 257, height: 193, resolution: 1.5, tileSize: 64 });
	const plan = planDrawingRegions({ width: 257, height: 193, resolution: 1.5, tileSize: 64 });
	let seed = 404;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 0x100000000;
	};
	for (let i = 0; i < 100; i++) {
		const rect = { x: random() * 400 - 100, y: random() * 350 - 100,
			width: random() * 100, height: random() * 100 };
		const padding = random() * 10;
		cache.invalidate([rect], padding);
		rendered.length = 0;
		rebuild();
		assert.deepEqual(rendered, plan.tiles.filter(tile =>
			rect.x - padding < tile.x + tile.width && rect.x + rect.width + padding > tile.x
			&& rect.y - padding < tile.y + tile.height && rect.y + rect.height + padding > tile.y,
		).map(tile => tile.id));
	}
	cache.destroy();
});

test('cache refuses uninitialized context, invalid keys and asynchronous rendering', () => {
	const cache = new DrawingRegionCache(options, { allocate: () => ({}), dispose: () => {} });
	assert.throws(() => cache.rebuild(() => {}), /render context/);
	assert.throws(() => cache.setContext(''), /bounded/);
	cache.setContext('test');
	assert.throws(() => cache.rebuild(() => Promise.resolve()), /synchronous/);
	assert.equal(cache.stats.dirtyTiles, 16);
	cache.rebuild(() => {});
	assert.throws(() => cache.replay(() => Promise.resolve()), /synchronous/);
	cache.destroy();
});
