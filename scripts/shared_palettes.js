import { MODULE } from './constants.js';
import { PALETTE_CHANGED, readPalette, validatePalette, normalizeColorName, normalizeSavedColor } from './saved_colors.js';
import { BUILTIN_PALETTES } from './builtin_palettes.js';
import { normalizeAppearance } from './appearance_swatches.js';

export const SHARED_PALETTES = 'sharedPalettes';
export const MAX_PALETTES = 32;
export const MAX_SHARED_COLORS = 2048;
const loc = key => game.i18n.localize(`FOUNDRYSHOP.Palettes.${key}`);
let queue = Promise.resolve();

export const builtinSharedId = id => `builtin-${id}`;
const builtinSource = id => BUILTIN_PALETTES.find(entry => builtinSharedId(entry.id) === id);
const defaultPalette = source => ({
	id: builtinSharedId(source.id),
	name: game.i18n.localize(`FOUNDRYSHOP.Builtins.Palette.${source.id}`),
	colors: structuredClone(source.colors),
});

export function effectivePalettes(data = readSharedPalettes()) {
	return [
		...BUILTIN_PALETTES.map(source => ({
			...(data.palettes.find(entry => entry.id === builtinSharedId(source.id)) ?? defaultPalette(source)),
			builtin: source.id,
		})),
		...data.palettes.filter(entry => !builtinSource(entry.id)),
	].map(entry => structuredClone(entry));
}

function requireGM() {
	if (!game.user.isGM) throw new Error(loc('GMOnly'));
}

function paletteName(name) {
	if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new Error(loc('InvalidName'));
	return name.trim();
}

export function validateSharedPalettes(data) {
	if (!data || data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0
		|| !Array.isArray(data.palettes)) throw new Error(loc('Invalid'));
	if (data.palettes.length > MAX_PALETTES) throw new Error(loc('Full'));
	const ids = new Set(), names = new Set();
	let count = 0;
	const palettes = data.palettes.map(entry => {
		if (!entry || typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.id) || ids.has(entry.id)) {
			throw new Error(loc('Invalid'));
		}
		const name = paletteName(entry.name);
		if (names.has(name.toLowerCase())) throw new Error(loc('DuplicateName'));
		ids.add(entry.id);
		names.add(name.toLowerCase());
		if (Array.isArray(entry.colors) && entry.colors.length > 256) throw new Error(loc('Full'));
		if (!Array.isArray(entry.colors)) throw new Error(loc('Invalid'));
		const singles = validatePalette({ schemaVersion: 1,
			colors: entry.colors.filter(color => color?.kind !== 'pair') }).colors;
		const colorIds = new Set();
		const colors = entry.colors.map(color => {
			if (!color || typeof color.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(color.id)
				|| colorIds.has(color.id)) throw new Error(loc('Invalid'));
			colorIds.add(color.id);
			if (color.kind === 'pair') return { id: color.id, ...normalizeAppearance(color) };
			if (color.kind !== undefined && color.kind !== 'color') throw new Error(loc('Invalid'));
			return singles.find(single => single.id === color.id);
		});
		count += colors.length;
		return { id: entry.id, name, colors };
	});
	if (count > MAX_SHARED_COLORS) throw new Error(loc('Full'));
	const validated = { version: 1, revision: data.revision, palettes };
	const effective = effectivePalettes(validated);
	if (effective.length > MAX_PALETTES || effective.reduce((total, entry) => total + entry.colors.length, 0) > MAX_SHARED_COLORS) {
		throw new Error(loc('Full'));
	}
	if (new Set(effective.map(entry => entry.name.toLowerCase())).size !== effective.length) throw new Error(loc('DuplicateName'));
	return validated;
}

export function readSharedPalettes() {
	return validateSharedPalettes(game.settings.get(MODULE, SHARED_PALETTES));
}

function mutate(expectedRevision, operation) {
	requireGM();
	const result = queue.then(async () => {
		requireGM();
		const before = readSharedPalettes();
		if (before.revision !== expectedRevision) throw new Error(loc('Changed'));
		const next = structuredClone(before);
		operation(next.palettes);
		const validated = validateSharedPalettes({ ...next, revision: before.revision + 1 });
		await game.settings.set(MODULE, SHARED_PALETTES, validated);
		if (JSON.stringify(readSharedPalettes()) !== JSON.stringify(validated)) throw new Error(loc('WriteFailed'));
		Hooks.callAll(PALETTE_CHANGED);
		return validated;
	});
	queue = result.then(() => {}, () => {});
	return result;
}

function find(palettes, id) {
	let palette = palettes.find(entry => entry.id === id);
	if (!palette && builtinSource(id)) {
		palette = defaultPalette(builtinSource(id));
		palettes.push(palette);
	}
	if (!palette) throw new Error(loc('Changed'));
	return palette;
}

function freshId(entries) {
	const id = foundry.utils.randomID();
	if (entries.some(entry => entry.id === id) || builtinSource(id)) throw new Error(loc('Collision'));
	return id;
}

