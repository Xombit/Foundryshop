import {
	MODULE,
	SETTINGS_COLOR_SELECTOR_SIZE,
	SETTING_DROPPER_PREVIEW_SIZE,
	SETTING_DROPPER_READ_RADIUS,
	SETTINGS_PRESET_COLOR_SWATCHES,
	SETTINGS_RECENT_COLOR_HISTORY,
	SETTINGS_RECENT_COLORS,
	SETTINGS_WINDOW_POSITION,
} from './constants.js';
import { Color_Selector } from './color_selector.js';
import { suggestedColorName } from './color_names.js';
import { drawingSettingKey, readDrawingConfig, updateDrawingConfig } from './drawing_config.js';
import {
	PALETTE_CHANGED, MAX_NAME_LENGTH, readPalette, canEditPalette,
	saveColor, editColor, deleteColor, importPresetColors,
} from './saved_colors.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class Drawing_Tools extends HandlebarsApplicationMixin(ApplicationV2) {
	static hex_test = /^#[0-9A-F]{6}$/i;
	static current_tool = 'stroke';
	static mouse_pos = { x: 0, y: 0 };

	/**
	 * Normalize a color value to a hex string (#RRGGBB).
	 * Handles hex strings, Color objects, and numeric values.
	 */
	static toHexString(value) {
		if (typeof value === 'string' && Drawing_Tools.hex_test.test(value)) return value;
		if (value instanceof foundry.utils.Color) return value.css.slice(0, 7);
		if (typeof value === 'string') return value;
		if (typeof value === 'number') return '#' + value.toString(16).padStart(6, '0');
		return '#000000';
	}

	/** @type {Drawing_Tools|null} */
	static _instance = null;
	static _toggling = false;
	static openInToolbox = null;
	static _pickerOnly = false;

	static reportError(error) {
		console.error('Foundryshop:', error);
		ui.notifications.error(game.i18n.format('FOUNDRYSHOP.Error', { message: error.message }));
	}

	static DEFAULT_OPTIONS = {
		id: 'foundryshop-panel',
		classes: ['fshop-drawing-tools'],
		window: {
			title: 'CONTROLS.QuickDrawConfigTitle',
			icon: 'fas fa-paint-brush',
			resizable: false,
		},
		position: {
			width: 'auto',
			height: 'auto',
		},
		actions: {
			strokeColor: Drawing_Tools.#onColorButton,
			fillColor: Drawing_Tools.#onColorButton,
			strokeWidthMinus: Drawing_Tools.#onStrokeWidthButton,
			strokeWidthPlus: Drawing_Tools.#onStrokeWidthButton,
			saveColor: Drawing_Tools.#onSavedColorAction,
			importPresets: Drawing_Tools.#onSavedColorAction,
			useSavedColor: Drawing_Tools.#onSavedColorAction,
			editSavedColor: Drawing_Tools.#onSavedColorAction,
			deleteSavedColor: Drawing_Tools.#onSavedColorAction,
		},
	};

	static PARTS = {
		main: {
			template: 'modules/foundryshop/templates/quick-draw-config.hbs',
		},
	};

	static init() {
		Drawing_Tools.#prepareHookHandlers();
		console.log(`====== Foundryshop ======\n - Drawing tools initialized`);
	}

	/**
	 * Toggle the drawing tools panel open/closed.
	 */
	static async toggle() {
		if (!Drawing_Tools._pickerOnly && Drawing_Tools.openInToolbox) {
			return Drawing_Tools.openInToolbox('brush').catch(Drawing_Tools.reportError);
		}
		if (Drawing_Tools._toggling) return;
		Drawing_Tools._toggling = true;
		try {
			if (Drawing_Tools._instance?.rendered) {
				await Drawing_Tools._instance.close();
				return;
			}
			const settings = Drawing_Tools.#getSettings();
			const app = Drawing_Tools._instance = new Drawing_Tools(settings);
			const savedPos = game.settings.get(MODULE, SETTINGS_WINDOW_POSITION);
			await app.render({
				force: true,
				...(savedPos?.left != null && savedPos?.top != null ? { position: savedPos } : {}),
			});
			if (Drawing_Tools._pickerOnly) app.element.classList.add('fshop-picker-only');
		} catch (error) {
			const app = Drawing_Tools._instance;
			if (!app?.rendered) {
				app?.color_selector.dispose();
				if (app?._configHook != null) Hooks.off('clientSettingChanged', app._configHook);
				if (app?._paletteHook != null) Hooks.off(PALETTE_CHANGED, app._paletteHook);
				Drawing_Tools._instance = null;
			}
			Drawing_Tools.reportError(error);
		} finally {
			Drawing_Tools._toggling = false;
		}
	}

	static #prepareHookHandlers() {
		Hooks.on('getSceneControlButtons', (controls) => Drawing_Tools.#addControlButtons(controls));
	}

	/** Open (or focus) the detailed panel targeting stroke or fill. */
	static async open(tool = Drawing_Tools.current_tool) {
		if (tool === 'stroke' || tool === 'fill') Drawing_Tools.current_tool = tool;
		const app = Drawing_Tools._instance;
		if (app?.rendered) {
			// Re-render so the requested target is reflected in an already-open panel.
			await app.render();
			app.bringToFront?.();
			return app;
		}
		await Drawing_Tools.toggle();
		return Drawing_Tools._instance;
	}

	static async openColorPicker(tool) {
		Drawing_Tools._pickerOnly = true;
		try {
			const app = await Drawing_Tools.open(tool);
			app?.element.classList.add('fshop-picker-only');
			return app;
		} finally { Drawing_Tools._pickerOnly = false; }
	}
	static #formatKeybinding() {
		const bindings = game.keybindings.get(MODULE, 'openPanel');
		if (!bindings?.length) return '';
		const binding = bindings[0];
		const parts = [];
		if (binding.modifiers?.includes('Control')) parts.push('Ctrl');
		if (binding.modifiers?.includes('Shift')) parts.push('Shift');
		if (binding.modifiers?.includes('Alt')) parts.push('Alt');
		// Convert key code like "KeyD" to "D", "Digit1" to "1", etc.
		const key = binding.key.replace(/^Key/, '').replace(/^Digit/, '');
		parts.push(key);
		return parts.join('+');
	}

	static #addControlButtons(controls) {
		if (!game.user.isGM || !controls.drawings?.tools) return;
		const shortcut = Drawing_Tools.#formatKeybinding();
		const label = game.i18n.localize('CONTROLS.QuickDrawConfig');
		const title = shortcut ? `${label} (${shortcut})` : label;
		controls.drawings.tools['quick-draw-config'] = {
			name: 'quick-draw-config',
			icon: 'fas fa-paint-brush',
			title: title,
			order: Math.max(-1, ...Object.values(controls.drawings.tools).map(tool => tool.order ?? -1)) + 1,
			onChange: () => {
				Drawing_Tools.toggle();
			},
			button: true,
		};
	}

	static generate_smooth_gradient_style(color, num_stops = 5) {
		let color_stops = '';
		for (let i = 0; i < num_stops; i++) {
			let alpha = Math.sin((i / num_stops) * (Math.PI / 2) + Math.PI) + 1;
			alpha = Math.min(Math.max(Math.floor(alpha * 255), 0), 255);
			let color_with_alpha = color + alpha.toString(16).padStart(2, '0');
			color_stops += color_with_alpha;
			if (i + 1 < num_stops) color_stops += ', ';
		}
		return `linear-gradient(180deg, ${color_stops}, transparent 30%)`;
	}

	static #getSettings() {
		let cs_size, dr_size, dr_radi, swatches, recent_count, recent;

		cs_size = (cs_size = Math.floor(game.settings.get(MODULE, SETTINGS_COLOR_SELECTOR_SIZE))) < 100 ? 100 : cs_size;
		dr_size = (dr_size = Math.floor(game.settings.get(MODULE, SETTING_DROPPER_PREVIEW_SIZE))) < 20 ? 20 : dr_size;
		dr_radi = (dr_radi = Math.floor(game.settings.get(MODULE, SETTING_DROPPER_READ_RADIUS))) < 1 ? 1 : dr_radi;
		const settings = {
			canvas_size: cs_size,
			dropper_preview_size: dr_size,
			dropper_read_size: dr_radi * 2 - 1,
		};

		swatches = game.settings.get(MODULE, SETTINGS_PRESET_COLOR_SWATCHES).split(',');
		for (let i = 0; i < swatches.length; i++) {
			swatches[i] = swatches[i].trim();
			if (!Drawing_Tools.hex_test.test(swatches[i])) {
				swatches = null;
				break;
			}
		}
		if (swatches !== null) settings.preset_color_swatches = swatches;

		recent_count = game.settings.get(MODULE, SETTINGS_RECENT_COLOR_HISTORY);
		recent = [...game.settings.get(MODULE, SETTINGS_RECENT_COLORS)];
		if (recent.length < recent_count) {
			while (recent.length < recent_count) {
				recent.push('#000000');
			}
		} else if (recent.length > recent_count) {
			recent = recent.slice(0, recent_count);
		}
		settings.recent_color_history = recent_count;
		settings.recent_color_swatches = recent;

		return settings;
	}

	constructor(settings = {}) {
		super(Drawing_Tools._pickerOnly ? { window: { title: 'FOUNDRYSHOP.Toolbox.ColorPicker' } } : {});
		this._settings = settings;
		this._pendingWrites = new Set();
		this._paletteScope = 'personal';
		this._paletteBusy = false;
		const drawing_defaults = readDrawingConfig();
		this.color_selector = new Color_Selector(
			{ color: Drawing_Tools.toHexString(drawing_defaults[`${Drawing_Tools.current_tool}Color`]), ...settings },
			Drawing_Tools.mouse_pos
		);
		this._configHook = Hooks.on('clientSettingChanged', (key, value, options = {}) => {
			if (key === `core.${drawingSettingKey()}` && this.rendered && options.foundryshopSource !== true) {
				this.#syncConfig();
			}
		});
		this._paletteHook = Hooks.on(PALETTE_CHANGED, () => {
			if (this.rendered) {
				try {
					this.#renderSavedColors();
				} catch (error) {
					Drawing_Tools.reportError(error);
				}
			}
		});
	}

	async _prepareContext(options) {
		const drawing_defaults = readDrawingConfig();

		const stroke_color = Drawing_Tools.toHexString(drawing_defaults['strokeColor']);
		const fill_color = Drawing_Tools.toHexString(drawing_defaults['fillColor']);
		const current_color = Drawing_Tools.current_tool === 'stroke' ? stroke_color : fill_color;
		return {
			current_tool: Drawing_Tools.current_tool,
			current_tool_tooltip: game.i18n.localize(`CONTROLS.${Drawing_Tools.current_tool}_color`),
			name_bar_color: current_color,
			start_gradient: Drawing_Tools.generate_smooth_gradient_style(current_color),
			stroke_color: stroke_color,
			stroke_alpha: drawing_defaults['strokeAlpha'],
			fill_color: fill_color,
			fill_alpha: drawing_defaults['fillAlpha'],
			stroke_width: drawing_defaults.strokeWidth,
			none_selected: drawing_defaults.fillType === 0 ? 'selected' : '',
			solid_selected: drawing_defaults.fillType === 1 ? 'selected' : '',
			pattern_selected: drawing_defaults.fillType === 2 ? 'selected' : '',
		};
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		const el = this.element;
		this.color_selector.dispose();

		// Attach non-action event listeners
		el.querySelector('#fshop-stroke-color-text')?.addEventListener('input', (e) => this.#colorTextHandler(e));
		el.querySelector('#fshop-fill-color-text')?.addEventListener('input', (e) => this.#colorTextHandler(e));
		el.querySelector('#fshop-stroke-alpha')?.addEventListener('input', (e) => this.#alphaSliderHandler(e));
		el.querySelector('#fshop-fill-alpha')?.addEventListener('input', (e) => this.#alphaSliderHandler(e));
		el.querySelector('#fshop-fill-type')?.addEventListener('change', (e) => this.#persist({ fillType: e.target.value }));
		el.querySelector('#fshop-stroke-width')?.addEventListener('input', (e) => {
			if (e.target.value === '' || !e.target.validity.valid) {
				e.target.setCustomValidity(game.i18n.localize('FOUNDRYSHOP.InvalidWidth'));
				e.target.reportValidity();
				e.target.setCustomValidity('');
				return;
			}
			this.#persist({ strokeWidth: e.target.value });
		});

		// Insert the color picker
		const color_selector_menu = el.querySelector('#fshop-color-selector-menu');
		this.color_selector.render_and_attach_html(color_selector_menu);
		this.color_selector.activate_listeners(el, (color) => {
			this.#updateHtmlColors(color, Drawing_Tools.current_tool, 'selector');
		});
		this.#syncConfig();
		el.querySelector('#fshop-palette-scope').value = this._paletteScope;
		el.querySelector('#fshop-palette-scope').addEventListener('change', e => {
			this._paletteScope = e.target.value;
			try {
				this.#renderSavedColors();
			} catch (error) {
				Drawing_Tools.reportError(error);
			}
		});
		this.#renderSavedColors();
	}

	// --- Action handlers (static, called via data-action) ---

	static #onColorButton(event, target) {
		const app = this;
		const tool = target.dataset.tool;
		Drawing_Tools.current_tool = tool;
		const el = app.element;
		el.querySelector('#fshop-selected-tool').textContent = game.i18n.localize(`CONTROLS.${tool}_color`);
		const drawing_defaults = readDrawingConfig();
		app.#updateHtmlColors(Drawing_Tools.toHexString(drawing_defaults[`${tool}Color`]), tool, 'button');
	}

	static #onStrokeWidthButton(event, target) {
		const app = this;
		const width_input = app.element.querySelector('#fshop-stroke-width');
		let width = Number.parseInt(width_input.value);
		if (!Number.isFinite(width)) width = readDrawingConfig().strokeWidth;
		width += (target.textContent === '-' ? -1 : +1) * (event.shiftKey ? 5 : 1);
		width_input.value = width < 0 ? 0 : width;
		app.#persist({ strokeWidth: width_input.value });
	}

	#renderSavedColors() {
		const editable = canEditPalette(this._paletteScope);
		const container = this.element.querySelector('#fshop-saved-color-list');
		container.replaceChildren();
		for (const entry of readPalette(this._paletteScope).colors) {
			const row = document.createElement('div');
			row.className = 'fshop-saved-color-row';
			const swatch = document.createElement('button');
			swatch.type = 'button';
			swatch.className = 'fshop-saved-color-swatch';
			swatch.dataset.action = 'useSavedColor';
			swatch.dataset.id = entry.id;
			swatch.title = `${entry.name} (${entry.color})`;
			swatch.setAttribute('aria-label', swatch.title);
			const colorBlock = document.createElement('span');
			colorBlock.className = 'fshop-saved-color-block';
			colorBlock.style.backgroundColor = entry.color;
			colorBlock.setAttribute('aria-hidden', 'true');
			swatch.append(colorBlock);
			const label = document.createElement('span');
			label.textContent = entry.name;
			label.title = entry.color;
			row.append(swatch, label);
			for (const [action, icon, text] of [
				['editSavedColor', 'fa-pen', 'Edit'],
				['deleteSavedColor', 'fa-trash', 'Delete'],
			]) {
				if (!editable) continue;
				const button = document.createElement('button');
				button.type = 'button';
				button.dataset.action = action;
				button.dataset.id = entry.id;
				button.disabled = this._paletteBusy;
				button.title = game.i18n.localize(`FOUNDRYSHOP.Saved.${text}`);
				button.setAttribute('aria-label', button.title);
				const symbol = document.createElement('i');
				symbol.className = `fas ${icon}`;
				symbol.setAttribute('aria-hidden', 'true');
				button.append(symbol);
				row.append(button);
			}
			container.append(row);
		}
		if (!container.childElementCount) {
			const empty = document.createElement('p');
			empty.textContent = game.i18n.localize('FOUNDRYSHOP.Saved.Empty');
			container.append(empty);
		}
		this.element.querySelector('#fshop-palette-access').textContent = game.i18n.localize(
			this._paletteScope === 'personal' ? 'FOUNDRYSHOP.Saved.PersonalHint' : 'FOUNDRYSHOP.Saved.CampaignHint'
		);
		for (const action of ['saveColor', 'importPresets']) {
			this.element.querySelector(`[data-action="${action}"]`).disabled = !editable || this._paletteBusy;
		}
		this.element.querySelector('#fshop-palette-scope').disabled = this._paletteBusy;
	}

	async #promptSavedColor(entry, allowColorEdit) {
		const content = document.createElement('div');
		const nameLabel = document.createElement('label');
		nameLabel.textContent = game.i18n.localize('FOUNDRYSHOP.Saved.Name');
		const name = document.createElement('input');
		name.type = 'text';
		name.name = 'colorName';
		name.maxLength = MAX_NAME_LENGTH;
		// DialogV2 serializes content to HTML, so live input properties alone are lost.
		name.setAttribute('value', entry.name);
		nameLabel.append(name);
		content.append(nameLabel);
		const colorLabel = document.createElement('label');
		colorLabel.textContent = game.i18n.localize('FOUNDRYSHOP.Saved.Color');
		const color = document.createElement('input');
		color.type = 'text';
		color.name = 'savedHex';
		color.pattern = '#[0-9a-fA-F]{6}';
		color.required = true;
		color.setAttribute('value', entry.color);
		color.readOnly = !allowColorEdit;
		colorLabel.append(color);
		content.append(colorLabel);
		return FoundryshopDialog.prompt({
			window: { title: game.i18n.localize(allowColorEdit ? 'FOUNDRYSHOP.Saved.Edit' : 'FOUNDRYSHOP.Saved.Save') },
			content,
			modal: true,
			rejectClose: false,
			ok: {
				callback: (event, button, dialog) => ({
					name: dialog.element.querySelector('[name="colorName"]').value,
					color: dialog.element.querySelector('[name="savedHex"]').value,
				}),
			},
		});
	}

	static async #onSavedColorAction(event, target) {
		const app = this;
		const scope = app._paletteScope;
		const action = target.dataset.action;
		if (action !== 'useSavedColor' && app._paletteBusy) return;
		try {
			const palette = readPalette(scope);
			const entry = palette.colors.find(color => color.id === target.dataset.id);
			if (action === 'useSavedColor') {
				if (!entry) throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.Changed'));
				app.#updateHtmlColors(entry.color, Drawing_Tools.current_tool, 'saved');
				return;
			}
			if (!canEditPalette(scope)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.GMOnly'));
			app._paletteBusy = true;
			app.#renderSavedColors();
			if (action === 'saveColor') {
				const color = Drawing_Tools.toHexString(readDrawingConfig()[`${Drawing_Tools.current_tool}Color`]).toLowerCase();
				const duplicate = palette.colors.find(entry => entry.color === color);
				if (duplicate) {
					const confirmed = await FoundryshopDialog.confirm({
						window: { title: game.i18n.localize('FOUNDRYSHOP.Saved.DuplicateTitle') },
						content: game.i18n.localize('FOUNDRYSHOP.Saved.DuplicatePrompt'),
						modal: true, rejectClose: false,
					});
					if (!confirmed) return;
				}
				const result = await app.#promptSavedColor(duplicate ?? { name: suggestedColorName(color), color }, false);
				if (result) {
					if (duplicate) await editColor(scope, duplicate, color, result.name);
					else await saveColor(scope, color, result.name);
				}
			} else if (action === 'importPresets') {
				const confirmed = await FoundryshopDialog.confirm({
					window: { title: game.i18n.localize('FOUNDRYSHOP.Saved.Import') },
					content: game.i18n.localize('FOUNDRYSHOP.Saved.ImportPrompt'),
					modal: true, rejectClose: false,
				});
				if (confirmed) await importPresetColors(scope, game.settings.get(MODULE, SETTINGS_PRESET_COLOR_SWATCHES));
			} else if (action === 'editSavedColor' || action === 'deleteSavedColor') {
				if (!entry) throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.Changed'));
				if (action === 'editSavedColor') {
					const result = await app.#promptSavedColor(entry, true);
					if (result) await editColor(scope, entry, result.color, result.name);
				} else {
					const content = document.createElement('div');
					content.textContent = game.i18n.format('FOUNDRYSHOP.Saved.DeletePrompt', { name: entry.name });
					const confirmed = await FoundryshopDialog.confirm({
						window: { title: game.i18n.localize('FOUNDRYSHOP.Saved.Delete') },
						content, modal: true, rejectClose: false,
					});
					if (confirmed) await deleteColor(scope, entry);
				}
			}
		} catch (error) {
			Drawing_Tools.reportError(error);
		} finally {
			if (action !== 'useSavedColor') {
				app._paletteBusy = false;
				if (app.rendered) {
					try {
						app.#renderSavedColors();
					} catch (error) {
						Drawing_Tools.reportError(error);
					}
				}
			}
		}
	}

	// --- Instance event handlers ---

	#colorTextHandler(e) {
		const tool = e.target.dataset.tool;
		const update_color = Drawing_Tools.hex_test.test(e.target.value) ? e.target.value : '#000000';
		this.#updateHtmlColors(update_color, tool, 'text');
	}

	#alphaSliderHandler(e) {
		const tool = e.target.dataset.tool;
		this.element.querySelector(`#fshop-${tool}-alpha-label`).textContent = e.target.value;
		this.#persist({ [`${tool}Alpha`]: e.target.value });
	}

	#updateHtmlColors(color, tool, caller) {
		const el = this.element;
		if (!el) return;
		if (caller !== 'button') {
			el.querySelector(`#fshop-${tool}-color`)?.style.setProperty('background', color);
		}
		if (caller !== 'button' && caller !== 'text') {
			const textInput = el.querySelector(`#fshop-${tool}-color-text`);
			if (textInput) textInput.value = color;
		}

		if (tool === Drawing_Tools.current_tool) {
			el.querySelector('#fshop-tool-name-bar')?.style.setProperty('background', color);
			el.querySelector('#fshop-color-selector-background')?.style.setProperty(
				'background-image',
				Drawing_Tools.generate_smooth_gradient_style(color)
			);

			if (caller !== 'selector') {
				this.color_selector.update_html_colors(color, 'external');
			}
		}

		if (caller !== 'button') this.#persist({ [`${tool}Color`]: color });
	}

	async close(options = {}) {
		await Promise.all(this._pendingWrites);
		if (this.rendered) await this.#saveRecentColors();
		// Save window position for next open
		const pos = this.position;
		if (pos?.left != null && pos?.top != null) {
			await game.settings.set(MODULE, SETTINGS_WINDOW_POSITION, { left: pos.left, top: pos.top });
		}
		const result = await super.close(options);
		if (Drawing_Tools._instance === this) Drawing_Tools._instance = null;
		return result;
	}

	_onClose(options) {
		super._onClose(options);
		this.color_selector.dispose();
		if (this._configHook != null) {
			Hooks.off('clientSettingChanged', this._configHook);
			this._configHook = null;
		}
		if (this._paletteHook != null) {
			Hooks.off(PALETTE_CHANGED, this._paletteHook);
			this._paletteHook = null;
		}
	}

	#syncConfig() {
		const el = this.element;
		if (!el) return;
		const config = readDrawingConfig();
		for (const tool of ['stroke', 'fill']) {
			const color = Drawing_Tools.toHexString(config[`${tool}Color`]);
			el.querySelector(`#fshop-${tool}-color`).style.background = color;
			el.querySelector(`#fshop-${tool}-color-text`).value = color;
			el.querySelector(`#fshop-${tool}-alpha`).value = config[`${tool}Alpha`];
			el.querySelector(`#fshop-${tool}-alpha-label`).textContent = config[`${tool}Alpha`];
		}
		el.querySelector('#fshop-stroke-width').value = config.strokeWidth;
		el.querySelector('#fshop-fill-type').value = config.fillType;
		const color = Drawing_Tools.toHexString(config[`${Drawing_Tools.current_tool}Color`]);
		el.querySelector('#fshop-tool-name-bar').style.background = color;
		el.querySelector('#fshop-color-selector-background').style.backgroundImage =
			Drawing_Tools.generate_smooth_gradient_style(color);
		this.color_selector.update_html_colors(color, 'external');
	}

	#persist(patch) {
		const write = updateDrawingConfig(patch).catch(error => {
			Drawing_Tools.reportError(error);
		});
		this._pendingWrites.add(write);
		write.finally(() => this._pendingWrites.delete(write));
	}

	async #saveRecentColors() {
		const el = this.element;
		if (!el) return;
		let temp, pos;
		const stroke = Drawing_Tools.hex_test.test(
			(temp = el.querySelector('#fshop-stroke-color-text').value)
		) ? temp : null;
		const fill = Drawing_Tools.hex_test.test(
			(temp = el.querySelector('#fshop-fill-color-text').value)
		) ? temp : null;

		const swatches = this._settings.recent_color_swatches || [];
		const presets = this._settings.preset_color_swatches || [];

		if (fill !== null && !presets.includes(fill)) {
			if ((pos = swatches.findIndex((c) => c === fill)) >= 0) {
				swatches.splice(pos, 1);
			}
			swatches.unshift(fill);
		}
		if (stroke !== null && !presets.includes(stroke)) {
			if ((pos = swatches.findIndex((c) => c === stroke)) >= 0) {
				swatches.splice(pos, 1);
			}
			swatches.unshift(stroke);
		}

		await game.settings.set(
			MODULE,
			SETTINGS_RECENT_COLORS,
			swatches.slice(0, this._settings.recent_color_history || 10)
		);
	}
}
import { FoundryshopDialog } from './dialogs.js';
