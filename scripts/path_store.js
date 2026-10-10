import { MODULE } from './constants.js';
import { canonicalJson } from './layers/project_package.js';
import { evaluatePathRoute, buildPathComponents } from './path_geometry.js';
import {
	PATH_SCHEMA_VERSION, PATH_REGISTRY_FLAG, PATH_MEMBER_FLAG, emptyPathRegistry, validatePathRegistry, validatePathRecipe,
} from './path_schema.js';

const BASELINE_FIELDS = [
	'x', 'y', 'shape', 'rotation', 'bezierFactor', 'elevation', 'levels', 'interface',
	'strokeWidth', 'strokeColor', 'strokeAlpha', 'fillType', 'fillColor', 'fillAlpha', 'texture',
	'text', 'fontFamily', 'fontSize', 'textColor', 'textAlpha',
];

export function readPathRegistry(scene) {
	if (!scene?.getFlag) throw new Error('Foundryshop Paths: an existing Scene is required.');
	const value = scene.getFlag(MODULE, PATH_REGISTRY_FLAG);
	return value === undefined ? emptyPathRegistry() : validatePathRegistry(value);
}

export function pathComponentBaseline(drawing) {
	const data = drawing.toObject();
	const source = {};
	for (const field of BASELINE_FIELDS) {
		if (data[field] === undefined) throw new Error(`Foundryshop Paths: missing native Drawing field ${field}.`);
		source[field] = data[field];
	}
	source.materialRepeat = data.flags?.[MODULE]?.materialRepeat ?? null;
	source.imageStamp = data.flags?.[MODULE]?.imageStamp ?? null;
	return canonicalJson(source);
}

export function inspectPathIntegrity(scene, id) {
	const registry = readPathRegistry(scene);
	const route = registry.routes.find(entry => entry.id === id);
	if (!route) throw new Error('Foundryshop Paths: this Scene has no matching retained path.');
	const issues = [], expected = new Set(route.components.map(component => component.drawingId));
	if (!scene.levels?.has(route.levelId)) issues.push({ kind: 'missing-level', id: route.levelId });
	const layer = scene.getFlag(MODULE, 'layers')?.nodes?.find(node => node.id === route.layerId && node.kind === 'layer');
	if (!layer) issues.push({ kind: 'missing-layer', id: route.layerId });
	for (const component of route.components) {
		const drawing = scene.drawings.get(component.drawingId);
		if (!drawing) { issues.push({ kind: 'missing-component', id: component.drawingId }); continue; }
		const member = drawing.getFlag(MODULE, PATH_MEMBER_FLAG);
		if (canonicalJson(member) !== canonicalJson({ version: PATH_SCHEMA_VERSION, id: route.id, role: component.role })) {
			issues.push({ kind: 'changed-membership', id: drawing.id });
		}
		if (drawing.getFlag(MODULE, 'layerId') !== route.layerId) issues.push({ kind: 'changed-layer', id: drawing.id });
		if (pathComponentBaseline(drawing) !== component.baseline) issues.push({ kind: 'changed-artwork', id: drawing.id });
	}
	for (const drawing of scene.drawings.values()) {
		if (drawing.getFlag(MODULE, PATH_MEMBER_FLAG)?.id === id && !expected.has(drawing.id)) {
			issues.push({ kind: 'unexpected-component', id: drawing.id });
		}
	}
	return { intact: !issues.length, route, registryRevision: registry.revision, issues };
}

export function pathConflictSnapshot(scene, id) {
	const integrity = inspectPathIntegrity(scene, id), ids = new Set(integrity.route.components.map(c => c.drawingId));
	for (const drawing of scene.drawings.values()) if (drawing.getFlag(MODULE, PATH_MEMBER_FLAG)?.id === id) ids.add(drawing.id);
	return { ...integrity, sources: [...ids].sort().map(id => ({ id, source: scene.drawings.get(id)?.toObject() ?? null })) };
}

export function evaluatePathRecipe(input) {
	const recipe = validatePathRecipe(input);
	return evaluatePathRoute(recipe.waypoints, recipe.options, recipe.gridSize, recipe.closed);
}

export function buildPathRecipeComponents(input) {
	const recipe = validatePathRecipe(input);
	return buildPathComponents(recipe.waypoints, recipe.options, recipe.gridSize, recipe.closed);
}
