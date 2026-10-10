import { validateRecoveryImportIntent } from './recovery_import_intent.js';
import { decodeRecoveryImportEvidence } from './recovery_import_evidence.js';
import { reconstructRecoveryProjectDrawings } from './recovery_project_manifest.js';
import { readOptimizationArchive } from './optimization_recovery.js';
import { assertOptimizationNativeSchemas, assertOptimizationNativeSource } from './optimization_native.js';
import { fileFingerprint, readVerifiedFile } from '../verified_file_storage.js';
import { canonicalJson } from './project_package.js';
import { recoveryImportSceneState } from './recovery_import_scene_state.js';
import { availableProjectFonts } from './project_resources.js';

const fail = message => { throw new Error(`Recovery import reconciliation: ${message}`); };
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const digest = value => fileFingerprint(new TextEncoder().encode(canonicalJson(value)));
const releasePhases = ['releasing', 'history-installed', 'native-released', 'complete'];

async function assertDestinationBaseline(scene, intent, nativeState) {
	const object = structuredClone(scene.toObject());
	if (nativeState.tree === 'after') object.flags.foundryshop.layers = structuredClone(intent.before.layers);
	if (nativeState.presentDrawingIds.length) object.drawings = [];
	if (nativeState.presentTileIds.length) object.tiles = [];
	if (nativeState.history === 'after') delete object.flags.foundryshop.optimizationJournal;
	if (nativeState.level === 'after') {
		if (!Array.isArray(object.levels)) fail('Native Scene Level serialization is unavailable.');
		object.levels = object.levels.map(level => level._id === intent.levelId ? structuredClone(intent.before.level) : level);
	}
	delete object.flags?.foundryshop?.projectImportJournal;
	const candidates = [structuredClone(object)];
	if (!intent.before.layers.nodes.length && !intent.before.layers.presets.length
		&& intent.before.layers.revision === 0 && object.flags?.foundryshop?.layers) {
		delete object.flags.foundryshop.layers;
		candidates.push(structuredClone(object));
	}
	if (object.flags?.foundryshop && !Object.keys(object.flags.foundryshop).length) {
		delete object.flags.foundryshop;
		candidates.push(structuredClone(object));
	}
	if (object.flags && !Object.keys(object.flags).length) {
		delete object.flags;
		candidates.push(object);
	}
	for (const candidate of candidates) if (await digest(recoveryImportSceneState(candidate)) === intent.destinationDigest) return;
	fail('Destination is no longer the exact pre-native import baseline; automatic continuation refused.');
}

async function inspectNativeStaging(scene, intent) {
	const current = scene.getFlag('foundryshop', 'layers') ?? { version: 1, revision: 0, nodes: [], presets: [] };
	const tree = same(current, intent.before.layers) ? 'before' : same(current, intent.after.layers) ? 'after' : 'conflict';
	const releasing = releasePhases.includes(intent.phase), canRelease = releasing && intent.phase !== 'releasing',
		currentLevel = scene.levels.get(intent.levelId)?.toObject(),
		level = same(currentLevel, intent.before.level) ? 'before' : same(currentLevel, intent.after.level) ? 'after' : 'conflict',
		currentHistory = scene.getFlag('foundryshop', 'optimizationJournal'),
		history = currentHistory === undefined ? 'absent' : same(currentHistory, intent.optimization) ? 'after' : 'conflict';
	if (tree === 'conflict' || intent.phase === 'intent' && tree !== 'before'
		|| level === 'conflict' || !canRelease && level !== 'before'
		|| history === 'conflict' || !releasing && history !== 'absent'
		|| canRelease && history !== 'after') {
		fail('Native tree or Level is not an exact retained import state.');
	}
	const result = { tree, level, history, presentDrawingIds: [], presentTileIds: [], missingDrawingIds: [], missingTileIds: [],
		finalDrawingIds: [], finalTileIds: [] };
	for (const [collection, descriptors, present, missing, final] of [
		[scene.drawings, intent.drawings, result.presentDrawingIds, result.missingDrawingIds, result.finalDrawingIds],
		[scene.tiles, intent.tiles, result.presentTileIds, result.missingTileIds, result.finalTileIds],
	]) {
		if ([...collection.keys()].some(id => !descriptors.some(source => source.id === id))) fail('Unowned native artwork appeared; reconciliation refused.');
		for (const descriptor of descriptors) {
			const source = collection.get(descriptor.id)?.toObject();
			if (!source) { missing.push(descriptor.id); continue; }
			const hash = await digest(source);
			if (canRelease && hash === descriptor.afterDigest && source.flags?.foundryshop?.importStaging === undefined) final.push(descriptor.id);
			else if (source.hidden !== true || source.flags?.foundryshop?.importStaging !== intent.token
				|| hash !== descriptor.stagedDigest) fail('Owned native source differs from exact hidden staging or approved final source.');
			if (tree !== 'after' || intent.phase === 'intent') fail('Native source appeared outside its retained tree state.');
			present.push(descriptor.id);
		}
	}
	if (['tree-installed', 'native-staged'].includes(intent.phase) && tree !== 'after'
		|| intent.phase === 'native-staged' && (result.missingDrawingIds.length || result.missingTileIds.length)
		|| intent.phase === 'compensated' && (tree !== 'before' || result.presentDrawingIds.length || result.presentTileIds.length)) {
		fail('Durable staging phase differs from native evidence.');
	}
	if (releasing && (tree !== 'after' || result.missingDrawingIds.length || result.missingTileIds.length)
		|| ['native-released', 'complete'].includes(intent.phase)
			&& (result.finalDrawingIds.length !== intent.drawings.length || result.finalTileIds.length !== intent.tiles.length
				|| !same(currentLevel, intent.after.level))) fail('Durable release phase differs from exact native/history evidence.');
	return result;
}

