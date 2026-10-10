import { MODULE } from '../constants.js';
import { canonicalJson } from './project_package.js';
import { readLayerWorkspace } from './layer_manager.js';
import { emptyLayerTree } from './layer_tree_store.js';
import { readOptimizationJournal } from './optimization_journal.js';
import { readStoredOptimizationArchive } from './optimization_recovery.js';
import { inspectJournaledOptimization } from './optimization_reconciliation.js';
import { optimizationSceneGrid } from './optimization_scene_data.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const phases = {
	apply: ['intent', 'assets-verified', 'replacement-staged', 'sources-removed', 'complete'],
	restore: ['intent', 'assets-verified', 'originals-staged', 'replacement-reverted', 'complete'],
};
const sources = collection => [...collection.values()].map(doc => doc.toObject()).sort((a, b) => a._id.localeCompare(b._id));

function snapshot(scene, levelId, payload) {
	const owned = new Set(payload?.originals.map(source => source._id) ?? []);
	const replacement = payload?.replacement;
	if (replacement?.type === 'Drawing') owned.add(replacement.id);
	const level = scene.levels.get(levelId)?.toObject() ?? null;
	return canonicalJson({
		width: scene.width, height: scene.height, padding: scene.padding, grid: optimizationSceneGrid(scene),
		level: replacement?.type === 'LevelBackground' && level ? { ...level, background: null, textures: null } : level,
		otherLevels: sources(scene.levels).filter(source => source._id !== levelId),
		layers: scene.getFlag(MODULE, 'layers') ?? emptyLayerTree(), workspace: readLayerWorkspace(scene),
		drawings: sources(scene.drawings).filter(source => !owned.has(source._id)),
		tiles: sources(scene.tiles).filter(source => replacement?.type !== 'Tile' || source._id !== replacement.id),
		import: scene.getFlag(MODULE, 'projectImportJournal') ?? null,
	});
}

/** Full pre-execution state for asynchronous entry-point evidence reads. */
export function captureOptimizationExecutionContext(scene, levelId) {
	return snapshot(scene, levelId);
}

function selected(readSelection) {
	const ids = readSelection();
	if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
		throw new Error('Execution selection requires exact unique Drawing identities.');
	}
	return [...ids].sort();
}

function assertNativeState(scene, payload, action, phase) {
	const { replacement, originals } = payload;
	const states = originals.map(original => {
		const live = scene.drawings.get(original._id)?.toObject();
		if (!live) return 'missing';
		if (same(live, original)) return 'original';
		if (action === 'restore' && same(live, { ...original, hidden: true })) return 'staged';
		throw new Error(`Execution original ${original._id} changed or its identity is occupied.`);
	});
	const live = replacement.type === 'LevelBackground' ? scene.levels.get(payload.levelId)?.toObject()
		: (replacement.type === 'Drawing' ? scene.drawings : scene.tiles).get(replacement.id)?.toObject();
	const state = !live ? 'absent' : same(live, replacement.after) ? 'after'
		: same(live, replacement.staged) ? 'staged'
			: replacement.type === 'LevelBackground' && same(live, replacement.before) ? 'before' : 'conflict';
	const ready = state === 'staged' || state === 'after';
	const reverted = state === (replacement.type === 'LevelBackground' ? 'before' : 'absent');
	const allOriginal = states.every(state => state === 'original');
	const allPresent = states.every(state => state !== 'missing');
	const allMissing = states.every(state => state === 'missing');
	let valid;
	if (action === 'apply') {
		const safelyStaged = replacement.type === 'LevelBackground' ? state === 'after'
			: state === 'staged' || state === 'after' && same(replacement.staged, replacement.after);
		if (phase === 'intent') valid = allOriginal && reverted;
		else if (phase === 'assets-verified') valid = allOriginal && (reverted || safelyStaged);
		else if (phase === 'replacement-staged') valid = safelyStaged;
		else if (phase === 'sources-removed') valid = allMissing && ready;
		else valid = allMissing && state === 'after';
	} else {
		if (phase === 'intent') valid = ready;
		else if (phase === 'assets-verified') valid = ready;
		else if (phase === 'originals-staged') valid = allPresent && (ready || reverted);
		else if (phase === 'replacement-reverted') valid = allPresent && reverted;
		else valid = allOriginal && reverted;
	}
	if (!valid) throw new Error(`Native execution state does not match reviewed ${action}/${phase}; reconcile again.`);
	return { states, replacementState: state };
}

