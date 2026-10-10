import { normalizeDrawingPatch } from './drawing_config.js';
import { materialCreationPatch } from './material_fill.js';
import { verifyLocalMaterial } from './texture_materials.js';
import { isDrawingLayerLocked } from './layers/layer_manager.js';

const error = key => new Error(game.i18n.localize(`FOUNDRYSHOP.Materials.${key}`));

function requireEditable(document, scene) {
	if (!game.user.isGM || !document || document.parent !== scene || document.locked
		|| isDrawingLayerLocked(document) || !document.canUserModify(game.user, 'update')) throw error('SelectionLocked');
	if (document.getFlag('foundryshop', 'imageStamp') === 1) throw error('ImageStamp');
	if (document.getFlag('foundryshop', 'importStaging')) throw error('SelectionLocked');
}

export function prepareMaterialSelection(scene, documents, config) {
	if (!scene || !documents.length || new Set(documents.map(document => document.id)).size !== documents.length) {
		throw error('SelectArtwork');
	}
	const defaults = normalizeDrawingPatch({
		fillType: config.fillType, fillColor: config.fillColor, fillAlpha: config.fillAlpha,
		texture: config.fillType === 2 ? config.texture : null, materialRepeat: config.materialRepeat ?? 1,
	});
	if (defaults.fillType === 2 && !defaults.texture) throw error('MissingTexture');
	const patch = materialCreationPatch(defaults, scene);
	const entries = documents.map(document => {
		requireEditable(document, scene);
		if (!document.id || scene.drawings.get(document.id) !== document) throw error('SelectionChanged');
		const before = document.toObject();
		const expected = structuredClone(before);
		for (const key of ['fillType', 'fillColor', 'fillAlpha', 'texture']) expected[key] = patch[key];
		const update = { _id: document.id, ...patch };
		if (defaults.fillType === 2) {
			expected.flags ??= {};
			expected.flags.foundryshop ??= {};
			expected.flags.foundryshop.materialRepeat = patch['flags.foundryshop.materialRepeat'];
		} else if (document.getFlag('foundryshop', 'materialRepeat') !== undefined) {
			update['flags.foundryshop.-=materialRepeat'] = null;
			delete expected.flags.foundryshop.materialRepeat;
		}
		return { id: document.id, before: JSON.stringify(before), expected: JSON.stringify(expected), update };
	});
	return { scene, grid: JSON.stringify(scene.grid), texture: defaults.texture, entries };
}

export async function applyMaterialSelection(plan, { checkContext, verify = verifyLocalMaterial } = {}) {
	const check = () => {
		checkContext?.();
		if (JSON.stringify(plan.scene.grid) !== plan.grid) throw error('SelectionChanged');
		for (const entry of plan.entries) {
			const document = plan.scene.drawings.get(entry.id);
			requireEditable(document, plan.scene);
			if (JSON.stringify(document.toObject()) !== entry.before) throw error('SelectionChanged');
		}
	};
	check();
	if (plan.texture) await verify(plan.texture);
	check();
	const changed = plan.entries.filter(entry => entry.before !== entry.expected);
	if (!changed.length) return 0;
	try {
		await plan.scene.updateEmbeddedDocuments('Drawing', changed.map(entry => entry.update));
	} catch (cause) {
		throw new Error(`${error('ApplyFailed').message} ${cause.message}`, { cause });
	}
	for (const entry of changed) {
		const document = plan.scene.drawings.get(entry.id);
		const expected = JSON.parse(entry.expected), actual = document?.toObject();
		// Foundry updates modification statistics as part of a successful document write.
		delete expected._stats;
		if (actual) delete actual._stats;
		if (!actual || JSON.stringify(actual) !== JSON.stringify(expected)) throw error('ApplyFailed');
	}
	return changed.length;
}
