import { MODULE } from '../constants.js';
import { renderArtworkWebp } from '../artwork_renderer.js';
import { STAMP_FOLDER, validateAssetFolder } from '../artwork_stamps.js';
import { exportProjectDrawing } from './project_transfer_service.js';
import { layerError, layerNode } from './layer_tree_store.js';
import { drawingLayerId } from './drawing_order_service.js';
import { readLayerTree, readLayerWorkspace, toggleWorkspaceVisibility } from './layer_manager.js';

export const TRACING_FLAG = 'tracingLayerId';
export const TRACING_FOLDER = 'foundryshop-tracing';
export const TRACING_ALPHA = 0.5;

export function tracingTiles(scene, layerId) {
	return [...scene.tiles.values()].filter(tile => tile.getFlag(MODULE, TRACING_FLAG) === layerId);
}

export function tracingFolder() {
	const configured = game.settings.get(MODULE, STAMP_FOLDER);
	return validateAssetFolder(configured || TRACING_FOLDER);
}

async function ensureFolder(picker, folder) {
	try {
		return await picker.browse('data', folder);
	} catch {
		let path = '';
		for (const part of folder.split('/')) {
			path = path ? `${path}/${part}` : part;
			try { await picker.createDirectory('data', path, {}); } catch { /* already exists */ }
		}
		return picker.browse('data', folder);
	}
}

/**
 * Snapshots one layer into a hidden, locked, translucent Tile beneath Drawings and
 * hides the source layer in the GM workspace. Re-running replaces the previous Tile;
 * uploaded files are kept because Foundry has no supported file delete API.
 */
export async function createTracingTile(scene, layerId, { render = renderArtworkWebp, exportDrawing = exportProjectDrawing } = {}) {
	if (!game.user.isGM) throw layerError('GMOnly');
	if (!scene || scene !== canvas.scene) throw layerError('Changed');
	if (!game.user.can('FILES_UPLOAD')) throw new Error(game.i18n.localize('FOUNDRYSHOP.Layers.TracingUpload'));
	const tree = readLayerTree(scene);
	if (layerNode(tree, layerId).kind !== 'layer') throw layerError('TracingGroup');
	const levelId = canvas.level?.id ?? null;
	const sources = [...scene.drawings.values()].filter(drawing => {
		if (drawingLayerId(drawing) !== layerId) return false;
		const levels = drawing.toObject().levels ?? [];
		return !levelId || !levels.length || levels.includes(levelId);
	});
	if (!sources.length) throw layerError('TracingEmpty');
	const entries = sources.map(drawing => exportDrawing(drawing));
	const { blob, bounds } = await render(entries,
		{ audience: 'gm', crop: 'artwork', scale: 1, quality: 0.9, acknowledgeExternal: false });
	if (scene !== canvas.scene) throw layerError('Changed');
	const picker = foundry.applications.apps.FilePicker.implementation;
	const folder = tracingFolder();
	await ensureFolder(picker, folder);
	const name = `tracing-${layerId}-${foundry.utils.randomID()}.webp`;
	const upload = await picker.upload('data', folder, new File([blob], name, { type: 'image/webp' }), {}, { notify: false });
	if (!upload?.path) throw new Error(game.i18n.localize('FOUNDRYSHOP.Layers.TracingUpload'));
	if (scene !== canvas.scene) throw layerError('Changed');
	const previous = tracingTiles(scene, layerId).map(tile => tile.id);
	const lowest = Math.min(0, ...[...scene.tiles.values()].map(tile => tile.sort ?? 0));
	const [tile] = await scene.createEmbeddedDocuments('Tile', [{
		texture: { src: upload.path }, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
		alpha: TRACING_ALPHA, hidden: true, locked: true, sort: lowest - 1,
		elevation: Math.min(...sources.map(drawing => drawing.elevation ?? 0)),
		...(levelId ? { levels: [levelId] } : {}),
		flags: { [MODULE]: { [TRACING_FLAG]: layerId } },
	}]);
	if (!tile) throw new Error(game.i18n.localize('FOUNDRYSHOP.Layers.TracingUpload'));
	if (previous.length) await scene.deleteEmbeddedDocuments('Tile', previous);
	if (!readLayerWorkspace(scene).hiddenIds.includes(layerId)) await toggleWorkspaceVisibility(scene, layerId);
	return tile;
}

/** Deletes the Tile only; the uploaded image stays in the asset folder. */
export async function removeTracingTile(scene, layerId) {
	if (!game.user.isGM) throw layerError('GMOnly');
	const ids = tracingTiles(scene, layerId).map(tile => tile.id);
	if (ids.length) await scene.deleteEmbeddedDocuments('Tile', ids);
	if (readLayerTree(scene).nodes.some(node => node.id === layerId)
		&& readLayerWorkspace(scene).hiddenIds.includes(layerId)) await toggleWorkspaceVisibility(scene, layerId);
	return ids.length;
}
