import { MODULE } from '../constants.js';
import {
	emptyLayerTree, validateLayerTree, normalizeLayerName, layerNode, orderedLayerNodes,
	effectiveLayerGate, moveLayerNode, layerSubtreeIds, lockedLayerIds, layerError, UNASSIGNED,
} from './layer_tree_store.js';
import { drawingLayerId, planDrawingOrder, newDrawingSort } from './drawing_order_service.js';
import { DRAWING_FIELDS, readDrawingConfig, normalizeDrawingPatch } from '../drawing_config.js';
import { materialCreationPatch } from '../material_fill.js';
import { PLACE_TEXT_OPTION } from '../label_placement.js';
import { getAppearanceOverride } from '../appearance_state.js';
import { isAuthorizedRecoveryImportCreate, isAuthorizedRecoveryImportDelete, isAuthorizedRecoveryImportUpdate } from './recovery_import_native_guard.js';
import { assertNoPendingPathOperation, isAuthorizedPathWrite, isPendingPathDrawing } from '../path_operation_guard.js';

export const LAYER_CHANGED = 'foundryshopLayersChanged';
export const LAYER_WORKSPACE = 'layerWorkspace';
export const LAYER_OPERATION = 'foundryshopLayerOperation';
export const PROJECT_IMPORT = 'foundryshopProjectImport';
const queues = new Map();
let hooks = [];
let refreshTimer;
let treeCache = new WeakMap();
let visibilityCache = new WeakMap();
let lockCache = new WeakMap();
let visibilityErrors = new WeakMap();
let refreshVisibility = false;
const orderTimers = new Map();

export function reportLayerError(error) {
	console.error('Foundryshop Layers:', error);
	ui.notifications.error(game.i18n.format('FOUNDRYSHOP.Error', { message: error.message }));
}

export function readLayerTree(scene = canvas.scene) {
	if (!scene) throw layerError('NoScene');
	const data = scene.getFlag(MODULE, 'layers');
	const cached = treeCache.get(scene);
	if (cached && cached.source === data) return cached.tree;
	const tree = data === undefined ? emptyLayerTree() : validateLayerTree(data);
	treeCache.set(scene, { source: data, tree });
	return tree;
}

export function readLayerWorkspace(scene = canvas.scene) {
	if (!scene) throw layerError('NoScene');
	const stored = game.settings.get(MODULE, LAYER_WORKSPACE);
	if (!stored || stored.version !== 1 || !stored.scenes || typeof stored.scenes !== 'object'
		|| Array.isArray(stored.scenes)) throw layerError('InvalidWorkspace');
	const state = stored.scenes[scene.id] ?? { activeLayerId: null, hiddenIds: [], collapsedIds: [] };
	if (!state || !(state.activeLayerId === null || typeof state.activeLayerId === 'string')
		|| !Array.isArray(state.hiddenIds) || state.hiddenIds.some(id => typeof id !== 'string')
		|| (state.collapsedIds !== undefined && (!Array.isArray(state.collapsedIds)
			|| state.collapsedIds.some(id => typeof id !== 'string')))) {
		throw layerError('InvalidWorkspace');
	}
	return { ...structuredClone(state), collapsedIds: [...(state.collapsedIds ?? [])] };
}

function requireGM(scene) {
	if (!game.user.isGM) throw layerError('GMOnly');
	if (!scene) throw layerError('NoScene');
}

function enqueue(key, operation) {
	const result = (queues.get(key) ?? Promise.resolve()).then(operation);
	const settled = result.then(() => {}, () => {});
	queues.set(key, settled);
	settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
	return result;
}

export function runLayerOperation(scene, operation) {
	requireGM(scene);
	return enqueue(`scene:${scene.id}`, async () => {
		requireGM(scene);
		return operation();
	});
}

function isStagedImport(document, options) {
	const token = options?.[PROJECT_IMPORT];
	const journal = document.parent?.getFlag(MODULE, 'projectImportJournal');
	return typeof token === 'string' && token.length > 0
		&& journal?.token === token && Array.isArray(journal.ids) && journal.ids.includes(document.id)
		&& document.getFlag(MODULE, 'importStaging') === token;
}

