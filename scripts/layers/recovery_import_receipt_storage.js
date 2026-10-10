import { validateRecoveryImportIntent } from './recovery_import_intent.js';
import { inspectRecoveryImport, inspectCompletedRecoveryImport,
	inspectClearedCompensatedRecoveryImport } from './recovery_import_reconciliation.js';
import { canonicalJson } from './project_package.js';
import { fileFingerprint, persistVerifiedFile, readVerifiedFile, validateStoredFile } from '../verified_file_storage.js';
import { runLayerOperation } from './layer_manager.js';

export const RECOVERY_IMPORT_RECEIPT_FORMAT = 'foundryshop-recovery-import-receipt';
const approvals = new WeakMap();
const fail = message => { throw new Error(`Recovery receipt storage: ${message}`); };
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

function budget(options) {
	if (!Number.isSafeInteger(options.maxReceiptBytes) || options.maxReceiptBytes < 1
		|| options.maxReceiptBytes >= 0xffffffff) fail('Explicit receipt byte budget is required.');
	return options.maxReceiptBytes;
}

export function encodeRecoveryImportReceipt(receipt, options = {}) {
	const limit = budget(options), retained = validateRecoveryImportIntent(receipt, receipt?.sceneId);
	if (!['complete', 'compensated'].includes(retained.phase)) fail('Only complete or compensated receipts can be retained.');
	const bytes = new TextEncoder().encode(JSON.stringify({
		format: RECOVERY_IMPORT_RECEIPT_FORMAT, version: 1, receipt: retained,
	}));
	if (bytes.length > limit) fail('Receipt exceeds reviewed byte budget.');
	return bytes;
}

export function decodeRecoveryImportReceipt(bytes, options = {}) {
	const limit = budget(options);
	if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > limit) fail('Receipt exceeds reviewed byte budget.');
	const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	if (!envelope || Object.getPrototypeOf(envelope) !== Object.prototype
		|| Object.keys(envelope).length !== 3 || envelope.format !== RECOVERY_IMPORT_RECEIPT_FORMAT
		|| envelope.version !== 1 || !Object.hasOwn(envelope, 'receipt')) fail('Invalid versioned receipt envelope.');
	const receipt = validateRecoveryImportIntent(envelope.receipt, envelope.receipt?.sceneId);
	if (!['complete', 'compensated'].includes(receipt.phase)) fail('Only complete or compensated receipts can be retained.');
	return receipt;
}

async function inspect(scene, receipt, options) {
	const journal = scene.getFlag('foundryshop', 'projectImportJournal');
	if (journal !== undefined) {
		if (!same(journal, receipt)) fail('Retained receipt differs from current import journal.');
		return inspectRecoveryImport(scene, options);
	}
	return receipt.phase === 'complete' ? inspectCompletedRecoveryImport(scene, receipt, options)
		: inspectClearedCompensatedRecoveryImport(scene, receipt, options);
}

async function receiptReference(receipt, bytes) {
	const fingerprint = await fileFingerprint(bytes);
	return validateStoredFile({ version: 1, root: receipt.bundle.root,
		path: `${receipt.bundle.root}/receipt-${receipt.token}-${receipt.phase}-${fingerprint}.json`,
		bytes: bytes.length, fingerprint });
}

/** Locate only the deterministic exact receipt for a supplied terminal intent, not a general file catalog. */
export async function findStoredRecoveryImportReceipt(scene, receipt, options = {}) {
	options = { ...options };
	const bytes = encodeRecoveryImportReceipt(receipt, options);
	if (!same(decodeRecoveryImportReceipt(bytes, options), receipt)) fail('Receipt is not losslessly serializable.');
	await inspect(scene, receipt, options);
	const snapshot = canonicalJson(scene.toObject()), owner = game.user.id;
	const check = () => {
		if (game.user?.id !== owner || !game.user.isGM || game.users?.activeGM?.id !== owner
			|| options.signal?.aborted || !options.isCurrent()
			|| canonicalJson(scene.toObject()) !== snapshot) fail('Receipt discovery context changed.');
		return true;
	};
	const reference = await receiptReference(receipt, bytes);
	check();
	const listing = await foundry.applications.apps.FilePicker.implementation.browse('data', reference.root);
	check();
	if (!Array.isArray(listing.files) || listing.files.some(path => typeof path !== 'string')) fail('Invalid receipt folder listing.');
	const matches = listing.files.filter(path => decodeURIComponent(path).toLowerCase() === reference.path.toLowerCase());
	if (!matches.length) return { status: 'not-found', reference };
	if (matches.length !== 1 || matches[0] !== reference.path) fail('Receipt exists under an ambiguous or conflicting path alias.');
	const stored = await inspectStoredRecoveryImportReceipt(scene, reference, { ...options, isCurrent: check });
	if (!same(stored.receipt, receipt)) fail('Discovered receipt differs from exact supplied receipt.');
	return { status: 'verified', ...stored };
}

