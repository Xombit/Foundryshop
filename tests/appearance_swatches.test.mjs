import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAppearance, applyAppearance } from '../scripts/appearance_swatches.js';
import { getAppearanceOverride, clearAppearanceOverride, installAppearancePreview, initAppearanceOverrides } from '../scripts/appearance_state.js';
import { readDrawingConfig, updateDrawingConfig } from '../scripts/drawing_config.js';
import { appearanceSample, promptAppearance } from '../scripts/appearance_editor.js';

const pair = { kind: 'pair', name: 'Stone', strokeColor: '#112233', fillColor: '#aabbcc', fillType: 2,
	texture: 'modules/foundryshop/assets/materials/flagstone.png', materialRepeat: 2 };
let stored, writes;
beforeEach(() => {
	stored = {
		drawingPalette: { strokeColor: '#000000', fillColor: '#ffffff', strokeWidth: 8, strokeAlpha: 0.7,
			fillAlpha: 0, fillType: 2, texture: 'old.png' },
		materialRepeat: 5, layerWorkspace: { version: 1, scenes: { scene: { activeLayerId: 'ground' } } },
	};
	writes = [];
	globalThis.game = {
		user: { isGM: true, can: () => true },
		i18n: { localize: key => key, format: key => key },
		settings: { get: (n, k) => stored[k], set: async(n, k, v) => { stored[k] = structuredClone(v); writes.push(k); } },
	};
	globalThis.foundry = { utils: { deepClone: structuredClone },
		applications: { sheets: { palette: { DrawingPalette: class { static SETTING_KEY = 'drawingPalette'; } } } } };
	globalThis.Hooks = { callAll() {} };
	globalThis.ui = {};
	globalThis.canvas = { ready: true, scene: { id: 'scene', grid: { type: 1, size: 100 } },
		level: { id: 'level' }, drawings: { active: true } };
	clearAppearanceOverride();
});

test('pairs validate only appearance fields, explicit solid/none clears textures and normalizes colors', () => {
	assert.deepEqual(normalizeAppearance(pair), pair);
	assert.equal(normalizeAppearance({ ...pair, fillType: 1 }).texture, null);
	assert.equal(normalizeAppearance({ ...pair, fillType: 0 }).materialRepeat, 1);
	for (const changes of [{ fillType: 4 }, { materialRepeat: 0 }, { texture: 'blob:abc' }, { strokeWidth: 8 }]) {
		assert.throws(() => normalizeAppearance({ ...pair, ...changes }));
	}
});

test('application is atomic transient appearance, preserving width/opacity and baseline settings', async () => {
	const before = structuredClone(stored);
	let verified;
	await applyAppearance(pair, {}, async path => { verified = path; });
	assert.equal(verified, pair.texture);
	assert.equal(readDrawingConfig().strokeColor, pair.strokeColor);
	assert.equal(readDrawingConfig().strokeWidth, 8);
	assert.equal(readDrawingConfig().fillAlpha, 0);
	assert.equal(readDrawingConfig().materialRepeat, 2);
	assert.deepEqual(stored, before);
	assert.deepEqual(writes, []);
	await applyAppearance({ ...pair, fillType: 1 }, {}, async () => {});
	assert.equal(readDrawingConfig().texture, null);
	assert.equal(readDrawingConfig().materialRepeat, 1);
	clearAppearanceOverride();
	assert.equal(readDrawingConfig().texture, 'old.png');
	assert.equal(readDrawingConfig().materialRepeat, 5);
});

test('failed resources and stale context/brush/permissions never replace the active appearance', async () => {
	await applyAppearance({ ...pair, fillType: 1 }, {}, async () => {});
	const before = getAppearanceOverride();
	await assert.rejects(applyAppearance(pair, {}, async () => { throw new Error('Missing'); }), /Missing/);
	assert.deepEqual(getAppearanceOverride(), before);
	const controller = new AbortController();
	await assert.rejects(applyAppearance(pair, { signal: controller.signal }, async () => controller.abort()), /Changed/);
	assert.deepEqual(getAppearanceOverride(), before);
	await assert.rejects(applyAppearance(pair, { checkCurrent: () => false }, async () => {}), /Changed/);
	await assert.rejects(applyAppearance(pair, {}, async () => { canvas.level.id = 'other'; }), /Changed/);
	assert.equal(getAppearanceOverride(), null);
	await assert.rejects(applyAppearance(pair, {}, async () => { game.user.isGM = false; }), /Changed/);
	assert.equal(writes.length, 0);
});

