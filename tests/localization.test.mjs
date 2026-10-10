import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('English translation keys expand without string/object namespace collisions', () => {
	const strings = JSON.parse(readFileSync(new URL('../languages/en.json', import.meta.url), 'utf8'));
	const expanded = {};
	for (const [key, value] of Object.entries(strings)) {
		assert.equal(typeof value, 'string', key);
		const parts = key.split('.');
		let parent = expanded;
		for (const part of parts.slice(0, -1)) {
			if (Object.hasOwn(parent, part)) assert.equal(typeof parent[part], 'object', `Namespace collision: ${key}`);
			else parent[part] = {};
			parent = parent[part];
		}
		assert.equal(Object.hasOwn(parent, parts.at(-1)), false, `Duplicate or namespace collision: ${key}`);
		parent[parts.at(-1)] = value;
	}
	assert.equal(expanded.FOUNDRYSHOP.Toolbox.Title, 'Drawing Toolbox');
	assert.equal(expanded.FOUNDRYSHOP.Toolbox.Tab.brush, 'Style');
	assert.equal(expanded.FOUNDRYSHOP.Toolbox.FillType, 'Fill type');
	assert.equal(expanded.FOUNDRYSHOP.Toolbox.FillOption[0], 'None');
});

test('project resource review distinguishes explicit multi-Level import from unsupported recovery', () => {
	const strings = JSON.parse(readFileSync(new URL('../languages/en.json', import.meta.url), 'utf8'));
	const review = strings['FOUNDRYSHOP.Project.ConfirmResources'];
	assert.match(review, /Multi-Level packages require the explicit source-Level or combine choice/);
	assert.match(review, /Recovery-bearing packages remain unsupported/);
	assert.doesNotMatch(review, /multiple source Levels are not supported/);
});
