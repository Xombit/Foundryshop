import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	LIBRARY_FOLDER, LIBRARY_OPERATIONS, LIBRARY_LIMITS, indexProjectLibrary, searchProjectLibrary, readLibraryProject, readLibraryShape, saveLibraryShape, saveLibraryProject,
	editLibraryMetadata, duplicateLibraryEntry, inspectLibraryRepair, acceptLibraryRepair, readLibraryOperations,
	LIBRARY_CATALOG, readLibraryCatalog, setLibraryCatalogRemoved,
} from '../scripts/project_library.js';
import { starterShape } from '../scripts/starter_shapes.js';
import { PROJECT_FORMAT, PROJECT_VERSION, validateProjectPackage } from '../scripts/layers/project_package.js';

const project = name => ({
	format: PROJECT_FORMAT, version: PROJECT_VERSION, name, scope: 'full', coordinateSpace: 'scene-pixels',
	source: { foundry: '14.365', drawingSchema: '14.355' }, tree: { version: 1, revision: 0, nodes: [], presets: [] },
	drawings: [], recovery: [], bounds: null, dependencies: {},
});
let folder, files, responses, requests, operations, catalog;
beforeEach(() => {
	folder = 'worlds/test/library'; files = []; responses = new Map(); requests = [];
	operations = { version: 1, revision: 0, entries: [] };
	catalog = { version: 1, revision: 0, entries: [] };
	globalThis.Hooks = { callAll() {} };
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.game = {
		user: { isGM: true, can: permission => permission === 'FILES_BROWSE' },
		i18n: { localize: key => key },
		settings: { get: (module, key) => {
			if (key === LIBRARY_OPERATIONS) return structuredClone(operations);
			if (key === LIBRARY_CATALOG) return structuredClone(catalog);
			assert.equal(key, LIBRARY_FOLDER); return folder;
		}, set: async (module, key, value) => {
			if (key === LIBRARY_CATALOG) catalog = structuredClone(value);
			else { assert.equal(key, LIBRARY_OPERATIONS); operations = structuredClone(value); }
			return value;
		} },
	};
	globalThis.foundry = { applications: { apps: { FilePicker: { implementation: {
		browse: async (source, root) => { assert.equal(source, 'data'); assert.equal(root, folder); return { files }; },
	} } } } };
	let id = 0;
	foundry.utils = { randomID: () => `generated${++id}` };
	globalThis.fetch = async (url, options) => {
		assert.equal(url.origin, 'http://localhost:30000');
		assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
		requests.push(decodeURIComponent(url.pathname).slice(1));
		return responses.get(requests.at(-1))?.() ?? new Response('missing', { status: 404 });
	};
});
function add(name, data = project(name)) {
	const path = `${folder}/${name}.json`;
	files.push(path);
	responses.set(path, () => new Response(JSON.stringify(data)));
	return path;
}

test('shared index validates file packages, stores only bounded metadata and supports name/path search', async () => {
	add('Quarry'); add('Forest'); files.push(`${folder}/ignore.webp`);
	const entries = await indexProjectLibrary();
	assert.equal(entries.length, 2); assert.equal(requests.length, 2);
	assert.equal(entries[0].kind, 'project'); assert.equal(entries[0].fingerprint.length, 64);
	assert.equal(entries[0].project, undefined); assert.equal(entries[0].data, undefined);
	assert.equal(searchProjectLibrary(entries, 'QUARRY')[0].name, 'Quarry');
	assert.equal(searchProjectLibrary(entries, 'forest.json').length, 1);
	assert.equal(searchProjectLibrary(entries, 'missing').length, 0);
	assert.deepEqual(await readLibraryProject(entries[0]), validateProjectPackage(project('Forest')));
});

test('changed bytes, root or permissions refuse stale imports and browsing has no writes', async () => {
	const path = add('Old');
	const [entry] = await indexProjectLibrary();
	responses.set(path, () => new Response(JSON.stringify(project('Changed'))));
	await assert.rejects(readLibraryProject(entry), /Changed/);
	folder = 'worlds/another/library';
	await assert.rejects(readLibraryProject(entry), /Changed/);
	game.user.isGM = false;
	await assert.rejects(indexProjectLibrary(), /Denied/);
	game.user.isGM = true; game.user.can = () => false;
	await assert.rejects(indexProjectLibrary(), /Denied/);
});

