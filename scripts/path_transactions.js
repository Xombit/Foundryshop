import { MODULE } from './constants.js';
import { canonicalJson } from './layers/project_package.js';
import { readLayerTree, readLayerWorkspace, runLayerOperation, LAYER_OPERATION } from './layers/layer_manager.js';
import { lockedLayerIds, effectiveLayerGate } from './layers/layer_tree_store.js';
import { planStampSorts, planDrawingOrder } from './layers/drawing_order_service.js';
import { prepareArtworkSnapshot } from './artwork_renderer.js';
import { exportProjectDrawing } from './layers/project_transfer_service.js';
import { PATH_SCHEMA_VERSION, PATH_REGISTRY_FLAG, validatePathRegistry, validatePathRecipe } from './path_schema.js';
import { readPathRegistry, inspectPathIntegrity, pathComponentBaseline, buildPathRecipeComponents, pathConflictSnapshot } from './path_store.js';
import { readOptimizationJournal } from './layers/optimization_journal.js';
import { PATH_JOURNAL_FLAG, withPathWrite } from './path_operation_guard.js';
import { preparePathHistory, recordPathHistory, replayPathHistory, planPathHistoryReplay, clearPathHistory } from './path_history.js';
import { translatePathRecipe } from './path_draft.js';

export { PATH_JOURNAL_FLAG } from './path_operation_guard.js';
const JOURNAL_BYTES = 12 * 1024 * 1024;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = message => { throw new Error(`Foundryshop Paths: ${message}`); };
const jsonSource = drawing => JSON.parse(JSON.stringify(drawing.toObject()));
const snapshots = scene => [...scene.drawings.values()].map(jsonSource);
const documentOptions = { keepId: true, diff: false, recursive: false, isUndo: true, [LAYER_OPERATION]: true };
const updatePayload = (source, current) => same({ ...source, sort: current.sort }, current)
	? { _id: source._id, sort: source.sort } : source;

function requireGM(scene) {
	if (!scene || !game.user.isGM || !game.user.can('DRAWING_CREATE')
		|| !scene.canUserModify(game.user, 'update')) fail('A GM with Scene update and Drawing creation permission is required.');
}

function otherRecovery(scene) {
	return scene.getFlag(MODULE, 'projectImportJournal')
		|| readOptimizationJournal(scene).entries.some(entry => entry.phase !== 'complete');
}

function destination(scene, layerId, levelId, elevation) {
	requireGM(scene);
	if (otherRecovery(scene)
		|| scene.getFlag(MODULE, 'pathJournal')) fail('Resolve pending Scene recovery before changing a path.');
	const tree = readLayerTree(scene), workspace = readLayerWorkspace(scene);
	const layer = tree.nodes.find(node => node.id === layerId && node.kind === 'layer');
	if (!layer || lockedLayerIds(tree).has(layerId)
		|| !effectiveLayerGate(tree, layerId, node => !workspace.hiddenIds.includes(node.id))
		|| !scene.levels.has(levelId) || !Number.isFinite(elevation)) fail('The destination layer or Level is unavailable.');
	return structuredClone(tree);
}

function nativeData(scene, source) {
	const drawing = new (getDocumentClass('Drawing'))(source, { parent: scene, strict: true });
	const result = drawing.toObject();
	const preserves = (expected, actual) => {
		if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
			return actual && typeof actual === 'object' && Object.keys(expected).every(key => preserves(expected[key], actual[key]));
		}
		return same(expected, actual);
	};
	if (!preserves(source, result)) fail('Native Drawing validation changed prepared artwork.');
	const portable = exportProjectDrawing(drawing);
	delete portable.data.flags[MODULE]?.path;
	prepareArtworkSnapshot([portable]);
	return jsonSource(drawing);
}

