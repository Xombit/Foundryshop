import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createBakeReviewDialogs, BakeReviewCancelledError } from '../scripts/layers/bake_dialogs.js';

class Element {
	constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.textContent = ''; }
	append(child) { this.children.push(child); }
	setAttribute(key, value) { this.attributes[key] = value; }
	async decode() { this.naturalWidth = 8000; this.naturalHeight = 6000; }
}
const all = element => [element, ...element.children.flatMap(all)];
let current, checked, close, prompts, duringPrompt, urls, revoke;
beforeEach(() => {
	current = true; checked = true; close = false; prompts = []; duringPrompt = null; urls = []; revoke = [];
	globalThis.game = { user: { id: 'gm', isGM: true }, users: { activeGM: { id: 'gm' } },
		i18n: { localize: key => key, format: (key, data) => `${key}: ${JSON.stringify(data)}` } };
	globalThis.document = { createElement: tag => new Element(tag) };
	globalThis.foundry = { applications: { api: { DialogV2: { prompt: async options => {
		prompts.push(options); duringPrompt?.(options);
		if (close) return null;
		return options.ok.callback(null, { form: { elements: { acknowledge: { checked } } } });
	} } } } };
	urls = [];
	revoke = [];
});
const dialogs = options => createBakeReviewDialogs({ isCurrent: () => current, ...options });
const scope = () => ({ includedCount: 1, excludedCount: 1, audience: 'player',
	included: [{ id: 'ink' }], excluded: [{ id: '<img src=x onerror=bad>', reasons: ['unsupported-texture'] }], blockers: [] });
const render = () => ({ width: 8000, height: 6000, bounds: { x: -42, y: 30 }, format: 'png', quality: 0.9,
	outputRgbaBytes: 192000000, croppedSourceIds: ['ink'], fullyOutsideSourceIds: [] });

test('scope dialog shows exact exclusions safely as text and requires unchecked acknowledgement', async () => {
	const result = await dialogs().approveScope(scope());
	assert.deepEqual(result, { excludedIds: ['<img src=x onerror=bad>'], flattenToGround: true });
	const elements = all(prompts[0].content);
	assert.ok(elements.some(element => element.textContent.includes('<img src=x onerror=bad>')));
	assert.equal(elements.filter(element => element.tag === 'img').length, 0);
	const checkbox = elements.find(element => element.tag === 'input');
	assert.equal(checkbox.attributes.required, ''); assert.equal(checkbox.attributes.checked, undefined);
	assert.equal(prompts[0].modal, true); assert.equal(prompts[0].rejectClose, false);
});
test('render and placement decisions retain exact dimensions, crop identities and overlaps', async () => {
	const d = dialogs();
	assert.deepEqual(await d.approveRender(render()), { proceed: true, width: 8000, height: 6000,
		format: 'png', quality: 0.9, croppedSourceIds: ['ink'] });
	assert.deepEqual(await d.approvePlacement({ audience: 'gm', groundElevation: 0, overlappingTileIds: ['tile'] }),
		{ flattenToGround: true, overlappingTileIds: ['tile'] });
	assert.ok(all(prompts[0].content).some(element => element.textContent.includes('192000000')));
});
test('Restore placement requests archived recovery approval rather than public Bake exposure or flattening', async () => {
	const result = await dialogs().approvePlacement({ action: 'restore', destination: 'Tile',
		audience: 'player', overlappingTileIds: ['otherTile'] });
	assert.deepEqual(result, { restorePlacement: true, overlappingTileIds: ['otherTile'] });
	assert.equal(prompts[0].window.title, 'FOUNDRYSHOP.Bake.ReviewRestorePlacement');
	assert.ok(all(prompts[0].content).some(element => element.textContent === 'FOUNDRYSHOP.Bake.RestorePlacementWarning'));
	assert.equal(all(prompts[0].content).some(element => element.textContent === 'FOUNDRYSHOP.Bake.GroundWarning'), false);
});