test('traversal, arbitrary hosts, subfolders and duplicate paths are never fetched', async () => {
	files = ['https://example.test/file.json', `${folder}/../secret.json`, `${folder}/sub/file.json`,
		`${folder}/%2e%2e%2fsecret.json`];
	const entries = await indexProjectLibrary();
	assert.equal(requests.length, 0); assert.equal(entries.length, 4);
	assert.ok(entries.every(entry => entry.error && !entry.fingerprint));
	files = []; add('Valid'); files.push(files[0]);
	const duplicates = await indexProjectLibrary();
	assert.equal(requests.length, 1); assert.match(duplicates[1].error, /Duplicate/);
});

test('missing/malformed files show explicit errors while older thumbnail-free files remain usable', async () => {
	files.push(`${folder}/Missing.json`);
	add('Malformed', { invalid: true }); add('Good');
	const entries = await indexProjectLibrary();
	assert.equal(entries.filter(entry => entry.error).length, 2);
	assert.equal(entries.find(entry => entry.name === 'Good').thumbnail, null);
});

test('finite browse/file limits and cancellation prevent incomplete success', async () => {
	files = Array.from({ length: LIBRARY_LIMITS.entries + 1 }, (_, i) => `${folder}/${i}.json`);
	await assert.rejects(indexProjectLibrary(), /TooMany/);
	assert.equal(requests.length, 0);
	files = []; const path = add('Huge');
	responses.set(path, () => new Response('{}', { headers: { 'content-length': String(21 * 1024 * 1024) } }));
	assert.match((await indexProjectLibrary())[0].error, /TooLarge/);
	const controller = new AbortController(); controller.abort();
	await assert.rejects(indexProjectLibrary(controller.signal), /Cancelled/);
});

test('streamed refresh budget is enforced without relying on content-length', async () => {
	const limit = LIBRARY_LIMITS.bytes;
	LIBRARY_LIMITS.bytes = 1024;
	try {
		const path = add('Streaming');
		const exact = JSON.stringify(project('Exact')).padEnd(1024, ' ');
		responses.set(path, () => new Response(exact));
		assert.equal((await indexProjectLibrary())[0].name, 'Exact');
		responses.set(path, () => new Response(new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(1025));
				controller.close();
			},
		})));
		assert.match((await indexProjectLibrary())[0].error, /TooLarge/);
		files.push(`${folder}/never-read.json`);
		await assert.rejects(indexProjectLibrary(), /TooLarge/);
		assert.equal(requests.filter(path => path.endsWith('never-read.json')).length, 0);
	} finally { LIBRARY_LIMITS.bytes = limit; }
});

test('shape packages survive indexing, tags search and fingerprinted reload without geometry in the index', async () => {
	const shape = starterShape('textured-timber-table');
	add('Table', shape);
	add('Map');
	const entries = await indexProjectLibrary();
	const entry = entries.find(entry => entry.kind === 'shape');
	assert.equal(entry.id, shape.id);
	assert.deepEqual(entry.tags, shape.tags);
	assert.equal(entry.project, undefined);
	assert.deepEqual(await readLibraryShape(entry), shape);
	assert.equal(searchProjectLibrary(entries, 'textured').length, 1);
	await assert.rejects(readLibraryProject(entry), /WrongKind/);
	await assert.rejects(readLibraryShape(entries.find(entry => entry.kind === 'project')), /WrongKind/);
	responses.set(entry.path, () => new Response(JSON.stringify({ ...shape, name: 'Changed' })));
	await assert.rejects(readLibraryShape(entry), /Changed/);
});

function uploadFixture() {
	const uploads = [];
	foundry.applications.apps.FilePicker.implementation.upload = async (source, root, file, options, notify) => {
		assert.equal(source, 'data'); assert.equal(root, folder);
		assert.equal(notify.notify, false);
		uploads.push(file);
		const path = `${root}/${file.name}`;
		const text = await file.text();
		if (!files.includes(path)) files.push(path);
		responses.set(path, () => new Response(text));
		return { path };
	};
	return uploads;
}

test('save uploads a fresh bounded shape file and verifies exact bytes before exposing its index entry', async () => {
	game.user.can = () => true;
	const uploads = uploadFixture();
	const shape = starterShape('round-tree');
	const saved = await saveLibraryShape(shape);
	assert.equal(uploads.length, 1);
	assert.equal(saved.kind, 'shape');
	assert.equal(saved.path, `${folder}/shape-round-tree.json`);
	assert.deepEqual(await readLibraryShape(saved), shape);
	assert.deepEqual((await indexProjectLibrary())[0], saved);
	await assert.rejects(saveLibraryShape(shape), /Collision/);
	assert.equal(uploads.length, 1);
});

