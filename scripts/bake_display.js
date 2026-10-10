import { acceptOptimizationImage } from './optimization_media.js';
import { bakeRasterCapabilities } from './bake_raster.js';
import { validateStoredFile } from './verified_file_storage.js';

const backgroundTransform = { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0,
	fit: 'fill', scaleX: 1, scaleY: 1, rotation: 0 };

/** Image stamps use the existing rectangle-to-full-texture Drawing renderer. */
export async function verifyConsolidationDisplay(input, options = {}) {
	const { replacement, output, width, height } = input, file = validateStoredFile(output);
	if (replacement?.type !== 'Drawing' || [replacement.staged, replacement.after].some(source =>
		source?.texture !== file.path || source.shape?.type !== 'r'
		|| source.shape.width !== width || source.shape.height !== height
		|| source.flags?.foundryshop?.imageStamp !== 1 || source.fillType !== 2
		|| source.fillColor?.toLowerCase() !== '#ffffff' || source.fillAlpha !== 1
		|| source.strokeWidth !== 0 || source.rotation !== 0 || source.text !== '')) {
		throw new Error('Consolidate display requires the exact neutral full-image Drawing mapping.');
	}
	return verifyBakeImageDisplay(input, options);
}

/** Full-resolution capability acceptance for the neutral full-Scene Level background mapping. */
export async function verifyBakeBackgroundDisplay(input, options = {}) {
	const { replacement, output } = input;
	const file = validateStoredFile(output);
	if (replacement?.type !== 'LevelBackground' || replacement.after?.background?.src !== file.path
		|| String(replacement.after.background.color).toLowerCase() !== '#ffffff'
		|| String(replacement.after.background.tint).toLowerCase() !== '#ffffff'
		|| Object.keys(replacement.after.textures ?? {}).length !== Object.keys(backgroundTransform).length
		|| Object.entries(backgroundTransform).some(([key, value]) => replacement.after.textures[key] !== value)) {
		throw new Error('Background display requires an exact neutral Level replacement.');
	}
	return verifyBakeImageDisplay(input, options);
}

/** Actual full-image GPU upload in an owned renderer; never borrows or changes the live renderer's GL state. */
export async function verifyBakeTileDisplay(input, options = {}) {
	const { output, replacement, width, height } = input;
	if (replacement?.type !== 'Tile') {
		throw new Error('Tile display acceptance requires exact image bytes, native Tile sources and a context guard.');
	}
	const file = validateStoredFile(output);
	for (const source of [replacement.staged, replacement.after]) {
		if (source?.texture?.src !== file.path || source.width !== width || source.height !== height
			|| source.texture.anchorX !== 0 || source.texture.anchorY !== 0
			|| source.texture.scaleX !== 1 || source.texture.scaleY !== 1 || source.texture.fit !== 'fill') {
			throw new Error('Tile display bytes/dimensions differ from the exact neutral native replacement.');
		}
	}
	return verifyBakeImageDisplay(input, options);
}

async function verifyBakeImageDisplay({ blob, output, width, height }, { isCurrent, signal } = {}) {
	if (typeof isCurrent !== 'function' || !(blob instanceof Blob)) {
		throw new Error('Bake display acceptance requires exact image bytes and a context guard.');
	}
	const file = validateStoredFile(output), live = canvas.app?.renderer;
	const check = () => {
		if (!game.user?.isGM || signal?.aborted || !isCurrent() || canvas.app?.renderer !== live
			|| live?.gl?.isContextLost()) throw new Error('Bake display authority/context changed, cancelled or lost its GPU context.');
		return true;
	};
	check();
	const capabilities = bakeRasterCapabilities(live);
	if (width > capabilities.textureAxis || height > capabilities.textureAxis) {
		throw new Error(`Native Bake image ${width} x ${height} exceeds this client GPU texture axis ${capabilities.textureAxis}; no downsampling is permitted.`);
	}
	await acceptOptimizationImage(new Uint8Array(await blob.arrayBuffer()), file, { width, height },
		{ isCurrent: check, signal });
	let bitmap, renderer, base, texture, sprite;
	try {
		bitmap = await createImageBitmap(blob, { imageOrientation: 'none' });
		check();
		if (bitmap.width !== width || bitmap.height !== height) throw new Error('Bake display decode dimensions changed.');
		renderer = new PIXI.Renderer({ width: 1, height: 1, resolution: 1, antialias: false,
			backgroundAlpha: 0, preserveDrawingBuffer: true });
		const gl = renderer.gl, axis = gl.getParameter(gl.MAX_TEXTURE_SIZE);
		if (!Number.isSafeInteger(axis) || width > axis || height > axis || gl.isContextLost()) {
			throw new Error('Isolated native texture renderer cannot allocate the exact full image.');
		}
		if (gl.getError() !== gl.NO_ERROR) throw new Error('Isolated Bake renderer initialization reported a GPU error.');
		base = new PIXI.BaseTexture(bitmap, { resolution: 1 });
		texture = new PIXI.Texture(base);
		if (!texture.valid || texture.width !== width || texture.height !== height) {
			throw new Error('Native Bake texture dimensions were normalized or are invalid.');
		}
		sprite = new PIXI.Sprite(texture);
		// A tiny target exercises sampling; the uploaded source texture remains full resolution.
		sprite.width = 1; sprite.height = 1;
		renderer.render(sprite, { clear: true });
		check();
		if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw new Error('Full-image Bake GPU upload/sampling failed.');
		const pixels = renderer.extract.pixels();
		if (!(pixels instanceof Uint8Array) || pixels.length !== 4 || gl.isContextLost() || gl.getError() !== gl.NO_ERROR) {
			throw new Error('Isolated native Bake sampling/readback failed.');
		}
		return true;
	} finally {
		try { sprite?.destroy({ texture: false, baseTexture: false }); }
		finally {
			try { if (texture) texture.destroy(true); else base?.destroy(); }
			finally {
				try { renderer?.destroy(true); }
				finally { bitmap?.close(); }
			}
		}
	}
}
