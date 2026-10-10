import { validateLayerTree } from './layer_tree_store.js';
import { validateProjectThumbnail } from './project_thumbnail.js';
import { validateMaterialRepeat } from '../material_fill.js';
import { normalizeLibraryMetadata } from '../library_metadata.js';
import { validatePortablePaths } from '../path_portability.js';

export const PROJECT_FORMAT = 'foundryshop-drawing-project';
export const PROJECT_VERSION = 1;
export const PROJECT_LIMITS = { bytes: 20 * 1024 * 1024, nodes: 2000, drawings: 10000, points: 1000000 };
export const DRAWING_PROJECT_FIELDS = [
	'name', 'shape', 'x', 'y', 'elevation', 'levels', 'sort', 'rotation', 'bezierFactor',
	'fillType', 'fillColor', 'fillAlpha', 'strokeWidth', 'strokeColor', 'strokeAlpha',
	'texture', 'text', 'fontFamily', 'fontSize', 'textColor', 'textAlpha', 'hidden', 'locked', 'interface', 'flags',
];
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fail(message) {
	throw new Error(`Foundryshop JSON: ${message}`);
}

export function serializeProjectPackage(project) {
	const text = JSON.stringify(project);
	if (new TextEncoder().encode(text).length > PROJECT_LIMITS.bytes) fail('Package exceeds 20 MiB.');
	return text;
}

