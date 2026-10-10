function integer(value, name, min, max) {
	if (!Number.isSafeInteger(value) || value < min || value > max) {
		throw new RangeError(`Invalid ${name}.`);
	}
}

export function planDrawingRegions({
	width, height, resolution = 1, tileSize = 128,
	maxBytes = 16 * 1024 * 1024, reserveBytes = 0, maxAxis = 4096, maxTiles = 256,
}) {
	integer(width, 'viewport width', 1, 8192);
	integer(height, 'viewport height', 1, 8192);
	integer(tileSize, 'physical tile size', 32, 1024);
	integer(maxBytes, 'memory budget', 1, Number.MAX_SAFE_INTEGER);
	integer(reserveBytes, 'reserved memory', 0, maxBytes);
	integer(maxAxis, 'GPU axis limit', 1, 16384);
	integer(maxTiles, 'tile count limit', 1, 4096);
	if (!Number.isFinite(resolution) || resolution <= 0 || resolution > 4) {
		throw new RangeError('Invalid viewport resolution.');
	}
	const physicalWidth = Math.ceil(width * resolution), physicalHeight = Math.ceil(height * resolution);
	const columns = Math.ceil(physicalWidth / tileSize), rows = Math.ceil(physicalHeight / tileSize);
	const bytes = physicalWidth * physicalHeight * 4;
	if (Math.min(tileSize, physicalWidth) > maxAxis || Math.min(tileSize, physicalHeight) > maxAxis
		|| columns * rows > maxTiles || bytes + reserveBytes > maxBytes) {
		throw new RangeError('Drawing-region cache exceeds its GPU, tile or memory budget; use native rendering.');
	}
	const tiles = [];
	for (let y = 0; y < physicalHeight; y += tileSize) {
		for (let x = 0; x < physicalWidth; x += tileSize) {
			const w = Math.min(tileSize, physicalWidth - x), h = Math.min(tileSize, physicalHeight - y);
			tiles.push(Object.freeze({
				id: `${x}:${y}`, x: x / resolution, y: y / resolution,
				width: w / resolution, height: h / resolution, physicalWidth: w, physicalHeight: h,
				resolution, bytes: w * h * 4,
			}));
		}
	}
	return Object.freeze({ tiles: Object.freeze(tiles), bytes, reserveBytes, physicalWidth, physicalHeight });
}

function rectangle(rect) {
	if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
		|| rect.width < 0 || rect.height < 0
		|| !Number.isFinite(rect.x + rect.width) || !Number.isFinite(rect.y + rect.height)) {
		throw new RangeError('Invalid dirty screen bounds; invalidate the entire cache when bounds are unknown.');
	}
	return rect;
}

/** Merge adjacent dirty tiles without adding clean pixels; coordinates remain physical-pixel aligned. */
export function coalesceDrawingRegions(plan, dirtyIds) {
	if (!plan?.tiles || !Array.isArray(dirtyIds) || dirtyIds.length > plan.tiles.length) {
		throw new TypeError('A bounded tile plan and dirty ID list are required.');
	}
	const ids = new Set(dirtyIds), known = new Set(plan.tiles.map(tile => tile.id));
	if (ids.size !== dirtyIds.length || dirtyIds.some(id => !known.has(id))) {
		throw new Error('Dirty region IDs must be unique tiles from this plan.');
	}
	const rows = new Map();
	for (const tile of plan.tiles) {
		if (!ids.has(tile.id)) continue;
		const [x, y] = tile.id.split(':').map(Number);
		if (!rows.has(y)) rows.set(y, []);
		rows.get(y).push({ x, y, width: tile.physicalWidth, height: tile.physicalHeight,
			resolution: tile.resolution });
	}
	const regions = [], active = new Map();
	for (const [y, tiles] of rows) {
		const runs = [];
		for (const tile of tiles) {
			const last = runs.at(-1);
			if (last && last.x + last.width === tile.x && last.height === tile.height) last.width += tile.width;
			else runs.push({ ...tile });
		}
		const next = new Map();
		for (const run of runs) {
			const key = `${run.x}:${run.width}`;
			const previous = active.get(key);
			if (previous && previous.y + previous.height === y) {
				previous.height += run.height;
				next.set(key, previous);
			} else {
				regions.push(run);
				next.set(key, run);
			}
		}
		active.clear();
		for (const [key, run] of next) active.set(key, run);
	}
	return Object.freeze(regions.map(region => Object.freeze({
		x: region.x / region.resolution, y: region.y / region.resolution,
		width: region.width / region.resolution, height: region.height / region.resolution,
		physicalWidth: region.width, physicalHeight: region.height, resolution: region.resolution,
	})));
}

