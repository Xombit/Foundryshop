import { capturePreparedRecoveryImport } from './recovery_import_preparation.js';
import { canonicalJson } from './project_package.js';
import { recoveryImportSceneState } from './recovery_import_scene_state.js';
import { fileFingerprint, validateStoredFile, persistVerifiedFile, readVerifiedFile } from '../verified_file_storage.js';
import { validateLayerTree } from './layer_tree_store.js';
import { validateOptimizationJournal } from './optimization_journal.js';
import { runLayerOperation, LAYER_OPERATION } from './layer_manager.js';
import { availableProjectFonts } from './project_resources.js';
import { encodeRecoveryImportEvidence, decodeRecoveryImportEvidence } from './recovery_import_evidence.js';
import { encodeRecoveryImportReceipt } from './recovery_import_receipt_storage.js';

export const RECOVERY_IMPORT_JOURNAL_FORMAT = 'foundryshop-recovery-import';
const flag = 'projectImportJournal';
const fail = message => { throw new Error(`Recovery import intent: ${message}`); };
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
	&& Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const digest = value => fileFingerprint(new TextEncoder().encode(canonicalJson(value)));
const approvals = new WeakMap();

/** Version 4 deliberately refuses the ordinary version 1-3 import cleanup path. */
export function validateRecoveryImportIntent(input, sceneId) {
	if (!exact(input, ['format', 'version', 'token', 'sceneId', 'levelId', 'ownerId', 'phase',
		'planDigest', 'destinationDigest', 'bundle', 'uploads', 'drawings', 'tiles', 'before', 'after',
		'optimization', 'decisions'])
		|| input.format !== RECOVERY_IMPORT_JOURNAL_FORMAT || input.version !== 4
		|| !['intent', 'assets-verified', 'tree-installed', 'native-staged', 'compensating', 'compensated',
			'releasing', 'history-installed', 'native-released', 'complete'].includes(input.phase)
		|| ![input.token, input.sceneId, input.levelId, input.ownerId].every(id) || input.sceneId !== sceneId
		|| !hash(input.planDigest) || !hash(input.destinationDigest)
		|| !Array.isArray(input.uploads) || !input.uploads.length
		|| !Array.isArray(input.drawings) || !Array.isArray(input.tiles)
		|| !exact(input.before, ['layers', 'level']) || !exact(input.after, ['layers', 'level'])
		|| input.before.level?._id !== input.levelId || input.after.level?._id !== input.levelId
		|| !Array.isArray(input.decisions) || !input.decisions.includes('project-import')
		|| new Set(input.decisions).size !== input.decisions.length
		|| input.decisions.some(value => !['project-import', 'native-tile-visibility',
			'level-background-replacement-and-visibility', 'empty-metadata-replacement'].includes(value))) {
		fail('Invalid versioned durable intent.');
	}
	for (const state of [input.before, input.after]) {
		if (!same(validateLayerTree(state.layers), state.layers)) fail('Intent trees must be canonical.');
	}
	const bundle = validateStoredFile(input.bundle);
	if (!bundle.path.endsWith('.json')) fail('Intent evidence must be a retained versioned JSON envelope.');
	const paths = new Set([bundle.path]);
	for (const upload of input.uploads) {
		const reference = validateStoredFile(upload);
		if (paths.has(reference.path) || reference.root !== bundle.root) fail('Duplicate or foreign-root intent upload.');
		paths.add(reference.path);
	}
	const identities = new Set();
	for (const source of [...input.drawings, ...input.tiles]) {
		if (!exact(source, ['id', 'stagedDigest', 'afterDigest']) || !id(source.id)
			|| !hash(source.stagedDigest) || !hash(source.afterDigest) || identities.has(source.id)) fail('Invalid native intent descriptors.');
		identities.add(source.id);
	}
	const optimization = validateOptimizationJournal(input.optimization, sceneId);
	if (!optimization.entries.length || optimization.entries.some(entry => entry.phase !== 'complete'
		|| entry.levelId !== input.levelId || entry.ownerId !== input.ownerId
		|| !same(input.uploads.find(reference => reference.path === entry.archive.path), entry.archive)
		|| !same(input.uploads.find(reference => reference.path === entry.asset.path), entry.asset))) {
		fail('Intent recovery history is outside its exact upload inventory.');
	}
	if (input.tiles.length && !input.decisions.includes('native-tile-visibility')
		|| optimization.entries.some(entry => entry.replacement.type === 'LevelBackground')
			&& !input.decisions.includes('level-background-replacement-and-visibility')
		|| (input.before.layers.nodes.length || input.before.layers.presets.length)
			&& !input.decisions.includes('empty-metadata-replacement')) fail('Intent lacks a required separate approval.');
	return structuredClone(input);
}

