import { canonicalJson } from './project_package.js';
import { reviewBakeStorage } from './bake_storage.js';
import { importReviewedRecoveryProject } from './recovery_import_lifecycle.js';
import { RecoveryImportReviewCancelledError } from './recovery_import_dialogs.js';

const loc = key => game.i18n.localize(`FOUNDRYSHOP.RecoveryImport.${key}`);

function field(parent, name, key, tag, attributes = {}) {
	const label = document.createElement('label'), caption = document.createElement('span'),
		control = document.createElement(tag);
	caption.textContent = loc(key); control.name = name;
	for (const [attribute, value] of Object.entries(attributes)) control.setAttribute(attribute, value);
	label.append(caption, control); parent.append(label);
	return control;
}

/** Setup only. No Scene creation/activation, settings write, upload or import authority. */
export async function promptRecoveryImportSetup(scene, options = {}) {
	options = { ...options };
	if (typeof options.isCurrent !== 'function'
		|| !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes >= 0xffffffff
		|| !Number.isSafeInteger(options.maxEntries) || options.maxEntries < 2 || options.maxEntries >= 65535
		|| !Number.isSafeInteger(options.maxReceiptBytes) || options.maxReceiptBytes < 1 || options.maxReceiptBytes >= 0xffffffff
		|| !Number.isSafeInteger(options.timeout) || options.timeout < 0) throw new Error(loc('SetupBudgets'));
	if (!scene?.levels?.size) throw new Error(loc('SetupDestination'));
	const snapshot = canonicalJson(scene.toObject()), owner = game.user?.id;
	const check = () => {
		if (!game.user?.isGM || game.user.id !== owner || game.users?.activeGM?.id !== owner
			|| !game.user.can('FILES_BROWSE') || !game.user.can('FILES_UPLOAD')
			|| game.scenes?.get(scene.id) !== scene || !scene.canUserModify(game.user, 'update')
			|| options.signal?.aborted || !options.isCurrent() || canonicalJson(scene.toObject()) !== snapshot) {
			throw new Error(loc('Changed'));
		}
		return true;
	};
	check();
	const content = document.createElement('div'), warning = document.createElement('p');
	warning.textContent = game.i18n.format('FOUNDRYSHOP.RecoveryImport.SetupWarning', { scene: scene.name, id: scene.id, maxBytes: options.maxBytes });
	content.append(warning);
	const fileInput = field(content, 'recoveryZip', 'ZipFile', 'input', { type: 'file', accept: '.zip,application/zip', required: '' }),
		levelInput = field(content, 'destinationLevel', 'DestinationLevel', 'select', { required: '' }),
		rootInput = field(content, 'storageRoot', 'StorageRoot', 'input', { type: 'text', required: '' }),
		metadata = field(content, 'replaceMetadata', 'MetadataDecision', 'input', { type: 'checkbox' });
	const browse = document.createElement('button'), status = document.createElement('p');
	browse.type = 'button'; browse.textContent = loc('BrowseFolder');
	status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
	content.append(browse, status);
	let picker, closed = false;
	const report = error => {
		status.textContent = game.i18n.format('FOUNDRYSHOP.Error', { message: error.message });
		ui.notifications.error(status.textContent);
	};
	browse.addEventListener('click', async () => {
		if (closed || browse.disabled) return;
		browse.disabled = true;
		try {
			check();
			if (picker) await picker.close();
			check();
			if (closed) return;
			picker = new foundry.applications.apps.FilePicker.implementation({
				type: 'folder', activeSource: 'data', current: rootInput.value,
				callback: path => {
					if (closed) return;
					try { check(); rootInput.value = path; status.textContent = ''; }
					catch (error) { report(error); }
				},
			});
			await picker.render({ force: true });
			if (closed) await picker.close();
		} catch (error) { report(error); }
		finally { browse.disabled = false; }
	});
	for (const level of scene.levels.values()) {
		const option = document.createElement('option'); option.value = level.id;
		option.textContent = `${level.name} (${level.id})`; levelInput.append(option);
	}
	if (options.levelId !== undefined) levelInput.value = options.levelId;
	if (options.root !== undefined) rootInput.value = options.root;
	let selected;
	try {
		selected = await FoundryshopDialog.prompt({
			classes: ['foundryshop-recovery-review'], window: { title: loc('SetupTitle') },
			content, modal: true, rejectClose: false,
			close: () => { closed = true; },
			ok: { label: loc('SetupContinue'), callback: () => {
				check();
				const file = fileInput.files?.[0];
				if (fileInput.files?.length !== 1 || !(file instanceof File) || !/\.zip$/i.test(file.name)
					|| !file.size || file.size > options.maxBytes) throw new Error(loc('InvalidZipFile'));
				if (!scene.levels.has(levelInput.value)) throw new Error(loc('SetupDestination'));
				return { file, levelId: levelInput.value, root: rootInput.value, replaceEmptyMetadata: metadata.checked === true };
			} },
		});
	} finally {
		closed = true;
		if (picker) await picker.close();
	}
	check();
	if (!selected) throw new RecoveryImportReviewCancelledError();
	const storage = await reviewBakeStorage({ root: selected.root, isCurrent: check, signal: options.signal });
	const listing = await foundry.applications.apps.FilePicker.implementation.browse('data', storage.root);
	check(); storage.assertCurrent();
	if (listing.target !== storage.root || listing.private !== false || !Array.isArray(listing.dirs)
		|| !Array.isArray(listing.files) || [...listing.files, ...listing.dirs].some(path => typeof path !== 'string')) {
		throw new Error(loc('SetupListing'));
	}
	const input = new Uint8Array(await selected.file.arrayBuffer());
	check();
	if (input.length !== selected.file.size || input.length > options.maxBytes) throw new Error(loc('InvalidZipFile'));
	return { input, options: { ...options, root: storage.root, levelId: selected.levelId,
		replaceEmptyMetadata: selected.replaceEmptyMetadata, reservedPaths: [...listing.files] } };
}

/** Opt-in setup plus existing independently reviewed workflow; no public registration. */
export async function promptReviewedRecoveryImport(scene, options = {}) {
	const selected = await promptRecoveryImportSetup(scene, options);
	return importReviewedRecoveryProject(scene, selected.input, selected.options);
}
import { FoundryshopDialog } from '../dialogs.js';
