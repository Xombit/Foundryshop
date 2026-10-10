import { MODULE } from './constants.js';

export const PERSONAL_COLORS = 'personalColors';
export const CAMPAIGN_COLORS = 'campaignColors';
export const PALETTE_CHANGED = 'foundryshopPaletteChanged';
export const MAX_COLORS = 256;
export const MAX_NAME_LENGTH = 80;

const queues = new Map();

export function paletteKey(scope) {
	if (scope === 'personal') return PERSONAL_COLORS;
	if (scope === 'campaign') return CAMPAIGN_COLORS;
	throw new Error('Invalid palette scope.');
}

export function normalizeSavedColor(color) {
	if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
		throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.InvalidColor'));
	}
	return color.toLowerCase();
}

export function normalizeColorName(name, color) {
	if (typeof name !== 'string' || name.trim().length > MAX_NAME_LENGTH) {
		throw new Error(game.i18n.format('FOUNDRYSHOP.Saved.InvalidName', { max: MAX_NAME_LENGTH }));
	}
	return name.trim() || color;
}

export function validatePalette(data) {
	if (!data || data.schemaVersion !== 1 || !Array.isArray(data.colors) || data.colors.length > MAX_COLORS) {
		throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.InvalidPalette'));
	}
	const ids = new Set();
	const colors = new Set();
	const entries = data.colors.map(entry => {
		if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) {
			throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.InvalidPalette'));
		}
		const color = normalizeSavedColor(entry.color);
		if (colors.has(color)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.InvalidPalette'));
		ids.add(entry.id);
		colors.add(color);
		return { id: entry.id, name: normalizeColorName(entry.name, color), color };
	});
	return { schemaVersion: 1, colors: entries };
}

export function readPalette(scope) {
	return validatePalette(game.settings.get(MODULE, paletteKey(scope)));
}

export function canEditPalette(scope) {
	paletteKey(scope);
	return scope === 'personal' || game.user.isGM;
}

function mutatePalette(scope, mutate) {
	const key = paletteKey(scope);
	if (!canEditPalette(scope)) {
		return Promise.reject(new Error(game.i18n.localize('FOUNDRYSHOP.Saved.GMOnly')));
	}
	const previous = queues.get(key) ?? Promise.resolve();
	const operation = previous.then(async () => {
		if (!canEditPalette(scope)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.GMOnly'));
		const palette = readPalette(scope);
		const before = JSON.stringify(palette);
		mutate(palette.colors);
		const validated = validatePalette(palette);
		if (JSON.stringify(validated) === before) return validated;
		await game.settings.set(MODULE, key, validated);
		return validated;
	});
	// Callers receive the original rejection; a failed operation must not poison the next edit.
	const settled = operation.then(() => {}, () => {});
	queues.set(key, settled);
	settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
	return operation;
}

export function saveColor(scope, color, name) {
	color = normalizeSavedColor(color);
	name = normalizeColorName(name, color);
	return mutatePalette(scope, entries => {
		if (entries.some(entry => entry.color === color)) {
			throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.Duplicate'));
		}
		if (entries.length >= MAX_COLORS) {
			throw new Error(game.i18n.format('FOUNDRYSHOP.Saved.Full', { max: MAX_COLORS }));
		}
		entries.push({ id: foundry.utils.randomID(), name, color });
	});
}

export function editColor(scope, expected, color, name) {
	color = normalizeSavedColor(color);
	name = normalizeColorName(name, color);
	return mutatePalette(scope, entries => {
		const entry = entries.find(entry => entry.id === expected.id);
		if (!entry || entry.color !== expected.color || entry.name !== expected.name) {
			throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.Changed'));
		}
		if (entries.some(other => other.id !== entry.id && other.color === color)) {
			throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.Duplicate'));
		}
		Object.assign(entry, { color, name });
	});
}

export function deleteColor(scope, expected) {
	return mutatePalette(scope, entries => {
		const index = entries.findIndex(entry => entry.id === expected.id);
		if (index < 0 || entries[index].color !== expected.color || entries[index].name !== expected.name) {
			throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.Changed'));
		}
		entries.splice(index, 1);
	});
}

export function importPresetColors(scope, text) {
	if (typeof text !== 'string') throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.InvalidPalette'));
	const colors = text.trim() ? [...new Set(text.split(',').map(color => normalizeSavedColor(color.trim())))] : [];
	return mutatePalette(scope, entries => {
		const additions = colors.filter(color => !entries.some(entry => entry.color === color));
		if (entries.length + additions.length > MAX_COLORS) {
			throw new Error(game.i18n.format('FOUNDRYSHOP.Saved.Full', { max: MAX_COLORS }));
		}
		for (const color of additions) entries.push({ id: foundry.utils.randomID(), name: color, color });
	});
}
