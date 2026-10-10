import { captureNativeDrawingCacheSnapshot } from '../scripts/render_native_snapshot.js';
import { DrawingArtworkCache } from '../scripts/render_artwork_cache.js';
import { DrawingCacheBudget } from '../scripts/render_cache_admission.js';
import { DrawingCacheHost } from '../scripts/render_cache_host.js';

/** Detached native-geometry comparison only; never suppresses, reparents or edits live sources. */
export async function runNativeDrawingSnapshotProbe({ canvas, PIXI, GraphicsClass, DrawingClass, options,
	assetRevision, rendererRevision }) {
	const capture = () => captureNativeDrawingCacheSnapshot({
		canvas, GraphicsClass, DrawingClass, options, assetRevision, rendererRevision,
	});
	const initial = capture(), renderer = canvas.app.renderer;
	const budget = new DrawingCacheBudget(options.maxBytes);
	const adapter = new DrawingArtworkCache({ budget, renderer });
	const host = new DrawingCacheHost({ adapter, capture });
	let output;
	const comparisons = [];
	try {
		const bytes = Math.ceil(options.width * options.resolution) * Math.ceil(options.height * options.resolution) * 4;
		if (options.reserveBytes < bytes) throw new Error('Native probe requires a reserved output target.');
		const prepared = await host.prepare();
		if (prepared.strategy !== 'candidate') throw new Error(`Native probe admission refused: ${prepared.reason}.`);
		output = PIXI.RenderTexture.create({
			width: options.width, height: options.height, resolution: options.resolution,
			multisample: 0, scaleMode: PIXI.SCALE_MODES.NEAREST,
		});
		host.use(entries => {
			for (const { run, resource } of entries) {
				const root = new PIXI.Container(), borrowed = [];
				try {
					root.position.set(initial.context.x, initial.context.y);
					root.scale.set(initial.context.scale);
					for (const id of run.ids) {
						const source = canvas.primary.children[Number(id.slice(5))];
						const geometry = source.geometry, references = geometry.refCount;
						const graphic = new PIXI.Graphics(geometry);
						borrowed.push({ geometry, references });
						root.addChild(graphic);
						graphic.position.copyFrom(source.position);
						graphic.pivot.copyFrom(source.pivot);
						graphic.scale.copyFrom(source.scale);
						graphic.skew.copyFrom(source.skew);
						graphic.rotation = source.rotation;
						graphic.alpha = source.alpha;
					}
					renderer.render(root, { renderTexture: output, clear: true });
					const expected = renderer.extract.pixels(output), actual = renderer.extract.pixels(resource);
					if (expected.length !== actual.length) throw new Error('Native probe output dimensions disagree.');
					let changedPixels = 0, maxChannelError = 0;
					for (let i = 0; i < expected.length; i += 4) {
						let changed = false;
						for (let j = 0; j < 4; j++) {
							const error = Math.abs(expected[i + j] - actual[i + j]);
							maxChannelError = Math.max(maxChannelError, error);
							if (error > 1) changed = true;
						}
						if (changed) changedPixels++;
					}
					comparisons.push({ start: run.start, drawings: run.ids.length, changedPixels, maxChannelError });
				} finally {
					root.destroy({ children: true });
					if (borrowed.some(({ geometry, references }) => geometry.refCount !== references)) {
						throw new Error('Native probe did not restore borrowed geometry ownership.');
					}
				}
			}
		});
		const reused = await host.prepare();
		output.destroy(true);
		output = null;
		await host.invalidate();
		const invalidated = !host.stats.ready && budget.stats.reservedBytes === 0;
		await host.destroy();
		return {
			slots: initial.stack.length, drawings: initial.identities.size, geometry: initial.artwork.size,
			excluded: initial.excluded, comparisons, reused: reused.reused, invalidated,
			reservedBytesAfterTeardown: budget.stats.reservedBytes,
		};
	} finally {
		try { output?.destroy(true); }
		finally { await host.destroy(); }
	}
}
