import { exportDrawingProject, exportDrawingSubtree, exportDrawingSelection, importDrawingProject, prepareProjectImport, discardInterruptedProjectImport, projectSourceLevels } from './project_transfer_service.js';
import { lockedLayerIds } from './layer_tree_store.js';
import { parseProjectPackage, serializeProjectPackage, canonicalJson, validateProjectPackage, PROJECT_LIMITS } from './project_package.js';
import { readLayerTree } from './layer_manager.js';
import { inspectProjectResources, availableProjectFonts } from './project_resources.js';
import { projectPreviewPlaceholder, populateProjectPreview } from './project_preview.js';
import { renderArtworkPreview } from '../artwork_renderer.js';
import { thumbnailFromPreview } from './project_thumbnail.js';

const loc = key => game.i18n.localize(`FOUNDRYSHOP.Project.${key}`);

export function downloadDrawingProject(scene, packageData = exportDrawingProject(scene)) {
	if (!game.user.isGM) throw new Error('JSON project exchange requires a GM.');
	const project = validateProjectPackage(packageData);
	const name = project.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'drawing-project';
	foundry.utils.saveDataToFile(serializeProjectPackage(project), 'application/json', `${name}.foundryshop.json`);
}
export async function promptProjectExport(scene, revision, render = renderArtworkPreview) {
	const initial = exportContext(scene), tree = readLayerTree(scene);
	const levelId = canvas.level?.id;
	if (!scene.levels?.has(levelId)) throw new Error(loc('Changed'));
	const selectedIds = selectionIds(scene);
	const content = document.createElement('div');
	paragraph(content, loc('ExportHint'));
	paragraph(content, `${scene.name}: ${scene.drawings.size} ${loc('Drawings')}`);
	selectField(content, loc('ExportScope'), 'nodeId', [['', loc('FullScope')],
		...(selectedIds.length ? [[':selection', `${loc('SelectedScope')} (${selectedIds.length})`]] : []),
		...tree.nodes.map(node => [node.id, node.name])]);
	paragraph(content, loc('SubtreeHint'));
	paragraph(content, loc('SelectionHint'));
	paragraph(content, loc('ResourcesHint'));
	paragraph(content, loc('ThumbnailDisclosure'));
	selectField(content, loc('LevelScope'), 'levelScope', [['active', loc('ActiveLevelScope')], ['all', loc('AllLevelScope')]]);
	paragraph(content, loc('LevelExportHint'));
	const checkbox = (key, name, checked = false) => {
		const label = document.createElement('label');
		const input = document.createElement('input');
		input.setAttribute('type', 'checkbox'); input.setAttribute('name', name);
		if (checked) input.setAttribute('checked', '');
		const text = document.createElement('span'); text.textContent = loc(key);
		label.append(input, text); content.append(label);
	};
	checkbox('IncludeThumbnail', 'thumbnail', true);
	checkbox('ThumbnailExternalConsent', 'acknowledgeExternal');
	const selected = await FoundryshopDialog.prompt({
		classes: ['foundryshop-project-exchange'], window: { title: loc('Export') }, content, modal: true, rejectClose: false,
		ok: { label: loc('Export'), callback: (event, button) => ({
			nodeId: button.form.elements.nodeId.value || null,
			levelScope: button.form.elements.levelScope?.value ?? 'active',
			thumbnail: button.form.elements.thumbnail.checked,
			acknowledgeExternal: button.form.elements.acknowledgeExternal.checked,
		}) },
	});
	if (!selected) return;
	selected.levelScope ??= 'active';
	if (!['active', 'all'].includes(selected.levelScope)) throw new Error(loc('Changed'));
	const exportOptions = { levelId: selected.levelScope === 'active' ? levelId : null };
	const selection = selected.nodeId === ':selection';
	const project = selection ? exportDrawingSelection(scene, selectedIds, exportOptions)
		: selected.nodeId ? exportDrawingSubtree(scene, selected.nodeId, exportOptions) : exportDrawingProject(scene, exportOptions);
	const isCurrent = () => canvas.ready && canvas.scene === scene && game.user.isGM
		&& canvas.level?.id === levelId && readLayerTree(scene).revision === revision;
	const assertCurrent = () => {
		if (!isCurrent() || exportContext(scene) !== initial
			|| (selection && canonicalJson(selectionIds(scene)) !== canonicalJson(selectedIds))) throw new Error(loc('Changed'));
	};
	assertCurrent();
	if (project.pathWarnings?.length) {
		const warning = document.createElement('div');
		paragraph(warning, game.i18n.localize('FOUNDRYSHOP.Paths.PortableLoss'));
		for (const item of project.pathWarnings) paragraph(warning, `${item.name}: ${game.i18n.localize(`FOUNDRYSHOP.Paths.PortableReason.${item.reason}`)}`);
		const approved = await FoundryshopDialog.confirm({ window: { title: game.i18n.localize('FOUNDRYSHOP.Paths.PortableReview') },
			content: warning, modal: true, rejectClose: false });
		if (!approved) return;
		assertCurrent();
	}
	let thumbnail;
	if (selected.thumbnail) {
		ui.notifications.info(loc('GeneratingThumbnail'));
		const controller = new AbortController();
		const timer = setInterval(() => {
			try { if (!isCurrent()) { clearInterval(timer); controller.abort(); } }
			catch (error) {
				clearInterval(timer); controller.abort();
				console.warn('Foundryshop | Export destination changed:', error);
			}

		}, 250);
		try {
			thumbnail = thumbnailFromPreview(await render(project.drawings, {
				width: 256, height: 192, padding: 8, acknowledgeExternal: selected.acknowledgeExternal,
				signal: controller.signal,
			}));
			validateProjectPackage({ ...project, thumbnail });
		} catch (error) {
			thumbnail = undefined;
			clearInterval(timer); controller.abort();
			assertCurrent();
			console.warn('Foundryshop | Export thumbnail failed:', error);
			const warning = document.createElement('div');
			paragraph(warning, `${loc('ThumbnailFailed')} ${error.message}`);
			const without = await FoundryshopDialog.confirm({
				window: { title: loc('ExportWithoutThumbnail') }, content: warning, modal: true, rejectClose: false,
				yes: { label: loc('ExportWithoutThumbnail') },
			});
			if (!without) return;
		} finally {
			clearInterval(timer);
			controller.abort();
		}
	}
	assertCurrent();
	downloadDrawingProject(scene, thumbnail ? { ...project, thumbnail } : project);
}

