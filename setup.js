import { prepare_settings } from './scripts/settings.js';
import { Drawing_Tools } from './scripts/drawing_tools.js';
import { Drawing_Toolbox } from './scripts/drawing_toolbox.js';
import { initLabelPlacement } from './scripts/label_placement.js';
import { Color_Selector } from './scripts/color_selector.js';
import { initLayerManager } from './scripts/layers/layer_manager.js';
import { LayerPanel } from './scripts/layers/layer_panel.js';
import { initDrawingNavigation } from './scripts/drawing_navigation.js';
import { initArtworkStamps } from './scripts/artwork_stamps.js';
import { initTabletControls } from './scripts/tablet_controls.js';
import { initAppearanceOverrides } from './scripts/appearance_state.js';
import { initPathPlacement } from './scripts/path_placement.js';
import { initPathEditor } from './scripts/path_editor.js';

Hooks.once('init', async () => {
	prepare_settings();
	initTabletControls();
	initAppearanceOverrides();
	initDrawingNavigation();
	initLayerManager();
	LayerPanel.init();
	// Register synchronously: Foundry does not await async init hooks.
	Drawing_Toolbox.openDetailedPanel = tool => Drawing_Tools.openColorPicker(tool);
	Drawing_Toolbox.openLayersPanel = () => LayerPanel.toggle();
	Drawing_Toolbox.createLayerPanel = owner => LayerPanel.embedded(owner);
	LayerPanel.openInToolbox = tab => Drawing_Toolbox.openTab(tab);
	Drawing_Tools.openInToolbox = tab => Drawing_Toolbox.openTab(tab);
	Drawing_Toolbox.init();
	initLabelPlacement();
	initArtworkStamps();
	initPathPlacement();
	initPathEditor();
	await Color_Selector.loadTemplate();
	Drawing_Tools.init();
});