function buildSources(scene, id, recipe, target, old = []) {
	const parts = buildPathRecipeComponents(recipe);
	const available = [...old];
	return parts.map((part, index) => {
		const at = available.findIndex(source => source.flags?.[MODULE]?.path?.role === part.role);
		const previous = at < 0 ? undefined : available.splice(at, 1)[0];
		const source = {
			...(previous ?? {}), ...part.data, _id: previous?._id ?? foundry.utils.randomID(),
			sort: previous?.sort ?? index * 1024, author: previous?.author ?? game.user.id,
			name: previous?.name ?? '',
			levels: [target.levelId], elevation: target.elevation,
			...(old.length ? { hidden: (previous ?? old[0]).hidden, locked: (previous ?? old[0]).locked } : {}),
			flags: { ...previous?.flags, [MODULE]: { ...previous?.flags?.[MODULE],
				layerId: target.layerId, path: { version: PATH_SCHEMA_VERSION, id, role: part.role } } },
		};
		return { role: part.role, data: nativeData(scene, source) };
	});
}

function routeEntry(scene, id, name, recipe, target, parts, revision) {
	return { id, revision, name, ...target, recipe, components: parts.map(({ role, data }) => ({
		drawingId: data._id, role, baseline: pathComponentBaseline(new (getDocumentClass('Drawing'))(data, { parent: scene })),
	})) };
}

function verifyState(scene, registry, drawings) {
	if (!same(scene.getFlag(MODULE, PATH_REGISTRY_FLAG), registry) || !same(
		snapshots(scene).sort((a, b) => a._id.localeCompare(b._id)),
		[...drawings].sort((a, b) => a._id.localeCompare(b._id)))) fail('Scene artwork or retained paths changed during the operation.');
}

function writeScene(scene, patch) {
	return withPathWrite(scene, 'scene', patch, { diff: false, [LAYER_OPERATION]: true },
		options => scene.update(patch, options));
}

function writeDrawings(scene, operation, payload) {
	const method = { create: 'createEmbeddedDocuments', update: 'updateEmbeddedDocuments', delete: 'deleteEmbeddedDocuments' }[operation];
	return withPathWrite(scene, operation, payload, documentOptions,
		options => scene[method]('Drawing', payload, options));
}

async function removeJournal(scene) {
	await writeScene(scene, { [`flags.${MODULE}.${PATH_JOURNAL_FLAG}`]: new foundry.data.operators.ForcedDeletion() });
	if (scene.getFlag(MODULE, PATH_JOURNAL_FLAG) !== undefined) fail('Path journal removal was not verified.');
}

async function writeRegistry(scene, registry) {
	await writeScene(scene, registry === undefined ? { [`flags.${MODULE}.${PATH_REGISTRY_FLAG}`]: new foundry.data.operators.ForcedDeletion() }
		: { [`flags.${MODULE}.${PATH_REGISTRY_FLAG}`]: registry });
	if (!same(scene.getFlag(MODULE, PATH_REGISTRY_FLAG), registry)) fail('Path registry write was not verified.');
}

