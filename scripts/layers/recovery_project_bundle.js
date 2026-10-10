import {
	recoveryZipBudget, encodeStoredRecoveryZip, decodeStoredRecoveryZip,
} from './recovery_file_bundle.js';
import { validateRecoveryProjectManifest, prepareRecoveryProjectManifest } from './recovery_project_manifest.js';
import { canonicalJson } from './project_package.js';
import { fileFingerprint, validateStoredFile } from '../verified_file_storage.js';
import { inspectOptimizationImage } from '../optimization_media.js';
import { loadBakeImage } from '../bake_resources.js';
import { classifyTexturePath } from './project_resources.js';

export const RECOVERY_PROJECT_BUNDLE_FORMAT = 'foundryshop-recovery-project-bundle';
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
	&& Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const pathFor = (fingerprint, extension) => `files/${fingerprint}.${extension}`;
const recoveryPath = reference => pathFor(reference.fingerprint, reference.path.split('.').at(-1));
const utf8 = new TextEncoder();
const fail = message => { throw new Error(`Recovery project ZIP: ${message}`); };

async function verifyAssets(manifest, assets) {
	const missing = manifest.resources.images.filter(image => image.file === null).map(image => image.source);
	if (!Array.isArray(assets) || assets.length !== missing.length) fail('All ordinary image bytes are required.');
	const sources = new Set();
	for (const asset of assets) {
		if (!exact(asset, ['source', 'bytes']) || !missing.includes(asset.source) || sources.has(asset.source)
			|| !(asset.bytes instanceof Uint8Array) || !asset.bytes.length) fail('Invalid or duplicate image-byte inventory.');
		sources.add(asset.source);
		inspectOptimizationImage(asset.bytes);
	}
}

/** Self-contained artwork-image transport; fonts/modules remain destination requirements and no import writes occur. */
export async function encodeRecoveryProjectBundle(input, recoveryFiles, imageAssets, options) {
	const limits = recoveryZipBudget(options);
	if (!Array.isArray(recoveryFiles) || !Array.isArray(imageAssets)
		|| recoveryFiles.length > limits.maxEntries || imageAssets.length > limits.maxEntries
		|| recoveryFiles.some(file => !exact(file, ['reference', 'bytes']))
		|| imageAssets.some(file => !exact(file, ['source', 'bytes']))
		|| [...recoveryFiles, ...imageAssets].some(file => !(file?.bytes instanceof Uint8Array))
		|| [...recoveryFiles, ...imageAssets].reduce((sum, file) => sum + file.bytes.length, 0) > limits.maxBytes) {
		fail('Image/recovery bytes exceed the reviewed budget or have an invalid inventory.');
	}
	const files = recoveryFiles.map(file => ({ reference: structuredClone(file.reference), bytes: file.bytes.slice() })),
		assets = imageAssets.map(asset => ({ source: asset.source, bytes: asset.bytes.slice() }));
	const project = await validateRecoveryProjectManifest(input, files);
	await verifyAssets(project, assets);
	const entries = Object.create(null);
	const manifest = { format: RECOVERY_PROJECT_BUNDLE_FORMAT, version: 1, project,
		recovery: files.map(file => ({ entry: recoveryPath(file.reference), reference: file.reference })),
		images: [] };
	for (const file of files) entries[recoveryPath(file.reference)] = file.bytes;
	for (const asset of assets) {
		const header = inspectOptimizationImage(asset.bytes), fingerprint = await fileFingerprint(asset.bytes),
			entry = pathFor(fingerprint, header.extension);
		if (entries[entry] && (entries[entry].length !== asset.bytes.length
			|| !entries[entry].every((byte, index) => byte === asset.bytes[index]))) {
			fail('Content-addressed image entry has conflicting bytes.');
		}
		entries[entry] = asset.bytes;
		manifest.images.push({ source: asset.source, entry, bytes: asset.bytes.length, fingerprint,
			extension: header.extension, width: header.width, height: header.height });
	}
	entries['manifest.json'] = utf8.encode(JSON.stringify(manifest));
	return encodeStoredRecoveryZip(entries, limits);
}

