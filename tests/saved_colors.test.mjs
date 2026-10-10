import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	PERSONAL_COLORS, CAMPAIGN_COLORS, MAX_COLORS, MAX_NAME_LENGTH,
	readPalette, canEditPalette, validatePalette, saveColor, editColor, deleteColor, importPresetColors,
} from '../scripts/saved_colors.js';

let stored, writes;
beforeEach(() => {
	let id = 0;
	stored = {
		[PERSONAL_COLORS]: { schemaVersion: 1, colors: [] },
		[CAMPAIGN_COLORS]: { schemaVersion: 1, colors: [] },
	};
	writes = [];
	globalThis.foundry = { utils: { randomID: () => `id-${++id}` } };
	globalThis.game = {
		user: { isGM: true },
		i18n: { localize: key => key, format: (key, args) => `${key} ${JSON.stringify(args)}` },
		settings: {
			get(namespace, key) { assert.equal(namespace, 'foundryshop'); return stored[key]; },
			async set(namespace, key, value) {
				await new Promise(resolve => setTimeout(resolve, 1));
				writes.push(key);
				stored[key] = structuredClone(value);
			},
		},
	};
});

test('save normalizes colors/names and uses stable IDs; reads are detached', async () => {
	await saveColor('personal', '#ABCDEF', '  Danger  ');
	assert.deepEqual(readPalette('personal').colors, [{ id: 'id-1', name: 'Danger', color: '#abcdef' }]);
	const read = readPalette('personal');
	read.colors[0].name = 'Changed';
	assert.equal(readPalette('personal').colors[0].name, 'Danger');
	await saveColor('personal', '#112233', '');
	assert.equal(readPalette('personal').colors[1].name, '#112233');
});

test('personal and campaign are independent; players can edit only personal', async () => {
	game.user.isGM = false;
	assert.equal(canEditPalette('personal'), true);
	assert.equal(canEditPalette('campaign'), false);
	await saveColor('personal', '#abcdef', 'Mine');
	await assert.rejects(saveColor('campaign', '#abcdef', 'Shared'), /GMOnly/);
	assert.deepEqual(readPalette('campaign').colors, []);
});

test('duplicates are case-insensitive; rename preserves ID and order', async () => {
	await saveColor('personal', '#abcdef', 'Original');
	await assert.rejects(saveColor('personal', '#ABCDEF', 'Duplicate'), /Duplicate/);
	const entry = readPalette('personal').colors[0];
	await editColor('personal', entry, entry.color, 'Renamed');
	assert.deepEqual(readPalette('personal').colors, [{ ...entry, name: 'Renamed' }]);
});

test('editing a color cannot duplicate another entry', async () => {
	await saveColor('personal', '#111111', 'First');
	await saveColor('personal', '#222222', 'Second');
	const entry = readPalette('personal').colors[0];
	await assert.rejects(editColor('personal', entry, '#222222', 'Conflict'), /Duplicate/);
	assert.equal(readPalette('personal').colors[0].color, '#111111');
});

test('stale edit/delete fails rather than replacing newer changes', async () => {
	await saveColor('campaign', '#abcdef', 'Original');
	const stale = readPalette('campaign').colors[0];
	await editColor('campaign', stale, stale.color, 'Newer');
	await assert.rejects(editColor('campaign', stale, stale.color, 'Old draft'), /Changed/);
	await assert.rejects(deleteColor('campaign', stale), /Changed/);
	await deleteColor('campaign', readPalette('campaign').colors[0]);
	assert.equal(readPalette('campaign').colors.length, 0);
});

test('queued edits do not lose writes during asynchronous persistence', async () => {
	await Promise.all([
		saveColor('personal', '#111111', 'One'),
		saveColor('personal', '#222222', 'Two'),
		saveColor('personal', '#333333', 'Three'),
	]);
	assert.deepEqual(readPalette('personal').colors.map(entry => entry.name), ['One', 'Two', 'Three']);
});

test('preset import is additive, idempotent, and validates all colors before writing', async () => {
	await saveColor('personal', '#abcdef', 'Keep name');
	await importPresetColors('personal', ' #ABCDEF, #112233,#112233 ');
	assert.equal(readPalette('personal').colors.length, 2);
	assert.equal(readPalette('personal').colors[0].name, 'Keep name');
	const writesBefore = writes.length;
	await importPresetColors('personal', '#abcdef,#112233');
	assert.equal(writes.length, writesBefore);
	assert.throws(() => importPresetColors('personal', '#445566,invalid'), /InvalidColor/);
	assert.equal(writes.length, writesBefore);
});

test('empty preset import is a no-op', async () => {
	await importPresetColors('personal', ' ');
	assert.equal(writes.length, 0);
});

test('palette/name limits are enforced without partial writes', async () => {
	assert.throws(() => saveColor('personal', '#abcdef', 'x'.repeat(MAX_NAME_LENGTH + 1)), /InvalidName/);
	stored[PERSONAL_COLORS].colors = Array.from({ length: MAX_COLORS }, (_, i) => ({
		id: `existing-${i}`, name: `Color ${i}`, color: `#${i.toString(16).padStart(6, '0')}`,
	}));
	await assert.rejects(saveColor('personal', '#ffffff', 'Overflow'), /Full/);
	await assert.rejects(importPresetColors('personal', '#ffffff'), /Full/);
	assert.equal(readPalette('personal').colors.length, MAX_COLORS);
	assert.equal(writes.length, 0);
});

test('malformed records and unknown schema versions are rejected', () => {
	for (const value of [null, { schemaVersion: 2, colors: [] }, { schemaVersion: 1, colors: {} },
		{ schemaVersion: 1, colors: [{ id: '', name: 'Bad', color: '#abcdef' }] },
		{ schemaVersion: 1, colors: [{ id: 'one', name: 123, color: '#abcdef' }] },
		{ schemaVersion: 1, colors: [
			{ id: 'one', name: '', color: '#abcdef' }, { id: 'two', name: '', color: '#ABCDEF' },
		] }]) {
		assert.throws(() => validatePalette(value));
	}
	assert.throws(() => readPalette('unknown'), /Invalid palette scope/);
});

test('storage failure reaches caller and does not poison subsequent edits', async () => {
	const set = game.settings.set;
	game.settings.set = async () => { throw new Error('Storage offline'); };
	await assert.rejects(saveColor('personal', '#abcdef', 'First'), /Storage offline/);
	game.settings.set = set;
	await saveColor('personal', '#112233', 'Second');
	assert.equal(readPalette('personal').colors.length, 1);
	assert.equal(readPalette('personal').colors[0].name, 'Second');
});
