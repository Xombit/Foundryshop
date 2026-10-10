import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BAKE_RECOVERY_FOLDER, registerBakeStorageSetting, reviewBakeStorage } from '../scripts/layers/bake_storage.js';

let root, current, listing, requests, registered, browseHook;
beforeEach(() => {
	root = 'worlds/test/recovery'; current = true; requests = []; registered = []; browseHook = null;
	listing = { target: root, files: [], dirs: [], private: false };
	globalThis.game = { user: { id: 'gm', isGM: true, can: () => true }, users: { activeGM: { id: 'gm' } },
		i18n: { localize: key => key }, settings: {
			get: (module, key) => { assert.equal(module, 'foundryshop'); assert.equal(key, BAKE_RECOVERY_FOLDER); return root; },
			register: (module, key, options) => registered.push({ module, key, options }),
		} };
	globalThis.foundry = { applications: { apps: { FilePicker: { implementation: {
		browse: async (...args) => { requests.push(args); await browseHook?.(); return structuredClone(listing); },
		upload: () => assert.fail('storage preflight must not upload'),
		createDirectory: () => assert.fail('storage preflight must not create directories'),
	} } } } };
});
const review = extra => reviewBakeStorage({ isCurrent: () => current, ...extra });

test('registers an empty world folder setting with native folder picker, no speculative directories', () => {
	registerBakeStorageSetting();
	assert.equal(registered.length, 1);
	assert.deepEqual(registered[0], { module: 'foundryshop', key: BAKE_RECOVERY_FOLDER, options: {
		name: 'FOUNDRYSHOP.Bake.FolderName', hint: 'FOUNDRYSHOP.Bake.FolderHint',
		scope: 'world', config: true, type: String, default: '', filePicker: 'folder',
	} });
	assert.deepEqual(requests, []);
});
test('configured shared existing folder is inspected read-only and availability can be rechecked', async () => {
	const prepared = await review();
	assert.equal(prepared.root, root); assert.equal(prepared.review.configured, true);
	assert.deepEqual(requests, [['data', root]]);
	prepared.review.root = 'forged';
	assert.equal(await prepared.assertAvailable(), true);
	assert.deepEqual(requests[1], ['data', root]);
	assert.equal(prepared.assertCurrent(), true);
});
test('changed setting invalidates configured guard, but explicit retained paths do not depend on new setting', async () => {
	const prepared = await review(), explicit = await review({ root });
	root = 'worlds/test/new-recovery';
	assert.throws(prepared.assertCurrent, /StorageChanged/);
	await assert.rejects(prepared.assertAvailable(), /StorageChanged/);
	assert.equal(explicit.assertCurrent(), true);
	assert.equal(explicit.root, 'worlds/test/recovery');
});
test('invalid, empty and package folders refuse before network contact', async () => {
	for (const value of ['', '../worlds', 'modules/foundryshop', 'systems/test', 'worlds//test',
		'https://example.org/folder', 'worlds/test/']) {
		await assert.rejects(review({ root: value }), /Folder/);
	}
	assert.deepEqual(requests, []);
});
test('permissions, designated GM, cancellation and reviewed context are enforced before and after browse', async () => {
	game.user.can = permission => permission !== 'FILES_UPLOAD';
	await assert.rejects(review(), /StorageChanged/); assert.deepEqual(requests, []);
	game.user.can = () => true; game.users.activeGM.id = 'other';
	await assert.rejects(review(), /StorageChanged/);
	game.users.activeGM.id = 'gm';
	browseHook = () => { current = false; };
	await assert.rejects(review(), /StorageChanged/);
	current = true; browseHook = null;
	const controller = new AbortController(); controller.abort();
	await assert.rejects(review({ signal: controller.signal }), /StorageChanged/);
});
test('redirected/malformed folder listings and private folders are errors, not success-shaped storage', async () => {
	const valid = structuredClone(listing);
	for (const patch of [{ target: 'worlds/test' }, { files: null }, { dirs: null },
		{ files: [42] }, { dirs: [{}] }, { private: undefined }]) {
		listing = { ...valid, ...patch }; await assert.rejects(review(), /StorageListingInvalid/);
	}
	listing = { ...valid, private: true };
	await assert.rejects(review(), /StoragePrivate/);
});
test('server browse errors remain explicit and disappearing/changed folders invalidate availability', async () => {
	const prepared = await review();
	browseHook = () => { throw new Error('permission denied by server'); };
	await assert.rejects(prepared.assertAvailable(), /permission denied by server/);
	browseHook = null; listing.target = 'worlds';
	await assert.rejects(prepared.assertAvailable(), /StorageListingInvalid/);
});
test('changed owner/permissions after review are caught by the retained guard', async () => {
	const prepared = await review();
	game.user.id = 'different'; assert.throws(prepared.assertCurrent, /StorageChanged/);
	game.user.id = 'gm'; game.user.can = permission => permission !== 'FILES_BROWSE';
	assert.throws(prepared.assertCurrent, /StorageChanged/);
});
