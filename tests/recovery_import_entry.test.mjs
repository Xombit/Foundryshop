import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { promptRecoveryImportSetup } from '../scripts/layers/recovery_import_entry.js';
import { RecoveryImportReviewCancelledError } from '../scripts/layers/recovery_import_dialogs.js';

class Element {
	constructor(tag) { this.tag = tag; this.children = []; this.value = ''; this.checked = false; }
	append(...children) { this.children.push(...children); }
	setAttribute(key, value) { this[key] = value; }
	addEventListener(key, callback) { this[key] = callback; }
}
const all = e => [e, ...e.children.flatMap(all)];
let scene, current, selectedFile, root, level, replace, cancelled, during, listing, browses, prompts, errors;
const options = () => ({ maxBytes: 10, maxEntries: 10, maxReceiptBytes: 1000, timeout: 30000, isCurrent: () => current });
beforeEach(() => {
	globalThis.File = File;
	current = true; root = 'worlds/test/assets'; level = 'floor'; replace = false; cancelled = false;
	during = () => {}; browses = 0; prompts = []; errors = [];
	globalThis.ui = { notifications: { error: message => errors.push(message) } };
	selectedFile = new File([new Uint8Array([1, 2, 3])], 'project.zip');
	scene = { id: 'scene', name: '<img src=x>', width: 800, levels: new Map([['floor', { id: 'floor', name: 'Ground' }]]),
		canUserModify: () => true, toObject: () => ({ _id: 'scene', width: scene.width }) };
	listing = { target: root, files: ['worlds/test/assets/retained.json'], dirs: [], private: false };
	globalThis.game = { user: { id: 'gm', isGM: true, can: () => true }, users: { activeGM: { id: 'gm' } },
		scenes: new Map([['scene', scene]]), i18n: { localize: key => key, format: (key, data) => `${key}: ${JSON.stringify(data)}` } };
	globalThis.document = { createElement: tag => new Element(tag) };
	globalThis.foundry = { applications: { apps: { FilePicker: { implementation: {
		browse: async () => { browses++; return structuredClone(listing); },
	} } }, api: { DialogV2: { prompt: async input => {
		prompts.push(input);
		if (cancelled) return null;
		const controls = all(input.content);
		controls.find(e => e.name === 'recoveryZip').files = selectedFile ? [selectedFile] : [];
		controls.find(e => e.name === 'destinationLevel').value = level;
		controls.find(e => e.name === 'storageRoot').value = root;
		controls.find(e => e.name === 'replaceMetadata').checked = replace;
		await during(input);
		return input.ok.callback();
	} } } } };
});

test('setup selects exact bounded bytes, Level and shared folder inventory without Scene writes', async () => {
	replace = true;
	const result = await promptRecoveryImportSetup(scene, options());
	assert.deepEqual([...result.input], [1, 2, 3]);
	assert.equal(result.options.levelId, 'floor'); assert.equal(result.options.root, root);
	assert.equal(result.options.replaceEmptyMetadata, true);
	assert.deepEqual(result.options.reservedPaths, listing.files);
	assert.equal(browses, 2);
	assert.equal(all(prompts[0].content).some(e => e.tag === 'img'), false);
	assert.equal(prompts[0].modal, true);
});
test('cancel, stale Scene and invalid budgets refuse without file reads or storage browse', async () => {
	cancelled = true;
	await assert.rejects(promptRecoveryImportSetup(scene, options()), RecoveryImportReviewCancelledError);
	cancelled = false; during = () => scene.width++;
	await assert.rejects(promptRecoveryImportSetup(scene, options()), /Changed/);
	await assert.rejects(promptRecoveryImportSetup(scene, { ...options(), maxBytes: 0 }), /SetupBudgets/);
	assert.equal(browses, 0);
});
test('missing, empty, oversized, wrong-extension files and unknown Levels refuse before storage', async () => {
	for (const file of [null, new File([], 'empty.zip'), new File([new Uint8Array(11)], 'large.zip'), new File(['a'], 'project.json')]) {
		selectedFile = file;
		await assert.rejects(promptRecoveryImportSetup(scene, options()), /InvalidZipFile/);
	}
	selectedFile = new File(['a'], 'project.zip'); level = 'unknown';
	await assert.rejects(promptRecoveryImportSetup(scene, options()), /SetupDestination/);
	assert.equal(browses, 0);
});
test('private/invalid storage, authority loss and context drift during file reading refuse', async () => {
	listing.private = true;
	await assert.rejects(promptRecoveryImportSetup(scene, options()), /StoragePrivate/);
	listing.private = false;
	game.users.activeGM.id = 'foreign';
	await assert.rejects(promptRecoveryImportSetup(scene, options()), /Changed/);
	game.users.activeGM.id = 'gm';
	selectedFile.arrayBuffer = async () => { scene.width++; return new ArrayBuffer(3); };
	await assert.rejects(promptRecoveryImportSetup(scene, options()), /Changed/);
});