test('save permissions, stale targets, file capacity and case-insensitive collisions block before upload', async () => {
	const uploads = uploadFixture();
	const shape = starterShape('round-tree');
	await assert.rejects(saveLibraryShape(shape), /SaveDenied/);
	game.user.can = () => true;
	await assert.rejects(saveLibraryShape(shape, { isCurrent: () => false }), /Changed/);
	files = [`${folder}/SHAPE-ROUND-TREE.JSON`];
	await assert.rejects(saveLibraryShape(shape), /Collision/);
	files = Array.from({ length: 100 }, (_, i) => `${folder}/${i}.json`);
	await assert.rejects(saveLibraryShape(shape), /TooMany/);
	files = [];
	foundry.applications.apps.FilePicker.implementation.browse = async () => {
		folder = 'worlds/changed/library'; return { files: [] };
	};
	await assert.rejects(saveLibraryShape(shape), /Changed/);
	assert.equal(uploads.length, 0);
});

test('failed verification and late context changes explicitly report possible retained files, without deletion', async () => {
	game.user.can = () => true;
	uploadFixture();
	const shape = starterShape('round-tree');
	const upload = foundry.applications.apps.FilePicker.implementation.upload;
	foundry.applications.apps.FilePicker.implementation.upload = async (...args) => {
		const result = await upload(...args);
		responses.set(result.path, () => new Response(JSON.stringify({ ...shape, name: 'Altered' })));
		return result;
	};
	await assert.rejects(saveLibraryShape(shape), /SaveUnverified/);
	assert.equal(files.length, 1);
	files = []; responses.clear();
	let current = true;
	foundry.applications.apps.FilePicker.implementation.upload = async (...args) => {
		const result = await upload(...args); current = false; return result;
	};
	await assert.rejects(saveLibraryShape(shape, { isCurrent: () => current }), /SaveUnverified/);
	assert.equal(files.length, 1);
});

test('serial save guard prevents simultaneous writes and unexpected upload paths never become library entries', async () => {
	game.user.can = () => true;
	let release;
	const pending = new Promise(resolve => { release = resolve; });
	foundry.applications.apps.FilePicker.implementation.browse = async () => {
		await pending; return { files: [] };
	};
	foundry.applications.apps.FilePicker.implementation.upload = async () => ({ path: 'worlds/elsewhere/file.json' });
	const operation = saveLibraryShape(starterShape('round-tree'));
	await assert.rejects(saveLibraryShape(starterShape('oak-tree')), /SaveBusy/);
	release();
	await assert.rejects(operation, /SaveUnverified/);
});

test('duplicate shape identities from external file copies are explicit error cards rather than ambiguous placement entries', async () => {
	const shape = starterShape('round-tree');
	add('First', shape); add('Second', shape);
	const entries = await indexProjectLibrary();
	assert.equal(entries.filter(entry => entry.kind === 'shape').length, 1);
	assert.match(entries.find(entry => entry.error).error, /Duplicate/);
});

test('project save uses a fresh identity filename and verifies portable artwork, layers and presets exactly', async () => {
	game.user.can = () => true;
	const uploads = uploadFixture();
	const input = project('Saved project');
	input.tree.nodes.push({ id: 'notes', name: 'GM Notes', kind: 'layer', parentId: null, playerAllowed: false,
		locked: true, defaults: { strokeColor: '#112233', strokeWidth: 8 } });
	input.tree.presets.push({ id: 'overview', name: 'Overview', entries: [{ nodeId: 'notes', playerAllowed: false }] });
	const saved = await saveLibraryProject(input, { id: 'project001' });
	assert.equal(saved.path, `${folder}/project-project001.json`);
	assert.equal(saved.kind, 'project');
	assert.equal(uploads.length, 1);
	assert.deepEqual(await readLibraryProject(saved), validateProjectPackage(input));
	assert.deepEqual((await indexProjectLibrary())[0], saved);
	await assert.rejects(saveLibraryProject(input, { id: 'project001' }), /Collision/);
	await assert.rejects(saveLibraryProject(input, { id: '../bad' }), /IdentityInvalid/);
	await assert.rejects(saveLibraryProject({ ...input, name: '' }, { id: 'another' }), /name/);
	assert.equal(uploads.length, 1);
});