function authority(scene, ownerId, levelId, options) {
	if (!game.user?.isGM || game.user.id !== ownerId || game.users?.activeGM?.id !== ownerId
		|| !game.user.can('FILES_BROWSE') || !game.user.can('FILES_UPLOAD')
		|| game.scenes?.get(scene.id) !== scene || !scene.canUserModify(game.user, 'update')
		|| !scene.levels?.has(levelId) || options.signal?.aborted || !options.isCurrent()) {
		fail('Destination authority/context changed or was cancelled.');
	}
}

function assertBaseline(scene, before) {
	const object = structuredClone(scene.toObject());
	delete object.flags?.foundryshop?.[flag];
	if (!before.flags?.foundryshop && object.flags?.foundryshop && !Object.keys(object.flags.foundryshop).length) delete object.flags.foundryshop;
	if (!before.flags && object.flags && !Object.keys(object.flags).length) delete object.flags;
	if (!same(recoveryImportSceneState(object), recoveryImportSceneState(before))) fail('Destination changed during import persistence/verification.');
}

/** Read-only approval capability bound to genuine preparation, exact bytes and native visibility decisions. */
export async function reviewRecoveryImport(scene, prepared, { isCurrent, signal, maxBytes, maxReceiptBytes } = {}) {
	if (typeof isCurrent !== 'function' || !Number.isSafeInteger(maxBytes) || maxBytes < 1) fail('Explicit context and total upload-byte budget are required.');
	const options = { isCurrent, signal }, plan = capturePreparedRecoveryImport(prepared),
		ownerId = plan.destinationBaseline.authorId, levelId = plan.manifest.source.levelId;
	const baseline = structuredClone(scene.toObject());
	if (scene.id !== plan.manifest.source.sceneId) fail('Prepared plan belongs to a different destination.');
	const check = () => {
		authority(scene, ownerId, levelId, options);
		capturePreparedRecoveryImport(prepared);
		const fonts = new Set(availableProjectFonts());
		if (plan.review.fonts.some(font => !fonts.has(font))
			|| plan.review.modules.some(module => !game.modules.get(module)?.active)) fail('Reviewed fonts/modules changed.');
	};
	check();
	const evidenceBytes = await encodeRecoveryImportEvidence(plan.bytes, { maxBytes, maxEntries: plan.uploads.length + 1 });
	const bundle = validateStoredFile({ version: 1, root: plan.destinationBaseline.root,
		path: `${plan.destinationBaseline.root}/import-${plan.provenance.importId}.json`,
		bytes: evidenceBytes.length, fingerprint: await fileFingerprint(evidenceBytes) });
	if ([...plan.destinationBaseline.reservedPaths, ...plan.uploads.map(upload => upload.reference.path)].includes(bundle.path)) {
		fail('Retained import evidence path is occupied.');
	}
	const uploadBytes = plan.uploads.reduce((sum, upload) => sum + upload.bytes.length, bundle.bytes);
	if (!Number.isSafeInteger(uploadBytes) || uploadBytes > maxBytes) fail('Recovery files plus retained evidence ZIP exceed the reviewed total upload budget.');
	const descriptors = async (sources, staged) => Promise.all(sources.map(async (source, index) => ({
		id: source._id, stagedDigest: await digest(staged[index]), afterDigest: await digest(source),
	})));
	const intentBase = {
		format: RECOVERY_IMPORT_JOURNAL_FORMAT, version: 4, token: plan.provenance.importId,
		sceneId: scene.id, levelId, ownerId, phase: 'intent', planDigest: await digest(plan),
		destinationDigest: await digest(recoveryImportSceneState(baseline)),
		bundle, uploads: plan.uploads.map(upload => upload.reference),
		drawings: await descriptors(plan.drawings, plan.stagedDrawings),
		tiles: await descriptors(plan.manifest.tiles, plan.stagedTiles),
		before: { layers: plan.before, level: plan.destinationBaseline.level },
		after: { layers: plan.manifest.project.tree, level: plan.manifest.source.level },
		optimization: plan.manifest.journal, decisions: [...plan.review.requiredApprovals],
	};
	const intent = validateRecoveryImportIntent(intentBase, scene.id);
	if (maxReceiptBytes !== undefined) encodeRecoveryImportReceipt({ ...intent, phase: 'complete' }, { maxReceiptBytes });
	check();
	return {
		review: { ...structuredClone(plan.review), token: intent.token, sceneId: scene.id, levelId,
			planDigest: intent.planDigest, uploadBytes, retainedEvidence: bundle,
			retainedPaths: [bundle.path, ...intent.uploads.map(reference => reference.path)],
			drawingIds: intent.drawings.map(source => source.id), tileIds: intent.tiles.map(source => source.id),
			backgroundBefore: structuredClone(intent.before.level), backgroundAfter: structuredClone(intent.after.level),
			disclosure: 'Approve this exact immutable plan and each listed native visibility/metadata decision. The next permitted write is durable intent only, before any uploads. Unknown persistence results retain evidence and require reconciliation; no automatic retry or ordinary JSON-import cleanup.' },
		approve(decision) {
			check();
			if (!exact(decision, ['planDigest', 'decisions']) || decision.planDigest !== intent.planDigest
				|| !Array.isArray(decision.decisions) || !same(decision.decisions, intent.decisions)) {
				fail('Explicitly approve the exact plan digest and every required separate decision.');
			}
			const capability = Object.freeze({ token: intent.token, planDigest: intent.planDigest });
			approvals.set(capability, { scene, check, intent, consumed: false, baseline, options,
				plan, evidenceBytes, assetsStarted: false, intentVerified: false });
			return capability;
		},
	};
}

