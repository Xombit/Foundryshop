import { canonicalJson } from './project_package.js';
import { readOptimizationJournal, beginOptimizationOperation, advanceOptimizationOperation } from './optimization_journal.js';
import { createOptimizationArchive, readOptimizationArchive, optimizationArchiveDescriptor,
	prepareOptimizationArchiveFile, inspectOptimizationRecovery } from './optimization_recovery.js';
import { verifyJournaledOptimizationPhase } from './optimization_reconciliation.js';
import { validateStoredFile, fileFingerprint, readVerifiedFile, persistVerifiedFile } from '../verified_file_storage.js';
import { acceptOptimizationImage, inspectOptimizationImage } from '../optimization_media.js';
import { createBakeReplacement, prepareBakeOutputFile } from './bake_replacement.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);

async function reference(blob, root, filename) {
	return validateStoredFile({ version: 1, root, path: `${root}/${filename}`,
		bytes: blob.size, fingerprint: await fileFingerprint(await blob.arrayBuffer()) });
}

/** Prepare immutable byte intents; approvedScope binds native review across this intent's own journal writes. */
export async function prepareBakeOperation(scene, {
	token, root, sourceIds, levelId, scope, rendered, replacement, parentToken = null,
	signal, isCurrent, verifyNative, timeout = 30000, approvedScope, audience, replacementId, sort,
} = {}) {
	if (typeof isCurrent !== 'function' || typeof verifyNative !== 'function'
		|| !(rendered?.blob instanceof Blob) || !rendered.blob.size
		|| !/^[a-zA-Z0-9_-]{1,64}$/.test(token) || !Number.isSafeInteger(timeout) || timeout < 0) {
		throw new Error('Bake operation requires exact rendered bytes, unique token and explicit context/native acceptance.');
	}
	const ownerId = game.user?.id;
	const expected = readOptimizationJournal(scene), rendererResult = {
		blob: rendered.blob, width: rendered.width, height: rendered.height,
		bounds: structuredClone(rendered.bounds), sourceDigest: rendered.sourceDigest,
		review: structuredClone(rendered.review), background: structuredClone(rendered.background ?? null),
		originalImage: rendered.originalImage == null ? null : {
			path: rendered.originalImage.path, blob: rendered.originalImage.blob, bytes: rendered.originalImage.bytes,
			fingerprint: rendered.originalImage.fingerprint,
		},
	};
	const capturedIds = structuredClone(sourceIds), capturedScope = structuredClone(scope);
	const capturedReplacement = structuredClone(replacement);
	if (replacement !== undefined && [audience, replacementId, sort].some(value => value !== undefined)) {
		throw new Error('Supply either an exact native replacement or native construction options, not both.');
	}
	if (approvedScope !== undefined && (typeof approvedScope.assertCurrent !== 'function'
		|| typeof approvedScope.bindOperationIntent !== 'function')) throw new Error('Bake preparation requires a real approved scope binding.');
	let scopeCurrent = approvedScope?.assertCurrent;
	const check = () => {
		if (!game.user?.isGM || game.user.id !== ownerId || game.users?.activeGM?.id !== game.user.id || signal?.aborted
			|| game.scenes?.get(scene.id) !== scene || !scene.canUserModify(game.user, 'update') || !isCurrent()
			|| scopeCurrent && !scopeCurrent()) {
			throw new Error('Bake operation authority/Scene/review context changed or was cancelled.');
		}
		return true;
	};
	check();
	const header = inspectOptimizationImage(new Uint8Array(await rendererResult.blob.arrayBuffer()));
	if (rendererResult.blob.type !== header.mime || rendererResult.review?.format !== header.extension
		|| !Number.isFinite(rendererResult.review?.quality) || rendererResult.review.quality < 0 || rendererResult.review.quality > 1) {
		throw new Error('Encoded bake bytes/MIME differ from the exact reviewed encoding options.');
	}
	const output = await prepareBakeOutputFile(rendererResult.blob, root, token);
	await acceptOptimizationImage(new Uint8Array(await rendererResult.blob.arrayBuffer()), output,
		{ width: rendererResult.width, height: rendererResult.height }, { signal, isCurrent: check });
	const nativeReplacement = capturedReplacement === undefined ? createBakeReplacement(scene, {
		levelId, output, rendered: rendererResult, audience, replacementId, sort, sourceIds: capturedIds, isCurrent: check,
	}) : capturedReplacement;
	if (!['Tile', 'LevelBackground', 'Drawing'].includes(nativeReplacement?.type)
		|| rendererResult.review?.destination !== ({ Tile: 'tile', LevelBackground: 'background', Drawing: 'drawing' }[nativeReplacement.type])
		|| rendererResult.review.width !== rendererResult.width || rendererResult.review.height !== rendererResult.height
		|| !same(rendererResult.review.bounds, rendererResult.bounds)
		|| (nativeReplacement.type === 'LevelBackground'
			? !same(rendererResult.background?.rect, rendererResult.bounds)
			: !same({ x: nativeReplacement.after?.x, y: nativeReplacement.after?.y,
				width: nativeReplacement.type === 'Drawing' ? nativeReplacement.after?.shape?.width : nativeReplacement.after?.width,
				height: nativeReplacement.type === 'Drawing' ? nativeReplacement.after?.shape?.height : nativeReplacement.after?.height }, rendererResult.bounds))) {
		throw new Error('Rendered review/destination/placement dimensions differ from the prepared native replacement.');
	}
	const parent = parentToken === null ? null : expected.entries.find(entry =>
		entry.token === parentToken && entry.phase === 'complete' && entry.action === 'apply' && entry.levelId === levelId);
	if (parentToken !== null && !parent) throw new Error('Bake lineage requires an earlier completed apply on the same Level.');
	let backup = null, originalBackground = null;
	if (nativeReplacement.type === 'LevelBackground') {
		const before = nativeReplacement.before, image = rendererResult.originalImage;
		if (!same(rendererResult.background?.texture, {
			src: before?.background?.src, color: String(before?.background?.color), tint: String(before?.background?.tint),
		}) || !same(rendererResult.background?.transform, before?.textures)) {
			throw new Error('Rendered background snapshot differs from exact native original settings.');
		}
		if (before.background.src) {
			if (image?.path !== before.background.src || !(image.blob instanceof Blob)) {
				throw new Error('Background bake requires the retained original byte Blob, not a mutable source URL.');
			}
			const originalHeader = inspectOptimizationImage(new Uint8Array(await image.blob.arrayBuffer()));
			const file = await reference(image.blob, root, `background-original-${token}.${originalHeader.extension}`);
			if (file.fingerprint !== image.fingerprint || file.bytes !== image.bytes) throw new Error('Retained original background bytes changed.');
			backup = { blob: image.blob, file };
			originalBackground = { src: image.path, file };
		} else if (image !== null) throw new Error('Color-only background cannot carry an unrelated original image.');
	}
	const archive = await createOptimizationArchive(scene, capturedIds, nativeReplacement, {
		token, levelId, scope: capturedScope, output, originalBackground,
		parent: parent ? { file: parent.archive, checksum: parent.archiveChecksum } : null,
	});
	if (archive.sourceDigest !== rendererResult.sourceDigest
		|| !Array.isArray(rendererResult.review.sourceIds)
		|| !same([...rendererResult.review.sourceIds].sort(), [...capturedIds].sort())) {
		throw new Error('Rendered pixels are bound to different exact original Drawing sources.');
	}
	const archiveFile = await prepareOptimizationArchiveFile(archive.text, root);
	const descriptor = await optimizationArchiveDescriptor(archive.text);
	const intent = { token, sceneId: scene.id, levelId, ownerId: game.user.id, action: 'apply', phase: 'intent',
		archive: archiveFile, ...descriptor, parentToken };
	if (approvedScope) scopeCurrent = await approvedScope.bindOperationIntent(intent, archive.text);
	const { payload } = await readOptimizationArchive(archive.text);
	const verifySources = async () => {
		check();
		const native = await inspectOptimizationRecovery(scene, archive.text);
		if (native.originals.missing.length || !['absent', 'before'].includes(native.replacementState)) {
			throw new Error('Bake preparation requires every exact original and an untouched replacement destination.');
		}
		if (await verifyNative(structuredClone(payload)) !== true) throw new Error('Prepared bake native/placement acceptance failed.');
		check();
		const rechecked = await inspectOptimizationRecovery(scene, archive.text);
		if (rechecked.originals.missing.length || !['absent', 'before'].includes(rechecked.replacementState)) {
			throw new Error('Bake native sources changed during acceptance.');
		}
		return true;
	};
	await verifySources();
	if (!same(readOptimizationJournal(scene), expected)) throw new Error('Bake journal changed during preparation.');
	const assets = [{ blob: new Blob([archive.text], { type: 'application/json' }), file: archiveFile },
		...(backup ? [backup] : []), { blob: rendererResult.blob, file: output }];
	let busy = false;
	return Object.freeze({ intent: structuredClone(intent), output: structuredClone(output),
		originalBackground: structuredClone(originalBackground),
		async persist() {
			if (busy) throw new Error('Bake asset preparation is already running.');
			busy = true;
			try {
				check(); await verifySources();
				let journal = readOptimizationJournal(scene), stored = journal.entries.find(entry => entry.token === token);
				if (!stored) {
					if (!same(journal, expected)) throw new Error('Bake journal changed before intent persistence.');
					journal = await beginOptimizationOperation(scene, expected, intent, { isCurrent: check, verifyIntent: verifySources });
				} else if (!same({ ...stored, phase: 'intent' }, intent) || !['intent', 'assets-verified'].includes(stored.phase)) {
					throw new Error('Bake preparation retry requires its exact owned asset intent, not an advanced native operation.');
				}
				const guard = () => {
					check();
					if (!same(readOptimizationJournal(scene), journal)) throw new Error('Bake journal changed during asset persistence.');
					return true;
				};
				for (const asset of assets) {
					guard(); await verifySources(); guard();
					const picker = foundry.applications.apps.FilePicker.implementation;
					const listing = await picker.browse('data', asset.file.root);
					guard();
					if (!Array.isArray(listing.files) || listing.files.some(path => typeof path !== 'string')) {
						throw new Error('Bake recovery folder listing is invalid.');
					}
					if (listing.files.some(path => decodeURIComponent(path).toLowerCase() === asset.file.path.toLowerCase())) {
						await readVerifiedFile(asset.file, { signal, isCurrent: guard, timeout });
					} else {
						const saved = await persistVerifiedFile(asset.blob, { root: asset.file.root,
							filename: asset.file.path.slice(asset.file.root.length + 1), signal, isCurrent: guard, timeout });
						if (!same(saved, asset.file)) throw new Error('Bake asset upload differs from its journaled byte intent.');
					}
					guard();
				}
				const verifyOutput = (bytes, supplied) => {
					if (!same(supplied, output)) throw new Error('Bake output acceptance belongs to another file.');
					return acceptOptimizationImage(bytes, output, { width: rendererResult.width, height: rendererResult.height },
						{ signal, isCurrent: guard });
				};
				if (journal.entries.find(entry => entry.token === token).phase === 'intent') {
					journal = await advanceOptimizationOperation(scene, journal, token, 'assets-verified', {
						isCurrent: check, verifyPhase: proposed => verifyJournaledOptimizationPhase(scene, proposed,
							{ signal, isCurrent: guard, timeout, verifyOutput }),
					});
				}
				await verifySources();
				check();
				if (!same(readOptimizationJournal(scene), journal)) throw new Error('Bake journal changed after asset verification.');
				return { token, sceneId: scene.id, phase: 'assets-verified', journal: structuredClone(journal) };
			} finally { busy = false; }
		},
	});
}
