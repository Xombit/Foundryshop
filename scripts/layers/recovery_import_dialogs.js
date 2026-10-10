import { reviewRecoveryImportStaging } from './recovery_import_execution.js';
import { reviewRecoveryImportCompensation } from './recovery_import_compensation.js';
import { reviewRecoveryImportFinalization, reviewRecoveryImportFinalizationResume } from './recovery_import_finalization.js';
import { reviewCompensatedRecoveryImportClearing } from './recovery_import_receipt.js';
import { reviewRecoveryImportReceiptPersistence } from './recovery_import_receipt_storage.js';
import { canonicalJson } from './project_package.js';
import { reviewRecoveryImport } from './recovery_import_intent.js';

const loc = key => game.i18n.localize(`FOUNDRYSHOP.RecoveryImport.${key}`);
const fmt = (key, data) => game.i18n.format(`FOUNDRYSHOP.RecoveryImport.${key}`, data);
const decisions = {
	'finalize-import': 'FinalizeDecision',
	'resume-finalize-import': 'ResumeDecision',
	'native-tile-visibility': 'TileDecision',
	'level-background-replacement-and-visibility': 'BackgroundDecision',
};
const importDecisions = {
	'project-import': 'ImportDecision',
	'native-tile-visibility': 'TileDecision',
	'level-background-replacement-and-visibility': 'BackgroundDecision',
	'empty-metadata-replacement': 'MetadataDecision',
};

export class RecoveryImportReviewCancelledError extends Error {
	constructor() { super(loc('Cancelled')); this.name = 'RecoveryImportReviewCancelledError'; }
}

function append(parent, tag, text, attributes = {}) {
	const element = document.createElement(tag);
	if (text !== undefined) element.textContent = String(text);
	for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
	parent.append(element);
	return element;
}

function list(parent, title, values) {
	append(parent, 'p', loc(title));
	const ul = append(parent, 'ul');
	for (const value of values.length ? values : [loc('None')]) append(ul, 'li', value);
}