/** Fresh read-only apply/restore review, including partial writes left behind by an interrupted executor. */
export async function reviewOptimizationExecution(scene, token, {
	isCurrent, verifyOutput, readSelection, signal, timeout = 30000,
} = {}) {
	if (typeof isCurrent !== 'function' || typeof verifyOutput !== 'function'
		|| readSelection !== undefined && typeof readSelection !== 'function') {
		throw new Error('Execution review requires explicit context/output acceptance and a valid optional selection reader.');
	}
	const journal = readOptimizationJournal(scene), entry = journal.entries.find(item => item.token === token);
	if (!entry || entry !== journal.entries.at(-1) || entry.phase === 'complete') {
		throw new Error('Execution review requires the final unfinished durable operation.');
	}
	const owner = game.user?.id;
	const authority = () => {
		if (!game.user?.isGM || game.user.id !== owner || entry.ownerId !== owner || game.users?.activeGM?.id !== owner
			|| game.scenes?.get(scene.id) !== scene || !scene.canUserModify(game.user, 'update')
			|| !scene.levels?.has(entry.levelId) || signal?.aborted || !isCurrent()) {
			throw new Error('Execution review authority/Scene/Level/context changed or was cancelled.');
		}
	};
	authority();
	const fullBaseline = snapshot(scene, entry.levelId);
	let selection = readSelection ? selected(readSelection) : null;
	const strict = () => {
		authority();
		if (!same(readOptimizationJournal(scene), journal) || snapshot(scene, entry.levelId) !== fullBaseline
			|| selection && !same(selected(readSelection), selection)) {
			throw new Error('Execution review changed during evidence verification; review again.');
		}
		return true;
	};
	const options = { isCurrent: strict, verifyOutput, signal, timeout };
	const inspected = await inspectJournaledOptimization(scene, token, options);
	const { payload } = await readStoredOptimizationArchive(entry.archive, options);
	strict();
	const initialState = assertNativeState(scene, payload, entry.action, entry.phase);
	const baseline = snapshot(scene, entry.levelId, payload), order = phases[entry.action];
	const start = order.indexOf(entry.phase), originalIds = payload.originals.map(source => source._id).sort();
	const publicReview = { token, sceneId: scene.id, levelId: entry.levelId, action: entry.action, phase: entry.phase,
		sourceIds: originalIds, replacementType: payload.replacement.type, replacementId: payload.replacement.id,
		presentSourceIds: inspected.originals.present, missingSourceIds: inspected.originals.missing,
		stagedSourceIds: inspected.stagedOriginalIds, replacementState: initialState.replacementState,
		layerRevisionChange: inspected.layerRevisionChange,
		disclosure: 'Resume only this exact operation. Own native transitions are allowed; unrelated sources, workspace, Level and journal changes invalidate approval. Files and native placement must be reverified by the executor.' };
	return {
		review: structuredClone(publicReview),
		approve({ sourceIds, resumeOperation } = {}) {
			strict();
			if (resumeOperation !== true || !Array.isArray(sourceIds) || !same([...sourceIds].sort(), originalIds)) {
				throw new Error('Approve resuming this exact operation and all archived source identities.');
			}
			let furthest = start;
			return {
				acceptBackgroundRedraw() {
					authority();
					const phase = readOptimizationJournal(scene).entries.at(-1)?.phase;
					if (payload.replacement.type !== 'LevelBackground'
						|| phase !== (entry.action === 'apply' ? 'assets-verified' : 'originals-staged')
						|| assertNativeState(scene, payload, entry.action, phase).replacementState
							!== (entry.action === 'apply' ? 'after' : 'before')) {
						throw new Error('Selection reset requires this operation\'s native background redraw.');
					}
					if (!selection) return;
					const now = selected(readSelection), expected = selection.filter(id => scene.drawings.has(id));
					if (now.length && !same(now, expected)) throw new Error('Unexpected selection after background redraw.');
					const before = selection;
					selection = now;
					try { this.assertCurrent(); }
					catch (error) { selection = before; throw error; }
				},
				assertOperation(candidateScene, candidateToken) {
					authority();
					if (candidateScene !== scene || candidateToken !== token) {
						throw new Error('Execution approval belongs to a different Scene/operation token.');
					}
					return true;
				},
				assertCurrent() {
					authority();
					const now = readOptimizationJournal(scene), current = now.entries.at(-1);
					const index = order.indexOf(current?.phase);
					if (index < furthest || !same({ ...current, phase: entry.phase }, entry)
						|| now.revision !== journal.revision + index - start || now.entries.length !== journal.entries.length
						|| !same(now.entries.slice(0, -1), journal.entries.slice(0, -1))
						|| snapshot(scene, entry.levelId, payload) !== baseline) {
						throw new Error('Execution approval is stale: unrelated native/workspace/journal changes or phase regression.');
					}
					assertNativeState(scene, payload, entry.action, current.phase);
					if (selection) {
						// Foundry deselects deleted originals; unrelated selection changes still invalidate approval.
						const expected = selection.filter(id => scene.drawings.has(id));
						if (!same(selected(readSelection), expected)) throw new Error('Execution selection changed outside owned source removal.');
					}
					furthest = index;
					return true;
				},
			};
		},
	};
}
