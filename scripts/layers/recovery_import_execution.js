import { inspectRecoveryImport } from './recovery_import_reconciliation.js';
import { validateRecoveryImportIntent, UnverifiedRecoveryImportIntentError } from './recovery_import_intent.js';
import { reconstructRecoveryProjectDrawings } from './recovery_project_manifest.js';
import { canonicalJson } from './project_package.js';
import { recoveryImportSceneState } from './recovery_import_scene_state.js';
import { runLayerOperation, LAYER_OPERATION } from './layer_manager.js';
import { authorizeRecoveryImportCreates } from './recovery_import_native_guard.js';
import { availableProjectFonts } from './project_resources.js';
import { readVerifiedFile } from '../verified_file_storage.js';
import { readOptimizationArchive } from './optimization_recovery.js';

const approvals = new WeakMap();
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = message => { throw new Error(`Recovery import staging: ${message}`); };
const sources = collection => [...collection.values()].map(document => document.toObject()).sort((a, b) => a._id.localeCompare(b._id));
const staged = (source, token) => {
	const result = structuredClone(source);
	result.hidden = true; result.flags.foundryshop ??= {};
	result.flags.foundryshop.importStaging = token;
	return result;
};

export function recoveryImportUnrelatedContext(scene, levelId, { ignoreOptimization = false } = {}) {
	const object = recoveryImportSceneState(scene.toObject());
	delete object.drawings; delete object.tiles; delete object.levels;
	if (object.flags?.foundryshop) {
		delete object.flags.foundryshop.projectImportJournal;
		delete object.flags.foundryshop.layers;
		if (ignoreOptimization) delete object.flags.foundryshop.optimizationJournal;
		if (!Object.keys(object.flags.foundryshop).length) delete object.flags.foundryshop;
	}
	if (object.flags && !Object.keys(object.flags).length) delete object.flags;
	return canonicalJson({ object, otherLevels: sources(scene.levels).filter(level => level._id !== levelId) });
}

/** Fresh native-staging review only. Final visibility release/background/history installation is a later step. */
export async function reviewRecoveryImportStaging(scene, options = {}) {
	options = { ...options };
	const inspected = await inspectRecoveryImport(scene, options);
	if (inspected.review.state !== 'all-assets-verified' || inspected.intent.phase !== 'assets-verified') {
		fail('Fresh complete evidence and an assets-verified journal are required; partial intent must be reconciled first.');
	}
	const { intent, evidence } = inspected, snapshot = canonicalJson(scene.toObject());
	const drawings = reconstructRecoveryProjectDrawings(evidence.manifest.project, evidence.manifest.authors)
		.map(source => staged(source, intent.token));
	const tiles = evidence.manifest.tiles.map(source => staged(source, intent.token));
	const artwork = [...drawings, ...tiles];
	for (const file of evidence.recoveryFiles.filter(file => file.reference.path.endsWith('.json'))) {
		const { payload } = await readOptimizationArchive(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes));
		artwork.push(...payload.originals);
		if (payload.replacement.type !== 'LevelBackground') artwork.push(payload.replacement.after);
	}
	const modules = [...new Set(artwork.flatMap(source => Object.keys(source.flags ?? {}))
		.filter(namespace => !['foundryshop', 'core'].includes(namespace)))];
	const check = () => {
		if (!game.user?.isGM || game.user.id !== intent.ownerId || game.users?.activeGM?.id !== intent.ownerId
			|| !game.user.can('FILES_BROWSE') || game.scenes?.get(scene.id) !== scene
			|| !scene.canUserModify(game.user, 'update') || options.signal?.aborted || !options.isCurrent()
			|| canonicalJson(scene.toObject()) !== snapshot) fail('Native staging review context changed.');
	};
	check();
	return { review: { token: intent.token, planDigest: intent.planDigest,
		drawingIds: drawings.map(source => source._id), tileIds: tiles.map(source => source._id),
		disclosure: 'Install only this hidden Drawing tree and hidden native staging documents. No native visibility release, background replacement or optimization-history installation is authorized by this step. Uncertain writes retain intent, files and staged documents for reconciliation.' },
		approve({ token, planDigest, stageHidden } = {}) {
			check();
			if (token !== intent.token || planDigest !== intent.planDigest || stageHidden !== true) fail('Explicit exact-plan hidden staging approval is required.');
			const capability = Object.freeze({ token, planDigest });
			approvals.set(capability, { scene, intent, drawings, tiles, evidence, modules, options, check,
				baseline: recoveryImportUnrelatedContext(scene, intent.levelId), consumed: false });
			return capability;
		} };
}

