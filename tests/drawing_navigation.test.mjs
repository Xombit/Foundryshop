import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDrawingNavigation, isDrawingCreationDrag, initDrawingNavigation } from '../scripts/drawing_navigation.js';

let enabled, calls;
beforeEach(() => {
	enabled = false;
	calls = [];
	globalThis.game = { settings: { get(namespace, key) {
		assert.equal(namespace, 'foundryshop');
		assert.equal(key, 'drawingEdgePan');
		return enabled;
	} } };
});

function canvasAndEvent() {
	const drawings = {};
	const canvas = { drawings, activeLayer: drawings, _onDragCanvasPan(...args) {
		calls.push({ receiver: this, args });
		return 'native-result';
	} };
	const event = { x: 5, y: 5, interactionData: {
		preview: { document: { documentName: 'Drawing' }, previewType: 'creation' },
	} };
	return { canvas, event };
}

test('Drawing creation at any edge does not trigger native auto-pan by default', () => {
	const { canvas, event } = canvasAndEvent();
	installDrawingNavigation(canvas);
	for (const point of [{ x: 5, y: 5 }, { x: 1500, y: 5 }, { x: 5, y: 900 }]) {
		Object.assign(event, point);
		assert.equal(canvas._onDragCanvasPan(event), undefined);
	}
	assert.equal(calls.length, 0);
	assert.equal(event.interactionData.preview.previewType, 'creation');
});

test('setting changes apply immediately and preserve native receiver, arguments and return value', () => {
	const { canvas, event } = canvasAndEvent();
	installDrawingNavigation(canvas);
	enabled = true;
	assert.equal(canvas._onDragCanvasPan(event, 'extra'), 'native-result');
	assert.deepEqual(calls, [{ receiver: canvas, args: [event, 'extra'] }]);
	enabled = false;
	canvas._onDragCanvasPan(event);
	assert.equal(calls.length, 1);
});

test('normal navigation, existing Drawing manipulation, and other layers retain native pan', () => {
	for (const variant of ['missing', 'existing', 'destroyed', 'other-document', 'other-layer']) {
		const { canvas, event } = canvasAndEvent();
		if (variant === 'missing') delete event.interactionData;
		if (variant === 'existing') event.interactionData.preview.previewType = 'dragging';
		if (variant === 'destroyed') event.interactionData.preview._destroyed = true;
		if (variant === 'other-document') event.interactionData.preview.document.documentName = 'Tile';
		if (variant === 'other-layer') canvas.activeLayer = {};
		assert.equal(isDrawingCreationDrag(canvas, event), false);
		installDrawingNavigation(canvas);
		assert.equal(canvas._onDragCanvasPan(event), 'native-result');
	}
	assert.equal(calls.length, 5);
});

test('installation is idempotent across Scene reloads and composes with the existing handler', () => {
	const { canvas, event } = canvasAndEvent();
	installDrawingNavigation(canvas);
	const wrapper = canvas._onDragCanvasPan;
	installDrawingNavigation(canvas);
	assert.equal(canvas._onDragCanvasPan, wrapper);
	enabled = true;
	canvas._onDragCanvasPan(event);
	assert.equal(calls.length, 1);
});

test('missing native handler throws and canvasReady reports the integration failure', () => {
	assert.throws(() => installDrawingNavigation({}), /edge-pan handler is unavailable/);
	let ready;
	const errors = [];
	globalThis.Hooks = { on(name, callback) { assert.equal(name, 'canvasReady'); ready = callback; } };
	game.i18n = { format: (key, { message }) => message };
	globalThis.ui = { notifications: { error: message => errors.push(message) } };
	initDrawingNavigation();
	ready({});
	assert.match(errors[0], /edge-pan handler is unavailable/);
	const { canvas, event } = canvasAndEvent();
	ready(canvas);
	canvas._onDragCanvasPan(event);
	assert.equal(calls.length, 0);
});
