import { MODULE } from './constants.js';
import { materialFillStyle } from './material_fill.js';
import { exportProjectDrawing } from './layers/project_transfer_service.js';
import { readLayerTree } from './layers/layer_manager.js';
import { layerSubtreeIds } from './layers/layer_tree_store.js';
import { PROJECT_FORMAT, PROJECT_VERSION, validateProjectPackage, canonicalJson } from './layers/project_package.js';
import { inspectProjectResources, assertProjectResources, availableProjectFonts } from './layers/project_resources.js';
import { imageHeader, imageStampFillStyle, STAMP_LIMITS } from './artwork_stamps.js';
import { validatePublicationBackground, buildPublicationBackground } from './publication_background.js';
import { assertNoPendingPathOperation } from './path_operation_guard.js';

export const ARTWORK_RENDER_VERSION = 1;
export const PREVIEW_LIMITS = Object.freeze({
	minSize: 32, maxSize: 512, drawings: 1000, points: 100000, snapshotBytes: 4 * 1024 * 1024,
	textures: 16, textureAxis: 4096, texturePixels: 16000000, curveSegments: 250000, textChars: 8192, textAxis: 8192,
	encodedBytes: 256 * 1024, cacheEntries: 64, cacheBytes: 8 * 1024 * 1024, cacheMs: 30000, queue: 32,
});
const cache = new Map();
let cachedBytes = 0;
let queue = Promise.resolve();
let waiting = 0;
const loc = key => game.i18n.localize(`FOUNDRYSHOP.Preview.${key}`);
const error = key => new Error(loc(key));
const checkAbort = signal => { if (signal?.aborted) throw new DOMException('Preview cancelled.', 'AbortError'); };

export function clearArtworkPreviewCache() {
	cache.clear();
	cachedBytes = 0;
}

export function layerArtworkSnapshot(scene, nodeId, levelId) {
	assertNoPendingPathOperation(scene);
	if (!game.user.isGM || !scene || !scene.levels?.has(levelId)) throw error('NoAccess');
	const tree = readLayerTree(scene);
	const members = layerSubtreeIds(tree, nodeId);
	return [...scene.drawings.values()].filter(drawing => members.has(drawing.getFlag(MODULE, 'layerId'))
		&& (drawing.levels?.has?.(levelId) || drawing.levels?.includes?.(levelId))
		&& !drawing.getFlag(MODULE, 'importStaging')).map(exportProjectDrawing);
}

