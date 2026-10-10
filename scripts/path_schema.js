import { PATH_LIMITS, pathOptions } from './path_geometry.js';

export const PATH_SCHEMA_VERSION = 1;
export const PATH_REGISTRY_FLAG = 'paths';
export const PATH_MEMBER_FLAG = 'path';
export const PATH_STORAGE_LIMITS = Object.freeze({ routes: 1000, components: 10000, bytes: 4 * 1024 * 1024, baselineBytes: 128 * 1024 });
export const PATH_COMPONENT_ROLES = Object.freeze(['path', 'rail-left', 'rail-right', 'sleeper', 'edge', 'surface', 'current']);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value)
	&& !['__proto__', 'constructor', 'prototype'].includes(value);
const finiteCoordinate = value => Number.isFinite(value) && Math.abs(value) <= 10000000;

function fail(message) { throw new Error(`Foundryshop Paths: ${message}`); }
function fields(value, allowed, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| ![Object.prototype, null].includes(Object.getPrototypeOf(value))
		|| Object.keys(value).some(key => !allowed.includes(key))) fail(`Invalid ${label}.`);
}
function point(value) {
	fields(value, ['x', 'y'], 'point');
	if (!finiteCoordinate(value.x) || !finiteCoordinate(value.y)) fail('Invalid point coordinates.');
	return { x: value.x, y: value.y };
}
function waypoint(value) {
	fields(value, ['x', 'y', 'mode', 'incoming', 'outgoing'], 'waypoint');
	const position = point({ x: value.x, y: value.y });
	if (!['automatic', 'smooth', 'corner'].includes(value.mode)) fail('Invalid waypoint mode.');
	if (value.mode === 'automatic') {
		if (value.incoming !== null || value.outgoing !== null) fail('Automatic points cannot have manual handles.');
		return { ...position, mode: value.mode, incoming: null, outgoing: null };
	}
	const incoming = point(value.incoming), outgoing = point(value.outgoing);
	if (value.mode === 'smooth') {
		const a = { x: incoming.x - position.x, y: incoming.y - position.y };
		const b = { x: outgoing.x - position.x, y: outgoing.y - position.y };
		const product = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
		if (product && (Math.abs(a.x * b.y - a.y * b.x) > product * 1e-8 || a.x * b.x + a.y * b.y > 0)) {
			fail('Smooth handles must have opposite linked directions.');
		}
	}
	return { ...position, mode: value.mode, incoming, outgoing };
}

export function validatePathRecipe(value) {
	fields(value, ['version', 'coordinateSpace', 'gridSize', 'closed', 'waypoints', 'options'], 'recipe');
	if (value.version !== PATH_SCHEMA_VERSION || value.coordinateSpace !== 'scene-pixels'
		|| !Number.isFinite(value.gridSize) || value.gridSize <= 0 || value.gridSize > 100000
		|| typeof value.closed !== 'boolean' || !Array.isArray(value.waypoints)
		|| value.waypoints.length < (value.closed ? 3 : 2) || value.waypoints.length > PATH_LIMITS.waypoints) {
		fail('Invalid recipe version, coordinate space, grid, closure or waypoint count.');
	}
	const waypoints = value.waypoints.map(waypoint);
	for (let index = 1; index < waypoints.length; index++) {
		if (Math.hypot(waypoints[index].x - waypoints[index - 1].x, waypoints[index].y - waypoints[index - 1].y) <= 0.01) {
			fail('Adjacent waypoints must be distinct.');
		}
	}
	if (value.closed && Math.hypot(waypoints[0].x - waypoints.at(-1).x, waypoints[0].y - waypoints.at(-1).y) <= 0.01) {
		fail('Closed recipes must not duplicate the first waypoint.');
	}
	const keys = Object.keys(pathOptions());
	fields(value.options, keys, 'options');
	if (keys.some(key => !Object.hasOwn(value.options, key))) fail('Persisted options must be complete.');
	const options = pathOptions(value.options);
	return { version: PATH_SCHEMA_VERSION, coordinateSpace: 'scene-pixels', gridSize: value.gridSize,
		closed: value.closed, waypoints, options };
}

