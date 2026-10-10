import { MODULE } from '../constants.js';
import { canonicalJson } from './project_package.js';
import { effectiveLayerGate } from './layer_tree_store.js';
import { readOptimizationArchive } from './optimization_recovery.js';
import { assertConsolidationPlacement } from './consolidation_placement.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const neutralTransform = {
	anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0,
	fit: 'fill', scaleX: 1, scaleY: 1, rotation: 0,
};

function rect(input) {
	if (!input || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(input[key]))
		|| input.width <= 0 || input.height <= 0
		|| ![input.x + input.width, input.y + input.height].every(Number.isFinite)) {
		throw new Error('Bake placement requires finite positive reviewed scene-pixel bounds.');
	}
	return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, input[key]]));
}

function nativeRect(scene) {
	return rect(scene.getDimensions().sceneRect);
}

function tiles(scene, levelId, replacement) {
	return [...scene.tiles.values()].filter(tile => tile.id !== (replacement.type === 'Tile' ? replacement.id : null))
		.filter(tile => tile.toObject().levels?.includes(levelId))
		.map(tile => ({ source: tile.toObject(), bounds: rect(tile.shape?.bounds) }))
		.sort((a, b) => a.source._id.localeCompare(b.source._id));
}

function overlap(tile, bounds) {
	// Native shape bounds account for v14 texture anchors and rotation, not pixel coverage.
	return tile.x + tile.width > bounds.x && tile.x < bounds.x + bounds.width
		&& tile.y + tile.height > bounds.y && tile.y < bounds.y + bounds.height;
}

function assertPlacement(scene, payload, reviewed) {
	const { replacement, context } = payload, level = context.level, ground = level.elevation?.bottom;
	if (reviewed.action === 'apply' && reviewed.audience === 'player' && payload.originals.some(source => {
		const membership = source.flags[MODULE]?.layerId ?? null;
		return membership !== null && !effectiveLayerGate(context.layers, membership, node => node.playerAllowed);
	})) throw new Error('Player bake cannot expose GM-private source artwork.');
	if (replacement.type === 'Drawing') {
		assertConsolidationPlacement(scene, payload, reviewed.bounds);
		return;
	}
	if (reviewed.action === 'restore') {
		if (replacement.type === 'Tile' && !same(rect(replacement.after), reviewed.bounds)) {
			throw new Error('Restore review bounds differ from the retained Tile.');
		}
		return;
	}
	if (!Number.isFinite(ground) || payload.originals.some(source => source.elevation !== ground || source.interface || source.hidden)) {
		throw new Error('Ground bake requires visible world Drawings at the exact Level-background elevation.');
	}
	if (replacement.type === 'Tile') {
		const after = replacement.after, texture = after.texture;
		if (!same(rect(after), reviewed.bounds) || after.elevation !== ground || after.rotation !== 0
			|| after.alpha !== 1 || after.locked !== true || after.hidden !== (reviewed.audience === 'gm')
			|| !Number.isSafeInteger(after.sort) || after.flags[MODULE]?.layerId != null
			|| !texture || texture.anchorX !== 0 || texture.anchorY !== 0 || texture.fit !== 'fill'
			|| texture.scaleX !== 1 || texture.scaleY !== 1 || String(texture.tint).toLowerCase() !== '#ffffff'
			|| after.restrictions?.light !== false || after.restrictions?.weather !== false
			|| !Array.isArray(after.occlusion?.modes) || after.occlusion.modes.length) {
			throw new Error('Baked Tile must match reviewed bounds, ground elevation, audience and neutral locked-overlay settings.');
		}
	} else if (replacement.type === 'LevelBackground') {
		if (reviewed.audience !== 'player' || !same(reviewed.bounds, reviewed.sceneRect)) {
			throw new Error('Background baking requires a public full-scene-rectangle output.');
		}
		if (!same(replacement.before.textures, neutralTransform) || !same(replacement.after.textures, neutralTransform)) {
			throw new Error('Nonidentity/shared Level texture transforms require inverse-mapping support; use a Tile or export instead.');
		}
		if (String(replacement.after.background.tint).toLowerCase() !== '#ffffff'
			|| String(replacement.after.background.color).toLowerCase() !== '#ffffff'
			|| replacement.after.background.alphaThreshold !== replacement.before.background.alphaThreshold) {
			throw new Error('Combined background requires neutral tint/color and retained alpha-threshold settings.');
		}
	} else throw new Error('Ground Bake placement accepts Tile or Level-background destinations, not Drawing consolidation.');
}

