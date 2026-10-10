import { sha256 } from './vendor/noble-hashes/sha2.js';

export async function sha256Hex(bytes) {
	if (!(bytes instanceof Uint8Array)) throw new TypeError('SHA-256 requires Uint8Array input.');
	const digest = globalThis.crypto?.subtle
		? new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
		: sha256(bytes);
	return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
