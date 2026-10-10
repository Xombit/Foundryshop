import { readDrawingConfig } from './drawing_config.js';
import { normalizeAppearance } from './appearance_swatches.js';
import { starterMaterials } from './starter_materials.js';
import { starterShape } from './starter_shapes.js';
import { materialCreationPatch } from './material_fill.js';
import { renderArtworkPreview } from './artwork_renderer.js';

const loc = key => game.i18n.localize(`FOUNDRYSHOP.Pairs.${key}`);
function node(tag, attributes = {}) {
	const element = document.createElement(tag);
	for (const [key, value] of Object.entries(attributes)) {
		if (key === 'text') element.textContent = value;
		else element.setAttribute(key, String(value));
	}

	return element;
}

export function appearanceSample(appearance, config, scene) {
	const { kind, name, ...patch } = normalizeAppearance(appearance);
	const source = structuredClone(starterShape('textured-timber-table').project.drawings[0].data);
	Object.assign(source, { x: 0, y: 0, rotation: 0, text: '',
		shape: { type: 'r', width: 180, height: 100, points: [] },
		strokeWidth: config.strokeWidth, strokeAlpha: config.strokeAlpha, fillAlpha: config.fillAlpha,
		flags: {} }, materialCreationPatch(patch, scene));
	if (source['flags.foundryshop.materialRepeat'] !== undefined) {
		source.flags = { foundryshop: { materialRepeat: source['flags.foundryshop.materialRepeat'] } };
		delete source['flags.foundryshop.materialRepeat'];
	}
	return [{ id: 'appearance-sample', data: source, layerId: null }];
}

export async function promptAppearance(initial, config = readDrawingConfig()) {
	const content = node('div', { class: 'fshop-pair-editor' });
	const dialogContent = node('div');
	dialogContent.append(content);
	const fields = {};
	const add = (name, title, element) => {
		element.setAttribute('name', name);
		fields[name] = element;
		const label = node('label', { text: loc(title) });
		label.append(element); content.append(label);
	};
	add('name', 'Name', node('input', { type: 'text', maxlength: 80, value: initial.name ?? '' }));
	add('strokeColor', 'Line', node('input', { type: 'color', value: initial.strokeColor ?? config.strokeColor }));
	add('fillColor', 'Interior', node('input', { type: 'color', value: initial.fillColor ?? config.fillColor }));
	let mode = node('select');
	for (const [value, title] of [[0, 'None'], [1, 'Solid'], [2, 'Pattern']]) {
		const option = node('option', { value, text: loc(title) });
		if (value === (initial.fillType ?? config.fillType)) option.setAttribute('selected', '');
		mode.append(option);
	}
	add('fillType', 'Mode', mode);
	let materials = node('select', { 'aria-label': loc('Material') });
	materials.append(node('option', { value: '', text: loc('CustomMaterial') }));
	for (const material of starterMaterials()) materials.append(node('option', {
		value: material.path, text: game.i18n.localize(`FOUNDRYSHOP.Materials.Name.${material.id}`),
	}));
	content.append(materials);
	add('texture', 'Material', node('input', { type: 'text', maxlength: 2048, value: initial.texture ?? config.texture ?? '' }));
	let browse = node('button', { type: 'button', text: loc('Browse'), 'data-pair-browse': '' });
	content.append(browse);
	add('materialRepeat', 'Repeat', node('input', { type: 'number', min: 0.05, max: 100, step: 0.05,
		value: initial.materialRepeat ?? config.materialRepeat ?? 1 }));
	let repeatButtons = node('div', { class: 'fshop-pair-repeat-buttons' });
	for (const [text, direction] of [['-', -1], ['+', 1]]) {
		const button = node('button', { type: 'button', text, 'data-step': direction, 'aria-label': `${loc('Repeat')} ${text}` });
		repeatButtons.append(button);
	}
	content.append(repeatButtons);
	content.append(node('p', { text: game.i18n.format('FOUNDRYSHOP.Pairs.Inherited', {
		width: config.strokeWidth, line: Math.round(config.strokeAlpha * 100), fill: Math.round(config.fillAlpha * 100),
	}) }));
	let image = node('img', { alt: loc('Preview'), width: 240, height: 140 });
	let status = node('p', { role: 'status', 'aria-live': 'polite' });
	content.append(image, status);
	let controller, timer, picker, closed = false;
	const read = () => normalizeAppearance({
		kind: 'pair', name: fields.name.value, strokeColor: fields.strokeColor.value,
		fillColor: fields.fillColor.value, fillType: Number(fields.fillType.value),
		texture: fields.texture.value.trim(), materialRepeat: Number(fields.materialRepeat.value),
	});
	const preview = async () => {
		controller?.abort();
		const active = controller = new AbortController();
		try {
			const result = await renderArtworkPreview(appearanceSample(read(), config, canvas.scene),
				{ signal: active.signal, width: 240, height: 140 });
			if (closed || active.signal.aborted) return;
			image.src = result.src;
			image.hidden = false; status.textContent = loc('Preview');
		} catch (error) {
			if (active.signal.aborted || closed) return;
			image.hidden = true; status.textContent = error.message;
			console.warn('Foundryshop appearance preview:', error);
		}
	};
	const schedule = () => {
		const textured = Number(mode.value) === 2;
		for (const element of [materials, fields.texture, fields.materialRepeat, browse, ...repeatButtons.children]) element.disabled = !textured;
		controller?.abort(); clearTimeout(timer);
		timer = setTimeout(preview, 200);
	};
	const stop = () => { closed = true; controller?.abort(); clearTimeout(timer); };
	try {
		return await FoundryshopDialog.prompt({
			window: { title: loc('Editor') }, content: dialogContent, modal: true, rejectClose: false,
			render: (event, dialog) => {
				const root = dialog.element.querySelector('.fshop-pair-editor');
				for (const name of Object.keys(fields)) fields[name] = root.querySelector(`[name="${name}"]`);
				mode = fields.fillType;
				materials = root.querySelector('select:not([name])');
				browse = root.querySelector('[data-pair-browse]');
				repeatButtons = root.querySelector('.fshop-pair-repeat-buttons');
				image = root.querySelector('img');
				status = root.querySelector('[role="status"]');
				for (const button of repeatButtons.children) button.addEventListener('click', () => {
					fields.materialRepeat.stepUp(Number(button.dataset.step));
					fields.materialRepeat.dispatchEvent(new Event('input'));
				});
				fields.materialRepeat.addEventListener('wheel', event => {
					if (fields.materialRepeat.disabled || event.ctrlKey || event.metaKey || !event.deltaY) return;
					event.preventDefault();
					fields.materialRepeat.stepUp(event.deltaY < 0 ? 1 : -1);
					fields.materialRepeat.dispatchEvent(new Event('input'));
				}, { passive: false });
				for (const field of Object.values(fields)) field.addEventListener('input', schedule);
				materials.addEventListener('change', () => { fields.texture.value = materials.value; schedule(); });
				browse.addEventListener('click', async () => {
					try {
						picker = new foundry.applications.apps.FilePicker.implementation({
							type: 'image', current: fields.texture.value,
							callback: path => { if (!closed) { fields.texture.value = path; schedule(); } },
						});
						await picker.render({ force: true });
					} catch (error) {
						status.textContent = error.message;
						ui.notifications.error(game.i18n.format('FOUNDRYSHOP.Error', { message: error.message }));
					}
				});
				schedule();
			},
			close: stop,
			ok: { label: loc('Save'), callback: read },
		});
	} finally { stop(); if (picker) await picker.close(); }
}
import { FoundryshopDialog } from './dialogs.js';
