import test from 'node:test';
import assert from 'node:assert/strict';
import { indexDrawingCandidates, detachedDrawingCandidates, chooseMeasuredDrawingRebuild } from '../tools/drawing-spatial-index.mjs';

const options = { width: 256, height: 256, tileSize: 64 };
const record = (id, x, y, width = 20, height = 20) => ({ id, bounds: { x, y, width, height } });

test('candidates preserve source order, include boundary padding and omit offscreen content', () => {
	const records = [record('top', 20, 20), record('bottom', 10, 10), record('edge', 63, 63, 1, 1),
		record('offscreen', -50, -50)];
	const index = indexDrawingCandidates(records, options);
	assert.deepEqual(index.query('0:0'), ['top', 'bottom', 'edge']);
	assert.deepEqual(index.query('64:64'), ['edge']);
	assert.deepEqual(index.query('192:192'), []);
	records[0].bounds.x = 200;
	assert.deepEqual(index.query('0:0'), ['top', 'bottom', 'edge']);
	assert.throws(() => index.query('missing'), /Unknown/);
	assert.ok(Object.isFrozen(index.query('0:0')));
});

test('invalid bounds, identity and reference capacity are explicitly refused', () => {
	for (const records of [[record('a', NaN, 0)], [record('a', 0, 0, -1)],
		[record('a', 0, 0), record('a', 10, 10)]]) {
		assert.throws(() => indexDrawingCandidates(records, options));
	}
	assert.throws(() => indexDrawingCandidates([record('a', 0, 0, 256, 256)], options,
		{ maxReferences: 15 }), /reference budget/);
});

function fixture() {
	const object = (x, renderable = true) => ({
		renderable, children: [], blendMode: 0,
		getBounds: () => ({ x, y: 10, width: 20, height: 20 }),
	});
	const root = { children: [object(10), object(200), object(15, false)], parent: null };
	return { root, snapshot: () => detachedDrawingCandidates(root, options) };
}

test('detached suppression preserves order and restores state on success and failure', () => {
	const { root, snapshot } = fixture();
	const original = [...root.children], index = snapshot();
	assert.equal(index.renderTile('0:0', () => {
		assert.deepEqual(root.children, original);
		assert.deepEqual(root.children.map(o => o.renderable), [true, false, false]);
	}), 2);
	assert.deepEqual(root.children.map(o => o.renderable), [true, true, false]);
	assert.throws(() => index.renderTile('0:0', () => { throw new Error('GPU failure'); }), /GPU failure/);
	assert.deepEqual(root.children.map(o => o.renderable), [true, true, false]);
	assert.throws(() => index.renderTile('0:0', () => Promise.resolve()), /synchronous/);
	assert.deepEqual(root.children.map(o => o.renderable), [true, true, false]);
	assert.throws(() => index.renderTile('0:0', () => index.renderTile('0:0', () => {})), /reenter/);
});

test('live roots, unsupported descendant effects and stale order cannot be suppressed', () => {
	const { root, snapshot } = fixture();
	root.parent = {};
	assert.throws(snapshot, /detached/);
	root.parent = null;
	root.inPrimary = true;
	assert.throws(snapshot, /detached/);
	root.inPrimary = false;
	for (const property of ['mask', 'cacheAsBitmap']) {
		root.children[0][property] = true;
		assert.throws(snapshot, /uncached/);
		root.children[0][property] = false;
	}
	root.children[0].children.push({ filters: [{}] });
	assert.throws(snapshot, /uncached/);
	root.children[0].children = [];
	root.children[0].blendMode = 2;
	assert.throws(snapshot, /uncached/);
	root.children[0].blendMode = 0;
	const index = snapshot();
	root.children.reverse();
	assert.throws(() => index.renderTile('0:0', () => {}), /stale/);
});

test('fractional-resolution candidates agree with exhaustive padded intersection', () => {
	let seed = 404;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 0x100000000;
	};
	const records = Array.from({ length: 100 }, (_, i) => record(String(i),
		random() * 400 - 100, random() * 400 - 100, random() * 150, random() * 150));
	const index = indexDrawingCandidates(records, { ...options, resolution: 1.5 }, { padding: 2 / 1.5 });
	for (const tile of index.plan.tiles) {
		assert.deepEqual(index.query(tile.id), records.filter(({ bounds: b }) =>
			b.x - 2 / 1.5 < tile.x + tile.width && b.x + b.width + 2 / 1.5 > tile.x
			&& b.y - 2 / 1.5 < tile.y + tile.height && b.y + b.height + 2 / 1.5 > tile.y,
		).map(r => r.id));
	}
});

test('measured admission defaults to viewport when ranges overlap or savings are marginal', () => {
	const seven = value => Array(7).fill(value);
	assert.equal(chooseMeasuredDrawingRebuild({
		viewport: seven(2), fullRootDirty: seven(1.9), spatialDirty: seven(2.1),
	}).strategy, 'viewport');
	assert.equal(chooseMeasuredDrawingRebuild({
		viewport: [1, 2, 2, 2, 2, 2, 3], fullRootDirty: seven(1.5), spatialDirty: seven(1.6),
	}).strategy, 'viewport');
	assert.equal(chooseMeasuredDrawingRebuild({
		viewport: seven(2), fullRootDirty: seven(1), spatialDirty: seven(0.8),
	}).strategy, 'spatialDirty');
	assert.equal(chooseMeasuredDrawingRebuild({
		viewport: seven(2), fullRootDirty: seven(0.8), spatialDirty: seven(1),
	}).strategy, 'fullRootDirty');
});

test('measured admission refuses missing, inadequate, zero and nonfinite samples', () => {
	for (const values of [null, [1], Array(7).fill(0), Array(7).fill(NaN), Array(7).fill(Infinity)]) {
		assert.throws(() => chooseMeasuredDrawingRebuild({
			viewport: values, fullRootDirty: Array(7).fill(1), spatialDirty: Array(7).fill(1),
		}), RangeError);
	}
});