function assertUnchanged(scene, expected) {
	treeCache.delete(scene);
	if (JSON.stringify(readLayerTree(scene)) !== JSON.stringify(expected)) throw layerError('Changed');
}

function verifyDrawingUpdates(scene, updates) {
	for (const update of updates) {
		const drawing = scene.drawings.get(update._id);
		if (!drawing || (Object.hasOwn(update, 'sort') && drawing.sort !== update.sort)
			|| (Object.hasOwn(update, `flags.${MODULE}.layerId`)
				&& drawingLayerId(drawing) !== update[`flags.${MODULE}.layerId`])) {
			throw layerError('DrawingUpdateIncomplete');
		}
	}
}

export async function mutateLayerTree(scene, mutate, { reconcile = false, expectedRevision } = {}) {
	requireGM(scene);
	return enqueue(`scene:${scene.id}`, async () => {
		requireGM(scene);
		const before = readLayerTree(scene);
		if (expectedRevision !== undefined && before.revision !== expectedRevision) throw layerError('Changed');
		const next = structuredClone(before);
		mutate(next);
		const validated = validateLayerTree(next);
		if (JSON.stringify(validated) === JSON.stringify(before)) return before;
		if (reconcile) planDrawingOrder(validated, [...scene.drawings.values()]);
		validated.revision++;
		validateLayerTree(validated);
		assertUnchanged(scene, before);
		await scene.update({ [`flags.${MODULE}.layers`]: validated }, { diff: false, [LAYER_OPERATION]: true });
		try {
			assertUnchanged(scene, validated);
			const updates = reconcile ? planDrawingOrder(validated, [...scene.drawings.values()]) : [];
			if (updates.length) await scene.updateEmbeddedDocuments('Drawing', updates, { [LAYER_OPERATION]: true });
			verifyDrawingUpdates(scene, updates);
			assertUnchanged(scene, validated);
		} catch (error) {
			// A write may be durable; do not roll it back over another GM's changes.
			throw new Error(`${layerError(reconcile ? 'OrderIncomplete' : 'StateIncomplete').message} ${error.message}`, { cause: error });
		}
		scheduleLayerRefresh();
		return validated;
	});
}

export function createLayer(scene, name, kind = 'layer', parentId = null, expectedRevision) {
	requireGM(scene);
	const id = foundry.utils.randomID();
	return mutateLayerTree(scene, tree => {
		if (!['layer', 'group'].includes(kind)) throw layerError('InvalidState');
		if (parentId !== null && layerNode(tree, parentId).kind !== 'group') throw layerError('InvalidDrop');
		tree.nodes.push({ id, kind, parentId, name: normalizeLayerName(name),
			playerAllowed: false, locked: false, defaults: {} });
	}, { expectedRevision }).then(async tree => {
		if (kind === 'layer') await setActiveLayer(scene, id);
		return tree;
	});
}

export function renameLayer(scene, id, name, expectedRevision) {
	return mutateLayerTree(scene, tree => { layerNode(tree, id).name = normalizeLayerName(name); }, { expectedRevision });
}

export function reorderLayer(scene, id, targetId, position, expectedRevision) {
	return mutateLayerTree(scene, tree => moveLayerNode(tree, id, targetId, position),
		{ reconcile: true, expectedRevision });
}

export function setPlayerPresentation(scene, id, enabled, expectedRevision) {
	return mutateLayerTree(scene, tree => {
		if (typeof enabled !== 'boolean') throw layerError('InvalidState');
		layerNode(tree, id).playerAllowed = enabled;
	}, { expectedRevision });
}

export function setSubtreePresentation(scene, id, enabled, expectedRevision) {
	return mutateLayerTree(scene, tree => {
		if (typeof enabled !== 'boolean') throw layerError('InvalidState');
		const ids = layerSubtreeIds(tree, id);
		for (const node of tree.nodes) if (ids.has(node.id)) node.playerAllowed = enabled;
	}, { expectedRevision });
}

export function setLayerLocked(scene, id, locked, expectedRevision) {
	return mutateLayerTree(scene, tree => {
		if (typeof locked !== 'boolean') throw layerError('InvalidState');
		layerNode(tree, id).locked = locked;
	}, { expectedRevision });
}

