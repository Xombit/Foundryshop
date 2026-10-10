import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAL_COLORS, CAMPAIGN_COLORS } from '../scripts/saved_colors.js';
import { PERSONAL_LABELS, CAMPAIGN_LABELS } from '../scripts/label_banks.js';
import { getLabelState, armLabel, resetLabelState } from '../scripts/label_placement.js';
import { starterShape } from '../scripts/starter_shapes.js';
import { getAppearanceOverride, clearAppearanceOverride } from '../scripts/appearance_state.js';
import { configurePath, getPathState } from '../scripts/path_placement.js';
import { createPathRecipe } from '../scripts/path_schema.js';
import { buildPathDrawings } from '../scripts/path_geometry.js';
import { pathComponentBaseline } from '../scripts/path_store.js';
import { getPathEditorState, cancelPathEdit } from '../scripts/path_editor.js';

class FakeElement {
	constructor(tag) {
		this.tagName = tag.toUpperCase();
		this.children = [];
		this.attributes = {};
		this.dataset = {};
		this.style = { setProperty(name, value) { this[name] = value; } };
		this.classList = {
			add: name => { this.className = `${this.className} ${name}`.trim(); },
			remove: name => { this.className = this.className.split(' ').filter(entry => entry !== name).join(' '); },
			contains: name => this.className.split(' ').includes(name),
		};
		this.offsetWidth = 300; this.offsetHeight = 400; this.clientLeft = 0; this.clientTop = 0;
		this.listeners = {};
		this.textContent = '';
	}
	append(...nodes) { this.children.push(...nodes); }
	replaceChildren(...nodes) { this.children = nodes; }
	setAttribute(name, value) {
		this.attributes[name] = value;
		if (['value', 'type'].includes(name)) this[name] = value;
		if (name === 'checked') this.checked = true;
	}
	getAttribute(name) { return this.attributes[name]; }
	set className(value) { this.attributes.class = value; }
	get className() { return this.attributes.class ?? ''; }
	addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
	removeEventListener(name, fn) { this.listeners[name] = (this.listeners[name] ?? []).filter(entry => entry !== fn); }
	dispatchEvent(event) { for (const listener of this.listeners[event.type] ?? []) listener(event); return true; }
	blur() { this.blurred = true; }
	focus() { document.activeElement = this; }
	getBoundingClientRect() { return { left: 50, top: 60, right: 350, bottom: 460, width: 300, height: 400 }; }
	*walk() { for (const child of this.children) { yield child; yield* child.walk(); } }
	matches(selector) {
		if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
		const match = /^(\w*)\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
		if (!match) throw new Error(`Unsupported selector ${selector}`);
		const [, tag, attribute, value] = match;
		const key = attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
		return (!tag || this.tagName === tag.toUpperCase()) && key in this.dataset
			&& (value === undefined || this.dataset[key] === value);
	}
	querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
	querySelectorAll(selector) { return [...this.walk()].filter(node => node.matches(selector)); }
}

class Application {
	static DEFAULT_OPTIONS = {};
	constructor() {
		this.rendered = false;
		this.element = new FakeElement('div');
		this.content = new FakeElement('section');
		this.element.append(this.content);
		this.position = { left: 50, top: 60, width: 300, height: 400 };
		this.renders = 0;
	}
	async render(options = {}) {
		const isFirstRender = !this.rendered;
		if (isFirstRender && !options.force) return this;
		if (options.position) Object.assign(this.position, options.position);
		const context = await this._prepareContext(options);
		this._replaceHTML(await this._renderHTML(context, options), this.content, options);
		this.rendered = true;
		this.renders++;
		await this._onRender(context, { ...options, isFirstRender });
		return this;
	}
	async _onRender() {}
	setPosition(position) { Object.assign(this.position, position); this._onPosition(this.position); }
	_onPosition() {}
	_updatePosition(position) { return { ...position }; }
	async close() { this.rendered = false; this.closed = true; return this; }
}

let hooks, stored, writes, errors, warnings, activations, dialogResult, updates;
globalThis.foundry = {
	applications: { api: { ApplicationV2: Application, DialogV2: {
		prompt: async () => dialogResult, confirm: async () => dialogResult,
	} }, sheets: { palette: { DrawingPalette: class { static SETTING_KEY = 'drawingPalette'; } } } },
	utils: { deepClone: structuredClone, debounce: fn => fn, randomID: () => 'new-id' },
};
const { Drawing_Toolbox } = await import('../scripts/drawing_toolbox.js');
const { actions } = Drawing_Toolbox.DEFAULT_OPTIONS;
const selectTab = (app, tab) => actions.toolboxTab.call(app, {}, button('toolboxTab', { tab }));
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function button(action, dataset = {}) {
	const node = new FakeElement('button');
	Object.assign(node.dataset, { action, ...dataset });
	return node;
}
function makeDrawing(overrides = {}) {
	const doc = {
		id: 'd1', text: 'Old', locked: false,
		canUserModify: () => true,
		getFlag(namespace, key) { return this.flags?.[namespace]?.[key]; },
		async update(changes) { updates.push(changes); Object.assign(this, changes); },
		...overrides,
	};
	return { document: doc };
}

test('material application requires explicit confirmation and rejects stale selection before writes', async () => {
	const app = new Drawing_Toolbox();
	await app.render({ force: true });
	await selectTab(app, 'brush');
	assert.equal(app.content.querySelector('[data-action="materialApplySelection"]').attributes.disabled, '');
	const data = { _id: 'd1', fillType: 0, texture: null, fillColor: '#ffffff', fillAlpha: 1,
		flags: {}, shape: { type: 'r', width: 50, height: 50 } };
	const drawing = makeDrawing({
		parent: canvas.scene, toObject: () => structuredClone(data), getFlag: () => undefined,
	});

	canvas.drawings.controlled = [drawing];
	canvas.scene.drawings.set('d1', drawing.document);
	canvas.scene.grid = { type: 1, size: 100 };
	let batches = 0;
	canvas.scene.updateEmbeddedDocuments = async (type, changes) => {
		batches++;
		Object.assign(data, changes[0]);
	};
	await actions.materialApplySelection.call(app);
	assert.equal(batches, 0, 'dismissed confirmation leaves artwork unchanged');
	const original = foundry.applications.api.DialogV2.confirm;
	try {
		foundry.applications.api.DialogV2.confirm = async () => {
			canvas.drawings.controlled = [];
			return true;
		};
		await actions.materialApplySelection.call(app);
		assert.match(errors.at(-1), /SelectionChanged/);
		assert.equal(batches, 0);
		canvas.drawings.controlled = [drawing];
		foundry.applications.api.DialogV2.confirm = async () => true;
		await actions.materialApplySelection.call(app);
		assert.equal(batches, 1);
		assert.equal(data.fillType, 1);
		assert.equal(data.fillColor, '#abcdef');
		assert.deepEqual(data.shape, { type: 'r', width: 50, height: 50 });
		assert.equal(app._materialApplying, false);
		assert.equal(writes.filter(write => ['core.drawingPalette', 'foundryshop.materialRepeat'].includes(write.key)).length,
			0, 'selection application does not alter brush settings');
	} finally {
		foundry.applications.api.DialogV2.confirm = original;
		await app.close();
	}
});

test('styled examples appear immediately, arm their style and apply it explicitly without changing brush defaults', async () => {
	const app = new Drawing_Toolbox();
	await app.render({ force: true });
	await selectTab(app, 'labels');
	assert.equal(app.content.querySelectorAll('[data-action="labelExample"]').length, 0);
	assert.equal(app.content.querySelectorAll('[data-action="labelArm"]').length, 16);
	await actions.labelArm.call(app, {}, button('labelArm', { id: 'example-DungeonTitle' }));
	assert.deepEqual(getLabelState().style, { fontFamily: 'Modesto Condensed', fontSize: 64, textColor: '#302b26', textAlpha: 1 });
	const drawing = makeDrawing();
	canvas.drawings.controlled = [drawing];
	canvas.scene.drawings.set('d1', drawing.document);
	await actions.selectionApply.call(app, {}, button('selectionApply'));
	assert.deepEqual(updates.at(-1), { text: 'FOUNDRYSHOP.Labels.Starter.DungeonTitle',
		fontFamily: 'Modesto Condensed', fontSize: 64, textColor: '#302b26', textAlpha: 1 });
	assert.equal(stored['core.drawingPalette'].fontFamily, undefined);
	await app.close();
});

test('live label composer previews edits without rerendering or writes and arms/saves all native text fields', async () => {
	const app = new Drawing_Toolbox();
	await app.render({ force: true });
	await selectTab(app, 'labels');
	const fields = Object.fromEntries(['text', 'fontFamily', 'fontSize', 'textColor', 'textAlpha']
		.map(field => [field, app.content.querySelector(`[data-label-draft="${field}"]`)]));
	assert.ok(Object.values(fields).every(Boolean));
	const family = fields.fontFamily;
	assert.equal(family.children.find(option => option.attributes.value === 'Amiri').style.fontFamily, 'Amiri');
	assert.ok([...app.content.walk()].indexOf(fields.text) < [...app.content.walk()]
		.indexOf(app.content.querySelector('[data-action="labelArm"]')));
	const renders = app.renders;
	for (const [field, value] of Object.entries({
		text: 'Silver River\nEast fork', fontFamily: 'Amiri', fontSize: '40', textColor: '#395d72', textAlpha: '0.35',
	})) {
		fields[field].value = value;
		fields[field].listeners.input[0]();
	}
	assert.equal(app.renders, renders);
	const preview = fields.text;
	assert.equal(preview.value, 'Silver River\nEast fork');
	assert.equal(preview.style.fontFamily, 'Amiri');
	assert.equal(preview.style.fontSize, '40px');
	assert.equal(preview.style.color, 'rgba(57, 93, 114, 0.35)');
	assert.equal(preview.style.opacity, undefined, 'opacity never fades the input background or caret');
	assert.equal(app.content.querySelector('[data-label-preview-text]'), null);
	fields.fontSize.value = '256'; fields.fontSize.listeners.input[0]();
	assert.equal(preview.style.fontSize, '256px', 'large fonts are not silently capped');
	fields.textAlpha.value = '0'; fields.textAlpha.listeners.input[0]();
	assert.equal(preview.style.color, 'rgba(57, 93, 114, 0)');
	fields.fontSize.value = '40'; fields.fontSize.listeners.input[0]();
	fields.textAlpha.value = '0.35'; fields.textAlpha.listeners.input[0]();
	assert.equal(fields.text.style.fontFamily, 'Amiri');
	assert.equal(getLabelState().mode, 'off');
	await actions.labelDraftUse.call(app, {}, button('labelDraftUse'));
	assert.deepEqual(getLabelState().style, { fontFamily: 'Amiri', fontSize: 40, textColor: '#395d72', textAlpha: 0.35 });
	await actions.labelDraftSave.call(app, {}, button('labelDraftSave'));
	assert.deepEqual(stored[`foundryshop.${PERSONAL_LABELS}`].labels.at(-1).style, getLabelState().style);
	const input = app.content.querySelector('[data-label-draft="text"]');
	input.value = 'Changed draft'; input.listeners.input[0]();
	assert.equal(getLabelState().mode, 'off');
	await app.render();
	assert.equal(app._labelDraft.text, 'Changed draft');
	const drawing = makeDrawing();
	canvas.drawings.controlled = [drawing];
	canvas.scene.drawings.set('d1', drawing.document);
	await actions.labelDraftApply.call(app, {}, button('labelDraftApply'));
	assert.deepEqual(updates.at(-1), { text: 'Changed draft', fontFamily: 'Amiri',
		fontSize: 40, textColor: '#395d72', textAlpha: 0.35 });
	assert.equal(getLabelState().mode, 'off', 'applying to artwork never arms placement');
	assert.equal(writes.filter(write => ['core.drawingPalette', 'foundryshop.materialRepeat'].includes(write.key)).length, 0);
	const size = app.content.querySelector('[data-label-draft="fontSize"]');
	size.value = '999'; size.listeners.input[0]();
	await actions.labelDraftUse.call(app, {}, button('labelDraftUse'));
	assert.match(errors.at(-1), /InvalidStyle/);
	assert.equal(getLabelState().mode, 'off');
	await app.close();
});

test('label size buttons and wheel update the draft preview in place with bounds and Shift steps', async () => {
	const app = new Drawing_Toolbox();
	await app.render({ force: true });
	await selectTab(app, 'labels');
	const input = app.content.querySelector('[data-label-draft="fontSize"]');
	const area = app.content.querySelector('.fshop-label-size');
	assert.equal(area.listeners.wheel.length, 1, 'wheel is bound before editing');
	const renders = app.renders;
	const initial = app._labelDraft.style.fontSize;
	actions.labelSize.call(app, {}, button('labelSize', { delta: '1' }));
	assert.equal(Number(input.value), initial + 1);
	actions.labelSize.call(app, { shiftKey: true }, button('labelSize', { delta: '-1' }));
	assert.equal(Number(input.value), initial - 4);
	let prevented = 0;
	const wheel = area.listeners.wheel[0];
	const event = { deltaY: -100, preventDefault() { prevented++; }, stopPropagation() {} };
	wheel(event);
	assert.equal(Number(input.value), initial - 3);
	wheel({ ...event, deltaY: 0, deltaX: -100, shiftKey: true });
	assert.equal(Number(input.value), initial + 2);
	for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) wheel({ ...event, [modifier]: true });
	wheel({ ...event, deltaY: 0 });
	assert.equal(prevented, 2);
	input.value = '256'; input.listeners.input[0]();
	wheel(event); assert.equal(input.value, '256');
	input.value = '8'; input.listeners.input[0]();
	actions.labelSize.call(app, {}, button('labelSize', { delta: '-1' }));
	assert.equal(input.value, '8');
	assert.equal(app.content.querySelector('[data-label-draft="text"]').style.fontSize, '8px');
	assert.equal(app.renders, renders);
	assert.equal(area.listeners.wheel.length, 1, 'edits never accumulate wheel handlers');
	assert.equal(getLabelState().mode, 'off');
	assert.equal(writes.filter(write => write.key === 'core.drawingPalette').length, 0);
	await app.close();
});

