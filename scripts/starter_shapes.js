import { createShapePackage } from './shape_package.js';
import { builtinPalette } from './builtin_palettes.js';
import { starterLabels } from './label_styles.js';
import { STARTER_MATERIALS } from './starter_materials.js';

const ink = '#302b26', brown = '#594538';
const color = name => builtinPalette().colors.find(entry => entry.name === name).color;
const part = (type, x, y, width, height, fill, points = [], stroke = ink, line = 3, smoothing = 0) => ({
	name: '', shape: { type, width, height, points, radius: 0 }, x, y, elevation: 0, levels: [],
	sort: 0, rotation: 0, bezierFactor: smoothing, fillType: fill ? 1 : 0, fillColor: fill ?? ink,
	fillAlpha: 1, strokeWidth: line, strokeColor: stroke, strokeAlpha: 1, texture: null,
	text: '', fontFamily: 'Signika', fontSize: 48, textColor: ink, textAlpha: 1,
	hidden: false, locked: false, interface: false, flags: {},
});
const rect = (x, y, w, h, fill, stroke = ink, line = 3) => part('r', x, y, w, h, fill, [], stroke, line);
const ellipse = (x, y, w, h, fill, stroke = ink, line = 3) => part('e', x, y, w, h, fill, [], stroke, line);
const path = (points, stroke = brown, line = 3) => {
	const xs = points.filter((_, i) => i % 2 === 0), ys = points.filter((_, i) => i % 2);
	const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
	return part('p', x, y, Math.max(w, 1), Math.max(h, 1), null,
		points.map((v, i) => v - (i % 2 ? y : x)), stroke, line);
};
const canopy = (x, y, w, h, fill, lobes = 9, phase = 0, inset = 0.84, smoothing = 0.3) => {
	const points = [];
	for (let i = 0; i < lobes * 2; i++) {
		const angle = i * Math.PI / lobes + phase, radius = i % 2 ? inset : 1;
		points.push(w / 2 + Math.cos(angle) * (w / 2 - 3) * radius,
			h / 2 + Math.sin(angle) * (h / 2 - 3) * radius);
	}
	points.push(...points.slice(0, 2));
	return part('p', x, y, w, h, fill, points, ink, 3, smoothing);
};
const poly = (w, h, fill, points) => part('p', 0, 0, w, h, fill, points);
const planks = (w, h, fill = color('Oak Wood')) => [
	rect(0, 0, w, h, fill),
	...Array.from({ length: Math.max(1, Math.floor(h / 30) - 1) }, (_, i) => path([5, (i + 1) * 30, w - 5, (i + 1) * 30], brown, 2)),
];
const barrel = (x, y, size = 70) => [
	ellipse(x, y, size, size, color('Oak Wood')),
	ellipse(x + 6, y + 6, size - 12, size - 12, null, color('Dark Timber'), 3),
	path([x + size / 2, y + 8, x + size / 2, y + size - 8], brown, 2),
];
const rubble = (w, h) => [
	poly(w, h, color('Deep Soil'), [0, 30, 30, 0, w - 15, 10, w, h - 20, w / 2, h, 0, 30]),
	ellipse(10, 20, w * 0.35, h * 0.4, color('Slate')),
	rect(w * 0.5, h * 0.2, w * 0.25, h * 0.3, color('Limestone')),
	ellipse(w * 0.35, h * 0.55, w * 0.3, h * 0.3, color('Deep Stone')),
];
const textured = (data, id, repeat = 100) => {
	const material = STARTER_MATERIALS.find(entry => entry.id === id);
	if (!material) throw new Error('Unknown starter material.');
	return { ...data, fillType: 2, texture: material.path,
		flags: { foundryshop: { materialRepeat: repeat } } };
};

