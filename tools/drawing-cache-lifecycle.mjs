import { IncrementalDrawingIndex } from './drawing-spatial-index.mjs';
import { coalesceDrawingRegions } from './drawing-region-cache.mjs';

function boundedKey(value, name) {
	if (typeof value !== 'string' || !value || value.length > 4096) throw new TypeError(`Invalid ${name}.`);
}

function snapshotRecords(records) {
	if (!Array.isArray(records) || records.length > 1000) throw new RangeError('Invalid lifecycle snapshot size.');
	return records.map(record => {
		boundedKey(record?.signature, 'artwork signature');
		if (typeof record.editing !== 'boolean') throw new TypeError('Explicit editing state is required.');
		return { id: record.id, signature: record.signature, editing: record.editing, bounds: { ...record.bounds } };
	});
}

function changed(a, b) {
	return a.signature !== b.signature || a.editing !== b.editing
		|| ['x', 'y', 'width', 'height'].some(key => a.bounds[key] !== b.bounds[key]);
}

/** Detached lifecycle state only. The host must provide complete ordered snapshots and native fallback. */
export class DrawingCacheLifecycle {
	#options;
	#limits;
	#index = null;
	#records = [];
	#context = null;
	#dirty = new Set();
	#revision = 0;
	#blocked = true;
	#editing = false;
	#destroyed = false;
	#issuedRevision = null;

	constructor(options, limits = {}) {
		// Validate the entire budget before accepting a source snapshot.
		new IncrementalDrawingIndex([], options, limits);
		this.#options = { ...options };
		this.#limits = { ...limits };
	}

	#check() {
		if (this.#destroyed) throw new Error('Drawing cache lifecycle is disposed.');
	}

	get stats() {
		return {
			revision: this.#revision, objects: this.#records.length, dirtyTiles: this.#dirty.size,
			ready: !this.#destroyed && !this.#blocked && !this.#editing && this.#dirty.size === 0,
			blocked: this.#blocked, editing: this.#editing,
		};
	}

	synchronize(records, context) {
		this.#check();
		try {
			boundedKey(context, 'render context');
			const next = snapshotRecords(records);
			const structural = !this.#index || next.length !== this.#records.length
				|| next.some((record, i) => record.id !== this.#records[i].id);
			const reset = structural || context !== this.#context || this.#blocked;
			let dirty;
			if (reset) {
				const index = new IncrementalDrawingIndex(next, this.#options, this.#limits);
				this.#index = index;
				dirty = index.plan.tiles.map(tile => tile.id);
			} else {
				const updates = next.filter((record, i) => changed(this.#records[i], record));
				dirty = this.#index.updateBounds(updates);
			}
			const hasChange = reset || dirty.length > 0 || next.some((record, i) =>
				!this.#records[i] || changed(this.#records[i], record));
			if (hasChange) this.#revision++;
			if (hasChange) this.#issuedRevision = null;
			for (const id of dirty) this.#dirty.add(id);
			this.#records = next;
			this.#context = context;
			this.#editing = next.some(record => record.editing);
			this.#blocked = false;
			return Object.freeze({ revision: this.#revision, reset, dirtyTiles: Object.freeze([...dirty]),
				fallback: this.#editing ? 'native-editing' : null });
		} catch (error) {
			this.#blocked = true;
			this.#issuedRevision = null;
			this.#revision++;
			if (this.#index) this.#dirty = new Set(this.#index.plan.tiles.map(tile => tile.id));
			throw error;
		}
	}

	frame() {
		this.#check();
		if (this.#blocked || this.#editing || !this.#index) {
			throw new Error('Lifecycle requires native fallback until a valid nonediting snapshot is synchronized.');
		}
		const dirty = this.#index.plan.tiles.filter(tile => this.#dirty.has(tile.id));
		this.#issuedRevision = this.#revision;
		return Object.freeze({
			revision: this.#revision,
			tiles: Object.freeze(dirty.map(tile => Object.freeze({ ...tile, candidates: this.#index.query(tile.id) }))),
		});
	}

	acknowledge(revision) {
		this.#check();
		if (revision !== this.#revision || revision !== this.#issuedRevision
			|| this.#blocked || this.#editing || !this.#index) {
			throw new Error('Stale or blocked cache frame cannot be published.');
		}
		this.#dirty.clear();
		this.#issuedRevision = null;
	}

	invalidate() {
		this.#check();
		this.#revision++;
		this.#issuedRevision = null;
		if (this.#index) this.#dirty = new Set(this.#index.plan.tiles.map(tile => tile.id));
	}

	destroy() {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#index = null;
		this.#records = [];
		this.#dirty.clear();
	}
}

/** Sequential scratch reuse; all cached tiles/output remain resident during the regional rebuild. */
export function admitCoalescedScratch(plan, dirtyIds, { maxBytes, maxAxis = 4096 }) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1
		|| !Number.isSafeInteger(maxAxis) || maxAxis < 1 || maxAxis > 16384) {
		throw new RangeError('Invalid coalesced scratch budget.');
	}
	const regions = coalesceDrawingRegions(plan, dirtyIds);
	const residentBytes = plan.bytes + plan.reserveBytes;
	const scratchBytes = regions.reduce((max, region) =>
		Math.max(max, region.physicalWidth * region.physicalHeight * 4), 0);
	if (residentBytes > maxBytes) throw new RangeError('Existing cache residency exceeds the total memory budget.');
	const oversized = regions.some(region => region.physicalWidth > maxAxis || region.physicalHeight > maxAxis);
	return Object.freeze({
		strategy: oversized || residentBytes + scratchBytes > maxBytes ? 'tiles' : 'coalesced',
		regions, scratchBytes, residentBytes, peakBytes: residentBytes + scratchBytes,
		reason: oversized ? 'Coalesced region exceeds GPU axis limit.'
			: residentBytes + scratchBytes > maxBytes ? 'Coalesced scratch exceeds total residency budget.'
				: 'Sequential coalesced scratch fits the explicit total budget.',
	});
}