test('label editor exposes registered fonts and persists selected style with the saved text', async () => {
	const app = new Drawing_Toolbox();
	await app.render({ force: true });
	const prompt = foundry.applications.api.DialogV2.prompt;
	try {
		foundry.applications.api.DialogV2.prompt = async options => {
			const elements = [...options.content.walk()];
			const family = elements.find(element => element.attributes.name === 'labelFont');
			assert.ok(family.children.some(option => option.attributes.value === 'Amiri'));
			const fields = {
				labelName: 'Woodland title', labelText: 'Whispering Woods',
				labelFont: 'Amiri', labelSize: '48', labelColor: '#31513b', labelAlpha: '0.7',
			};
			return options.ok.callback(null, null, { element: { querySelector: selector => {
				const name = /name="([^"]+)"/.exec(selector)[1];
				return { value: fields[name] };
			} } });
		};
		await actions.labelAdd.call(app, {}, button('labelAdd'));
		const saved = stored[`foundryshop.${PERSONAL_LABELS}`].labels.at(-1);
		assert.equal(saved.text, 'Whispering Woods');
		assert.deepEqual(saved.style, { fontFamily: 'Amiri', fontSize: 48, textColor: '#31513b', textAlpha: 0.7 });
	} finally {
		foundry.applications.api.DialogV2.prompt = prompt;
		await app.close();
	}
});

beforeEach(() => {
	globalThis.ResizeObserver = class { observe() {} disconnect() { this.disconnected = true; } };
	globalThis.IntersectionObserver = class {
		constructor(callback) { this.callback = callback; this.targets = []; }
		observe(target) { this.targets.push(target); }
		unobserve(target) { this.targets = this.targets.filter(entry => entry !== target); }
		disconnect() { this.disconnected = true; }
	};
	hooks = new Map();
	let id = 0;
	globalThis.Hooks = {
		on(name, fn) { hooks.set(++id, { name, fn }); return id; },
		off(name, key) { hooks.delete(key); },
		callAll(name, ...args) { for (const hook of [...hooks.values()]) if (hook.name === name) hook.fn(...args); },
	};
	stored = {
		'core.drawingPalette': { strokeColor: '#123456', fillColor: '#abcdef', strokeWidth: 8,
			strokeAlpha: 1, fillAlpha: 0.5, fillType: 1 },
		'foundryshop.toolboxAutoShow': true,
		'foundryshop.toolboxDensity': 'tablet',
		'foundryshop.toolboxState': {},
		'foundryshop.libraryFileOperations': { version: 1, revision: 0, entries: [] },
		'foundryshop.libraryCatalog': { version: 1, revision: 0, entries: [] },
		'foundryshop.sharedPalettes': { version: 1, revision: 0, palettes: [
			{ id: 'shared1', name: 'Terrain', colors: [{ id: 'c1', name: 'Blood', color: '#aa0000' }] },
		] },
		[`foundryshop.${PERSONAL_COLORS}`]: { schemaVersion: 1, colors: [
			{ id: 'c1', name: 'Blood', color: '#aa0000' }] },
		[`foundryshop.${CAMPAIGN_COLORS}`]: { schemaVersion: 1, colors: [] },
		[`foundryshop.${PERSONAL_LABELS}`]: { schemaVersion: 1, labels: [
			{ id: 'l1', name: 'Hall', text: 'Hall' }, { id: 'l2', name: 'Cave', text: 'Cave' }] },
		[`foundryshop.${CAMPAIGN_LABELS}`]: { schemaVersion: 1, labels: [] },
		'foundryshop.brushPresets': { schemaVersion: 1, presets: null },
		'foundryshop.pathPresets': { version: 1, presets: null },
	};
	writes = [];
	errors = [];
	warnings = [];
	activations = [];
	updates = [];
	dialogResult = null;
	globalThis.game = {
		user: { id: 'me', isGM: true, can: () => true },
		activeTool: 'rect',
		keybindings: {
			actions: new Map(['drawFreehand', 'selectTokens', 'toggleToolbox', 'disarmLabel'].map(id => [`foundryshop.${id}`, {}])),
			get: () => [],
		},
		i18n: { localize: key => key, format: (key, args) => `${key} ${JSON.stringify(args)}` },
		settings: {
			get: (namespace, key) => stored[`${namespace}.${key}`],
			async set(namespace, key, value, options = {}) {
				const fullKey = `${namespace}.${key}`;
				stored[fullKey] = structuredClone(value);
				writes.push({ key: fullKey, value, options });
				Hooks.callAll('clientSettingChanged', fullKey, value, options);
			},
		},
	};
	globalThis.document = { createElement: tag => new FakeElement(tag) };
	foundry.applications.settings = { menus: { FontConfig: {
		getAvailableFontChoices: () => ({ Signika: 'Signika', Amiri: 'Amiri', 'Modesto Condensed': 'Modesto Condensed' }),
		getAvailableFonts: () => ['Signika', 'Amiri', 'Modesto Condensed'],
	} } };
	globalThis.window = { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
	globalThis.ui = {
		notifications: { error: message => errors.push(message), warn: message => warnings.push(message) },
		controls: {
			control: { name: 'drawings' },
			controls: { drawings: { tools: { rect: { title: 'CONTROLS.DrawingRect', icon: 'native-rect' } } } },
			async activate(options) {
				activations.push(options);
				if (options.tool) game.activeTool = options.tool;
				if (options.control === 'drawings') canvas.drawings.active = true;
			},
		},
	};
	globalThis.canvas = {
		ready: true,
		drawings: { active: true, controlled: [] },
		level: { id: 'ground' },
		scene: { drawings: new Map(), levels: new Map([['ground', {}]]), getFlag: () => undefined },
	};
	globalThis.getDocumentClass = () => class {
		static metadata = { schemaVersion: '14.355' };
		constructor(data) { Object.assign(this, structuredClone(data)); }
		updateSource(data) { Object.assign(this, structuredClone(data)); }
	};
	globalThis.CONFIG = { Drawing: { objectClass: class {
		constructor(document) { this.document = document; this.renderFlags = { set() {} }; }
		async draw() {}
		destroy() { this.destroyed = true; }
	} } };
	canvas.drawings.preview = { addChild() {} };
	canvas.drawings.addChild = () => {};
	canvas.drawings.paletteCreateData = { fontFamily: 'Signika', fontSize: 48 };
	game.version = '14.365';
	Drawing_Toolbox._instance = null;
	Drawing_Toolbox._suppressed = false;
	Drawing_Toolbox._opening = null;
	Drawing_Toolbox.createLayerPanel = null;
	Drawing_Toolbox.openDetailedPanel = null;
	resetLabelState();
	Drawing_Toolbox.init();
});

test('auto-shows on the Drawings layer, hides on leave, and user close suppresses until next activation', async () => {
	Hooks.callAll('activateDrawingsLayer');
	await flush();
	const app = Drawing_Toolbox._instance;
	assert.equal(app.rendered, true);
	Hooks.callAll('deactivateDrawingsLayer');
	await flush();
	assert.equal(app.rendered, false);
	assert.equal(Drawing_Toolbox._suppressed, false, 'layer change is not a user dismissal');

	Hooks.callAll('activateDrawingsLayer');
	await flush();
	await Drawing_Toolbox._instance.close();
	assert.equal(Drawing_Toolbox._suppressed, true);
	Hooks.callAll('canvasReady');
	await flush();
	assert.equal(Drawing_Toolbox._instance, null, 'stays closed during this activation');
	Hooks.callAll('activateDrawingsLayer');
	await flush();
	assert.equal(Drawing_Toolbox._instance.rendered, true);
});

test('auto-show respects the setting, permission, and canvas state; toggle opens explicitly', async () => {
	stored['foundryshop.toolboxAutoShow'] = false;
	Hooks.callAll('activateDrawingsLayer');
	await flush();
	assert.equal(Drawing_Toolbox._instance, null);
	canvas.drawings.active = false;
	await Drawing_Toolbox.toggle();
	assert.deepEqual(activations, [{ control: 'drawings' }]);
	assert.equal(Drawing_Toolbox._instance.rendered, true);
	await Drawing_Toolbox.toggle();
	assert.equal(Drawing_Toolbox._instance, null);
	game.user.can = () => false;
	await Drawing_Toolbox.toggle();
	assert.equal(Drawing_Toolbox._instance, null);
	assert.equal(warnings.length, 1);
});

test('adds a Drawings toolbar button after existing tools', () => {
	const controls = { drawings: { tools: { select: { order: 1 }, clear: { order: 8 } } } };
	Hooks.callAll('getSceneControlButtons', controls);
	assert.equal(controls.drawings.tools['foundryshop-toolbox'].order, 9);
	assert.equal(controls.drawings.tools['foundryshop-toolbox'].button, true);
	Hooks.callAll('getSceneControlButtons', {});
});

test('Settings includes Intuos4 bindings and focused key test without writes or pressure controls', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	await selectTab(app, 'settings');
	const before = writes.length;
	assert.equal(app.content.querySelectorAll('[data-tablet-binding]').length, 4);
	assert.match(app.content.querySelector('[data-tablet-binding="drawFreehand"]').textContent, /Unbound/);
	assert.ok(app.content.querySelector('[data-action="tabletBindings"]'));
	const input = app.content.querySelector('[data-tablet-key-test]');
	assert.equal(input.attributes.readonly, '');
	assert.equal(input.listeners.focus.length, 1);
	assert.equal(input.listeners.blur.length, 1);
	game.keybindings.get = () => [{ key: 'F13', modifiers: [] }];
	foundry.helpers = { interaction: { KeyboardManager: { getKeycodeDisplayString: key => key } } };
	Hooks.callAll('clientSettingChanged', 'core.keybindings', {});
	await flush();
	assert.equal(app.content.querySelector('[data-tablet-binding="drawFreehand"]').textContent, 'F13');
	assert.equal(input.listeners.focus.length, 0, 'refresh removes listeners on the old test field');
	assert.equal(writes.length, before);
	const current = app.content.querySelector('[data-tablet-key-test]');
	await app.close({ foundryshopHide: true });
	assert.equal(current.listeners.focus.length, 0, 'close disposes the focused capture surface');
});

test('layer toolbox shortcut is shown and dispatched only for a GM', async () => {
	Drawing_Toolbox.createLayerPanel = () => ({
		context: async () => ({ rows: [], unassignedCount: 0 }), bind() {}, render: async () => '',
	});
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	game.user.isGM = false;
	await app.render();
	assert.equal(app.content.querySelector('[data-action="layers"]'), null);
	await actions.layers.call(app);
	assert.equal(app._tab, 'brush');
	game.user.isGM = true;
	await app.render();
	assert.ok(app.content.querySelector('[data-action="layers"]'));
	await actions.layers.call(app);
	assert.equal(app._tab, 'brush');
	assert.equal(app._layerFlyout, true);
	assert.equal(app._collapsed, false);
	await actions.fullLayers.call(app);
	assert.equal(app._tab, 'layers');
	assert.equal(app._layerFlyout, false);
});

test('quick layers reuses visibility, activate, lock and group actions without drag or destructive controls', async () => {
	const calls = [];
	const rows = [
		{ id: 'group', name: 'Terrain', count: 5, depth: 0, isGroup: true, expanded: true,
			localIcon: 'fa-adjust', localAria: 'mixed', localTitle: 'GM workspace mixed',
			playerIcon: 'fa-eye-slash', playerAria: 'false', playerTitle: 'Players hidden', lockTitle: 'Lock' },
		{ id: 'ink', name: 'Ink', count: 5, depth: 1, active: true, localVisible: true,
			localIcon: 'fa-eye', localAria: 'true', localTitle: 'GM workspace visible',
			playerIcon: 'fa-eye', playerAria: 'true', playerTitle: 'Players visible',
			effectiveLocked: true, locked: false, lockTitle: 'Inherited lock' },
	];
	Drawing_Toolbox.createLayerPanel = () => ({
		context: async () => ({ rows, unassignedCount: 2 }), bind() {},
		action(event, target) { calls.push(target.dataset); },
		render: async () => '',
	});
	stored['foundryshop.toolboxState'] = { collapsed: true, tab: 'palettes' };
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	await actions.layers.call(app);
	assert.equal(app._collapsed, true);
	assert.equal(app._tab, 'palettes');
	const flyout = app.content.querySelector('.fshop-tb-layer-flyout');
	assert.ok(flyout);
	assert.equal(flyout.querySelectorAll('[data-preview-layer]').length, 2);
	assert.equal(flyout.querySelector('[data-preview-layer="group"]').dataset.previewState, 'loading');
	assert.ok(flyout.querySelector('[data-action="refreshPreviews"]'));
	const firstObserver = app._previewObserver;
	const firstAbort = app._previewAbort;
	const controls = flyout.querySelectorAll('[data-layerAction]');
	assert.deepEqual(controls.map(node => node.dataset.layerAction),
		['workspace', 'present', 'collapseGroup', 'lock', 'workspace', 'present', 'activate', 'lock']);
	assert.equal(controls[0].attributes['aria-pressed'], 'mixed');
	assert.equal(controls[1].attributes['aria-pressed'], 'false');
	assert.equal(controls[6].attributes.disabled, '');
	assert.equal(controls[2].attributes['aria-expanded'], 'true');
	assert.equal(app.content.querySelector('.fshop-tb-tools').children.length, 9);
	await actions.layerAction.call(app, {}, controls[1]);
	assert.deepEqual(calls.at(-1), { action: 'present', layerAction: 'present', id: 'group' });
	app._dismissFlyout({ target: {} });
	await flush();
	assert.equal(app._layerFlyout, false);
	assert.equal(firstObserver.disconnected, true);
	assert.equal(firstAbort.signal.aborted, true);
	await actions.layers.call(app);
	let prevented = false;
	app._escapeFlyout({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() {} });
	await flush();
	assert.equal(prevented, true);
	assert.equal(app._layerFlyout, false, 'Escape works with focus on the canvas');
	await actions.layers.call(app);
	await actions.fullLayers.call(app);
	assert.equal(app._collapsed, false);
	assert.equal(app._tab, 'layers');
	assert.equal(app._layerFlyout, false);
});

