import { MODULE, SETTINGS_DRAWING_EDGE_PAN } from './constants.js';

const installed = new WeakSet();

export function isDrawingCreationDrag(canvas, event) {
	const preview = event?.interactionData?.preview;
	return canvas.activeLayer === canvas.drawings && !!canvas.drawings
		&& preview?.document?.documentName === 'Drawing'
		&& preview.previewType === 'creation' && !preview._destroyed;
}

/** Foundry calls edge pan before dispatching drag movement to the active layer. */
export function installDrawingNavigation(canvas) {
	if (installed.has(canvas)) return;
	const nativePan = canvas._onDragCanvasPan;
	if (typeof nativePan !== 'function') throw new Error('Foundry canvas edge-pan handler is unavailable.');
	canvas._onDragCanvasPan = function(event, ...args) {
		if (isDrawingCreationDrag(this, event) && !game.settings.get(MODULE, SETTINGS_DRAWING_EDGE_PAN)) return;
		return nativePan.call(this, event, ...args);
	};
	installed.add(canvas);
}

export function initDrawingNavigation() {
	Hooks.on('canvasReady', canvas => {
		try {
			installDrawingNavigation(canvas);
		} catch (error) {
			console.error('Foundryshop drawing navigation:', error);
			ui.notifications.error(game.i18n.format('FOUNDRYSHOP.Error', { message: error.message }));
		}
	});
}
