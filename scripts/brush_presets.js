import { MODULE } from './constants.js';
import { DRAWING_FIELDS, normalizeDrawingPatch } from './drawing_config.js';

export const SETTINGS_BRUSH_PRESETS = 'brushPresets';
export const MAX_BRUSH_PRESETS = 32;
export const MAX_BRUSH_PRESET_NAME = 60;

const STARTERS = [
	{ id: 'starter-wall', patch: { strokeColor: '#302b26', strokeWidth: 12, strokeAlpha: 1, fillType: 0 } },
	{ id: 'starter-sketch', patch: { strokeColor: '#535e60', strokeWidth: 3, strokeAlpha: 0.7, fillType: 0 } },
	{ id: 'starter-floor', patch: { strokeColor: '#594538', strokeWidth: 6, strokeAlpha: 1,
		fillColor: '#e8d8b5', fillType: 1, fillAlpha: 1 } },
	{ id: 'starter-water', patch: { strokeColor: '#526f83', strokeWidth: 4, strokeAlpha: 1,
		fillColor: '#8faeb0', fillType: 1, fillAlpha: 0.6 } },
];

const loc = key => game.i18n.localize(`FOUNDRYSHOP.BrushPresets.${key}`);

function starters() {
	return STARTERS.map(({ id, patch }) => ({ id, name: loc(`Starter.${id}`), patch: { ...patch } }));
}

function validateName(name) {
	if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_BRUSH_PRESET_NAME) {
		throw new Error(game.i18n.format('FOUNDRYSHOP.BrushPresets.InvalidName', { max: MAX_BRUSH_PRESET_NAME }));
	}
	return name.trim();
}

function validate(data) {
	if (!data || data.schemaVersion !== 1 || (data.presets !== null && !Array.isArray(data.presets))) {
		throw new Error(loc('Invalid'));
	}
	if (data.presets === null) return starters();
	if (data.presets.length > MAX_BRUSH_PRESETS) throw new Error(loc('Invalid'));
	const ids = new Set();
	return data.presets.map(entry => {
		if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) || !entry.patch) throw new Error(loc('Invalid'));
		ids.add(entry.id);
		return { id: entry.id, name: validateName(entry.name), patch: normalizeDrawingPatch(entry.patch) };
	});
}

export function readBrushPresets() {
	return validate(game.settings.get(MODULE, SETTINGS_BRUSH_PRESETS));
}

/** Capture the brush fields of the current drawing defaults. */
export function capturePresetPatch(config) {
	const patch = {};
	for (const key of DRAWING_FIELDS) {
		if (config[key] !== undefined && !(key === 'texture' && !config[key])) patch[key] = config[key];
	}
	if (patch.fillType !== 2) { delete patch.texture; delete patch.materialRepeat; }
	return normalizeDrawingPatch(patch);
}

/** Preset fields are applied as a patch; texture is cleared unless the preset uses a pattern fill. */
export function presetApplyPatch(preset) {
	return preset.patch.fillType === 2 ? { ...preset.patch } : { texture: null, ...preset.patch };
}

export function matchingPresetId(presets, config) {
	return presets.find(preset => Object.entries(preset.patch).every(([key, value]) => {
		const current = config[key];
		return typeof value === 'number' ? Math.abs(Number(current) - value) < 1e-6 : String(current).toLowerCase() === String(value).toLowerCase();
	}))?.id ?? '';
}

async function write(presets) {
	const data = { schemaVersion: 1, presets };
	validate(data);
	await game.settings.set(MODULE, SETTINGS_BRUSH_PRESETS, data);
}

export async function saveBrushPreset(name, config) {
	const presets = readBrushPresets();
	if (presets.length >= MAX_BRUSH_PRESETS) {
		throw new Error(game.i18n.format('FOUNDRYSHOP.BrushPresets.Full', { max: MAX_BRUSH_PRESETS }));
	}
	const preset = { id: foundry.utils.randomID(), name: validateName(name), patch: capturePresetPatch(config) };
	await write([...presets, preset]);
	return preset;
}

export async function deleteBrushPreset(id) {
	const presets = readBrushPresets();
	if (!presets.some(preset => preset.id === id)) throw new Error(loc('Changed'));
	await write(presets.filter(preset => preset.id !== id));
}

export function registerBrushPresetSetting(onChange) {
	game.settings.register(MODULE, SETTINGS_BRUSH_PRESETS, {
		scope: 'user', config: false, type: Object,
		default: { schemaVersion: 1, presets: null },
		onChange,
	});
}
