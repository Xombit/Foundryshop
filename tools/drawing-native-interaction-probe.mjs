import { createNativeDrawingCacheCapture } from '../scripts/render_native_snapshot.js';
import { DrawingArtworkCache } from '../scripts/render_artwork_cache.js';
import { DrawingCacheBudget } from '../scripts/render_cache_admission.js';
import { DrawingCacheHost } from '../scripts/render_cache_host.js';

/** Explicit transient selection/pan experiment. Restores client state and never edits Scene documents. */
export async function runNativeDrawingInteractionProbe({ canvas, hooks, readInput }) {
	if (!canvas.ready || !canvas.activeLayer || canvas.activeLayer.controlled?.length || canvas.drawings.controlled.length
		|| canvas.drawings.preview.children.length) throw new Error('Interaction probe requires an idle canvas without selected Drawings.');
	const input = readInput(), capture = createNativeDrawingCacheCapture(readInput);
	const baseline = capture(), primary = [...canvas.primary.children], scene = canvas.scene;
	const source = JSON.stringify(scene.toObject()), layer = canvas.activeLayer;
	const pivot = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y }, scale = canvas.stage.scale.x;
	const view = scene._viewPosition;
	const drawing = scene.drawings.get(baseline.identities.get(baseline.artwork.keys().next().value))?.object;
	if (!drawing || drawing.document.locked) throw new Error('Interaction probe requires an unlocked eligible Drawing.');
	const budget = new DrawingCacheBudget(input.options.maxBytes);
	const host = new DrawingCacheHost({ adapter: new DrawingArtworkCache({ budget, renderer: canvas.app.renderer }), capture });
	const reports = [], timings = [];
	let selectionBlocked = false, panBlocked = false, unhookedBlocked = false, recovered = false;
	const refused = () => {
		try { host.use(() => {}); }
		catch (error) {
			if (!/current frame|snapshot changed/.test(error.message)) throw error;
			return true;
		}
		return false;
	};
	try {
		host.bind({ hooks, sceneId: () => canvas.scene?.id, reportError: error => reports.push(error.message),
			assets: [...new Set([...baseline.textures.values()].map(t => t.baseTexture))] });
		await host.prepare();
		for (let i = 0; i < 7; i++) {
			const start = performance.now();
			if (!baseline.isCurrent()) throw new Error('Native baseline changed before the interaction probe.');
			timings.push(performance.now() - start);
		}
		// A transform change with no event must still block replay before the next browser frame.
		canvas.stage.pivot.x = pivot.x + 1;
		try { unhookedBlocked = refused(); }
		finally { canvas.stage.pivot.set(pivot.x, pivot.y); }
		await host.prepare();
		canvas.drawings.activate();
		if (!drawing.control({ releaseOthers: false })) throw new Error('Native Drawing control failed.');
		selectionBlocked = refused();
		drawing.release();
		await new Promise(resolve => setTimeout(resolve, 50));
		await host.prepare();
		canvas.pan({ x: pivot.x + 20, y: pivot.y + 10, scale });
		panBlocked = refused();
		canvas.pan({ ...pivot, scale });
		await new Promise(resolve => setTimeout(resolve, 50));
		await host.prepare();
		recovered = host.use(entries => entries.length > 0);
	} finally {
		try {
			await host.destroy();
		} finally {
			if (drawing.controlled) drawing.release();
			if (canvas.scene !== scene) throw new Error('Displayed Scene changed during native interaction probe; restore the original view manually.');
			canvas.pan({ ...pivot, scale });
			scene._viewPosition = view;
			if (canvas.activeLayer !== layer) layer.activate();
		}
	}
	await new Promise(resolve => setTimeout(resolve, 50));
	if (canvas.drawings.placeables.some(placeable => placeable.renderFlags.size)) {
		throw new Error('Native refresh remains pending after client restoration; defer the next probe.');
	}
	return {
		selectionBlocked, panBlocked, unhookedBlocked, recovered, reports, guardSamplesMs: timings,
		reservedBytesAfterTeardown: budget.stats.reservedBytes,
		sourceUnchanged: source === JSON.stringify(scene.toObject()),
		primaryUnchanged: primary.length === canvas.primary.children.length && primary.every((o, i) => canvas.primary.children[i] === o),
		clientRestored: canvas.activeLayer === layer && !drawing.controlled && canvas.stage.pivot.x === pivot.x
			&& canvas.stage.pivot.y === pivot.y && canvas.stage.scale.x === scale && scene._viewPosition === view,
		disclosure: 'Actual native control/release and canvas.pan, not physical mouse drag, stroke creation or Level switch. Full recapture guard is shadow-only; costs are CPU capture timings, not render speedup.',
	};
}