function definitions() {
	return [
		...['empty', 'loaded'].map(load => [`minecart-${load}`, `${load === 'empty' ? 'Empty' : 'Ore-loaded'} Minecart`,
			'Mining', ['mine', 'cart', 'railway', 'ore'], 0.65, 1, [
				...[15, 70].flatMap(y => [rect(0, y, 12, 18, ink), rect(53, y, 12, 18, ink)]),
				rect(8, 5, 49, 90, color('Deep Stone')), rect(14, 12, 37, 76, ink, color('Limestone'), 3),
				...(load === 'loaded' ? [
					ellipse(17, 18, 19, 20, color('Slate')), ellipse(30, 34, 16, 22, color('Aged Paper')),
					ellipse(17, 53, 22, 27, color('Deep Stone')), path([22, 23, 31, 30], color('Limestone'), 2),
				] : []),
			]]),
		['mine-ore-pile', 'Ore Pile', 'Mining', ['mine', 'ore', 'rubble'], 1, 0.8, rubble(100, 80)],
		['mine-timber-support', 'Mine Timber Support', 'Mining', ['mine', 'timber', 'tunnel', 'support'], 1.5, 0.35, [
			rect(0, 0, 150, 20, color('Oak Wood')), rect(4, 15, 20, 20, brown), rect(126, 15, 20, 20, brown),
			path([5, 8, 145, 8], color('Aged Paper'), 2),
		]],
		['mine-buffer-stop', 'Railway Buffer Stop', 'Mining', ['mine', 'railway', 'buffer', 'track'], 1, 0.7, [
			rect(10, 5, 12, 60, color('Deep Stone')), rect(78, 5, 12, 60, color('Deep Stone')),
			rect(0, 12, 100, 18, color('Oak Wood')), path([10, 60, 45, 20, 55, 20, 90, 60], ink, 6),
		]],
		['mine-pickaxe', 'Mining Pickaxe', 'Mining', ['mine', 'pickaxe', 'tools'], 0.7, 0.9, [
			path([12, 82, 47, 18], color('Oak Wood'), 7),
			path([3, 28, 30, 12, 50, 15, 67, 33], color('Deep Stone'), 8),
			path([8, 26, 30, 15, 48, 18], color('Limestone'), 2),
		]],
		...starterLabels().map(entry => {
			const width = Math.max(2, Math.ceil(Math.max(...entry.text.split('\n').map(line => line.length))
				* entry.style.fontSize * 0.65 / 100) + 1);
			const height = Math.max(1, Math.ceil(entry.text.split('\n').length * entry.style.fontSize * 1.5 / 100));
			return [`label-${entry.id.slice(8)}`, entry.name, 'Labels',
				['label', 'text', entry.style.fontFamily], width, height, [
					{ ...rect(0, 0, width * 100, height * 100, null, ink, 0), text: entry.text, ...entry.style },
				]];
		}),
		['round-tree', 'Round Deciduous Tree', 'Vegetation', ['tree', 'woodland', 'canopy'], 2, 2, [
			canopy(0, 0, 200, 200, color('Moss')),
			canopy(35, 32, 130, 126, color('Sage'), 7, 0.2),
			path([70, 103, 102, 91, 125, 115], color('Pine'), 3),
		]],
		['oak-tree', 'Spreading Oak', 'Vegetation', ['tree', 'woodland', 'oak'], 3, 2.5, [
			canopy(0, 0, 300, 250, color('Pine'), 11, 0.1),
			canopy(28, 45, 140, 160, color('Moss'), 8),
			canopy(130, 30, 135, 160, color('Moss'), 7, 0.2),
			canopy(90, 105, 140, 115, color('Sage'), 8),
		]],
		['conifer-tree', 'Conifer Crown', 'Vegetation', ['tree', 'pine', 'woodland'], 2, 2, [
			canopy(0, 0, 200, 200, color('Pine'), 10, 0, 0.58, 0),
			canopy(25, 25, 150, 150, color('Moss'), 10, Math.PI / 10, 0.58, 0),
			canopy(56, 56, 88, 88, color('Sage'), 8, 0, 0.58, 0),
		]],
		['wood-door', 'Wooden Door Symbol', 'Structure', ['door', 'entrance', 'dungeon'], 1, 0.25, [
			rect(0, 0, 100, 25, color('Dark Timber')), rect(8, 4, 84, 17, color('Oak Wood'), brown, 2),
			ellipse(76, 9, 7, 7, color('Ochre Gold'), ink, 1),
		]],
		['stairs-down', 'Stairs Down', 'Structure', ['stairs', 'dungeon', 'steps'], 1, 2, [
			rect(0, 0, 100, 200, color('Limestone')),
			...[35, 65, 95, 125, 155].map((y, i) => path([8 + i * 4, y, 92 - i * 4, y], color('Deep Stone'), 3)),
			path([50, 20, 50, 181, 40, 167, 50, 181, 60, 167], ink, 3),
		]],
		['timber-table', 'Timber Table', 'Furniture', ['table', 'tavern', 'wood'], 2, 1, [
			rect(0, 0, 200, 100, color('Dark Timber')), rect(7, 7, 186, 86, color('Oak Wood'), brown, 2),
			path([12, 35, 188, 35], brown, 2), path([12, 65, 188, 65], brown, 2),
		]],
		['chest', 'Iron-bound Chest', 'Storage', ['chest', 'treasure', 'wood'], 1, 0.6, [
			rect(0, 0, 100, 60, color('Oak Wood')),
			rect(14, 0, 9, 60, color('Deep Stone'), ink, 1), rect(77, 0, 9, 60, color('Deep Stone'), ink, 1),
			path([5, 30, 95, 30], brown, 2), rect(44, 23, 12, 16, color('Ochre Gold'), ink, 2),
		]],
		['column', 'Stone Column', 'Dungeon', ['column', 'pillar', 'stone'], 1, 1, [
			ellipse(0, 0, 100, 100, color('Deep Stone')), ellipse(8, 8, 84, 84, color('Limestone')),
			ellipse(22, 22, 56, 56, null, color('Slate'), 2),
		]],
		['boulder', 'Weathered Boulder', 'Terrain', ['rock', 'boulder', 'stone'], 1.5, 1.2, [
			part('p', 0, 0, 150, 120, color('Slate'), [8, 40, 35, 8, 105, 4, 143, 38, 135, 93, 88, 116, 25, 102, 8, 40]),
			path([35, 8, 58, 43, 115, 45, 143, 38], color('Limestone'), 3),
			path([58, 43, 45, 82, 25, 102], color('Deep Stone'), 2),
		]],
		['campfire', 'Campfire', 'Camp', ['fire', 'camp', 'wood'], 1, 1, [
			ellipse(0, 0, 100, 100, color('Deep Soil'), color('Slate'), 6),
			path([22, 25, 78, 75], color('Oak Wood'), 10), path([22, 75, 78, 25], color('Dark Timber'), 10),
			canopy(27, 27, 46, 46, color('Rust Red'), 6),
			canopy(38, 37, 25, 25, color('Ochre Gold'), 5),
		]],
		['altar', 'Stone Altar', 'Dungeon', ['altar', 'temple', 'stone'], 2, 1, [
			rect(0, 0, 200, 100, color('Deep Stone')),
			rect(8, 8, 184, 84, color('Limestone')), rect(22, 20, 156, 60, null, color('Slate'), 2),
			ellipse(24, 35, 28, 28, color('Ochre Gold'), brown, 2),
			rect(86, 32, 52, 36, color('Ivory'), brown, 2), path([112, 34, 112, 66], brown, 2),
		]],
		['crate', 'Braced Crate', 'Storage', ['crate', 'supplies', 'wood'], 1, 1, [
			rect(0, 0, 100, 100, color('Oak Wood')),
			path([33, 5, 33, 95], brown, 2), path([66, 5, 66, 95], brown, 2),
			path([8, 8, 92, 92], color('Dark Timber'), 8), path([8, 92, 92, 8], color('Dark Timber'), 8),
		]],
		...expandedDefinitions(),
		...texturedDefinitions(),
	];
}

