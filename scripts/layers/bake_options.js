import { readLayerTree, readLayerWorkspace } from './layer_manager.js';
import { canonicalJson } from './project_package.js';
import { readOptimizationJournal } from './optimization_journal.js';
import { BakeReviewCancelledError } from './bake_dialogs.js';
import { optimizationSceneGrid } from './optimization_scene_data.js';

const loc = key => game.i18n.localize(`FOUNDRYSHOP.Bake.${key}`);

function append(parent, tag, text, attributes = {}) {
	const element = document.createElement(tag);
	if (text !== undefined) element.textContent = String(text);
	for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
	parent.append(element);
	return element;
}

function field(parent, key, name, choices, required = true) {
	const label = append(parent, 'label', loc(key));
	const select = append(label, 'select', undefined, { name, ...(required ? { required: '' } : {}) });
	for (const [value, text] of choices) append(select, 'option', text, { value });
	return select;
}

function number(parent, key, name, value = '', attributes = {}) {
	const label = append(parent, 'label', loc(key));
	return append(label, 'input', undefined, { name, type: 'number', value, ...attributes });
}

function selection(reader) {
	const ids = reader();
	if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
		throw new Error(loc('OptionsInvalid'));
	}
	return [...ids].sort();
}

/** Read-only options; exact scope/crop and destructive approvals still follow separately. */
export async function promptTileBakeOptions(scene, { levelId, isCurrent, signal, readSelection } = {}) {
	if (typeof isCurrent !== 'function' || readSelection !== undefined && typeof readSelection !== 'function') {
		throw new Error(loc('Changed'));
	}
	const owner = game.user?.id;
	const check = () => {
		if (!game.user?.isGM || game.user.id !== owner || game.users?.activeGM?.id !== owner
			|| !scene?.levels?.has(levelId) || signal?.aborted || !isCurrent()) throw new Error(loc('Changed'));
	};
	check();
	const tree = readLayerTree(scene), workspace = readLayerWorkspace(scene);
	const leaves = tree.nodes.filter(node => node.kind === 'layer');
	const selected = readSelection ? selection(readSelection) : [];
	const valid = result => ['layer', 'selection', 'all'].includes(result.kind)
		&& ['gm', 'player'].includes(result.audience) && Number.isSafeInteger(result.sort)
		&& ['png', 'webp'].includes(result.format) && Number.isFinite(result.quality)
		&& result.quality >= 0 && result.quality <= 1 && ['automatic', 'custom'].includes(result.crop)
		&& (result.kind !== 'layer' || leaves.some(node => node.id === result.layerId))
		&& (result.kind !== 'selection' || selected.length > 0 && selected.every(id => scene.drawings.has(id)))
		&& (result.crop !== 'custom' || result.bounds && Object.values(result.bounds).every(Number.isSafeInteger)
			&& result.bounds.width > 0 && result.bounds.height > 0
			&& Number.isSafeInteger(result.bounds.width * result.bounds.height * 4)
			&& [result.bounds.x + result.bounds.width, result.bounds.y + result.bounds.height].every(Number.isSafeInteger));
	const read = form => {
		const numeric = name => form[name].value.trim() ? Number(form[name].value) : NaN;
		return { kind: form.kind.value, layerId: form.layerId.value, audience: form.audience.value,
			sort: numeric('sort'), format: form.format.value, quality: numeric('quality'),
			crop: form.crop.value, bounds: form.crop.value === 'custom'
				? Object.fromEntries(['x', 'y', 'width', 'height'].map(name => [name, numeric(name)])) : undefined,
			acknowledgeExternal: form.acknowledgeExternal.checked === true };
	};
	const snapshot = () => canonicalJson({
		level: scene.levels.get(levelId).toObject(), tree: readLayerTree(scene), workspace: readLayerWorkspace(scene),
		journal: readOptimizationJournal(scene), width: scene.width, height: scene.height, padding: scene.padding,
		grid: optimizationSceneGrid(scene),
		drawings: [...scene.drawings.values()].map(doc => doc.toObject()).sort((a, b) => a._id.localeCompare(b._id)),
		tiles: [...scene.tiles.values()].map(doc => doc.toObject()).sort((a, b) => a._id.localeCompare(b._id)),
		selection: readSelection ? selection(readSelection) : [],
	});
	const baseline = snapshot(), content = document.createElement('div');
	append(content, 'p', loc('OptionsHint'));
	field(content, 'Scope', 'kind', [['layer', loc('ScopeLayer')], ['selection', loc('ScopeSelection')], ['all', loc('ScopeAll')]]);
	const layer = field(content, 'Layer', 'layerId', [['', loc('ChooseLayer')], ...leaves.map(node => [node.id, node.name])], false);
	if (leaves.some(node => node.id === workspace.activeLayerId)) layer.value = workspace.activeLayerId;
	field(content, 'Audience', 'audience', [['', loc('ChooseAudience')], ['gm', loc('GM')], ['player', loc('Players')]]);
	number(content, 'Sort', 'sort', '', { step: 1, required: '' });
	append(content, 'p', loc('SortHint'));
	field(content, 'Format', 'format', [['webp', 'WEBP'], ['png', 'PNG']]);
	number(content, 'Quality', 'quality', 0.9, { min: 0, max: 1, step: 0.01, required: '' });
	field(content, 'Crop', 'crop', [['automatic', loc('CropAutomatic')], ['custom', loc('CropCustom')]]);
	for (const name of ['x', 'y', 'width', 'height']) number(content, `Crop${name}`, name, '', { step: 1,
		...(['width', 'height'].includes(name) ? { min: 1 } : {}) });
	append(content, 'p', loc('CropHint'));
	const consent = append(content, 'label');
	append(consent, 'input', undefined, { name: 'acknowledgeExternal', type: 'checkbox' });
	append(consent, 'span', loc('ExternalConsent'));
	const result = await FoundryshopDialog.prompt({
		classes: ['foundryshop-bake-review'], window: { title: loc('OptionsTitle') },
		content, modal: true, rejectClose: false,
		render: (event, dialog) => {
			const form = dialog.element.querySelector('form');
			const updateRequired = () => {
				form.elements.layerId.required = form.elements.kind.value === 'layer';
				form.elements.layerId.disabled = !form.elements.layerId.required;
				for (const name of ['x', 'y', 'width', 'height']) {
					form.elements[name].required = form.elements.crop.value === 'custom';
					form.elements[name].disabled = !form.elements[name].required;
				}
			};
			updateRequired();
			form.addEventListener('change', updateRequired);
			const guard = event => {
				if (event.type === 'click' && !event.target.closest('button[data-action="ok"]')) return;
				updateRequired();
				if (!form.reportValidity() || !valid(read(form.elements))) {
					event.preventDefault();
					event.stopImmediatePropagation();
					ui.notifications.warn(loc('OptionsInvalid'));
				}
			};
			dialog.element.addEventListener('click', guard, { capture: true });
			form.addEventListener('submit', guard, { capture: true });
		},
		ok: { label: loc('ReviewScope'), callback: (event, button) => read(button.form.elements) },
	});
	check();
	if (snapshot() !== baseline) throw new Error(loc('OptionsStale'));
	if (!result) throw new BakeReviewCancelledError();
	if (!valid(result)) {
		throw new Error(loc('OptionsInvalid'));
	}
	return { kind: result.kind, layerId: result.kind === 'layer' ? result.layerId : null, audience: result.audience,
		sort: result.sort, format: result.format, quality: result.quality, bounds: result.bounds,
		acknowledgeExternal: result.acknowledgeExternal };
}
import { FoundryshopDialog } from '../dialogs.js';
