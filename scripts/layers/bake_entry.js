import { prepareReviewedTileBake, prepareReviewedBackgroundBake, prepareReviewedConsolidation } from './bake_workflow.js';
import { createBakeReviewDialogs, BakeReviewCancelledError } from './bake_dialogs.js';
import { beginOptimizationOperation, readOptimizationJournal, takeOverOptimizationOperation } from './optimization_journal.js';
import { promptTileBakeOptions } from './bake_options.js';
import { canonicalJson } from './project_package.js';
import { captureOptimizationExecutionContext, reviewOptimizationExecution } from './optimization_execution_review.js';
import { inspectOptimizationRecovery, readStoredOptimizationArchive } from './optimization_recovery.js';
import { inspectJournaledOptimization } from './optimization_reconciliation.js';
import { readVerifiedFile } from '../verified_file_storage.js';
import { inspectOptimizationImage, optimizationOutputVerifier } from '../optimization_media.js';
import { prepareOptimizationPlacement } from './optimization_placement.js';
import { verifyBakeTileDisplay, verifyBakeBackgroundDisplay, verifyConsolidationDisplay } from '../bake_display.js';
import { resumeOptimizationOperation } from './optimization_executor.js';
import { assertOptimizationNativeSchemas, optimizationNativeVerifier } from './optimization_native.js';
import { monitorOptimizationConflicts } from './optimization_conflict_monitor.js';
import { loadBakeImage } from '../bake_resources.js';
import { effectiveLayerGate } from './layer_tree_store.js';
import { verifyConsolidationLineage } from './consolidation_placement.js';

const active = new Set();
const loc = key => game.i18n.localize(`FOUNDRYSHOP.Bake.${key}`);
const fmt = (key, data) => game.i18n.format(`FOUNDRYSHOP.Bake.${key}`, data);
const replacementBounds = (scene, replacement) => replacement.type === 'LevelBackground'
	? scene.getDimensions().sceneRect : replacement.type === 'Drawing'
		? { x: replacement.after.x, y: replacement.after.y,
			width: replacement.after.shape.width, height: replacement.after.shape.height } : replacement.after;

async function verifiedRecoveryOutput(reference, replacement, bounds, options) {
	const bytes = await readVerifiedFile(reference, options), header = inspectOptimizationImage(bytes);
	// Portable backgrounds keep their original bytes while native Scene mapping is rebound.
	const size = replacement.type === 'LevelBackground' ? header : bounds;
	const verifyOutput = optimizationOutputVerifier(reference, size, options);
	await verifyOutput(bytes, reference);
	return { bytes, header, verifyOutput, width: size.width, height: size.height };
}

async function verifyOriginalBackground(payload, options) {
	if (!payload.originalBackground) return;
	const image = await loadBakeImage(payload.originalBackground.src, options);
	try {
		const file = payload.originalBackground.file;
		if (image.fingerprint !== file.fingerprint || image.bytes !== file.bytes) {
			throw new Error(loc('BackgroundOriginalChanged'));
		}
	} finally { image.destroy(); }
}

/** Explicit opt-in command; it is not registered on the toolbar or invoked by module startup. */
export async function promptReviewedTileBake(scene, options = {}, dependencies = {}) {
	return promptReviewedBake(scene, options, dependencies, 'Tile');
}

/** Explicit advanced command. Scope must be supplied; background output is always public and full Scene. */
export async function promptReviewedBackgroundBake(scene, options = {}, dependencies = {}) {
	return promptReviewedBake(scene, options, dependencies, 'LevelBackground');
}

export async function promptReviewedConsolidation(scene, options = {}, dependencies = {}) {
	return promptReviewedBake(scene, options, dependencies, 'Drawing');
}

