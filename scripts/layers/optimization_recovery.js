import { MODULE } from '../constants.js';
import { canonicalJson } from './project_package.js';
import { optimizationSceneGrid } from './optimization_scene_data.js';
import { emptyLayerTree, validateLayerTree } from './layer_tree_store.js';
import { fileFingerprint, validateStoredFile, persistVerifiedFile, readVerifiedFile } from '../verified_file_storage.js';

export const OPTIMIZATION_ARCHIVE_FORMAT = 'foundryshop-optimization-recovery';
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const checksum = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
	&& Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const digest = value => fileFingerprint(new TextEncoder().encode(canonicalJson(value)));

function json(value, depth = 0) {
	if (depth > 64) throw new Error('Recovery metadata nesting exceeds 64 levels.');
	if (value === null || typeof value === 'string' || typeof value === 'boolean'
		|| typeof value === 'number' && Number.isFinite(value)) return;
	if (!value || typeof value !== 'object' || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(value))) {
		throw new Error('Recovery sources must contain exact round-trippable plain JSON values.');
	}
	if (Array.isArray(value) && (Object.keys(value).length !== value.length
		|| Array.from({ length: value.length }, (_, index) => index).some(index => !Object.hasOwn(value, index)))) {
		throw new Error('Sparse/custom recovery arrays cannot round-trip exactly.');
	}
	for (const [key, child] of Object.entries(value)) {
		if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe recovery metadata key.');
		json(child, depth + 1);
	}
}

function source(value, levelId, { drawing = false } = {}) {
	if (!value || !id(value._id) || !Array.isArray(value.levels) || value.levels.length !== 1
		|| value.levels[0] !== levelId || !value.flags || Array.isArray(value.flags)
		|| drawing && (!id(value.author) || !value.shape || typeof value.shape.type !== 'string')) {
		throw new Error('Recovery requires native sources with exact identities on one explicit Level.');
	}
}

function context(scene, levelId) {
	const level = scene.levels?.get(levelId);
	if (!level) throw new Error('Recovery source Level is missing.');
	return {
		scene: { width: scene.width, height: scene.height, padding: scene.padding,
			grid: optimizationSceneGrid(scene) },
		layers: validateLayerTree(scene.getFlag(MODULE, 'layers') ?? emptyLayerTree()), level: level.toObject(),
	};
}

function requireScene(scene, levelId) {
	if (!game.user?.isGM || !scene || !scene.levels?.has(levelId)
		|| scene.getFlag(MODULE, 'projectImportJournal')) throw new Error('Recovery requires GM access, an existing Level and no unfinished import.');
}

