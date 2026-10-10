export const MATERIAL_SIZE = 256;
export const STARTER_MATERIALS = Object.freeze([
	['rough-stone', 'stone'], ['flagstone', 'stone'], ['brick', 'stone'],
	['cobblestone', 'stone'], ['timber-planks', 'wood'], ['wood-grain', 'wood'],
	['packed-earth', 'terrain'], ['sand', 'terrain'], ['gravel', 'terrain'],
	['grass', 'terrain'], ['forest-floor', 'terrain'], ['water-ripples', 'water'],
	['snow', 'terrain'], ['ice', 'water'], ['parchment', 'paper'],
].map(([id, category]) => Object.freeze({
	id, category, path: `modules/foundryshop/assets/materials/${id}.png`,
	width: MATERIAL_SIZE, height: MATERIAL_SIZE,
})));

export function starterMaterials(query = '') {
	if (typeof query !== 'string') throw new Error('Invalid material search.');
	const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
	return STARTER_MATERIALS.filter(entry => {
		const text = `${entry.id} ${game.i18n.localize(`FOUNDRYSHOP.Materials.Name.${entry.id}`)} ${
			game.i18n.localize(`FOUNDRYSHOP.Materials.Category.${entry.category}`)}`.toLocaleLowerCase();
		return terms.every(term => text.includes(term));
	}).map(entry => ({ ...entry }));
}
