import { admitDrawingCacheStack, DrawingCacheBudget } from './render_cache_admission.js';

function synchronous(result, operation) {
	if (result && typeof result.then === 'function') throw new TypeError(`${operation} must be synchronous.`);
	return result;
}

/** Independent derived resources only. This service never attaches to or suppresses native shapes. */
export class DrawingRunCache {
	#budget;
	#allocate;
	#dispose;
	#entries = [];
	#lease = null;
	#signature = null;
	#key = null;
	#ready = false;
	#busy = false;
	#destroyed = false;
	#admission = null;

	constructor({ budget, allocate, dispose }) {
		if (!(budget instanceof DrawingCacheBudget) || typeof allocate !== 'function' || typeof dispose !== 'function') {
			throw new TypeError('A shared DrawingCacheBudget and synchronous resource callbacks are required.');
		}
		this.#budget = budget;
		this.#allocate = allocate;
		this.#dispose = dispose;
	}

	get stats() {
		return { resources: this.#entries.length, ready: this.#ready && !this.#destroyed,
			reservedBytes: this.#lease ? this.#admission.totalBytes : 0, destroyed: this.#destroyed };
	}

	#check() {
		if (this.#destroyed) throw new Error('Drawing run cache is disposed.');
		if (this.#busy) throw new Error('Drawing run cache callbacks may not reenter.');
	}

	#clear() {
		this.#ready = false;
		this.#signature = null;
		this.#key = null;
		const retained = [], errors = [];
		for (const entry of this.#entries) {
			try { synchronous(this.#dispose(entry.resource), 'Run disposal'); }
			catch (error) { retained.push(entry); errors.push(error); }
		}
		this.#entries = retained;
		if (!retained.length && this.#lease) {
			this.#budget.release(this.#lease);
			this.#lease = null;
			this.#admission = null;
		}
		if (errors.length) throw new AggregateError(errors, 'Run resources failed disposal; reservation retained for retry.');
	}

	prepare(stack, options, sourceKey) {
		this.#check();
		const previouslyReady = this.#ready;
		this.#ready = false;
		this.#busy = true;
		try {
			if (typeof sourceKey !== 'string' || !sourceKey || sourceKey.length > 4096) {
				throw new TypeError('A bounded source/context fingerprint is required.');
			}
			const admission = admitDrawingCacheStack(stack, options);
			const signature = JSON.stringify({ stack, options, sourceKey });
			if (admission.strategy === 'candidate' && signature === this.#signature) {
				this.#ready = previouslyReady;
				return Object.freeze({ strategy: 'candidate', reused: true, runs: admission.runs });
			}
			this.#clear();
			if (admission.strategy !== 'candidate') return admission;
			this.#lease = this.#budget.reserve(admission.totalBytes);
			this.#admission = admission;
			try {
				for (const run of admission.runs) {
					const resource = synchronous(this.#allocate(run, Object.freeze({ ...options })), 'Run allocation');
					if (!resource) throw new TypeError('Run allocation must return an owned resource.');
					this.#entries.push({ run, resource });
				}
				this.#signature = signature;
				this.#key = sourceKey;
				return Object.freeze({ strategy: 'candidate', reused: false, runs: admission.runs });
			} catch (failure) {
				try { this.#clear(); }
				catch (cleanup) { throw new AggregateError([failure, cleanup], 'Run allocation and cleanup failed.'); }
				throw failure;
			}
		} finally { this.#busy = false; }
	}

	rebuild(render) {
		this.#check();
		this.#ready = false;
		if (!this.#signature || typeof render !== 'function') throw new Error('Prepare an admitted cache before rebuilding.');
		this.#busy = true;
		try {
			for (const { run, resource } of this.#entries) synchronous(render(resource, run), 'Run rendering');
			this.#ready = true;
		} finally { this.#busy = false; }
	}

	use(sourceKey, callback) {
		this.#check();
		if (sourceKey !== this.#key) this.#ready = false;
		if (!this.#ready || typeof callback !== 'function') throw new Error('Stale or unfinished run cache; use native rendering.');
		this.#busy = true;
		try {
			return synchronous(callback(Object.freeze(this.#entries.map(entry => Object.freeze({ ...entry })))), 'Run replay');
		} catch (error) {
			this.#ready = false;
			throw error;
		} finally { this.#busy = false; }
	}

	evict() {
		this.#check();
		this.#busy = true;
		try { this.#clear(); }
		finally { this.#busy = false; }
	}

	destroy() {
		if (this.#destroyed) return;
		this.evict();
		this.#destroyed = true;
	}
}
