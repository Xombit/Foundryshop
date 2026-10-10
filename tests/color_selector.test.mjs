import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pixelRegion } from '../scripts/pixel_region.js';
import { Color_Selector } from '../scripts/color_selector.js';

test('sampling maps offset/scaled canvas to physical pixels and bottom-left origin', () => {
	assert.deepEqual(pixelRegion(110, 70, 3, { left: 10, top: 20, width: 200, height: 100 }, 400, 200, 2),
		{ x: 99.5, y: 49, width: 1.5, height: 1.5 });
	assert.deepEqual(pixelRegion(10, 20, 1, { left: 10, top: 20, width: 200, height: 100 }, 400, 200, 2),
		{ x: 0, y: 99.5, width: 0.5, height: 0.5 });
});

test('preview center and single-pixel selection address the same pixel', () => {
	const args = [110, 70];
	const bounds = { left: 10, top: 20, width: 200, height: 100 };
	const preview = pixelRegion(...args, 5, bounds, 400, 200, 2);
	const selected = pixelRegion(...args, 1, bounds, 400, 200, 2);
	assert.equal(preview.x + 1, selected.x);
	assert.equal(preview.y + 1, selected.y);
});

test('invalid sampling dimensions fail explicitly', () => {
	assert.throws(() => pixelRegion(0, 0, 0, { width: 100, height: 100 }, 100, 100, 1));
	assert.throws(() => pixelRegion(0, 0, 1, { width: 0, height: 100 }, 100, 100, 1));
});

test('preview indices use extraction display order, without vertical inversion', () => {
	const picker = new Color_Selector({ dropper_read_size: 3 }, { x: 0, y: 0 });
	picker.initialize_dropper();
	assert.deepEqual(picker.pixel_ids, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('sampling refreshes the main canvas before extracting an exact-size region', () => {
	let rendered = false;
	globalThis.canvas = {
		ready: true,
		app: {
			render() { rendered = true; },
			renderer: {
				width: 100, height: 100, resolution: 1,
				view: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
				extract: {
					pixels(target, rect) {
						assert.equal(rendered, true);
						assert.equal(target, undefined);
						assert.equal(rect.x, 10);
						assert.equal(rect.y, 79);
						return new Uint8Array([10, 20, 30, 255]);
					},
				},
			},
		},
	};
	globalThis.PIXI = { Rectangle: class { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } } };
	const picker = new Color_Selector();
	assert.deepEqual([...picker._readCanvasPixels(10, 20, 1)], [10, 20, 30, 255]);
	canvas.app.renderer.extract.pixels = () => new Uint8Array(0);
	assert.throws(() => picker._readCanvasPixels(10, 20, 1), /pixel data length/);
});

test('dispose cancels sampling and releases all document drag listeners', () => {
	const removed = [];
	globalThis.document = { removeEventListener: (name, handler) => removed.push([name, handler]) };
	const picker = new Color_Selector();
	let cancelled = false;
	picker.cancel_dropper = () => { cancelled = true; };
	picker.mouseup_wrapper = () => {};
	picker.canvas_mousemove_wrapper = () => {};
	picker.hue_mousemove_wrapper = () => {};
	picker.down = true;
	picker.color_update_listener = () => {};
	picker.dispose();
	assert.equal(cancelled, true);
	assert.deepEqual(removed.map(([name]) => name), ['mouseup', 'mousemove', 'mousemove']);
	assert.equal(picker.down, false);
	assert.equal(picker.color_update_listener, null);
});

test('template HTTP failures do not compile an error page', async () => {
	globalThis.fetch = async () => ({ ok: false, status: 404 });
	await assert.rejects(Color_Selector.loadTemplate(), /HTTP 404/);
});

test('RGB/HSV conversions preserve primary and representative colors', () => {
	for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#123456', '#000000', '#ffffff']) {
		const vector = Color_Selector.color_str_to_vec(hex);
		assert.equal(Color_Selector.color_vec_to_str(Color_Selector.hsv_vec_to_rgb(
			Color_Selector.rbg_vec_to_hsv(vector))), hex);
	}
});

function dropperFixture() {
	const listeners = new Map();
	const callbacks = new Map();
	const frames = new Map();
	const errors = [];
	const overlay = { style: {}, remove() { this.removed = true; }, querySelector: () => ({ style: {} }) };
	globalThis.document = {
		createElement: () => ({ content: { firstChild: overlay } }),
		body: { appendChild() {} },
		elementFromPoint: () => null,
		addEventListener: (name, handler) => listeners.set(name, handler),
		removeEventListener: name => listeners.delete(name),
	};
	globalThis.Handlebars = { compile: () => () => '<div></div>' };
	globalThis.Hooks = {
		on: (name, handler) => { callbacks.set(name, handler); return name; },
		off: name => callbacks.delete(name),
	};
	globalThis.requestAnimationFrame = handler => { frames.set(1, handler); return 1; };
	globalThis.cancelAnimationFrame = id => frames.delete(id);
	globalThis.game = { i18n: { localize: key => key, format: (key, { message }) => message } };
	globalThis.ui = { notifications: { error: message => errors.push(message), warn: message => errors.push(message) } };
	globalThis.canvas = { ready: true, app: { renderer: { view: {} } } };
	const picker = new Color_Selector({ dropper_read_size: 3 }, { x: 0, y: 0 });
	picker.initialize_dropper();
	picker._readCanvasPixels = () => new Uint8Array([1, 2, 3, 255]);
	picker.dropper_button_handler({ stopImmediatePropagation() {} });
	return { picker, listeners, callbacks, frames, errors, overlay };
}

test('eyedropper selection reports sampled RGB and removes capture listeners', () => {
	const fixture = dropperFixture();
	let selected;
	fixture.picker.update_html_colors = color => { selected = color; };
	let prevented = false;
	fixture.listeners.get('pointerdown')({
		target: canvas.app.renderer.view, button: 0, clientX: 10, clientY: 20,
		preventDefault() { prevented = true; }, stopImmediatePropagation() {},
	});
	assert.equal(selected, '#010203');
	assert.equal(prevented, true);
	assert.equal(fixture.listeners.size, 0);
	assert.equal(fixture.callbacks.size, 0);
	assert.equal(fixture.overlay.removed, true);
	assert.equal(fixture.picker.dropper, null);
});

test('canvas teardown cancels pending preview work and removes the overlay', () => {
	const fixture = dropperFixture();
	fixture.listeners.get('mousemove')({
		target: canvas.app.renderer.view, clientX: 10, clientY: 20, stopImmediatePropagation() {},
	});
	assert.equal(fixture.frames.size, 1);
	fixture.callbacks.get('canvasTearDown')();
	assert.equal(fixture.frames.size, 0);
	assert.equal(fixture.listeners.size, 0);
	assert.equal(fixture.overlay.removed, true);
});

test('sampling failure is reported and never leaves input capture active', () => {
	const fixture = dropperFixture();
	fixture.picker._readCanvasPixels = () => { throw new Error('Extraction failed'); };
	const originalError = console.error;
	console.error = () => {};
	try {
		fixture.listeners.get('pointerdown')({
			target: canvas.app.renderer.view, button: 0, clientX: 10, clientY: 20,
			preventDefault() {}, stopImmediatePropagation() {},
		});
	} finally {
		console.error = originalError;
	}
	assert.deepEqual(fixture.errors, ['Extraction failed']);
	assert.equal(fixture.listeners.size, 0);
	assert.equal(fixture.overlay.removed, true);
});
