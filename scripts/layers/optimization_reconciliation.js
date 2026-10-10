import { canonicalJson } from './project_package.js';
import { readOptimizationJournal } from './optimization_journal.js';
import {
	readStoredOptimizationArchive, optimizationArchiveDescriptor, inspectOptimizationRecovery,
} from './optimization_recovery.js';
import { readVerifiedFile } from '../verified_file_storage.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);

/** File/native evidence only. Does not decode images, mutate documents or advance journal phases. */
export async function inspectJournaledOptimization(scene, token, {
	signal, isCurrent, timeout = 30000, verifyOutput,
} = {}) {
	if (typeof isCurrent !== 'function') throw new Error('Optimization reconciliation requires an explicit reviewed-context guard.');
	const journal = readOptimizationJournal(scene), entry = journal.entries.find(item => item.token === token);
	if (!entry) throw new Error('Optimization recovery operation is missing from the Scene journal.');
	const check = () => {
		if (!game.user?.isGM || signal?.aborted || !isCurrent() || !same(readOptimizationJournal(scene), journal)) {
			throw new Error('Optimization journal/authority/context changed during reconciliation.');
		}
		return true;
	};
	check();
	const options = { signal, isCurrent: check, timeout };
	const { payload, text } = await readStoredOptimizationArchive(entry.archive, options);
	const descriptor = await optimizationArchiveDescriptor(text);
	if (payload.sceneId !== scene.id || payload.levelId !== entry.levelId
		|| payload.id !== (entry.action === 'apply' ? entry.token : entry.parentToken)
		|| !same(descriptor, {
			archiveChecksum: entry.archiveChecksum, sourceCount: entry.sourceCount,
			sourceDigest: entry.sourceDigest, asset: entry.asset, replacement: entry.replacement,
		})) throw new Error('Typed recovery archive does not match journaled operation identity/state digests.');
	if (entry.action === 'apply') {
		const parent = entry.parentToken === null ? null : journal.entries.find(item => item.token === entry.parentToken);
		if (parent ? !same(payload.parent, { file: parent.archive, checksum: parent.archiveChecksum }) : payload.parent !== null) {
			throw new Error('Typed recovery lineage does not match the retained journal parent.');
		}
	}
	const outputBytes = await readVerifiedFile(entry.asset, options);
	if (verifyOutput !== undefined && (typeof verifyOutput !== 'function'
		|| await verifyOutput(outputBytes, structuredClone(entry.asset)) !== true)) {
		throw new Error('Persisted optimization output decode/render acceptance was not verified.');
	}
	if (payload.originalBackground) await readVerifiedFile(payload.originalBackground.file, options);
	check();
	// Inspect native state only after asynchronous file verification; no stale pre-upload native snapshot is reused.
	const native = await inspectOptimizationRecovery(scene, text, {
		allowStagedOriginals: entry.action === 'restore', allowLayerRevisionChange: entry.action === 'restore',
	});
	check();
	return { ...native, token, action: entry.action, phase: entry.phase, verifiedFiles: true,
		outputAccepted: typeof verifyOutput === 'function' };
}

/** A real evidence callback for journal transitions; image decode/render acceptance remains separately required. */
export async function verifyJournaledOptimizationPhase(scene, proposed, options) {
	if (typeof options?.verifyOutput !== 'function') throw new Error('Phase verification requires explicit persisted-output decode/render acceptance.');
	const stored = readOptimizationJournal(scene).entries.find(entry => entry.token === proposed.token);
	if (!stored || !same({ ...proposed, phase: stored.phase }, stored)) {
		throw new Error('Proposed phase changed immutable optimization intent.');
	}
	const inspected = await inspectJournaledOptimization(scene, proposed.token, options);
	if (!same(readOptimizationJournal(scene).entries.find(entry => entry.token === proposed.token), stored)) {
		throw new Error('Optimization journal changed during phase verification.');
	}
	const allPresent = inspected.originals.missing.length === 0 && inspected.stagedOriginalIds.length === 0;
	const allRestoredOrStaged = inspected.originals.missing.length === 0;
	const allMissing = inspected.originals.present.length === 0 && inspected.stagedOriginalIds.length === 0;
	const replacementReady = ['staged', 'after'].includes(inspected.replacementState);
	const reverted = ['before', 'absent'].includes(inspected.replacementState);
	let verified = false;
	if (proposed.action === 'apply') {
		if (proposed.phase === 'assets-verified') verified = allPresent;
		else if (proposed.phase === 'replacement-staged') verified = replacementReady;
		else if (proposed.phase === 'sources-removed') verified = allMissing && replacementReady;
		else if (proposed.phase === 'complete') verified = allMissing && inspected.replacementState === 'after';
	} else {
		if (proposed.phase === 'assets-verified') verified = !inspected.requiresReplacementRecovery;
		else if (['originals-staged', 'replacement-reverted'].includes(proposed.phase)) verified = allRestoredOrStaged
			&& (proposed.phase === 'originals-staged' || reverted);
		else if (proposed.phase === 'complete') verified = allPresent && reverted;
	}
	if (!verified) throw new Error(`Native recovery state does not verify optimization phase ${proposed.phase}.`);
	return true;
}
