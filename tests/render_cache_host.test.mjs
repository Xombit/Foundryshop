import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DrawingCacheHost } from '../scripts/render_cache_host.js';

function fixture(prepare = async () => ({ strategy: 'candidate', sourceKey: 'key' })) {
	const calls = [], adapter = {
		prepare: (...args) => { calls.push('prepare'); return prepare(...args); },
		invalidate() { calls.push('invalidate'); },
		use(key, callback) { return callback(key); },
		destroy() { calls.push('destroy'); },
	};
	const host = new DrawingCacheHost({ adapter, capture: () => ({ stack: [], context: {}, artwork: new Map() }) });
	return { host, calls, adapter };
}

test('invalidating during preparation blocks old frames and serially retries the latest snapshot', async () => {
	let resolve, count = 0;
	const { host, calls } = fixture(async () => {
		if (++count === 1) await new Promise(r => { resolve = r; });
		return { strategy: 'candidate', sourceKey: String(count) };
	});
	const first = host.prepare();
	assert.equal(host.prepare(), first);
	await new Promise(r => setImmediate(r));
	const invalidated = host.invalidate();
	assert.throws(() => host.use(() => {}), /current frame/);
	resolve();
	assert.equal((await first).sourceKey, '2');
	await invalidated;
	assert.deepEqual(calls, ['prepare', 'invalidate', 'prepare']);
	assert.equal(host.use(key => key), '2');
	await host.destroy();
});

test('continuous churn is bounded, evicts and refuses publication', async () => {
	let host, count = 0;
	({ host } = fixture(async () => {
		count++;
		void host.invalidate().catch(() => {});
		return { strategy: 'candidate', sourceKey: 'stale' };
	}));
	await assert.rejects(host.prepare(), /repeatedly/);
	assert.equal(count, 4);
	assert.equal(host.stats.ready, false);
	await host.destroy();
});

test('failure surfaces and explicit retry can recover', async () => {
	let fail = true;
	const { host } = fixture(async () => {
		if (fail) throw new Error('GPU failure');
		return { strategy: 'candidate', sourceKey: 'fixed' };
	});
	await assert.rejects(host.prepare(), /GPU failure/);
	assert.equal(host.stats.ready, false);
	fail = false;
	await host.prepare();
	assert.equal(host.stats.ready, true);
	await host.invalidate();
	assert.equal(host.stats.ready, false);
	await host.destroy();
	await host.destroy();
	assert.throws(() => host.prepare(), /closed/);
});

test('opt-in hooks scope Scene events, unregister fully and report invalidation failures', async () => {
	const handlers = new Map(), reported = [];
	const hooks = { on(name, fn) { handlers.set(name, fn); return name; }, off(name) { handlers.delete(name); } };
	const { host, calls, adapter } = fixture();
	host.bind({ hooks, sceneId: () => 'current', reportError: error => reported.push(error) });
	await host.prepare();
	handlers.get('updateDrawing')({ parent: { id: 'other' } });
	assert.equal(host.stats.ready, true);
	handlers.get('refreshDrawing')({ document: { parent: { id: 'current' } } });
	assert.equal(host.stats.ready, false);
	await new Promise(r => setImmediate(r));
	assert.ok(calls.includes('invalidate'));
	adapter.invalidate = () => { throw new Error('Cleanup failed'); };
	handlers.get('canvasPan')();
	await new Promise(r => setImmediate(r));
	assert.equal(reported[0].message, 'Cleanup failed');
	await host.destroy();
	assert.equal(handlers.size, 0);
});

test('teardown waits for hashing/preparation before destroying adapter resources', async () => {
	let resolve;
	const { host, calls } = fixture(async () => {
		await new Promise(r => { resolve = r; });
		return { strategy: 'candidate', sourceKey: 'late' };
	});

	const pending = host.prepare();
	await new Promise(r => setImmediate(r));
	const destroyed = host.destroy();
	resolve();
	await assert.rejects(pending, /closed/);
	await assert.rejects(destroyed, AggregateError);
	assert.equal(host.stats.disposed, true);
	assert.equal(calls.at(-1), 'destroy');
	assert.equal(host.stats.ready, false);
});

test('font, context and borrowed-asset changes invalidate synchronously and listeners are removed', async () => {
	const fonts = new EventTarget(), contextTarget = new EventTarget(), asset = new EventEmitter();
	const hooks = { on: () => 1, off() {} };
	const { host } = fixture();
	host.bind({ hooks, sceneId: () => 'scene', reportError: error => assert.fail(error),
		fonts, contextTarget, assets: [asset] });
	for (const trigger of [
		() => fonts.dispatchEvent(new Event('loadingdone')),
		() => contextTarget.dispatchEvent(new Event('webglcontextlost')),
		() => asset.emit('update'),
		() => asset.emit('dispose'),
	]) {
		await host.prepare();
		trigger();
		assert.equal(host.stats.ready, false);
		await new Promise(r => setImmediate(r));
	}
	await host.destroy();
	assert.equal(asset.listenerCount('update'), 0);
	assert.equal(asset.listenerCount('dispose'), 0);
	fonts.dispatchEvent(new Event('loadingdone'));
	contextTarget.dispatchEvent(new Event('webglcontextlost'));
});