export class UnverifiedRecoveryImportIntentError extends Error {
	constructor(sceneId, token, cause, phase = 'intent') {
		super(`Recovery import ${phase} journal write is unverified for ${sceneId}/${token}: ${cause.message}. Re-read and reconcile before retrying; ${phase === 'intent' ? 'no uploads were started' : 'uploaded evidence is retained and native writes must not proceed'}.`, { cause });
		this.name = 'UnverifiedRecoveryImportIntentError'; this.sceneId = sceneId; this.token = token;
		this.phase = phase;
	}
}

/** Persist the approved intent only. Upload/execution/reconciliation are separate, still-disabled surfaces. */
export function beginRecoveryImportIntent(scene, capability) {
	return runLayerOperation(scene, async () => {
		const approval = approvals.get(capability);
		if (!approval || approval.scene !== scene || approval.consumed) fail('A fresh exact-plan approval is required.');
		approval.check();
		const intent = validateRecoveryImportIntent(approval.intent, scene.id);
		approval.consumed = true;
		try {
			await scene.update({ [`flags.foundryshop.${flag}`]: intent }, { diff: false, [LAYER_OPERATION]: true });
			if (!same(scene.getFlag('foundryshop', flag), intent)) fail('Durable intent readback differs.');
			// Own intent is the only permitted source change at this boundary.
			authority(scene, intent.ownerId, intent.levelId, approval.options);
			assertBaseline(scene, approval.baseline);
		} catch (error) { throw new UnverifiedRecoveryImportIntentError(scene.id, intent.token, error); }
		approval.intentVerified = true;
		return structuredClone(intent);
	});
}

function assertAssetContext(scene, approval, expected, options) {
	authority(scene, expected.ownerId, expected.levelId, options);
	authority(scene, expected.ownerId, expected.levelId, approval.options);
	if (!same(scene.getFlag('foundryshop', flag), expected)) fail('Durable import journal changed during asset verification.');
	assertBaseline(scene, approval.baseline);
	const fonts = new Set(availableProjectFonts());
	if (approval.plan.review.fonts.some(font => !fonts.has(font))
		|| approval.plan.review.modules.some(module => !game.modules.get(module)?.active)) fail('Reviewed fonts/modules changed.');
	return true;
}

