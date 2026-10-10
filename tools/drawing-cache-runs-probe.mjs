import { withDetachedDrawingRuns } from './drawing-cache-runs.mjs';
import { DrawingRunCache } from '../scripts/render_run_cache.js';
import { DrawingCacheBudget } from '../scripts/render_cache_admission.js';

export function runDrawingCacheRunsProbe({ PIXI, renderer, GraphicsClass, ContainerClass, resolution = 1 }) {
	const root = new ContainerClass(), textures = [], replacements = [], results = [];
	let output, text, cache;
	const budget = new DrawingCacheBudget(8 * 1024 * 1024);
	const shape = (id, color, sort, kind = 'drawing', sortLayer = 600) => {
		const object = new GraphicsClass();
		object.name = id;
		object.sort = sort;
		object.sortLayer = sortLayer;
		object.beginFill(color, 0.6).drawRect(20 + sort * 4, 20, 90, 80).endFill();
		object.probeKind = kind;
		root.addChild(object);
		return object;
	};
	const pixels = () => {
		const mode = output.baseTexture.alphaMode;
		try { output.baseTexture.alphaMode = PIXI.ALPHA_MODES.NPM; return renderer.extract.pixels(output); }
		finally { output.baseTexture.alphaMode = mode; }
	};
	const render = () => renderer.render(root, { renderTexture: output, clear: true });
	const cleanupCaches = () => {
		if (cache) { cache.destroy(); cache = null; }
		for (const replacement of replacements.splice(0)) replacement.destroy({ children: true });
		for (const texture of textures.splice(0)) texture.destroy(true);
	};
	try {
		output = PIXI.RenderTexture.create({ width: 256, height: 256, resolution, multisample: 0 });
		const a = shape('a', 0xff0000, 0);
		shape('b', 0xff8000, 0);
		shape('barrier', 0x00ff00, 0, 'other');
		const c = shape('c', 0x0000ff, 0);
		shape('d', 0x8000ff, 0);
		shape('upper-a', 0xffffff, 0, 'drawing', 700);
		shape('upper-b', 0xff00ff, 1, 'drawing', 700);
		text = new PIXI.Text('Run text', { fontSize: 18, fill: '#ffffff', stroke: '#000000', strokeThickness: 2 });
		text.alpha = 0.5;
		c.addChild(text);
		const check = (name, editing = new Set()) => {
			cleanupCaches();
			root.sortChildren();
			render();
			const expected = pixels(), sources = [...root.children], states = sources.map(o => o.renderable);
			const stack = sources.map(o => ({ id: o.name, kind: o.probeKind,
				cacheable: true, editing: editing.has(o.name), depth: false, interface: false,
				elevation: o.elevation, sortLayer: o.sortLayer, sort: o.sort, zIndex: o.zIndex }));
			cache = new DrawingRunCache({ budget,
				allocate() {
					const texture = PIXI.RenderTexture.create({
						width: 256, height: 256, resolution, multisample: 0, scaleMode: PIXI.SCALE_MODES.NEAREST,
					});
					let replacement;
					try {
						replacement = new ContainerClass();
						replacement.addChild(new PIXI.Sprite(texture));
						return { texture, replacement };
					} catch (error) {
						replacement?.destroy({ children: true });
						texture.destroy(true);
						throw error;
					}
				},
				dispose({ texture, replacement }) {
					replacement.destroy({ children: true });
					texture.destroy(true);
				},
			});
			const admission = cache.prepare(stack, {
				width: 256, height: 256, resolution, maxAxis: 4096,
				maxBytes: 8 * 1024 * 1024, reserveBytes: Math.ceil(256 * resolution) ** 2 * 4,
			}, name);
			const runs = admission.runs;
			if (admission.strategy === 'candidate') {
				cache.rebuild(({ texture }, run) => {
					try {
					for (const source of sources) source.renderable = states[sources.indexOf(source)] && run.ids.includes(source.name);
					renderer.render(root, { renderTexture: texture, clear: true });
					} finally { for (let i = 0; i < sources.length; i++) sources[i].renderable = states[i]; }
				});
				cache.use(name, entries => withDetachedDrawingRuns(root, runs, entries.map(e => e.resource.replacement), render));
			} else render();
			const actual = pixels();
			let maxChannelError = 0, changedPixels = 0;
			for (let i = 0; i < expected.length; i += 4) {
				let changed = false;
				for (let j = 0; j < 4; j++) {
					const error = Math.abs(expected[i + j] - actual[i + j]);
					maxChannelError = Math.max(maxChannelError, error);
					changed ||= error > 1;
				}
				if (changed) changedPixels++;
			}
			const restored = sources.every((source, i) => root.children[i] === source
				&& source.parent === root && source.renderable === states[i]);
			let failureRestored = false;
			try {
				if (admission.strategy !== 'candidate') throw new Error('Intentional fixture render failure');
				cache.use(name, entries => withDetachedDrawingRuns(root, runs, entries.map(e => e.resource.replacement),
					() => { throw new Error('Intentional fixture render failure'); }));
			} catch (error) {
				if (error.message !== 'Intentional fixture render failure') throw error;
				failureRestored = sources.every((source, i) => root.children[i] === source && source.renderable === states[i]);
			}
			results.push({ name, strategy: admission.strategy, runs: runs.map(r => r.ids),
				maxChannelError, changedPixels, restored, failureRestored, reservedBytes: budget.stats.reservedBytes });
		};
		check('stable-ties-and-interleaved-barrier');
		check('editing-source-excluded', new Set(['a']));
		a.alpha = 0.4;
		check('hidden-or-drag-alpha');
		a.renderable = false;
		check('preexisting-suppression');
		a.renderable = true;
		c.sort = 2;
		check('sort-change');
		const inserted = shape('inserted-barrier', 0x00ffff, 1, 'other');
		check('inserted-barrier');
		root.removeChild(inserted);
		inserted.destroy();
		check('deleted-barrier');
		cleanupCaches();
		render();
		return { resolution, results, targetsRemaining: textures.length, reservedBytesAfterCleanup: budget.stats.reservedBytes,
			disclosure: 'Detached PrimaryCanvasContainer sorting, normal blend/no filters/MSAA, common elevation. Synthetic barriers, not actual Tile depth or live Drawing lifecycle. Whole-viewport targets per run are fixture-only.' };
	} finally {
		cleanupCaches();
		text?.destroy({ texture: true, baseTexture: true });
		root.destroy({ children: true });
		output?.destroy(true);
	}
}