test('renders native tool icons, active tool, density, saved swatches, and labels; restores position clamped', async () => {
	stored['foundryshop.toolboxState'] = { left: 5000, top: -20, collapsed: false };
	stored['foundryshop.toolboxDensity'] = 'compact';
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	assert.deepEqual([app.position.left, app.position.top], [700, 0]);
	const root = app.content.children[0];
	assert.match(root.className, /fshop-tb-compact/);
	const rect = root.querySelector('[data-tool="rect"]');
	assert.equal(rect.attributes['aria-pressed'], 'true');
	assert.equal(rect.children[0].className, 'native-rect');
	assert.equal(root.querySelector('[data-tool="select"]').attributes['aria-pressed'], 'false');
	await selectTab(app, 'palettes');
	await app.content.querySelector('select[data-palette-selector]').listeners.change[0]({ target: { value: 'shared1' } });
	const swatch = app.content.querySelectorAll('[data-action="useColor"]').find(node => node.dataset.paletteId === 'shared1');
	assert.equal(swatch.style.backgroundColor, '#aa0000');
	assert.equal(swatch.style['--by-tb-color'], '#aa0000');
	assert.equal(swatch.style['--button-hover-background-color'], '#aa0000');
	assert.equal(swatch.style['--by-tb-color-text'], '#ffffff');
	assert.equal(swatch.children[0].className, 'fshop-tb-swatch-block');
	assert.equal(swatch.children[0].style.backgroundColor, '#aa0000');
	const strokeChip = root.querySelector('[data-target="stroke"]');
	assert.equal(strokeChip.style['--by-tb-color'], '#123456');
	await selectTab(app, 'labels');
	assert.deepEqual(app.content.querySelectorAll('[data-action="labelArm"]').slice(0, 2).map(node => node.textContent), ['Hall', 'Cave']);
	assert.equal(app.content.querySelectorAll('[data-action="labelArm"]').length, 16);
	assert.equal(app.content.querySelector('[data-action="labelManage"]').attributes['aria-pressed'], 'false');
});

test('unified selector shows one horizontal palette with a trailing add button, persists choices and duplicates explicitly', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	await selectTab(app, 'palettes');
	assert.equal(app._selectedPalette, 'builtin-fantasy');
	assert.equal(app.content.querySelectorAll('[data-action="useColor"]').length, 20);
	assert.equal(app.content.querySelectorAll('select[data-palette-selector]').length, 1);
	assert.equal(app.content.querySelectorAll('[data-action="paletteEdit"]').length, 0);
	const strip = app.content.querySelector('.fshop-tb-palette-grid');
	assert.equal(strip.children.at(-1).dataset.action, 'paletteSave');
	assert.equal(strip.children.at(-1).dataset.paletteId, 'builtin-fantasy');
	const swatch = app.content.querySelectorAll('[data-action="useColor"]')[0];
	await actions.useColor.call(app, {}, swatch);
	assert.equal(stored['core.drawingPalette'].strokeColor, '#302b26');
	assert.equal(stored['foundryshop.sharedPalettes'].palettes.length, 1);
	const selector = app.content.querySelector('select[data-palette-selector]');
	await selector.listeners.change[0]({ target: { value: 'builtin-grayscale' } });
	assert.equal(stored['foundryshop.toolboxState'].selectedPalette, 'builtin-grayscale');
	assert.equal(app.content.querySelectorAll('[data-action="useColor"]').length, 6);
	await actions.paletteManage.call(app);
	assert.equal(app.content.querySelectorAll('[data-action="paletteEdit"]').length, 6);
	assert.equal(app.content.querySelectorAll('[data-action="paletteReset"]').length, 1);
	await actions.sharedDuplicate.call(app, {}, button('sharedDuplicate', { paletteId: 'builtin-grayscale' }));
	assert.equal(stored['foundryshop.sharedPalettes'].palettes.length, 1, 'cancel does not add a palette');
	dialogResult = 'My Grays';
	await actions.sharedDuplicate.call(app, {}, button('sharedDuplicate', { paletteId: 'builtin-grayscale' }));
	assert.equal(stored['foundryshop.sharedPalettes'].palettes.at(-1).colors.length, 6);
	assert.equal(stored['foundryshop.sharedPalettes'].palettes[0].name, 'Terrain');
	assert.equal(app._selectedPalette, stored['foundryshop.sharedPalettes'].palettes.at(-1).id);
	await selectTab(app, 'library');
	assert.equal(app.content.querySelectorAll('[data-action="starterPlace"]').length, 94);
	assert.equal(app.content.querySelectorAll('[data-preview-shape]').length, 94);
	assert.equal(app.content.querySelector('[data-action="starterPlace"]').tagName, 'BUTTON');
	app.content.querySelector('[data-shape-search]').listeners.input[0]({ target: { value: 'tree' } });
	assert.equal(app.content.querySelectorAll('[data-shape-search-text]').filter(card => !card.hidden).length, 8);
	app.content.querySelector('[data-shape-category]').listeners.change[0]({ target: { value: 'Furniture' } });
	assert.equal(app.content.querySelectorAll('[data-shape-search-text]').filter(card => !card.hidden).length, 0);
	app.content.querySelector('[data-shape-search]').listeners.input[0]({ target: { value: '' } });
	assert.equal(app.content.querySelectorAll('[data-shape-search-text]').filter(card => !card.hidden).length, 11);
	assert.match(app.content.querySelector('[data-shape-count]').textContent, /"count":11/);
	await app.render();
	assert.equal(app.content.querySelectorAll('[data-shape-search-text]').filter(card => !card.hidden).length, 11);
});

test('paired swatches have a whole-button target, touch management, atomic brush activation and Return', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	await selectTab(app, 'palettes');
	const pair = { kind: 'pair', name: 'Hall', strokeColor: '#112233', fillColor: '#aabbcc',
		fillType: 1, texture: null, materialRepeat: 1 };
	const baseline = structuredClone(stored['core.drawingPalette']);
	const prompt = foundry.applications.api.DialogV2.prompt;
	const randomID = foundry.utils.randomID;
	try {
		foundry.applications.api.DialogV2.prompt = async options => {
			assert.deepEqual(options.content.attributes, {}, 'native DialogV2 content wrapper must have no attributes');
			assert.equal(options.content.children[0].className, 'fshop-pair-editor');
			return dialogResult;
		};
		await actions.pairCreate.call(app, {}, button('pairCreate', { paletteId: 'builtin-fantasy' }));
		assert.equal(stored['foundryshop.sharedPalettes'].revision, 0);
		dialogResult = pair;
		await actions.pairCreate.call(app, {}, button('pairCreate', { paletteId: 'builtin-fantasy' }));
		assert.deepEqual(stored['core.drawingPalette'], baseline, 'saving a pair does not change the brush');
		const swatch = app.content.querySelectorAll('[data-action="useColor"]').at(-1);
		assert.equal(swatch.children.length, 2);
		assert.equal(swatch.children[0].dataset.action, undefined);
		assert.equal(swatch.children[1].dataset.action, undefined);
		assert.equal(swatch.listeners.contextmenu.length, 1);
		let contextPrevented = false;
		foundry.applications.api.DialogV2.wait = async options => {
			assert.equal(options.content.tagName, 'DIV');
			assert.deepEqual(options.content.attributes, {});
			assert.deepEqual(options.buttons.map(button => button.action), ['pairEdit', 'pairDuplicate', 'paletteDelete']);
			return null;
		};
		await swatch.listeners.contextmenu[0]({ preventDefault() { contextPrevented = true; } });
		assert.equal(contextPrevented, true);
		await actions.useColor.call(app, {}, swatch);
		assert.equal(getAppearanceOverride().patch.fillColor, pair.fillColor);
		assert.deepEqual(stored['core.drawingPalette'], baseline, 'activation does not persist partial settings');
		assert.ok(app.content.querySelector('[data-action="pairReturn"]'));
		await actions.pairReturn.call(app);
		assert.equal(getAppearanceOverride(), null);
		await actions.paletteManage.call(app);
		assert.equal(app.content.querySelectorAll('[data-action="pairEdit"]').length, 1);
		assert.equal(app.content.querySelectorAll('[data-action="pairDuplicate"]').length, 1);
		dialogResult = { ...pair, name: 'Hall copy' };
		foundry.utils.randomID = () => 'pair-copy';
		await actions.pairDuplicate.call(app, {}, button('pairDuplicate', { paletteId: 'builtin-fantasy', id: swatch.dataset.id }));
		assert.deepEqual(errors, []);
		assert.equal(stored['foundryshop.sharedPalettes'].palettes.find(entry => entry.id === 'builtin-fantasy').colors.length, 22);
	} finally {
		foundry.applications.api.DialogV2.prompt = prompt;
		delete foundry.applications.api.DialogV2.wait;
		foundry.utils.randomID = randomID;
		clearAppearanceOverride();
	}
});

test('trailing plus edits built-ins directly, reset confirms and new palettes are selected ready for additions', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	await selectTab(app, 'palettes');
	const before = structuredClone(stored['foundryshop.sharedPalettes']);
	let add = app.content.querySelector('[data-action="paletteSave"]');
	await actions.paletteSave.call(app, {}, add);
	assert.deepEqual(stored['foundryshop.sharedPalettes'], before, 'cancelled add leaves defaults unstored');
	dialogResult = { name: 'Blue accent', color: '#112233' };
	await actions.paletteSave.call(app, {}, add);
	assert.equal(app.content.querySelectorAll('[data-action="useColor"]').length, 21);
	assert.equal(stored['foundryshop.sharedPalettes'].palettes.find(p => p.id === 'builtin-fantasy').colors.at(-1).name, 'Blue accent');
	assert.equal(stored['core.drawingPalette'].strokeColor, '#123456');
	dialogResult = false;
	await actions.paletteReset.call(app, {}, button('paletteReset', { paletteId: 'builtin-fantasy' }));
	assert.equal(app.content.querySelectorAll('[data-action="useColor"]').length, 21);
	dialogResult = true;
	await actions.paletteReset.call(app, {}, button('paletteReset', { paletteId: 'builtin-fantasy' }));
	assert.deepEqual(stored['foundryshop.sharedPalettes'].palettes, before.palettes);
	assert.equal(app.content.querySelectorAll('[data-action="useColor"]').length, 20);
	dialogResult = 'My palette';
	await actions.sharedCreate.call(app, {}, button('sharedCreate'));
	assert.equal(app._selectedPalette, 'new-id');
	assert.equal(app.content.querySelectorAll('[data-action="useColor"]').length, 0);
	add = app.content.querySelector('[data-action="paletteSave"]');
	assert.equal(add.dataset.paletteId, 'new-id');
	dialogResult = { name: 'Accent', color: '#445566' };
	await actions.paletteSave.call(app, {}, add);
	assert.equal(stored['foundryshop.sharedPalettes'].palettes.at(-1).colors[0].color, '#445566');
	assert.equal(app.content.querySelectorAll('[data-action="useColor"]').length, 1);
	await app.close();
	await Drawing_Toolbox.show();
	assert.equal(Drawing_Toolbox._instance._selectedPalette, 'new-id');
	dialogResult = true;
	await actions.sharedDelete.call(Drawing_Toolbox._instance, {}, button('sharedDelete', { paletteId: 'new-id' }));
	assert.equal(Drawing_Toolbox._instance._selectedPalette, 'builtin-fantasy');
	assert.equal(stored['foundryshop.toolboxState'].selectedPalette, 'builtin-fantasy');
});

