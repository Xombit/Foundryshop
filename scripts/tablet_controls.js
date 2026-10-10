import { MODULE } from './constants.js';
import { disarmLabel, isLabelPlacementPending } from './label_placement.js';
import { cancelStamp, getStampState } from './artwork_stamps.js';

export const TABLET_ACTIONS = [
	{ id: 'drawFreehand', control: 'drawings', tool: 'freehand', name: 'FOUNDRYSHOP.Tablet.Freehand' },
	{ id: 'selectTokens', control: 'tokens', tool: 'select', name: 'FOUNDRYSHOP.Tablet.Tokens' },
];

const loc = key => game.i18n.localize(`FOUNDRYSHOP.Tablet.${key}`);
let switching = false;
const pointers = new Set();
let stopTracking = null;

function report(error) {
	console.error('Foundryshop tablet controls:', error);
	ui.notifications.error(game.i18n.format('FOUNDRYSHOP.Error', { message: error.message }));
}

function hasEditableFocus() {
	const focused = globalThis.document?.activeElement;
	return game.keyboard?.hasFocus || focused?.isContentEditable
		|| ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused?.tagName);
}

function requireAvailable(action) {
	if (!game.user?.isGM || !canvas.ready || !canvas.scene
		|| (action.control === 'drawings' && !game.user.can('DRAWING_CREATE'))) {
		throw new Error(loc('Unavailable'));
	}
	const control = ui.controls?.controls?.[action.control];
	if (!control || control.visible === false || !control.tools?.[action.tool]
		|| control.tools[action.tool].visible === false) throw new Error(loc('Unavailable'));
	if (pointers.size || canvas.currentMouseManager?.isDragging || canvas.mouseInteractionManager?.isDragging
		|| getStampState().busy || isLabelPlacementPending()) throw new Error(loc('Gesture'));
}

export async function activateTabletTool(id) {
	const action = TABLET_ACTIONS.find(entry => entry.id === id);
	if (!action) throw new Error(loc('Unavailable'));
	if (switching) throw new Error(loc('Busy'));
	requireAvailable(action);
	const scene = canvas.scene;
	switching = true;
	try {
		disarmLabel();
		cancelStamp();
		await ui.controls.activate({ control: action.control, tool: action.tool });
		if (!canvas.ready || canvas.scene !== scene || !game.user.isGM
			|| (action.control === 'drawings' && !game.user.can('DRAWING_CREATE'))
			|| ui.controls.control?.name !== action.control || game.activeTool !== action.tool) {
			throw new Error(loc('Changed'));
		}
	} finally {
		switching = false;
	}
}

export function registerTabletKeybindings() {
	for (const action of TABLET_ACTIONS) game.keybindings.register(MODULE, action.id, {
		name: action.name,
		hint: 'FOUNDRYSHOP.Tablet.BindingHint',
		editable: [],
		restricted: true,
		repeat: false,
		precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
		onDown: () => {
			if (hasEditableFocus()) return false;
			activateTabletTool(action.id).catch(report);
			return true;
		},
	});
}

export function initTabletControls() {
	const stop = () => { stopTracking?.(); stopTracking = null; };
	Hooks.on('canvasTearDown', stop);
	Hooks.on('canvasReady', () => {
		stop();
		const down = event => { if (event.target === canvas.app?.view) pointers.add(event.pointerId); };
		const up = event => pointers.delete(event.pointerId);
		const clear = () => pointers.clear();
		window.addEventListener('pointerdown', down, true);
		window.addEventListener('pointerup', up, true);
		window.addEventListener('pointercancel', up, true);
		window.addEventListener('blur', clear);
		stopTracking = () => {
			window.removeEventListener('pointerdown', down, true);
			window.removeEventListener('pointerup', up, true);
			window.removeEventListener('pointercancel', up, true);
			window.removeEventListener('blur', clear);
			clear();
		};
	});
}

export function tabletBindingLabel(id) {
	if (!game.keybindings.actions.has(`${MODULE}.${id}`)) return loc('Reload');
	const bindings = game.keybindings.get(MODULE, id);
	if (!bindings.length) return loc('Unbound');
	const display = key => foundry.helpers.interaction.KeyboardManager.getKeycodeDisplayString(key);
	return bindings.map(binding => [...(binding.modifiers ?? []).map(display), display(binding.key)].join(' + ')).join(' / ');
}

export function openTabletBindings() {
	return new foundry.applications.sidebar.apps.ControlsConfig().render({ force: true });
}

/** Capture only while the deliberately focused test field is active. */
export function bindTabletKeyTest(input, output) {
	let stopCapture = null;
	const stop = () => { stopCapture?.(); stopCapture = null; };
	const focus = () => {
		stop();
		output.textContent = loc('TestReady');
		const capture = event => {
			if (event.key === 'Tab') return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (event.key === 'Escape') { input.blur(); return; }
			if (event.type === 'keyup') return;
			output.textContent = game.i18n.format('FOUNDRYSHOP.Tablet.TestResult', {
				key: event.key, code: event.code || loc('NoCode'),
				modifiers: ['ctrlKey', 'shiftKey', 'altKey', 'metaKey']
					.filter(key => event[key]).map(key => key.slice(0, -3)).join(' + ') || loc('NoModifiers'),
			});
		};
		window.addEventListener('keydown', capture, true);
		window.addEventListener('keyup', capture, true);
		window.addEventListener('blur', stop);
		stopCapture = () => {
			window.removeEventListener('keydown', capture, true);
			window.removeEventListener('keyup', capture, true);
			window.removeEventListener('blur', stop);
		};
	};
	input.addEventListener('focus', focus);
	input.addEventListener('blur', stop);
	return () => {
		stop();
		input.removeEventListener('focus', focus);
		input.removeEventListener('blur', stop);
	};
}
