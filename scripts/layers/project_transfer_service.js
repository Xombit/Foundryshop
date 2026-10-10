import { MODULE } from '../constants.js';
import { validateLayerTree, layerSubtreeIds, lockedLayerIds } from './layer_tree_store.js';
import {
	readLayerTree, runLayerOperation, scheduleLayerRefresh, PROJECT_IMPORT, LAYER_OPERATION,
} from './layer_manager.js';
import { planDrawingOrder, layerDrawingStack } from './drawing_order_service.js';
import {
	PROJECT_FORMAT, PROJECT_VERSION, DRAWING_PROJECT_FIELDS, validateProjectPackage, canonicalJson,
} from './project_package.js';
import { validateResourceMappings, inspectProjectResources, assertProjectResources } from './project_resources.js';
import { assertNoPendingPathOperation } from '../path_operation_guard.js';
import { withPathWrite } from '../path_operation_guard.js';
import { exportPortablePaths, filterPortablePaths, remapPortablePaths } from '../path_portability.js';
import { readPathRegistry } from '../path_store.js';
import { validatePathRegistry } from '../path_schema.js';
import { clearPathHistory } from '../path_history.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const journalPath = `flags.${MODULE}.projectImportJournal`;

function requireGM(scene) {
	if (!game.user.isGM || !scene) throw new Error('JSON project exchange requires a GM and a Scene.');
	assertNoPendingPathOperation(scene);
}

function assertPortableRecovery(scene) {
	if (scene.getFlag(MODULE, 'optimizationJournal') !== undefined) {
		throw new Error('Optimization recovery exists; Drawing-only JSON export is refused until portable baked-output recovery is supported.');
	}
}

export function exportDrawingProject(scene, { levelId = null } = {}) {
	requireGM(scene);
	assertPortableRecovery(scene);
	if (scene.getFlag(MODULE, 'projectImportJournal')) throw new Error('Resolve the unfinished project import before exporting.');
	const Document = getDocumentClass('Drawing');
	const drawings = exportLevelDrawings(scene, [...scene.drawings.values()], levelId).map(exportProjectDrawing);
	const sceneFlags = scene.getFlag(MODULE, 'recovery');
	if (sceneFlags !== undefined) throw new Error('Recovery data exists but is not supported by this build; export refused to avoid losing it.');
	return validateProjectPackage({
		format: PROJECT_FORMAT, version: PROJECT_VERSION, scope: 'full', coordinateSpace: 'scene-pixels',
		name: scene.name.slice(0, 80), source: { foundry: game.version, drawingSchema: Document.metadata.schemaVersion },
		tree: readLayerTree(scene), drawings, ...exportPortablePaths(scene, drawings), recovery: [], bounds: null, dependencies: {},
	});
}

export function exportDrawingSubtree(scene, nodeId, { levelId = null } = {}) {
	requireGM(scene);
	assertPortableRecovery(scene);
	if (scene.getFlag(MODULE, 'projectImportJournal')) throw new Error('Resolve the unfinished project import before exporting.');
	if (scene.getFlag(MODULE, 'recovery') !== undefined) throw new Error('Recovery data is not supported by this build; subtree export refused.');
	const tree = readLayerTree(scene), members = layerSubtreeIds(tree, nodeId);
	const selected = tree.nodes.find(node => node.id === nodeId), included = new Set(members);
	let parentId = selected.parentId;
	while (parentId !== null) {
		included.add(parentId);
		parentId = tree.nodes.find(node => node.id === parentId).parentId;
	}
	const scoped = { ...tree, nodes: tree.nodes.filter(node => included.has(node.id)),
		presets: tree.presets.map(preset => ({ ...preset, entries: preset.entries.filter(entry => included.has(entry.nodeId)) })) };
	const drawings = exportLevelDrawings(scene, [...scene.drawings.values()], levelId)
		.filter(drawing => members.has(drawing.getFlag(MODULE, 'layerId')))
		.map(exportProjectDrawing);
	return validateProjectPackage({
		format: PROJECT_FORMAT, version: PROJECT_VERSION, scope: 'subtree', coordinateSpace: 'scene-pixels',
		name: selected.name, source: { foundry: game.version, drawingSchema: getDocumentClass('Drawing').metadata.schemaVersion },
		tree: scoped, drawings, ...exportPortablePaths(scene, drawings), recovery: [], bounds: null, dependencies: {},
	});
}

