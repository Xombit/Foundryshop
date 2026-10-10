export function pixelRegion(screenX, screenY, size, bounds, width, height, resolution) {
	if (!Number.isInteger(size) || size < 1 || bounds.width <= 0 || bounds.height <= 0
		|| width < 1 || height < 1 || !Number.isFinite(resolution) || resolution <= 0) {
		throw new Error('Invalid canvas sampling dimensions.');
	}
	const x = Math.floor((screenX - bounds.left) * width / bounds.width);
	const y = Math.floor((screenY - bounds.top) * height / bounds.height);
	const offset = Math.floor(size / 2);
	// PIXI expects a bottom-left framebuffer region, then flips the extracted rows.
	return {
		x: (x - offset) / resolution,
		y: (height - y - offset - 1) / resolution,
		width: size / resolution,
		height: size / resolution,
	};
}
