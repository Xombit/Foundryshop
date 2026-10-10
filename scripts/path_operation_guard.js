import { MODULE } from './constants.js';
import { canonicalJson } from './layers/project_package.js';

export const PATH_JOURNAL_FLAG = 'pathJournal';
const permissionKey = '_foundryshopPathWrite';
const permissions = new Map();
const source = document => JSON.parse(JSON.stringify(document.toObject()));
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

export function assertNoPendingPathOperation(scene) {
	if (scene?.getFlag(MODULE, PATH_JOURNAL_FLAG) !== undefined) {
		throw new Error(game.i18n.localize('FOUNDRYSHOP.Paths.PendingOperation'));
	}
}

function expanded(patch) {
	return JSON.parse(JSON.stringify(foundry.utils.expandObject(patch)));
}

/** Permission is local, exact and expires when the native call settles. It never bypasses locks. */
export async function withPathWrite(scene, operation, payload, options, write) {
	const token = foundry.utils.randomID();
	if (permissions.has(token) || Object.hasOwn(options, permissionKey)) throw new Error('Path write permission collision.');
	const journal = structuredClone(scene.getFlag(MODULE, PATH_JOURNAL_FLAG));
	const before = new Map([...scene.drawings.values()].map(drawing => [drawing.id, source(drawing)]));
	const patches = new Map(operation === 'update' ? payload.map(patch => [patch._id, expanded(patch)]) : []);
	const creates = new Map(operation === 'create' ? payload.map(data => [data._id, data]) : []);
	const ids = new Set(operation === 'delete' ? payload : []);
	permissions.set(token, { scene, operation, journal, before, patches, creates, ids,
		scenePatch: operation === 'scene' ? expanded(payload) : null, userId: game.user.id });
	const scoped = { ...options, [permissionKey]: token };
	try { return await write(scoped); }
	finally { permissions.delete(token); }
}

export function isAuthorizedPathWrite(document, operation, patch, options) {
	const permission = permissions.get(options?.[permissionKey]);
	if (!permission || permission.operation !== operation || !game.user.isGM
		|| game.user.id !== permission.userId || (operation === 'scene' ? document : document.parent) !== permission.scene
		|| !same(permission.scene.getFlag(MODULE, PATH_JOURNAL_FLAG), permission.journal)) return false;
	if (operation === 'scene') {
		const changes = { ...patch }; delete changes._id;
		return same(expanded(changes), permission.scenePatch);
	}
	if (operation === 'create') return same(source(document), permission.creates.get(document.id));
	if (!same(source(document), permission.before.get(document.id))) return false;
	if (operation === 'delete') return permission.ids.has(document.id);
	return same(expanded(patch), permission.patches.get(document.id));
}

const stagedCache = new WeakMap();

export function isPendingPathDrawing(document) {
	const scene = document.parent, journal = scene?.getFlag(MODULE, PATH_JOURNAL_FLAG);
	if (journal === undefined) return false;
	let cached = stagedCache.get(scene);
	if (!cached || cached.journal !== journal) {
		if (!journal || journal.version !== 1 || journal.sceneId !== scene.id || !Array.isArray(journal.before) || !Array.isArray(journal.after)
			|| journal.before.length > 10000 || journal.after.length > 10000
			|| [...journal.before, ...journal.after].some(data => !data || typeof data._id !== 'string')) {
			throw new Error(game.i18n.localize('FOUNDRYSHOP.Paths.InvalidRecovery'));
		}
		const before = new Map(journal.before.map(data => [data._id, data]));
		const after = new Map(journal.after.map(data => [data._id, data]));
		const ids = new Set();
		for (const id of new Set([...before.keys(), ...after.keys()])) {
			const old = before.get(id), next = after.get(id);
			if ((old?.flags?.[MODULE]?.path || next?.flags?.[MODULE]?.path) && !same(old, next)) ids.add(id);
		}
		cached = { journal, ids }; stagedCache.set(scene, cached);
	}
	return cached.ids.has(document.id);
}
