import { unpremultiplyPublicationPixels } from './artwork_renderer.js';
import { inspectOptimizationImage } from './optimization_media.js';

let busy = false;

/** Full reviewed pixel resolution; memory is advisory, not an admission budget. */
export function bakeRasterDimensions(bounds) {
	if (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))
		|| !Number.isSafeInteger(bounds.width) || !Number.isSafeInteger(bounds.height)
		|| bounds.width <= 0 || bounds.height <= 0) throw new Error('Bake raster requires finite bounds and positive integer reviewed pixel dimensions.');
	const width = bounds.width, height = bounds.height, pixels = width * height;
	if (![width, height, pixels, pixels * 4].every(Number.isSafeInteger)) {
		throw new Error('Bake raster dimensions exceed JavaScript safe-integer representation.');
	}
	return { width, height, pixels, rgbaBytes: pixels * 4 };
}

export function bakeRasterCapabilities(renderer, requestedTileAxis = 1024) {
	if (!renderer?.gl || typeof renderer.render !== 'function' || typeof renderer.extract?.pixels !== 'function'
		|| renderer.gl.isContextLost() || !Number.isSafeInteger(requestedTileAxis) || requestedTileAxis < 1) {
		throw new Error('Bake raster requires an available WebGL renderer and a positive tile size.');
	}
	const gl = renderer.gl;
	const texture = gl.getParameter(gl.MAX_TEXTURE_SIZE), renderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
	const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
	if (![texture, renderbuffer, viewport?.[0], viewport?.[1]].every(value => Number.isSafeInteger(value) && value > 0)) {
		throw new Error('Bake raster GPU dimension capabilities could not be verified.');
	}
	return { textureAxis: texture, renderbufferAxis: renderbuffer, viewport: [...viewport],
		tileAxis: Math.min(requestedTileAxis, texture, renderbuffer, ...viewport) };
}

