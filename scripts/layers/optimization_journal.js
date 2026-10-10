import { MODULE } from '../constants.js';
import { canonicalJson } from './project_package.js';
import { runLayerOperation, LAYER_OPERATION } from './layer_manager.js';
import { validateStoredFile } from '../verified_file_storage.js';
import { assertNoPendingPathOperation } from '../path_operation_guard.js';

export const OPTIMIZATION_JOURNAL = 'optimizationJournal';
const phases = {
	apply: ['intent', 'assets-verified', 'replacement-staged', 'sources-removed', 'complete'],
	restore: ['intent', 'assets-verified', 'originals-staged', 'replacement-reverted', 'complete'],
};
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
	&& [Object.prototype, null].includes(Object.getPrototypeOf(value))
	&& Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const empty = () => ({ version: 1, revision: 0, entries: [] });

function validateEntry(entry, sceneId) {
	if (!exact(entry, ['token', 'sceneId', 'levelId', 'ownerId', 'action', 'phase', 'archive',
		'archiveChecksum', 'asset', 'sourceCount', 'sourceDigest', 'replacement', 'parentToken'])
		|| ![entry.token, entry.sceneId, entry.levelId, entry.ownerId].every(id)
		|| entry.sceneId !== sceneId || typeof entry.action !== 'string' || !Object.hasOwn(phases, entry.action)
		|| !phases[entry.action].includes(entry.phase)
		|| !digest(entry.archiveChecksum) || !digest(entry.sourceDigest)
		|| !Number.isSafeInteger(entry.sourceCount) || entry.sourceCount < 1
		|| !(entry.parentToken === null || id(entry.parentToken))) {
		throw new Error('Invalid optimization operation record.');
	}
	validateStoredFile(entry.archive);
	validateStoredFile(entry.asset);
	if (!entry.archive.path.endsWith('.json') || entry.archive.path === entry.asset.path) {
		throw new Error('Optimization archive and output require distinct persistent paths.');
	}
	const replacement = entry.replacement;
	if (!exact(replacement, ['type', 'id', 'beforeDigest', 'stagedDigest', 'afterDigest'])
		|| !['Drawing', 'Tile', 'LevelBackground'].includes(replacement.type)
		|| !id(replacement.id) || !digest(replacement.afterDigest)
		|| !(replacement.stagedDigest === null || digest(replacement.stagedDigest))
		|| !(replacement.beforeDigest === null || digest(replacement.beforeDigest))
		|| (replacement.type === 'LevelBackground'
			? replacement.id !== entry.levelId || !digest(replacement.beforeDigest) || replacement.stagedDigest !== null
			: replacement.beforeDigest !== null || !digest(replacement.stagedDigest))) {
		throw new Error('Invalid typed optimization replacement descriptor.');
	}
	return structuredClone(entry);
}

/** Records retain references/digests, never large original Drawing payloads. */
export function validateOptimizationJournal(input, sceneId) {
	if (!id(sceneId) || !exact(input, ['version', 'revision', 'entries']) || input.version !== 1
		|| !Number.isSafeInteger(input.revision) || input.revision < 0 || !Array.isArray(input.entries)) {
		throw new Error('Invalid optimization journal.');
	}
	const seen = new Map(), paths = new Set(), restored = new Set();
	let active = false;
	for (const entry of input.entries) {
		validateEntry(entry, sceneId);
		if (seen.has(entry.token)) throw new Error('Duplicate optimization operation token.');
		if (active) throw new Error('An unfinished optimization operation must be the final journal entry.');
		if (entry.phase !== 'complete') active = true;
		if (entry.parentToken !== null) {
			const parent = seen.get(entry.parentToken);
			if (!parent || parent.phase !== 'complete' || parent.levelId !== entry.levelId) {
				throw new Error('Optimization lineage must reference an earlier completed operation on the same Level.');
			}
			if (entry.action === 'restore' && (parent.action !== 'apply'
				|| !same(entry.archive, parent.archive) || entry.archiveChecksum !== parent.archiveChecksum
				|| !same(entry.asset, parent.asset) || !same(entry.replacement, parent.replacement)
				|| entry.sourceCount !== parent.sourceCount || entry.sourceDigest !== parent.sourceDigest)) {
				throw new Error('Restore intent must retain the exact applied operation recovery descriptors.');
			}
			if (entry.action === 'restore') {
				if (restored.has(parent.token)) throw new Error('An applied optimization operation already has a restore intent.');
				restored.add(parent.token);
			}
		} else if (entry.action === 'restore') throw new Error('Restore intent requires an applied operation lineage.');
		if (entry.action === 'apply') {
			for (const path of [entry.archive.path, entry.asset.path]) {
				if (paths.has(path)) throw new Error('New optimization outputs must not overwrite prior recovery paths.');
				paths.add(path);
			}
		}
		seen.set(entry.token, entry);
	}
	return structuredClone(input);
}

export function readOptimizationJournal(scene) {
	if (!scene) throw new Error('Optimization journal requires a Scene.');
	const stored = scene.getFlag(MODULE, OPTIMIZATION_JOURNAL);
	return validateOptimizationJournal(stored === undefined ? empty() : stored, scene.id);
}

