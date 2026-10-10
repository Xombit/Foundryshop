/** Opt-in event/revision host. No render replacement, timers, settings or source mutation. */
export class DrawingCacheHost {
	#adapter;
	#capture;
	#revision = 0;
	#ready = null;
	#dirty = false;
	#preparing = null;
	#cleanup = null;
	#closed = false;
	#disposed = false;
	#error = null;
	#unsubscribers = [];

	constructor({ adapter, capture }) {
		if (!adapter || ['prepare', 'use', 'invalidate', 'destroy'].some(key => typeof adapter[key] !== 'function')
			|| typeof capture !== 'function') throw new TypeError('A cache adapter and synchronous snapshot capture are required.');
		this.#adapter = adapter;
		this.#capture = capture;
	}

	get stats() {
		return { revision: this.#revision, ready: Boolean(this.#ready) && !this.#closed && !this.#error,
			preparing: Boolean(this.#preparing), closed: this.#closed, disposed: this.#disposed,
			error: this.#error };
	}

	#check() {
		if (this.#closed) throw new Error('Drawing cache host is closed.');
	}

	#current(snapshot) {
		if (snapshot.isCurrent === undefined) return true;
		if (typeof snapshot.isCurrent !== 'function') throw new TypeError('Snapshot currentness guard must be a synchronous function.');
		const current = snapshot.isCurrent();
		if (typeof current !== 'boolean') throw new TypeError('Snapshot currentness guard must return a synchronous boolean.');
		return current;
	}

	invalidate() {
		this.#check();
		this.#revision++;
		this.#ready = null;
		this.#dirty = true;
		if (this.#preparing) return this.#preparing.then(() => undefined);
		return this.#flush();
	}

	#flush() {
		if (this.#cleanup) return this.#cleanup;
		this.#cleanup = Promise.resolve().then(() => {
			if (this.#dirty) {
				this.#adapter.invalidate();
				this.#dirty = false;
			}
		}).catch(error => {
			this.#error = error;
			throw error;
		}).finally(() => { this.#cleanup = null; });
		return this.#cleanup;
	}

	prepare() {
		this.#check();
		if (this.#preparing) return this.#preparing;
		this.#ready = null;
		this.#preparing = Promise.resolve().then(async () => {
			try {
				for (let attempt = 0; attempt < 4; attempt++) {
					await this.#flush();
					if (this.#closed) throw new Error('Drawing cache host closed during preparation.');
					const revision = this.#revision;
					const snapshot = this.#capture();
					if (!snapshot || typeof snapshot.then === 'function') throw new TypeError('Snapshot capture must be synchronous.');
					if (!this.#current(snapshot)) {
						this.#dirty = true;
						continue;
					}
					const result = await this.#adapter.prepare(snapshot.stack, snapshot.artwork,
						snapshot.options, snapshot.context, snapshot.textures);
					const current = this.#closed || revision !== this.#revision ? false : this.#current(snapshot);
					if (!current || this.#closed || revision !== this.#revision) {
						this.#dirty = true;
						continue;
					}
					this.#error = null;
					if (result.strategy === 'candidate') this.#ready = { revision, key: result.sourceKey, isCurrent: snapshot.isCurrent };
					return result;
				}
				throw new Error('Drawing cache changed repeatedly during preparation; use native rendering and retry later.');
			} catch (failure) {
				this.#ready = null;
				this.#dirty = true;
				this.#error = failure;
				try { await this.#flush(); }
				catch (cleanup) {
					this.#error = new AggregateError([failure, cleanup], 'Cache host preparation and cleanup failed.');
					throw this.#error;
				}
				throw failure;
			}
		}).finally(() => { this.#preparing = null; });
		return this.#preparing;
	}

	use(callback) {
		this.#check();
		if (!this.#ready || this.#dirty || this.#error || this.#preparing
			|| this.#ready.revision !== this.#revision) throw new Error('Cache host has no current frame; use native rendering.');
		try {
			const ready = this.#ready;
			if (!this.#current(ready) || this.#ready !== ready || ready.revision !== this.#revision || this.#closed) {
				throw new Error('Native cache snapshot changed; use native rendering and reprepare.');
			}
			return this.#adapter.use(this.#ready.key, callback);
		} catch (error) {
			this.#ready = null;
			this.#dirty = true;
			this.#error = error;
			throw error;
		}
	}

	bind({ hooks, sceneId, reportError, fonts, contextTarget, assets = [] }) {
		this.#check();
		if (this.#unsubscribers.length) throw new Error('Cache host events are already bound.');
		if (!hooks || typeof hooks.on !== 'function' || typeof hooks.off !== 'function'
			|| typeof sceneId !== 'function' || typeof reportError !== 'function'
			|| !Array.isArray(assets) || assets.length > 16 || new Set(assets).size !== assets.length
			|| assets.some(asset => !asset || typeof asset.on !== 'function' || typeof asset.off !== 'function')) {
			throw new TypeError('Explicit hook provider, displayed Scene lookup and error reporter are required.');
		}
		const report = promise => { promise.catch(reportError); };
		const invalidate = () => report(this.invalidate());
		const scoped = value => {
			const document = value?.document ?? value;
			const id = document?.documentName === 'Scene' ? document.id : document?.parent?.id;
			if (id === sceneId()) invalidate();
		};
		const add = (name, callback) => {
			const id = hooks.on(name, callback);
			this.#unsubscribers.push(() => hooks.off(name, id));
		};
		try {
			for (const name of ['createDrawing', 'updateDrawing', 'deleteDrawing', 'drawDrawing',
				'refreshDrawing', 'controlDrawing', 'updateScene', 'updateLevel']) add(name, scoped);
			for (const name of ['canvasReady', 'canvasPan', 'foundryshopLayersChanged']) add(name, invalidate);
			add('canvasTearDown', () => report(this.destroy()));
			for (const [target, event] of [[fonts, 'loadingdone'], [fonts, 'loadingerror'],
				[contextTarget, 'webglcontextlost'], [contextTarget, 'webglcontextrestored']]) {
				if (!target) continue;
				target.addEventListener(event, invalidate);
				this.#unsubscribers.push(() => target.removeEventListener(event, invalidate));
			}
			for (const asset of assets) {
				for (const event of ['update', 'error', 'dispose']) {
					asset.on(event, invalidate);
					this.#unsubscribers.push(() => asset.off(event, invalidate));
				}
			}
		} catch (error) {
			try { this.#unbind(); }
			catch (cleanup) { throw new AggregateError([error, cleanup], 'Cache host binding and cleanup failed.'); }
			throw error;
		}
	}

	#unbind() {
		const errors = [];
		for (const off of this.#unsubscribers.splice(0)) {
			try { off(); } catch (error) { errors.push(error); this.#unsubscribers.push(off); }
		}
		if (errors.length) throw new AggregateError(errors, 'Cache host event removal failed.');
	}

	async destroy() {
		if (this.#disposed && !this.#unsubscribers.length) return;
		this.#closed = true;
		this.#ready = null;
		this.#revision++;
		const errors = [];
		try { this.#unbind(); } catch (error) { errors.push(error); }
		if (this.#preparing) {
			try { await this.#preparing; } catch (error) { errors.push(error); }
		}
		if (this.#cleanup) {
			try { await this.#cleanup; } catch (error) { errors.push(error); }
		}
		try { if (!this.#disposed) this.#adapter.destroy(); this.#disposed = true; }
		catch (error) { errors.push(error); }
		if (errors.length) {
			this.#error = new AggregateError(errors, 'Cache host teardown failed.');
			throw this.#error;
		}
	}
}
