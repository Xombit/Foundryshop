import { remapRecoveryProjectBundle } from './recovery_project_remap.js';
import { reconstructRecoveryProjectDrawings } from './recovery_project_manifest.js';
import { readOptimizationArchive } from './optimization_recovery.js';
import { assertOptimizationNativeSchemas, assertOptimizationNativeSource } from './optimization_native.js';
import { readLayerTree } from './layer_manager.js';
import { optimizationSceneGrid } from './optimization_scene_data.js';
import { canonicalJson } from './project_package.js';
import { availableProjectFonts } from './project_resources.js';
import { planDrawingOrder } from './drawing_order_service.js';

const fail = message => { throw new Error(`Recovery import preparation: ${message}`); };
const preparedPlans = new WeakMap();

/** Only genuine, unchanged detached plans can enter the review/intent boundary. */
export function capturePreparedRecoveryImport(plan) {
	const retained = preparedPlans.get(plan);
	if (!retained || canonicalJson(plan) !== retained.signature) fail('Prepared plan is fabricated or was changed; prepare again.');
	retained.check();
	return structuredClone(retained.plan);
}

function assertHistoricalOrder(manifest, archives, sources) {
	const drawings = new Map(sources.map(source => [source._id, source]));
	const check = () => {
		const virtual = [...drawings.values()].map(source => ({ ...source, id: source._id,
			getFlag: (namespace, key) => source.flags[namespace]?.[key] }));
		if (planDrawingOrder(manifest.project.tree, virtual).length) {
			fail('Live or historical Drawing order needs repair; import will not rewrite retained sorts.');
		}
	};
	const byToken = new Map(archives.map(payload => [payload.id, payload]));
	check();
	for (const entry of [...manifest.journal.entries].reverse()) {
		const payload = byToken.get(entry.action === 'apply' ? entry.token : entry.parentToken);
		if (entry.action === 'restore') {
			for (const original of payload.originals) drawings.delete(original._id);
			if (payload.replacement.type === 'Drawing') drawings.set(payload.replacement.id, payload.replacement.after);
		} else {
			if (payload.replacement.type === 'Drawing') drawings.delete(payload.replacement.id);
			for (const original of payload.originals) drawings.set(original._id, original);
		}
		check();
	}
}

