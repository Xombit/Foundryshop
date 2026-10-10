import {
	MODULE,
	SETTINGS_COLOR_SELECTOR_SIZE,
	SETTING_DROPPER_PREVIEW_SIZE,
	SETTING_DROPPER_READ_RADIUS,
	SETTINGS_PRESET_COLOR_SWATCHES,
	SETTINGS_RECENT_COLOR_HISTORY,
	SETTINGS_RECENT_COLORS,
	SETTINGS_WINDOW_POSITION,
	SETTINGS_TOOLBOX_AUTO_SHOW,
	SETTINGS_TOOLBOX_DENSITY,
	SETTINGS_TOOLBOX_THEME,
	SETTINGS_TOOLBOX_SCALE,
	SETTINGS_TOOLBOX_STATE,
	SETTINGS_DRAWING_EDGE_PAN,
} from './constants.js';
import { Drawing_Tools } from './drawing_tools.js';
import { Drawing_Toolbox } from './drawing_toolbox.js';
import { PERSONAL_COLORS, CAMPAIGN_COLORS, PALETTE_CHANGED } from './saved_colors.js';
import { PERSONAL_LABELS, CAMPAIGN_LABELS, LABELS_CHANGED } from './label_banks.js';
import { disarmLabel } from './label_placement.js';
import { SHARED_PALETTES } from './shared_palettes.js';
import { STAMP_FOLDER } from './artwork_stamps.js';
import { TOOLBOX_SCALE } from './toolbox_appearance.js';
import { LIBRARY_FOLDER, LIBRARY_OPERATIONS, LIBRARY_CATALOG, LIBRARY_CHANGED } from './project_library.js';
import { starterLabels } from './label_styles.js';
import { registerTabletKeybindings } from './tablet_controls.js';
import { registerBakeStorageSetting } from './layers/bake_storage.js';
import { registerBrushPresetSetting } from './brush_presets.js';
import { registerPathPresetSetting } from './path_presets.js';

