import { MODULE } from '../constants.js';
import { canonicalJson } from './project_package.js';
import { readLayerWorkspace } from './layer_manager.js';
import { emptyLayerTree, validateLayerTree, effectiveLayerGate, lockedLayerIds } from './layer_tree_store.js';
import { readOptimizationJournal, validateOptimizationJournal } from './optimization_journal.js';
import { createOptimizationArchive, readOptimizationArchive, optimizationArchiveDescriptor, prepareOptimizationArchiveFile } from './optimization_recovery.js';
import { optimizationSceneGrid } from './optimization_scene_data.js';
import { consolidationRun } from './consolidation_placement.js';
import { assertNoPendingPathOperation } from '../path_operation_guard.js';

const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const sorted = values => [...values].sort();
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

function selection(readSelection) {
	if (typeof readSelection !== 'function') throw new Error('Selection scope requires a live selected-ID reader.');
	const ids = readSelection();
	if (!Array.isArray(ids) || !ids.length || ids.some(value => !id(value)) || new Set(ids).size !== ids.length) {
		throw new Error('Select existing unique Drawing IDs before reviewing a bake.');
	}
	return sorted(ids);
}

function snapshot(scene, levelId, { includeJournal = true } = {}) {
	return canonicalJson({
		width: scene.width, height: scene.height, padding: scene.padding, grid: optimizationSceneGrid(scene),
		level: scene.levels.get(levelId)?.toObject() ?? null,
		layers: scene.getFlag(MODULE, 'layers') ?? emptyLayerTree(), workspace: readLayerWorkspace(scene),
		drawings: [...scene.drawings.values()].map(drawing => drawing.toObject()).sort((a, b) => a._id.localeCompare(b._id)),
		tiles: [...scene.tiles.values()].map(tile => tile.toObject()).sort((a, b) => a._id.localeCompare(b._id)),
		import: scene.getFlag(MODULE, 'projectImportJournal') ?? null,
		pathJournal: scene.getFlag(MODULE, 'pathJournal') ?? null,
		...(includeJournal ? { journal: readOptimizationJournal(scene) } : {}),
	});
}

