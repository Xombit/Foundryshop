import { zipSync, unzipSync } from '../vendor/fflate.js';
import { fileFingerprint, validateStoredFile, readVerifiedFile } from '../verified_file_storage.js';
import { inspectOptimizationImage } from '../optimization_media.js';
import { readOptimizationArchive, optimizationArchiveDescriptor } from './optimization_recovery.js';
import { readOptimizationJournal } from './optimization_journal.js';
import { canonicalJson } from './project_package.js';

export const RECOVERY_FILE_BUNDLE_FORMAT = 'foundryshop-recovery-files';
const manifestPath = 'manifest.json';
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
	&& Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const entryPath = reference => `files/${reference.fingerprint}.${reference.path.split('.').at(-1)}`;
const safeEntry = path => path === manifestPath || /^files\/[a-f0-9]{64}\.(json|png|webp|jpg|jpeg)$/.test(path);
const text = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

export function recoveryZipBudget(options) {
	if (!options || !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes >= 0xffffffff
		|| !Number.isSafeInteger(options.maxEntries) || options.maxEntries < 2 || options.maxEntries >= 65535) {
		throw new Error('Recovery ZIP requires explicit positive ZIP32 byte and entry budgets.');
	}
	return options;
}

export function encodeStoredRecoveryZip(entries, options) {
	const limits = recoveryZipBudget(options);
	if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('Recovery ZIP requires an entry inventory.');
	const inventory = Object.entries(entries);
	if (inventory.some(([name, bytes]) => !safeEntry(name) || !(bytes instanceof Uint8Array))
		|| !Object.hasOwn(entries, manifestPath)) throw new Error('Recovery ZIP entry inventory is invalid.');
	const estimate = inventory.reduce((sum, [name, bytes]) => sum + bytes.length + 76 + 2 * name.length, 22);
	if (inventory.length > limits.maxEntries || estimate > limits.maxBytes) throw new Error('Recovery ZIP exceeds the reviewed byte or entry budget.');
	const result = zipSync(entries, { level: 0 });
	inspectZip(result, limits);
	return result;
}

export function decodeStoredRecoveryZip(input, options) {
	const limits = recoveryZipBudget(options);
	if (!(input instanceof Uint8Array) || input.length > limits.maxBytes) {
		throw new Error('Recovery ZIP requires binary bytes within the reviewed budget.');
	}
	const captured = input.slice();
	inspectZip(captured, limits);
	return unzipSync(captured);
}

// Admit only ordinary stored ZIP32 entries before the library allocates output.
function inspectZip(bytes, limits) {
	if (!(bytes instanceof Uint8Array) || bytes.length < 22 || bytes.length > limits.maxBytes) {
		throw new Error('Recovery ZIP is empty, truncated or exceeds the reviewed byte budget.');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = bytes.length - 22;
	if (view.getUint32(end, true) !== 0x06054b50 || view.getUint16(end + 20, true)
		|| view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) {
		throw new Error('Recovery ZIP requires a complete single-disk ZIP32 container without trailing data.');
	}
	const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true),
		start = view.getUint32(end + 16, true);
	if (count < 2 || count > limits.maxEntries || count !== view.getUint16(end + 8, true)
		|| start + size !== end) throw new Error('Recovery ZIP entry count or central directory is invalid.');
	const records = [], names = new Set();
	let offset = start;
	for (let index = 0; index < count; index++) {
		if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid recovery ZIP directory.');
		const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true),
			length = view.getUint32(offset + 20, true), unpacked = view.getUint32(offset + 24, true),
			nameLength = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true),
			comment = view.getUint16(offset + 32, true), local = view.getUint32(offset + 42, true);
		if (flags !== 0 || method !== 0 || length !== unpacked || extra || comment
			|| view.getUint16(offset + 34, true) || offset + 46 + nameLength > end) {
			throw new Error('Recovery ZIP rejects compression, encryption, descriptors and extended entries.');
		}
		const name = text(bytes.subarray(offset + 46, offset + 46 + nameLength));
		if (!safeEntry(name) || names.has(name)) throw new Error('Recovery ZIP has unsafe or duplicate entry names.');
		names.add(name);
		records.push({ name, local, length, crc: view.getUint32(offset + 16, true), nameLength });
		offset += 46 + nameLength;
	}
	if (offset !== end || !names.has(manifestPath)) throw new Error('Recovery ZIP manifest/directory is incomplete.');
	let next = 0;
	for (const record of records.sort((a, b) => a.local - b.local)) {
		const at = record.local;
		if (at !== next || at + 30 > start || view.getUint32(at, true) !== 0x04034b50
			|| view.getUint16(at + 6, true) || view.getUint16(at + 8, true)
			|| view.getUint32(at + 14, true) !== record.crc
			|| view.getUint32(at + 18, true) !== record.length || view.getUint32(at + 22, true) !== record.length
			|| view.getUint16(at + 26, true) !== record.nameLength || view.getUint16(at + 28, true)) {
			throw new Error('Recovery ZIP local entry differs from its directory or overlaps another entry.');
		}
		next = at + 30 + record.nameLength + record.length;
		if (next > start || text(bytes.subarray(at + 30, at + 30 + record.nameLength)) !== record.name) {
			throw new Error('Recovery ZIP local filename or byte range is invalid.');
		}
	}
	if (next !== start) throw new Error('Recovery ZIP contains unlisted local data.');
	return names;
}