/** Immutable file approval only; no journal removal, import retry or receipt adoption. */
export async function reviewRecoveryImportReceiptPersistence(scene, receipt, options = {}) {
	options = { ...options };
	const bytes = encodeRecoveryImportReceipt(receipt, options),
		retained = decodeRecoveryImportReceipt(bytes, options);
	if (!same(retained, receipt)) fail('Receipt is not losslessly serializable.');
	await inspect(scene, retained, options);
	const snapshot = canonicalJson(scene.toObject()), owner = game.user.id;
	const check = () => {
		if (!game.user?.isGM || game.user.id !== owner || game.users?.activeGM?.id !== owner
			|| !game.user.can('FILES_BROWSE') || !game.user.can('FILES_UPLOAD')
			|| game.scenes?.get(scene.id) !== scene || !scene.canUserModify(game.user, 'update')
			|| options.signal?.aborted || !options.isCurrent() || canonicalJson(scene.toObject()) !== snapshot) {
			fail('Receipt persistence context changed.');
		}
		return true;
	};
	const reference = await receiptReference(retained, bytes), fingerprint = reference.fingerprint;
	check();
	return { review: { token: retained.token, planDigest: retained.planDigest, phase: retained.phase, reference: structuredClone(reference),
		disclosure: 'Write only this exact immutable receipt file and verify its bytes. Retain every evidence file. No Scene changes, journal clearing, retry or ownership transfer. An uncertain upload must be inspected by its exact reference, not automatically retried.' },
		approve({ fingerprint: hash, persistReceipt, retainFiles } = {}) {
			check();
			if (hash !== fingerprint || persistReceipt !== true || retainFiles !== true) fail('Exact receipt persistence and file retention approval required.');
			const capability = Object.freeze({ fingerprint });
			approvals.set(capability, { scene, receipt: retained, bytes, reference, options, check, consumed: false });
			return capability;
		} };
}

export class InterruptedRecoveryImportReceiptPersistenceError extends Error {
	constructor(reference, receipt, cause) {
		super(`Recovery receipt persistence stopped at ${reference.path}: ${cause.message}. Keep all files and the receipt; verify this exact reference read-only before further action. No automatic retry or journal clearing.`, { cause });
		this.name = 'InterruptedRecoveryImportReceiptPersistenceError';
		this.reference = structuredClone(reference); this.receipt = structuredClone(receipt);
	}
}

export function persistRecoveryImportReceipt(scene, capability) {
	return runLayerOperation(scene, async () => {
		const approval = approvals.get(capability);
		if (!approval || approval.scene !== scene || approval.consumed) fail('Fresh receipt persistence approval is required.');
		approval.check(); approval.consumed = true;
		const { receipt, reference, bytes, options, check } = approval;
		try {
			await inspect(scene, receipt, { ...options, isCurrent: check });
			check();
			const stored = await persistVerifiedFile(new Blob([bytes], { type: 'application/json' }), {
				...options, root: reference.root, filename: reference.path.slice(reference.root.length + 1), isCurrent: check,
			});
			if (!same(stored, reference)) fail('Persisted receipt reference differs from approved bytes.');
			await inspectStoredRecoveryImportReceipt(scene, reference, { ...options, isCurrent: check });
			return { reference: structuredClone(reference), receipt: structuredClone(receipt) };
		} catch (error) { throw new InterruptedRecoveryImportReceiptPersistenceError(reference, receipt, error); }
	});
}

/** Caller supplies the exact retained reference; integrity is not authenticity or write authority. */
export async function inspectStoredRecoveryImportReceipt(scene, input, options = {}) {
	options = { ...options };
	const reference = validateStoredFile(input);
	if (reference.bytes > budget(options) || !reference.path.endsWith('.json')) fail('Receipt file exceeds budget or is not JSON.');
	if (!scene || typeof options.isCurrent !== 'function') fail('Exact Scene and currentness guard required.');
	const snapshot = canonicalJson(scene.toObject()), owner = game.user?.id;
	const check = () => {
		if (!game.user?.isGM || game.user.id !== owner || game.users?.activeGM?.id !== owner
			|| game.scenes?.get(scene.id) !== scene || options.signal?.aborted || !options.isCurrent()
			|| canonicalJson(scene.toObject()) !== snapshot) fail('Stored receipt inspection context changed.');
		return true;
	};
	check();
	const guarded = { ...options, isCurrent: check },
		bytes = await readVerifiedFile(reference, guarded), receipt = decodeRecoveryImportReceipt(bytes, options);
	if (reference.root !== receipt.bundle.root) fail('Receipt storage root differs from retained evidence.');
	const inspected = await inspect(scene, receipt, guarded);
	check();
	return { reference, receipt, review: inspected.review };
}