export class InterruptedRecoveryImportStagingError extends Error {
	constructor(sceneId, token, cause) {
		super(`Recovery import staging stopped for ${sceneId}/${token}: ${cause.message}. Retain journal, files and any hidden documents; reconcile before retrying. Final visibility/background were not released by this stage.`, { cause });
		this.name = 'InterruptedRecoveryImportStagingError'; this.sceneId = sceneId; this.token = token;
	}
}

/** No automatic cleanup of partial/uncertain writes; only exact expected states permit phase progression. */
export function stageRecoveryImport(scene, capability) {
	return runLayerOperation(scene, async () => {
		const approval = approvals.get(capability);
		if (!approval || approval.scene !== scene || approval.consumed) fail('Fresh hidden-staging approval is required.');
		approval.check(); approval.consumed = true;
		let expected = approval.intent, treeInstalled = false, createdDrawings = false, createdTiles = false;
		const check = () => {
			const { options } = approval;
			if (!game.user?.isGM || game.user.id !== expected.ownerId || game.users?.activeGM?.id !== expected.ownerId
				|| !game.user.can('FILES_BROWSE') || game.scenes?.get(scene.id) !== scene
				|| !scene.canUserModify(game.user, 'update') || options.signal?.aborted || !options.isCurrent()
				|| !same(scene.getFlag('foundryshop', 'projectImportJournal'), expected)
				|| recoveryImportUnrelatedContext(scene, expected.levelId) !== approval.baseline
				|| !same(scene.levels.get(expected.levelId)?.toObject(), expected.before.level)
				|| scene.getFlag('foundryshop', 'optimizationJournal') !== undefined
				|| !same(scene.getFlag('foundryshop', 'layers') ?? { version: 1, revision: 0, nodes: [], presets: [] },
					treeInstalled ? expected.after.layers : expected.before.layers)
				|| !same(sources(scene.drawings), createdDrawings ? [...approval.drawings].sort((a, b) => a._id.localeCompare(b._id)) : [])
				|| !same(sources(scene.tiles), createdTiles ? [...approval.tiles].sort((a, b) => a._id.localeCompare(b._id)) : [])) {
				fail('Native staging journal, owned state or unrelated destination context changed.');
			}
			const fonts = new Set(availableProjectFonts());
			if (approval.evidence.manifest.resources.fonts.some(font => !fonts.has(font))
				|| approval.modules.some(module => !game.modules.get(module)?.active)) fail('Historical fonts/modules changed.');
			return true;
		};
		const advance = async phase => {
			check();
			const next = validateRecoveryImportIntent({ ...expected, phase }, scene.id);
			try {
				await scene.update({ 'flags.foundryshop.projectImportJournal': next }, { diff: false, [LAYER_OPERATION]: true });
				expected = next; check();
			} catch (error) { throw new UnverifiedRecoveryImportIntentError(scene.id, expected.token, error, phase); }
		};
		try {
			check();
			// Byte evidence is fresh again immediately before any native write.
			for (const reference of [expected.bundle, ...expected.uploads]) {
				await readVerifiedFile(reference, { ...approval.options, isCurrent: check });
				check();
			}
			await scene.update({ 'flags.foundryshop.layers': expected.after.layers }, { diff: false, [LAYER_OPERATION]: true });
			treeInstalled = true; check();
			await advance('tree-installed');
			for (const [type, data] of [['Drawing', approval.drawings], ['Tile', approval.tiles]]) {
				check();
				if (data.length) {
					const options = { keepId: true, [LAYER_OPERATION]: true };
					const revoke = authorizeRecoveryImportCreates(options, scene, expected, data);
					try { await scene.createEmbeddedDocuments(type, structuredClone(data), options); }
					finally { revoke(); }
				}
				if (type === 'Drawing') createdDrawings = true;
				else createdTiles = true;
				check();
			}
			await advance('native-staged');
			return structuredClone(expected);
		} catch (error) { throw new InterruptedRecoveryImportStagingError(scene.id, expected.token, error); }
	});
}