/** Sequential tiled GPU extraction avoids a full-output render target; browser encoding still uses a full canvas. */
export async function renderBakeRaster({
	bounds, format = 'webp', quality = 0.9, tileAxis = 1024, signal, isCurrent,
	buildDisplay, onProgress, paintUnderlay,
} = {}) {
	const size = bakeRasterDimensions(bounds);
	const crop = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, bounds[key]]));
	if (!['png', 'webp'].includes(format) || !Number.isFinite(quality) || quality < 0 || quality > 1
		|| typeof isCurrent !== 'function' || typeof buildDisplay !== 'function'
		|| onProgress !== undefined && typeof onProgress !== 'function'
		|| paintUnderlay !== undefined && typeof paintUnderlay !== 'function') {
		throw new Error('Bake raster requires explicit display/context guards and PNG or WEBP encoding options.');
	}
	const renderer = canvas.app?.renderer, capabilities = bakeRasterCapabilities(renderer, tileAxis);
	const check = () => {
		if (!game.user?.isGM || signal?.aborted || !isCurrent() || canvas.app?.renderer !== renderer
			|| renderer.gl.isContextLost()) throw new Error('Bake raster authority/context changed, cancelled or lost its GPU context.');
	};
	check();
	if (busy) throw new Error('A bake raster job is already using this client renderer.');
	busy = true;
	let root, image, target, bitmap, tileImage, overlayImage;
	try {
		image = document.createElement('canvas');
		image.width = size.width; image.height = size.height;
		if (image.width !== size.width || image.height !== size.height) throw new Error('Browser canvas cannot allocate reviewed full bake dimensions.');
		const context = image.getContext('2d');
		if (!context) throw new Error('Browser canvas allocation failed for full-size bake output.');
		if (paintUnderlay) {
			tileImage = document.createElement('canvas');
			overlayImage = document.createElement('canvas');
		}
		const display = await buildDisplay();
		if (display?.parent) throw new Error('Bake display cannot borrow an attached live canvas container.');
		root = display;
		check();
		if (!root || typeof root.destroy !== 'function' || root.parent || root.children === undefined
			|| root.rotation !== 0 || root.alpha !== 1 || root.scale?.x !== 1 || root.scale?.y !== 1
			|| root.pivot?.x !== 0 || root.pivot?.y !== 0 || root.position?.x !== 0 || root.position?.y !== 0
			|| typeof root.position?.set !== 'function') {
			throw new Error('Bake display must be an owned detached neutral scene-coordinate container.');
		}
		const axis = capabilities.tileAxis;
		const tiles = Math.ceil(size.width / axis) * Math.ceil(size.height / axis);
		let completed = 0;
		for (let y = 0; y < size.height; y += axis) {
			for (let x = 0; x < size.width; x += axis) {
				check();
				const width = Math.min(axis, size.width - x), height = Math.min(axis, size.height - y);
				root.position.set(-crop.x - x, -crop.y - y);
				target = PIXI.RenderTexture.create({ width, height, resolution: 1 });
				renderer.render(root, { renderTexture: target, clear: true });
				check();
				const alphaMode = target.baseTexture.alphaMode;
				let pixels;
				try {
					target.baseTexture.alphaMode = PIXI.ALPHA_MODES.NPM;
					pixels = renderer.extract.pixels(target);
				} finally { target.baseTexture.alphaMode = alphaMode; }
				if (!(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) {
					throw new Error('Bake raster tile extraction returned incomplete pixels.');
				}
				const drawingPixels = new ImageData(unpremultiplyPublicationPixels(pixels), width, height);
				if (paintUnderlay) {
					tileImage.width = overlayImage.width = width;
					tileImage.height = overlayImage.height = height;
					const tileContext = tileImage.getContext('2d', { willReadFrequently: true });
					const overlayContext = overlayImage.getContext('2d');
					if (!tileContext || !overlayContext) throw new Error('Browser canvas allocation failed for bake compositing tiles.');
					tileContext.save();
					try { await paintUnderlay(tileContext, { x: crop.x + x, y: crop.y + y, width, height }); }
					finally { tileContext.restore(); }
					check();
					overlayContext.putImageData(drawingPixels, 0, 0);
					tileContext.drawImage(overlayImage, 0, 0);
					context.drawImage(tileImage, x, y);
				} else context.putImageData(drawingPixels, x, y);
				target.destroy(true); target = null;
				completed++;
				onProgress?.({ completed, tiles, width: size.width, height: size.height });
				await new Promise(resolve => setTimeout(resolve, 0));
			}
		}
		check();
		const blob = await new Promise((resolve, reject) => image.toBlob(value => value
			? resolve(value) : reject(new Error('Full-size bake encoder returned no image.')), `image/${format}`, quality));
		check();
		if (blob.type !== `image/${format}`) throw new Error('Browser bake encoder substituted an unsupported output format.');
		const bytes = new Uint8Array(await blob.arrayBuffer()), header = inspectOptimizationImage(bytes);
		if (header.width !== size.width || header.height !== size.height || header.extension !== format) {
			throw new Error('Bake encoder changed the reviewed format or dimensions.');
		}
		bitmap = await createImageBitmap(blob, { imageOrientation: 'none' });
		check();
		if (bitmap.width !== size.width || bitmap.height !== size.height) throw new Error('Full-size encoded bake failed dimension/decode verification.');
		return { blob, width: size.width, height: size.height, bounds: crop, capabilities,
			estimate: { outputRgbaBytes: size.rgbaBytes, tileRgbaBytes: axis * axis * 4,
				compositingRgbaBytes: paintUnderlay ? axis * axis * 8 : 0,
				disclosure: 'Advisory buffer sizes only; graph/textures, browser canvas and encoder may consume additional memory.' } };
	} finally {
		try {
			try { bitmap?.close(); }
			finally {
				try { target?.destroy(true); }
				finally { if (typeof root?.destroy === 'function') root.destroy({ children: true }); }
			}
		}
		finally {
			if (image) { image.width = 1; image.height = 1; }
			if (tileImage) { tileImage.width = 1; tileImage.height = 1; }
			if (overlayImage) { overlayImage.width = 1; overlayImage.height = 1; }
			busy = false;
		}
	}
}
