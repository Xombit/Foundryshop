import { validatePathRecipe } from './path_schema.js';
import { evaluatePathRecipe, buildPathRecipeComponents } from './path_store.js';
import { PATH_LIMITS, pathCubics, splitPathCubic, pathOptions } from './path_geometry.js';

export function changePathOptions(input, patch) {
	return changePathSettings(input, patch);
}

export function changePathSettings(input, patch) {
	const recipe = validatePathRecipe(input);
	if (!patch || typeof patch !== 'object' || Array.isArray(patch)
		|| Object.keys(patch).some(key => key !== 'closed' && !Object.hasOwn(recipe.options, key))) throw new Error('Invalid path option patch.');
	const { closed, ...options } = patch;
	recipe.options = pathOptions({ ...recipe.options, ...options });
	if (Object.hasOwn(patch, 'closed')) recipe.closed = closed;
	return validateDraft(recipe);
}

export function changePathClosure(input, closed) {
	return changePathSettings(input, { closed });
}

export function nextPathSeed(seed) {
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid path variation seed.');
	return (seed + 0x9e3779b9) >>> 0;
}

export function translatePathRecipe(input, dx, dy) {
	const recipe = validatePathRecipe(input);
	if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('Path offsets must be finite scene coordinates.');
	for (const point of recipe.waypoints) {
		point.x += dx; point.y += dy;
		for (const handle of [point.incoming, point.outgoing]) if (handle) { handle.x += dx; handle.y += dy; }
	}
	return validateDraft(recipe);
}

export function pathWaypointHandles(input, index) {
	const recipe = validatePathRecipe(input), point = recipe.waypoints[index];
	if (!point) throw new Error('Invalid path waypoint selection.');
	if (point.mode !== 'automatic') return { incoming: point.incoming, outgoing: point.outgoing };
	const cubics = pathCubics(recipe.waypoints, recipe.options, recipe.closed);
	return { incoming: (index ? cubics[index - 1]?.[2] : recipe.closed ? cubics.at(-1)[2] : null)
			?? { x: 2 * point.x - cubics[0][1].x, y: 2 * point.y - cubics[0][1].y },
		outgoing: cubics[index]?.[1] ?? { x: 2 * point.x - cubics.at(-1)[2].x, y: 2 * point.y - cubics.at(-1)[2].y } };
}

export function changePathPointMode(input, index, mode) {
	const recipe = validatePathRecipe(input), point = recipe.waypoints[index];
	if (!point || !['automatic', 'smooth', 'corner'].includes(mode)) throw new Error('Invalid path waypoint mode or selection.');
	const handles = pathWaypointHandles(recipe, index);
	point.mode = mode;
	point.incoming = mode === 'automatic' ? null : { x: handles.incoming.x, y: handles.incoming.y };
	point.outgoing = mode === 'automatic' ? null : { x: handles.outgoing.x, y: handles.outgoing.y };
	if (mode === 'smooth') linkHandle(point, 'outgoing');
	return validateDraft(recipe);
}

function linkHandle(point, side) {
	const other = side === 'incoming' ? 'outgoing' : 'incoming';
	const dx = point[side].x - point.x, dy = point[side].y - point.y, length = Math.hypot(dx, dy);
	const oppositeLength = Math.hypot(point[other].x - point.x, point[other].y - point.y);
	if (length) point[other] = { x: point.x - dx / length * oppositeLength, y: point.y - dy / length * oppositeLength };
}

export function changePathHandle(input, index, side, position) {
	const recipe = validatePathRecipe(input), point = recipe.waypoints[index];
	if (!point || point.mode === 'automatic' || !['incoming', 'outgoing'].includes(side)) throw new Error('Choose a manual path handle first.');
	point[side] = { x: position.x, y: position.y };
	if (point.mode === 'smooth') linkHandle(point, side);
	return validateDraft(recipe);
}

export function changePathWaypoint(input, index, point) {
	const recipe = validatePathRecipe(input);
	if (!Number.isInteger(index) || !recipe.waypoints[index]) throw new Error('Invalid path waypoint selection.');
	const waypoint = recipe.waypoints[index], dx = point.x - waypoint.x, dy = point.y - waypoint.y;
	waypoint.x = point.x; waypoint.y = point.y;
	for (const handle of [waypoint.incoming, waypoint.outgoing]) if (handle) { handle.x += dx; handle.y += dy; }
	return validateDraft(recipe);
}

