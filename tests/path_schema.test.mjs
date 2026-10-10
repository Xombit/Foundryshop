import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	createPathRecipe, validatePathRecipe, validatePathRegistry, validatePathMembership,
	emptyPathRegistry, PATH_STORAGE_LIMITS,
} from '../scripts/path_schema.js';
import { buildPathDrawings, evaluatePathRoute, buildPathComponents } from '../scripts/path_geometry.js';
import {
	readPathRegistry, pathComponentBaseline, inspectPathIntegrity, evaluatePathRecipe, buildPathRecipeComponents,
} from '../scripts/path_store.js';

const points = [{ x: -30, y: 10 }, { x: 100, y: 40 }, { x: 180, y: 150 }];
const recipe = () => createPathRecipe(points, { style: 'plain' });
function fixture() {
	const native = {
		_id: 'drawing1', ...buildPathDrawings(points, { style: 'plain' })[0],
		elevation: 0, levels: ['ground'], sort: 1024, author: 'gm', fontFamily: 'Signika', fontSize: 48,
		textColor: '#ffffff', textAlpha: 1,
		flags: { foundryshop: { layerId: 'ink', path: { version: 1, id: 'route1', role: 'path' } } },
	};
	const drawing = { id: 'drawing1', data: native, toObject() { return structuredClone(this.data); },
		getFlag(namespace, key) { return this.data.flags[namespace]?.[key]; } };
	const route = {
		id: 'route1', revision: 0, name: 'Route', layerId: 'ink', levelId: 'ground', elevation: 0,
		recipe: recipe(), components: [{ drawingId: drawing.id, role: 'path', baseline: pathComponentBaseline(drawing) }],
	};
	const scene = {
		flags: { foundryshop: { paths: { version: 1, revision: 0, routes: [route] },
			layers: { nodes: [{ id: 'ink', kind: 'layer' }] } } },
		drawings: new Map([[drawing.id, drawing]]), levels: new Map([['ground', {}]]),
		getFlag(namespace, key) { return this.flags[namespace]?.[key]; },
	};
	return { scene, route, drawing };
}

test('retained recipe roundtrips complete options, scene coordinates and independent waypoint data', () => {
	const result = recipe();
	assert.equal(result.version, 1);
	assert.equal(result.coordinateSpace, 'scene-pixels');
	assert.equal(result.options.seed, 1);
	assert.deepEqual(validatePathRecipe(JSON.parse(JSON.stringify(result))), result);
	assert.deepEqual(result.waypoints.map(({ x, y }) => ({ x, y })), points);
	result.waypoints[0].x = 99;
	assert.equal(points[0].x, -30);
});

test('persisted recipe validation refuses ambiguous, unsafe, nonfinite and incomplete data', () => {
	for (const mutate of [
		r => { r.version = 2; }, r => { r.gridSize = 0; }, r => { r.coordinateSpace = 'canvas'; },
		r => { delete r.options.seed; }, r => { r.options.walls = true; },
		r => { r.waypoints[0].x = Infinity; }, r => { r.waypoints[0].mode = 'mystery'; },
		r => { r.waypoints[0].incoming = { x: 1, y: 1 }; },
		r => { r.waypoints[1] = structuredClone(r.waypoints[0]); },
		r => { r.waypoints[0].constructor = {}; },
		r => { r.waypoints = Array(257).fill(r.waypoints[0]); },
	]) {
		const input = recipe(); mutate(input);
		assert.throws(() => validatePathRecipe(input), /Foundryshop Paths|Invalid path/);
	}
	assert.throws(() => createPathRecipe(null), /waypoint/);
});

test('manual point schema defines absolute handles and enforces linked smooth directions', () => {
	const input = recipe();
	input.waypoints[1] = { x: 100, y: 40, mode: 'smooth', incoming: { x: 80, y: 30 }, outgoing: { x: 140, y: 60 } };
	assert.deepEqual(validatePathRecipe(input), input);
	input.waypoints[1].outgoing.y = 80;
	assert.throws(() => validatePathRecipe(input), /linked directions/);
	input.waypoints[1].mode = 'corner';
	assert.deepEqual(validatePathRecipe(input), input);
	assert.ok(evaluatePathRecipe(input).length > 0);
});

