export const MATERIAL_REPEAT = 'materialRepeat';
export const MATERIAL_REPEAT_MAX = 10000000;

export function validateMaterialRepeat(value, { squares = false } = {}) {
	if (!Number.isFinite(value) || value <= 0 || value > (squares ? 100 : MATERIAL_REPEAT_MAX)
		|| (squares && value < 0.05)) throw new Error('Invalid material repeat size.');
	return value;
}

export function materialFillStyle(data, texture, style) {
	const repeat = data.flags?.foundryshop?.materialRepeat;
	if (repeat === undefined || data.fillType !== 2 || !data.texture || data.flags?.foundryshop?.imageStamp === 1) return style;
	validateMaterialRepeat(repeat);
	if (!texture?.valid || !texture.width || !texture.height) throw new Error('Material texture is unavailable.');
	return { ...style, matrix: new PIXI.Matrix().scale(repeat / texture.width, repeat / texture.width) };
}

export function materialCreationPatch(defaults, scene) {
	const { materialRepeat, ...source } = defaults;
	const native = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined));
	if (materialRepeat === undefined || native.fillType !== 2 || !native.texture) return native;
	validateMaterialRepeat(materialRepeat, { squares: true });
	const grid = scene.grid?.type === 0 ? 100 : Number(scene.grid?.size ?? 100);
	if (!Number.isFinite(grid) || grid <= 0) throw new Error('Invalid Scene grid size.');
	const pixels = validateMaterialRepeat(materialRepeat * grid);
	return { ...native, 'flags.foundryshop.materialRepeat': pixels };
}