function texturedDefinitions() {
	return [
		['textured-flagstone-room', 'Flagstone Room', 'Structure', ['textured', 'stone', 'floor', 'room'], 4, 3, [
			textured(rect(0, 0, 400, 300, color('Limestone'), ink, 6), 'flagstone'),
		]],
		['textured-timber-table', 'Planked Timber Table', 'Furniture', ['textured', 'wood', 'table', 'tavern'], 2, 1, [
			rect(0, 0, 200, 100, color('Dark Timber')),
			textured(rect(7, 7, 186, 86, color('Oak Wood'), brown, 2), 'timber-planks', 75),
		]],
		['textured-forest-clearing', 'Forest-floor Clearing', 'Terrain', ['textured', 'forest', 'floor', 'clearing'], 4, 3, [
			textured(canopy(0, 0, 400, 300, color('Moss'), 11, 0.1, 0.9), 'forest-floor', 150),
		]],
		['textured-sand-patch', 'Sandy Clearing', 'Terrain', ['textured', 'sand', 'desert', 'clearing'], 3, 2, [
			textured(ellipse(0, 0, 300, 200, color('Sandy Earth'), brown, 2), 'sand'),
		]],
		['textured-ripple-pond', 'Rippling Pond', 'Terrain', ['textured', 'water', 'pond', 'ripples'], 3, 2, [
			textured(canopy(0, 0, 300, 200, color('Shallow Water'), 8, 0.2, 0.9), 'water-ripples', 125),
			ellipse(70, 55, 35, 25, color('Moss'), color('Pine'), 2),
		]],
		['textured-frozen-pool', 'Frozen Pool', 'Terrain', ['textured', 'water', 'ice', 'winter'], 2.5, 2, [
			textured(ellipse(0, 0, 250, 200, color('Shallow Water'), color('Deep Water'), 3), 'ice', 125),
		]],
		['textured-stone-column', 'Rough-stone Column', 'Dungeon', ['textured', 'stone', 'column', 'pillar'], 1, 1, [
			ellipse(0, 0, 100, 100, color('Deep Stone')),
			textured(ellipse(8, 8, 84, 84, color('Limestone')), 'rough-stone', 50),
			ellipse(22, 22, 56, 56, null, color('Slate'), 2),
		]],
		['textured-brick-dais', 'Brick Dais', 'Dungeon', ['textured', 'brick', 'platform', 'temple'], 2, 2, [
			textured(rect(0, 0, 200, 200, color('Rust Red'), ink, 4), 'brick'),
			rect(15, 15, 170, 170, null, color('Deep Stone'), 3),
		]],
	];
}

