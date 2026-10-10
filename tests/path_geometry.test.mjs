import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPathDrawings, pathOptions, PATH_LIMITS } from '../scripts/path_geometry.js';
import { prepareArtworkSnapshot } from '../scripts/artwork_renderer.js';

const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
const absolute = data => data.shape.points.map((value, index) => value + (index % 2 ? data.y : data.x));

test('all styles produce finite native geometry with grid-scaled widths', () => {
	for (const style of ['plain', 'railway', 'road', 'river']) {
		for (const grid of [50, 100, 200]) {
			const data = buildPathDrawings(points, { style, width: 0.5 }, grid);
			assert.ok(data.length <= PATH_LIMITS.drawings);
			assert.ok(data.every(part => part.shape.points.every(Number.isFinite) && part.fillType === 0));
			assert.equal(data[style === 'railway' ? data.length - 1 : style === 'plain' ? 0 : 1].strokeAlpha, 1);
			if (style !== 'railway') assert.equal(data[style === 'plain' ? 0 : 1].strokeWidth, grid * 0.5);
		}
	}
});

test('rail separation and sleeper spacing remain continuous across corners', () => {
	const result = buildPathDrawings(points, { curve: 'straight', width: 0.4, spacing: 0.3 }, 100);
	assert.equal(result.length, 9);
	const sleepers = result.slice(0, -2);
	const centers = sleepers.map(data => {
		const p = absolute(data);
		return [(p[0] + p[2]) / 2, (p[1] + p[3]) / 2];
	});
	assert.deepEqual(centers, [[0, 0], [30, 0], [60, 0], [90, 0], [100, 20], [100, 50], [100, 80]]);
	const rails = result.slice(-2).map(absolute);
	assert.equal(Math.abs(rails[0][1] - rails[1][1]), 40);
	assert.ok(result.slice(-2).every(part => part.name.endsWith('rail')));
});

test('reversals, duplicate points, negative coordinates and acute corners stay bounded', () => {
	for (const path of [
		[{ x: -100, y: -50 }, { x: 0, y: -50 }, { x: -100, y: -50 }],
		[{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 1, y: 1 }],
	]) {
		const result = buildPathDrawings(path, { style: 'railway' });
		assert.ok(result.flatMap(absolute).every(value => Number.isFinite(value) && Math.abs(value) < 300));
	}
	assert.throws(() => buildPathDrawings([{ x: 1, y: 1 }, { x: 1, y: 1 }]), /different/);
});

test('limits and invalid options refuse before allocating excessive geometry', () => {
	assert.throws(() => pathOptions({ color: new String('#abcdef') }), /Invalid/);
	assert.throws(() => pathOptions({ width: NaN }), /Invalid/);
	assert.throws(() => pathOptions({ width: 0.001 }), /Invalid/);
	assert.throws(() => pathOptions({ spacing: 0 }), /Invalid/);
	assert.throws(() => pathOptions({ style: 'unknown' }), /Invalid/);
	assert.throws(() => pathOptions({ curve: 'unknown' }), /Invalid/);
	assert.throws(() => pathOptions({ smoothing: -0.1 }), /Invalid/);
	assert.throws(() => pathOptions({ smoothing: Infinity }), /Invalid/);
	assert.throws(() => pathOptions({ meander: -1 }), /Invalid/);
	assert.throws(() => pathOptions({ meander: NaN }), /Invalid/);
	assert.throws(() => pathOptions({ bendSpacing: 0 }), /Invalid/);
	assert.throws(() => pathOptions({ seed: 0x100000000 }), /Invalid/);
	assert.throws(() => buildPathDrawings([{ x: 0, y: 0 }, { x: 100000, y: 0 }], { spacing: 0.1 }), /sleepers/);
	assert.throws(() => buildPathDrawings([{ x: 0, y: 0 }, { x: Infinity, y: 0 }]), /Invalid/);
	assert.throws(() => buildPathDrawings(Array(257).fill({ x: 0, y: 0 })), /Invalid/);
});

const pathPoints = data => {
	const values = absolute(data);
	return Array.from({ length: values.length / 2 }, (_, index) => ({ x: values[index * 2], y: values[index * 2 + 1] }));
};

