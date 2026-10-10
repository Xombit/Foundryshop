import { inspectRecoveryImport, inspectCompletedRecoveryImport,
	inspectClearedCompensatedRecoveryImport } from './recovery_import_reconciliation.js';
import { stageRecoveryImport } from './recovery_import_execution.js';
import { compensateRecoveryImport } from './recovery_import_compensation.js';
import { finalizeRecoveryImport, resumeRecoveryImportFinalization } from './recovery_import_finalization.js';
import { promptRecoveryImportApproval, promptRecoveryImportReceiptPersistence,
	RecoveryImportReviewCancelledError } from './recovery_import_dialogs.js';
import { persistRecoveryImportReceipt, inspectStoredRecoveryImportReceipt,
	findStoredRecoveryImportReceipt, encodeRecoveryImportReceipt } from './recovery_import_receipt_storage.js';
import { retireCompensatedRecoveryImport } from './recovery_import_lifecycle.js';
import { canonicalJson } from './project_package.js';

const loc = key => game.i18n.localize(`FOUNDRYSHOP.RecoveryImport.${key}`);

export class InterruptedRecoveryImportActionError extends Error {
	constructor(sceneId, action, receipt, reference, cause) {
		super(`Recovery import action ${action} stopped for ${sceneId}: ${cause.message}. Retain all files and any journal or attached receipt/reference. Inspect before another explicit action; no automatic retry or compensation.`, { cause });
		this.name = 'InterruptedRecoveryImportActionError'; this.sceneId = sceneId; this.action = action;
		this.receipt = receipt === undefined ? undefined : structuredClone(receipt);
		this.reference = reference === undefined ? undefined : structuredClone(reference);
	}
}