test('project save refuses malformed read-back and cancellation, without hiding retained-file uncertainty', async () => {
	game.user.can = () => true;
	const uploads = uploadFixture(), upload = foundry.applications.apps.FilePicker.implementation.upload;
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(saveLibraryProject(project('Canceled'), { id: 'canceled', signal: controller.signal }), /Cancelled/);
	assert.equal(uploads.length, 0);
	const late = new AbortController();
	foundry.applications.apps.FilePicker.implementation.upload = async (...args) => {
		const result = await upload(...args); late.abort(); return result;
	};
	await assert.rejects(saveLibraryProject(project('Late'), { id: 'late', signal: late.signal }), /SaveUnverified.*project-late/);
	assert.equal(files.length, 1);
	foundry.applications.apps.FilePicker.implementation.upload = async (...args) => {
		const result = await upload(...args); responses.set(result.path, () => new Response('{}')); return result;
	};
	await assert.rejects(saveLibraryProject(project('Broken'), { id: 'broken' }), /SaveUnverified/);
	assert.equal(files.length, 2);
});

test('projects share the shape save guard and honor independent permissions/capacity/case-insensitive collision checks', async () => {
	const uploads = uploadFixture(), input = project('Map');
	await assert.rejects(saveLibraryProject(input, { id: 'map' }), /SaveDenied/);
	game.user.can = () => true;
	await assert.rejects(saveLibraryProject(input, { id: 'map', isCurrent: () => false }), /Changed/);
	files.push(`${folder}/PROJECT-MAP.JSON`);
	await assert.rejects(saveLibraryProject(input, { id: 'map' }), /Collision/);
	files = Array.from({ length: 100 }, (_, i) => `${folder}/${i}.json`);
	await assert.rejects(saveLibraryProject(input, { id: 'map' }), /TooMany/);
	let release;
	foundry.applications.apps.FilePicker.implementation.browse = () => new Promise(resolve => { release = resolve; });
	const saving = saveLibraryProject(input, { id: 'map' });
	await assert.rejects(saveLibraryShape(starterShape('round-tree')), /SaveBusy/);
	release({ files: [] });
	await saving;
	assert.equal(uploads.length, 1);
});

const metadata = { name: 'Renamed', category: 'Dungeon', tags: ['rooms', 'stone'] };
test('metadata editing replaces portable shape fields, retains identity/artwork and verifies then clears repair marker', async () => {
	game.user.can = () => true;
	const uploads = uploadFixture(), shape = starterShape('round-tree');
	const path = add('Tree', shape);
	const [entry] = await indexProjectLibrary();
	const edited = await editLibraryMetadata(entry, metadata);
	assert.equal(uploads.length, 1);
	assert.equal(edited.path, path);
	assert.equal(edited.id, shape.id);
	assert.equal(edited.name, metadata.name);
	assert.deepEqual(edited.tags, metadata.tags);
	const loaded = await readLibraryShape(edited);
	assert.deepEqual(loaded.project.drawings, shape.project.drawings);
	assert.equal(loaded.project.name, metadata.name);
	assert.deepEqual(readLibraryOperations(), { version: 1, revision: 2, entries: [] });
	await assert.rejects(readLibraryShape(entry), /Changed/);
});

test('portable project metadata edits add a stable identity and indexed/searchable category/tags without changing layers/presets', async () => {
	game.user.can = () => true; uploadFixture();
	add('Map');
	const [entry] = await indexProjectLibrary();
	const edited = await editLibraryMetadata(entry, metadata);
	const loaded = await readLibraryProject(edited);
	assert.equal(loaded.name, metadata.name);
	assert.equal(loaded.library.id, edited.id);
	assert.deepEqual(loaded.library.tags, metadata.tags);
	assert.deepEqual(loaded.tree, project('Map').tree);
	const index = await indexProjectLibrary();
	assert.equal(searchProjectLibrary(index, 'Dungeon')[0].path, edited.path);
	const again = await editLibraryMetadata(edited, { ...metadata, name: 'Second name' });
	assert.equal(again.id, edited.id);
	assert.equal((await indexProjectLibrary())[0].name, 'Second name');
});

test('shape/project duplication generates independent portable identities and preserves source bytes and artwork', async () => {
	game.user.can = () => true; uploadFixture();
	const shape = starterShape('round-tree');
	add('Tree', shape); add('Map');
	const entries = await indexProjectLibrary();
	for (const entry of entries) {
		const source = await (entry.kind === 'shape' ? readLibraryShape(entry) : readLibraryProject(entry));
		const duplicate = await duplicateLibraryEntry(entry, metadata);
		assert.notEqual(duplicate.path, entry.path);
		if (entry.id) assert.notEqual(duplicate.id, entry.id);
		const loaded = await (entry.kind === 'shape' ? readLibraryShape(duplicate) : readLibraryProject(duplicate));
		assert.deepEqual((loaded.project ?? loaded).drawings, (source.project ?? source).drawings);
		assert.deepEqual(await (entry.kind === 'shape' ? readLibraryShape(entry) : readLibraryProject(entry)), source);
	}
	assert.equal(readLibraryOperations().revision, 0, 'fresh duplicates do not need replacement markers');
});

