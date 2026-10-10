import { normalizeDrawingPatch } from '../drawing_config.js';

export const LAYER_SCHEMA_VERSION = 1;
export const UNASSIGNED = '__unassigned__';

export function layerError(key) {
	return new Error(game.i18n.localize(`FOUNDRYSHOP.Layers.${key}`));
}

export function emptyLayerTree() {
	return { version: LAYER_SCHEMA_VERSION, revision: 0, nodes: [], presets: [] };
}

const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id) && id !== UNASSIGNED;

export function normalizePresetName(name) {
	if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw layerError('InvalidPresetName');
	return name.trim();
}

/** Missing node references are retained for explicit repair, never silently dropped. */
export function validatePresentationPresets(presets) {
	if (!Array.isArray(presets)) throw layerError('InvalidPresets');
	const ids = new Set(), names = new Set();
	return presets.map(preset => {
		if (!preset || !validId(preset.id) || ids.has(preset.id) || !Array.isArray(preset.entries)) {
			throw layerError('InvalidPresets');
		}
		const name = normalizePresetName(preset.name);
		if (names.has(name.toLowerCase())) throw layerError('DuplicatePresetName');
		ids.add(preset.id);
		names.add(name.toLowerCase());
		const nodeIds = new Set();
		const entries = preset.entries.map(entry => {
			if (!entry || !validId(entry.nodeId) || nodeIds.has(entry.nodeId)
				|| typeof entry.playerAllowed !== 'boolean') throw layerError('InvalidPresets');
			nodeIds.add(entry.nodeId);
			return { nodeId: entry.nodeId, playerAllowed: entry.playerAllowed };
		});
		return { id: preset.id, name, entries };
	});
}

export function normalizeLayerName(name) {
	if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw layerError('InvalidName');
	return name.trim();
}

/** Array position is the sole sibling-order authority: top to bottom. */
export function validateLayerTree(data) {
	if (!data || data.version !== LAYER_SCHEMA_VERSION || !Number.isSafeInteger(data.revision)
		|| data.revision < 0 || !Array.isArray(data.nodes)) throw layerError('InvalidState');
	const ids = new Set();
	const nodes = data.nodes.map(node => {
		if (!node || !validId(node.id) || ids.has(node.id)
			|| !['layer', 'group'].includes(node.kind)
			|| !(node.parentId === null || typeof node.parentId === 'string')
			|| typeof node.playerAllowed !== 'boolean' || typeof node.locked !== 'boolean'
			|| !node.defaults || typeof node.defaults !== 'object' || Array.isArray(node.defaults)) {
			throw layerError('InvalidState');
		}
		ids.add(node.id);
		return {
			id: node.id, kind: node.kind, name: normalizeLayerName(node.name), parentId: node.parentId,
			playerAllowed: node.playerAllowed, locked: node.locked,
			defaults: normalizeDrawingPatch(node.defaults),
		};
	});
	const byId = new Map(nodes.map(node => [node.id, node]));
	for (const node of nodes) {
		const visited = new Set([node.id]);
		let parentId = node.parentId;
		while (parentId !== null) {
			const parent = byId.get(parentId);
			if (!parent || parent.kind !== 'group' || visited.has(parentId)) throw layerError('InvalidState');
			visited.add(parentId);
			parentId = parent.parentId;
		}
	}
	const presets = validatePresentationPresets(data.presets === undefined ? [] : data.presets);
	return { version: LAYER_SCHEMA_VERSION, revision: data.revision, nodes, presets };
}

export function layerNode(tree, id) {
	const node = tree.nodes.find(entry => entry.id === id);
	if (!node) throw layerError('Changed');
	return node;
}

export function lockedLayerIds(tree) {
	const locked = new Set();
	for (const { node } of orderedLayerNodes(tree)) {
		if (node.locked || locked.has(node.parentId)) locked.add(node.id);
	}
	return locked;
}

export function orderedLayerNodes(tree) {
	const children = new Map();
	for (const node of tree.nodes) {
		if (!children.has(node.parentId)) children.set(node.parentId, []);
		children.get(node.parentId).push(node);
	}
	const result = [];
	const pending = [...(children.get(null) ?? [])].reverse().map(node => ({ node, depth: 0 }));
	while (pending.length) {
		const entry = pending.pop();
		result.push(entry);
		for (const node of [...(children.get(entry.node.id) ?? [])].reverse()) {
			pending.push({ node, depth: entry.depth + 1 });
		}
	}
	return result;
}

export function effectiveLayerGate(tree, id, enabled) {
	const byId = new Map(tree.nodes.map(node => [node.id, node]));
	let node = byId.get(id);
	if (!node || node.kind !== 'layer') return false;
	while (node) {
		if (!enabled(node)) return false;
		node = node.parentId === null ? null : byId.get(node.parentId);
	}
	return true;
}

export function layerSubtreeIds(tree, id) {
	layerNode(tree, id);
	const ids = new Set([id]);
	for (const { node } of orderedLayerNodes(tree)) {
		if (ids.has(node.parentId)) ids.add(node.id);
	}
	return ids;
}

/** Summaries use effective descendant leaves, while toggles use the node's own gate. */
export function layerVisibilitySummary(tree, enabled) {
	const entries = orderedLayerNodes(tree);
	const summaries = new Map();
	for (const { node } of entries) {
		const ancestorVisible = node.parentId === null || summaries.get(node.parentId).effective;
		const gateEnabled = enabled(node);
		const effective = ancestorVisible && gateEnabled;
		summaries.set(node.id, {
			gateEnabled, effective, ancestorBlocked: !ancestorVisible,
			total: node.kind === 'layer' ? 1 : 0,
			visible: node.kind === 'layer' && effective ? 1 : 0,
		});
	}
	for (const { node } of [...entries].reverse()) {
		const summary = summaries.get(node.id);
		if (!summary.total) {
			summary.total = 1;
			summary.visible = summary.effective ? 1 : 0;
		}
		summary.state = summary.visible === 0 ? 'hidden'
			: summary.visible === summary.total ? 'visible' : 'mixed';
		if (node.parentId !== null) {
			const parent = summaries.get(node.parentId);
			parent.total += summary.total;
			parent.visible += summary.visible;
		}
	}
	return summaries;
}

export function moveLayerNode(tree, id, targetId, position) {
	if (position === 'root' && targetId === null) {
		const node = layerNode(tree, id);
		tree.nodes.splice(tree.nodes.indexOf(node), 1);
		node.parentId = null;
		tree.nodes.push(node);
		return tree;
	}
	if (!['before', 'after', 'inside'].includes(position) || id === targetId) throw layerError('InvalidDrop');
	const node = layerNode(tree, id);
	const target = layerNode(tree, targetId);
	if (position === 'inside' && target.kind !== 'group') throw layerError('InvalidDrop');
	let parentId = position === 'inside' ? target.id : target.parentId;
	for (let ancestorId = parentId; ancestorId !== null; ancestorId = layerNode(tree, ancestorId).parentId) {
		if (ancestorId === node.id) throw layerError('InvalidDrop');
	}
	tree.nodes.splice(tree.nodes.indexOf(node), 1);
	node.parentId = parentId;
	const index = tree.nodes.indexOf(target);
	tree.nodes.splice(index + (position === 'before' ? 0 : 1), 0, node);
	return tree;
}
