import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { promptTileBakeOptions } from '../scripts/layers/bake_options.js';
import { BakeReviewCancelledError } from '../scripts/layers/bake_dialogs.js';

class Element {
	constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; }
	append(child) { this.children.push(child); }
	setAttribute(key, value) { this.attributes[key] = value; }
}
const all = element => [element, ...element.children.flatMap(all)];
let scene, current, fields, selected, hook, prompts, tree;
beforeEach(() => {
	current = true; selected = ['ink']; hook = null; prompts = [];
	tree = { version: 1, revision: 0, presets: [], nodes: [
		{ id: 'inkLayer', kind: 'layer', name: '<b>Ink</b>', parentId: null, locked: false, playerAllowed: true, defaults: {} },
	] };
	const doc = source => ({ toObject: () => structuredClone(source) });
	scene = { id: 'scene', width: 100, height: 100, padding: 0, grid: { toObject: () => ({ size: 100 }) },
		levels: new Map([['ground', doc({ _id: 'ground' })]]),
		drawings: new Map([['ink', doc({ _id: 'ink' })]]), tiles: new Map(),
		getFlag: (module, key) => key === 'layers' ? tree : undefined };
	globalThis.game = { user: { id: 'gm', isGM: true }, users: { activeGM: { id: 'gm' } },
		i18n: { localize: key => key }, settings: { get: () => ({ version: 1, scenes: {
			scene: { activeLayerId: 'inkLayer', hiddenIds: [], collapsedIds: [] },
		} }) } };
	globalThis.document = { createElement: tag => new Element(tag) };
	fields = { kind: 'layer', layerId: 'inkLayer', audience: 'player', sort: '0', format: 'webp',
		quality: '0.9', crop: 'automatic', x: '', y: '', width: '', height: '', acknowledgeExternal: false };
	globalThis.foundry = { applications: { api: { DialogV2: { prompt: async options => {
		prompts.push(options); hook?.();
		if (!fields) return null;
		return options.ok.callback(null, { form: { elements: Object.fromEntries(Object.entries(fields)
			.map(([key, value]) => [key, { value, checked: value === true }])) } });
	} } } } };
});
const prompt = () => promptTileBakeOptions(scene, { levelId: 'ground', isCurrent: () => current, readSelection: () => selected });

test('layer default and active leaf are displayed with explicit audience/sort and safe names', async () => {
	const result = await prompt();
	assert.deepEqual(result, { kind: 'layer', layerId: 'inkLayer', audience: 'player', sort: 0,
		format: 'webp', quality: 0.9, bounds: undefined, acknowledgeExternal: false });
	const elements = all(prompts[0].content), scope = elements.find(e => e.attributes.name === 'kind');
	assert.equal(scope.children[0].attributes.value, 'layer');
	assert.equal(elements.find(e => e.attributes.name === 'layerId').value, 'inkLayer');
	assert.ok(elements.some(e => e.textContent === '<b>Ink</b>'));
	assert.equal(elements.find(e => e.attributes.name === 'audience').children[0].attributes.value, '');
	assert.equal(elements.find(e => e.attributes.name === 'sort').attributes.value, '');
});
test('Selection/All allow no layer and custom exact negative-origin integer crops', async () => {
	fields.kind = 'selection'; fields.layerId = ''; fields.crop = 'custom';
	Object.assign(fields, { x: '-42', y: '30', width: '8000', height: '6000', acknowledgeExternal: true });
	assert.deepEqual((await prompt()).bounds, { x: -42, y: 30, width: 8000, height: 6000 });
	assert.equal(all(prompts[0].content).find(e => e.attributes.name === 'layerId').attributes.required, undefined);
	fields.kind = 'all'; selected = []; assert.equal((await prompt()).layerId, null);
});
test('invalid explicit choices, blank sort, fractional crop and empty selection refuse', async () => {
	const baseline = { ...fields };
	for (const patch of [{ audience: '' }, { sort: '' }, { sort: '0.5' }, { layerId: 'absent' },
		{ format: 'jpg' }, { quality: '1.1' }, { crop: 'custom', x: '0.5', y: '0', width: '10', height: '10' },
		{ crop: 'custom', x: '0', y: '0', width: '0', height: '10' }]) {
		fields = { ...baseline, ...patch }; await assert.rejects(prompt(), /OptionsInvalid/);
	}
	fields = { ...baseline, kind: 'selection' }; selected = [];
	await assert.rejects(prompt(), /OptionsInvalid/);
});
test('close cancels without writes and stale sources/selection/context cannot become new baseline', async () => {
	fields = null; await assert.rejects(prompt(), BakeReviewCancelledError);
	fields = { kind: 'all', layerId: '', audience: 'gm', sort: '1', format: 'png', quality: '1', crop: 'automatic', acknowledgeExternal: false };
	hook = () => { scene.width++; }; await assert.rejects(prompt(), /OptionsStale/);
	hook = () => { selected = []; }; await assert.rejects(prompt(), /OptionsStale/);
	hook = () => { current = false; }; await assert.rejects(prompt(), /Changed/);
});

