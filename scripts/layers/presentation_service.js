import { layerError, normalizePresetName } from './layer_tree_store.js';
import { mutateLayerTree } from './layer_manager.js';

export function presentationPreset(tree, id) {
	const preset = tree.presets.find(entry => entry.id === id);
	if (!preset) throw layerError('Changed');
	return preset;
}

export function analyzePresentationPreset(tree, preset) {
	const nodes = new Set(tree.nodes.map(node => node.id));
	const saved = new Map(preset.entries.map(entry => [entry.nodeId, entry.playerAllowed]));
	const missingIds = preset.entries.filter(entry => !nodes.has(entry.nodeId)).map(entry => entry.nodeId);
	const newIds = tree.nodes.filter(node => !saved.has(node.id)).map(node => node.id);
	return {
		missingIds, newIds,
		matches: !missingIds.length && tree.nodes.every(node => node.playerAllowed === (saved.get(node.id) ?? false)),
	};
}

function captureEntries(tree) {
	if (!tree.nodes.length) throw layerError('NoPresetNodes');
	return tree.nodes.map(node => ({ nodeId: node.id, playerAllowed: node.playerAllowed }));
}

export function capturePresentationPreset(scene, name, expectedRevision) {
	return mutateLayerTree(scene, tree => {
		tree.presets.push({
			id: foundry.utils.randomID(), name: normalizePresetName(name), entries: captureEntries(tree),
		});
	}, { expectedRevision });
}

export function recapturePresentationPreset(scene, id, expectedRevision) {
	return mutateLayerTree(scene, tree => {
		presentationPreset(tree, id).entries = captureEntries(tree);
	}, { expectedRevision });
}

export function renamePresentationPreset(scene, id, name, expectedRevision) {
	return mutateLayerTree(scene, tree => {
		presentationPreset(tree, id).name = normalizePresetName(name);
	}, { expectedRevision });
}

export function removePresentationPreset(scene, id, expectedRevision) {
	return mutateLayerTree(scene, tree => {
		const preset = presentationPreset(tree, id);
		tree.presets.splice(tree.presets.indexOf(preset), 1);
	}, { expectedRevision });
}

/** One Scene update applies all gates. Workspace, Drawing data, and defaults are untouched. */
export function applyPresentationPreset(scene, id, expectedRevision) {
	return mutateLayerTree(scene, tree => {
		const preset = presentationPreset(tree, id);
		const { missingIds } = analyzePresentationPreset(tree, preset);
		if (missingIds.length) {
			throw new Error(game.i18n.format('FOUNDRYSHOP.Layers.PresetMissingNodes', { count: missingIds.length }));
		}
		const saved = new Map(preset.entries.map(entry => [entry.nodeId, entry.playerAllowed]));
		for (const node of tree.nodes) node.playerAllowed = saved.get(node.id) ?? false;
	}, { expectedRevision });
}
