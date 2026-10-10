import { inspectRecoveryImport, inspectCompletedRecoveryImport } from './recovery_import_reconciliation.js';
import { validateRecoveryImportIntent, UnverifiedRecoveryImportIntentError } from './recovery_import_intent.js';
import { reconstructRecoveryProjectDrawings } from './recovery_project_manifest.js';
import { recoveryImportUnrelatedContext } from './recovery_import_execution.js';
import { authorizeRecoveryImportUpdates } from './recovery_import_native_guard.js';
import { canonicalJson } from './project_package.js';
import { availableProjectFonts } from './project_resources.js';
import { runLayerOperation, LAYER_OPERATION, scheduleLayerRefresh } from './layer_manager.js';

const approvals = new WeakMap();
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = message => { throw new Error(`Recovery import finalization: ${message}`); };
const sources = collection => [...collection.values()].map(document => document.toObject()).sort((a, b) => a._id.localeCompare(b._id));
const sorted = data => [...data].sort((a, b) => a._id.localeCompare(b._id));
const withoutBackground = source => {
	const value = structuredClone(source);
	delete value.background; delete value.textures;
	return value;
};

/** Final native visibility is a separate exact-plan decision, not implied by hidden staging. */
export async function reviewRecoveryImportFinalization(scene, options = {}) {
	return reviewFinalization(scene, options, false);
}

/** Explicit fresh approval finishes only exact retained release state; no automatic retry or rollback. */
export async function reviewRecoveryImportFinalizationResume(scene, options = {}) {
	return reviewFinalization(scene, options, true);
}

async function reviewFinalization(scene, options, resume) {
	options = { ...options };
	const inspected = await inspectRecoveryImport(scene, options);
	if (resume ? inspected.review.state !== 'native-release-in-progress'
		: inspected.intent.phase !== 'native-staged' || inspected.review.state !== 'hidden-native-staging') {
		fail(resume ? 'Exact retained release-phase evidence is required for explicit resume.'
			: 'Exact complete hidden native staging is required; partial release needs separate reconciliation.');
	}
	const { intent, evidence, dependencies } = inspected, snapshot = canonicalJson(scene.toObject());
	if (!same(withoutBackground(intent.before.level), withoutBackground(intent.after.level))) {
		fail('Final Level target changes unrelated settings.');
	}
	const requiredDecisions = [resume ? 'resume-finalize-import' : 'finalize-import', ...intent.decisions.filter(decision =>
		['native-tile-visibility', 'level-background-replacement-and-visibility'].includes(decision))];
	const drawings = reconstructRecoveryProjectDrawings(evidence.manifest.project, evidence.manifest.authors),
		tiles = evidence.manifest.tiles;
	const check = () => {
		if (!game.user?.isGM || game.user.id !== intent.ownerId || game.users?.activeGM?.id !== intent.ownerId
			|| !game.user.can('FILES_BROWSE') || game.scenes?.get(scene.id) !== scene
			|| !scene.canUserModify(game.user, 'update') || options.signal?.aborted || !options.isCurrent()
			|| canonicalJson(scene.toObject()) !== snapshot) fail('Finalization review context changed.');
	};
	check();
	return { review: { token: intent.token, planDigest: intent.planDigest, requiredDecisions: [...requiredDecisions],
		resume, phase: intent.phase, nativeState: structuredClone(inspected.nativeState),
		drawingIds: drawings.map(source => source._id), tileIds: tiles.map(source => source._id),
		beforeLevel: structuredClone(intent.before.level), afterLevel: structuredClone(intent.after.level),
		disclosure: `${resume ? 'Explicitly resume only the remaining exact release steps; already-final artwork and backgrounds are not rewritten. ' : ''}Install this complete recovery history and release owned staging to its exact imported native sources. The Drawing presentation wrapper stays closed. Native Tiles/backgrounds do not obey that wrapper and may immediately be player-visible; their separate approval is required again. Source historical backgrounds, not the destination background, are restored by imported history. Clear intent only after exact final evidence verification. Retain all files; uncertain release is not automatically retried or compensated.` },
		approve({ token, planDigest, decisions } = {}) {
			check();
			if (token !== intent.token || planDigest !== intent.planDigest || !same(decisions, requiredDecisions)) {
				fail('Explicit exact-plan finalization and separate native visibility approvals are required.');
			}
			const capability = Object.freeze({ token, planDigest });
			approvals.set(capability, { scene, intent, drawings, tiles, dependencies, options, check, resume,
				nativeState: inspected.nativeState,
				baseline: recoveryImportUnrelatedContext(scene, intent.levelId, { ignoreOptimization: true }), consumed: false });
			return capability;
		} };
}

export class InterruptedRecoveryImportFinalizationError extends Error {
	constructor(sceneId, intent, cause) {
		super(`Recovery import finalization stopped for ${sceneId}/${intent.token}: ${cause.message}. Native visibility/background may have changed. Retain all files and any journal; inspect exact release state before further action. If journal removal was uncertain, use the attached complete receipt for read-only verification.`, { cause });
		this.name = 'InterruptedRecoveryImportFinalizationError'; this.sceneId = sceneId;
		this.token = intent.token; this.receipt = structuredClone(intent);
	}
}

