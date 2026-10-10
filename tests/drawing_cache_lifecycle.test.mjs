import test from 'node:test';
import assert from 'node:assert/strict';
import { DrawingCacheLifecycle, admitCoalescedScratch } from '../tools/drawing-cache-lifecycle.mjs';
import { planDrawingRegions } from '../tools/drawing-region-cache.mjs';

const options = { width: 256, height: 256, tileSize: 64 };
const record = (id, x = 10, signature = 'source:1', editing = false) =>
	({ id, signature, editing, bounds: { x, y: 10, width: 20, height: 20 } });
function ready() {
	const lifecycle = new DrawingCacheLifecycle(options);
	lifecycle.synchronize([record('a'), record('b', 180)], 'scene:level:zoom:1');
	lifecycle.acknowledge(lifecycle.frame().revision);
	return lifecycle;
}

test('local geometry and same-bounds style changes dirty old/new memberships', () => {
	const lifecycle = ready();
	let result = lifecycle.synchronize([record('a', 90), record('b', 180)], 'scene:level:zoom:1');
	assert.equal(result.reset, false);
	assert.deepEqual(result.dirtyTiles, ['0:0', '64:0']);
	assert.equal(lifecycle.stats.ready, false);
	lifecycle.acknowledge(lifecycle.frame().revision);
	result = lifecycle.synchronize([record('a', 90, 'alpha:0.5'), record('b', 180)], 'scene:level:zoom:1');
	assert.deepEqual(result.dirtyTiles, ['64:0']);
	assert.deepEqual(lifecycle.frame().tiles[0].candidates, ['a']);
	lifecycle.destroy();
});

test('insert/delete/order/context changes rebuild the full frame', () => {
	const lifecycle = ready();
	for (const [records, context] of [
		[[record('a'), record('b', 180), record('c', 90)], 'scene:level:zoom:1'],
		[[record('a'), record('b', 180)], 'scene:level:zoom:1'],
		[[record('b', 180), record('a')], 'scene:level:zoom:1'],
		[[record('b', 180), record('a')], 'scene:other-level:zoom:1'],
	]) {
		const result = lifecycle.synchronize(records, context);
		assert.equal(result.reset, true);
		assert.equal(result.dirtyTiles.length, 16);
		lifecycle.acknowledge(lifecycle.frame().revision);
	}
	assert.equal(lifecycle.stats.ready, true);
	lifecycle.destroy();
});

test('stale frames cannot publish, while pending dirty tiles survive multiple updates', () => {
	const lifecycle = ready();
	lifecycle.synchronize([record('a', 90), record('b', 180)], 'scene:level:zoom:1');
	assert.throws(() => lifecycle.acknowledge(lifecycle.stats.revision), /Stale/);
	const frame = lifecycle.frame();
	lifecycle.synchronize([record('a', 90), record('b', 240)], 'scene:level:zoom:1');
	assert.throws(() => lifecycle.acknowledge(frame.revision), /Stale/);
	assert.deepEqual(lifecycle.frame().tiles.map(tile => tile.id), ['0:0', '64:0', '128:0', '192:0']);
	lifecycle.acknowledge(lifecycle.frame().revision);
	const revision = lifecycle.stats.revision;
	lifecycle.synchronize([record('a', 90), record('b', 240)], 'scene:level:zoom:1');
	assert.equal(lifecycle.stats.revision, revision);
	assert.equal(lifecycle.frame().tiles.length, 0);
	lifecycle.destroy();
});

test('offscreen style changes invalidate issued revisions even with no dirty pixels', () => {
	const lifecycle = new DrawingCacheLifecycle(options);
	lifecycle.synchronize([record('offscreen', -100)], 'context');
	const old = lifecycle.frame();
	lifecycle.synchronize([record('offscreen', -100, 'style:2')], 'context');
	assert.throws(() => lifecycle.acknowledge(old.revision), /Stale/);
	lifecycle.acknowledge(lifecycle.frame().revision);
	assert.equal(lifecycle.stats.ready, true);
	lifecycle.destroy();
});

test('editing uses native fallback and redraws both entry and exit bounds', () => {
	const lifecycle = ready();
	const result = lifecycle.synchronize([record('a', 90, 'drag', true), record('b', 180)], 'scene:level:zoom:1');
	assert.equal(result.fallback, 'native-editing');
	assert.throws(() => lifecycle.frame(), /fallback/);
	assert.throws(() => lifecycle.acknowledge(result.revision), /blocked/);
	lifecycle.synchronize([record('a', 90, 'drag', false), record('b', 180)], 'scene:level:zoom:1');
	assert.deepEqual(lifecycle.frame().tiles.map(tile => tile.id), ['0:0', '64:0']);
	lifecycle.destroy();
});

test('bad snapshots fail closed and recovery resets all tiles without retaining caller references', () => {
	const lifecycle = ready();
	const frame = lifecycle.frame();
	assert.throws(() => lifecycle.synchronize([record('a'), record('a')], 'context'));
	assert.equal(lifecycle.stats.blocked, true);
	assert.throws(() => lifecycle.acknowledge(frame.revision));
	const records = [record('a')];
	assert.equal(lifecycle.synchronize(records, 'context').reset, true);
	lifecycle.acknowledge(lifecycle.frame().revision);
	records[0].bounds.x = 190;
	assert.deepEqual(lifecycle.synchronize(records, 'context').dirtyTiles, ['0:0', '128:0', '192:0']);
	lifecycle.invalidate();
	assert.equal(lifecycle.frame().tiles.length, 16);
	lifecycle.destroy();
	lifecycle.destroy();
	assert.throws(() => lifecycle.frame(), /disposed/);
});

test('scratch admission includes tile residency, output reserve and largest sequential surface', () => {
	const plan = planDrawingRegions({ ...options, reserveBytes: 256 * 256 * 4 });
	const ids = plan.tiles.map(tile => tile.id);
	let admitted = admitCoalescedScratch(plan, ids, { maxBytes: 786432 });
	assert.equal(admitted.strategy, 'coalesced');
	assert.equal(admitted.peakBytes, 786432);
	assert.equal(admitCoalescedScratch(plan, ids, { maxBytes: 786431 }).strategy, 'tiles');
	assert.equal(admitCoalescedScratch(plan, ids, { maxBytes: 786432, maxAxis: 128 }).strategy, 'tiles');
	assert.throws(() => admitCoalescedScratch(plan, ids, { maxBytes: 524287 }), /residency/);
	admitted = admitCoalescedScratch(plan, [], { maxBytes: 524288 });
	assert.equal(admitted.scratchBytes, 0);
	assert.equal(admitted.regions.length, 0);
});
