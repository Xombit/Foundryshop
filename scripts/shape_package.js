import { validateProjectPackage, PROJECT_FORMAT, PROJECT_VERSION } from './layers/project_package.js';

export const SHAPE_FORMAT = 'foundryshop-editable-shape';
export const SHAPE_LIMITS = { drawings: 100, points: 100000, bytes: 4 * 1024 * 1024 };

export function validateShapePackage(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)
		|| Object.keys(input).some(key => !['format', 'version', 'id', 'name', 'category', 'tags', 'footprint', 'project'].includes(key))
		|| input.format !== SHAPE_FORMAT || input.version !== 1
		|| typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.id)
		|| typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80
		|| typeof input.category !== 'string' || !input.category.trim() || input.category.length > 40
		|| !Array.isArray(input.tags) || input.tags.length > 12
		|| input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 40)
		|| !input.footprint || typeof input.footprint !== 'object' || Array.isArray(input.footprint)
		|| Object.keys(input.footprint).some(key => !['width', 'height'].includes(key))
		|| [input.footprint.width, input.footprint.height].some(value => !Number.isFinite(value) || value <= 0 || value > 20)) {
		throw new Error('Invalid editable shape metadata.');
	}
	const project = validateProjectPackage(input.project);
	if (!project.drawings.length || project.drawings.length > SHAPE_LIMITS.drawings
		|| project.drawings.reduce((sum, entry) => sum + entry.data.shape.points.length, 0) > SHAPE_LIMITS.points
		|| new TextEncoder().encode(JSON.stringify(input)).length > SHAPE_LIMITS.bytes
		|| project.tree.nodes.length || project.tree.presets.length
		|| project.drawings.some(entry => entry.layerId !== null || entry.data.hidden || entry.data.locked
			|| entry.data.levels.length || entry.data.flags.foundryshop?.provenance
			|| Math.abs(entry.data.x) > 10000 || Math.abs(entry.data.y) > 10000)
		|| new Set(project.drawings.map(entry => `${entry.data.elevation}:${entry.data.interface}`)).size !== 1) {
		throw new Error('Shape requires bounded visible unlocked artwork without layer/preset membership or mixed render modes.');
	}
	return { ...structuredClone(input), project };
}

export function createShapePackage(metadata, drawings, paths, pathWarnings = []) {
	return validateShapePackage({
		format: SHAPE_FORMAT, version: 1, ...metadata,
		project: {
			format: PROJECT_FORMAT, version: PROJECT_VERSION, scope: 'full', coordinateSpace: 'scene-pixels',
			name: metadata.name, source: { foundry: '14', drawingSchema: '14.355' },
			tree: { version: 1, revision: 0, nodes: [], presets: [] },
			drawings, recovery: [], bounds: null, dependencies: {},
			...(paths ? { paths } : {}),
			...(pathWarnings.length ? { pathWarnings } : {}),
		},
	});
}