test('native folder picker is data-bound, preserves manual input and closes with setup', async () => {
	let pickerOptions, closes = 0;
	const browser = foundry.applications.apps.FilePicker.implementation.browse;
	foundry.applications.apps.FilePicker.implementation = class {
		static browse = browser;
		constructor(options) { pickerOptions = options; }
		async render(options) {
			assert.deepEqual(options, { force: true });
			pickerOptions.callback(root);
		}
		async close() { closes++; }
	};
	during = async input => {
		const elements = all(input.content), browse = elements.find(e => e.tag === 'button'),
			field = elements.find(e => e.name === 'storageRoot');
		field.value = 'worlds/manual/path';
		assert.equal(browse.type, 'button');
		await browse.click();
		assert.equal(field.value, root);
		assert.equal(browse.disabled, false);
		assert.equal(elements.find(e => e.role === 'status')['aria-live'], 'polite');
	};
	assert.equal((await promptRecoveryImportSetup(scene, options())).options.root, root);
	assert.equal(pickerOptions.type, 'folder');
	assert.equal(pickerOptions.activeSource, 'data');
	assert.equal(pickerOptions.current, 'worlds/manual/path');
	assert.equal(closes, 1);
	const field = all(prompts[0].content).find(e => e.name === 'storageRoot');
	pickerOptions.callback('late/path');
	assert.equal(field.value, root);
	assert.deepEqual(errors, []);
});

test('folder picker errors are explicit and stale callbacks cannot replace the path', async () => {
	let pickerOptions, closes = 0;
	const browser = foundry.applications.apps.FilePicker.implementation.browse;
	foundry.applications.apps.FilePicker.implementation = class {
		static browse = browser;
		constructor(options) { pickerOptions = options; }
		async render() { throw new Error('picker unavailable'); }
		async close() { closes++; }
	};
	during = async input => {
		const elements = all(input.content), browse = elements.find(e => e.tag === 'button'),
			field = elements.find(e => e.name === 'storageRoot');
		await browse.click();
		assert.equal(errors.length, 1);
		assert.ok(errors[0].includes('picker unavailable'));
		scene.width++;
		pickerOptions.callback('worlds/changed/path');
		assert.equal(field.value, root);
		assert.equal(errors.length, 2);
	};
	await assert.rejects(promptRecoveryImportSetup(scene, options()), /Changed/);
	assert.equal(closes, 1); assert.equal(browses, 0);
});

test('closing setup during pending picker render revokes late selection and closes picker', async () => {
	let pickerOptions, closes = 0, release;
	const browser = foundry.applications.apps.FilePicker.implementation.browse;
	foundry.applications.apps.FilePicker.implementation = class {
		static browse = browser;
		constructor(options) { pickerOptions = options; }
		async render() { await new Promise(resolve => { release = resolve; }); }
		async close() { closes++; }
	};
	during = async input => {
		const elements = all(input.content), field = elements.find(e => e.name === 'storageRoot'),
			pending = elements.find(e => e.tag === 'button').click();
		await Promise.resolve();
		input.close();
		pickerOptions.callback('worlds/late/path');
		assert.equal(field.value, root);
		release(); await pending;
	};
	await promptRecoveryImportSetup(scene, options());
	assert.equal(closes, 2);
});
