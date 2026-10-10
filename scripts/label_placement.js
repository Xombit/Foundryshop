import { normalizeLabelText } from './label_banks.js';
import { normalizeLabelStyle } from './label_styles.js';
import { availableProjectFonts } from './layers/project_resources.js';

export const LABEL_MODES = ['off', 'next', 'repeat', 'place'];
export const LABEL_STATE_CHANGED = 'foundryshopLabelStateChanged';
export const PLACE_TEXT_OPTION = 'foundryshopPlaceText';

let state = { mode: 'off', text: '' };
let pending = [];
let listening = false;
let hookIds = [];
let ghost = null, placementTarget = null, ghostEpoch = 0, placing = false, cursorPoint = null;
let pendingWrites = 0;

export function getLabelState() {
	return structuredClone(state);
}

export function isLabelPlacementPending() {
	return pendingWrites > 0;
}

function setState(next) {
	const changed = JSON.stringify(next) !== JSON.stringify(state);
	state = next;
	if (state.mode !== 'place') {
		ghostEpoch++;
		ghost?.destroy({ children: true });
		ghost = null; placementTarget = null; cursorPoint = null; placing = false;
	}
	if (state.mode !== 'next' && state.mode !== 'repeat') pending = [];
	syncListeners();
	if (changed) Hooks.callAll(LABEL_STATE_CHANGED, getLabelState());
}

/** Arm a label. Armed state is intentionally in-memory only and never restored after reload. */
export function armLabel(text, mode = 'next', style) {
	if (!LABEL_MODES.includes(mode) || mode === 'off') throw new Error(`Invalid label mode: ${mode}`);
	style = normalizeLabelStyle(style);
	if (style && !availableProjectFonts().includes(style.fontFamily)) {
		throw new Error(game.i18n.format('FOUNDRYSHOP.Labels.MissingFont', { font: style.fontFamily }));
	}
	setState({ mode, text: normalizeLabelText(text), ...(style ? { style } : {}) });
}

export function setLabelMode(mode) {
	if (!LABEL_MODES.includes(mode)) throw new Error(`Invalid label mode: ${mode}`);
	if (mode === 'off') return disarmLabel();
	if (!state.text) throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.NoneSelected'));
	setState({ ...state, mode });
}

/** Turn label placement off while keeping the chosen text available to re-arm. */
export function disarmLabel() {
	if (state.mode === 'off') return;
	setState({ ...state, mode: 'off' });
}

export function resetLabelState() {
	setState({ mode: 'off', text: '' });
}

function placementCurrent(target) {
	return target && game.user.isGM && game.user.can('DRAWING_CREATE') && canvas.ready
		&& canvas.drawings?.active && canvas.scene === target.scene && canvas.level?.id === target.levelId
		&& target.scene.levels.has(target.levelId) && !target.scene.getFlag('foundryshop', 'projectImportJournal')
		&& JSON.stringify(target.scene.getFlag('foundryshop', 'layers')) === target.layers
		&& JSON.stringify(game.settings?.get('foundryshop', 'layerWorkspace')) === target.workspace;
}

