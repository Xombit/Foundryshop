import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	TABLET_ACTIONS, activateTabletTool, registerTabletKeybindings, initTabletControls,
	tabletBindingLabel, openTabletBindings, bindTabletKeyTest,
} from '../scripts/tablet_controls.js';
import { armLabel, disarmLabel, getLabelState, resetLabelState, onPlacePointerDown } from '../scripts/label_placement.js';

class EventTargetFake {
	constructor() { this.listeners = new Map(); }
	addEventListener(type, fn) {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(fn); this.listeners.set(type, listeners);
	}
	removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
	dispatch(event) { for (const fn of [...(this.listeners.get(event.type) ?? [])]) fn(event); }
	blur() { this.dispatch({ type: 'blur' }); }
}

let activations, hooks, actions, errors, target;
beforeEach(() => {
	activations = []; hooks = new Map(); actions = new Map(); errors = [];
	target = new EventTargetFake();
	globalThis.window = target;
	globalThis.document = { activeElement: null };
	globalThis.CONST = { KEYBINDING_PRECEDENCE: { NORMAL: 0 } };
	globalThis.Hooks = {
		on: (name, fn) => hooks.set(name, fn),
		callAll() {},
	};
	globalThis.game = {
		user: { isGM: true, can: () => true },
		keyboard: { hasFocus: false },
		i18n: { localize: key => key, format: (key, args) => `${key} ${JSON.stringify(args)}` },
		keybindings: { actions,
			register(namespace, id, data) { actions.set(`${namespace}.${id}`, data); },
			get: () => [],
		},
	};
	globalThis.canvas = { ready: true, scene: {}, app: { view: {} },
		drawings: { active: true }, currentMouseManager: { isDragging: false },
		mouseInteractionManager: { isDragging: false } };
	globalThis.ui = {
		notifications: { error: message => errors.push(message) },
		controls: { control: { name: 'tokens' },
			controls: { drawings: { tools: { freehand: {} } }, tokens: { tools: { select: {} } } },
			async activate(options) {
				activations.push(options);
				this.control = { name: options.control };
				game.activeTool = options.tool;
			},
		},
	};
	globalThis.foundry = {
		helpers: { interaction: { KeyboardManager: { getKeycodeDisplayString: key => key.replace('Key', '') } } },
		applications: { sidebar: { apps: { ControlsConfig: class {
			render(options) { return options; }
		} } } },
	};
	resetLabelState();
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const event = overrides => ({ type: 'keydown', key: 'F13', code: 'F13', ctrlKey: true,
	preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...overrides });

test('both keybindings register unbound, GM-only and non-repeating using native controls', async () => {
	registerTabletKeybindings();
	assert.equal(actions.size, 2);
	for (const action of TABLET_ACTIONS) {
		const binding = actions.get(`foundryshop.${action.id}`);
		assert.deepEqual(binding.editable, []);
		assert.equal(binding.restricted, true);
		assert.equal(binding.repeat, false);
		assert.equal(binding.onDown(), true);
		await flush();
		assert.deepEqual(activations.at(-1), { control: action.control, tool: action.tool });
	}
	assert.equal(errors.length, 0);
});

test('shortcuts ignore editable focus and report missing permission/tool/canvas failures', async () => {
	registerTabletKeybindings();
	const down = actions.get('foundryshop.drawFreehand').onDown;
	for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
		document.activeElement = { tagName };
		assert.equal(down(), false);
	}
	document.activeElement = { isContentEditable: true };
	assert.equal(down(), false);
	document.activeElement = null; game.keyboard.hasFocus = true;
	assert.equal(down(), false);
	game.keyboard.hasFocus = false;
	game.user.isGM = false;
	down(); await flush();
	assert.match(errors.at(-1), /Unavailable/);
	game.user.isGM = true; game.user.can = () => false;
	await assert.rejects(activateTabletTool('drawFreehand'), /Unavailable/);
	game.user.can = () => true; delete ui.controls.controls.tokens.tools.select;
	await assert.rejects(activateTabletTool('selectTokens'), /Unavailable/);
	ui.controls.controls.tokens.tools.select = {}; canvas.ready = false;
	await assert.rejects(activateTabletTool('selectTokens'), /Unavailable/);
	assert.equal(activations.length, 0);
});

test('token select cancels label placement without rewriting any brush or Scene data', async () => {
	const scene = canvas.scene;
	armLabel('Room', 'place');
	await activateTabletTool('selectTokens');
	assert.equal(getLabelState().mode, 'off');
	assert.equal(canvas.scene, scene);
	assert.deepEqual(scene, {});
	await activateTabletTool('drawFreehand');
	await activateTabletTool('drawFreehand');
	assert.equal(game.activeTool, 'freehand', 'explicit activation never toggles');
});

test('canvas contact/drag guards reset on release, blur and teardown without accumulating listeners', async () => {
	initTabletControls();
	const ready = hooks.get('canvasReady'), tearDown = hooks.get('canvasTearDown');
	ready(); ready();
	assert.equal(target.listeners.get('pointerdown').size, 1);
	target.dispatch({ type: 'pointerdown', pointerId: 1, target: canvas.app.view });
	await assert.rejects(activateTabletTool('selectTokens'), /Gesture/);
	target.dispatch({ type: 'pointerup', pointerId: 1 });
	await activateTabletTool('selectTokens');
	canvas.currentMouseManager.isDragging = true;
	await assert.rejects(activateTabletTool('drawFreehand'), /Gesture/);
	canvas.currentMouseManager.isDragging = false;
	target.dispatch({ type: 'pointerdown', pointerId: 2, target: canvas.app.view });
	target.dispatch({ type: 'blur' });
	await activateTabletTool('drawFreehand');
	target.dispatch({ type: 'pointerdown', pointerId: 3, target: canvas.app.view });
	tearDown();
	assert.equal(target.listeners.get('pointerdown').size, 0);
	await activateTabletTool('selectTokens');
});

test('activation refuses overlap, reports veto/stale completion and releases its guard after failure', async () => {
	let finish;
	ui.controls.activate = () => new Promise(resolve => { finish = resolve; });
	const pending = activateTabletTool('drawFreehand');
	await assert.rejects(activateTabletTool('selectTokens'), /Busy/);
	finish();
	await assert.rejects(pending, /Changed/);
	ui.controls.activate = async () => { throw new Error('Native failed'); };
	await assert.rejects(activateTabletTool('drawFreehand'), /Native failed/);
	ui.controls.activate = async ({ control, tool }) => {
		ui.controls.control = { name: control }; game.activeTool = tool; canvas.scene = {};
	};
	await assert.rejects(activateTabletTool('drawFreehand'), /Changed/);
});

test('pending label creation blocks switching until the native write has completed', async () => {
	let finish;
	foundry.utils = { deepClone: structuredClone };
	canvas.canvasCoordinatesFromClient = point => point;
	canvas.drawings.getMaxSort = () => 0;
	globalThis.getDocumentClass = () => ({
		cleanData: data => data,
		create: () => new Promise(resolve => { finish = resolve; }),
	});
	armLabel('Room', 'place');
	onPlacePointerDown({ target: canvas.app.view, clientX: 10, clientY: 10, button: 0, isPrimary: true,
		preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
	await assert.rejects(activateTabletTool('selectTokens'), /Gesture/);
	disarmLabel();
	await assert.rejects(activateTabletTool('selectTokens'), /Gesture/, 'canceling a ghost does not cancel a pending native write');
	finish({ id: 'created' });
	await flush();
	await activateTabletTool('selectTokens');
	assert.equal(getLabelState().mode, 'off');
});

test('binding display reads the native store and Configure Controls opens without changing bindings', () => {
	assert.match(tabletBindingLabel('drawFreehand'), /Reload/);
	registerTabletKeybindings();
	assert.match(tabletBindingLabel('drawFreehand'), /Unbound/);
	game.keybindings.get = () => [{ key: 'KeyP', modifiers: ['Control', 'Shift'] }, { key: 'F13', modifiers: [] }];
	assert.equal(tabletBindingLabel('drawFreehand'), 'Control + Shift + P / F13');
	assert.deepEqual(openTabletBindings(), { force: true });
});

test('key test captures only while focused, never executes/saves input, and cleans up on exit', () => {
	const input = new EventTargetFake(), output = { textContent: '' };
	const dispose = bindTabletKeyTest(input, output);
	assert.equal(target.listeners.get('keydown'), undefined);
	input.dispatch({ type: 'focus' });
	const down = event();
	target.dispatch(down);
	assert.equal(down.prevented, true); assert.equal(down.stopped, true);
	assert.match(output.textContent, /F13/); assert.match(output.textContent, /ctrl/);
	const text = output.textContent;
	target.dispatch(event({ type: 'keyup' }));
	assert.equal(output.textContent, text);
	const tab = event({ key: 'Tab' });
	target.dispatch(tab);
	assert.equal(tab.stopped, undefined);
	input.blur();
	assert.equal(target.listeners.get('keydown').size, 0);
	input.dispatch({ type: 'focus' });
	const escape = event({ key: 'Escape' });
	target.dispatch(escape);
	assert.equal(escape.stopped, true, 'Escape exits capture without executing a canvas action');
	assert.equal(target.listeners.get('keydown').size, 0);
	input.dispatch({ type: 'focus' });
	target.dispatch({ type: 'blur' });
	assert.equal(target.listeners.get('keyup').size, 0);
	input.dispatch({ type: 'focus' });
	dispose();
	assert.equal(input.listeners.get('focus').size, 0);
	assert.equal(target.listeners.get('keydown').size, 0);
});
