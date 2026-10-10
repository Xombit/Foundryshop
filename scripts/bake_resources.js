import { classifyTexturePath } from './layers/project_resources.js';
import { inspectOptimizationImage } from './optimization_media.js';
import { fileFingerprint } from './verified_file_storage.js';
import { bakeRasterCapabilities } from './bake_raster.js';

const ownedImages = new WeakMap();

function guard(signal, isCurrent) {
	if (typeof isCurrent !== 'function') throw new Error('Bake resources require an explicit reviewed-context guard.');
	return () => {
		if (signal?.aborted || !game.user?.isGM || !isCurrent()) {
			throw new Error('Bake resource authority/context changed or was cancelled.');
		}
	};
}

/** Retains original bytes independently of the decoded image; no preview/publication admission budgets. */
export async function loadBakeImage(path, {
	signal, isCurrent, acknowledgeExternal = false, timeout = 30000, maxBytes,
} = {}) {
	const check = guard(signal, isCurrent);
	check();
	if (typeof acknowledgeExternal !== 'boolean' || !Number.isSafeInteger(timeout) || timeout < 0
		|| maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) {
		throw new Error('Invalid bake resource consent, timeout or byte budget.');
	}
	const classified = classifyTexturePath(path, location.href);
	if (classified.kind === 'invalid' || classified.kind === 'external' && !acknowledgeExternal) {
		throw new Error('Bake image path is invalid or requires explicit external-resource acknowledgement.');
	}
	const controller = new AbortController(), abort = () => controller.abort();
	signal?.addEventListener('abort', abort, { once: true });
	const timer = timeout ? setTimeout(abort, timeout) : null;
	let bitmap;
	const current = () => {
		check();
		if (controller.signal.aborted) throw new Error('Bake image read cancelled or timed out.');
	};
	try {
		current();
		const response = await fetch(classified.url, { signal: controller.signal, redirect: 'error',
			credentials: classified.kind === 'local' ? 'same-origin' : 'omit', cache: 'no-store', mode: 'cors' });
		if (!response.ok || !response.body?.getReader) {
			await response.body?.cancel();
			current();
			throw new Error(`Bake image read failed: HTTP ${response.status}.`);
		}
		const reader = response.body.getReader(), chunks = [];
		let total = 0;
		try {
			current();
			const length = response.headers.get('content-length'), encoding = response.headers.get('content-encoding');
			if (maxBytes !== undefined && (!encoding || encoding.toLowerCase() === 'identity') && length !== null
				&& /^\d+$/.test(length) && Number(length) > maxBytes) {
				throw new Error('Bake image exceeds the reviewed byte budget.');
			}
			while (true) {
				const { done, value } = await reader.read();
				current();
				if (done) break;
				if (!(value instanceof Uint8Array) || !Number.isSafeInteger(total + value.byteLength)) {
					throw new Error('Bake image stream exceeds safe byte representation or returned invalid bytes.');
				}
				total += value.byteLength;
				if (maxBytes !== undefined && total > maxBytes) throw new Error('Bake image exceeds the reviewed byte budget.');
				chunks.push(value);
			}
			if ((!encoding || encoding.toLowerCase() === 'identity') && length !== null
				&& (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) !== total)) {
				throw new Error('Bake image stream differs from its declared byte length.');
			}
		} finally {
			try { await reader.cancel(); }
			finally { reader.releaseLock(); }
		}
		current();
		const source = new Blob(chunks), bytes = new Uint8Array(await source.arrayBuffer());
		const header = inspectOptimizationImage(bytes);
		const blob = new Blob([source], { type: header.mime });
		if (!Number.isSafeInteger(header.width * header.height * 4)) {
			throw new Error('Bake image decoded buffer exceeds safe-integer representation.');
		}
		const fingerprint = await fileFingerprint(bytes);
		current();
		if (typeof createImageBitmap !== 'function') throw new Error('Bake image decode API is unavailable.');
		bitmap = await createImageBitmap(blob, { imageOrientation: 'none' });
		current();
		if (bitmap.width !== header.width || bitmap.height !== header.height) {
			throw new Error('Bake image decode differs from its exact header dimensions.');
		}
		const decoded = bitmap;
		const resource = Object.freeze({ path, url: classified.url, blob, fingerprint, bytes: total,
			width: header.width, height: header.height, extension: header.extension, mime: header.mime,
			estimate: Object.freeze({ decodedRgbaBytes: header.width * header.height * 4 }),
			destroy() {
				const state = ownedImages.get(resource);
				if (state && !state.closed) { state.closed = true; decoded.close(); }
			} });
		ownedImages.set(resource, { bitmap: decoded, closed: false, visiting: false });
		bitmap = null;
		return resource;
	} finally {
		try { bitmap?.close(); }
		finally {
			if (timer !== null) clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
		}
	}
}

