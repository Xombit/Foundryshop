import { layerError, orderedLayerNodes } from './layer_tree_store.js';

const SORT_GAP = 1024;

export function drawingLayerId(drawing) {
	return drawing.getFlag('foundryshop', 'layerId');
}

export function layerDrawingStack(tree, drawings) {
	const layers = orderedLayerNodes(tree).map(entry => entry.node).filter(node => node.kind === 'layer');
	const members = new Map(layers.map(node => [node.id, []]));
	for (const drawing of drawings) members.get(drawingLayerId(drawing))?.push(drawing);
	const stack = [];
	for (const layer of layers.reverse()) {
		stack.push(...members.get(layer.id).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id)));
	}
	return stack;
}

/** Preserve the largest increasing set of existing sort values when there is room. */
export function planDrawingOrder(tree, drawings) {
	const stack = layerDrawingStack(tree, drawings);
	if (stack.length < 2) return [];
	const first = stack[0];
	if (stack.some(drawing => drawing.elevation !== first.elevation
		|| !!drawing.interface !== !!first.interface)) throw layerError('MixedRenderOrder');
	if (stack.some(drawing => !Number.isSafeInteger(drawing.sort))) throw layerError('InvalidSort');

	const tails = [], previous = new Map();
	for (let i = 0; i < stack.length; i++) {
		let low = 0, high = tails.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (stack[tails[mid]].sort < stack[i].sort) low = mid + 1;
			else high = mid;
		}
		if (low) previous.set(i, tails[low - 1]);
		tails[low] = i;
	}
	const anchors = [];
	for (let index = tails.at(-1); index !== undefined; index = previous.get(index)) anchors.push(index);
	anchors.reverse();
	const values = stack.map(drawing => drawing.sort);
	let leftIndex = -1;
	let leftValue = stack[anchors[0]].sort - (anchors[0] + 1) * SORT_GAP;
	let canPreserve = Number.isSafeInteger(leftValue);
	for (const rightIndex of [...anchors, stack.length]) {
		const rightValue = rightIndex === stack.length
			? leftValue + (rightIndex - leftIndex) * SORT_GAP : stack[rightIndex].sort;
		const step = Math.floor((rightValue - leftValue) / (rightIndex - leftIndex));
		if (step < 1 || !Number.isSafeInteger(rightValue)) { canPreserve = false; break; }
		for (let i = leftIndex + 1; i < rightIndex; i++) values[i] = leftValue + step * (i - leftIndex);
		leftIndex = rightIndex;
		leftValue = rightValue;
	}
	if (!canPreserve || values.some(value => !Number.isSafeInteger(value))) {
		for (let i = 0; i < stack.length; i++) values[i] = (i + 1) * SORT_GAP;
	}
	return stack.flatMap((drawing, index) => drawing.sort === values[index]
		? [] : [{ _id: drawing.id, sort: values[index] }]);
}

export function newDrawingSort(tree, drawings, layerId) {
	const layers = orderedLayerNodes(tree).map(entry => entry.node).filter(node => node.kind === 'layer');
	const targetIndex = layers.findIndex(node => node.id === layerId);
	if (targetIndex < 0) throw layerError('Changed');
	const stack = layerDrawingStack(tree, drawings);
	const above = new Set(layers.slice(0, targetIndex).map(node => node.id));
	const belowOrSame = new Set(layers.slice(targetIndex).map(node => node.id));
	const lower = Math.max(0, ...stack.filter(drawing => belowOrSame.has(drawingLayerId(drawing))).map(d => d.sort));
	const upper = Math.min(Infinity, ...stack.filter(drawing => above.has(drawingLayerId(drawing))).map(d => d.sort));
	const sort = upper === Infinity ? lower + SORT_GAP : lower + Math.max(1, Math.floor((upper - lower) / 2));
	if (!Number.isSafeInteger(sort)) throw layerError('InvalidSort');
	return sort;
}

export function planStampSorts(tree, drawings, layerId, count) {
	if (!Number.isInteger(count) || count < 1 || count > 100) throw layerError('InvalidSort');
	if (planDrawingOrder(tree, drawings).length) throw layerError('InvalidSort');
	if (drawings.some(drawing => !Number.isSafeInteger(drawing.sort))) throw layerError('InvalidSort');
	const layers = orderedLayerNodes(tree).map(entry => entry.node).filter(node => node.kind === 'layer');
	const index = layers.findIndex(node => node.id === layerId);
	if (layerId && index < 0) throw layerError('Changed');
	const below = new Set(layers.slice(index).map(node => node.id));
	const managed = new Set(layers.map(node => node.id));
	const lowerPeers = layerId ? drawings.filter(drawing => below.has(drawingLayerId(drawing))) : drawings;
	const upperPeers = layerId ? drawings.filter(drawing => managed.has(drawingLayerId(drawing))
		&& !below.has(drawingLayerId(drawing))) : [];
	const lower = Math.max(0, ...lowerPeers.map(drawing => drawing.sort));
	const upper = Math.min(Infinity, ...upperPeers.map(drawing => drawing.sort));
	const available = Math.min(count, upper - lower - 1);
	if (available >= count && Number.isSafeInteger(lower + count)) {
		const step = upper === Infinity ? SORT_GAP : 1;
		const sorts = Array.from({ length: count }, (_, i) => lower + (i + 1) * step);
		if (sorts.every(sort => Number.isSafeInteger(sort) && !drawings.some(d => d.sort === sort))) {
			return { sorts, updates: [] };
		}
	}
	// Re-space the complete native stack without changing its relative visual order,
	// including Unassigned artwork. Existing ties remain in their native stable order.
	const stack = [...drawings].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
	const insertion = layerId ? stack.findIndex(drawing => upperPeers.includes(drawing)) : stack.length;
	const at = insertion < 0 ? stack.length : insertion;
	const updates = stack.flatMap((drawing, i) => {
		const sort = (i + 1 + (i >= at ? count : 0)) * SORT_GAP;
		return sort === drawing.sort ? [] : [{ _id: drawing.id, sort }];
	});
	return { sorts: Array.from({ length: count }, (_, i) => (at + i + 1) * SORT_GAP), updates };
}
