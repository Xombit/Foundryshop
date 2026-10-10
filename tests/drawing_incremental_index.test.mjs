import test from 'node:test';
import assert from 'node:assert/strict';
import { IncrementalDrawingIndex, indexDrawingCandidates } from '../tools/drawing-spatial-index.mjs';
import { planDrawingRegions, coalesceDrawingRegions } from '../tools/drawing-region-cache.mjs';

const options = { width: 257, height: 193, resolution: 1.5, tileSize: 64 };
const record = (id, x, y, width = 20, height = 20) => ({ id, bounds: { x, y, width, height } });

test('incremental moves match fresh ordered snapshots through 100 randomized batches', () => {
	let seed = 404;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 0x100000000;
	};
	const records = Array.from({ length: 50 }, (_, i) => record(String(i), random() * 300, random() * 200));
	const index = new IncrementalDrawingIndex(records, options);
	for (let step = 0; step < 100; step++) {
		const i = step % records.length;
		const before = new Map(index.plan.tiles.map(tile => [tile.id, index.query(tile.id)]));
		records[i] = record(String(i), random() * 400 - 100, random() * 300 - 100, random() * 80, random() * 80);
		const dirty = new Set(index.updateBounds([records[i]]));
		const fresh = indexDrawingCandidates(records, options);
		assert.equal(index.references, fresh.references);
		for (const tile of index.plan.tiles) {
			assert.deepEqual(index.query(tile.id), fresh.query(tile.id));
			if (!dirty.has(tile.id)) assert.equal(index.query(tile.id), before.get(tile.id));
		}
	}
});

test('old and new memberships remain dirty even when membership itself did not change', () => {
	const index = new IncrementalDrawingIndex([record('a', 2, 2)], { width: 128, height: 128, tileSize: 64 });
	assert.deepEqual(index.updateBounds([record('a', 5, 5)]), ['0:0']);
	assert.deepEqual(index.updateBounds([record('a', 90, 90)]), ['0:0', '64:64']);
	assert.deepEqual(index.query('0:0'), []);
	assert.deepEqual(index.query('64:64'), ['a']);
});

test('invalid or over-capacity batches are atomic', () => {
	const small = { width: 128, height: 128, tileSize: 64 };
	const index = new IncrementalDrawingIndex([record('a', 5, 5)], small, { maxReferences: 1 });
	for (const updates of [[record('a', 5, 5), record('missing', 2, 2)],
		[record('a', 5, 5), record('a', 2, 2)], [record('a', NaN, 0)], [record('a', 0, 0, 128, 128)]]) {
		assert.throws(() => index.updateBounds(updates));
		assert.deepEqual(index.query('0:0'), ['a']);
		assert.equal(index.references, 1);
	}
	assert.deepEqual(index.updateBounds([]), []);
});

test('batched moves retain authoritative order and apply final capacity atomically', () => {
	const small = { width: 128, height: 128, tileSize: 64 };
	const index = new IncrementalDrawingIndex([record('a', 5, 5), record('b', 90, 90)], small,
		{ maxReferences: 2 });
	index.updateBounds([record('b', 5, 5), record('a', 5, 5)]);
	assert.deepEqual(index.query('0:0'), ['a', 'b']);
	assert.deepEqual(index.query('64:64'), []);
	index.updateBounds([record('a', -100, -100), record('b', 50, 5)]);
	assert.deepEqual(index.query('0:0'), ['b']);
	assert.deepEqual(index.query('64:0'), ['b']);
	assert.equal(index.references, 2);
});

test('coalescing merges rectangles without including clean tiles at fractional edges', () => {
	const plan = planDrawingRegions(options);
	for (const ids of [plan.tiles.map(t => t.id), plan.tiles.filter((t, i) => i % 3 !== 0).map(t => t.id),
		[plan.tiles[0].id], []]) {
		const regions = coalesceDrawingRegions(plan, ids);
		const selected = plan.tiles.filter(tile => ids.includes(tile.id));
		assert.equal(regions.reduce((sum, r) => sum + r.physicalWidth * r.physicalHeight, 0),
			selected.reduce((sum, t) => sum + t.physicalWidth * t.physicalHeight, 0));
		for (const tile of plan.tiles) {
			const covered = regions.filter(r => tile.x >= r.x && tile.y >= r.y
				&& tile.x + tile.width <= r.x + r.width + 1e-10
				&& tile.y + tile.height <= r.y + r.height + 1e-10);
			assert.equal(covered.length, ids.includes(tile.id) ? 1 : 0);
		}
	}
	assert.equal(coalesceDrawingRegions(plan, plan.tiles.map(t => t.id)).length, 1);
	assert.throws(() => coalesceDrawingRegions(plan, ['missing']));
	assert.throws(() => coalesceDrawingRegions(plan, [plan.tiles[0].id, plan.tiles[0].id]));
});
