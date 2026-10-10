import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Color_Selector } from '../scripts/color_selector.js';
import { PERSONAL_COLORS, CAMPAIGN_COLORS, PALETTE_CHANGED } from '../scripts/saved_colors.js';

let hooks, stored, writes, errors;
function element() {
	const nodes = new Map();
	return {
		children: [], style: {}, dataset: {},
		append(...children) { this.children.push(...children); },
		replaceChildren(...children) { this.children = children; },
		get childElementCount() { return this.children.length; },
		attributes: {},
		setAttribute(name, value) { this.attributes[name] = value; },
		querySelector(selector) {
			if (!nodes.has(selector)) nodes.set(selector, {
				...element(), value: '', textContent: '', validity: { valid: true }, listeners: {},
				style: { setProperty(key, value) { this[key] = value; } },
				addEventListener(name, listener) { this.listeners[name] = listener; },
				setCustomValidity() {},
				reportValidity() { this.reported = true; },
			});
			return nodes.get(selector);
		},
	};
}
class Application {
	constructor() {
		this.rendered = false;
		this.element = element();
		this.position = { left: 10, top: 20 };
	}
	async render() {
		const context = await this._prepareContext({});
		this.rendered = true;
		await this._onRender(context, {});
		return this;
	}
	async _onRender() {}
	_onClose() {}
	async close(options) {
		this._onClose(options);
		this.rendered = false;
		return this;
	}
}
globalThis.foundry = {
	applications: {
		api: { ApplicationV2: Application, HandlebarsApplicationMixin: Base => Base },
		sheets: { palette: { DrawingPalette: class { static SETTING_KEY = 'drawingPalette'; } } },
	},
	utils: { deepClone: structuredClone, Color: class {} },
};
const { Drawing_Tools } = await import('../scripts/drawing_tools.js');
const { prepare_settings } = await import('../scripts/settings.js');

beforeEach(() => {
	hooks = new Map();
	let id = 0;
	globalThis.Hooks = {
		on(name, fn) { hooks.set(++id, { name, fn }); return id; },
		off(name, key) { hooks.delete(key); },
		callAll(name, ...args) {
			for (const hook of hooks.values()) if (hook.name === name) hook.fn(...args);
		},
	};
	stored = {
		'core.drawingPalette': { strokeColor: '#123456', fillColor: '#abcdef', strokeWidth: 8,
			strokeAlpha: 1, fillAlpha: 0.5, fillType: 1, texture: 'keep.webp' },
		'foundryshop.color_selector_size': 150,
		'foundryshop.dropper_preview_size': 50,
		'foundryshop.dropper_read_radius': 3,
		'foundryshop.preset_color_swatches': '#ffffff',
		'foundryshop.recent_color_history': 2,
		'foundryshop.recent_colors': [],
		'foundryshop.window_position': {},
		[`foundryshop.${PERSONAL_COLORS}`]: { schemaVersion: 1, colors: [] },
		[`foundryshop.${CAMPAIGN_COLORS}`]: { schemaVersion: 1, colors: [] },
	};
	writes = [];
	errors = [];
	foundry.utils.randomID = () => 'new-id';
	globalThis.game = {
		user: { isGM: true },
		i18n: { localize: key => key, format: (key, { message }) => message },
		keybindings: { get: () => [{ key: 'KeyD', modifiers: ['Control'] }] },
		settings: {
			get: (namespace, key) => stored[`${namespace}.${key}`],
			async set(namespace, key, value, options = {}) {
				const fullKey = `${namespace}.${key}`;
				stored[fullKey] = structuredClone(value);
				writes.push(fullKey);
				Hooks.callAll('clientSettingChanged', fullKey, value, options);
				if ([PERSONAL_COLORS, CAMPAIGN_COLORS].includes(key)) Hooks.callAll(PALETTE_CHANGED);
			},
		},
	};
	globalThis.document = { createElement: () => element() };
	globalThis.ui = { notifications: { error: message => errors.push(message) } };
	Drawing_Tools._instance = null;
	Drawing_Tools._toggling = false;
	Drawing_Tools.current_tool = 'stroke';
	// Isolate application wiring from the separately tested browser color picker.
	Color_Selector.prototype.render_and_attach_html = function () {};
	Color_Selector.prototype.activate_listeners = function (root, listener) { this.color_update_listener = listener; };
	Color_Selector.prototype.update_html_colors = function (color) { this.lastColor = color; };
	Color_Selector.prototype.dispose = function () { this.disposed = true; };
});