export function validateOptimizationArchive(payload) {
	json(payload);
	if (!exact(payload, ['format', 'version', 'id', 'sceneId', 'levelId', 'scope', 'context',
		'originals', 'replacement', 'output', 'originalBackground', 'parent'])
		|| payload.format !== OPTIMIZATION_ARCHIVE_FORMAT || payload.version !== 1
		|| ![payload.id, payload.sceneId, payload.levelId].every(id)
		|| !exact(payload.scope, ['kind', 'layerId']) || !['layer', 'selection', 'all'].includes(payload.scope.kind)
		|| (payload.scope.kind === 'layer' ? !id(payload.scope.layerId) : payload.scope.layerId !== null)
		|| !exact(payload.context, ['scene', 'layers', 'level'])
		|| !exact(payload.context.scene, ['width', 'height', 'padding', 'grid'])
		|| ![payload.context.scene.width, payload.context.scene.height].every(value => Number.isFinite(value) && value > 0)
		|| !Number.isFinite(payload.context.scene.padding) || payload.context.scene.padding < 0
		|| !payload.context.scene.grid || payload.context.level?._id !== payload.levelId
		|| !Array.isArray(payload.originals) || !payload.originals.length) {
		throw new Error('Invalid typed optimization recovery archive.');
	}
	const tree = validateLayerTree(payload.context.layers);
	if (!same(tree, payload.context.layers)) throw new Error('Recovery layer context must be canonical and complete.');
	const ids = new Set();
	for (const original of payload.originals) {
		source(original, payload.levelId, { drawing: true });
		if (ids.has(original._id)) throw new Error('Duplicate original Drawing identity.');
		ids.add(original._id);
		const membership = original.flags[MODULE]?.layerId ?? null;
		if (membership !== null && !tree.nodes.some(node => node.id === membership && node.kind === 'layer')
			|| payload.scope.kind === 'layer' && membership !== payload.scope.layerId) {
			throw new Error('Original Drawing membership does not match the reviewed recovery scope.');
		}
	}
	const output = validateStoredFile(payload.output), replacement = payload.replacement;
	if (!exact(replacement, ['type', 'id', 'before', 'staged', 'after']) || !id(replacement.id)
		|| !['Drawing', 'Tile', 'LevelBackground'].includes(replacement.type)) throw new Error('Invalid typed recovery replacement.');
	if (replacement.type === 'LevelBackground') {
		if (replacement.id !== payload.levelId || replacement.staged !== null
			|| !same(replacement.before, payload.context.level) || replacement.after?._id !== payload.levelId
			|| replacement.after.background?.src !== output.path
			|| !same({ ...replacement.before, background: null, textures: null },
				{ ...replacement.after, background: null, textures: null })) {
			throw new Error('Background replacement must retain unrelated native Level settings.');
		}
		if (typeof replacement.before.background?.src !== 'string' && replacement.before.background?.src !== null) {
			throw new Error('Original background source must be explicit.');
		}
		if (replacement.before.background.src) {
			if (!exact(payload.originalBackground, ['src', 'file'])
				|| payload.originalBackground.src !== replacement.before.background.src
				|| validateStoredFile(payload.originalBackground.file).path === output.path
				|| payload.originalBackground.file.path === payload.originalBackground.src) {
				throw new Error('Background recovery requires a distinct preserved original byte-copy reference.');
			}
		} else if (payload.originalBackground !== null) throw new Error('Color-only backgrounds do not have an original image file.');
	} else {
		if (replacement.before !== null || ids.has(replacement.id) || payload.originalBackground !== null) {
			throw new Error('New Drawing/Tile replacement must be distinct from originals.');
		}
		for (const state of [replacement.staged, replacement.after]) {
			source(state, payload.levelId, { drawing: replacement.type === 'Drawing' });
			if (state._id !== replacement.id || typeof state.hidden !== 'boolean'
				|| (replacement.type === 'Drawing' ? state.texture : state.texture?.src) !== output.path) {
				throw new Error('Replacement identity/texture does not match the baked output.');
			}
		}
		if (replacement.staged.hidden !== true || !same({ ...replacement.staged, hidden: null }, { ...replacement.after, hidden: null })) {
			throw new Error('Replacement staging may differ only in native hidden state.');
		}
	}
	if (payload.parent !== null) {
		if (!exact(payload.parent, ['file', 'checksum']) || !checksum(payload.parent.checksum)
			|| !validateStoredFile(payload.parent.file).path.endsWith('.json')
			|| payload.parent.file.path === output.path) throw new Error('Invalid immutable recovery lineage reference.');
	}
	return structuredClone(payload);
}

function assertOriginals(scene, payload) {
	requireScene(scene, payload.levelId);
	if (scene.id !== payload.sceneId || !same(context(scene, payload.levelId), payload.context)
		|| payload.originals.some(original => !same(scene.drawings.get(original._id)?.toObject(), original))) {
		throw new Error('Recovery source/context changed during preparation or persistence.');
	}
	if (payload.replacement.type !== 'LevelBackground') {
		const collection = payload.replacement.type === 'Drawing' ? scene.drawings : scene.tiles;
		if (collection.has(payload.replacement.id)) throw new Error('Recovery replacement identity is occupied.');
	}
}