export function removePathWaypoint(input, index) {
	const recipe = validatePathRecipe(input);
	if (!Number.isInteger(index) || !recipe.waypoints[index]) throw new Error('Invalid path waypoint selection.');
	recipe.waypoints.splice(index, 1);
	return validateDraft(recipe);
}

function validateDraft(recipe) {
	const valid = validatePathRecipe(recipe);
	buildPathRecipeComponents(valid);
	return valid;
}

export function nearestPathSegment(input, point) {
	const recipe = validatePathRecipe(input), route = evaluatePathRecipe(recipe);
	let anchor = 1, best = null;
	for (let index = 0; index < route.points.length - 1; index++) {
		const a = route.points[index], b = route.points[index + 1], end = recipe.waypoints[anchor % recipe.waypoints.length];
		if (anchor < recipe.waypoints.length - (recipe.closed ? 0 : 1) && Math.hypot(a.x - end.x, a.y - end.y) < 0.01) anchor++;
		const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
		const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
		const position = { x: a.x + t * dx, y: a.y + t * dy };
		const distance = Math.hypot(point.x - position.x, point.y - position.y);
		if (!best || distance < best.distance) best = { point: position, index: route.spans ? route.spans[index].segment + 1 : anchor,
			distance, span: route.spans?.[index], t };
	}
	if (best?.span) {
		const cubic = pathCubics(recipe.waypoints, recipe.options, recipe.closed)[best.span.segment];
		const at = t => splitPathCubic(cubic, t)[0][3];
		const distance = t => { const p = at(t); return Math.hypot(p.x - point.x, p.y - point.y); };
		let lo = best.span.t0, hi = best.span.t1;
		// Refine within the hit's bounded flattened interval, including the exact endpoints.
		for (let iteration = 0; iteration < 48; iteration++) {
			const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
			if (distance(a) < distance(b)) hi = b; else lo = a;
		}
		const t = [best.span.t0, best.span.t1, (lo + hi) / 2].reduce((a, b) => distance(a) <= distance(b) ? a : b);
		best.point = at(t); best.distance = distance(t);
		best.t = (t - best.span.t0) / (best.span.t1 - best.span.t0);
	}
	return best;
}

export function insertPathWaypoint(input, point, maxDistance = Infinity) {
	const recipe = validatePathRecipe(input);
	if (recipe.waypoints.length >= PATH_LIMITS.waypoints) throw new Error('Path waypoint limit reached.');
	const nearest = nearestPathSegment(recipe, point);
	if (!nearest || nearest.distance > maxDistance) throw new Error('Choose a position on the path preview.');
	if (nearest.span) {
		const cubics = pathCubics(recipe.waypoints, recipe.options, recipe.closed);
		const t = nearest.span.t0 + nearest.t * (nearest.span.t1 - nearest.span.t0);
		if (t <= 1e-8 || t >= 1 - 1e-8) throw new Error('Choose a position between existing waypoints.');
		// Freeze automatic tangents before subdivision so inserting a neighbor cannot alter other intervals.
		const handles = recipe.waypoints.map((_, index) => pathWaypointHandles(recipe, index));
		for (const [index, waypoint] of recipe.waypoints.entries()) if (waypoint.mode === 'automatic') {
			waypoint.mode = 'corner';
			waypoint.incoming = { x: handles[index].incoming.x, y: handles[index].incoming.y };
			waypoint.outgoing = { x: handles[index].outgoing.x, y: handles[index].outgoing.y };
		}
		const [left, right] = splitPathCubic(cubics[nearest.index - 1], t);
		recipe.waypoints[nearest.index - 1].outgoing = { ...left[1] };
		recipe.waypoints[nearest.index % recipe.waypoints.length].incoming = { ...right[2] };
		recipe.waypoints.splice(nearest.index, 0, { ...left[3], mode: 'smooth', incoming: left[2], outgoing: right[1] });
	} else {
		recipe.waypoints.splice(nearest.index, 0, { ...nearest.point, mode: 'automatic', incoming: null, outgoing: null });
	}
	return { recipe: validateDraft(recipe), index: nearest.index };
}
