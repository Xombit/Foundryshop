import { canonicalJson } from './project_package.js';
import { readOptimizationJournal, advanceOptimizationOperation } from './optimization_journal.js';
import { readOptimizationArchive, optimizationArchiveDescriptor, inspectOptimizationRecovery } from './optimization_recovery.js';
import { verifyJournaledOptimizationPhase } from './optimization_reconciliation.js';
import { readVerifiedFile, persistVerifiedFile, fileFingerprint } from '../verified_file_storage.js';
import { readLayerWorkspace } from './layer_manager.js';
import { optimizationSceneGrid } from './optimization_scene_data.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);

async function matches(blob, file) {
	if (!(blob instanceof Blob) || blob.size !== file.bytes
		|| await fileFingerprint(await blob.arrayBuffer()) !== file.fingerprint) {
		throw new Error(`Recovery bytes differ from the immutable file intent: ${file.path}.`);
	}
}

/** Reload-safe asset-only review. Missing source bytes are never re-created or silently fetched from mutable URLs. */
export async function reviewBakeAssetRecovery(scene, token, {
	isCurrent, signal, timeout = 30000, verifyNative, verifyOutput, archiveBlob,
} = {}) {
	if (typeof isCurrent !== 'function' || typeof verifyNative !== 'function' || typeof verifyOutput !== 'function'
		|| !Number.isSafeInteger(timeout) || timeout < 0) {
		throw new Error('Bake asset recovery requires explicit context/native/output acceptance and valid timeout.');
	}
	let journal = readOptimizationJournal(scene);
	const entry = journal.entries.find(item => item.token === token);
	if (!entry || entry.action !== 'apply' || !['intent', 'assets-verified'].includes(entry.phase)
		|| !['Tile', 'LevelBackground'].includes(entry.replacement.type)) {
		throw new Error('Asset recovery requires an existing bake apply intent before native execution.');
	}
	const access = () => {
		if (!game.user?.isGM || game.user.id !== entry.ownerId || game.users?.activeGM?.id !== entry.ownerId
			|| game.scenes?.get(scene.id) !== scene || !scene.canUserModify(game.user, 'update')
			|| signal?.aborted || !isCurrent() || scene.getFlag('foundryshop', 'projectImportJournal')) {
			throw new Error('Bake asset recovery owner/authority/context changed or was cancelled.');
		}
		return true;
	};
	access();
	const snapshot = () => canonicalJson({
		width: scene.width, height: scene.height, padding: scene.padding, grid: optimizationSceneGrid(scene),
		level: scene.levels.get(entry.levelId)?.toObject() ?? null,
		drawings: [...scene.drawings.values()].map(doc => doc.toObject()).sort((a, b) => a._id.localeCompare(b._id)),
		tiles: [...scene.tiles.values()].map(doc => doc.toObject()).sort((a, b) => a._id.localeCompare(b._id)),
		layers: scene.getFlag('foundryshop', 'layers') ?? null, workspace: readLayerWorkspace(scene),
	});
	const baseline = snapshot();
	const guard = () => {
		access();
		if (!same(readOptimizationJournal(scene), journal)) throw new Error('Bake asset recovery journal changed; review again.');
		if (snapshot() !== baseline) throw new Error('Bake asset recovery native/workspace context changed; review again.');
		return true;
	};
	const options = { signal, timeout, isCurrent: guard };
	const present = async file => {
		guard();
		const listing = await foundry.applications.apps.FilePicker.implementation.browse('data', file.root);
		guard();
		if (!Array.isArray(listing.files) || listing.files.some(path => typeof path !== 'string')) {
			throw new Error('Bake recovery folder listing is invalid; absence cannot be inferred.');
		}
		return listing.files.some(path => decodeURIComponent(path).toLowerCase() === file.path.toLowerCase());
	};
	guard();
	const archivePresent = await present(entry.archive);
	let archiveBytes;
	if (archivePresent) archiveBytes = await readVerifiedFile(entry.archive, options);
	else if (archiveBlob !== undefined) {
		await matches(archiveBlob, entry.archive); guard();
		archiveBytes = new Uint8Array(await archiveBlob.arrayBuffer());
	} else {
		return { review: { token, sceneId: scene.id, phase: entry.phase, blocked: true,
			missingPaths: [entry.archive.path],
			disclosure: 'Recovery archive is missing. Supply its exact original bytes to inspect the remaining assets; the journal cannot reconstruct raw Drawing originals.' } };
	}
	const text = new TextDecoder('utf-8', { fatal: true }).decode(archiveBytes);
	const { payload } = await readOptimizationArchive(text), descriptor = await optimizationArchiveDescriptor(text);
	const parent = entry.parentToken === null ? null : journal.entries.find(item => item.token === entry.parentToken);
	if (payload.id !== token || payload.sceneId !== scene.id || payload.levelId !== entry.levelId
		|| !same(descriptor, Object.fromEntries(Object.keys(descriptor).map(key => [key, entry[key]])))
		|| !same(payload.parent, parent ? { file: parent.archive, checksum: parent.archiveChecksum } : null)) {
		throw new Error('Stored recovery archive differs from exact journal identity, descriptors or lineage.');
	}
	const native = async () => {
		guard();
		const before = await inspectOptimizationRecovery(scene, text);
		if (before.originals.missing.length || !['before', 'absent'].includes(before.replacementState)) {
			throw new Error('Asset recovery requires untouched replacement state and all exact originals; use native reconciliation instead.');
		}
		if (await verifyNative(structuredClone(payload)) !== true) throw new Error('Reload recovery native/placement acceptance failed.');
		guard();
		const after = await inspectOptimizationRecovery(scene, text);
		if (after.originals.missing.length || !['before', 'absent'].includes(after.replacementState)) {
			throw new Error('Native originals/replacement changed during recovery acceptance.');
		}
	};
	await native();
	const assets = [{ role: 'archive', file: entry.archive },
		...(payload.originalBackground ? [{ role: 'original-background', file: payload.originalBackground.file }] : []),
		{ role: 'output', file: entry.asset }];
	const inventory = [];
	for (const asset of assets) {
		const exists = asset.role === 'archive' ? archivePresent : await present(asset.file);
		if (exists) {
			const bytes = asset.role === 'archive' ? archiveBytes : await readVerifiedFile(asset.file, options);
			if (asset.role === 'output' && await verifyOutput(bytes, structuredClone(asset.file)) !== true) {
				throw new Error('Reload recovery output decode/render acceptance failed.');
			}
		}
		guard();
		inventory.push({ ...asset, status: exists ? 'verified' : 'missing' });
	}
	const missingPaths = inventory.filter(asset => asset.status === 'missing').map(asset => asset.file.path).sort();
	let busy = false, finished = false;
	return { review: { token, sceneId: scene.id, phase: entry.phase, blocked: false,
		assets: structuredClone(inventory), missingPaths: [...missingPaths],
		disclosure: 'Only exact missing asset bytes can be supplied. Existing mismatches are conflicts, never overwritten. No Drawing or replacement document will be changed.' },
		async recover({ approvedMissingPaths, blobs = {} } = {}) {
			if (busy || finished) throw new Error('Bake asset recovery review is running or consumed; inspect again.');
			if (!Array.isArray(approvedMissingPaths) || !same([...approvedMissingPaths].sort(), missingPaths)
				|| !blobs || ![Object.prototype, null].includes(Object.getPrototypeOf(blobs))
				|| Object.keys(blobs).some(path => !missingPaths.includes(path))) {
				throw new Error('Approve the exact missing asset paths and supply only their immutable intended bytes.');
			}
			busy = true;
			try {
				const capturedBlobs = new Map(Object.entries(blobs));
				guard(); await native();
				const supplied = new Map();
				for (const asset of inventory.filter(item => item.status === 'missing')) {
					const blob = asset.role === 'archive' && archiveBlob !== undefined ? archiveBlob : capturedBlobs.get(asset.file.path);
					await matches(blob, asset.file); guard();
					if (asset.role === 'output' && await verifyOutput(new Uint8Array(await blob.arrayBuffer()), structuredClone(asset.file)) !== true) {
						throw new Error('Supplied recovery output failed decode/render acceptance.');
					}
					supplied.set(asset.file.path, blob);
				}
				for (const asset of inventory) {
					guard(); await native();
					if (await present(asset.file)) await readVerifiedFile(asset.file, options);
					else {
						const blob = supplied.get(asset.file.path);
						if (!blob) throw new Error(`Previously verified asset disappeared; review again: ${asset.file.path}.`);
						const saved = await persistVerifiedFile(blob, { ...options, root: asset.file.root,
							filename: asset.file.path.slice(asset.file.root.length + 1) });
						if (!same(saved, asset.file)) throw new Error('Recovered upload differs from immutable file intent.');
					}
				}
				const verifyPhase = proposed => verifyJournaledOptimizationPhase(scene, proposed, { ...options, verifyOutput });
				if (entry.phase === 'intent') {
					journal = await advanceOptimizationOperation(scene, journal, token, 'assets-verified',
						{ isCurrent: access, verifyPhase });
				} else await verifyPhase({ ...entry, phase: 'assets-verified' });
				guard(); await native(); guard();
				finished = true;
				return { token, sceneId: scene.id, phase: 'assets-verified', journal: structuredClone(journal) };
			} finally { busy = false; }
		} };
}
