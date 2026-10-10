import { prepareArtworkSnapshot, buildArtworkDisplay } from './artwork_renderer.js';
import { DrawingRunCache } from './render_run_cache.js';
import { admitDrawingCacheStack } from './render_cache_admission.js';
import { drawingCacheTextureRevision } from './render_cache_assets.js';

/** Geometry-only derived adapter. Text remains native until font bitmap ownership/resolution is verified. */
export class DrawingArtworkCache {
	#cache;
	#renderer;
	#busy = false;
	#key = null;
	#destroyed = false;

	constructor({ budget, renderer }) {
		if (!renderer || typeof renderer.render !== 'function') throw new TypeError('A native PIXI renderer is required.');
		this.#renderer = renderer;
		this.#cache = new DrawingRunCache({
			budget,
			allocate: (run, options) => PIXI.RenderTexture.create({
				width: options.width, height: options.height, resolution: options.resolution,
				multisample: 0, scaleMode: PIXI.SCALE_MODES.NEAREST,
			}),
			dispose: texture => texture.destroy(true),
		});
	}

	get stats() { return { ...this.#cache.stats, preparing: this.#busy }; }

	#check() {
		if (this.#destroyed) throw new Error('Drawing artwork cache is disposed.');
		if (this.#busy) throw new Error('Drawing artwork cache preparation is in progress.');
	}

	async prepare(stack, artwork, options, context, textures = new Map()) {
		this.#check();
		this.#busy = true;
		try {
			if (!(artwork instanceof Map) || !(textures instanceof Map)) {
				throw new TypeError('Artwork and borrowed textures must be explicit maps.');
			}
			stack = structuredClone(stack);
			options = structuredClone(options);
			context = structuredClone(context);
			textures = new Map(textures);
			if (!context || ![context.scene, context.level, context.assets, context.renderer].every(value =>
					typeof value === 'string' && value.length > 0 && value.length <= 1024)
				|| typeof context.nativeHidden !== 'boolean'
				|| ![context.x, context.y, context.scale].every(Number.isFinite) || context.scale <= 0) {
				throw new TypeError('Explicit Scene/Level/asset/renderer revisions and viewport transform are required.');
			}
			const admission = admitDrawingCacheStack(stack, options);
			if (admission.strategy !== 'candidate') {
				this.#cache.evict();
				this.#key = null;
				return admission;
			}
			const projects = new Map();
			const assetMetadata = new Map();
			let drawings = 0, points = 0, bytes = 0;
			for (const run of admission.runs) {
				const entries = run.ids.map(id => {
					if (!artwork.has(id)) throw new Error(`Missing cache artwork for ${id}.`);
					const entry = artwork.get(id);
					if (entry.data?.text) throw new Error('Text cache rendering is not verified; use native rendering.');
					return entry;
				});
				const project = prepareArtworkSnapshot(entries);
				const byId = new Map(project.drawings.map(entry => [entry.id, entry]));
				if (byId.size !== entries.length) throw new Error('Cache artwork identities are not unique.');
				// Publication sorting breaks native equal-sort ties; preserve the supplied native order here.
				project.drawings = entries.map(entry => byId.get(entry.id));
				for (const { data } of project.drawings) {
					if (data.elevation !== run.elevation || data.interface !== run.interface) {
						throw new Error('Cache artwork and native stack modes disagree.');
					}
					if (data.fillType !== 2 || !data.texture) continue;
					const texture = textures.get(data.texture);
					if (!texture?.valid || !Number.isFinite(texture.width) || !Number.isFinite(texture.height)
						|| texture.width <= 0 || texture.height <= 0 || texture.width > 4096 || texture.height > 4096) {
						throw new Error('A valid bounded borrowed artwork texture is required.');
					}
					assetMetadata.set(data.texture, drawingCacheTextureRevision(texture));
				}
				drawings += entries.length;
				points += entries.reduce((sum, entry) => sum + (entry.data.shape.points?.length ?? 0), 0);
				bytes += new TextEncoder().encode(JSON.stringify(project.drawings)).length;
				if (drawings > 1000 || points > 100000 || bytes > 4 * 1024 * 1024
					|| assetMetadata.size > 16) throw new RangeError('Aggregate derived artwork limits exceeded.');
				projects.set(run.start, project);
			}
			const decodedPixels = [...assetMetadata.values()].reduce((sum, asset) => sum + asset.width * asset.height, 0);
			if (decodedPixels > 16000000) throw new RangeError('Borrowed artwork texture pixel limit exceeded.');
			const fingerprint = JSON.stringify({ stack, options, context: {
				scene: context.scene, level: context.level, assets: context.assets, renderer: context.renderer,
				nativeHidden: context.nativeHidden, x: context.x, y: context.y, scale: context.scale,
			}, projects: [...projects], assets: [...assetMetadata] });
			const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
			const key = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
			for (const [path, metadata] of assetMetadata) {
				const texture = textures.get(path);
				if (JSON.stringify(metadata) !== JSON.stringify(drawingCacheTextureRevision(texture))) {
					throw new Error('Artwork texture changed during cache preparation.');
				}
			}
			if (this.#destroyed) throw new Error('Drawing artwork cache was disposed during preparation.');
			const result = this.#cache.prepare(stack, options, key);
			if (!this.#cache.stats.ready) this.#cache.rebuild((target, run) => {
				const root = buildArtworkDisplay(projects.get(run.start), textures, {
					publication: true, nativeHidden: context.nativeHidden,
				});
				try {
					root.scale.set(context.scale);
					root.position.set(context.x, context.y);
					this.#renderer.render(root, { renderTexture: target, clear: true });
				} finally { root.destroy({ children: true }); }
			});
			this.#key = key;
			return Object.freeze({ ...result, sourceKey: key });
		} catch (failure) {
			this.#key = null;
			try { this.#cache.evict(); }
			catch (cleanup) { throw new AggregateError([failure, cleanup], 'Artwork preparation and cleanup failed.'); }
			throw failure;
		} finally { this.#busy = false; }
	}

	use(sourceKey, callback) {
		this.#check();
		return this.#cache.use(sourceKey, callback);
	}

	invalidate() {
		this.#check();
		this.#key = null;
		this.#cache.evict();
	}

	destroy() {
		if (this.#destroyed) return;
		this.#check();
		this.#cache.destroy();
		this.#key = null;
		this.#destroyed = true;
	}
}
