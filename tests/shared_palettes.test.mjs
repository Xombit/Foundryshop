import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	SHARED_PALETTES, readSharedPalettes, validateSharedPalettes, createSharedPalette, adoptSavedPalette,
	renameSharedPalette, duplicateSharedPalette, removeSharedPalette, moveSharedPalette,
	saveSharedColor, editSharedColor, removeSharedColor, moveSharedColor, importSharedColors,
	effectivePalettes, resetBuiltinPalette,
	saveSharedAppearance, duplicateSharedAppearance,
} from '../scripts/shared_palettes.js';

let stored, writes, changed, counter, failWrite, dropWrite;
beforeEach(() => {
	stored = {
		[SHARED_PALETTES]: { version: 1, revision: 0, palettes: [] },
		personalColors: { schemaVersion: 1, colors: [{ id: 'old', name: 'Blue', color: '#112233' }] },
		campaignColors: { schemaVersion: 1, colors: [{ id: 'campaign', name: 'Red', color: '#aa0000' }] },
	};
	writes = []; changed = 0; counter = 0; failWrite = false; dropWrite = false;
	globalThis.game = {
		user: { isGM: true },
		i18n: { localize: key => key, format: key => key },
		settings: {
			get: (module, key) => stored[key],
			async set(module, key, value) {
				if (failWrite) throw new Error('Storage failed');
				writes.push(structuredClone(value));
				if (!dropWrite) stored[key] = structuredClone(value);
			},
		},
	};
	globalThis.foundry = { utils: { randomID: () => `id${++counter}` } };
	globalThis.Hooks = { callAll: () => changed++ };
});

test('built-ins edit directly through verified shared overrides and reset only the selected palette', async () => {
	const original = effectivePalettes();
	assert.equal(original[0].id, 'builtin-fantasy');
	assert.equal(original[0].colors.length, 20);
	assert.equal(writes.length, 0, 'viewing shipped defaults never writes');
	await saveSharedColor('builtin-fantasy', '#123456', '', 0);
	assert.equal(effectivePalettes()[0].colors.length, 21);
	assert.equal(original[0].colors.length, 20);
	await editSharedColor('builtin-fantasy', 'color0', '#112233', 'Custom ink', 1);
	await renameSharedPalette('builtin-fantasy', 'My mapping colors', 2);
	await createSharedPalette('Unrelated', 3);
	const unrelated = readSharedPalettes().palettes.at(-1);
	await resetBuiltinPalette('builtin-fantasy', 4);
	assert.deepEqual(effectivePalettes()[0], original[0]);
	assert.deepEqual(readSharedPalettes().palettes, [unrelated]);
	await assert.rejects(resetBuiltinPalette('builtin-fantasy', 4), /Changed/);
	assert.throws(() => resetBuiltinPalette('not-a-builtin', 5), /Invalid/);
	await assert.rejects(removeSharedPalette('builtin-fantasy', 5), /Invalid/);
	game.user.isGM = false;
	assert.throws(() => saveSharedColor('builtin-bright', '#123456', '', 5), /GMOnly/);
	assert.deepEqual(readSharedPalettes().palettes, [unrelated]);
});

test('mixed paired swatches preserve order, duplicate/edit/delete and reset without changing single colors', async () => {
	const pair = { kind: 'pair', name: 'Stone', strokeColor: '#112233', fillColor: '#aabbcc', fillType: 2,
		texture: 'modules/foundryshop/assets/materials/flagstone.png', materialRepeat: 2 };
	await saveSharedAppearance('builtin-fantasy', pair, 0);
	let entries = effectivePalettes()[0].colors;
	assert.equal(entries.length, 21);
	const id = entries.at(-1).id;
	assert.deepEqual(entries.at(-1), { id, ...pair });
	await duplicateSharedAppearance('builtin-fantasy', id, 'Stone copy', 1);
	await editSharedColor('builtin-fantasy', 'color0', '#aabbcc', 'Single', 2);
	await moveSharedColor('builtin-fantasy', id, -1, 3);
	await saveSharedAppearance('builtin-fantasy', { ...pair, fillType: 1 }, 4, id);
	entries = effectivePalettes()[0].colors;
	assert.equal(entries.find(entry => entry.id === id).texture, null);
	assert.equal(entries.find(entry => entry.id === id).materialRepeat, 1);
	await assert.rejects(saveSharedAppearance('builtin-fantasy', pair, 4, id), /Changed/);
	await assert.rejects(editSharedColor('builtin-fantasy', id, '#ffffff', 'Wrong', 5), /Changed/);
	await removeSharedColor('builtin-fantasy', id, 5);
	await resetBuiltinPalette('builtin-fantasy', 6);
	assert.equal(effectivePalettes()[0].colors.length, 20);
	assert.throws(() => saveSharedAppearance('builtin-fantasy', { ...pair, strokeAlpha: 1 }, 7), /Invalid/);
	assert.throws(() => saveSharedAppearance('builtin-fantasy', { ...pair, texture: 'https://example.com/a.png' }, 7), /LocalOnly/);
});