export async function verifyRecoveryBundleFiles(files) {
	if (!Array.isArray(files) || !files.length) throw new Error('Recovery bundle requires verified archive and image files.');
	const byPath = new Map(), archives = new Map(), usedImages = new Set();
	for (const file of files) {
		if (!exact(file, ['reference', 'bytes'])) throw new Error('Invalid recovery bundle file record.');
		const reference = validateStoredFile(file.reference);
		if (!safeEntry(entryPath(reference)) || byPath.has(reference.path)
			|| !(file.bytes instanceof Uint8Array) || file.bytes.length !== reference.bytes
			|| await fileFingerprint(file.bytes) !== reference.fingerprint) {
			throw new Error('Recovery bundle file is duplicated, unsupported or differs from its verified bytes.');
		}
		byPath.set(reference.path, { reference, bytes: file.bytes });
		if (reference.path.endsWith('.json')) archives.set(reference.path, await readOptimizationArchive(text(file.bytes)));
		else {
			const image = inspectOptimizationImage(file.bytes), extension = reference.path.split('.').at(-1);
			if (image.extension !== (extension === 'jpeg' ? 'jpg' : extension)) {
				throw new Error('Recovery image extension differs from its verified container.');
			}
		}
	}
	if (!archives.size) throw new Error('Recovery bundle has no typed recovery archive.');
	const identities = new Set();
	for (const archive of archives.values()) {
		const { payload } = archive;
		const identity = `${payload.sceneId}:${payload.id}`;
		if (identities.has(identity)) throw new Error('Recovery bundle duplicates an operation identity.');
		identities.add(identity);
		for (const reference of [payload.output, ...(payload.originalBackground ? [payload.originalBackground.file] : [])]) {
			if (!same(byPath.get(reference.path)?.reference, reference) || archives.has(reference.path)) {
				throw new Error('Recovery bundle is missing an exact output or original-background image.');
			}
			usedImages.add(reference.path);
		}
		const seen = new Set([payload.id]);
		let child = payload;
		while (child.parent !== null) {
			const parent = archives.get(child.parent.file.path);
			if (!parent || !same(byPath.get(child.parent.file.path).reference, child.parent.file)
				|| parent.checksum !== child.parent.checksum || parent.payload.sceneId !== child.sceneId
				|| parent.payload.levelId !== child.levelId || parent.payload.replacement.type !== 'Drawing'
				|| seen.has(parent.payload.id)
				|| !child.originals.some(original => same(original, parent.payload.replacement.after))) {
				throw new Error('Recovery bundle ancestry is missing, cyclic or differs from its exact reference.');
			}
			seen.add(parent.payload.id);
			child = parent.payload;
		}
	}
	if ([...byPath.keys()].some(path => !archives.has(path) && !usedImages.has(path))) {
		throw new Error('Recovery bundle contains an unreferenced image.');
	}
	return [...byPath.values()];
}

/** Immutable file transport only; this does not make archives usable in another Scene. */
export async function encodeRecoveryFileBundle(files, options) {
	const limits = recoveryZipBudget(options);
	if (!Array.isArray(files) || !files.length || files.length > limits.maxEntries - 1
		|| files.some(file => !exact(file, ['reference', 'bytes']) || !(file.bytes instanceof Uint8Array))
		|| files.reduce((sum, file) => sum + file.bytes.length, 0) > limits.maxBytes) {
		throw new Error('Recovery file inventory is invalid or exceeds the reviewed budget.');
	}
	const captured = files.map(file => ({ reference: structuredClone(file.reference), bytes: file.bytes.slice() }));
	const verified = await verifyRecoveryBundleFiles(captured), entries = Object.create(null);
	const manifest = { format: RECOVERY_FILE_BUNDLE_FORMAT, version: 1, files: verified.map(file => ({
		entry: entryPath(file.reference), reference: file.reference,
	})) };
	entries[manifestPath] = new TextEncoder().encode(JSON.stringify(manifest));
	for (const file of verified) entries[entryPath(file.reference)] = file.bytes;
	return encodeStoredRecoveryZip(entries, limits);
}