function selectionIds(scene) {
	if (!canvas.ready || canvas.scene !== scene) return [];
	const controlled = canvas.drawings?.controlled ?? [];
	if (controlled.some(drawing => drawing.document?.parent !== scene || drawing.isPreview || drawing._original
		|| scene.drawings.get(drawing.id) !== drawing.document)) throw new Error(loc('Changed'));
	return controlled.map(drawing => drawing.id).sort();
}

function exportContext(scene) {
	if (!game.user.isGM || scene.getFlag('foundryshop', 'projectImportJournal')) throw new Error(loc('Changed'));
	return canonicalJson({ name: scene.name, tree: readLayerTree(scene),
		drawings: [...scene.drawings.values()].map(drawing => drawing.toObject()), paths: scene.getFlag('foundryshop', 'paths'),
		recovery: scene.getFlag('foundryshop', 'recovery') });
}

function selectField(content, labelText, name, choices) {
	const label = document.createElement('label'); label.textContent = labelText;
	const select = document.createElement('select'); select.setAttribute('name', name);
	for (const [value, text] of choices) {
		const option = document.createElement('option'); option.setAttribute('value', value); option.textContent = text; select.append(option);
	}
	label.append(select); content.append(label);
	return select;
}

function inputField(content, labelText, name, type, value = '') {
	const label = document.createElement('label');
	label.textContent = labelText;
	const input = document.createElement('input');
	input.setAttribute('name', name);
	input.setAttribute('type', type);
	if (type === 'file') input.setAttribute('accept', '.json,application/json');
	else input.setAttribute('value', value);
	label.append(input);
	content.append(label);
	return input;
}

function paragraph(content, text) {
	const node = document.createElement('p');
	node.textContent = text;
	content.append(node);
}

function mappingField(content, kind, value = {}) {
	const label = document.createElement('label');
	label.textContent = loc(kind === 'assets' ? 'AssetMappings' : 'FontMappings');
	const input = document.createElement('textarea');
	input.setAttribute('name', kind);
	input.textContent = JSON.stringify(value);
	label.append(input);
	content.append(label);
}