test('panel opens using v14 defaults and explicit toolbar order', async () => {
	Drawing_Tools.init();
	const controls = { drawings: { tools: { select: { order: 0 }, clear: { order: 9 } } } };
	Hooks.callAll('getSceneControlButtons', controls);
	assert.equal(controls.drawings.tools['quick-draw-config'].order, 10);
	Hooks.callAll('getSceneControlButtons', {});
	await Drawing_Tools.toggle();
	assert.equal(Drawing_Tools._instance.rendered, true);
	assert.equal(Drawing_Tools._instance.element.querySelector('#fshop-stroke-width').value, 8);
	assert.equal(errors.length, 0);
});

test('rapid toggle requests cannot create duplicate panels', async () => {
	await Promise.all([Drawing_Tools.toggle(), Drawing_Tools.toggle(), Drawing_Tools.toggle()]);
	assert.equal([...hooks.values()].filter(h => h.name === 'clientSettingChanged').length, 1);
	assert.equal(Drawing_Tools._instance.rendered, true);
});

test('direct width input persists immediately and invalid input is reported', async () => {
	await Drawing_Tools.toggle();
	const app = Drawing_Tools._instance;
	const width = app.element.querySelector('#fshop-stroke-width');
	width.value = '17';
	width.listeners.input({ target: width });
	await Promise.all(app._pendingWrites);
	assert.equal(stored['core.drawingPalette'].strokeWidth, 17);
	assert.equal(stored['core.drawingPalette'].texture, 'keep.webp');
	width.value = '';
	width.listeners.input({ target: width });
	assert.equal(width.reported, true);
	assert.equal(stored['core.drawingPalette'].strokeWidth, 17);
});

test('native changes synchronize without writes; close cannot overwrite them', async () => {
	await Drawing_Tools.toggle();
	const app = Drawing_Tools._instance;
	await game.settings.set('core', 'drawingPalette', {
		...stored['core.drawingPalette'], strokeWidth: 30, fillColor: '#fedcba',
	});
	assert.equal(app.element.querySelector('#fshop-stroke-width').value, 30);
	assert.equal(app.element.querySelector('#fshop-fill-color-text').value, '#fedcba');
	assert.equal(writes.filter(key => key === 'core.drawingPalette').length, 1);
	await app.close();
	assert.equal(stored['core.drawingPalette'].strokeWidth, 30);
	assert.equal(writes.filter(key => key === 'core.drawingPalette').length, 1);
	assert.equal(app.color_selector.disposed, true);
	assert.equal(hooks.size, 0);
	assert.equal(Drawing_Tools._instance, null);
	assert.deepEqual(stored['foundryshop.window_position'], { left: 10, top: 20 });
});

test('self-originated color input does not reset partially typed text', async () => {
	await Drawing_Tools.toggle();
	const app = Drawing_Tools._instance;
	const input = app.element.querySelector('#fshop-stroke-color-text');
	input.dataset.tool = 'stroke';
	input.value = '#12';
	input.listeners.input({ target: input });
	await Promise.all(app._pendingWrites);
	assert.equal(input.value, '#12');
	assert.equal(stored['core.drawingPalette'].strokeColor, '#000000');
});

test('color tool switch does not write settings, width buttons do', async () => {
	await Drawing_Tools.toggle();
	const app = Drawing_Tools._instance;
	Drawing_Tools.DEFAULT_OPTIONS.actions.fillColor.call(app, {}, { dataset: { tool: 'fill' } });
	assert.equal(writes.length, 0);
	assert.equal(app.color_selector.lastColor, '#abcdef');
	Drawing_Tools.DEFAULT_OPTIONS.actions.strokeWidthPlus.call(app, { shiftKey: true }, { textContent: '+' });
	await Promise.all(app._pendingWrites);
	assert.equal(stored['core.drawingPalette'].strokeWidth, 13);
});

test('saved colors render names as text and apply to the active target', async () => {
	stored[`foundryshop.${PERSONAL_COLORS}`].colors.push({
		id: 'one', name: '<img src=x onerror=alert(1)>', color: '#112233',
	});
	await Drawing_Tools.toggle();
	const app = Drawing_Tools._instance;
	const row = app.element.querySelector('#fshop-saved-color-list').children[0];
	assert.equal(row.children[1].textContent, '<img src=x onerror=alert(1)>');
	assert.equal(row.children[0].title, '<img src=x onerror=alert(1)> (#112233)');
	assert.equal(row.children[0].children[0].className, 'fshop-saved-color-block');
	assert.equal(row.children[0].children[0].style.backgroundColor, '#112233');
	Drawing_Tools.current_tool = 'fill';
	await Drawing_Tools.DEFAULT_OPTIONS.actions.useSavedColor.call(app, {}, {
		dataset: { action: 'useSavedColor', id: 'one' },
	});
	await Promise.all(app._pendingWrites);
	assert.equal(stored['core.drawingPalette'].fillColor, '#112233');
	assert.equal(stored['core.drawingPalette'].strokeColor, '#123456');
});

