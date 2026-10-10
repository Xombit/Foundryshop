import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	LABEL_STATE_CHANGED, PLACE_TEXT_OPTION, getLabelState, armLabel, setLabelMode, disarmLabel, resetLabelState,
	isInteractiveCreate, onPreCreateDrawing, onCreateDrawing, buildPlaceTextData, placeTextAt,
	onPlacePointerDown, onPlaceKeyDown, initLabelPlacement, teardownLabelPlacement,
	armLabelPlacement, updateLabelPlacement, onLabelMove, onLabelWheel,
} from '../scripts/label_placement.js';

let hooks, events, listeners, created, errors;

function drawing(text = '') {
	return { text, updateSource(changes) { Object.assign(this, changes); } };
}

beforeEach(() => {
	hooks = new Map();
	events = [];
	listeners = new Map();
	created = [];
	errors = [];
	let id = 0;
	globalThis.Hooks = {
		on(name, fn) { hooks.set(++id, { name, fn }); return id; },
		off(name, key) { hooks.delete(key); },
		callAll(name, ...args) {
			if (name === LABEL_STATE_CHANGED) events.push(args[0]);
			for (const hook of hooks.values()) if (hook.name === name) hook.fn(...args);
		},
	};
	globalThis.window = {
		addEventListener(name, fn) { listeners.set(name, fn); },
		removeEventListener(name) { listeners.delete(name); },
	};
	globalThis.game = {
		user: { id: 'me', can: () => true },
		i18n: { localize: key => key, format: (key, args) => `${key} ${JSON.stringify(args)}` },
	};
	globalThis.foundry = { utils: { deepClone: structuredClone } };
	foundry.applications = { settings: { menus: { FontConfig: {
		getAvailableFonts: () => ['Signika', 'Amiri', 'Modesto Condensed'],
	} } } };
	globalThis.ui = { notifications: { error: message => errors.push(message) } };
	const view = {};
	globalThis.canvas = {
		ready: true,
		scene: { id: 'scene' },
		app: { view },
		drawings: {
			active: true,
			paletteCreateData: { _id: 'x', strokeWidth: 8, fillType: 1, fontSize: 20, textAlpha: 0, textColor: '#ffffff' },
			getMaxSort: () => 4,
		},
		canvasCoordinatesFromClient: ({ x, y }) => ({ x: x * 2, y: y * 2 }),
	};
	globalThis.getDocumentClass = () => ({
		cleanData: data => ({ ...data, cleaned: true }),
		async create(data, options) { created.push({ data, options }); return data; },
	});
});

afterEach(() => teardownLabelPlacement());

test('arming validates text and mode; armed state is in-memory and observable', () => {
	assert.throws(() => armLabel('   '), /InvalidText/);
	assert.throws(() => armLabel('Hall', 'bogus'), /Invalid label mode/);
	assert.throws(() => setLabelMode('next'), /NoneSelected/);
	armLabel('  Hall ');
	assert.deepEqual(getLabelState(), { mode: 'next', text: 'Hall' });
	setLabelMode('repeat');
	disarmLabel();
	assert.deepEqual(getLabelState(), { mode: 'off', text: 'Hall' });
	assert.deepEqual(events.map(event => event.mode), ['next', 'repeat', 'off']);
	setLabelMode('next');
	assert.equal(getLabelState().mode, 'next');
	resetLabelState();
	assert.deepEqual(getLabelState(), { mode: 'off', text: '' });
});