function resourceSummary(content, report) {
	for (const [key, entries] of [['assets', report.textures], ['fonts', report.fonts]]) {
		paragraph(content, loc(key));
		for (const entry of entries) {
			paragraph(content, `${entry.source} -> ${entry.target}: ${loc(`ResourceStatus.${entry.status}`)}${entry.detail ? ` (${entry.detail})` : ''}`);
		}
		if (!entries.length) paragraph(content, loc('None'));
	}
}

async function reviewResources(project, options) {
	ui.notifications.info(loc('CheckingResources'));
	let report = await inspectProjectResources(project, options);
	while (!report.ready) {
		if (!options.isCurrent()) throw new Error(loc('Changed'));
		const content = document.createElement('div');
		paragraph(content, loc('ResourcesBlocked'));
		resourceSummary(content, report);
		paragraph(content, `${loc('AvailableFonts')}: ${availableProjectFonts().join(', ')}`);
		mappingField(content, 'assets', options.assets);
		mappingField(content, 'fonts', options.fonts);
		const label = document.createElement('label');
		const external = document.createElement('input');
		external.setAttribute('type', 'checkbox');
		external.setAttribute('name', 'acknowledgeExternal');
		if (options.acknowledgeExternal) external.setAttribute('checked', '');
		label.append(external);
		const explanation = document.createElement('span');
		explanation.textContent = loc('AcknowledgeExternal');
		label.append(explanation);
		content.append(label);
		const replacements = await FoundryshopDialog.prompt({
			window: { title: loc('ResolveResources') }, content, modal: true, rejectClose: false,
			ok: { label: loc('RecheckResources'), callback: (event, button) => ({
				assets: JSON.parse(button.form.elements.assets.value),
				fonts: JSON.parse(button.form.elements.fonts.value),
				acknowledgeExternal: button.form.elements.acknowledgeExternal.checked,
			}) },
		});
		if (!replacements) return null;
		Object.assign(options, replacements);
		if (!options.isCurrent()) throw new Error(loc('Changed'));
		ui.notifications.info(loc('CheckingResources'));
		report = await inspectProjectResources(project, options);
	}
	return report;
}

