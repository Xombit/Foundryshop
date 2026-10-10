import { MODULE } from '../constants.js';
import { canonicalJson } from './project_package.js';
import { planDrawingOrder } from './drawing_order_service.js';
import { emptyLayerTree, validateLayerTree } from './layer_tree_store.js';
import { readStoredOptimizationArchive } from './optimization_recovery.js';
import { readVerifiedFile } from '../verified_file_storage.js';
import { readOptimizationJournal } from './optimization_journal.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);

export async function verifyConsolidationLineage(scene, levelId, parent, options) {
	const journal = readOptimizationJournal(scene);
	if (parent !== null) {
		const root = journal.entries.find(entry => entry.action === 'apply' && entry.phase === 'complete'
			&& entry.levelId === levelId && same(entry.archive, parent.file) && entry.archiveChecksum === parent.checksum);
		if (!root) throw new Error('Drawing recovery lineage is not retained in the same-Level journal.');
		if (root.replacement.type !== 'Drawing') return;
	}
	let before = journal.entries.length;
	while (parent !== null) {
		const index = journal.entries.findIndex(entry => entry.action === 'apply' && entry.phase === 'complete'
			&& entry.levelId === levelId && entry.replacement.type === 'Drawing'
			&& same(entry.archive, parent.file) && entry.archiveChecksum === parent.checksum);
		if (index < 0 || index >= before) throw new Error('Consolidate recovery ancestors must precede their children in the retained journal.');
		before = index;
		const archive = await readStoredOptimizationArchive(parent.file, options);
		if (archive.checksum !== parent.checksum || archive.payload.sceneId !== scene.id
			|| archive.payload.levelId !== levelId || archive.payload.replacement.type !== 'Drawing'
			|| archive.payload.id !== journal.entries[index].token
			|| !same(archive.payload.output, journal.entries[index].asset)) {
			throw new Error('Consolidate requires exact same-Scene/Level Drawing recovery ancestors.');
		}
		await readVerifiedFile(archive.payload.output, options);
		parent = archive.payload.parent;
	}
}

/** A single composite may replace only a contiguous, unambiguous native Drawing run. */
export function consolidationRun(scene, levelId, originals, replacementId = null) {
	if (!Array.isArray(originals) || !originals.length) throw new Error('Consolidate requires eligible original Drawings.');
	const layerId = originals[0].flags?.[MODULE]?.layerId ?? null, elevation = originals[0].elevation;
	if (originals.some(source => (source.flags?.[MODULE]?.layerId ?? null) !== layerId
		|| source.elevation !== elevation || source.interface || source.hidden
		|| source.levels?.length !== 1 || source.levels[0] !== levelId)) {
		throw new Error('Consolidate requires one Drawing layer, one elevation and visible world artwork.');
	}
	const ids = new Set(originals.map(source => source._id));
	const peers = [...scene.drawings.values()].map(drawing => drawing.toObject())
		.filter(source => !ids.has(source._id) && source._id !== replacementId
			&& source.levels?.includes(levelId) && source.elevation === elevation && !source.interface);
	const stack = [...peers, ...originals].sort((a, b) => a.sort - b.sort);
	if (stack.some(source => !Number.isSafeInteger(source.sort))
		|| new Set(stack.map(source => source.sort)).size !== stack.length) {
		throw new Error('Consolidate requires unique integer native sorts; resolve ambiguous stack ties first.');
	}
	const first = stack.findIndex(source => ids.has(source._id));
	if (stack.slice(first, first + originals.length).some(source => !ids.has(source._id))) {
		throw new Error('Consolidate cannot cross an intervening Drawing stack barrier; select a contiguous run.');
	}
	const tree = validateLayerTree(scene.getFlag(MODULE, 'layers') ?? emptyLayerTree());
	const order = planDrawingOrder(tree, stack.map(source => ({
		id: source._id, sort: source.sort, elevation, interface: false,
		getFlag: (namespace, key) => source.flags?.[namespace]?.[key],
	})));
	if (order.length) throw new Error('Drawing layer order needs repair before Consolidate; no unrelated sorts are rewritten.');
	return { layerId, elevation, sort: stack[first].sort };
}

export function assertConsolidationPlacement(scene, payload, bounds) {
	const { replacement } = payload;
	if (replacement.type !== 'Drawing') throw new Error('Consolidate placement requires a Drawing replacement.');
	const run = consolidationRun(scene, payload.levelId, payload.originals, replacement.id);
	const source = replacement.after;
	if (source.x !== bounds.x || source.y !== bounds.y || source.shape?.width !== bounds.width
		|| source.shape?.height !== bounds.height || source.shape?.type !== 'r'
		|| source.elevation !== run.elevation || source.sort !== run.sort
		|| (source.flags?.[MODULE]?.layerId ?? null) !== run.layerId
		|| source.flags?.[MODULE]?.imageStamp !== 1 || source.hidden || source.locked
		|| source.interface || source.rotation !== 0 || source.strokeWidth !== 0
		|| source.fillType !== 2 || source.fillColor?.toLowerCase() !== '#ffffff'
		|| source.fillAlpha !== 1 || source.text !== '' || source.texture !== payload.output.path) {
		throw new Error('Consolidate must retain its exact Drawing run, layer, elevation and neutral image mapping.');
	}
	if (!same({ ...replacement.staged, hidden: false }, source)) {
		throw new Error('Consolidate hidden staging differs from the reviewed image Drawing.');
	}
	return run;
}