async function promptReviewedBake(scene, options, { reviewDialogs }, replacementType) {
	options = { ...options };
	if (replacementType === 'LevelBackground'
		&& (options.audience !== 'player' || options.sort !== undefined || options.replacementId !== undefined
			|| options.bounds !== undefined)) throw new Error(loc('BackgroundOptionsInvalid'));
	if (replacementType === 'Drawing' && (!['gm', 'player'].includes(options.audience)
		|| !['selection', 'layer'].includes(options.kind) || options.sort !== undefined || options.bounds !== undefined)) {
		throw new Error(loc('ConsolidationOptionsInvalid'));
	}
	const levelId = options.levelId ?? canvas.level?.id, owner = game.user?.id;
	let conflictMonitor;
	const context = () => game.user?.isGM && game.user.id === owner && game.users?.activeGM?.id === owner
		&& canvas.ready && canvas.scene === scene && canvas.level?.id === levelId
		&& !options.signal?.aborted && (options.isCurrent === undefined || options.isCurrent())
		&& (!conflictMonitor || conflictMonitor.assertCurrent());
	if (options.isCurrent !== undefined && typeof options.isCurrent !== 'function'
		|| !context()) throw new Error(loc('Changed'));
	if (active.has(scene)) throw new Error(loc('EntryBusy'));
	const token = options.token ?? foundry.utils.randomID();
	const replacementId = replacementType !== 'LevelBackground' ? options.replacementId ?? foundry.utils.randomID() : undefined;
	if (readOptimizationJournal(scene).entries.some(entry => entry.token === token)) {
		throw new Error(loc('EntryTokenUsed'));
	}
	active.add(scene);
	let stage = 'preparation';
	try {
		const baseline = readOptimizationJournal(scene);
		conflictMonitor = monitorOptimizationConflicts(scene, {
			baseline, allowedTokens: [token], ownerTransfers: { [token]: owner },
		});
		if (replacementType === 'Tile' && (options.audience === undefined || options.sort === undefined)) {
			stage = 'options';
			const readSelection = options.readSelection ?? (() => canvas.drawings.controlled.map(drawing => drawing.document.id));
			const chosen = await promptTileBakeOptions(scene, { levelId, isCurrent: context, signal: options.signal, readSelection });
			options = { ...options, ...chosen, readSelection };
			stage = 'preparation';
		}
		if (options.kind === 'selection' && options.readSelection === undefined) {
			options.readSelection = () => canvas.drawings.controlled.map(drawing => drawing.document.id);
		}
		const dialogs = reviewDialogs ?? createBakeReviewDialogs({ isCurrent: context, signal: options.signal });
		for (const callback of ['approveScope', 'approveRender', 'approvePlacement', 'approvePreview',
			'approvePersistence', 'approveExecution']) {
			if (typeof dialogs[callback] !== 'function') throw new Error(loc('EntryDialogsInvalid'));
		}
		const prepare = { Tile: prepareReviewedTileBake, LevelBackground: prepareReviewedBackgroundBake,
			Drawing: prepareReviewedConsolidation }[replacementType];
		const workflow = await prepare(scene, {
			...options, token, replacementId, levelId, isCurrent: context,
			approveScope: review => dialogs.approveScope(review),
			approveRender: review => dialogs.approveRender(review),
			approvePlacement: review => dialogs.approvePlacement(review),
			approvePreview: (blob, review) => dialogs.approvePreview(blob, review),
		});
		stage = 'persistence';
		const fileDecision = await dialogs.approvePersistence(structuredClone(workflow.review));
		await workflow.persistAssets(fileDecision);
		stage = 'execution';
		const journal = await workflow.apply({ approveExecution: review => dialogs.approveExecution(review) });
		ui.notifications.info(fmt(replacementType === 'Drawing' ? 'ConsolidationComplete' : 'EntryComplete', { token }));
		return { status: 'complete', token, sceneId: scene.id, journal };
	} catch (error) {
		if (!(error instanceof BakeReviewCancelledError)) throw error;
		const entry = readOptimizationJournal(scene).entries.find(item => item.token === token);
		const recovery = entry ? structuredClone(entry) : null;
		ui.notifications.warn(recovery
			? fmt('EntryCancelledRetained', { token, phase: recovery.phase })
			: loc('EntryCancelledBeforeWrites'));
		return { status: 'cancelled', token, sceneId: scene.id, stage, recovery };
	} finally { conflictMonitor?.close(); active.delete(scene); }
}

