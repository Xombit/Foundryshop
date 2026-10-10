import { MODULE } from '../constants.js';
import { canonicalJson } from './project_package.js';
import { readLayerTree } from './layer_manager.js';
import { layerError, layerNode, lockedLayerIds } from './layer_tree_store.js';
import { planStampSorts } from './drawing_order_service.js';
import { commitDrawingStamp } from './project_transfer_service.js';
import { exportPortablePaths, remapPortablePaths } from '../path_portability.js';
import { readPathRegistry } from '../path_store.js';
import { validatePathRegistry } from '../path_schema.js';
import { assertNoPendingPathOperation } from '../path_operation_guard.js';

export async function copyDrawingsToLayer(scene, ids, layerId, {
	expectedRevision, isCurrent = () => true, approvePathLoss,
} = {}) {
	const check = () => {
		if (!game.user.isGM || !game.user.can('DRAWING_CREATE') || !scene?.canUserModify(game.user, 'update')) {
			throw layerError('GMOnly');
		}
		if (!isCurrent()) throw layerError('Changed');
	};
	check();
	assertNoPendingPathOperation(scene);
	const tree = readLayerTree(scene), target = layerNode(tree, layerId), locked = lockedLayerIds(tree);
	if (expectedRevision !== undefined && tree.revision !== expectedRevision) throw layerError('Changed');
	if (target.kind !== 'layer' || locked.has(layerId)) throw layerError('Locked');
	if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw layerError('NoSelection');
	if (ids.length > 100 || scene.drawings.size + ids.length > 10000) {
		throw new Error(game.i18n.localize('FOUNDRYSHOP.Layers.CopyLimit'));
	}
	const documents = ids.map(id => scene.drawings.get(id));
	if (documents.some(d => !d)) throw layerError('NoSelection');
	if (documents.some(d => d.locked || d.toObject().locked || locked.has(d.getFlag(MODULE, 'layerId')))) throw layerError('Locked');
	const sources = documents.map(d => d.toObject()).sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
	const registry = structuredClone(scene.getFlag(MODULE, 'paths'));
	const entries = sources.map(data => ({ id: data._id, layerId: data.flags?.[MODULE]?.layerId ?? null,
		data: structuredClone(data) }));
	const portable = exportPortablePaths(scene, entries);
	if (portable.pathWarnings.length) {
		if (typeof approvePathLoss !== 'function') {
			throw new Error(game.i18n.localize('FOUNDRYSHOP.Layers.CopyPathLoss'));
		}
		if (!await approvePathLoss(portable.pathWarnings)) return null;
	}
	const reviewCurrent = () => {
		check();
		assertNoPendingPathOperation(scene);
		if (canonicalJson(readLayerTree(scene)) !== canonicalJson(tree)
			|| canonicalJson(scene.getFlag(MODULE, 'paths')) !== canonicalJson(registry)
			|| sources.some(source => canonicalJson(scene.drawings.get(source._id)?.toObject()) !== canonicalJson(source))) {
			throw layerError('Changed');
		}
	};
	reviewCurrent();
	return commitDrawingStamp(scene, token => {
		reviewCurrent();
		const peers = [...scene.drawings.values()], allocation = planStampSorts(tree, peers, layerId, sources.length);
		const paths = readPathRegistry(scene), forbidden = new Set([...peers.map(d => d.id), ...paths.routes.map(r => r.id)]);
		const fresh = () => {
			const id = foundry.utils.randomID();
			if (forbidden.has(id)) throw layerError('Changed');
			forbidden.add(id); return id;
		};
		const drawingIds = new Map(), routeIds = new Map(portable.paths.routes.map(r => [r.id, fresh()]));
		const data = entries.map((entry, index) => {
			const copy = structuredClone(entry.data), id = fresh();
			drawingIds.set(entry.id, id);
			copy._id = id; copy.sort = allocation.sorts[index];
			copy.flags ??= {};
			copy.flags[MODULE] = { ...copy.flags[MODULE], layerId,
				importStaging: token, provenance: { importId: token } };
			return copy;
		});
		const routes = remapPortablePaths(portable.paths, data, drawingIds, routeIds);
		return { data, sortUpdates: allocation.updates,
			paths: routes.length ? validatePathRegistry({ ...paths, revision: paths.revision + 1,
				routes: [...paths.routes, ...routes] }) : undefined };
	}, { expectedRevision: tree.revision, isCurrent: () => { check(); return true; } });
}
