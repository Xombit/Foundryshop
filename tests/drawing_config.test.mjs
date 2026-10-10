import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { drawingSettingKey, readDrawingConfig, normalizeDrawingPatch, updateDrawingConfig } from '../scripts/drawing_config.js';

let stored, writes;
class DrawingPalette {
	static SETTING_KEY = 'drawingPalette';
	rendered = true;
	isSelect = false;
	renders = 0;
	async render() { this.renders++; }
}

beforeEach(() => {
	stored = { strokeColor: '#123456', strokeWidth: 8, texture: 'pattern.webp', text: 'Keep me', nested: { value: 1 } };
	writes = [];
	globalThis.foundry = {
		applications: { sheets: { palette: { DrawingPalette } } },
		canvas: { layers: { DrawingsLayer: { DEFAULT_CONFIG_SETTING: 'defaultDrawingConfig' } } },
		utils: { deepClone: structuredClone },
	};
	globalThis.game = {
		settings: {
			get(namespace, key) {
				if (namespace === 'foundryshop' && key === 'materialRepeat') return undefined;
				assert.equal(namespace, 'core');
				assert.equal(key, drawingSettingKey());
				return stored;
			},
			async set(namespace, key, value, options) {
				writes.push({ namespace, key, value, options });
				stored = structuredClone(value);
			},
		},
	};
	globalThis.ui = { placeablesPalette: null };
});

test('v14 uses DrawingPalette even if a legacy constant exists', () => {
	assert.equal(drawingSettingKey(), 'drawingPalette');
});

test('v13 retains the legacy configuration path', async () => {
	delete foundry.applications.sheets.palette.DrawingPalette;
	assert.equal(drawingSettingKey(), 'defaultDrawingConfig');
	await updateDrawingConfig({ strokeWidth: 10 });
	assert.equal(writes[0].key, 'defaultDrawingConfig');
});

test('unsupported configuration API fails explicitly', () => {
	delete foundry.applications.sheets.palette.DrawingPalette;
	delete foundry.canvas.layers.DrawingsLayer.DEFAULT_CONFIG_SETTING;
	assert.throws(drawingSettingKey, /No supported/);
});

test('read returns a detached copy and rejects unavailable defaults', () => {
	const config = readDrawingConfig();
	config.nested.value = 9;
	assert.equal(stored.nested.value, 1);
	stored = undefined;
	assert.throws(readDrawingConfig, /could not be loaded/);
});

test('partial updates preserve unrelated fields and tag their origin', async () => {
	await updateDrawingConfig({ strokeColor: '#abcdef', strokeWidth: 12 });
	assert.equal(stored.texture, 'pattern.webp');
	assert.equal(stored.text, 'Keep me');
	assert.deepEqual(stored.nested, { value: 1 });
	assert.equal(stored.strokeColor, '#abcdef');
	assert.equal(writes[0].options.foundryshopSource, true);
});

test('creation palette refreshes; selection draft is not refreshed', async () => {
	ui.placeablesPalette = new DrawingPalette();
	await updateDrawingConfig({ fillAlpha: 0.5 });
	assert.equal(ui.placeablesPalette.renders, 1);
	ui.placeablesPalette.isSelect = true;
	await updateDrawingConfig({ fillAlpha: 0.8 });
	assert.equal(ui.placeablesPalette.renders, 1);
});

test('another placeable palette is not refreshed', async () => {
	ui.placeablesPalette = { rendered: true, render() { assert.fail('Wrong palette refreshed'); } };
	await updateDrawingConfig({ strokeWidth: 2 });
});

test('rapid client writes preserve the latest fields', async () => {
	await Promise.all([
		updateDrawingConfig({ strokeWidth: 11 }),
		updateDrawingConfig({ fillColor: '#fedcba' }),
		updateDrawingConfig({ strokeWidth: 22 }),
	]);
	assert.equal(stored.strokeWidth, 22);
	assert.equal(stored.fillColor, '#fedcba');
});

test('numeric normalization and invalid inputs', () => {
	assert.deepEqual(normalizeDrawingPatch({ strokeWidth: -2, strokeAlpha: 2, fillAlpha: -1, fillType: '2' }),
		{ strokeWidth: 0, strokeAlpha: 1, fillAlpha: 0, fillType: 2 });
	for (const patch of [{ strokeWidth: '' }, { strokeWidth: NaN }, { fillAlpha: Infinity },
		{ fillType: 9 }, { fillColor: 'red' }, { texture: 'blob:temporary' }, { texture: 'data:image/png;base64,abc' }]) {
		assert.throws(() => normalizeDrawingPatch(patch));
	}
});

test('texture defaults accept persistent references and clearing while rejecting malformed paths', async () => {
	await updateDrawingConfig({ texture: 'worlds/test/stone.webp', fillType: 2 });
	assert.equal(stored.texture, 'worlds/test/stone.webp');
	assert.equal(stored.fillType, 2);
	assert.equal(stored.strokeColor, '#123456');
	await updateDrawingConfig({ texture: null, fillType: 1 });
	assert.equal(stored.texture, null);
	for (const texture of ['', ' padded.png ', 'a\\b.png', 'javascript:alert(1)', 42, 'a'.repeat(2049)]) {
		assert.throws(() => normalizeDrawingPatch({ texture }), /texture/);
	}
	assert.equal(normalizeDrawingPatch({ texture: 'https://example.com/texture.png' }).texture, 'https://example.com/texture.png',
		'existing external references remain representable for project/layer-default compatibility');
});

test('persistence and palette refresh failures reject explicitly', async () => {
	game.settings.set = async () => { throw new Error('Storage failure'); };
	await assert.rejects(updateDrawingConfig({ strokeWidth: 3 }), /Storage failure/);
	game.settings.set = async () => {};
	ui.placeablesPalette = new DrawingPalette();
	ui.placeablesPalette.render = async () => { throw new Error('Render failure'); };
	await assert.rejects(updateDrawingConfig({ strokeWidth: 3 }), /Render failure/);
});

test('repeat defaults persist separately from native palette fields and verify storage', async () => {
	let repeat = 1;
	const get = game.settings.get, set = game.settings.set;
	game.settings.get = (namespace, key) => namespace === 'foundryshop' ? repeat : get(namespace, key);
	game.settings.set = async (namespace, key, value, options) => {
		if (namespace === 'foundryshop') repeat = value;
		else await set(namespace, key, value, options);
	};
	await updateDrawingConfig({ materialRepeat: '2' });
	assert.equal(readDrawingConfig().materialRepeat, 2);
	assert.equal(writes.length, 0, 'scale-only changes do not alter native defaults');
	await updateDrawingConfig({ fillType: 2 });
	assert.equal(stored.materialRepeat, undefined);
	game.settings.set = async () => {};
	await assert.rejects(updateDrawingConfig({ materialRepeat: 3 }), /not saved/);
});
