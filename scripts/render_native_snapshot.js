import { capturePrimaryDrawingCacheStack, admitDrawingCacheStack } from './render_cache_admission.js';
import { exportProjectDrawing } from './layers/project_transfer_service.js';
import { drawingCacheTextureRevision } from './render_cache_assets.js';

const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-7;
const identity = object => object.position?.x === 0 && object.position?.y === 0
	&& object.scale?.x === 1 && object.scale?.y === 1
	&& object.pivot?.x === 0 && object.pivot?.y === 0
	&& object.rotation === 0 && object.skew?.x === 0 && object.skew?.y === 0;

const signature = snapshot => JSON.stringify({
	stack: snapshot.stack, artwork: [...snapshot.artwork], options: snapshot.options, context: snapshot.context,
}, (_, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value);

const textureState = texture => ({
	texture, base: texture.baseTexture, revision: JSON.stringify(drawingCacheTextureRevision(texture)),
});
const sameTexture = (before, texture) => {
	const after = textureState(texture);
	return Object.keys(before).every(key => before[key] === after[key]);
};

/** Opt-in shadow guard: bounded recapture on publication/replay, not a per-frame performance path. */
export function createNativeDrawingCacheCapture(readInput) {
	if (typeof readInput !== 'function') throw new TypeError('A synchronous native cache input provider is required.');
	return () => {
		const input = readInput();
		const snapshot = captureNativeDrawingCacheSnapshot(input), key = signature(snapshot);
		const { canvas } = input, scene = canvas.scene, level = canvas.level, primary = canvas.primary,
			stage = canvas.stage, renderer = canvas.app.renderer;
		const objects = primary.children.map(object => ({
			object, drawing: object.object, document: object.object?.document, geometry: object.geometry,
			dirty: object.geometry?.dirty, batchDirty: object.geometry?.batchDirty,
			clearDirty: object.geometry?.clearDirty,
		}));
		const assets = [...snapshot.textures].map(([path, texture]) => [path, textureState(texture)]);
		return {
			...snapshot,
			isCurrent() {
				const latest = readInput(), current = latest?.canvas;
				if (current !== canvas || current.scene !== scene || current.level !== level
					|| current.primary !== primary || current.stage !== stage || current.app?.renderer !== renderer
					|| objects.length !== primary.children.length
					|| objects.some((entry, i) => {
						const object = primary.children[i];
						return object !== entry.object || object.object !== entry.drawing
							|| object.object?.document !== entry.document || object.geometry !== entry.geometry
							|| object.geometry?.dirty !== entry.dirty || object.geometry?.batchDirty !== entry.batchDirty
							|| object.geometry?.clearDirty !== entry.clearDirty;
					})) return false;
				const recaptured = captureNativeDrawingCacheSnapshot(latest);
				return signature(recaptured) === key && assets.length === recaptured.textures.size
					&& assets.every(([path, state]) => recaptured.textures.has(path)
						&& sameTexture(state, recaptured.textures.get(path)));
			},
		};
	};
}

/** Read-only geometry snapshot for shadow validation, never permission to replace primary output. */
export function captureNativeDrawingCacheSnapshot({ canvas, GraphicsClass, DrawingClass, options, assetRevision, rendererRevision }) {
	const { scene, level, primary, stage, drawings, app } = canvas ?? {};
	const renderer = app?.renderer;
	if (!canvas?.ready || !scene?.id || !level?.id || !scene.levels?.has(level.id)
		|| !primary || !stage || !renderer || !drawings) throw new Error('Native cache capture requires a ready Scene and Level.');
	if (![assetRevision, rendererRevision].every(value => typeof value === 'string' && value.length > 0 && value.length <= 1024)) {
		throw new TypeError('Explicit asset and renderer revisions are required.');
	}
	if (typeof DrawingClass !== 'function') throw new TypeError('An explicit native Drawing class is required.');
	if (renderer.gl?.isContextLost()) throw new Error('Native cache capture refused during renderer context loss.');
	if (drawings.controlled?.length || drawings.preview?.children?.length) {
		throw new Error('Native cache capture deferred while Drawings are being edited.');
	}
	if (stage.parent || stage.rotation !== 0 || stage.skew?.x !== 0 || stage.skew?.y !== 0
		|| !near(stage.scale?.x, stage.scale?.y) || stage.scale.x <= 0
		|| ![stage.position?.x, stage.position?.y, stage.pivot?.x, stage.pivot?.y].every(Number.isFinite)) {
		throw new Error('Unsupported native viewport transform; use native rendering.');
	}
	const ancestors = new Set();
	for (let parent = primary; ; parent = parent.parent) {
		if (!parent || ancestors.has(parent) || ancestors.size >= 32) throw new Error('Unsupported native primary ancestry.');
		ancestors.add(parent);
		if (parent.alpha !== 1 || parent.visible !== true || parent.renderable !== true
			|| (parent !== stage && !identity(parent))) throw new Error('Unsupported native primary transform or visibility.');
		if (parent === stage) break;
	}
	if (options?.width !== renderer.screen?.width || options?.height !== renderer.screen?.height
		|| options?.resolution !== renderer.resolution) throw new Error('Cache target must match the current renderer viewport.');
	const stack = capturePrimaryDrawingCacheStack(primary, GraphicsClass);
	const artwork = new Map(), textures = new Map(), identities = new Map(), excluded = [];
	const documentIds = new Set();
	let coordinates = 0, bytes = 0;
	for (let i = 0; i < stack.length; i++) {
		const slot = stack[i], shape = primary.children[i], drawing = shape.object, document = drawing?.document;
		if (slot.kind !== 'drawing') continue;
		if (document.parent !== scene || scene.drawings?.get(document.id) !== document || documentIds.has(document.id)) {
			throw new Error('Native Drawing identity does not match the displayed Scene.');
		}
		documentIds.add(document.id);
		identities.set(slot.id, document.id);
		if (drawing.renderFlags?.size) throw new Error('Native Drawing refresh is pending; defer capture.');
		let reason = null;
		if (drawing.constructor !== DrawingClass) reason = 'custom-drawing';
		else if (!slot.cacheable) reason = 'native-effects';
		else if (slot.editing) reason = 'editing';
		else if (slot.interface || slot.depth) reason = 'native-mode';
		else if (document.text || shape.children?.length) reason = 'text-or-descendants';
		else if (document.hidden) reason = 'hidden-alpha-unverified';
		else if (shape.visible !== true || shape.renderable !== true) reason = 'not-rendered';
		else if (!(document.levels?.has?.(level.id) || document.levels?.includes?.(level.id))) reason = 'other-level';
		else if (document.getFlag('foundryshop', 'importStaging')) reason = 'import-staging';
		else if ((shape.tint != null && shape.tint !== 0xffffff) || shape.shader
			|| shape.alpha !== 1 || shape.scale?.x !== 1 || shape.scale?.y !== 1
			|| shape.skew?.x !== 0 || shape.skew?.y !== 0
			|| !near(shape.position?.x, document.x + document.shape.width / 2)
			|| !near(shape.position?.y, document.y + document.shape.height / 2)
			|| !near(shape.pivot?.x, document.shape.width / 2) || !near(shape.pivot?.y, document.shape.height / 2)
			|| !near(shape.angle, document.rotation) || document.elevation !== slot.elevation || document.sort !== slot.sort) {
			reason = 'native-state-mismatch';
		}
		if (reason) {
			stack[i] = Object.freeze({ ...slot, cacheable: false });
			excluded.push(Object.freeze({ slot: slot.id, drawing: document.id, reason }));
			continue;
		}
		coordinates += document.shape.points?.length ?? 0;
		if (artwork.size >= 1000 || coordinates > 100000) throw new RangeError('Native artwork snapshot limits exceeded.');
		const entry = exportProjectDrawing(document, { prepared: true });
		bytes += new TextEncoder().encode(JSON.stringify(entry)).length;
		if (bytes > 4 * 1024 * 1024) throw new RangeError('Native artwork snapshot byte limit exceeded.');
		artwork.set(slot.id, entry);
		if (entry.data.fillType === 2 && entry.data.texture) {
			const texture = drawing.texture;
			if (!texture?.valid) throw new Error('Native Drawing texture is not ready.');
			if (textures.has(entry.data.texture) && textures.get(entry.data.texture) !== texture) {
				throw new Error('Native Drawings disagree on borrowed texture identity.');
			}
			textures.set(entry.data.texture, texture);
			if (textures.size > 16) throw new RangeError('Native artwork texture limit exceeded.');
		}
	}
	const detachedOptions = structuredClone(options);
	admitDrawingCacheStack(stack, detachedOptions);
	return {
		stack: Object.freeze(stack), artwork, textures, identities, excluded: Object.freeze(excluded),
		options: detachedOptions,
		context: Object.freeze({
			scene: scene.id, level: level.id, assets: assetRevision, renderer: rendererRevision,
			nativeHidden: false, scale: stage.scale.x,
			x: stage.position.x - stage.pivot.x * stage.scale.x,
			y: stage.position.y - stage.pivot.y * stage.scale.y,
		}),
	};
}