/** Fresh read-only evidence inspection; no preparation/approval capability or session upload state needed. */
export async function inspectRecoveryImport(scene, {
	isCurrent, signal, timeout = 30000, maxBytes, maxEntries,
} = {}) {
	return inspectRetainedImport(scene, { isCurrent, signal, timeout, maxBytes, maxEntries });
}

/** A returned complete receipt can verify uncertain journal removal; it cannot authorize another write. */
export async function inspectCompletedRecoveryImport(scene, receipt, options = {}) {
	const intent = validateRecoveryImportIntent(receipt, scene?.id);
	if (intent.phase !== 'complete') fail('An exact complete receipt is required.');
	return inspectRetainedImport(scene, options, intent);
}

/** Exact read-only verification after compensated journal removal, including uncertain acknowledgement. */
export async function inspectClearedCompensatedRecoveryImport(scene, receipt, options = {}) {
	const intent = validateRecoveryImportIntent(receipt, scene?.id);
	if (intent.phase !== 'compensated') fail('An exact compensated receipt is required.');
	return inspectRetainedImport(scene, options, intent);
}

async function inspectRetainedImport(scene, {
	isCurrent, signal, timeout = 30000, maxBytes, maxEntries,
} = {}, receipt) {
	if (typeof isCurrent !== 'function' || !Number.isSafeInteger(timeout) || timeout < 0
		|| !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes >= 0xffffffff
		|| !Number.isSafeInteger(maxEntries) || maxEntries < 2 || maxEntries >= 65535) {
		fail('Explicit context, timeout and evidence byte/entry budgets are required.');
	}
	if (!scene) fail('Destination Scene is required.');
	const intent = receipt ?? validateRecoveryImportIntent(scene.getFlag('foundryshop', 'projectImportJournal'), scene.id),
		snapshot = canonicalJson(scene.toObject());
	const check = () => {
		if (!game.user?.isGM || game.user.id !== intent.ownerId || game.users?.activeGM?.id !== intent.ownerId
			|| !game.user.can('FILES_BROWSE') || game.scenes?.get(scene.id) !== scene
			|| !scene.canUserModify(game.user, 'update') || !scene.levels?.has(intent.levelId)
			|| signal?.aborted || !isCurrent() || canonicalJson(scene.toObject()) !== snapshot
			|| (receipt ? scene.getFlag('foundryshop', 'projectImportJournal') !== undefined
				: !same(scene.getFlag('foundryshop', 'projectImportJournal'), intent))) {
			fail('Journal, destination or owner authority/context changed or was cancelled.');
		}
		return true;
	};
	check();
	const references = [intent.bundle, ...intent.uploads],
		total = references.reduce((sum, reference) => sum + reference.bytes, 0);
	if (references.length > maxEntries || !Number.isSafeInteger(total) || total > maxBytes) {
		fail('Retained evidence exceeds the reviewed total byte or entry budget.');
	}
	const nativeState = await inspectNativeStaging(scene, intent);
	check();
	await assertDestinationBaseline(scene, intent, nativeState);
	check();
	if (scene.getFlag('foundryshop', 'recovery') !== undefined) fail('Unexpected native artwork or recovery history is present.');
	const picker = foundry.applications.apps.FilePicker.implementation;
	const listing = await picker.browse('data', intent.bundle.root);
	check();
	if (!Array.isArray(listing.files) || listing.files.some(path => typeof path !== 'string')) fail('Invalid evidence-folder listing.');
	const listed = new Map();
	for (const path of listing.files) {
		const decoded = decodeURIComponent(path), key = decoded.toLowerCase();
		if (listed.has(key)) fail('Ambiguous case/encoded file aliases in evidence listing.');
		listed.set(key, decoded);
	}
	const missing = [], verified = new Map();
	for (const reference of references) {
		const path = listed.get(reference.path.toLowerCase());
		if (path === undefined) { missing.push(reference.path); continue; }
		if (path !== reference.path) fail(`Evidence exists under a conflicting path alias: ${reference.path}.`);
		const bytes = await readVerifiedFile(reference, { signal, timeout, isCurrent: check });
		check();
		verified.set(reference.path, bytes);
	}
	let evidence = null, dependencies = null;
	if (verified.has(intent.bundle.path)) {
		evidence = await decodeRecoveryImportEvidence(verified.get(intent.bundle.path), { maxBytes, maxEntries });
		check();
		const { manifest, recoveryFiles, imageAssets } = evidence;
		if (manifest.source.sceneId !== scene.id || manifest.source.levelId !== intent.levelId
			|| !same(manifest.project.tree, intent.after.layers) || !same(manifest.source.level, intent.after.level)
			|| !same(manifest.journal, intent.optimization)) fail('Evidence ZIP differs from durable destination/history targets.');
		const files = new Map(recoveryFiles.map(file => [file.reference.path, file]));
		for (const image of manifest.resources.images) {
			if (image.file && !files.has(image.source)) {
				const preserved = files.get(image.file.path);
				if (!preserved) fail('Missing preserved image alias bytes.');
				files.set(image.source, { bytes: preserved.bytes, reference: null });
			}
		}
		for (const asset of imageAssets) {
			if (files.has(asset.source)) fail('Evidence image alias conflicts with recovery inventory.');
			files.set(asset.source, { bytes: asset.bytes, reference: null });
		}
		if (files.size !== intent.uploads.length) fail('Evidence ZIP upload inventory differs from durable intent.');
		for (const reference of intent.uploads) {
			const file = files.get(reference.path);
			if (!file || file.bytes.length !== reference.bytes || await fileFingerprint(file.bytes) !== reference.fingerprint
				|| file.reference && !same(file.reference, reference)) fail('Evidence ZIP upload bytes/references differ from intent.');
			check();
		}
		const drawings = reconstructRecoveryProjectDrawings(manifest.project, manifest.authors);
		const verifyNative = async (type, sources, descriptors) => {
			if (sources.length !== descriptors.length) fail('Native evidence inventory differs from intent.');
			for (let index = 0; index < sources.length; index++) {
				const source = sources[index], staged = structuredClone(source);
				staged.hidden = true; staged.flags.foundryshop ??= {};
				staged.flags.foundryshop.importStaging = intent.token;
				const descriptor = descriptors[index];
				if (source._id !== descriptor.id || await digest(source) !== descriptor.afterDigest
					|| await digest(staged) !== descriptor.stagedDigest) fail('Native evidence digests differ from approved intent.');
				check();
				assertOptimizationNativeSource(scene, type, source);
				assertOptimizationNativeSource(scene, type, staged);
			}
		};
		await verifyNative('Drawing', drawings, intent.drawings);
		await verifyNative('Tile', manifest.tiles, intent.tiles);
		assertOptimizationNativeSource(scene, 'Level', manifest.source.level);
		const artwork = [...drawings, ...manifest.tiles];
		for (const file of recoveryFiles.filter(file => file.reference.path.endsWith('.json'))) {
			const { payload } = await readOptimizationArchive(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes));
			check(); assertOptimizationNativeSchemas(scene, payload);
			artwork.push(...payload.originals);
			if (payload.replacement.type !== 'LevelBackground') artwork.push(payload.replacement.staged, payload.replacement.after);
		}
		const modules = new Set(artwork.flatMap(source => Object.keys(source.flags ?? {}))
			.filter(namespace => !['foundryshop', 'core'].includes(namespace)));
		const fonts = new Set(availableProjectFonts());
		if ([...modules].some(module => !game.modules.get(module)?.active)
			|| manifest.resources.fonts.some(font => !fonts.has(font))) fail('Historical fonts/modules are unavailable; restore them before continuation.');
		dependencies = { fonts: [...manifest.resources.fonts], modules: [...modules] };
	}
	check();
	if (intent.phase !== 'intent' && missing.length) fail('Assets-verified journal has missing durable evidence; phase alone cannot authorize continuation.');
	return {
		intent, evidence, nativeState, dependencies,
		review: { token: intent.token, phase: intent.phase, verifiedPaths: [...verified.keys()], missingPaths: missing,
			nativeState,
			state: !evidence ? 'missing-project-evidence' : missing.length ? 'partial-assets'
				: receipt ? intent.phase === 'compensated' ? 'cleared-compensated-import' : 'completed-import'
					: releasePhases.includes(intent.phase) ? 'native-release-in-progress'
					: intent.phase === 'compensated' ? 'compensated-retained-evidence'
					: intent.phase === 'compensating' ? 'compensation-in-progress'
						: nativeState.tree === 'after' ? 'hidden-native-staging' : 'all-assets-verified',
			disclosure: 'Fresh read-only evidence inspection. Missing paths are explicit; corrupt or conflicting evidence refuses. No uploads adopted/retried, approval granted, ownership handed off, phase changed, native writes or cleanup performed.' },
	};
}
