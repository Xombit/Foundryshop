import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { projectPreviewEntries, projectPreviewPlaceholder, populateProjectPreview } from '../scripts/layers/project_preview.js';

class Element {
	constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; }
	setAttribute(key, value) { this.attributes[key] = value; }
	append(...children) { this.children.push(...children); }
	querySelector(selector) {
		return this.children.find(child => selector === 'img' ? child.tag === 'img' : 'data-preview-status' in child.attributes);
	}
}
const plan = () => ({ data: [{
	_id: 'newDrawing', author: 'currentGM', x: 500, y: 100, sort: 4096, levels: ['destination'],
	texture: 'replacement.webp', fontFamily: 'MappedFont', hidden: true, flags: {
		foundryshop: { layerId: 'destinationLayer', importStaging: 'journal', imageStamp: 1 },
	},
}] });
beforeEach(() => {
	globalThis.game = { i18n: { localize: key => key } };
	globalThis.document = { createElement: tag => new Element(tag) };
});

test('preview snapshots reflect validated import mappings, positioning and order without staging/native identity', () => {
	const input = plan(), before = structuredClone(input);
	const [entry] = projectPreviewEntries(input);
	assert.equal(entry.id, 'newDrawing'); assert.equal(entry.layerId, 'destinationLayer');
	assert.equal(entry.data.texture, 'replacement.webp'); assert.equal(entry.data.fontFamily, 'MappedFont');
	assert.equal(entry.data.sort, 4096); assert.equal(entry.data.x, 500); assert.equal(entry.data.hidden, true);
	assert.equal(entry.data.flags.foundryshop.imageStamp, 1);
	assert.equal(entry.data.flags.foundryshop.importStaging, undefined);
	assert.equal(entry.data._id, undefined); assert.equal(entry.data.author, undefined);
	assert.deepEqual(input, before);
});

test('generated preview uses bounded output, white UI background and explicit full-artwork scope', async () => {
	const section = projectPreviewPlaceholder(), controller = new AbortController();
	let received;
	await populateProjectPreview(section, plan(), { isCurrent: () => true, acknowledgeExternal: true }, controller.signal,
		async (entries, options) => {
			received = options;
			return { src: 'data:image/webp;base64,example', width: 384, height: 256, empty: false };
		});
	assert.equal(received.width, 384); assert.equal(received.height, 256);
	assert.equal(received.acknowledgeExternal, true); assert.equal(received.signal, controller.signal);
	assert.equal(section.attributes['data-preview-state'], 'ready');
	assert.match(section.querySelector('img').attributes.style, /background:#fff/);
	assert.match(section.children[0].textContent, /PreviewScope/);
});

test('missing/unsupported previews explicitly warn and never masquerade as successful art', async () => {
	const section = projectPreviewPlaceholder();
	await populateProjectPreview(section, plan(), { isCurrent: () => true }, new AbortController().signal,
		async () => { throw new Error('Missing texture'); });
	assert.equal(section.attributes['data-preview-state'], 'error');
	assert.match(section.querySelector('[data-preview-status]').textContent, /PreviewUnavailable.*Missing texture/);
	assert.equal(section.querySelector('img'), undefined);
});

test('dismissed work cannot attach an image and stale destination is rejected before/after rendering', async () => {
	const section = projectPreviewPlaceholder(), controller = new AbortController();
	await populateProjectPreview(section, plan(), { isCurrent: () => true }, controller.signal,
		async () => { controller.abort(); return { src: 'obsolete' }; });
	assert.equal(section.querySelector('img'), undefined);
	let renders = 0;
	await populateProjectPreview(section, plan(), { isCurrent: () => false }, new AbortController().signal,
		async () => { renders++; });
	assert.equal(renders, 0); assert.equal(section.attributes['data-preview-state'], 'error');
	let current = true;
	await populateProjectPreview(section, plan(), { isCurrent: () => current }, new AbortController().signal,
		async () => { current = false; return { src: 'obsolete' }; });
	assert.equal(section.querySelector('img'), undefined);
	assert.match(section.querySelector('[data-preview-status]').textContent, /Changed/);
});
