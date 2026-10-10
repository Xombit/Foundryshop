import { validateProjectPackage, canonicalJson } from './project_package.js';

function segment(entry) {
	const d = entry.data, p = d.shape.points;
	if (d.shape.type !== 'p' || p.length !== 4) return { reason: 'not-a-two-point-line' };
	if (d.bezierFactor !== 0 || d.rotation !== 0) return { reason: 'smoothing-or-rotation' };
	if (d.fillType !== 0 || d.strokeAlpha !== 1 || d.strokeWidth <= 0 || d.texture || d.text) {
		return { reason: 'unsupported-style' };
	}
	if (d.hidden || d.locked || d.interface || d.levels.length !== 1) return { reason: 'unsupported-context' };
	if (Object.keys(d.flags).length || d.name) return { reason: 'source-metadata' };
	const a = [d.x + p[0], d.y + p[1]], b = [d.x + p[2], d.y + p[3]];
	if (a[0] === b[0] && a[1] === b[1]) return { reason: 'zero-length' };
	return { a, b, key: canonicalJson({
		layer: entry.layerId, level: d.levels[0], elevation: d.elevation,
		color: d.strokeColor, width: d.strokeWidth,
	}) };
}

const equal = (a, b) => a[0] === b[0] && a[1] === b[1];
function join(first, next) {
	let a, meeting, b;
	if (equal(first.b, next.a)) [a, meeting, b] = [first.a, first.b, next.b];
	else if (equal(first.b, next.b)) [a, meeting, b] = [first.a, first.b, next.a];
	else if (equal(first.a, next.a)) [a, meeting, b] = [first.b, first.a, next.b];
	else if (equal(first.a, next.b)) [a, meeting, b] = [first.b, first.a, next.a];
	else return null;
	const u = [meeting[0] - a[0], meeting[1] - a[1]], v = [b[0] - meeting[0], b[1] - meeting[1]];
	// Exact arithmetic only: no snapping, corner rounding, tolerance or overlapping/backtracking paths.
	if (u[0] * v[1] !== u[1] * v[0] || u[0] * v[0] + u[1] * v[1] <= 0) return null;
	return { a, b, key: first.key };
}

/** Analysis only. Complete native order must include null barriers; output is not a deletion/commit plan. */
export function analyseStraightLineConsolidation(input, orderedIds, selectedIds) {
	const project = validateProjectPackage(input);
	if (project.drawings.length > 1000 || !Array.isArray(orderedIds) || orderedIds.length > 4096
		|| !Array.isArray(selectedIds) || !selectedIds.length || selectedIds.length > 1000) {
		throw new RangeError('Line analysis exceeds bounded selection/stack limits.');
	}
	const byId = new Map(project.drawings.map(e => [e.id, e])), selected = new Set(selectedIds);
	const ids = orderedIds.filter(id => id !== null);
	if (ids.length !== byId.size || ids.some(id => typeof id !== 'string' || !byId.has(id)) || new Set(ids).size !== ids.length
		|| selected.size !== selectedIds.length || selectedIds.some(id => !byId.has(id) || !ids.includes(id))) {
		throw new Error('Line analysis requires unique selected identities in an explicit complete ordered stack.');
	}
	const candidates = [], skipped = [], eligible = new Set();
	let current = null;
	const finish = () => {
		if (current?.ids.length > 1) {
			const data = structuredClone(byId.get(current.ids[0]).data);
			const x = Math.min(current.a[0], current.b[0]), y = Math.min(current.a[1], current.b[1]);
			data.x = x; data.y = y;
			data.shape = { type: 'p', width: Math.abs(current.b[0] - current.a[0]),
				height: Math.abs(current.b[1] - current.a[1]), radius: null,
				points: [current.a[0] - x, current.a[1] - y, current.b[0] - x, current.b[1] - y] };
			candidates.push({ sourceIds: [...current.ids], layerId: byId.get(current.ids[0]).layerId, data });
		}
		current = null;
	};
	for (const id of orderedIds) {
		if (id === null || !selected.has(id)) { finish(); continue; }
		const line = segment(byId.get(id));
		if (line.reason) { finish(); skipped.push({ id, reason: line.reason }); continue; }
		eligible.add(id);
		const combined = current?.key === line.key ? join(current, line) : null;
		if (combined) current = { ...combined, ids: [...current.ids, id] };
		else { finish(); current = { ...line, ids: [id] }; }
	}
	finish();
	const grouped = new Set(candidates.flatMap(c => c.sourceIds));
	for (const id of eligible) if (!grouped.has(id)) skipped.push({ id, reason: 'no-consecutive-compatible-connection' });
	const reduction = candidates.reduce((sum, c) => sum + c.sourceIds.length - 1, 0);
	return {
		strategy: 'analysis-only', selected: selected.size, candidates, skipped,
		potentialDocumentReduction: reduction, potentialRemaining: selected.size - reduction,
		disclosure: 'Requires native pixel validation and durable original recovery before any Scene replacement. No snapping, curves, corners, metadata, translucent strokes or disconnected joins.',
	};
}