test('local material picker validates before changing future defaults and rejects stale selection', async () => {
	const previous = { apps: foundry.applications.apps, fetch: globalThis.fetch, bitmap: globalThis.createImageBitmap,
		pixi: globalThis.PIXI, location: globalThis.location };
	let picker, closed = 0;
	foundry.applications.apps = { FilePicker: { implementation: class {
		constructor(options) { this.options = options; picker = this; }
		addEventListener(name, callback) { this.onClose = callback; }
		async render(options) { assert.equal(options.force, true); this.rendered = true; }
		async close() { this.rendered = false; this.onClose(); }
		bringToFront() {}
	} } };
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.PIXI = { BaseTexture: class {}, Texture: class { valid = true; destroy() { closed++; } } };
	globalThis.createImageBitmap = async () => ({ width: 10, height: 20, close() { closed++; } });
	globalThis.fetch = async () => {
		const bytes = new Uint8Array(33);
		bytes[0] = 137; bytes.set([80, 78, 71], 1); bytes.set([73, 72, 68, 82], 12);
		const view = new DataView(bytes.buffer); view.setUint32(8, 13); view.setUint32(16, 10); view.setUint32(20, 20);
		return new Response(bytes);
	};
	try {
		await Drawing_Toolbox.show();
		const app = Drawing_Toolbox._instance;
		const before = structuredClone(stored['core.drawingPalette']);
		const repeatInput = app.content.querySelector('[data-brush="materialRepeat"]');
		assert.equal(repeatInput.value, '1');
		await repeatInput.listeners.change[0]();
		assert.equal(stored['foundryshop.materialRepeat'], 1);
		assert.equal(stored['core.drawingPalette'].materialRepeat, undefined);
		assert.equal(app.content.querySelectorAll('[data-action="materialSelect"]').length, 0, 'closed picker requests no thumbnails');
		await actions.materialChoose.call(app, {}, button('materialChoose'));
		assert.equal(app.content.querySelectorAll('[data-action="materialSelect"]').length, 15);
		assert.ok(app.content.querySelectorAll('[data-material-image]').every(img => img.attributes.loading === 'lazy'));
		const renders = app.renders;
		const search = app.content.querySelector('[data-material-search]');
		search.listeners.input[0]({ target: { value: 'wood' } });
		assert.equal(app.content.querySelectorAll('[data-action="materialSelect"]').filter(card => !card.hidden).length, 2);
		assert.equal(app.renders, renders, 'search preserves input focus without rerendering');
		search.listeners.input[0]({ target: { value: 'unknown entry' } });
		assert.equal(app.content.querySelector('[data-material-empty]').hidden, false);
		search.listeners.input[0]({ target: { value: '' } });
		const image = app.content.querySelector('[data-material-image]');
		image.listeners.error[0]();
		assert.equal(image.hidden, true);
		assert.equal(app.content.querySelector('[data-material-error="rough-stone"]').hidden, false);
		await actions.materialSelect.call(app, {}, button('materialSelect', { materialId: 'rough-stone' }));
		assert.equal(stored['core.drawingPalette'].texture, 'modules/foundryshop/assets/materials/rough-stone.png');
		assert.equal(app.content.querySelector('[data-action="materialSelect"]').attributes['aria-pressed'], 'true');
		assert.equal(closed, 2);
		await actions.materialSelect.call(app, {}, button('materialSelect', { materialId: 'missing' }));
		assert.match(errors.at(-1), /Materials.Unknown/);
		await actions.materialClear.call(app, {}, button('materialClear'));
		assert.equal(stored['core.drawingPalette'].texture, null);
		closed = 0;
		const current = structuredClone(stored['core.drawingPalette']);
		await actions.materialBrowse.call(app, {}, button('materialBrowse'));
		await picker.close();
		assert.deepEqual(stored['core.drawingPalette'], current, 'picker cancellation does not mutate defaults');
		await actions.materialBrowse.call(app, {}, button('materialBrowse'));
		await picker.options.callback('https://external.example/a.png');
		assert.match(errors.at(-1), /LocalOnly/);
		await picker.options.callback('worlds/test/stone.png');
		assert.equal(stored['core.drawingPalette'].texture, 'worlds/test/stone.png');
		assert.equal(stored['core.drawingPalette'].fillType, 2);
		assert.equal(stored['core.drawingPalette'].fillColor, before.fillColor);
		assert.equal(updates.length, 0, 'material selection never edits existing artwork');
		assert.equal(closed, 2);
		await actions.noFill.call(app);
		assert.equal(stored['core.drawingPalette'].fillType, 0);
		await actions.noFill.call(app);
		assert.equal(stored['core.drawingPalette'].fillType, 2, 're-enabling fill restores the selected material');
		await actions.noFill.call(app);
		app._target = 'fill';
		await actions.recentColor.call(app, {}, button('recentColor', { color: '#ffffff' }));
		assert.equal(stored['core.drawingPalette'].fillType, 2, 'choosing a tint preserves texture mode');
		await picker.close();
		await actions.materialBrowse.call(app, {}, button('materialBrowse'));
		stored['core.drawingPalette'].strokeWidth = 12;
		await picker.options.callback('worlds/test/other.png');
		assert.match(errors.at(-1), /Materials.Changed/);
		assert.equal(stored['core.drawingPalette'].texture, 'worlds/test/stone.png');
		await actions.materialClear.call(app, {}, button('materialClear'));
		assert.equal(stored['core.drawingPalette'].texture, null);
		assert.equal(stored['core.drawingPalette'].fillType, 1);
		const set = game.settings.set, renderCount = app.renders;
		game.settings.set = async () => { throw new Error('Material storage failed'); };
		try {
			await actions.materialSelect.call(app, {}, button('materialSelect', { materialId: 'brick' }));
			assert.match(errors.at(-1), /Material storage failed/);
			assert.equal(app.renders, renderCount, 'failed persistence is not reported as a successful selected material');
			assert.equal(stored['core.drawingPalette'].texture, null);
		} finally { game.settings.set = set; }
		let finishDecode, beganDecode;
		const started = new Promise(resolve => { beganDecode = resolve; });
		globalThis.createImageBitmap = async () => {
			beganDecode();
			return new Promise(resolve => { finishDecode = () => resolve({ width: 10, height: 20, close() { closed++; } }); });
		};
		const pending = actions.materialSelect.call(app, {}, button('materialSelect', { materialId: 'ice' }));
		await started;
		await app.close();
		finishDecode();
		await pending;
		assert.equal(stored['core.drawingPalette'].texture, null, 'closing aborts in-flight material selection even if decoding completes late');
	} finally {
		foundry.applications.apps = previous.apps; globalThis.fetch = previous.fetch;
		globalThis.createImageBitmap = previous.bitmap; globalThis.PIXI = previous.pixi; globalThis.location = previous.location;
	}
});

test('theme switching defaults to slate, opts into the active system and removes that class on return', async () => {
	game.system = { id: 'D35E' };
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	assert.equal(app.element.dataset.toolboxTheme, undefined);
	assert.equal(app.element.attributes['data-toolbox-theme'], 'slate');
	stored['foundryshop.toolboxTheme'] = 'system';
	await app.render();
	assert.equal(app.element.classList.contains('D35E'), true);
	assert.equal(app.element.attributes['data-toolbox-theme'], 'system');
	stored['foundryshop.toolboxTheme'] = 'foundry';
	await app.render();
	assert.equal(app.element.classList.contains('D35E'), false);
	assert.equal(app.element.attributes['data-toolbox-theme'], 'foundry');
	await selectTab(app, 'settings');
	const input = app.content.querySelector('[data-setting="toolboxTheme"]');
	assert.deepEqual(input.children.map(option => option.attributes.value), ['slate', 'foundry', 'system']);
	input.value = 'slate';
	await input.listeners.change[0]({});
	assert.equal(stored['foundryshop.toolboxTheme'], 'slate');
	assert.equal(app.element.attributes['data-toolbox-theme'], 'slate');
});

test('flyout positioning uses its actual positioned parent and movement never alters the toolbox size', async () => {
	Drawing_Toolbox.createLayerPanel = () => ({
		context: async () => ({ rows: [], unassignedCount: 0 }), bind() {}, render: async () => '',
	});

	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	const before = { ...app.position };
	await actions.layers.call(app);
	const panel = app.content.querySelector('.fshop-tb-layer-flyout');
	const parent = new FakeElement('section');
	parent.getBoundingClientRect = () => ({ left: 50, top: 100, width: 300, height: 400 });
	panel.offsetParent = parent;
	app.setPosition({ left: 80 });
	assert.equal(panel.style.top, '-40px');
	assert.equal(panel.style.left, '308px');
	assert.equal(app.position.width, before.width);
	assert.equal(app.position.height, before.height);
	assert.equal(app.element.attributes['data-layer-flyout'], 'true');
	await actions.layers.call(app);
	assert.equal(app.element.attributes['data-layer-flyout'], 'false');
});

test('flyout captures the opening pointer once, retains it across refresh/movement and resets on reopening', async () => {
	Drawing_Toolbox.createLayerPanel = () => ({
		context: async () => ({ rows: [], unassignedCount: 0 }), bind() {}, render: async () => '',
	});
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	const event = { clientX: 500, clientY: 200, detail: 1 };
	await actions.layers.call(app, event);
	assert.deepEqual(app._flyoutAnchor, { x: 500, y: 200 });
	event.clientX = 900;
	await app.render();
	app.setPosition({ left: 100 });
	assert.deepEqual(app._flyoutAnchor, { x: 500, y: 200 });
	assert.equal(app.content.querySelector('.fshop-tb-layer-flyout').style.left, '458px');
	await actions.layers.call(app);
	await actions.layers.call(app, { clientX: 0, clientY: 0, detail: 0 });
	assert.deepEqual(app._flyoutAnchor, { x: 350, y: 60 }, 'keyboard opening uses the button, not synthetic zero coordinates');
	await actions.layers.call(app);
	await actions.layers.call(app, { clientX: 950, clientY: 750, detail: 1 });
	assert.deepEqual(app._flyoutAnchor, { x: 950, y: 750 });
	assert.equal(app.content.querySelector('.fshop-tb-layer-flyout').dataset.side, 'left');
});

test('closing suppresses queued hook refreshes and flyout dismissal renders', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	const before = app.renders;
	app.requestRefresh();
	const closed = app.close({ foundryshopHide: true });
	app._layerFlyout = true;
	app._dismissFlyout({ target: {} });
	app._escapeFlyout({ key: 'Escape', preventDefault() { throw new Error('Unexpected dismissal during close'); } });
	await closed;
	await flush();
	assert.equal(app.renders, before);
	assert.equal(app.rendered, false);
});

test('tool buttons use Foundry scene-control activation', async () => {
	await Drawing_Toolbox.show();
	await actions.tool.call(Drawing_Toolbox._instance, {}, button('tool', { tool: 'freehand' }));
	assert.deepEqual(activations.at(-1), { control: 'drawings', tool: 'freehand' });
});

test('new personal/shared saves suggest editable names while editing retains the saved name', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	stored['core.drawingPalette'].strokeColor = '#80d5aa';
	const prompt = foundry.applications.api.DialogV2.prompt;
	const names = [];
	try {
		foundry.applications.api.DialogV2.prompt = async options => {
			const inputs = [...options.content.walk()].filter(node => node.tagName === 'INPUT');
			names.push(inputs.find(input => input.attributes.name === 'name').value);
			return null;
		};
		await actions.paletteSave.call(app, {}, button('paletteSave'));
		await actions.paletteSave.call(app, {}, button('paletteSave', { paletteId: 'shared1' }));
		await actions.paletteEdit.call(app, {}, button('paletteEdit', { paletteId: 'shared1', id: 'c1' }));
		assert.equal(names[0], names[1]);
		assert.match(names[0], /ColorNames.Tone.Light/);
		assert.equal(names[2], 'Blood');
	} finally { foundry.applications.api.DialogV2.prompt = prompt; }
});

test('whole-window scale persists numeric values on release and presets include the flyout scale', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	assert.equal(app.position.scale, 1);
	await selectTab(app, 'settings');
	const input = app.content.querySelector('[data-setting="toolboxScale"]');
	assert.equal(input.attributes.min, '50'); assert.equal(input.attributes.max, '125');
	input.value = '75';
	input.listeners.input[0]();
	assert.equal(app.content.querySelector('[data-scale-value]').textContent, '75%');
	assert.equal(app.position.scale, 1, 'no shrinking the slider while dragging it');
	await input.listeners.change[0]({});
	assert.equal(stored['foundryshop.toolboxScale'], 75);
	assert.equal(app.position.scale, 0.75);
	await actions.scalePreset.call(app, {}, button('scalePreset', { scale: '50' }));
	assert.equal(app.position.scale, 0.5);
	assert.equal(app.element.style['--fshop-scale'], 0.5);
	await actions.scalePreset.call(app, {}, button('scalePreset', { scale: '100' }));
	assert.equal(app.position.scale, 1);
});

test('scaled auto-size clamping uses untransformed dimensions before native measurement changes them', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	const native = Application.prototype._updatePosition;
	app.element.offsetWidth = 408; app.element.offsetHeight = 201;
	try {
		Application.prototype._updatePosition = function(position) {
			this.element.offsetHeight = 100;
			return { ...position };
		};
		const result = app._updatePosition({ left: 999, top: 799, scale: 0.5 });
		assert.equal(result.left, 796);
		assert.equal(result.top, 699.5);
	} finally { Application.prototype._updatePosition = native; }
});

test('8button layout keeps icon tabs, compact brush controls and eight recent colors in separate rows', async () => {
	stored['foundryshop.recent_colors'] = [
		'#AABBCC', '#aabbcc', 'invalid', '#112233', '#223344', '#334455', '#445566', '#556677', '#667788', '#778899', '#8899aa',
	];
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	const checkRows = () => {
		assert.equal(app.content.querySelector('.fshop-tb-tools').children.length, 9);
		const quick = app.content.querySelector('.fshop-tb-quick');
		const recent = quick.querySelector('.fshop-tb-recent');
		assert.deepEqual(recent.querySelectorAll('[data-action="recentColor"]').map(node => node.dataset.color),
			['#aabbcc', '#112233', '#223344', '#334455', '#445566', '#556677', '#667788', '#778899']);
		const colors = quick.querySelector('.fshop-tb-colors');
		assert.ok(colors.querySelector('[data-action="swap"]'));
		assert.ok(colors.querySelector('[data-action="noFill"]'));
		assert.ok(colors.querySelector('select[data-brush-preset]'));
		assert.equal(colors.querySelectorAll('.fshop-tb-chip').length, 2);
		assert.equal(quick.querySelector('[data-target="stroke"]').children[0].tagName, 'I');
		assert.deepEqual(quick.querySelectorAll('[data-alpha]').map(node => node.dataset.alpha), ['stroke', 'fill']);
		assert.equal(app.content.querySelectorAll('[data-alpha]').length, 2, 'no duplicate tab sliders');
		assert.equal(quick.querySelector('.fshop-tb-width').attributes['aria-label'], 'FOUNDRYSHOP.Toolbox.Width');
		assert.deepEqual(quick.querySelectorAll('[data-action="widthSet"]').map(node => node.dataset.width), ['2', '4', '8', '16', '32']);
	};
	checkRows();
	const strip = app.content.querySelectorAll('button[data-tab]');
	assert.deepEqual(strip.map(tab => tab.dataset.group), ['brush', 'palettes', 'layers', 'assets']);
	for (const tab of strip) {
		assert.equal(tab.children.length, 2);
		assert.equal(tab.children[0].tagName, 'I');
		assert.equal(tab.children[0].attributes['aria-hidden'], 'true');
		assert.equal(tab.children[1].textContent, `FOUNDRYSHOP.Toolbox.Group.${tab.dataset.group}`);
		assert.equal(tab.attributes['data-tooltip-text'], `FOUNDRYSHOP.Toolbox.Group.${tab.dataset.group}`);
		assert.equal(tab.attributes.title, undefined);
	}
	await actions.target.call(app, {}, button('target', { target: 'fill' }));
	await flush();
	assert.equal(app.content.querySelectorAll('[data-alpha]').length, 2, 'both opacities remain independent of active color target');
	armLabel('Hall', 'repeat');
	await actions.collapse.call(app);
	await flush();
	checkRows();
	assert.ok(app.content.querySelector('[data-action="labelMode"]'), 'armed-label disarm stays accessible outside eight-button tools');
});