/** Native document sources are preserved, not converted to an interchange project or normalized. */
export async function createOptimizationArchive(scene, selectedIds, replacement, {
	token, levelId, scope, output, originalBackground = null, parent = null,
} = {}) {
	requireScene(scene, levelId);
	if (!Array.isArray(selectedIds) || !selectedIds.length || new Set(selectedIds).size !== selectedIds.length
		|| selectedIds.some(value => !id(value) || !scene.drawings.has(value))) throw new Error('Recovery requires unique existing source IDs.');
	const payload = validateOptimizationArchive({
		format: OPTIMIZATION_ARCHIVE_FORMAT, version: 1, id: token, sceneId: scene.id, levelId,
		scope: structuredClone(scope), context: context(scene, levelId),
		originals: [...selectedIds].sort().map(value => scene.drawings.get(value).toObject()),
		replacement: structuredClone(replacement), output: structuredClone(output),
		originalBackground: structuredClone(originalBackground), parent: structuredClone(parent),
	});
	const archive = await encodeOptimizationArchive(payload);
	assertOriginals(scene, payload);
	return archive;
}

/** Rebuild immutable evidence after an explicitly reviewed source/destination transformation. */
export async function encodeOptimizationArchive(input) {
	const payload = validateOptimizationArchive(input);
	const hash = await digest(payload), sourceDigest = await digest(payload.originals);
	return { text: JSON.stringify({ payload, checksum: hash }), checksum: hash, sourceDigest, sourceCount: payload.originals.length };
}

export async function readOptimizationArchive(text) {
	if (typeof text !== 'string') throw new Error('Recovery archive must be JSON text.');
	const envelope = JSON.parse(text);
	if (!exact(envelope, ['payload', 'checksum']) || !checksum(envelope.checksum)) throw new Error('Invalid recovery archive envelope.');
	const payload = validateOptimizationArchive(envelope.payload);
	if (await digest(payload) !== envelope.checksum) throw new Error('Recovery archive checksum mismatch.');
	return { payload, checksum: envelope.checksum };
}

/** Produces the immutable digests required by the operation journal. */
export async function optimizationArchiveDescriptor(text) {
	const { payload, checksum: hash } = await readOptimizationArchive(text);
	const { replacement } = payload;
	return {
		archiveChecksum: hash, sourceCount: payload.originals.length, sourceDigest: await digest(payload.originals),
		asset: structuredClone(payload.output),
		replacement: {
			type: replacement.type, id: replacement.id,
			beforeDigest: replacement.before === null ? null : await digest(replacement.before),
			stagedDigest: replacement.staged === null ? null : await digest(replacement.staged),
			afterDigest: await digest(replacement.after),
		},
	};
}

/** Prepared file reference belongs in durable intent before upload. */
export async function prepareOptimizationArchiveFile(text, root) {
	const { payload } = await readOptimizationArchive(text);
	const bytes = new TextEncoder().encode(text);
	const reference = validateStoredFile({
		version: 1, root, path: `${root}/recovery-${payload.id}.json`, bytes: bytes.length,
		fingerprint: await fileFingerprint(bytes),
	});
	if ([payload.output.path, payload.originalBackground?.file.path, payload.parent?.file.path].includes(reference.path)) {
		throw new Error('Recovery archive path must be distinct from output, original backup and parent archive.');
	}
	return reference;
}

export async function persistOptimizationArchive(scene, text, reference, { signal, isCurrent } = {}) {
	if (typeof isCurrent !== 'function') throw new Error('Typed recovery persistence requires an explicit journal/context guard.');
	const expected = validateStoredFile(reference), { payload } = await readOptimizationArchive(text);
	const prepared = await prepareOptimizationArchiveFile(text, expected.root);
	if (!same(prepared, expected)) throw new Error('Typed recovery bytes differ from journaled file intent.');
	const check = () => { assertOriginals(scene, payload); return isCurrent(); };
	return persistVerifiedFile(new Blob([text], { type: 'application/json' }), {
		root: expected.root, filename: expected.path.slice(expected.root.length + 1), signal, isCurrent: check,
	});
}

