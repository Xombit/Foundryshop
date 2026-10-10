import { classifyTexturePath } from './layers/project_resources.js';
import { MODULE } from './constants.js';
import { MATERIAL_REPEAT, validateMaterialRepeat } from './material_fill.js';
import { APPEARANCE_FIELDS, getAppearanceOverride, updateAppearanceOverride } from './appearance_state.js';

export const DRAWING_FIELDS = ['strokeColor', 'fillColor', 'strokeAlpha', 'fillAlpha', 'strokeWidth', 'fillType', 'texture', MATERIAL_REPEAT];

export function drawingSettingKey() {
	const key = foundry.applications.sheets.palette?.DrawingPalette?.SETTING_KEY
		?? foundry.canvas.layers.DrawingsLayer.DEFAULT_CONFIG_SETTING;
	if (!key) throw new Error('No supported drawing defaults setting is available.');
	return key;
}

export function readDrawingConfig({ appearance = true } = {}) {
	const config = game.settings.get('core', drawingSettingKey());
	if (!config || typeof config !== 'object') throw new Error('Drawing defaults could not be loaded.');
	const repeat = game.settings.get(MODULE, MATERIAL_REPEAT);
	return { ...foundry.utils.deepClone(config), ...(repeat === undefined ? {} : {
		materialRepeat: validateMaterialRepeat(repeat, { squares: true }),
	}), ...(appearance ? getAppearanceOverride()?.patch : {}) };
}

export function normalizeDrawingPatch(patch) {
	const normalized = {};
	for (const [key, value] of Object.entries(patch)) {
		if (!DRAWING_FIELDS.includes(key)) throw new Error(`Unsupported drawing property: ${key}`);
		if (key === MATERIAL_REPEAT) {
			const number = typeof value === 'string' && !value.trim() ? NaN : Number(value);
			normalized[key] = validateMaterialRepeat(number, { squares: true });
		} else if (key === 'texture') {
			if (value !== null && (typeof value !== 'string' || value.length > 2048
				|| classifyTexturePath(value, globalThis.location?.href ?? 'http://localhost/').kind === 'invalid')) {
				throw new Error('Invalid drawing texture path.');
			}
			normalized[key] = value;
		} else if (key.endsWith('Color')) {
			if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Invalid drawing color: ${value}`);
			normalized[key] = value;
		} else {
			const number = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
			if (!Number.isFinite(number)) throw new Error(`Invalid drawing value for ${key}: ${value}`);
			if (key === 'fillType') {
				if (![0, 1, 2].includes(number)) throw new Error(`Invalid drawing fill type: ${value}`);
				normalized[key] = number;
			} else if (key === 'strokeWidth') {
				normalized[key] = Math.max(0, Math.floor(number));
			} else {
				normalized[key] = Math.min(1, Math.max(0, number));
			}
		}
	}
	return normalized;
}

/**
 * @param {object} patch
 * @param {object} [options]
 * @param {true|string} [options.source]  Identifies the writer so each Foundryshop window can ignore only its own echo.
 */
export async function updateDrawingConfig(patch, { source = true } = {}) {
	const normalized = normalizeDrawingPatch(patch);
	const paired = getAppearanceOverride();
	const consumed = paired && Object.keys(normalized).some(key => APPEARANCE_FIELDS.includes(key));
	const persistent = Object.fromEntries(Object.entries(normalized).filter(([key]) => !consumed || !APPEARANCE_FIELDS.includes(key)));
	const native = { ...foundry.utils.deepClone(game.settings.get('core', drawingSettingKey())), ...persistent };
	delete native.materialRepeat;
	const materialRepeat = persistent.materialRepeat;
	if (Object.hasOwn(persistent, MATERIAL_REPEAT)) {
		await game.settings.set(MODULE, MATERIAL_REPEAT, materialRepeat);
		if (game.settings.get(MODULE, MATERIAL_REPEAT) !== materialRepeat) throw new Error('Material repeat setting was not saved.');
	}
	if (Object.keys(persistent).some(key => key !== MATERIAL_REPEAT)) {
		await game.settings.set('core', drawingSettingKey(), native, { foundryshopSource: source });
	}
	if (consumed) updateAppearanceOverride(normalized);
	const palette = ui.placeablesPalette;
	const DrawingPalette = foundry.applications.sheets.palette?.DrawingPalette;
	// Selection mode has its own draft; Foundryshop only edits creation defaults.
	if (DrawingPalette && palette instanceof DrawingPalette && palette.rendered && !palette.isSelect) {
		await palette.render();
	}
}