test('named palettes create, rename, duplicate, reorder and delete without sharing mutable colors', async () => {
	await createSharedPalette(' Terrain ', 0);
	const first = readSharedPalettes().palettes[0].id;
	await saveSharedColor(first, '#ABCDEF', 'Sky', 1);
	await duplicateSharedPalette(first, 'Water', 2);
	const second = readSharedPalettes().palettes[1].id;
	await editSharedColor(second, readSharedPalettes().palettes[1].colors[0].id, '#112233', 'Deep', 3);
	assert.equal(readSharedPalettes().palettes[0].colors[0].color, '#abcdef');
	await renameSharedPalette(first, 'Buildings', 4);
	await moveSharedPalette(second, -1, 5);
	assert.deepEqual(readSharedPalettes().palettes.map(palette => palette.name), ['Water', 'Buildings']);
	await removeSharedPalette(first, 6);
	assert.equal(readSharedPalettes().palettes.length, 1);
	assert.equal(readSharedPalettes().revision, 7);
	assert.equal(changed, 7);
});

test('colors allow duplication between palettes, reject within a palette and preserve order', async () => {
	await createSharedPalette('A', 0);
	await createSharedPalette('B', 1);
	const [a, b] = readSharedPalettes().palettes.map(palette => palette.id);
	await saveSharedColor(a, '#112233', 'Blue', 2);
	await saveSharedColor(b, '#112233', 'Blue', 3);
	await assert.rejects(saveSharedColor(a, '#112233', 'Duplicate', 4), /Duplicate/);
	await importSharedColors(a, '#abcdef,#abcdef,#112233,#ffffff', 4);
	const colors = readSharedPalettes().palettes[0].colors;
	assert.deepEqual(colors.map(color => color.color), ['#112233', '#abcdef', '#ffffff']);
	await moveSharedColor(a, colors[2].id, -1, 5);
	assert.deepEqual(readSharedPalettes().palettes[0].colors.map(color => color.color), ['#112233', '#ffffff', '#abcdef']);
	await removeSharedColor(a, colors[0].id, 6);
	assert.equal(readSharedPalettes().palettes[0].colors.length, 2);
});

test('explicit adoption copies existing personal/campaign lists without modifying them', async () => {
	const originals = structuredClone(stored);
	await adoptSavedPalette('personal', 'My old colors', 0);
	await adoptSavedPalette('campaign', 'Campaign', 1);
	assert.deepEqual(stored.personalColors, originals.personalColors);
	assert.deepEqual(stored.campaignColors, originals.campaignColors);
	assert.deepEqual(readSharedPalettes().palettes[0].colors, originals.personalColors.colors);
	assert.throws(() => adoptSavedPalette('bad', 'Bad', 2), /scope/);
});