/** Detached, synchronous cache. Callers supply complete ordered pixels, not isolated blend-dependent layers. */
export class DrawingRegionCache {
	#plan;
	#allocate;
	#dispose;
	#entries = new Map();
	#dirty;
	#destroyed = false;
	#context = null;
	#busy = false;

	constructor(options, { allocate, dispose }) {
		if (typeof allocate !== 'function' || typeof dispose !== 'function') {
			throw new TypeError('Cache allocation and disposal callbacks are required.');
		}
		this.#plan = planDrawingRegions(options);
		this.#allocate = allocate;
		this.#dispose = dispose;
		this.#dirty = new Set(this.#plan.tiles.map(tile => tile.id));
	}

	get stats() {
		return {
			plannedBytes: this.#plan.bytes, reservedBytes: this.#plan.reserveBytes,
			residentBytes: [...this.#entries.values()].reduce((sum, entry) => sum + entry.tile.bytes, 0),
			residentTiles: this.#entries.size, dirtyTiles: this.#dirty.size,
			totalTiles: this.#plan.tiles.length, ready: !this.#destroyed && this.#dirty.size === 0,
		};
	}

	#check() {
		if (this.#destroyed) throw new Error('Drawing-region cache is disposed.');
		if (this.#busy) throw new Error('Drawing-region cache callbacks may not reenter the cache.');
	}

	setContext(key) {
		this.#check();
		if (typeof key !== 'string' || key.length < 1 || key.length > 4096) {
			throw new TypeError('A bounded explicit render-context key is required.');
		}
		if (key === this.#context) return false;
		this.#context = key;
		this.invalidateAll();
		return true;
	}

	invalidateAll() {
		this.#check();
		this.#dirty = new Set(this.#plan.tiles.map(tile => tile.id));
	}

	invalidate(bounds, padding = 0) {
		this.#check();
		if (!Array.isArray(bounds) || bounds.length > 2048
			|| !Number.isFinite(padding) || padding < 0 || padding > 8192) {
			throw new RangeError('Invalid dirty-region batch or effect padding.');
		}
		const regions = bounds.map(rectangle).map(rect => rectangle({
			x: rect.x - padding, y: rect.y - padding,
			width: rect.width + padding * 2, height: rect.height + padding * 2,
		}));
		for (const tile of this.#plan.tiles) {
			if (regions.some(rect => rect.width > 0 && rect.height > 0
				&& rect.x < tile.x + tile.width && rect.x + rect.width > tile.x
				&& rect.y < tile.y + tile.height && rect.y + rect.height > tile.y)) {
				this.#dirty.add(tile.id);
			}
		}
	}

	rebuild(renderTile) {
		this.#check();
		if (typeof renderTile !== 'function' || this.#context === null) {
			throw new TypeError('Set the render context and provide a synchronous tile renderer.');
		}
		this.#busy = true;
		let rebuilt = 0;
		try {
			for (const tile of this.#plan.tiles) {
				if (!this.#dirty.has(tile.id)) continue;
				let entry = this.#entries.get(tile.id);
				if (!entry) {
					const resource = this.#allocate(tile);
					if (!resource || typeof resource.then === 'function') {
						throw new TypeError('Tile allocation must return a synchronous resource.');
					}
					entry = { tile, resource };
					this.#entries.set(tile.id, entry);
				}
				const result = renderTile(entry.resource, tile);
				if (result && typeof result.then === 'function') {
					throw new TypeError('Tile rendering must be synchronous.');
				}
				this.#dirty.delete(tile.id);
				rebuilt++;
			}
			return rebuilt;
		} catch (error) {
			// No partially rebuilt frame may be replayed after a failed allocation/render.
			this.#dirty = new Set(this.#plan.tiles.map(tile => tile.id));
			throw error;
		} finally { this.#busy = false; }
	}

	replay(drawTile) {
		this.#check();
		if (this.#dirty.size || typeof drawTile !== 'function') {
			throw new Error('Drawing-region cache is not ready for replay; use native rendering.');
		}
		this.#busy = true;
		try {
			for (const { resource, tile } of this.#entries.values()) {
				const result = drawTile(resource, tile);
				if (result && typeof result.then === 'function') throw new TypeError('Tile replay must be synchronous.');
			}
		} finally { this.#busy = false; }
	}

	evict() {
		this.#check();
		const errors = [];
		for (const [id, { resource }] of this.#entries) {
			try {
				const result = this.#dispose(resource);
				if (result && typeof result.then === 'function') throw new TypeError('Tile disposal must be synchronous.');
			}
			catch (error) { errors.push(error); }
			this.#entries.delete(id);
		}
		this.invalidateAll();
		if (errors.length) throw new AggregateError(errors, 'Drawing-region cache disposal failed.');
	}

	destroy() {
		if (this.#destroyed) return;
		this.#check();
		try { this.evict(); }
		finally { this.#destroyed = true; }
	}
}