/** Reload-safe resume of one existing Tile apply/restore intent; no uploads or new intent creation. */
export async function promptResumeTileBake(scene, token, options = {}, dependencies = {}) {
	return promptResumeBake(scene, token, options, dependencies, 'Tile');
}

export async function promptResumeBackgroundBake(scene, token, options = {}, dependencies = {}) {
	return promptResumeBake(scene, token, options, dependencies, 'LevelBackground');
}

export async function promptResumeConsolidation(scene, token, options = {}, dependencies = {}) {
	return promptResumeBake(scene, token, options, dependencies, 'Drawing');
}

async function promptResumeBake(scene, token, options, { reviewDialogs }, replacementType) {
	options = { ...options };
	const journal = readOptimizationJournal(scene), entry = journal.entries.at(-1);
	if (!entry || entry.token !== token || entry.phase === 'complete' || entry.replacement.type !== replacementType) {
		throw new Error(loc('ResumeInvalid'));
	}

	if (options.isCurrent !== undefined && typeof options.isCurrent !== 'function'
		|| options.verifyDisplay !== undefined && typeof options.verifyDisplay !== 'function') {
		throw new Error(loc('Changed'));
	}
	const owner = game.user?.id, levelId = entry.levelId;
	let conflictMonitor;
	const context = () => {
		if (!game.user?.isGM || game.user.id !== owner || entry.ownerId !== owner || game.users?.activeGM?.id !== owner
			|| !canvas.ready || canvas.scene !== scene || canvas.level?.id !== levelId
			|| game.scenes?.get(scene.id) !== scene || !scene.canUserModify(game.user, 'update')
			|| options.signal?.aborted || options.isCurrent && !options.isCurrent()) throw new Error(loc('Changed'));
		conflictMonitor?.assertCurrent();
		return true;
	};
	context();
	if (active.has(scene)) throw new Error(loc('EntryBusy'));
	active.add(scene);
	let stage = 'evidence';
	try {
		conflictMonitor = monitorOptimizationConflicts(scene, { baseline: journal });
		const baseline = captureOptimizationExecutionContext(scene, levelId);
		const strict = () => {
			context();
			if (canonicalJson(readOptimizationJournal(scene)) !== canonicalJson(journal)
				|| captureOptimizationExecutionContext(scene, levelId) !== baseline) throw new Error(loc('ResumeStale'));
			return true;
		};
		let current = strict;
		const check = () => current();
		const readOptions = { isCurrent: strict, signal: options.signal, timeout: options.timeout ?? 30000 };
		const archive = await readStoredOptimizationArchive(entry.archive, readOptions);
		const replacement = archive.payload.replacement;
		if (replacement.type !== replacementType) throw new Error(loc('ResumeInvalid'));
		await verifyConsolidationLineage(scene, levelId, archive.payload.parent, readOptions);
		if (entry.action === 'restore') await verifyOriginalBackground(archive.payload, {
			...readOptions, acknowledgeExternal: options.acknowledgeExternal === true,
		});
		const mappedBounds = replacementBounds(scene, replacement);
		const bounds = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, mappedBounds[key]]));
		const { width, height, bytes, header, verifyOutput } = await verifiedRecoveryOutput(entry.asset, replacement,
			bounds, { ...readOptions, isCurrent: check });
		const blob = new Blob([bytes], { type: header.mime });
		const execution = await reviewOptimizationExecution(scene, token, {
			...readOptions, isCurrent: context, verifyOutput, readSelection: options.readSelection,
		});
		strict();
		const dialogs = reviewDialogs ?? createBakeReviewDialogs({ isCurrent: check, signal: options.signal });
		for (const callback of ['approvePreview', 'approvePlacement', 'approveExecution']) {
			if (typeof dialogs[callback] !== 'function') throw new Error(loc('EntryDialogsInvalid'));
		}
		stage = 'preview';
		if (await dialogs.approvePreview(blob, { token, sceneId: scene.id, levelId,
			render: { width, height, bounds: structuredClone(bounds), format: header.extension } }) !== true) {
			throw new BakeReviewCancelledError();
		}
		strict();
		stage = 'placement';
		const placement = await prepareOptimizationPlacement(scene, archive.text, {
			action: entry.action, bounds, audience: replacement.type !== 'LevelBackground'
				&& (replacement.after.hidden || replacement.type === 'Drawing'
					&& !archive.payload.originals.every(source => {
						const layerId = source.flags.foundryshop?.layerId;
						return !layerId || effectiveLayerGate(archive.payload.context.layers, layerId, node => node.playerAllowed);
					})) ? 'gm' : 'player', isCurrent: check,
		});
		const placementDecision = await dialogs.approvePlacement(structuredClone(placement.review));
		strict();
		const acceptedPlacement = placement.approve(placementDecision);
		const display = { Tile: verifyBakeTileDisplay, LevelBackground: verifyBakeBackgroundDisplay,
			Drawing: verifyConsolidationDisplay }[replacementType];
		const verifyDisplay = options.verifyDisplay ?? (input => display(input,
			{ isCurrent: check, signal: options.signal }));
		const verifyNative = await optimizationNativeVerifier(scene, archive.text, {
			isCurrent: check, verifyPlacement: async (payload, operation) => {
				await acceptedPlacement(payload);
				await verifyConsolidationLineage(scene, levelId, payload.parent,
					{ isCurrent: check, signal: options.signal, timeout: options.timeout ?? 30000 });
				if (operation.action === 'restore' && operation.phase === 'originals-staged') {
					await verifyOriginalBackground(payload, { isCurrent: check, signal: options.signal,
						timeout: options.timeout ?? 30000, acknowledgeExternal: options.acknowledgeExternal === true });
				}
				// Restore removes the replacement; GPU inability must not block exact original recovery.
				if (operation.action === 'apply' && await verifyDisplay({
					blob, output: structuredClone(entry.asset), replacement: structuredClone(payload.replacement),
					width, height, operation,
				}) !== true) throw new Error(loc('ResumeDisplayFailed'));
				check();
				return true;
			},
		});
		stage = 'execution';
		const decision = await dialogs.approveExecution(structuredClone(execution.review));
		strict();
		const approvedExecution = execution.approve(decision);
		current = approvedExecution.assertCurrent;
		const result = await resumeOptimizationOperation(scene, token, {
			isCurrent: context, approvedExecution, verifyNative, verifyOutput,
			signal: options.signal, timeout: options.timeout ?? 30000,
		});
		ui.notifications.info(fmt('ResumeComplete', { token, action: entry.action }));
		return { status: 'complete', token, sceneId: scene.id, journal: result };
	} catch (error) {
		if (!(error instanceof BakeReviewCancelledError)) throw error;
		const recovery = structuredClone(readOptimizationJournal(scene).entries.find(item => item.token === token));
		ui.notifications.warn(fmt('EntryCancelledRetained', { token, phase: recovery.phase }));
		return { status: 'cancelled', token, sceneId: scene.id, stage, recovery };
	} finally { conflictMonitor?.close(); active.delete(scene); }
}

