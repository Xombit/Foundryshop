import { inspectRecoveryImport } from './recovery_import_reconciliation.js';
import { validateRecoveryImportIntent, UnverifiedRecoveryImportIntentError } from './recovery_import_intent.js';
import { recoveryImportUnrelatedContext } from './recovery_import_execution.js';
import { authorizeRecoveryImportDeletes } from './recovery_import_native_guard.js';
import { canonicalJson } from './project_package.js';
import { runLayerOperation, LAYER_OPERATION } from './layer_manager.js';
import { readVerifiedFile } from '../verified_file_storage.js';

const approvals = new WeakMap();
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = message => { throw new Error(`Recovery import compensation: ${message}`); };
const sources = collection => [...collection.values()].map(document => document.toObject()).sort((a, b) => a._id.localeCompare(b._id));

/** Fresh destructive review of verified hidden staging only; never deletes retained files. */
export async function reviewRecoveryImportCompensation(scene, options = {}) {
	options = { ...options };
	const inspected = await inspectRecoveryImport(scene, options);
	if (!inspected.evidence || inspected.review.missingPaths.length
		|| !['intent', 'assets-verified', 'tree-installed', 'native-staged', 'compensating'].includes(inspected.intent.phase)) {
		fail('Complete verified evidence and an unfinished import are required for compensation.');
	}
	const { intent } = inspected, snapshot = canonicalJson(scene.toObject()),
		drawings = sources(scene.drawings), tiles = sources(scene.tiles);
	const check = () => {
		if (!game.user?.isGM || game.user.id !== intent.ownerId || game.users?.activeGM?.id !== intent.ownerId
			|| !game.user.can('FILES_BROWSE') || game.scenes?.get(scene.id) !== scene
			|| !scene.canUserModify(game.user, 'update') || options.signal?.aborted || !options.isCurrent()
			|| canonicalJson(scene.toObject()) !== snapshot) fail('Compensation review context changed.');
	};
	check();
	return { review: { token: intent.token, planDigest: intent.planDigest,
		drawingIds: drawings.map(source => source._id), tileIds: tiles.map(source => source._id),
		retainedPaths: [intent.bundle.path, ...intent.uploads.map(file => file.path)],
		disclosure: 'Delete only the listed exact hidden staged documents and restore the prior layer metadata. Native Level/background remains untouched. Keep every uploaded file and a compensated journal receipt; this does not clear the import block or authorize retry.' },
		approve({ token, planDigest, deleteHiddenStaging, retainFiles } = {}) {
			check();
			if (token !== intent.token || planDigest !== intent.planDigest
				|| deleteHiddenStaging !== true || retainFiles !== true) fail('Explicit exact-plan deletion and file-retention approval is required.');
			const capability = Object.freeze({ token, planDigest });
			approvals.set(capability, { scene, intent, drawings, tiles, options, check,
				baseline: recoveryImportUnrelatedContext(scene, intent.levelId), consumed: false });
			return capability;
		} };
}

export class InterruptedRecoveryImportCompensationError extends Error {
	constructor(sceneId, token, cause) {
		super(`Recovery import compensation stopped for ${sceneId}/${token}: ${cause.message}. Retain journal and all files; re-inspect remaining hidden documents before another cleanup approval.`, { cause });
		this.name = 'InterruptedRecoveryImportCompensationError'; this.sceneId = sceneId; this.token = token;
	}
}

/** Intent precedes deletion; uncertain outcomes require a fresh inspection, never automatic cleanup retry. */
export function compensateRecoveryImport(scene, capability) {
	return runLayerOperation(scene, async () => {
		const approval = approvals.get(capability);
		if (!approval || approval.scene !== scene || approval.consumed) fail('Fresh exact compensation approval is required.');
		approval.check(); approval.consumed = true;
		let expected = approval.intent, tree = structuredClone(scene.getFlag('foundryshop', 'layers') ?? expected.before.layers);
		const remaining = { Drawing: approval.drawings, Tile: approval.tiles };
		const check = () => {
			if (!game.user?.isGM || game.user.id !== expected.ownerId || game.users?.activeGM?.id !== expected.ownerId
				|| !game.user.can('FILES_BROWSE') || game.scenes?.get(scene.id) !== scene
				|| !scene.canUserModify(game.user, 'update') || approval.options.signal?.aborted || !approval.options.isCurrent()
				|| !same(scene.getFlag('foundryshop', 'projectImportJournal'), expected)
				|| recoveryImportUnrelatedContext(scene, expected.levelId) !== approval.baseline
				|| !same(scene.levels.get(expected.levelId)?.toObject(), expected.before.level)
				|| !same(scene.getFlag('foundryshop', 'layers') ?? expected.before.layers, tree)
				|| !same(sources(scene.drawings), remaining.Drawing) || !same(sources(scene.tiles), remaining.Tile)) {
				fail('Owned staging or unrelated destination changed during compensation.');
			}
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
			for (const reference of [expected.bundle, ...expected.uploads]) {
				await readVerifiedFile(reference, { ...approval.options, isCurrent: check });
				check();
			}
			if (expected.phase !== 'compensating') await advance('compensating');
			for (const type of ['Drawing', 'Tile']) {
				check();
				const data = remaining[type];
				if (data.length) {
					const options = { [LAYER_OPERATION]: true };
					const revoke = authorizeRecoveryImportDeletes(options, scene, expected, data);
					try { await scene.deleteEmbeddedDocuments(type, data.map(source => source._id), options); }
					finally { revoke(); }
				}
				remaining[type] = []; check();
			}
			if (!same(tree, expected.before.layers)) {
				await scene.update({ 'flags.foundryshop.layers': expected.before.layers }, { diff: false, [LAYER_OPERATION]: true });
				tree = expected.before.layers; check();
			}
			await advance('compensated');
			return structuredClone(expected);
		} catch (error) { throw new InterruptedRecoveryImportCompensationError(scene.id, expected.token, error); }
	});
}
