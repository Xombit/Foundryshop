import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	authorizeRecoveryImportCreates, authorizeRecoveryImportDeletes, authorizeRecoveryImportUpdates,
	isAuthorizedRecoveryImportCreate, isAuthorizedRecoveryImportDelete, isAuthorizedRecoveryImportUpdate,
} from '../scripts/layers/recovery_import_native_guard.js';

test('scoped native permissions survive host option copies but not revocation, other actions or changed context', () => {
	const prior = globalThis.game;
	globalThis.game = { user: { id: 'gm', isGM: true }, users: { activeGM: { id: 'gm' } } };
	try {
		let intent = { token: 'import', ownerId: 'gm', phase: 'tree-installed' };
		const scene = { getFlag: () => intent };
		let source = { _id: 'drawing', hidden: true, flags: { foundryshop: { importStaging: 'import', layerId: 'ink' } } };
		const document = { id: 'drawing', parent: scene, toObject: () => structuredClone(source),
			getFlag: (namespace, key) => source.flags[namespace]?.[key] };
		const patch = { _id: 'drawing', hidden: false, 'flags.foundryshop.-=importStaging': null };
		for (const [phase, authorize, check] of [
			['tree-installed', authorizeRecoveryImportCreates, opts => isAuthorizedRecoveryImportCreate(document, opts)],
			['compensating', authorizeRecoveryImportDeletes, opts => isAuthorizedRecoveryImportDelete(document, opts)],
			['history-installed', authorizeRecoveryImportUpdates, opts => isAuthorizedRecoveryImportUpdate(document, patch, opts)],
		]) {
			intent = { ...intent, phase };
			const options = {}, revoke = authorize(options, scene, intent, [source], [patch]);
			const copied = structuredClone(options);
			assert.equal(check(copied), true);
			assert.equal(check({}), false);
			assert.equal(check({ ...copied, _foundryshopRecoveryNative: 'fabricated' }), false);
			assert.equal(isAuthorizedRecoveryImportCreate(document, copied), phase === 'tree-installed');
			assert.equal(isAuthorizedRecoveryImportDelete(document, copied), phase === 'compensating');
			assert.equal(isAuthorizedRecoveryImportUpdate(document, patch, copied), phase === 'history-installed');
			const before = source;
			source = { ...source, x: 99 };
			assert.equal(check(copied), false);
			source = before;
			game.users.activeGM.id = 'other';
			assert.equal(check(copied), false);
			game.users.activeGM.id = 'gm';
			const retained = intent;
			intent = { ...intent, token: 'other' };
			assert.equal(check(copied), false);
			intent = retained;
			revoke();
			assert.deepEqual(options, {});
			assert.equal(check(copied), false);
		}
	} finally { globalThis.game = prior; }
});

test('release permissions accept only exact flattened or host-expanded hidden/staging patches', () => {
	const prior = globalThis.game;
	globalThis.game = { user: { id: 'gm', isGM: true }, users: { activeGM: { id: 'gm' } } };
	try {
		const intent = { token: 'import', ownerId: 'gm', phase: 'history-installed' };
		const scene = { getFlag: () => intent };
		const source = { _id: 'drawing', hidden: true, flags: { foundryshop: { importStaging: 'import' } } };
		const document = { id: source._id, parent: scene, toObject: () => structuredClone(source),
			getFlag: (namespace, key) => source.flags[namespace]?.[key] };
		for (const wholeNamespace of [false, true]) {
			const patch = { _id: source._id, hidden: false,
				[wholeNamespace ? 'flags.-=foundryshop' : 'flags.foundryshop.-=importStaging']: null };
			const expanded = { _id: source._id, hidden: false,
				flags: wholeNamespace ? { '-=foundryshop': null } : { foundryshop: { '-=importStaging': null } } };
			const options = {}, revoke = authorizeRecoveryImportUpdates(options, scene, intent, [source], [patch]);
			const copied = structuredClone(options);
			assert.equal(isAuthorizedRecoveryImportUpdate(document, expanded, copied), true);
			for (const changed of [{ ...expanded, x: 1 }, { ...expanded, hidden: true },
				{ ...expanded, flags: { foundryshop: { '-=importStaging': null, layerId: 'other' } } }]) {
				assert.equal(isAuthorizedRecoveryImportUpdate(document, changed, copied), false);
			}
			revoke();
			assert.equal(isAuthorizedRecoveryImportUpdate(document, expanded, copied), false);
		}
		assert.throws(() => authorizeRecoveryImportUpdates({}, scene, intent, [source],
			[{ _id: source._id, hidden: false, x: 1 }]), /exact hidden/);
	} finally { globalThis.game = prior; }
});