test('style actions write tagged drawing defaults: swap, no fill, width, swatches', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	await actions.swap.call(app, {});
	assert.equal(stored['core.drawingPalette'].strokeColor, '#abcdef');
	assert.equal(stored['core.drawingPalette'].fillColor, '#123456');
	assert.equal(writes.findLast(write => write.key === 'core.drawingPalette').options.foundryshopSource, 'toolbox');
	await actions.noFill.call(app, {});
	assert.equal(stored['core.drawingPalette'].fillType, 0);
	await actions.width.call(app, { shiftKey: true }, button('width', { delta: '-1' }));
	assert.equal(stored['core.drawingPalette'].strokeWidth, 3);
	await actions.width.call(app, { shiftKey: true }, button('width', { delta: '-1' }));
	assert.equal(stored['core.drawingPalette'].strokeWidth, 0);
	actions.target.call(app, {}, button('target', { target: 'fill' }));
	await actions.useColor.call(app, {}, button('useColor', { id: 'c1' }));
	assert.equal(stored['core.drawingPalette'].fillColor, '#aa0000');
	assert.equal(stored['core.drawingPalette'].fillType, 1, 'choosing a fill color re-enables fill');
	await actions.useColor.call(app, {}, button('useColor', { id: 'missing' }));
	assert.equal(errors.length, 1);
});

test('mouse wheel over the width row adjusts line width (Shift: 5) and ignores zero deltas', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	let prevented = 0;
	// Each render replaces the row, so always dispatch to the current one.
	const wheel = (deltaY, shiftKey = false) => app.element.querySelector('.fshop-tb-width')
		.listeners.wheel[0]({ deltaY, deltaX: 0, shiftKey, preventDefault: () => prevented++ });
	const before = writes.length;
	wheel(-100);
	await flush();
	wheel(-100);
	await flush();
	assert.equal(stored['core.drawingPalette'].strokeWidth, 10);
	assert.equal(app.element.querySelector('.fshop-tb-width').querySelector('.fshop-tb-value').textContent, '10');
	wheel(100, true);
	await flush();
	assert.equal(stored['core.drawingPalette'].strokeWidth, 5);
	wheel(0);
	assert.equal(prevented, 3);
	assert.ok(writes.length > before);
});

test('width slider and quick sizes set line width; slider input previews then commits', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	await actions.widthSet.call(app, {}, button('widthSet', { width: '16' }));
	assert.equal(stored['core.drawingPalette'].strokeWidth, 16);
	await flush();
	assert.equal(app.element.querySelector('[data-width="16"]').attributes['aria-pressed'], 'true');
	const slider = app.element.querySelector('input[data-width-slider]');
	slider.value = '24';
	slider.listeners.input[0]({ target: slider });
	await flush();
	assert.equal(stored['core.drawingPalette'].strokeWidth, 24);
});

test('brush presets: starters apply as a patch, save captures current brush, delete confirms', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	const select = () => app.element.querySelector('select[data-brush-preset]');
	const ids = select().children.map(option => option.attributes.value);
	assert.deepEqual(ids, ['', 'starter-wall', 'starter-sketch', 'starter-floor', 'starter-water']);
	select().listeners.change[0]({ target: { value: 'starter-water' } });
	await flush();
	const palette = stored['core.drawingPalette'];
	assert.equal(palette.fillColor, '#8faeb0');
	assert.equal(palette.fillAlpha, 0.6);
	assert.equal(palette.strokeWidth, 4);
	assert.equal(palette.texture, null);
	assert.equal(app.element.querySelector('[data-action="brushPresetDelete"]').dataset.id, 'starter-water');
	const { prompt, confirm } = foundry.applications.api.DialogV2;
	try {
		foundry.applications.api.DialogV2.prompt = async () => 'My ink';
		await actions.brushPresetSave.call(app, {});
		const saved = stored['foundryshop.brushPresets'].presets.at(-1);
		assert.equal(saved.name, 'My ink');
		assert.equal(saved.patch.fillColor, '#8faeb0');
		assert.equal(saved.patch.texture, undefined, 'non-pattern presets do not store textures');
		foundry.applications.api.DialogV2.confirm = async () => false;
		await actions.brushPresetDelete.call(app, {}, button('brushPresetDelete', { id: 'starter-wall' }));
		assert.equal(stored['foundryshop.brushPresets'].presets.length, 5);
		foundry.applications.api.DialogV2.confirm = async () => true;
		await actions.brushPresetDelete.call(app, {}, button('brushPresetDelete', { id: 'starter-wall' }));
		assert.deepEqual(stored['foundryshop.brushPresets'].presets.map(preset => preset.id),
			['starter-sketch', 'starter-floor', 'starter-water', 'new-id']);
	} finally { Object.assign(foundry.applications.api.DialogV2, { prompt, confirm }); }
});

test('corrupt brush presets disable the preset controls without breaking the brush bar', async () => {
	stored['foundryshop.brushPresets'] = { schemaVersion: 9 };
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	assert.equal(select(app).attributes.disabled, '');
	assert.ok(app.element.querySelector('.fshop-tb-width'));
	function select(app) { return app.element.querySelector('select[data-brush-preset]'); }
});

test('rail Label/Stamp tools toggle placement and the selection bar appears only with a selection', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	assert.equal(app.content.querySelector('.fshop-tb-selection'), null);
	assert.ok(app.content.querySelector('[data-action="railLabel"]'));
	assert.ok(app.content.querySelector('[data-action="railStamp"]'));
	app._labelDraft = { text: 'Crypt', style: { fontFamily: 'Signika', fontSize: 48, textColor: '#302b26', textAlpha: 1 } };
	await actions.railLabel.call(app, {});
	assert.equal(app._tab, 'labels');
	assert.equal(getLabelState().text, 'Crypt');
	assert.notEqual(getLabelState().mode, 'off');
	assert.equal(app.content.querySelector('[data-action="railLabel"]').attributes['aria-pressed'], 'true');
	await actions.railLabel.call(app, {});
	assert.equal(getLabelState().mode, 'off');
	const infos = [];
	ui.notifications.info = message => infos.push(message);
	try {
		await actions.railStamp.call(app, {});
		assert.equal(app._tab, 'library');
		assert.deepEqual(infos, ['FOUNDRYSHOP.Toolbox.Rail.StampEmpty']);
	} finally { delete ui.notifications.info; }
	const drawing = makeDrawing({ text: 'Hall' });
	canvas.drawings.controlled = [drawing];
	await app.render();
	const bar = app.content.querySelector('.fshop-tb-selection');
	assert.ok(bar.querySelector('[data-action="selectionEdit"]'));
	assert.ok(bar.querySelector('[data-action="stampCopy"]'));
	canvas.drawings.controlled = [drawing, makeDrawing({ id: 'd2' })];
	await app.render();
	assert.equal(app.content.querySelector('.fshop-tb-selection').querySelector('[data-action="selectionEdit"]'), null);
	assert.equal(app.content.querySelector('.fshop-tb-selection').querySelector('.fshop-tb-hint').textContent,
		'FOUNDRYSHOP.Toolbox.SelectOne');
	canvas.drawings.controlled = [];
	await app.close();
});

test('Path replaces native Text in the nine-button rail; native Text in Labels cancels saved label placement', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	const rail = app.content.querySelector('.fshop-tb-tools');
	assert.equal(rail.children.length, 9);
	assert.ok(rail.querySelector('[data-action="pathArm"]'));
	assert.equal(rail.querySelector('[data-tool="text"]'), null);
	await selectTab(app, 'labels');
	const text = app.content.querySelector('[data-tool="text"]');
	assert.ok(text);
	armLabel('Tunnel', 'next');
	await actions.tool.call(app, {}, text);
	assert.equal(getLabelState().mode, 'off');
});

test('selection discovers retained path and renders numbered numeric draft controls with read-only Cancel', async () => {
	canvas.grid = { size: 100 };
	const scene = canvas.scene;
	scene.canUserModify = () => true;
	stored['foundryshop.layerWorkspace'] = {version:1,scenes:{}};
	const recipe = createPathRecipe([{x:100,y:100},{x:200,y:150}],{style:'plain'});
	const data = { _id:'d1', ...buildPathDrawings(recipe.waypoints,recipe.options)[0],
		sort:1024,author:'gm',elevation:0,levels:['ground'],fontFamily:'Signika',fontSize:48,textColor:'#ffffff',textAlpha:1,
		flags:{foundryshop:{layerId:'ink',path:{version:1,id:'route',role:'path'}}} };
	const drawing = makeDrawing({toObject:()=>structuredClone(data),flags:data.flags});
	scene.drawings.set('d1',drawing.document);
	const route = {id:'route',revision:0,name:'Test route',layerId:'ink',levelId:'ground',elevation:0,recipe,
		components:[{drawingId:'d1',role:'path',baseline:pathComponentBaseline(drawing.document)}]};
	scene.getFlag = (namespace,key) => key==='paths' ? {version:1,revision:0,routes:[route]}
		: key==='layers' ? {version:1,revision:0,presets:[],nodes:[{id:'ink',name:'Ink',kind:'layer',parentId:null,locked:false,playerAllowed:true,defaults:{}}]} : undefined;
	const app = new Drawing_Toolbox();
	canvas.drawings.controlled = [drawing];
	globalThis.PIXI = {Graphics:class {
		clear(){} lineStyle(){} moveTo(){} lineTo(){} beginFill(){} endFill(){} drawCircle(){} destroy(){}
	}};
	try {
		await app.render({force:true});
		assert.ok(app.content.querySelector('[data-action="pathEdit"]'));
		await actions.pathEdit.call(app,{},app.content.querySelector('[data-action="pathEdit"]'));
		assert.equal(getPathEditorState().active,true, errors.join('\n'));
		assert.equal(app.content.querySelector('[data-path-waypoint]').children.length,2);
		const x=app.content.querySelector('[data-path-coordinate="x"]');
		x.value='120';x.listeners.change[0]();
		assert.equal(getPathEditorState().recipe.waypoints[0].x,120);
		assert.equal(route.recipe.waypoints[0].x,100);
		const mode=app.content.querySelector('[data-path-point-mode]');
		assert.equal(mode.children.length,3);
		mode.value='corner';mode.listeners.change[0]();
		await app.render({force:true});
		const handle=app.content.querySelector('[data-path-handle="outgoing"]');
		assert.ok(handle);
		handle.value='170';handle.listeners.change[0]();
		assert.equal(getPathEditorState().recipe.waypoints[0].outgoing.x,170);
		assert.equal(route.recipe.waypoints[0].mode,'automatic');
		const opacity=app.content.querySelector('[data-path-edit-setting="alpha"]');
		opacity.valueAsNumber=0.3;opacity.listeners.change[0]();
		assert.equal(getPathEditorState().recipe.options.alpha,0.3);
		const width=app.content.querySelector('[data-path-edit-setting="width"]');
		width.valueAsNumber=0.03;width.listeners.change[0]();
		assert.equal(getPathEditorState().recipe.options.width,0.03);
		assert.equal(route.recipe.options.width,0.6);
		const oldPrompt=foundry.applications.api.DialogV2.prompt;
		try{
			foundry.applications.api.DialogV2.prompt=async()=>null;
			await actions.pathTranslate.call(app,{},button('pathTranslate'));
			assert.equal(getPathEditorState().recipe.waypoints[0].x,120);
			foundry.applications.api.DialogV2.prompt=async()=>({x:30,y:-10});
			await actions.pathTranslate.call(app,{},button('pathTranslate'));
			assert.equal(getPathEditorState().recipe.waypoints[0].x,150);
			assert.equal(getPathEditorState().recipe.waypoints[0].outgoing.x,200);
			assert.equal(route.recipe.waypoints[0].x,100);
			assert.notEqual(app.content.querySelector('[data-action="pathDraftUndo"]').disabled,true);
			await actions.pathDraftUndo.call(app,{},button('pathDraftUndo'));
			assert.equal(getPathEditorState().recipe.waypoints[0].x,120);
			await actions.pathDraftRedo.call(app,{},button('pathDraftRedo'));
			assert.equal(getPathEditorState().recipe.waypoints[0].x,150);
			foundry.applications.api.DialogV2.prompt=async options=>{
				assert.throws(()=>options.ok.callback({}, {form:{elements:{x:{value:''},y:{value:'1'}}}}),/EditorCoordinate/);
				assert.throws(()=>options.ok.callback({}, {form:{elements:{x:{value:'Infinity'},y:{value:'1'}}}}),/EditorCoordinate/);
				return null;
			};
			await actions.pathTranslate.call(app,{},button('pathTranslate'));
			assert.equal(getPathEditorState().recipe.waypoints[0].x,150);
		}finally{foundry.applications.api.DialogV2.prompt=oldPrompt;}
		const closed=app.content.querySelector('[data-path-edit-setting="closed"]');
		closed.checked=true;closed.listeners.change[0]();
		assert.equal(getPathEditorState().recipe.closed,false,'invalid two-point closure keeps the draft');
		await actions.pathEditCancel.call(app,{},button('pathEditCancel'));
		assert.equal(getPathEditorState().active,false);
		assert.equal(app.content.querySelector('.fshop-path-editor'),null);
		assert.equal(route.revision,0);
		let confirmations=0;
		const oldConfirm=foundry.applications.api.DialogV2.confirm;
		foundry.applications.api.DialogV2.confirm=async()=>{confirmations++;return false;};
		try{
			await actions.pathDeleteWhole.call(app,{},button('pathDeleteWhole',{pathId:'route'}));
			await actions.pathDetach.call(app,{},button('pathDetach',{pathId:'route'}));
			assert.equal(confirmations,2);assert.equal(scene.drawings.size,1);assert.equal(route.revision,0);
		}finally{foundry.applications.api.DialogV2.confirm=oldConfirm;}
		data.x++;
		await app.render({force:true});
		assert.ok(app.content.querySelector('[data-action="pathConflict"]'));
		foundry.applications.api.DialogV2.confirm=async options=>{
			assert.ok(options.content.textContent.includes('FOUNDRYSHOP.Paths.ConflictDetachHint'));
			return false;
		};
		try{
			await actions.pathConflict.call(app,{},button('pathConflict',{pathId:'route'}));
			assert.equal(route.revision,0);assert.equal(scene.drawings.size,1);
		}finally{foundry.applications.api.DialogV2.confirm=oldConfirm;}
		canvas.drawings.controlled=[];
		await selectTab(app,'brush');
		assert.ok(app.content.querySelector('[data-retained-path]'));
		assert.ok(app.content.querySelector('[data-action="pathConflict"]'),'damaged routes can be reviewed without native selection');
	} finally { cancelPathEdit(); await app.close(); }
});