export async function armLabelPlacement(text, style) {
	disarmLabel();
	if (!game.user.isGM || !canvas.ready || !canvas.drawings?.active || !game.user.can('DRAWING_CREATE')) {
		throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.NoLayer'));
	}
	const target = { scene: canvas.scene, levelId: canvas.level?.id,
		layers: JSON.stringify(canvas.scene?.getFlag('foundryshop', 'layers')),
		workspace: JSON.stringify(game.settings?.get('foundryshop', 'layerWorkspace')) };
	if (!placementCurrent(target)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.NoLayer'));
	armLabel(text, 'place', style);
	placementTarget = target;
	const epoch = ++ghostEpoch;
	let preview;
	try {
		const data = buildPlaceTextData({ x: 0, y: 0 }, state.text,
			{ ...foundry.utils.deepClone(canvas.drawings.paletteCreateData ?? {}), ...state.style, rotation: 0 });
		data.author = game.user.id; data.levels = [target.levelId]; data.hidden = true;
		const document = new (getDocumentClass('Drawing'))(data, { parent: target.scene });
		preview = new CONFIG.Drawing.objectClass(document);
		preview._previewType = 'creation';
		await preview.draw();
		if (epoch !== ghostEpoch) {
			preview.destroy({ children: true });
			return;
		}
		if (!placementCurrent(target)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.NoLayer'));
		ghost = preview;
		canvas.drawings.preview.addChild(ghost);
		ghost.eventMode = 'none';
		if (ghost.frame) ghost.frame.visible = false;
		if (ghost.controls) ghost.controls.visible = false;
		ghost.visible = false;
		setState({ ...state, rotation: 0 });
	} catch (error) {
		preview?.destroy({ children: true });
		if (epoch === ghostEpoch) disarmLabel();
		throw error;
	}
}

export function updateLabelPlacement({ fontSize, rotation } = {}) {
	if (!placementCurrent(placementTarget) || state.mode !== 'place') {
		disarmLabel();
		return;
	}
	const next = { ...state };
	if (fontSize !== undefined) next.style = normalizeLabelStyle({ ...state.style, fontSize });
	if (rotation !== undefined) {
		if (!Number.isFinite(rotation)) throw new Error('Invalid label rotation.');
		next.rotation = ((rotation % 360) + 360) % 360;
	}
	state = next;
	if (ghost) {
		const data = buildPlaceTextData(cursorPoint ?? { x: 0, y: 0 }, state.text,
			{ ...foundry.utils.deepClone(canvas.drawings.paletteCreateData ?? {}), ...state.style, rotation: state.rotation });
		ghost.document.updateSource(data);
		ghost.renderFlags.set({ refreshShape: true, refreshText: true, refreshPosition: true, refreshRotation: true });
	}
	Hooks.callAll(LABEL_STATE_CHANGED, getLabelState());
}

export function onLabelMove(event) {
	if (!placementTarget || event.target !== canvas.app?.view) {
		if (ghost) ghost.visible = false;
		return;
	}
	if (!placementCurrent(placementTarget)) { disarmLabel(); return; }
	cursorPoint = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
	if (ghost) {
		const { width, height } = ghost.document.shape;
		ghost.document.updateSource({ x: cursorPoint.x - width / 2, y: cursorPoint.y - height / 2 });
		ghost.renderFlags.set({ refreshPosition: true });
		ghost.visible = true;
	}
}

export function onLabelWheel(event) {
	if (!placementTarget || event.target !== canvas.app?.view || event.altKey || event.metaKey
		|| (!event.ctrlKey && !event.shiftKey) || !event.deltaY && !event.deltaX) return;
	event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
	const direction = (event.deltaY || event.deltaX) < 0 ? 1 : -1;
	try {
		updateLabelPlacement(event.ctrlKey ? { fontSize: Math.max(8, Math.min(256, state.style.fontSize + direction)) }
			: { rotation: (state.rotation ?? 0) + direction * 15 });
	} catch (error) { disarmLabel(); reportError(error); }
}

/** Only native drag/click creation passes controlObject; paste, undo, imports, and our own Place Text do not. */
export function isInteractiveCreate(options = {}) {
	return typeof options.controlObject === 'boolean' && !options.isUndo && !options.keepId
		&& !options[PLACE_TEXT_OPTION];
}

export function onPreCreateDrawing(document, data, options, userId) {
	if (userId !== game.user.id || (state.mode !== 'next' && state.mode !== 'repeat')) return;
	if (!isInteractiveCreate(options)) return;
	if (typeof document.text === 'string' && document.text.trim()) return;
	document.updateSource({ text: state.text, ...state.style });
	pending.push({ text: state.text, style: structuredClone(state.style) });
}

export function onCreateDrawing(document, options, userId) {
	if (userId !== game.user.id) return;
	const index = pending.findIndex(entry => entry.text === document.text
		&& (!entry.style || Object.entries(entry.style).every(([key, value]) => String(document[key]) === String(value))));
	if (index < 0) return;
	const [entry] = pending.splice(index, 1);
	// Next Shape is consumed only once Foundry confirms the drawing exists.
	if (state.mode === 'next' && state.text === document.text
		&& JSON.stringify(state.style) === JSON.stringify(entry.style)) disarmLabel();
}

export function buildPlaceTextData(point, text, base = {}) {
	text = normalizeLabelText(text);
	const fontSize = Math.min(256, Math.max(8, Math.round(Number(base.fontSize) || 48)));
	const lines = text.split('\n');
	const longest = Math.max(...lines.map(line => line.length));
	const width = Math.max(fontSize, Math.ceil(longest * fontSize * 0.6)) + 16;
	const height = Math.ceil(lines.length * fontSize * 1.5);
	const data = {
		...base,
		x: Math.round(point.x - (width / 2)),
		y: Math.round(point.y - (height / 2)),
		shape: { type: 'r', width, height },
		text,
		fontSize,
			textAlpha: Number(base.textAlpha) > 0 ? base.textAlpha : 1,
		strokeWidth: 0,
		fillType: 0,
		texture: null,
		bezierFactor: 0,
	};
	delete data._id;
	if (data.flags?.foundryshop?.materialRepeat !== undefined) {
		data.flags = structuredClone(data.flags);
		delete data.flags.foundryshop.materialRepeat;
	}
	return data;
}

export async function placeTextAt(clientX, clientY, text = state.text) {
	const layer = canvas.drawings;
	if (!canvas.scene || !layer?.active) throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.NoLayer'));
	if (!game.user.can('DRAWING_CREATE')) throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.NoPermission'));
	const point = canvas.canvasCoordinatesFromClient({ x: clientX, y: clientY });
	if (placementTarget && !placementCurrent(placementTarget)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.NoLayer'));
	const data = buildPlaceTextData(point, text, { ...foundry.utils.deepClone(layer.paletteCreateData ?? {}), ...state.style,
		...(state.rotation !== undefined ? { rotation: state.rotation } : {}) });
	if (state.style?.textAlpha !== undefined) data.textAlpha = state.style.textAlpha;
	data.author = game.user.id;
	data.sort = Math.max(layer.getMaxSort() + 1, 0);
	const cls = getDocumentClass('Drawing');
	const result = await cls.create(cls.cleanData(data), { parent: canvas.scene, [PLACE_TEXT_OPTION]: true });
	if (!result) throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.PlacementRejected'));
	return result;
}

function reportError(error) {
	console.error('Foundryshop:', error);
	ui.notifications.error(game.i18n.format('FOUNDRYSHOP.Error', { message: error.message }));
}

export function onPlacePointerDown(event) {
	if (state.mode !== 'place' || event.button !== 0 || !event.isPrimary) return;
	if (!canvas.ready || !canvas.drawings?.active || event.target !== canvas.app?.view) return;
	// Swallow the tap before Foundry's canvas interaction manager starts a native drag or selection.
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();
	if (placing) return;
	const current = placementTarget;
	const epoch = ghostEpoch;
	placing = true;
	pendingWrites++;
	placeTextAt(event.clientX, event.clientY).then(() => {
		if (current && epoch === ghostEpoch) disarmLabel();
	}).catch(error => {
		if (epoch === ghostEpoch && (!current || !placementCurrent(current))) disarmLabel();
		reportError(error);
	}).finally(() => {
		pendingWrites--;
		if (epoch === ghostEpoch) placing = false;
	});
}

export function onPlaceKeyDown(event) {
	if (state.mode !== 'place' || event.key !== 'Escape') return;
	const target = event.target;
	if (!placementTarget && (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName))) return;
	event.preventDefault();
	event.stopPropagation();
	disarmLabel();
}

function onPlaceCancel() {
	if (state.mode === 'place') disarmLabel();
}

function syncListeners() {
	const target = globalThis.window;
	if (!target?.addEventListener) return;
	const wanted = state.mode === 'place';
	if (wanted === listening) return;
	const method = wanted ? 'addEventListener' : 'removeEventListener';
	target[method]('pointerdown', onPlacePointerDown, { capture: true });
	target[method]('keydown', onPlaceKeyDown, { capture: true });
	target[method]('pointermove', onLabelMove, { capture: true });
	target[method]('wheel', onLabelWheel, { capture: true, passive: false });
	target[method]('blur', onPlaceCancel);
	listening = wanted;
}

export function initLabelPlacement() {
	if (hookIds.length) return;
	hookIds = [
		['preCreateDrawing', Hooks.on('preCreateDrawing', onPreCreateDrawing)],
		['createDrawing', Hooks.on('createDrawing', onCreateDrawing)],
		['deactivateDrawingsLayer', Hooks.on('deactivateDrawingsLayer', () => disarmLabel())],
		['canvasTearDown', Hooks.on('canvasTearDown', () => disarmLabel())],
		['canvasReady', Hooks.on('canvasReady', () => disarmLabel())],
		['foundryshopStampChanged', Hooks.on('foundryshopStampChanged', stamp => { if (stamp.armed) disarmLabel(); })],
	];
}

/** Test helper: remove hooks/listeners and clear in-memory state. */
export function teardownLabelPlacement() {
	for (const [name, id] of hookIds) Hooks.off(name, id);
	hookIds = [];
	resetLabelState();
	pending = [];
	syncListeners();
}
