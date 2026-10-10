import { IncrementalDrawingIndex, indexDrawingCandidates } from './drawing-spatial-index.mjs';
import { coalesceDrawingRegions, planDrawingRegions } from './drawing-region-cache.mjs';
import { admitCoalescedScratch } from './drawing-cache-lifecycle.mjs';
import { rebuildCoalescedDrawingRegions, copyDrawingScratchTile } from './drawing-coalesced-rebuild.mjs';

export function runDrawingIncrementalProbe({ PIXI, renderer, GraphicsClass, ContainerClass, resolution = 1 }) {
	const options = { width: 256, height: 256, resolution, tileSize: 64,
		reserveBytes: Math.ceil(256 * resolution) ** 2 * 4, maxBytes: 8 * 1024 * 1024 };
	const plan = planDrawingRegions(options), root = new ContainerClass(), replay = new PIXI.Container();
	root.sortableChildren = false;
	const targets = [], resources = [], comparisons = [];
	let output;
	const rectangle = object => {
		const b = object.getBounds();
		return { x: b.x, y: b.y, width: b.width, height: b.height };
	};
	const pixels = () => {
		const mode = output.baseTexture.alphaMode;
		try { output.baseTexture.alphaMode = PIXI.ALPHA_MODES.NPM; return renderer.extract.pixels(output); }
		finally { output.baseTexture.alphaMode = mode; }
	};
	const render = object => renderer.render(object, { renderTexture: output, clear: true });
	try {
		for (let i = 0; i < 100; i++) {
			const shape = new GraphicsClass();
			shape.lineStyle({ width: 2 + i % 5, color: i * 7919 % 0xffffff, alpha: 0.6 });
			shape.moveTo(0, 0).bezierCurveTo(12, 27, 28, -6, 42, 19);
			shape.position.set(i * 73 % 210 + 0.25, i * 97 % 210 + 0.75);
			root.addChild(shape);
		}
		const records = root.children.map((object, i) => ({ id: String(i), bounds: rectangle(object) }));
		const limits = { padding: 2 / resolution };
		const index = new IncrementalDrawingIndex(records, options, limits);
		output = PIXI.RenderTexture.create({ width: 256, height: 256, resolution, multisample: 0 });
		const drawCandidates = (ids, texture, region) => {
			const members = new Set(ids), states = root.children.map(o => o.renderable);
			try {
				for (let i = 0; i < states.length; i++) root.children[i].renderable = states[i] && members.has(String(i));
				renderer.render(root, { renderTexture: texture, clear: true,
					transform: new PIXI.Matrix(1, 0, 0, 1, -region.x, -region.y) });
			} finally {
				for (let i = 0; i < states.length; i++) root.children[i].renderable = states[i];
			}
		};
		for (const tile of plan.tiles) {
			const texture = PIXI.RenderTexture.create({
				width: tile.width, height: tile.height, resolution, multisample: 0, scaleMode: PIXI.SCALE_MODES.NEAREST,
			});
			targets.push(texture);
			const sprite = new PIXI.Sprite(texture);
			sprite.position.set(tile.x, tile.y);
			replay.addChild(sprite);
			resources.push({ tile, texture });
			drawCandidates(index.query(tile.id), texture, tile);
		}
		const compare = name => {
			render(root);
			const expected = pixels();
			render(replay);
			const actual = pixels();
			let maxChannelError = 0, changedPixels = 0;
			for (let i = 0; i < actual.length; i += 4) {
				let changed = false;
				for (let j = 0; j < 4; j++) {
					const error = Math.abs(expected[i + j] - actual[i + j]);
					maxChannelError = Math.max(maxChannelError, error);
					changed ||= error > 1;
				}
				if (changed) changedPixels++;
			}
			comparisons.push({ name, maxChannelError, changedPixels });
		};
		compare('initial');
		const rebuildCoalesced = dirty => rebuildCoalescedDrawingRegions(plan, dirty,
			{ maxBytes: options.maxBytes }, {
				allocate: region => PIXI.RenderTexture.create({
					width: region.width, height: region.height, resolution, multisample: 0,
					scaleMode: PIXI.SCALE_MODES.NEAREST,
				}),
				render(texture, region) {
					const ids = new Set();
					for (const tile of plan.tiles) {
						if (tile.x >= region.x && tile.y >= region.y
							&& tile.x + tile.width <= region.x + region.width + 1e-10
							&& tile.y + tile.height <= region.y + region.height + 1e-10) {
							for (const id of index.query(tile.id)) ids.add(id);
						}
					}
					drawCandidates([...ids], texture, region);
				},
				copy: (scratch, region, tile) => copyDrawingScratchTile(PIXI, renderer, scratch, region,
					resources.find(r => r.tile.id === tile.id).texture, tile),
				dispose: texture => texture.destroy(true),
			});
		let updatedTiles = 0, coalescedRegions = 0;
		for (let step = 0; step < 12; step++) {
			const i = step * 7;
			const object = root.children[i];
			object.position.set(step * 41 % 220 + 0.5, step * 53 % 220 + 0.25);
			object.angle = step * 13;
			object.alpha = step % 3 ? 0.4 : 1;
			records[i] = { id: String(i), bounds: rectangle(object) };
			const dirty = index.updateBounds([records[i]]);
			const fresh = indexDrawingCandidates(records, options, limits);
			for (const tile of plan.tiles) {
				if (JSON.stringify(index.query(tile.id)) !== JSON.stringify(fresh.query(tile.id))) {
					throw new Error('Incremental membership differs from a fresh snapshot.');
				}
			}
			updatedTiles += dirty.length;
			for (const { tile, texture } of resources) {
				if (dirty.includes(tile.id)) drawCandidates(index.query(tile.id), texture, tile);
			}
			compare(`incremental-${step}`);
			rebuildCoalesced(dirty);
			compare(`copyback-${step}`);
			// Independently verify larger cropped regions against the same direct output.
			const regions = coalesceDrawingRegions(plan, dirty);
			const admission = admitCoalescedScratch(plan, dirty, { maxBytes: options.maxBytes });
			if (admission.strategy !== 'coalesced') throw new Error(admission.reason);
			coalescedRegions += regions.length;
			for (const region of regions) {
				const texture = PIXI.RenderTexture.create({
					width: region.width, height: region.height, resolution, multisample: 0,
					scaleMode: PIXI.SCALE_MODES.NEAREST,
				});
				let sprite;
				try {
					const ids = new Set();
					for (const tile of plan.tiles) {
						if (tile.x >= region.x && tile.y >= region.y
							&& tile.x + tile.width <= region.x + region.width + 1e-10
							&& tile.y + tile.height <= region.y + region.height + 1e-10) {
							for (const id of index.query(tile.id)) ids.add(id);
						}
					}
					drawCandidates([...ids], texture, region);
					sprite = new PIXI.Sprite(texture);
					sprite.position.set(region.x, region.y);
					// Compose the coalesced replacement only over its exact constituent tiles.
					const states = replay.children.map(child => child.renderable);
					for (const child of replay.children) {
						if (child.x >= region.x && child.y >= region.y
							&& child.x < region.x + region.width - 1e-10
							&& child.y < region.y + region.height - 1e-10) child.renderable = false;
					}
					replay.addChild(sprite);
					try { compare(`coalesced-${step}`); }
					finally {
						replay.removeChild(sprite);
						for (let j = 0; j < states.length; j++) replay.children[j].renderable = states[j];
					}
				} finally { sprite?.destroy(); texture.destroy(true); }
			}
		}
		const edited = root.children[0];
		const edit = () => {
			edited.alpha = edited.alpha === 0.4 ? 0.6 : 0.4;
			records[0] = { id: '0', bounds: rectangle(edited) };
		};
		const rebuildAndReplay = (dirty, query) => {
			for (const { tile, texture } of resources) {
				if (dirty.includes(tile.id)) drawCandidates(query(tile.id), texture, tile);
			}
			render(replay);
		};
		const actions = {
			direct: () => { edit(); render(root); },
			freshIndex: () => {
				edit();
				const fresh = indexDrawingCandidates(records, options, limits);
				const dirty = plan.tiles.filter(tile => fresh.query(tile.id).includes('0')).map(tile => tile.id);
				rebuildAndReplay(dirty, id => fresh.query(id));
			},
			incrementalIndex: () => {
				edit();
				const dirty = index.updateBounds([records[0]]);
				rebuildAndReplay(dirty, id => index.query(id));
			},
			coalescedCopyback: () => {
				edit();
				const dirty = index.updateBounds([records[0]]);
				const result = rebuildCoalesced(dirty);
				if (result.strategy !== 'coalesced') throw new Error(result.reason);
				render(replay);
			},
		};
		const samples = { direct: [], freshIndex: [], incrementalIndex: [], coalescedCopyback: [] };
		for (const action of Object.values(actions)) for (let i = 0; i < 3; i++) action();
		const orders = [
			['direct', 'freshIndex', 'incrementalIndex', 'coalescedCopyback'],
			['coalescedCopyback', 'direct', 'freshIndex', 'incrementalIndex'],
			['incrementalIndex', 'coalescedCopyback', 'direct', 'freshIndex'],
			['freshIndex', 'incrementalIndex', 'coalescedCopyback', 'direct'],
		];
		for (let round = 0; round < 9; round++) {
			for (const name of orders[round % orders.length]) {
				renderer.gl.finish();
				const start = performance.now();
				for (let i = 0; i < 8; i++) actions[name]();
				renderer.gl.finish();
				samples[name].push((performance.now() - start) / 8);
			}
		}
		return { resolution, comparisons: comparisons.length,
			maxChannelError: Math.max(...comparisons.map(c => c.maxChannelError)),
			changedPixels: comparisons.reduce((sum, c) => sum + c.changedPixels, 0),
			failures: comparisons.filter(c => c.maxChannelError > 1),
			updatedTiles, coalescedRegions, tileCount: plan.tiles.length,
			editAndReplayMilliseconds: Object.fromEntries(Object.entries(samples).map(([name, values]) =>
				[name, { median: [...values].sort((a, b) => a - b)[4],
					min: Math.min(...values), max: Math.max(...values) }])),
			disclosure: 'Detached 100-stroke normal-blend fixture, no filters/MSAA. Timing includes edit, bounds/index, rebuild and replay; coalesced path includes admitted scratch allocation/copyback/disposal. Excludes native hooks and initial persistent target allocation; not live FPS.' };
	} finally {
		replay.destroy({ children: true });
		root.destroy({ children: true });
		output?.destroy(true);
		for (const texture of targets) texture.destroy(true);
	}
}
