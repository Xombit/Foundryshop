import { MODULE, SETTINGS_TOOLBOX_AUTO_SHOW, SETTINGS_TOOLBOX_DENSITY, SETTINGS_TOOLBOX_THEME, SETTINGS_TOOLBOX_SCALE, SETTINGS_TOOLBOX_STATE,
	SETTINGS_RECENT_COLORS, SETTINGS_RECENT_COLOR_HISTORY, SETTINGS_DRAWING_EDGE_PAN } from './constants.js';
import { drawingSettingKey, readDrawingConfig, updateDrawingConfig } from './drawing_config.js';
import { PATH_CHANGED, getPathState, configurePath, armPath, cancelPath, finishPath, rerollPath } from './path_placement.js';
import { PATH_EDITOR_CHANGED, selectedRetainedPath, getPathEditorState, beginPathEdit, cancelPathEdit,
	applyPathEdit, selectWholePath, selectPathWaypoint, setPathWaypoint, deletePathWaypoint, togglePathInsertion,
	setPathPointMode, setPathHandle, configurePathEdit, rerollPathEdit, translatePathEdit, undoPathDraft } from './path_editor.js';
import { duplicateRetainedPath, deleteRetainedPath, detachRetainedPath, undoRetainedPath, redoRetainedPath } from './path_transactions.js';
import { inspectPathIntegrity } from './path_store.js';
import { getPathHistoryState, PATH_HISTORY_CHANGED } from './path_history.js';
import { pathConflictSnapshot, readPathRegistry } from './path_store.js';
import { detachConflictingPath } from './path_transactions.js';
import { PATH_STYLES, pathOptions } from './path_geometry.js';
import { readPathPresets, pathPresetPatch, savePathPreset, deletePathPreset, MAX_PATH_PRESET_NAME } from './path_presets.js';
import { PALETTE_CHANGED, readPalette, canEditPalette, saveColor, editColor, deleteColor, importPresetColors } from './saved_colors.js';
import {
	LABELS_CHANGED, MAX_LABEL_NAME_LENGTH, MAX_LABEL_TEXT_LENGTH,
	readLabelBank, canEditLabelBank, saveLabel, editLabel, deleteLabel, addStarterLabels, normalizeLabelText, ensureStarterLabels,
} from './label_banks.js';
import { LABEL_STATE_CHANGED, getLabelState, armLabel, disarmLabel, armLabelPlacement, updateLabelPlacement } from './label_placement.js';
import { isDrawingLayerLocked } from './layers/layer_manager.js';
import {
	readSharedPalettes, createSharedPalette, adoptSavedPalette, renameSharedPalette, duplicateSharedPalette,
	removeSharedPalette, moveSharedPalette, saveSharedColor, editSharedColor, removeSharedColor, moveSharedColor, importSharedColors,
	effectivePalettes, builtinSharedId, resetBuiltinPalette,
	saveSharedAppearance,
} from './shared_palettes.js';
import {
	STAMP_CHANGED, STAMP_FOLDER, getStampState, copySelectedStamp, armCopiedStamp,
	cancelStamp, importImageStamp, pasteImageStamp, validateAssetFolder, loadShapeStamp, copiedStampSnapshot,
} from './artwork_stamps.js';
import { layerArtworkSnapshot, renderArtworkPreview, clearArtworkPreviewCache } from './artwork_renderer.js';
import { TOOLBOX_THEMES, TOOLBOX_SCALE, validateToolboxScale, resolveToolboxTheme, flyoutPosition } from './toolbox_appearance.js';
import { suggestedColorName } from './color_names.js';
import { LIBRARY_FOLDER, LIBRARY_CHANGED, validateLibraryFolder, indexProjectLibrary, searchProjectLibrary, readLibraryProject,
	readLibraryShape } from './project_library.js';
import { promptLibrarySave } from './library_save.js';
import { promptLibraryManagement } from './library_management.js';
import { promptArtworkPublication } from './artwork_publication.js';
import { promptProjectImport, downloadDrawingProject } from './layers/project_dialogs.js';
import { readLayerTree } from './layers/layer_manager.js';
import { BUILTIN_PALETTES, DEFAULT_BUILTIN_PALETTE } from './builtin_palettes.js';
import { starterShapes, starterShape } from './starter_shapes.js';
import { starterProjects, starterProject } from './starter_projects.js';
import { verifyLocalMaterial } from './texture_materials.js';
import { STARTER_MATERIALS, starterMaterials } from './starter_materials.js';
import { prepareMaterialSelection, applyMaterialSelection } from './material_selection.js';
import { normalizeLabelStyle } from './label_styles.js';
import { TABLET_ACTIONS, tabletBindingLabel, openTabletBindings, bindTabletKeyTest } from './tablet_controls.js';
import { APPEARANCE_CHANGED, getAppearanceOverride, clearAppearanceOverride } from './appearance_state.js';
import { applyAppearance, verifyAppearance } from './appearance_swatches.js';
import { promptAppearance, appearanceSample } from './appearance_editor.js';
import { readBrushPresets, matchingPresetId, presetApplyPatch, saveBrushPreset, deleteBrushPreset,
	MAX_BRUSH_PRESET_NAME } from './brush_presets.js';

const { ApplicationV2 } = foundry.applications.api;

export const TOOLBOX_TOOLS = ['select', 'rect', 'ellipse', 'polygon', 'freehand', 'text'];
export const TOOLBOX_TABS = ['brush', 'layers', 'presentation', 'palettes', 'labels', 'library', 'settings'];
const TAB_ICONS = {
	brush: 'fas fa-paintbrush', layers: 'fas fa-layer-group', presentation: 'fas fa-eye',
	palettes: 'fas fa-palette', labels: 'fas fa-tags', library: 'fas fa-book-open', settings: 'fas fa-gears',
};
/** Top-level panels shown in the tab strip; each owns one or more internal tabs shown as a sub-switch. */
export const TOOLBOX_GROUPS = [
	{ id: 'brush', icon: 'fas fa-paintbrush', tabs: ['brush'] },
	{ id: 'palettes', icon: 'fas fa-palette', tabs: ['palettes'] },
	{ id: 'layers', icon: 'fas fa-layer-group', tabs: ['layers', 'presentation'] },
	{ id: 'assets', icon: 'fas fa-shapes', tabs: ['library', 'labels'] },
];
const GM_ONLY_TABS = ['layers', 'presentation', 'library'];
const groupOf = tab => TOOLBOX_GROUPS.find(group => group.tabs.includes(tab));
const FALLBACK_ICONS = {
	select: 'fa-solid fa-expand', rect: 'fa-solid fa-square', ellipse: 'fa-solid fa-circle',
	polygon: 'fa-solid fa-draw-polygon', freehand: 'fa-solid fa-signature', text: 'fa-solid fa-font',
};
const DENSITIES = ['compact', 'comfortable', 'tablet'];
export const QUICK_WIDTHS = [2, 4, 8, 16, 32];
const MAX_RECENT_SWATCHES = 8;

function toHex(value) {
	if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
	if (typeof value === 'number') return `#${value.toString(16).padStart(6, '0')}`;
	if (value?.css) return String(value.css).slice(0, 7).toLowerCase();
	return '#000000';
}

function contrastText(hex) {
	const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#000000' : '#ffffff';
}

// Foundry themes style buttons through CSS variables, so color buttons set both the variables and our own.
const colorStyle = color => ({
	'--by-tb-color': color, '--by-tb-color-text': contrastText(color),
	'--button-background-color': color, '--button-hover-background-color': color, backgroundColor: color,
});

function el(tag, attrs = {}, children = []) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (value === undefined || value === null || value === false) continue;
		if (key === 'text') node.textContent = value;
		else if (key === 'dataset') Object.assign(node.dataset, value);
		else if (key === 'style') {
			for (const [prop, val] of Object.entries(value)) {
				if (prop.startsWith('--')) node.style.setProperty(prop, val);
				else node.style[prop] = val;
			}
		}
		else if (key === 'className') node.className = value;
		else if (key === 'title') {
			// Foundry tooltips replace native titles; the text variant never interprets HTML.
			node.setAttribute('data-tooltip-text', String(value));
			if (!('aria-label' in attrs) && !['p', 'span', 'strong'].includes(tag)) node.setAttribute('aria-label', String(value));
		}
		else node.setAttribute(key, value === true ? '' : String(value));
	}
	for (const child of [children].flat()) if (child) node.append(child);
	return node;
}

/** Collapsed built-in help: tooltip on hover, expandable text on tap. */
function help(text) {
	return el('details', { className: 'fshop-tb-help' }, [
		el('summary', { className: 'fshop-tb-help-toggle', 'aria-label': loc('Help'), 'data-tooltip-text': text },
			[el('i', { className: 'fas fa-circle-question', 'aria-hidden': 'true' }), el('span', { text: loc('Help') })]),
		el('p', { className: 'fshop-tb-hint', text }),
	]);
}

function iconButton(action, icon, title, { dataset = {}, pressed, disabled, className = '', text } = {}) {
	const button = el('button', {
		type: 'button', className: `fshop-tb-button ${className}`.trim(), title, 'aria-label': title,
		dataset: { action, ...dataset }, disabled: disabled || undefined,
		'aria-pressed': pressed === undefined ? undefined : String(!!pressed),
	}, [icon ? el('i', { className: icon, 'aria-hidden': 'true' }) : null, text ? el('span', { text }) : null]);
	return button;
}

const loc = key => game.i18n.localize(`FOUNDRYSHOP.Toolbox.${key}`);

export class Drawing_Toolbox extends ApplicationV2 {
	/** @type {Drawing_Toolbox|null} */
	static _instance = null;
	/** Closed by the user during the current Drawings-layer activation. */
	static _suppressed = false;
	static _opening = null;

	static DEFAULT_OPTIONS = {
		id: 'foundryshop-toolbox',
		classes: ['fshop-toolbox'],
		window: {
			title: 'FOUNDRYSHOP.Toolbox.Title',
			icon: 'fas fa-toolbox',
			resizable: false,
			minimizable: false,
		},
		position: { width: 'auto', height: 'auto' },
		actions: {
			materialChoose: Drawing_Toolbox.#onMaterialAction,
			materialClear: Drawing_Toolbox.#onMaterialAction,
			materialBrowse: Drawing_Toolbox.#onMaterialAction,
			materialSelect: Drawing_Toolbox.#onMaterialAction,
			materialApplySelection: Drawing_Toolbox.#onApplyMaterialSelection,
			starterPlace: Drawing_Toolbox.#onStarterPlace,
			paletteManage: Drawing_Toolbox.#onPaletteManage,
			paletteReset: Drawing_Toolbox.#onSharedPalette,
			libraryRefresh: Drawing_Toolbox.#onLibraryAction,
			libraryImport: Drawing_Toolbox.#onLibraryAction,
			libraryPlace: Drawing_Toolbox.#onLibraryAction,
			librarySaveShape: Drawing_Toolbox.#onLibrarySave,
			librarySaveProject: Drawing_Toolbox.#onLibrarySave,
			libraryManage: Drawing_Toolbox.#onLibraryManage,
			libraryEdit: Drawing_Toolbox.#onLibraryManagement,
			libraryDuplicate: Drawing_Toolbox.#onLibraryManagement,
			libraryRepair: Drawing_Toolbox.#onLibraryManagement,
			libraryRemove: Drawing_Toolbox.#onLibraryManagement,
			libraryRestore: Drawing_Toolbox.#onLibraryManagement,
			libraryRemoved: Drawing_Toolbox.#onLibraryRemoved,
			artworkPublish: Drawing_Toolbox.#onArtworkPublish,
			artworkSvg: Drawing_Toolbox.#onArtworkPublish,
			starterProjectDownload: Drawing_Toolbox.#onStarterProject,
			scalePreset: Drawing_Toolbox.#onScalePreset,
			tabletBindings: Drawing_Toolbox.#onTabletBindings,
			pairCreate: Drawing_Toolbox.#onPairAction,
			pairEdit: Drawing_Toolbox.#onPairAction,
			pairDuplicate: Drawing_Toolbox.#onPairAction,
			pairReturn: Drawing_Toolbox.#onPairReturn,
			refreshPreviews: Drawing_Toolbox.#onRefreshPreviews,
			fullLayers: Drawing_Toolbox.#onFullLayers,
			stampCopy: Drawing_Toolbox.#onStampAction,
			stampImage: Drawing_Toolbox.#onStampAction,
			stampPaste: Drawing_Toolbox.#onStampAction,
			stampArm: Drawing_Toolbox.#onStampAction,
			stampCancel: Drawing_Toolbox.#onStampAction,
			sharedCreate: Drawing_Toolbox.#onSharedPalette,
			sharedRename: Drawing_Toolbox.#onSharedPalette,
			sharedDuplicate: Drawing_Toolbox.#onSharedPalette,
			sharedDelete: Drawing_Toolbox.#onSharedPalette,
			sharedMove: Drawing_Toolbox.#onSharedPalette,
			sharedAdopt: Drawing_Toolbox.#onSharedPalette,
			sharedColorMove: Drawing_Toolbox.#onSharedPalette,
			paletteSave: Drawing_Toolbox.#onPaletteAction,
			paletteEdit: Drawing_Toolbox.#onPaletteAction,
			paletteDelete: Drawing_Toolbox.#onPaletteAction,
			paletteImport: Drawing_Toolbox.#onPaletteAction,
			layerAction: Drawing_Toolbox.onLayerAction,
			toolboxTab: Drawing_Toolbox.#onTab,
			toolboxPanel: Drawing_Toolbox.#onPanel,
			toolboxSettings: Drawing_Toolbox.#onSettings,
			recentColor: Drawing_Toolbox.#onRecentColor,
			layers: Drawing_Toolbox.#onLayers,
			tool: Drawing_Toolbox.#onTool,
			pathArm: Drawing_Toolbox.#onPathArm,
			pathFinish: Drawing_Toolbox.#onPathFinish,
			pathCancel: Drawing_Toolbox.#onPathCancel,
			target: Drawing_Toolbox.#onTarget,
			swap: Drawing_Toolbox.#onSwap,
			noFill: Drawing_Toolbox.#onNoFill,
			width: Drawing_Toolbox.#onWidth,
			widthSet: Drawing_Toolbox.#onWidthSet,
			brushPresetSave: Drawing_Toolbox.#onBrushPresetSave,
			brushPresetDelete: Drawing_Toolbox.#onBrushPresetDelete,
			useColor: Drawing_Toolbox.#onUseColor,
			moreColors: Drawing_Toolbox.#onMoreColors,
			collapse: Drawing_Toolbox.#onCollapse,
			labelArm: Drawing_Toolbox.#onLabelArm,
			labelDraftUse: Drawing_Toolbox.#onLabelDraftAction,
			labelDraftSave: Drawing_Toolbox.#onLabelDraftAction,
			labelDraftApply: Drawing_Toolbox.#onLabelDraftAction,
			labelSize: Drawing_Toolbox.#onLabelSize,
			labelMode: Drawing_Toolbox.#onLabelMode,
			railLabel: Drawing_Toolbox.#onRailLabel,
			railStamp: Drawing_Toolbox.#onRailStamp,
			labelCustom: Drawing_Toolbox.#onLabelCustom,
			labelManage: Drawing_Toolbox.#onLabelManage,
			labelAdd: Drawing_Toolbox.#onLabelBankAction,
			labelEdit: Drawing_Toolbox.#onLabelBankAction,
			labelDelete: Drawing_Toolbox.#onLabelBankAction,
			labelStarters: Drawing_Toolbox.#onLabelBankAction,
			selectionEdit: Drawing_Toolbox.#onSelectionAction,
			selectionApply: Drawing_Toolbox.#onSelectionAction,
			selectionClear: Drawing_Toolbox.#onSelectionAction,
			pathEdit: Drawing_Toolbox.#onPathEditorAction, pathSelectWhole: Drawing_Toolbox.#onPathEditorAction,
			pathEditApply: Drawing_Toolbox.#onPathEditorAction, pathEditCancel: Drawing_Toolbox.#onPathEditorAction,
			pathPointDelete: Drawing_Toolbox.#onPathEditorAction, pathPointInsert: Drawing_Toolbox.#onPathEditorAction,
			pathDraftUndo: Drawing_Toolbox.#onPathEditorAction, pathDraftRedo: Drawing_Toolbox.#onPathEditorAction,
			pathTranslate: Drawing_Toolbox.#onWholePathAction, pathDuplicate: Drawing_Toolbox.#onWholePathAction,
			pathConflict: Drawing_Toolbox.#onWholePathAction,
			pathDeleteWhole: Drawing_Toolbox.#onWholePathAction, pathDetach: Drawing_Toolbox.#onWholePathAction,
			pathUndo: Drawing_Toolbox.#onWholePathAction, pathRedo: Drawing_Toolbox.#onWholePathAction,
			pathReroll: Drawing_Toolbox.#onPathAppearanceAction,
			pathPresetSave: Drawing_Toolbox.#onPathAppearanceAction, pathPresetDelete: Drawing_Toolbox.#onPathAppearanceAction,
		},
	};

	/** Opens the detailed panel; injected by setup to avoid a circular import. */
	static openDetailedPanel = null;
	static openLayersPanel = null;
	static createLayerPanel = null;
	static async onLayerAction(event, target) {
		if (!this._layerPanel) return Drawing_Toolbox.reportError(new Error('Layer controls are unavailable.'));
		return this._layerPanel.action(event, { dataset: { ...target.dataset, action: target.dataset.layerAction } });
	}

	static async openTab(tab) {
		if (!TOOLBOX_TABS.includes(tab)) throw new Error('Invalid toolbox tab.');
		if (!game.user.isGM) throw new Error(game.i18n.localize('FOUNDRYSHOP.Layers.GMOnly'));
		if (canvas?.ready && !canvas.drawings?.active) await ui.controls.activate({ control: 'drawings' });
		if (!Drawing_Toolbox.canShow()) throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.NoLayer'));
		Drawing_Toolbox._suppressed = false;
		await Drawing_Toolbox.show();
		const app = Drawing_Toolbox._instance;
		if (!app) throw new Error('Drawing Toolbox could not open.');
		app._tab = tab;
		app._layerFlyout = false;
		app._collapsed = false;
		app.#saveState();
		await app.render();
		return app;
	}

	static reportError(error) {
		console.error('Foundryshop:', error);
		ui.notifications.error(game.i18n.format('FOUNDRYSHOP.Error', { message: error.message }));
	}

	static init() {
		Hooks.on('activateDrawingsLayer', () => {
			Drawing_Toolbox._suppressed = false;
			Drawing_Toolbox.autoShow();
		});
		Hooks.on('canvasReady', () => { if (canvas.drawings?.active) Drawing_Toolbox.autoShow(); });
		Hooks.on('deactivateDrawingsLayer', () => Drawing_Toolbox.hide());
		Hooks.on('canvasTearDown', () => Drawing_Toolbox.hide());
		Hooks.on('getSceneControlButtons', controls => Drawing_Toolbox.#addControlButton(controls));
		const refresh = () => Drawing_Toolbox._instance?.requestRefresh();
		Hooks.on(LIBRARY_CHANGED, () => {
			const app = Drawing_Toolbox._instance;
			if (app) app._libraryEntries = undefined;
			refresh();
		});
		for (const hook of ['activateSceneControls', 'controlDrawing', 'updateDrawing', 'deleteDrawing',
			PALETTE_CHANGED, APPEARANCE_CHANGED, LABELS_CHANGED, STAMP_CHANGED, PATH_CHANGED, PATH_EDITOR_CHANGED,
			PATH_HISTORY_CHANGED, 'foundryshopPathPresetsChanged', 'foundryshopLayersChanged', 'updateUser']) {
			Hooks.on(hook, refresh);
		}
		Hooks.on(LABEL_STATE_CHANGED, state => {
			const app = Drawing_Toolbox._instance;
			if (state.mode === 'place' && state.style && app?._labelDraft) {
				app._labelDraft.style.fontSize = state.style.fontSize;
				const input = app.element.querySelector('[data-label-draft="fontSize"]');
				if (input) input.value = String(state.style.fontSize);
				const preview = app.element.querySelector('[data-label-draft="text"]');
				if (preview) preview.style.fontSize = `${state.style.fontSize}px`;
				const rotation = app.element.querySelector('[data-label-rotation]');
				if (rotation) rotation.value = String(state.rotation ?? 0);
			}
			refresh();
		});
		Hooks.on('clientSettingChanged', (key, value, options = {}) => {
			if (key === 'core.keybindings'
				|| key === `core.${drawingSettingKey()}` && options.foundryshopSource !== 'toolbox') refresh();
		});
	}

	static #addControlButton(controls) {
		if (!game.user.isGM || !controls.drawings?.tools) return;
		controls.drawings.tools['foundryshop-toolbox'] = {
			name: 'foundryshop-toolbox',
			icon: 'fas fa-toolbox',
			title: 'FOUNDRYSHOP.Toolbox.Toggle',
			order: Math.max(-1, ...Object.values(controls.drawings.tools).map(tool => tool.order ?? -1)) + 1,
			onChange: () => Drawing_Toolbox.toggle(),
			button: true,
		};
	}

