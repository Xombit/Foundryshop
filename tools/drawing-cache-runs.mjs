export { planDrawingCacheRuns } from '../scripts/render_cache_admission.js';

const activeRoots = new WeakSet();

/** Execute temporary replacement on owned detached fixtures only; source parents/order are never changed. */
export function withDetachedDrawingRuns(root, runs, replacements, render) {
	if (root.parent || root.inPrimary) throw new Error('Cache-run replacement requires a detached root.');
	if (activeRoots.has(root)) throw new Error('Cache-run rendering may not reenter.');
	if (!Array.isArray(runs) || !Array.isArray(replacements) || runs.length !== replacements.length
		|| typeof render !== 'function') throw new TypeError('A replacement is required for every ordered run.');
	const originals = [...root.children], states = originals.map(child => child.renderable);
	const selected = new Set(), usedReplacements = new Set();
	for (let i = 0; i < runs.length; i++) {
		const run = runs[i], replacement = replacements[i];
		if (!replacement || replacement.parent || usedReplacements.has(replacement)
			|| !Number.isInteger(run.start) || run.start < 0 || !run.ids.length
			|| run.interface || run.elevation !== (root.elevation ?? 0)) {
			throw new Error('Invalid detached run replacement.');
		}
		usedReplacements.add(replacement);
		for (let j = 0; j < run.ids.length; j++) {
			const source = originals[run.start + j];
			if (!source || source.name !== run.ids[j] || selected.has(source)) {
				throw new Error('Cache-run snapshot is stale or overlapping.');
			}
			selected.add(source);
		}
	}
	const added = [];
	activeRoots.add(root);
	try {
		// Insert before the first source, retaining stable ties with interleaved barriers.
		for (let i = runs.length - 1; i >= 0; i--) {
			const replacement = replacements[i], run = runs[i];
			replacement.sortLayer = run.sortLayer;
			replacement.sort = run.sort;
			replacement.zIndex = run.zIndex;
			added.push(replacement);
			root.addChildAt(replacement, root.children.indexOf(originals[run.start]));
		}
		for (const source of selected) source.renderable = false;
		root.sortChildren();
		const result = render();
		if (result && typeof result.then === 'function') throw new TypeError('Run rendering must be synchronous.');
		return result;
	} finally {
		activeRoots.delete(root);
		const errors = [];
		for (const replacement of added) {
			if (replacement.parent !== root) continue;
			try { root.removeChild(replacement); }
			catch (error) { errors.push(error); }
		}
		for (let i = 0; i < originals.length; i++) originals[i].renderable = states[i];
		// The native sorter must retain source identities/order after replacement removal.
		if (root.children.length !== originals.length || originals.some((source, i) => root.children[i] !== source)) {
			errors.push(new Error('Detached replacement changed the source stack.'));
		}
		if (errors.length) throw new AggregateError(errors, 'Detached cache-run restoration failed.');
	}
}