test('background scope and placement disclose replacement of the existing Level background', async () => {
	const d = dialogs();
	await d.approveScope({ ...scope(), destination: 'background' });
	await d.approvePlacement({ audience: 'player', destination: 'LevelBackground',
		groundElevation: 0, overlappingTileIds: [] });
	for (const prompt of prompts) {
		assert.ok(all(prompt.content).some(element => element.textContent === 'FOUNDRYSHOP.Bake.BackgroundWarning'));
	}
});
test('Consolidate scope and placement disclose retained Drawing layer and stack rather than ground change', async () => {
	const d = dialogs();
	await d.approveScope({ ...scope(), destination: 'drawing' });
	await d.approvePlacement({ audience: 'player', destination: 'Drawing',
		groundElevation: 5, layerId: 'ink', sort: 1024, overlappingTileIds: [] });
	for (const prompt of prompts) {
		assert.ok(all(prompt.content).some(element => element.textContent === 'FOUNDRYSHOP.Bake.ConsolidationWarning'));
		assert.equal(all(prompt.content).some(element => element.textContent === 'FOUNDRYSHOP.Bake.GroundWarning'), false);
	}
	assert.ok(all(prompts[1].content).some(element => element.textContent.includes('"sort":1024')));
	assert.ok(all(prompts[1].content).some(element =>
		element.textContent.startsWith('FOUNDRYSHOP.Bake.ConsolidationElevationSummary:') && element.textContent.includes('"elevation":5')));
	assert.equal(all(prompts[1].content).some(element =>
		element.textContent.startsWith('FOUNDRYSHOP.Bake.PlacementSummary:')), false);
});
test('execution and file approvals disclose exact captured sources and paths', async () => {
	const d = dialogs(), input = { token: 'token', action: 'apply', phase: 'assets-verified',
		sourceIds: ['ink'], missingSourceIds: [], stagedSourceIds: [] };
	duringPrompt = () => input.sourceIds.push('forged');
	assert.deepEqual(await d.approveExecution(input), { resumeOperation: true, sourceIds: ['ink'] });
	assert.deepEqual(await d.approvePersistence({ paths: ['worlds/test/recovery.json', 'worlds/test/bake.png'] }),
		{ approvedPaths: ['worlds/test/recovery.json', 'worlds/test/bake.png'] });
});
test('Restore intent and execution disclose exact archived/current layer revisions', async () => {
	const d = dialogs(), layerRevisionChange = { archived: 0, current: 2 };
	await d.approveRestoreIntent({ token: 'apply', sourceIds: ['ink'], layerRevisionChange });
	await d.approveExecution({ token: 'restore', action: 'restore', phase: 'intent',
		sourceIds: ['ink'], missingSourceIds: ['ink'], stagedSourceIds: [], layerRevisionChange });
	for (const prompt of prompts) {
		assert.ok(all(prompt.content).some(element =>
			element.textContent === 'FOUNDRYSHOP.Bake.RestoreLayerRevision: {"archived":0,"current":2}'));
	}
});
test('cancel/close and missing acknowledgement are explicit cancellation, not success-shaped decisions', async () => {
	const d = dialogs();
	checked = false; await assert.rejects(d.approveScope(scope()), BakeReviewCancelledError);
	close = true; await assert.rejects(d.approveRender(render()), BakeReviewCancelledError);
});
test('blocked scopes, lost authority, cancellation and changed context do not yield approvals', async () => {
	await assert.rejects(dialogs().approveScope({ ...scope(), blockers: ['mixed-elevation'] }), /mixed-elevation/);
	assert.equal(prompts.length, 0);
	const d = dialogs();
	duringPrompt = () => { current = false; };
	await assert.rejects(d.approveScope(scope()), /Changed/);
	current = true; duringPrompt = null;
	game.users.activeGM.id = 'other'; await assert.rejects(d.approveRender(render()), /Changed/);
	game.users.activeGM.id = 'gm';
	const controller = new AbortController(), cancelled = dialogs({ signal: controller.signal });
	controller.abort(); await assert.rejects(cancelled.approveRender(render()), /Changed/);
});
test('preview owns and revokes its Blob URL on acceptance, close and dialog failure', async () => {
	const create = URL.createObjectURL, remove = URL.revokeObjectURL;
	URL.createObjectURL = blob => { assert.ok(blob instanceof Blob); const url = `blob:test-${urls.length}`; urls.push(url); return url; };
	URL.revokeObjectURL = url => revoke.push(url);
	try {
		const blob = new Blob(['image'], { type: 'image/png' }), d = dialogs(), review = { render: render() };
		assert.equal(await d.approvePreview(blob, review), true);
		const image = all(prompts[0].content).find(element => element.tag === 'img');
		assert.equal(image.attributes.src, urls[0]); assert.ok(image.attributes.style.includes('max-width:100%'));
		close = true; await assert.rejects(d.approvePreview(blob, review), BakeReviewCancelledError);
		close = false; duringPrompt = () => { throw new Error('dialog failure'); };
		await assert.rejects(d.approvePreview(blob, review), /dialog failure/);
		duringPrompt = null;
		await assert.rejects(d.approvePreview(blob, { render: { ...render(), width: 7999 } }), /InvalidPreview/);
		const decode = Element.prototype.decode;
		try {
			Element.prototype.decode = async () => { throw new Error('image decode failed'); };
			await assert.rejects(d.approvePreview(blob, review), /image decode failed/);
		} finally { Element.prototype.decode = decode; }
		assert.deepEqual(revoke, urls);
		await assert.rejects(d.approvePreview(new Blob(['bad'], { type: 'text/html' }), review), /InvalidPreview/);
		assert.equal(urls.length, 5);
	} finally { URL.createObjectURL = create; URL.revokeObjectURL = remove; }
});
