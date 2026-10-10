export const PATH_STYLES = ['plain', 'railway', 'road', 'river'];
export const PATH_LIMITS = { waypoints: 256, drawings: 100, length: 1000000, samples: 4096 };
export class PathGeometryError extends Error {}

export function pathOptions(options = {}) {
	const result = { style: 'railway', curve: 'smooth', smoothing: 1, meander: 0, bendSpacing: 4, seed: 1,
		width: 0.6, spacing: 0.35, color: options.style === 'road' ? '#b49a72' : options.style === 'river' ? '#6aa5b8' : '#302b26', alpha: 1, ...options };
	if (!PATH_STYLES.includes(result.style) || !Number.isFinite(result.width) || result.width < 0.01 || result.width > 10
		|| !['smooth', 'straight'].includes(result.curve) || !Number.isFinite(result.smoothing) || result.smoothing < 0 || result.smoothing > 1
		|| !Number.isFinite(result.meander) || result.meander < 0 || result.meander > 5
		|| !Number.isFinite(result.bendSpacing) || result.bendSpacing < 0.5 || result.bendSpacing > 20
		|| !Number.isInteger(result.seed) || result.seed < 0 || result.seed > 0xffffffff
		|| !Number.isFinite(result.spacing) || result.spacing < 0.1 || result.spacing > 5
		|| typeof result.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(result.color)
		|| !Number.isFinite(result.alpha) || result.alpha < 0 || result.alpha > 1) {
		throw new PathGeometryError('Invalid path style, curve, meander, width, spacing, seed, color or opacity.');
	}
	return result;
}

function line(points, width, color, alpha, name) {
	const xs = points.map(point => point.x), ys = points.map(point => point.y);
	const x = Math.min(...xs), y = Math.min(...ys);
	return {
		name, x, y, rotation: 0, bezierFactor: 0,
		shape: { type: 'p', width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y),
			points: points.flatMap(point => [point.x - x, point.y - y]) },
		strokeWidth: Math.max(1, Math.round(width)), strokeColor: color, strokeAlpha: alpha,
		fillType: 0, fillColor: color, fillAlpha: 0, texture: null, text: '',
		hidden: false, locked: false, interface: false,
	};
}

export function pathCubics(points, options = {}, closed = false) {
	const settings = pathOptions(options), amount = settings.curve === 'straight' ? 0 : settings.smoothing;
	return (closed ? points : points.slice(0, -1)).map((b, index) => {
		const c = points[(index + 1) % points.length];
		const a = points[index - 1] ?? (closed ? points.at(-1) : { x: 2 * b.x - c.x, y: 2 * b.y - c.y });
		const d = points[index + 2] ?? (closed ? points[(index + 2) % points.length] : { x: 2 * c.x - b.x, y: 2 * c.y - b.y });
		const ab = Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y));
		const bc = Math.sqrt(Math.hypot(c.x - b.x, c.y - b.y));
		const cd = Math.sqrt(Math.hypot(d.x - c.x, d.y - c.y));
		const controls = ['x', 'y'].map(axis => [
			b[axis] + amount * bc / 3 * ((b[axis] - a[axis]) / ab - (c[axis] - a[axis]) / (ab + bc) + (c[axis] - b[axis]) / bc),
			c[axis] - amount * bc / 3 * ((c[axis] - b[axis]) / bc - (d[axis] - b[axis]) / (bc + cd) + (d[axis] - c[axis]) / cd),
		]);
		return [b, b.outgoing ?? { x: controls[0][0], y: controls[1][0] },
			c.incoming ?? { x: controls[0][1], y: controls[1][1] }, c];
	});
}

export const mixPathPoint = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export function splitPathCubic([a, b, c, d], t) {
	const ab = mixPathPoint(a, b, t), bc = mixPathPoint(b, c, t), cd = mixPathPoint(c, d, t);
	const abc = mixPathPoint(ab, bc, t), bcd = mixPathPoint(bc, cd, t), center = mixPathPoint(abc, bcd, t);
	return [[a, ab, abc, center], [center, bcd, cd, d]];
}

function curvedPoints(points, settings, tolerance, closed) {
	const result = [points[0]];
	const spans = [];
	const mix = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
	const distanceToSegment = (point, a, b) => {
		const dx = b.x - a.x, dy = b.y - a.y;
		const lengthSquared = dx * dx + dy * dy;
		const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
		return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
	};
	const flatten = (a, b, c, d, segment, t0 = 0, t1 = 1, depth = 0) => {
		const polygonLength = Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y) + Math.hypot(d.x - c.x, d.y - c.y);
		if (Math.max(distanceToSegment(b, a, d), distanceToSegment(c, a, d)) <= tolerance
			&& polygonLength - Math.hypot(d.x - a.x, d.y - a.y) <= tolerance) {
			if (result.length >= PATH_LIMITS.samples) throw new PathGeometryError('Curve is too detailed. Finish a shorter section.');
			result.push(d);
			spans.push({ segment, t0, t1 });
			return;
		}
		if (depth === 16) throw new PathGeometryError('Curve is too detailed. Finish a shorter section.');
		const ab = mix(a, b), bc = mix(b, c), cd = mix(c, d);
		const abc = mix(ab, bc), bcd = mix(bc, cd), center = mix(abc, bcd);
		const tm = (t0 + t1) / 2;
		flatten(a, ab, abc, center, segment, t0, tm, depth + 1);
		flatten(center, bcd, cd, d, segment, tm, t1, depth + 1);
	};
	pathCubics(points, settings, closed).forEach((cubic, index) => flatten(...cubic, index));
	const distinct = [result[0]], distinctSpans = [];
	for (let index = 1; index < result.length; index++) {
		if (Math.hypot(result[index].x - distinct.at(-1).x, result[index].y - distinct.at(-1).y) > 1e-9) {
			distinct.push(result[index]); distinctSpans.push(spans[index - 1]);
		}
	}
	return { points: distinct, spans: distinctSpans };
}