	static canShow() {
		return !!(game.user?.isGM && canvas?.ready && canvas.drawings?.active && game.user.can('DRAWING_CREATE'));
	}

	static autoShow() {
		if (Drawing_Toolbox._suppressed || !game.settings.get(MODULE, SETTINGS_TOOLBOX_AUTO_SHOW)) return;
		if (Drawing_Toolbox.canShow()) Drawing_Toolbox.show();
	}

	static async show() {
		if (!Drawing_Toolbox.canShow()) throw new Error(game.i18n.localize('FOUNDRYSHOP.Layers.GMOnly'));
		if (Drawing_Toolbox._instance?.rendered) return Drawing_Toolbox._instance;
		if (Drawing_Toolbox._opening) return Drawing_Toolbox._opening;
		const app = Drawing_Toolbox._instance ??= new Drawing_Toolbox();
		const saved = game.settings.get(MODULE, SETTINGS_TOOLBOX_STATE) ?? {};
		Drawing_Toolbox._opening = app.render({
			force: true,
			...(Number.isFinite(saved.left) && Number.isFinite(saved.top)
				? { position: { left: saved.left, top: saved.top } } : {}),
		}).catch(error => {
			if (!app.rendered && Drawing_Toolbox._instance === app) Drawing_Toolbox._instance = null;
			Drawing_Toolbox.reportError(error);
		}).finally(() => { Drawing_Toolbox._opening = null; });
		return Drawing_Toolbox._opening;
	}

	/** Programmatic hide (layer change, teardown); does not count as the user dismissing it. */
	static async hide() {
		await Drawing_Toolbox._opening;
		const app = Drawing_Toolbox._instance;
		if (app?.rendered) await app.close({ foundryshopHide: true });
	}

	static async toggle() {
		if (Drawing_Toolbox._instance?.rendered) return Drawing_Toolbox._instance.close();
		Drawing_Toolbox._suppressed = false;
		if (canvas?.ready && !canvas.drawings?.active) await ui.controls.activate({ control: 'drawings' });
		if (!Drawing_Toolbox.canShow()) {
			ui.notifications.warn(game.i18n.localize('FOUNDRYSHOP.Labels.NoLayer'));
			return;
		}
		return Drawing_Toolbox.show();
	}

	constructor(options = {}) {
		super(options);
		this._target = 'stroke';
		this._paletteScope = 'personal';
		this._labelScope = 'personal';
		this._manage = false;
		this._busy = false;
		this._refreshQueued = false;
		this._pendingWrites = new Set();
		this._stampOptions = { scale: 1, rotation: 0, repeat: false };
		const saved = game.settings.get(MODULE, SETTINGS_TOOLBOX_STATE) ?? {};
		const previousBuiltin = BUILTIN_PALETTES.some(palette => palette.id === saved.builtinPalette)
			? saved.builtinPalette : DEFAULT_BUILTIN_PALETTE;
		this._selectedPalette = typeof saved.selectedPalette === 'string' ? saved.selectedPalette : builtinSharedId(previousBuiltin);
		this._paletteManage = false;
		this._materialExpanded = false;
		this._materialQuery = '';
		this._collapsed = !!saved.collapsed;
		this._tab = TOOLBOX_TABS.includes(saved.tab) ? saved.tab : 'brush';
		this._layerPanel = Drawing_Toolbox.createLayerPanel?.(this);
		this._scrollPositions = new Map();
		this._layerFlyout = false;
		this._flyoutScroll = 0;
		this._flyoutAnchor = null;
		this._positionFlyout = () => this.#positionFlyout();
		this._dismissFlyout = event => {
			if (this._closing || !this._layerFlyout || this.element.contains?.(event.target)) return;
			this._layerFlyout = false;
			this.render().catch(Drawing_Toolbox.reportError);
		};
		this._escapeFlyout = event => {
			if (this._closing || !this._layerFlyout || event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			this._layerFlyout = false;
			this.render().catch(Drawing_Toolbox.reportError);
		};
	}

	/** Coalesce bursts of hook refreshes (e.g. multi-select) into one render. */
	requestRefresh() {
		const stamp = getStampState();
		if (stamp.armed) Object.assign(this._stampOptions, { scale: stamp.scale, rotation: stamp.rotation });
		if (this._closing || !this.rendered || this._refreshQueued) return;
		if (!game.user.isGM) {
			this.close({ foundryshopHide: true }).catch(Drawing_Toolbox.reportError);
			return;
		}
		const focused = document.activeElement;
		if (focused && this.element.contains?.(focused) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName)) {
			this._refreshAfterEdit = true;
			return;
		}
		this._refreshQueued = true;
		queueMicrotask(() => {
			this._refreshQueued = false;
			if (!this._closing && this.rendered) {
				if (!game.user.isGM) this.close({ foundryshopHide: true }).catch(Drawing_Toolbox.reportError);
				else this.render().catch(Drawing_Toolbox.reportError);
			}
		});
	}

	async _prepareContext() {
		if (this._tab === 'labels') await ensureStarterLabels(this._labelScope);
		const config = readDrawingConfig();
		const controlled = canvas.drawings?.controlled ?? [];
		let colors = [];
		let labels = [];
		const sharedPalettes = readSharedPalettes();
		const errors = [];
		try { colors = readPalette(this._paletteScope).colors; } catch (error) { errors.push(error); }
		try { labels = readLabelBank(this._labelScope).labels; } catch (error) { errors.push(error); }
		for (const error of errors) console.error('Foundryshop:', error);
		const nativeTools = ui.controls?.controls?.drawings?.tools ?? {};
		let retainedPath = null, pathSelectionError = null;
		try { retainedPath = selectedRetainedPath(canvas.scene, controlled); }
		catch (error) { pathSelectionError = error.message; }
		return {
			retainedPath, pathSelectionError,
			config,
			stroke: toHex(config.strokeColor),
			fill: toHex(config.fillColor),
			activeTool: ui.controls?.control?.name === 'drawings' ? game.activeTool : null,
			nativeTools,
			colors,
			sharedPalettes,
			labels,
			labelState: getLabelState(),
			stampState: getStampState(),
			canEditLabels: canEditLabelBank(this._labelScope),
			selection: controlled.length === 1 ? controlled[0].document : null,
			selectionCount: controlled.length,
			density: DENSITIES.includes(game.settings.get(MODULE, SETTINGS_TOOLBOX_DENSITY))
				? game.settings.get(MODULE, SETTINGS_TOOLBOX_DENSITY) : 'tablet',
			theme: resolveToolboxTheme(game.settings.get(MODULE, SETTINGS_TOOLBOX_THEME)),
			scale: validateToolboxScale(game.settings.get(MODULE, SETTINGS_TOOLBOX_SCALE) ?? TOOLBOX_SCALE.default),
		};
	}