/** Read-only placement review; actual crop pixels and native renderer acceptance remain separate gates. */
export async function prepareOptimizationPlacement(scene, archiveText, { bounds, audience, action = 'apply', isCurrent } = {}) {
	if (!['gm', 'player'].includes(audience) || !['apply', 'restore'].includes(action) || typeof isCurrent !== 'function') {
		throw new Error('Placement review requires supported action, explicit audience and reviewed-context checks.');
	}
	const { payload } = await readOptimizationArchive(archiveText);
	const check = () => {
		if (!game.user?.isGM || scene?.id !== payload.sceneId || !scene.levels?.has(payload.levelId) || !isCurrent()) {
			throw new Error('Bake placement review authority/Scene/Level/context changed.');
		}
	};
	check();
	const reviewed = { bounds: rect(bounds), audience, action, sceneRect: nativeRect(scene) };
	assertPlacement(scene, payload, reviewed);
	const baselineTiles = tiles(scene, payload.levelId, payload.replacement);
	if (baselineTiles.some(({ source }) => !['x', 'y', 'width', 'height', 'elevation'].every(key => Number.isFinite(source[key]))
		|| source.width <= 0 || source.height <= 0)) throw new Error('Existing Tile geometry is unverified; placement review refused.');
	const publicReview = {
		...structuredClone(reviewed), destination: payload.replacement.type,
		groundElevation: payload.replacement.type === 'Drawing' ? payload.replacement.after.elevation : payload.context.level.elevation.bottom,
		...(payload.replacement.type === 'Drawing' ? {
			layerId: payload.replacement.after.flags[MODULE]?.layerId ?? null, sort: payload.replacement.after.sort,
		} : {}),
		overlappingTileIds: baselineTiles.filter(tile => overlap(tile.bounds, reviewed.bounds)).map(tile => tile.source._id),
		disclosure: action === 'restore'
			? 'Restore removes the retained replacement and recreates exact archived originals under their archived native visibility and Drawing presentation gates. It does not authorize new public Bake exposure or flattening.'
			: payload.replacement.type === 'Drawing'
			? 'Consolidate retains the original Drawing layer, elevation and contiguous native stack run; it does not flatten ink to ground artwork.'
			: 'Ground bake moves ink below remaining Drawings and Tokens. Background ink also moves below Tiles; Tile overlap is a conservative bounds estimate, not pixel-identical stacking. Hidden assets are not secure secret storage.',
	};
	const current = () => {
		check();
		if (payload.replacement.type === 'Drawing') assertPlacement(scene, payload, reviewed);
		if (!same(nativeRect(scene), reviewed.sceneRect) || !same(tiles(scene, payload.levelId, payload.replacement), baselineTiles)) {
			throw new Error('Native Tile/Scene placement context changed; review ground stacking again.');
		}
	};
	return {
		review: structuredClone(publicReview),
		approve({ flattenToGround, restorePlacement, overlappingTileIds } = {}) {
			current();
			if ((action === 'restore' ? restorePlacement !== true : flattenToGround !== true) || !Array.isArray(overlappingTileIds)
				|| !same([...overlappingTileIds].sort(), [...publicReview.overlappingTileIds].sort())) {
				throw new Error(action === 'restore' ? 'Approve exact archived Restore placement and listed Tile overlaps.'
					: payload.replacement.type === 'Drawing'
					? 'Approve the retained Drawing-run placement and exact listed Tile overlaps.'
					: 'Approve the ground-stacking change and exact listed Tile overlaps.');
			}
			return async candidate => {
				current();
				if (!same(candidate, payload)) throw new Error('Placement acceptance belongs to a different reviewed archive.');
				assertPlacement(scene, candidate, reviewed);
				return true;
			};
		},
	};
}