test('failed cleanup remains blocked and teardown retries resource and listener ownership', async () => {
	let failCleanup = true, failDisposal = true, failOff = true;
	const { host, adapter, calls } = fixture();
	adapter.invalidate = () => { if (failCleanup) throw new Error('evict'); };
	adapter.destroy = () => {
		calls.push('destroy');
		if (failDisposal) throw new Error('dispose');
	};
	const handlers = new Map();
	const hooks = {
		on(name, fn) { handlers.set(name, fn); return name; },
		off(name) { if (failOff) throw new Error('off'); handlers.delete(name); },
	};
	host.bind({ hooks, sceneId: () => 'scene', reportError: error => assert.fail(error) });
	await host.prepare();
	await assert.rejects(host.invalidate(), /evict/);
	assert.throws(() => host.use(() => {}), /current frame/);
	failCleanup = false;
	await host.prepare();
	await assert.rejects(host.destroy(), AggregateError);
	assert.equal(host.stats.disposed, false);
	failDisposal = false;
	failOff = false;
	await host.destroy();
	assert.equal(host.stats.disposed, true);
	assert.equal(handlers.size, 0);
	assert.equal(calls.filter(value => value === 'destroy').length, 2);
});

test('snapshot guard detects changes during async preparation without hooks and retries serially', async () => {
	let revision = 0, count = 0;
	const adapter = {
		async prepare() {
			if (++count === 1) revision++;
			return { strategy: 'candidate', sourceKey: String(count) };
		},
		use(key, callback) { return callback(key); }, invalidate() {}, destroy() {},
	};
	const host = new DrawingCacheHost({ adapter, capture: () => {
		const captured = revision;
		return { isCurrent: () => captured === revision };
	} });
	await host.prepare();
	assert.equal(count, 2);
	assert.equal(host.use(key => key), '2');
	revision++;
	let replayed = false;
	assert.throws(() => host.use(() => { replayed = true; }), /snapshot changed/);
	assert.equal(replayed, false);
	assert.equal(host.stats.ready, false);
	await host.prepare();
	assert.equal(host.use(key => key), '3');
	await host.destroy();
});

test('guard contract errors surface and cleanup; async or missing booleans never authorize replay', async () => {
	for (const isCurrent of [true, () => undefined, () => Promise.resolve(true), () => { throw new Error('guard failed'); }]) {
		let disposed = 0;
		const adapter = { prepare() { assert.fail('Invalid guards must fail before allocation.'); },
			use() {}, invalidate() { disposed++; }, destroy() {} };
		const host = new DrawingCacheHost({ adapter, capture: () => ({ isCurrent }) });
		await assert.rejects(host.prepare());
		assert.equal(host.stats.ready, false);
		assert.equal(disposed, 1);
		await host.destroy();
	}
});

test('guard exceptions at replay keep stale resources blocked until serialized cleanup', async () => {
	let fail = false, disposed = 0;
	const adapter = { async prepare() { return { strategy: 'candidate', sourceKey: '1' }; },
		use(key, callback) { return callback(key); }, invalidate() { disposed++; }, destroy() {} };
	const host = new DrawingCacheHost({ adapter, capture: () => ({
		isCurrent: () => { if (fail) throw new Error('editing'); return true; },
	}) });
	await host.prepare();
	fail = true;
	assert.throws(() => host.use(() => assert.fail('Stale resources must not be replayed.')), /editing/);
	assert.equal(host.stats.ready, false);
	fail = false;
	await host.prepare();
	assert.equal(disposed, 1);
	await host.destroy();
});

test('a guard firing invalidation cannot publish or replay the revision it just invalidated', async () => {
	let host, guards = 0, invalidateAt = 2;
	const adapter = { async prepare() { return { strategy: 'candidate', sourceKey: '1' }; },
		use(key, callback) { return callback(key); }, invalidate() {}, destroy() {} };
	host = new DrawingCacheHost({ adapter, capture: () => ({ isCurrent: () => {
		if (++guards === invalidateAt) void host.invalidate().catch(error => assert.fail(error));
		return true;
	} }) });
	await host.prepare();
	assert.equal(guards, 4);
	invalidateAt = 5;
	assert.throws(() => host.use(() => assert.fail('Guard-invalidated replay must be refused.')), /snapshot changed/);
	await host.destroy();
});