export function exportDrawingSelection(scene, ids, { levelId = null } = {}) {
	requireGM(scene);
	assertPortableRecovery(scene);
	if (!Array.isArray(ids) || !ids.length || ids.length > 10000
		|| ids.some(id => typeof id !== 'string' || !scene.drawings.has(id)) || new Set(ids).size !== ids.length) {
		throw new Error('Select existing Scene Drawings with unique IDs before exporting.');
	}
	if (scene.getFlag(MODULE, 'projectImportJournal')) throw new Error('Resolve the unfinished project import before exporting.');
	if (scene.getFlag(MODULE, 'recovery') !== undefined) throw new Error('Recovery data is not supported by this build; selection export refused.');
	const tree = readLayerTree(scene), selected = new Set(ids);
	const drawings = exportLevelDrawings(scene, [...scene.drawings.values()], levelId)
		.filter(drawing => selected.has(drawing.id)).map(exportProjectDrawing);
	const byId = new Map(tree.nodes.map(node => [node.id, node])), included = new Set();
	for (const drawing of drawings) {
		let id = drawing.layerId;
		if (id !== null && byId.get(id)?.kind !== 'layer') throw new Error('Repair selected Drawing layer membership before exporting.');
		while (id !== null && !included.has(id)) {
			included.add(id);
			id = byId.get(id).parentId;
		}
	}
	const scoped = { ...tree, nodes: tree.nodes.filter(node => included.has(node.id)),
		presets: tree.presets.map(preset => ({ ...preset, entries: preset.entries.filter(entry => included.has(entry.nodeId)) }))
			.filter(preset => preset.entries.length) };
	return validateProjectPackage({
		format: PROJECT_FORMAT, version: PROJECT_VERSION, scope: 'subtree', coordinateSpace: 'scene-pixels',
		name: `${scene.name.slice(0, 69)} selection`, source: {
			foundry: game.version, drawingSchema: getDocumentClass('Drawing').metadata.schemaVersion,
		},
		tree: scoped, drawings, ...exportPortablePaths(scene, drawings), recovery: [], bounds: null, dependencies: {},
	});
}

function exportLevelDrawings(scene, drawings, levelId) {
	if (levelId === null) return drawings;
	if (typeof levelId !== 'string' || !scene.levels?.has(levelId)) throw new Error('Choose an existing export Level.');
	return drawings.filter(drawing => drawing.toObject().levels?.includes(levelId));
}

export function projectSourceLevels(project) {
	return [...new Set(project.drawings.flatMap(entry => entry.data.levels))];
}

function importLevelProject(input, levelMode, sourceLevelId) {
	const project = validateProjectPackage(input), levels = projectSourceLevels(project);
	if (!['single', 'combine'].includes(levelMode)) throw new Error('Choose one source Level or explicitly combine all source Levels.');
	if (levelMode === 'combine') {
		if (sourceLevelId !== null) throw new Error('Combined import cannot also select a source Level.');
		return project;
	}
	const selected = sourceLevelId ?? (levels.length === 1 ? levels[0] : null);
	if (levels.length > 1 && selected === null) throw new Error('Choose one source Level; multiple Levels are never silently combined.');
	if (selected !== null && !levels.includes(selected)) throw new Error('Choose an existing package source Level.');
	return validateProjectPackage(filterPortablePaths(project, project.drawings.filter(entry =>
		selected === null || entry.data.levels.includes(selected))));
}

export function exportProjectDrawing(drawing, { prepared = false } = {}) {
	const source = drawing.toObject(!prepared);
	if (prepared) {
		for (const field of ['fillColor', 'strokeColor', 'textColor']) {
			if (source[field] != null) source[field] = String(source[field]);
		}
	}
	const unsupported = Object.keys(source).filter(key => !['_id', 'author', ...DRAWING_PROJECT_FIELDS].includes(key));
	if (unsupported.length) throw new Error(`Drawing ${drawing.id} has unsupported fields: ${unsupported.join(', ')}.`);
	const data = structuredClone(source);
	delete data._id;
	delete data.author;
	// Native optional strings can be undefined; explicit empty strings round-trip in v14.
	for (const field of ['name', 'text']) {
		if (data[field] === undefined) data[field] = '';
	}
	const layerId = data.flags?.[MODULE]?.layerId ?? null;
	if (data.flags?.[MODULE]) {
		delete data.flags[MODULE].layerId;
		if (!Object.keys(data.flags[MODULE]).length) delete data.flags[MODULE];
	}
	return { id: drawing.id, layerId, data };
}

