import { planDrawingRegions } from './drawing-region-cache.mjs';

function validBounds(bounds) {
	if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
		|| bounds.width < 0 || bounds.height < 0
		|| !Number.isFinite(bounds.x + bounds.width) || !Number.isFinite(bounds.y + bounds.height)) {
		throw new RangeError('Invalid candidate screen bounds; use uncached rendering.');
	}
}

/** Snapshot order is authoritative. Recreate after bounds, order, visibility or context changes. */
export function indexDrawingCandidates(records, options, { padding = 2, maxReferences = 65536 } = {}) {
	const plan = planDrawingRegions(options);
	if (!Array.isArray(records) || records.length > 1000 || !Number.isFinite(padding)
		|| padding < 0 || padding > 128 || !Number.isSafeInteger(maxReferences)
		|| maxReferences < 1 || maxReferences > 65536) {
		throw new RangeError('Spatial candidate limits exceeded.');
	}
	const ids = new Set();
	const snapshots = records.map(record => {
		if (!record || typeof record.id !== 'string' || !record.id || record.id.length > 128 || ids.has(record.id)) {
			throw new TypeError('Candidate IDs must be unique bounded strings.');
		}
		ids.add(record.id);
		validBounds(record.bounds);
		const bounds = {
			x: record.bounds.x - padding, y: record.bounds.y - padding,
			width: record.bounds.width + padding * 2, height: record.bounds.height + padding * 2,
		};
		validBounds(bounds);
		return { id: record.id, bounds };
	});
	let references = 0;
	const candidates = new Map();
	for (const tile of plan.tiles) {
		const members = [];
		for (const { id, bounds } of snapshots) {
			if (bounds.width > 0 && bounds.height > 0
				&& bounds.x < tile.x + tile.width && bounds.x + bounds.width > tile.x
				&& bounds.y < tile.y + tile.height && bounds.y + bounds.height > tile.y) {
				if (++references > maxReferences) throw new RangeError('Spatial reference budget exceeded; use uncached rendering.');
				members.push(id);
			}
		}
		candidates.set(tile.id, Object.freeze(members));
	}
	return Object.freeze({
		plan, references, objects: records.length,
		query(id) {
			if (!candidates.has(id)) throw new Error('Unknown spatial tile.');
			return candidates.get(id);
		},
	});
}

/** Bounds-only updates retain identity/order. Structural/context changes require a fresh index. */
export class IncrementalDrawingIndex {
	#options;
	#limits;
	#members;
	#recordTiles = new Map();
	#rank = new Map();
	#references;
	#plan;

	constructor(records, options, limits = {}) {
		const snapshot = indexDrawingCandidates(records, options, limits);
		this.#options = { ...options };
		this.#limits = { padding: 2, maxReferences: 65536, ...limits };
		this.#plan = snapshot.plan;
		this.#references = snapshot.references;
		this.#members = new Map(snapshot.plan.tiles.map(tile => [tile.id, snapshot.query(tile.id)]));
		for (let i = 0; i < records.length; i++) {
			this.#rank.set(records[i].id, i);
			this.#recordTiles.set(records[i].id, new Set());
		}
		for (const [tileId, members] of this.#members) {
			for (const id of members) this.#recordTiles.get(id).add(tileId);
		}
	}

