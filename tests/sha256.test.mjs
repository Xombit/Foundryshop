import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { sha256Hex } from '../scripts/sha256.js';

test('native and LAN HTTP SHA-256 produce identical fingerprints across padding boundaries and UTF-8', async () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
	try {
		for (const length of [0, 1, 55, 56, 63, 64, 65, 127, 128, 129, 10000]) {
			const bytes = Uint8Array.from({ length }, (_, i) => (i * 13) % 256);
			const expected = createHash('sha256').update(bytes).digest('hex');
			for (const crypto of [webcrypto, {}, undefined]) {
				Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto });
				assert.equal(await sha256Hex(bytes), expected);
			}
		}
		const bytes = new TextEncoder().encode('Artwork: \u00e9 \u6c34 \ud83d\ude82');
		assert.equal(await sha256Hex(bytes), createHash('sha256').update(bytes).digest('hex'));
		assert.equal(await sha256Hex(new Uint8Array()), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
		await assert.rejects(sha256Hex('invalid'), /Uint8Array/);
		Object.defineProperty(globalThis, 'crypto', { configurable: true,
			value: { subtle: { digest: async () => { throw new Error('native digest failed'); } } } });
		await assert.rejects(sha256Hex(bytes), /native digest failed/);
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
		else delete globalThis.crypto;
	}
});