export function isDrawingLayerLocked(document) {
	if (!document?.parent || drawingLayerId(document) == null) return false;
	return readLockedIds(document.parent).has(drawingLayerId(document));
}

function readLockedIds(scene) {
	const tree = readLayerTree(scene);
	let cached = lockCache.get(scene);
	if (!cached || cached.tree !== tree) {
		cached = { tree, ids: lockedLayerIds(tree) };
		lockCache.set(scene, cached);
	}
	return cached.ids;
}

function setLayerDefaults(scene, id, defaults, expectedRevision) {
	return mutateLayerTree(scene, tree => {
		const node = layerNode(tree, id);
		if (node.kind !== 'layer') throw layerError('Changed');
		node.defaults = defaults;
	}, { expectedRevision });
}

export function saveLayerDefaults(scene, id, expectedRevision) {
	requireGM(scene);
	const defaults = normalizeDrawingPatch(Object.fromEntries(
		Object.entries(readDrawingConfig()).filter(([key]) =>
			DRAWING_FIELDS.includes(key))));
	return setLayerDefaults(scene, id, defaults, expectedRevision);
}

export function clearLayerDefaults(scene, id, expectedRevision) {
	return setLayerDefaults(scene, id, {}, expectedRevision);
}

async function mutateWorkspace(scene, mutate, expectedRevision) {
	requireGM(scene);
	return enqueue('workspace', async () => {
		requireGM(scene);
		const stored = structuredClone(game.settings.get(MODULE, LAYER_WORKSPACE));
		const state = readLayerWorkspace(scene);
		const tree = readLayerTree(scene);
		if (expectedRevision !== undefined && tree.revision !== expectedRevision) throw layerError('Changed');
		mutate(state, tree);
		stored.scenes[scene.id] = state;
		await game.settings.set(MODULE, LAYER_WORKSPACE, stored);
		scheduleLayerRefresh();
		return state;
	});
}

export function activeLayer(tree, workspace) {
	const locked = lockedLayerIds(tree);
	const available = tree.nodes.filter(node => node.kind === 'layer' && !locked.has(node.id));
	return available.find(node => node.id === workspace.activeLayerId) ?? available[0] ?? null;
}

export function setActiveLayer(scene, id) {
	return mutateWorkspace(scene, (workspace, tree) => {
		const node = layerNode(tree, id);
		if (node.kind !== 'layer' || lockedLayerIds(tree).has(id)) throw layerError('Locked');
		workspace.activeLayerId = id;
		let entry = node;
		while (entry) {
			workspace.hiddenIds = workspace.hiddenIds.filter(hiddenId => hiddenId !== entry.id);
			workspace.collapsedIds = workspace.collapsedIds.filter(groupId => groupId !== entry.id);
			entry = entry.parentId === null ? null : layerNode(tree, entry.parentId);
		}
	});
}

export function toggleWorkspaceVisibility(scene, id) {
	return mutateWorkspace(scene, (workspace, tree) => {
		layerNode(tree, id);
		if (workspace.hiddenIds.includes(id)) workspace.hiddenIds = workspace.hiddenIds.filter(hiddenId => hiddenId !== id);
		else workspace.hiddenIds.push(id);
	});
}

export function setSubtreeWorkspaceVisibility(scene, id, enabled, expectedRevision) {
	return mutateWorkspace(scene, (workspace, tree) => {
		if (typeof enabled !== 'boolean') throw layerError('InvalidState');
		const ids = layerSubtreeIds(tree, id);
		const hidden = new Set(workspace.hiddenIds);
		for (const nodeId of ids) {
			if (enabled) hidden.delete(nodeId);
			else hidden.add(nodeId);
		}
		workspace.hiddenIds = [...hidden];
	}, expectedRevision);
}

export function toggleGroupCollapsed(scene, id) {
	return mutateWorkspace(scene, (workspace, tree) => {
		if (layerNode(tree, id).kind !== 'group') throw layerError('Changed');
		if (workspace.collapsedIds.includes(id)) workspace.collapsedIds = workspace.collapsedIds.filter(entry => entry !== id);
		else workspace.collapsedIds.push(id);
	});
}

