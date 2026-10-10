import { inspectRecoveryImport, inspectClearedCompensatedRecoveryImport } from './recovery_import_reconciliation.js';
import { canonicalJson } from './project_package.js';
import { recoveryImportSceneState } from './recovery_import_scene_state.js';
import { runLayerOperation } from './layer_manager.js';
import { inspectStoredRecoveryImportReceipt } from './recovery_import_receipt_storage.js';

const approvals = new WeakMap();
const fail = message => { throw new Error(`Recovery import receipt: ${message}`); };

/** Clearing a compensated block is a separate decision, not approval to repeat an import. */
export async function reviewCompensatedRecoveryImportClearing(scene, options = {}) {
	options = { ...options };
	if (options.retainedReceiptReference !== undefined) options.retainedReceiptReference = structuredClone(options.retainedReceiptReference);
	const inspected = await inspectRecoveryImport(scene, options);
	if (inspected.review.state !== 'compensated-retained-evidence') fail('Exact compensated state and complete retained evidence are required.');
	const receipt = inspected.intent, snapshot = canonicalJson(scene.toObject());
	const check = () => {
		if (!game.user?.isGM || game.user.id !== receipt.ownerId || game.users?.activeGM?.id !== receipt.ownerId
			|| !game.user.can('FILES_BROWSE') || game.scenes?.get(scene.id) !== scene
			|| !scene.canUserModify(game.user, 'update') || options.signal?.aborted || !options.isCurrent()
			|| canonicalJson(scene.toObject()) !== snapshot) fail('Receipt clearing review context changed.');
	};
	check();
	if (options.retainedReceiptReference !== undefined) {
		const stored = await inspectStoredRecoveryImportReceipt(scene, options.retainedReceiptReference, options);
		if (canonicalJson(stored.receipt) !== canonicalJson(receipt)) fail('Stored receipt differs from compensated journal.');
		check();
	}
	return { review: { token: receipt.token, planDigest: receipt.planDigest,
		retainedPaths: [receipt.bundle.path, ...receipt.uploads.map(file => file.path)],
		retainedReceiptReference: options.retainedReceiptReference === undefined ? undefined : structuredClone(options.retainedReceiptReference),
		disclosure: 'Clear only this verified compensated import journal. Keep the receipt and every server file. No artwork, layer, Level, history or files are changed. A new import requires fresh preparation, collision checks, identities and approvals; this is not retry authority.' },
		approve({ token, planDigest, clearCompensatedReceipt, retainFiles } = {}) {
			check();
			if (token !== receipt.token || planDigest !== receipt.planDigest
				|| clearCompensatedReceipt !== true || retainFiles !== true) fail('Explicit exact receipt clearing and file retention approval are required.');
			const capability = Object.freeze({ token, planDigest });
			approvals.set(capability, { scene, receipt, options, check, consumed: false });
			return capability;
		} };
}

export class InterruptedRecoveryImportReceiptClearingError extends Error {
	constructor(sceneId, receipt, cause) {
		super(`Recovery import receipt clearing stopped for ${sceneId}/${receipt.token}: ${cause.message}. Retain all files and this receipt. Inspect retained intent if present; if removal was uncertain, verify the attached receipt read-only. Do not retry automatically.`, { cause });
		this.name = 'InterruptedRecoveryImportReceiptClearingError';
		this.sceneId = sceneId; this.receipt = structuredClone(receipt);
	}
}

export function clearCompensatedRecoveryImport(scene, capability) {
	return runLayerOperation(scene, async () => {
		const approval = approvals.get(capability);
		if (!approval || approval.scene !== scene || approval.consumed) fail('Fresh receipt clearing approval is required.');
		approval.check(); approval.consumed = true;
		const { receipt, options } = approval;
		try {
			await inspectRecoveryImport(scene, { ...options, isCurrent: () => { approval.check(); return true; } });
			if (options.retainedReceiptReference !== undefined) {
				const stored = await inspectStoredRecoveryImportReceipt(scene, options.retainedReceiptReference,
					{ ...options, isCurrent: () => { approval.check(); return true; } });
				if (canonicalJson(stored.receipt) !== canonicalJson(receipt)) fail('Stored receipt differs from compensated journal.');
			}
			approval.check();
			const baseline = recoveryImportSceneState(scene.toObject());
			delete baseline.flags.foundryshop.projectImportJournal;
			const checkCleared = () => {
				if (canonicalJson(recoveryImportSceneState(scene.toObject())) !== canonicalJson(baseline)) fail('Scene differs from exact cleared receipt state.');
				return options.isCurrent();
			};
			await scene.unsetFlag('foundryshop', 'projectImportJournal');
			await inspectClearedCompensatedRecoveryImport(scene, receipt, { ...options, isCurrent: checkCleared });
			return structuredClone(receipt);
		} catch (error) { throw new InterruptedRecoveryImportReceiptClearingError(scene.id, receipt, error); }
	});
}
