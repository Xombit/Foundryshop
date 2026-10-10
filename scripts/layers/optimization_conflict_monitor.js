import { canonicalJson } from './project_package.js';
import { readOptimizationJournal } from './optimization_journal.js';

/** Client-side fail-closed detection of competing durable optimization journals; this is not a distributed lock. */
export function monitorOptimizationConflicts(scene, {
	baseline = readOptimizationJournal(scene), allowedTokens = [], ownerTransfers = {},
} = {}) {
	if (!scene || !Array.isArray(allowedTokens) || allowedTokens.some(token => typeof token !== 'string')
		|| !ownerTransfers || typeof ownerTransfers !== 'object' || Array.isArray(ownerTransfers)
		|| typeof globalThis.Hooks?.on !== 'function' || typeof globalThis.Hooks?.off !== 'function') {
		throw new Error('Optimization conflict monitoring requires a Scene and Foundry Hook support.');
	}
	const expected = readOptimizationJournal(scene);
	if (canonicalJson(expected) !== canonicalJson(baseline)) {
		throw new Error('Optimization conflict monitor baseline is stale.');
	}
	const allowed = new Set([...baseline.entries.map(entry => entry.token), ...allowedTokens]);
	const initialOwners = new Map(baseline.entries.map(entry => [entry.token, entry.ownerId]));
	const initialEntries = new Map(baseline.entries.map(entry => [entry.token,
		canonicalJson({ ...entry, ownerId: null, phase: null })]));
	let conflict = null;
	const observe = updated => {
		if (updated?.id !== scene.id || conflict) return;
		if (updated !== scene) {
			conflict = new Error('The reviewed Scene document identity changed.');
			return;
		}
		try {
			const journal = readOptimizationJournal(scene);
			const currentEntries = new Map(journal.entries.map(entry => [entry.token, entry]));
			for (const [token, descriptor] of initialEntries) {
				const current = currentEntries.get(token);
				if (!current || canonicalJson({ ...current, ownerId: null, phase: null }) !== descriptor) {
					throw new Error('An existing optimization recovery descriptor changed during this review.');
				}
			}
			for (const entry of journal.entries) {
				if (!allowed.has(entry.token)) {
					throw new Error('Another optimization journal entry appeared during this review.');
				}
				const initialOwner = initialOwners.get(entry.token);
				const expectedOwner = Object.hasOwn(ownerTransfers, entry.token) ? ownerTransfers[entry.token] : initialOwner;
				if (expectedOwner !== undefined && (Array.isArray(expectedOwner)
					? !expectedOwner.includes(entry.ownerId) : entry.ownerId !== expectedOwner)) {
					throw new Error('Optimization operation ownership changed during this review.');
				}
			}
		} catch (error) { conflict = error; }
	};
	const hookId = globalThis.Hooks.on('updateScene', observe);
	let closed = false;
	return {
		assertCurrent() {
			if (closed) throw new Error('Optimization conflict monitor is closed.');
			observe(scene);
			if (conflict) throw new Error(`Optimization conflict detected; review again. ${conflict.message}`, { cause: conflict });
			return true;
		},
		close() {
			if (closed) return;
			closed = true;
			globalThis.Hooks.off('updateScene', hookId);
		},
	};
}