function meanderingPoints(points, waypoints, settings, gridSize, tolerance, closed) {
	if (!settings.meander) return points;
	const amplitude = settings.meander * gridSize, spacing = settings.bendSpacing * gridSize;
	const step = Math.min(gridSize * 0.1, spacing / 24, spacing * Math.sqrt(tolerance / (8 * amplitude)));
	const distances = [0], directions = [];
	for (let index = 1; index < points.length; index++) {
		const dx = points[index].x - points[index - 1].x, dy = points[index].y - points[index - 1].y;
		const length = Math.hypot(dx, dy);
		distances.push(distances.at(-1) + length);
		directions.push({ x: -dy / length, y: dx / length });
	}
	const anchors = distances.filter((distance, index) => waypoints.includes(points[index]));
	const normals = points.map((point, index) => {
		if (!closed && !index) return directions[0];
		if (!closed && index === points.length - 1) return directions.at(-1);
		const a = directions[index ? index - 1 : directions.length - 1], b = directions[index % directions.length], length = Math.hypot(a.x + b.x, a.y + b.y);
		return length > 1e-9 ? { x: (a.x + b.x) / length, y: (a.y + b.y) / length } : b;
	});
	const random = index => {
		let value = settings.seed ^ Math.imul(index + 1, 0x9e3779b1);
		value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
		value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
		return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
	};
	const smooth = t => t * t * (3 - 2 * t);
	const noise = distance => {
		const position = distance / spacing, index = Math.floor(position), t = smooth(position - index);
		return random(index) * (1 - t) + random(index + 1) * t;
	};
	const result = [points[0]];
	let anchor = 1;
	for (let index = 1; index < points.length; index++) {
		const length = distances[index] - distances[index - 1], steps = Math.ceil(length / step);
		if (result.length + steps > PATH_LIMITS.samples) throw new PathGeometryError('Meander is too detailed. Increase bend spacing or finish a shorter section.');
		for (let part = 1; part <= steps; part++) {
			const t = part / steps, distance = distances[index - 1] + t * length;
			while (anchor < anchors.length - 1 && distance > anchors[anchor]) anchor++;
			const ramp = Math.min(spacing / 2, (anchors[anchor] - anchors[anchor - 1]) / 2);
			// Fade at each clicked waypoint so meandering never moves route anchors.
			const fade = smooth(Math.max(0, Math.min(1,
				(distance - anchors[anchor - 1]) / ramp, (anchors[anchor] - distance) / ramp)));
			const offset = amplitude * noise(distance) * fade;
			const a = points[index - 1], b = points[index];
			const normal = { x: normals[index - 1].x * (1 - t) + normals[index].x * t,
				y: normals[index - 1].y * (1 - t) + normals[index].y * t };
			const normalLength = Math.hypot(normal.x, normal.y);
			const direction = normalLength > 1e-9 ? { x: normal.x / normalLength, y: normal.y / normalLength } : directions[index - 1];
			result.push(part === steps && waypoints.includes(b) ? b : {
				x: a.x + (b.x - a.x) * t + direction.x * offset,
				y: a.y + (b.y - a.y) * t + direction.y * offset,
			});
		}
	}
	return result.reduce((distinct, point) => {
		if (!distinct.length || Math.hypot(point.x - distinct.at(-1).x, point.y - distinct.at(-1).y) > 1e-9) distinct.push(point);
		return distinct;
	}, []);
}

function offsetPath(points, offset, closed) {
	const normals = points.slice(1).map((point, index) => {
		const dx = point.x - points[index].x, dy = point.y - points[index].y, length = Math.hypot(dx, dy);
		return { x: -dy / length, y: dx / length };
	});
	const result = (closed ? points.slice(0, -1) : points).flatMap((point, index) => {
		if (!closed && (!index || index === points.length - 1)) {
			const normal = normals[index ? index - 1 : 0];
			return [{ x: point.x + normal.x * offset, y: point.y + normal.y * offset }];
		}
		const a = normals[index ? index - 1 : normals.length - 1], b = normals[index];
		const denominator = 1 + a.x * b.x + a.y * b.y;
		if (denominator < 0.5) {
			return [a, b].map(normal => ({ x: point.x + normal.x * offset, y: point.y + normal.y * offset }));
		}
		return [{ x: point.x + (a.x + b.x) * offset / denominator,
			y: point.y + (a.y + b.y) * offset / denominator }];
	});
	if (closed) result.push({ ...result[0] });
	return result;
}