export async function promptProjectImport(scene, revision, suppliedProject) {
	const Dialog = FoundryshopDialog;
	const content = document.createElement('div');
	paragraph(content, loc('ImportHint'));
	const modeLabel = document.createElement('label');
	modeLabel.textContent = loc('ImportMode');
	const mode = document.createElement('select');
	mode.setAttribute('name', 'mode');
	for (const value of ['empty', 'additive']) {
		const option = document.createElement('option');
		option.setAttribute('value', value);
		if (value === 'empty') option.setAttribute('selected', '');
		option.textContent = loc(value === 'empty' ? 'EmptyMode' : 'AdditiveMode');
		mode.append(option);
	}
	modeLabel.append(mode);
	content.append(modeLabel);
	const tree = readLayerTree(scene), locked = lockedLayerIds(tree);
	selectField(content, loc('TargetGroup'), 'targetGroupId', [['', loc('TopLevel')],
		...tree.nodes.filter(node => node.kind === 'group' && !locked.has(node.id)).map(node => [node.id, node.name])]);
	paragraph(content, loc('TargetGroupHint'));
	if (suppliedProject) paragraph(content, suppliedProject.name);
	else inputField(content, loc('File'), 'project', 'file');
	inputField(content, loc('OffsetX'), 'dx', 'number', '0');
	inputField(content, loc('OffsetY'), 'dy', 'number', '0');
	mappingField(content, 'assets');
	mappingField(content, 'fonts');
	const selected = await Dialog.prompt({
		classes: ['foundryshop-project-exchange'], window: { title: loc('Import') }, content, modal: true, rejectClose: false,
		render: (event, dialog) => {
			const fields = dialog.element.querySelector('form').elements;
			const update = () => {
				fields.targetGroupId.disabled = fields.mode.value !== 'additive';
				if (fields.targetGroupId.disabled) fields.targetGroupId.value = '';
			};
			fields.mode.addEventListener('change', update); update();
		},
		ok: { label: loc('Preview'), callback: (event, button) => {
			const form = button.form;
			const file = suppliedProject ? null : form.elements.project.files[0];
			if (!suppliedProject && !file) throw new Error(loc('ChooseFile'));
			if (file?.size > PROJECT_LIMITS.bytes) throw new Error(loc('FileTooLarge'));
			return {
				mode: form.elements.mode.value,
				targetGroupId: form.elements.targetGroupId.value || null,
				file, dx: form.elements.dx.valueAsNumber, dy: form.elements.dy.valueAsNumber,
				assets: JSON.parse(form.elements.assets.value),
				fonts: JSON.parse(form.elements.fonts.value),
			};
		} },
	});
	if (!selected) return;
	if (!canvas.ready || canvas.scene !== scene || readLayerTree(scene).revision !== revision) throw new Error(loc('Changed'));
	const project = suppliedProject ? validateProjectPackage(suppliedProject) : parseProjectPackage(await selected.file.text());
	const levelId = canvas.level?.id;
	const sourceLevels = projectSourceLevels(project);
	const levelContent = document.createElement('div');
	paragraph(levelContent, loc('LevelImportHint'));
	selectField(levelContent, loc('SourceLevel'), 'sourceLevel', [
		...(sourceLevels.length ? sourceLevels.map(id => [id, id]) : [['', loc('NoSourceLevel')]]),
		[':combine', loc('CombineLevels')],
	]);
	paragraph(levelContent, loc('CombineLevelsWarning'));
	const levelChoice = sourceLevels.length > 1 ? await Dialog.prompt({
		classes: ['foundryshop-project-exchange'], window: { title: loc('LevelScope') },
		content: levelContent, modal: true, rejectClose: false,
		ok: { label: loc('Preview'), callback: (event, button) => button.form.elements.sourceLevel.value },
	}) : sourceLevels[0] ?? '';
	if (levelChoice === null || levelChoice === undefined) return;
	const ground = scene.levels.get(levelId)?.elevation?.bottom;
	const options = {
		levelId, levelMode: levelChoice === ':combine' ? 'combine' : 'single',
		sourceLevelId: levelChoice === ':combine' || levelChoice === '' ? null : levelChoice,
		mode: selected.mode ?? 'empty', targetGroupId: selected.targetGroupId ?? null,
		dx: selected.dx, dy: selected.dy, assets: selected.assets, fonts: selected.fonts ?? {},
		acknowledgeExternal: false, expectedRevision: revision,
		isCurrent: () => canvas.ready && canvas.scene === scene && canvas.level?.id === levelId
			&& scene.levels.has(levelId) && scene.levels.get(levelId).elevation?.bottom === ground
			&& readLayerTree(scene).revision === revision,
	};
	const before = readLayerTree(scene);
	if (options.mode === 'empty' && !scene.drawings.size && (before.nodes.length || before.presets.length)) {
		const warning = document.createElement('div');
		paragraph(warning, game.i18n.format('FOUNDRYSHOP.Project.ReplaceEmptyMetadataHint', {
			nodes: before.nodes.length, presets: before.presets.length,
		}));
		const replace = await Dialog.confirm({
			window: { title: loc('ReplaceEmptyMetadata') }, content: warning, modal: true, rejectClose: false,
		});
		if (!replace) return;
		if (!options.isCurrent()) throw new Error(loc('Changed'));
		options.replaceEmptyMetadata = true;
	}
	const prepared = prepareProjectImport(scene, project, options);
	const importedProject = prepared.project;
	const report = await reviewResources(importedProject, options);
	if (!report) return;
	if (!options.isCurrent()) throw new Error(loc('Changed'));
	const plan = prepareProjectImport(scene, importedProject, options);
	const summary = document.createElement('div');
	paragraph(summary, project.name);
	paragraph(summary, game.i18n.format('FOUNDRYSHOP.Paths.PortableCount', { count: importedProject.paths?.routes.length ?? 0 }));
	if (importedProject.pathWarnings?.length) {
		paragraph(summary, game.i18n.localize('FOUNDRYSHOP.Paths.PortableLoss'));
		for (const item of importedProject.pathWarnings) paragraph(summary, `${item.name}: ${game.i18n.localize(`FOUNDRYSHOP.Paths.PortableReason.${item.reason}`)}`);
	}
	paragraph(summary, options.levelMode === 'combine' ? loc('CombineLevelsWarning')
		: `${loc('SourceLevel')}: ${options.sourceLevelId ?? loc('NoSourceLevel')}`);
	paragraph(summary, game.i18n.format('FOUNDRYSHOP.Project.LevelImportCounts', {
		included: importedProject.drawings.length, excluded: project.drawings.length - importedProject.drawings.length,
		ground: options.levelMode === 'combine' ? ground : loc('ElevationPreserved'),
	}));
	summary.append(projectPreviewPlaceholder());
	paragraph(summary, loc(options.mode === 'additive' ? 'AdditiveReview' : 'EmptyMode'));
	paragraph(summary, `${loc('TargetGroup')}: ${options.targetGroupId
		? before.nodes.find(node => node.id === options.targetGroupId).name : loc('TopLevel')}`);
	if (options.replaceEmptyMetadata) paragraph(summary, loc('ReplaceEmptyMetadataReview'));
	paragraph(summary, game.i18n.format('FOUNDRYSHOP.Project.Summary', {
		nodes: importedProject.tree.nodes.length, drawings: importedProject.drawings.length, presets: importedProject.tree.presets.length,
		level: canvas.level?.name ?? levelId, dx: selected.dx, dy: selected.dy,
	}));
	paragraph(summary, `${loc('Bounds')}: ${JSON.stringify(importedProject.bounds)}`);
	paragraph(summary, loc('PresentationHint'));
	paragraph(summary, loc('ResourcesHint'));
	resourceSummary(summary, report);
	paragraph(summary, `${loc('modules')}: ${project.dependencies.modules.length ? project.dependencies.modules.join(', ') : loc('None')}`);

	paragraph(summary, `${loc('AssetMappings')}: ${JSON.stringify(options.assets)}`);
	paragraph(summary, `${loc('FontMappings')}: ${JSON.stringify(options.fonts)}`);
	if (options.acknowledgeExternal) paragraph(summary, loc('ExternalAcknowledged'));
	paragraph(summary, loc('ConfirmResources'));
	let preview, previewTimer;
	const cancelPreview = () => { preview?.abort(); clearInterval(previewTimer); };
	const confirmed = await Dialog.confirm({
		classes: ['foundryshop-project-exchange'], window: { title: loc('Preview') }, content: summary, modal: true, rejectClose: false,
		render: (event, dialog) => {
			cancelPreview();
			preview = new AbortController();
			const section = dialog.element.querySelector('[data-project-preview]');
			previewTimer = setInterval(() => {
				if (options.isCurrent() && game.user.isGM) return;
				cancelPreview();
				section.querySelector('img')?.remove();
				section.querySelector('[data-preview-status]').textContent = loc('Changed');
				section.setAttribute('data-preview-state', 'error');
			}, 250);
			void populateProjectPreview(section, plan, options, preview.signal);
		},
		close: cancelPreview,
	}).finally(cancelPreview);
	if (!confirmed) return;
	if (!canvas.ready || canvas.scene !== scene || canvas.level?.id !== plan.levelId) throw new Error(loc('Changed'));
	ui.notifications.info(loc('CheckingResources'));
	await importDrawingProject(scene, importedProject, options);
	ui.notifications.info(loc('ImportSuccess'));
}

export async function promptDiscardProjectImport(scene) {
	const journal = scene.getFlag('foundryshop', 'projectImportJournal');
	if (!journal) throw new Error(loc('NoJournal'));
	if (journal.version === 4) throw new Error(loc('RecoveryIntentPending'));
	const content = document.createElement('div');
	paragraph(content, loc('DiscardHint'));
	paragraph(content, `${loc('ImportIds')}: ${journal.ids.join(', ')}`);
	const token = journal.token;
	const confirmed = await FoundryshopDialog.confirm({
		window: { title: loc('Discard') }, content, modal: true, rejectClose: false,
	});
	if (!confirmed) return;
	if (!canvas.ready || canvas.scene !== scene || scene.getFlag('foundryshop', 'projectImportJournal')?.token !== token) {
		throw new Error(loc('Changed'));
	}
	await discardInterruptedProjectImport(scene);
	ui.notifications.info(loc('DiscardSuccess'));
}
import { FoundryshopDialog } from '../dialogs.js';
