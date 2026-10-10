import { DrawingArtworkCache } from '../scripts/render_artwork_cache.js';
import { DrawingCacheBudget } from '../scripts/render_cache_admission.js';
import { withDetachedDrawingRuns } from './drawing-cache-runs.mjs';
import { compareRenderPixels } from './drawing-render-probe.mjs';

/** Complete owned fixture, including uncached text/blend/filter barriers and post-composition effects. */
export async function runDrawingOrderedReplayProbe({ PIXI, renderer, GraphicsClass, ContainerClass,
	TextClass, resolution = 1 }) {
	if (!Number.isFinite(resolution) || resolution < 0.5 || resolution > 2) {
		throw new RangeError('Ordered replay probe resolution must be between 0.5 and 2.');
	}
	const root = new ContainerClass(), budget = new DrawingCacheBudget(16 * 1024 * 1024);
	const adapter = new DrawingArtworkCache({ budget, renderer });
	const sources = [], artwork = new Map(), results = [], texts = [], filters = [];
	const options = { width: 256, height: 256, resolution, maxBytes: budget.stats.limitBytes,
		reserveBytes: Math.ceil(256 * resolution) ** 2 * 4, maxAxis: 4096 };
	let output;
	const add = (id, color, sort, kind = 'drawing') => {
		const shape = new GraphicsClass();
		root.addChild(shape);
		sources.push(shape);
		shape.name = id;
		shape.sort = sort;
		shape.sortLayer = 600;
		shape.probeKind = kind;
		shape.position.set(38 + sort * 6, 68);
		shape.pivot.set(40, 35);
		shape.lineStyle({ width: 4, color: 0x202020, alpha: 0.8 });
		shape.beginFill(color, 0.6).drawRect(2, 2, 76, 66).endFill();
		shape.line.reset();
		artwork.set(id, { id, layerId: null, data: {
			name: id, x: shape.x - 40, y: shape.y - 35, elevation: 0, sort,
			levels: ['ground'], interface: false, hidden: false, locked: false,
			shape: { type: 'r', width: 80, height: 70, points: [], radius: null },
			rotation: 0, bezierFactor: 0, fillType: 1,
			fillColor: `#${color.toString(16).padStart(6, '0')}`, fillAlpha: 0.6,
			strokeWidth: 4, strokeColor: '#202020', strokeAlpha: 0.8, texture: null,
			text: '', fontFamily: 'Signika', fontSize: 18, textColor: '#ffffff', textAlpha: 1, flags: {},
		} });
		return shape;
	};
	const pixels = () => {
		const straight = renderer.extract.pixels(output), mode = output.baseTexture.alphaMode;
		try {
			output.baseTexture.alphaMode = PIXI.ALPHA_MODES.NPM;
			return { straight, premultiplied: renderer.extract.pixels(output) };
		} finally { output.baseTexture.alphaMode = mode; }
	};
	const render = () => renderer.render(root, { renderTexture: output, clear: true });
	const compare = async (name, x, y, scale, editing = false) => {
		root.position.set(x, y);
		root.scale.set(scale);
		root.sortChildren();
		const ordered = [...root.children], states = ordered.map(s => s.renderable);
		const stack = ordered.map(s => ({ id: s.name, kind: s.probeKind,
			cacheable: s.probeKind === 'drawing', editing: editing && s === sources[0],
			depth: false, interface: false, elevation: 0,
			sortLayer: s.sortLayer, sort: s.sort, zIndex: s.zIndex }));
		render();
		const expected = pixels();
		const prepared = await adapter.prepare(stack, artwork, options, {
			scene: 'detached', level: 'ground', assets: '1', renderer: 'fixture',
			nativeHidden: false, x, y, scale,
		});
		const replacements = [];
		let failureRestored = true;
		try {
			if (prepared.strategy === 'candidate') adapter.use(prepared.sourceKey, entries => {
				for (const { resource } of entries) {
					const replacement = new ContainerClass();
					replacements.push(replacement);
					const sprite = new PIXI.Sprite(resource);
					replacement.addChild(sprite);
					// Targets are screen-aligned; undo the fixture viewport exactly once.
					sprite.position.set(-x / scale, -y / scale);
					sprite.scale.set(1 / scale);
				}
				withDetachedDrawingRuns(root, entries.map(e => e.run), replacements, render);
				try {
					withDetachedDrawingRuns(root, entries.map(e => e.run), replacements,
						() => { throw new Error('Intentional replay failure'); });
				} catch (error) {
					if (error.message !== 'Intentional replay failure') throw error;
					failureRestored = root.children.length === ordered.length
						&& ordered.every((s, i) => root.children[i] === s && s.renderable === states[i]);
				}
			});
			else render();
			const actual = pixels();
			const premultiplied = compareRenderPixels(expected.premultiplied, actual.premultiplied);
			const straight = compareRenderPixels(expected.straight, actual.straight);
			results.push({ name, strategy: prepared.strategy, reason: prepared.reason,
				runs: prepared.runs.map(r => r.ids), premultiplied, straight, failureRestored,
				restored: root.children.length === ordered.length && ordered.every((s, i) =>
					root.children[i] === s && s.parent === root && s.renderable === states[i]) });
		} finally {
			for (const replacement of replacements) replacement.destroy({ children: true });
		}
	};
	try {
		output = PIXI.RenderTexture.create({ width: 256, height: 256, resolution, multisample: 0 });
		add('a', 0xff4000, 0);
		add('b', 0xffc000, 0);
		const textBarrier = add('text', 0x206040, 0, 'barrier');
		const text = new TextClass('Native text', { fontSize: 18, fill: '#ffffff', stroke: '#000000', strokeThickness: 2 });
		text.resolution = 2;
		text.position.set(8, 20);
		text.alpha = 0.7;
		textBarrier.addChild(text);
		texts.push(text);
		add('c', 0x0040ff, 1);
		add('d', 0x8040ff, 1);
		const multiply = add('multiply', 0x60ff60, 2, 'barrier');
		multiply.blendMode = PIXI.BLEND_MODES.MULTIPLY;
		add('e', 0xff2080, 3);
		add('f', 0x20ffff, 3);
		const filtered = add('filtered', 0xffffff, 4, 'barrier');
		const barrierFilter = new PIXI.filters.ColorMatrixFilter();
		barrierFilter.brightness(0.7, false);
		filtered.filters = [barrierFilter];
		filters.push(barrierFilter);
		await compare('complete-stack-stable-ties', 0, 0, 1);
		await compare('fractional-pan', 13.5, 7.25, 1);
		await compare('zoom-out', 16, 20, 0.2);
		await compare('zoom-in', -43.5, -26.25, 2);
		const parentFilter = new PIXI.filters.ColorMatrixFilter();
		parentFilter.saturate(-0.4, false);
		filters.push(parentFilter);
		root.filters = [parentFilter];
		await compare('post-composition-parent-filter', 13.5, 7.25, 1);
		root.filters = null;
		root.alpha = 0.5;
		await compare('inherited-parent-alpha', 13.5, 7.25, 1);
		root.alpha = 1;
		await compare('editing-native-fallback', 0, 0, 1, true);
		adapter.destroy();
		return { resolution, results, reservedBytesAfterTeardown: budget.stats.reservedBytes,
			disclosure: 'Complete synthetic detached native-container fixture. Real text plus multiply/filter barriers; ordinary color filter, not Foundry ambience/weather/depth or live suppression. Inherited parent alpha is a diagnostic, not approved opacity semantics.' };
	} finally {
		try { adapter.destroy(); }
		finally {
			root.filters = null;
			for (const text of texts) text.destroy({ texture: true, baseTexture: true });
			root.destroy({ children: true });
			for (const filter of filters) filter.destroy();
			output?.destroy(true);
		}
	}
}