function assertDestination(scene, expectedRevision, mode, replaceEmptyMetadata = false) {
	const before = readLayerTree(scene);
	if (!['empty', 'additive'].includes(mode)) throw new Error('Choose empty-project or additive import.');
	if (before.revision !== expectedRevision || scene.getFlag(MODULE, 'projectImportJournal')) {
		throw new Error('Destination changed or has an unfinished import. Existing content is never replaced.');
	}
	if (mode === 'empty' && scene.drawings.size) {
		throw new Error('Import requires an empty Drawing project unless additive mode is explicitly selected.');
	}
	if (mode === 'empty' && (before.nodes.length || before.presets.length) && replaceEmptyMetadata !== true) {
		throw new Error('The Scene has no Drawings but retains layers or presets. Confirm replacement of this metadata or choose additive import.');
	}
	const layers = new Set(before.nodes.filter(node => node.kind === 'layer').map(node => node.id));
	if ([...scene.drawings.values()].some(drawing => drawing.getFlag(MODULE, 'layerId') != null
		&& !layers.has(drawing.getFlag(MODULE, 'layerId')))) throw new Error('Repair unresolved destination membership before importing.');
	return before;
}

function uniqueIds(count, forbidden) {
	const ids = new Set();
	while (ids.size < count) {
		const id = foundry.utils.randomID();
		if (ids.has(id) || forbidden.has(id)) throw new Error('ID generation collision; please retry.');
		ids.add(id);
	}
	return [...ids];
}