export function evaluatePathRoute(waypoints, options = {}, gridSize = 100, closed = false) {
	const settings = pathOptions(options);
	if (!Array.isArray(waypoints) || waypoints.length < 2 || waypoints.length > PATH_LIMITS.waypoints
		|| !Number.isFinite(gridSize) || gridSize <= 0
		|| waypoints.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
			|| Math.abs(point.x) > 10000000 || Math.abs(point.y) > 10000000
			|| [point.incoming, point.outgoing].some(handle => handle != null && (!Number.isFinite(handle.x) || !Number.isFinite(handle.y)
				|| Math.abs(handle.x) > 10000000 || Math.abs(handle.y) > 10000000)))) throw new PathGeometryError('Invalid path waypoints or grid size.');
	const distinct = waypoints.reduce((result, point) => {
		if (!result.length || Math.hypot(point.x - result.at(-1).x, point.y - result.at(-1).y) > 0.01) result.push({ ...point });
		return result;
	}, []);
	if (distinct.length < 2) throw new PathGeometryError('A path needs two different waypoints.');
	if (typeof closed !== 'boolean' || (closed && (distinct.length < 3
		|| Math.hypot(distinct[0].x - distinct.at(-1).x, distinct[0].y - distinct.at(-1).y) <= 0.01))) {
		throw new PathGeometryError('A closed path needs three waypoints without a duplicated seam.');
	}
	const tolerance = Math.max(0.25, Math.min(2, gridSize * 0.005));
	const flattened = curvedPoints(distinct, settings, tolerance, closed), curved = flattened.points;
	const points = meanderingPoints(curved, distinct, settings, gridSize, tolerance, closed);
	const segments = points.slice(1).map((point, index) => ({
		start: points[index], end: point, length: Math.hypot(point.x - points[index].x, point.y - points[index].y),
	}));
	const length = segments.reduce((total, segment) => total + segment.length, 0);
	if (length > PATH_LIMITS.length) throw new PathGeometryError('Path is too long. Finish a shorter section.');
	const distances = [0];
	for (const segment of segments) distances.push(distances.at(-1) + segment.length);
	const position = point => ({ x: point.x, y: point.y });
	return { basePoints: curved.map(position), points: points.map(position),
		segments: segments.map(segment => ({ ...segment, start: position(segment.start), end: position(segment.end) })), distances, length, tolerance,
		spans: settings.meander ? null : flattened.spans };
}

export function buildPathComponents(waypoints, options = {}, gridSize = 100, closed = false) {
	const settings = pathOptions(options);
	const { points, segments, length } = evaluatePathRoute(waypoints, settings, gridSize, closed);
	const width = settings.width * gridSize, alpha = settings.alpha;
	const make = (points, stroke, color, part, role = part) => ({
		role, data: line(points, stroke, color, alpha, `${settings.style}: ${part}`),
	});
	if (settings.style === 'plain') return [make(points, width, settings.color, 'path')];
	if (settings.style === 'road' || settings.style === 'river') {
		const river = settings.style === 'river';
		return [
			make(points, width + Math.max(2, gridSize * 0.04), river ? '#244e63' : '#594538', 'edge'),
			make(points, width, settings.color, 'surface'),
			...(river ? [make(points, Math.max(1, width * 0.06), '#b8dce3', 'current')] : []),
		];
	}
	const requestedSpacing = settings.spacing * gridSize;
	const sleepers = closed ? Math.max(1, Math.ceil(length / requestedSpacing)) : Math.floor((length + 0.000001) / requestedSpacing) + 1;
	const spacing = closed ? length / sleepers : requestedSpacing;
	if (sleepers + 2 > PATH_LIMITS.drawings) throw new PathGeometryError('Too many railway sleepers. Increase spacing or finish a shorter section.');
	const result = [];
	let travelled = 0, next = 0;
	for (const segment of segments) {
		const dx = (segment.end.x - segment.start.x) / segment.length;
		const dy = (segment.end.y - segment.start.y) / segment.length;
		while (next <= travelled + segment.length + 0.000001 && (!closed || result.length < sleepers)) {
			const distance = Math.max(0, next - travelled);
			const center = { x: segment.start.x + dx * distance, y: segment.start.y + dy * distance };
			const half = width * 0.75;
			result.push(make([{ x: center.x - dy * half, y: center.y + dx * half },
				{ x: center.x + dy * half, y: center.y - dx * half }], Math.max(2, gridSize * 0.08), '#74543a', 'sleeper'));
			next += spacing;
		}
		travelled += segment.length;
	}
	for (const [offset, role] of [[-width / 2, 'rail-left'], [width / 2, 'rail-right']]) {
		result.push(make(offsetPath(points, offset, closed), Math.max(2, gridSize * 0.045), settings.color, 'rail', role));
	}
	return result;
}

export function buildPathDrawings(waypoints, options = {}, gridSize = 100, closed = false) {
	return buildPathComponents(waypoints, options, gridSize, closed).map(component => component.data);
}
