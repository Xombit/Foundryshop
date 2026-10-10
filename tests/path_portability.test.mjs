import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPathRecipe } from '../scripts/path_schema.js';
import { changePathPointMode } from '../scripts/path_draft.js';
import { evaluatePathRecipe, buildPathRecipeComponents } from '../scripts/path_store.js';
import { transformPathRecipe, validatePortablePaths, filterPortablePaths } from '../scripts/path_portability.js';

const portable = () => {
	const recipe = createPathRecipe([{ x: 0, y: 0 }, { x: 400, y: 0 }], { style: 'road' });
	const routes = [{ id: 'route', name: 'Road', recipe,
		components: [{ drawingId: 'edge', role: 'edge' }, { drawingId: 'surface', role: 'surface' }] }];
	const drawings = routes[0].components.map(c => ({ id: c.drawingId, layerId: 'ink',
		data: { levels: ['ground'], elevation: 0, interface: false, flags: { foundryshop: {
			path: { version: 1, id: 'route', role: c.role },
		} } } }));
	return { paths: { version: 1, routes }, drawings };
};

test('portable recipe rotation/scale/translation transforms absolute handles and every grid-derived dimension', () => {
	for (const style of ['plain', 'road', 'river', 'railway']) {
		let recipe = createPathRecipe([{ x: 100, y: 100 }, { x: 400, y: 250 }, { x: 700, y: 100 }],
			{ style, meander: 0.2, bendSpacing: 2, width: 0.6, spacing: 0.5, seed: 123 }, 100);
		recipe = changePathPointMode(recipe, 1, 'corner');
		const source = structuredClone(recipe), transformed = transformPathRecipe(recipe, { x: 1000, y: 800, scale: 2, rotation: 90 });
		assert.deepEqual(recipe, source);
		assert.equal(transformed.gridSize, 200); assert.deepEqual(transformed.options, recipe.options);
		for (const [index, p] of recipe.waypoints.entries()) {
			const q = transformed.waypoints[index];
			assert.ok(Math.abs(q.x - (1000 - p.y * 2)) < 1e-8);
			assert.ok(Math.abs(q.y - (800 + p.x * 2)) < 1e-8);
			for (const side of ['incoming', 'outgoing']) if (p[side]) {
				assert.ok(Math.abs(q[side].x - (1000 - p[side].y * 2)) < 1e-8);
				assert.ok(Math.abs(q[side].y - (800 + p[side].x * 2)) < 1e-8);
			}
		}
		const originalGeometry = evaluatePathRecipe(recipe), scaledGeometry = evaluatePathRecipe(transformed);
		assert.ok(Math.abs(scaledGeometry.length - originalGeometry.length * 2) < 0.1);
		const originalParts = buildPathRecipeComponents(recipe), scaledParts = buildPathRecipeComponents(transformed);
		assert.deepEqual(scaledParts.map(p => p.role), originalParts.map(p => p.role));
		for (const [index, part] of scaledParts.entries()) {
			assert.ok(Math.abs(part.data.strokeWidth - originalParts[index].data.strokeWidth * 2) <= 1);
		}
	}
	assert.throws(() => transformPathRecipe(createPathRecipe([{ x: 0, y: 0 }, { x: 100, y: 0 }]), { scale: 0 }), /transform/);
	assert.throws(() => transformPathRecipe(createPathRecipe([{ x: 0, y: 0 }, { x: 100, y: 0 }]), { x: 1e8 }), /coordinates/);
});

test('portable validation rejects missing, multiply-owned, extra and cross-destination components', () => {
	const { paths, drawings } = portable();
	assert.deepEqual(validatePortablePaths(paths, drawings), paths);
	assert.throws(() => validatePortablePaths(paths, drawings.slice(0, 1)), /missing/);
	const duplicated = structuredClone(paths); duplicated.routes.push({ ...duplicated.routes[0], id: 'other' });
	assert.throws(() => validatePortablePaths(duplicated, drawings), /owned/);
	const extra = [...drawings, { ...structuredClone(drawings[0]), id: 'extra' }];
	assert.throws(() => validatePortablePaths(paths, extra), /dangling/);
	for (const patch of [{ levels: ['upper'] }, { elevation: 10 }, { interface: true }]) {
		const changed = structuredClone(drawings); Object.assign(changed[1].data, patch);
		assert.throws(() => validatePortablePaths(paths, changed), /destinations/);
	}
	const changedLayer = structuredClone(drawings); changedLayer[1].layerId = 'other';
	assert.throws(() => validatePortablePaths(paths, changedLayer), /destinations/);
});

test('Level filtering retains complete paths or reports partial loss without mutating the package', () => {
	const project = portable(), before = structuredClone(project);
	assert.equal(filterPortablePaths(project, project.drawings).paths.routes.length, 1);
	const partial = filterPortablePaths(project, project.drawings.slice(0, 1));
	assert.equal(partial.paths.routes.length, 0);
	assert.deepEqual(partial.pathWarnings, [{ name: 'Road', reason: 'partial' }]);
	assert.equal(partial.drawings[0].data.flags.foundryshop.path, undefined);
	const empty = filterPortablePaths(project, []);
	assert.equal(empty.paths.routes.length, 0); assert.equal(empty.pathWarnings, undefined);
	assert.deepEqual(project, before);
});