export function prepareProjectImport(scene, input, { levelId, levelMode = 'single', sourceLevelId = null,
	mode = 'empty', targetGroupId = null, replaceEmptyMetadata = false, dx = 0, dy = 0, assets = {}, fonts = {}, acknowledgeExternal = false } = {}) {
	requireGM(scene);
	const before = assertDestination(scene, readLayerTree(scene).revision, mode, replaceEmptyMetadata);
	const retained = mode === 'additive' ? before : { ...before, nodes: [], presets: [] };
	const existing = [...scene.drawings.values()].map(drawing => drawing.toObject());
	const project = importLevelProject(input, levelMode, sourceLevelId);
	const beforePaths = structuredClone(scene.getFlag(MODULE, 'paths')) ?? null;
	const registry = readPathRegistry(scene);
	if (targetGroupId !== null && (mode !== 'additive' || typeof targetGroupId !== 'string'
		|| before.nodes.find(node => node.id === targetGroupId)?.kind !== 'group'
		|| lockedLayerIds(before).has(targetGroupId))) {
		throw new Error('Choose an unlocked existing group with unlocked ancestors for additive targeted import.');
	}
	if (typeof levelId !== 'string' || !scene.levels?.has(levelId)) throw new Error('Choose an existing destination Level.');
	const ground = scene.levels.get(levelId).elevation?.bottom;
	if (levelMode === 'combine' && !Number.isFinite(ground)) throw new Error('Combined import requires a finite destination Level ground elevation.');
	if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 10000000 || Math.abs(dy) > 10000000) {
		throw new Error('Translation must be finite and within 10,000,000 pixels.');
	}
	validateResourceMappings(project, { assets, fonts, acknowledgeExternal });
	const missingModules = project.dependencies.modules.filter(id => !game.modules.get(id)?.active);
	if (missingModules.length) throw new Error(`Enable required Drawing metadata modules first: ${missingModules.join(', ')}.`);
	const forbidden = new Set([
		...before.nodes.map(node => node.id), ...before.presets.map(preset => preset.id), ...scene.drawings.keys(),
		...project.tree.nodes.map(node => node.id), ...project.tree.presets.map(preset => preset.id),
		...project.drawings.map(drawing => drawing.id),
		...registry.routes.map(r => r.id), ...(project.paths?.routes ?? []).map(r => r.id),
	]);
	const ids = uniqueIds(project.tree.nodes.length + project.tree.presets.length + project.drawings.length + (project.paths?.routes.length ?? 0) + 4, forbidden);
	const token = ids.shift(), rootId = ids.shift(), unassignedId = ids.shift(), presentationId = ids.shift();
	const nodeIds = new Map(project.tree.nodes.map(node => [node.id, ids.shift()]));
	const presetIds = new Map(project.tree.presets.map(preset => [preset.id, ids.shift()]));
	const routeIds = new Map((project.paths?.routes ?? []).map(route => [route.id, ids.shift()]));
	const drawingIds = new Map();
	const node = (id, name, kind, parentId) => ({ id, name, kind, parentId, locked: false, defaults: {}, playerAllowed: false });
	const nodes = [node(rootId, project.name, 'group', targetGroupId), ...project.tree.nodes.map(source => ({
		...source, id: nodeIds.get(source.id), parentId: source.parentId === null ? rootId : nodeIds.get(source.parentId),
		defaults: { ...source.defaults, ...(source.defaults.texture && Object.hasOwn(assets, source.defaults.texture)
			? { texture: assets[source.defaults.texture] } : {}) },
		playerAllowed: false,
	}))];
	const hasUnassigned = project.drawings.some(entry => entry.layerId === null);
	if (retained.nodes.length + nodes.length + (hasUnassigned ? 1 : 0) > 2000
		|| retained.presets.length + project.tree.presets.length >= 200 || existing.length + project.drawings.length > 10000) {
		throw new Error('The import wrapper/presentation would exceed the project layer or preset limits.');
	}
	if (hasUnassigned) nodes.push(node(unassignedId, 'Imported Unassigned', 'layer', rootId));
	const existingGates = retained.nodes.map(node => ({ nodeId: node.id, playerAllowed: node.playerAllowed }));
	const desired = [...existingGates, { nodeId: rootId, playerAllowed: true },
		...project.tree.nodes.map(source => ({ nodeId: nodeIds.get(source.id), playerAllowed: source.playerAllowed })),
		...(hasUnassigned ? [{ nodeId: unassignedId, playerAllowed: true }] : [])];
	const names = new Set(retained.presets.map(preset => preset.name.toLowerCase()));
	const uniqueName = name => {
		let candidate = name;
		for (let suffix = 2; names.has(candidate.toLowerCase()); suffix++) candidate = `${name.slice(0, 70)} (${suffix})`;
		names.add(candidate.toLowerCase());
		return candidate;
	};
	const presets = project.tree.presets.map(source => ({
		...source, name: uniqueName(source.name), id: presetIds.get(source.id), entries: [
			...existingGates,
			{ nodeId: rootId, playerAllowed: true },
			...source.entries.map(entry => ({ ...entry, nodeId: nodeIds.get(entry.nodeId) })),
			...(hasUnassigned ? [{ nodeId: unassignedId, playerAllowed: false }] : []),
		],
	}));
	presets.push({ id: presentationId, name: uniqueName('Imported Presentation'), entries: desired });
	const mergedNodes = [...retained.nodes];
	mergedNodes.splice(targetGroupId === null ? 0 : mergedNodes.findIndex(node => node.id === targetGroupId) + 1, 0, ...nodes);
	const tree = validateLayerTree({
		...before, revision: before.revision + 1, nodes: mergedNodes, presets: [...retained.presets, ...presets],
	});
	const Document = getDocumentClass('Drawing');
	const data = project.drawings.map(entry => {
		const result = structuredClone(entry.data);
		if (result.texture && Object.hasOwn(assets, result.texture)) result.texture = assets[result.texture];
		if (Object.hasOwn(fonts, result.fontFamily)) result.fontFamily = fonts[result.fontFamily];
		result.x += dx; result.y += dy;
		if (Math.abs(result.x) > 10000000 || Math.abs(result.y) > 10000000) throw new Error('Translated Drawing exceeds the coordinate limit.');
		result.levels = [levelId];
		if (levelMode === 'combine') result.elevation = ground;
		result._id = ids.shift();
		drawingIds.set(entry.id, result._id);
		result.author = game.user.id;
		result.flags[MODULE] = {
			...(result.flags[MODULE] ?? {}), layerId: entry.layerId === null ? unassignedId : nodeIds.get(entry.layerId),
			importStaging: token,
			provenance: { sourceFormat: PROJECT_FORMAT, sourceDrawingId: entry.id, importId: token },
		};
		return result;
	});
	const virtual = data.map(drawing => ({ ...drawing, id: drawing._id, getFlag: (namespace, key) => drawing.flags[namespace]?.[key] }));
	const managed = layerDrawingStack(before, [...scene.drawings.values()]);
	const byId = new Map(data.map(drawing => [drawing._id, drawing]));
	const virtualById = new Map(virtual.map(drawing => [drawing.id, drawing]));
	const sourceOrdered = virtual.map((drawing, index) => ({
		...drawing, id: project.drawings[index].id, destinationId: drawing.id,
		...(levelMode === 'combine' ? { sort: index } : {}),
	}));
	if (levelMode === 'combine') {
		const ordered = project.drawings.map((entry, index) => ({ entry, index })).sort((a, b) =>
			a.entry.data.elevation - b.entry.data.elevation || a.entry.data.sort - b.entry.data.sort || a.index - b.index);
		ordered.forEach(({ index }, rank) => { sourceOrdered[index].sort = rank; });
	}
	const importedStack = layerDrawingStack(tree, sourceOrdered);
	const combinedStack = layerDrawingStack(tree, [...scene.drawings.values(), ...virtual]);
	const firstImported = combinedStack.findIndex(drawing => byId.has(drawing.id));
	const lastImported = firstImported + importedStack.length - 1;
	const upper = combinedStack[lastImported + 1]?.sort ?? Infinity;
	const lower = targetGroupId === null ? Math.max(0, ...managed.map(drawing => drawing.sort))
		: firstImported > 0 ? combinedStack[firstImported - 1].sort
			: upper === Infinity ? 0 : upper - (importedStack.length + 1) * 1024;
	const step = upper === Infinity ? 1024 : Math.floor((upper - lower) / (importedStack.length + 1));
	for (const [index, drawing] of importedStack.entries()) {
		const sort = lower + (index + 1) * step;
		if (step < 1 || !Number.isSafeInteger(sort) || sort >= upper) {
			throw new Error('No safe sort space at the destination; import refused without reordering existing artwork.');
		}
		virtualById.get(drawing.destinationId).sort = sort;
		byId.get(drawing.destinationId).sort = sort;
	}
	if (planDrawingOrder(tree, [...scene.drawings.values(), ...virtual]).length) {
		throw new Error('Existing Drawing order needs repair; import will not change existing sorts.');
	}
	const importedRoutes = remapPortablePaths(project.paths, data, drawingIds, routeIds, { dx, dy });
	const paths = importedRoutes.length ? validatePathRegistry({ ...registry, revision: registry.revision + 1,
		routes: [...registry.routes, ...importedRoutes] }) : beforePaths;
	for (const drawing of data) {
		const checked = new Document(drawing, { parent: scene, strict: true }).toObject();
		if (!same(checked, drawing)) throw new Error(`Native validation would alter Drawing ${drawing._id}; import refused.`);
	}
	return { token, sceneId: scene.id, before, tree, data, existing, beforePaths, paths, presentationId, project, levelId,
		levelMode, sourceLevelId, ground, mode, targetGroupId, dx, dy };
}

