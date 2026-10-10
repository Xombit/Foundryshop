import { MODULE } from '../constants.js';
import { canonicalJson } from './project_package.js';
import { runLayerOperation, LAYER_OPERATION } from './layer_manager.js';
import { validateLayerTree, emptyLayerTree, lockedLayerIds } from './layer_tree_store.js';
import { readOptimizationJournal, advanceOptimizationOperation } from './optimization_journal.js';
import { readStoredOptimizationArchive } from './optimization_recovery.js';
import { inspectJournaledOptimization, verifyJournaledOptimizationPhase } from './optimization_reconciliation.js';
import { optimizationSceneGrid } from './optimization_scene_data.js';

const running = new Set();
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const steps = {
	apply: ['intent', 'assets-verified', 'replacement-staged', 'sources-removed', 'complete'],
	restore: ['intent', 'assets-verified', 'originals-staged', 'replacement-reverted', 'complete'],
};

/** A native write may have partially succeeded. Keep the journal and re-inspect instead of compensating blindly. */
export class InterruptedOptimizationError extends Error {
	constructor(sceneId, token, cause) {
		super(`Optimization ${sceneId}/${token} stopped: ${cause.message}. Recovery records are retained; inspect and resume before retrying.`, { cause });
		this.name = 'InterruptedOptimizationError';
		this.sceneId = sceneId;
		this.token = token;
	}
}

function checkAuthority(scene, journal, entry, options) {
	if (!game.user?.isGM || game.users?.activeGM?.id !== game.user.id || entry.ownerId !== game.user.id
		|| game.scenes?.get(scene.id) !== scene || !scene.canUserModify(game.user, 'update')
		|| !scene.levels?.has(entry.levelId) || scene.getFlag(MODULE, 'projectImportJournal')) {
		throw new Error('Optimization native write authority/Scene/Level changed.');
	}
	if (options.signal?.aborted || !options.isCurrent() || !same(readOptimizationJournal(scene), journal)) {
		throw new Error('Optimization native write journal/context changed or was cancelled.');
	}
}

function nativeSnapshot(scene, payload) {
	const replacement = payload.replacement, collection = replacement.type === 'Drawing' ? scene.drawings : scene.tiles;
	return canonicalJson({
		width: scene.width, height: scene.height, padding: scene.padding, grid: optimizationSceneGrid(scene),
		layers: scene.getFlag(MODULE, 'layers') ?? emptyLayerTree(),
		level: scene.levels.get(payload.levelId)?.toObject(),
		originals: payload.originals.map(source => scene.drawings.get(source._id)?.toObject() ?? null),
		replacement: replacement.type === 'LevelBackground' ? null : collection.get(replacement.id)?.toObject() ?? null,
	});
}

function assertEditable(scene, payload) {
	const locked = lockedLayerIds(validateLayerTree(scene.getFlag(MODULE, 'layers') ?? emptyLayerTree()));
	if (payload.originals.some(source => locked.has(source.flags?.[MODULE]?.layerId))
		|| payload.replacement.type === 'Drawing'
			&& locked.has(payload.replacement.after.flags?.[MODULE]?.layerId)) {
		throw new Error('Unlock affected Drawing layers before optimization or recovery.');
	}
}

async function settleBackgroundRedraw(scene, payload, journal, entry, options) {
	const view = globalThis.canvas;
	if (view?.scene !== scene || typeof view.ready !== 'boolean') return;
	const native = nativeSnapshot(scene, payload), started = Date.now();
	while (!view.ready) {
		if (options.signal?.aborted || game.user?.id !== entry.ownerId || !game.user?.isGM
			|| game.users?.activeGM?.id !== entry.ownerId || game.scenes?.get(scene.id) !== scene
			|| !scene.canUserModify(game.user, 'update') || view !== globalThis.canvas || view.scene !== scene
			|| !same(readOptimizationJournal(scene), journal) || nativeSnapshot(scene, payload) !== native) {
			throw new Error('Background redraw authority/Scene/native state changed or was cancelled.');
		}
		if (Date.now() - started >= (options.timeout || 30000)) {
			throw new Error('Background redraw timed out; inspect and resume the retained operation.');
		}
		await new Promise(resolve => setTimeout(resolve, 25));
	}
	if (view.level?.id !== entry.levelId) throw new Error('Displayed Level changed during background redraw.');
	options.approvedExecution?.acceptBackgroundRedraw();
}

