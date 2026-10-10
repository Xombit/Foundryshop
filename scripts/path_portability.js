import { MODULE } from './constants.js';
import { validatePathRegistry, validatePathMembership, validatePathRecipe } from './path_schema.js';
import { readPathRegistry, inspectPathIntegrity, pathComponentBaseline } from './path_store.js';

const fail = message => { throw new Error(`Foundryshop Paths: ${message}`); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

export function validatePortablePaths(value, drawings) {
	if (!plain(value) || value.version !== 1 || Object.keys(value).some(key => !['version', 'routes'].includes(key))
		|| !Array.isArray(value.routes)) fail('Invalid portable path collection.');
	const routes = value.routes.map(route => {
		if (!plain(route) || Object.keys(route).some(key => !['id', 'name', 'recipe', 'components'].includes(key))
			|| !Array.isArray(route.components) || route.components.some(c => !plain(c)
				|| Object.keys(c).some(key => !['drawingId', 'role'].includes(key)))) fail('Invalid portable route.');
		return { ...route, revision: 0, layerId: 'portable', levelId: 'portable', elevation: 0,
			components: route.components.map(c => ({ ...c, baseline: 'portable' })) };
	});
	const registry = validatePathRegistry({ version: 1, revision: 0, routes });
	const entries = new Map(drawings.map(d => [d.id, d])), owned = new Set();
	for (const route of registry.routes) {
		let destination;
		for (const component of route.components) {
			const drawing = entries.get(component.drawingId);
			if (!drawing) fail('Portable path has a missing component.');
			const member = validatePathMembership(drawing.data.flags?.[MODULE]?.path);
			if (member.id !== route.id || member.role !== component.role) fail('Portable path membership does not match its route.');
			const target = JSON.stringify([drawing.layerId, drawing.data.levels, drawing.data.elevation, drawing.data.interface]);
			if (destination !== undefined && destination !== target) fail('Portable path components have different destinations.');
			destination = target; owned.add(component.drawingId);
		}
	}
	if (drawings.some(d => Object.hasOwn(d.data.flags?.[MODULE] ?? {}, 'path') && !owned.has(d.id))) {
		fail('Drawing has a dangling portable path membership.');
	}
	return { version: 1, routes: registry.routes.map(({ id, name, recipe, components }) => ({
		id, name, recipe, components: components.map(({ drawingId, role }) => ({ drawingId, role })),
	})) };
}

export function exportPortablePaths(scene, drawings) {
	const registry = readPathRegistry(scene), included = new Set(drawings.map(d => d.id)), routes = [], warnings = [];
	for (const route of registry.routes) {
		if (!route.components.some(c => included.has(c.drawingId))
			&& !drawings.some(d => d.data.flags?.[MODULE]?.path?.id === route.id)) continue;
		const integrity = inspectPathIntegrity(scene, route.id);
		if (integrity.intact && route.components.every(c => included.has(c.drawingId))) {
			const { id, name, recipe, components } = route;
			routes.push({ id, name, recipe, components: components.map(({ drawingId, role }) => ({ drawingId, role })) });
		} else warnings.push({ name: route.name, reason: integrity.intact ? 'partial' : 'damaged' });
	}
	const retained = new Set(routes.map(r => r.id));
	for (const drawing of drawings) {
		const member = drawing.data.flags?.[MODULE]?.path;
		if (member === undefined) continue;
		validatePathMembership(member);
		if (!registry.routes.some(r => r.id === member.id)) fail('Drawing refers to a missing retained route; repair it before sharing.');
		if (!retained.has(member.id)) delete drawing.data.flags[MODULE].path;
	}
	return { paths: validatePortablePaths({ version: 1, routes }, drawings), pathWarnings: warnings };
}

export function filterPortablePaths(project, drawings) {
	const ids = new Set(drawings.map(d => d.id)), routes = [], warnings = [...(project.pathWarnings ?? [])];
	for (const route of project.paths?.routes ?? []) {
		if (route.components.every(c => ids.has(c.drawingId))) routes.push(route);
		else if (route.components.some(c => ids.has(c.drawingId))) warnings.push({ name: route.name, reason: 'partial' });
	}
	const retained = new Set(routes.map(r => r.id));
	const filtered = structuredClone(drawings);
	for (const drawing of filtered) if (drawing.data.flags?.[MODULE]?.path
		&& !retained.has(drawing.data.flags[MODULE].path.id)) delete drawing.data.flags[MODULE].path;
	return { ...project, drawings: filtered, ...(project.paths ? { paths: { version: 1, routes } } : {}),
		...(warnings.length ? { pathWarnings: warnings } : {}) };
}

export function transformPathRecipe(input, { x = 0, y = 0, scale = 1, rotation = 0 } = {}) {
	if (![x, y, scale, rotation].every(Number.isFinite) || scale <= 0 || Math.abs(rotation) > 360) fail('Invalid portable path transform.');
	const recipe = validatePathRecipe(input), angle = rotation * Math.PI / 180;
	const transform = p => ({ x: x + scale * (p.x * Math.cos(angle) - p.y * Math.sin(angle)),
		y: y + scale * (p.x * Math.sin(angle) + p.y * Math.cos(angle)) });
	return validatePathRecipe({ ...recipe, gridSize: recipe.gridSize * scale,
		waypoints: recipe.waypoints.map(p => ({ ...transform(p), mode: p.mode,
			incoming: p.incoming ? transform(p.incoming) : null, outgoing: p.outgoing ? transform(p.outgoing) : null })) });
}

export function transformPortablePaths(paths, transform) {
	return paths ? { version: 1, routes: paths.routes.map(route => ({
		...route, recipe: transformPathRecipe(route.recipe, transform),
	})) } : undefined;
}

export function remapPortablePaths(paths, data, drawingIds, routeIds, { dx = 0, dy = 0 } = {}) {
	const byId = new Map(data.map(d => [d._id, d]));
	return (paths?.routes ?? []).map(route => {
		const id = routeIds.get(route.id), components = route.components.map(component => {
			const drawing = byId.get(drawingIds.get(component.drawingId));
			if (!drawing || !id) fail('Missing imported path identity.');
			drawing.flags[MODULE].path = { version: 1, id, role: component.role };
			return { drawingId: drawing._id, role: component.role,
				baseline: pathComponentBaseline({ toObject: () => drawing }) };
		});
		const first = byId.get(components[0].drawingId);
		return { id, revision: 0, name: route.name, recipe: transformPathRecipe(route.recipe, { x: dx, y: dy }),
			layerId: first.flags[MODULE].layerId, levelId: first.levels[0], elevation: first.elevation, components };
	});
}
