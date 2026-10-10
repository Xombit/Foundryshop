import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prepareLibraryProject, promptLibrarySave } from '../scripts/library_save.js';
import { LIBRARY_FOLDER, LIBRARY_OPERATIONS, LIBRARY_CATALOG, indexProjectLibrary, readLibraryProject, readLibraryShape } from '../scripts/project_library.js';
import { starterShape } from '../scripts/starter_shapes.js';
import { getStampState } from '../scripts/artwork_stamps.js';

class Element {
	constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; }
	setAttribute(key, value) { this.attributes[key] = value; }
	append(...children) { this.children.push(...children); }
}
function preview() {
	const bytes = new Uint8Array(30), view = new DataView(bytes.buffer);
	for (const [offset, text] of [[0, 'RIFF'], [8, 'WEBP'], [12, 'VP8 ']]) bytes.set([...text].map(c => c.charCodeAt(0)), offset);
	view.setUint32(4, 22, true); view.setUint32(16, 10, true);
	bytes.set([157, 1, 42], 23); view.setUint16(26, 256, true); view.setUint16(28, 192, true);
	return { src: `data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`, width: 256, height: 192 };
}

let settings, files, uploads, flags, source, selected, confirms, notices, renderCalls;
beforeEach(() => {
	settings = { [LIBRARY_FOLDER]: 'worlds/test/library', [LIBRARY_OPERATIONS]: { version: 1, revision: 0, entries: [] },
		layerWorkspace: { version: 1, scenes: {} } };
	settings[LIBRARY_CATALOG] = { version: 1, revision: 0, entries: [] };
	files = new Map(); uploads = []; confirms = []; notices = []; renderCalls = [];
	flags = { layers: { version: 1, revision: 0, nodes: [{
		id: 'ground', kind: 'layer', name: 'Ground', parentId: null, playerAllowed: false, locked: false,
		defaults: { strokeWidth: 12, fillAlpha: 0.7 },
	}], presets: [{ id: 'overview', name: 'Overview', entries: [{ nodeId: 'ground', playerAllowed: false }] }] } };
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.game = { version: '14.365', user: { isGM: true, can: () => true },
		i18n: { localize: key => key, format: (key, values) => `${key} ${JSON.stringify(values)}` }, settings: { get: (n, key) => settings[key] } };
	source = { ...structuredClone(starterShape('textured-timber-table').project.drawings[0].data),
		_id: 'drawing001', author: 'gm', levels: ['level001'] };
	source.flags.foundryshop ??= {};
	source.flags.foundryshop.layerId = 'ground';
	const drawing = { id: source._id, toObject: () => structuredClone(source),
		getFlag: (n, key) => source.flags[n]?.[key] };
	globalThis.canvas = { ready: true, level: { id: 'level001' }, scene: {
		id: 'scene001', name: 'Scene project', grid: { type: 1, size: 100 },
		drawings: new Map([[drawing.id, drawing]]), levels: new Map([['level001', {}]]),
		getFlag: (n, key) => flags[key],
	}, drawings: { active: true, controlled: [{ document: drawing }] } };
	globalThis.getDocumentClass = () => ({ metadata: { schemaVersion: '14.355' } });
	globalThis.document = { createElement: tag => new Element(tag) };
	globalThis.ui = { notifications: { info: message => notices.push(message) } };
	selected = { name: 'Saved project', thumbnail: true, acknowledgeExternal: false };
	globalThis.foundry = {
		utils: { randomID: () => 'saved001' },
		applications: { api: { DialogV2: {
			prompt: async options => { assert.equal(options.content.tagName, 'DIV'); return selected; },
			confirm: async options => { confirms.push(options); return false; },
		} }, apps: { FilePicker: { implementation: {
			browse: async () => ({ files: [...files.keys()] }),
			upload: async (n, root, file) => {
				const path = `${root}/${file.name}`; uploads.push(path); files.set(path, await file.text()); return { path };
			},
		} } } },
	};
	globalThis.fetch = async url => new Response(files.get(decodeURIComponent(url.pathname).slice(1)), { status: files.has(decodeURIComponent(url.pathname).slice(1)) ? 200 : 404 });
});
const render = async (drawings, options) => { renderCalls.push({ drawings, options }); return preview(); };

test('full project save captures all artwork, layer defaults/presets and embedded thumbnail without Scene/settings/stamp mutation', async () => {
	source.hidden = true;
	const before = structuredClone({ flags, source, settings }), stamp = getStampState();
	const saved = await promptLibrarySave('project', {}, render);
	assert.equal(saved.kind, 'project');
	assert.equal(saved.path, 'worlds/test/library/project-saved001.json');
	assert.equal(saved.thumbnail.width, 256);
	const project = await readLibraryProject(saved);
	assert.equal(project.drawings[0].data.hidden, true);
	assert.equal(project.drawings[0].layerId, 'ground');
	assert.equal(project.tree.presets[0].name, 'Overview');
	assert.equal(project.tree.nodes[0].defaults.strokeWidth, 12);
	assert.equal(project.name, 'Saved project');
	assert.equal(renderCalls[0].options.acknowledgeExternal, false);
	assert.equal((await indexProjectLibrary())[0].thumbnail.data, project.thumbnail.data);
	assert.deepEqual({ flags, source, settings }, before);
	assert.deepEqual(getStampState(), stamp);
});