/** Read-only scope manifest. Resource/native placement checks remain mandatory after this review. */
export function prepareOptimizationScope(scene, levelId, {
	kind = 'layer', layerId = null, audience, destination, readSelection, isCurrent, inspectSource,
} = {}) {
	if (!['layer', 'selection', 'all'].includes(kind) || !['gm', 'player'].includes(audience)
		|| !['tile', 'background', 'drawing'].includes(destination) || typeof isCurrent !== 'function'
		|| typeof inspectSource !== 'function' || (kind === 'layer' ? !id(layerId) : layerId !== null)) {
		throw new Error('Bake review requires explicit scope, audience, destination, context and renderer capability checks.');
	}
	const reviewerId = game.user?.id;
	const check = () => {
		assertNoPendingPathOperation(scene);
		if (!game.user?.isGM || game.user.id !== reviewerId || !scene || !scene.levels.has(levelId) || !isCurrent()
			|| scene.getFlag(MODULE, 'projectImportJournal')
			|| readOptimizationJournal(scene).entries.some(entry => entry.phase !== 'complete')) {
			throw new Error('Bake review context changed or another document operation is unfinished.');
		}
	};
	check();
	const tree = validateLayerTree(scene.getFlag(MODULE, 'layers') ?? emptyLayerTree());
	if (kind === 'layer' && !tree.nodes.some(node => node.id === layerId && node.kind === 'layer')) {
		throw new Error('Layer bake requires one leaf layer, not a group or implicit descendants.');
	}
	const chosen = kind === 'selection' ? selection(readSelection) : null;
	if (chosen?.some(value => !scene.drawings.has(value))) throw new Error('Selected Drawing identity is no longer present.');
	const selected = chosen ? new Set(chosen) : null;
	const baseline = snapshot(scene, levelId), nativeBaseline = snapshot(scene, levelId, { includeJournal: false });
	const baselineJournal = readOptimizationJournal(scene);
	const workspace = readLayerWorkspace(scene), locked = lockedLayerIds(tree);
	const included = [], excluded = [];
	for (const drawing of scene.drawings.values()) {
		const source = drawing.toObject(), membership = source.flags?.[MODULE]?.layerId ?? null;
		if (kind === 'selection' ? !selected.has(drawing.id)
			: !(source.levels ?? []).includes(levelId) || kind === 'layer' && membership !== layerId) continue;
		const reasons = [];
		if (!id(drawing.id) || source._id !== drawing.id) reasons.push('invalid-native-identity');
		if (!Array.isArray(source.levels) || source.levels.length !== 1 || source.levels[0] !== levelId) reasons.push('other-or-multiple-levels');
		if (source.interface) reasons.push('interface-artwork');
		if (source.hidden) reasons.push('native-hidden');
		if (source.locked || locked.has(membership)) reasons.push('locked');
		if (source.flags?.[MODULE]?.importStaging) reasons.push('unfinished-staging');
		if (!Number.isFinite(source.elevation) || !Number.isSafeInteger(source.sort)) reasons.push('invalid-native-order');
		if (membership !== null) {
			if (!tree.nodes.some(node => node.id === membership && node.kind === 'layer')) reasons.push('invalid-membership');
			else {
				if (!effectiveLayerGate(tree, membership, node => !workspace.hiddenIds.includes(node.id))) reasons.push('workspace-hidden');
				if (audience === 'player' && !effectiveLayerGate(tree, membership, node => node.playerAllowed)) reasons.push('gm-private');
			}
		}
		const capability = inspectSource(structuredClone(source));
		if (!capability || typeof capability.supported !== 'boolean'
			|| !capability.supported && (typeof capability.reason !== 'string' || !capability.reason.trim())) {
			throw new Error('Renderer capability inspection requires explicit support or an actionable exclusion reason.');
		}
		if (!capability.supported) reasons.push(capability.reason);
		if (reasons.length) excluded.push({ id: drawing.id, layerId: membership, reasons });
		else included.push({ id: drawing.id, layerId: membership, source });
	}
	check();
	if (snapshot(scene, levelId) !== baseline || chosen && !same(selection(readSelection), chosen)) {
		throw new Error('Bake sources/context changed during scope inspection.');
	}
	included.sort((a, b) => a.source.elevation - b.source.elevation || a.source.sort - b.source.sort || a.id.localeCompare(b.id));
	excluded.sort((a, b) => a.id.localeCompare(b.id));
	const blockers = [];
	if (!included.length) blockers.push('No eligible Drawing sources remain.');
	if (new Set(included.map(entry => entry.source.elevation)).size > 1) blockers.push('Mixed elevations require a separate scope; ground flattening is not an elevation conversion.');
	if (destination === 'background' && audience !== 'player') blockers.push('Level backgrounds cannot represent GM-private artwork.');
	if (destination === 'drawing') {
		if (!['layer', 'selection'].includes(kind)) blockers.push('Consolidate supports Selected Drawings or one leaf layer, not All or groups.');
		if (included.length) {
			try { consolidationRun(scene, levelId, included.map(entry => entry.source)); }
			catch (error) { blockers.push(error.message); }
		}
	}
	const publicReview = {
		scope: { kind, layerId }, sceneId: scene.id, levelId, audience, destination,
		included: included.map(({ id, layerId }) => ({ id, layerId })), excluded,
		includedCount: included.length, excludedCount: excluded.length, removalCount: included.length,
		sourceLayers: sorted(new Set(included.map(entry => entry.layerId).filter(value => value !== null))),
		includesUnassigned: included.some(entry => entry.layerId === null), blockers,
		requiresFlattenReview: true,
		disclosure: destination === 'drawing'
			? 'Consolidate retains one contiguous Drawing run and layer ownership. This manifest does not establish resource, pixel, resolution or placement acceptance.'
			: 'Bake changes Drawing stack depth to ground artwork. This manifest does not establish resource, pixel, resolution or placement acceptance.',
	};
	const current = () => {
		check();
		if (snapshot(scene, levelId) !== baseline || chosen && !same(selection(readSelection), chosen)) {
			throw new Error('Bake preview is stale; review again before rendering or removal.');
		}
		return true;
	};
	return {
		review: structuredClone(publicReview), assertCurrent: current,
		/** Explicit exact exclusion acceptance avoids silently dropping private/unsupported Drawings from All. */
		approve({ excludedIds, flattenToGround } = {}) {
			current();
			if (blockers.length) throw new Error(`Bake scope is blocked: ${blockers.join(' ')}`);
			if (!Array.isArray(excludedIds) || !same(sorted(excludedIds), sorted(excluded.map(entry => entry.id)))
				|| flattenToGround !== true) throw new Error(destination === 'drawing'
					? 'Approve exact listed exclusions and the retained Drawing-run placement before consolidating.'
					: 'Approve exact listed exclusions and the Drawing-to-ground stacking change before baking.');
			const ids = included.map(entry => entry.id);
			let boundIntent = null;
			return { ...structuredClone(publicReview), sourceIds: [...ids],
				sources: included.map(entry => structuredClone(entry.source)), assertCurrent: current,
				async bindOperationIntent(intent, archiveText) {
					current();
					const candidate = structuredClone(intent);
					validateOptimizationJournal({ ...baselineJournal, revision: baselineJournal.revision + 1,
						entries: [...baselineJournal.entries, candidate] }, scene.id);
					const { payload } = await readOptimizationArchive(archiveText);
					const descriptor = await optimizationArchiveDescriptor(archiveText);
					const archiveFile = await prepareOptimizationArchiveFile(archiveText, candidate.archive.root);
					const parent = candidate.parentToken === null ? null : baselineJournal.entries.find(entry => entry.token === candidate.parentToken);
					current();
					if (candidate.action !== 'apply' || candidate.phase !== 'intent' || candidate.sceneId !== scene.id
						|| candidate.levelId !== levelId || candidate.ownerId !== reviewerId
						|| payload.id !== candidate.token || payload.sceneId !== scene.id || payload.levelId !== levelId
						|| !same(payload.scope, { kind, layerId })
						|| !same([...payload.originals].sort((a, b) => a._id.localeCompare(b._id)),
							included.map(entry => entry.source).sort((a, b) => a._id.localeCompare(b._id)))
						|| candidate.replacement.type !== ({ tile: 'Tile', background: 'LevelBackground', drawing: 'Drawing' }[destination])
						|| !same(candidate.archive, archiveFile)
						|| !same(payload.parent, parent ? { file: parent.archive, checksum: parent.archiveChecksum } : null)
						|| !same(descriptor, Object.fromEntries(Object.keys(descriptor).map(key => [key, candidate[key]])))
						|| destination === 'tile' && payload.replacement.after.hidden !== (audience === 'gm')) {
						throw new Error('Bake intent does not match exact approved scope, sources, audience or destination.');
					}
					if (boundIntent && !same(boundIntent, candidate)) throw new Error('Approved scope is already bound to another bake intent.');
					boundIntent = candidate;
					return () => {
						if (!game.user?.isGM || game.user.id !== candidate.ownerId || !scene.levels.has(levelId) || !isCurrent()
							|| scene.getFlag(MODULE, 'projectImportJournal')
							|| snapshot(scene, levelId, { includeJournal: false }) !== nativeBaseline
							|| chosen && !same(selection(readSelection), chosen)) {
							throw new Error('Bound bake scope native/selection/authority context changed; review again.');
						}
						const journal = readOptimizationJournal(scene);
						const allowed = [baselineJournal,
							{ ...baselineJournal, revision: baselineJournal.revision + 1, entries: [...baselineJournal.entries, candidate] },
							{ ...baselineJournal, revision: baselineJournal.revision + 2,
								entries: [...baselineJournal.entries, { ...candidate, phase: 'assets-verified' }] }];
						if (!allowed.some(value => same(journal, value))) {
							throw new Error('Bound bake scope journal changed beyond its exact preparation intent.');
						}
						return true;
					};
				},
				async createArchive(replacement, archiveOptions) {
					current();
					const archive = await createOptimizationArchive(scene, ids, replacement, {
						...archiveOptions, levelId, scope: { kind, layerId },
					});
					current();
					return archive;
				} };
		},
	};
}
