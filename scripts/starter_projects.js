import { starterShape } from './starter_shapes.js';
import { transformStamp } from './artwork_stamps.js';
import { PROJECT_FORMAT, PROJECT_VERSION, validateProjectPackage } from './layers/project_package.js';

const loc = key => game.i18n.localize(`FOUNDRYSHOP.Examples.${key}`);
const layer = (id, parentId, playerAllowed = true) => ({
	id, kind: 'layer', name: loc(`Layer.${id}`), parentId, playerAllowed, locked: false, defaults: {},
});

function createProject(id, placements) {
	const nodes = [
		{ id: 'site', kind: 'group', name: loc(`Name.${id}`), parentId: null,
			playerAllowed: true, locked: false, defaults: {} },
		layer('notes', 'site', false), layer('labels', 'site'),
		{ id: 'map', kind: 'group', name: loc('Layer.map'), parentId: 'site',
			playerAllowed: true, locked: false, defaults: {} },
		layer('features', 'map'), layer('structure', 'map'), layer('ground', 'map'),
	];
	const drawings = [];
	for (const node of [...nodes].reverse().filter(node => node.kind === 'layer')) {
		for (const [index, placement] of placements.entries()) {
			const [shapeId, layerId, x, y, scale = 1, rotation = 0] = placement;
			if (layerId !== node.id) continue;
			const shape = starterShape(shapeId);
			for (const [part, data] of transformStamp(shape.project, { x, y }, { scale, rotation }).entries()) {
				drawings.push({ id: `${id}-${index}-${part}`, layerId,
					data: { ...data, sort: drawings.length * 1024 } });
			}
		}
	}
	const presets = [
		['overview', node => node.id !== 'notes'],
		['terrain', node => ['site', 'map', 'ground'].includes(node.id)],
		['details', () => true],
	].map(([presetId, allowed]) => ({
		id: presetId, name: loc(`Preset.${presetId}`),
		entries: nodes.map(node => ({ nodeId: node.id, playerAllowed: allowed(node) })),
	}));
	return validateProjectPackage({
		format: PROJECT_FORMAT, version: PROJECT_VERSION, scope: 'full', coordinateSpace: 'scene-pixels',
		name: loc(`Name.${id}`), source: { foundry: '14', drawingSchema: '14.355' },
		tree: { version: 1, revision: 0, nodes, presets },
		drawings, recovery: [], bounds: null, dependencies: {},
	});
}

export function starterProjects() {
	return [
		{ id: 'wayfarer', project: createProject('wayfarer', [
			['textured-forest-clearing', 'ground', 600, 550, 3],
			['textured-flagstone-room', 'structure', 600, 530, 2],
			['wood-door', 'features', 600, 830],
			['textured-timber-table', 'features', 430, 420],
			['textured-timber-table', 'features', 750, 420],
			['barrel', 'features', 880, 700],
			['chest', 'features', 320, 710],
			['campfire', 'features', 600, 650],
			['label-TavernTitle', 'labels', 600, 170],
			['label-Entrance', 'labels', 600, 900],
			['label-Storage', 'labels', 330, 640, 0.75],
			['label-MapNote', 'notes', 600, 1040],
		]) },
		{ id: 'woodland', project: createProject('woodland', [
			['textured-forest-clearing', 'ground', 650, 580, 3],
			['textured-ripple-pond', 'ground', 1030, 750, 1.5],
			['textured-sand-patch', 'ground', 600, 630, 1.5],
			['textured-brick-dais', 'structure', 600, 520, 2],
			['textured-stone-column', 'features', 460, 380],
			['textured-stone-column', 'features', 740, 380],
			['altar', 'features', 600, 500],
			['oak-tree', 'features', 220, 400],
			['conifer-tree', 'features', 1100, 330],
			['round-tree', 'features', 220, 820],
			['label-WhisperingWoods', 'labels', 650, 150],
			['label-Ruins', 'labels', 600, 720],
			['label-River', 'labels', 1040, 900],
			['secret-door', 'notes', 600, 620],
			['label-MapNote', 'notes', 650, 1060],
		]) },
	];
}

export function starterProject(id) {
	const entry = starterProjects().find(project => project.id === id);
	if (!entry) throw new Error(loc('Unknown'));
	return entry.project;
}
