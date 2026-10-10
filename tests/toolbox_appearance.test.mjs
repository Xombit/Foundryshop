import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flyoutPosition, resolveToolboxTheme, validateToolboxScale } from '../scripts/toolbox_appearance.js';

test('whole-window scaling accepts only the bounded slider steps', () => {
	globalThis.game = { i18n: { localize: key => key } };
	for (const value of [50, 75, 100, 125]) assert.equal(validateToolboxScale(value), value);
	for (const value of [0, 49, 126, 101, NaN, '50']) assert.throws(() => validateToolboxScale(value), /InvalidScale/);
});

test('slate is default; Foundry and game system are explicit alternatives', () => {
	assert.equal(resolveToolboxTheme(undefined), 'slate');
	assert.equal(resolveToolboxTheme('invalid'), 'slate');
	assert.equal(resolveToolboxTheme('foundry'), 'foundry');
	assert.equal(resolveToolboxTheme('system'), 'system');
});

test('flyout opens right with a gap without altering its anchor', () => {
	const anchor = { left: 20, right: 420, top: 100 };
	assert.deepEqual(flyoutPosition(anchor, { width: 360, height: 400 }, { width: 1200, height: 900 }),
		{ left: 428, top: 100, width: 360, height: 400, side: 'right' });
	assert.deepEqual(anchor, { left: 20, right: 420, top: 100 });
});

test('flyout flips left and clamps vertically near viewport edges', () => {
	assert.deepEqual(flyoutPosition({ left: 700, right: 1100, top: 700 }, { width: 360, height: 400 },
		{ width: 1200, height: 900 }), { left: 332, top: 492, width: 360, height: 400, side: 'left' });
});

test('narrow viewports keep the overlay bounded when neither side fits', () => {
	const result = flyoutPosition({ left: 5, right: 399, top: -5 }, { width: 360, height: 500 },
		{ width: 320, height: 300 });
	assert.equal(result.left, 8); assert.equal(result.top, 8);
	assert.equal(result.width, 304); assert.equal(result.height, 284);
});

test('a cursor point anchors once and follows the same right/left and bottom-edge rules', () => {
	assert.deepEqual(flyoutPosition({ left: 500, right: 500, top: 200 }, { width: 360, height: 250 },
		{ width: 1200, height: 900 }), { left: 508, top: 200, width: 360, height: 250, side: 'right' });
	assert.deepEqual(flyoutPosition({ left: 1150, right: 1150, top: 850 }, { width: 360, height: 250 },
		{ width: 1200, height: 900 }), { left: 782, top: 642, width: 360, height: 250, side: 'left' });
});
