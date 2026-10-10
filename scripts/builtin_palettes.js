const colors = entries => entries.map(([name, color], index) => ({ id: `color${index}`, name, color }));

export const DEFAULT_BUILTIN_PALETTE = 'fantasy';
export const BUILTIN_PALETTES = [
	{ id: 'fantasy', name: 'Fantasy Mapping', colors: colors([
		['Charcoal Ink', '#302b26'], ['Brown Ink', '#594538'], ['Parchment', '#e8d8b5'],
		['Ivory', '#f4ead2'], ['Aged Paper', '#bba47b'], ['Sandy Earth', '#ba9868'],
		['Clay', '#956a50'], ['Deep Soil', '#614c3c'], ['Oak Wood', '#a17a4f'],
		['Dark Timber', '#6b4e35'], ['Limestone', '#b8b3a3'], ['Slate', '#858b88'],
		['Deep Stone', '#535e60'], ['Sage', '#a3ad7a'], ['Moss', '#74834d'],
		['Pine', '#445f49'], ['Shallow Water', '#8faeb0'], ['Deep Water', '#526f83'],
		['Rust Red', '#a45b46'], ['Ochre Gold', '#c29b4b'],
	]) },
	{ id: 'grayscale', name: 'Grayscale', colors: colors([
		['Black', '#000000'], ['Charcoal', '#333333'], ['Gray', '#777777'],
		['Silver', '#aaaaaa'], ['Light Gray', '#dddddd'], ['White', '#ffffff'],
	]) },
	{ id: 'bright', name: 'Bright Markers', colors: colors([
		['Red', '#d83b3b'], ['Orange', '#e98c32'], ['Yellow', '#e4cb42'],
		['Green', '#419b58'], ['Blue', '#397bc6'], ['Purple', '#9058b5'],
	]) },
];

export function builtinPalette(id = DEFAULT_BUILTIN_PALETTE) {
	const palette = BUILTIN_PALETTES.find(entry => entry.id === id);
	if (!palette) throw new Error('Unknown built-in palette.');
	return structuredClone(palette);
}