test('path preset GUI applies settings, rerolls only variation and saves/deletes with explicit dialogs',async()=>{
	await Drawing_Toolbox.show();const app=Drawing_Toolbox._instance;
	configurePath({style:'river',meander:0.2,width:1.2,closed:false});
	await app.render({force:true});
	const seed=getPathState().seed;
	await actions.pathReroll.call(app,{},button('pathReroll',{editing:'false'}));
	assert.notEqual(getPathState().seed,seed);
	const {prompt,confirm}=foundry.applications.api.DialogV2;
	try{
		foundry.applications.api.DialogV2.prompt=async()=> 'Blue river';
		await actions.pathPresetSave.call(app,{},button('pathPresetSave',{editing:'false'}));
		const saved=stored['foundryshop.pathPresets'].presets.at(-1);
		assert.equal(saved.name,'Blue river');assert.equal(saved.options.style,'river');assert.equal(saved.options.width,1.2);
		const select=app.content.querySelector('[data-path-preset]');
		select.value='starter-plain';select.listeners.change[0]();
		assert.equal(getPathState().style,'plain');assert.equal(getPathState().width,0.03);
		assert.equal(getPathState().seed,saved.options.seed);
		foundry.applications.api.DialogV2.confirm=async()=>false;
		await actions.pathPresetDelete.call(app,{},button('pathPresetDelete',{id:saved.id,editing:'false'}));
		assert.equal(stored['foundryshop.pathPresets'].presets.length,5);
		foundry.applications.api.DialogV2.confirm=async()=>true;
		await actions.pathPresetDelete.call(app,{},button('pathPresetDelete',{id:saved.id,editing:'false'}));
		assert.equal(stored['foundryshop.pathPresets'].presets.length,4);
	}finally{Object.assign(foundry.applications.api.DialogV2,{prompt,confirm});}
});

test('Path controls share smooth/straight shape and curve amount across all styles', async () => {
	configurePath({ style: 'railway', curve: 'smooth', smoothing: 1, meander: 0 });
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	await selectTab(app, 'brush');
	const curve = app.element.querySelector('[data-path-setting="curve"]');
	assert.equal(curve.children.length, 2);
	const amount = app.element.querySelector('[data-path-setting="smoothing"]');
	assert.equal(Number(amount.value), 1);
	amount.valueAsNumber = 0.4;
	amount.listeners.change[0]();
	assert.equal(getPathState().smoothing, 0.4);
	const style = app.element.querySelector('[data-path-setting="style"]');
	style.value = 'plain'; style.listeners.change[0]();
	assert.equal(getPathState().style, 'plain');
	await app.render();
	assert.equal(app.element.querySelector('[data-path-setting="spacing"]'), null);
	curve.value = 'straight'; curve.listeners.change[0]();
	assert.equal(getPathState().curve, 'straight');
	await app.render();
	assert.equal(app.element.querySelector('[data-path-setting="smoothing"]'), null);
	assert.equal(app.element.querySelector('[data-path-setting="width"]').attributes.min, '0.01');
	assert.equal(app.element.querySelector('[data-path-setting="bendSpacing"]'), null);
	const meander = app.element.querySelector('[data-path-setting="meander"]');
	meander.valueAsNumber = 0.3; meander.listeners.change[0]();
	await app.render();
	assert.equal(getPathState().meander, 0.3);
	const bend = app.element.querySelector('[data-path-setting="bendSpacing"]');
	assert.ok(bend);
	bend.valueAsNumber = 2; bend.listeners.change[0]();
	assert.equal(getPathState().bendSpacing, 2);
	configurePath({ style: 'railway', curve: 'smooth', smoothing: 1, meander: 0, bendSpacing: 4 });
});
test('alpha sliders persist on input and release focus afterwards', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	for (const [target, value] of [['fill', '0.25'], ['stroke', '0.65']]) {
		const slider = app.element.querySelector(`input[data-alpha="${target}"]`);
		assert.equal(slider.attributes['aria-label'], `FOUNDRYSHOP.Toolbox.Opacity.${target}`);
		slider.value = value;
		slider.listeners.input[0]({ target: slider });
		assert.equal(app.element.querySelector(`[data-alpha-value="${target}"]`).textContent, `${Number(value) * 100}%`);
		await flush();
		assert.equal(stored['core.drawingPalette'][`${target}Alpha`], Number(value));
		slider.listeners.change[0]({ target: slider });
		assert.equal(slider.blurred, true);
	}
	assert.equal(stored['core.drawingPalette'].fillAlpha, 0.25, 'stroke opacity does not change fill opacity');
});

test('Library exposes session stamp controls without extra tool buttons; image dialog cancellation is non-destructive', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	await selectTab(app, 'library');
	for (const action of ['stampCopy', 'stampImage', 'stampPaste', 'stampArm']) {
		assert.ok(app.content.querySelector(`[data-action="${action}"]`));
	}
	assert.equal(app.content.querySelector('[data-action="stampArm"]').attributes.disabled, '');
	assert.equal(app.content.querySelector('.fshop-tb-tools').children.length, 9);
	assert.equal(app.content.querySelector('[data-stamp-option="scale"]').value, '1');
	const repeat = app.content.querySelector('[data-stamp-option="repeat"]');
	repeat.checked = true; repeat.listeners.change[0]();
	assert.equal(app._stampOptions.repeat, true);
	const before = writes.length;
	await actions.stampImage.call(app, {}, button('stampImage'));
	assert.equal(writes.length, before);
	assert.equal(errors.length, 0);
	await actions.stampCopy.call(app, {}, button('stampCopy'));
	assert.equal(errors.length, 1, 'empty selection is reported explicitly');
	await selectTab(app, 'settings');
	const folder = app.content.querySelector('[data-setting="stampAssetFolder"]');
	folder.value = 'worlds/test/artwork';
	await folder.listeners.change[0]();
	assert.equal(stored['foundryshop.stampAssetFolder'], 'worlds/test/artwork');
});

test('project library cards disclose scope, search names without rerender, and preserve the 8button width', async () => {
	stored['foundryshop.projectLibraryFolder'] = 'worlds/test/library';
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	app._libraryRoot = 'worlds/test/library';
	app._libraryEntries = [
		{ path: 'worlds/test/library/quarry.json', name: 'Quarry', drawings: 2, thumbnail: {
			data: 'sample', width: 32, height: 32,
		} },
		{ path: 'worlds/test/library/forest.json', name: 'Forest', drawings: 3, thumbnail: null },
		{ path: 'worlds/test/library/bad.json', name: 'Bad file', error: 'Invalid package' },
	];
	await selectTab(app, 'library');
	assert.equal(app.content.querySelector('.fshop-tb-tools').children.length, 9);
	assert.equal(app.content.querySelectorAll('[data-library-path]').length, 5);
	assert.equal(app.content.querySelectorAll('[data-action="libraryImport"]').length, 4);
	assert.match(app.content.querySelectorAll('[data-library-image-status]')[2].textContent, /ThumbnailScope/);
	const image = app.content.querySelector('[data-library-image]');
	assert.equal(image.attributes.loading, 'lazy');
	const search = app.content.querySelector('[data-library-search]');
	const before = app.renders;
	search.listeners.input[0]({ target: { value: 'FOREST' } });
	const cards = app.content.querySelectorAll('[data-library-path]');
	assert.equal(cards[2].hidden, true); assert.equal(cards[3].hidden, false);
	assert.equal(app.renders, before);
	image.closest = () => cards[2];
	image.listeners.error[0]();
	assert.equal(image.hidden, true);
	assert.match(cards[2].querySelector('[data-library-image-status]').textContent, /ImageFailed/);
	await selectTab(app, 'settings');
	const folder = app.content.querySelector('[data-setting="projectLibraryFolder"]');
	folder.value = 'worlds/test/new-library';
	await folder.listeners.change[0]();
	assert.equal(stored['foundryshop.projectLibraryFolder'], 'worlds/test/new-library');
	assert.equal(app._libraryEntries, undefined);
});

test('example project cards work without a file folder and downloading or canceling import does not write artwork', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	await selectTab(app, 'library');
	assert.equal(app.content.querySelectorAll('[data-preview-project]').length, 2);
	assert.equal(app.content.querySelectorAll('[data-action="libraryImport"]').length, 2);
	assert.equal(app.content.querySelectorAll('[data-action="starterProjectDownload"]').length, 2);
	assert.equal(app._previewObserver.targets.filter(slot => slot.dataset.previewProject).length, 2);
	const downloads = [];
	const previous = foundry.utils.saveDataToFile;
	foundry.utils.saveDataToFile = (...args) => downloads.push(args);
	try {
		const before = writes.length;
		await actions.starterProjectDownload.call(app, {}, button('starterProjectDownload', { projectId: 'wayfarer' }));
		assert.equal(downloads.length, 1);
		assert.equal(JSON.parse(downloads[0][0]).tree.presets.length, 3);
		assert.equal(downloads[0][1], 'application/json');
		assert.equal(writes.length, before);
		assert.equal(canvas.scene.drawings.size, 0);
		canvas.level = { id: 'test-level' };
		canvas.scene.getFlag = () => undefined;
		await actions.libraryImport.call(app, {}, button('libraryImport', { libraryIndex: '1' }));
		assert.equal(writes.length, before, 'canceling the normal review creates nothing');
		assert.equal(canvas.scene.drawings.size, 0);
		assert.equal(app._libraryBusy, false);
		assert.equal(errors.length, 0);
		game.user.isGM = false;
		await actions.starterProjectDownload.call(app, {}, button('starterProjectDownload', { projectId: 'wayfarer' }));
		assert.equal(downloads.length, 1);
		assert.match(errors.at(-1), /GMOnly/);
	} finally { foundry.utils.saveDataToFile = previous; }
});

test('library save selection verifies a persistent file, refreshes typed cards and preserves Scene/stamp data', async () => {
	stored['foundryshop.projectLibraryFolder'] = 'worlds/test/library';
	const data = starterShape('textured-timber-table').project.drawings[0].data;
	const source = { ...data, _id: 'selected', author: 'me' };
	canvas.scene.getFlag = () => undefined;
	canvas.scene.grid = { type: 1, size: 100 };
	canvas.scene.levels = new Map([['ground', {}]]);
	canvas.level = { id: 'ground' };
	canvas.drawings.controlled = [makeDrawing({ id: 'selected', parent: canvas.scene,
		getFlag: () => undefined, toObject: () => structuredClone(source) })];
	canvas.scene.drawings.set('selected', canvas.drawings.controlled[0].document);
	const files = [], responses = new Map(), notices = [];
	const previousFetch = globalThis.fetch, previousLocation = globalThis.location;
	const previousDocumentClass = globalThis.getDocumentClass;
	globalThis.getDocumentClass = () => ({ metadata: { schemaVersion: '14.355' } });
	game.version = '14.365';
	const previousPicker = foundry.applications.apps, info = ui.notifications.info;
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.fetch = async url => new Response(responses.get(decodeURIComponent(url.pathname).slice(1)));
	foundry.applications.apps = { FilePicker: { implementation: {
		browse: async () => ({ files }),
		upload: async (kind, root, file) => {
			const path = `${root}/${file.name}`;
			responses.set(path, await file.text()); files.push(path); return { path };
		},
	} } };
	ui.notifications.info = message => notices.push(message);
	try {
		await Drawing_Toolbox.show();
		const app = Drawing_Toolbox._instance;
		await selectTab(app, 'library');
		assert.notEqual(app.content.querySelector('[data-action="librarySaveShape"]').attributes.disabled, '');
		const before = structuredClone(source), writeCount = writes.length;
		await actions.librarySaveShape.call(app);
		assert.equal(files.length, 0, 'canceled metadata prompt never uploads');
		dialogResult = { name: 'Saved table base', category: 'Furniture', tags: ['tavern'] };
		await actions.librarySaveShape.call(app);
		assert.equal(errors.length, 0);
		assert.equal(notices.length, 1);
		assert.equal(files.length, 1);
		assert.equal(app._libraryEntries[0].kind, 'shape');
		assert.equal(app.content.querySelectorAll('[data-action="libraryPlace"]').length, 1);
		assert.equal(writes.length, writeCount);
		assert.deepEqual(source, before);
		assert.equal(canvas.scene.drawings.size, 1);
		const kind = app.content.querySelector('[data-library-kind]');
		const savedCard = app.content.querySelectorAll('[data-library-path]').at(-1);
		kind.listeners.change[0]({ target: { value: 'project' } });
		assert.equal(savedCard.hidden, true);
		kind.listeners.change[0]({ target: { value: 'shape' } });
		assert.equal(savedCard.hidden, false);
		const prompt = foundry.applications.api.DialogV2.prompt;
		try {
			foundry.applications.api.DialogV2.prompt = async () => {
				source.fillColor = '#000000'; return dialogResult;
			};
			await actions.librarySaveShape.call(app);
			assert.equal(files.length, 1, 'artwork edited during metadata review blocks upload');
			assert.match(errors.at(-1), /Changed/);
			Object.assign(source, before);
		} finally { foundry.applications.api.DialogV2.prompt = prompt; }
		const browse = foundry.applications.apps.FilePicker.implementation.browse;
		let browses = 0;
		foundry.utils.randomID = () => 'another-id';
		try {
			foundry.applications.apps.FilePicker.implementation.browse = async (...args) => {
				if (++browses === 2) throw new Error('Refresh unavailable');
				return browse(...args);
			};
			await actions.librarySaveShape.call(app);
			assert.equal(files.length, 2, 'verified file remains after reindex failure');
			assert.match(errors.at(-1), /RefreshAfterSave/);
			assert.equal(app._libraryEntries, undefined);
		} finally {
			foundry.applications.apps.FilePicker.implementation.browse = browse;
			foundry.utils.randomID = () => 'new-id';
		}
		canvas.drawings.controlled = [];
		await actions.librarySaveShape.call(app);
		assert.equal(files.length, 2);
		assert.match(errors.at(-1), /SelectionLimit/);
	} finally {
		globalThis.fetch = previousFetch; globalThis.location = previousLocation;
		globalThis.getDocumentClass = previousDocumentClass;
		foundry.applications.apps = previousPicker; ui.notifications.info = info;
	}
});