test('styled examples retain style across modes and apply only to interactive new shapes or Place Text', async () => {
	const style = { fontFamily: 'Amiri', fontSize: 36, textColor: '#302b26' };
	armLabel('Old Watchtower', 'repeat', style);
	const detached = getLabelState(); detached.style.fontSize = 99;
	assert.equal(getLabelState().style.fontSize, 36);
	const changes = [];
	const doc = { text: '', updateSource: patch => changes.push(patch) };
	onPreCreateDrawing(doc, {}, { controlObject: true }, 'me');
	assert.deepEqual(changes[0], { text: 'Old Watchtower', ...style });
	onPreCreateDrawing(doc, {}, { isUndo: true }, 'me');
	assert.equal(changes.length, 1);
	setLabelMode('place');
	assert.deepEqual(getLabelState().style, style);
	await placeTextAt(100, 100);
	assert.equal(created[0].data.fontFamily, 'Amiri');
	assert.equal(created[0].data.fontSize, 36);
	assert.equal(created[0].data.textColor, '#302b26');
	disarmLabel();
	assert.deepEqual(getLabelState().style, style);
	resetLabelState();
	assert.equal(getLabelState().style, undefined);
	assert.throws(() => armLabel('Unavailable', 'next', { ...style, fontFamily: 'Missing' }), /MissingFont/);
});

test('confirmation of an older same-text style cannot consume a newly armed styled label', () => {
	const first = { fontFamily: 'Amiri', fontSize: 36, textColor: '#302b26' };
	const second = { ...first, fontFamily: 'Signika' };
	armLabel('Hall', 'next', first);
	const doc = { text: '', updateSource: patch => Object.assign(doc, patch) };
	onPreCreateDrawing(doc, {}, { controlObject: true }, 'me');
	armLabel('Hall', 'next', second);
	onCreateDrawing(doc, {}, 'me');
	assert.equal(getLabelState().mode, 'next');
	const next = { text: '', updateSource: patch => Object.assign(next, patch) };
	onPreCreateDrawing(next, {}, { controlObject: true }, 'me');
	onCreateDrawing(next, {}, 'me');
	assert.equal(getLabelState().mode, 'off');
});

test('explicit label opacity survives interactive creation and Place Text including fully transparent labels', async () => {
	for (const textAlpha of [0, 0.4, 1]) {
		armLabel('Opacity', 'place', { fontFamily: 'Signika', fontSize: 24, textColor: '#302b26', textAlpha });
		await placeTextAt(20, 20);
		assert.equal(created.at(-1).data.textAlpha, textAlpha);
		setLabelMode('repeat');
		const doc = { text: '', updateSource: patch => Object.assign(doc, patch) };
		onPreCreateDrawing(doc, {}, { controlObject: true }, 'me');
		assert.equal(doc.textAlpha, textAlpha);
	}
	assert.throws(() => armLabel('Bad', 'next', {
		fontFamily: 'Signika', fontSize: 24, textColor: '#302b26', textAlpha: 1.5,
	}), /InvalidStyle/);
});

test('only native interactive creation is treated as labelable', () => {
	assert.equal(isInteractiveCreate({ controlObject: true }), true);
	assert.equal(isInteractiveCreate({ controlObject: false }), true);
	assert.equal(isInteractiveCreate({}), false);
	assert.equal(isInteractiveCreate({ controlObject: true, isUndo: true }), false);
	assert.equal(isInteractiveCreate({ controlObject: true, keepId: true }), false);
	assert.equal(isInteractiveCreate({ controlObject: true, [PLACE_TEXT_OPTION]: true }), false);
});

test('Next Shape labels one confirmed creation then disarms', () => {
	armLabel('Hall');
	const doc = drawing();
	onPreCreateDrawing(doc, {}, { controlObject: true }, 'me');
	assert.equal(doc.text, 'Hall');
	assert.equal(getLabelState().mode, 'next', 'not consumed before the server confirms');
	onCreateDrawing(doc, {}, 'me');
	assert.equal(getLabelState().mode, 'off');
	const next = drawing();
	onPreCreateDrawing(next, {}, { controlObject: true }, 'me');
	assert.equal(next.text, '');
});

test('Repeat labels every creation until disarmed', () => {
	armLabel('Cave', 'repeat');
	for (let i = 0; i < 3; i++) {
		const doc = drawing();
		onPreCreateDrawing(doc, {}, { controlObject: true }, 'me');
		onCreateDrawing(doc, {}, 'me');
		assert.equal(doc.text, 'Cave');
	}
	assert.equal(getLabelState().mode, 'repeat');
});