test('player campaign view disables edits while allowing saved-color use', async () => {
	game.user.isGM = false;
	stored[`foundryshop.${CAMPAIGN_COLORS}`].colors.push({
		id: 'shared', name: 'Shared', color: '#998877',
	});
	await Drawing_Tools.toggle();
	const app = Drawing_Tools._instance;
	const select = app.element.querySelector('#fshop-palette-scope');
	select.value = 'campaign';
	select.listeners.change({ target: select });
	assert.equal(app.element.querySelector('[data-action="saveColor"]').disabled, true);
	assert.equal(app.element.querySelector('[data-action="importPresets"]').disabled, true);
	assert.equal(app.element.querySelector('#fshop-saved-color-list').children[0].children.length, 2);
	await Drawing_Tools.DEFAULT_OPTIONS.actions.useSavedColor.call(app, {}, {
		dataset: { action: 'useSavedColor', id: 'shared' },
	});
	await Promise.all(app._pendingWrites);
	assert.equal(stored['core.drawingPalette'].strokeColor, '#998877');
});

test('palette notifications update only saved-color list, not the picker', async () => {
	await Drawing_Tools.toggle();
	const app = Drawing_Tools._instance;
	app.color_selector.lastColor = 'unchanged';
	stored[`foundryshop.${PERSONAL_COLORS}`].colors.push({
		id: 'new', name: 'New color', color: '#445566',
	});
	Hooks.callAll(PALETTE_CHANGED);
	assert.equal(app.element.querySelector('#fshop-saved-color-list').children[0].children[1].textContent, 'New color');
	assert.equal(app.color_selector.lastColor, 'unchanged');
});

	test('settings register per-user personal and world campaign storage with refresh callbacks', () => {
		const registrations = new Map();
		game.settings.register = (namespace, key, config) => registrations.set(key, config);
		game.keybindings.register = () => {};
		globalThis.CONST = { KEYBINDING_PRECEDENCE: { NORMAL: 0 } };
		prepare_settings();
		assert.equal(registrations.get(PERSONAL_COLORS).scope, 'user');
		assert.equal(registrations.get(CAMPAIGN_COLORS).scope, 'world');
		assert.equal(registrations.get(PERSONAL_COLORS).config, false);
		assert.deepEqual(registrations.get(PERSONAL_COLORS).default, { schemaVersion: 1, colors: [] });
		let refreshed = 0;
		Hooks.on(PALETTE_CHANGED, () => refreshed++);
		registrations.get(CAMPAIGN_COLORS).onChange();
		assert.equal(refreshed, 1);
	});

	test('save uses active color and dialog name, cancellation writes nothing', async () => {
		await Drawing_Tools.toggle();
		const app = Drawing_Tools._instance;
		Drawing_Tools.current_tool = 'fill';
		foundry.applications.api.DialogV2 = { prompt: async () => ({ name: 'Water', color: '#abcdef' }) };
		await Drawing_Tools.DEFAULT_OPTIONS.actions.saveColor.call(app, {}, { dataset: { action: 'saveColor' } });
		assert.deepEqual(stored[`foundryshop.${PERSONAL_COLORS}`].colors,
			[{ id: 'new-id', name: 'Water', color: '#abcdef' }]);
		const before = writes.length;
		foundry.applications.api.DialogV2.confirm = async () => false;
		await Drawing_Tools.DEFAULT_OPTIONS.actions.saveColor.call(app, {}, { dataset: { action: 'saveColor' } });
		assert.equal(writes.length, before);
		assert.equal(app._paletteBusy, false);
	});

	test('duplicate save offers rename and retains the existing ID', async () => {
		stored[`foundryshop.${PERSONAL_COLORS}`].colors.push({
			id: 'existing', name: 'Old', color: '#123456',
		});
		await Drawing_Tools.toggle();
		const app = Drawing_Tools._instance;
		let confirmations = 0;
		foundry.applications.api.DialogV2 = {
			confirm: async () => { confirmations++; return true; },
			prompt: async () => ({ name: 'New name', color: '#123456' }),
		};
		await Drawing_Tools.DEFAULT_OPTIONS.actions.saveColor.call(app, {}, { dataset: { action: 'saveColor' } });
		assert.equal(confirmations, 1);
		assert.deepEqual(stored[`foundryshop.${PERSONAL_COLORS}`].colors,
			[{ id: 'existing', name: 'New name', color: '#123456' }]);
	});

	test('edit and confirmed delete actions persist; cancelled delete preserves entry', async () => {
		stored[`foundryshop.${PERSONAL_COLORS}`].colors.push({
			id: 'existing', name: 'Old', color: '#123456',
		});
		await Drawing_Tools.toggle();
		const app = Drawing_Tools._instance;
		foundry.applications.api.DialogV2 = {
			prompt: async () => ({ name: 'Changed', color: '#998877' }),
			confirm: async () => false,
		};
		await Drawing_Tools.DEFAULT_OPTIONS.actions.editSavedColor.call(app, {}, {
			dataset: { action: 'editSavedColor', id: 'existing' },
		});
		assert.equal(stored[`foundryshop.${PERSONAL_COLORS}`].colors[0].color, '#998877');
		const target = { dataset: { action: 'deleteSavedColor', id: 'existing' } };
		await Drawing_Tools.DEFAULT_OPTIONS.actions.deleteSavedColor.call(app, {}, target);
		assert.equal(stored[`foundryshop.${PERSONAL_COLORS}`].colors.length, 1);
		foundry.applications.api.DialogV2.confirm = async () => true;
		await Drawing_Tools.DEFAULT_OPTIONS.actions.deleteSavedColor.call(app, {}, target);
		assert.equal(stored[`foundryshop.${PERSONAL_COLORS}`].colors.length, 0);
	});

	test('overlapping save actions do not unlock the first operation prematurely', async () => {
		await Drawing_Tools.toggle();
		const app = Drawing_Tools._instance;
		let dismiss;
		foundry.applications.api.DialogV2 = { prompt: () => new Promise(resolve => { dismiss = resolve; }) };
		const target = { dataset: { action: 'saveColor' } };
		const first = Drawing_Tools.DEFAULT_OPTIONS.actions.saveColor.call(app, {}, target);
		await Drawing_Tools.DEFAULT_OPTIONS.actions.saveColor.call(app, {}, target);
		assert.equal(app._paletteBusy, true);
		assert.equal(writes.length, 0);
		dismiss(null);
		await first;
		assert.equal(app._paletteBusy, false);
	});

