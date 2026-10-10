import { canonicalJson } from './layers/project_package.js';

export const PATH_HISTORY_CHANGED = 'foundryshopPathHistoryChanged';
export const PATH_HISTORY_LIMITS = Object.freeze({ entries: 20, bytes: 24 * 1024 * 1024 });
const histories = new WeakMap();
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const routeContent = route => route ? { ...route, revision: 0 } : null;
const fail = () => { throw new Error(game.i18n.localize('FOUNDRYSHOP.Paths.HistoryConflict')); };

function history(scene) {
	let users = histories.get(scene);
	if (!users) { users = new Map(); histories.set(scene, users); }
	if (!users.has(game.user.id)) users.set(game.user.id, { entries: [], cursor: 0, busy: false });
	return users.get(game.user.id);
}

export function getPathHistoryState(scene) {
	if (!scene) return { undo: false, redo: false, busy: false };
	const state = history(scene);
	return { undo: state.cursor > 0, redo: state.cursor < state.entries.length, busy: state.busy,
		undoLabel: state.entries[state.cursor - 1]?.label, redoLabel: state.entries[state.cursor]?.label };
}

export function preparePathHistory(beforeRegistry, afterRegistry, before, after, label) {
	const beforeSources = new Map(before.map(d => [d._id, d])), afterSources = new Map(after.map(d => [d._id, d]));
	const drawingIds = [...new Set([...beforeSources.keys(), ...afterSources.keys()])]
		.filter(id => !same(beforeSources.get(id), afterSources.get(id)));
	const beforeRoutes = new Map((beforeRegistry?.routes ?? []).map(r => [r.id, r]));
	const afterRoutes = new Map(afterRegistry.routes.map(r => [r.id, r]));
	const routeIds = [...new Set([...beforeRoutes.keys(), ...afterRoutes.keys()])]
		.filter(id => !same(routeContent(beforeRoutes.get(id)), routeContent(afterRoutes.get(id))));
	if (!drawingIds.length && !routeIds.length) return null;
	const entry = structuredClone({ label, drawingIds, routeIds,
		before: drawingIds.map(id => beforeSources.get(id) ?? null), after: drawingIds.map(id => afterSources.get(id) ?? null),
		beforeRoutes: routeIds.map(id => beforeRoutes.get(id) ?? null), afterRoutes: routeIds.map(id => afterRoutes.get(id) ?? null) });
	entry.bytes = new TextEncoder().encode(JSON.stringify(entry)).length;
	if (entry.bytes > PATH_HISTORY_LIMITS.bytes) throw new Error(game.i18n.localize('FOUNDRYSHOP.Paths.HistoryLimit'));
	return entry;
}

export function recordPathHistory(scene, entry) {
	if (!entry) return;
	const state = history(scene);
	state.entries.splice(state.cursor);
	state.entries.push(entry);
	let bytes = state.entries.reduce((sum, e) => sum + e.bytes, 0);
	while (state.entries.length > PATH_HISTORY_LIMITS.entries || bytes > PATH_HISTORY_LIMITS.bytes) bytes -= state.entries.shift().bytes;
	state.cursor = state.entries.length;
	Hooks.callAll(PATH_HISTORY_CHANGED, scene);
}

export function clearPathHistory(scene) {
	histories.delete(scene);
	Hooks.callAll(PATH_HISTORY_CHANGED, scene);
}

export async function replayPathHistory(scene, direction, execute) {
	const state = history(scene);
	if (state.busy || !['undo', 'redo'].includes(direction)) fail();
	const index = direction === 'undo' ? state.cursor - 1 : state.cursor;
	const entry = state.entries[index];
	if (!entry) throw new Error(game.i18n.localize('FOUNDRYSHOP.Paths.HistoryEmpty'));
	state.busy = true;
	Hooks.callAll(PATH_HISTORY_CHANGED, scene);
	try {
		await execute(entry, direction === 'undo');
		state.cursor += direction === 'undo' ? -1 : 1;
	} finally { state.busy = false; Hooks.callAll(PATH_HISTORY_CHANGED, scene); }
}

export function planPathHistoryReplay(entry, undo, registry, sources) {
	const expected = undo ? entry.after : entry.before, target = undo ? entry.before : entry.after;
	const expectedRoutes = undo ? entry.afterRoutes : entry.beforeRoutes, targetRoutes = undo ? entry.beforeRoutes : entry.afterRoutes;
	const current = new Map(sources.map(d => [d._id, d])), routes = new Map(registry.routes.map(r => [r.id, r]));
	for (const [index, id] of entry.drawingIds.entries()) if (!same(current.get(id) ?? null, expected[index])) fail();
	for (const [index, id] of entry.routeIds.entries()) if (!same(routeContent(routes.get(id)), routeContent(expectedRoutes[index]))) fail();
	const changed = new Set(entry.drawingIds), changedRoutes = new Set(entry.routeIds);
	const after = [...sources.filter(d => !changed.has(d._id)), ...target.filter(Boolean)];
	const next = { ...registry, revision: registry.revision + 1, routes: [
		...registry.routes.filter(r => !changedRoutes.has(r.id)),
		...targetRoutes.filter(Boolean).map(r => ({ ...r, revision: Math.max(registry.revision, r.revision, routes.get(r.id)?.revision ?? 0,
			...expectedRoutes.filter(Boolean).filter(e => e.id === r.id).map(e => e.revision)) + 1 })),
	] };
	return { after, registry: next, destinations: [...expectedRoutes, ...targetRoutes].filter(Boolean) };
}
