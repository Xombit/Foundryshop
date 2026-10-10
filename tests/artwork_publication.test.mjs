import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { publicationSnapshot, promptArtworkPublication } from '../scripts/artwork_publication.js';
import { starterShape } from '../scripts/starter_shapes.js';

class Element {
	constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; }
	setAttribute(key, value) { this.attributes[key] = value; }
	append(...children) { this.children.push(...children); }
}
let scene, tree, workspace, selected, renders, downloads, flags;
beforeEach(() => {
	globalThis.game = { user: { isGM: true }, i18n: { localize: key => key }, settings: { get: () => workspace } };
	tree = { version: 1, revision: 0, presets: [], nodes: [
		{ id: 'group', name: 'Group', kind: 'group', parentId: null, playerAllowed: true, locked: false, defaults: {} },
		{ id: 'ink', name: 'Ink', kind: 'layer', parentId: 'group', playerAllowed: true, locked: true, defaults: {} },
	] };
	workspace = { version: 1, scenes: { scene: { activeLayerId: 'ink', hiddenIds: [], collapsedIds: [] } } };
	flags = {};
	const data = structuredClone(starterShape('round-tree').project.drawings[0].data);
	const docs = ['visible', 'native-hidden', 'unassigned', 'orphan', 'other-level'].map((id, index) => {
		const source = { ...structuredClone(data), _id: id, author: 'gm', levels: [index === 4 ? 'other' : 'ground'],
			hidden: index === 1, flags: { foundryshop: { ...(index === 2 ? {} : { layerId: index === 3 ? 'missing' : 'ink' }) } } };
		return { id, source, toObject: () => structuredClone(source) };
	});
	scene = { id: 'scene', name: 'Publication test', levels: new Map([['ground', {}]]),
		drawings: new Map(docs.map(doc => [doc.id, doc])), getFlag: (n, key) => key === 'layers' ? tree : flags[key] };
	globalThis.canvas = { ready: true, scene, level: { id: 'ground' } };
	globalThis.document = { createElement: tag => new Element(tag) };
	selected = { audience: 'player', nodeId: null, crop: 'artwork', scale: 1, quality: 0.9, acknowledgeExternal: false };
	globalThis.foundry = { applications: { api: { DialogV2: { prompt: async () => selected } } } };
	globalThis.ui = { notifications: { info() {} } };
	renders = []; downloads = [];
});
const options = () => ({ render: async(entries, config) => { renders.push({ entries, config }); return { blob: new Blob(['test'], { type: 'image/webp' }) }; },
	download: (...args) => downloads.push(args) });
test('publication selection respects audience ancestors/native hidden, unassigned/orphan rules and displayed Level', () => {
	const player = { audience: 'player', nodeId: null }, gm = { audience: 'gm', nodeId: null };
	assert.deepEqual(publicationSnapshot(scene, 'ground', player).entries.map(entry => entry.id), ['visible', 'unassigned']);
	assert.deepEqual(publicationSnapshot(scene, 'ground', gm).entries.map(entry => entry.id), ['visible', 'native-hidden', 'unassigned', 'orphan']);
	tree.nodes[0].playerAllowed = false;
	assert.deepEqual(publicationSnapshot(scene, 'ground', player).entries.map(entry => entry.id), ['unassigned']);
	workspace.scenes.scene.hiddenIds = ['group'];
	assert.deepEqual(publicationSnapshot(scene, 'ground', gm).entries.map(entry => entry.id), ['unassigned', 'orphan']);
	assert.deepEqual(publicationSnapshot(scene, 'ground', { ...gm, nodeId: 'group' }).entries, []);
	assert.throws(() => publicationSnapshot(scene, 'ground', { ...gm, nodeId: 'bad' }));
});
test('cancel does not render or download; accepted export passes explicit options and downloads blob', async () => {
	selected = null; assert.equal(await promptArtworkPublication(options()), null);
	assert.equal(renders.length, 0);
	selected = { audience: 'player', nodeId: 'group', crop: 'artwork', scale: 2, quality: 0.9, acknowledgeExternal: false };
	await promptArtworkPublication(options());
	assert.deepEqual(renders[0].entries.map(entry => entry.id), ['visible']);
	assert.equal(renders[0].config.scale, 2);
	assert.equal(downloads[0][1], 'Publication_test-player.webp');
});
test('native form callback reads actual values and uses attribute-free wrapper', async () => {
	foundry.applications.api.DialogV2.prompt = async config => {
		assert.equal(config.content.tagName, 'DIV'); assert.deepEqual(config.content.attributes, {});
		const values = { audience: 'gm', nodeId: 'ink', backgroundMode: 'transparent', crop: 'custom', scale: '2', quality: '0.75', x: '-5', y: '10', width: '100', height: '200' };
		const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }]));
		fields.acknowledgeExternal = { checked: true };
		return config.ok.callback({}, { form: { elements: fields } });
	};
	await promptArtworkPublication(options());
	assert.deepEqual(renders[0].config.bounds, { x: -5, y: 10, width: 100, height: 200 });
	assert.equal(renders[0].config.quality, 0.75); assert.equal(renders[0].config.acknowledgeExternal, true);
});
test('stale artwork, raw tree/workspace, Level, authority and close/abort context never download', async () => {
	const render = async () => { scene.drawings.get('visible').source.fillAlpha = 0.1; return { blob: new Blob() }; };
	await assert.rejects(promptArtworkPublication({ ...options(), render }), /Changed/);
	assert.equal(downloads.length, 0);
	foundry.applications.api.DialogV2.prompt = async () => { tree.nodes[0].name = 'Changed'; return selected; };
	await assert.rejects(promptArtworkPublication(options()), /Changed/);
	foundry.applications.api.DialogV2.prompt = async () => { workspace.scenes.scene.hiddenIds = ['ink']; return selected; };
	await assert.rejects(promptArtworkPublication(options()), /Changed/);
	const controller = new AbortController(); controller.abort();
	await assert.rejects(promptArtworkPublication({ ...options(), signal: controller.signal }), /Changed/);
	await assert.rejects(promptArtworkPublication({ ...options(), isOpen: () => false }), /Changed/);
	game.user.isGM = false; await assert.rejects(promptArtworkPublication(options()), /Changed/);
});
test('staged/pending imports refuse publication instead of silently omitting artwork', () => {
	flags.projectImportJournal = { token: 'journal' };
	assert.throws(() => publicationSnapshot(scene, 'ground', selected), /PendingImport/);
	delete flags.projectImportJournal;
	scene.drawings.get('visible').source.flags.foundryshop.importStaging = 'journal';
	assert.throws(() => publicationSnapshot(scene, 'ground', selected), /PendingImport/);
});