	async _renderHTML(context) {
		const root = el('div', { className: `fshop-tb fshop-tb-${context.density}${this._collapsed ? ' fshop-tb-collapsed' : ''}` });
		root.append(this.#renderTools(context));
		if (this._layerFlyout && game.user.isGM) {
			try { root.append(await this.#renderLayerFlyout()); }
			catch (error) { this._layerFlyout = false; console.warn('Foundryshop:', error); }
		}
		root.append(this.#renderStyle(context, true));
		if (context.selectionCount) root.append(this.#renderSelection(context));
		const history = getPathHistoryState(canvas.scene), editor = getPathEditorState();
		if (game.user.isGM && (history.undo || history.redo)) root.append(el('div', { className: 'fshop-tb-row', role: 'toolbar',
			'aria-label': game.i18n.localize('FOUNDRYSHOP.Paths.HistoryHelp') }, [
			iconButton('pathUndo', 'fas fa-rotate-left', game.i18n.localize('FOUNDRYSHOP.Paths.Undo'),
				{ text: game.i18n.localize('FOUNDRYSHOP.Paths.Undo'), disabled: !history.undo || history.busy || editor.active || this._busy }),
			iconButton('pathRedo', 'fas fa-rotate-right', game.i18n.localize('FOUNDRYSHOP.Paths.Redo'),
				{ text: game.i18n.localize('FOUNDRYSHOP.Paths.Redo'), disabled: !history.redo || history.busy || editor.active || this._busy }),
			help(game.i18n.localize('FOUNDRYSHOP.Paths.HistoryHelp')),
		]));
		if (getPathEditorState().active) root.append(this.#renderPathEditor());
		const appearance = getAppearanceOverride();
		if (appearance) root.append(el('div', { className: 'fshop-tb-row' }, [
			el('span', { text: game.i18n.format('FOUNDRYSHOP.Pairs.Active', {
				name: appearance.name + (appearance.modified ? ` (${game.i18n.localize('FOUNDRYSHOP.Pairs.Modified')})` : ''),
			}), role: 'status' }),
			iconButton('pairReturn', 'fas fa-rotate-left', game.i18n.localize('FOUNDRYSHOP.Pairs.Return')),
		]));
		const stampState = getStampState();
		if (stampState.armed) root.append(el('div', { className: 'fshop-tb-row' }, [
			el('span', { className: 'fshop-tb-armed',
				text: `${game.i18n.localize(`FOUNDRYSHOP.Stamps.${stampState.repeat ? 'RepeatMode' : 'PlaceMode'}`)}: ${stampState.armed}`,
				title: game.i18n.localize(`FOUNDRYSHOP.Stamps.${stampState.repeat ? 'Repeat' : 'Place'}`) }),
			iconButton('stampCancel', 'fas fa-xmark', game.i18n.localize('FOUNDRYSHOP.Stamps.Cancel')),
		]));
		if (this._collapsed && context.labelState.mode !== 'off') {
			const { mode, text } = context.labelState;
			root.append(el('div', { className: 'fshop-tb-row' }, [
				el('span', { className: 'fshop-tb-armed', text: `${loc(`Mode.${mode}`)}: ${text}` }),
				iconButton('labelMode', 'fas fa-xmark', loc('Mode.off'), { dataset: { mode: 'off' } }),
			]));
		}
		if (!this._collapsed) {
			const tabs = el('nav', { className: 'fshop-tb-tabs', role: 'tablist', 'aria-label': loc('Tabs') });
			const tab = !game.user.isGM && GM_ONLY_TABS.includes(this._tab) ? 'brush' : this._tab;
			const visible = name => game.user.isGM || !GM_ONLY_TABS.includes(name);
			const current = groupOf(tab);
			if (current) (this._groupTabs ??= {})[current.id] = tab;
			for (const group of TOOLBOX_GROUPS) {
				const members = group.tabs.filter(visible);
				if (!members.length) continue;
				const selected = current === group;
				const target = selected ? tab : members.includes(this._groupTabs?.[group.id]) ? this._groupTabs[group.id] : members[0];
				tabs.append(el('button', { type: 'button', role: 'tab', id: `fshop-tab-${group.id}`,
					'aria-selected': String(selected), 'aria-controls': 'fshop-tab-body',
					tabindex: selected || (!current && group === TOOLBOX_GROUPS[0]) ? 0 : -1,
					title: loc(`Group.${group.id}`),
					dataset: { action: 'toolboxTab', tab: target, group: group.id } },
				[el('i', { className: group.icon, 'aria-hidden': 'true' }), el('span', { text: loc(`Group.${group.id}`) })]));
			}
			const body = el('section', { className: 'fshop-tb-body', id: 'fshop-tab-body',
				role: 'tabpanel', 'aria-labelledby': current ? `fshop-tab-${current.id}` : undefined,
				'aria-label': current ? undefined : loc(`Tab.${tab}`), dataset: { tab } });
			const members = current?.tabs.filter(visible) ?? [];
			if (members.length > 1) body.append(el('div', { className: 'fshop-tb-subtabs', role: 'group',
				'aria-label': loc(`Group.${current.id}`) }, members.map(name => el('button', { type: 'button',
				className: 'fshop-tb-subtab', 'aria-pressed': String(name === tab), dataset: { action: 'toolboxPanel', panel: name } },
			[el('i', { className: TAB_ICONS[name], 'aria-hidden': 'true' }), el('span', { text: loc(`Tab.${name}`) })]))));
			else if (!current) body.append(el('h3', { className: 'fshop-tb-panel-title', text: loc(`Tab.${tab}`) }));
			if (tab === 'library') body.append(this.#renderStamps(), this.#renderLibrary(), this.#renderStarters());
			if (tab === 'brush') body.append(this.#renderStyle(context));
			else if (tab === 'palettes') body.append(this.#renderColors(context));
			else if (tab === 'labels') body.append(this.#renderLabels(context));
			else if (tab === 'settings') body.append(this.#renderSettings(context));
			else if (this._layerPanel) {
				const panel = el('div', { className: 'fshop-tb-layer-body' });
				try { panel.innerHTML = await this._layerPanel.render(tab); }
				catch (error) {
					// Canvas teardown/redraw briefly leaves no scene; keep the rest of the toolbox usable.
					panel.append(el('p', { className: 'fshop-tb-hint', role: 'status', text: error?.message ?? String(error) }));
				}
				const hints = new Map();
				for (const hint of panel.querySelectorAll('[data-help]')) {
					const parent = hint.parentElement;
					if (!hints.has(parent)) hints.set(parent, []);
					hints.get(parent).push(hint);
				}
				// One help chip per section, beside its title, instead of one empty-looking row per hint.
				for (const [parent, group] of hints) {
					const chip = help(group.map(hint => hint.textContent.trim()).join(' '));
					const title = [...parent.children].find(child => child.matches?.('.fshop-layer-toolbar'))?.querySelector('strong');
					if (title) title.after(chip);
					else group[0].before(chip);
					for (const hint of group) hint.remove();
				}
				for (const button of panel.querySelectorAll('[data-action]')) {
					button.dataset.layerAction = button.dataset.action;
					button.dataset.action = 'layerAction';
				}
				body.append(panel);
			}
			root.append(tabs, body);
		}
		return root;
	}

	_replaceHTML(result, content) {
		this.#stopPreviews();
		const flyout = content.querySelector('.fshop-tb-flyout-stack');
		if (flyout) this._flyoutScroll = flyout.scrollTop;
		const previous = content.querySelector('.fshop-tb-body');
		if (previous) this._scrollPositions.set(previous.dataset.tab, previous.scrollTop);
		content.replaceChildren(result);
		const next = content.querySelector('.fshop-tb-body');
		if (next) next.scrollTop = this._scrollPositions.get(next.dataset.tab) ?? 0;
		const nextFlyout = content.querySelector('.fshop-tb-flyout-stack');
		if (nextFlyout) nextFlyout.scrollTop = this._flyoutScroll;
	}

	#renderTools(context) {
		const row = el('div', { className: 'fshop-tb-row fshop-tb-tools', role: 'toolbar', 'aria-label': loc('Tools') });
		const armed = context.labelState.mode !== 'off' || !!context.stampState.armed || getPathState().armed;
		for (const name of TOOLBOX_TOOLS.filter(name => name !== 'text')) {
			const native = context.nativeTools[name];
			const title = native?.title ? game.i18n.localize(native.title) : name;
			row.append(iconButton('tool', native?.icon ?? FALLBACK_ICONS[name], title, {
				dataset: { tool: name }, pressed: !armed && context.activeTool === name,
			}));
		}
		row.append(iconButton('railLabel', 'fas fa-tag', loc('Rail.Label'), { pressed: context.labelState.mode !== 'off' }));
		if (game.user.isGM) row.append(iconButton('railStamp', 'fas fa-stamp', loc('Rail.Stamp'), { pressed: !!context.stampState.armed }));
		if (game.user.isGM) row.append(iconButton('pathArm', 'fas fa-route',
			game.i18n.localize('FOUNDRYSHOP.Paths.Tool'), { pressed: getPathState().armed, disabled: getPathState().pending }));
		if (game.user.isGM) {
			const button = iconButton('layers', 'fas fa-layer-group', loc('LayerFlyout'), { pressed: this._layerFlyout });
			button.setAttribute('aria-expanded', String(this._layerFlyout));
			button.setAttribute('aria-controls', 'fshop-layer-flyout');
			row.append(button);
		}
		return row;
	}

	async _renderFrame(options) {
		const frame = await super._renderFrame(options);
		const close = frame.querySelector?.('.window-header [data-action="close"]');
		if (close) {
			const settings = document.createElement('button');
			settings.type = 'button';
			settings.className = 'header-control icon fa-solid fa-gear fshop-tb-settings';
			settings.dataset.action = 'toolboxSettings';
			const toggle = document.createElement('button');
			toggle.type = 'button';
			toggle.className = 'header-control icon fa-solid fa-chevron-up fshop-tb-collapse';
			toggle.dataset.action = 'collapse';
			close.before(settings);
			close.before(toggle);
		}
		return frame;
	}

	#syncCollapseControl() {
		const settings = this.element?.querySelector?.('.window-header .fshop-tb-settings');
		if (settings) {
			settings.setAttribute('aria-label', loc('Tab.settings'));
			settings.setAttribute('data-tooltip-text', loc('Tab.settings'));
			settings.setAttribute('aria-pressed', String(!this._collapsed && this._tab === 'settings'));
		}
		const toggle = this.element?.querySelector?.('.window-header .fshop-tb-collapse');
		if (!toggle) return;
		const label = loc(this._collapsed ? 'Expand' : 'Collapse');
		toggle.classList.toggle('fa-chevron-up', !this._collapsed);
		toggle.classList.toggle('fa-chevron-down', this._collapsed);
		toggle.setAttribute('aria-label', label);
		toggle.setAttribute('data-tooltip-text', label);
		toggle.setAttribute('aria-pressed', String(this._collapsed));
	}

	async #renderLayerFlyout() {
		if (!this._layerPanel?.context) throw new Error('Layer controls are unavailable.');
		const context = await this._layerPanel.context();
		const section = el('section', { id: 'fshop-layer-flyout', className: 'fshop-tb-layer-flyout',
			role: 'region', 'aria-label': loc('LayerFlyout') });
		section.append(el('div', { className: 'fshop-tb-flyout-title' }, [
			el('strong', { text: loc('LayerFlyout') }),
			iconButton('layers', 'fas fa-xmark', loc('CloseLayerFlyout')),
		]));
		section.append(el('div', { className: 'fshop-tb-flyout-head' }, [
			el('i', { className: 'fas fa-eye', title: game.i18n.localize('FOUNDRYSHOP.Layers.Workspace'),
				'aria-label': game.i18n.localize('FOUNDRYSHOP.Layers.Workspace') }),
			el('i', { className: 'fas fa-users', title: game.i18n.localize('FOUNDRYSHOP.Layers.Players'),
				'aria-label': game.i18n.localize('FOUNDRYSHOP.Layers.Players') }),
			el('span', { text: game.i18n.localize('FOUNDRYSHOP.Layers.Stack') }),
			el('i', { className: 'fas fa-lock', title: game.i18n.localize('FOUNDRYSHOP.Layers.Lock'),
				'aria-label': game.i18n.localize('FOUNDRYSHOP.Layers.Lock') }),
		]));
		const stack = el('div', { className: 'fshop-tb-flyout-stack' });
		for (const row of context.rows) {
			const action = (command, icon, title, options = {}) => iconButton('layerAction', icon, title,
				{ dataset: { layerAction: command, id: row.id }, ...options });
			const name = action(row.isGroup ? 'collapseGroup' : 'activate',
				row.isGroup ? `fas ${row.collapsed ? 'fa-folder' : 'fa-folder-open'}` : row.active ? 'fas fa-pen' : null,
				`${row.name} (${row.count})`, { text: row.name, className: 'fshop-tb-flyout-name',
					disabled: !row.isGroup && row.effectiveLocked, pressed: row.isGroup ? undefined : row.active });
			name.style.setProperty('--layer-depth', row.depth);
			if (row.isGroup) name.setAttribute('aria-expanded', String(row.expanded));
			stack.append(el('div', { className: `fshop-tb-flyout-row${row.active ? ' fshop-tb-flyout-active' : ''}` }, [
				action('workspace', `fas ${row.localIcon}`, `${row.name}: ${row.localTitle}`, { pressed: row.localVisible }),
				action('present', `fas ${row.playerIcon}`, `${row.name}: ${row.playerTitle}`),
				el('div', { className: 'fshop-tb-flyout-entry' }, [
					el('span', { className: 'fshop-tb-artwork-preview', dataset: { previewLayer: row.id, previewState: 'loading' },
						role: 'img', 'aria-label': game.i18n.localize('FOUNDRYSHOP.Preview.Loading'),
						title: game.i18n.localize('FOUNDRYSHOP.Preview.Scope') }, [
						el('i', { className: 'fas fa-hourglass-half', 'aria-hidden': 'true' }),
					]), name, el('span', { text: String(row.count),
					className: 'fshop-tb-flyout-count' })]),
				action('lock', `fas ${row.effectiveLocked ? 'fa-lock' : 'fa-lock-open'}`,
					`${row.name}: ${row.lockTitle}`, { pressed: row.locked }),
			]));
			const buttons = stack.children[stack.children.length - 1].children;
			buttons[0].setAttribute('aria-pressed', row.localAria);
			buttons[1].setAttribute('aria-pressed', row.playerAria);
		}
		if (!context.rows.length) stack.append(el('p', { text: game.i18n.localize('FOUNDRYSHOP.Layers.Empty') }));
		section.append(stack, el('div', { className: 'fshop-tb-row' }, [
			el('span', { className: 'fshop-tb-preview-scope', text: game.i18n.localize('FOUNDRYSHOP.Preview.Scope') }),
			el('span', { className: 'fshop-tb-flyout-unassigned',
				text: `${game.i18n.localize('FOUNDRYSHOP.Layers.Unassigned')} (${context.unassignedCount})` }),
			iconButton('fullLayers', 'fas fa-up-right-from-square', loc('FullLayers')),
			iconButton('refreshPreviews', 'fas fa-arrows-rotate', game.i18n.localize('FOUNDRYSHOP.Preview.Refresh')),
			iconButton('layers', 'fas fa-xmark', loc('CloseLayerFlyout')),
		]));
		return section;
	}

	#renderStyle({ config, stroke, fill, selectionCount }, quick = false) {
		const section = el('div', { className: `fshop-tb-section${quick ? ' fshop-tb-quick' : ''}` });
		const chips = el('div', { className: 'fshop-tb-row' });
		for (const [target, color] of [['stroke', stroke], ['fill', fill]]) {
			const noFill = target === 'fill' && config.fillType === 0;
			chips.append(el('button', {
				type: 'button', className: `fshop-tb-chip${noFill ? ' fshop-tb-nofill' : ''}`,
				title: `${loc(`Target.${target}`)} (${color})`, 'aria-label': `${loc(`Target.${target}`)} ${color}`,
				'aria-pressed': String(this._target === target), dataset: { action: 'target', target },
				style: colorStyle(color),
			}, [quick ? el('i', { className: target === 'stroke' ? 'fas fa-pen' : 'fas fa-fill-drip',
				'aria-hidden': 'true' }) : el('span', { text: loc(`Target.${target}`) })]));
		}
		const current = Number(this._wheelWidth ?? config.strokeWidth) || 0;
		const width = el('div', { className: 'fshop-tb-row fshop-tb-width', title: loc('WidthWheel'),
			role: 'group', 'aria-label': loc('Width') }, [
			el('span', { className: 'fshop-tb-value', text: String(current), 'aria-live': 'polite' }),
			el('input', { type: 'range', min: 0, max: Math.max(64, current), step: 1, value: current,
				className: 'fshop-tb-width-slider', 'aria-label': loc('Width'), dataset: { widthSlider: '' } }),
			el('div', { className: 'fshop-tb-sizes', role: 'group', 'aria-label': loc('QuickSizes') }, QUICK_WIDTHS.map(size =>
				el('button', { type: 'button', className: 'fshop-tb-size', text: String(size),
					title: game.i18n.format('FOUNDRYSHOP.Toolbox.SetWidth', { width: size }),
					'aria-pressed': String(current === size), dataset: { action: 'widthSet', width: String(size) } }))),
		]);
		const alpha = el('div', { className: 'fshop-tb-row fshop-tb-opacity' });
		for (const target of quick ? ['stroke', 'fill'] : []) {
			const value = Number(config[`${target}Alpha`]);
			alpha.append(el('label', { className: 'fshop-tb-alpha', title: loc(`Opacity.${target}`) }, [
				el('i', { className: target === 'stroke' ? 'fas fa-pen' : 'fas fa-fill-drip', 'aria-hidden': 'true' }),
				el('span', { className: 'fshop-tb-alpha-name', text: loc(`OpacityShort.${target}`), 'aria-hidden': 'true' }),
				el('input', { type: 'range', min: 0, max: 1, step: 0.05, value,
					'aria-label': loc(`Opacity.${target}`), dataset: { alpha: target } }),
				el('span', { className: 'fshop-tb-alpha-value', text: `${Math.round(value * 100)}%`,
					dataset: { alphaValue: target }, 'aria-hidden': 'true' }),
			]));
		}
		if (quick) {
			let presets = [], presetError = null;
			try { presets = readBrushPresets(); } catch (error) { presetError = error; console.error('Foundryshop:', error); }
			const matched = matchingPresetId(presets, config);
			chips.classList.add('fshop-tb-colors');
			chips.append(
				iconButton('swap', 'fas fa-right-left', loc('Swap')),
				iconButton('noFill', 'fas fa-fill-drip', loc('NoFill'), { pressed: config.fillType === 0 }),
				el('select', { className: 'fshop-tb-preset', 'aria-label': loc('BrushPreset'), title: presetError?.message ?? loc('BrushPresetHint'),
					dataset: { brushPreset: '' }, disabled: !!presetError || undefined }, [
					el('option', { value: '', text: loc('BrushPresetCustom'), selected: !matched }),
					...presets.map(preset => el('option', { value: preset.id, text: preset.name, selected: preset.id === matched })),
				]),
				iconButton('brushPresetSave', 'fas fa-floppy-disk', loc('BrushPresetSave'), { disabled: !!presetError }),
				iconButton('brushPresetDelete', 'fas fa-trash', loc('BrushPresetDelete'), { disabled: !matched, dataset: { id: matched } }),
			);
			section.append(chips, width, alpha);
		}
		else {
			for (const target of ['stroke', 'fill']) section.append(el('label', { className: 'fshop-tb-row',
				text: loc(`Target.${target}`) }, [el('input', { type: 'text', value: target === 'stroke' ? stroke : fill,
					dataset: { brush: `${target}Color` }, 'aria-label': loc(`Target.${target}`) })]));
			section.append(el('label', { className: 'fshop-tb-row', text: loc('FillType') }, [
				el('select', { dataset: { brush: 'fillType' } }, [0, 1, 2].map(value =>
					el('option', { value, selected: config.fillType === value, text: loc(`FillOption.${value}`) }))),
			]));
			const material = key => game.i18n.localize(`FOUNDRYSHOP.Materials.${key}`);
			const selectedMaterial = STARTER_MATERIALS.find(entry => entry.path === config.texture);
			section.append(el('div', { className: 'fshop-tb-row' }, [
				selectedMaterial ? el('img', { src: selectedMaterial.path, alt: '', width: 32, height: 32,
					className: 'fshop-material-selected-source', dataset: { materialImage: `selected-${selectedMaterial.id}` } }) : null,
				selectedMaterial ? el('span', { text: material('PreviewFailed'), hidden: true, role: 'status',
					dataset: { materialError: `selected-${selectedMaterial.id}` } }) : null,
				el('span', { className: 'fshop-tb-material-path',
					text: selectedMaterial ? material(`Name.${selectedMaterial.id}`) : config.texture || material('None'),
					title: config.texture || material('None') }),
				iconButton('materialChoose', 'fas fa-layer-group', material('Choose'), { pressed: this._materialExpanded }),
				iconButton('materialClear', 'fas fa-xmark', material('Clear'), { disabled: !config.texture }),
			]), help(material('Hint')));
			section.append(el('label', { className: 'fshop-tb-row', text: material('RepeatSize') }, [
				el('input', { type: 'number', min: 0.05, max: 100, step: 0.05,
					value: config.materialRepeat ?? 1, dataset: { brush: 'materialRepeat' },
					title: material('RepeatHint'), 'aria-label': material('RepeatSize') }),
			]));
			section.append(el('button', { type: 'button', className: 'fshop-tb-button', text: material('ApplySelection'),
				dataset: { action: 'materialApplySelection' }, disabled: !selectionCount || this._materialApplying,
				title: material('ApplyHint') }),
			help(material('ApplyHint')));
			if (this._materialExpanded) {
				const picker = el('section', { className: 'fshop-material-picker', 'aria-label': material('Choose') });
				picker.append(el('div', { className: 'fshop-tb-row fshop-material-search' }, [
					el('input', { type: 'search', value: this._materialQuery, placeholder: material('Search'),
						'aria-label': material('Search'), dataset: { materialSearch: '' } }),
					iconButton('materialBrowse', 'fas fa-folder-open', material('Browse')),
				]));
				const grid = el('div', { className: 'fshop-material-grid' });
				for (const entry of STARTER_MATERIALS) {
					const name = material(`Name.${entry.id}`), category = material(`Category.${entry.category}`);
					const card = el('button', { type: 'button', className: 'fshop-material-card',
						title: `${name} (${category})`, 'aria-label': name, 'aria-pressed': String(config.texture === entry.path),
						dataset: { action: 'materialSelect', materialId: entry.id },
					}, [el('img', { src: entry.path, loading: 'lazy', decoding: 'async', alt: '',
						width: 64, height: 64, dataset: { materialImage: entry.id } }),
						el('span', { text: name }),
						el('span', { className: 'fshop-material-error', hidden: true, text: material('PreviewFailed'),
							dataset: { materialError: entry.id }, role: 'status' })]);
					grid.append(card);
				}
				picker.append(grid, el('p', { text: material('NoResults'), hidden: true, dataset: { materialEmpty: '' }, role: 'status' }),
					help(material('StarterHint')));
				section.append(picker);
			}
			section.append(iconButton('moreColors', 'fas fa-palette', loc('MoreColors')));
		}
		if (quick) {
			const colors = game.settings.get(MODULE, SETTINGS_RECENT_COLORS) ?? [];
			const recent = el('div', { className: 'fshop-tb-swatches fshop-tb-recent', role: 'toolbar', 'aria-label': loc('RecentColors') });
			for (const color of [...new Set(colors.map(color => typeof color === 'string' ? color.toLowerCase() : color))]
				.filter(color => /^#[0-9a-f]{6}$/i.test(color)).slice(0, MAX_RECENT_SWATCHES)) {
				recent.append(iconButton('recentColor', null, `${loc('RecentColors')}: ${color}`,
					{ dataset: { color }, className: 'fshop-tb-swatch' }));
				const swatch = recent.children[recent.children.length - 1];
				for (const [key, value] of Object.entries(colorStyle(color))) swatch.style.setProperty(key, value);
			}
			if (recent.children.length) section.append(recent);
		}
		if (!quick && game.user.isGM) section.append(this.#renderPaths());
		return section;
	}

	#renderPaths() {
		const tr = key => game.i18n.localize(`FOUNDRYSHOP.Paths.${key}`);
		const state = getPathState();
		const section = el('section', { className: 'fshop-path-controls', 'aria-label': tr('Title') });
		section.append(el('div', { className: 'fshop-tb-row' }, [
			el('strong', { text: tr('Title') }), help(tr('Help')),
		]));
		section.append(this.#renderPathAppearance(state, false));
		section.append(el('div', { className: 'fshop-tb-row' }, [
			iconButton('pathArm', 'fas fa-route', tr('Tool'), { text: tr(state.armed ? 'Restart' : 'Start'), disabled: state.pending }),
			iconButton('pathFinish', 'fas fa-check', tr('Finish'), { text: tr('Finish'), disabled: !state.armed || state.count < (state.closed ? 3 : 2) || state.pending }),
			iconButton('pathCancel', 'fas fa-xmark', tr('Cancel'), { disabled: !state.armed }),
		]));
		if (state.armed) section.append(el('p', { className: 'fshop-tb-hint', role: 'status',
			text: game.i18n.format('FOUNDRYSHOP.Paths.Points', { count: state.count }) }));
		try {
			const routes = readPathRegistry(canvas.scene).routes;
			if (routes.length) {
				const names = new Map();
				for (const route of routes) names.set(route.name, (names.get(route.name) ?? 0) + 1);
				const id = routes.some(r => r.id === this._retainedPathId) ? this._retainedPathId : routes[0].id;
				const integrity = inspectPathIntegrity(canvas.scene, id), editing = getPathEditorState().active;
				section.append(el('details', { className: 'fshop-retained-paths', open: this._retainedPathsOpen }, [
					el('summary', { text: tr('RetainedRoutes') }),
					el('select', { dataset: { retainedPath: '' }, 'aria-label': tr('RetainedRoutes'), disabled: editing },
						routes.map(r => el('option', { value: r.id, selected: r.id === id,
							text: names.get(r.name) > 1 ? `${r.name} (${r.id.slice(-6)})` : r.name }))),
					el('div', { className: 'fshop-tb-row' }, [
						iconButton('pathEdit', 'fas fa-route', tr('Edit'), { text: tr('Edit'), disabled: editing || !integrity.intact,
							dataset: { pathId: id } }),
						iconButton(integrity.intact ? 'pathSelectWhole' : 'pathConflict', integrity.intact ? 'fas fa-object-group' : 'fas fa-triangle-exclamation',
							tr(integrity.intact ? 'SelectWhole' : 'ConflictReview'), { text: tr(integrity.intact ? 'SelectWhole' : 'ConflictReview'),
								disabled: editing || this._busy, dataset: { pathId: id } }),
					]),
				]));
			}
		} catch (error) {
			section.append(el('p', { className: 'fshop-tb-hint', role: 'alert', text: error.message }));
		}
		return section;
	}

	#renderPathAppearance(state, editing) {
		const tr = key => game.i18n.localize(`FOUNDRYSHOP.Paths.${key}`);
		const section = el('div', { className: 'fshop-path-controls' });
		const dataset = key => editing ? { pathEditSetting: key } : { pathSetting: key };
		let presets = [], presetError = null;
		try { presets = readPathPresets(); } catch (error) { presetError = error; console.error('Foundryshop:', error); }
		const matched = presets.find(p => p.closed === state.closed && Object.entries(p.options).every(([key, value]) => key === 'seed' || state[key] === value));
		section.append(el('div', { className: 'fshop-tb-row' }, [
			el('select', { dataset: { pathPreset: '', pathEditing: String(editing) }, 'aria-label': tr('Preset'),
				disabled: state.pending || !!presetError }, [
				el('option', { value: '', text: tr('PresetCustom'), selected: !matched }),
				...presets.map(p => el('option', { value: p.id, text: p.name, selected: p.id === matched?.id })),
			]),
			iconButton('pathPresetSave', 'fas fa-floppy-disk', tr('PresetSave'), { dataset: { editing: String(editing) }, disabled: state.pending || !!presetError }),
			iconButton('pathPresetDelete', 'fas fa-trash', tr('PresetDelete'), { dataset: { id: matched?.id, editing: String(editing) }, disabled: state.pending || !matched }),
		]));
		if (presetError) section.append(el('p', { role: 'alert', text: presetError.message }));
		section.append(el('label', { className: 'fshop-tb-row', text: tr('StyleLabel') }, [
			el('select', { dataset: dataset('style'), 'aria-label': tr('StyleLabel'), disabled: state.pending }, PATH_STYLES.map(style =>
				el('option', { value: style, selected: state.style === style, text: tr(`Style.${style}`) }))),
		]));
		section.append(el('label', { className: 'fshop-tb-row', text: tr('CurveLabel') }, [
			el('select', { dataset: dataset('curve'), 'aria-label': tr('CurveLabel'), disabled: state.pending }, ['smooth', 'straight'].map(curve =>
				el('option', { value: curve, selected: state.curve === curve, text: tr(`Curve.${curve}`) }))),
		]));
		for (const [key, min, max] of [['smoothing', 0, 1], ['meander', 0, 5], ['bendSpacing', 0.5, 20], ['width', 0.01, 10], ['spacing', 0.1, 5], ['alpha', 0, 1]]) {
			if (key === 'spacing' && state.style !== 'railway') continue;
			if (key === 'smoothing' && state.curve !== 'smooth') continue;
			if (key === 'bendSpacing' && !state.meander) continue;
			section.append(el('label', { className: 'fshop-tb-row', text: tr(key) }, [
				el('input', { type: 'number', min, max, step: key === 'width' ? 0.01 : key === 'bendSpacing' ? 0.25 : 0.05, value: state[key],
					dataset: dataset(key), 'aria-label': tr(key), title: tr(`${key}Hint`), disabled: state.pending }),
			]));
		}
		section.append(el('div', { className: 'fshop-tb-row' }, [
			el('label', { text: tr('Color') }, [el('input', { type: 'color', value: state.color, dataset: dataset('color'),
				'aria-label': tr('Color'), disabled: state.pending })]),
			el('label', { text: tr('Closed') }, [el('input', { type: 'checkbox', checked: state.closed, dataset: dataset('closed'),
				'aria-label': tr('Closed'), disabled: state.pending })]),
			iconButton('pathReroll', 'fas fa-dice', tr('Reroll'), { dataset: { editing: String(editing) }, disabled: state.pending || !state.meander }),
		]));
		section.append(help(tr('AppearanceHelp')));
		return section;
	}

	#renderSettings(context) {
		const section = el('div', { className: 'fshop-tb-section' });
		const scale = context.scale ?? TOOLBOX_SCALE.default;
		section.append(el('label', { className: 'fshop-tb-row', text: loc('Setting.toolboxScale') }, [
			el('input', { type: 'range', min: TOOLBOX_SCALE.min, max: TOOLBOX_SCALE.max, step: TOOLBOX_SCALE.step,
				value: scale, dataset: { setting: SETTINGS_TOOLBOX_SCALE }, 'aria-label': loc('Setting.toolboxScale') }),
			el('output', { text: `${scale}%`, dataset: { scaleValue: '' }, 'aria-live': 'polite' }),
		]), el('div', { className: 'fshop-tb-row' }, [
			iconButton('scalePreset', 'fas fa-computer-mouse', loc('ScaleMouse'), { text: loc('ScaleMouse'), dataset: { scale: 50 } }),
			iconButton('scalePreset', 'fas fa-tablet-screen-button', loc('ScaleTablet'), { text: loc('ScaleTablet'), dataset: { scale: 100 } }),
		]), help(loc('ScaleHint')));
		for (const [key, type, value] of [
			[SETTINGS_TOOLBOX_DENSITY, 'select', context.density],
			[SETTINGS_TOOLBOX_THEME, 'select', context.theme],
			[SETTINGS_TOOLBOX_AUTO_SHOW, 'checkbox', game.settings.get(MODULE, SETTINGS_TOOLBOX_AUTO_SHOW)],
			[SETTINGS_DRAWING_EDGE_PAN, 'checkbox', game.settings.get(MODULE, SETTINGS_DRAWING_EDGE_PAN)],
		]) {
			const label = el('label', { className: 'fshop-tb-row', text: loc(`Setting.${key}`) });
			const choices = key === SETTINGS_TOOLBOX_THEME ? TOOLBOX_THEMES : DENSITIES;
			const input = type === 'select'
				? el('select', { dataset: { setting: key } }, choices.map(choice =>
					el('option', { value: choice, selected: choice === value,
						text: loc(`${key === SETTINGS_TOOLBOX_THEME ? 'Theme' : 'Density'}.${choice}`) })))
				: el('input', { type, checked: !!value, dataset: { setting: key } });
			label.append(input);
			section.append(label);
		}
		if (game.user.isGM) section.append(el('label', { className: 'fshop-tb-row',
			text: game.i18n.localize('FOUNDRYSHOP.Stamps.FolderName') }, [
			el('input', { type: 'text', value: game.settings.get(MODULE, STAMP_FOLDER) ?? '',
				dataset: { setting: STAMP_FOLDER }, title: game.i18n.localize('FOUNDRYSHOP.Stamps.FolderHint') }),
		]));
		if (game.user.isGM) section.append(el('label', { className: 'fshop-tb-row',
			text: game.i18n.localize('FOUNDRYSHOP.Library.FolderName') }, [
			el('input', { type: 'text', value: game.settings.get(MODULE, LIBRARY_FOLDER) ?? '',
				dataset: { setting: LIBRARY_FOLDER }, title: game.i18n.localize('FOUNDRYSHOP.Library.FolderHint') }),
		]));
		const tr = key => game.i18n.localize(`FOUNDRYSHOP.Tablet.${key}`);
		const tablet = el('section', { className: 'fshop-tb-section', 'aria-label': tr('Title') }, [
			el('strong', { text: tr('Title') }),
			help(tr('Setup')),
		]);
		for (const action of [...TABLET_ACTIONS,
			{ id: 'toggleToolbox', name: 'FOUNDRYSHOP.Keybindings.ToggleToolbox' },
			{ id: 'disarmLabel', name: 'FOUNDRYSHOP.Keybindings.DisarmLabel' }]) {
			tablet.append(el('div', { className: 'fshop-tb-row' }, [
				el('span', { text: game.i18n.localize(action.name) }),
				el('strong', { text: tabletBindingLabel(action.id), dataset: { tabletBinding: action.id } }),
			]));
		}
		tablet.append(iconButton('tabletBindings', 'fas fa-keyboard', tr('Configure'), { text: tr('Configure') }),
			help(tr('BrowserHint')),
			el('label', { text: tr('Test') }, [
				el('input', { type: 'text', readonly: true, placeholder: tr('TestPlaceholder'),
					dataset: { tabletKeyTest: '', keyboardFocus: 'true' }, 'aria-label': tr('Test') }),
			]),
			el('p', { className: 'fshop-tb-hint', role: 'status', 'aria-live': 'polite',
				text: tr('TestHint'), dataset: { tabletKeyResult: '' } }));
		section.append(tablet);
		return section;
	}

	#renderColors({ sharedPalettes }) {
		const section = el('div', { className: 'fshop-tb-section' });
		const pal = key => game.i18n.localize(`FOUNDRYSHOP.Palettes.${key}`);
		const palettes = effectivePalettes(sharedPalettes);
		const palette = palettes.find(entry => entry.id === this._selectedPalette) ?? palettes[0];
		this._selectedPalette = palette.id;
		const dataset = { paletteId: palette.id };
		section.append(el('div', { className: 'fshop-tb-row' }, [
			el('select', { dataset: { paletteSelector: '' }, 'aria-label': pal('Selector') },
				palettes.map(entry => el('option', {
					value: entry.id, text: entry.name, selected: entry.id === palette.id,
				}))),
			iconButton('sharedCreate', 'fas fa-plus', pal('Create')),
			iconButton('paletteManage', 'fas fa-sliders', pal('Manage'), { pressed: this._paletteManage }),
		]));
		const strip = el('div', { className: 'fshop-tb-palette-grid', 'aria-label': palette.name });
		for (const [colorIndex, entry] of palette.colors.entries()) {
			const paired = entry.kind === 'pair';
			const title = paired ? game.i18n.format('FOUNDRYSHOP.Pairs.Title', {
				name: entry.name, line: entry.strokeColor, fill: entry.fillColor,
				mode: game.i18n.localize(`FOUNDRYSHOP.Pairs.${['None', 'Solid', 'Pattern'][entry.fillType]}`),
				texture: entry.texture ?? '', repeat: entry.materialRepeat,
			}) : `${entry.name} (${entry.color})`;
			const swatch = el('button', {
				type: 'button', className: 'fshop-tb-swatch', title, 'aria-label': title,
				style: colorStyle(paired ? entry.strokeColor : entry.color), dataset: { action: 'useColor', id: entry.id, ...dataset },
			}, paired ? [
				el('span', { className: 'fshop-pair-half', style: { backgroundColor: entry.strokeColor }, 'aria-hidden': 'true' }),
				el('span', { className: `fshop-pair-half${entry.fillType === 0 ? ' fshop-pair-empty' : ''}`,
					style: { backgroundColor: entry.fillColor }, 'aria-hidden': 'true',
					dataset: entry.fillType === 2 ? { previewPair: entry.id, pairPalette: palette.id } : {} },
					[el('i', { className: entry.fillType === 0 ? 'fas fa-ban' : entry.fillType === 2 ? 'fas fa-border-all' : 'fas fa-fill',
						'aria-hidden': 'true' })]),
			] : [el('span', { className: 'fshop-tb-swatch-block', style: { backgroundColor: entry.color }, 'aria-hidden': 'true' })]);
			swatch.addEventListener('contextmenu', async event => {
				event.preventDefault();
				try {
					const choices = [
						{ action: paired ? 'pairEdit' : 'pairCreate', label: game.i18n.localize(`FOUNDRYSHOP.Pairs.${paired ? 'Edit' : 'Create'}`) },
						...(paired ? [
							{ action: 'pairDuplicate', label: game.i18n.localize('FOUNDRYSHOP.Pairs.Duplicate') },
							{ action: 'paletteDelete', label: loc('PaletteDelete') },
						] : []),
					];
					const choice = await FoundryshopDialog.wait({
						window: { title: entry.name }, content: el('div', {}, [el('p', { text: title })]),
						modal: true, rejectClose: false,
						buttons: choices.map(({ action, label }) => ({ action, label, callback: () => action })),
					});
					if (!choice) return;
					const target = { dataset: { action: choice, ...dataset, id: entry.id } };
					if (choice === 'paletteDelete') await Drawing_Toolbox.#onPaletteAction.call(this, event, target);
					else await Drawing_Toolbox.#onPairAction.call(this, event, target);
				} catch (error) { Drawing_Toolbox.reportError(error); }
			});
			if (!this._paletteManage) { strip.append(swatch); continue; }
			const card = el('div', { className: 'fshop-tb-color-card' });
			card.append(swatch);
			card.append(el('span', { text: entry.name, title: entry.color }));
			card.append(el('div', { className: 'fshop-tb-row' }, [
				iconButton(paired ? 'pairEdit' : 'paletteEdit', 'fas fa-pen', `${loc('PaletteEdit')}: ${entry.name}`, { dataset: { ...dataset, id: entry.id } }),
				iconButton(paired ? 'pairDuplicate' : 'pairCreate', 'fas fa-clone', game.i18n.localize(`FOUNDRYSHOP.Pairs.${paired ? 'Duplicate' : 'Create'}`),
					{ dataset: { ...dataset, id: entry.id } }),
				iconButton('paletteDelete', 'fas fa-trash', `${loc('PaletteDelete')}: ${entry.name}`, { dataset: { ...dataset, id: entry.id } }),
				iconButton('sharedColorMove', 'fas fa-arrow-left', pal('Up'), { dataset: { ...dataset, id: entry.id, delta: '-1' }, disabled: colorIndex === 0 }),
				iconButton('sharedColorMove', 'fas fa-arrow-right', pal('Down'), { dataset: { ...dataset, id: entry.id, delta: '1' }, disabled: colorIndex === palette.colors.length - 1 }),
			]));
			strip.append(card);
		}
		strip.append(iconButton('pairCreate', 'fas fa-circle-half-stroke', game.i18n.localize('FOUNDRYSHOP.Pairs.Create'), { dataset }));
		strip.append(iconButton('paletteSave', 'fas fa-plus', loc('PaletteSave'), { dataset, className: 'fshop-tb-palette-add' }));
		section.append(strip);
		if (this._paletteManage) {
			section.append(el('div', { className: 'fshop-tb-row' }, [
				iconButton('sharedRename', 'fas fa-pen', pal('Rename'), { dataset }),
				iconButton('sharedDuplicate', 'fas fa-copy', pal('Duplicate'), { dataset }),
				palette.builtin ? iconButton('paletteReset', 'fas fa-rotate-left', pal('Reset'), { dataset })
					: iconButton('sharedDelete', 'fas fa-trash', pal('Delete'), { dataset }),
				iconButton('paletteImport', 'fas fa-file-import', loc('PaletteImport'), { text: loc('PaletteImport'), dataset }),
			]));
			section.append(el('div', { className: 'fshop-tb-row' }, ['personal', 'campaign'].map(scope =>
				iconButton('sharedAdopt', 'fas fa-file-import', pal(`Adopt.${scope}`), { text: pal(`Adopt.${scope}`), dataset: { scope } }))));
		}
		section.append(help(pal('UnifiedHint')));
		return section;
	}

	#renderLabels({ labels, labelState, canEditLabels, selection, config }) {
		const section = el('div', { className: 'fshop-tb-section' });
		section.append(iconButton('tool', 'fas fa-font', game.i18n.localize('FOUNDRYSHOP.Paths.NativeText'),
			{ text: game.i18n.localize('FOUNDRYSHOP.Paths.NativeTextShort'), dataset: { tool: 'text' } }));
		const tr = key => game.i18n.localize(`FOUNDRYSHOP.Labels.${key}`);
		this._labelDraft ??= { text: labelState.text, style: { fontFamily: config.fontFamily || 'Signika',
			fontSize: config.fontSize || 48, textColor: String(config.textColor || '#302b26'),
			textAlpha: config.textAlpha ?? 1, ...labelState.style } };
		const draft = this._labelDraft;
		const fonts = foundry.applications.settings.menus.FontConfig.getAvailableFontChoices();
		const editor = el('div', { className: 'fshop-label-editor' });
		editor.append(el('label', { text: tr('Font') }, [
			el('select', { dataset: { labelDraft: 'fontFamily' }, 'aria-label': tr('Font'),
				style: { fontFamily: draft.style.fontFamily } }, Object.keys(fonts).map(font =>
				el('option', { value: font, text: font, selected: font === draft.style.fontFamily, style: { fontFamily: font } }))),
		]), el('label', { text: tr('Text') }, [
			el('textarea', { rows: 3, maxlength: MAX_LABEL_TEXT_LENGTH, text: draft.text,
				className: 'fshop-label-text-preview', placeholder: tr('PreviewPlaceholder'),
				dataset: { labelDraft: 'text' }, 'aria-label': tr('Text'), spellcheck: true }),
		]));
		const controls = el('div', { className: 'fshop-label-controls' });
		for (const [field, title, type, limits] of [
			['fontSize', 'FontSize', 'number', { min: 8, max: 256, step: 1 }],
			['textColor', 'TextColor', 'color', {}],
			['textAlpha', 'TextAlpha', 'range', { min: 0, max: 1, step: 0.05 }],
		]) {
			const input = el('input', { type, ...limits, value: draft.style[field],
				dataset: { labelDraft: field }, 'aria-label': tr(title) });
			controls.append(field === 'fontSize'
				? el('div', { className: 'fshop-label-size', title: tr('SizeWheel') }, [
					el('span', { text: tr(title) }),
					el('div', { className: 'fshop-label-size-controls' }, [
						iconButton('labelSize', 'fas fa-minus', tr('SizeDown'), { dataset: { delta: '-1' } }),
						input,
						iconButton('labelSize', 'fas fa-plus', tr('SizeUp'), { dataset: { delta: '1' } }),
					]),
				]) : el('label', { text: tr(title) }, [input]));
		}
		editor.append(controls, help(tr('DraftHint')),
		el('div', { className: 'fshop-tb-row' }, [
			iconButton('labelDraftUse', 'fas fa-tag', tr('UseDraft'), { text: tr('UseDraft') }),
			iconButton('labelDraftSave', 'fas fa-plus', tr('SaveDraft'), { disabled: !canEditLabels }),
			iconButton('labelDraftApply', 'fas fa-i-cursor', loc('SelectionApply'),
				{ disabled: !selection || !Drawing_Toolbox.#canEditDrawing(selection) }),
		]));
		const header = el('div', { className: 'fshop-tb-row' }, [
			el('select', { className: 'fshop-tb-label-scope', 'aria-label': loc('LabelScope') }, [
				el('option', { value: 'personal', text: loc('MyLabels'), selected: this._labelScope === 'personal' }),
				el('option', { value: 'campaign', text: loc('CampaignLabels'), selected: this._labelScope === 'campaign' }),
			]),
			canEditLabels ? iconButton('labelManage', 'fas fa-pen-to-square', loc('Manage'), { pressed: this._manage }) : null,
		]);
		const modes = el('div', { className: 'fshop-tb-row' }, [
			el('label', { text: tr('Rotation') }, [
				el('input', { type: 'number', min: -360, max: 360, step: 15, value: labelState.rotation ?? 0,
					dataset: { labelRotation: '' }, disabled: labelState.mode !== 'place' }),
			]),
			iconButton('labelMode', 'fas fa-xmark', tr('CancelPlacement'), {
				text: tr('CancelPlacement'), dataset: { mode: 'off' }, disabled: labelState.mode === 'off',
			}),
		]);
		const status = el('div', { className: `fshop-tb-status${labelState.mode !== 'off' ? ' fshop-tb-status-armed' : ''}`,
			'aria-live': 'polite', dataset: { labelStatus: '' },
			text: labelState.text
				? game.i18n.format('FOUNDRYSHOP.Toolbox.LabelStatus', { mode: loc(`Mode.${labelState.mode}`), text: labelState.text })
				: loc('NoLabel') });
		const list = el('div', { className: 'fshop-tb-labels' });
		for (const entry of labels) {
			const armed = labelState.mode !== 'off' && labelState.text === entry.text
				&& ['fontFamily', 'fontSize', 'textColor', 'textAlpha']
					.every(key => labelState.style?.[key] === (entry.style?.[key] ?? draft.style[key]));
			const item = el('div', { className: 'fshop-tb-label-item' }, [
				el('button', {
					type: 'button', className: 'fshop-label-preset',
					title: game.i18n.format('FOUNDRYSHOP.Labels.PreviewScale', { text: entry.text,
						size: entry.style?.fontSize ?? draft.style.fontSize,
						scale: Math.round(Math.max(16, Math.min(entry.style?.fontSize ?? draft.style.fontSize, 64))
							/ (entry.style?.fontSize ?? draft.style.fontSize) * 100) }),
					'aria-pressed': String(armed), dataset: { action: 'labelArm', id: entry.id }, text: entry.text,
					style: { fontFamily: entry.style?.fontFamily || draft.style.fontFamily,
						fontSize: `${Math.max(16, Math.min(entry.style?.fontSize ?? draft.style.fontSize, 64))}px`,
						color: entry.style?.textColor ?? draft.style.textColor },
				}),
			]);
			if (this._manage && canEditLabels) {
				item.append(
					iconButton('labelEdit', 'fas fa-pen', game.i18n.localize('FOUNDRYSHOP.Labels.Edit'),
						{ dataset: { id: entry.id }, disabled: this._busy }),
					iconButton('labelDelete', 'fas fa-trash', game.i18n.localize('FOUNDRYSHOP.Labels.Delete'),
						{ dataset: { id: entry.id }, disabled: this._busy }),
				);
			}
			list.append(item);
		}
		if (!labels.length) list.append(el('span', { className: 'fshop-tb-hint', text: loc('NoLabels') }));
		section.append(editor, modes, status, help(tr('PlacementHint')),
			header, help(tr('SavedPreviewHint')), list);
		if (this._manage && canEditLabels) {
			section.append(el('div', { className: 'fshop-tb-row' }, [
				iconButton('labelAdd', 'fas fa-plus', game.i18n.localize('FOUNDRYSHOP.Labels.Add'),
					{ text: game.i18n.localize('FOUNDRYSHOP.Labels.Add'), disabled: this._busy }),
				iconButton('labelStarters', 'fas fa-wand-magic-sparkles', game.i18n.localize('FOUNDRYSHOP.Labels.Starters'),
					{ text: game.i18n.localize('FOUNDRYSHOP.Labels.Starters'), disabled: this._busy }),
			]));
		}
		return section;
	}

	#renderSelection({ selection, selectionCount, labelState, stampState, retainedPath, pathSelectionError }) {
		const canEdit = !!selection && Drawing_Toolbox.#canEditDrawing(selection);
		const hint = selectionCount > 1 && !retainedPath ? loc('SelectOne') : (selection && !canEdit ? loc('SelectionLocked') : '');
		return el('div', { className: 'fshop-tb-row fshop-tb-selection', role: 'toolbar', 'aria-label': loc('Selection') }, [
			el('span', { className: 'fshop-tb-selection-count', role: 'status', title: hint || undefined,
				text: game.i18n.format('FOUNDRYSHOP.Toolbox.SelectionCount', { count: selectionCount }) }),
			selection ? iconButton('selectionEdit', 'fas fa-i-cursor', loc('SelectionEdit'), { disabled: !canEdit }) : null,
			selection ? iconButton('selectionApply', 'fas fa-tag', loc('SelectionApply'), { disabled: !canEdit || !labelState.text }) : null,
			selection ? iconButton('selectionClear', 'fas fa-eraser', loc('SelectionClear'), { disabled: !canEdit || !selection?.text }) : null,
			game.user.isGM ? iconButton('stampCopy', 'fas fa-copy', game.i18n.localize('FOUNDRYSHOP.Stamps.Copy'),
				{ disabled: stampState.busy }) : null,
			retainedPath ? iconButton('pathEdit', 'fas fa-route', game.i18n.localize('FOUNDRYSHOP.Paths.Edit'),
				{ disabled: !retainedPath.intact || getPathEditorState().pending, dataset: { pathId: retainedPath.route.id } }) : null,
			retainedPath ? iconButton('pathSelectWhole', 'fas fa-object-group', game.i18n.localize('FOUNDRYSHOP.Paths.SelectWhole'),
				{ disabled: !retainedPath.intact || getPathEditorState().pending, dataset: { pathId: retainedPath.route.id } }) : null,
			retainedPath && !retainedPath.intact ? iconButton('pathConflict', 'fas fa-triangle-exclamation',
				game.i18n.localize('FOUNDRYSHOP.Paths.ConflictReview'), { text: game.i18n.localize('FOUNDRYSHOP.Paths.ConflictReview'),
					disabled: getPathEditorState().active || this._busy, dataset: { pathId: retainedPath.route.id } }) : null,
			retainedPath ? el('details', {}, [
				el('summary', { text: game.i18n.localize('FOUNDRYSHOP.Paths.Operations') }),
				el('div', { className: 'fshop-tb-row' }, [
					...[['pathDuplicate', 'Duplicate', 'fas fa-clone'], ['pathDeleteWhole', 'DeleteWhole', 'fas fa-trash'],
						['pathDetach', 'Detach', 'fas fa-link-slash']].map(([action, key, icon]) =>
						iconButton(action, icon, game.i18n.localize(`FOUNDRYSHOP.Paths.${key}`), {
							text: game.i18n.localize(`FOUNDRYSHOP.Paths.${key}`), dataset: { pathId: retainedPath.route.id },
							disabled: !retainedPath.intact || getPathEditorState().active || this._busy,
						})),
				]),
			]) : null,
			pathSelectionError || retainedPath && !retainedPath.intact
				? el('span', { className: 'fshop-tb-hint', role: 'status',
					text: pathSelectionError ?? game.i18n.localize('FOUNDRYSHOP.Paths.EditorDamaged') }) : null,
			hint ? el('span', { className: 'fshop-tb-hint', text: hint }) : null,
		]);
	}

	#renderPathEditor() {
		const state = getPathEditorState(), tr = key => game.i18n.localize(`FOUNDRYSHOP.Paths.${key}`);
		const section = el('section', { className: 'fshop-path-editor fshop-tb-section', 'aria-label': tr('Edit') });
		section.append(el('div', { className: 'fshop-tb-row' }, [
			el('strong', { text: `${tr('Edit')}: ${state.name}` }), help(tr('EditorHelp')),
		]),
			el('label', { className: 'fshop-tb-row', text: tr('Waypoint') }, [
				el('select', { dataset: { pathWaypoint: '' }, disabled: state.pending, 'aria-label': tr('Waypoint') },
					state.recipe.waypoints.map((point, index) => el('option', {
						value: index, selected: state.selected === index, text: String(index + 1),
					}))),
			]));
		const point = state.recipe.waypoints[state.selected];
		section.append(el('label', { className: 'fshop-tb-row', text: tr('PointMode') }, [
			el('select', { dataset: { pathPointMode: '' }, disabled: state.pending, 'aria-label': tr('PointMode') },
				['automatic', 'smooth', 'corner'].map(mode => el('option', { value: mode, selected: mode === point.mode, text: tr(`Mode.${mode}`) }))),
		]));
		section.append(el('div', { className: 'fshop-path-coordinates' }, ['x', 'y'].map(key => el('label', { className: 'fshop-tb-row', text: key.toUpperCase() }, [
			el('input', { type: 'number', value: point[key], min: -10000000, max: 10000000, step: 1,
				dataset: { pathCoordinate: key }, disabled: state.pending, 'aria-label': `${tr('Waypoint')} ${key.toUpperCase()}` }),
		]))));
		for (const side of ['incoming', 'outgoing']) if (point[side]) {
			section.append(el('div', { className: 'fshop-tb-label', text: tr(`Handle.${side}`) }));
			section.append(el('div', { className: 'fshop-path-coordinates' }, ['x', 'y'].map(key => el('label', { className: 'fshop-tb-row', text: key.toUpperCase() }, [
				el('input', { type: 'number', value: point[side][key], min: -10000000, max: 10000000, step: 1,
					dataset: { pathHandle: side, pathAxis: key }, disabled: state.pending,
					'aria-label': `${tr(`Handle.${side}`)} ${key.toUpperCase()}` }),
			]))));
		}
		section.append(el('div', { className: 'fshop-tb-row' }, [
			iconButton('pathDraftUndo', 'fas fa-rotate-left', tr('DraftUndo'), { disabled: state.pending || !state.undo }),
			iconButton('pathDraftRedo', 'fas fa-rotate-right', tr('DraftRedo'), { disabled: state.pending || !state.redo }),
			iconButton('pathTranslate', 'fas fa-arrows-up-down-left-right', tr('Translate'), { disabled: state.pending || this._busy }),
			iconButton('pathPointInsert', 'fas fa-plus', tr('InsertPoint'), { text: tr('InsertPoint'), pressed: state.insert, disabled: state.pending }),
			iconButton('pathPointDelete', 'fas fa-minus', tr('DeletePoint'), { disabled: state.pending || state.recipe.waypoints.length <= (state.recipe.closed ? 3 : 2) }),
			iconButton('pathEditApply', 'fas fa-check', tr('Apply'), { text: tr('Apply'), disabled: state.pending }),
			iconButton('pathEditCancel', 'fas fa-xmark', tr('Cancel'), { disabled: state.pending }),
		]));
		section.append(el('details', { className: 'fshop-path-appearance', open: this._pathAppearanceOpen }, [
			el('summary', { text: tr('Appearance') }),
			el('p', { className: 'fshop-tb-hint', text: game.i18n.format('FOUNDRYSHOP.Paths.DimensionReference', {
				reference: state.recipe.gridSize, scene: canvas.grid.size,
				width: Math.max(1, Math.round(state.recipe.gridSize * state.recipe.options.width)),
			}) }),
			this.#renderPathAppearance({ ...state.recipe.options, closed: state.recipe.closed, pending: state.pending }, true),
		]));
		if (state.insert) section.append(el('p', { className: 'fshop-tb-hint', role: 'status', text: tr('InsertHelp') }));
		if (state.error) section.append(el('p', { className: 'fshop-tb-hint', role: 'alert', text: state.error }));
		return section;
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		for (const select of this.element.querySelectorAll('[data-retained-path]')) select.addEventListener('change', () => {
			this._retainedPathId = select.value; this._retainedPathsOpen = true;
			this.render().catch(Drawing_Toolbox.reportError);
		});
		for (const details of this.element.querySelectorAll('.fshop-retained-paths')) details.addEventListener('toggle', () => {
			this._retainedPathsOpen = details.open;
		});
		for (const input of [...this.element.querySelectorAll('[data-path-waypoint]'), ...this.element.querySelectorAll('[data-path-coordinate]'),
			...this.element.querySelectorAll('[data-path-point-mode]'), ...this.element.querySelectorAll('[data-path-handle]')]) {
			input.addEventListener('change', () => {
				try {
					if (Object.hasOwn(input.dataset, 'pathWaypoint')) selectPathWaypoint(Number(input.value));
					else if (Object.hasOwn(input.dataset, 'pathPointMode')) setPathPointMode(input.value);
					else {
						if (!String(input.value).trim()) throw new Error(game.i18n.localize('FOUNDRYSHOP.Paths.EditorCoordinate'));
						const state = getPathEditorState(), point = state.recipe.waypoints[state.selected];
						if (input.dataset.pathHandle) setPathHandle(input.dataset.pathHandle,
							{ ...point[input.dataset.pathHandle], [input.dataset.pathAxis]: Number(input.value) });
						else setPathWaypoint({ ...point, [input.dataset.pathCoordinate]: Number(input.value) });
					}
					this.render().catch(Drawing_Toolbox.reportError);
				} catch (error) { Drawing_Toolbox.reportError(error); this.render().catch(Drawing_Toolbox.reportError); }
			});
		}
		for (const input of [...this.element.querySelectorAll('[data-path-setting]'), ...this.element.querySelectorAll('[data-path-edit-setting]')]) {
			input.addEventListener('change', () => {
				try {
					const key = input.dataset.pathEditSetting ?? input.dataset.pathSetting;
					const value = key === 'closed' ? input.checked : ['style', 'curve', 'color'].includes(key) ? input.value : input.valueAsNumber;
					if (input.dataset.pathEditSetting) configurePathEdit({ [key]: value }); else configurePath({ [key]: value });
				}
				catch (error) { Drawing_Toolbox.reportError(error); this.render(); }
			});
		}
		for (const input of this.element.querySelectorAll('[data-path-preset]')) input.addEventListener('change', () => {
			if (!input.value) return;
			try {
				const preset = readPathPresets().find(p => p.id === input.value);
				if (!preset) throw new Error(game.i18n.localize('FOUNDRYSHOP.Paths.PresetChanged'));
				if (input.dataset.pathEditing === 'true') configurePathEdit(pathPresetPatch(preset));
				else configurePath(pathPresetPatch(preset));
			} catch (error) { Drawing_Toolbox.reportError(error); this.render(); }
		});
		const root = this.element;
		root.querySelector('.fshop-path-appearance')?.addEventListener('toggle', event => {
			if (root.contains(event.target)) this._pathAppearanceOpen = event.target.open;
		});
		this.#syncCollapseControl();
		this._stopTabletTest?.();
		this._stopTabletTest = null;
		const tabletTest = root.querySelector('[data-tablet-key-test]');
		if (tabletTest) this._stopTabletTest = bindTabletKeyTest(tabletTest, root.querySelector('[data-tablet-key-result]'));
		const refreshLabelPreview = () => {
			if (!this._labelDraft) return;
			const { text, style } = this._labelDraft;
			const font = root.querySelector('[data-label-draft="fontFamily"]');
			const textarea = root.querySelector('[data-label-draft="text"]');
			if (font) font.style.fontFamily = style.fontFamily;
			if (textarea) {
				textarea.style.fontFamily = style.fontFamily;
				textarea.style.fontSize = `${style.fontSize}px`;
				const rgb = [1, 3, 5].map(index => parseInt(style.textColor.slice(index, index + 2), 16));
				textarea.style.color = `rgba(${rgb.join(', ')}, ${style.textAlpha})`;
			}
			for (const button of root.querySelectorAll('[data-action="labelMode"]')) button.disabled = getLabelState().mode === 'off';
			const state = getLabelState(), status = root.querySelector('[data-label-status]');
			if (status) {
				status.textContent = state.text
					? game.i18n.format('FOUNDRYSHOP.Toolbox.LabelStatus', { mode: loc(`Mode.${state.mode}`), text: state.text })
					: loc('NoLabel');
				if (state.mode === 'off') status.classList.remove('fshop-tb-status-armed');
			}
			if (state.mode === 'off') for (const preset of root.querySelectorAll('[data-action="labelArm"]')) {
				preset.setAttribute('aria-pressed', 'false');
			}
		};
		for (const input of root.querySelectorAll('[data-label-draft]')) {
			input.addEventListener('input', () => {
				const field = input.dataset.labelDraft;
				if (field === 'text') this._labelDraft.text = input.value;
				else {
					const value = ['fontSize', 'textAlpha'].includes(field) ? Number(input.value) : input.value;
					try {
						const style = normalizeLabelStyle({ ...this._labelDraft.style, [field]: value });
						this._labelDraft.style = style;
					} catch (error) {
						(this._labelInvalidFields ??= new Set()).add(field);
						disarmLabel();
						input.setCustomValidity?.(error.message);
						input.reportValidity?.();
						return;
					}
				}
				input.setCustomValidity?.('');
				this._labelInvalidFields?.delete(field);
				if (field === 'fontSize' && getLabelState().mode === 'place') updateLabelPlacement({ fontSize: this._labelDraft.style.fontSize });
				else disarmLabel();
				refreshLabelPreview();
			});
		}
		refreshLabelPreview();
		root.querySelector('[data-label-rotation]')?.addEventListener('change', event => {
			const rotation = Number(event.target.value);
			if (!Number.isFinite(rotation) || rotation < -360 || rotation > 360) {
				event.target.setCustomValidity?.(game.i18n.localize('FOUNDRYSHOP.Labels.InvalidRotation'));
				event.target.reportValidity?.();
				return;
			}
			event.target.setCustomValidity?.('');
			updateLabelPlacement({ rotation });
		});
		root.querySelector('.fshop-label-size')?.addEventListener('wheel', event => {
			const delta = event.deltaY || event.deltaX;
			if (!delta || event.ctrlKey || event.altKey || event.metaKey) return;
			event.preventDefault();
			event.stopPropagation();
			this.#changeLabelSize((delta < 0 ? 1 : -1) * (event.shiftKey ? 5 : 1));
		}, { passive: false });
		this.#applyAppearance(context);
		this.#positionFlyout();
		this.#startPreviews(root);
		this._layerPanel?.bind(root);
		const materialSearch = root.querySelector('[data-material-search]');
		const filterMaterials = () => {
			const matches = new Set(starterMaterials(this._materialQuery).map(entry => entry.id));
			let visible = 0;
			for (const card of root.querySelectorAll('[data-action="materialSelect"]')) {
				card.hidden = !matches.has(card.dataset.materialId);
				if (!card.hidden) visible++;
			}
			const empty = root.querySelector('[data-material-empty]');
			if (empty) empty.hidden = visible > 0;
		};
		materialSearch?.addEventListener('input', event => {
			this._materialQuery = event.target.value;
			filterMaterials();
		});
		filterMaterials();
		for (const image of root.querySelectorAll('[data-material-image]')) {
			const failed = () => {
				image.hidden = true;
				const status = root.querySelector(`[data-material-error="${image.dataset.materialImage}"]`);
				if (status) status.hidden = false;
				console.warn(`Foundryshop material preview failed: ${image.dataset.materialImage}`);
			};
			image.addEventListener('error', failed, { once: true });
			if (image.complete && image.naturalWidth === 0) failed();
		}
		for (const input of root.querySelectorAll('[data-brush]')) {
			input.addEventListener('change', async () => {
				await this.#persist({ [input.dataset.brush]: input.value });
				await this.render();
			});
		}
		if (options.isFirstRender) {
			window.addEventListener('pointerdown', this._dismissFlyout, { capture: true });
			window.addEventListener('keydown', this._escapeFlyout, { capture: true });
			window.addEventListener('resize', this._positionFlyout);
			this._flyoutResize = new ResizeObserver(this._positionFlyout);
			this._flyoutResize.observe(root);
			// Keep keyboard focus on the canvas so native text entry (and spaces) never trigger toolbox buttons.
			root.addEventListener('mousedown', event => {
				if (event.target.closest?.('button:not([role="tab"])')) event.preventDefault();
			});
			root.addEventListener('focusout', () => {
				if (!this._refreshAfterEdit) return;
				queueMicrotask(() => {
					this._refreshAfterEdit = false;
					this.requestRefresh();
				});
			});
		}
		this.#clampToViewport();
		this.#positionFlyout();
		for (const tab of root.querySelectorAll('[data-tab]')) {
			if (tab.tagName !== 'BUTTON') continue;
			tab.addEventListener('keydown', async event => {
				if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
				event.preventDefault();
				event.stopPropagation();
				const tabs = [...root.querySelectorAll('button[data-tab]')], index = tabs.indexOf(tab);
				const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
					: (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
				try {
					await Drawing_Toolbox.#onTab.call(this, { detail: 0 }, tabs[next]);
				} catch (error) { Drawing_Toolbox.reportError(error); }
			});
		}
		root.querySelector('.fshop-tb-palette-scope')?.addEventListener('change', event => {
			this._paletteScope = event.target.value;
			event.target.blur();
			this.render();
		});
		root.querySelector('select[data-palette-selector]')?.addEventListener('change', async event => {
			try {
				if (!effectivePalettes().some(entry => entry.id === event.target.value)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Palettes.Changed'));
				this._selectedPalette = event.target.value;
				this.#saveState();
				await this.render();
			} catch (error) { Drawing_Toolbox.reportError(error); }
		});
		root.querySelector('[data-shape-search]')?.addEventListener('input', event => {
			this._shapeQuery = event.target.value;
			this.#filterStarters(root);
		});
		root.querySelector('[data-shape-category]')?.addEventListener('change', event => {
			this._shapeCategory = event.target.value;
			this.#filterStarters(root);
		});
		root.querySelector('.fshop-tb-label-scope')?.addEventListener('change', event => {
			this._labelScope = event.target.value;
			this._manage = false;
			event.target.blur();
			this.render();
		});
		for (const input of root.querySelectorAll('[data-setting]')) {
			if (input.dataset.setting === SETTINGS_TOOLBOX_SCALE) input.addEventListener('input', () => {
				root.querySelector('[data-scale-value]').textContent = `${input.value}%`;
			});
			input.addEventListener('change', async event => {
				try {
					const value = input.dataset.setting === SETTINGS_TOOLBOX_SCALE ? validateToolboxScale(Number(input.value))
						: input.tagName === 'SELECT' || input.type === 'text' ? input.value : input.checked;
					if ([STAMP_FOLDER, LIBRARY_FOLDER].includes(input.dataset.setting)) {
						if (!game.user.isGM) throw new Error(game.i18n.localize('FOUNDRYSHOP.Layers.GMOnly'));
						if (input.dataset.setting === LIBRARY_FOLDER) {
							if (value) validateLibraryFolder(value);
							this._libraryController?.abort();
							this._libraryEntries = undefined;
						} else validateAssetFolder(value);
					}
					await game.settings.set(MODULE, input.dataset.setting, value);
					await this.render();
				} catch (error) { Drawing_Toolbox.reportError(error); }
			});
		}
		for (const input of root.querySelectorAll('[data-stamp-option]')) {
			input.addEventListener('change', () => {
				this._stampOptions[input.dataset.stampOption] = input.type === 'checkbox' ? input.checked : Number(input.value);
				cancelStamp();
				input.blur();
			});
		}
		root.querySelector('[data-library-search]')?.addEventListener('input', event => {
			this._libraryQuery = event.target.value;
			this.#filterLibrary(root);
		});
		root.querySelector('[data-library-kind]')?.addEventListener('change', event => {
			this._libraryKind = event.target.value;
			this.#filterLibrary(root);
		});
		for (const image of root.querySelectorAll('[data-library-image]')) image.addEventListener('error', () => {
			image.hidden = true;
			const card = image.closest('[data-library-path]');
			card.querySelector('[data-library-image-status]').textContent = game.i18n.localize('FOUNDRYSHOP.Library.ImageFailed');
			console.warn('Foundryshop | Embedded library thumbnail failed to decode:', card.dataset.libraryPath);
		}, { once: true });
		for (const input of root.querySelectorAll('input[data-alpha]')) {
			input.addEventListener('input', event => {
				const { alpha } = event.target.dataset;
				root.querySelector(`[data-alpha-value="${alpha}"]`).textContent = `${Math.round(Number(event.target.value) * 100)}%`;
				this.#persist({ [`${alpha}Alpha`]: event.target.value });
			});
			// A focused input makes Foundry ignore canvas keystrokes, which would block native text entry.
			input.addEventListener('change', event => event.target.blur());
		}

		root.querySelector('.fshop-tb-width')?.addEventListener('wheel', event => this.#onWidthWheel(event), { passive: false });
		const widthSlider = root.querySelector('input[data-width-slider]');
		widthSlider?.addEventListener('input', event => this.#previewWidth(Number(event.target.value)));
		widthSlider?.addEventListener('change', event => event.target.blur());
		root.querySelector('select[data-brush-preset]')?.addEventListener('change', event => this.#applyBrushPreset(event.target.value));
	}

	#renderStarters() {
		const tr = key => game.i18n.localize(`FOUNDRYSHOP.Builtins.${key}`);
		const shapes = starterShapes().filter(shape => shape.category !== 'Labels');
		const section = el('section', { className: 'fshop-tb-section', 'aria-label': tr('Shapes') });
		section.append(el('strong', { text: tr('Shapes') }), help(tr('Hint')),
			el('select', { 'aria-label': tr('Category'), dataset: { shapeCategory: '' } }, [
				el('option', { value: '', text: tr('AllCategories'), selected: !this._shapeCategory }),
				...[...new Set(shapes.map(shape => shape.category))].map(category => el('option', {
					value: category, text: tr(`CategoryName.${category}`), selected: this._shapeCategory === category,
				})),
			]),
			el('input', { type: 'search', value: this._shapeQuery ?? '', 'aria-label': tr('Search'),
				placeholder: tr('Search'), dataset: { shapeSearch: '' } }),
			el('p', { role: 'status', dataset: { shapeCount: '' } }));
		const cards = el('div', { className: 'fshop-library-cards' });
		for (const shape of shapes) {
			const name = game.i18n.localize(`FOUNDRYSHOP.Builtins.Shape.${shape.id}`);
			const text = `${name} ${tr(`CategoryName.${shape.category}`)} ${shape.category} ${shape.tags.join(' ')}`.toLocaleLowerCase();
			cards.append(el('article', { className: 'fshop-library-card',
				dataset: { shapeSearchText: text, shapeCategoryName: shape.category } }, [
				el('button', { type: 'button', className: 'fshop-starter-preview', 'aria-label': `${tr('Place')}: ${name}`,
					dataset: { previewShape: shape.id, action: 'starterPlace', shapeId: shape.id },
					disabled: getStampState().busy }, [el('i', { className: 'fas fa-hourglass-half', 'aria-hidden': 'true' })]),
				el('strong', { text: name }), el('small', {
					text: `${shape.footprint.width} x ${shape.footprint.height} ${tr('Squares')} / ${shape.project.drawings.length} ${tr('Parts')}`,
				}),
			]));
		}
		section.append(cards);
		this.#filterStarters(section);
		return section;
	}

	#filterStarters(root) {
		const term = (this._shapeQuery ?? '').trim().toLocaleLowerCase();
		const cards = root.querySelectorAll('[data-shape-search-text]');
		let visible = 0;
		for (const card of cards) {
			card.hidden = !card.dataset.shapeSearchText.includes(term)
				|| !!this._shapeCategory && card.dataset.shapeCategoryName !== this._shapeCategory;
			if (!card.hidden) visible++;
		}
		const status = root.querySelector('[data-shape-count]');
		if (status) status.textContent = game.i18n.format('FOUNDRYSHOP.Builtins.Results', { count: visible, total: cards.length });
	}

	static async #onStarterPlace(event, target) {
		if (this._busy) return;
		this._busy = true;
		try {
			const shape = starterShape(target.dataset.shapeId);
			const unit = canvas.scene?.grid?.type === 0 ? 100 : Number(canvas.scene?.grid?.size ?? 100);
			if (!Number.isFinite(unit) || unit <= 0) throw new Error('Invalid Scene grid size.');
			loadShapeStamp(shape, { gridSize: unit });
			await armCopiedStamp(this._stampOptions);
		} catch (error) { Drawing_Toolbox.reportError(error); }
		finally { this._busy = false; }
	}

	static async #onPaletteManage() {
		this._paletteManage = !this._paletteManage;
		await this.render();
	}

	static async #onStarterProject(event, target) {
		if (this._busy || this._libraryBusy) return;
		this._busy = true;
		try {
			if (!game.user.isGM) throw new Error(game.i18n.localize('FOUNDRYSHOP.Layers.GMOnly'));
			const project = starterProject(target.dataset.projectId);
			if (target.dataset.action === 'starterProjectDownload') downloadDrawingProject(canvas.scene, project);
			else {
				const scene = canvas.scene;
				if (!canvas.ready || !scene || !canvas.level?.id) throw new Error(game.i18n.localize('FOUNDRYSHOP.Library.Changed'));
				await promptProjectImport(scene, readLayerTree(scene).revision, project);
			}
		} catch (error) { Drawing_Toolbox.reportError(error); }
		finally { this._busy = false; }
	}

	#renderLibrary() {
		const tr = key => game.i18n.localize(`FOUNDRYSHOP.Library.${key}`);
		const section = el('section', { className: 'fshop-tb-section fshop-library', 'aria-label': tr('Title') });
		section.append(el('div', { className: 'fshop-tb-row fshop-library-actions' }, [
			el('strong', { text: tr('Title') }),
			iconButton('libraryRefresh', 'fas fa-arrows-rotate', tr('Refresh'), {
				text: tr('Refresh'), disabled: !!this._libraryBusy,
			}),
			iconButton('librarySaveShape', 'fas fa-floppy-disk', tr('SaveShape'), {
				text: tr('SaveShape'), disabled: !!this._libraryBusy || !canvas.drawings?.controlled?.length
					|| !game.user.can('FILES_BROWSE') || !game.user.can('FILES_UPLOAD') || !game.settings.get(MODULE, LIBRARY_FOLDER),
			}),
			iconButton('librarySaveProject', 'fas fa-file-circle-plus', tr('SaveProject'), {
				text: tr('SaveProject'), disabled: !!this._libraryBusy || !canvas.ready || !canvas.level?.id
					|| !game.user.can('FILES_BROWSE') || !game.user.can('FILES_UPLOAD') || !game.settings.get(MODULE, LIBRARY_FOLDER),
			}),
			iconButton('libraryManage', 'fas fa-sliders', tr('Manage'), { pressed: !!this._libraryManage }),
			iconButton('libraryRemoved', 'fas fa-box-archive', tr('CatalogRemovedView'), { pressed: !!this._libraryRemoved }),
			iconButton('artworkPublish', 'fas fa-file-image', game.i18n.localize('FOUNDRYSHOP.Publication.Title'), {
				text: game.i18n.localize('FOUNDRYSHOP.Publication.Title'),
				disabled: !!this._libraryBusy || this._busy || !canvas.ready || !canvas.level?.id,
			}),
			iconButton('artworkSvg', 'fas fa-bezier-curve', game.i18n.localize('FOUNDRYSHOP.Publication.SVGTitle'), {
				text: game.i18n.localize('FOUNDRYSHOP.Publication.SVGTitle'),
				disabled: !!this._libraryBusy || this._busy || !canvas.ready || !canvas.level?.id,
			}),
		]), help(tr('Scope')));
		const root = game.settings.get(MODULE, LIBRARY_FOLDER);
		section.append(el('p', { role: 'status', text: this._libraryBusy ? tr('Loading')
			: this._libraryError || (!root ? tr('Configure') : this._libraryEntries === undefined || this._libraryRoot !== root ? tr('RefreshHint')
				: `${this._libraryEntries.length} ${tr('Files')}`) }));
		section.append(el('input', { type: 'search', value: this._libraryQuery ?? '', placeholder: tr('Search'),
			'aria-label': tr('Search'), dataset: { librarySearch: '' } }));
		section.append(el('select', { 'aria-label': tr('Kind'), dataset: { libraryKind: '' } },
			['', 'project', 'shape'].map(kind => el('option', {
				value: kind, text: tr(kind === 'project' ? 'Projects' : kind === 'shape' ? 'Shapes' : 'AllKinds'),
				selected: (this._libraryKind ?? '') === kind,
			}))));
		const entries = this.#libraryEntries();
		const visible = new Set(searchProjectLibrary(entries, this._libraryQuery ?? '').map(entry => entry.path));
		const cards = el('div', { className: 'fshop-library-cards' });
		for (const [index, entry] of entries.entries()) {
			const card = el('article', { className: 'fshop-library-card',
				hidden: !visible.has(entry.path) || !!this._libraryKind && entry.kind !== this._libraryKind
					|| !entry.repair && !!entry.removed !== !!this._libraryRemoved,
				dataset: { libraryPath: entry.path } });
			const action = entry.kind === 'shape' ? 'libraryPlace' : 'libraryImport';
			if (!entry.error && !entry.removed) {
				const preview = el('button', { type: 'button', className: 'fshop-starter-preview',
					'aria-label': `${tr(entry.kind === 'shape' ? 'PlaceShape' : 'Import')}: ${entry.name}`,
					dataset: { action, libraryIndex: String(index),
						...(entry.builtinId ? { previewProject: entry.builtinId } : entry.kind === 'shape' && !entry.thumbnail
							? { previewLibrary: String(index) } : {}) }, disabled: !!this._libraryBusy });
				if (entry.thumbnail) preview.append(el('img', {
					src: `data:image/webp;base64,${entry.thumbnail.data}`, alt: '', loading: 'lazy',
					width: entry.thumbnail.width, height: entry.thumbnail.height, dataset: { libraryImage: '' },
				}));
				else preview.append(el('span', { text: entry.name }));
				card.append(preview);
			}
			card.append(el('strong', { text: entry.name }), el('small', { text: entry.path }),
				el('small', { text: tr(entry.kind === 'shape' ? 'Shapes' : 'Projects') }),
				el('small', { text: tr(entry.builtinId ? 'BuiltIn' : 'SavedFile') }),
				el('p', { className: 'fshop-tb-hint', role: 'status', dataset: { libraryImageStatus: '' },
					text: entry.error || (entry.thumbnail || entry.builtinId || entry.kind === 'shape'
						? tr('ThumbnailScope') : tr('NoThumbnail')) }));
			if (entry.category) card.append(el('small', { text: entry.category }));
			if (entry.tags?.length) card.append(el('small', { text: entry.tags.join(', ') }));
			if (entry.removed) card.append(el('p', { className: 'fshop-tb-hint',
				text: tr(entry.catalogChanged ? 'CatalogChanged' : 'CatalogRemoved') }));
			if (this._libraryManage && !entry.builtinId) {
				const dataset = { libraryIndex: String(index) };
				if (entry.repair) card.append(iconButton('libraryRepair', 'fas fa-triangle-exclamation', tr('Repair'),
					{ text: tr('Repair'), dataset, disabled: !!this._libraryBusy || !game.user.can('SETTINGS_MODIFY') }));
				else if (!entry.error && entry.removed) card.append(iconButton('libraryRestore', 'fas fa-box-open', tr('CatalogRestore'),
					{ text: tr('CatalogRestore'), dataset, disabled: !!this._libraryBusy || !game.user.can('SETTINGS_MODIFY') }));
				else if (!entry.error) card.append(el('div', { className: 'fshop-tb-row' }, [
					iconButton('libraryEdit', 'fas fa-pen', tr('Edit'), { dataset, disabled: !!this._libraryBusy
						|| !game.user.can('FILES_UPLOAD') || !game.user.can('SETTINGS_MODIFY') }),
					iconButton('libraryDuplicate', 'fas fa-clone', tr('DuplicateEntry'), { dataset,
						disabled: !!this._libraryBusy || !game.user.can('FILES_UPLOAD') }),
					iconButton('libraryRemove', 'fas fa-box-archive', tr('CatalogRemove'), { dataset,
						disabled: !!this._libraryBusy || !game.user.can('SETTINGS_MODIFY') }),
				]));
			}
			if (!entry.error) card.append(el('div', { className: 'fshop-tb-row' }, [
				el('span', { text: `${entry.drawings} ${game.i18n.localize('FOUNDRYSHOP.Project.Drawings')}` }),
				...(entry.builtinId ? [iconButton('starterProjectDownload', 'fas fa-download',
					game.i18n.localize('FOUNDRYSHOP.Examples.Download'), {
						dataset: { projectId: entry.builtinId }, disabled: !!this._libraryBusy,
					})] : []),
			]));
			cards.append(card);
		}
		section.append(cards);
		return section;
	}

	#filterLibrary(root) {
		const visible = new Set(searchProjectLibrary(this.#libraryEntries(), this._libraryQuery ?? '')
			.filter(entry => (!this._libraryKind || entry.kind === this._libraryKind)
				&& (entry.repair || !!entry.removed === !!this._libraryRemoved)).map(entry => entry.path));
		for (const card of root.querySelectorAll('[data-library-path]')) card.hidden = !visible.has(card.dataset.libraryPath);
	}

	#libraryEntries() {
		const builtin = starterProjects().map(({ id, project }) => ({
			path: `builtin:${id}`, builtinId: id, kind: 'project', name: project.name,
			drawings: project.drawings.length, thumbnail: null, tags: ['example', 'built-in'],
		}));
		const root = game.settings.get(MODULE, LIBRARY_FOLDER);
		return [...builtin, ...(root && this._libraryRoot === root ? this._libraryEntries ?? [] : [])];
	}

	static async #onLibrarySave(event, target) {
		if (this._libraryBusy || this._busy) return;
		this._libraryBusy = true;
		this._libraryError = '';
		this._libraryController?.abort();
		const controller = this._libraryController = new AbortController();
		try {
			const root = game.settings.get(MODULE, LIBRARY_FOLDER);
			const entry = await promptLibrarySave(target?.dataset.action === 'librarySaveProject' ? 'project' : 'shape', {
				signal: controller.signal, isOpen: () => !this._closing,
			});
			if (!entry) return;
			this._libraryRoot = root;
			ui.notifications.info(game.i18n.localize('FOUNDRYSHOP.Library.Saved'));
			this._libraryEntries = undefined;
			try {
				this._libraryEntries = await indexProjectLibrary(controller.signal);
				if (game.settings.get(MODULE, LIBRARY_FOLDER) !== root) throw new Error(game.i18n.localize('FOUNDRYSHOP.Library.Changed'));
			} catch (error) {
				throw new Error(`${game.i18n.localize('FOUNDRYSHOP.Library.RefreshAfterSave')} ${entry.path}: ${error.message}`, { cause: error });
			}

		} catch (error) {
			this._libraryError = error.message;
			Drawing_Toolbox.reportError(error);
		} finally {
			if (this._libraryController === controller) this._libraryController = null;
			this._libraryBusy = false;
			if (this.rendered && !this._closing) await this.render();
		}
	}

	static async #onLibraryManage() {
		this._libraryManage = !this._libraryManage;
		await this.render();
	}

	static async #onLibraryRemoved() {
		this._libraryRemoved = !this._libraryRemoved;
		if (this._libraryRemoved) this._libraryManage = true;
		await this.render();
	}