/** Completion clears only verified intent; uncertain release requires a separate fresh resume approval. */
export function finalizeRecoveryImport(scene, capability) {
	return executeFinalization(scene, capability, false);
}

export function resumeRecoveryImportFinalization(scene, capability) {
	return executeFinalization(scene, capability, true);
}

function executeFinalization(scene, capability, resume) {
	return runLayerOperation(scene, async () => {
		const approval = approvals.get(capability);
		if (!approval || approval.scene !== scene || approval.consumed || approval.resume !== resume) fail('Fresh finalization approval is required.');
		approval.check(); approval.consumed = true;
		let expected = approval.intent, historyInstalled = approval.nativeState.history === 'after',
			levelReleased = approval.nativeState.level === 'after', cleared = false;
		const native = { Drawing: sources(scene.drawings), Tile: sources(scene.tiles) };
		const check = () => {
			if (!game.user?.isGM || game.user.id !== expected.ownerId || game.users?.activeGM?.id !== expected.ownerId
				|| !game.user.can('FILES_BROWSE') || game.scenes?.get(scene.id) !== scene
				|| !scene.canUserModify(game.user, 'update') || approval.options.signal?.aborted || !approval.options.isCurrent()
				|| (cleared ? scene.getFlag('foundryshop', 'projectImportJournal') !== undefined
					: !same(scene.getFlag('foundryshop', 'projectImportJournal'), expected))
				|| recoveryImportUnrelatedContext(scene, expected.levelId, { ignoreOptimization: true }) !== approval.baseline
				|| !same(scene.getFlag('foundryshop', 'layers'), expected.after.layers)
				|| !same(scene.getFlag('foundryshop', 'optimizationJournal'), historyInstalled ? expected.optimization : undefined)
				|| !same(scene.levels.get(expected.levelId)?.toObject(), levelReleased ? expected.after.level : expected.before.level)
				|| !same(sources(scene.drawings), native.Drawing) || !same(sources(scene.tiles), native.Tile)) {
				fail('Owned native/history state or unrelated destination changed during finalization.');
			}
			const fonts = new Set(availableProjectFonts());
			if (approval.dependencies.fonts.some(font => !fonts.has(font))
				|| approval.dependencies.modules.some(module => !game.modules.get(module)?.active)) fail('Historical fonts/modules changed.');
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
			await inspectRecoveryImport(scene, { ...approval.options, isCurrent: check });
			check();
			if (expected.phase === 'native-staged') await advance('releasing');
			if (!historyInstalled) {
				await scene.update({ 'flags.foundryshop.optimizationJournal': expected.optimization }, { diff: false, [LAYER_OPERATION]: true });
				historyInstalled = true; check();
			}
			if (expected.phase === 'releasing') await advance('history-installed');
			for (const [type, final] of [['Drawing', approval.drawings], ['Tile', approval.tiles]]) {
				check();
				const remaining = final.filter(source => !same(native[type].find(current => current._id === source._id), source));
				const patches = remaining.map(source => ({
					_id: source._id, hidden: source.hidden,
					[source.flags?.foundryshop === undefined ? 'flags.-=foundryshop' : 'flags.foundryshop.-=importStaging']: null,
				}));
				if (patches.length) {
					const options = { diff: false, [LAYER_OPERATION]: true };
					const revoke = authorizeRecoveryImportUpdates(options, scene, expected,
						native[type].filter(source => remaining.some(target => target._id === source._id)), patches);
					try { await scene.updateEmbeddedDocuments(type, patches, options); }
					finally { revoke(); }
				}
				native[type] = sorted(final); check();
			}
			if (!levelReleased && !same(expected.before.level, expected.after.level)) {
				const patch = { _id: expected.levelId };
				for (const field of ['background', 'textures']) {
					if (Object.hasOwn(expected.after.level, field)) patch[field] = structuredClone(expected.after.level[field]);
					else if (Object.hasOwn(expected.before.level, field)) patch[`-=${field}`] = null;
				}
				await scene.updateEmbeddedDocuments('Level', [patch], { diff: false, recursive: false, [LAYER_OPERATION]: true });
			}
			levelReleased = true; check();
			await inspectRecoveryImport(scene, { ...approval.options, isCurrent: check });
			check();
			if (expected.phase === 'history-installed') await advance('native-released');
			if (expected.phase === 'native-released') await advance('complete');
			await scene.unsetFlag('foundryshop', 'projectImportJournal');
			cleared = true; check();
			await inspectCompletedRecoveryImport(scene, expected, { ...approval.options, isCurrent: check });
			check(); scheduleLayerRefresh();
			return structuredClone(expected);
		} catch (error) { throw new InterruptedRecoveryImportFinalizationError(scene.id, expected, error); }
	});
}