test('shape save embeds thumbnail in portable project while preserving grid normalization and metadata', async () => {
	selected = { name: 'Table', category: 'Furniture', tags: ['tavern'], thumbnail: true, acknowledgeExternal: true };
	const saved = await promptLibrarySave('shape', {}, render);
	const shape = await readLibraryShape(saved);
	assert.equal(shape.project.thumbnail.width, 256);
	assert.equal(saved.thumbnail.data, shape.project.thumbnail.data);
	assert.deepEqual(shape.tags, ['tavern']);
	assert.equal(shape.project.drawings[0].layerId, null);
	assert.deepEqual(shape.project.drawings[0].data.levels, []);
	assert.equal(renderCalls[0].options.acknowledgeExternal, true);
	assert.equal(source.flags.foundryshop.layerId, 'ground');
});

test('native prompt callback reads named form values and default checked thumbnail/unchecked external consent', async () => {
	foundry.applications.api.DialogV2.prompt = async options => {
		const inputs = options.content.children.flatMap(e => e.children).filter(e => e.tagName === 'INPUT');
		assert.equal(inputs.find(e => e.attributes.name === 'thumbnail').attributes.checked, '');
		assert.equal(inputs.find(e => e.attributes.name === 'acknowledgeExternal').attributes.checked, undefined);
		return options.ok.callback({}, { form: { elements: {
			name: { value: ' Form project ' }, thumbnail: { checked: false }, acknowledgeExternal: { checked: true },
		} } });
	};
	const saved = await promptLibrarySave('project', {}, render);
	assert.equal(saved.name, 'Form project');
	assert.equal(saved.thumbnail, null);
	assert.equal(renderCalls.length, 0);
});

test('canceled metadata and deliberate thumbnail-free save never render or silently add a thumbnail', async () => {
	selected = null;
	assert.equal(await promptLibrarySave('project', {}, render), null);
	assert.equal(uploads.length, 0);
	selected = { name: 'Without thumbnail', thumbnail: false };
	const saved = await promptLibrarySave('project', {}, render);
	assert.equal(saved.thumbnail, null);
	assert.equal(Object.hasOwn(await readLibraryProject(saved), 'thumbnail'), false);
	assert.equal(renderCalls.length, 0);
});

test('thumbnail failures require explicit fallback; refusal uploads nothing and acceptance saves authoritative artwork', async () => {
	const failing = async () => { throw new Error('Renderer limit'); };
	assert.equal(await promptLibrarySave('project', {}, failing), null);
	assert.equal(uploads.length, 0);
	assert.equal(confirms.length, 1);
	foundry.applications.api.DialogV2.confirm = async options => { confirms.push(options); return true; };
	const saved = await promptLibrarySave('project', {}, failing);
	assert.equal(saved.thumbnail, null);
	assert.equal(saved.drawings, 1);
	assert.equal(uploads.length, 1);
});

test('stale complete artwork/layers/presets, grid, Level, authority, folder or canceled context block before upload', async () => {
	const cases = [
		() => source.fillColor = '#001122',
		() => flags.layers.nodes[0].defaults.strokeWidth = 20,
		() => flags.layers.presets[0].name = 'Changed',
		() => canvas.scene.grid.size = 200,
		() => canvas.level.id = 'other',
		() => game.user.isGM = false,
		() => settings[LIBRARY_FOLDER] = 'worlds/other/library',
	];
	for (const change of cases) {
		const restore = { source: structuredClone(source), flags: structuredClone(flags), settings: structuredClone(settings),
			grid: canvas.scene.grid.size, level: canvas.level.id };
		foundry.applications.api.DialogV2.prompt = async () => { change(); return selected; };
		await assert.rejects(promptLibrarySave('project', {}, render), undefined, change.toString());
		source = restore.source; flags = restore.flags; settings = restore.settings;
		canvas.scene.grid.size = restore.grid; canvas.level.id = restore.level; game.user.isGM = true;
	}
	assert.equal(uploads.length, 0);
});

test('changes during rendering or fallback review refuse save rather than accepting stale success', async () => {
	await assert.rejects(promptLibrarySave('project', {}, async () => { source.strokeWidth++; return preview(); }), /Changed/);
	assert.equal(confirms.length, 0);
	foundry.applications.api.DialogV2.confirm = async () => { canvas.scene.grid.size = 200; return true; };
	await assert.rejects(promptLibrarySave('project', {}, async () => { throw new Error('Preview failure'); }), /Changed/);
	assert.equal(uploads.length, 0);
});

test('cancellation, permission loss and closed toolbox never fall back or upload', async () => {
	const controller = new AbortController();
	await assert.rejects(promptLibrarySave('project', { signal: controller.signal }, async () => {
		controller.abort(); throw new DOMException('Canceled', 'AbortError');
	}), /Changed/);
	assert.equal(confirms.length, 0);
	await assert.rejects(promptLibrarySave('project', { isOpen: () => false }, render), /Changed/);
	game.user.can = () => false;
	await assert.rejects(promptLibrarySave('project', {}, render), /SaveDenied/);
	assert.equal(uploads.length, 0);
});

test('project preparation retains multi-Level associations but refuses recovery and unfinished imports', () => {
	const prepared = prepareLibraryProject();
	canvas.scene.drawings.delete('drawing001');
	assert.equal(prepared.isCurrent(), false);
	flags.recovery = {};
	assert.throws(prepareLibraryProject, /Recovery/);
	delete flags.recovery;
	flags.projectImportJournal = {};
	assert.throws(prepareLibraryProject, /unfinished/);
	delete flags.projectImportJournal;
	const drawing = { id: 'one', toObject: () => ({ ...source, levels: ['one', 'two'] }) };
	canvas.scene.drawings.set(drawing.id, drawing);
	assert.deepEqual(prepareLibraryProject().project.drawings[0].data.levels, ['one', 'two']);
});