test('labels ignore other users, paste/undo, and drawings that already have text', () => {
	armLabel('Hall');
	const other = drawing();
	onPreCreateDrawing(other, {}, { controlObject: true }, 'someone-else');
	const pasted = drawing();
	onPreCreateDrawing(pasted, {}, {}, 'me');
	const typed = drawing('Typed');
	onPreCreateDrawing(typed, {}, { controlObject: true }, 'me');
	assert.deepEqual([other.text, pasted.text, typed.text], ['', '', 'Typed']);
	onCreateDrawing(drawing('Hall'), {}, 'someone-else');
	onCreateDrawing(drawing('Hall'), {}, 'me');
	assert.equal(getLabelState().mode, 'next', 'unrelated creations never consume the armed label');
});

test('Place Text data is centered, text-only, and keeps palette text style', () => {
	const data = buildPlaceTextData({ x: 100, y: 100 }, 'Hall\nEast', { _id: 'x', fontSize: 20, textAlpha: 0.5, strokeWidth: 8 });
	assert.equal(data._id, undefined);
	assert.deepEqual(data.shape, { type: 'r', width: 64, height: 60 });
	assert.deepEqual([data.x, data.y], [68, 70]);
	assert.deepEqual([data.text, data.strokeWidth, data.fillType, data.textAlpha], ['Hall\nEast', 0, 0, 0.5]);
	assert.equal(buildPlaceTextData({ x: 0, y: 0 }, 'A', { fontSize: 9999 }).fontSize, 256);
	assert.equal(buildPlaceTextData({ x: 0, y: 0 }, 'A', { textAlpha: 0 }).textAlpha, 1);
});

test('Place Text creates a scene drawing at canvas coordinates without leaking into defaults', async () => {
	armLabel('Ruins', 'place');
	await placeTextAt(10, 20);
	assert.equal(created.length, 1);
	const { data, options } = created[0];
	assert.equal(options.parent, canvas.scene);
	assert.equal(options[PLACE_TEXT_OPTION], true);
	assert.deepEqual([data.text, data.author, data.sort, data.cleaned], ['Ruins', 'me', 5, true]);
	assert.equal(data.x + data.shape.width / 2, 20);
	assert.equal(canvas.drawings.paletteCreateData.strokeWidth, 8);
	assert.equal(canvas.drawings.paletteCreateData.textAlpha, 0);
	canvas.drawings.active = false;
	await assert.rejects(placeTextAt(1, 1), /NoLayer/);
	canvas.drawings.active = true;
	game.user.can = () => false;
	await assert.rejects(placeTextAt(1, 1), /NoPermission/);
});

test('Place mode installs pointer/escape listeners only while armed and swallows canvas taps', async () => {
	armLabel('Hall');
	assert.equal(listeners.has('pointerdown'), false);
	setLabelMode('place');
	assert.equal(listeners.has('pointerdown'), true);
	let stopped = 0;
	const tap = (overrides = {}) => ({
		button: 0, isPrimary: true, target: canvas.app.view, clientX: 5, clientY: 5,
		preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { stopped++; }, ...overrides,
	});
	onPlacePointerDown(tap({ target: {} }));
	onPlacePointerDown(tap({ button: 2 }));
	onPlacePointerDown(tap({ isPrimary: false }));
	assert.equal(stopped, 0);
	onPlacePointerDown(tap());
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(stopped, 1);
	assert.equal(created.length, 1);
	onPlaceKeyDown({ key: 'Escape', target: { tagName: 'INPUT' }, preventDefault() {}, stopPropagation() {} });
	assert.equal(getLabelState().mode, 'place', 'Escape in a form field is not ours');
	onPlaceKeyDown({ key: 'Escape', target: {}, preventDefault() {}, stopPropagation() {} });
	assert.equal(getLabelState().mode, 'off');
	assert.equal(listeners.has('pointerdown'), false);
});