test('invalid/stale metadata and independent permissions block edits without file uploads or journal changes', async () => {
	const uploads = uploadFixture();
	const path = add('Map');
	const [entry] = await indexProjectLibrary();
	await assert.rejects(editLibraryMetadata(entry, metadata), /ManageDenied/);
	game.user.can = permission => permission !== 'SETTINGS_MODIFY';
	await assert.rejects(editLibraryMetadata(entry, metadata), /ManageDenied/);
	game.user.can = () => true;
	for (const invalid of [{ ...metadata, name: '' }, { ...metadata, tags: [''] },
		{ ...metadata, category: 'x'.repeat(41) }, { ...metadata, tags: Array(13).fill('a') }]) {
		await assert.rejects(editLibraryMetadata(entry, invalid), /Invalid library/);
	}
	responses.set(path, () => new Response(JSON.stringify(project('External edit'))));
	await assert.rejects(editLibraryMetadata(entry, metadata), /Changed/);
	assert.equal(uploads.length, 0);
	assert.equal(readLibraryOperations().revision, 0);
});

test('failed/dropped journal persistence prevents file overwrite; malformed operation records fail closed', async () => {
	game.user.can = () => true;
	const uploads = uploadFixture(); add('Map');
	const [entry] = await indexProjectLibrary();
	const set = game.settings.set;
	game.settings.set = async () => {};
	await assert.rejects(editLibraryMetadata(entry, metadata), /OperationsWriteFailed/);
	assert.equal(uploads.length, 0);
	game.settings.set = set;
	operations = { version: 1, revision: 0, entries: [{ token: 'op', root: folder, path: `${folder}/../x.json`,
		before: 'a'.repeat(64), after: 'b'.repeat(64) }] };
	assert.throws(readLibraryOperations, /UnsafePath/);
});

test('uncertain overwrite survives reindex, blocks imports/edits/duplicates and can accept reviewed original bytes', async () => {
	game.user.can = () => true;
	const uploads = uploadFixture(); add('Map');
	const [entry] = await indexProjectLibrary();
	foundry.applications.apps.FilePicker.implementation.upload = async () => { throw new Error('Network lost'); };
	await assert.rejects(editLibraryMetadata(entry, metadata), /EditUnverified.*Network lost/);
	const [repair] = await indexProjectLibrary();
	assert.ok(repair.repair);
	assert.match(repair.error, /RepairRequired/);
	await assert.rejects(readLibraryProject(entry), /RepairRequired/);
	await assert.rejects(editLibraryMetadata(entry, metadata), /RepairRequired/);
	await assert.rejects(duplicateLibraryEntry(entry, metadata), /RepairRequired/);
	const reviewed = await inspectLibraryRepair(repair.repair);
	assert.equal(reviewed.fingerprint, repair.repair.before);
	const accepted = await acceptLibraryRepair(repair.repair, reviewed);
	assert.deepEqual(await readLibraryProject(accepted), validateProjectPackage(project('Map')));
	assert.equal(readLibraryOperations().entries.length, 0);
	assert.equal(uploads.length, 0);
});

test('failed marker clearing reports uncertainty even after exact replacement and review can accept intended bytes', async () => {
	game.user.can = () => true;
	uploadFixture(); add('Map');
	const [entry] = await indexProjectLibrary();
	const set = game.settings.set;
	game.settings.set = async (n, k, value) => {
		if (!value.entries.length) throw new Error('Marker clear failed');
		return set(n, k, value);
	};
	await assert.rejects(editLibraryMetadata(entry, metadata), /EditUnverified.*Marker clear failed/);
	const [repair] = await indexProjectLibrary();
	const reviewed = await inspectLibraryRepair(repair.repair);
	assert.equal(reviewed.fingerprint, repair.repair.after);
	assert.equal(reviewed.name, metadata.name);
	game.settings.set = set;
	await acceptLibraryRepair(repair.repair, reviewed);
	assert.equal((await indexProjectLibrary())[0].name, metadata.name);
});