function authority(scene, expected, isCurrent) {
	assertNoPendingPathOperation(scene);
	if (!game.user?.isGM || !id(game.user.id) || game.users?.activeGM?.id !== game.user.id) {
		throw new Error('Optimization writes require the currently designated active GM.');
	}
	if (!scene || game.scenes?.get(scene.id) !== scene || !scene.canUserModify(game.user, 'update')) {
		throw new Error('Optimization Scene update permission/identity changed.');
	}
	if (scene.getFlag(MODULE, 'projectImportJournal')) throw new Error('Resolve the unfinished import before optimization.');
	if (typeof isCurrent !== 'function' || !isCurrent()) throw new Error('Optimization reviewed context changed.');
	if (!same(readOptimizationJournal(scene), expected)) throw new Error('Optimization journal changed; stale write refused.');
}

/** Intent/phase writes are not atomic CAS. Never continue native mutations after uncertain persistence. */
export class UnverifiedOptimizationJournalError extends Error {
	constructor(sceneId, token, cause) {
		super(`Optimization journal write is unverified for ${sceneId}/${token}: ${cause.message}. Re-read and reconcile before retrying.`, { cause });
		this.name = 'UnverifiedOptimizationJournalError';
		this.sceneId = sceneId;
		this.token = token;
	}
}

async function write(scene, before, entries, token, isCurrent) {
	authority(scene, before, isCurrent);
	if (before.revision === Number.MAX_SAFE_INTEGER) throw new Error('Optimization journal revision exhausted.');
	const next = validateOptimizationJournal({ version: 1, revision: before.revision + 1, entries }, scene.id);
	try {
		await scene.update({ [`flags.${MODULE}.${OPTIMIZATION_JOURNAL}`]: next }, { diff: false, [LAYER_OPERATION]: true });
		authority(scene, next, isCurrent);
	} catch (error) { throw new UnverifiedOptimizationJournalError(scene.id, token, error); }
	return next;
}

async function verify(check, entry) {
	if (typeof check !== 'function' || await check(structuredClone(entry)) !== true) {
		throw new Error('Optimization phase evidence was not verified.');
	}
}

/** Persist before upload/native writes. The caller must verify the reviewed sources and archive intent. */
export function beginOptimizationOperation(scene, expected, intent, { isCurrent, verifyIntent } = {}) {
	return runLayerOperation(scene, async () => {
		const before = validateOptimizationJournal(expected, scene.id);
		authority(scene, before, isCurrent);
		const entry = validateEntry(intent, scene.id);
		if (entry.ownerId !== game.user.id || entry.phase !== 'intent'
			|| !scene.levels?.has(entry.levelId) || before.entries.some(item => item.phase !== 'complete')) {
			throw new Error('Optimization intent requires its active GM owner, existing Level and no unfinished operation.');
		}
		validateOptimizationJournal({ ...before, entries: [...before.entries, entry] }, scene.id);
		await verify(verifyIntent, entry);
		authority(scene, before, isCurrent);
		if (!scene.levels?.has(entry.levelId)) throw new Error('Optimization source Level was removed.');
		return write(scene, before, [...before.entries, entry], entry.token, isCurrent);
	});
}

/** Evidence callbacks must inspect native/file state; a journal phase alone never authorizes deletion. */
export function advanceOptimizationOperation(scene, expected, token, nextPhase, { isCurrent, verifyPhase } = {}) {
	return runLayerOperation(scene, async () => {
		const before = validateOptimizationJournal(expected, scene.id);
		authority(scene, before, isCurrent);
		const entry = before.entries.find(item => item.token === token);
		if (!entry || entry.ownerId !== game.user.id || entry.phase === 'complete'
			|| !scene.levels?.has(entry.levelId)
			|| phases[entry.action][phases[entry.action].indexOf(entry.phase) + 1] !== nextPhase) {
			throw new Error('Optimization phase transition is not the next owned unfinished step.');
		}
		const next = { ...entry, phase: nextPhase };
		await verify(verifyPhase, next);
		authority(scene, before, isCurrent);
		if (!scene.levels?.has(entry.levelId)) throw new Error('Optimization source Level was removed.');
		return write(scene, before, before.entries.map(item => item.token === token ? next : item), token, isCurrent);
	});
}

/** Explicit recovery handoff only after the prior owner disconnects; it never changes the phase. */
export function takeOverOptimizationOperation(scene, expected, token, { isCurrent, verifyRecovery } = {}) {
	return runLayerOperation(scene, async () => {
		const before = validateOptimizationJournal(expected, scene.id);
		authority(scene, before, isCurrent);
		const entry = before.entries.find(item => item.token === token);
		if (!entry || entry.phase === 'complete' || entry.ownerId === game.user.id
			|| game.users.get(entry.ownerId)?.active) throw new Error('Optimization recovery owner is still active or no handoff is needed.');
		await verify(verifyRecovery, entry);
		authority(scene, before, isCurrent);
		if (game.users.get(entry.ownerId)?.active) throw new Error('Optimization recovery owner reconnected.');
		const next = { ...entry, ownerId: game.user.id };
		return write(scene, before, before.entries.map(item => item.token === token ? next : item), token, isCurrent);
	});
}
