import { buildArtworkDisplay } from './artwork_renderer.js';
import { bakeRasterCapabilities } from './bake_raster.js';
import { DRAWING_PROJECT_FIELDS } from './layers/project_package.js';
import { availableProjectFonts, classifyTexturePath } from './layers/project_resources.js';
import { MATERIAL_REPEAT_MAX } from './material_fill.js';
import { loadBakeImage, acquireBakeImageTexture } from './bake_resources.js';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
	&& [Object.prototype, null].includes(Object.getPrototypeOf(value));
const identity = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const unsupported = reason => ({ supported: false, reason });

/** Scope-compatible capability result; opting into textures still requires asynchronous media/GPU acceptance. */
export function inspectBakeDrawing(source, { capabilities = bakeRasterCapabilities(canvas.app?.renderer), allowTextureFills = false } = {}) {
	if (!record(source) || !identity(source._id)
		|| Object.keys(source).some(key => !['_id', 'author', ...DRAWING_PROJECT_FIELDS].includes(key))) {
		return unsupported('bake-unsupported-native-fields');
	}
	const shape = source.shape;
	if (!record(shape) || !['r', 'e', 'p'].includes(shape.type)
		|| Object.keys(shape).some(key => !['type', 'width', 'height', 'radius', 'points'].includes(key))
		|| ![shape.width, shape.height].every(value => Number.isFinite(value) && value >= 0)
		|| !Array.isArray(shape.points) || shape.points.length % 2 || shape.points.some(value => !Number.isFinite(value))
		|| shape.type === 'p' && shape.points.length < 4) return unsupported('bake-unsupported-geometry');
	if (!['x', 'y', 'elevation', 'rotation', 'bezierFactor', 'strokeWidth', 'fontSize'].every(key => Number.isFinite(source[key]))
		|| !Number.isSafeInteger(source.sort) || !Number.isSafeInteger(source.strokeWidth) || source.strokeWidth < 0
		|| ![0, 1, 2].includes(source.fillType) || source.bezierFactor < 0 || source.bezierFactor > 1
		|| ['fillAlpha', 'strokeAlpha', 'textAlpha'].some(key => !Number.isFinite(source[key]) || source[key] < 0 || source[key] > 1)
		|| ['fillColor', 'strokeColor', 'textColor'].some(key => typeof source[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(source[key]))
		|| ![source.x + shape.width / 2, source.y + shape.height / 2].every(Number.isFinite)) {
		return unsupported('bake-invalid-style-or-transform');
	}
	if (![source.x, source.y, shape.width, shape.height, source.strokeWidth,
		source.x + shape.width / 2, source.y + shape.height / 2].every(value => Number.isFinite(Math.fround(value)))
		|| shape.points.some(value => !Number.isFinite(Math.fround(value)))) {
		return unsupported('bake-geometry-exceeds-gpu-float-representation');
	}
	if (!Array.isArray(source.levels) || source.levels.length !== 1 || !identity(source.levels[0])
		|| source.interface !== false || source.hidden !== false || typeof source.locked !== 'boolean') {
		return unsupported('bake-visible-world-single-level-required');
	}
	if (!record(source.flags) || Object.keys(source.flags).some(key => key !== 'foundryshop')
		|| source.flags.foundryshop !== undefined && (!record(source.flags.foundryshop)
			|| Object.keys(source.flags.foundryshop).some(key => !['layerId', 'provenance', 'imageStamp', 'materialRepeat'].includes(key)))) {
		return unsupported('bake-unverified-module-rendering-metadata');
	}
	if (!(source.texture === null || typeof source.texture === 'string')
		|| source.text !== undefined && typeof source.text !== 'string'
		|| typeof source.fontFamily !== 'string') return unsupported('bake-invalid-resource-fields');
	const stamp = source.flags.foundryshop?.imageStamp, repeat = source.flags.foundryshop?.materialRepeat;
	if (stamp !== undefined && (stamp !== 1 || shape.type !== 'r' || source.fillType !== 2 || !source.texture)
		|| repeat !== undefined && (!Number.isFinite(repeat) || repeat <= 0 || repeat > MATERIAL_REPEAT_MAX
			|| source.fillType !== 2 || !source.texture || stamp !== undefined)) return unsupported('bake-invalid-texture-metadata');
	if (stamp !== undefined || repeat !== undefined || source.fillType === 2 && source.texture) {
		if (!allowTextureFills) return unsupported('bake-texture-fill-preparation-required');
		if (classifyTexturePath(source.texture, location.href).kind === 'invalid') return unsupported('bake-invalid-texture-path');
	}
	if (typeof PIXI.Graphics?.prototype?.drawSmoothedPolygon !== 'function'
		|| typeof PIXI.Graphics?.prototype?.drawSmoothedPath !== 'function') return unsupported('bake-native-smoothing-api-unavailable');
	if (source.text) {
		const family = source.fontFamily || CONFIG.defaultFontFamily;
		if (source.fontSize <= 0 || !availableProjectFonts().includes(family)
			|| !document.fonts?.check(`${source.fontSize}px "${family}"`)) return unsupported('bake-font-unavailable');
		if (typeof CONFIG.Drawing?.objectClass?.prototype?._getTextStyle !== 'function'
			|| typeof PIXI.TextMetrics?.measureText !== 'function'
			|| typeof foundry.canvas?.containers?.PreciseText !== 'function') return unsupported('bake-native-text-api-unavailable');
		const style = CONFIG.Drawing.objectClass.prototype._getTextStyle.call({ document: source });
		const metrics = PIXI.TextMetrics.measureText(source.text, style);
		const padding = style.padding ?? 0;
		if (![metrics.width, metrics.height, padding].every(value => Number.isFinite(value) && value >= 0)) {
			return unsupported('bake-text-metrics-unverified');
		}
		if (Math.ceil(metrics.width + 2 * padding) > capabilities.textureAxis
			|| Math.ceil(metrics.height + 2 * padding) > capabilities.textureAxis) {
			return unsupported('bake-text-bitmap-exceeds-gpu-axis');
		}
	}
	return { supported: true };
}

/** Owns captured rendering sources, not live Placeables; raw recovery sources are never normalized. */
export function prepareBakeDrawingDisplay(sources, { signal, isCurrent } = {}) {
	return prepareDisplay(sources, { signal, isCurrent }, new Map(), false);
}

function prepareDisplay(sources, { signal, isCurrent }, textures, allowTextureFills) {
	if (!Array.isArray(sources) || !sources.length || typeof isCurrent !== 'function') {
		throw new Error('Bake Drawing preparation requires nonempty exact sources and an explicit context guard.');
	}
	const renderer = canvas.app?.renderer, capabilities = bakeRasterCapabilities(renderer);
	const check = () => {
		if (!game.user?.isGM || signal?.aborted || !isCurrent() || canvas.app?.renderer !== renderer
			|| renderer.gl.isContextLost()) throw new Error('Bake Drawing authority/context changed, cancelled or lost its GPU context.');
	};
	check();
	const captured = structuredClone(sources), ids = new Set();
	for (const source of captured) {
		const result = inspectBakeDrawing(source, { capabilities, allowTextureFills });
		if (!result.supported) throw new Error(`Drawing ${source?._id ?? '(unknown)'} cannot bake: ${result.reason}.`);
		if (ids.has(source._id)) throw new Error('Bake Drawing sources contain duplicate native IDs.');
		ids.add(source._id);
	}
	if (new Set(captured.map(source => `${source.levels[0]}:${source.elevation}`)).size !== 1) {
		throw new Error('Bake Drawing rendering requires one Level and elevation; ground conversion must be reviewed separately.');
	}
	captured.sort((a, b) => a.sort - b.sort || a._id.localeCompare(b._id));
	check();
	return Object.freeze({
		review: Object.freeze({ sourceCount: captured.length, pointCount: captured.reduce((sum, source) => sum + source.shape.points.length, 0),
			sourceIds: Object.freeze(captured.map(source => source._id)),
			textCount: captured.filter(source => source.text).length, textureCount: textures.size,
			disclosure: 'No preview count/point caps. Texture inputs must fit actual GPU axes. Pixel/placement and crop coverage acceptance remain required.' }),
		buildDisplay() {
			check();
			for (const source of captured) {
				const result = inspectBakeDrawing(source, { capabilities, allowTextureFills });
				if (!result.supported) throw new Error(`Drawing ${source._id} rendering resources changed: ${result.reason}.`);
			}
			let root;
			try {
				root = buildArtworkDisplay({ drawings: captured.map(source => ({ data: structuredClone(source) })) },
					textures, { publication: true, nativeHidden: false, nativeText: true });
				for (const graphic of root.children) {
					for (const text of graphic.children) {
						if (typeof text.updateText !== 'function') throw new Error('Bake native text rasterization API unavailable.');
						text.updateText(true);
						const base = text.texture?.baseTexture;
						if (!base || ![base.realWidth, base.realHeight].every(value => Number.isSafeInteger(value) && value > 0)
							|| base.realWidth > capabilities.textureAxis || base.realHeight > capabilities.textureAxis) {
							throw new Error('Bake native text bitmap exceeds actual GPU capabilities or could not be verified.');
						}
					}
				}
				check();
				return root;
			} catch (error) { root?.destroy({ children: true }); throw error; }
		},
	});
}

/** Await the complete render inside visit; owned graphs are released before their shared textures. */
export async function withBakeDrawingResources(sources, visit, {
	signal, isCurrent, acknowledgeExternal = false, timeout = 30000,
} = {}) {
	if (typeof visit !== 'function' || typeof isCurrent !== 'function' || typeof acknowledgeExternal !== 'boolean') {
		throw new Error('Bake Drawing resources require explicit render/context callbacks and external consent.');
	}
	const renderer = canvas.app?.renderer;
	const captured = structuredClone(sources), textures = new Map(), owned = [], leases = [], graphs = [];
	let closed = false;
	const current = () => {
		if (closed) throw new Error('Bake Drawing resource preparation is closed.');
		return canvas.app?.renderer === renderer && isCurrent() && leases.every(lease => lease.assertCurrent());
	};
	prepareDisplay(captured, { signal, isCurrent: current }, textures, true);
	const paths = [...new Set(captured.filter(source => source.fillType === 2 && source.texture).map(source => source.texture))];
	if (!acknowledgeExternal && paths.some(path => classifyTexturePath(path, location.href).kind === 'external')) {
		throw new Error('Bake Drawing textures require external-resource acknowledgement before any contact.');
	}
	try {
		for (const path of paths) {
			const image = await loadBakeImage(path, { signal, isCurrent: current, acknowledgeExternal, timeout });
			owned.push(image);
			const lease = acquireBakeImageTexture(image, { signal, isCurrent });
			leases.push(lease); textures.set(path, lease.texture);
		}
		const prepared = prepareDisplay(captured, { signal, isCurrent: current }, textures, true);
		const result = await visit(Object.freeze({ review: prepared.review, buildDisplay() {
			const root = prepared.buildDisplay(); graphs.push(root); return root;
		} }));
		if (!game.user?.isGM || signal?.aborted || !current()) throw new Error('Bake Drawing resources changed or were cancelled after rendering.');
		return result;
	} finally {
		closed = true;
		const failures = [];
		for (const root of graphs) {
			try { if (!root.destroyed) root.destroy({ children: true }); }
			catch (error) { failures.push(error); }
		}
		for (const resource of [...leases, ...owned]) {
			try { resource.destroy(); }
			catch (error) { failures.push(error); }
		}
		if (failures.length) throw new AggregateError(failures, 'Bake Drawing resource cleanup failed.');
	}
}
