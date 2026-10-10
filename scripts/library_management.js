import { MODULE } from './constants.js';
import { LIBRARY_FOLDER, editLibraryMetadata, duplicateLibraryEntry, inspectLibraryRepair, acceptLibraryRepair,
	setLibraryCatalogRemoved } from './project_library.js';
import { normalizeLibraryMetadata } from './library_metadata.js';

const loc = key => game.i18n.localize(`FOUNDRYSHOP.Library.${key}`);
function text(content, value) {
	const p = document.createElement('p'); p.textContent = value; content.append(p);
}

export async function promptLibraryManagement(action, entry, { signal, isOpen = () => true } = {}) {
	if (!['edit', 'duplicate', 'repair', 'remove', 'restore'].includes(action)) throw new Error(loc('WrongKind'));
	const catalogAction = action === 'remove' || action === 'restore';
	const root = game.settings.get(MODULE, LIBRARY_FOLDER);
	const check = () => {
		if (!entry || entry.builtinId || entry.root !== root || signal?.aborted || !isOpen()
			|| game.settings.get(MODULE, LIBRARY_FOLDER) !== root) throw new Error(loc('Changed'));
		if (!game.user.isGM || !game.user.can('FILES_BROWSE')
			|| !game.user.can(action === 'repair' || catalogAction ? 'SETTINGS_MODIFY' : 'FILES_UPLOAD')
			|| action === 'edit' && !game.user.can('SETTINGS_MODIFY')) throw new Error(loc(catalogAction ? 'CatalogDenied' : 'ManageDenied'));
	};
	check();
	const options = { signal, isCurrent: () => { check(); return true; } };
	if (catalogAction) {
		if (entry.error || entry.repair || (action === 'restore') !== !!entry.removed) throw new Error(loc('Changed'));
		const content = document.createElement('div');
		text(content, loc(action === 'remove' ? 'CatalogRemoveHint' : 'CatalogRestoreHint'));
		text(content, entry.name); text(content, entry.path);
		text(content, `${loc('Fingerprint')}: ${entry.fingerprint}`);
		if (entry.catalogChanged) text(content, loc('CatalogChanged'));
		if (!await FoundryshopDialog.confirm({
			classes: ['foundryshop-library-management'], window: { title: loc(action === 'remove' ? 'CatalogRemove' : 'CatalogRestore') },
			content, modal: true, rejectClose: false,
			yes: { label: loc(action === 'remove' ? 'CatalogRemove' : 'CatalogRestore') },
		})) return null;
		check();
		return setLibraryCatalogRemoved(entry, action === 'remove', options);
	}
	if (action === 'repair') {
		if (!entry.repair) throw new Error(loc('Changed'));
		const reviewed = await inspectLibraryRepair(entry.repair, signal);
		check();
		const content = document.createElement('div');
		text(content, loc('RepairHint'));
		text(content, entry.path);
		text(content, `${reviewed.name} (${reviewed.kind}), ${reviewed.drawings} ${loc('RepairDrawings')}`);
		text(content, `${loc('Fingerprint')}: ${reviewed.fingerprint}`);
		text(content, reviewed.fingerprint === entry.repair.after ? loc('RepairMatchesAfter')
			: reviewed.fingerprint === entry.repair.before ? loc('RepairMatchesBefore') : loc('RepairDifferent'));
		if (!await FoundryshopDialog.confirm({
			classes: ['foundryshop-library-management'],
			window: { title: loc('Repair') }, content, modal: true, rejectClose: false,
			yes: { label: loc('AcceptCurrent') },
		})) return null;
		check();
		return acceptLibraryRepair(entry.repair, reviewed, options);
	}
	const content = document.createElement('div');
	text(content, loc(action === 'edit' ? 'EditHint' : 'DuplicateHint'));
	text(content, entry.path);
	for (const [name, value, maxlength] of [
		['name', entry.name, 80], ['category', entry.category ?? (entry.kind === 'shape' ? 'Custom' : 'Project'), 40],
		['tags', (entry.tags ?? []).join(', '), 491],
	]) {
		const label = document.createElement('label'); label.textContent = loc(`Field.${name}`);
		const input = document.createElement('input');
		for (const [key, val] of Object.entries({ name, type: 'text', value, maxlength, ...(name !== 'tags' ? { required: '' } : {}) })) input.setAttribute(key, String(val));
		label.append(input); content.append(label);
	}
	const selected = await FoundryshopDialog.prompt({
		classes: ['foundryshop-library-management'],
		window: { title: loc(action === 'edit' ? 'Edit' : 'DuplicateEntry') }, content, modal: true, rejectClose: false,
		ok: { callback: (event, button) => normalizeLibraryMetadata({
			name: button.form.elements.name.value, category: button.form.elements.category.value,
			tags: button.form.elements.tags.value.split(',').map(tag => tag.trim()).filter(Boolean),
		}) },
	});
	if (!selected) return null;
	check();
	const metadata = normalizeLibraryMetadata(selected);
	if (action === 'edit') {
		const warning = document.createElement('div');
		text(warning, loc('ReplaceHint')); text(warning, entry.path);
		text(warning, `${loc('Field.name')}: ${metadata.name}; ${loc('Field.category')}: ${metadata.category}; ${loc('Field.tags')}: ${metadata.tags.join(', ')}`);
		if (!await FoundryshopDialog.confirm({
			classes: ['foundryshop-library-management'],
			window: { title: loc('ReplaceConfirm') }, content: warning, modal: true, rejectClose: false,
			yes: { label: loc('ReplaceConfirm') },
		})) return null;
		check();
		return editLibraryMetadata(entry, metadata, options);
	}
	return duplicateLibraryEntry(entry, metadata, options);
}
import { FoundryshopDialog } from './dialogs.js';