/**
 * Copies a layer's metadata and artwork as a new sibling directly above it.
 * Copies are never locked and do not inherit import/recovery provenance.
 */
export async function duplicateLayer(scene, id, name, expectedRevision) {
	requireGM(scene);
	const copyId = foundry.utils.randomID();
	return enqueue(`scene:${scene.id}`, async () => {
		requireGM(scene);
		const before = readLayerTree(scene);
		if (expectedRevision !== undefined && before.revision !== expectedRevision) throw layerError('Changed');
		const source = layerNode(before, id);
		if (source.kind !== 'layer') throw layerError('DuplicateGroup');
		if (lockedLayerIds(before).has(id)) throw layerError('Locked');
		const nodes = structuredClone(before.nodes);
		nodes.splice(nodes.findIndex(node => node.id === id), 0,
			{ ...structuredClone(source), id: copyId, name: normalizeLayerName(name), locked: false });
		const next = validateLayerTree({ ...before, revision: before.revision + 1, nodes });
		const data = [...scene.drawings.values()].filter(drawing => drawingLayerId(drawing) === id)
			.sort((a, b) => a.sort - b.sort).map(drawing => {
				const copy = drawing.toObject();
				delete copy._id;
				const flags = { ...copy.flags?.[MODULE], layerId: copyId };
				delete flags.provenance;
				delete flags.importStaging;
				copy.flags = { ...copy.flags, [MODULE]: flags };
				return copy;
			});
		assertUnchanged(scene, before);
		try {
			await scene.update({ [`flags.${MODULE}.layers`]: next }, { diff: false, [LAYER_OPERATION]: true });
			assertUnchanged(scene, next);
			if (data.length) {
				const created = await scene.createEmbeddedDocuments('Drawing', data, { [LAYER_OPERATION]: true });
				if (created?.length !== data.length) throw layerError('DrawingUpdateIncomplete');
			}
			const updates = planDrawingOrder(next, [...scene.drawings.values()]);
			if (updates.length) await scene.updateEmbeddedDocuments('Drawing', updates, { [LAYER_OPERATION]: true });
			verifyDrawingUpdates(scene, updates);
		} catch (error) {
			throw new Error(`${layerError('DuplicateIncomplete').message} ${error.message}`, { cause: error });
		} finally {
			scheduleLayerRefresh();
		}
		return next;
	}).then(async tree => {
		await setActiveLayer(scene, copyId);
		return tree;
	});
}

/** Destination sentinel: remove the subtree together with its Drawings. */
export const DELETE_ARTWORK = '__deleteArtwork__';