export function prepareArtworkSnapshot(entries) {
	if (!Array.isArray(entries) || entries.length > PREVIEW_LIMITS.drawings) throw error('Limit');
	const points = entries.reduce((total, entry) => total + (entry?.data?.shape?.points?.length ?? 0), 0);
	if (points > PREVIEW_LIMITS.points || new TextEncoder().encode(JSON.stringify(entries)).length > PREVIEW_LIMITS.snapshotBytes) {
		throw error('Limit');
	}
	const project = validateProjectPackage({
		format: PROJECT_FORMAT, version: PROJECT_VERSION, scope: 'full', coordinateSpace: 'scene-pixels', name: 'Artwork preview',
		source: { foundry: game.version, drawingSchema: getDocumentClass('Drawing').metadata.schemaVersion },
		tree: { version: 1, revision: 0, nodes: [], presets: [] },
		drawings: entries.map(entry => {
			const drawing = structuredClone(entry);
			if (drawing.data.flags?.foundryshop) delete drawing.data.flags.foundryshop.path;
			return { ...drawing, layerId: null };
		}), recovery: [], bounds: null, dependencies: {},
	});
	if (project.dependencies.assets.length > PREVIEW_LIMITS.textures) throw error('Limit');
	if (new Set(project.drawings.map(({ data }) => `${data.elevation}:${data.interface}`)).size > 1) throw error('MixedOrder');
	let segments = 0;
	for (const { data } of project.drawings) {
		if (!['r', 'e', 'p'].includes(data.shape.type) || (data.shape.type === 'p' && data.shape.points.length < 4)) throw error('Geometry');
		if (![0, 1, 2].includes(data.fillType) || data.bezierFactor < 0 || data.bezierFactor > 1
			|| [data.fillAlpha, data.strokeAlpha, data.textAlpha].some(value => value < 0 || value > 1)) throw error('Style');
		if (data.text && (data.text.length > PREVIEW_LIMITS.textChars || data.fontSize < 8 || data.fontSize > 256
			|| data.shape.width > PREVIEW_LIMITS.textAxis)) throw error('TextLimit');
		if ([data.fillColor, data.strokeColor, data.textColor].some(value => !/^#[0-9a-f]{6}$/i.test(value))) throw error('Style');
		if (data.shape.type === 'p' && data.bezierFactor > 0) {
			const points = data.shape.points;
			for (let i = 0; i < points.length; i += 2) {
				const next = (i + 2) % points.length;
				const distance = Math.hypot(points[next] - points[i], points[next + 1] - points[i + 1]);
				segments += Math.min(2048, Math.max(8, Math.ceil(distance * 4 / 10)));
			}
			if (segments > PREVIEW_LIMITS.curveSegments) throw error('Limit');
		}
	}
	project.drawings.sort((a, b) => a.data.sort - b.data.sort || a.id.localeCompare(b.id));
	return project;
}

export function fitArtworkBounds(bounds, width, height, padding = 4) {
	if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
		|| bounds.width < 0 || bounds.height < 0 || padding * 2 >= Math.min(width, height)) throw error('Bounds');
	const scale = Math.min((width - padding * 2) / Math.max(bounds.width, 1), (height - padding * 2) / Math.max(bounds.height, 1));
	return { scale, x: (width - bounds.width * scale) / 2 - bounds.x * scale,
		y: (height - bounds.height * scale) / 2 - bounds.y * scale };
}

/** Pure scene construction: no native PlaceableObjects, hooks or live canvas groups. */
export function buildArtworkDisplay(project, textures = new Map(), { publication = false, nativeHidden = false, nativeText = false } = {}) {
	const root = new PIXI.Container();
	const PreciseText = foundry.canvas.containers.PreciseText;
	try {
		for (const { data } of project.drawings) {
			const graphic = new PIXI.Graphics();
			root.addChild(graphic);
			const { width, height, points } = data.shape;
			const imageStamp = data.flags.foundryshop?.imageStamp === 1;
			const texture = textures.get(data.texture);
			const alpha = nativeHidden && data.hidden ? 0.5 : 1;
			graphic.lineStyle({ width: data.strokeWidth, color: data.strokeColor, alpha: data.strokeAlpha * alpha });
			let fill = { color: data.fillColor, alpha: data.fillType ? data.fillAlpha * alpha : 0 };
			if (data.fillType === 2 && data.texture) {
				if (!texture?.valid) throw error('Texture');
				fill.texture = texture;
			}
			if (imageStamp) fill = imageStampFillStyle(data.shape, texture, fill);
			else fill = materialFillStyle(data, texture, fill);
			graphic.beginTextureFill(fill);
			if (data.shape.type === 'r') graphic.drawRect(data.strokeWidth / 2, data.strokeWidth / 2,
				Math.max(width - data.strokeWidth, 0), Math.max(height - data.strokeWidth, 0));
			else if (data.shape.type === 'e') graphic.drawEllipse(width / 2, height / 2,
				Math.max(width - data.strokeWidth, 0) / 2, Math.max(height - data.strokeWidth, 0) / 2);
			else {
				const closed = data.fillType || (points[0] === points.at(-2) && points[1] === points.at(-1));
				const method = closed ? 'drawSmoothedPolygon' : 'drawSmoothedPath';
				if (typeof graphic[method] !== 'function') throw error('Renderer');
				graphic[method](points, data.bezierFactor * 2);
			}
			graphic.endFill();
			graphic.line.reset();
			graphic.position.set(data.x + width / 2, data.y + height / 2);
			graphic.pivot.set(width / 2, height / 2);
			graphic.angle = data.rotation;
			if (data.text) {
				const style = CONFIG.Drawing.objectClass.prototype._getTextStyle.call({ document: data });
				const text = new PreciseText(data.text, style);
				graphic.addChild(text);
				// Preview/publication bounds text sampling; Bake preserves native PreciseText resolution.
				if (!nativeText) text.resolution = publication ? 1 : Math.min(2, 2048 / Math.max(width, data.text.length * data.fontSize, 1));
				text.position.set(width / 2, height / 2);
				text.anchor.set(0.5);
				text.alpha = data.textAlpha;
			}
		}
		return root;
	} catch (failure) { root.destroy({ children: true }); throw failure; }
}

async function fingerprint(project, options) {
	const text = canonicalJson({ version: ARTWORK_RENDER_VERSION, drawings: project.drawings, ...options,
		fonts: availableProjectFonts(), defaultFont: CONFIG.defaultFontFamily,
		textStyle: CONFIG.canvasTextStyle?.toJSON?.() ?? null });
	// Exact cache identity does not require Web Crypto on HTTP installations.
	if (!globalThis.crypto?.subtle) return text;
	const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function remember(key, result) {
	const cost = result.src.length * 2 + key.length * 2 + 256;
	if (cost > PREVIEW_LIMITS.cacheBytes) return;
	while (cache.size >= PREVIEW_LIMITS.cacheEntries || cachedBytes + cost > PREVIEW_LIMITS.cacheBytes) {
		const first = cache.keys().next().value;
		cachedBytes -= cache.get(first).cost; cache.delete(first);
	}
	cache.set(key, { result, cost, expires: Date.now() + PREVIEW_LIMITS.cacheMs });
	cachedBytes += cost;
}

function previewOptions(options) {
	const width = options.width ?? 96, height = options.height ?? 96, padding = options.padding ?? 4;
	if (![width, height].every(value => Number.isInteger(value) && value >= PREVIEW_LIMITS.minSize && value <= PREVIEW_LIMITS.maxSize)
		|| !Number.isInteger(padding) || padding < 1 || padding * 2 >= Math.min(width, height)
		|| (options.acknowledgeExternal !== undefined && typeof options.acknowledgeExternal !== 'boolean')) throw error('Options');
	return { width, height, padding, acknowledgeExternal: options.acknowledgeExternal ?? false };
}

export async function loadArtworkTexture(path, signal, remainingPixels = PREVIEW_LIMITS.texturePixels, limits = { axis: PREVIEW_LIMITS.textureAxis, pixels: PREVIEW_LIMITS.texturePixels }) {
	const controller = new AbortController();
	const cancel = () => controller.abort(signal.reason);
	signal?.addEventListener('abort', cancel, { once: true });
	const timeout = setTimeout(() => controller.abort(new Error(loc('TextureTimeout'))), 5000);
	let bitmap, texture;
	try {
		checkAbort(signal);
		const url = new URL(path, location.href);
		const local = url.origin === new URL(location.href).origin;
		const response = await fetch(url.href, { signal: controller.signal, credentials: local ? 'same-origin' : 'omit',
			redirect: 'error', cache: 'no-store', mode: 'cors' });
		if (!response.ok || Number(response.headers.get('content-length')) > STAMP_LIMITS.bytes || !response.body?.getReader) throw error('Texture');
		const reader = response.body.getReader();
		const chunks = [];
		let total = 0;
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				total += value.byteLength;
				if (total > STAMP_LIMITS.bytes) { await reader.cancel(); throw error('Texture'); }
				chunks.push(value);
			}
		} finally { reader.releaseLock(); }
		const bytes = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
		const header = imageHeader(bytes, limits);
		if (header.width > limits.axis || header.height > limits.axis
			|| header.width * header.height > remainingPixels) throw error('Texture');
		checkAbort(signal);
		bitmap = await createImageBitmap(new Blob([bytes]));
		if (bitmap.width !== header.width || bitmap.height !== header.height) throw error('Texture');
		texture = new PIXI.Texture(new PIXI.BaseTexture(bitmap));
		if (!texture.valid) throw error('Texture');
		return { texture, bitmap };
	} catch (failure) {
		texture?.destroy(true); bitmap?.close();
		if (signal?.aborted) checkAbort(signal);
		if (controller.signal.aborted) throw error('TextureTimeout');
		throw failure;
	} finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); }
}