/** Available actions are evidence-derived, not phase-only permissions. */
export async function reviewRecoveryImportActions(scene, options = {}) {
	options = { ...options };
	if (options.receipt !== undefined) options.receipt = structuredClone(options.receipt);
	if (options.retainedReceiptReference !== undefined) options.retainedReceiptReference = structuredClone(options.retainedReceiptReference);
	let inspected, receipt;
	if (scene.getFlag('foundryshop', 'projectImportJournal') !== undefined) {
		inspected = await inspectRecoveryImport(scene, options); receipt = inspected.intent;
	} else if (options.retainedReceiptReference !== undefined) {
		inspected = await inspectStoredRecoveryImportReceipt(scene, options.retainedReceiptReference, options);
		receipt = inspected.receipt;
	} else if (options.receipt !== undefined) {
		receipt = options.receipt;
		inspected = receipt.phase === 'complete' ? await inspectCompletedRecoveryImport(scene, receipt, options)
			: await inspectClearedCompensatedRecoveryImport(scene, receipt, options);
	} else throw new Error(loc('ActionEvidenceRequired'));
	const state = inspected.review.state, actions = ['inspect'];
	if (state === 'all-assets-verified' && receipt.phase === 'assets-verified') actions.push('stage');
	if (state === 'hidden-native-staging' && receipt.phase === 'native-staged') actions.push('finalize');
	if (['all-assets-verified', 'hidden-native-staging', 'compensation-in-progress'].includes(state)
		&& !inspected.review.missingPaths.length
		&& ['intent', 'assets-verified', 'tree-installed', 'native-staged', 'compensating'].includes(receipt.phase)) actions.push('compensate');
	if (state === 'native-release-in-progress') actions.push('resume');
	if (state === 'compensated-retained-evidence') actions.push('retire');
	if (['compensated-retained-evidence', 'completed-import', 'cleared-compensated-import'].includes(state)) actions.push('retain-receipt');
	const snapshot = canonicalJson(scene.toObject()), owner = game.user.id;
	const check = () => {
		if (!game.user?.isGM || game.user.id !== owner || game.users?.activeGM?.id !== owner
			|| options.signal?.aborted || !options.isCurrent() || game.scenes?.get(scene.id) !== scene
			|| canonicalJson(scene.toObject()) !== snapshot) throw new Error(loc('Changed'));
	};
	check();
	let consumed = false;
	return { review: { ...structuredClone(inspected.review), actions: [...actions] },
		async execute(action) {
			check();
			if (!actions.includes(action)) throw new Error(loc('InvalidAction'));
			if (action === 'inspect') return { status: 'inspected', review: structuredClone(inspected.review), receipt: structuredClone(receipt) };
			if (consumed) throw new Error(loc('ActionReviewConsumed'));
			// Fail before native changes if terminal receipt cannot fit the admitted retention budget.
			if (['finalize', 'resume', 'compensate'].includes(action)) {
				encodeRecoveryImportReceipt({ ...receipt, phase: action === 'compensate' ? 'compensated' : 'complete' }, options);
			}
			consumed = true;
			let result = receipt, reference = options.retainedReceiptReference;
			try {
				if (action === 'retire') {
					if (reference === undefined) {
						const found = await findStoredRecoveryImportReceipt(scene, receipt, options);
						if (found.status === 'verified') reference = found.reference;
					}
					return await retireCompensatedRecoveryImport(scene, { ...options, retainedReceiptReference: reference });
				}
				if (action !== 'retain-receipt') {
					const capability = await promptRecoveryImportApproval(scene, action, options);
					check();
					const operations = { stage: stageRecoveryImport, finalize: finalizeRecoveryImport,
						resume: resumeRecoveryImportFinalization, compensate: compensateRecoveryImport };
					result = await operations[action](scene, capability);
					if (action === 'stage') return { status: 'hidden-native-staged', receipt: result };
				}
				const stored = reference === undefined ? await findStoredRecoveryImportReceipt(scene, result, options)
					: await inspectStoredRecoveryImportReceipt(scene, reference, options);
				if (stored.status !== 'not-found') {
					if (canonicalJson(stored.receipt) !== canonicalJson(result)) throw new Error('Stored receipt differs from action result.');
					return { status: 'receipt-retained', receipt: result, reference: stored.reference };
				}
				const capability = await promptRecoveryImportReceiptPersistence(scene, result, options),
					persisted = await persistRecoveryImportReceipt(scene, capability);
				return { status: 'receipt-retained', ...persisted };
			} catch (error) {
				throw new InterruptedRecoveryImportActionError(scene.id, action, error.receipt ?? result,
					error.reference ?? reference, error);
			}
		} };
}

/** One selected action per fresh inspection; each write still has its own independent approval. */
export async function promptRecoveryImportActions(scene, options = {}) {
	const reviewed = await reviewRecoveryImportActions(scene, options), content = document.createElement('div'),
		label = document.createElement('label'), caption = document.createElement('span'),
		select = document.createElement('select'), summary = document.createElement('p');
	summary.textContent = game.i18n.format('FOUNDRYSHOP.RecoveryImport.ActionSummary', {
		token: reviewed.review.token, phase: reviewed.review.phase, state: reviewed.review.state,
		missing: reviewed.review.missingPaths.join(', ') || loc('None'),
	});
	caption.textContent = loc('ActionLabel'); select.name = 'recoveryAction';
	for (const action of reviewed.review.actions) {
		const option = document.createElement('option'); option.value = action;
		option.textContent = loc(`Action-${action}`); select.append(option);
	}
	select.value = 'inspect'; label.append(caption, select); content.append(summary, label);
	const action = await FoundryshopDialog.prompt({
		classes: ['foundryshop-recovery-review'], window: { title: loc('ActionsTitle') },
		content, modal: true, rejectClose: false,
		ok: { label: loc('ActionContinue'), callback: () => select.value },
	});
	if (action === null || action === undefined) throw new RecoveryImportReviewCancelledError();
	return reviewed.execute(action);
}
import { FoundryshopDialog } from '../dialogs.js';
