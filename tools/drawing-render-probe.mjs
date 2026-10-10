/** Detached investigation only; never installs a live render override. */
export function renderSurfaceBudget(width, height, resolution, surfaces = 2) {
	if (![width, height, surfaces].every(value => Number.isSafeInteger(value) && value > 0)
		|| !Number.isFinite(resolution) || resolution <= 0) {
		throw new RangeError('Invalid render-surface dimensions.');
	}
	const physicalWidth = Math.ceil(width * resolution);
	const physicalHeight = Math.ceil(height * resolution);
	const bytes = physicalWidth * physicalHeight * 4 * surfaces;
	if (!Number.isSafeInteger(bytes)) throw new RangeError('Render-surface size exceeds safe arithmetic.');
	return { physicalWidth, physicalHeight, surfaces, bytes };
}

export function compareRenderPixels(a, b) {
	if (a.length !== b.length) throw new Error('Pixel buffer dimensions differ.');
	let changedPixels = 0, maxChannelError = 0, totalError = 0;
	for (let i = 0; i < a.length; i += 4) {
		let changed = false;
		for (let j = 0; j < 4; j++) {
			const error = Math.abs(a[i + j] - b[i + j]);
			maxChannelError = Math.max(maxChannelError, error);
			totalError += error;
			changed ||= error > 1;
		}
		if (changed) changedPixels++;
	}
	return { changedPixels, maxChannelError, meanChannelError: totalError / a.length };
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function runDrawingRenderProbe({
	PIXI, renderer, GraphicsClass = PIXI.Graphics, ContainerClass = PIXI.Container, width = 512, height = 512,
	counts = [100, 500, 1000], rounds = 7, frames = 8,
}) {
	if (![width, height].every(value => Number.isInteger(value) && value >= 64 && value <= 1024)
		|| !Array.isArray(counts) || counts.length < 1 || counts.length > 8
		|| counts.some(value => !Number.isInteger(value) || value < 1 || value > 1000)
		|| !Number.isInteger(rounds) || rounds < 3 || rounds > 15
		|| !Number.isInteger(frames) || frames < 1 || frames > 30) {
		throw new RangeError('Probe exceeds detached investigation limits.');
	}
	const gl = renderer.gl;
	const roots = [], targets = [], sprites = [], standaloneTextures = [];
	const target = (targetWidth = width, targetHeight = height) => {
		const texture = PIXI.RenderTexture.create({
			width: targetWidth, height: targetHeight, resolution: 1, multisample: PIXI.MSAA_QUALITY.NONE,
			scaleMode: PIXI.SCALE_MODES.NEAREST,
		});
		targets.push(texture);
		return texture;
	};
	const root = () => {
		const container = new ContainerClass();
		container.sortableChildren = false;
		roots.push(container);
		return container;
	};
	let output, cached, sprite;
	const render = object => renderer.render(object, { renderTexture: output, clear: true });
	const rebuild = object => renderer.render(object, { renderTexture: cached, clear: true });
	const pixels = texture => {
		const mode = texture.baseTexture.alphaMode;
		try {
			texture.baseTexture.alphaMode = PIXI.ALPHA_MODES.NPM;
			return renderer.extract.pixels(texture);
		} finally { texture.baseTexture.alphaMode = mode; }
	};
	const makeStrokes = count => {
		const container = root();
		for (let i = 0; i < count; i++) {
			const shape = new GraphicsClass();
			const x = (i * 73) % (width - 50), y = (i * 97) % (height - 50);
			shape.lineStyle({ width: 1 + i % 7, color: (i * 7919) % 0xffffff, alpha: i % 3 ? 1 : 0.5 });
			shape.moveTo(x, y);
			shape.bezierCurveTo(x + 11, y + 29, x + 27, y - 7, x + 43, y + 19);
			container.addChild(shape);
		}
		return container;
	};
	try {
		output = target();
		cached = target();
		sprite = new PIXI.Sprite(cached);
		sprites.push(sprite);
		const fidelityRoot = makeStrokes(100);
		const text = new PIXI.Text('Detached reference\n50% source alpha', {
			fontFamily: 'sans-serif', fontSize: 18, fill: '#ffffff',
			stroke: '#000000', strokeThickness: 2,
		});
		text.position.set(31.25, 48.75);
		text.alpha = 0.5;
		fidelityRoot.addChild(text);
		const texture = PIXI.Texture.fromBuffer(new Uint8Array([
			255, 0, 0, 255, 0, 255, 0, 128,
			0, 0, 255, 255, 255, 255, 255, 128,
		]), 2, 2);
		standaloneTextures.push(texture);
		const stamp = new PIXI.Sprite(texture);
		stamp.position.set(80.5, 70.25);
		stamp.scale.set(35);
		stamp.angle = 23;
		fidelityRoot.addChild(stamp);
		const fidelity = [];
		for (const scale of [0.2, 1, 2]) {
			fidelityRoot.scale.set(scale);
			fidelityRoot.position.set(0.25, 0.75);
			render(fidelityRoot);
			const expected = pixels(output);
			rebuild(fidelityRoot);
			render(sprite);
			fidelity.push({ scale, ...compareRenderPixels(expected, pixels(output)) });
		}
		fidelityRoot.scale.set(1);
		rebuild(fidelityRoot);
		sprite.scale.set(2);
		render(sprite);
		const scaledCache = pixels(output);
		sprite.scale.set(1);
		fidelityRoot.scale.set(2);
		fidelityRoot.position.set(0.5, 1.5);
		render(fidelityRoot);
		const zoomReuse = compareRenderPixels(pixels(output), scaledCache);
		const tiles = root(), tileSize = 128;
		for (let y = 0; y < height; y += tileSize) {
			for (let x = 0; x < width; x += tileSize) {
				const texture = target(Math.min(tileSize, width - x), Math.min(tileSize, height - y));
				renderer.render(fidelityRoot, {
					renderTexture: texture, clear: true, transform: new PIXI.Matrix(1, 0, 0, 1, -x, -y),
				});
				const tile = new PIXI.Sprite(texture);
				tile.position.set(x, y);
				tiles.addChild(tile);
			}
		}
		render(fidelityRoot);
		const tileExpected = pixels(output);
		render(tiles);
		const tiledFidelity = compareRenderPixels(tileExpected, pixels(output));

		const backdrop = root(), foreground = root(), combined = root(), replay = root();
		const background = new GraphicsClass().beginFill(0x406080).drawRect(0, 0, width, height).endFill();
		backdrop.addChild(background);
		for (const [color, blendMode, x] of [
			[0xff8040, PIXI.BLEND_MODES.MULTIPLY, 12],
			[0x4080ff, PIXI.BLEND_MODES.ADD, 28],
		]) {
			const shape = new GraphicsClass().beginFill(color, 0.75).drawRect(x, 12, 60, 60).endFill();
			shape.blendMode = blendMode;
			foreground.addChild(shape);
		}
		combined.addChild(backdrop, foreground);
		render(combined);
		const blendExpected = pixels(output);
		rebuild(combined);
		render(sprite);
		const wholeBackdropBlend = compareRenderPixels(blendExpected, pixels(output));
		rebuild(foreground);
		replay.addChild(backdrop, sprite);
		render(replay);
		const isolatedBlend = compareRenderPixels(blendExpected, pixels(output));
		replay.removeChild(sprite);
		combined.addChild(backdrop);
		// Each object has one owner; cleanup below uses only top-level roots.
		const timings = [];
		let seed = 0x404;
		const random = () => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed / 0x100000000;
		};
		for (const count of counts) {
			const strokes = makeStrokes(count);
			const samples = { direct: [], reuse: [], rebuild: [] };
			const actions = {
				direct: () => render(strokes),
				reuse: () => render(sprite),
				rebuild: () => { rebuild(strokes); render(sprite); },
			};
			rebuild(strokes);
			for (const action of Object.values(actions)) {
				for (let i = 0; i < 3; i++) action();
			}
			gl.finish();
			for (let round = 0; round < rounds; round++) {
				const order = Object.keys(actions);
				for (let i = order.length - 1; i > 0; i--) {
					const j = Math.floor(random() * (i + 1));
					[order[i], order[j]] = [order[j], order[i]];
				}
				for (const name of order) {
					gl.finish();
					const start = performance.now();
					for (let frame = 0; frame < frames; frame++) actions[name]();
					gl.finish();
					samples[name].push((performance.now() - start) / frames);
				}
			}
			timings.push({ count, millisecondsPerFrame: Object.fromEntries(
				Object.entries(samples).map(([name, values]) => [name, {
					median: median(values), min: Math.min(...values), max: Math.max(...values), samples: values,
				}]),
			) });
			await new Promise(resolve => setTimeout(resolve, 0));
		}
		return {
			pixi: PIXI.VERSION, width, height, rounds, frames,
			knownTargetBudget: {
				surfaces: targets.length,
				bytes: targets.reduce((sum, texture) => sum
					+ renderSurfaceBudget(texture.width, texture.height, 1, 1).bytes, 0),
			},
			fidelity, zoomReuse, tiledFidelity, wholeBackdropBlend, isolatedBlend, timings,
			disclosure: 'Synthetic detached CPU submission plus GPU completion; not live FPS. Target budget excludes geometry, text, assets, driver storage and native canvas targets.',
		};
	} finally {
		for (const container of roots.filter(container => !container.parent)) {
			if (!container.destroyed) container.destroy({ children: true });
		}
		for (const item of sprites) if (!item.destroyed) item.destroy();
		for (const texture of targets) texture.destroy(true);
		for (const texture of standaloneTextures) texture.destroy(true);
	}
}