test('stale/concurrent edits, invalid names and permissions reject without partial writes', async () => {
	await createSharedPalette('A', 0);
	const id = readSharedPalettes().palettes[0].id;
	const concurrent = await Promise.allSettled([renameSharedPalette(id, 'First', 1), renameSharedPalette(id, 'Second', 1)]);
	assert.deepEqual(concurrent.map(result => result.status), ['fulfilled', 'rejected']);
	const before = structuredClone(stored[SHARED_PALETTES]);
	await assert.rejects(createSharedPalette('first', 2), /DuplicateName/);
	await assert.rejects(createSharedPalette(' ', 2), /InvalidName/);
	await assert.rejects(saveSharedColor(id, 'bad', '', 2), /InvalidColor/);
	await assert.rejects(moveSharedPalette(id, 2, 2), /Invalid/);
	game.user.isGM = false;
	assert.throws(() => removeSharedPalette(id, 2), /GMOnly/);
	assert.deepEqual(stored[SHARED_PALETTES], before);
});

test('failed writes reach callers without poisoning subsequent edits; dropped writes are not success', async () => {
	failWrite = true;
	await assert.rejects(createSharedPalette('A', 0), /Storage failed/);
	failWrite = false;
	dropWrite = true;
	await assert.rejects(createSharedPalette('A', 0), /WriteFailed/);
	dropWrite = false;
	await createSharedPalette('A', 0);
	assert.equal(readSharedPalettes().palettes.length, 1);
});

test('IDs, schema, palette and total-color limits validate before writes', async () => {
	assert.throws(() => validateSharedPalettes({ version: 2, revision: 0, palettes: [] }), /Invalid/);
	assert.throws(() => validateSharedPalettes({ version: 1, revision: -1, palettes: [] }), /Invalid/);
	const palette = index => ({ id: `p${index}`, name: `Palette ${index}`, colors: [] });
	assert.throws(() => validateSharedPalettes({ version: 1, revision: 0, palettes: [palette(0), palette(0)] }), /Invalid/);
	assert.throws(() => validateSharedPalettes({ version: 1, revision: 0, palettes: Array.from({ length: 33 }, (_, i) => palette(i)) }), /Full/);
	const many = Array.from({ length: 9 }, (_, i) => ({
		...palette(i), colors: Array.from({ length: 256 }, (_, j) => ({
			id: `c${j}`, name: `${j}`, color: `#${j.toString(16).padStart(6, '0')}`,
		})),
	}));
	assert.throws(() => validateSharedPalettes({ version: 1, revision: 0, palettes: many }), /Full/);
	await createSharedPalette('A', 0);
	foundry.utils.randomID = () => readSharedPalettes().palettes[0].id;
	await assert.rejects(createSharedPalette('B', 1), /Collision/);
	assert.equal(writes.length, 1);
});

test('effective palette names stay unique and duplication does not persist a default override', async () => {
	const builtin = effectivePalettes()[0];
	await assert.rejects(createSharedPalette(builtin.name, 0), /DuplicateName/);
	await duplicateSharedPalette(builtin.id, 'My mapping', 0);
	assert.equal(readSharedPalettes().palettes.length, 1);
	assert.deepEqual(readSharedPalettes().palettes[0].colors, builtin.colors);
	assert.equal(effectivePalettes().length, 4);
	foundry.utils.randomID = () => 'builtin-bright';
	await assert.rejects(createSharedPalette('Reserved ID', 1), /Collision/);
});

test('built-in saves respect bounds and failed writes without losing shipped defaults', async () => {
	const original = effectivePalettes();
	dropWrite = true;
	await assert.rejects(saveSharedColor('builtin-fantasy', '#123456', '', 0), /WriteFailed/);
	assert.deepEqual(effectivePalettes(), original);
	dropWrite = false;
	await assert.rejects(saveSharedColor('builtin-fantasy', original[0].colors[0].color, '', 0), /Duplicate/);
	assert.deepEqual(effectivePalettes(), original);
	const colors = Array.from({ length: 256 }, (_, i) => ({ id: `c${i}`, color: `#${i.toString(16).padStart(6, '0')}`, name: String(i) }));
	stored[SHARED_PALETTES] = { version: 1, revision: 0, palettes: [{ ...original[0], colors }] };
	await assert.rejects(saveSharedColor('builtin-fantasy', '#123456', '', 0), /Full/);
	assert.equal(effectivePalettes()[0].colors.length, 256);
	await resetBuiltinPalette('builtin-fantasy', 0);
	assert.deepEqual(effectivePalettes(), original);
});
