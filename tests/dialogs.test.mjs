import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { FoundryshopDialog } from '../scripts/dialogs.js';

test('module dialogs add scrolling without mutating options or changing callbacks and results', async () => {
	for (const method of ['prompt', 'confirm', 'wait']) {
		const callback = () => 'accepted';
		const options = { classes: ['foundryshop-project-exchange'], modal: true,
			rejectClose: false, ok: { callback }, render: callback };
		let received;
		const result = { accepted: true };
		globalThis.foundry = { applications: { api: { DialogV2: {
			[method](value) { received = value; return Promise.resolve(result); },
		} } } };
		assert.equal(await FoundryshopDialog[method](options), result);
		assert.deepEqual(received.classes, ['foundryshop-project-exchange', 'fshop-dialog']);
		assert.deepEqual(options.classes, ['foundryshop-project-exchange']);
		assert.equal(received.ok, options.ok);
		assert.equal(received.render, callback);
		assert.equal(received.rejectClose, false);
		assert.equal(received.modal, true);
	}
	delete globalThis.foundry;
});

test('simple dialogs are scrollable and dialog failures still propagate', async () => {
	let received;
	const error = new Error('dialog failed');
	globalThis.foundry = { applications: { api: { DialogV2: {
		confirm(options) { received = options; throw error; },
	} } } };
	assert.throws(() => FoundryshopDialog.confirm({}), error);
	assert.deepEqual(received.classes, ['fshop-dialog']);
	delete globalThis.foundry;
});

test('all module DialogV2 calls use the scoped scrolling wrapper', () => {
	const check = directory => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
			if (entry.isDirectory()) check(path);
			else if (entry.name.endsWith('.js') && entry.name !== 'dialogs.js') {
				assert.doesNotMatch(readFileSync(path, 'utf8'), /api\.DialogV2|const\s*\{[^}]*\bDialogV2\b/,
					`Unwrapped dialog: ${path}`);
			}
		}
	};
	check(new URL('../scripts/', import.meta.url));
});