function validateJournal(scene, journal) {
	const json = (value, depth = 0) => {
		if (depth > 64) fail('Invalid path recovery nesting.');
		if (value === null || ['string', 'boolean'].includes(typeof value)
			|| typeof value === 'number' && Number.isFinite(value)) return;
		if (!value || typeof value !== 'object' || !Array.isArray(value)
			&& ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Invalid path recovery JSON.');
		for (const [key, child] of Object.entries(value)) {
			if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('Invalid path recovery metadata key.');
			json(child, depth + 1);
		}
	};
	json(journal);
	const keys = ['version', 'sceneId', 'token', 'beforeRegistry', 'afterRegistry', 'before', 'after',
		...(Object.hasOwn(journal ?? {}, 'detachedConflict') ? ['detachedConflict'] : [])];
	if (!journal || Object.keys(journal).length !== keys.length || keys.some(key => !Object.hasOwn(journal, key))
		|| journal.version !== 1 || journal.sceneId !== scene.id || typeof journal.token !== 'string'
		|| !/^[a-zA-Z0-9_-]{1,64}$/.test(journal.token)
		|| !Array.isArray(journal.before) || !Array.isArray(journal.after)
		|| journal.before.length > 10000 || journal.after.length > 10000
		|| [...journal.before, ...journal.after].some(d => !d || typeof d._id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(d._id))
		|| new Set(journal.before.map(d => d._id)).size !== journal.before.length
		|| new Set(journal.after.map(d => d._id)).size !== journal.after.length) fail('Invalid path recovery journal.');
	if (journal.beforeRegistry !== null) validatePathRegistry(journal.beforeRegistry);
	validatePathRegistry(journal.afterRegistry);
	if (journal.detachedConflict !== undefined && (!journal.beforeRegistry?.routes.some(r => r.id === journal.detachedConflict)
		|| journal.afterRegistry.routes.some(r => r.id === journal.detachedConflict)
		|| journal.after.some(d => d.flags?.[MODULE]?.path?.id === journal.detachedConflict))) {
		fail('Invalid conflict detach recovery.');
	}
	if (new TextEncoder().encode(JSON.stringify(journal)).length > JOURNAL_BYTES) fail('Path operation exceeds the recovery storage budget.');
	for (const source of [...journal.before, ...journal.after]) nativeData(scene, source);
	for (const [registry, sources] of [[journal.beforeRegistry, journal.before], [journal.afterRegistry, journal.after]]) {
		if (registry === null) continue;
		const drawings = new Map(sources.map(source => [source._id, source]));
		for (const route of registry.routes) for (const component of route.components) {
			if (registry === journal.beforeRegistry && route.id === journal.detachedConflict) continue;
			const source = drawings.get(component.drawingId);
			if (!source || source.flags?.[MODULE]?.layerId !== route.layerId
				|| !same(source.flags?.[MODULE]?.path, { version: PATH_SCHEMA_VERSION, id: route.id, role: component.role })
				|| pathComponentBaseline(new (getDocumentClass('Drawing'))(source, { parent: scene })) !== component.baseline) {
				fail('Path recovery registry does not match its native artwork.');
			}
		}
	}
	return journal;
}

async function restoreJournal(scene, journal) {
	validateJournal(scene, journal);
	const beforeRegistry = journal.beforeRegistry ?? undefined;
	const before = new Map(journal.before.map(d => [d._id, d])), after = new Map(journal.after.map(d => [d._id, d]));
	const check = () => {
		requireGM(scene);
		if (!same(scene.getFlag(MODULE, PATH_JOURNAL_FLAG), journal)) fail('Recovery ownership changed.');
		const registry = scene.getFlag(MODULE, PATH_REGISTRY_FLAG);
		if (!same(registry, beforeRegistry) && !same(registry, journal.afterRegistry)) fail('Registry changed externally; recovery refused.');
		for (const drawing of scene.drawings.values()) {
			if (!same(jsonSource(drawing), before.get(drawing.id)) && !same(jsonSource(drawing), after.get(drawing.id))) {
				fail('Artwork changed externally; recovery refused without overwriting it.');
			}
		}
		for (const [id, source] of before) {
			if (!scene.drawings.has(id) && same(source, after.get(id))) fail('Unrelated artwork disappeared; recovery refused.');
		}
	};
	check();
	const created = [...scene.drawings.keys()].filter(id => !before.has(id));
	if (created.length) await writeDrawings(scene, 'delete', created);
	check();
	const missing = [], updates = [];
	for (const source of before.values()) {
		if (!scene.drawings.has(source._id)) missing.push(source);
		else {
			const current = jsonSource(scene.drawings.get(source._id));
			if (!same(current, source)) updates.push(updatePayload(source, current));
		}
	}
	if (missing.length) await writeDrawings(scene, 'create', missing);
	check();
	if (updates.length) await writeDrawings(scene, 'update', updates);
	check();
	await writeRegistry(scene, beforeRegistry);
	check();
	verifyState(scene, beforeRegistry, journal.before);
	await removeJournal(scene);
}

async function commit(scene, beforeRegistry, afterRegistry, before, after, tree, isCurrent, historyLabel = 'Edit', replay = false, detachedConflict) {
	const historyEntry = replay ? null : preparePathHistory(beforeRegistry, afterRegistry, before, after, historyLabel);
	const workspace = readLayerWorkspace(scene);
	const levelState = () => [...scene.levels.entries()].map(([id, level]) => ({ id, elevation: level.elevation ?? null }));
	const levels = structuredClone(levelState());
	const journal = validateJournal(scene, {
		version: 1, sceneId: scene.id, token: foundry.utils.randomID(), beforeRegistry: beforeRegistry ?? null,
		afterRegistry, before, after,
		...(detachedConflict ? { detachedConflict } : {}),
	});
	const check = () => {
		requireGM(scene);
		if (!same(readLayerTree(scene), tree) || !same(readLayerWorkspace(scene), workspace)
			|| !same(levelState(), levels) || isCurrent && !isCurrent()) fail('The path destination changed.');
		if (otherRecovery(scene)) fail('Another Scene recovery operation began.');
		if (!same(scene.getFlag(MODULE, PATH_JOURNAL_FLAG), journal)) fail('Path transaction ownership changed.');
	};
	verifyState(scene, beforeRegistry, before);
	if (!same(readLayerTree(scene), tree) || isCurrent && !isCurrent()) fail('The path destination changed before saving.');
	try {
		await writeScene(scene, { [`flags.${MODULE}.${PATH_JOURNAL_FLAG}`]: journal });
		check(); verifyState(scene, beforeRegistry, before);
		const beforeIds = new Set(before.map(d => d._id)), afterIds = new Set(after.map(d => d._id));
		const old = new Map(before.map(d => [d._id, d]));
		const updates = after.filter(d => beforeIds.has(d._id) && !same(d, old.get(d._id)));
		const creates = after.filter(d => !beforeIds.has(d._id));
		const deletes = before.filter(d => !afterIds.has(d._id)).map(d => d._id);
		let expected = before;
		if (updates.length) {
			await writeDrawings(scene, 'update', updates.map(source => updatePayload(source, old.get(source._id))));
			const replaced = new Map(updates.map(d => [d._id, d]));
			expected = expected.map(d => replaced.get(d._id) ?? d);
			check(); verifyState(scene, beforeRegistry, expected);
		}
		if (creates.length) {
			await writeDrawings(scene, 'create', creates);
			expected = [...expected, ...creates];
			check(); verifyState(scene, beforeRegistry, expected);
		}
		if (deletes.length) {
			await writeDrawings(scene, 'delete', deletes);
			expected = expected.filter(d => !deletes.includes(d._id));
			check(); verifyState(scene, beforeRegistry, expected);
		}
		await writeRegistry(scene, afterRegistry);
		check(); verifyState(scene, afterRegistry, after);
		await removeJournal(scene);
		verifyState(scene, afterRegistry, after);
		recordPathHistory(scene, historyEntry);
		Hooks.callAll('foundryshopPathsChanged', scene);
	} catch (error) {
		if (same(scene.getFlag(MODULE, PATH_JOURNAL_FLAG), journal)) {
			try { await restoreJournal(scene, journal); }
			catch (recoveryError) {
				throw new Error(`${error.message} Recovery incomplete: ${recoveryError.message} Resolve the retained path journal before retrying.`, { cause: error });
			}
		} else if (!same(scene.getFlag(MODULE, PATH_REGISTRY_FLAG), beforeRegistry) || !same(snapshots(scene), before)) {
			throw new Error(`${error.message} Transaction ownership is unavailable; inspect the Scene before retrying.`, { cause: error });
		}
		throw error;
	}
}

export function createRetainedPath(scene, input, { layerId, levelId, elevation, name = 'Path', isCurrent } = {}) {
	const recipe = validatePathRecipe(input);
	return runLayerOperation(scene, async () => {
		const tree = destination(scene, layerId, levelId, elevation);
		const beforeRegistry = structuredClone(scene.getFlag(MODULE, PATH_REGISTRY_FLAG));
		const registry = readPathRegistry(scene), before = snapshots(scene), id = foundry.utils.randomID();
		if (registry.routes.some(r => r.id === id)) fail('Path identity collision.');
		const target = { layerId, levelId, elevation }, parts = buildSources(scene, id, recipe, target);
		const allocation = planStampSorts(tree, [...scene.drawings.values()], layerId, parts.length);
		for (const [index, part] of parts.entries()) part.data.sort = allocation.sorts[index];
		const updates = new Map(allocation.updates.map(update => [update._id, update.sort]));
		const after = [...before.map(d => updates.has(d._id) ? { ...d, sort: updates.get(d._id) } : d), ...parts.map(p => p.data)];
		if (after.length > 10000 || new Set(after.map(d => d._id)).size !== after.length) fail('Drawing limit or identity collision.');
		if (before.some(d => d.elevation !== elevation || !!d.interface)) fail('Mixed native drawing order is unsupported.');
		const route = routeEntry(scene, id, name, recipe, target, parts, 0);
		const next = validatePathRegistry({ ...registry, revision: registry.revision + 1, routes: [...registry.routes, route] });
		await commit(scene, beforeRegistry, next, before, after, tree, isCurrent, 'Create');
		return route;
	});
}

export function updateRetainedPath(scene, id, input, { expectedRevision, isCurrent } = {}) {
	const recipe = validatePathRecipe(input);
	return runLayerOperation(scene, async () => {
		const integrity = inspectPathIntegrity(scene, id), original = integrity.route;
		const tree = destination(scene, original.layerId, original.levelId, original.elevation);
		if (!integrity.intact || original.revision !== expectedRevision) fail('Path changed; review it again before applying.');
		const registry = readPathRegistry(scene), before = snapshots(scene);
		const old = original.components.map(c => jsonSource(scene.drawings.get(c.drawingId)));
		if (old.some(d => d.locked)) fail('Unlock the component Drawings before editing.');
		const target = { layerId: original.layerId, levelId: original.levelId, elevation: original.elevation };
		const parts = buildSources(scene, id, recipe, target, old);
		const members = new Set(old.map(d => d._id)), peers = [...scene.drawings.values()].filter(d => !members.has(d.id));
		if (planDrawingOrder(tree, [...scene.drawings.values()]).length) fail('Repair native layer order before editing a path.');
		// Keep the existing block position when its complete native sort interval has room.
		const lower = Math.min(...old.map(d => d.sort)), upper = Math.min(Infinity, ...peers.filter(d => d.sort > lower).map(d => d.sort));
		const preserve = Number.isSafeInteger(lower) && Number.isSafeInteger(lower + parts.length - 1)
			&& lower + parts.length - 1 < upper && !peers.some(d => d.sort === lower);
		const sortUpdates = new Map();
		if (preserve) for (const [index, part] of parts.entries()) part.data.sort = lower + index;
		else {
			const stack = [...scene.drawings.values()].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
			const first = stack.findIndex(d => members.has(d.id));
			const at = stack.slice(0, first).filter(d => !members.has(d.id)).length;
			const ordered = stack.filter(d => !members.has(d.id));
			ordered.splice(at, 0, ...parts.map(part => ({ id: part.data._id, sort: part.data.sort })));
			for (const [index, drawing] of ordered.entries()) sortUpdates.set(drawing.id, (index + 1) * 1024);
			for (const part of parts) part.data.sort = sortUpdates.get(part.data._id);
		}
		const after = [...before.filter(d => !members.has(d._id)).map(d => sortUpdates.has(d._id) ? { ...d, sort: sortUpdates.get(d._id) } : d), ...parts.map(p => p.data)];
		if (after.length > 10000 || new Set(after.map(d => d._id)).size !== after.length) fail('Drawing limit or identity collision.');
		const route = routeEntry(scene, id, original.name, recipe, target, parts, original.revision + 1);
		const next = validatePathRegistry({ ...registry, revision: registry.revision + 1,
			routes: registry.routes.map(r => r.id === id ? route : r) });
		await commit(scene, registry, next, before, after, tree, isCurrent);
		return route;
	});
}

export function deleteRetainedPath(scene, id, { expectedRevision, isCurrent } = {}) {
	return runLayerOperation(scene, async () => {
		const integrity = inspectPathIntegrity(scene, id), route = integrity.route;
		const tree = destination(scene, route.layerId, route.levelId, route.elevation);
		if (!integrity.intact || route.revision !== expectedRevision) fail('Path changed; review it again before deleting.');
		const registry = readPathRegistry(scene), before = snapshots(scene), members = new Set(route.components.map(c => c.drawingId));
		if (before.some(d => members.has(d._id) && d.locked)) fail('Unlock the component Drawings before deleting.');
		const next = validatePathRegistry({ ...registry, revision: registry.revision + 1, routes: registry.routes.filter(r => r.id !== id) });
		await commit(scene, registry, next, before, before.filter(d => !members.has(d._id)), tree, isCurrent, 'DeleteWhole');
	});
}

export function detachRetainedPath(scene, id, { expectedRevision, isCurrent } = {}) {
	return runLayerOperation(scene, async () => {
		const integrity = inspectPathIntegrity(scene, id), route = integrity.route;
		const tree = destination(scene, route.layerId, route.levelId, route.elevation);
		if (!integrity.intact || route.revision !== expectedRevision) fail('Path changed; review it again before detaching.');
		const registry = readPathRegistry(scene), before = snapshots(scene), members = new Set(route.components.map(c => c.drawingId));
		if (before.some(d => members.has(d._id) && d.locked)) fail('Unlock the component Drawings before detaching.');
		const after = before.map(source => {
			if (!members.has(source._id)) return source;
			const detached = structuredClone(source);
			delete detached.flags[MODULE].path;
			return detached;
		});
		const next = validatePathRegistry({ ...registry, revision: registry.revision + 1, routes: registry.routes.filter(r => r.id !== id) });
		await commit(scene, registry, next, before, after, tree, isCurrent, 'Detach');
	});
}

export function detachConflictingPath(scene, id, { expectedSnapshot, isCurrent } = {}) {
	return runLayerOperation(scene, async () => {
		requireGM(scene);
		if (otherRecovery(scene) || scene.getFlag(MODULE, PATH_JOURNAL_FLAG)) fail('Resolve Scene recovery first.');
		const snapshot = pathConflictSnapshot(scene, id);
		if (snapshot.intact || !expectedSnapshot || !same(snapshot, expectedSnapshot)) fail('Path conflict changed after review.');
		const tree = structuredClone(readLayerTree(scene)), workspace = readLayerWorkspace(scene);
		const before = snapshots(scene), affected = before.filter(d => d.flags?.[MODULE]?.path?.id === id);
		if (affected.some(d => d.locked || lockedLayerIds(tree).has(d.flags[MODULE].layerId)
			|| tree.nodes.some(n => n.id === d.flags[MODULE].layerId)
				&& !effectiveLayerGate(tree, d.flags[MODULE].layerId, n => !workspace.hiddenIds.includes(n.id)))) {
			fail('Unlock and show the remaining path artwork before detaching.');
		}
		const after = before.map(d => {
			if (d.flags?.[MODULE]?.path?.id !== id) return d;
			const ordinary = structuredClone(d); delete ordinary.flags[MODULE].path; return ordinary;
		});
		const registry = readPathRegistry(scene), next = validatePathRegistry({ ...registry, revision: registry.revision + 1,
			routes: registry.routes.filter(r => r.id !== id) });
		await commit(scene, registry, next, before, after, tree, isCurrent, 'Detach', true, id);
		clearPathHistory(scene);
	});
}

export function recoverRetainedPathOperation(scene, { expectedJournal } = {}) {
	return runLayerOperation(scene, async () => {
		requireGM(scene);
		if (otherRecovery(scene)) fail('Resolve other Scene recovery first.');
		const journal = scene.getFlag(MODULE, PATH_JOURNAL_FLAG);
		if (!journal) fail('There is no retained path recovery operation.');
		if (expectedJournal !== undefined && !same(journal, expectedJournal)) fail('Path recovery changed after review.');
		await restoreJournal(scene, journal);
		clearPathHistory(scene);
		Hooks.callAll('foundryshopPathsChanged', scene);
	});
}

export async function promptRetainedPathRecovery(scene) {
	requireGM(scene);
	const journal = structuredClone(scene.getFlag(MODULE, PATH_JOURNAL_FLAG));
	validateJournal(scene, journal);
	const { FoundryshopDialog } = await import('./dialogs.js');
	const content = document.createElement('div');
	content.textContent = game.i18n.localize('FOUNDRYSHOP.Paths.RecoveryHint');
	const confirmed = await FoundryshopDialog.confirm({
		window: { title: game.i18n.localize('FOUNDRYSHOP.Paths.Recover') }, content, modal: true, rejectClose: false,
	});
	if (!confirmed) return;
	if (!canvas.ready || canvas.scene !== scene) fail('The recovery Scene changed.');
	await recoverRetainedPathOperation(scene, { expectedJournal: journal });
	ui.notifications.info(game.i18n.localize('FOUNDRYSHOP.Paths.RecoverySuccess'));
}

export function duplicateRetainedPath(scene, id, { expectedRevision, dx = 0, dy = 0, isCurrent } = {}) {
	requireGM(scene);
	const source = inspectPathIntegrity(scene, id);
	if (!source.intact || source.route.revision !== expectedRevision) fail('Path changed; review it again before duplicating.');
	if (!Number.isFinite(dx) || !Number.isFinite(dy)) fail('Duplicate offsets must be finite scene coordinates.');
	const original = source.route, recipe = translatePathRecipe(original.recipe, dx, dy);

	return createRetainedPath(scene, validatePathRecipe(recipe), {
		layerId: original.layerId, levelId: original.levelId, elevation: original.elevation,
		name: original.name,
		isCurrent: () => {
			const current = inspectPathIntegrity(scene, id);
			return current.intact && same(current.route, original) && (!isCurrent || isCurrent());
		},
	});
}

export function undoRetainedPath(scene, { isCurrent } = {}) { return replayRetainedPath(scene, 'undo', isCurrent); }
export function redoRetainedPath(scene, { isCurrent } = {}) { return replayRetainedPath(scene, 'redo', isCurrent); }

function replayRetainedPath(scene, direction, isCurrent) {
	return runLayerOperation(scene, () => replayPathHistory(scene, direction, async (entry, undo) => {
		requireGM(scene);
		if (scene.getFlag(MODULE, PATH_JOURNAL_FLAG) || otherRecovery(scene)) fail('Resolve Scene recovery before path history.');
		const registry = readPathRegistry(scene), before = snapshots(scene);
		const plan = planPathHistoryReplay(entry, undo, registry, before);
		let tree;
		for (const route of plan.destinations) tree = destination(scene, route.layerId, route.levelId, route.elevation);
		if (!tree) fail('Path history has no available destination.');
		if ([...before, ...plan.after].some(d => entry.drawingIds.includes(d._id) && d.locked)) fail('Unlock path history components first.');
		const drawingIds = new Set(entry.drawingIds);
		const restored = plan.after.filter(d => drawingIds.has(d._id));
		const peers = plan.after.filter(d => !drawingIds.has(d._id));
		if (restored.some(d => peers.some(peer => peer.sort === d.sort && peer.elevation === d.elevation && peer.interface === d.interface))
			|| planDrawingOrder(tree, plan.after.map(d => new (getDocumentClass('Drawing'))(d, { parent: scene }))).length) {
			fail('Native drawing order changed; path history cannot restore its original stack position.');
		}
		const next = validatePathRegistry(plan.registry);
		await commit(scene, registry, next, before, plan.after, tree, isCurrent, entry.label, true);
	}));
}