test('smooth defaults interpolate every waypoint with deterministic adaptive native points', () => {
	assert.equal(pathOptions().curve, 'smooth');
	assert.equal(pathOptions().smoothing, 1);
	const result = buildPathDrawings(points, { style: 'plain' })[0];
	const sampled = pathPoints(result);
	assert.ok(sampled.length > points.length);
	assert.deepEqual(sampled[0], points[0]);
	assert.deepEqual(sampled.at(-1), points.at(-1));
	for (const waypoint of points) assert.ok(sampled.some(point => Math.hypot(point.x - waypoint.x, point.y - waypoint.y) < 1e-9));
	assert.ok(sampled.some(point => Math.hypot(point.x - 56.25, point.y + 6.25) < 1e-9), 'passes through the expected spline midpoint');
	assert.equal(result.bezierFactor, 0, 'portable points encode the curve without renderer-specific smoothing');
	assert.deepEqual(buildPathDrawings(points, { style: 'plain' })[0], result);
	const road = buildPathDrawings(points, { style: 'road' });
	const river = buildPathDrawings(points, { style: 'river' });
	for (const part of [...road, ...river]) assert.deepEqual(pathPoints(part), sampled);
});

test('curve amount tightens bends and straight mode preserves exact original geometry', () => {
	const smooth = pathPoints(buildPathDrawings(points, { style: 'plain' })[0]);
	const tighter = pathPoints(buildPathDrawings(points, { style: 'plain', smoothing: 0.4 })[0]);
	assert.ok(Math.min(...tighter.map(p => p.y)) > Math.min(...smooth.map(p => p.y)));
	for (const options of [{ curve: 'straight' }, { smoothing: 0 }]) {
		assert.deepEqual(pathPoints(buildPathDrawings(points, { style: 'plain', ...options })[0]), points);
	}
	const two = points.slice(0, 2);
	assert.deepEqual(pathPoints(buildPathDrawings(two, { style: 'plain' })[0]), two);
	assert.equal(buildPathDrawings(points, { style: 'plain', width: 0.01 }, 100)[0].strokeWidth, 1, 'generic curves support thin lines');
});

test('curved railway sleepers use sampled arc length and follow the local curve direction', () => {
	const centerline = pathPoints(buildPathDrawings(points, { style: 'plain' })[0]);
	const railway = buildPathDrawings(points, { width: 0.4, spacing: 0.3 });
	const sleepers = railway.slice(0, -2).map(pathPoints);
	let segment = 1, previousLength = 0;
	for (let index = 0; index < sleepers.length; index++) {
		const [a, b] = sleepers[index], center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		const expectedLength = index * 30;
		while (segment < centerline.length - 1) {
			const p = centerline[segment - 1], q = centerline[segment];
			const length = Math.hypot(q.x - p.x, q.y - p.y);
			if (previousLength + length >= expectedLength - 1e-8) break;
			previousLength += length; segment++;
		}
		const p = centerline[segment - 1], q = centerline[segment];
		const dx = q.x - p.x, dy = q.y - p.y, length = Math.hypot(dx, dy);
		const distance = expectedLength - previousLength;
		assert.ok(Math.hypot(center.x - p.x - dx * distance / length, center.y - p.y - dy * distance / length) < 1e-8);
		assert.ok(Math.abs((b.x - a.x) * dx + (b.y - a.y) * dy) < 1e-8, 'sleeper is perpendicular to the curve');
		assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 60) < 1e-8);
	}
	const [left, right] = railway.slice(-2).map(pathPoints);
	assert.equal(left.length, centerline.length);
	assert.equal(right.length, centerline.length);
	for (let index = 0; index < centerline.length; index++) {
		assert.ok(Math.hypot((left[index].x + right[index].x) / 2 - centerline[index].x,
			(left[index].y + right[index].y) / 2 - centerline[index].y) < 1e-8);
		const gauge = Math.hypot(left[index].x - right[index].x, left[index].y - right[index].y);
		assert.ok(gauge >= 40 - 1e-8 && gauge < 41);
	}
});

test('uneven, near-duplicate and reversing curved waypoints stay finite and bounded', () => {
	for (const path of [
		[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10000, y: 100 }, { x: 10001, y: 100 }],
		[{ x: 0, y: 0 }, { x: 0.005, y: 0 }, { x: 0.009, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }],
		[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 99.99, y: 0.01 }, { x: 0, y: -100 }],
	]) {
		const sampled = pathPoints(buildPathDrawings(path, { style: 'plain' })[0]);
		assert.ok(sampled.length <= PATH_LIMITS.samples);
		assert.ok(sampled.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
		assert.deepEqual(sampled[0], path[0]);
		assert.deepEqual(sampled.at(-1), path.at(-1));
		assert.ok(sampled.every(p => Math.abs(p.y) < 200), 'uneven distances do not produce an exaggerated loop');
	}
});