function validateJson(value, depth = 0) {
	if (depth > 64) fail('Metadata exceeds the maximum nesting depth.');
	if (typeof value === 'number' && !Number.isFinite(value)) fail('Non-finite number.');
	if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return;
	if (!record(value) && !Array.isArray(value)) fail('Only JSON values are supported.');
	if (record(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Only plain JSON objects are supported.');
	for (const [key, child] of Object.entries(value)) {
		if (['__proto__', 'constructor', 'prototype'].includes(key)) fail(`Unsafe metadata key: ${key}`);
		validateJson(child, depth + 1);
	}
}

export function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	return JSON.stringify(value);
}

export function projectDependencies(drawings, tree = { nodes: [] }) {
	const assets = new Set(), fonts = new Set(), modules = new Set();
	for (const node of tree.nodes) if (node.defaults.texture) assets.add(node.defaults.texture);
	for (const { data } of drawings) {
		if (data.texture) assets.add(data.texture);
		if (data.text && data.fontFamily) fonts.add(data.fontFamily);
		for (const namespace of Object.keys(data.flags ?? {})) {
			if (!['foundryshop', 'core'].includes(namespace)) modules.add(namespace);
		}
	}
	return { assets: [...assets].sort(), fonts: [...fonts].sort(), modules: [...modules].sort() };
}

export function projectBounds(drawings) {
	if (!drawings.length) return null;
	let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
	for (const { data } of drawings) {
		// A circumscribed circle conservatively includes rotated geometry and its stroke.
		const width = data.shape.type === 'c' ? 2 * data.shape.radius : data.shape.width;
		const height = data.shape.type === 'c' ? 2 * data.shape.radius : data.shape.height;
		let radius = Math.hypot(width, height) / 2;
		for (let index = 0; index < data.shape.points.length; index += 2) {
			radius = Math.max(radius, Math.hypot(data.shape.points[index] - width / 2, data.shape.points[index + 1] - height / 2));
		}
		radius += data.strokeWidth / 2;
		const x = data.x + width / 2, y = data.y + height / 2;
		left = Math.min(left, x - radius); top = Math.min(top, y - radius);
		right = Math.max(right, x + radius); bottom = Math.max(bottom, y + radius);
	}
	return { x: left, y: top, width: right - left, height: bottom - top };
}

export function validateProjectPackage(input) {
	validateJson(input);
	if (new TextEncoder().encode(JSON.stringify(input)).length > PROJECT_LIMITS.bytes) fail('Package exceeds 20 MiB.');
	if (!record(input) || input.format !== PROJECT_FORMAT || input.version !== PROJECT_VERSION
		|| !['full', 'subtree'].includes(input.scope) || input.coordinateSpace !== 'scene-pixels'
		|| !record(input.source) || !/^14(?:\.|$)/.test(input.source.foundry)
		|| typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) {
		fail('Unsupported package format, version, coordinate space, source Foundry version, or name.');
	}
	if (Object.keys(input.source).some(key => !['foundry', 'drawingSchema'].includes(key))
		|| typeof input.source.drawingSchema !== 'string') fail('Unsupported source metadata.');
	const allowed = new Set(['format', 'version', 'scope', 'coordinateSpace', 'name', 'source', 'tree',
		'drawings', 'bounds', 'dependencies', 'recovery', 'thumbnail', 'library', 'paths', 'pathWarnings']);
	if (Object.keys(input).some(key => !allowed.has(key))) fail('Unsupported package field.');
	let library;
	if (Object.hasOwn(input, 'library')) {
		if (!record(input.library) || Object.keys(input.library).some(key => !['id', 'category', 'tags'].includes(key))) fail('Invalid library metadata.');
		const { name, ...metadata } = normalizeLibraryMetadata({ ...input.library, name: input.name }, { identity: true });
		library = metadata;
	}
	if (Object.hasOwn(input, 'thumbnail')) validateProjectThumbnail(input.thumbnail);
	if (!Array.isArray(input.recovery) || input.recovery.length) fail('Recovery data is not supported by this build; nothing was imported.');
	const tree = validateLayerTree(input.tree);
	if (Object.keys(input.tree).some(key => !['version', 'revision', 'nodes', 'presets'].includes(key))
		|| input.tree.nodes.some(node => Object.keys(node).some(key => !['id', 'name', 'kind', 'parentId', 'playerAllowed', 'locked', 'defaults'].includes(key)))
		|| (input.tree.presets ?? []).some(preset => Object.keys(preset).some(key => !['id', 'name', 'entries'].includes(key))
			|| preset.entries.some(entry => Object.keys(entry).some(key => !['nodeId', 'playerAllowed'].includes(key))))) {
		fail('Unsupported layer or preset metadata.');
	}
	if (tree.nodes.length > PROJECT_LIMITS.nodes || tree.presets.length > 200) fail('Too many layers or presets.');
	if (!Array.isArray(input.drawings) || input.drawings.length > PROJECT_LIMITS.drawings) fail('Too many Drawings or invalid Drawing collection.');
	const nodes = new Map(tree.nodes.map(node => [node.id, node]));
	for (const preset of tree.presets) {
		if (preset.entries.length > PROJECT_LIMITS.nodes || preset.entries.some(entry => !nodes.has(entry.nodeId))) {
			fail(`Preset "${preset.name}" has missing references or too many entries. Repair it before sharing.`);
		}
	}
	const ids = new Set();
	let pointCount = 0;
	const drawings = input.drawings.map(entry => {
		if (!record(entry) || Object.keys(entry).some(key => !['id', 'layerId', 'data'].includes(key))
			|| typeof entry.id !== 'string' || !idPattern.test(entry.id) || ids.has(entry.id)
			|| !(entry.layerId === null || nodes.get(entry.layerId)?.kind === 'layer') || !record(entry.data)) {
			fail('Invalid Drawing ID, membership, or data.');
		}
		ids.add(entry.id);
		const data = entry.data;
		if (Object.keys(data).some(key => !DRAWING_PROJECT_FIELDS.includes(key))) fail(`Unsupported field in Drawing ${entry.id}.`);
		if (!record(data.shape) || !['r', 'e', 'p', 'c'].includes(data.shape.type)
			|| Object.keys(data.shape).some(key => !['type', 'width', 'height', 'radius', 'points'].includes(key))
			|| !Array.isArray(data.shape.points) || data.shape.points.length % 2
			|| data.shape.points.some(point => typeof point !== 'number' || !Number.isFinite(point))
			|| data.shape.points.some(point => Math.abs(point) > 10000000)
			|| !Number.isFinite(data.shape.width) || data.shape.width < 0
			|| !Number.isFinite(data.shape.height) || data.shape.height < 0
			|| (data.shape.type === 'c' && (!Number.isFinite(data.shape.radius) || data.shape.radius <= 0))) fail(`Unsupported geometry in Drawing ${entry.id}.`);
		pointCount += data.shape.points.length;
		for (const field of ['x', 'y', 'elevation', 'sort', 'rotation', 'bezierFactor', 'fillType', 'fillAlpha',
			'strokeWidth', 'strokeAlpha', 'fontSize', 'textAlpha']) {
			if (typeof data[field] !== 'number' || !Number.isFinite(data[field])) fail(`Invalid ${field} in Drawing ${entry.id}.`);
		}
		if ([data.x, data.y, data.shape.width, data.shape.height, data.shape.radius ?? 0]
			.some(value => Math.abs(value) > 10000000)) fail(`Drawing ${entry.id} exceeds the coordinate/geometry limit.`);
		if (!Number.isSafeInteger(data.sort) || !Number.isSafeInteger(data.strokeWidth) || data.strokeWidth < 0 || data.strokeWidth > 10000000
			|| !Array.isArray(data.levels) || data.levels.some(id => typeof id !== 'string' || !idPattern.test(id))
			|| new Set(data.levels).size !== data.levels.length
			|| ['hidden', 'locked', 'interface'].some(key => typeof data[key] !== 'boolean')
			|| !(data.texture === null || typeof data.texture === 'string')
			|| ['text', 'fontFamily', 'fillColor', 'strokeColor', 'textColor'].some(key => typeof data[key] !== 'string')
			|| !record(data.flags)) fail(`Invalid Drawing fields in ${entry.id}.`);
		if ('name' in data && typeof data.name !== 'string') fail(`Invalid name in Drawing ${entry.id}.`);
		if (Object.keys(data.flags.foundryshop ?? {}).some(key => !['provenance', 'imageStamp', 'materialRepeat', 'path'].includes(key))) {
			fail(`Unsupported Foundryshop metadata in Drawing ${entry.id}; recovery/import state must not be discarded.`);
		}
		if (Object.hasOwn(data.flags.foundryshop ?? {}, 'imageStamp')
			&& (data.flags.foundryshop.imageStamp !== 1 || data.shape.type !== 'r' || !data.texture)) {
			fail(`Invalid image stamp metadata in Drawing ${entry.id}.`);
		}
		if (Object.hasOwn(data.flags.foundryshop ?? {}, 'materialRepeat')) {
			validateMaterialRepeat(data.flags.foundryshop.materialRepeat);
			if (!data.texture || data.flags.foundryshop.imageStamp === 1) fail(`Invalid material metadata in Drawing ${entry.id}.`);
		}
		return structuredClone(entry);
	});
	if (pointCount > PROJECT_LIMITS.points) fail('Geometry exceeds the point limit.');
	const paths = validatePortablePaths(input.paths ?? { version: 1, routes: [] }, drawings);
	if (input.pathWarnings !== undefined && (!Array.isArray(input.pathWarnings) || input.pathWarnings.length > 1000
		|| input.pathWarnings.some(w => !record(w) || Object.keys(w).some(k => !['name', 'reason'].includes(k))
			|| typeof w.name !== 'string' || !w.name.trim() || w.name.length > 80 || !['partial', 'damaged'].includes(w.reason)))) {
		fail('Invalid path editability disclosure.');
	}
	const validated = {
		...structuredClone(input), name: input.name.trim(), tree, drawings,
		...(input.paths ? { paths } : {}),
		...(library ? { library } : {}),
		bounds: projectBounds(drawings), dependencies: projectDependencies(drawings, tree),
	};
	serializeProjectPackage(validated);
	return validated;
}

export function parseProjectPackage(text) {
	if (new TextEncoder().encode(text).length > PROJECT_LIMITS.bytes) fail('Package exceeds 20 MiB.');
	return validateProjectPackage(JSON.parse(text));
}