export function createSharedPalette(name, expectedRevision, colors = []) {
	return mutate(expectedRevision, palettes => {
		palettes.push({ id: freshId(palettes), name: paletteName(name), colors: structuredClone(colors) });
	});
}

export function adoptSavedPalette(scope, name, expectedRevision) {
	requireGM();
	const colors = readPalette(scope).colors;
	return createSharedPalette(name, expectedRevision, colors);
}

export function renameSharedPalette(id, name, expectedRevision) {
	return mutate(expectedRevision, palettes => { find(palettes, id).name = paletteName(name); });
}

export function duplicateSharedPalette(id, name, expectedRevision) {
	return mutate(expectedRevision, palettes => {
		const source = effectivePalettes({ palettes }).find(entry => entry.id === id);
		if (!source) throw new Error(loc('Changed'));
		palettes.push({ ...structuredClone(source), id: freshId(palettes), name: paletteName(name) });
	});
}

export function removeSharedPalette(id, expectedRevision) {
	return mutate(expectedRevision, palettes => {
		if (builtinSource(id)) throw new Error(loc('Invalid'));
		find(palettes, id);
		palettes.splice(palettes.findIndex(entry => entry.id === id), 1);
	});
}

export function resetBuiltinPalette(id, expectedRevision) {
	if (!builtinSource(id)) throw new Error(loc('Invalid'));
	return mutate(expectedRevision, palettes => {
		const index = palettes.findIndex(entry => entry.id === id);
		if (index >= 0) palettes.splice(index, 1);
	});
}

function move(entries, id, delta) {
	if (![1, -1].includes(delta)) throw new Error(loc('Invalid'));
	const index = entries.findIndex(entry => entry.id === id);
	if (index < 0 || index + delta < 0 || index + delta >= entries.length) throw new Error(loc('Changed'));
	const [entry] = entries.splice(index, 1);
	entries.splice(index + delta, 0, entry);
}

export function moveSharedPalette(id, delta, expectedRevision) {
	return mutate(expectedRevision, palettes => move(palettes, id, delta));
}

export function saveSharedColor(id, color, name, expectedRevision) {
	return mutate(expectedRevision, palettes => {
		const entries = find(palettes, id).colors;
		const normalized = normalizeSavedColor(color);
		if (entries.some(entry => entry.color === normalized)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.Duplicate'));
		entries.push({ id: freshId(entries), color: normalized, name: normalizeColorName(name, normalized) });
	});
}

export function editSharedColor(id, colorId, color, name, expectedRevision) {
	return mutate(expectedRevision, palettes => {
		const entries = find(palettes, id).colors;
		const entry = entries.find(entry => entry.id === colorId);
		if (!entry || entry.kind === 'pair') throw new Error(loc('Changed'));
		const normalized = normalizeSavedColor(color);
		if (entries.some(other => other.id !== colorId && other.color === normalized)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.Duplicate'));
		Object.assign(entry, { color: normalized, name: normalizeColorName(name, normalized) });
	});
}

export function saveSharedAppearance(id, appearance, expectedRevision, entryId = null) {
	const normalized = normalizeAppearance(appearance);
	return mutate(expectedRevision, palettes => {
		const entries = find(palettes, id).colors;
		if (entryId !== null) {
			const index = entries.findIndex(entry => entry.id === entryId && entry.kind === 'pair');
			if (index < 0) throw new Error(loc('Changed'));
			entries[index] = { id: entryId, ...normalized };
		} else entries.push({ id: freshId(entries), ...normalized });
	});
}

export function duplicateSharedAppearance(id, entryId, name, expectedRevision) {
	return mutate(expectedRevision, palettes => {
		const entries = find(palettes, id).colors;
		const entry = entries.find(entry => entry.id === entryId && entry.kind === 'pair');
		if (!entry) throw new Error(loc('Changed'));
		entries.push({ id: freshId(entries), ...normalizeAppearance({ ...entry, name }) });
	});
}

export function removeSharedColor(id, colorId, expectedRevision) {
	return mutate(expectedRevision, palettes => {
		const entries = find(palettes, id).colors;
		const index = entries.findIndex(entry => entry.id === colorId);
		if (index < 0) throw new Error(loc('Changed'));
		entries.splice(index, 1);
	});
}

export function moveSharedColor(id, colorId, delta, expectedRevision) {
	return mutate(expectedRevision, palettes => move(find(palettes, id).colors, colorId, delta));
}

export function importSharedColors(id, text, expectedRevision) {
	if (typeof text !== 'string') throw new Error(loc('Invalid'));
	const colors = [...new Set(text.trim() ? text.split(',').map(color => normalizeSavedColor(color.trim())) : [])];
	return mutate(expectedRevision, palettes => {
		const entries = find(palettes, id).colors;
		for (const color of colors) {
			if (!entries.some(entry => entry.color === color)) entries.push({ id: freshId(entries), name: color, color });
		}
	});
}