test('closed schema requires distinct seam and at least three waypoints without silently opening it', () => {
	const input = recipe(); input.closed = true;
	assert.deepEqual(validatePathRecipe(input), input);
	assert.ok(buildPathRecipeComponents(input).length > 0);
	input.waypoints.push(structuredClone(input.waypoints[0]));
	assert.throws(() => validatePathRecipe(input), /duplicate the first/);
	input.waypoints = input.waypoints.slice(0, 2);
	assert.throws(() => validatePathRecipe(input), /waypoint count/);
});

test('shared evaluator returns base and meander routes independently of Drawing style and width', () => {
	const options = { meander: 0.3, bendSpacing: 2, seed: 17 };
	const evaluated = evaluatePathRoute(points, options);
	assert.notDeepEqual(evaluated.points, evaluated.basePoints);
	assert.equal(evaluated.distances.length, evaluated.points.length);
	assert.equal(evaluated.distances[0], 0);
	assert.equal(evaluated.distances.at(-1), evaluated.length);
	assert.ok(evaluated.distances.every((d, index) => !index || d > evaluated.distances[index - 1]));
	for (const style of ['plain', 'railway', 'road', 'river']) {
		assert.deepEqual(evaluatePathRoute(points, { ...options, style, width: 4 }), evaluated);
	}
	const r = createPathRecipe(points, options);
	assert.deepEqual(evaluatePathRecipe(r), evaluated);
	evaluated.points[0].x = 123;
	assert.equal(points[0].x, -30, 'returned geometry cannot mutate source waypoints');
});

test('component roles are explicit while existing Drawing output remains byte-equivalent', () => {
	const roles = { plain: ['path'], road: ['edge', 'surface'], river: ['edge', 'surface', 'current'] };
	for (const style of ['plain', 'railway', 'road', 'river']) {
		const components = buildPathComponents(points, { style });
		assert.deepEqual(components.map(c => c.data), buildPathDrawings(points, { style }));
		assert.deepEqual(buildPathRecipeComponents(createPathRecipe(points, { style })), components);
		if (style === 'railway') {
			assert.ok(components.slice(0, -2).every(c => c.role === 'sleeper'));
			assert.deepEqual(components.slice(-2).map(c => c.role), ['rail-left', 'rail-right']);
		} else assert.deepEqual(components.map(c => c.role), roles[style]);
	}
});

test('registry and membership roundtrip and enforce unique component ownership and roles', () => {
	const { scene } = fixture(), registry = readPathRegistry(scene);
	assert.deepEqual(validatePathRegistry(JSON.parse(JSON.stringify(registry))), registry);
	assert.deepEqual(validatePathMembership({ version: 1, id: 'route1', role: 'path' }), { version: 1, id: 'route1', role: 'path' });
	for (const member of [{ version: 2, id: 'route1', role: 'path' },
		{ version: 1, id: '__proto__', role: 'path' }, { version: 1, id: 'route1', role: 'rail' }]) {
		assert.throws(() => validatePathMembership(member), /Invalid/);
	}
	for (const mutate of [
		r => { r.routes.push(structuredClone(r.routes[0])); },
		r => { const copy = structuredClone(r.routes[0]); copy.id = 'route2'; r.routes.push(copy); },
		r => { r.routes[0].components[0].role = 'surface'; },
		r => { r.routes[0].components[0].baseline = 'x'.repeat(PATH_STORAGE_LIMITS.baselineBytes + 1); },
		r => { r.routes[0].name = ' '; },
		r => { r.routes[0].layerId = null; },
		r => { r.revision = -1; },
		r => { r.routes[0].recipe.version = 2; },
	]) {
		const input = structuredClone(registry); mutate(input);
		assert.throws(() => validatePathRegistry(input), /Foundryshop Paths/);
	}
	registry.routes[0].recipe.waypoints[0].x = 100;
	assert.equal(scene.flags.foundryshop.paths.routes[0].recipe.waypoints[0].x, -30);
});