/** Pure byte/container/hash validation; browser/GPU/font and destination recovery acceptance remain separate. */
export async function decodeRecoveryProjectBundle(input, options) {
	const limits = recoveryZipBudget(options), entries = decodeStoredRecoveryZip(input, limits),
		manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entries['manifest.json']));
	if (!exact(manifest, ['format', 'version', 'project', 'recovery', 'images'])
		|| manifest.format !== RECOVERY_PROJECT_BUNDLE_FORMAT || manifest.version !== 1
		|| !Array.isArray(manifest.recovery) || !Array.isArray(manifest.images)
		|| manifest.recovery.length > limits.maxEntries || manifest.images.length > limits.maxEntries) {
		fail('Invalid enclosing project manifest.');
	}
	const used = new Set(['manifest.json']);
	const files = manifest.recovery.map(file => {
		if (!exact(file, ['entry', 'reference'])) fail('Invalid recovery entry descriptor.');
		const reference = validateStoredFile(file.reference);
		if (file.entry !== recoveryPath(reference) || !Object.hasOwn(entries, file.entry)) fail('Missing exact recovery entry.');
		used.add(file.entry);
		return { reference, bytes: entries[file.entry] };
	});
	const project = await validateRecoveryProjectManifest(manifest.project, files), assets = [];
	for (const asset of manifest.images) {
		if (!exact(asset, ['source', 'entry', 'bytes', 'fingerprint', 'extension', 'width', 'height'])
			|| typeof asset.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(asset.fingerprint)
			|| !['png', 'webp', 'jpg'].includes(asset.extension)
			|| asset.entry !== pathFor(asset.fingerprint, asset.extension)
			|| !Object.hasOwn(entries, asset.entry)) fail('Invalid image entry descriptor.');
		const bytes = entries[asset.entry], header = inspectOptimizationImage(bytes);
		if (asset.bytes !== bytes.length || await fileFingerprint(bytes) !== asset.fingerprint
			|| asset.extension !== header.extension || asset.width !== header.width || asset.height !== header.height) {
			fail('Image bytes or dimensions differ from the manifest.');
		}
		used.add(asset.entry);
		assets.push({ source: asset.source, bytes });
	}
	await verifyAssets(project, assets);
	if (used.size !== Object.keys(entries).length) fail('ZIP contains undeclared entries.');
	return { manifest: project, recoveryFiles: files, imageAssets: assets };
}

/** Same-server read-only collection. External resources are refused without making any external request. */
export async function prepareRecoveryProjectBundle(scene, options = {}) {
	const limits = recoveryZipBudget(options), { isCurrent, signal } = options;
	if (!game.user?.isGM || typeof isCurrent !== 'function' || !scene) fail('GM and explicit source guard are required.');
	const snapshot = canonicalJson(scene.toObject()), owner = game.user.id;
	const check = () => {
		if (!game.user?.isGM || game.user.id !== owner || signal?.aborted || !isCurrent()
			|| game.scenes?.get(scene.id) !== scene || canonicalJson(scene.toObject()) !== snapshot) {
			fail('Source authority/context changed.');
		}
		return true;
	};
	check();
	const prepared = await prepareRecoveryProjectManifest(scene, { ...options, isCurrent: check });
	const missing = prepared.manifest.resources.images.filter(image => image.file === null);
	const classified = missing.map(image => ({ ...image, classified: classifyTexturePath(image.source, location.href) }));
	if (classified.some(image => image.classified.kind !== 'local')) fail('Only same-server ordinary textures can be bundled; external/invalid paths are unsupported.');
	const assets = [], reads = new Map();
	let total = prepared.recoveryFiles.reduce((sum, file) => sum + file.bytes.length, 0);
	for (const image of classified) {
		let bytes = reads.get(image.classified.url);
		if (!bytes) {
			if (total >= limits.maxBytes) fail('Resources exceed the reviewed byte budget.');
			const resource = await loadBakeImage(image.source, { signal, isCurrent: check,
				timeout: options.timeout, maxBytes: limits.maxBytes - total });
			try {
				bytes = new Uint8Array(await resource.blob.arrayBuffer());
				check();
				reads.set(image.classified.url, bytes);
				total += bytes.length;
			} finally { resource.destroy(); }
		}
		assets.push({ source: image.source, bytes });
	}
	const bytes = await encodeRecoveryProjectBundle(prepared.manifest, prepared.recoveryFiles, assets, limits);
	check();
	return { bytes, review: { ...prepared.review, zipBytes: bytes.length, ordinaryImageCount: assets.length,
		disclosure: 'Verified same-server artwork images and retained recovery history. Fonts/modules are destination requirements, not embedded files. No destination remapping, uploads, native writes or portable Restore acceptance occurred.' } };
}
