import { normalizeSavedColor, normalizeColorName } from './saved_colors.js';
import { validateMaterialRepeat } from './material_fill.js';
import { classifyTexturePath } from './layers/project_resources.js';
import { verifyLocalMaterial } from './texture_materials.js';
import { appearanceContext, sameAppearanceContext, setAppearanceOverride } from './appearance_state.js';

const loc = key => game.i18n.localize(`FOUNDRYSHOP.Pairs.${key}`);

export function normalizeAppearance(entry) {
	if (!entry || entry.kind !== 'pair' || ![0, 1, 2].includes(entry.fillType)) throw new Error(loc('Invalid'));
	const strokeColor = normalizeSavedColor(entry.strokeColor), fillColor = normalizeSavedColor(entry.fillColor);
	const name = normalizeColorName(entry.name, `${strokeColor} / ${fillColor}`);
	if (entry.fillType === 2 && (typeof entry.texture !== 'string' || entry.texture.length > 2048
		|| classifyTexturePath(entry.texture, globalThis.location?.href ?? 'http://localhost/').kind !== 'local')) {
		throw new Error(loc('LocalOnly'));
	}
	if (['strokeWidth', 'strokeAlpha', 'fillAlpha'].some(key => Object.hasOwn(entry, key))) throw new Error(loc('Invalid'));
	return { kind: 'pair', name, strokeColor, fillColor, fillType: entry.fillType,
		texture: entry.fillType === 2 ? entry.texture : null,
		materialRepeat: entry.fillType === 2 ? validateMaterialRepeat(entry.materialRepeat, { squares: true }) : 1 };
}

export async function verifyAppearance(entry, options, verify = verifyLocalMaterial) {
	const normalized = normalizeAppearance(entry);
	if (normalized.fillType === 2) await verify(normalized.texture, options);
	return normalized;
}

export async function applyAppearance(entry, { signal, checkCurrent = () => true } = {}, verify = verifyLocalMaterial) {
	if (!game.user.isGM || !canvas.ready || !canvas.drawings?.active || !game.user.can('DRAWING_CREATE')) {
		throw new Error(loc('Unavailable'));
	}
	const context = appearanceContext();
	const normalized = await verifyAppearance(entry, { signal }, verify);
	if (signal?.aborted || !checkCurrent() || !game.user.isGM || !canvas.ready || !canvas.drawings?.active
		|| !game.user.can('DRAWING_CREATE') || !sameAppearanceContext(context, appearanceContext())) {
		throw new Error(loc('Changed'));
	}
	const { kind, name, ...patch } = normalized;
	setAppearanceOverride(name, patch);
	return normalized;
}