test('render guard blocks invalid click/submit before DialogV2 disables buttons; corrected input remains usable', async () => {
	await prompt();
	const listeners = {}, formListeners = {}, warnings = [];
	const elements = Object.fromEntries(Object.entries(fields).map(([key, value]) =>
		[key, { value, checked: value === true, required: false }]));
	const form = { elements, reportValidity: () => true,
		addEventListener: (type, handler, options) => { formListeners[type] = { handler, options }; } };
	globalThis.ui = { notifications: { warn: message => warnings.push(message) } };
	prompts[0].render(null, { element: {
		querySelector: () => form,
		addEventListener: (type, handler, options) => { listeners[type] = { handler, options }; },
	} });
	assert.equal(elements.layerId.required, true);
	assert.equal(elements.layerId.disabled, false);
	assert.equal(elements.width.required, false);
	assert.equal(elements.width.disabled, true);
	assert.equal(listeners.click.options.capture, true);
	assert.equal(formListeners.submit.options.capture, true);
	const event = type => ({ type, target: { closest: () => ({}) },
		preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } });
	elements.sort.value = '';
	const invalidClick = event('click');
	listeners.click.handler(invalidClick);
	assert.equal(invalidClick.prevented, true); assert.equal(invalidClick.stopped, true);
	elements.sort.value = '0'; elements.kind.value = 'selection'; elements.crop.value = 'custom';
	formListeners.change.handler();
	assert.equal(elements.layerId.required, false); assert.equal(elements.width.required, true);
	assert.equal(elements.layerId.disabled, true); assert.equal(elements.width.disabled, false);
	const invalidSubmit = event('submit');
	formListeners.submit.handler(invalidSubmit);
	assert.equal(invalidSubmit.prevented, true);
	for (const [key, value] of Object.entries({ x: '-42', y: '30', width: '8000', height: '6000' })) {
		elements[key].value = value;
	}
	const corrected = event('click');
	listeners.click.handler(corrected);
	assert.equal(corrected.prevented, undefined);
	assert.equal(warnings.length, 2);
	form.reportValidity = () => false;
	const nativeInvalid = event('submit');
	formListeners.submit.handler(nativeInvalid);
	assert.equal(nativeInvalid.prevented, true);
	assert.equal(warnings.length, 3);
	const closeClick = event('click');
	closeClick.target.closest = () => null;
	listeners.click.handler(closeClick);
	assert.equal(closeClick.prevented, undefined);
	const decision = prompts[0].ok.callback(null, { form });
	assert.equal(decision.kind, 'selection');
	assert.deepEqual(decision.bounds, { x: -42, y: 30, width: 8000, height: 6000 });
});
