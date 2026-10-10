import { inspectRecoveryImport } from './recovery_import_reconciliation.js';
import { persistRecoveryImportReceipt, inspectStoredRecoveryImportReceipt } from './recovery_import_receipt_storage.js';
import { clearCompensatedRecoveryImport } from './recovery_import_receipt.js';
import { promptRecoveryImportReceiptPersistence, promptRecoveryImportApproval,
	promptRecoveryImportEntryApproval } from './recovery_import_dialogs.js';
import { canonicalJson } from './project_package.js';
import { prepareRecoveryImport } from './recovery_import_preparation.js';
import { beginRecoveryImportIntent, uploadRecoveryImportAssets } from './recovery_import_intent.js';
import { stageRecoveryImport } from './recovery_import_execution.js';
import { finalizeRecoveryImport } from './recovery_import_finalization.js';

export class InterruptedReviewedRecoveryImportError extends Error {
	constructor(sceneId, token, step, receipt, reference, cause) {
		super(`Reviewed recovery import stopped for ${sceneId}/${token} at ${step}: ${cause.message}. Keep all files and any journal. Inspect exact retained state or attached completed receipt before further action. No automatic retry, release, compensation or receipt upload.`, { cause });
		this.name = 'InterruptedReviewedRecoveryImportError';
		this.sceneId = sceneId; this.token = token; this.step = step;
		this.receipt = receipt === undefined ? undefined : structuredClone(receipt);
		this.reference = reference === undefined ? undefined : structuredClone(reference);
	}
}

/** Opt-in entry workflow; each native transition is separately reviewed. Caller selects exact bytes/Level/root. */
export async function importReviewedRecoveryProject(scene, input, options = {}) {
	options = { ...options };
	// Validate receipt retention budget before any intent, upload or native write.
	if (!Number.isSafeInteger(options.maxReceiptBytes) || options.maxReceiptBytes < 1
		|| options.maxReceiptBytes >= 0xffffffff) throw new Error('Reviewed import requires an explicit receipt byte budget.');
	const plan = await prepareRecoveryImport(scene, input, options);
	const capability = await promptRecoveryImportEntryApproval(scene, plan, options);
	let step = 'intent', receipt;
	try {
		await beginRecoveryImportIntent(scene, capability);
		step = 'assets';
		await uploadRecoveryImportAssets(scene, capability, options);
		step = 'hidden-staging-review';
		const staging = await promptRecoveryImportApproval(scene, 'stage', options);
		step = 'hidden-staging';
		await stageRecoveryImport(scene, staging);
		step = 'final-release-review';
		const release = await promptRecoveryImportApproval(scene, 'finalize', options);
		step = 'final-release';
		receipt = await finalizeRecoveryImport(scene, release);
		step = 'receipt-storage-review';
		const storage = await promptRecoveryImportReceiptPersistence(scene, receipt, options);
		step = 'receipt-storage';
		const stored = await persistRecoveryImportReceipt(scene, storage);
		return { status: 'recovery-import-complete', receipt: stored.receipt, reference: stored.reference };
	} catch (error) {
		throw new InterruptedReviewedRecoveryImportError(scene.id, plan.provenance.importId, step,
			receipt ?? error.receipt, error.reference, error);
	}
}

export class InterruptedCompensatedRecoveryImportRetirementError extends Error {
	constructor(sceneId, receipt, reference, cause) {
		super(`Compensated import retirement stopped for ${sceneId}/${receipt.token}: ${cause.message}. Retain all files and the attached receipt/reference. Inspect journal or exact stored receipt before another explicit review; no automatic retry or new import.`, { cause });
		this.name = 'InterruptedCompensatedRecoveryImportRetirementError';
		this.sceneId = sceneId; this.receipt = structuredClone(receipt);
		this.reference = reference === undefined ? undefined : structuredClone(reference);
	}
}

/** Persist/verify before separately reviewed clearing. Existing references are inspected, never blindly adopted. */
export async function retireCompensatedRecoveryImport(scene, options = {}) {
	options = { ...options };
	const inspected = await inspectRecoveryImport(scene, options);
	if (inspected.review.state !== 'compensated-retained-evidence') {
		throw new Error('Compensated retirement requires exact compensated state and verified evidence.');
	}
	const receipt = inspected.intent, snapshot = canonicalJson(scene.toObject()), owner = game.user.id,
		current = options.isCurrent;
	const check = () => {
		if (!game.user?.isGM || game.user.id !== owner || game.users?.activeGM?.id !== owner
			|| options.signal?.aborted || !current() || canonicalJson(scene.toObject()) !== snapshot) {
			throw new Error('Compensated retirement context changed.');
		}
		return true;
	};
	const guarded = { ...options, isCurrent: check };
	let reference = options.retainedReceiptReference === undefined ? undefined : structuredClone(options.retainedReceiptReference);
	try {
		check();
		if (reference === undefined) {
			const capability = await promptRecoveryImportReceiptPersistence(scene, receipt, guarded),
				stored = await persistRecoveryImportReceipt(scene, capability);
			reference = stored.reference;
		}
		const stored = await inspectStoredRecoveryImportReceipt(scene, reference, guarded);
		if (canonicalJson(stored.receipt) !== canonicalJson(receipt)) throw new Error('Stored receipt differs from compensated journal.');
		check();
		const clearingOptions = { ...options, retainedReceiptReference: reference },
			capability = await promptRecoveryImportApproval(scene, 'clear', clearingOptions);
		check();
		const cleared = await clearCompensatedRecoveryImport(scene, capability);
		return { status: 'compensated-import-retired', reference: structuredClone(reference), receipt: cleared };
	} catch (error) {
		throw new InterruptedCompensatedRecoveryImportRetirementError(scene.id, receipt, reference ?? error.reference, error);
	}
}