/** Explicitly transfers an interrupted Tile operation from a disconnected GM, then runs ordinary resume review. */
export async function promptTakeOverTileBake(scene, token, options = {}, dependencies = {}) {
	return promptTakeOverBake(scene, token, options, dependencies, 'Tile');
}

export async function promptTakeOverBackgroundBake(scene, token, options = {}, dependencies = {}) {
	return promptTakeOverBake(scene, token, options, dependencies, 'LevelBackground');
}

export async function promptTakeOverConsolidation(scene, token, options = {}, dependencies = {}) {
	return promptTakeOverBake(scene, token, options, dependencies, 'Drawing');
}

async function promptTakeOverBake(scene, token, options, { reviewDialogs }, replacementType) {
	options = { ...options };
	const baseline = readOptimizationJournal(scene), entry = baseline.entries.at(-1);
	if (!entry || entry.token !== token || entry.phase === 'complete' || entry.replacement.type !== replacementType) {
		throw new Error(loc('ResumeInvalid'));
	}
	const owner = game.user?.id, previousOwner = entry.ownerId, levelId = entry.levelId;
	let conflictMonitor;
	const context = () => {
		const formerOwner = game.users?.get?.(previousOwner);
		if (!game.user?.isGM || !owner || owner === previousOwner || game.users?.activeGM?.id !== owner
			|| !formerOwner || formerOwner.active !== false || !canvas.ready || canvas.scene !== scene
			|| canvas.level?.id !== levelId || game.scenes?.get(scene.id) !== scene
			|| !scene.canUserModify(game.user, 'update') || options.signal?.aborted
			|| options.isCurrent && !options.isCurrent()) throw new Error(loc('TakeoverUnavailable'));
		conflictMonitor?.assertCurrent();
		return true;
	};
	if (options.isCurrent !== undefined && typeof options.isCurrent !== 'function'
		|| options.verifyDisplay !== undefined && typeof options.verifyDisplay !== 'function') {
		throw new Error(loc('Changed'));
	}
	context();
	if (active.has(scene)) throw new Error(loc('EntryBusy'));
	active.add(scene);
	try {
		conflictMonitor = monitorOptimizationConflicts(scene, {
			baseline, ownerTransfers: { [token]: [previousOwner, owner] },
		});
		const dialogs = reviewDialogs ?? createBakeReviewDialogs({ isCurrent: context, signal: options.signal });
		for (const callback of ['approveTakeover', 'approvePreview', 'approvePlacement', 'approveExecution']) {
			if (typeof dialogs[callback] !== 'function') throw new Error(loc('EntryDialogsInvalid'));
		}
		const recoveryContext = captureOptimizationExecutionContext(scene, levelId);
		let acceptedJournal = null;
		const strict = () => {
			context();
			const current = readOptimizationJournal(scene);
			if ((canonicalJson(current) !== canonicalJson(baseline)
				&& (!acceptedJournal || canonicalJson(current) !== canonicalJson(acceptedJournal)))
				|| captureOptimizationExecutionContext(scene, levelId) !== recoveryContext) {
				throw new Error(loc('ResumeStale'));
			}
			return true;
		};
		const timeout = options.timeout ?? 30000, readOptions = { isCurrent: strict, signal: options.signal, timeout };
		const archive = await readStoredOptimizationArchive(entry.archive, readOptions);
		if (archive.payload.replacement.type !== replacementType
			|| archive.payload.id !== (entry.action === 'apply' ? entry.token : entry.parentToken)) {
			throw new Error(loc('ResumeInvalid'));
		}
		assertOptimizationNativeSchemas(scene, archive.payload);
		await verifyConsolidationLineage(scene, levelId, archive.payload.parent, readOptions);
		const { verifyOutput } = await verifiedRecoveryOutput(entry.asset, archive.payload.replacement,
			replacementBounds(scene, archive.payload.replacement), readOptions);
		const evidence = await inspectJournaledOptimization(scene, token, { ...readOptions, verifyOutput });
		strict();
		if (evidence.verifiedFiles !== true || evidence.outputAccepted !== true) {
			throw new Error(loc('TakeoverEvidenceFailed'));
		}
		const decision = await dialogs.approveTakeover({
			token, action: entry.action, phase: entry.phase, previousOwner,
			sourceIds: archive.payload.originals.map(source => source._id).sort(),
			sceneId: scene.id, levelId,
		});
		strict();
		if (decision !== true) throw new BakeReviewCancelledError();
		acceptedJournal = {
			...baseline, revision: baseline.revision + 1,
			entries: baseline.entries.map(item => item.token === token ? { ...item, ownerId: owner } : item),
		};
		const transferred = await takeOverOptimizationOperation(scene, baseline, token, {
			isCurrent: strict,
			verifyRecovery: async candidate => {
				strict();
				if (canonicalJson(candidate) !== canonicalJson(entry)) {
					throw new Error(loc('TakeoverStale'));
				}
				const latest = await inspectJournaledOptimization(scene, token, { ...readOptions, verifyOutput });
				strict();
				if (latest.verifiedFiles !== true || latest.outputAccepted !== true) {
					throw new Error(loc('TakeoverEvidenceFailed'));
				}
				return true;
			},
		});
		if (canonicalJson(transferred) !== canonicalJson(acceptedJournal)) throw new Error(loc('TakeoverStale'));
		active.delete(scene);
		const result = await promptResumeBake(scene, token, options, { reviewDialogs: dialogs }, replacementType);
		return { ...result, ownershipTransferred: true, previousOwner };
	} catch (error) {
		if (!(error instanceof BakeReviewCancelledError)) throw error;
		ui.notifications.warn(loc('TakeoverCancelled'));
		return { status: 'cancelled', token, sceneId: scene.id, stage: 'takeover', recovery: null,
			ownershipTransferred: false };
	} finally { conflictMonitor?.close(); active.delete(scene); }
}