export async function renderArtworkPreview(entries, options = {}) {
	checkAbort(options.signal);
	const settings = previewOptions(options);
	const project = prepareArtworkSnapshot(entries);
	if (waiting >= PREVIEW_LIMITS.queue) throw error('Queue');
	waiting++;
	const task = queue.then(async () => {
		checkAbort(options.signal);
		const key = await fingerprint(project, settings);
		checkAbort(options.signal);
		const cached = cache.get(key);
		if (cached && cached.expires > Date.now()) {
			cache.delete(key); cache.set(key, cached);
			return structuredClone(cached.result);
		}

		if (cached) { cachedBytes -= cached.cost; cache.delete(key); }
		assertProjectResources(await inspectProjectResources(project, settings));
		checkAbort(options.signal);
		for (const { data } of project.drawings) {
			if (data.text && !document.fonts.check(`${data.fontSize}px "${data.fontFamily || CONFIG.defaultFontFamily}"`)) throw error('Font');
		}
		const renderer = canvas.app?.renderer;
		if (!renderer?.render || !renderer.extract?.canvas || !PIXI.RenderTexture) throw error('Renderer');
		const textures = new Map(), owned = [];
		let root, target;
		try {
			let remainingPixels = PREVIEW_LIMITS.texturePixels;
			for (const path of project.dependencies.assets) {
				checkAbort(options.signal);
				const asset = await loadArtworkTexture(path, options.signal, remainingPixels);
				remainingPixels -= asset.bitmap.width * asset.bitmap.height;
				owned.push(asset); textures.set(path, asset.texture);
			}
			checkAbort(options.signal);
			root = buildArtworkDisplay(project, textures);
			const bounds = root.getLocalBounds();
			const fit = fitArtworkBounds(bounds, settings.width, settings.height, settings.padding);
			root.scale.set(fit.scale); root.position.set(fit.x, fit.y);
			target = PIXI.RenderTexture.create({ width: settings.width, height: settings.height, resolution: 1 });
			renderer.render(root, { renderTexture: target, clear: true });
			const image = renderer.extract.canvas(target);
			checkAbort(options.signal);
			const blob = await new Promise((resolve, reject) => image.toBlob(value => value ? resolve(value) : reject(error('Encoding')), 'image/webp', 0.85));
			if (blob.type !== 'image/webp' || blob.size > PREVIEW_LIMITS.encodedBytes) throw error('Encoding');
			checkAbort(options.signal);
			const bytes = new Uint8Array(await blob.arrayBuffer());
			let binary = '';
			for (const byte of bytes) binary += String.fromCharCode(byte);
			const result = { src: `data:image/webp;base64,${btoa(binary)}`, width: settings.width, height: settings.height,
				bytes: blob.size, fingerprint: key, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
				empty: project.drawings.length === 0, scope: 'full-artwork' };
			checkAbort(options.signal);
			remember(key, result);
			return structuredClone(result);
		} finally {
			target?.destroy(true);
			root?.destroy({ children: true });
			for (const asset of owned) { asset.texture.destroy(true); asset.bitmap.close(); }
		}
	});
	queue = task.then(() => {}, () => {});
	try { return await task; } finally { waiting--; }
}