test('leaving the Drawings layer or tearing down the canvas disarms', () => {
	initLabelPlacement();
	initLabelPlacement();
	assert.equal([...hooks.values()].filter(hook => hook.name === 'preCreateDrawing').length, 1);
	for (const hook of ['deactivateDrawingsLayer', 'canvasTearDown']) {
		armLabel('Hall', 'repeat');
		Hooks.callAll(hook);
		assert.equal(getLabelState().mode, 'off');
	}
	armLabel('Hall');
	const doc = drawing();
	Hooks.callAll('preCreateDrawing', doc, {}, { controlObject: true }, 'me');
	Hooks.callAll('createDrawing', doc, {}, 'me');
	assert.equal(doc.text, 'Hall');
	assert.equal(getLabelState().mode, 'off');
});

function cursorFixture() {
	game.user.isGM = true;
	let layers = {}, workspace = {};
	canvas.level = { id: 'ground' };
	canvas.scene.levels = new Map([['ground', {}]]);
	canvas.scene.getFlag = (namespace, key) => key === 'layers' ? layers : undefined;
	game.settings = { get: () => workspace };
	const ghosts = [];
	globalThis.CONFIG = { Drawing: { objectClass: class {
		constructor(document) { this.document = document; this.frame = {}; this.controls = {};
			this.renderFlags = { set: flags => { this.flags = flags; } }; ghosts.push(this); }
		async draw() {}
		destroy() { this.destroyed = true; }
	} } };
	canvas.drawings.preview = { addChild() {} };
	globalThis.getDocumentClass = () => class {
		constructor(data) { Object.assign(this, structuredClone(data)); }
		updateSource(data) { Object.assign(this, structuredClone(data)); }
		static cleanData(data) { return structuredClone(data); }
		static async create(data, options) { created.push({ data, options }); return data; }
	};
	return { ghosts, changeLayers: () => { layers = { revision: 1 }; },
		changeWorkspace: () => { workspace = { activeLayerId: 'other' }; } };
}
const labelStyle = { fontFamily: 'Signika', fontSize: 24, textColor: '#302b26', textAlpha: 0.4 };
const cursorEvent = overrides => ({ target: canvas.app.view, clientX: 40, clientY: 50,
	button: 0, isPrimary: true, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...overrides });

test('cursor label mirrors rotation/size, creates exactly one Drawing and removes its ghost after success', async () => {
	const { ghosts } = cursorFixture();
	await armLabelPlacement('Hall', labelStyle);
	const ghost = ghosts[0];
	assert.equal(ghost.visible, false);
	onLabelMove(cursorEvent());
	assert.equal(ghost.visible, true);
	assert.equal(ghost.document.x + ghost.document.shape.width / 2, 80);
	onLabelWheel(cursorEvent({ deltaY: -1, shiftKey: true }));
	assert.equal(getLabelState().rotation, 15);
	assert.equal(ghost.document.rotation, 15);
	onLabelWheel(cursorEvent({ deltaY: -1, ctrlKey: true }));
	assert.equal(getLabelState().style.fontSize, 25);
	assert.equal(ghost.document.fontSize, 25);
	updateLabelPlacement({ rotation: -30, fontSize: 32 });
	assert.equal(ghost.document.rotation, 330);
	assert.equal(ghost.flags.refreshRotation, true);
	onPlacePointerDown(cursorEvent());
	onPlacePointerDown(cursorEvent());
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(created.length, 1);
	assert.equal(created[0].data.rotation, 330);
	assert.equal(created[0].data.fontSize, 32);
	assert.equal(created[0].data.textAlpha, 0.4);
	assert.equal(created[0].data.texture, null);
	assert.equal(getLabelState().mode, 'off');
	assert.equal(ghost.destroyed, true);
});

