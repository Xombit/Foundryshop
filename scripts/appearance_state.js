import { MODULE } from './constants.js';
import { materialCreationPatch } from './material_fill.js';

export const APPEARANCE_CHANGED = 'foundryshopAppearanceChanged';
export const APPEARANCE_FIELDS = ['strokeColor', 'fillColor', 'fillType', 'texture', 'materialRepeat'];
let current = null;

export function appearanceContext() {
	const scene = globalThis.canvas?.scene;
	return { scene, level: globalThis.canvas?.level?.id,
		layer: game.settings.get(MODULE, 'layerWorkspace')?.scenes?.[scene?.id]?.activeLayerId ?? null };
}

export function sameAppearanceContext(a, b) {
	return a.scene === b.scene && a.level === b.level && a.layer === b.layer;
}

export function clearAppearanceOverride() {
	if (!current) return;
	current = null;
	Hooks.callAll(APPEARANCE_CHANGED);
}

export function getAppearanceOverride() {
	if (current && (!game.user.isGM || !sameAppearanceContext(current.context, appearanceContext()))) {
		clearAppearanceOverride();
	}
	return current ? structuredClone({ name: current.name, patch: current.patch, modified: current.modified }) : null;
}

export function setAppearanceOverride(name, patch) {
	current = { name, patch: structuredClone(patch), context: appearanceContext(), modified: false };
	Hooks.callAll(APPEARANCE_CHANGED);
}

export function updateAppearanceOverride(patch) {
	if (!getAppearanceOverride()) return false;
	const appearance = Object.fromEntries(Object.entries(patch).filter(([key]) => APPEARANCE_FIELDS.includes(key)));
	if (!Object.keys(appearance).length) return false;
	Object.assign(current.patch, appearance);
	if (current.patch.fillType !== 2) {
		current.patch.texture = null;
		current.patch.materialRepeat = 1;
	}
	current.modified = true;
	Hooks.callAll(APPEARANCE_CHANGED);
	return true;
}

export function installAppearancePreview(layer) {
	if (Object.getOwnPropertyDescriptor(layer, 'paletteCreateData')?.get?.foundryshopAppearancePreview) return;
	let prototype = layer, descriptor;
	while (prototype && !descriptor) {
		descriptor = Object.getOwnPropertyDescriptor(prototype, 'paletteCreateData');
		prototype = Object.getPrototypeOf(prototype);
	}
	if (!descriptor?.get) throw new Error('Drawing creation palette getter is unavailable.');
	const native = descriptor.get;
	const getter = function() {
		const data = native.call(this);
		const override = getAppearanceOverride();
		if (!override || !game.user.isGM || !this.active) return data;
		const source = { ...data, ...materialCreationPatch(override.patch, canvas.scene) };
		if (override.patch.fillType !== 2) {
			delete source[`flags.${MODULE}.materialRepeat`];
			if (source.flags?.[MODULE]?.materialRepeat !== undefined) {
				source.flags = structuredClone(source.flags);
				delete source.flags[MODULE].materialRepeat;
			}
		}
		return source;
	};
	getter.foundryshopAppearancePreview = true;
	Object.defineProperty(layer, 'paletteCreateData', { configurable: true, get: getter });
}

export function initAppearanceOverrides() {
	Hooks.on('canvasTearDown', clearAppearanceOverride);
	Hooks.on('canvasReady', () => {
		clearAppearanceOverride();
		try { installAppearancePreview(canvas.drawings); }
		catch (error) {
			console.error('Foundryshop appearance:', error);
			ui.notifications.error(game.i18n.format('FOUNDRYSHOP.Error', { message: error.message }));
		}
	});
}
