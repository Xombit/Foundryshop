import { MODULE } from './constants.js';
import { pathOptions } from './path_geometry.js';

export const SETTINGS_PATH_PRESETS = 'pathPresets';
export const MAX_PATH_PRESETS = 32;
export const MAX_PATH_PRESET_NAME = 60;
const loc = key => game.i18n.localize(`FOUNDRYSHOP.Paths.${key}`);
const starters = () => ['plain', 'railway', 'road', 'river'].map(style => ({
	id: `starter-${style}`, name: loc(`Style.${style}`), closed: false,
	options: pathOptions({ style, ...(style === 'plain' ? { width: 0.03 } : {}) }),
}));

export function validatePathPresets(data) {
	if (!data || data.version !== 1 || Object.keys(data).some(key => !['version', 'presets'].includes(key))
		|| (data.presets !== null && (!Array.isArray(data.presets) || data.presets.length > MAX_PATH_PRESETS))) throw new Error(loc('PresetInvalid'));
	if (data.presets === null) return starters();
	const ids = new Set();
	return data.presets.map(entry => {
		if (!entry || Object.keys(entry).some(key => !['id', 'name', 'closed', 'options'].includes(key))
			|| typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.id) || ids.has(entry.id)
			|| typeof entry.name !== 'string' || !entry.name.trim() || entry.name.trim().length > MAX_PATH_PRESET_NAME
			|| typeof entry.closed !== 'boolean' || !entry.options
			|| Object.keys(entry.options).some(key => !Object.hasOwn(pathOptions(), key))
			|| Object.keys(pathOptions()).some(key => !Object.hasOwn(entry.options, key))) throw new Error(loc('PresetInvalid'));
		ids.add(entry.id);
		return { id: entry.id, name: entry.name.trim(), closed: entry.closed, options: pathOptions(entry.options) };
	});
}

export function readPathPresets() { return validatePathPresets(game.settings.get(MODULE, SETTINGS_PATH_PRESETS)); }

export function pathPresetPatch(preset) {
	const { seed, ...options } = preset.options;
	return { ...options, closed: preset.closed };
}

export async function savePathPreset(name, options, closed) {
	const presets = readPathPresets();
	if (presets.length >= MAX_PATH_PRESETS) throw new Error(loc('PresetFull'));
	const preset = { id: foundry.utils.randomID(), name, options: pathOptions(options), closed };
	const data = { version: 1, presets: [...presets, preset] };
	validatePathPresets(data);
	await game.settings.set(MODULE, SETTINGS_PATH_PRESETS, data);
	return preset;
}

export async function deletePathPreset(id) {
	const presets = readPathPresets();
	if (!presets.some(entry => entry.id === id)) throw new Error(loc('PresetChanged'));
	await game.settings.set(MODULE, SETTINGS_PATH_PRESETS, { version: 1, presets: presets.filter(entry => entry.id !== id) });
}

export function registerPathPresetSetting() {
	game.settings.register(MODULE, SETTINGS_PATH_PRESETS, {
		scope: 'user', config: false, type: Object, default: { version: 1, presets: null },
		onChange: () => Hooks.callAll('foundryshopPathPresetsChanged'),
	});
}
