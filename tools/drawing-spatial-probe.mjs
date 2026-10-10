import { detachedDrawingCandidates, chooseMeasuredDrawingRebuild } from './drawing-spatial-index.mjs';
import { planDrawingRegions } from './drawing-region-cache.mjs';

export function runDrawingSpatialBenchmark({ PIXI, renderer, GraphicsClass, ContainerClass }) {
	const options = { width: 512, height: 512, tileSize: 128 };
	const plan = planDrawingRegions(options), results = [];
	for (const crowded of [false, true]) {
		const root = new ContainerClass();
		root.sortableChildren = false;
		const targets = [];
		let output;
		try {
			for (let i = 0; i < 500; i++) {
				const shape = new GraphicsClass();
				const x = crowded ? 210 + i % 40 : i * 73 % 460;
				const y = crowded ? 210 + i % 30 : i * 97 % 460;
				shape.lineStyle({ width: 1 + i % 5, color: i * 7919 % 0xffffff, alpha: i % 3 ? 1 : 0.5 });
				shape.moveTo(x, y).bezierCurveTo(x + 12, y + 27, x + 28, y - 6, x + 42, y + 19);
				root.addChild(shape);
			}
			output = PIXI.RenderTexture.create({ width: 512, height: 512, resolution: 1, multisample: 0 });
			for (const tile of plan.tiles) {
				targets.push(PIXI.RenderTexture.create({
					width: tile.width, height: tile.height, resolution: 1, multisample: 0,
				}));
			}
			const dirty = plan.tiles.filter(t => t.x >= 128 && t.x < 384 && t.y >= 128 && t.y < 384);
			const renderTile = tile => renderer.render(root, {
				renderTexture: targets[plan.tiles.indexOf(tile)], clear: true,
				transform: new PIXI.Matrix(1, 0, 0, 1, -tile.x, -tile.y),
			});
			const subset = tiles => {
				// Bounds refresh and index creation are deliberately included in each rebuild sample.
				const snapshot = detachedDrawingCandidates(root, options);
				for (const tile of tiles) snapshot.renderTile(tile.id, () => renderTile(tile));
			};
			const actions = {
				viewport: () => renderer.render(root, { renderTexture: output, clear: true }),
				fullRootDirty: () => { for (const tile of dirty) renderTile(tile); },
				spatialDirty: () => subset(dirty),
				spatialAll: () => subset(plan.tiles),
				fullRootLocal: () => renderTile(plan.tiles[0]),
				spatialLocal: () => subset([plan.tiles[0]]),
			};
			const snapshot = detachedDrawingCandidates(root, options);
			const submissions = tiles => tiles.reduce((sum, tile) => sum + snapshot.index.query(tile.id).length, 0);
			const samples = Object.fromEntries(Object.keys(actions).map(name => [name, []]));
			for (const action of Object.values(actions)) for (let i = 0; i < 3; i++) action();
			let seed = 404;
			for (let round = 0; round < 7; round++) {
				const order = Object.keys(actions);
				for (let i = order.length - 1; i > 0; i--) {
					seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
					const j = seed % (i + 1);
					[order[i], order[j]] = [order[j], order[i]];
				}
				for (const name of order) {
					renderer.gl.finish();
					const start = performance.now();
					for (let i = 0; i < 8; i++) actions[name]();
					renderer.gl.finish();
					samples[name].push((performance.now() - start) / 8);
				}
			}
			results.push({
				crowded, drawings: 500, dirtyTiles: dirty.length, allTiles: plan.tiles.length,
				submissions: { viewport: 500, fullRootDirty: dirty.length * 500,
					spatialDirty: submissions(dirty), spatialAll: submissions(plan.tiles) },
				millisecondsPerRebuild: Object.fromEntries(Object.entries(samples).map(([name, values]) =>
					[name, { median: [...values].sort((a, b) => a - b)[3],
						min: Math.min(...values), max: Math.max(...values) }])),
				fourTileAdmission: chooseMeasuredDrawingRebuild(samples),
				oneTileAdmission: chooseMeasuredDrawingRebuild({
					viewport: samples.viewport, fullRootDirty: samples.fullRootLocal, spatialDirty: samples.spatialLocal,
				}),
			});
		} finally {
			root.destroy({ children: true });
			output?.destroy(true);
			for (const texture of targets) texture.destroy(true);
		}
	}
	return {
		results, rounds: 7, iterations: 8,
		disclosure: 'Detached CPU submission plus GPU completion. Includes bounds/index work; excludes cache replay, allocation and native lifecycle. Not live FPS.',
	};
}
