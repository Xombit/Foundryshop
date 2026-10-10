import { DrawingRegionCache } from './drawing-region-cache.mjs';
import { detachedDrawingCandidates } from './drawing-spatial-index.mjs';
import { DrawingCacheLifecycle } from './drawing-cache-lifecycle.mjs';

/** Native detached acceptance fixture; spatial subsets preserve source order. */
export function runDrawingRegionProbe({ PIXI, renderer, GraphicsClass, ContainerClass, resolution = 1 }) {
	const width = 256, height = 256, roots = [], results = [];
	let output, cache, lifecycle;
	const targets = new Set(), ownedTextures = [];
	const root = new ContainerClass();
	root.sortableChildren = false;
	roots.push(root);
	const replay = new PIXI.Container();
	roots.push(replay);
	const shape = (color, x, y, alpha = 1) => {
		const graphic = new GraphicsClass();
		graphic.beginFill(color, alpha).drawRoundedRect(0, 0, 53, 39, 5).endFill();
		graphic.position.set(x, y);
		root.addChild(graphic);
		return graphic;
	};
	const render = object => renderer.render(object, { renderTexture: output, clear: true });
	const pixels = () => {
		const mode = output.baseTexture.alphaMode;
		try {
			output.baseTexture.alphaMode = PIXI.ALPHA_MODES.NPM;
			return renderer.extract.pixels(output);
		} finally { output.baseTexture.alphaMode = mode; }
	};
	const bounds = object => {
		const b = object.getBounds();
		return { x: b.x, y: b.y, width: b.width, height: b.height };
	};
	let text;
	try {
		output = PIXI.RenderTexture.create({ width, height, resolution, multisample: 0 });
		const reserveBytes = output.baseTexture.realWidth * output.baseTexture.realHeight * 4;
		cache = new DrawingRegionCache({
			width, height, resolution, tileSize: 64,
			maxBytes: 8 * 1024 * 1024, reserveBytes,
		}, {
			allocate(tile) {
				const texture = PIXI.RenderTexture.create({
					width: tile.width, height: tile.height, resolution: tile.resolution,
					multisample: 0, scaleMode: PIXI.SCALE_MODES.NEAREST,
				});
				targets.add(texture);
				let sprite;
				try {
					sprite = new PIXI.Sprite(texture);
					sprite.position.set(tile.x, tile.y);
					replay.addChild(sprite);
					return { texture, sprite };
				} catch (error) {
					sprite?.destroy();
					texture.destroy(true);
					targets.delete(texture);
					throw error;
				}
			},
			dispose({ texture, sprite }) {
				sprite.destroy();
				texture.destroy(true);
				targets.delete(texture);
			},
		});
		cache.setContext(`fixture:${resolution}:transform-1:assets-1:fonts-1`);
		lifecycle = new DrawingCacheLifecycle({
			width, height, resolution, tileSize: 64, maxBytes: 8 * 1024 * 1024, reserveBytes,
		}, { padding: 2 / resolution });
		const ids = new WeakMap();
		let nextId = 0;
		const red = shape(0xff0000, 28.25, 28.75, 0.5);
		const green = shape(0x00ff00, 48.5, 42.25, 0.7);
		const blue = shape(0x0000ff, 150.5, 142.25, 0.5);
		const curve = new GraphicsClass();
		curve.lineStyle({ width: 7, color: 0xff80ff, alpha: 0.6 });
		curve.moveTo(-10.25, 80.75).bezierCurveTo(95, -20, 150, 220, 270, 100);
		root.addChild(curve);
		text = new PIXI.Text('Reference', { fontFamily: 'sans-serif', fontSize: 17, fill: '#ffffff' });
		text.position.set(20.25, 100.75);
		root.addChild(text);
		const imageTexture = PIXI.Texture.fromBuffer(new Uint8Array([
			255, 0, 0, 255, 0, 255, 0, 128,
			0, 0, 255, 255, 255, 255, 255, 128,
		]), 2, 2);
		ownedTextures.push(imageTexture);
		const image = new PIXI.Sprite(imageTexture);
		image.position.set(120.25, 70.5);
		image.scale.set(18);
		image.angle = 19;
		root.addChild(image);
		const check = name => {
			render(root);
			const expected = pixels();
			const records = root.children.map(object => {
				if (!ids.has(object)) ids.set(object, String(nextId++));
				return {
					id: ids.get(object), bounds: bounds(object), editing: false,
					signature: JSON.stringify({
						alpha: object.alpha, visible: object.visible, renderable: object.renderable,
						geometry: object.geometry?.dirty, text: object.text,
						fontSize: object.style?.fontSize, texture: object.texture?.baseTexture?.uid,
					}),
				};
			});
			const transition = lifecycle.synchronize(records,
				JSON.stringify({ resolution, x: root.x, y: root.y, scaleX: root.scale.x, scaleY: root.scale.y }));
			const frame = lifecycle.frame();
			if (transition.reset) cache.invalidateAll();
			else cache.invalidate(frame.tiles);
			const candidates = detachedDrawingCandidates(root, {
				width, height, resolution, tileSize: 64, maxBytes: 8 * 1024 * 1024, reserveBytes,
			});
			let submissions = 0;
			const rebuilt = cache.rebuild(({ texture }, tile) => {
				submissions += candidates.renderTile(tile.id, () => renderer.render(root, {
					renderTexture: texture, clear: true,
					transform: new PIXI.Matrix(1, 0, 0, 1, -tile.x, -tile.y),
				}));
			});
			cache.replay(() => {});
			lifecycle.acknowledge(frame.revision);
			renderer.render(replay, { renderTexture: output, clear: true });
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
			results.push({ name, rebuilt, lifecycleReset: transition.reset, submissions, fullRootSubmissions: rebuilt * root.children.length,
				maxChannelError, changedPixels });
		};
		check('initial');
		check('unchanged');
		red.position.set(180.25, 30.75);
		red.angle = 27;
		check('move-and-rotate');
		root.removeChild(green);
		green.destroy();
		check('delete');
		const inserted = shape(0xffff00, 60.25, 50.75, 0.8);
		check('insert');
		blue.clear().beginFill(0x00ffff, 0.3).drawEllipse(20, 20, 20, 15).endFill();
		check('geometry-and-alpha');
		root.setChildIndex(inserted, 0);
		check('sort-change');
		text.text = 'Changed label';
		check('text-change');
		image.alpha = 0.5;
		check('image-alpha');
		red.alpha = 0.4;
		check('source-hidden-or-drag-alpha');
		root.scale.set(1.3);
		root.position.set(2.25, -7.5);
		check('pan-and-zoom');
		const replacement = PIXI.Texture.fromBuffer(new Uint8Array([
			0, 255, 255, 128, 255, 0, 255, 255,
			255, 255, 0, 128, 0, 0, 0, 255,
		]), 2, 2);
		ownedTextures.push(replacement);
		image.texture = replacement;
		text.style.fontSize = 23;
		check('font-and-asset-context');
		cache.evict();
		lifecycle.invalidate();
		check('evict-and-rebuild');
		const stats = cache.stats;
		cache.destroy();
		return { resolution, results, stats, remainingTargets: targets.size,
			disclosure: 'Detached normal-blend no-filter fixture; screen-bound subsets preserve source order. No live optimization claimed.' };
	} finally {
		try { cache?.destroy(); }
		finally {
			lifecycle?.destroy();
			for (const texture of targets) texture.destroy(true);
			// PIXI.Text owns a separate generated bitmap, unlike borrowed artwork textures.
			if (text && !text.destroyed) text.destroy({ texture: true, baseTexture: true });
			for (const container of roots) container.destroy({ children: true });
			for (const texture of ownedTextures) texture.destroy(true);
			output?.destroy(true);
		}
	}
}
