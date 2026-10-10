import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starterShapes, starterShape } from '../scripts/starter_shapes.js';
import { builtinPalette, BUILTIN_PALETTES } from '../scripts/builtin_palettes.js';
import { validateShapePackage } from '../scripts/shape_package.js';
import { prepareArtworkSnapshot } from '../scripts/artwork_renderer.js';
import { readFileSync } from 'node:fs';
import { transformStamp } from '../scripts/artwork_stamps.js';
import { STARTER_MATERIALS } from '../scripts/starter_materials.js';

test('expanded original catalog is deterministic, bounded editable geometry with no external resources', () => {
	globalThis.game = { version: '14.365', i18n: { localize: key => key } };
	globalThis.getDocumentClass = () => ({ metadata: { schemaVersion: '14.355' } });
	const translations = JSON.parse(readFileSync(new URL('../languages/en.json', import.meta.url), 'utf8'));
	game.i18n.localize = key => translations[key] ?? key;
	const shapes = starterShapes();
	assert.equal(shapes.length, 108); assert.equal(new Set(shapes.map(shape => shape.id)).size, 108);
	assert.equal(new Set(shapes.map(shape => shape.category)).size, 10);
	assert.deepEqual(starterShapes(), shapes);
	for (const shape of shapes) {
		assert.equal(translations[`FOUNDRYSHOP.Builtins.Shape.${shape.id}`], shape.name);
		assert.ok(translations[`FOUNDRYSHOP.Builtins.CategoryName.${shape.category}`]);
		assert.deepEqual(validateShapePackage(shape), shape);
		assert.ok(shape.project.drawings.length >= 1 && shape.project.drawings.length <= 12);
		assert.deepEqual(shape.project.dependencies.assets,
			[...new Set(shape.project.drawings.map(entry => entry.data.texture).filter(Boolean))].sort());
		assert.ok(shape.project.dependencies.assets.every(asset => STARTER_MATERIALS.some(material => material.path === asset)));
		assert.deepEqual(shape.project.dependencies.fonts, shape.category === 'Labels'
			? [shape.project.drawings[0].data.fontFamily] : []);
		assert.equal(shape.project.tree.nodes.length, 0);
		for (const { data } of shape.project.drawings) {
			assert.equal(data.hidden, false); assert.equal(data.locked, false);
			assert.equal(data.levels.length, 0);
			if (shape.category !== 'Labels') assert.equal(data.text, '');
			assert.ok(['r', 'e', 'p'].includes(data.shape.type));
		}
		assert.doesNotThrow(() => prepareArtworkSnapshot(shape.project.drawings));
	}
	assert.notDeepEqual(starterShape('round-tree').project.drawings, starterShape('oak-tree').project.drawings);
	assert.notDeepEqual(starterShape('round-tree').project.drawings, starterShape('conifer-tree').project.drawings);
	const detached = starterShape('round-tree'); detached.project.drawings[0].data.x = 9999;
	assert.notEqual(starterShape('round-tree').project.drawings[0].data.x, 9999);
});

test('Fantasy Mapping is the default 20-color palette with other independent defaults and detached copies', () => {
	const palette = builtinPalette();
	assert.equal(palette.id, 'fantasy'); assert.equal(palette.colors.length, 20);
	assert.equal(new Set(palette.colors.map(entry => entry.id)).size, 20);
	assert.ok(palette.colors.every(entry => /^#[0-9a-f]{6}$/.test(entry.color)));
	palette.colors[0].color = '#ffffff';
	assert.equal(builtinPalette().colors[0].color, '#302b26');
	assert.equal(BUILTIN_PALETTES.length, 3);
	assert.throws(() => builtinPalette('missing'));
	assert.throws(() => starterShape('missing'));
});

test('all starter prefabs preserve footprint geometry, saved palette and relative order when transformed', () => {
	const palette = new Set(builtinPalette().colors.map(entry => entry.color));
	const counts = new Map();
	for (const shape of starterShapes()) {
		counts.set(shape.category, (counts.get(shape.category) ?? 0) + 1);
		const transformed = transformStamp(shape.project, { x: 250, y: 500 }, { scale: 1.5, rotation: 90 });
		for (const [index, source] of shape.project.drawings.entries()) {
			const data = source.data, changed = transformed[index];
			assert.ok(palette.has(data.fillColor)); assert.ok(palette.has(data.strokeColor));
			assert.equal(changed.sort, index * 1024); assert.equal(changed.fillColor, data.fillColor);
			assert.equal(changed.rotation, 90); assert.equal(changed.shape.width, data.shape.width * 1.5);
			assert.equal(changed.shape.height, data.shape.height * 1.5);
			assert.deepEqual(changed.shape.points, data.shape.points.map(value => value * 1.5));
			assert.ok(Math.abs(data.x) <= shape.footprint.width * 50 + 1);
			assert.ok(Math.abs(data.y) <= shape.footprint.height * 50 + 1);
		}
	}
	assert.deepEqual(Object.fromEntries(counts), {
		Vegetation: 11, Structure: 10, Furniture: 11, Storage: 11, Dungeon: 15, Terrain: 13, Camp: 9, Symbols: 8,
		Labels: 14,
		Mining: 6,
	});
});

test('eight textured starters retain shipped dependencies and material proportions through placement and JSON', () => {
	const shapes = starterShapes().filter(shape => shape.tags.includes('textured'));
	assert.equal(shapes.length, 8);
	for (const shape of shapes) {
		assert.deepEqual(validateShapePackage(JSON.parse(JSON.stringify(shape))), shape);
		assert.equal(shape.project.dependencies.assets.length, 1);
		assert.deepEqual(shape.project.dependencies.modules, []);
		const asset = shape.project.dependencies.assets[0];
		assert.ok(readFileSync(new URL(`../${asset.replace('modules/foundryshop/', '')}`, import.meta.url)).length > 0);
		for (const scale of [0.05, 0.5, 1, 2, 20]) {
			const changed = transformStamp(shape.project, { x: 350, y: 700 }, { scale, rotation: 45 });
			for (const [index, { data }] of shape.project.drawings.entries()) {
				assert.equal(changed[index].texture, data.texture);
				assert.equal(changed[index].fillType, data.fillType);
				if (data.texture) {
					assert.equal(data.fillType, 2);
					assert.ok(data.flags.foundryshop.materialRepeat > 0);
					assert.equal(changed[index].flags.foundryshop.materialRepeat, data.flags.foundryshop.materialRepeat * scale);
					assert.equal(changed[index].flags.foundryshop.imageStamp, undefined);
				} else {
					assert.equal(changed[index].flags.foundryshop?.materialRepeat, undefined);
				}
			}
		}
	}
	assert.equal(starterShape('timber-table').project.dependencies.assets.length, 0);
});

test('shape metadata, unsafe styles and scene-specific references are rejected before arming', () => {
	for (const mutate of [
		s => delete s.id, s => s.id = '../unsafe', s => s.version = 2,
		s => s.tags = ['x'.repeat(41)], s => s.footprint.width = 0,
		s => s.footprint = [], s => s.extra = true,
		s => s.project.drawings[0].data.hidden = true,
		s => s.project.drawings[0].data.locked = true,
		s => s.project.drawings[0].data.levels = ['sceneLevel'],
		s => s.project.drawings[0].data.flags.foundryshop = { provenance: { sceneId: 'old' } },
		s => s.project.drawings[0].data.elevation = 50,
	]) {
		const shape = starterShape('round-tree'); mutate(shape);
		assert.throws(() => validateShapePackage(shape));
	}
});