test('repair rejects changed bytes, missing/malformed files, closed context and revoked permission without clearing markers', async () => {
	game.user.can = () => true; add('Map');
	const [entry] = await indexProjectLibrary();
	foundry.applications.apps.FilePicker.implementation.upload = async () => ({ path: entry.path });
	await assert.rejects(editLibraryMetadata(entry, metadata), /EditUnverified/);
	const operation = readLibraryOperations().entries[0], reviewed = await inspectLibraryRepair(operation);
	responses.set(entry.path, () => new Response(JSON.stringify(project('Other bytes'))));
	await assert.rejects(acceptLibraryRepair(operation, reviewed), /Changed/);
	const changed = await inspectLibraryRepair(operation);
	await assert.rejects(acceptLibraryRepair(operation, changed, { isCurrent: () => false }), /Changed/);
	game.user.can = permission => permission !== 'SETTINGS_MODIFY';
	await assert.rejects(acceptLibraryRepair(operation, changed), /ManageDenied/);
	game.user.can = () => true;
	responses.set(entry.path, () => new Response('{}'));
	await assert.rejects(inspectLibraryRepair(operation), /Unsupported/);
	files = [];
	const [missing] = await indexProjectLibrary();
	assert.match(missing.error, /RepairMissing/);
	assert.equal(readLibraryOperations().entries.length, 1);
});

test('duplication rechecks source fingerprint after folder browsing; identity collisions never overwrite source', async () => {
	game.user.can = () => true;
	const uploads = uploadFixture();
	const shape = starterShape('round-tree'); add('Tree', shape);
	const [entry] = await indexProjectLibrary();
	foundry.utils.randomID = () => shape.id;
	await assert.rejects(duplicateLibraryEntry(entry, metadata), /Collision/);
	foundry.utils.randomID = () => 'new-copy';
	const browse = foundry.applications.apps.FilePicker.implementation.browse;
	foundry.applications.apps.FilePicker.implementation.browse = async (...args) => {
		responses.set(entry.path, () => new Response(JSON.stringify({ ...shape, name: 'Changed' })));
		return browse(...args);
	};
	await assert.rejects(duplicateLibraryEntry(entry, metadata), /Changed/);
	assert.equal(uploads.length, 0);
});

test('repair markers added during a refresh still block the current card and preserve malformed-file details', async () => {
	const shape = starterShape('round-tree'), path = 'worlds/test/library/shape-tree.json';
	files = [path]; responses.set(path, () => new Response(JSON.stringify(shape)));
	const [entry] = await indexProjectLibrary();
	responses.set(path, () => {
		operations = { version: 1, revision: 1, entries: [{
			token: 'concurrent-repair', root: entry.root, path, before: entry.fingerprint, after: entry.fingerprint,
		}] };
		return new Response(JSON.stringify(shape));
	});
	const [blocked] = await indexProjectLibrary();
	assert.ok(blocked.repair);
	assert.match(blocked.error, /RepairRequired/);
	operations = { version: 1, revision: 0, entries: [] };
	await assert.rejects(readLibraryShape(entry), /RepairRequired/);
	responses.set(path, () => new Response('broken'));
	const warn = console.warn; console.warn = () => {};
	try {
		const [invalid] = await indexProjectLibrary();
		assert.ok(invalid.repair);
		assert.match(invalid.error, /RepairRequired/);
		assert.match(invalid.error, /Unexpected token/);
	} finally { console.warn = warn; }
});
test('invalid generated journal identities are refused before any persistent setting or file write', async () => {
	const uploads = uploadFixture();
	game.user.can = () => true;
	const shape = starterShape('round-tree'), path = 'worlds/test/library/shape-tree.json';
	files = [path]; responses.set(path, () => new Response(JSON.stringify(shape)));
	const [entry] = await indexProjectLibrary();
	foundry.utils.randomID = () => 'invalid/token';
	await assert.rejects(editLibraryMetadata(entry, { name: 'Tree', category: 'Trees', tags: [] }), /OperationsInvalid/);
	assert.equal(operations.revision, 0);
	assert.equal(uploads.length, 0);
});