/** Move membership before removing metadata; artwork is deleted only with DELETE_ARTWORK. */
export async function deleteLayerSubtree(scene, id, destinationId, expectedRevision) {
	requireGM(scene);
	return enqueue(`scene:${scene.id}`, async () => {
		requireGM(scene);
		const before = readLayerTree(scene);
		if (expectedRevision !== undefined && before.revision !== expectedRevision) throw layerError('Changed');
		const removed = layerSubtreeIds(before, id);
		const locked = lockedLayerIds(before);
		const deleteArtwork = destinationId === DELETE_ARTWORK;
		if (removed.has(destinationId)) throw layerError('InvalidDestination');
		if (destinationId !== UNASSIGNED && !deleteArtwork) {
			const destination = layerNode(before, destinationId);
			if (destination.kind !== 'layer' || locked.has(destinationId)) throw layerError('InvalidDestination');
		}
		if ([...removed].some(nodeId => locked.has(nodeId))) throw layerError('Locked');
		const sources = [...scene.drawings.values()].filter(drawing => removed.has(drawingLayerId(drawing)));
		if (sources.some(drawing => drawing.locked
			|| !drawing.canUserModify(game.user, deleteArtwork ? 'delete' : 'update'))) throw layerError('Locked');
		const sourceIds = new Set(sources.map(drawing => drawing.id));
		const targetId = destinationId === UNASSIGNED || deleteArtwork ? null : destinationId;
		const next = validateLayerTree({
			...before, revision: before.revision + 1,
			nodes: before.nodes.filter(node => !removed.has(node.id)),
		});
		const virtual = [...scene.drawings.values()].map(drawing => sourceIds.has(drawing.id)
			? { id: drawing.id, sort: drawing.sort, elevation: drawing.elevation, interface: drawing.interface,
				getFlag: () => targetId } : drawing);
		const updates = deleteArtwork ? new Map()
			: new Map(planDrawingOrder(next, virtual).map(update => [update._id, update]));
		if (!deleteArtwork) for (const drawing of sources) {
			updates.set(drawing.id, { ...updates.get(drawing.id), _id: drawing.id,
				[`flags.${MODULE}.layerId`]: targetId });
		}
		assertUnchanged(scene, before);
		try {
			if (deleteArtwork && sourceIds.size) {
				await scene.deleteEmbeddedDocuments('Drawing', [...sourceIds], { [LAYER_OPERATION]: true });
			}
			if (updates.size) {
				await scene.updateEmbeddedDocuments('Drawing', [...updates.values()], { [LAYER_OPERATION]: true });
				verifyDrawingUpdates(scene, [...updates.values()]);
			}
			assertUnchanged(scene, before);
			if ([...scene.drawings.values()].some(drawing => removed.has(drawingLayerId(drawing)))) throw layerError('Changed');
			await scene.update({ [`flags.${MODULE}.layers`]: next }, { diff: false, [LAYER_OPERATION]: true });
			assertUnchanged(scene, next);
		} catch (error) {
			throw new Error(`${layerError(deleteArtwork ? 'DeleteArtworkIncomplete' : 'DeleteIncomplete').message} ${error.message}`, { cause: error });
		} finally {
			scheduleLayerRefresh();
		}
		await mutateWorkspace(scene, (workspace, current) => {
			workspace.hiddenIds = workspace.hiddenIds.filter(entry => !removed.has(entry));
			workspace.collapsedIds = workspace.collapsedIds.filter(entry => !removed.has(entry));
			if (removed.has(workspace.activeLayerId)) {
				workspace.activeLayerId = activeLayer(current, { activeLayerId: targetId })?.id ?? null;
			}
		});
		return next;
	});
}

export function layerMembershipIndex(scene, tree = readLayerTree(scene)) {
	const members = new Map(tree.nodes.filter(node => node.kind === 'layer').map(node => [node.id, []]));
	members.set(UNASSIGNED, []);
	for (const drawing of scene.drawings.values()) {
		(members.get(drawingLayerId(drawing)) ?? members.get(UNASSIGNED)).push(drawing);
	}
	return members;
}

export async function assignDrawings(scene, ids, layerId, expectedRevision) {
	requireGM(scene);
	return enqueue(`scene:${scene.id}`, async () => {
		requireGM(scene);
		const tree = readLayerTree(scene);
		if (expectedRevision !== undefined && tree.revision !== expectedRevision) throw layerError('Changed');
		const locked = lockedLayerIds(tree);
		if (layerId !== UNASSIGNED) {
			const target = layerNode(tree, layerId);
			if (target.kind !== 'layer' || locked.has(layerId)) throw layerError('Locked');
		}
		const documents = [...new Set(ids)].map(id => scene.drawings.get(id));
		if (!documents.length || documents.some(drawing => !drawing)) throw layerError('NoSelection');
		for (const drawing of documents) {
			const source = tree.nodes.find(node => node.id === drawingLayerId(drawing));
			if (drawing.locked || (source && locked.has(source.id)) || !drawing.canUserModify(game.user, 'update')) throw layerError('Locked');
		}
		const targetId = layerId === UNASSIGNED ? null : layerId;
		const selected = new Set(documents);
		const virtual = [...scene.drawings.values()].map(drawing => selected.has(drawing)
			? { id: drawing.id, sort: drawing.sort, elevation: drawing.elevation, interface: drawing.interface,
				getFlag: () => targetId } : drawing);
		const order = planDrawingOrder(tree, virtual);
		const updates = new Map(order.map(update => [update._id, update]));
		for (const drawing of documents) {
			updates.set(drawing.id, { ...updates.get(drawing.id), _id: drawing.id,
				[`flags.${MODULE}.layerId`]: targetId });
		}
		assertUnchanged(scene, tree);
		await scene.updateEmbeddedDocuments('Drawing', [...updates.values()], { [LAYER_OPERATION]: true });
		verifyDrawingUpdates(scene, [...updates.values()]);
		scheduleLayerRefresh();
	});
}