/** Guarded, detached empty-project planning only. No approvals, upload or native writes. */
export async function prepareRecoveryImport(scene, input, options = {}) {
	const { levelId, isCurrent, signal, replaceEmptyMetadata = false } = options;
	if (typeof isCurrent !== 'function' || typeof replaceEmptyMetadata !== 'boolean'
		|| !scene?.levels?.has(levelId)) fail('Explicit destination Level/context and metadata policy are required.');
	const owner = game.user?.id, snapshot = canonicalJson(scene.toObject());
	const check = () => {
		if (!game.user?.isGM || game.user.id !== owner || game.users?.activeGM?.id !== owner
			|| !game.user.can('FILES_BROWSE') || !game.user.can('FILES_UPLOAD')
			|| game.scenes?.get(scene.id) !== scene || !scene.canUserModify(game.user, 'update')
			|| signal?.aborted || !isCurrent() || canonicalJson(scene.toObject()) !== snapshot) {
			fail('Destination authority/context changed or was cancelled.');
		}
		if (scene.getFlag('foundryshop', 'projectImportJournal') !== undefined
			|| scene.getFlag('foundryshop', 'optimizationJournal') !== undefined
			|| scene.getFlag('foundryshop', 'recovery') !== undefined) fail('Resolve destination import/recovery history first.');
		if (scene.drawings.size || scene.tiles.size) fail('Initial recovery preparation requires an empty Drawing/Tile project; additive import is not supported yet.');
		return true;
	};
	check();
	const before = readLayerTree(scene);
	if ((before.nodes.length || before.presets.length) && !replaceEmptyMetadata) fail('Retained empty-project layers/presets require explicit replacement approval.');
	if (before.revision === Number.MAX_SAFE_INTEGER) fail('Destination layer revision is exhausted.');
	const reservedIds = [...before.nodes.map(node => node.id), ...before.presets.map(preset => preset.id),
		...scene.levels.keys(), ...scene.drawings.keys(), ...scene.tiles.keys()];
	const result = await remapRecoveryProjectBundle(input, {
		sceneId: scene.id, authorId: owner, level: scene.levels.get(levelId).toObject(),
		scene: { width: scene.width, height: scene.height, padding: scene.padding, grid: optimizationSceneGrid(scene) },
		root: options.root, reservedIds, reservedPaths: options.reservedPaths,
	}, { ...options, createId: options.createId ?? (() => foundry.utils.randomID()),
		presentation: { revision: before.revision + 1 } });
	check();
	const archives = [];
	for (const file of result.recoveryFiles.filter(file => file.reference.path.endsWith('.json'))) {
		const { payload } = await readOptimizationArchive(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes));
		check();
		assertOptimizationNativeSchemas(scene, payload);
		archives.push(payload);
	}
	const drawings = reconstructRecoveryProjectDrawings(result.manifest.project, result.manifest.authors);
	assertHistoricalOrder(result.manifest, archives, drawings);
	const staged = source => {
		const data = structuredClone(source);
		data.hidden = true;
		data.flags.foundryshop ??= {};
		data.flags.foundryshop.importStaging = result.provenance.importId;
		return data;
	};
	const stagedDrawings = drawings.map(staged), stagedTiles = result.manifest.tiles.map(staged);
	for (const [type, sources] of [['Drawing', [...drawings, ...stagedDrawings]],
		['Tile', [...result.manifest.tiles, ...stagedTiles]], ['Level', [result.manifest.source.level]]]) {
		for (const source of sources) { check(); assertOptimizationNativeSource(scene, type, source); }
	}
	const sources = [...drawings, ...result.manifest.tiles, ...archives.flatMap(payload => [
		...payload.originals, ...(payload.replacement.type === 'LevelBackground'
			? [] : [payload.replacement.after, payload.replacement.staged]),
	])];
	const modules = [...new Set(sources.flatMap(source => Object.keys(source.flags ?? {}))
		.filter(namespace => !['foundryshop', 'core'].includes(namespace)))].sort();
	const missingModules = modules.filter(namespace => !game.modules.get(namespace)?.active);
	if (missingModules.length) fail(`Enable metadata modules used by live or archived sources: ${missingModules.join(', ')}.`);
	const available = new Set(availableProjectFonts());
	const missingFonts = result.manifest.resources.fonts.filter(font => !available.has(font));
	if (missingFonts.length) fail(`Install fonts used by live or archived sources: ${missingFonts.join(', ')}.`);
	check();
	const plan = { ...result, drawings, stagedDrawings, stagedTiles, before, destinationSnapshot: snapshot,
		review: { ...result.review, presentationPolicy: 'Drawings concealed by hidden wrapper',
			requiredApprovals: ['project-import', ...(result.manifest.tiles.length ? ['native-tile-visibility'] : []),
				...(result.review.hasBackground ? ['level-background-replacement-and-visibility'] : []),
				...((before.nodes.length || before.presets.length) ? ['empty-metadata-replacement'] : [])],
			nativeTiles: result.manifest.tiles.map(tile => ({ id: tile._id, hidden: tile.hidden })),
			fonts: [...result.manifest.resources.fonts], modules,
			disclosure: 'Detached native schemas verified across retained generations and temporary hidden staging. Empty destination only. Native Tiles/backgrounds do not obey the Drawing presentation wrapper: separate visibility/replacement approval is required. No approval consumed, upload, disk collision check, journal or Scene write occurred.' } };
	preparedPlans.set(plan, { plan: structuredClone(plan), signature: canonicalJson(plan), check });
	return plan;
}
