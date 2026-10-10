import { bakeRasterDimensions, bakeRasterCapabilities, renderBakeRaster } from './bake_raster.js';
import { renderBakeBackground } from './bake_background.js';
import { withBakeDrawingResources } from './bake_drawings.js';
import { canonicalJson } from './layers/project_package.js';
import { fileFingerprint } from './verified_file_storage.js';

function measure(root, ids) {
	if (root.parent || root.children.length !== ids.length) throw new Error('Bake bounds require an owned graph matching exact source identities.');
	return root.children.map((graphic, index) => {
		const bounds = graphic.getBounds();
		if (!bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))
			|| bounds.width < 0 || bounds.height < 0
			|| ![bounds.x + bounds.width, bounds.y + bounds.height].every(Number.isFinite)) {
			throw new Error(`Drawing ${ids[index]} has unverified rendered bounds.`);
		}
		return { id: ids[index], bounds: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, bounds[key]])) };
	});
}

export function reviewBakeBounds(entries, bounds) {
	if (!Array.isArray(entries) || !entries.length || entries.some(entry => !entry?.bounds
		|| !['x', 'y', 'width', 'height'].every(key => Number.isFinite(entry.bounds[key]))
		|| entry.bounds.width < 0 || entry.bounds.height < 0
		|| ![entry.bounds.x + entry.bounds.width, entry.bounds.y + entry.bounds.height].every(Number.isFinite))
		|| entries.some(entry => typeof entry.id !== 'string') || new Set(entries.map(entry => entry.id)).size !== entries.length) {
		throw new Error('Bake crop review requires exact unique sources and finite rendered bounds.');
	}
	const union = entries.reduce((result, { bounds: source }) => ({
		left: Math.min(result.left, source.x), top: Math.min(result.top, source.y),
		right: Math.max(result.right, source.x + source.width), bottom: Math.max(result.bottom, source.y + source.height),
	}), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
	const left = Math.floor(union.left), top = Math.floor(union.top);
	const right = Math.ceil(union.right), bottom = Math.ceil(union.bottom);
	const extent = { x: left, y: top, width: right - left, height: bottom - top };
	const crop = structuredClone(bounds ?? extent), size = bakeRasterDimensions(crop);
	if (![crop.x + crop.width, crop.y + crop.height].every(Number.isFinite)) throw new Error('Bake crop endpoints overflow.');
	return { bounds: crop, extent, width: size.width, height: size.height, outputRgbaBytes: size.rgbaBytes,
		croppedSourceIds: entries.filter(({ bounds: source }) => source.x < crop.x || source.y < crop.y
			|| source.x + source.width > crop.x + crop.width || source.y + source.height > crop.y + crop.height)
			.map(entry => entry.id).sort(),
		fullyOutsideSourceIds: entries.filter(({ bounds: source }) =>
			source.x + source.width <= crop.x || source.y + source.height <= crop.y
			|| source.x >= crop.x + crop.width || source.y >= crop.y + crop.height).map(entry => entry.id).sort() };
}

/** Read-only preparation-to-encoding transaction. This does not upload, journal or remove any source. */
export async function renderReviewedBake(sources, {
	bounds, background, image, destination, approveReview, isCurrent, signal, format = 'webp', quality = 0.9, tileAxis = 1024,
	acknowledgeExternal = false, timeout = 30000, onProgress,
} = {}) {
	if (typeof approveReview !== 'function' || typeof isCurrent !== 'function'
		|| !['png', 'webp'].includes(format) || !Number.isFinite(quality) || quality < 0 || quality > 1
		|| destination !== undefined && (!['tile', 'background', 'drawing'].includes(destination)
			|| (destination === 'background') !== !!background)) {
		throw new Error('Reviewed bake requires exact encoding options and explicit review/context callbacks.');
	}
	const capturedBounds = bounds === undefined ? undefined : structuredClone(bounds);
	const capturedBackground = background === undefined ? undefined : structuredClone(background);
	if (capturedBackground && capturedBounds !== undefined
		&& ['x', 'y', 'width', 'height'].some(key => capturedBounds[key] !== capturedBackground.rect?.[key])) {
		throw new Error('Background render review must use the exact full Scene rectangle.');
	}
	const renderer = canvas.app?.renderer;
	const check = () => {
		if (!game.user?.isGM || signal?.aborted || !isCurrent() || canvas.app?.renderer !== renderer
			|| renderer.gl.isContextLost()) throw new Error('Reviewed bake authority/context changed or was cancelled.');
		return true;
	};
	check();
	if (!Array.isArray(sources)) throw new Error('Reviewed bake requires exact Drawing sources.');
	const capturedSources = structuredClone(sources);
	const sourceDigest = await fileFingerprint(new TextEncoder().encode(canonicalJson(
		[...capturedSources].sort((a, b) => a._id < b._id ? -1 : a._id > b._id ? 1 : 0))));
	check();
	return withBakeDrawingResources(capturedSources, async prepared => {
		let root = prepared.buildDisplay();
		try {
			const entries = measure(root, prepared.review.sourceIds);
			const coverage = reviewBakeBounds(entries, capturedBackground?.rect ?? capturedBounds);
			const capabilities = bakeRasterCapabilities(renderer, tileAxis);
			const review = { ...coverage, sources: entries, ...prepared.review,
				destination: destination ?? (capturedBackground ? 'background' : 'tile'), format, quality, capabilities,
				disclosure: 'Rendered bounds are conservative, not pixel coverage. Cropped sources may lose ink in output; originals remain recoverable only after durable archive wiring. Buffer sizes are advisory, not peak memory.' };
			const approval = await approveReview(structuredClone(review));
			check();
			if (!approval || approval.proceed !== true || approval.width !== review.width || approval.height !== review.height
				|| approval.format !== format || approval.quality !== quality
				|| !Array.isArray(approval.croppedSourceIds)
				|| JSON.stringify([...approval.croppedSourceIds].sort()) !== JSON.stringify(coverage.croppedSourceIds)) {
				throw new Error('Approve exact output dimensions, encoding and listed cropped source identities before rendering.');
			}
			root.destroy({ children: true }); root = prepared.buildDisplay();
			if (JSON.stringify(measure(root, prepared.review.sourceIds)) !== JSON.stringify(entries)) {
				throw new Error('Rendered source bounds changed after review; review again.');
			}
			const options = { buildDisplay: () => root, isCurrent: check, signal, format, quality, tileAxis, onProgress };
			const result = capturedBackground
				? await renderBakeBackground({ ...options, background: capturedBackground, image })
				: await renderBakeRaster({ ...options, bounds: coverage.bounds });
			check();
			return { ...result, sourceDigest, review: structuredClone(review) };
		} finally { if (root && !root.destroyed) root.destroy({ children: true }); }
	}, { signal, isCurrent: check, acknowledgeExternal, timeout });
}