	static async #onArtworkPublish(event, target) {
		if (this._libraryBusy || this._busy) return;
		this._libraryBusy = true;
		const controller = this._libraryController = new AbortController();
		try {
			await promptArtworkPublication({ signal: controller.signal, isOpen: () => !this._closing,
				format: target?.dataset.action === 'artworkSvg' ? 'svg' : 'webp' });
		} catch (error) { Drawing_Toolbox.reportError(error); }
		finally {
			if (this._libraryController === controller) this._libraryController = null;
			this._libraryBusy = false;
			if (this.rendered && !this._closing) await this.render();
		}
	}

	static async #onLibraryManagement(event, target) {
		if (this._libraryBusy || this._busy) return;
		const entry = this.#libraryEntries()[Number(target.dataset.libraryIndex)];
		this._libraryBusy = true; this._libraryError = '';
		this._libraryController?.abort();
		const controller = this._libraryController = new AbortController();
		try {
			const action = { libraryEdit: 'edit', libraryDuplicate: 'duplicate', libraryRepair: 'repair',
				libraryRemove: 'remove', libraryRestore: 'restore' }[target.dataset.action];
			const saved = await promptLibraryManagement(action, entry, { signal: controller.signal, isOpen: () => !this._closing });
			if (!saved) return;
			this._libraryEntries = undefined;
			ui.notifications.info(game.i18n.localize('FOUNDRYSHOP.Library.Managed'));
			try {
				this._libraryRoot = saved.root;
				this._libraryEntries = await indexProjectLibrary(controller.signal);
				if (game.settings.get(MODULE, LIBRARY_FOLDER) !== saved.root) throw new Error(game.i18n.localize('FOUNDRYSHOP.Library.Changed'));
			} catch (error) {
				throw new Error(`${game.i18n.localize('FOUNDRYSHOP.Library.RefreshAfterManage')} ${saved.path}: ${error.message}`, { cause: error });
			}
		} catch (error) {
			this._libraryError = error.message;
			this._libraryEntries = undefined;
			Drawing_Toolbox.reportError(error);
		} finally {
			if (this._libraryController === controller) this._libraryController = null;
			this._libraryBusy = false;
			if (this.rendered && !this._closing) await this.render();
		}
	}

	static async #onLibraryAction(event, target) {
		try {
			if (!game.user.isGM) throw new Error(game.i18n.localize('FOUNDRYSHOP.Layers.GMOnly'));
			if (this._libraryBusy) return;
			this._libraryController?.abort();
			const controller = this._libraryController = new AbortController();
			this._libraryBusy = true; this._libraryError = '';
			if (target.dataset.action === 'libraryRefresh') {
				this._libraryEntries = undefined;
				this._libraryRoot = game.settings.get(MODULE, LIBRARY_FOLDER);
				await this.render();
				const entries = await indexProjectLibrary(controller.signal);
				if (!controller.signal.aborted) this._libraryEntries = entries;
			} else {
				const entry = this.#libraryEntries()[Number(target.dataset.libraryIndex)];
				if (!entry) throw new Error(game.i18n.localize('FOUNDRYSHOP.Library.Changed'));
				const scene = canvas.scene, levelId = canvas.level?.id, revision = readLayerTree(scene).revision;
				const gridSize = scene.grid?.type === 0 ? 100 : Number(scene.grid?.size ?? 100);
				const content = entry.builtinId ? starterProject(entry.builtinId)
					: target.dataset.action === 'libraryPlace' ? await readLibraryShape(entry, controller.signal)
					: await readLibraryProject(entry, controller.signal);
				if (controller.signal.aborted || canvas.scene !== scene || canvas.level?.id !== levelId) {
					throw new Error(game.i18n.localize('FOUNDRYSHOP.Library.Changed'));
				}
				if (target.dataset.action === 'libraryPlace') {
					if (gridSize !== (scene.grid?.type === 0 ? 100 : Number(scene.grid?.size ?? 100))) {
						throw new Error(game.i18n.localize('FOUNDRYSHOP.Library.Changed'));
					}
					loadShapeStamp(content, { gridSize });
					await armCopiedStamp(this._stampOptions);
				} else await promptProjectImport(scene, revision, content);
			}
		} catch (error) {
			if (!this._libraryController?.signal.aborted) {
				this._libraryError = error.message;
				Drawing_Toolbox.reportError(error);
			}
		} finally {
			this._libraryBusy = false;
			if (this.rendered && !this._closing && !this._libraryController?.signal.aborted) await this.render();
		}
	}

	#renderStamps() {
		const tr = key => game.i18n.localize(`FOUNDRYSHOP.Stamps.${key}`);
		const state = getStampState();
		const section = el('div', { className: 'fshop-tb-section' }, [
			help(tr('Hint')),
			el('div', { className: 'fshop-tb-row' }, [
				iconButton('stampCopy', 'fas fa-copy', tr('Copy'), { text: tr('Copy'), disabled: state.busy }),
				iconButton('stampImage', 'fas fa-image', tr('Import'), { text: tr('Import'), disabled: state.busy }),
				iconButton('stampPaste', 'fas fa-paste', tr('Paste'), { text: tr('Paste'), disabled: state.busy }),
			]),
			el('span', { text: state.copied || tr('NoCopy') }),
		]);
		for (const [key, min, max, step] of [['scale', 0.05, 20, 0.05], ['rotation', -360, 360, 1]]) {
			section.append(el('label', { className: 'fshop-tb-row', text: tr(key) }, [
				el('input', { type: 'number', min, max, step, value: this._stampOptions[key], dataset: { stampOption: key } }),
			]));
		}
		section.append(el('label', { className: 'fshop-tb-row', text: tr('Repeat') }, [
			el('input', { type: 'checkbox', checked: this._stampOptions.repeat, dataset: { stampOption: 'repeat' } }),
		]));
		section.append(el('button', { type: 'button', className: 'fshop-starter-preview',
			'aria-label': `${tr('Place')}: ${state.copied || tr('NoCopy')}`,
			dataset: { action: 'stampArm', ...(state.copied ? { previewStamp: 'copied' } : {}) },
			disabled: !state.copied || state.busy }, [el('span', { text: state.copied || tr('NoCopy') })]));
		return section;
	}

	static async #onStampAction(event, target) {
		if (this._busy) return;
		this._busy = true;
		try {
			const action = target.dataset.action;
			if (action === 'stampCancel') cancelStamp();
			else if (action === 'stampCopy') copySelectedStamp();
			else {
				if (action === 'stampImage') {
					const file = await FoundryshopDialog.prompt({
						window: { title: 'FOUNDRYSHOP.Stamps.Import' },
						content: '<input type="file" name="image" accept="image/png,image/jpeg,image/webp" required>',
						ok: { label: 'FOUNDRYSHOP.Stamps.Import', callback: (event, button, dialog) =>
							dialog.element.querySelector('input[name="image"]').files[0] },
						rejectClose: false,
					});
					if (!file) return;
					await importImageStamp(file);
				} else if (action === 'stampPaste') await pasteImageStamp();
				await armCopiedStamp(this._stampOptions);
			}
			await this.render();
		} catch (error) { Drawing_Toolbox.reportError(error); }
		finally { this._busy = false; }
	}
	#onWidthWheel(event) {
		// Shift+wheel is reported as horizontal scrolling by some browsers.
		const delta = event.deltaY || event.deltaX;
		if (!delta) return;
		event.preventDefault();
		const step = (delta < 0 ? 1 : -1) * (event.shiftKey ? 5 : 1);
		const current = this._wheelWidth ?? (Number(readDrawingConfig().strokeWidth) || 0);
		this.#previewWidth(current + step);
	}

	/** Show a width immediately and write it once input pauses. */
	#previewWidth(width) {
		this._wheelWidth = Math.max(0, Math.floor(Number(width) || 0));
		const value = this.element.querySelector('.fshop-tb-width .fshop-tb-value');
		if (value) value.textContent = String(this._wheelWidth);
		const slider = this.element.querySelector('input[data-width-slider]');
		if (slider && Number(slider.value) !== this._wheelWidth) {
			if (this._wheelWidth > Number(slider.max)) slider.max = String(this._wheelWidth);
			slider.value = String(this._wheelWidth);
		}
		this.#commitWheelWidth();
	}

	async #applyBrushPreset(id) {
		if (!id) return;
		try {
			const preset = readBrushPresets().find(entry => entry.id === id);
			if (!preset) throw new Error(game.i18n.localize('FOUNDRYSHOP.BrushPresets.Changed'));
			this._wheelWidth = undefined;
			await this.#persist(presetApplyPatch(preset));
		} catch (error) { Drawing_Toolbox.reportError(error); }
		this.render();
	}

	// Wheel ticks arrive rapidly; show them immediately but write the setting once scrolling pauses.
	#commitWheelWidth = foundry.utils.debounce(async () => {
		const strokeWidth = this._wheelWidth;
		if (strokeWidth === undefined) return;
		try {
			await this.#persist({ strokeWidth });
		} finally {
			if (this._wheelWidth === strokeWidth) this._wheelWidth = undefined;
		}
		this.render();
	}, 200);

	#clampToViewport() {
		const { left, top, width, height } = this.position;
		const bounds = this.element.getBoundingClientRect();
		const maxLeft = Math.max(0, window.innerWidth - (bounds.width || Number(width) || 0));
		const maxTop = Math.max(0, window.innerHeight - (bounds.height || Number(height) || 0));
		const clamped = { left: Math.min(Math.max(0, left ?? 0), maxLeft), top: Math.min(Math.max(0, top ?? 0), maxTop) };
		if (clamped.left !== left || clamped.top !== top) this.setPosition(clamped);
	}

	_onPosition(position) {
		super._onPosition?.(position);
		this.#positionFlyout();
		this.#saveState();
	}

	_updatePosition(position) {
		const width = this.element?.offsetWidth, height = this.element?.offsetHeight;
		const result = super._updatePosition(position);
		if (!this.element) return result;
		// Native auto-size bounds already include the previous transform scale.
		const scale = result.scale ?? 1;
		result.left = Math.min(Math.max(0, result.left), Math.max(0, window.innerWidth - width * scale));
		result.top = Math.min(Math.max(0, result.top), Math.max(0, window.innerHeight - height * scale));
		return result;
	}

	#saveState = foundry.utils.debounce(() => {
		const { left, top } = this.position ?? {};
		if (!Number.isFinite(left) || !Number.isFinite(top)) return;
		game.settings.set(MODULE, SETTINGS_TOOLBOX_STATE, { left, top, collapsed: this._collapsed, tab: this._tab,
			selectedPalette: this._selectedPalette })
			.catch(Drawing_Toolbox.reportError);
	}, 300);

	async close(options = {}) {
		cancelPathEdit();
		cancelPath();
		this._closing = true;
		this._pairController?.abort();
		this._stopTabletTest?.();
		this._stopTabletTest = null;
		this._materialController?.abort();
		if (this._materialPicker) await this._materialPicker.close();
		this._libraryController?.abort();
		this._layerFlyout = false;
		if (!options.foundryshopHide) Drawing_Toolbox._suppressed = true;
		this.#stopPreviews();
		await Promise.all(this._pendingWrites);
		const result = await super.close(options);
		window.removeEventListener('pointerdown', this._dismissFlyout, { capture: true });
		window.removeEventListener('keydown', this._escapeFlyout, { capture: true });
		window.removeEventListener('resize', this._positionFlyout);
		this._flyoutResize?.disconnect();
		this._layerFlyout = false;
		cancelStamp();
		if (Drawing_Toolbox._instance === this) Drawing_Toolbox._instance = null;
		this._closing = false;
		return result;
	}

	#applyAppearance(context) {
		const root = this.element;
		const theme = resolveToolboxTheme(context.theme);
		root.setAttribute('data-toolbox-theme', theme);
		root.setAttribute('data-layer-flyout', String(this._layerFlyout));
		root.style.setProperty('--by-tb-size', `${context.density === 'compact' ? 28 : context.density === 'comfortable' ? 36 : 44}px`);
		root.style.setProperty('--by-tb-gap', `${context.density === 'compact' ? 3 : context.density === 'comfortable' ? 4 : 6}px`);
		const scale = validateToolboxScale(context.scale ?? TOOLBOX_SCALE.default) / 100;
		root.style.setProperty('--fshop-scale', scale);
		if (this.position.scale !== scale) this.setPosition({ scale });
		if (this._systemThemeClass) root.classList.remove(this._systemThemeClass);
		this._systemThemeClass = null;
		const system = game.system?.id;
		if (theme === 'system' && typeof system === 'string' && /^[a-zA-Z0-9_-]+$/.test(system)) {
			root.classList.add(system);
			this._systemThemeClass = system;
		}
	}

	#positionFlyout() {
		const panel = this.element?.querySelector('.fshop-tb-layer-flyout');
		const tools = this.element?.querySelector('.fshop-tb-tools');
		if (!panel || !tools) return;
		const parent = panel.offsetParent ?? this.element;
		const windowRect = parent.getBoundingClientRect();
		const button = tools.querySelector('[data-action="layers"]').getBoundingClientRect();
		this._flyoutAnchor ??= { x: button.right, y: button.top };
		const anchor = this._flyoutAnchor;
		const rect = panel.getBoundingClientRect();
		const position = flyoutPosition({ left: anchor.x, right: anchor.x, top: anchor.y },
			{ width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight });
		const scaleX = windowRect.width / parent.offsetWidth || 1;
		const scaleY = windowRect.height / parent.offsetHeight || 1;
		panel.style.left = `${(position.left - windowRect.left) / scaleX - parent.clientLeft}px`;
		panel.style.top = `${(position.top - windowRect.top) / scaleY - parent.clientTop}px`;
		panel.dataset.side = position.side;
	}

	#stopPreviews() {
		this._previewAbort?.abort();
		this._previewObserver?.disconnect();
		this._previewAbort = null;
		this._previewObserver = null;
	}

	#startPreviews(root) {
		this.#stopPreviews();
		const slots = [...root.querySelectorAll('[data-preview-pair]'), ...root.querySelectorAll('[data-preview-layer]'), ...root.querySelectorAll('[data-preview-shape]'),
			...root.querySelectorAll('[data-preview-project]'), ...root.querySelectorAll('[data-preview-library]'),
			...root.querySelectorAll('[data-preview-stamp]')];
		if (!slots.length) return;
		const scene = canvas.scene, levelId = canvas.level?.id;
		const abort = this._previewAbort = new AbortController();
		const update = async slot => {
			try {
				const pair = slot.dataset.previewPair ? effectivePalettes()
					.find(palette => palette.id === slot.dataset.pairPalette)?.colors.find(entry => entry.id === slot.dataset.previewPair) : null;
				const snapshot = slot.dataset.previewPair ? appearanceSample(pair,
					{ strokeWidth: 0, strokeAlpha: 0, fillAlpha: 1 }, scene)
					: slot.dataset.previewShape ? starterShape(slot.dataset.previewShape).project.drawings
					: slot.dataset.previewStamp ? copiedStampSnapshot()
					: slot.dataset.previewProject ? starterProject(slot.dataset.previewProject).drawings
					: slot.dataset.previewLibrary ? (await readLibraryShape(this.#libraryEntries()[Number(slot.dataset.previewLibrary)], abort.signal)).project.drawings
					: layerArtworkSnapshot(scene, slot.dataset.previewLayer, levelId);
				const result = await renderArtworkPreview(snapshot, { signal: abort.signal });
				if (abort.signal.aborted || canvas.scene !== scene || canvas.level?.id !== levelId || !slot.isConnected) return;
				const key = result.empty ? 'Empty' : 'Artwork';
				const label = game.i18n.localize(`FOUNDRYSHOP.Preview.${key}`);
				slot.dataset.previewState = result.empty ? 'empty' : 'ready';
				if (slot.tagName !== 'BUTTON') slot.setAttribute('aria-label', label);
				slot.replaceChildren(result.empty ? el('i', { className: 'far fa-square', 'aria-hidden': 'true' })
					: el('img', { src: result.src, alt: '', width: result.width, height: result.height, draggable: 'false' }));
			} catch (failure) {
				if (abort.signal.aborted) return;
				const message = `${game.i18n.localize('FOUNDRYSHOP.Preview.Failed')} ${failure.message}`;
				slot.dataset.previewState = 'error';
				slot.setAttribute('title', message);
				slot.setAttribute('aria-label', message);
				slot.replaceChildren(el('i', { className: 'fas fa-triangle-exclamation', 'aria-hidden': 'true' }));
				console.warn('Foundryshop | Artwork preview failed:', failure);
			}
		};
		this._previewObserver = new IntersectionObserver(entries => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				this._previewObserver?.unobserve(entry.target);
				void update(entry.target);
			}
		}, { root: root.querySelector('[data-preview-shape]') ? null : root.querySelector('.fshop-tb-flyout-stack'), rootMargin: '44px' });
		for (const slot of slots) this._previewObserver.observe(slot);
	}

	static async #onRefreshPreviews() {
		clearArtworkPreviewCache();
		await this.render();
	}

	#persist(patch, { reportErrors = true } = {}) {
		this._pairController?.abort();
		const write = updateDrawingConfig(patch, { source: 'toolbox' }).then(async () => {
			const colors = Object.entries(patch).filter(([key]) => ['strokeColor', 'fillColor'].includes(key)).map(([, color]) => toHex(color));
			if (colors.length) {
				const current = game.settings.get(MODULE, SETTINGS_RECENT_COLORS) ?? [];
				const limit = game.settings.get(MODULE, SETTINGS_RECENT_COLOR_HISTORY) ?? 10;
				await game.settings.set(MODULE, SETTINGS_RECENT_COLORS, [...new Set([...colors, ...current])].slice(0, limit));
			}
		}).catch(error => {
			if (!reportErrors) throw error;
			Drawing_Toolbox.reportError(error);
		});
		this._pendingWrites.add(write);
		write.then(() => this._pendingWrites.delete(write), () => this._pendingWrites.delete(write));
		return write;
	}

	static #canEditDrawing(document) {
		return !!document && !document.locked && !isDrawingLayerLocked(document)
			&& document.canUserModify(game.user, 'update');
	}

	// --- Actions (this = app) ---

	static async #onTabletBindings() {
		try { await openTabletBindings(); }
		catch (error) { Drawing_Toolbox.reportError(error); }
	}

	static async #onPairReturn() {
		this._pairController?.abort();
		clearAppearanceOverride();
		await this.render();
	}

	static async #onPairAction(event, target) {
		if (this._busy) return;
		this._pairController?.abort();
		this._busy = true;
		const controller = this._pairController = new AbortController();
		try {
			if (!game.user.isGM) throw new Error(game.i18n.localize('FOUNDRYSHOP.Palettes.GMOnly'));
			const before = readSharedPalettes();
			const palette = effectivePalettes(before).find(entry => entry.id === target.dataset.paletteId);
			if (!palette) throw new Error(game.i18n.localize('FOUNDRYSHOP.Palettes.Changed'));
			const source = palette.colors.find(entry => entry.id === target.dataset.id);
			if (target.dataset.id && !source) throw new Error(game.i18n.localize('FOUNDRYSHOP.Palettes.Changed'));
			const config = readDrawingConfig();
			const initial = source?.kind === 'pair' ? { ...source }
				: { strokeColor: source?.color ?? config.strokeColor, fillColor: source?.color ?? config.fillColor, fillType: config.fillType };
			if (target.dataset.action === 'pairDuplicate') initial.name = '';
			const result = await promptAppearance(initial, config);
			if (!result) return;
			await verifyAppearance(result, { signal: controller.signal });
			if (controller.signal.aborted || this._closing || !game.user.isGM) throw new Error(game.i18n.localize('FOUNDRYSHOP.Pairs.Changed'));
			await saveSharedAppearance(palette.id, result, before.revision,
				target.dataset.action === 'pairEdit' ? source?.id : null);
			await this.render();
		} catch (error) {
			if (!controller.signal.aborted) Drawing_Toolbox.reportError(error);
		} finally { this._busy = false; if (this._pairController === controller) this._pairController = null; }
	}

	static async #onApplyMaterialSelection() {
		if (this._materialApplying) return;
		this._materialApplying = true;
		try {
			if (!Drawing_Toolbox.canShow()) throw new Error(game.i18n.localize('FOUNDRYSHOP.Materials.Unavailable'));
			const scene = canvas.scene, level = canvas.level?.id, config = readDrawingConfig();
			const documents = (canvas.drawings.controlled ?? []).map(object => object.document);
			const ids = documents.map(document => document.id).sort();
			const plan = prepareMaterialSelection(scene, documents, config);
			const confirmed = await FoundryshopDialog.confirm({
				window: { title: game.i18n.localize('FOUNDRYSHOP.Materials.ApplySelection') },
				content: game.i18n.format('FOUNDRYSHOP.Materials.ApplyConfirm', { count: documents.length }),
				rejectClose: false,
			});
			if (!confirmed) return;
			await applyMaterialSelection(plan, { checkContext: () => {
				const currentIds = (canvas.drawings?.controlled ?? []).map(object => object.document.id).sort();
				if (this._closing || !Drawing_Toolbox.canShow() || canvas.scene !== scene || canvas.level?.id !== level
					|| JSON.stringify(currentIds) !== JSON.stringify(ids)
					|| JSON.stringify(readDrawingConfig()) !== JSON.stringify(config)) {
					throw new Error(game.i18n.localize('FOUNDRYSHOP.Materials.SelectionChanged'));
				}
			} });
			this._materialApplying = false;
			await this.render();
		} catch (error) { Drawing_Toolbox.reportError(error); }
		finally { this._materialApplying = false; }
	}

	async #selectMaterial(path, scene, level, before) {
		this._materialController?.abort();
		const controller = this._materialController = new AbortController();
		try {
			await verifyLocalMaterial(path, { signal: controller.signal });
			if (controller.signal.aborted || this._closing) return;
			if (!Drawing_Toolbox.canShow() || canvas.scene !== scene || canvas.level?.id !== level
				|| JSON.stringify(readDrawingConfig()) !== before) {
				throw new Error(game.i18n.localize('FOUNDRYSHOP.Materials.Changed'));
			}
			await this.#persist({ texture: path, fillType: 2 }, { reportErrors: false });
			await this.render();
		} catch (error) {
			if (!controller.signal.aborted) Drawing_Toolbox.reportError(error);
		} finally {
			if (this._materialController === controller) this._materialController = null;
		}
	}

	static async #onMaterialAction(event, target) {
		const tr = key => game.i18n.localize(`FOUNDRYSHOP.Materials.${key}`);
		try {
			if (!Drawing_Toolbox.canShow()) throw new Error(tr('Unavailable'));
			if (target.dataset.action === 'materialChoose') {
				this._materialExpanded = !this._materialExpanded;
				await this.render();
				return;
			}
			if (target.dataset.action === 'materialClear') {
				this._materialController?.abort();
				await this.#persist({ texture: null, fillType: 1 }, { reportErrors: false });
				await this.render();
				return;
			}
			const scene = canvas.scene, level = canvas.level?.id;
			const before = JSON.stringify(readDrawingConfig());
			if (target.dataset.action === 'materialSelect') {
				const material = STARTER_MATERIALS.find(entry => entry.id === target.dataset.materialId);
				if (!material) throw new Error(tr('Unknown'));
				await this.#selectMaterial(material.path, scene, level, before);
				return;
			}
			if (this._materialPicker?.rendered) return this._materialPicker.bringToFront();
			const Picker = foundry.applications.apps.FilePicker.implementation;
			this._materialPicker = new Picker({
				type: 'image', current: readDrawingConfig().texture ?? '',
				callback: path => this.#selectMaterial(path, scene, level, before),
			});
			const picker = this._materialPicker;
			picker.addEventListener('close', () => {
				if (this._materialPicker === picker) this._materialPicker = null;
			}, { once: true });
			await picker.render({ force: true });
		} catch (error) { Drawing_Toolbox.reportError(error); }
	}

	static async #onTool(event, target) {
		cancelPath();
		cancelStamp();
		disarmLabel();
		await ui.controls.activate({ control: 'drawings', tool: target.dataset.tool });
	}

	static async #onPathArm() {
		try {
			cancelPath();
			await ui.controls.activate({ control: 'drawings', tool: 'select' });
			armPath();
			this._tab = 'brush'; this._collapsed = false;
			await this.render();
			this.element.querySelector('.fshop-path-controls')?.scrollIntoView?.({ block: 'nearest' });
		} catch (error) { Drawing_Toolbox.reportError(error); }
	}
	static async #onPathFinish() {
		try { await finishPath(); } catch (error) { Drawing_Toolbox.reportError(error); }
	}
	static #onPathCancel() { cancelPath(); }

	static async #onPathEditorAction(event, target) {
		try {
			switch (target.dataset.action) {
				case 'pathEdit': beginPathEdit(target.dataset.pathId); break;
				case 'pathSelectWhole': selectWholePath(target.dataset.pathId); break;
				case 'pathEditApply': await applyPathEdit(); break;
				case 'pathEditCancel': cancelPathEdit(); break;
				case 'pathPointDelete': deletePathWaypoint(); break;
				case 'pathPointInsert': togglePathInsertion(); break;
				case 'pathDraftUndo': undoPathDraft(); break;
				case 'pathDraftRedo': undoPathDraft(true); break;
			}

			await this.render();
			this.element.querySelector('.fshop-path-editor')?.scrollIntoView?.({ block: 'nearest' });
		} catch (error) { Drawing_Toolbox.reportError(error); }
	}

	static async #onWholePathAction(event, target) {
		if (this._busy) return;
		const scene = canvas.scene, levelId = canvas.level?.id, action = target.dataset.action;
		const tr = key => game.i18n.localize(`FOUNDRYSHOP.Paths.${key}`);
		const current = () => canvas.ready && canvas.scene === scene && canvas.drawings.active && canvas.level?.id === levelId;
		this._busy = true;
		try {
			if (!current()) throw new Error(tr('EditorChanged'));
			const editor = getPathEditorState();
			if ((action !== 'pathTranslate' && editor.active) || editor.pending) throw new Error(tr('EditorChanged'));
			if (action === 'pathConflict') {
				const snapshot = pathConflictSnapshot(scene, target.dataset.pathId);
				if (snapshot.intact) throw new Error(tr('EditorChanged'));
				const content = el('div', {}, [
					el('p', { text: game.i18n.format('FOUNDRYSHOP.Paths.ConflictHint', { name: snapshot.route.name }) }),
					el('ul', {}, snapshot.issues.map(issue => el('li', { text: `${tr(`Issue.${issue.kind}`)}: ${issue.id}` }))),
					el('p', { text: tr('ConflictDetachHint') }),
				]);
				const confirmed = await FoundryshopDialog.confirm({ window: { title: tr('ConflictReview') }, content,
					modal: true, rejectClose: false, yes: { label: tr('Detach') }, no: { label: tr('Cancel') } });
				if (confirmed) {
					if (!current()) throw new Error(tr('EditorChanged'));
					await detachConflictingPath(scene, snapshot.route.id, { expectedSnapshot: snapshot, isCurrent: current });
				}
			} else if (action === 'pathUndo' || action === 'pathRedo') {
				await (action === 'pathUndo' ? undoRetainedPath : redoRetainedPath)(scene, { isCurrent: current });
			} else if (action === 'pathTranslate' || action === 'pathDuplicate') {
				const original = action === 'pathDuplicate' ? inspectPathIntegrity(scene, target.dataset.pathId).route : null;
				if (action === 'pathTranslate' && !editor.active) throw new Error(tr('EditorChanged'));
				const content = el('div', {}, ['x', 'y'].map(axis => el('label', { text: tr(axis === 'x' ? 'OffsetX' : 'OffsetY') }, [
					el('input', { name: axis, type: 'number', value: action === 'pathDuplicate' ? canvas.grid.size : 0, step: 1, required: true }),
				])));
				const offset = await FoundryshopDialog.prompt({ window: { title: tr(action === 'pathDuplicate' ? 'Duplicate' : 'Translate') },
					content, modal: true, rejectClose: false, ok: { callback: (event, button) => {
						const x = button.form.elements.x.value, y = button.form.elements.y.value;
						if (!x.trim() || !y.trim() || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) throw new Error(tr('EditorCoordinate'));
						return { x: Number(x), y: Number(y) };
					} } });
				if (offset !== null && offset !== undefined) {
					if (!current()) throw new Error(tr('EditorChanged'));
					if (action === 'pathTranslate') {
						const latest = getPathEditorState();
						if (!latest.active || latest.id !== editor.id || JSON.stringify(latest.recipe) !== JSON.stringify(editor.recipe)) throw new Error(tr('EditorChanged'));
						translatePathEdit(offset.x, offset.y);
					} else await duplicateRetainedPath(scene, original.id, { expectedRevision: original.revision, dx: offset.x, dy: offset.y, isCurrent: current });
				}
			} else {
				const original = inspectPathIntegrity(scene, target.dataset.pathId).route;
				const detach = action === 'pathDetach';
				if (action !== 'pathDeleteWhole' && !detach) throw new Error(tr('EditorChanged'));
				const confirmed = await FoundryshopDialog.confirm({ window: { title: tr(detach ? 'Detach' : 'DeleteWhole') },
					content: el('div', { text: game.i18n.format(`FOUNDRYSHOP.Paths.${detach ? 'DetachConfirm' : 'DeleteConfirm'}`, { name: original.name }) }),
					modal: true, rejectClose: false });
				if (confirmed) {
					if (!current()) throw new Error(tr('EditorChanged'));
					await (detach ? detachRetainedPath : deleteRetainedPath)(scene, original.id,
						{ expectedRevision: original.revision, isCurrent: current });
				}
			}
		} catch (error) { Drawing_Toolbox.reportError(error); }
		finally { this._busy = false; }
		await this.render();
	}

	static #onTarget(event, target) {
		this._target = target.dataset.target;
		this.render();
		Drawing_Toolbox.openDetailedPanel?.(this._target);
	}

	static async #onSwap() {
		const config = readDrawingConfig();
		await this.#persist({ strokeColor: toHex(config.fillColor), fillColor: toHex(config.strokeColor) });
		this.render();
	}

	static async #onNoFill() {
		const config = readDrawingConfig();
		await this.#persist({ fillType: config.fillType === 0 ? (config.texture ? 2 : 1) : 0 });
		this.render();
	}

	static async #onWidth(event, target) {
		const step = Number(target.dataset.delta) * (event.shiftKey ? 5 : 1);
		const base = this._wheelWidth ?? (Number(readDrawingConfig().strokeWidth) || 0);
		this._wheelWidth = undefined;
		await this.#persist({ strokeWidth: Math.max(0, base + step) });
		this.render();
	}

	static async #onWidthSet(event, target) {
		this._wheelWidth = undefined;
		await this.#persist({ strokeWidth: Number(target.dataset.width) });
		this.render();
	}

	static async #onBrushPresetSave() {
		if (this._busy) return;
		this._busy = true;
		try {
			const content = document.createElement('div');
			content.append(el('label', { text: game.i18n.localize('FOUNDRYSHOP.BrushPresets.Name') }, [
				el('input', { type: 'text', name: 'presetName', maxlength: MAX_BRUSH_PRESET_NAME, required: true, autofocus: true }),
			]));
			const name = await FoundryshopDialog.prompt({
				window: { title: loc('BrushPresetSave') }, content, modal: true, rejectClose: false,
				ok: { callback: (event, button) => button.form.elements.presetName.value },
			});
			if (name !== null && name !== undefined) await saveBrushPreset(name, readDrawingConfig());
		} catch (error) { Drawing_Toolbox.reportError(error); }
		finally { this._busy = false; }
		this.render();
	}

	static async #onPathAppearanceAction(event, target) {
		if (this._busy) return;
		const editing = target.dataset.editing === 'true', tr = key => game.i18n.localize(`FOUNDRYSHOP.Paths.${key}`);
		this._busy = true;
		try {
			if (target.dataset.action === 'pathReroll') { if (editing) rerollPathEdit(); else rerollPath(); }
			else if (target.dataset.action === 'pathPresetSave') {
				const state = editing ? getPathEditorState() : getPathState();
				if (state.pending || (editing && !state.active)) throw new Error(tr('EditorChanged'));
				const options = editing ? state.recipe.options : Object.fromEntries(Object.keys(pathOptions()).map(key => [key, state[key]]));
				const closed = editing ? state.recipe.closed : state.closed;
				const content = el('div', {}, [el('label', { text: tr('PresetName') }, [
					el('input', { type: 'text', name: 'presetName', maxlength: MAX_PATH_PRESET_NAME, required: true, autofocus: true }),
				])]);
				const name = await FoundryshopDialog.prompt({ window: { title: tr('PresetSave') }, content, modal: true, rejectClose: false,
					ok: { callback: (event, button) => button.form.elements.presetName.value } });
				if (name !== null && name !== undefined) await savePathPreset(name, options, closed);
			} else {
				const preset = readPathPresets().find(p => p.id === target.dataset.id);
				if (!preset) throw new Error(tr('PresetChanged'));
				if (await FoundryshopDialog.confirm({ window: { title: tr('PresetDelete') }, modal: true, rejectClose: false,
					content: el('div', { text: game.i18n.format('FOUNDRYSHOP.Paths.PresetDeleteConfirm', { name: preset.name }) }) })) await deletePathPreset(preset.id);
			}
		} catch (error) { Drawing_Toolbox.reportError(error); }
		finally { this._busy = false; }
		await this.render();
	}

	static async #onBrushPresetDelete(event, target) {
		if (this._busy) return;
		this._busy = true;
		try {
			const preset = readBrushPresets().find(entry => entry.id === target.dataset.id);
			if (!preset) throw new Error(game.i18n.localize('FOUNDRYSHOP.BrushPresets.Changed'));
			if (await FoundryshopDialog.confirm({ window: { title: loc('BrushPresetDelete') },
				content: el('p', { text: game.i18n.format('FOUNDRYSHOP.BrushPresets.DeleteConfirm', { name: preset.name }) }),
				modal: true, rejectClose: false })) await deleteBrushPreset(preset.id);
		} catch (error) { Drawing_Toolbox.reportError(error); }
		finally { this._busy = false; }
		this.render();
	}

	static async #onUseColor(event, target) {
		const entries = target.dataset.paletteId
			? effectivePalettes().find(palette => palette.id === target.dataset.paletteId)?.colors ?? []
			: readPalette(this._paletteScope).colors;
		const entry = entries.find(color => color.id === target.dataset.id);
		if (!entry) return Drawing_Toolbox.reportError(new Error(game.i18n.localize('FOUNDRYSHOP.Saved.Changed')));
		if (entry.kind === 'pair') {
			this._pairController?.abort();
			const controller = this._pairController = new AbortController();
			const before = JSON.stringify(readDrawingConfig()), revision = readSharedPalettes().revision;
			try {
				await applyAppearance(entry, { signal: controller.signal, checkCurrent: () => !this._closing
					&& JSON.stringify(readDrawingConfig()) === before && readSharedPalettes().revision === revision });
				await this.render();
			} catch (error) { if (!controller.signal.aborted) Drawing_Toolbox.reportError(error); }
			finally { if (this._pairController === controller) this._pairController = null; }
			return;
		}
		const patch = { [`${this._target}Color`]: entry.color };
		// Picking a fill color while "No Fill" is on implies the user wants a visible fill.
		if (this._target === 'fill' && readDrawingConfig().fillType === 0) patch.fillType = readDrawingConfig().texture ? 2 : 1;
		await this.#persist(patch);
		this.render();
	}

	static #onMoreColors() {
		Drawing_Toolbox.openDetailedPanel?.(this._target);
	}

	static async #onLayers(event) {
		if (!game.user.isGM) return;
		this._layerFlyout = !this._layerFlyout;
		this._flyoutAnchor = this._layerFlyout && event?.detail !== 0
			&& Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)
			? { x: event.clientX, y: event.clientY } : null;
		await this.render();
	}

	static async #onScalePreset(event, target) {
		try {
			await game.settings.set(MODULE, SETTINGS_TOOLBOX_SCALE, validateToolboxScale(Number(target.dataset.scale)));
			await this.render();
		} catch (error) { Drawing_Toolbox.reportError(error); }
	}

	static async #onFullLayers() {
		if (!game.user.isGM) return;
		this._layerFlyout = false;
		this._tab = 'layers';
		this._collapsed = false;
		this.#saveState();
		await this.render();
	}

	static async #onPanel(event, target) {
		const panel = target.dataset.panel;
		await Drawing_Toolbox.#onTab.call(this, { detail: 1 }, { dataset: { tab: panel } });
		if (event.detail === 0 && !this._closing) this.element.querySelector(`button[data-panel="${panel}"]`)?.focus();
	}

	static async #onSettings() {
		if (!game.user.isGM) return Drawing_Toolbox.reportError(new Error(game.i18n.localize('FOUNDRYSHOP.Layers.GMOnly')));
		if (this._tab === 'settings' && !this._collapsed) this._tab = this._settingsReturn ?? 'brush';
		else {
			if (this._tab !== 'settings') this._settingsReturn = this._tab;
			this._tab = 'settings';
		}
		this._collapsed = false;
		this._layerFlyout = false;
		this.#saveState();
		await this.render();
	}

	static async #onTab(event, target) {
		const tab = target.dataset.tab;
		if (!TOOLBOX_TABS.includes(tab)) return Drawing_Toolbox.reportError(new Error('Invalid toolbox tab.'));
		if (!game.user.isGM) return Drawing_Toolbox.reportError(new Error(game.i18n.localize('FOUNDRYSHOP.Layers.GMOnly')));
		this._tab = tab;
		this._layerFlyout = false;
		this.#saveState();
		await this.render();
		if (event.detail === 0 && !this._closing) {
			this.element.querySelector(`button[data-tab="${tab}"]`)?.focus();
		}
	}

	static async #onPaletteAction(event, target) {
		if (this._busy) return;
		this._busy = true;
		const scope = this._paletteScope;
		try {
			if (!game.user.isGM) throw new Error(game.i18n.localize('FOUNDRYSHOP.Palettes.GMOnly'));
			if (!canEditPalette(scope)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.GMOnly'));
			const action = target.dataset.action;
			const shared = target.dataset.paletteId ? readSharedPalettes() : null;
			const palette = shared && effectivePalettes(shared).find(palette => palette.id === target.dataset.paletteId);
			if (shared && !palette) throw new Error(game.i18n.localize('FOUNDRYSHOP.Palettes.Changed'));
			const entry = (palette?.colors ?? readPalette(scope).colors).find(color => color.id === target.dataset.id);
			if (['paletteEdit', 'paletteDelete'].includes(action) && !entry) throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.Changed'));
			const Dialog = FoundryshopDialog;
			if (action === 'paletteDelete') {
				if (await Dialog.confirm({ window: { title: loc('PaletteDelete') }, content: loc('PaletteDeleteConfirm'),
					modal: true, rejectClose: false })) {
					if (shared) await removeSharedColor(palette.id, entry.id, shared.revision);
					else await deleteColor(scope, entry);
				}
			} else {
				const content = document.createElement('div');
				const color = entry?.color ?? toHex(readDrawingConfig()[`${this._target}Color`]);
				const fields = action === 'paletteImport' ? [['colors', '', loc('PaletteImportHint')]]
					: [['name', entry?.name ?? suggestedColorName(color), loc('PaletteName')],
						['color', color, loc('PaletteColor')]];
				for (const [name, value, text] of fields) content.append(el('label', { text }, [
					el('input', { name, type: 'text', value, required: name !== 'name' }),
				]));
				const result = await Dialog.prompt({ window: { title: loc(action === 'paletteEdit' ? 'PaletteEdit' : action === 'paletteImport' ? 'PaletteImport' : 'PaletteSave') },
					content, modal: true, rejectClose: false,
					ok: { callback: (event, button) => Object.fromEntries(fields.map(([name]) => [name, button.form.elements[name].value])) } });
				if (result !== null && result !== undefined) {
					if (shared) {
						if (action === 'paletteImport') await importSharedColors(palette.id, result.colors, shared.revision);
						else if (action === 'paletteEdit') await editSharedColor(palette.id, entry.id, result.color, result.name, shared.revision);
						else await saveSharedColor(palette.id, result.color, result.name, shared.revision);
					} else if (action === 'paletteImport') await importPresetColors(scope, result.colors);
					else if (action === 'paletteEdit') await editColor(scope, entry, result.color, result.name);
					else await saveColor(scope, result.color, result.name);
				}
			}
			await this.render();
		} catch (error) { Drawing_Toolbox.reportError(error); }
		finally { this._busy = false; }
	}

	static async #onSharedPalette(event, target) {
		if (this._busy) return;
		this._busy = true;
		const pal = key => game.i18n.localize(`FOUNDRYSHOP.Palettes.${key}`);
		try {
			if (!game.user.isGM) throw new Error(pal('GMOnly'));
			const before = readSharedPalettes();
			const { action, paletteId, id, delta, scope } = target.dataset;
			const palette = effectivePalettes(before).find(entry => entry.id === paletteId);
			if (!['sharedCreate', 'sharedAdopt'].includes(action) && !palette) throw new Error(pal('Changed'));
			if (action === 'sharedMove') await moveSharedPalette(paletteId, Number(delta), before.revision);
			else if (action === 'sharedColorMove') await moveSharedColor(paletteId, id, Number(delta), before.revision);
			else if (action === 'paletteReset') {
				if (await FoundryshopDialog.confirm({ window: { title: pal('Reset') },
					content: pal('ResetConfirm'), modal: true, rejectClose: false })) await resetBuiltinPalette(paletteId, before.revision);
			} else if (action === 'sharedDelete') {
				if (await FoundryshopDialog.confirm({ window: { title: pal('Delete') },
					content: pal('DeleteConfirm'), modal: true, rejectClose: false })) await removeSharedPalette(paletteId, before.revision);
			} else {
				const content = document.createElement('div');
				content.append(el('label', { text: pal('Name') }, [
					el('input', { type: 'text', name: 'paletteName', maxlength: 80, required: true,
						value: action === 'sharedRename' ? palette.name : '' }),
				]));
				const name = await FoundryshopDialog.prompt({
					window: { title: pal('Name') }, content, modal: true, rejectClose: false,
					ok: { callback: (event, button) => button.form.elements.paletteName.value },
				});
				if (name !== null && name !== undefined) {
					let next;
					if (action === 'sharedCreate') next = await createSharedPalette(name, before.revision);
					else if (action === 'sharedAdopt') next = await adoptSavedPalette(scope, name, before.revision);
					else if (action === 'sharedDuplicate') next = await duplicateSharedPalette(paletteId, name, before.revision);
					else if (action === 'sharedRename') await renameSharedPalette(paletteId, name, before.revision);
					else throw new Error(pal('Invalid'));
					if (next) this._selectedPalette = next.palettes.at(-1).id;
				}
			}
			if (!effectivePalettes().some(entry => entry.id === this._selectedPalette)) this._selectedPalette = builtinSharedId(DEFAULT_BUILTIN_PALETTE);
			this.#saveState();
			await this.render();
		} catch (error) { Drawing_Toolbox.reportError(error); }
		finally { this._busy = false; }
	}
	static async #onRecentColor(event, target) {
		const color = target.dataset.color;
		if (!/^#[0-9a-f]{6}$/i.test(color)) return Drawing_Toolbox.reportError(new Error('Invalid recent color.'));
		const patch = { [`${this._target}Color`]: color };
		if (this._target === 'fill' && readDrawingConfig().fillType === 0) patch.fillType = readDrawingConfig().texture ? 2 : 1;
		await this.#persist(patch);
		await this.render();
	}
	static #onCollapse() {
		this._collapsed = !this._collapsed;
		this.#saveState();
		this.render();
	}

	static async #onLabelArm(event, target) {
		try {
			const entry = readLabelBank(this._labelScope).labels.find(label => label.id === target.dataset.id);
			if (!entry) throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.Changed'));
			const config = readDrawingConfig();
			this._labelDraft = { text: entry.text, style: { fontFamily: config.fontFamily || 'Signika',
				fontSize: config.fontSize || 48, textColor: String(config.textColor || '#302b26'),
				textAlpha: config.textAlpha ?? 1, ...entry.style } };
			this._labelInvalidFields?.clear();
			cancelStamp();
			await armLabelPlacement(entry.text, this._labelDraft.style);
			await this.render();
		} catch (error) {
			Drawing_Toolbox.reportError(error);
		}
	}

	static #onLabelMode(event, target) {
		try {
			disarmLabel();
		} catch (error) {
			Drawing_Toolbox.reportError(error);
		}
	}

	/** Label tool: toggles placement of the current draft and shows the label panel. */
	static async #onRailLabel() {
		try {
			cancelPath();
			if (getLabelState().mode !== 'off') disarmLabel();
			else {
				this._tab = 'labels';
				this._collapsed = false;
				this._layerFlyout = false;
				this.#saveState();
				const text = this._labelDraft?.text?.trim();
				if (text && !this._labelInvalidFields?.size && Drawing_Toolbox.canShow()) {
					cancelStamp();
					await armLabelPlacement(normalizeLabelText(text), normalizeLabelStyle(this._labelDraft.style));
				}
			}
			await this.render();
		} catch (error) { Drawing_Toolbox.reportError(error); }
	}

	/** Stamp tool: toggles placement of the copied stamp, or opens the stamp panel when none is copied. */
	static async #onRailStamp() {
		if (this._busy) return;
		this._busy = true;
		try {
			const state = getStampState();
			if (state.armed) cancelStamp();
			else if (state.copied) {
				if (getLabelState().mode !== 'off') disarmLabel();
				await armCopiedStamp(this._stampOptions);
			} else {
				this._tab = 'library';
				this._collapsed = false;
				this._layerFlyout = false;
				this.#saveState();
				ui.notifications.info(loc('Rail.StampEmpty'));
			}
			await this.render();
		} catch (error) { Drawing_Toolbox.reportError(error); }
		finally { this._busy = false; }
	}

	#changeLabelSize(step) {
		const input = this.element.querySelector('[data-label-draft="fontSize"]');
		if (!input || !this._labelDraft) return;
		input.value = String(Math.min(256, Math.max(8, this._labelDraft.style.fontSize + step)));
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}

	static #onLabelSize(event, target) {
		this.#changeLabelSize(Number(target.dataset.delta) * (event.shiftKey ? 5 : 1));
	}

	static async #onLabelDraftAction(event, target) {
		try {
			if (!Drawing_Toolbox.canShow()) throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.NoLayer'));
			if (this._labelInvalidFields?.size) throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.InvalidStyle'));
			const text = normalizeLabelText(this._labelDraft.text);
			const style = normalizeLabelStyle(this._labelDraft.style);
			if (target.dataset.action === 'labelDraftSave') {
				await saveLabel(this._labelScope, text, '', style);
			} else {
				if (target.dataset.action === 'labelDraftApply') {
					armLabel(text, 'place', style);
					disarmLabel();
					await Drawing_Toolbox.#onSelectionAction.call(this, event, { dataset: { action: 'selectionApply' } });
				} else { cancelStamp(); await armLabelPlacement(text, style); }
			}
			await this.render();
		} catch (error) { Drawing_Toolbox.reportError(error); }
	}

	static async #onLabelCustom() {
		try {
			const result = await Drawing_Toolbox.#promptLabel({ name: '', ...getLabelState() }, false, 'CustomLabel');
			if (!result) return;
			this._labelDraft = { text: result.text, style: { fontFamily: 'Signika', fontSize: 48,
				textColor: '#302b26', textAlpha: 1, ...result.style } };
			this._labelInvalidFields?.clear();
			cancelStamp();
			await armLabelPlacement(result.text, this._labelDraft.style);
			await this.render();
		} catch (error) {
			Drawing_Toolbox.reportError(error);
		}
	}

	static #onLabelManage() {
		this._manage = !this._manage;
		this.render();
	}

	static async #promptLabel(entry, withName, titleKey) {
		const content = document.createElement('div');
		if (withName) {
			const name = el('input', { type: 'text', name: 'labelName', maxlength: MAX_LABEL_NAME_LENGTH });
			// DialogV2 serializes content to HTML, so values must be attributes.
			name.setAttribute('value', entry.name ?? '');
			content.append(el('label', { text: game.i18n.localize('FOUNDRYSHOP.Labels.Name') }, [name]));
		}
		const text = el('textarea', { name: 'labelText', rows: 2, maxlength: MAX_LABEL_TEXT_LENGTH, required: true });
		text.textContent = entry.text ?? '';
		content.append(el('label', { text: game.i18n.localize('FOUNDRYSHOP.Labels.Text') }, [text]));
		if (titleKey !== 'SelectionEdit') {
			const choices = foundry.applications.settings.menus.FontConfig.getAvailableFontChoices();
			const family = el('select', { name: 'labelFont' }, [
				el('option', { value: '', text: game.i18n.localize('FOUNDRYSHOP.Labels.BrushFont'), selected: !entry.style }),
				...Object.keys(choices).map(font => el('option', { value: font, text: font, selected: entry.style?.fontFamily === font })),
			]);
			if (entry.style && !Object.hasOwn(choices, entry.style.fontFamily)) {
				family.append(el('option', { value: entry.style.fontFamily, text: entry.style.fontFamily, selected: true }));
			}
			content.append(el('label', { text: game.i18n.localize('FOUNDRYSHOP.Labels.Font') }, [family]),
				el('label', { text: game.i18n.localize('FOUNDRYSHOP.Labels.FontSize') }, [
					el('input', { type: 'number', name: 'labelSize', min: 8, max: 256, step: 1, value: entry.style?.fontSize ?? 24 }),
				]), el('label', { text: game.i18n.localize('FOUNDRYSHOP.Labels.TextColor') }, [
					el('input', { type: 'color', name: 'labelColor', value: entry.style?.textColor ?? '#302b26' }),
				]), el('label', { text: game.i18n.localize('FOUNDRYSHOP.Labels.TextAlpha') }, [
					el('input', { type: 'range', name: 'labelAlpha', min: 0, max: 1, step: 0.05,
						value: entry.style?.textAlpha ?? 1 }),
				]));
		}
		return FoundryshopDialog.prompt({
			window: { title: titleKey.startsWith('FOUNDRYSHOP.') ? game.i18n.localize(titleKey) : loc(titleKey) },
			content,
			modal: true,
			rejectClose: false,
			ok: {
				callback: (event, button, dialog) => ({
					name: dialog.element.querySelector('[name="labelName"]')?.value ?? '',
					text: dialog.element.querySelector('[name="labelText"]').value,
					style: dialog.element.querySelector('[name="labelFont"]')?.value ? {
						fontFamily: dialog.element.querySelector('[name="labelFont"]').value,
						fontSize: Number(dialog.element.querySelector('[name="labelSize"]').value),
						textColor: dialog.element.querySelector('[name="labelColor"]').value,
						textAlpha: Number(dialog.element.querySelector('[name="labelAlpha"]').value),
					} : undefined,
				}),
			},
		});
	}

	static async #onLabelBankAction(event, target) {
		const action = target.dataset.action;
		const scope = this._labelScope;
		if (this._busy) return;
		this._busy = true;
		try {
			if (!canEditLabelBank(scope)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.GMOnly'));
			const entry = readLabelBank(scope).labels.find(label => label.id === target.dataset.id);
			if ((action === 'labelEdit' || action === 'labelDelete') && !entry) {
				throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.Changed'));
			}
			if (action === 'labelAdd') {
				const result = await Drawing_Toolbox.#promptLabel({ name: '', ...getLabelState() }, true,
					'FOUNDRYSHOP.Labels.Add');
				if (result) await saveLabel(scope, result.text, result.name, result.style);
			} else if (action === 'labelEdit') {
				const result = await Drawing_Toolbox.#promptLabel(entry, true, 'FOUNDRYSHOP.Labels.Edit');
				if (result) await editLabel(scope, entry, result.text, result.name, result.style ?? null);
			} else if (action === 'labelDelete') {
				const content = el('div', { text: game.i18n.format('FOUNDRYSHOP.Labels.DeletePrompt', { name: entry.name }) });
				const confirmed = await FoundryshopDialog.confirm({
					window: { title: game.i18n.localize('FOUNDRYSHOP.Labels.Delete') }, content, modal: true, rejectClose: false,
				});
				if (confirmed) await deleteLabel(scope, entry);
			} else if (action === 'labelStarters') {
				await addStarterLabels(scope);
			}
		} catch (error) {
			Drawing_Toolbox.reportError(error);
		} finally {
			this._busy = false;
			if (this.rendered) this.render();
		}
	}

	static async #onSelectionAction(event, target) {
		const action = target.dataset.action;
		try {
			const controlled = canvas.drawings?.controlled ?? [];
			if (controlled.length !== 1) throw new Error(loc('SelectOne'));
			const scene = canvas.scene, level = canvas.level?.id;
			const { id, text: originalText } = controlled[0].document;
			let text;
			if (action === 'selectionEdit') {
				const result = await Drawing_Toolbox.#promptLabel({ text: originalText }, false, 'SelectionEdit');
				if (!result) return;
				text = normalizeLabelText(result.text);
			} else if (action === 'selectionApply') {
				text = normalizeLabelText(getLabelState().text);
			} else {
				text = '';
			}
			// Re-resolve after any dialog: the drawing may have been deleted, locked, or changed by someone else.
			const document = scene?.drawings.get(id);
			if (canvas.scene !== scene || canvas.level?.id !== level || canvas.drawings.controlled.length !== 1
				|| canvas.drawings.controlled[0].document.id !== id || !document || document.text !== originalText) {
				throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.Changed'));
			}
			if (!Drawing_Toolbox.#canEditDrawing(document)) throw new Error(loc('SelectionLocked'));
			const style = action === 'selectionApply' ? getLabelState().style : undefined;
			if (document.text !== text || style) await document.update({ text, ...style });
		} catch (error) {
			Drawing_Toolbox.reportError(error);
		}
	}
}
import { FoundryshopDialog } from './dialogs.js';
