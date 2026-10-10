import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { MATERIAL_SIZE, STARTER_MATERIALS, starterMaterials } from '../scripts/starter_materials.js';
import { materialPixel, materialPng } from '../tools/generate-materials.mjs';
import { imageHeader } from '../scripts/image_header.js';

test('original material assets are deterministic bounded static PNGs with distinct authored patterns', async () => {
	globalThis.game = { i18n: { localize: key => key } };
	const seen = new Set();
	let total = 0;
	for (const material of STARTER_MATERIALS) {
		const bytes = await readFile(new URL(`../assets/materials/${material.id}.png`, import.meta.url));
		assert.deepEqual(bytes, materialPng(material.id), `${material.id}: shipped asset matches original generator`);
		assert.deepEqual(imageHeader(bytes), { width: MATERIAL_SIZE, height: MATERIAL_SIZE, extension: 'png' });
		assert.ok(bytes.length < 64 * 1024);
		assert.equal(bytes[25], 0, 'neutral grayscale, no unwanted source hue');
		const idatLength = bytes.readUInt32BE(33);
		const pixels = inflateSync(bytes.subarray(41, 41 + idatLength));
		assert.equal(pixels.length, 257 * 256);
		assert.ok(new Set(pixels).size > 10, 'material has visible tonal structure');
		seen.add(bytes.toString('base64')); total += bytes.length;
	}
	assert.equal(STARTER_MATERIALS.length, 15);
	assert.equal(seen.size, 15);
	assert.ok(total <= 512 * 1024, `bundled material budget exceeded: ${total}`);
});

test('material sampler repeats on both axes including negative coordinates without random regeneration', () => {
	for (const material of STARTER_MATERIALS) {
		for (const [x, y] of [[0, 0], [255, 255], [17, 83], [130, 12], [-1, -65]]) {
			assert.equal(materialPixel(material.id, x, y), materialPixel(material.id, x + 256, y));
			assert.equal(materialPixel(material.id, x, y), materialPixel(material.id, x, y - 256));
		}
	}
	assert.throws(() => materialPixel('unknown', 0, 0), /Unknown/);
});

test('starter material metadata has stable local paths, translated names and detached searchable results', async () => {
	const translations = JSON.parse(await readFile(new URL('../languages/en.json', import.meta.url), 'utf8'));
	globalThis.game = { i18n: { localize: key => translations[key] ?? key } };
	for (const entry of STARTER_MATERIALS) {
		assert.equal(entry.path, `modules/foundryshop/assets/materials/${entry.id}.png`);
		assert.ok(translations[`FOUNDRYSHOP.Materials.Name.${entry.id}`]);
		assert.ok(translations[`FOUNDRYSHOP.Materials.Category.${entry.category}`]);
	}
	assert.equal(starterMaterials('wood').length, 2);
	assert.equal(starterMaterials('stone masonry').length, 4);
	assert.equal(starterMaterials('not available').length, 0);
	const list = starterMaterials();
	list[0].path = 'changed';
	assert.notEqual(starterMaterials()[0].path, 'changed');
	assert.throws(() => starterMaterials(null), /Invalid/);
});