/** Strict stored ZIP32 reader; hashes detect corruption, not provenance or authenticity. */
export async function decodeRecoveryFileBundle(input, options) {
	const limits = recoveryZipBudget(options), entries = decodeStoredRecoveryZip(input, limits),
		names = new Set(Object.keys(entries));
	const manifest = JSON.parse(text(entries[manifestPath]));
	if (!exact(manifest, ['format', 'version', 'files']) || manifest.format !== RECOVERY_FILE_BUNDLE_FORMAT
		|| manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.length
		|| manifest.files.length > limits.maxEntries - 1) throw new Error('Invalid recovery file-bundle manifest.');
	const declared = new Set([manifestPath]), files = manifest.files.map(file => {
		if (!exact(file, ['entry', 'reference'])) throw new Error('Invalid recovery manifest file.');
		const reference = validateStoredFile(file.reference);
		if (file.entry !== entryPath(reference) || !names.has(file.entry)) throw new Error('Recovery manifest points outside its exact file inventory.');
		declared.add(file.entry);
		return { reference, bytes: entries[file.entry] };
	});
	if (declared.size !== names.size) throw new Error('Recovery ZIP contains undeclared files.');
	return verifyRecoveryBundleFiles(files);
}

/** Read-only same-Level evidence collection, not a portable project export or destination import. */
export async function prepareRecoveryFileBundle(scene, { levelId, maxBytes, maxEntries, signal, isCurrent, timeout = 30000 } = {}) {
	const limits = recoveryZipBudget({ maxBytes, maxEntries });
	if (!game.user?.isGM || !scene || !scene.levels?.has(levelId) || typeof isCurrent !== 'function'
		|| scene.getFlag('foundryshop', 'projectImportJournal')) {
		throw new Error('Recovery file collection requires a GM, explicit current Scene/Level and no unfinished import.');
	}
	const snapshot = canonicalJson(scene.toObject()), journal = readOptimizationJournal(scene), owner = game.user.id;
	if (journal.entries.some(entry => entry.phase !== 'complete')) throw new Error('Resolve unfinished optimization operations before bundling recovery.');
	const operations = journal.entries.filter(entry => entry.levelId === levelId && entry.action === 'apply');
	if (!operations.length) throw new Error('The chosen Level has no retained optimization recovery.');
	const check = () => {
		if (!game.user?.isGM || game.user.id !== owner || signal?.aborted || !isCurrent()
			|| game.scenes?.get(scene.id) !== scene || canonicalJson(scene.toObject()) !== snapshot) {
			throw new Error('Recovery file collection source/authority/context changed.');
		}
		return true;
	};
	check();
	const files = new Map();
	let total = 0;
	const collect = async reference => {
		const previous = files.get(reference.path);
		if (previous) {
			if (!same(previous.reference, reference)) throw new Error('Recovery file path has conflicting retained descriptors.');
			return previous.bytes;
		}
		if (files.size + 2 > limits.maxEntries || total + reference.bytes > limits.maxBytes) {
			throw new Error('Recovery file collection exceeds the reviewed budget.');
		}
		const bytes = await readVerifiedFile(reference, { signal, isCurrent: check, timeout });
		check();
		files.set(reference.path, { reference: structuredClone(reference), bytes });
		total += bytes.length;
		return bytes;
	};
	for (const operation of operations) {
		const archiveBytes = await collect(operation.archive), archiveText = text(archiveBytes),
			{ payload } = await readOptimizationArchive(archiveText),
			descriptor = await optimizationArchiveDescriptor(archiveText);
		check();
		if (payload.id !== operation.token || payload.sceneId !== scene.id || payload.levelId !== levelId
			|| !same(descriptor, { archiveChecksum: operation.archiveChecksum,
				sourceCount: operation.sourceCount, sourceDigest: operation.sourceDigest,
				asset: operation.asset, replacement: operation.replacement })) {
			throw new Error('Recovery archive differs from its retained journal operation.');
		}
		const parent = operation.parentToken === null ? null : operations.find(entry => entry.token === operation.parentToken);
		if (operation.parentToken !== null && !parent || !same(payload.parent,
			parent ? { file: parent.archive, checksum: parent.archiveChecksum } : null)) {
			throw new Error('Recovery archive ancestry differs from its retained journal.');
		}
		await collect(operation.asset);
		if (payload.originalBackground) await collect(payload.originalBackground.file);
	}
	const bytes = await encodeRecoveryFileBundle([...files.values()], limits);
	check();
	return { bytes, review: {
		sourceSceneId: scene.id, sourceLevelId: levelId, operationTokens: operations.map(entry => entry.token),
		fileCount: files.size, zipBytes: bytes.length, maxBytes, maxEntries,
		disclosure: 'Verified immutable recovery files only. No project, resource bundling, destination remapping, upload, native writes or portable Restore capability is provided.',
	} };
}