function verifyTree(scene, expected) {
	if (!same(readLayerTree(scene), expected)) throw new Error('Scene project changed during import.');
}

async function drawingDigest(data) {
	if (!globalThis.crypto?.subtle) throw new Error(game.i18n.localize('FOUNDRYSHOP.Project.DigestUnavailable'));
	const bytes = new TextEncoder().encode(canonicalJson(data));
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyExistingDrawings(scene, baseline, allowedIds = [], allowReordered = false) {
	const ids = new Set([...baseline.map(entry => entry.id), ...allowedIds]);
	if ([...scene.drawings.keys()].some(id => !ids.has(id))) throw new Error('Other artwork appeared during import; automatic cleanup refused.');
	for (const entry of baseline) {
		const drawing = scene.drawings.get(entry.id);
		const digest = drawing && await drawingDigest(drawing.toObject());
		if (!drawing || (digest !== entry.digest && (!allowReordered || digest !== entry.reorderedDigest))) {
			throw new Error('Existing artwork changed during import; automatic cleanup refused.');
		}
	}
}

export function importDrawingProject(scene, input, options = {}) {
	requireGM(scene);
	return runLayerOperation(scene, async () => {
		const plan = prepareProjectImport(scene, input, options);
		return commitImportPlan(scene, plan, options);
	});
}

/** Stamp preparation runs inside the same Scene queue and keeps the layer tree intact. */
export function commitDrawingStamp(scene, prepare, options = {}) {
	requireGM(scene);
	return runLayerOperation(scene, async () => {
		if (scene.getFlag(MODULE, 'projectImportJournal')) throw new Error('Resolve the unfinished import before placing artwork.');
		const before = structuredClone(readLayerTree(scene));
		const token = foundry.utils.randomID();
		const prepared = await prepare(token);
		const data = Array.isArray(prepared) ? prepared : prepared.data;
		const sortUpdates = Array.isArray(prepared) ? [] : prepared.sortUpdates ?? [];
		if (!Array.isArray(sortUpdates) || new Set(sortUpdates.map(entry => entry._id)).size !== sortUpdates.length
			|| sortUpdates.some(entry => !scene.drawings.has(entry._id) || !Number.isSafeInteger(entry.sort)
				|| Object.keys(entry).some(key => !['_id', 'sort'].includes(key)))) {
			throw new Error('Invalid stamp sort allocation.');
		}
		if (!Array.isArray(data) || !data.length || data.length > 100) throw new Error('Stamp must contain 1 to 100 Drawings.');
		if (new Set(data.map(drawing => drawing._id)).size !== data.length
			|| data.some(drawing => typeof drawing._id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(drawing._id)
				|| scene.drawings.has(drawing._id) || drawing.flags?.[MODULE]?.importStaging !== token
				|| drawing.flags?.[MODULE]?.provenance?.importId !== token)) {
			throw new Error('Stamp IDs or staging provenance are invalid; no artwork was created.');
		}
		verifyTree(scene, before);
		const plan = { token, sceneId: scene.id, before, tree: before, data,
			existing: [...scene.drawings.values()].map(drawing => drawing.toObject()), stamp: true, sortUpdates,
			beforePaths: structuredClone(scene.getFlag(MODULE, 'paths')) ?? null,
			paths: Array.isArray(prepared) ? structuredClone(scene.getFlag(MODULE, 'paths')) ?? null : prepared.paths
				?? structuredClone(scene.getFlag(MODULE, 'paths')) ?? null };
		return commitImportPlan(scene, plan, options);
	});
}

async function commitImportPlan(scene, plan, options) {
		const retained = plan.beforePaths !== null || plan.paths !== null;
		const verifyPaths = expected => {
			if (!same(scene.getFlag(MODULE, 'paths') ?? null, expected)) throw new Error('Retained paths changed during import.');
		};
		if (plan.beforePaths !== null) validatePathRegistry(plan.beforePaths);
		if (plan.paths !== null) validatePathRegistry(plan.paths);
		const verifyLevel = () => {
			if (plan.stamp) return;
			if (!scene.levels?.has(plan.levelId)
				|| plan.levelMode === 'combine' && scene.levels.get(plan.levelId).elevation?.bottom !== plan.ground) {
				throw new Error('Destination Level or ground changed during import; review again.');
			}
		};
		const baseline = await Promise.all(plan.existing.map(async drawing => ({ id: drawing._id, digest: await drawingDigest(drawing) })));
		for (const update of plan.sortUpdates ?? []) {
			const original = plan.existing.find(drawing => drawing._id === update._id);
			Object.assign(baseline.find(entry => entry.id === update._id), {
				beforeSort: original.sort, afterSort: update.sort,
				reorderedDigest: await drawingDigest({ ...original, sort: update.sort }),
			});
		}
		const stagedBaseline = baseline.map(entry => ({ ...entry, digest: entry.reorderedDigest ?? entry.digest }));
		if (options.expectedRevision !== undefined && plan.before.revision !== options.expectedRevision) {
			throw new Error('Scene project changed while the import dialog was open.');
		}
		if (options.isCurrent && !options.isCurrent()) throw new Error('Scene or displayed Level changed before import.');
		if (plan.project) assertProjectResources(await inspectProjectResources(plan.project, options));
		requireGM(scene);
		if (plan.stamp) {
			if (scene.getFlag(MODULE, 'projectImportJournal')) throw new Error('An import began during stamp preparation.');
		} else assertDestination(scene, plan.before.revision, plan.mode, options.replaceEmptyMetadata);
		verifyTree(scene, plan.before);
		verifyPaths(plan.beforePaths);
		await verifyExistingDrawings(scene, baseline);
		verifyTree(scene, plan.before);
		if (options.isCurrent && !options.isCurrent()) throw new Error('Scene or displayed Level changed during resource checks.');
		verifyLevel();
		const disabledModules = (plan.project?.dependencies.modules ?? []).filter(id => !game.modules.get(id)?.active);
		if (disabledModules.length) throw new Error(`Required modules changed during resource checks: ${disabledModules.join(', ')}.`);
		const journal = {
			version: retained ? 5 : plan.sortUpdates?.length ? 3 : 2, token: plan.token, ids: plan.data.map(drawing => drawing._id),
			before: plan.before, staged: plan.tree, baseline,
			...(retained ? { beforePaths: plan.beforePaths, paths: plan.paths } : {}),
		};
		await scene.update({ [journalPath]: journal }, { diff: false, [LAYER_OPERATION]: true });
		if (!same(scene.getFlag(MODULE, 'projectImportJournal'), journal)) throw new Error('Import journal write was not verified; no artwork was created.');
		try {
			verifyLevel();
			verifyTree(scene, plan.before);
			verifyPaths(plan.beforePaths);
			await verifyExistingDrawings(scene, baseline);
			if (scene.getFlag(MODULE, 'projectImportJournal')?.token !== plan.token) throw new Error('Import journal changed before staging.');
			if (plan.sortUpdates?.length) {
				await importDrawingWrite(scene, journal, 'update', plan.sortUpdates, { [LAYER_OPERATION]: true });
				await verifyExistingDrawings(scene, stagedBaseline);
			}
			if (!same(plan.before, plan.tree)) {
				await scene.update({ [`flags.${MODULE}.layers`]: plan.tree }, { diff: false, [LAYER_OPERATION]: true });
			}
			verifyTree(scene, plan.tree);
			await verifyExistingDrawings(scene, stagedBaseline, journal.ids);
			if (plan.stamp && options.isCurrent && !options.isCurrent()) throw new Error('Destination changed before creating artwork.');
			verifyLevel();
			await importDrawingWrite(scene, journal, 'create', plan.data, {
				keepId: true, [LAYER_OPERATION]: true, [PROJECT_IMPORT]: plan.token,
			});
			for (const expected of plan.data) {
				if (!same(scene.drawings.get(expected._id)?.toObject(), expected)) throw new Error(`Imported Drawing ${expected._id} was not fully verified.`);
			}
			verifyTree(scene, plan.tree);
			verifyPaths(plan.beforePaths);
			await verifyExistingDrawings(scene, stagedBaseline, journal.ids);
			if (plan.stamp && options.isCurrent && !options.isCurrent()) throw new Error('Destination changed before staging release.');
			verifyLevel();
			if (retained && !same(plan.beforePaths, plan.paths)) await writeImportedPaths(scene, plan.paths);
			verifyPaths(plan.paths);
			const updates = plan.data.map(drawing => ({
				_id: drawing._id, [`flags.${MODULE}.-=importStaging`]: null,
			}));
			if (updates.length) await importDrawingWrite(scene, journal, 'update', updates, { [PROJECT_IMPORT]: plan.token });
			for (const expected of plan.data) {
				const final = structuredClone(expected);
				delete final.flags[MODULE].importStaging;
				if (!same(scene.drawings.get(expected._id)?.toObject(), final)) throw new Error(`Staging release failed for Drawing ${expected._id}.`);
			}
			verifyTree(scene, plan.tree);
			await verifyExistingDrawings(scene, stagedBaseline, journal.ids);
			verifyLevel();
			verifyTree(scene, plan.tree);
			verifyPaths(plan.paths);
			await scene.unsetFlag(MODULE, 'projectImportJournal');
			if (scene.getFlag(MODULE, 'projectImportJournal') !== undefined) throw new Error('Import journal removal was not verified.');
			if (retained) clearPathHistory(scene);
			Hooks.callAll('foundryshopPathsChanged', scene);
			scheduleLayerRefresh();
			return plan;
		} catch (error) {
			try {
				await compensateProjectImport(scene, journal);
			} catch (cleanupError) {
				throw new Error(`Import failed: ${error.message} Cleanup incomplete: ${cleanupError.message} The Scene import journal is retained; do not retry until resolved.`, { cause: error });
			}
			throw new Error(`Import failed and its own changes were removed: ${error.message}`, { cause: error });
		}
}

async function importDrawingWrite(scene, journal, operation, data, options = {}) {
	const method = { create: 'createEmbeddedDocuments', update: 'updateEmbeddedDocuments', delete: 'deleteEmbeddedDocuments' }[operation];
	if (journal.version !== 5) return scene[method]('Drawing', data, options);
	return withPathWrite(scene, operation, data, { ...options, isUndo: true },
		scoped => scene[method]('Drawing', data, scoped));
}

async function writeImportedPaths(scene, registry) {
	const patch = { [`flags.${MODULE}.paths`]: registry === null ? new foundry.data.operators.ForcedDeletion() : registry };
	await withPathWrite(scene, 'scene', patch, { diff: false, [LAYER_OPERATION]: true }, options => scene.update(patch, options));
	if (!same(scene.getFlag(MODULE, 'paths') ?? null, registry)) throw new Error('Imported path registry write was not verified.');
}

export function discardInterruptedProjectImport(scene) {
	requireGM(scene);
	return runLayerOperation(scene, async () => {
		const journal = scene.getFlag(MODULE, 'projectImportJournal');
		if (!journal || ![1, 2, 3, 5].includes(journal.version) || typeof journal.token !== 'string'
			|| !Array.isArray(journal.ids) || journal.ids.some(id => typeof id !== 'string')
			|| new Set(journal.ids).size !== journal.ids.length
			|| !journal.before || !Array.isArray(journal.before.nodes) || !Array.isArray(journal.before.presets)
			|| (journal.version === 1 && (journal.before.nodes.length || journal.before.presets.length))
			|| ([2, 3, 5].includes(journal.version) && (!Array.isArray(journal.baseline)
				|| journal.baseline.some(entry => !entry || typeof entry.id !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest))
				|| new Set(journal.baseline.map(entry => entry.id)).size !== journal.baseline.length
				|| journal.baseline.some(entry => journal.ids.includes(entry.id))))
			|| ([3, 5].includes(journal.version) && journal.baseline.some(entry => entry.reorderedDigest !== undefined
				&& (!/^[a-f0-9]{64}$/.test(entry.reorderedDigest)
					|| !Number.isSafeInteger(entry.beforeSort) || !Number.isSafeInteger(entry.afterSort))))) {
			throw new Error('Invalid import journal; automatic cleanup refused.');
		}
		validateLayerTree(journal.before);
		validateLayerTree(journal.staged);
		if (journal.version === 5) {
			if (!Object.hasOwn(journal, 'beforePaths') || !Object.hasOwn(journal, 'paths')) throw new Error('Missing path recovery state.');
			if (journal.beforePaths !== null) validatePathRegistry(journal.beforePaths);
			if (journal.paths !== null) validatePathRegistry(journal.paths);
		}
		await compensateProjectImport(scene, structuredClone(journal));
	});
}

