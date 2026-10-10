import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeColor, suggestedColorName } from '../scripts/color_names.js';

const translations = JSON.parse(readFileSync(new URL('../languages/en.json', import.meta.url), 'utf8'));
globalThis.game = { i18n: {
	localize: key => translations[key] ?? key,
	format: (key, { color }) => translations[key].replace('{color}', color),
} };

test('names neutrals, hue families and useful tonal variations deterministically', () => {
	for (const [hex, name] of Object.entries({
		'#000000': 'Black', '#ffffff': 'White', '#808080': 'Gray', '#333333': 'Dark Gray', '#cccccc': 'Light Gray',
		'#ff0000': 'Red', '#ff8000': 'Orange', '#ffff00': 'Yellow', '#80ff00': 'Yellow-green',
		'#00ff00': 'Green', '#00ff80': 'Blue-green', '#00ffff': 'Cyan', '#0000ff': 'Blue',
		'#8000ff': 'Purple', '#ff00ff': 'Magenta', '#ff0080': 'Pink', '#804000': 'Brown',
		'#80d5aa': 'Light Blue-green', '#bbddff': 'Pale Blue', '#708090': 'Muted Blue', '#001040': 'Dark Blue',
	})) {
		assert.equal(suggestedColorName(hex), name, hex);
		assert.equal(suggestedColorName(hex.toUpperCase()), name);
	}
});

test('invalid values reject explicitly, and tone phrases are localized as complete templates', () => {
	for (const value of ['blue', '#fff', null, 0, '#zz0000']) assert.throws(() => describeColor(value), /six-digit hex/);
	const original = game.i18n;
	try {
		game.i18n = { localize: key => key.endsWith('.Blue') ? 'bleu' : key,
			format: (key, { color }) => `${color} clair` };
		assert.equal(suggestedColorName('#80aaff'), 'bleu clair');
	} finally { game.i18n = original; }
});
