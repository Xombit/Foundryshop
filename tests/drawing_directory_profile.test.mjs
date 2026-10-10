import test from 'node:test';
import assert from 'node:assert/strict';
import { profileDrawingDirectory } from '../tools/drawing-directory-profile.mjs';

function fixture() {
	const flags = [], scene = { drawings: { size: 500 }, toObject: () => ({ unchanged: true }) };
	class App {
		constructor(id) { this.id = id; }
		async render() { await this._renderHTML(); this._applyFilters(); }
		async _renderHTML() { return 'directory'; }
		_applyFilters() { flags.push('all-refresh'); }
	}
	const apps = ['placeables', 'drawings-tab'].map(id => new App(id));
	const options = [];
	const drawing = {
		document: { hidden: false, locked: false }, controlled: false,
		renderFlags: { set(value) { flags.push(value); } },
		control(option) {
			options.push(option);
			this.controlled = true;
			if (option.renderSidebar) for (const app of apps) app.render();
			return true;
		},
		release(option) {
			options.push(option);
			this.controlled = false;
			if (option.renderSidebar) for (const app of apps) app.render();
		},
	};
	globalThis.game = { user: { isGM: true } };
	globalThis.canvas = { ready: true, scene, drawings: { active: true, controlled: [], placeables: [drawing] } };
	globalThis.document = { visibilityState: 'visible' };
	globalThis.CONFIG = { debug: { hooks: true } };
	globalThis.ui = { placeables: { active: false } };
	globalThis.foundry = { applications: { instances: new Map(apps.map(app => [app.id, app])) } };
	globalThis.requestAnimationFrame = callback => queueMicrotask(() => callback(performance.now()));
	return { apps, drawing, flags, options };
}

test('directory profiling measures both native modes and restores inherited methods', async () => {
	const f = fixture();
	const methods = f.apps.map(app => ({ render: app.render, html: app._renderHTML, filters: app._applyFilters }));
	const result = await profileDrawingDirectory({ trials: 2 });
	assert.equal(result.count, 500);
	assert.equal(result.hookDebug, true);
	assert.equal(CONFIG.debug.hooks, true);
	assert.equal(result.cases.length, 2);
	assert.deepEqual(result.cases.map(c => c.trialsMs.length), [2, 2]);
	assert.equal(result.stages.find(s => s.application === 'placeables' && s.method === 'render').calls, 4);
	assert.equal(result.stages.some(s => s.mode === 'native-renderSidebar-false'), false);
	assert.equal(f.options.filter(o => o.renderSidebar === true).length, 4);
	assert.equal(f.options.filter(o => o.renderSidebar === false).length, 4);
	assert.equal(f.drawing.controlled, false);
	for (let i = 0; i < f.apps.length; i++) {
		assert.equal(f.apps[i].render, methods[i].render);
		assert.equal(f.apps[i]._renderHTML, methods[i].html);
		assert.equal(f.apps[i]._applyFilters, methods[i].filters);
		assert.equal(Object.hasOwn(f.apps[i], 'render'), false);
	}
});

test('directory profiling refuses selections, hidden pages and excessive trials', async () => {
	fixture();
	for (const trials of [0, 6, 1.5]) await assert.rejects(profileDrawingDirectory({ trials }), /idle/);
	canvas.drawings.controlled.push({});
	await assert.rejects(profileDrawingDirectory(), /idle/);
	canvas.drawings.controlled.length = 0;
	document.visibilityState = 'hidden';
	await assert.rejects(profileDrawingDirectory(), /idle/);
});

test('directory profiling restores own descriptors and releases selection after a failure', async () => {
	const f = fixture();
	const render = function() { return this; };
	Object.defineProperty(f.apps[0], 'render', { value: render, writable: true, enumerable: false, configurable: true });
	const descriptor = Object.getOwnPropertyDescriptor(f.apps[0], 'render');
	f.drawing.renderFlags.set = () => { throw new Error('Refresh failed'); };
	await assert.rejects(profileDrawingDirectory({ trials: 1 }), /Refresh failed/);
	assert.deepEqual(Object.getOwnPropertyDescriptor(f.apps[0], 'render'), descriptor);
	assert.equal(f.drawing.controlled, false);
	assert.equal(Object.hasOwn(f.apps[1], 'render'), false);
});

test('asynchronous native directory failures are surfaced even if they settle before draining', async () => {
	const f = fixture();
	const render = async function() { throw new Error('Render failed'); };
	f.apps[0].render = render;
	await assert.rejects(profileDrawingDirectory({ trials: 1 }), error => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.errors[0].message, 'Render failed');
		return true;
	});
	assert.equal(f.apps[0].render, render);
	assert.equal(f.drawing.controlled, false);
	assert.equal(Object.hasOwn(f.apps[1], 'render'), false);
});
