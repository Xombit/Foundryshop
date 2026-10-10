import { MODULE } from '../constants.js';
import { validateAssetFolder } from '../artwork_stamps.js';

export const BAKE_RECOVERY_FOLDER = 'bakeRecoveryFolder';
const loc = key => game.i18n.localize(`FOUNDRYSHOP.Bake.${key}`);

export function registerBakeStorageSetting() {
	game.settings.register(MODULE, BAKE_RECOVERY_FOLDER, {
		name: 'FOUNDRYSHOP.Bake.FolderName', hint: 'FOUNDRYSHOP.Bake.FolderHint',
		scope: 'world', config: true, type: String, default: '', filePicker: 'folder',
	});
}

/** Read-only existing-folder preflight. No probe upload, directory creation or settings write. */
export async function reviewBakeStorage({ root, isCurrent, signal } = {}) {
	if (typeof isCurrent !== 'function') throw new Error(loc('StorageChanged'));
	const configured = root === undefined;
	const folder = validateAssetFolder(configured ? game.settings.get(MODULE, BAKE_RECOVERY_FOLDER) : root);
	const owner = game.user?.id;
	const check = () => {
		if (!game.user?.isGM || game.user.id !== owner || game.users?.activeGM?.id !== owner
			|| !game.user.can('FILES_BROWSE') || !game.user.can('FILES_UPLOAD') || signal?.aborted || !isCurrent()
			|| configured && game.settings.get(MODULE, BAKE_RECOVERY_FOLDER) !== folder) {
			throw new Error(loc('StorageChanged'));
		}
		return true;
	};
	const inspect = async () => {
		check();
		const listing = await foundry.applications.apps.FilePicker.implementation.browse('data', folder);
		check();
		if (!listing || listing.target !== folder || !Array.isArray(listing.files) || !Array.isArray(listing.dirs)
			|| [...listing.files, ...listing.dirs].some(path => typeof path !== 'string')
			|| typeof listing.private !== 'boolean') {
			throw new Error(loc('StorageListingInvalid'));
		}
		if (listing.private) throw new Error(loc('StoragePrivate'));
		return true;
	};
	await inspect();
	return Object.freeze({
		root: folder, assertCurrent: check, assertAvailable: inspect,
		review: { root: folder, source: 'data', configured, shared: true,
			disclosure: loc('FolderHint') },
	});
}