export function prepare_settings() {
	registerTabletKeybindings();
	registerBakeStorageSetting();
	game.settings.register(MODULE, 'materialRepeat', {
		scope: 'client', config: false, type: Number, default: 1,
		onChange: () => Drawing_Toolbox._instance?.requestRefresh(),
	});
	game.settings.register(MODULE, LIBRARY_FOLDER, {
		name: 'FOUNDRYSHOP.Library.FolderName', hint: 'FOUNDRYSHOP.Library.FolderHint',
		scope: 'world', config: true, type: String, default: '',
		onChange: () => Drawing_Toolbox._instance?.requestRefresh(),
	});
	game.settings.register(MODULE, LIBRARY_OPERATIONS, {
		scope: 'world', config: false, type: Object, default: { version: 1, revision: 0, entries: [] },
		onChange: () => Hooks.callAll(LIBRARY_CHANGED),
	});
	game.settings.register(MODULE, LIBRARY_CATALOG, {
		scope: 'world', config: false, type: Object, default: { version: 1, revision: 0, entries: [] },
		onChange: () => Hooks.callAll(LIBRARY_CHANGED),
	});
	game.settings.register(MODULE, STAMP_FOLDER, {
		name: 'FOUNDRYSHOP.Stamps.FolderName', hint: 'FOUNDRYSHOP.Stamps.FolderHint',
		scope: 'world', config: true, type: String, default: '',
	});
	game.settings.register(MODULE, SHARED_PALETTES, {
		scope: 'world', config: false, type: Object,
		default: { version: 1, revision: 0, palettes: [] },
		onChange: () => Hooks.callAll(PALETTE_CHANGED),
	});
	game.settings.register(MODULE, SETTINGS_DRAWING_EDGE_PAN, {
		name: 'FOUNDRYSHOP.Settings.DrawingEdgePan.Name',
		hint: 'FOUNDRYSHOP.Settings.DrawingEdgePan.Hint',
		scope: 'client', config: true, type: Boolean, default: false,
	});
	for (const [key, scope] of [[PERSONAL_COLORS, 'user'], [CAMPAIGN_COLORS, 'world']]) {
		game.settings.register(MODULE, key, {
			scope,
			config: false,
			type: Object,
			default: { schemaVersion: 1, colors: [] },
			onChange: () => Hooks.callAll(PALETTE_CHANGED),
		});
	}
	for (const [key, scope] of [[PERSONAL_LABELS, 'user'], [CAMPAIGN_LABELS, 'world']]) {
		game.settings.register(MODULE, key, {
			scope,
			config: false,
			type: Object,
			default: { schemaVersion: 1, labels: starterLabels(), startersInitialized: true },
			onChange: () => Hooks.callAll(LABELS_CHANGED),
		});
	}
	game.settings.register(MODULE, SETTINGS_TOOLBOX_AUTO_SHOW, {
		name: 'FOUNDRYSHOP.Settings.ToolboxAutoShow.Name',
		hint: 'FOUNDRYSHOP.Settings.ToolboxAutoShow.Hint',
		scope: 'client',
		config: true,
		type: Boolean,
		default: true,
	});
	game.settings.register(MODULE, SETTINGS_TOOLBOX_DENSITY, {
		name: 'FOUNDRYSHOP.Settings.ToolboxDensity.Name',
		hint: 'FOUNDRYSHOP.Settings.ToolboxDensity.Hint',
		scope: 'client',
		config: true,
		type: String,
		choices: {
			compact: 'FOUNDRYSHOP.Settings.ToolboxDensity.Compact',
			comfortable: 'FOUNDRYSHOP.Settings.ToolboxDensity.Comfortable',
			tablet: 'FOUNDRYSHOP.Settings.ToolboxDensity.Tablet',
		},
		default: 'tablet',
		onChange: () => Drawing_Toolbox._instance?.requestRefresh(),
	});
	game.settings.register(MODULE, SETTINGS_TOOLBOX_THEME, {
		name: 'FOUNDRYSHOP.Settings.ToolboxTheme.Name',
		hint: 'FOUNDRYSHOP.Settings.ToolboxTheme.Hint',
		scope: 'client',
		config: true,
		type: String,
		default: 'slate',
		choices: {
			slate: 'FOUNDRYSHOP.Toolbox.Theme.slate',
			foundry: 'FOUNDRYSHOP.Toolbox.Theme.foundry',
			system: 'FOUNDRYSHOP.Toolbox.Theme.system',
		},
		onChange: () => Drawing_Toolbox._instance?.requestRefresh(),
	});
	game.settings.register(MODULE, SETTINGS_TOOLBOX_SCALE, {
		name: 'FOUNDRYSHOP.Settings.ToolboxScale.Name',
		hint: 'FOUNDRYSHOP.Settings.ToolboxScale.Hint',
		scope: 'client',
		config: true,
		type: Number,
		default: TOOLBOX_SCALE.default,
		range: { min: TOOLBOX_SCALE.min, max: TOOLBOX_SCALE.max, step: TOOLBOX_SCALE.step },
		onChange: () => Drawing_Toolbox._instance?.requestRefresh(),
	});
	game.settings.register(MODULE, SETTINGS_TOOLBOX_STATE, {
		scope: 'client',
		config: false,
		type: Object,
		default: {},
	});
	// Unbound by default so tablet express keys / users can assign them without colliding with core shortcuts.
	game.keybindings.register(MODULE, 'toggleToolbox', {
		name: 'FOUNDRYSHOP.Keybindings.ToggleToolbox',
		editable: [],
		onDown: () => {
			Drawing_Toolbox.toggle();
			return true;
		},
		restricted: false,
		precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
	});
	game.keybindings.register(MODULE, 'disarmLabel', {
		name: 'FOUNDRYSHOP.Keybindings.DisarmLabel',
		editable: [],
		onDown: () => {
			disarmLabel();
			return true;
		},
		restricted: false,
		precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
	});
	// Register keybinding for opening the drawing tools panel
	game.keybindings.register(MODULE, 'openPanel', {
		name: 'CONTROLS.QuickDrawConfig',
		hint: 'SETTINGS.HINT.shortcut_enabled',
		editable: [
			{ key: 'KeyD', modifiers: ['Control'] },
		],
		onDown: () => {
			Drawing_Tools.toggle();
			return true;
		},
		restricted: false,
		precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
	});

	game.settings.register(MODULE, SETTINGS_COLOR_SELECTOR_SIZE, {
		name: 'SETTINGS.NAME.color_selector_size',
		hint: 'SETTINGS.HINT.color_selector_size',
		scope: 'client',
		config: true,
		type: Number,
		default: 150,
		requiresReload: false,
	});

	game.settings.register(MODULE, SETTING_DROPPER_PREVIEW_SIZE, {
		name: 'SETTINGS.NAME.dropper_preview_size',
		hint: 'SETTINGS.HINT.dropper_preview_size',
		scope: 'client',
		config: true,
		type: Number,
		default: 50,
		requiresReload: false,
	});

	game.settings.register(MODULE, SETTING_DROPPER_READ_RADIUS, {
		name: 'SETTINGS.NAME.dropper_read_radius',
		hint: 'SETTINGS.HINT.dropper_read_radius',
		scope: 'client',
		config: true,
		type: Number,
		default: 3,
		requiresReload: false,
	});

	game.settings.register(MODULE, SETTINGS_PRESET_COLOR_SWATCHES, {
		name: 'SETTINGS.NAME.preset_color_swatches',
		hint: 'SETTINGS.HINT.preset_color_swatches',
		scope: 'client',
		config: true,
		type: String,
		default:
			'#cc0000,#ea9999,#e69138,#f9cb9c,#f1c232,#ffe599,#6aa84f,#b6d7a8,#45818e,#a2c4c9,#3c78d8,#a4c2f4,#674ea7,#b4a7d6,#c41d70,#ec83b7,#7e3426,#8f674f,#000000,#808080',
		requiresReload: false,
	});

	game.settings.register(MODULE, SETTINGS_RECENT_COLOR_HISTORY, {
		name: 'SETTINGS.NAME.recent_color_history',
		hint: 'SETTINGS.HINT.recent_color_history',
		scope: 'client',
		config: true,
		type: Number,
		default: 10,
		requiresReload: false,
	});

	game.settings.register(MODULE, SETTINGS_RECENT_COLORS, {
		scope: 'client',
		config: false,
		type: Array,
		default: [],
		requiresReload: false,
	});
	registerBrushPresetSetting();
	registerPathPresetSetting();

	game.settings.register(MODULE, SETTINGS_WINDOW_POSITION, {
		scope: 'client',
		config: false,
		type: Object,
		default: {},
		requiresReload: false,
	});
}