test('shared catalog removal persists across refresh, blocks stale-card actions and restores without file writes', async () => {
	const uploads = uploadFixture();
	game.user.can = permission => permission !== 'FILES_UPLOAD';
	const path = add('Tree', starterShape('round-tree')), original = await responses.get(path)().text();
	const [entry] = await indexProjectLibrary();
	await setLibraryCatalogRemoved(entry, true);
	assert.equal(readLibraryCatalog().revision, 1);
	assert.deepEqual(Object.keys(catalog.entries[0]).sort(), ['root', 'path', 'name', 'id', 'kind', 'fingerprint'].sort());
	const [removed] = await indexProjectLibrary();
	assert.equal(removed.removed.id, 'round-tree');
	assert.equal(removed.catalogChanged, false);
	await assert.rejects(readLibraryShape(entry), /CatalogRemoved/);
	await assert.rejects(duplicateLibraryEntry(entry, { name: 'Copy', category: 'Trees', tags: [] }), /CatalogRemoved/);
	await assert.rejects(setLibraryCatalogRemoved(entry, true), /Changed/);
	await setLibraryCatalogRemoved(removed, false);
	assert.equal(catalog.revision, 2);
	assert.equal((await indexProjectLibrary())[0].removed, undefined);
	assert.equal((await readLibraryShape(entry)).id, 'round-tree');
	assert.equal(await responses.get(path)().text(), original);
	assert.equal(uploads.length, 0);
});
test('externally replaced removed paths stay removed and restoring requires freshly reviewed current bytes', async () => {
	uploadFixture(); game.user.can = () => true;
	const path = add('Tree', starterShape('round-tree'));
	const [entry] = await indexProjectLibrary();
	await setLibraryCatalogRemoved(entry, true);
	const [old] = await indexProjectLibrary();
	const replacement = { ...starterShape('round-tree'), id: 'replacement-tree', name: 'External tree' };
	responses.set(path, () => new Response(JSON.stringify(replacement)));
	await assert.rejects(setLibraryCatalogRemoved(old, false), /Changed/);
	const [reviewed] = await indexProjectLibrary();
	assert.equal(reviewed.catalogChanged, true);
	assert.equal(reviewed.id, 'replacement-tree');
	await setLibraryCatalogRemoved(reviewed, false);
	assert.equal(catalog.entries.length, 0);
});
test('missing and malformed removed files retain explicit recoverable catalog cards and root-scoped records', async () => {
	uploadFixture(); game.user.can = () => true;
	const path = add('Map');
	const [entry] = await indexProjectLibrary();
	await setLibraryCatalogRemoved(entry, true);
	files = [];
	const [missing] = await indexProjectLibrary();
	assert.equal(missing.name, entry.name);
	assert.match(missing.error, /CatalogMissing/);
	assert.ok(missing.removed);
	await assert.rejects(setLibraryCatalogRemoved(missing, false, { isCurrent: () => false }), /Changed/);
	files = [path]; responses.set(path, () => new Response('invalid'));
	const warn = console.warn; console.warn = () => {};
	try {
		const [invalid] = await indexProjectLibrary();
		assert.ok(invalid.removed); assert.match(invalid.error, /Unexpected token/);
		assert.equal(invalid.kind, entry.kind); assert.equal(invalid.name, entry.name);
		await assert.rejects(setLibraryCatalogRemoved(invalid, false), /Changed/);
	} finally { console.warn = warn; }
	folder = 'worlds/other/library'; files = [];
	assert.deepEqual(await indexProjectLibrary(), []);
	assert.equal(catalog.entries.length, 1);
	folder = entry.root; responses.set(path, () => new Response(JSON.stringify(project('Map'))));
	assert.ok((await indexProjectLibrary())[0].removed);
});
test('catalog permissions, stale source, cancellation and concurrent catalog revisions fail without writes', async () => {
	const uploads = uploadFixture(); game.user.can = () => true;
	const path = add('Map');
	const [entry] = await indexProjectLibrary();
	game.user.can = permission => permission !== 'SETTINGS_MODIFY';
	await assert.rejects(setLibraryCatalogRemoved(entry, true), /CatalogDenied/);
	game.user.can = () => true;
	const controller = new AbortController(); controller.abort();
	await assert.rejects(setLibraryCatalogRemoved(entry, true, { signal: controller.signal }), /Changed/);
	await assert.rejects(setLibraryCatalogRemoved({ ...entry, builtinId: 'builtin' }, true), /Changed/);
	responses.set(path, () => { catalog.revision++; return new Response(JSON.stringify(project('Map'))); });
	await assert.rejects(setLibraryCatalogRemoved(entry, true), /Changed/);
	assert.equal(catalog.entries.length, 0);
	responses.set(path, () => { game.user.isGM = false; return new Response(JSON.stringify(project('Map'))); });
	await assert.rejects(setLibraryCatalogRemoved(entry, true), /Denied/);
	assert.equal(catalog.entries.length, 0);
	assert.equal(uploads.length, 0);
});
test('full catalog refuses additional removal and new records during reads are honored immediately', async () => {
	uploadFixture(); game.user.can = () => true;
	const path = add('Map'); const [entry] = await indexProjectLibrary();
	const record = { root: entry.root, path, kind: entry.kind, id: null, name: entry.name, fingerprint: entry.fingerprint };
	catalog.entries = Array.from({ length: 100 }, (_, i) => ({ ...record, path: `${entry.root}/missing${i}.json` }));
	await assert.rejects(setLibraryCatalogRemoved(entry, true), /CatalogFull/);
	assert.equal(catalog.revision, 0);
	catalog.entries = [];
	responses.set(path, () => { catalog.entries = [record]; return new Response(JSON.stringify(project('Map'))); });
	await assert.rejects(readLibraryProject(entry), /CatalogRemoved/);
	catalog.entries = [];
	assert.ok((await indexProjectLibrary())[0].removed);
});
test('dropped or uncertain catalog setting writes report explicit uncertainty and release the busy guard', async () => {
	uploadFixture(); game.user.can = () => true;
	add('Map'); const [entry] = await indexProjectLibrary();
	const set = game.settings.set;
	game.settings.set = async () => {};
	await assert.rejects(setLibraryCatalogRemoved(entry, true), /CatalogUnverified.*CatalogWriteFailed/);
	assert.equal(catalog.entries.length, 0);
	game.settings.set = async (...args) => { await set(...args); throw new Error('Disconnected after write'); };
	await assert.rejects(setLibraryCatalogRemoved(entry, true), /CatalogUnverified.*Disconnected/);
	assert.equal(catalog.entries.length, 1);
	game.settings.set = set;
	const [removed] = await indexProjectLibrary();
	await setLibraryCatalogRemoved(removed, false);
	assert.equal(catalog.entries.length, 0);
});
test('invalid, duplicate and over-capacity catalog records fail closed', async () => {
	const uploads = uploadFixture(); game.user.can = () => true;
	add('Map'); const [entry] = await indexProjectLibrary();
	await setLibraryCatalogRemoved(entry, true);
	const record = structuredClone(catalog.entries[0]);
	for (const patch of [{ path: `${entry.root}/../secret.json` }, { fingerprint: 'bad' }, { id: {} },
		{ kind: 'shape', id: null }, { name: 'x'.repeat(81) }, { geometry: [] }]) {
		catalog.entries = [{ ...record, ...patch }];
		assert.throws(readLibraryCatalog);
		await assert.rejects(indexProjectLibrary());
	}
	catalog.entries = [record, record]; assert.throws(readLibraryCatalog, /CatalogInvalid/);
	catalog.entries = Array.from({ length: 101 }, (_, i) => ({ ...record, path: `${entry.root}/map${i}.json` }));
	assert.throws(readLibraryCatalog, /CatalogInvalid/);
	assert.equal(uploads.length, 0);
});
test('removal cannot conceal unfinished replacement markers or bypass explicit repair', async () => {
	uploadFixture(); game.user.can = () => true;
	add('Map'); const [entry] = await indexProjectLibrary();
	await setLibraryCatalogRemoved(entry, true);
	operations.entries = [{ token: 'repair', root: entry.root, path: entry.path, before: entry.fingerprint, after: entry.fingerprint }];
	const [removed] = await indexProjectLibrary();
	assert.ok(removed.repair); assert.ok(removed.removed);
	await assert.rejects(setLibraryCatalogRemoved(removed, false), /RepairRequired/);
	const reviewed = await inspectLibraryRepair(removed.repair);
	await acceptLibraryRepair(removed.repair, reviewed);
	assert.ok((await indexProjectLibrary())[0].removed);
});

test('portable project library metadata is bounded and duplicate identities are refused on refresh', async () => {
	const input = { ...project('Map'), library: { id: 'map001', category: 'Dungeon', tags: ['a'] } };
	assert.deepEqual(validateProjectPackage(input).library, input.library);
	for (const library of [{ ...input.library, category: '' }, { ...input.library, id: '../x' },
		{ ...input.library, tags: Array(13).fill('a') }, { ...input.library, extra: true }]) {
		assert.throws(() => validateProjectPackage({ ...input, library }));
	}
	add('First', input); add('Second', input);
	const entries = await indexProjectLibrary();
	assert.equal(entries.filter(entry => entry.error).length, 1);
	assert.match(entries.find(entry => entry.error).error, /Duplicate/);
});