async function mutate(scene, token, phase, options, expected) {
	return runLayerOperation(scene, async () => {
		const journal = readOptimizationJournal(scene), entry = journal.entries.find(item => item.token === token);
		if (!entry || entry.phase !== phase || !same(journal, expected)) {
			throw new Error('Optimization journal/phase changed before native work.');
		}
		checkAuthority(scene, journal, entry, options);
		const check = () => { checkAuthority(scene, journal, entry, options); return true; };
		const { payload } = await readStoredOptimizationArchive(entry.archive, { ...options, isCurrent: check });
		const inspected = await inspectJournaledOptimization(scene, token, { ...options, isCurrent: check });
		check();
		assertEditable(scene, payload);
		const before = nativeSnapshot(scene, payload);
		if (await options.verifyNative(structuredClone(payload), { action: entry.action, phase }) !== true) {
			throw new Error('Native schema/placement/audience acceptance was not verified.');
		}
		check();
		if (before !== nativeSnapshot(scene, payload)) throw new Error('Native sources changed during acceptance checks.');
		const replacement = payload.replacement;
		const operation = { keepId: true, [LAYER_OPERATION]: true, foundryshopOptimization: token };
		const updateBackground = async state => {
			await scene.updateEmbeddedDocuments('Level', [{
				_id: replacement.id, background: structuredClone(state.background), textures: structuredClone(state.textures),
			}], { ...operation, diff: false, recursive: false });
			await settleBackgroundRedraw(scene, payload, journal, entry, options);
		};
		if (entry.action === 'apply') {
			if (phase === 'assets-verified') {
				if (inspected.requiresReplacementRecovery) throw new Error('Missing originals and replacement require explicit recovery review.');
				if (replacement.type === 'LevelBackground') {
					if (inspected.replacementState === 'before') await updateBackground(replacement.after);
				} else if (inspected.replacementState === 'absent') {
					await scene.createEmbeddedDocuments(replacement.type, [structuredClone(replacement.staged)], operation);
				}
			} else if (phase === 'replacement-staged') {
				if (!['staged', 'after'].includes(inspected.replacementState)) throw new Error('Verified replacement is missing before source removal.');
				if (inspected.originals.present.length) await scene.deleteEmbeddedDocuments('Drawing', inspected.originals.present, operation);
			} else if (phase === 'sources-removed') {
				if (inspected.originals.present.length) throw new Error('Source Drawings remain; final exposure refused.');
				if (replacement.type !== 'LevelBackground' && inspected.replacementState === 'staged') {
					await scene.updateEmbeddedDocuments(replacement.type, [{
						_id: replacement.id, hidden: replacement.after.hidden,
					}], operation);
				}
			}
		} else {
			if (phase === 'assets-verified') {
				if (inspected.requiresReplacementRecovery) throw new Error('Missing originals and replacement require explicit recovery review.');
				const missing = new Set(inspected.originals.missing);
				const sources = payload.originals.filter(source => missing.has(source._id))
					.map(source => ({ ...structuredClone(source), hidden: true }));
				if (sources.length) await scene.createEmbeddedDocuments('Drawing', sources, operation);
			} else if (phase === 'originals-staged') {
				if (inspected.originals.missing.length) throw new Error('Originals are incomplete; replacement removal refused.');
				if (replacement.type === 'LevelBackground') {
					if (inspected.replacementState === 'after') await updateBackground(replacement.before);
				} else if (['staged', 'after'].includes(inspected.replacementState)) {
					await scene.deleteEmbeddedDocuments(replacement.type, [replacement.id], operation);
				}
			} else if (phase === 'replacement-reverted') {
				if (inspected.originals.missing.length || !['before', 'absent'].includes(inspected.replacementState)) {
					throw new Error('Recovery replacement is not reverted; original exposure refused.');
				}
				const staged = new Set(inspected.stagedOriginalIds);
				const updates = payload.originals.filter(source => staged.has(source._id))
					.map(source => ({ _id: source._id, hidden: source.hidden }));
				if (updates.length) await scene.updateEmbeddedDocuments('Drawing', updates, operation);
			}
		}
		check();
	});
}

/** Executes an existing durable intent only. Upload preparation, authority routing and UI are separate. */
export async function resumeOptimizationOperation(scene, token, options = {}) {
	if (typeof options.isCurrent !== 'function' || typeof options.verifyOutput !== 'function'
		|| typeof options.verifyNative !== 'function') {
		throw new Error('Optimization execution requires reviewed-context, output-decode and native-acceptance guards.');
	}
	if (options.approvedExecution !== undefined) {
		const { approvedExecution, isCurrent } = options;
		if (!approvedExecution || typeof approvedExecution.assertOperation !== 'function' || typeof approvedExecution.assertCurrent !== 'function'
			|| approvedExecution.assertOperation(scene, token) !== true) {
			throw new Error('Optimization execution requires a matching real execution approval.');
		}
		options = { ...options, isCurrent: () => isCurrent() && approvedExecution.assertCurrent() };
	}
	if (running.has(scene.id)) throw new Error('An optimization executor is already running for this Scene.');
	running.add(scene.id);
	try {
		const initial = readOptimizationJournal(scene), entry = initial.entries.find(item => item.token === token);
		if (!entry) throw new Error('Optimization intent must be durably recorded before execution.');
		checkAuthority(scene, initial, entry, options);
		if (entry.phase === 'complete') {
			await verifyJournaledOptimizationPhase(scene, entry, options);
			return readOptimizationJournal(scene);
		}
		while (true) {
			const journal = readOptimizationJournal(scene), current = journal.entries.find(item => item.token === token);
			if (!current || !same({ ...current, phase: entry.phase }, entry)) {
				throw new Error('Optimization intent changed during execution.');
			}
			checkAuthority(scene, journal, current, options);
			if (current.phase === 'complete') return journal;
			if (current.phase !== 'intent') await mutate(scene, token, current.phase, options, journal);
			const nextPhase = steps[current.action][steps[current.action].indexOf(current.phase) + 1];
			await advanceOptimizationOperation(scene, journal, token, nextPhase, {
				isCurrent: () => !options.signal?.aborted && options.isCurrent(),
				verifyPhase: proposed => verifyJournaledOptimizationPhase(scene, proposed, options),
			});
		}
	} catch (error) { throw new InterruptedOptimizationError(scene.id, token, error); }
	finally { running.delete(scene.id); }
}
