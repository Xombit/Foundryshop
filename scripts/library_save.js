import { MODULE } from './constants.js';
import { exportDrawingProject } from './layers/project_transfer_service.js';
import { canonicalJson, validateProjectPackage } from './layers/project_package.js';
import { thumbnailFromPreview } from './layers/project_thumbnail.js';
import { prepareSelectedShape } from './artwork_stamps.js';
import { validateShapePackage } from './shape_package.js';
import { renderArtworkPreview } from './artwork_renderer.js';
import { LIBRARY_FOLDER, validateLibraryFolder, saveLibraryProject, saveLibraryShape } from './project_library.js';

const loc = key => game.i18n.localize(`FOUNDRYSHOP.Library.${key}`);

export function prepareLibraryProject() {
	if (!game.user.isGM || !canvas.ready || !canvas.scene || !canvas.level?.id) throw new Error(loc('Changed'));
	const scene = canvas.scene, level = canvas.level.id, grid = canonicalJson(scene.grid.toObject?.() ?? scene.grid);
	const project = exportDrawingProject(scene), snapshot = canonicalJson(project);
	const layers = canonicalJson(scene.getFlag(MODULE, 'layers'));
	return { project, isCurrent: () => game.user.isGM && canvas.ready && canvas.scene === scene
		&& canvas.level?.id === level && canonicalJson(scene.grid.toObject?.() ?? scene.grid) === grid
		&& canonicalJson(scene.getFlag(MODULE, 'layers')) === layers
		&& canonicalJson(exportDrawingProject(scene)) === snapshot };
}

function append(content, tag, text, attributes = {}) {
	const element = document.createElement(tag);
	if (text) element.textContent = text;
	for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
	content.append(element);
	return element;
}

export async function promptLibrarySave(kind, { signal, isOpen = () => true } = {}, render = renderArtworkPreview) {
	if (!['project', 'shape'].includes(kind)) throw new Error(loc('WrongKind'));
	const root = game.settings.get(MODULE, LIBRARY_FOLDER);
	validateLibraryFolder(root);
	const checkAuthority = () => {
		if (signal?.aborted || !isOpen() || root !== game.settings.get(MODULE, LIBRARY_FOLDER)) throw new Error(loc('Changed'));
		if (!game.user.isGM || !game.user.can('FILES_UPLOAD') || !game.user.can('FILES_BROWSE')) throw new Error(loc('SaveDenied'));
	};
	checkAuthority();
	const id = foundry.utils.randomID();
	const prepared = kind === 'project' ? prepareLibraryProject() : prepareSelectedShape({
		id, name: loc('CustomShape'), category: 'Custom', tags: [],
	});
	const original = kind === 'project' ? prepared.project : prepared.shape.project;
	const assertCurrent = () => {
		checkAuthority();
		if (!prepared.isCurrent()) throw new Error(loc('Changed'));
	};
	const content = document.createElement('div');
	append(content, 'p', loc(kind === 'project' ? 'SaveProjectHint' : 'SaveHint'));
	append(content, 'p', game.i18n.format('FOUNDRYSHOP.Paths.PortableCount', { count: original.paths?.routes.length ?? 0 }));
	if (original.pathWarnings?.length) {
		append(content, 'p', game.i18n.localize('FOUNDRYSHOP.Paths.PortableLoss'));
		for (const item of original.pathWarnings) append(content, 'p', `${item.name}: ${game.i18n.localize(`FOUNDRYSHOP.Paths.PortableReason.${item.reason}`)}`);
	}
	const fields = kind === 'project' ? [['name', original.name, 80]]
		: [['name', prepared.shape.name, 80], ['category', 'Custom', 40], ['tags', '', 491]];
	for (const [name, value, maxlength] of fields) {
		const label = append(content, 'label', loc(`Field.${name}`));
		append(label, 'input', '', { name, type: 'text', value, maxlength, ...(name !== 'tags' ? { required: '' } : {}) });
	}
	append(content, 'p', loc('SaveThumbnailHint'));
	for (const [name, title, checked] of [['thumbnail', 'IncludeThumbnail', true], ['acknowledgeExternal', 'ThumbnailExternalConsent', false]]) {
		const label = append(content, 'label', '');
		append(label, 'input', '', { type: 'checkbox', name, ...(checked ? { checked: '' } : {}) });
		append(label, 'span', game.i18n.localize(`FOUNDRYSHOP.Project.${title}`));
	}
	const title = loc(kind === 'project' ? 'SaveProject' : 'SaveShape');
	const selected = await FoundryshopDialog.prompt({
		window: { title }, content, modal: true, rejectClose: false,
		ok: { label: title, callback: (event, button) => ({
			name: button.form.elements.name.value.trim(),
			...(kind === 'shape' ? { category: button.form.elements.category.value.trim(),
				tags: button.form.elements.tags.value.split(',').map(tag => tag.trim()).filter(Boolean) } : {}),
			thumbnail: button.form.elements.thumbnail.checked,
			acknowledgeExternal: button.form.elements.acknowledgeExternal.checked,
		}) },
	});
	if (!selected) return null;
	assertCurrent();
	let packageData = kind === 'project' ? validateProjectPackage({ ...original, name: selected.name,
		library: { id, category: 'Project', tags: [] } })
		: validateShapePackage({ ...prepared.shape, name: selected.name, category: selected.category, tags: selected.tags,
			project: { ...original, name: selected.name } });
	if (selected.thumbnail) {
		ui.notifications.info(game.i18n.localize('FOUNDRYSHOP.Project.GeneratingThumbnail'));
		try {
			const thumbnail = thumbnailFromPreview(await render(original.drawings, {
				width: 256, height: 192, padding: 8, acknowledgeExternal: selected.acknowledgeExternal, signal,
			}));
			assertCurrent();
			packageData = kind === 'project' ? validateProjectPackage({ ...packageData, thumbnail })
				: validateShapePackage({ ...packageData, project: { ...packageData.project, thumbnail } });
		} catch (error) {
			assertCurrent();
			console.warn('Foundryshop | Library thumbnail failed:', error);
			const warning = document.createElement('div');
			append(warning, 'p', `${loc('SaveThumbnailFailed')} ${error.message}`);
			if (!await FoundryshopDialog.confirm({
				window: { title: loc('SaveWithoutThumbnail') }, content: warning, modal: true, rejectClose: false,
				yes: { label: loc('SaveWithoutThumbnail') },
			})) return null;
			assertCurrent();
		}
	}
	assertCurrent();
	const options = { signal, isCurrent: () => { assertCurrent(); return true; } };
	return kind === 'project' ? saveLibraryProject(packageData, { ...options, id }) : saveLibraryShape(packageData, options);
}
import { FoundryshopDialog } from './dialogs.js';