test('save dialog serializes the current active color without requiring hex entry', async () => {
	await Drawing_Tools.toggle();
	Drawing_Tools.current_tool = 'fill';
	game.i18n.format = (key, values) => key.startsWith('FOUNDRYSHOP.ColorNames.') ? `${key} ${values.color}` : values.message;
	foundry.applications.api.DialogV2 = {
		prompt: async config => {
			const name = config.content.children[0].children[0];
			const hex = config.content.children[1].children[0];
			assert.match(name.attributes.value, /ColorNames.Tone.Pale/);
			assert.equal(hex.attributes.value, '#abcdef');
			assert.equal(hex.readOnly, true);
			// Model the values recreated by Foundry from serialized HTML.
			return config.ok.callback({}, {}, {
				element: {
					querySelector: selector => ({ value: selector.includes('colorName') ? 'Water' : hex.attributes.value }),
				},
			});
		},
	};
	await Drawing_Tools.DEFAULT_OPTIONS.actions.saveColor.call(Drawing_Tools._instance, {}, {
		dataset: { action: 'saveColor' },
	});
	assert.equal(stored[`foundryshop.${PERSONAL_COLORS}`].colors[0].color, '#abcdef');
	assert.equal(errors.length, 0);
});

test('edit dialog serializes the existing name and hex, including special characters', async () => {
	const entry = { id: 'existing', name: 'Water "blue" & <ice>', color: '#112233' };
	stored[`foundryshop.${PERSONAL_COLORS}`].colors.push(entry);
	await Drawing_Tools.toggle();
	foundry.applications.api.DialogV2 = {
		prompt: async config => {
			const name = config.content.children[0].children[0];
			const hex = config.content.children[1].children[0];
			assert.equal(name.attributes.value, entry.name);
			assert.equal(hex.attributes.value, entry.color);
			assert.equal(hex.readOnly, false);
			return config.ok.callback({}, {}, {
				element: {
					querySelector: selector => ({ value: selector.includes('colorName') ? name.attributes.value : hex.attributes.value }),
				},
			});
		},
	};
	await Drawing_Tools.DEFAULT_OPTIONS.actions.editSavedColor.call(Drawing_Tools._instance, {}, {
		dataset: { action: 'editSavedColor', id: entry.id },
	});
	assert.deepEqual(stored[`foundryshop.${PERSONAL_COLORS}`].colors[0], entry);
	assert.equal(errors.length, 0);
});
