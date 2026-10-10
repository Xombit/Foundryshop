import { canonicalJson } from './project_package.js';

const creates = new Map();
const deletes = new Map();
const updates = new Map();
const permissionKey = '_foundryshopRecoveryNative';

function authorize(registry, options, permission) {
	if (Object.hasOwn(options, permissionKey)) throw new Error('Recovery native options already contain a scoped permission.');
	const token = crypto.randomUUID();
	options[permissionKey] = token;
	registry.set(token, permission);
	return () => {
		registry.delete(token);
		delete options[permissionKey];
	};
}

/** Foundry copies operation options before hooks; only a live scoped token survives that boundary. */
export function authorizeRecoveryImportCreates(options, scene, intent, sources) {
	return authorize(creates, options, { scene, intent,
		sources: new Map(sources.map(source => [source._id, canonicalJson(source)])) });
}

export function isAuthorizedRecoveryImportCreate(document, options) {
	const permission = creates.get(options?.[permissionKey]);
	if (!permission || document.parent !== permission.scene || !game.user?.isGM
		|| game.user.id !== permission.intent.ownerId || game.users?.activeGM?.id !== game.user.id
		|| canonicalJson(document.parent.getFlag('foundryshop', 'projectImportJournal')) !== canonicalJson(permission.intent)
		|| permission.intent.phase !== 'tree-installed') return false;
	return permission.sources.has(document.id)
		&& permission.sources.get(document.id) === canonicalJson(document.toObject());
}

/** Only exact hidden owned sources under a compensating intent may bypass layer locks. */
export function authorizeRecoveryImportDeletes(options, scene, intent, sources) {
	return authorize(deletes, options, { scene, intent,
		sources: new Map(sources.map(source => [source._id, canonicalJson(source)])) });
}

export function isAuthorizedRecoveryImportDelete(document, options) {
	const permission = deletes.get(options?.[permissionKey]);
	if (!permission || document.parent !== permission.scene || !game.user?.isGM
		|| game.user.id !== permission.intent.ownerId || game.users?.activeGM?.id !== game.user.id
		|| permission.intent.phase !== 'compensating'
		|| canonicalJson(document.parent.getFlag('foundryshop', 'projectImportJournal')) !== canonicalJson(permission.intent)
		|| document.toObject().hidden !== true
		|| document.getFlag('foundryshop', 'importStaging') !== permission.intent.token) return false;
	return permission.sources.has(document.id)
		&& permission.sources.get(document.id) === canonicalJson(document.toObject());
}

/** Exact hidden-to-final patch only; permission expires with the native update call. */
export function authorizeRecoveryImportUpdates(options, scene, intent, sources, patches) {
	const accepted = patches.map(patch => {
		const key = Object.hasOwn(patch, 'flags.-=foundryshop') ? 'flags.-=foundryshop' : 'flags.foundryshop.-=importStaging';
		if (Object.keys(patch).length !== 3 || typeof patch.hidden !== 'boolean' || patch[key] !== null) {
			throw new Error('Recovery native updates require an exact hidden/staging release patch.');
		}
		const expanded = { _id: patch._id, hidden: patch.hidden,
			flags: key === 'flags.-=foundryshop' ? { '-=foundryshop': null } : { foundryshop: { '-=importStaging': null } } };
		return [patch._id, new Set([canonicalJson(patch), canonicalJson(expanded)])];
	});
	return authorize(updates, options, { scene, intent,
		sources: new Map(sources.map(source => [source._id, canonicalJson(source)])),
		patches: new Map(accepted) });
}

export function isAuthorizedRecoveryImportUpdate(document, changes, options) {
	const permission = updates.get(options?.[permissionKey]);
	if (!permission || document.parent !== permission.scene || !game.user?.isGM
		|| game.user.id !== permission.intent.ownerId || game.users?.activeGM?.id !== game.user.id
		|| permission.intent.phase !== 'history-installed'
		|| canonicalJson(document.parent.getFlag('foundryshop', 'projectImportJournal')) !== canonicalJson(permission.intent)
		|| document.toObject().hidden !== true
		|| document.getFlag('foundryshop', 'importStaging') !== permission.intent.token) return false;
	return permission.sources.has(document.id)
		&& permission.sources.get(document.id) === canonicalJson(document.toObject())
		&& permission.patches.get(document.id)?.has(canonicalJson(changes)) === true;
}