	get plan() { return this.#plan; }
	get references() { return this.#references; }
	query(id) {
		if (!this.#members.has(id)) throw new Error('Unknown spatial tile.');
		return this.#members.get(id);
	}

	updateBounds(updates) {
		if (!Array.isArray(updates) || updates.length > 1000) throw new RangeError('Invalid incremental bounds batch.');
		const seen = new Set(), nextTiles = new Map(), dirty = new Set();
		let references = this.#references;
		for (const record of updates) {
			if (!record || !this.#rank.has(record.id) || seen.has(record.id)) {
				throw new Error('Bounds updates require unique existing IDs; rebuild after structural changes.');
			}
			seen.add(record.id);
			const snapshot = indexDrawingCandidates([record], this.#options, this.#limits);
			const tiles = new Set(snapshot.plan.tiles.filter(tile => snapshot.query(tile.id).length).map(tile => tile.id));
			const previous = this.#recordTiles.get(record.id);
			references += tiles.size - previous.size;
			for (const id of previous) dirty.add(id);
			for (const id of tiles) dirty.add(id);
			nextTiles.set(record.id, tiles);
		}
		if (references > this.#limits.maxReferences) {
			throw new RangeError('Incremental reference budget exceeded; use uncached rendering.');
		}
		const nextMembers = new Map();
		for (const tileId of dirty) {
			const members = this.#members.get(tileId).filter(id => !seen.has(id));
			for (const [id, tiles] of nextTiles) if (tiles.has(tileId)) members.push(id);
			members.sort((a, b) => this.#rank.get(a) - this.#rank.get(b));
			nextMembers.set(tileId, Object.freeze(members));
		}
		for (const [id, tiles] of nextTiles) this.#recordTiles.set(id, tiles);
		for (const [id, members] of nextMembers) this.#members.set(id, members);
		this.#references = references;
		return Object.freeze(this.#plan.tiles.filter(tile => dirty.has(tile.id)).map(tile => tile.id));
	}
}

/** Only detached owned fixtures may use temporary render suppression. Never use on live canvas shapes. */
export function detachedDrawingCandidates(root, options) {
	if (root.parent || root.inPrimary) throw new Error('Spatial fixture root must be detached.');
	const objects = [...root.children], stack = [root];
	let visited = 0;
	while (stack.length) {
		const object = stack.pop();
		if (++visited > 4096) throw new RangeError('Detached display-tree limit exceeded.');
		if (object.mask || object.filters?.length || object.cacheAsBitmap
			|| (object.blendMode != null && object.blendMode !== 0)) {
			throw new Error('Masks, filters, bitmap caches and non-normal blends require uncached rendering.');
		}
		stack.push(...(object.children ?? []));
	}
	const index = indexDrawingCandidates(objects.map((object, i) => {
		const bounds = object.getBounds();
		return { id: String(i), bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
	}), options, { padding: 2 / (options.resolution ?? 1) });
	let busy = false;
	return Object.freeze({
		index,
		renderTile(id, render) {
			if (busy) throw new Error('Spatial rendering may not reenter.');
			if (root.parent || root.children.length !== objects.length
				|| objects.some((object, i) => root.children[i] !== object)) {
				throw new Error('Spatial snapshot is stale; rebuild after membership or order changes.');
			}
			if (typeof render !== 'function') throw new TypeError('A synchronous render callback is required.');
			const members = new Set(index.query(id));
			const states = objects.map(object => object.renderable);
			busy = true;
			try {
				for (let i = 0; i < objects.length; i++) objects[i].renderable = states[i] && members.has(String(i));
				const result = render();
				if (result && typeof result.then === 'function') throw new TypeError('Spatial rendering must be synchronous.');
				return members.size;
			} finally {
				for (let i = 0; i < objects.length; i++) objects[i].renderable = states[i];
				busy = false;
			}
		},
	});
}

/** Conservative developer gate. Timings must include every cost of the compared rebuild paths. */
export function chooseMeasuredDrawingRebuild(samples) {
	const names = ['viewport', 'fullRootDirty', 'spatialDirty'];
	const summary = {};
	for (const name of names) {
		const values = samples?.[name];
		if (!Array.isArray(values) || values.length < 7 || values.length > 64
			|| values.some(value => !Number.isFinite(value) || value <= 0)) {
			throw new RangeError('Each rebuild strategy needs 7-64 positive measured samples.');
		}
		const sorted = [...values].sort((a, b) => a - b);
		summary[name] = {
			min: sorted[0], max: sorted.at(-1),
			median: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
		};
	}
	const admitted = names.slice(1).filter(name => summary[name].max * 1.1 < summary.viewport.min);
	admitted.sort((a, b) => summary[a].max - summary[b].max);
	return {
		strategy: admitted[0] ?? 'viewport', summary,
		reason: admitted.length ? 'Measured regional worst case clears viewport best case with 10% headroom.'
			: 'No measured regional path clears the conservative margin; keep viewport rendering.',
	};
}