test('Save current project adds a verified browser card without selection, preserves hidden artwork/layers and refuses stale changes', async () => {
	stored['foundryshop.projectLibraryFolder'] = 'worlds/test/library';
	canvas.scene.name = 'Saved Scene'; canvas.scene.id = 'scene1'; canvas.scene.grid = { type: 1, size: 100 };
	game.version = '14.365';
	const tree = { version: 1, revision: 0, nodes: [{ id: 'notes', name: 'Notes', kind: 'layer', parentId: null,
		playerAllowed: false, locked: false, defaults: { fillType: 0 } }], presets: [] };
	canvas.scene.getFlag = (n, key) => key === 'layers' ? structuredClone(tree) : undefined;
	const data = { ...structuredClone(starterShape('round-tree').project.drawings[0].data),
		_id: 'hidden', hidden: true, flags: { foundryshop: { layerId: 'notes' } } };
	canvas.scene.drawings.set('hidden', { id: 'hidden', toObject: () => structuredClone(data) });
	const files = [], responses = new Map(), notices = [];
	const original = { fetch: globalThis.fetch, location: globalThis.location, apps: foundry.applications.apps,
		info: ui.notifications.info, prompt: foundry.applications.api.DialogV2.prompt };
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.fetch = async url => new Response(responses.get(decodeURIComponent(url.pathname).slice(1)));
	foundry.applications.apps = { FilePicker: { implementation: {
		browse: async () => ({ files }),
		upload: async (kind, root, file) => { const path = `${root}/${file.name}`;
			responses.set(path, await file.text()); files.push(path); return { path }; },
	} } };
	ui.notifications.info = message => notices.push(message);
	try {
		await Drawing_Toolbox.show();
		const app = Drawing_Toolbox._instance;
		await selectTab(app, 'library');
		const save = app.content.querySelector('[data-action="librarySaveProject"]');
		assert.equal(save.attributes.disabled, undefined, 'project saving does not require a Drawing selection');
		await actions.librarySaveProject.call(app, {}, save);
		assert.equal(files.length, 0);
		dialogResult = { name: 'GM project', thumbnail: false };
		const writeCount = writes.length, before = structuredClone(data);
		await actions.librarySaveProject.call(app, {}, save);
		assert.equal(errors.length, 0);
		assert.equal(files[0], 'worlds/test/library/project-new-id.json');
		assert.equal(app._libraryEntries[0].kind, 'project');
		assert.equal(app.content.querySelectorAll('[data-action="libraryImport"]').length, 3);
		const saved = JSON.parse(responses.get(files[0]));
		assert.equal(saved.drawings[0].data.hidden, true);
		assert.equal(saved.tree.nodes[0].name, 'Notes');
		assert.equal(saved.name, 'GM project');
		assert.deepEqual(data, before);
		assert.equal(writes.length, writeCount);
		assert.equal(notices.length, 1);
		foundry.applications.api.DialogV2.prompt = async () => { data.strokeWidth++; return dialogResult; };
		await actions.librarySaveProject.call(app, {}, save);
		assert.match(errors.at(-1), /Changed/);
		assert.equal(files.length, 1);
		game.user.can = permission => permission !== 'FILES_UPLOAD';
		await app.render();
		assert.equal(app.content.querySelector('[data-action="librarySaveProject"]').attributes.disabled, '');
	} finally {
		globalThis.fetch = original.fetch; globalThis.location = original.location;
		foundry.applications.apps = original.apps; ui.notifications.info = original.info;
		foundry.applications.api.DialogV2.prompt = original.prompt;
	}
});

test('saved-file management edits JSON only after confirmation, duplicates independently and blocks uncertain replacements with repair cards', async () => {
	stored['foundryshop.projectLibraryFolder'] = 'worlds/test/library';
	const root = stored['foundryshop.projectLibraryFolder'], path = `${root}/shape-round-tree.json`;
	const source = starterShape('round-tree');
	const files = new Map([[path, JSON.stringify(source)]]), uploads = [], notices = [];
	const original = { fetch: globalThis.fetch, location: globalThis.location, apps: foundry.applications.apps,
		info: ui.notifications.info, id: foundry.utils.randomID };
	let nextId = 0;
	foundry.utils.randomID = () => `admin-id${++nextId}`;
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.fetch = async url => {
		const target = decodeURIComponent(url.pathname).slice(1);
		return new Response(files.get(target), { status: files.has(target) ? 200 : 404 });
	};
	foundry.applications.apps = { FilePicker: { implementation: {
		browse: async () => ({ files: [...files.keys()] }),
		upload: async (kind, folder, file) => {
			const target = `${folder}/${file.name}`;
			uploads.push(target); files.set(target, await file.text()); return { path: target };
		},
	} } };
	ui.notifications.info = message => notices.push(message);
	try {
		await Drawing_Toolbox.show();
		const app = Drawing_Toolbox._instance;
		await selectTab(app, 'library');
		await actions.libraryRefresh.call(app, {}, button('libraryRefresh'));
		assert.equal(app.content.querySelectorAll('[data-action="libraryEdit"]').length, 0);
		await actions.libraryManage.call(app);
		assert.equal(app.content.querySelectorAll('[data-action="libraryEdit"]').length, 1);
		assert.equal(app.content.querySelectorAll('[data-action="libraryDuplicate"]').length, 1);
		const index = '2', edit = button('libraryEdit', { libraryIndex: index });
		await actions.libraryEdit.call(app, {}, edit);
		assert.equal(uploads.length, 0);
		const prompt = foundry.applications.api.DialogV2.prompt, confirm = foundry.applications.api.DialogV2.confirm;
		try {
			foundry.applications.api.DialogV2.prompt = async () => ({ name: 'Library oak', category: 'Trees', tags: ['forest'] });
			foundry.applications.api.DialogV2.confirm = async () => false;
			await actions.libraryEdit.call(app, {}, edit);
			assert.equal(uploads.length, 0, 'replacement cancellation never uploads');
			foundry.applications.api.DialogV2.confirm = async () => true;
			await actions.libraryEdit.call(app, {}, edit);
			assert.equal(errors.length, 0);
			assert.equal(app._libraryEntries[0].name, 'Library oak');
			assert.equal(JSON.parse(files.get(path)).project.name, 'Library oak');
			assert.deepEqual(JSON.parse(files.get(path)).project.drawings, source.project.drawings);
			assert.equal(stored['foundryshop.libraryFileOperations'].entries.length, 0);
			assert.equal(notices.length, 1);
			await actions.libraryDuplicate.call(app, {}, button('libraryDuplicate', { libraryIndex: index }));
			assert.equal(files.size, 2);
			assert.equal(app._libraryEntries.length, 2);
			assert.equal(notices.length, 2);
			const sourceIndex = app._libraryEntries.findIndex(entry => entry.path === path) + 2;
			const upload = foundry.applications.apps.FilePicker.implementation.upload;
			foundry.applications.apps.FilePicker.implementation.upload = async () => { throw new Error('Fixture upload failed'); };
			foundry.applications.api.DialogV2.prompt = async () => ({ name: 'Interrupted change', category: 'Trees', tags: [] });
			await actions.libraryEdit.call(app, {}, button('libraryEdit', { libraryIndex: String(sourceIndex) }));
			assert.match(errors.at(-1), /EditUnverified/);
			assert.equal(app._libraryEntries, undefined);
			await actions.libraryRefresh.call(app, {}, button('libraryRefresh'));
			assert.equal(app.content.querySelectorAll('[data-action="libraryRepair"]').length, 1);
			assert.equal(app.content.querySelectorAll('[data-action="libraryPlace"]').length, 1);
			const repairIndex = app._libraryEntries.findIndex(entry => entry.path === path) + 2;
			foundry.applications.apps.FilePicker.implementation.upload = upload;
			await actions.libraryRepair.call(app, {}, button('libraryRepair', { libraryIndex: String(repairIndex) }));
			assert.equal(stored['foundryshop.libraryFileOperations'].entries.length, 0);
			assert.equal(app.content.querySelectorAll('[data-action="libraryPlace"]').length, 2);
			assert.equal(JSON.parse(files.get(path)).name, 'Library oak');
			await actions.libraryRemove.call(app, {}, button('libraryRemove', { libraryIndex: String(repairIndex) }));
			assert.equal(stored['foundryshop.libraryCatalog'].entries.length, 1);
			let removedCard = app.content.querySelectorAll('[data-library-path]').find(card => card.dataset.libraryPath === path);
			assert.equal(removedCard.getAttribute('hidden'), '');
			assert.equal(removedCard.querySelector('[data-action="libraryPlace"]'), null);
			await actions.libraryRemoved.call(app);
			removedCard = app.content.querySelectorAll('[data-library-path]').find(card => card.dataset.libraryPath === path);
			assert.equal(removedCard.getAttribute('hidden'), undefined);
			assert.ok(removedCard.querySelector('[data-action="libraryRestore"]'));
			assert.equal(removedCard.querySelector('[data-action="libraryEdit"]'), null);
			const removedIndex = app._libraryEntries.findIndex(entry => entry.path === path) + 2;
			const uploadCount = uploads.length;
			await actions.libraryRestore.call(app, {}, button('libraryRestore', { libraryIndex: String(removedIndex) }));
			assert.equal(stored['foundryshop.libraryCatalog'].entries.length, 0);
			assert.equal(uploads.length, uploadCount);
			await actions.libraryRemoved.call(app);
			assert.equal(app.content.querySelectorAll('[data-action="libraryPlace"]').length, 2);
		} finally {
			foundry.applications.api.DialogV2.prompt = prompt; foundry.applications.api.DialogV2.confirm = confirm;
		}
	} finally {
		globalThis.fetch = original.fetch; globalThis.location = original.location; foundry.applications.apps = original.apps;
		ui.notifications.info = original.info; foundry.utils.randomID = original.id;
	}
});

test('WEBP/SVG publication is available without a library folder, cancel releases busy state and failures are explicit', async () => {
	stored['foundryshop.layerWorkspace'] = { version: 1, scenes: {} };
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	await selectTab(app, 'library');
	assert.ok(app.content.querySelector('[data-action="artworkPublish"]'));
	assert.ok(app.content.querySelector('[data-action="artworkSvg"]'));
	await actions.artworkPublish.call(app);
	await actions.artworkSvg.call(app, {}, { dataset: { action: 'artworkSvg' } });
	assert.equal(app._libraryBusy, false); assert.equal(app._libraryController, null);
	assert.equal(errors.length, 0);
	const prompt = foundry.applications.api.DialogV2.prompt;
	foundry.applications.api.DialogV2.prompt = async () => { throw new Error('Publication dialog failed'); };
	try {
		await actions.artworkPublish.call(app);
		assert.match(errors.at(-1), /Publication dialog failed/);
		assert.equal(app._libraryBusy, false); assert.equal(app._libraryController, null);
	} finally { foundry.applications.api.DialogV2.prompt = prompt; }
});

test('saved shapes with embedded thumbnails retain the image rather than scheduling a second artwork render', async () => {
	stored['foundryshop.projectLibraryFolder'] = 'worlds/test/library';
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	app._libraryRoot = stored['foundryshop.projectLibraryFolder'];
	app._libraryEntries = [{ name: 'Thumbnail shape', kind: 'shape', path: 'worlds/test/library/shape.json',
		drawings: 1, thumbnail: { data: 'sample', width: 256, height: 192 } }];
	await selectTab(app, 'library');
	const preview = app.content.querySelector('[data-action="libraryPlace"]');
	assert.equal(preview.dataset.previewLibrary, undefined);
	assert.equal(preview.querySelector('[data-library-image]').attributes.src, 'data:image/webp;base64,sample');
});

test('label previews arm one standalone cursor placement and cancel explicitly', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	await selectTab(app, 'labels');
	await actions.labelArm.call(app, {}, button('labelArm', { id: 'l1' }));
	assert.equal(getLabelState().mode, 'place');
	assert.equal(getLabelState().text, 'Hall');
	await actions.labelArm.call(app, {}, button('labelArm', { id: 'l2' }));
	assert.equal(getLabelState().mode, 'place');
	assert.equal(getLabelState().text, 'Cave');
	actions.labelMode.call(app, {}, button('labelMode', { mode: 'off' }));
	assert.equal(getLabelState().mode, 'off');
	await flush();
	const status = app.content.children[0].querySelector('.fshop-tb-status');
	assert.match(status.textContent, /LabelStatus/);
	dialogResult = { name: '', text: ' Secret Door ' };
	await actions.labelCustom.call(app, {});
	assert.equal(getLabelState().mode, 'place');
	assert.equal(getLabelState().text, 'Secret Door');
});

test('players manage their own labels but cannot edit the campaign bank', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	game.user.isGM = false;
	dialogResult = { name: 'Throne', text: 'Throne Room' };
	await actions.labelAdd.call(app, {}, button('labelAdd'));
	assert.equal(stored[`foundryshop.${PERSONAL_LABELS}`].labels.at(-1).text, 'Throne Room');
	app._labelScope = 'campaign';
	await actions.labelStarters.call(app, {}, button('labelStarters'));
	assert.match(errors.at(-1), /GMOnly/);
	await app.render();
	assert.equal(app.content.children[0].querySelector('[data-action="labelManage"]'), null);
});

test('selection label actions require exactly one editable, unchanged drawing', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	const drawing = makeDrawing();
	canvas.drawings.controlled = [drawing];
	canvas.scene.drawings.set('d1', drawing.document);

	armLabel('Hall', 'next');
	await actions.selectionApply.call(app, {}, button('selectionApply'));
	assert.deepEqual(updates.at(-1), { text: 'Hall' });

	dialogResult = { text: 'Renamed' };
	await actions.selectionEdit.call(app, {}, button('selectionEdit'));
	assert.deepEqual(updates.at(-1), { text: 'Renamed' });

	await actions.selectionClear.call(app, {}, button('selectionClear'));
	assert.deepEqual(updates.at(-1), { text: '' });

	drawing.document.locked = true;
	await actions.selectionApply.call(app, {}, button('selectionApply'));
	assert.match(errors.at(-1), /SelectionLocked/);

	drawing.document.locked = false;
	dialogResult = { text: 'Too late' };
	const prompt = foundry.applications.api.DialogV2.prompt;
	foundry.applications.api.DialogV2.prompt = async () => { drawing.document.text = 'Changed elsewhere'; return dialogResult; };
	await actions.selectionEdit.call(app, {}, button('selectionEdit'));
	foundry.applications.api.DialogV2.prompt = prompt;
	assert.match(errors.at(-1), /Changed/);
	assert.equal(drawing.document.text, 'Changed elsewhere');

	canvas.drawings.controlled = [drawing, makeDrawing({ id: 'd2' })];
	const count = updates.length;
	await actions.selectionClear.call(app, {}, button('selectionClear'));
	assert.equal(updates.length, count);
	assert.match(errors.at(-1), /SelectOne/);
});