export function createPathRecipe(points, options = {}, gridSize = 100) {
	if (!Array.isArray(points)) fail('Invalid waypoint array.');
	return validatePathRecipe({
		version: PATH_SCHEMA_VERSION, coordinateSpace: 'scene-pixels', gridSize, closed: false,
		waypoints: points.map(position => ({ ...point(position), mode: 'automatic', incoming: null, outgoing: null })),
		options: pathOptions(options),
	});
}

export function validatePathMembership(value) {
	fields(value, ['version', 'id', 'role'], 'component membership');
	if (value.version !== PATH_SCHEMA_VERSION || !identifier(value.id) || !PATH_COMPONENT_ROLES.includes(value.role)) {
		fail('Invalid component membership.');
	}
	return { version: PATH_SCHEMA_VERSION, id: value.id, role: value.role };
}

export function emptyPathRegistry() { return { version: PATH_SCHEMA_VERSION, revision: 0, routes: [] }; }

export function validatePathRegistry(value) {
	fields(value, ['version', 'revision', 'routes'], 'registry');
	if (value.version !== PATH_SCHEMA_VERSION || !Number.isSafeInteger(value.revision) || value.revision < 0
		|| !Array.isArray(value.routes) || value.routes.length > PATH_STORAGE_LIMITS.routes) fail('Invalid registry version, revision or route count.');
	const routeIds = new Set(), drawingIds = new Set();
	const routes = value.routes.map(route => {
		fields(route, ['id', 'revision', 'name', 'layerId', 'levelId', 'elevation', 'recipe', 'components'], 'route');
		if (!identifier(route.id) || routeIds.has(route.id) || !Number.isSafeInteger(route.revision) || route.revision < 0
			|| typeof route.name !== 'string' || !route.name.trim() || route.name.length > 80
			|| !identifier(route.layerId) || !identifier(route.levelId) || !Number.isFinite(route.elevation)
			|| !Array.isArray(route.components) || !route.components.length || route.components.length > PATH_LIMITS.drawings) {
			fail('Invalid route identity, destination or components.');
		}
		routeIds.add(route.id);
		const recipe = validatePathRecipe(route.recipe);
		const components = route.components.map(component => {
			fields(component, ['drawingId', 'role', 'baseline'], 'component');
			if (!identifier(component.drawingId) || drawingIds.has(component.drawingId)
				|| !PATH_COMPONENT_ROLES.includes(component.role) || typeof component.baseline !== 'string'
				|| !component.baseline.length || new TextEncoder().encode(component.baseline).length > PATH_STORAGE_LIMITS.baselineBytes) {
				fail('Invalid or multiply owned component.');
			}
			drawingIds.add(component.drawingId);
			return { drawingId: component.drawingId, role: component.role, baseline: component.baseline };
		});
		const roles = components.map(component => component.role);
		const expected = recipe.options.style === 'plain' ? ['path'] : recipe.options.style === 'road'
			? ['edge', 'surface'] : recipe.options.style === 'river' ? ['edge', 'surface', 'current'] : null;
		if (expected ? roles.join(',') !== expected.join(',')
			: roles.length < 3 || roles.slice(0, -2).some(role => role !== 'sleeper')
				|| roles.slice(-2).join(',') !== 'rail-left,rail-right') fail('Components do not match the path style.');
		return { id: route.id, revision: route.revision, name: route.name, layerId: route.layerId,
			levelId: route.levelId, elevation: route.elevation, recipe, components };
	});
	if (drawingIds.size > PATH_STORAGE_LIMITS.components) fail('Registry component limit exceeded.');
	const result = { version: PATH_SCHEMA_VERSION, revision: value.revision, routes };
	if (new TextEncoder().encode(JSON.stringify(result)).length > PATH_STORAGE_LIMITS.bytes) fail('Registry storage limit exceeded.');
	return result;
}