test('cursor cancellation works even in focused inputs, and Scene/Level/workspace changes refuse creation', async () => {
	const fixture = cursorFixture();
	await armLabelPlacement('Hall', labelStyle);
	onPlaceKeyDown(cursorEvent({ key: 'Escape', target: { tagName: 'INPUT' } }));
	assert.equal(getLabelState().mode, 'off');
	assert.equal(fixture.ghosts[0].destroyed, true);
	await armLabelPlacement('Hall', labelStyle);
	fixture.changeWorkspace();
	onPlacePointerDown(cursorEvent());
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(created.length, 0);
	assert.equal(getLabelState().mode, 'off');
	assert.match(errors.at(-1), /NoLayer/);
	await armLabelPlacement('Hall', labelStyle);
	canvas.level.id = 'other';
	onLabelMove(cursorEvent());
	assert.equal(getLabelState().mode, 'off');
});

test('cursor preview replacement, error cleanup and noncanvas/unmodified wheel gestures are safe', async () => {
	const { ghosts } = cursorFixture();
	await armLabelPlacement('First', labelStyle);
	await armLabelPlacement('Second', labelStyle);
	assert.equal(ghosts[0].destroyed, true);
	let prevented = 0;
	for (const overrides of [{}, { ctrlKey: true, target: {} }, { ctrlKey: true, altKey: true }]) {
		onLabelWheel(cursorEvent({ deltaY: -1, preventDefault() { prevented++; }, ...overrides }));
	}
	assert.equal(prevented, 0);
	assert.equal(getLabelState().rotation, 0);
	CONFIG.Drawing.objectClass.prototype.draw = async () => { throw new Error('Preview failed'); };
	await assert.rejects(armLabelPlacement('Failure', labelStyle), /Preview failed/);
	assert.equal(getLabelState().mode, 'off');
	assert.equal(ghosts.at(-1).destroyed, true);
});

test('refused native creation is reported and leaves the cursor available for retry', async () => {
	cursorFixture();
	await armLabelPlacement('Hall', labelStyle);
	const cls = getDocumentClass('Drawing');
	cls.create = async () => null;
	globalThis.getDocumentClass = () => cls;
	onPlacePointerDown(cursorEvent());
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(created.length, 0);
	assert.match(errors.at(-1), /PlacementRejected/);
	assert.equal(getLabelState().mode, 'place');
});

test('a late asynchronous preview cannot replace a newer label or survive cancellation', async () => {
	const { ghosts } = cursorFixture();
	let release;
	CONFIG.Drawing.objectClass.prototype.draw = function () {
		return this.document.text === 'Old' ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
	};
	const old = armLabelPlacement('Old', labelStyle);
	await armLabelPlacement('New', labelStyle);
	release();
	await old;
	assert.equal(ghosts[0].destroyed, true);
	assert.equal(ghosts[1].destroyed, undefined);
	assert.equal(getLabelState().text, 'New');
	const cancelled = armLabelPlacement('Old', labelStyle);
	disarmLabel();
	release();
	await cancelled;
	assert.equal(ghosts.at(-1).destroyed, true);
	assert.equal(getLabelState().mode, 'off');
});

test('an older failed creation does not cancel a replacement or release its pending-click guard', async () => {
	cursorFixture();
	const cls = getDocumentClass('Drawing'), requests = [];
	cls.create = data => new Promise((resolve, reject) => requests.push({ data, resolve, reject }));
	globalThis.getDocumentClass = () => cls;
	await armLabelPlacement('First', labelStyle);
	onPlacePointerDown(cursorEvent());
	await armLabelPlacement('Second', labelStyle);
	onPlacePointerDown(cursorEvent());
	requests[0].reject(new Error('Old write failed'));
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(getLabelState().text, 'Second');
	assert.equal(getLabelState().mode, 'place');
	onPlacePointerDown(cursorEvent());
	assert.equal(requests.length, 2);
	requests[1].resolve(requests[1].data);
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(getLabelState().mode, 'off');
});