test('collapse persists and hides detail sections; hook bursts coalesce into one render', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	actions.collapse.call(app, {});
	await flush();
	assert.equal(stored['foundryshop.toolboxState'].collapsed, true);
	assert.equal(app.content.children[0].children.length, 2);
	assert.ok(app.content.querySelector('[data-action="widthSet"]'));
	assert.ok(app.content.querySelector('[data-target="stroke"]'));
	assert.equal(app.content.querySelector('.fshop-tb-body'), null);
	const before = app.renders;
	for (let i = 0; i < 5; i++) Hooks.callAll('controlDrawing');
	await flush();
	assert.equal(app.renders, before + 1);
	Hooks.callAll('clientSettingChanged', 'core.drawingPalette', {}, { foundryshopSource: 'toolbox' });
	await flush();
	assert.equal(app.renders, before + 1, 'own writes do not re-render (keeps slider drags smooth)');
});

test('selection label controls respect ancestor layer locks, including a lock added during a dialog', async () => {
	await Drawing_Toolbox.show();
	const app = Drawing_Toolbox._instance;
	let locked = true;
	const drawing = makeDrawing({
		getFlag: () => 'ink',
		parent: { getFlag: () => ({
			version: 1, revision: locked ? 1 : 2, presets: [], nodes: [
				{ id: 'group', name: 'Group', kind: 'group', parentId: null, locked, playerAllowed: false, defaults: {} },
				{ id: 'ink', name: 'Ink', kind: 'layer', parentId: 'group', locked: false, playerAllowed: false, defaults: {} },
			],
		}) },
	});

	test('grouped tabs persist locally while collapsed brush controls and recent colors remain usable', async () => {
		stored['foundryshop.recent_colors'] = ['#112233', '#112233', '#445566', 'invalid'];
		stored['foundryshop.toolboxState'] = { tab: 'settings', left: 50, top: 60 };
		await Drawing_Toolbox.show();
		const app = Drawing_Toolbox._instance;
		assert.equal(app._tab, 'settings');
		assert.equal(app.content.querySelectorAll('button[data-tab]').length, 4);
		assert.ok(app.content.querySelectorAll('button[data-tab]').every(tab => tab.attributes['aria-selected'] === 'false'));
		assert.equal(app.content.querySelector('.fshop-tb-panel-title').textContent, 'FOUNDRYSHOP.Toolbox.Tab.settings');
		assert.equal(app.content.querySelectorAll('[data-action="recentColor"]').length, 2);
		await actions.recentColor.call(app, {}, button('recentColor', { color: '#445566' }));
		assert.equal(stored['core.drawingPalette'].strokeColor, '#445566');
		assert.equal(stored['foundryshop.recent_colors'][0], '#445566');
		await selectTab(app, 'labels');
		assert.equal(stored['foundryshop.toolboxState'].tab, 'labels');
		actions.collapse.call(app);
		await flush();
		assert.ok(app.content.querySelector('[data-action="recentColor"]'));
		assert.equal(app.content.querySelectorAll('button[data-tab]').length, 0);
	});

	test('tab strip has one keyboard stop and arrow/Home/End navigation restores focus', async () => {
		const app = new Drawing_Toolbox();
		await app.render({ force: true });
		const tabs = () => app.content.querySelectorAll('button[data-tab]');
		const selected = () => tabs().find(tab => tab.attributes['aria-selected'] === 'true');
		const check = name => {
			assert.equal(selected().dataset.group, name);
			assert.equal(tabs().filter(tab => tab.attributes.tabindex === '0').length, 1);
			assert.equal(selected().attributes.tabindex, '0');
			assert.ok(tabs().filter(tab => tab !== selected()).every(tab => tab.attributes.tabindex === '-1'));
		};
		const press = async key => {
			let prevented = false, stopped = false;
			await selected().listeners.keydown[0]({ key, preventDefault: () => { prevented = true; },
				stopPropagation: () => { stopped = true; } });
			assert.equal(prevented, true); assert.equal(stopped, true);
			assert.equal(document.activeElement, selected());
			assert.equal(stored['foundryshop.toolboxState'].tab, selected().dataset.tab);
		};
		check('brush');
		await press('ArrowLeft'); check('assets');
		await press('ArrowRight'); check('brush');
		await press('End'); check('assets');
		await press('Home'); check('brush');
		await press('ArrowRight'); check('palettes');
		await app.close();
	});

	test('sub-switches, remembered group panels and the header settings toggle', async () => {
		await Drawing_Toolbox.openTab('presentation');
		const app = Drawing_Toolbox._instance;
		const subs = () => app.content.querySelectorAll('button[data-panel]');
		assert.deepEqual(subs().map(node => node.dataset.panel), ['layers', 'presentation']);
		assert.equal(subs().find(node => node.attributes['aria-pressed'] === 'true').dataset.panel, 'presentation');
		await actions.toolboxPanel.call(app, { detail: 1 }, button('toolboxPanel', { panel: 'layers' }));
		assert.equal(app._tab, 'layers');
		await selectTab(app, 'labels');
		assert.deepEqual(subs().map(node => node.dataset.panel), ['library', 'labels']);
		const layersTab = app.content.querySelectorAll('button[data-tab]').find(node => node.dataset.group === 'layers');
		assert.equal(layersTab.dataset.tab, 'layers', 'group remembers its last panel');
		await actions.toolboxSettings.call(app);
		assert.equal(app._tab, 'settings');
		assert.equal(subs().length, 0);
		await actions.toolboxSettings.call(app);
		assert.equal(app._tab, 'labels');
		await app.close();
	});

	test('keyboard tab activation restores focus but pointer activation does not steal canvas focus', async () => {
		const app = new Drawing_Toolbox();
		await app.render({ force: true });
		const canvasFocus = document.activeElement;
		await actions.toolboxTab.call(app, { detail: 1 }, button('toolboxTab', { tab: 'labels' }));
		assert.equal(document.activeElement, canvasFocus);
		await actions.toolboxTab.call(app, { detail: 0 }, button('toolboxTab', { tab: 'palettes' }));
		assert.equal(document.activeElement, app.content.querySelector('button[data-tab="palettes"]'));
		await app.close();
	});

	test('tab navigation reports failed renders instead of rejecting the DOM event silently', async () => {
		const app = new Drawing_Toolbox();
		await app.render({ force: true });
		app.render = async () => { throw new Error('tab render unavailable'); };
		await app.content.querySelector('button[data-tab="brush"]').listeners.keydown[0]({
			key: 'ArrowRight', preventDefault() {}, stopPropagation() {},
		});
		assert.match(errors.at(-1), /tab render unavailable/);
		await app.close();
	});

	test('a layer panel without a scene shows an inline status instead of failing the toolbox render', async () => {
		Drawing_Toolbox.createLayerPanel = () => ({
			render: async () => { throw new Error('Open an active Scene'); },
			bind() {}, action: async () => {},
		});
		await Drawing_Toolbox.openTab('layers');
		const app = Drawing_Toolbox._instance;
		const status = app.content.querySelector('.fshop-tb-layer-body').children[0];
		assert.equal(status.textContent, 'Open an active Scene');
		assert.ok(app.content.querySelector('.fshop-tb-tools'));
		await app.close();
	});

	test('embedded layer actions keep their original command and node ID without opening a panel', async () => {
		const calls = [];
		Drawing_Toolbox.createLayerPanel = () => ({
			render: async tab => { calls.push({ tab }); return ''; },
			bind() {},
			action: async (event, target) => { calls.push({ ...target.dataset }); },
		});
		await Drawing_Toolbox.openTab('layers');
		const app = Drawing_Toolbox._instance;
		assert.ok(calls.some(call => call.tab === 'layers'));
		await actions.layerAction.call(app, {}, button('layerAction', { layerAction: 'lock', id: 'ink' }));
		assert.deepEqual(calls.at(-1), { action: 'lock', layerAction: 'lock', id: 'ink' });
		await selectTab(app, 'presentation');
		assert.equal(calls.at(-1).tab, 'presentation');
		await selectTab(app, 'library');
		assert.equal(calls.at(-1).tab, 'library');
	});

	test('body scroll is restored per tab rather than shared with persistent controls', async () => {
		await Drawing_Toolbox.show();
		const app = Drawing_Toolbox._instance;
		app.content.querySelector('.fshop-tb-body').scrollTop = 123;
		await selectTab(app, 'labels');
		assert.equal(app.content.querySelector('.fshop-tb-body').scrollTop, 0);
		app.content.querySelector('.fshop-tb-body').scrollTop = 45;
		await selectTab(app, 'brush');
		assert.equal(app.content.querySelector('.fshop-tb-body').scrollTop, 123);
		await selectTab(app, 'labels');
		assert.equal(app.content.querySelector('.fshop-tb-body').scrollTop, 45);
	});

	test('GM-only toolbox gate blocks automatic and direct opening by other users', async () => {
		game.user.isGM = false;
		Hooks.callAll('activateDrawingsLayer');
		await flush();
		assert.equal(Drawing_Toolbox._instance, null);
		await assert.rejects(Drawing_Toolbox.show(), /GMOnly/);
		await assert.rejects(Drawing_Toolbox.openTab('layers'), /GMOnly/);
		const controls = { drawings: { tools: {} } };
		Hooks.callAll('getSceneControlButtons', controls);
		assert.equal(controls.drawings.tools['foundryshop-toolbox'], undefined);
	});

	test('palette editor preserves source colors on cancellation and reports stale entries', async () => {
		await Drawing_Toolbox.show();
		const app = Drawing_Toolbox._instance;
		const before = structuredClone(stored[`foundryshop.${PERSONAL_COLORS}`]);
		await actions.paletteEdit.call(app, {}, button('paletteEdit', { id: 'c1' }));
		assert.deepEqual(stored[`foundryshop.${PERSONAL_COLORS}`], before);
		dialogResult = { name: 'New blood', color: '#bb0000' };
		await actions.paletteEdit.call(app, {}, button('paletteEdit', { id: 'c1' }));
		assert.equal(stored[`foundryshop.${PERSONAL_COLORS}`].colors[0].color, '#bb0000');
		assert.equal(stored['core.drawingPalette'].strokeColor, '#123456', 'editing saved colors is not brush selection');
		await actions.paletteDelete.call(app, {}, button('paletteDelete', { id: 'missing' }));
		assert.match(errors.at(-1), /Changed/);
	});

	test('named palette cards edit shared colors separately from applying brush colors', async () => {
		await Drawing_Toolbox.show();
		const app = Drawing_Toolbox._instance;
		await selectTab(app, 'palettes');
		await app.content.querySelector('select[data-palette-selector]').listeners.change[0]({ target: { value: 'shared1' } });
		assert.equal(app.content.querySelectorAll('[data-action="useColor"]').length, 1);
		const swatch = app.content.querySelectorAll('[data-action="useColor"]').find(node => node.dataset.paletteId === 'shared1');
		assert.equal(swatch.dataset.paletteId, 'shared1');
		await actions.useColor.call(app, {}, swatch);
		assert.equal(stored['core.drawingPalette'].strokeColor, '#aa0000');
		dialogResult = { name: 'Earth', color: '#776655' };
		await actions.paletteEdit.call(app, {}, button('paletteEdit', { paletteId: 'shared1', id: 'c1' }));
		assert.equal(stored['foundryshop.sharedPalettes'].palettes[0].colors[0].color, '#776655');
		assert.equal(stored['core.drawingPalette'].strokeColor, '#aa0000');
		assert.equal(stored[`foundryshop.${PERSONAL_COLORS}`].colors[0].color, '#aa0000');
	});

	test('palette creation and copying old colors require explicit submission and keep old data', async () => {
		await Drawing_Toolbox.show();
		const app = Drawing_Toolbox._instance;
		const original = structuredClone(stored[`foundryshop.${PERSONAL_COLORS}`]);
		await actions.sharedCreate.call(app, {}, button('sharedCreate'));
		assert.equal(stored['foundryshop.sharedPalettes'].palettes.length, 1);
		dialogResult = 'My old colors';
		await actions.sharedAdopt.call(app, {}, button('sharedAdopt', { scope: 'personal' }));
		assert.equal(stored['foundryshop.sharedPalettes'].palettes.length, 2);
		assert.deepEqual(stored[`foundryshop.${PERSONAL_COLORS}`], original);
		assert.deepEqual(stored['foundryshop.sharedPalettes'].palettes[1].colors, original.colors);
	});
	canvas.drawings.controlled = [drawing];
	canvas.scene.drawings.set('d1', drawing.document);
	armLabel('Hall', 'next');
	await actions.selectionApply.call(app, {}, button('selectionApply'));
	assert.match(errors.at(-1), /SelectionLocked/);
	assert.equal(updates.length, 0);
	locked = false;
	const prompt = foundry.applications.api.DialogV2.prompt;
	foundry.applications.api.DialogV2.prompt = async () => {
		locked = true;
		return { text: 'Too late' };
	};
	await actions.selectionEdit.call(app, {}, button('selectionEdit'));
	foundry.applications.api.DialogV2.prompt = prompt;
	assert.equal(updates.length, 0);
	assert.match(errors.at(-1), /SelectionLocked/);
	locked = false;
	await actions.selectionApply.call(app, {}, button('selectionApply'));
	assert.deepEqual(updates.at(-1), { text: 'Hall' });
	assert.equal(drawing.document.locked, false);
});