test('registry missing is empty but malformed storage fails explicitly with no Scene writes', () => {
	const { scene } = fixture();
	delete scene.flags.foundryshop.paths;
	assert.deepEqual(readPathRegistry(scene), emptyPathRegistry());
	scene.flags.foundryshop.paths = null;
	assert.throws(() => readPathRegistry(scene), /Invalid registry/);
	assert.throws(() => readPathRegistry(null), /Scene/);
});

test('registry enforces route, aggregate component and encoded storage budgets', () => {
	const { scene } = fixture(), input = readPathRegistry(scene), route = input.routes[0];
	assert.throws(() => validatePathRegistry({ ...input, routes: Array(PATH_STORAGE_LIMITS.routes + 1).fill(route) }), /route count/);
	const oversized = Array.from({ length: 33 }, (_, index) => ({
		...structuredClone(route), id: `route${index}`, components: [{
			drawingId: `drawing${index}`, role: 'path', baseline: 'x'.repeat(PATH_STORAGE_LIMITS.baselineBytes),
		}],
	}));
	assert.throws(() => validatePathRegistry({ ...input, routes: oversized }), /storage limit/);
	const tooMany = Array.from({ length: 101 }, (_, index) => ({
		...structuredClone(route), id: `route${index}`, recipe: createPathRecipe(points, { style: 'railway' }),
		components: Array.from({ length: 100 }, (_, part) => ({
			drawingId: `drawing${index}_${part}`, role: part < 98 ? 'sleeper' : part === 98 ? 'rail-left' : 'rail-right', baseline: 'x',
		})),
	}));
	assert.throws(() => validatePathRegistry({ ...input, routes: tooMany }), /component limit/);
});

test('integrity tolerates presentation/sort bookkeeping but detects geometry, appearance and material changes', () => {
	const { scene, drawing } = fixture();
	assert.equal(inspectPathIntegrity(scene, 'route1').intact, true);
	Object.assign(drawing.data, { hidden: true, locked: true, sort: 8000, author: 'another', name: 'Renamed' });
	drawing.data.flags.foundryshop.provenance = { importId: 'unrelated' };
	assert.equal(inspectPathIntegrity(scene, 'route1').intact, true);
	const baseline = structuredClone(drawing.data);
	for (const mutate of [
		d => { d.x++; }, d => { d.strokeColor = '#ff0000'; },
		d => { d.elevation = 10; }, d => { d.levels = ['other']; },
		d => { d.flags.foundryshop.materialRepeat = 2; }, d => { d.shape.points[0]++; },
	]) {
		drawing.data = structuredClone(baseline); mutate(drawing.data);
		assert.ok(inspectPathIntegrity(scene, 'route1').issues.some(issue => issue.kind === 'changed-artwork'));
	}
});

test('integrity distinguishes missing, unexpectedly copied and detached components and destination damage', () => {
	const { scene, drawing } = fixture();
	delete drawing.data.flags.foundryshop.path;
	drawing.data.flags.foundryshop.layerId = 'other';
	const extra = { ...drawing, id: 'extra' };
	extra.data = structuredClone(drawing.data);
	extra.data.flags.foundryshop.path = { version: 1, id: 'route1', role: 'path' };
	scene.drawings.set('extra', extra);
	scene.levels.clear(); scene.flags.foundryshop.layers.nodes = [];
	assert.deepEqual(inspectPathIntegrity(scene, 'route1').issues.map(issue => issue.kind),
		['missing-level', 'missing-layer', 'changed-membership', 'changed-layer', 'unexpected-component']);
	scene.drawings.delete('drawing1');
	assert.ok(inspectPathIntegrity(scene, 'route1').issues.some(issue => issue.kind === 'missing-component'));
	assert.throws(() => inspectPathIntegrity(scene, 'unknown'), /no matching/);
});