test('meander is bounded, seeded, grid-scaled and anchored to every clicked waypoint', () => {
	const route = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 1200, y: 0 }];
	const options = { style: 'plain', meander: 0.4, bendSpacing: 2, seed: 27 };
	const data = buildPathDrawings(route, options)[0], samples = pathPoints(data);
	assert.ok(samples.some(point => Math.abs(point.y) > 5));
	assert.ok(samples.every(point => Math.abs(point.y) <= 40 + 1e-9));
	for (const waypoint of route) assert.ok(samples.some(point => point.x === waypoint.x && point.y === waypoint.y));
	assert.deepEqual(buildPathDrawings(route, options)[0], data);
	assert.notDeepEqual(buildPathDrawings(route, { ...options, seed: 28 })[0], data);
	const scaled = buildPathDrawings(route.map(p => ({ x: p.x * 2, y: p.y * 2 })), options, 200)[0];
	const doubled = pathPoints(scaled);
	assert.equal(doubled.length, samples.length);
	for (let index = 0; index < samples.length; index++) {
		assert.ok(Math.hypot(doubled[index].x - samples[index].x * 2, doubled[index].y - samples[index].y * 2) < 1e-8);
	}
	assert.deepEqual(pathPoints(buildPathDrawings(route, { ...options, meander: 0 })[0]), route);
	assert.notDeepEqual(buildPathDrawings(route, { ...options, bendSpacing: 5 })[0], data);
	for (const style of ['road', 'river']) {
		for (const part of buildPathDrawings(route, { ...options, style })) assert.deepEqual(pathPoints(part), samples);
	}
});

test('meandering rails follow the generated route and all meanders remain portable and bounded', () => {
	const route = [{ x: 0, y: 0 }, { x: 600, y: 0 }];
	const options = { meander: 0.3, bendSpacing: 2, seed: 41 };
	const samples = pathPoints(buildPathDrawings(route, { ...options, style: 'plain' })[0]);
	const railway = buildPathDrawings(route, options);
	const sleepers = railway.slice(0, -2).map(pathPoints);
	assert.ok(sleepers.some(([a, b]) => Math.abs(a.x - b.x) > 1), 'sleepers turn with the meander instead of staying vertical');
	assert.ok(railway.every(part => part.shape.points.every(Number.isFinite)));
	assert.ok(railway.length <= PATH_LIMITS.drawings);
	const rails = railway.slice(-2).map(pathPoints);
	for (const rail of rails) assert.equal(rail.length, samples.length);
	assert.throws(() => buildPathDrawings([{ x: 0, y: 0 }, { x: 100000, y: 0 }],
		{ style: 'plain', meander: 5, bendSpacing: 0.5 }), /detailed/);
	globalThis.game = { version: '14.365', i18n: { localize: key => key } };
	globalThis.getDocumentClass = () => ({ metadata: { schemaVersion: '14.355' } });
	for (const style of ['plain', 'railway', 'road', 'river']) {
		const drawings = buildPathDrawings(route, { ...options, style }).map((data, index) => ({
			id: `meander${index}`, layerId: null, data: {
				...data, elevation: 0, levels: [], sort: index * 1024, flags: {},
				fontFamily: 'Signika', fontSize: 48, textColor: '#302b26', textAlpha: 1,
			},
		}));
		assert.equal(prepareArtworkSnapshot(drawings).drawings.length, drawings.length);
	}
});

test('path artwork passes portable preview validation with no custom renderer', () => {
	globalThis.game = { version: '14.365', i18n: { localize: key => key } };
	globalThis.getDocumentClass = () => ({ metadata: { schemaVersion: '14.355' } });
	for (const style of ['plain', 'railway', 'road', 'river']) {
		const drawings = buildPathDrawings(points, { style }).map((data, index) => ({
			id: `part${index}`, layerId: null, data: {
				...data, elevation: 0, levels: [], sort: index * 1024, flags: {},
				fontFamily: 'Signika', fontSize: 48, textColor: '#302b26', textAlpha: 1,
			},
		}));
		assert.equal(prepareArtworkSnapshot(drawings).drawings.length, drawings.length);
	}
});