export const PUBLICATION_LIMITS = Object.freeze({ axis: 8192, pixels: 16000000, encodedBytes: 32 * 1024 * 1024, scale: 4 });
export const BACKGROUND_LIMITS = Object.freeze({ axis: 8192, pixels: 64000000 });
const publicationError = key => new Error(game.i18n.localize(`FOUNDRYSHOP.Publication.${key}`));

export function publicationDimensions(bounds, scale) {
	if (!Number.isFinite(scale) || scale < 0.1 || scale > PUBLICATION_LIMITS.scale
		|| !bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
		|| bounds.width <= 0 || bounds.height <= 0) throw publicationError('Options');
	const width = Math.ceil(bounds.width * scale), height = Math.ceil(bounds.height * scale);
	if (width > PUBLICATION_LIMITS.axis || height > PUBLICATION_LIMITS.axis
		|| width * height > PUBLICATION_LIMITS.pixels) throw publicationError('Limit');
	return { width, height };
}

export function unpremultiplyPublicationPixels(pixels) {
	if (!(pixels instanceof Uint8Array) || pixels.length % 4) throw publicationError('Encoding');
	const result = new Uint8ClampedArray(pixels.length);
	for (let index = 0; index < pixels.length; index += 4) {
		const alpha = pixels[index + 3];
		if (alpha) {
			for (let channel = 0; channel < 3; channel++) result[index + channel] = Math.round(pixels[index + channel] * 255 / alpha);
		}
		result[index + 3] = alpha;
	}
	return result;
}

