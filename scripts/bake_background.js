import { validatePublicationBackground } from './publication_background.js';
import { renderBakeRaster, bakeRasterDimensions } from './bake_raster.js';
import { paintBakeImage } from './bake_resources.js';

const identity = { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0,
	fit: 'fill', scaleX: 1, scaleY: 1, rotation: 0 };

/** Full-scene identity background only; shared Level transforms are not changed or approximated. */
export async function renderBakeBackground({
	background, image, buildDisplay, isCurrent, signal, format = 'webp', quality = 0.9, tileAxis = 1024, onProgress,
} = {}) {
	const input = validatePublicationBackground(background);
	bakeRasterDimensions(input.rect);
	if (Object.keys(identity).some(key => input.transform[key] !== identity[key])
		|| Object.keys(input.transform).some(key => !Object.hasOwn(identity, key))) {
		throw new Error('Bake background requires reviewed identity shared Level texture transforms.');
	}
	if (input.texture.src ? image?.path !== input.texture.src : image != null) {
		throw new Error('Bake background image must match the exact reviewed source path; color-only backgrounds require no image.');
	}
	if (typeof isCurrent !== 'function') throw new Error('Bake background requires an explicit reviewed-context guard.');
	const tint = input.texture.tint.slice(1).match(/../g).map(channel => parseInt(channel, 16));
	const result = await renderBakeRaster({ bounds: input.rect, buildDisplay, isCurrent, signal, format, quality, tileAxis, onProgress,
		paintUnderlay(context, tile) {
			if (image) {
				paintBakeImage(image, context, { x: input.rect.x - tile.x, y: input.rect.y - tile.y,
					width: input.rect.width, height: input.rect.height }, { signal, isCurrent });
				if (tint.some(channel => channel !== 255)) {
					const pixels = context.getImageData(0, 0, tile.width, tile.height);
					for (let i = 0; i < pixels.data.length; i += 4) {
						for (let channel = 0; channel < 3; channel++) {
							pixels.data[i + channel] = Math.round(pixels.data[i + channel] * tint[channel] / 255);
						}
					}
					context.putImageData(pixels, 0, 0);
				}
			}
			context.globalCompositeOperation = 'destination-over';
			context.fillStyle = input.texture.color;
			context.fillRect(0, 0, tile.width, tile.height);
		},
	});
	return { ...result, background: input, originalImage: image ?? null };
}