/** Each cropped texture is valid only during visit; oversized inputs never require a giant GPU upload. */
export async function visitBakeImageTiles(resource, visit, { signal, isCurrent, tileAxis = 1024 } = {}) {
	const check = guard(signal, isCurrent), state = ownedImages.get(resource);
	if (!state || state.closed || state.visiting || typeof visit !== 'function') {
		throw new Error('Bake image tile visits require an owned open image, exclusive access and a callback.');
	}
	check();
	const renderer = canvas.app?.renderer, capabilities = bakeRasterCapabilities(renderer, tileAxis);
	const current = () => {
		check();
		if (state.closed || renderer !== canvas.app?.renderer || renderer.gl.isContextLost()) {
			throw new Error('Bake image tile renderer/resource changed or lost its GPU context.');
		}
	};
	state.visiting = true;
	try {
		for (let y = 0; y < resource.height; y += capabilities.tileAxis) {
			for (let x = 0; x < resource.width; x += capabilities.tileAxis) {
				current();
				const width = Math.min(capabilities.tileAxis, resource.width - x);
				const height = Math.min(capabilities.tileAxis, resource.height - y);
				let bitmap, base, texture;
				try {
					bitmap = await createImageBitmap(state.bitmap, x, y, width, height, { imageOrientation: 'none' });
					current();
					if (bitmap.width !== width || bitmap.height !== height) throw new Error('Bake image crop dimensions changed.');
					base = new PIXI.BaseTexture(bitmap);
					texture = new PIXI.Texture(base);
					if (!texture.valid || texture.width !== width || texture.height !== height) {
						throw new Error('Bake image GPU tile texture is invalid or changed dimensions.');
					}
					await visit({ texture, x, y, width, height, imageWidth: resource.width, imageHeight: resource.height });
					current();
				} finally {
					try {
						if (texture) texture.destroy(true);
						else base?.destroy();
					} finally { bitmap?.close(); }
				}
				await new Promise(resolve => setTimeout(resolve, 0));
				current();
			}
		}
		return capabilities;
	} finally { state.visiting = false; }
}

/** CPU canvas sampling uses the full bitmap, avoiding artificial crop edges and oversized GPU textures. */
export function paintBakeImage(resource, context, destination, { signal, isCurrent } = {}) {
	const check = guard(signal, isCurrent), state = ownedImages.get(resource);
	check();
	if (!state || state.closed || state.visiting || typeof context?.drawImage !== 'function'
		|| !destination || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(destination[key]))
		|| destination.width <= 0 || destination.height <= 0) {
		throw new Error('Bake image painting requires an owned open exclusive image and finite positive destination.');
	}
	context.drawImage(state.bitmap, destination.x, destination.y, destination.width, destination.height);
	check();
}

/** Full-image GPU lease only when actual input axes fit; never rescales oversized Drawing textures. */
export function acquireBakeImageTexture(resource, { signal, isCurrent } = {}) {
	const check = guard(signal, isCurrent), state = ownedImages.get(resource);
	check();
	const renderer = canvas.app?.renderer, capabilities = bakeRasterCapabilities(renderer);
	if (!state || state.closed || state.visiting) throw new Error('Bake texture requires an owned open exclusive image.');
	if (resource.width > capabilities.textureAxis || resource.height > capabilities.textureAxis) {
		throw new Error('Bake Drawing input exceeds actual GPU texture axes; tiled material/stamp mapping is not implemented.');
	}
	let base, texture, closed = false;
	try {
		base = new PIXI.BaseTexture(state.bitmap);
		texture = new PIXI.Texture(base);
		if (!texture.valid || texture.width !== resource.width || texture.height !== resource.height) {
			throw new Error('Bake Drawing texture dimensions/validity differ from its preserved source.');
		}
		return Object.freeze({ texture,
			assertCurrent() {
				check();
				if (closed || state.closed || state.visiting || !texture.valid
					|| canvas.app?.renderer !== renderer || renderer.gl.isContextLost()) {
					throw new Error('Bake Drawing texture resource/renderer changed or closed.');
				}
				return true;
			},
			destroy() { if (!closed) { closed = true; texture.destroy(true); } },
		});
	} catch (error) {
		if (texture) texture.destroy(true);
		else base?.destroy();
		throw error;
	}
}