export async function readStoredOptimizationArchive(reference, options = {}) {
	const file = validateStoredFile(reference);
	if (!file.path.endsWith('.json')) throw new Error('Typed recovery file must be JSON.');
	const bytes = await readVerifiedFile(file, options);
	const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	const archive = await readOptimizationArchive(text);
	if (!game.user?.isGM || !game.user.can('FILES_BROWSE') || options.signal?.aborted
		|| options.isCurrent && !options.isCurrent()) throw new Error('Recovery read authority/context changed.');
	return { ...archive, text };
}

export class OptimizationRecoveryConflictError extends Error {
	constructor(conflicts) {
		super(`Optimization recovery conflicts require review: ${conflicts.join('; ')}.`);
		this.name = 'OptimizationRecoveryConflictError';
		this.conflicts = conflicts;
	}
}

/** Read-only reconciliation: partial missing originals are resumable; altered sources are never overwritten. */
export async function inspectOptimizationRecovery(scene, text, {
	allowStagedOriginals = false, allowLayerRevisionChange = false,
} = {}) {
	if (!game.user?.isGM) throw new Error('Recovery inspection requires GM access.');
	const { payload, checksum: hash } = await readOptimizationArchive(text);
	requireScene(scene, payload.levelId);
	if (scene.id !== payload.sceneId) throw new Error('Recovery archive belongs to another Scene.');
	const now = context(scene, payload.levelId), conflicts = [];
	const layerRevisionChange = !same(now.layers, payload.context.layers)
		&& allowLayerRevisionChange === true && now.layers.revision > payload.context.layers.revision
		&& same({ ...now.layers, revision: payload.context.layers.revision }, payload.context.layers)
		? { archived: payload.context.layers.revision, current: now.layers.revision } : null;
	if (!same(now.scene, payload.context.scene) || !same(now.layers, payload.context.layers) && !layerRevisionChange) {
		conflicts.push('Scene dimensions/grid or layer context changed');
	}
	const present = [], missing = [], staged = [];
	for (const original of payload.originals) {
		const live = scene.drawings.get(original._id);
		if (!live) missing.push(original._id);
		else if (same(live.toObject(), original)) present.push(original._id);
		else if (allowStagedOriginals && same(live.toObject(), { ...original, hidden: true })) staged.push(original._id);
		else conflicts.push(`original ${original._id} was edited or its identity is occupied`);
	}
	const replacement = payload.replacement;
	let state;
	if (replacement.type === 'LevelBackground') {
		if (same(now.level, replacement.before)) state = 'before';
		else if (same(now.level, replacement.after)) state = 'after';
		else { state = 'conflict'; conflicts.push('Level background/settings changed'); }
	} else {
		if (!same(now.level, payload.context.level)) conflicts.push('Native Level context changed');
		const live = (replacement.type === 'Drawing' ? scene.drawings : scene.tiles).get(replacement.id);
		if (!live) state = 'absent';
		else if (same(live.toObject(), replacement.after)) state = 'after';
		else if (same(live.toObject(), replacement.staged)) state = 'staged';
		else { state = 'conflict'; conflicts.push(`${replacement.type} replacement was edited or reassigned`); }
	}
	if (conflicts.length) throw new OptimizationRecoveryConflictError(conflicts);
	const replacementPresent = ['staged', 'after'].includes(state);
	return {
		strategy: 'reconciliation-preview-only', archiveId: payload.id, checksum: hash,
		layerRevisionChange,
		originals: { present, missing }, stagedOriginalIds: staged, replacementState: state,
		canResumeApply: replacementPresent,
		canResumeRestore: present.length === payload.originals.length,
		requiresReplacementRecovery: missing.length > 0 && !replacementPresent,
		disclosure: 'No native writes or asset verification occurred. Re-read verified files and current native state before each journaled mutation.',
	};
}