test('Level background composition passes detached native metadata and detects changes during review/render', async () => {
	const level = { background: { src: null, color: '#112233', tint: '#ffffff' }, elevation: { bottom: 0 },
		textures: { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0, fit: 'fill' } };
	scene.levels.set('ground', { toObject: () => structuredClone(level) });
	scene.getDimensions = () => ({ sceneRect: { x: 40, y: 60, width: 500, height: 300 } });
	selected.backgroundMode = 'level'; selected.crop = 'scene';
	await promptArtworkPublication(options());
	assert.deepEqual(renders[0].config.background.rect, { x: 40, y: 60, width: 500, height: 300 });
	assert.equal(renders[0].config.background.texture.src, null);
	const count = downloads.length;
	await assert.rejects(promptArtworkPublication({ ...options(), render: async () => {
		level.textures.offsetX++; return { blob: new Blob() };
	} }), /Changed/);
	assert.equal(downloads.length, count);
	foundry.applications.api.DialogV2.prompt = async () => { level.background.tint = '#aabbcc'; return selected; };
	await assert.rejects(promptArtworkPublication(options()), /Changed/);
	assert.equal(downloads.length, count);
});

test('SVG shares scope/audience and source guards with vector-specific form/filename and named tree forwarding', async () => {
	let content;
	foundry.applications.api.DialogV2.prompt = async config => {
		content = config.content;
		const fields = Object.fromEntries(Object.entries({ audience: 'player', nodeId: 'group', crop: 'custom',
			scale: '1', x: '0', y: '0', width: '400', height: '300' }).map(([key, value]) => [key, { value }]));
		fields.acknowledgeFidelity = { checked: true };
		return config.ok.callback({}, { form: { elements: fields } });
	};
	await promptArtworkPublication({ ...options(), format: 'svg' });
	assert.deepEqual(renders[0].entries.map(entry => entry.id), ['visible']);
	assert.deepEqual(renders[0].config.tree, tree);
	assert.equal(renders[0].config.acknowledgeFidelity, true); assert.equal(renders[0].config.background, null);
	assert.equal(downloads[0][1], 'Publication_test-player.svg');
	const names = content.children.flatMap(child => child.children.map(field => field.attributes?.name));
	assert.ok(names.includes('acknowledgeFidelity')); assert.ok(!names.includes('backgroundMode'));
	assert.ok(!names.includes('quality')); assert.ok(!names.includes('acknowledgeExternal'));
	await assert.rejects(promptArtworkPublication({ ...options(), format: 'svg', render: async () => {
		scene.drawings.get('visible').source.rotation++; return { blob: new Blob() };
	} }), /Changed/);
	assert.equal(downloads.length, 1);
	await assert.rejects(promptArtworkPublication({ ...options(), format: 'png' }), /Options/);
});
