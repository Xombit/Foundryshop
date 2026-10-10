import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	PERSONAL_LABELS, CAMPAIGN_LABELS, MAX_LABELS, MAX_LABEL_TEXT_LENGTH, STARTER_LABEL_KEYS,
	readLabelBank, canEditLabelBank, validateLabelBank, saveLabel, editLabel, deleteLabel, addStarterLabels, ensureStarterLabels,
} from '../scripts/label_banks.js';

let stored, writes;
beforeEach(() => {
	let id = 0;
	stored = {
		[PERSONAL_LABELS]: { schemaVersion: 1, labels: [] },
		[CAMPAIGN_LABELS]: { schemaVersion: 1, labels: [] },
	};
	writes = [];
	globalThis.foundry = { utils: { randomID: () => `id-${++id}` } };
	globalThis.game = {
		user: { isGM: true },
		i18n: {
			localize: key => key.startsWith('FOUNDRYSHOP.Labels.Starter.') ? `Starter ${key.split('.').pop()}` : key,
			format: (key, args) => `${key} ${JSON.stringify(args)}`,
		},
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

test('stored raw starter i18n keys read back localized and persist on the next edit', async () => {
	game.i18n.has = key => key.startsWith('FOUNDRYSHOP.Labels.Starter.');
	stored[PERSONAL_LABELS] = { schemaVersion: 1, startersInitialized: true, labels: [
		{ id: 'example-Hall', name: 'FOUNDRYSHOP.Labels.Starter.Hall', text: 'FOUNDRYSHOP.Labels.Starter.Hall' },
		{ id: 'user', name: 'FOUNDRYSHOP.Labels.Mine', text: 'FOUNDRYSHOP.Labels.Mine' },
	] };
	assert.deepEqual(readLabelBank('personal').labels.map(entry => [entry.name, entry.text]), [
		['Starter Hall', 'Starter Hall'], ['FOUNDRYSHOP.Labels.Mine', 'FOUNDRYSHOP.Labels.Mine'],
	]);
	await saveLabel('personal', 'Crypt');
	assert.equal(stored[PERSONAL_LABELS].labels[0].text, 'Starter Hall');
});

test('labels normalize text, default the button name, and allow duplicate text', async () => {
	await saveLabel('personal', '  Throne Room \r\n(ruined) ', '');
	await saveLabel('personal', 'Hall', 'Great Hall');
	await saveLabel('personal', 'Hall', 'Side Hall');
	assert.deepEqual(readLabelBank('personal').labels, [
		{ id: 'id-1', name: 'Throne Room', text: 'Throne Room \n(ruined)' },
		{ id: 'id-2', name: 'Great Hall', text: 'Hall' },
		{ id: 'id-3', name: 'Side Hall', text: 'Hall' },
	]);
});

test('empty or oversized label text is rejected without writes', () => {
	assert.throws(() => saveLabel('personal', '   '), /InvalidText/);
	assert.throws(() => saveLabel('personal', 'x'.repeat(MAX_LABEL_TEXT_LENGTH + 1)), /InvalidText/);
	assert.throws(() => saveLabel('personal', 42), /InvalidText/);
	assert.equal(writes.length, 0);
});

test('players can edit only their own bank', async () => {
	game.user.isGM = false;
	assert.equal(canEditLabelBank('personal'), true);
	assert.equal(canEditLabelBank('campaign'), false);
	await assert.rejects(saveLabel('campaign', 'Shared'), /GMOnly/);
	await saveLabel('personal', 'Mine');
	assert.equal(readLabelBank('personal').labels.length, 1);
	assert.throws(() => readLabelBank('other'), /Invalid label bank scope/);
});

test('stale edit/delete is refused; valid edit keeps id and order', async () => {
	await saveLabel('campaign', 'Cave');
	await saveLabel('campaign', 'River');
	const stale = readLabelBank('campaign').labels[0];
	await editLabel('campaign', stale, 'Cave Mouth', 'Cave');
	assert.deepEqual(readLabelBank('campaign').labels[0], { id: stale.id, name: 'Cave', text: 'Cave Mouth' });
	await assert.rejects(editLabel('campaign', stale, 'Old'), /Changed/);
	await assert.rejects(deleteLabel('campaign', stale), /Changed/);
	await deleteLabel('campaign', readLabelBank('campaign').labels[0]);
	assert.deepEqual(readLabelBank('campaign').labels.map(label => label.text), ['River']);
});

test('starter labels are explicit, localized, additive, and idempotent', async () => {
	await saveLabel('personal', 'Starter Hall', 'Keep my name');
	await addStarterLabels('personal');
	const labels = readLabelBank('personal').labels;
	assert.equal(labels.length, STARTER_LABEL_KEYS.length);
	assert.equal(labels[0].name, 'Keep my name');
	const count = writes.length;
	await addStarterLabels('personal');
	assert.equal(writes.length, count);
});

test('starter defaults initialize once, preserve existing entries and respect later deletion', async () => {
	await saveLabel('personal', 'Starter Hall', 'My hall');
	await ensureStarterLabels('personal');
	let bank = readLabelBank('personal');
	assert.equal(bank.startersInitialized, true);
	assert.equal(bank.labels.length, 14);
	assert.equal(bank.labels[0].name, 'My hall');
	await deleteLabel('personal', bank.labels.at(-1));
	const count = writes.length;
	await ensureStarterLabels('personal');
	bank = readLabelBank('personal');
	assert.equal(bank.labels.length, 13);
	assert.equal(writes.length, count);
});

test('concurrent saves are serialized and the bank limit is enforced', async () => {
	await Promise.all(['A', 'B', 'C'].map(text => saveLabel('personal', text)));
	assert.deepEqual(readLabelBank('personal').labels.map(label => label.text), ['A', 'B', 'C']);
	stored[PERSONAL_LABELS].labels = Array.from({ length: MAX_LABELS }, (_, i) => ({ id: `l${i}`, name: '', text: `L${i}` }));
	await assert.rejects(saveLabel('personal', 'Overflow'), /Full/);
	await assert.rejects(addStarterLabels('personal'), /Full/);
});

test('malformed banks are rejected', () => {
	for (const value of [null, { schemaVersion: 2, labels: [] }, { schemaVersion: 1, labels: {} },
		{ schemaVersion: 1, labels: [{ id: '', name: '', text: 'x' }] },
		{ schemaVersion: 1, labels: [{ id: 'a', name: '', text: '' }] },
		{ schemaVersion: 1, labels: [{ id: 'a', name: '', text: 'x' }, { id: 'a', name: '', text: 'y' }] }]) {
		assert.throws(() => validateLabelBank(value));
	}
});

test('storage failure reaches caller and does not poison subsequent edits', async () => {
	const set = game.settings.set;
	game.settings.set = async () => { throw new Error('Storage offline'); };
	await assert.rejects(saveLabel('personal', 'First'), /Storage offline/);
	game.settings.set = set;
	await saveLabel('personal', 'Second');
	assert.deepEqual(readLabelBank('personal').labels.map(label => label.text), ['Second']);
});

test('saved styles round trip, edits preserve them, stale style changes fail, and plain defaults remain optional', async () => {
	const style = { fontFamily: 'Amiri', fontSize: 36, textColor: '#302b26' };
	await saveLabel('personal', 'Old Watchtower', '', style);
	const original = readLabelBank('personal').labels[0];
	assert.deepEqual(original.style, style);
	const detached = readLabelBank('personal'); detached.labels[0].style.fontSize = 99;
	assert.equal(readLabelBank('personal').labels[0].style.fontSize, 36);
	await editLabel('personal', original, 'Watchtower');
	assert.deepEqual(readLabelBank('personal').labels[0].style, style);
	const saved = readLabelBank('personal').labels[0];
	await editLabel('personal', saved, saved.text, saved.name, { ...style, fontFamily: 'Signika' });
	await assert.rejects(deleteLabel('personal', saved), /Changed/);
	await editLabel('personal', readLabelBank('personal').labels[0], 'Watchtower', '', null);
	assert.equal(readLabelBank('personal').labels[0].style, undefined);
	for (const invalid of [{ ...style, fontSize: 7 }, { ...style, fontSize: 300 },
		{ ...style, fontSize: 24.5 }, { ...style, textColor: 'red' }, { ...style, fontFamily: '<bad>' },
		{ ...style, extra: true }]) {
		assert.throws(() => saveLabel('personal', 'Bad', '', invalid), /InvalidStyle/);
	}
});

test('starter examples persist three distinct fonts and readable ink without replacing existing labels', async () => {
	await addStarterLabels('personal');
	const labels = readLabelBank('personal').labels;
	assert.equal(labels.length, 14);
	assert.deepEqual(new Set(labels.map(label => label.style.fontFamily)), new Set(['Signika', 'Amiri', 'Modesto Condensed']));
	assert.ok(labels.every(label => label.style.fontSize >= 22 && label.style.fontSize <= 64));
});