test('canvas ready/teardown resets overrides and installs an idempotent preview without changing persistent settings', async () => {
	const hooks = new Map();
	Hooks.on = (name, handler) => hooks.set(name, handler);
	class Layer { get paletteCreateData() { return { fillType: 0 }; } }
	canvas.drawings = new Layer(); canvas.drawings.active = true;
	initAppearanceOverrides();
	await applyAppearance({ ...pair, fillType: 1 });
	hooks.get('canvasReady')();
	assert.equal(getAppearanceOverride(), null);
	const getter = Object.getOwnPropertyDescriptor(canvas.drawings, 'paletteCreateData').get;
	hooks.get('canvasReady')();
	assert.equal(Object.getOwnPropertyDescriptor(canvas.drawings, 'paletteCreateData').get, getter);
	await applyAppearance({ ...pair, fillType: 1 });
	hooks.get('canvasTearDown')();
	assert.equal(getAppearanceOverride(), null);
	assert.deepEqual(writes, []);
});

test('override expires on active layer/Scene changes and manual appearance edits remain transient', async () => {
	await applyAppearance(pair, {}, async () => {});
	await updateDrawingConfig({ fillColor: '#445566', strokeWidth: 12, fillAlpha: 0.5 });
	assert.equal(readDrawingConfig().fillColor, '#445566');
	assert.equal(stored.drawingPalette.fillColor, '#ffffff');
	assert.equal(stored.drawingPalette.strokeWidth, 12);
	assert.equal(stored.drawingPalette.fillAlpha, 0.5);
	await updateDrawingConfig({ fillType: 1 });
	assert.equal(getAppearanceOverride().patch.texture, null);
	stored.layerWorkspace.scenes.scene.activeLayerId = 'other';
	assert.equal(getAppearanceOverride(), null);
	assert.equal(readDrawingConfig().texture, 'old.png');
	await applyAppearance(pair, {}, async () => {});
	canvas.scene = { id: 'different' };
	assert.equal(getAppearanceOverride(), null);
});

test('native preview getter composes safely and saved artwork sample uses current width/opacity and pixel repeat', async () => {
	class Layer { get paletteCreateData() { return { strokeWidth: 8, fillAlpha: 0, text: 'Native' }; } }
	const layer = new Layer(); layer.active = true;
	canvas.drawings = layer;
	installAppearancePreview(layer);
	installAppearancePreview(layer);
	await applyAppearance(pair, {}, async () => {});
	assert.equal(layer.paletteCreateData.strokeColor, pair.strokeColor);
	assert.equal(layer.paletteCreateData['flags.foundryshop.materialRepeat'], 200);
	assert.equal(layer.paletteCreateData.strokeWidth, 8);
	assert.equal(layer.paletteCreateData.text, 'Native');
	const sample = appearanceSample(pair, readDrawingConfig(), canvas.scene)[0].data;
	assert.equal(sample.strokeWidth, 8);
	assert.equal(sample.fillAlpha, 0);
	assert.equal(sample.flags.foundryshop.materialRepeat, 200);
	clearAppearanceOverride();
	assert.deepEqual(layer.paletteCreateData, { strokeWidth: 8, fillAlpha: 0, text: 'Native' });
});

test('editor binds rendered DialogV2 fields, not the serialized content nodes; touch step buttons update submission', async () => {
	class Element {
		constructor() { this.attributes = {}; this.children = []; this.dataset = {}; this.listeners = {}; }
		setAttribute(key, value) {
			this.attributes[key] = value;
			if (key === 'value') this.value = value;
			if (key === 'data-step') this.dataset.step = value;
		}
		append(...children) { this.children.push(...children); }
		addEventListener(key, fn) { this.listeners[key] = fn; }
		dispatchEvent(event) { this.listeners[event.type]?.(event); }
		stepUp(direction) { this.value = String(Math.round((Number(this.value) + direction * 0.05) * 100) / 100); }
	}
	const oldDocument = globalThis.document;
	globalThis.document = { createElement: () => new Element() };
	foundry.applications.api = { DialogV2: { prompt: async options => {
		assert.deepEqual(options.content.attributes, {});
		const rendered = {};
		for (const [name, value] of Object.entries({ name: 'Rendered pair', strokeColor: '#778899', fillColor: '#ddeeff',
			fillType: '2', texture: pair.texture, materialRepeat: '3' })) {
			rendered[name] = new Element(); rendered[name].value = value;
		}
		const materials = new Element(), browse = new Element(), image = new Element(), status = new Element();
		const buttons = new Element(); const increase = new Element(); increase.dataset.step = '1'; buttons.append(increase);
		const root = { querySelector: selector => {
			const name = /^\[name="(.+)"\]$/.exec(selector)?.[1];
			return name ? rendered[name] : {
				'select:not([name])': materials, '[data-pair-browse]': browse,
				'.fshop-pair-repeat-buttons': buttons, img: image, '[role="status"]': status,
			}[selector];
		} };
		options.render({}, { element: { querySelector: () => root } });
		increase.listeners.click();
		return options.ok.callback();
	} } };
	try {
		const result = await promptAppearance(pair);
		assert.equal(result.name, 'Rendered pair');
		assert.equal(result.strokeColor, '#778899');
		assert.equal(result.materialRepeat, 3.05);
		assert.deepEqual(writes, []);
	} finally { globalThis.document = oldDocument; }
});