/** Creates a separate restore intent for the latest completed Tile apply, then uses normal reload resume. */
export async function promptRestoreTileBake(scene, parentToken, options = {}, dependencies = {}) {
	return promptRestoreBake(scene, parentToken, options, dependencies, 'Tile');
}

export async function promptRestoreBackgroundBake(scene, parentToken, options = {}, dependencies = {}) {
	return promptRestoreBake(scene, parentToken, options, dependencies, 'LevelBackground');
}

export async function promptRestoreConsolidation(scene, parentToken, options = {}, dependencies = {}) {
	return promptRestoreBake(scene, parentToken, options, dependencies, 'Drawing');
}

async function promptRestoreBake(scene, parentToken, options, { reviewDialogs }, replacementType) {
	options = { ...options };
	const baseline = readOptimizationJournal(scene), parent = replacementType === 'Drawing'
		? baseline.entries.find(entry => entry.token === parentToken) : baseline.entries.at(-1);
	if (!parent || parent.token !== parentToken || parent.action !== 'apply' || parent.phase !== 'complete'
		|| parent.replacement.type !== replacementType
		|| baseline.entries.some(entry => entry.phase !== 'complete')
		|| baseline.entries.some(entry => entry.action === 'restore' && entry.parentToken === parentToken)) {
		throw new Error(loc('RestoreInvalid'));
	}
	const owner = game.user?.id, levelId = parent.levelId;
	let conflictMonitor;
	const context = () => {
		if (!game.user?.isGM || game.user.id !== owner || game.users?.activeGM?.id !== owner
			|| !canvas.ready || canvas.scene !== scene || canvas.level?.id !== levelId
			|| game.scenes?.get(scene.id) !== scene || !scene.canUserModify(game.user, 'update')
			|| options.signal?.aborted || options.isCurrent && !options.isCurrent()) throw new Error(loc('Changed'));
		conflictMonitor?.assertCurrent();
		return true;
	};
	if (options.isCurrent !== undefined && typeof options.isCurrent !== 'function') throw new Error(loc('Changed'));
	context();
	if (active.has(scene)) throw new Error(loc('EntryBusy'));
	const token = options.token ?? foundry.utils.randomID();
	if (baseline.entries.some(entry => entry.token === token)) throw new Error(loc('EntryTokenUsed'));
	active.add(scene);
	try {
		conflictMonitor = monitorOptimizationConflicts(scene, {
			baseline, allowedTokens: [token], ownerTransfers: { [token]: owner },
		});
		const dialogs = reviewDialogs ?? createBakeReviewDialogs({ isCurrent: context, signal: options.signal });
		if (typeof dialogs.approveRestoreIntent !== 'function'
			|| typeof dialogs.approvePreview !== 'function' || typeof dialogs.approvePlacement !== 'function'
			|| typeof dialogs.approveExecution !== 'function') throw new Error(loc('EntryDialogsInvalid'));
		const recoveryContext = captureOptimizationExecutionContext(scene, levelId);
		let acceptedIntent = null;
		const strict = () => {
			context();
			const currentJournal = readOptimizationJournal(scene);
			if ((canonicalJson(currentJournal) !== canonicalJson(baseline)
				&& (!acceptedIntent || canonicalJson(currentJournal) !== canonicalJson(acceptedIntent)))
				|| captureOptimizationExecutionContext(scene, levelId) !== recoveryContext) {
				throw new Error(loc('ResumeStale'));
			}
			return true;
		};
		const timeout = options.timeout ?? 30000, readOptions = { isCurrent: strict, signal: options.signal, timeout };
		const archive = await readStoredOptimizationArchive(parent.archive, readOptions);
		if (archive.payload.id !== parent.token || archive.payload.replacement.type !== replacementType) throw new Error(loc('RestoreInvalid'));
		await verifyConsolidationLineage(scene, levelId, archive.payload.parent, readOptions);
		await verifyOriginalBackground(archive.payload, {
			...readOptions, acknowledgeExternal: options.acknowledgeExternal === true,
		});
		assertOptimizationNativeSchemas(scene, archive.payload);
		await verifiedRecoveryOutput(parent.asset, archive.payload.replacement,
			replacementBounds(scene, archive.payload.replacement), readOptions);
		const inspected = await inspectOptimizationRecovery(scene, archive.text, { allowLayerRevisionChange: true });
		strict();
		const sourceIds = archive.payload.originals.map(source => source._id).sort();
		if (inspected.originals.present.length || canonicalJson([...inspected.originals.missing].sort())
			!== canonicalJson(sourceIds) || inspected.replacementState !== 'after') throw new Error(loc('RestoreConflict'));
		const decision = await dialogs.approveRestoreIntent({ token: parentToken, restoreToken: token,
			sceneId: scene.id, levelId, sourceIds, output: structuredClone(parent.asset),
			layerRevisionChange: inspected.layerRevisionChange });
		strict();
		if (decision !== true) throw new BakeReviewCancelledError();
		const intent = { ...parent, token, ownerId: owner, action: 'restore', phase: 'intent', parentToken };
		acceptedIntent = { ...baseline, revision: baseline.revision + 1, entries: [...baseline.entries, intent] };
		await beginOptimizationOperation(scene, baseline, intent, {
			isCurrent: strict,
			verifyIntent: async candidate => {
				strict();
				if (canonicalJson(candidate) !== canonicalJson(intent)) throw new Error(loc('RestoreInvalid'));
				assertOptimizationNativeSchemas(scene, archive.payload);
				const latest = await inspectOptimizationRecovery(scene, archive.text, { allowLayerRevisionChange: true });
				strict();
				if (latest.originals.present.length
					|| canonicalJson([...latest.originals.missing].sort()) !== canonicalJson(sourceIds)
					|| latest.replacementState !== 'after') throw new Error(loc('RestoreConflict'));
				return true;
			},
		});
		strict();
		active.delete(scene);
		const result = await promptResumeBake(scene, token, options, { reviewDialogs: dialogs }, replacementType);
		return { ...result, parentToken };
	} catch (error) {
		if (!(error instanceof BakeReviewCancelledError)) throw error;
		ui.notifications.warn(loc('RestoreIntentCancelled'));
		return { status: 'cancelled', token, parentToken, sceneId: scene.id, stage: 'restore-intent',
			recovery: null };
	} finally { conflictMonitor?.close(); active.delete(scene); }
}