function publicationCanvas(renderer, target, width, height) {
	// PIXI 7's Uint8Array unpremultiplication can wrap saturated channels to zero.
	const alphaMode = target.baseTexture.alphaMode;
	let pixels;
	try {
		target.baseTexture.alphaMode = PIXI.ALPHA_MODES.NPM;
		pixels = renderer.extract.pixels(target);
	} finally { target.baseTexture.alphaMode = alphaMode; }
	if (pixels.length !== width * height * 4) throw publicationError('Encoding');
	const image = document.createElement('canvas'); image.width = width; image.height = height;
	const context = image.getContext('2d');
	if (!context) throw publicationError('Encoding');
	context.putImageData(new ImageData(unpremultiplyPublicationPixels(pixels), width, height), 0, 0);
	return image;
}

export async function renderArtworkWebp(entries, options = {}) {
	options = { ...options, ...(options.bounds ? { bounds: { ...options.bounds } } : {}) };
	const background = options.background ? validatePublicationBackground(options.background) : null;
	checkAbort(options.signal);
	if (!game.user.isGM || !['player', 'gm'].includes(options.audience)
		|| !['artwork', 'custom', 'scene'].includes(options.crop) || options.crop === 'scene' && !background
		|| typeof options.acknowledgeExternal !== 'boolean'
		|| !Number.isFinite(options.quality) || options.quality < 0.1 || options.quality > 1) throw publicationError('Options');
	publicationDimensions(options.crop === 'custom' ? options.bounds : options.crop === 'scene' ? background.rect
		: { x: 0, y: 0, width: 1, height: 1 }, options.scale);
	const project = prepareArtworkSnapshot(entries);
	if (options.audience === 'player' && project.drawings.some(entry => entry.data.hidden)) throw publicationError('Options');
	if (!project.drawings.length && !background) throw error('Empty');
	if (background && project.drawings.some(({ data }) => !data.interface && data.elevation < background.elevation)) throw publicationError('BackgroundOrder');
	const resources = background?.texture.src ? { ...project, dependencies: { ...project.dependencies,
		assets: [...new Set([...project.dependencies.assets, background.texture.src])] } } : project;
	if (waiting >= PREVIEW_LIMITS.queue) throw error('Queue');
	waiting++;
	const task = queue.then(async () => {
		checkAbort(options.signal);
		if (!game.user.isGM) throw error('NoAccess');
		assertProjectResources(await inspectProjectResources(resources, options));
		for (const { data } of project.drawings) {
			if (data.text && !document.fonts.check(`${data.fontSize}px "${data.fontFamily || CONFIG.defaultFontFamily}"`)) throw error('Font');
		}
		const renderer = canvas.app?.renderer;
		if (!renderer?.render || !renderer.extract?.pixels || !renderer.gl || !PIXI.ALPHA_MODES) throw error('Renderer');
		const maximum = renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE);
		if (!Number.isFinite(maximum) || maximum <= 0) throw publicationError('Limit');
		const textures = new Map(), owned = [];
		let root, target, artwork;
		try {
			let remainingPixels = PREVIEW_LIMITS.texturePixels;
			for (const path of project.dependencies.assets) {
				checkAbort(options.signal);
				const asset = await loadArtworkTexture(path, options.signal, remainingPixels);
				remainingPixels -= asset.bitmap.width * asset.bitmap.height;
				owned.push(asset); textures.set(path, asset.texture);
			}
			if (background?.texture.src && !textures.has(background.texture.src)) {
				const asset = await loadArtworkTexture(background.texture.src, options.signal,
					BACKGROUND_LIMITS.pixels - (PREVIEW_LIMITS.texturePixels - remainingPixels),
					{ ...BACKGROUND_LIMITS, axis: Math.min(BACKGROUND_LIMITS.axis, maximum) });
				owned.push(asset); textures.set(background.texture.src, asset.texture);
			}
			checkAbort(options.signal);
			root = new PIXI.Container();
			if (background) root.addChild(buildPublicationBackground(background, textures.get(background.texture.src)));
			artwork = buildArtworkDisplay(project, textures, { publication: true, nativeHidden: options.audience === 'gm' });
			root.addChild(artwork);
			for (const graphic of artwork.children) {
				for (const text of graphic.children) {
					if (text.width * options.scale > PREVIEW_LIMITS.textAxis || text.height * options.scale > PREVIEW_LIMITS.textAxis
						|| text.width * text.height * options.scale ** 2 > PUBLICATION_LIMITS.pixels) throw publicationError('TextLimit');
					text.resolution = options.scale;
				}
			}
			const measured = root.getLocalBounds();
			const bounds = options.crop === 'custom' ? options.bounds : options.crop === 'scene' ? background.rect
				: { x: Math.floor(measured.x) - 1, y: Math.floor(measured.y) - 1,
					width: Math.ceil(measured.x + measured.width) - Math.floor(measured.x) + 2,
					height: Math.ceil(measured.y + measured.height) - Math.floor(measured.y) + 2 };
			const { width, height } = publicationDimensions(bounds, options.scale);
			if (width > maximum || height > maximum) throw publicationError('Limit');
			root.scale.set(options.scale); root.position.set(-bounds.x * options.scale, -bounds.y * options.scale);
			target = PIXI.RenderTexture.create({ width, height, resolution: 1 });
			checkAbort(options.signal);
			if (!game.user.isGM) throw error('NoAccess');
			renderer.render(root, { renderTexture: target, clear: true });
			const image = publicationCanvas(renderer, target, width, height);
			if (image.width !== width || image.height !== height) throw publicationError('Encoding');
			const blob = await new Promise((resolve, reject) => image.toBlob(value => value ? resolve(value) : reject(publicationError('Encoding')), 'image/webp', options.quality));
			checkAbort(options.signal);
			if (blob.type !== 'image/webp' || blob.size > PUBLICATION_LIMITS.encodedBytes) throw publicationError('Encoding');
			const header = imageHeader(new Uint8Array(await blob.arrayBuffer()), PUBLICATION_LIMITS);
			if (header.extension !== 'webp' || header.width !== width || header.height !== height) throw publicationError('Encoding');
			checkAbort(options.signal);
			if (!game.user.isGM) throw error('NoAccess');
			return { blob, width, height, bounds: { ...bounds }, drawings: project.drawings.length };
		} finally {
			target?.destroy(true); root?.destroy({ children: true });
			for (const asset of owned) { asset.texture.destroy(true); asset.bitmap.close(); }
		}
	});
	queue = task.then(() => {}, () => {});
	try { return await task; } finally { waiting--; }
}
