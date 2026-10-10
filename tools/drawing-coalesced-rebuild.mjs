import { admitCoalescedScratch } from './drawing-cache-lifecycle.mjs';

/** Sequential scratch ownership; failures must leave the host frame unpublished. */
export function rebuildCoalescedDrawingRegions(plan, dirtyIds, budget, { allocate, render, copy, dispose }) {
	for (const callback of [allocate, render, copy, dispose]) {
		if (typeof callback !== 'function') throw new TypeError('Coalesced rebuild callbacks are required.');
	}
	const admission = admitCoalescedScratch(plan, dirtyIds, budget);
	if (admission.strategy !== 'coalesced') return admission;
	let copiedTiles = 0;
	for (const region of admission.regions) {
		let resource, failure;
		try {
			resource = allocate(region);
			if (!resource || typeof resource.then === 'function') throw new TypeError('Scratch allocation must be synchronous.');
			const result = render(resource, region);
			if (result && typeof result.then === 'function') throw new TypeError('Scratch rendering must be synchronous.');
			for (const tile of plan.tiles) {
				if (tile.x >= region.x && tile.y >= region.y
					&& tile.x + tile.width <= region.x + region.width + 1e-10
					&& tile.y + tile.height <= region.y + region.height + 1e-10) {
					const copied = copy(resource, region, tile);
					if (copied && typeof copied.then === 'function') throw new TypeError('Scratch copying must be synchronous.');
					copiedTiles++;
				}
			}
		} catch (error) {
			failure = error;
			throw error;
		} finally {
			if (resource) {
				try {
					const result = dispose(resource);
					if (result && typeof result.then === 'function') throw new TypeError('Scratch disposal must be synchronous.');
				} catch (error) {
					if (failure) throw new AggregateError([failure, error], 'Coalesced rebuild and cleanup failed.');
					throw error;
				}
			}
		}
	}
	return Object.freeze({ ...admission, copiedTiles });
}

/** Detached targets only. Never extracts/readbacks pixels or changes source Drawing ownership. */
export function copyDrawingScratchTile(PIXI, renderer, scratch, region, target, tile) {
	let texture, sprite;
	try {
		const resolution = scratch.baseTexture.resolution ?? 1;
		if (!Number.isFinite(resolution) || resolution <= 0
			|| ![tile.x, tile.y, tile.width, tile.height, region.x, region.y].every(Number.isFinite)
			|| tile.width <= 0 || tile.height <= 0
			|| Math.round((tile.x - region.x) * resolution) < 0
			|| Math.round((tile.y - region.y) * resolution) < 0
			|| Math.round((tile.x - region.x + tile.width) * resolution) > Math.round(scratch.baseTexture.width * resolution)
			|| Math.round((tile.y - region.y + tile.height) * resolution) > Math.round(scratch.baseTexture.height * resolution)) {
			throw new RangeError('Scratch copy lies outside its source surface.');
		}
		const x = Math.round((tile.x - region.x) * resolution) / resolution;
		const y = Math.round((tile.y - region.y) * resolution) / resolution;
		// Derive edge extents from the actual base size to avoid fractional-resolution overflow.
		const width = Math.min(tile.width, scratch.baseTexture.width - x);
		const height = Math.min(tile.height, scratch.baseTexture.height - y);
		if (!(width > 0 && height > 0)) throw new RangeError('Scratch copy lies outside its source surface.');
		texture = new PIXI.Texture(scratch.baseTexture, new PIXI.Rectangle(
			x, y, width, height,
		));
		sprite = new PIXI.Sprite(texture);
		renderer.render(sprite, { renderTexture: target, clear: true });
	} finally {
		sprite?.destroy();
		texture?.destroy(false);
	}
}
