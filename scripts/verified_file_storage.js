import { validateAssetFolder } from './artwork_stamps.js';

const pendingPaths = new Set();
export const fileFingerprint = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
	.map(byte => byte.toString(16).padStart(2, '0')).join('');

function filePath(root, filename) {
	validateAssetFolder(root);
	if (typeof filename !== 'string' || !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{1,16}$/.test(filename)) {
		throw new Error('Invalid internal recovery asset filename.');
	}
	return `${root}/${filename}`;
}

export function validateStoredFile(reference) {
	if (!reference || typeof reference !== 'object' || Array.isArray(reference) || Object.keys(reference).length !== 5
		|| !['version', 'root', 'path', 'bytes', 'fingerprint'].every(key => Object.hasOwn(reference, key))
		|| reference.version !== 1 || typeof reference.path !== 'string'
		|| typeof reference.root !== 'string'
		|| !Number.isSafeInteger(reference.bytes) || reference.bytes <= 0
		|| typeof reference.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(reference.fingerprint)
		|| filePath(reference.root, reference.path.slice(reference.root.length + 1)) !== reference.path) {
		throw new Error('Invalid verified file reference.');
	}
	return structuredClone(reference);
}

function checkAccess(signal, isCurrent, upload = false) {
	if (signal?.aborted) throw new Error('Recovery storage operation cancelled.');
	if (!game.user?.isGM || !game.user.can('FILES_BROWSE') || (upload && !game.user.can('FILES_UPLOAD'))) {
		throw new Error('Recovery storage requires GM file permissions.');
	}
	if (!isCurrent()) throw new Error('Recovery storage source/context changed.');
}

/** A failed upload may still have written bytes; retain the path for later journal reconciliation. */
export class UnverifiedFileError extends Error {
	constructor(path, cause) {
		super(`Internal asset upload is unverified at ${path}: ${cause.message}`, { cause });
		this.name = 'UnverifiedFileError';
		this.path = path;
	}
}

/** Reads exactly the expected size; no arbitrary image/memory admission cap is imposed here. */
export async function readVerifiedFile(reference, { signal, isCurrent = () => true, timeout = 30000 } = {}) {
	const expected = validateStoredFile(reference);
	if (!Number.isSafeInteger(timeout) || timeout < 0) throw new Error('Invalid recovery read timeout.');
	const check = () => checkAccess(signal, isCurrent);
	check();
	const controller = new AbortController(), abort = () => controller.abort();
	signal?.addEventListener('abort', abort, { once: true });
	const timer = timeout ? setTimeout(abort, timeout) : null;
	try {
		const url = new URL(expected.path.split('/').map(encodeURIComponent).join('/'), location.href);
		const response = await fetch(url, {
			signal: controller.signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store',
		});
		if (!response.ok || !response.body) {
			await response.body?.cancel();
			throw new Error(`Recovery file read failed: HTTP ${response.status}.`);
		}
		const reader = response.body.getReader();
		let bytes;
		try {
			check();
			const length = response.headers.get('content-length'), encoding = response.headers.get('content-encoding');
			if ((!encoding || encoding === 'identity') && length !== null
				&& (!/^\d+$/.test(length) || Number(length) !== expected.bytes)) {
				throw new Error('Recovery file size differs from its verified reference.');
			}
			bytes = new Uint8Array(expected.bytes);
			let offset = 0;
			while (true) {
				const { done, value } = await reader.read();
				check();
				if (done) break;
				if (offset + value.byteLength > bytes.length) throw new Error('Recovery file exceeds its verified size.');
				bytes.set(value, offset);
				offset += value.byteLength;
			}
			if (offset !== bytes.length) throw new Error('Recovery file is truncated.');
		} finally { await reader.cancel(); reader.releaseLock(); }
		if (await fileFingerprint(bytes) !== expected.fingerprint) throw new Error('Recovery file fingerprint mismatch.');
		check();
		if (controller.signal.aborted) throw new Error('Recovery file read cancelled or timed out.');
		return bytes;
	} finally {
		if (timer !== null) clearTimeout(timer);
		signal?.removeEventListener('abort', abort);
	}
}

/** Caller journals intent before invoking this. Success means verified bytes, not a verified document swap. */
export async function persistVerifiedFile(blob, { root, filename, signal, isCurrent, timeout = 30000 } = {}) {
	if (!(blob instanceof Blob) || !blob.size || typeof isCurrent !== 'function') {
		throw new Error('Recovery persistence requires nonempty bytes and an explicit source-currentness guard.');
	}
	const path = filePath(root, filename);
	const check = () => checkAccess(signal, isCurrent, true);
	check();
	if (pendingPaths.has(path)) throw new Error('Recovery asset path is already being written.');
	pendingPaths.add(path);
	let attempted = false;
	try {
		const fingerprint = await fileFingerprint(await blob.arrayBuffer());
		check();
		const picker = foundry.applications.apps.FilePicker.implementation;
		const listing = await picker.browse('data', root);
		check();
		if (!Array.isArray(listing.files)) throw new Error('Recovery folder listing is invalid.');
		if (listing.files.some(file => typeof file !== 'string'
			|| decodeURIComponent(file).toLowerCase() === path.toLowerCase())) {
			throw new Error('Recovery asset path is occupied or the listing is invalid.');
		}
		check();
		attempted = true;
		const uploaded = await picker.upload('data', root, new File([blob], filename, { type: blob.type }), {}, { notify: false });
		if (typeof uploaded?.path !== 'string' || decodeURIComponent(uploaded.path) !== path) {
			throw new Error('Recovery upload did not return the exact requested path.');
		}
		check();
		const reference = validateStoredFile({ version: 1, root, path, bytes: blob.size, fingerprint });
		await readVerifiedFile(reference, { signal, timeout, isCurrent: () => { check(); return true; } });
		check();
		return reference;
	} catch (error) {
		if (attempted) throw new UnverifiedFileError(path, error);
		throw error;
	} finally { pendingPaths.delete(path); }
}