export class InterruptedRecoveryImportAssetsError extends Error {
	constructor(sceneId, token, cause) {
		super(`Recovery import assets stopped for ${sceneId}/${token}: ${cause.message}. Retain the journal and any uploaded evidence; reconcile before retrying. No native artwork was created.`, { cause });
		this.name = 'InterruptedRecoveryImportAssetsError'; this.sceneId = sceneId; this.token = token;
	}
}

/** Session-owned upload stage only; uncertain files and phase writes never authorize native creation. */
export function uploadRecoveryImportAssets(scene, capability, { isCurrent, signal, timeout = 30000 } = {}) {
	if (typeof isCurrent !== 'function' || !Number.isSafeInteger(timeout) || timeout < 0) {
		fail('Asset upload requires an explicit currentness guard and valid timeout.');
	}
	return runLayerOperation(scene, async () => {
		const approval = approvals.get(capability);
		if (!approval || approval.scene !== scene || !approval.intentVerified || approval.assetsStarted) {
			fail('Verified session-owned intent and an unused asset stage are required; reconcile instead of retrying.');
		}
		const intent = validateRecoveryImportIntent(approval.intent, scene.id), options = { isCurrent, signal };
		const check = () => assertAssetContext(scene, approval, intent, options);
		check();
		approval.assetsStarted = true;
		try {
			const inventory = [{ reference: intent.bundle, bytes: approval.evidenceBytes }, ...approval.plan.uploads];
			// Preflight the entire inventory before even uploading evidence. Storage repeats the check per file.
			const picker = foundry.applications.apps.FilePicker.implementation;
			const listing = await picker.browse('data', intent.bundle.root);
			check();
			if (!Array.isArray(listing.files) || listing.files.some(path => typeof path !== 'string')) fail('Invalid destination file listing.');
			const occupied = new Set(listing.files.map(path => decodeURIComponent(path).toLowerCase()));
			const planned = new Set();
			for (const { reference, bytes } of inventory) {
				const path = reference.path.toLowerCase();
				if (occupied.has(path) || planned.has(path)) fail(`Destination asset path is occupied: ${reference.path}.`);
				planned.add(path);
				if (bytes.length !== reference.bytes || await fileFingerprint(bytes) !== reference.fingerprint) fail('Planned bytes differ from durable intent.');
				check();
			}
			for (const { reference, bytes } of inventory) {
				check();
				const extension = reference.path.split('.').at(-1);
				const mime = { json: 'application/json', png: 'image/png',
					jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[extension];
				if (!mime) fail('Unsupported planned upload extension.');
				const verified = await persistVerifiedFile(new Blob([bytes], { type: mime }), {
					root: reference.root, filename: reference.path.slice(reference.root.length + 1),
					signal, timeout, isCurrent: check,
				});
				check();
				if (!same(verified, reference)) fail('Verified uploaded reference differs from durable intent.');
			}
			// Re-read all files after the last upload, not only each file's immediate storage readback.
			let evidence;
			for (const { reference } of inventory) {
				const bytes = await readVerifiedFile(reference, { signal, timeout, isCurrent: check });
				check();
				if (reference.path === intent.bundle.path) evidence = bytes;
			}
			const decoded = await decodeRecoveryImportEvidence(evidence, {
				maxBytes: intent.bundle.bytes, maxEntries: approval.plan.uploads.length + 1,
			});
			check();
			if (!same(decoded.manifest, approval.plan.manifest)) fail('Retained project evidence differs from reviewed recovery history.');
			const next = validateRecoveryImportIntent({ ...intent, phase: 'assets-verified' }, scene.id);
			try {
				await scene.update({ [`flags.foundryshop.${flag}`]: next }, { diff: false, [LAYER_OPERATION]: true });
				assertAssetContext(scene, approval, next, options);
			} catch (error) { throw new UnverifiedRecoveryImportIntentError(scene.id, intent.token, error, 'assets-verified'); }
			return structuredClone(next);
		} catch (error) { throw new InterruptedRecoveryImportAssetsError(scene.id, intent.token, error); }
	});
}