export async function reconcileDrawingOrder(scene) {
	requireGM(scene);
	return enqueue(`scene:${scene.id}`, async () => {
		requireGM(scene);
		const tree = readLayerTree(scene);
		const updates = planDrawingOrder(tree, [...scene.drawings.values()]);
		assertUnchanged(scene, tree);
		if (updates.length) await scene.updateEmbeddedDocuments('Drawing', updates, { [LAYER_OPERATION]: true });
		verifyDrawingUpdates(scene, updates);
	});
}

export function onPreCreateLayerDrawing(document, data, options, userId) {
	try {
		if (!isAuthorizedPathWrite(document, 'create', data, options)) assertNoPendingPathOperation(document.parent);
		if (options?.isUndo && document.getFlag(MODULE, 'path') !== undefined
			&& !isAuthorizedPathWrite(document, 'create', data, options)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Paths.NativeUndo'));
		if (isAuthorizedRecoveryImportCreate(document, options)) return;
		if (game.user.isGM && isStagedImport(document, options)) return;
		if (isDrawingLayerLocked(document)) throw layerError('Locked');
		if (!game.user.isGM || userId !== game.user.id || options.isUndo || options.keepId
			|| document.getFlag(MODULE, 'layerId') != null) return;
		const scene = document.parent;
		const tree = readLayerTree(scene);
		const workspace = readLayerWorkspace(scene);
		const node = activeLayer(tree, workspace);
		const override = typeof options.controlObject === 'boolean' && !options[PLACE_TEXT_OPTION]
			? getAppearanceOverride()?.patch ?? {} : {};
		const repeat = readDrawingConfig({ appearance: false }).materialRepeat;
		const clearRepeat = Object.hasOwn(override, 'fillType') && override.fillType !== 2
			&& document.getFlag(MODULE, 'materialRepeat') !== undefined
			? { [`flags.${MODULE}.materialRepeat`]: new foundry.data.operators.ForcedDeletion() } : {};
		const materialDefaults = {
			fillType: document.fillType, texture: document.texture,
			...(repeat === undefined || document.getFlag(MODULE, 'materialRepeat') !== undefined
				|| document.getFlag(MODULE, 'imageStamp') === 1 ? {} : { materialRepeat: repeat }),
		};
		if (!node) {
			if (tree.nodes.some(entry => entry.kind === 'layer')) throw layerError('Locked');
			if (!options[PLACE_TEXT_OPTION]) document.updateSource({
				...materialCreationPatch({ ...materialDefaults, ...override }, scene), ...clearRepeat,
			});
			return;
		}
		if (!effectiveLayerGate(tree, node.id, entry => !workspace.hiddenIds.includes(entry.id))) {
			throw layerError('ActiveHidden');
		}
		const layers = new Set(tree.nodes.filter(entry => entry.kind === 'layer').map(entry => entry.id));
		const peers = [...scene.drawings.values()].filter(drawing => layers.has(drawingLayerId(drawing)));
		if (peers.some(drawing => drawing.elevation !== document.elevation
			|| !!drawing.interface !== !!document.interface)) throw layerError('MixedRenderOrder');
		document.updateSource({
			[`flags.${MODULE}.layerId`]: node.id,
			...(options[PLACE_TEXT_OPTION] ? {} : materialCreationPatch({
				...materialDefaults,
				...node.defaults,
				...override,
			}, scene)),
			sort: newDrawingSort(tree, [...scene.drawings.values()], node.id),
			...clearRepeat,
		});
	} catch (error) {
		reportLayerError(error);
		return false;
	}
}

/** Locks are an independent editing gate; only our sort-only maintenance may pass. */
export function onPreUpdateLayerDrawing(document, changes, options) {
	try {
		if (!isAuthorizedPathWrite(document, 'update', changes, options)) assertNoPendingPathOperation(document.parent);
		if (options?.isUndo && (document.getFlag(MODULE, 'path') !== undefined
			|| Object.hasOwn(foundry.utils.expandObject(changes).flags?.[MODULE] ?? {}, 'path'))
			&& !isAuthorizedPathWrite(document, 'update', changes, options)) {
			throw new Error(game.i18n.localize('FOUNDRYSHOP.Paths.NativeUndo'));
		}
		if (isAuthorizedRecoveryImportUpdate(document, changes, options)) return;
		if (game.user.isGM && isStagedImport(document, options)
			&& Object.keys(changes).every(key => key === '_id' || key === `flags.${MODULE}.-=importStaging`)) return;
		if (isDrawingLayerLocked(document)
			&& !(options?.[LAYER_OPERATION] && Object.keys(changes).every(key => key === 'sort' || key === '_id'))) {
			throw layerError('Locked');
		}
		const path = `flags.${MODULE}.layerId`;
		const id = Object.hasOwn(changes, path) ? changes[path]
			: changes[`flags.${MODULE}`]?.layerId ?? changes.flags?.[MODULE]?.layerId;
		if (id != null && readLockedIds(document.parent).has(id)) throw layerError('Locked');
	} catch (error) {
		reportLayerError(error);
		return false;
	}
}

export function onPreDeleteLayerDrawing(document, options) {
	try {
		if (!isAuthorizedPathWrite(document, 'delete', null, options)) assertNoPendingPathOperation(document.parent);
		if (options?.isUndo && document.getFlag(MODULE, 'path') !== undefined
			&& !isAuthorizedPathWrite(document, 'delete', null, options)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Paths.NativeUndo'));
		if (isAuthorizedRecoveryImportDelete(document, options)) return;
		const journal = document.parent?.getFlag(MODULE, 'projectImportJournal');
		if (game.user.isGM && journal && journal.token === options?.[PROJECT_IMPORT]
			&& Array.isArray(journal.ids) && journal.ids.includes(document.id) && document.getFlag(MODULE, 'provenance')?.importId === journal.token) return;
		if (isDrawingLayerLocked(document)) throw layerError('Locked');
	} catch (error) {
		reportLayerError(error);
		return false;
	}
}

/** Only suppress native output; never turn a native-hidden object on here. */
export function applyDrawingVisibility(object) {
	if (!object?.document?.parent) return;
	const scene = object.document.parent;
	if (object.document.getFlag(MODULE, 'importStaging') || isPendingPathDrawing(object.document)
		|| scene.getFlag(MODULE, 'projectImportJournal')?.version === 5
			&& scene.getFlag(MODULE, 'projectImportJournal').ids.includes(object.document.id)) {
		suppressDrawing(object);
		return;
	}
	const tree = readLayerTree(scene);
	if (object.controlled && readLockedIds(scene).has(drawingLayerId(object.document))) object.release();
	const id = drawingLayerId(object.document);
	const workspace = game.user.isGM ? game.settings.get(MODULE, LAYER_WORKSPACE) : null;
	let cached = visibilityCache.get(scene);
	if (!cached || cached.tree !== tree || cached.workspace !== workspace || cached.isGM !== game.user.isGM) {
		const hidden = new Set(game.user.isGM ? readLayerWorkspace(scene).hiddenIds : []);
		const gates = new Map();
		const managed = new Set();
		for (const { node } of orderedLayerNodes(tree)) {
			gates.set(node.id, (node.parentId === null || gates.get(node.parentId))
				&& (game.user.isGM ? !hidden.has(node.id) : node.playerAllowed));
			if (node.kind === 'layer') managed.add(node.id);
		}
		cached = { tree, workspace, isGM: game.user.isGM, gates, managed };
		visibilityCache.set(scene, cached);
	}
	if (!cached.managed.has(id)) {
		if (!game.user.isGM && id != null) suppressDrawing(object);
		return;
	}
	if (cached.gates.get(id)) return;
	suppressDrawing(object);
}

function suppressDrawing(object) {
	if (object.controlled) object.release();
	object.visible = false;
	if (object.shape) object.shape.visible = false;
	if (object.text) object.text.visible = false;
}

export function scheduleLayerRefresh({ visibility = true } = {}) {
	if (visibility) {
		visibilityCache = new WeakMap();
		refreshVisibility = true;
	}
	clearTimeout(refreshTimer);
	refreshTimer = setTimeout(() => {
		if (canvas.ready && refreshVisibility) {
			for (const drawing of canvas.drawings?.placeables ?? []) {
				drawing.renderFlags.set({ refreshVisibility: true });
			}
		}
		refreshVisibility = false;
		Hooks.callAll(LAYER_CHANGED);
	}, 30);
}

export function initLayerManager() {
	if (hooks.length) return;
	game.settings.register(MODULE, LAYER_WORKSPACE, {
		scope: 'user', config: false, type: Object,
		default: { version: 1, scenes: {} }, onChange: scheduleLayerRefresh,
	});
	const addHook = (name, callback) => hooks.push([name, Hooks.on(name, callback)]);
	addHook('preUpdateScene', onPreUpdatePathScene);
	addHook('preCreateDrawing', onPreCreateLayerDrawing);
	addHook('preUpdateDrawing', onPreUpdateLayerDrawing);
	addHook('preDeleteDrawing', onPreDeleteLayerDrawing);
	addHook('controlDrawing', (object, controlled) => {
		if (!controlled) return;
		try {
			if (isDrawingLayerLocked(object.document)) {
				throw layerError('Locked');
			}
		} catch (error) {
			object.release();
			reportLayerError(error);
		}
	});
	const visibility = object => {
		try {
			applyDrawingVisibility(object);
			visibilityErrors.delete(object.document.parent);
		}
		catch (error) {
			if (object.document.parent.getFlag(MODULE, 'pathJournal') !== undefined
				|| !game.user.isGM && drawingLayerId(object.document)) suppressDrawing(object);
			if (visibilityErrors.get(object.document.parent) !== error.message) {
				visibilityErrors.set(object.document.parent, error.message);
				reportLayerError(error);
			}

		}
	};
	addHook('refreshDrawing', visibility);
	addHook('drawDrawing', visibility);
	addHook('canvasReady', scheduleLayerRefresh);
	addHook('canvasTearDown', () => {
		clearTimeout(refreshTimer);
		refreshVisibility = false;
		Hooks.callAll(LAYER_CHANGED);
	});
	addHook('updateScene', scene => { treeCache.delete(scene); scheduleLayerRefresh(); });
	for (const name of ['createDrawing', 'updateDrawing', 'deleteDrawing']) {
		addHook(name, (document, changesOrOptions, optionsOrUserId, userId) => {
			scheduleLayerRefresh({ visibility: false });
			const options = name === 'updateDrawing' ? optionsOrUserId : changesOrOptions;
			const author = name === 'updateDrawing' ? userId : optionsOrUserId;
			if (name === 'updateDrawing' && (Object.hasOwn(changesOrOptions, 'flags')
				|| Object.keys(changesOrOptions).some(key => key.startsWith('flags.')))) {
				document.object?.renderFlags.set({ refreshVisibility: true });
			}
			if (name === 'createDrawing' && author === game.user.id && game.user.isGM
				&& drawingLayerId(document) && !options?.[LAYER_OPERATION]) {
				const scene = document.parent;
				clearTimeout(orderTimers.get(scene.id));
				orderTimers.set(scene.id, setTimeout(() => {
					orderTimers.delete(scene.id);
					reconcileDrawingOrder(scene).catch(reportLayerError);
				}, 30));
			}
		});
	}
}

export function onPreUpdatePathScene(scene, changes, options) {
	try {
		if (!isAuthorizedPathWrite(scene, 'scene', changes, options)) assertNoPendingPathOperation(scene);
	} catch (error) {
		reportLayerError(error);
		return false;
	}
}

export function teardownLayerManager() {
	for (const [name, id] of hooks) Hooks.off(name, id);
	hooks = [];
	clearTimeout(refreshTimer);
	treeCache = new WeakMap();
	visibilityCache = new WeakMap();
	lockCache = new WeakMap();
	visibilityErrors = new WeakMap();
	refreshVisibility = false;
	for (const timer of orderTimers.values()) clearTimeout(timer);
	orderTimers.clear();
}
