/** Input must include all native-sorted objects, not just managed Drawings. */
export function planDrawingCacheRuns(stack, { minDrawings = 2, maxRuns = 32 } = {}) {
	if (!Array.isArray(stack) || stack.length > 4096 || !Number.isInteger(minDrawings)
		|| minDrawings < 1 || minDrawings > 1000 || !Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 256) {
		throw new RangeError('Invalid ordered cache-run limits.');
	}
	const ids = new Set(), runs = [];
	let current = null;
	const finish = () => {
		if (current?.ids.length >= minDrawings) {
			if (runs.length >= maxRuns) throw new RangeError('Ordered cache-run limit exceeded; use native rendering.');
			runs.push(Object.freeze({ ...current, ids: Object.freeze(current.ids) }));
		}
		current = null;
	};
	for (let i = 0; i < stack.length; i++) {
		const entry = stack[i];
		if (!entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > 128 || ids.has(entry.id)
			|| ![entry.elevation, entry.sortLayer, entry.sort, entry.zIndex].every(value =>
				entry.kind === 'drawing' ? Number.isFinite(value) : typeof value === 'number' && !Number.isNaN(value))
			|| typeof entry.interface !== 'boolean' || typeof entry.cacheable !== 'boolean'
			|| typeof entry.editing !== 'boolean' || typeof entry.depth !== 'boolean') {
			throw new TypeError('Ordered stack requires unique IDs and explicit compatibility metadata.');
		}
		ids.add(entry.id);
		const eligible = entry.kind === 'drawing' && entry.cacheable && !entry.editing && !entry.depth;
		const key = `${entry.elevation}:${entry.sortLayer}:${entry.interface}`;
		if (!eligible || current?.key !== key) finish();
		if (!eligible) continue;
		if (!current) current = {
			key, start: i, elevation: entry.elevation, sortLayer: entry.sortLayer,
			sort: entry.sort, zIndex: entry.zIndex, interface: entry.interface, ids: [],
		};
		current.ids.push(entry.id);
	}
	finish();
	return Object.freeze(runs);
}

/** Admission only; no display objects, allocations, hooks or native suppression. */
export function admitDrawingCacheStack(stack, {
	width, height, resolution, maxBytes, reserveBytes = 0, scratchBytes = 0,
	maxAxis, maxRuns = 32, minDrawings = 2,
}) {
	for (const [name, value, minimum] of [
		['width', width, 1], ['height', height, 1], ['maxBytes', maxBytes, 1],
		['reserveBytes', reserveBytes, 0], ['scratchBytes', scratchBytes, 0], ['maxAxis', maxAxis, 1],
	]) {
		if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`Invalid cache ${name}.`);
	}
	if (!Number.isFinite(resolution) || resolution <= 0 || resolution > 4) {
		throw new RangeError('Invalid cache resolution.');
	}
	const runs = planDrawingCacheRuns(stack, { minDrawings, maxRuns });
	for (let i = 1; i < stack.length; i++) {
		const previous = stack[i - 1], current = stack[i];
		const comparison = previous.elevation - current.elevation || previous.sortLayer - current.sortLayer
			|| previous.sort - current.sort || previous.zIndex - current.zIndex;
		if (comparison > 0) throw new Error('Cache admission requires a complete native-sorted stack.');
	}
	const physicalWidth = Math.ceil(width * resolution), physicalHeight = Math.ceil(height * resolution);
	const perRunBytes = physicalWidth * physicalHeight * 4;
	const totalBytes = reserveBytes + scratchBytes + perRunBytes * runs.length;
	if (![physicalWidth, physicalHeight, perRunBytes, totalBytes].every(Number.isSafeInteger)) {
		throw new RangeError('Cache budget arithmetic exceeds safe integer limits.');
	}
	const reject = reason => Object.freeze({
		strategy: 'native', reason, runs: Object.freeze([]), candidateRuns: runs.length,
		perRunBytes, totalBytes, physicalWidth, physicalHeight,
	});
	if (stack.some(entry => entry.kind === 'drawing' && entry.editing)) return reject('editing');
	if (runs.some(run => run.interface)) return reject('interface-unverified');
	if (new Set(runs.map(run => run.elevation)).size > 1) return reject('mixed-elevation-unverified');
	if (!runs.length) return reject('no-compatible-runs');
	if (physicalWidth > maxAxis || physicalHeight > maxAxis) return reject('gpu-axis');
	if (totalBytes > maxBytes) return reject('aggregate-memory');
	return Object.freeze({
		strategy: 'candidate', reason: 'requires-renderer-and-performance-validation', runs,
		candidateRuns: runs.length, perRunBytes, totalBytes, physicalWidth, physicalHeight,
	});
}

/** Account before allocating; release only after owned GPU resources have actually been disposed. */
export class DrawingCacheBudget {
	#limit;
	#leases = new Map();
	#bytes = 0;
	constructor(maxBytes) {
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('Invalid aggregate cache budget.');
		this.#limit = maxBytes;
	}
	get stats() { return { limitBytes: this.#limit, reservedBytes: this.#bytes, reservations: this.#leases.size }; }
	reserve(bytes) {
		if (!Number.isSafeInteger(bytes) || bytes < 1) throw new RangeError('Invalid cache reservation.');
		if (this.#leases.size >= 256) throw new RangeError('Cache reservation count exceeded; use native rendering.');
		if (bytes > this.#limit - this.#bytes) throw new RangeError('Aggregate cache memory exhausted; use native rendering.');
		const lease = Object.freeze({});
		this.#leases.set(lease, bytes);
		this.#bytes += bytes;
		return lease;
	}

	release(lease) {
		if (!this.#leases.has(lease)) throw new Error('Unknown or already released cache reservation.');
		this.#bytes -= this.#leases.get(lease);
		this.#leases.delete(lease);
	}
}

/** Read-only primary metadata capture; unknown/custom objects remain uncached barriers. */
export function capturePrimaryDrawingCacheStack(primary, GraphicsClass) {
	if (!primary || !Array.isArray(primary.children) || primary.children.length > 4096
		|| typeof GraphicsClass !== 'function') throw new TypeError('Invalid native primary cache snapshot.');
	if (primary.sortDirty) throw new Error('Primary stack is not sorted yet; defer cache admission.');
	return primary.children.map((object, i) => {
		const drawing = object.object;
		const isDrawing = Boolean(object.constructor === GraphicsClass && drawing?.document?.documentName === 'Drawing'
			&& drawing.shape === object && object.parent === primary);
		let cacheable = isDrawing;
		const descendants = isDrawing ? [object] : [];
		let visited = 0;
		while (descendants.length) {
			const child = descendants.pop();
			if (++visited > 4096) throw new RangeError('Primary Drawing display-tree limit exceeded.');
			if (child.filters?.length || child.mask || child.cacheAsBitmap
				|| (child.blendMode != null && child.blendMode !== 0)) cacheable = false;
			descendants.push(...(child.children ?? []));
		}
		return Object.freeze({
			id: `slot:${i}`, kind: isDrawing ? 'drawing' : 'barrier',
			cacheable, editing: isDrawing && Boolean(drawing.controlled || drawing._original || drawing.isPreview),
			depth: Boolean(object.shouldRenderDepth), interface: Boolean(isDrawing && drawing.document.interface),
			elevation: object.elevation ?? 0, sortLayer: object.sortLayer ?? 0,
			sort: object.sort ?? 0, zIndex: object.zIndex ?? 0,
		});
	});
}