async function compensateProjectImport(scene, journal) {
	if (scene.getFlag(MODULE, 'projectImportJournal')?.token !== journal.token) throw new Error('Import journal changed; cleanup refused.');
	if (![journal.before, journal.staged].some(tree => same(readLayerTree(scene), tree))) throw new Error('Layer state changed; cleanup refused.');
	const verifyPaths = () => {
		if (journal.version === 5 && ![journal.beforePaths, journal.paths].some(paths => same(scene.getFlag(MODULE, 'paths') ?? null, paths))) {
			throw new Error('Retained paths changed; cleanup refused.');
		}
	};
	verifyPaths();
	const owned = journal.ids.filter(id => scene.drawings.get(id)?.getFlag(MODULE, 'provenance')?.importId === journal.token);
	await verifyExistingDrawings(scene, journal.baseline ?? [], owned, [3, 5].includes(journal.version));
	if (owned.length) await importDrawingWrite(scene, journal, 'delete', owned, { [PROJECT_IMPORT]: journal.token });
	if (journal.ids.some(id => scene.drawings.has(id))) throw new Error('Some imported Drawings remain.');
	await verifyExistingDrawings(scene, journal.baseline ?? [], [], [3, 5].includes(journal.version));
	if ([3, 5].includes(journal.version)) {
		for (const entry of journal.baseline.filter(entry => entry.reorderedDigest !== undefined)) {
			const source = scene.drawings.get(entry.id).toObject();
			if (await drawingDigest({ ...source, sort: entry.beforeSort }) !== entry.digest) {
				throw new Error('Invalid original sort baseline; cleanup refused.');
			}
		}
		const restore = (journal.baseline ?? []).filter(entry => entry.reorderedDigest !== undefined
			&& scene.drawings.get(entry.id).sort !== entry.beforeSort)
			.map(entry => ({ _id: entry.id, sort: entry.beforeSort }));
		if (restore.length) await importDrawingWrite(scene, journal, 'update', restore, { [LAYER_OPERATION]: true });
		await verifyExistingDrawings(scene, journal.baseline);
	}
	if (![journal.before, journal.staged].some(tree => same(readLayerTree(scene), tree))) throw new Error('Layer state changed during cleanup.');
	if (!same(readLayerTree(scene), journal.before)) {
		await scene.update({ [`flags.${MODULE}.layers`]: journal.before }, { diff: false, [LAYER_OPERATION]: true });
	}
	verifyTree(scene, journal.before);
	verifyPaths();
	if (journal.version === 5) await writeImportedPaths(scene, journal.beforePaths);
	await verifyExistingDrawings(scene, journal.baseline ?? []);
	verifyTree(scene, journal.before);
	await scene.unsetFlag(MODULE, 'projectImportJournal');
	if (scene.getFlag(MODULE, 'projectImportJournal') !== undefined) throw new Error('Import journal remains.');
	if (journal.version === 5) clearPathHistory(scene);
	scheduleLayerRefresh();
}
