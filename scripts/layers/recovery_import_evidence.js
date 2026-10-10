import { fileFingerprint } from '../verified_file_storage.js';
import { recoveryZipBudget } from './recovery_file_bundle.js';
import { decodeRecoveryProjectBundle } from './recovery_project_bundle.js';

export const RECOVERY_IMPORT_EVIDENCE_FORMAT = 'foundryshop-recovery-import-evidence';
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
	&& Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = message => { throw new Error(`Recovery import evidence: ${message}`); };

function base64(bytes) {
	const chunks = [];
	for (let offset = 0; offset < bytes.length; offset += 16384) {
		chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 16384)));
	}
	return btoa(chunks.join(''));
}

/** Actual JSON transport for Foundry storage; portable exchange remains an unchanged ZIP. */
export async function encodeRecoveryImportEvidence(zip, options) {
	const limits = recoveryZipBudget(options);
	if (!(zip instanceof Uint8Array) || !zip.length || zip.length > limits.maxBytes) fail('JSON evidence exceeds the reviewed byte budget.');
	const evidence = { format: RECOVERY_IMPORT_EVIDENCE_FORMAT, version: 1,
		bundle: { encoding: 'base64', bytes: zip.length, fingerprint: await fileFingerprint(zip), data: '' } };
	const size = new TextEncoder().encode(JSON.stringify(evidence)).length + 4 * Math.ceil(zip.length / 3);
	if (size > limits.maxBytes) fail('JSON evidence exceeds the reviewed byte budget.');
	await decodeRecoveryProjectBundle(zip, limits);
	evidence.bundle.data = base64(zip);
	const bytes = new TextEncoder().encode(JSON.stringify(evidence));
	if (bytes.length > limits.maxBytes) fail('JSON evidence exceeds the reviewed byte budget.');
	return bytes;
}

/** Bounds JSON and decoded ZIP before byte allocation, then checks the inner hash and full recovery closure. */
export async function decodeRecoveryImportEvidence(input, options) {
	const limits = recoveryZipBudget(options);
	if (!(input instanceof Uint8Array) || !input.length || input.length > limits.maxBytes) fail('JSON evidence exceeds the reviewed byte budget.');
	const evidence = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input));
	if (!exact(evidence, ['format', 'version', 'bundle']) || evidence.format !== RECOVERY_IMPORT_EVIDENCE_FORMAT
		|| evidence.version !== 1 || !exact(evidence.bundle, ['encoding', 'bytes', 'fingerprint', 'data'])) {
		fail('Invalid versioned JSON evidence.');
	}
	const { encoding, bytes, fingerprint, data } = evidence.bundle;
	if (encoding !== 'base64' || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > limits.maxBytes
		|| typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)
		|| typeof data !== 'string' || data.length !== 4 * Math.ceil(bytes / 3)
		|| !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
		fail('Invalid bounded ZIP descriptor/base64.');
	}
	const binary = atob(data);
	if (binary.length !== bytes || btoa(binary) !== data) fail('Noncanonical base64 or decoded byte count.');
	const zip = Uint8Array.from(binary, character => character.charCodeAt(0));
	if (await fileFingerprint(zip) !== fingerprint) fail('Retained inner ZIP fingerprint differs.');
	return decodeRecoveryProjectBundle(zip, limits);
}