function expandedDefinitions() {
	return [
		['dead-tree', 'Dead Branching Tree', 'Vegetation', ['tree', 'dead', 'winter'], 2, 2, [
			path([100, 182, 100, 110, 77, 72, 70, 20], color('Dark Timber'), 10),
			path([100, 120, 148, 80, 176, 24], brown, 7),
			path([88, 92, 35, 80, 20, 45], brown, 6),
			path([143, 85, 135, 35], brown, 5),
			path([98, 155, 45, 138, 20, 151], brown, 6),
			ellipse(89, 170, 22, 22, color('Oak Wood')),
		]],
		['narrow-pine', 'Narrow Conifer', 'Vegetation', ['tree', 'pine', 'conifer'], 1.5, 1.5, [
			canopy(0, 0, 150, 150, color('Pine'), 7, 0, 0.45, 0),
			canopy(30, 30, 90, 90, color('Moss'), 7, 0.2, 0.45, 0),
		]],
		['broadleaf-tree', 'Clustered Broadleaf Tree', 'Vegetation', ['tree', 'forest', 'broadleaf'], 2.5, 2.5, [
			canopy(0, 0, 250, 250, color('Pine'), 8),
			canopy(20, 25, 120, 130, color('Moss'), 6),
			canopy(125, 35, 105, 130, color('Sage'), 6),
			canopy(60, 125, 145, 110, color('Moss'), 7),
		]],
		['shrub-cluster', 'Shrub Cluster', 'Vegetation', ['bush', 'shrub', 'undergrowth'], 1.5, 1, [
			canopy(0, 10, 80, 85, color('Moss'), 6),
			canopy(65, 0, 85, 85, color('Pine'), 7),
			canopy(45, 35, 75, 65, color('Sage'), 6),
		]],
		['stump', 'Tree Stump', 'Vegetation', ['tree', 'stump', 'wood'], 1, 1, [
			canopy(0, 0, 100, 100, color('Dark Timber'), 6),
			ellipse(16, 16, 68, 68, color('Oak Wood')),
			ellipse(29, 29, 42, 42, null, brown, 2),
			path([55, 51, 79, 68], brown, 3),
		]],
		['fallen-log', 'Fallen Log', 'Vegetation', ['tree', 'log', 'wood'], 2, 0.6, [
			rect(15, 5, 170, 50, color('Dark Timber')), ellipse(0, 0, 35, 60, color('Oak Wood')),
			ellipse(7, 10, 20, 40, null, brown, 2), path([40, 20, 185, 20], brown, 2),
		]],
		['reeds', 'Reed Bed', 'Vegetation', ['wetland', 'reeds', 'water'], 1.5, 1, [
			canopy(0, 0, 150, 100, color('Sage'), 8),
			...[25, 50, 75, 100, 125].map((x, i) => path([x, 80, x + (i % 2 ? 10 : -10), 20], color('Pine'), 4)),
		]],
		['mushrooms', 'Mushroom Cluster', 'Vegetation', ['fungus', 'cave', 'mushroom'], 1, 1, [
			ellipse(5, 10, 50, 50, color('Rust Red')), ellipse(45, 40, 50, 50, color('Clay')),
			ellipse(18, 23, 12, 12, color('Ivory'), ink, 1), ellipse(60, 52, 10, 10, color('Ivory'), ink, 1),
			ellipse(75, 65, 8, 8, color('Ivory'), ink, 1),
		]],
		['round-table', 'Round Table', 'Furniture', ['table', 'tavern', 'wood'], 1.5, 1.5, [
			ellipse(0, 0, 150, 150, color('Dark Timber')), ellipse(7, 7, 136, 136, color('Oak Wood')),
			path([30, 40, 120, 40], brown, 2), path([12, 75, 138, 75], brown, 2), path([30, 110, 120, 110], brown, 2),
		]],
		['chair', 'Wooden Chair', 'Furniture', ['chair', 'seat', 'tavern'], 0.6, 0.6, [
			rect(5, 10, 50, 45, color('Oak Wood')), rect(0, 0, 60, 12, color('Dark Timber')),
			path([12, 22, 48, 22], brown, 2),
		]],
		['bench', 'Long Bench', 'Furniture', ['bench', 'seat', 'tavern'], 2, 0.5, [
			rect(12, 0, 15, 50, color('Dark Timber')), rect(172, 0, 15, 50, color('Dark Timber')),
			rect(0, 8, 200, 34, color('Oak Wood')), path([8, 25, 192, 25], brown, 2),
		]],
		['bedroll', 'Rolled-out Bedroll', 'Furniture', ['bedroll', 'camp', 'sleep'], 1, 2, [
			rect(10, 0, 80, 200, color('Sage')), rect(10, 0, 80, 40, color('Moss')),
			path([18, 60, 82, 60], color('Pine'), 2),
		]],
		['bed', 'Single Bed', 'Furniture', ['bed', 'bedroom', 'sleep'], 1, 2, [
			rect(0, 0, 100, 200, color('Dark Timber')), rect(7, 12, 86, 175, color('Ivory')),
			rect(12, 18, 76, 38, color('Parchment')), rect(7, 68, 86, 119, color('Sage')),
			path([12, 80, 88, 80], color('Pine'), 2),
		]],
		['bookshelf', 'Bookshelf', 'Furniture', ['shelf', 'books', 'library'], 2, 0.5, [
			rect(0, 0, 200, 50, color('Dark Timber')),
			...Array.from({ length: 8 }, (_, i) => rect(10 + i * 23, 8, 16, 33, color(['Rust Red', 'Pine', 'Deep Water', 'Parchment'][i % 4]), brown, 1)),
		]],
		['desk', 'Writing Desk', 'Furniture', ['desk', 'study', 'paper'], 1.5, 1, [
			...planks(150, 100), rect(72, 22, 55, 50, color('Ivory'), brown, 2),
			path([80, 35, 116, 35], color('Slate'), 2), path([80, 46, 112, 46], color('Slate'), 2),
			ellipse(22, 23, 22, 22, color('Deep Stone')), path([30, 35, 50, 68], ink, 3),
		]],
		['throne', 'Stone Throne', 'Furniture', ['throne', 'seat', 'royal'], 1.2, 1.2, [
			rect(0, 0, 120, 30, color('Deep Stone')), rect(10, 20, 100, 90, color('Limestone')),
			rect(23, 35, 74, 60, color('Rust Red')), rect(0, 25, 18, 95, color('Slate')),
			rect(102, 25, 18, 95, color('Slate')),
		]],
		['rug', 'Woven Rug', 'Furniture', ['rug', 'carpet', 'room'], 2, 1.5, [
			rect(0, 0, 200, 150, color('Rust Red')), rect(12, 12, 176, 126, null, color('Ochre Gold'), 3),
			poly(200, 150, color('Ochre Gold'), [100, 30, 150, 75, 100, 120, 50, 75, 100, 30]),
		]],
		['barrel', 'Wooden Barrel', 'Storage', ['barrel', 'supplies', 'tavern'], 0.7, 0.7, barrel(0, 0)],
		['barrel-cluster', 'Three Barrels', 'Storage', ['barrel', 'supplies', 'warehouse'], 1.5, 1.4, [
			...barrel(0, 0), ...barrel(80, 5), ...barrel(40, 70),
		]],
		['sacks', 'Sack Pile', 'Storage', ['sack', 'grain', 'supplies'], 1.2, 1, [
			ellipse(0, 0, 70, 95, color('Parchment')), ellipse(55, 15, 65, 85, color('Aged Paper')),
			path([18, 12, 50, 12], brown, 4), path([70, 25, 104, 25], brown, 4),
		]],
		['crates', 'Stacked Crates', 'Storage', ['crate', 'supplies', 'warehouse'], 1.5, 1.5, [
			rect(0, 0, 100, 100, color('Dark Timber')), path([8, 8, 92, 92], brown, 5),
			rect(50, 50, 100, 100, color('Oak Wood')), path([58, 58, 142, 142], brown, 6),
			path([58, 142, 142, 58], brown, 6),
		]],
		['handcart', 'Handcart', 'Storage', ['cart', 'market', 'transport'], 1.5, 2, [
			rect(0, 20, 15, 85, color('Deep Stone')), rect(135, 20, 15, 85, color('Deep Stone')),
			rect(40, 100, 10, 100, color('Dark Timber')), rect(100, 100, 10, 100, color('Dark Timber')),
			rect(15, 0, 120, 130, color('Oak Wood')),
			path([23, 40, 127, 40], brown, 2), path([23, 85, 127, 85], brown, 2),
		]],
		['weapon-rack', 'Weapon Rack', 'Storage', ['rack', 'weapons', 'armory'], 1.5, 0.7, [
			rect(0, 15, 150, 40, color('Dark Timber')),
			...[30, 75, 120].map(x => path([x, 3, x, 67], color('Slate'), 5)),
			...[30, 75, 120].map(x => path([x - 12, 49, x + 12, 49], color('Oak Wood'), 4)),
		]],
		['urn', 'Ceramic Urn', 'Storage', ['urn', 'pottery', 'tomb'], 0.6, 0.6, [
			ellipse(0, 0, 60, 60, color('Clay')), ellipse(14, 14, 32, 32, color('Deep Soil')),
			ellipse(21, 21, 18, 18, color('Deep Stone'), brown, 1),
		]],
		['supplies', 'Supply Bundle', 'Storage', ['supplies', 'camp', 'bundle'], 1.4, 1, [
			rect(0, 0, 100, 70, color('Sage')), path([0, 23, 100, 23], color('Dark Timber'), 5),
			path([50, 0, 50, 70], color('Dark Timber'), 5), ...barrel(80, 35, 60),
		]],
		['well', 'Stone Well', 'Dungeon', ['well', 'water', 'settlement'], 1.5, 1.5, [
			ellipse(0, 0, 150, 150, color('Limestone')), ellipse(20, 20, 110, 110, color('Deep Water')),
			path([8, 75, 142, 75], color('Dark Timber'), 8),
			rect(60, 50, 30, 28, color('Oak Wood')),
		]],
		['sarcophagus', 'Sarcophagus', 'Dungeon', ['tomb', 'coffin', 'stone'], 1, 2, [
			rect(0, 0, 100, 200, color('Deep Stone')), rect(8, 8, 84, 184, color('Limestone')),
			ellipse(35, 30, 30, 30, null, color('Slate'), 3),
			path([50, 60, 50, 145, 30, 174, 50, 145, 70, 174], color('Slate'), 3),
			path([23, 90, 77, 90], color('Slate'), 3),
		]],
		['broken-column', 'Broken Column', 'Dungeon', ['column', 'ruin', 'stone'], 1.5, 1, [
			canopy(0, 0, 100, 100, color('Limestone'), 6, 0, 0.7, 0),
			ellipse(20, 20, 60, 60, null, color('Slate'), 2),
			rect(108, 35, 32, 24, color('Slate')),
		]],
		['statue', 'Statue Pedestal', 'Dungeon', ['statue', 'temple', 'stone'], 1, 1, [
			rect(0, 0, 100, 100, color('Deep Stone')), rect(10, 10, 80, 80, color('Limestone')),
			ellipse(30, 20, 40, 55, color('Slate')), ellipse(38, 14, 24, 24, color('Limestone')),
		]],
		['pit', 'Open Pit', 'Dungeon', ['pit', 'hazard', 'hole'], 2, 2, [
			rect(0, 0, 200, 200, color('Slate')), rect(12, 12, 176, 176, color('Deep Stone')),
			rect(28, 28, 144, 144, color('Charcoal Ink')),
		]],
		['rubble', 'Rubble Pile', 'Dungeon', ['rubble', 'ruin', 'debris'], 2, 1.5, rubble(200, 150)],
		['grate', 'Floor Grate', 'Dungeon', ['grate', 'drain', 'metal'], 1, 1, [
			rect(0, 0, 100, 100, color('Deep Stone')),
			...[20, 40, 60, 80].map(x => path([x, 5, x, 95], color('Slate'), 5)),
			path([5, 50, 95, 50], color('Slate'), 5),
		]],
		['brazier', 'Lit Brazier', 'Dungeon', ['fire', 'brazier', 'temple'], 0.8, 0.8, [
			ellipse(0, 0, 80, 80, color('Deep Stone')), ellipse(10, 10, 60, 60, color('Rust Red')),
			canopy(23, 23, 34, 34, color('Ochre Gold'), 5),
		]],
		['pond', 'Small Pond', 'Terrain', ['water', 'pond', 'outdoors'], 3, 2, [
			canopy(0, 0, 300, 200, color('Shallow Water'), 7),
			canopy(60, 40, 180, 120, color('Deep Water'), 7),
			path([40, 95, 75, 95], color('Ivory'), 2),
		]],
		['rocky-pool', 'Rocky Pool', 'Terrain', ['water', 'pool', 'stone'], 2, 2, [
			canopy(0, 0, 200, 200, color('Slate'), 8),
			canopy(20, 20, 160, 160, color('Shallow Water'), 7),
			canopy(45, 45, 110, 110, color('Deep Water'), 6),
		]],
		['rock-cluster', 'Rock Cluster', 'Terrain', ['rock', 'boulder', 'outdoors'], 2, 1.5, [
			canopy(0, 0, 110, 100, color('Slate'), 5, 0, 0.85, 0),
			canopy(95, 25, 105, 125, color('Deep Stone'), 5, 0, 0.8, 0),
			canopy(45, 85, 70, 65, color('Limestone'), 5, 0, 0.85, 0),
		]],
		['stepping-stones', 'Stepping Stones', 'Terrain', ['crossing', 'stone', 'water'], 3, 1, [
			ellipse(0, 15, 60, 55, color('Limestone')), ellipse(80, 40, 55, 55, color('Slate')),
			ellipse(160, 5, 60, 60, color('Limestone')), ellipse(240, 40, 60, 55, color('Slate')),
		]],
		['cave-mouth', 'Cave Mouth Symbol', 'Terrain', ['cave', 'entrance', 'stone'], 2, 1.2, [
			poly(200, 120, color('Slate'), [0, 120, 30, 20, 95, 0, 160, 25, 200, 120, 0, 120]),
			poly(200, 120, color('Charcoal Ink'), [35, 115, 65, 60, 125, 40, 165, 115, 35, 115]),
		]],
		['sandbank', 'Sandbank', 'Terrain', ['sand', 'shore', 'terrain'], 3, 1.5, [
			canopy(0, 0, 300, 150, color('Sandy Earth'), 8),
			path([40, 70, 85, 62, 120, 70], color('Aged Paper'), 3),
			path([155, 90, 210, 80, 250, 85], color('Aged Paper'), 3),
		]],
		['mud-patch', 'Mud Patch', 'Terrain', ['mud', 'swamp', 'terrain'], 2, 1.5, [
			canopy(0, 0, 200, 150, color('Deep Soil'), 7),
			ellipse(25, 30, 60, 40, color('Clay'), brown, 2),
			ellipse(110, 70, 65, 45, color('Clay'), brown, 2),
		]],
		['crystals', 'Crystal Cluster', 'Terrain', ['crystal', 'cave', 'mineral'], 1.5, 1.5, [
			poly(150, 150, color('Shallow Water'), [5, 90, 35, 15, 70, 80, 55, 130, 5, 90]),
			poly(150, 150, color('Deep Water'), [65, 100, 95, 0, 145, 75, 115, 140, 65, 100]),
			path([95, 8, 100, 88, 115, 132], color('Ivory'), 2),
		]],
		['tent', 'Small Tent', 'Camp', ['tent', 'camp', 'shelter'], 2, 2, [
			poly(200, 200, color('Parchment'), [0, 20, 100, 0, 200, 20, 200, 180, 100, 200, 0, 180, 0, 20]),
			path([100, 5, 100, 195], brown, 4), path([4, 175, 100, 150, 196, 175], color('Aged Paper'), 3),
		]],
		['pavilion', 'Large Pavilion', 'Camp', ['tent', 'camp', 'pavilion'], 3, 3, [
			rect(0, 0, 300, 300, color('Parchment')),
			path([0, 0, 150, 150, 300, 0], color('Aged Paper'), 4),
			path([0, 300, 150, 150, 300, 300], color('Aged Paper'), 4),
			rect(100, 285, 100, 15, color('Deep Soil'), brown, 2),
		]],
		['firepit', 'Unlit Firepit', 'Camp', ['fire', 'camp', 'pit'], 1, 1, [
			ellipse(0, 0, 100, 100, color('Slate')), ellipse(12, 12, 76, 76, color('Deep Soil')),
			path([25, 32, 72, 65], color('Dark Timber'), 8), path([28, 70, 73, 30], color('Dark Timber'), 8),
		]],
		['wagon', 'Supply Wagon', 'Camp', ['wagon', 'transport', 'supplies'], 2, 3, [
			...[0, 170].flatMap(x => [rect(x, 25, 30, 65, color('Deep Stone')), rect(x, 175, 30, 65, color('Deep Stone'))]),
			rect(25, 0, 150, 250, color('Oak Wood')),
			...[50, 100, 150, 200].map(y => path([32, y, 168, y], brown, 2)),
			path([100, 250, 100, 300], color('Dark Timber'), 10),
		]],
		['fence', 'Fence Segment', 'Camp', ['fence', 'settlement', 'wood'], 2, 0.3, [
			rect(0, 8, 200, 14, color('Oak Wood')),
			...[5, 95, 180].map(x => rect(x, 0, 15, 30, color('Dark Timber'))),
		]],
		['bridge', 'Wooden Bridge', 'Camp', ['bridge', 'crossing', 'wood'], 3, 2, [
			...planks(300, 200), path([0, 12, 300, 12], color('Dark Timber'), 8),
			path([0, 188, 300, 188], color('Dark Timber'), 8),
		]],
		['market-stall', 'Market Stall', 'Camp', ['market', 'shop', 'settlement'], 2, 1.5, [
			rect(0, 0, 200, 150, color('Dark Timber')), rect(0, 0, 200, 105, color('Parchment')),
			...[0, 80, 160].map(x => rect(x, 0, 40, 105, color('Rust Red'), brown, 1)),
			rect(8, 117, 184, 25, color('Oak Wood')),
		]],
		['hitching-post', 'Hitching Post', 'Camp', ['stable', 'post', 'settlement'], 2, 0.5, [
			ellipse(0, 0, 45, 45, color('Dark Timber')), ellipse(155, 0, 45, 45, color('Dark Timber')),
			path([22, 22, 178, 22], color('Oak Wood'), 12),
		]],
		['room-rectangle', 'Rectangular Room', 'Structure', ['room', 'dungeon', 'floor'], 6, 4, [
			rect(0, 0, 600, 400, color('Limestone'), ink, 8),
			rect(14, 14, 572, 372, null, color('Slate'), 2),
		]],
		['room-round', 'Circular Chamber', 'Structure', ['room', 'dungeon', 'chamber'], 4, 4, [
			ellipse(0, 0, 400, 400, color('Limestone'), ink, 8),
			ellipse(14, 14, 372, 372, null, color('Slate'), 2),
		]],
		['room-l', 'L-shaped Room', 'Structure', ['room', 'dungeon', 'floor'], 6, 4, [
			poly(600, 400, color('Limestone'), [0, 0, 600, 0, 600, 200, 300, 200, 300, 400, 0, 400, 0, 0]),
			path([12, 12, 588, 12, 588, 188, 288, 188, 288, 388, 12, 388, 12, 12], color('Slate'), 2),
		]],
		['corridor', 'Corridor Segment', 'Structure', ['corridor', 'dungeon', 'floor'], 4, 1, [
			rect(0, 0, 400, 100, color('Limestone'), color('Limestone'), 0),
			path([0, 0, 400, 0], ink, 6), path([0, 100, 400, 100], ink, 6),
		]],
		['stairs-up', 'Stairs Up', 'Structure', ['stairs', 'dungeon', 'steps'], 1, 2, [
			rect(0, 0, 100, 200, color('Limestone')),
			...[35, 65, 95, 125, 155].map((y, i) => path([24 - i * 4, y, 76 + i * 4, y], color('Deep Stone'), 3)),
			path([50, 180, 50, 19, 40, 33, 50, 19, 60, 33], ink, 3),
		]],
		['barred-gate', 'Barred Gate Symbol', 'Structure', ['gate', 'door', 'metal'], 2, 0.4, [
			rect(0, 0, 200, 40, color('Deep Stone')),
			...[20, 45, 70, 95, 120, 145, 170].map(x => path([x, 4, x, 36], color('Slate'), 5)),
		]],
		['ladder', 'Ladder', 'Structure', ['ladder', 'climb', 'wood'], 1, 2, [
			path([10, 0, 10, 200], color('Dark Timber'), 7), path([90, 0, 90, 200], color('Dark Timber'), 7),
			...[25, 60, 95, 130, 165].map(y => path([10, y, 90, y], color('Oak Wood'), 6)),
		]],
		['north-arrow', 'North Arrow', 'Symbols', ['north', 'compass', 'direction'], 1, 1.5, [
			poly(100, 150, color('Ivory'), [50, 0, 95, 140, 50, 110, 5, 140, 50, 0]),
			poly(100, 150, color('Deep Stone'), [50, 0, 95, 140, 50, 110, 50, 0]),
		]],
		['entrance-arrow', 'Entrance Arrow', 'Symbols', ['entrance', 'direction', 'arrow'], 1.5, 1, [
			rect(0, 35, 80, 30, color('Ochre Gold')),
			poly(150, 100, color('Ochre Gold'), [70, 5, 145, 50, 70, 95, 70, 5]),
		]],
		['marker-base', 'Number Marker Base', 'Symbols', ['marker', 'number', 'annotation'], 0.7, 0.7, [
			ellipse(0, 0, 70, 70, color('Ivory')), ellipse(8, 8, 54, 54, null, brown, 2),
		]],
		['encounter-marker', 'Encounter Marker', 'Symbols', ['encounter', 'combat', 'annotation'], 0.7, 0.7, [
			ellipse(0, 0, 70, 70, color('Rust Red')),
			path([20, 20, 50, 50], color('Ivory'), 5), path([20, 50, 50, 20], color('Ivory'), 5),
		]],
		['hazard-marker', 'Hazard Marker', 'Symbols', ['hazard', 'trap', 'annotation'], 0.8, 0.8, [
			poly(80, 80, color('Ochre Gold'), [40, 0, 80, 75, 0, 75, 40, 0]),
			path([40, 25, 40, 48], ink, 5), ellipse(37, 58, 6, 6, ink, ink, 1),
		]],
		['secret-door', 'Secret Door Mark', 'Symbols', ['secret', 'door', 'annotation'], 0.6, 0.8, [
			rect(0, 0, 60, 80, color('Parchment')),
			path([45, 20, 18, 20, 15, 38, 44, 42, 42, 60, 15, 60], ink, 4),
		]],
		['treasure-marker', 'Treasure Mark', 'Symbols', ['treasure', 'loot', 'annotation'], 0.8, 0.8, [
			poly(80, 80, color('Ochre Gold'), [40, 3, 77, 40, 40, 77, 3, 40, 40, 3]),
			path([20, 40, 60, 40], color('Ivory'), 3),
		]],
		['route-arrow', 'Route Arrow', 'Symbols', ['route', 'direction', 'arrow'], 2, 0.6, [
			path([0, 30, 185, 30], color('Deep Water'), 7),
			path([160, 5, 190, 30, 160, 55], color('Deep Water'), 7),
		]],
		['ritual-circle', 'Ritual Circle', 'Dungeon', ['ritual', 'magic', 'temple'], 3, 3, [
			ellipse(0, 0, 300, 300, null, color('Rust Red'), 4),
			ellipse(20, 20, 260, 260, null, color('Rust Red'), 3),
			path([150, 35, 218, 240, 40, 112, 260, 112, 82, 240, 150, 35], color('Rust Red'), 3),
		]],
		['forge', 'Smithy Forge', 'Dungeon', ['forge', 'smith', 'fire'], 2, 1.5, [
			rect(0, 0, 200, 150, color('Slate')), rect(20, 20, 160, 110, color('Deep Stone')),
			rect(35, 35, 130, 80, color('Rust Red')),
			ellipse(55, 48, 35, 35, color('Ochre Gold')), ellipse(105, 65, 35, 35, color('Ochre Gold')),
		]],
		['hay-bale', 'Hay Bale', 'Storage', ['hay', 'farm', 'stable'], 1, 0.7, [
			rect(0, 0, 100, 70, color('Ochre Gold')),
			path([25, 0, 25, 70], color('Dark Timber'), 4), path([75, 0, 75, 70], color('Dark Timber'), 4),
			path([8, 20, 92, 20], color('Aged Paper'), 2), path([8, 50, 92, 50], color('Aged Paper'), 2),
		]],
		['gravestone', 'Gravestone', 'Dungeon', ['grave', 'cemetery', 'stone'], 0.8, 0.5, [
			rect(0, 0, 80, 50, color('Slate')), rect(10, 10, 60, 30, color('Limestone')),
			path([28, 25, 52, 25], color('Deep Stone'), 2),
		]],
	];
}

let catalog;
export function starterShapes() {
	catalog ??= definitions().map(([id, name, category, tags, width, height, parts]) => createShapePackage({
		id, name, category, tags, footprint: { width, height },
	}, parts.map((data, index) => ({
		id: `${id}-${index}`, layerId: null,
		data: { ...data, x: data.x - width * 50, y: data.y - height * 50, sort: index * 1024 },
	}))));
	return structuredClone(catalog);
}

export function starterShape(id) {
	if (!catalog) starterShapes();
	const shape = catalog.find(entry => entry.id === id);
	if (!shape) throw new Error('Unknown starter shape.');
	return structuredClone(shape);
}