/** Internal review adapters only: they grant no uploads, execution, receipt storage or toolbar access. */
export function createRecoveryImportReviewDialogs({ isCurrent, signal } = {}) {
	if (typeof isCurrent !== 'function') throw new Error(loc('Changed'));
	const owner = game.user?.id;
	const check = () => {
		if (!game.user?.isGM || game.user.id !== owner || game.users?.activeGM?.id !== owner
			|| signal?.aborted || !isCurrent()) throw new Error(loc('Changed'));
	};
	check();
	const confirm = async (title, input, warning, requirements, describe) => {
		check();
		const review = structuredClone(input), content = document.createElement('div');
		append(content, 'p', fmt('Identity', { token: review.token, digest: review.planDigest }));
		append(content, 'p', loc(warning));
		describe(content, review);
		for (const [name, key] of requirements) {
			const label = append(content, 'label');
			append(label, 'input', undefined, { type: 'checkbox', name, required: '' });
			append(label, 'span', loc(key));
		}
		const accepted = await FoundryshopDialog.prompt({
			classes: ['foundryshop-recovery-review'], window: { title: loc(title) },
			content, modal: true, rejectClose: false,
			ok: { label: loc(title), callback: (event, button) =>
				requirements.every(([name]) => button.form.elements[name]?.checked === true) },
		});
		check();
		if (accepted !== true) throw new RecoveryImportReviewCancelledError();
		return review;
	};
	return {
		async approveImport(input) {
			const required = [...input.requiredApprovals];
			if (required[0] !== 'project-import' || new Set(required).size !== required.length
				|| required.some(key => !Object.hasOwn(importDecisions, key))) throw new Error(loc('InvalidDecisions'));
			const review = await confirm('ImportTitle', input, 'ImportWarning',
				required.map((key, index) => [`decision${index}`, importDecisions[key]]), (content, r) => {
					append(content, 'p', fmt('Destination', { scene: r.sceneId, level: r.levelId }));
					append(content, 'p', fmt('UploadSummary', { bytes: r.uploadBytes, count: r.uploadCount + 1 }));
					append(content, 'p', fmt('CoordinatePolicy', { coordinates: r.coordinatePolicy, elevation: r.elevationPolicy }));
					list(content, 'Drawings', r.drawingIds); list(content, 'Tiles', r.tileIds);
					list(content, 'Fonts', r.fonts); list(content, 'Modules', r.modules);
					list(content, 'Paths', r.retainedPaths);
					append(content, 'p', fmt('Level', {
						before: canonicalJson(r.backgroundBefore), after: canonicalJson(r.backgroundAfter),
					}));
				});
			return { planDigest: review.planDigest, decisions: [...review.requiredApprovals] };
		},
		async approveStaging(input) {
			const review = await confirm('StageTitle', input, 'StageWarning', [['stage', 'StageDecision']], (content, r) => {
				list(content, 'Drawings', r.drawingIds); list(content, 'Tiles', r.tileIds);
			});
			return { token: review.token, planDigest: review.planDigest, stageHidden: true };
		},
		async approveCompensation(input) {
			const review = await confirm('CompensateTitle', input, 'CompensateWarning',
				[['delete', 'DeleteDecision'], ['retain', 'RetainDecision']], (content, r) => {
					list(content, 'Drawings', r.drawingIds); list(content, 'Tiles', r.tileIds);
					list(content, 'Paths', r.retainedPaths);
				});
			return { token: review.token, planDigest: review.planDigest, deleteHiddenStaging: true, retainFiles: true };
		},
		async approveFinalization(input) {
			const required = [...input.requiredDecisions];
			if (required[0] !== (input.resume ? 'resume-finalize-import' : 'finalize-import')
				|| new Set(required).size !== required.length || required.some(key => !Object.hasOwn(decisions, key))) {
				throw new Error(loc('InvalidDecisions'));
			}
			const review = await confirm(input.resume ? 'ResumeTitle' : 'FinalizeTitle', input,
				input.resume ? 'ResumeWarning' : 'FinalizeWarning',
				required.map((key, index) => [`decision${index}`, decisions[key]]), (content, r) => {
					append(content, 'p', fmt('Phase', { phase: r.phase }));
					list(content, 'Drawings', r.drawingIds); list(content, 'Tiles', r.tileIds);
					list(content, 'FinalDrawings', r.nativeState.finalDrawingIds);
					list(content, 'FinalTiles', r.nativeState.finalTileIds);
					append(content, 'p', fmt('Level', {
						before: canonicalJson(r.beforeLevel), after: canonicalJson(r.afterLevel),
					}));
				});
			return { token: review.token, planDigest: review.planDigest, decisions: [...review.requiredDecisions] };
		},
		async approveClearing(input) {
			const review = await confirm('ClearTitle', input, 'ClearWarning',
				[['clear', 'ClearDecision'], ['retain', 'RetainDecision']], (content, r) => {
					list(content, 'Paths', r.retainedPaths);
					if (r.retainedReceiptReference) {
						list(content, 'ReceiptPath', [r.retainedReceiptReference.path]);
						append(content, 'p', fmt('ReceiptFile', {
							bytes: r.retainedReceiptReference.bytes, fingerprint: r.retainedReceiptReference.fingerprint,
						}));
					}
				});
			return { token: review.token, planDigest: review.planDigest, clearCompensatedReceipt: true, retainFiles: true };
		},
		async approveReceiptPersistence(input) {
			const review = await confirm('ReceiptTitle', input, 'ReceiptWarning',
				[['persist', 'ReceiptDecision'], ['retain', 'RetainDecision']], (content, r) => {
					list(content, 'Paths', [r.reference.path]);
					append(content, 'p', fmt('ReceiptFile', { bytes: r.reference.bytes, fingerprint: r.reference.fingerprint }));
				});
			return { fingerprint: review.reference.fingerprint, persistReceipt: true, retainFiles: true };
		},
	};
}

export async function promptRecoveryImportEntryApproval(scene, prepared, options = {}) {
	options = { ...options };
	const dialogs = createRecoveryImportReviewDialogs(options), reviewed = await reviewRecoveryImport(scene, prepared, options);
	return reviewed.approve(await dialogs.approveImport(reviewed.review));
}

export async function promptRecoveryImportReceiptPersistence(scene, receipt, options = {}) {
	options = { ...options };
	const dialogs = createRecoveryImportReviewDialogs(options),
		reviewed = await reviewRecoveryImportReceiptPersistence(scene, receipt, options);
	return reviewed.approve(await dialogs.approveReceiptPersistence(reviewed.review));
}

/** Fresh service review plus explicit dialog approval; caller must execute the returned single-use capability. */
export async function promptRecoveryImportApproval(scene, action, options = {}) {
	options = { ...options };
	const operations = {
		stage: [reviewRecoveryImportStaging, 'approveStaging'],
		compensate: [reviewRecoveryImportCompensation, 'approveCompensation'],
		finalize: [reviewRecoveryImportFinalization, 'approveFinalization'],
		resume: [reviewRecoveryImportFinalizationResume, 'approveFinalization'],
		clear: [reviewCompensatedRecoveryImportClearing, 'approveClearing'],
	};
	if (!Object.hasOwn(operations, action)) throw new Error(loc('InvalidAction'));
	const dialogs = createRecoveryImportReviewDialogs(options), [reviewService, method] = operations[action];
	const reviewed = await reviewService(scene, options);
	const decision = await dialogs[method](reviewed.review);
	return reviewed.approve(decision);
}
import { FoundryshopDialog } from '../dialogs.js';
