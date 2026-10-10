import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { promptLibraryManagement } from '../scripts/library_management.js';
import { indexProjectLibrary, LIBRARY_FOLDER, LIBRARY_OPERATIONS, LIBRARY_CATALOG, editLibraryMetadata } from '../scripts/project_library.js';
import { starterShape } from '../scripts/starter_shapes.js';

class Element {
	constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; }
	setAttribute(key, value) { this.attributes[key] = value; }
	append(...children) { this.children.push(...children); }
}
let files, uploads, settings, dialogs, confirmed, metadata;
beforeEach(() => {
	settings = { [LIBRARY_FOLDER]: 'worlds/test/library', [LIBRARY_OPERATIONS]: { version: 1, revision: 0, entries: [] } };
	settings[LIBRARY_CATALOG] = { version: 1, revision: 0, entries: [] };
	files = new Map(); uploads = []; dialogs = []; confirmed = false;
	metadata = { name: 'Renamed tree', category: 'Trees', tags: ['forest'] };
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.Hooks = { callAll() {} };
	globalThis.game = { i18n: { localize: key => key }, user: { isGM: true, can: () => true },
		settings: { get: (n, key) => structuredClone(settings[key]), set: async(n, key, value) => settings[key] = structuredClone(value) } };
	globalThis.document = { createElement: tag => new Element(tag) };
	let id = 0;
	globalThis.foundry = { utils: { randomID: () => `newid${++id}` }, applications: {
		api: { DialogV2: {
			prompt: async options => { dialogs.push(options); return metadata; },
			confirm: async options => { dialogs.push(options); return confirmed; },
		} }, apps: { FilePicker: { implementation: {
			browse: async () => ({ files: [...files.keys()] }),
			upload: async (n, root, file) => {
				const path = `${root}/${file.name}`;
				uploads.push(path); files.set(path, await file.text()); return { path };
			},
		} } } },
	};
	const shape = starterShape('round-tree');
	files.set(`${settings[LIBRARY_FOLDER]}/shape-round-tree.json`, JSON.stringify(shape));
	globalThis.fetch = async url => {
		const path = decodeURIComponent(url.pathname).slice(1);
		return new Response(files.get(path), { status: files.has(path) ? 200 : 404 });
	};
});
test('editing requires both metadata review and separate replacement confirmation; cancel changes no file or journal', async () => {
	const [entry] = await indexProjectLibrary();
	const original = files.get(entry.path);
	assert.equal(await promptLibraryManagement('edit', entry), null);
	assert.equal(dialogs.length, 2);
	assert.equal(uploads.length, 0);
	assert.equal(settings[LIBRARY_OPERATIONS].revision, 0);
	confirmed = true;
	const saved = await promptLibraryManagement('edit', entry);
	assert.equal(saved.name, metadata.name);
	assert.notEqual(files.get(entry.path), original);
	assert.equal(settings[LIBRARY_OPERATIONS].entries.length, 0);
	assert.equal(uploads.length, 1);
});
test('catalog remove/restore dialogs require explicit acceptance, no upload permission and unchanged reviewed bytes', async () => {
	const [entry] = await indexProjectLibrary(), original = files.get(entry.path);
	game.user.can = permission => permission !== 'FILES_UPLOAD';
	assert.equal(await promptLibraryManagement('remove', entry), null);
	assert.equal(settings[LIBRARY_CATALOG].revision, 0);
	assert.match(dialogs.at(-1).content.children.map(child => child.textContent).join(' '), /CatalogRemoveHint/);
	confirmed = true;
	await promptLibraryManagement('remove', entry);
	const [removed] = await indexProjectLibrary();
	foundry.applications.api.DialogV2.confirm = async () => {
		files.set(entry.path, JSON.stringify({ ...JSON.parse(original), name: 'External change' }));
		return true;
	};
	await assert.rejects(promptLibraryManagement('restore', removed), /Changed/);
	assert.equal(settings[LIBRARY_CATALOG].entries.length, 1);
	const [changed] = await indexProjectLibrary();
	assert.equal(changed.catalogChanged, true);
	foundry.applications.api.DialogV2.confirm = async () => true;
	await promptLibraryManagement('restore', changed);
	assert.equal(settings[LIBRARY_CATALOG].entries.length, 0);
	assert.equal(uploads.length, 0);
});
test('management callback uses actual native form values and validates bounded portable metadata', async () => {
	const [entry] = await indexProjectLibrary();
	foundry.applications.api.DialogV2.prompt = async options => {
		assert.equal(options.content.tagName, 'DIV'); assert.deepEqual(options.content.attributes, {});
		return options.ok.callback({}, { form: { elements: { name: { value: ' Copy tree ' },
			category: { value: ' Forest ' }, tags: { value: ' tree, forest, tree ' } } } });
	};
	const saved = await promptLibraryManagement('duplicate', entry);
	assert.equal(saved.name, 'Copy tree');
	assert.equal(saved.category, 'Forest');
	assert.deepEqual(saved.tags, ['tree', 'forest']);
	assert.notEqual(saved.path, entry.path);
	assert.equal(files.size, 2);
	assert.equal(settings[LIBRARY_OPERATIONS].revision, 0);
});
test('built-in entries, canceled metadata, bad fields and denied permission cannot start replacement', async () => {
	const [entry] = await indexProjectLibrary();
	await assert.rejects(promptLibraryManagement('edit', { ...entry, builtinId: 'example' }), /Changed/);
	metadata = null;
	assert.equal(await promptLibraryManagement('edit', entry), null);
	metadata = { name: '', category: 'Forest', tags: [] };
	await assert.rejects(promptLibraryManagement('edit', entry), /Invalid library/);
	game.user.can = permission => permission !== 'SETTINGS_MODIFY';
	await assert.rejects(promptLibraryManagement('edit', entry), /ManageDenied/);
	assert.equal(uploads.length, 0);
});
test('folder/authority/closed-window changes during prompts refuse edits and do not claim success', async () => {
	const [entry] = await indexProjectLibrary();
	foundry.applications.api.DialogV2.prompt = async () => {
		settings[LIBRARY_FOLDER] = 'worlds/other/library'; return metadata;
	};
	await assert.rejects(promptLibraryManagement('edit', entry), /Changed/);
	settings[LIBRARY_FOLDER] = entry.root;
	let open = true;
	foundry.applications.api.DialogV2.prompt = async () => metadata;
	foundry.applications.api.DialogV2.confirm = async () => { open = false; return true; };
	await assert.rejects(promptLibraryManagement('edit', entry, { isOpen: () => open }), /Changed/);
	assert.equal(uploads.length, 0);
});
test('repair disclosure requires explicit acceptance, retains altered files and never uploads or deletes during recovery', async () => {
	const [entry] = await indexProjectLibrary();
	const upload = foundry.applications.apps.FilePicker.implementation.upload;
	foundry.applications.apps.FilePicker.implementation.upload = async () => { throw new Error('Lost connection'); };
	await assert.rejects(editLibraryMetadata(entry, metadata), /EditUnverified/);
	const [repair] = await indexProjectLibrary();
	foundry.applications.apps.FilePicker.implementation.upload = upload;
	assert.equal(await promptLibraryManagement('repair', repair), null);
	assert.equal(settings[LIBRARY_OPERATIONS].entries.length, 1);
	const content = dialogs.at(-1).content.children.map(child => child.textContent).join(' ');
	assert.match(content, /RepairMatchesBefore/);
	assert.match(content, /Fingerprint/);
	assert.match(content, /round-tree.json/);
	confirmed = true;
	const accepted = await promptLibraryManagement('repair', repair);
	assert.equal(accepted.name, repair.name);
	assert.equal(settings[LIBRARY_OPERATIONS].entries.length, 0);
	assert.equal(uploads.length, 0);
});
