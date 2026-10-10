const hues = ['Red', 'Orange', 'Yellow', 'YellowGreen', 'Green', 'BlueGreen',
	'Cyan', 'Blue', 'Blue', 'Purple', 'Magenta', 'Pink', 'Red'];

export function describeColor(color) {
	if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
		throw new Error(game.i18n.localize('FOUNDRYSHOP.Saved.InvalidColor'));
	}
	const [r, g, b] = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255);
	const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
	const lightness = (max + min) / 2;
	const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
	if (lightness <= 0.06) return { hue: 'Black', tone: null };
	if (lightness >= 0.96) return { hue: 'White', tone: null };
	if (saturation <= 0.12) return { hue: 'Gray', tone: lightness < 0.3 ? 'Dark' : lightness > 0.7 ? 'Light' : null };
	let hue = delta === 0 ? 0 : max === r ? ((g - b) / delta) % 6
		: max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
	hue = (hue * 60 + 360) % 360;
	let family = hues[Math.floor((hue + 15) / 30)];
	if (hue >= 15 && hue < 45 && lightness < 0.45) family = 'Brown';
	return { hue: family, tone: lightness < 0.25 ? 'Dark' : lightness > 0.78 ? 'Pale'
		: lightness > 0.62 ? 'Light' : saturation < 0.4 ? 'Muted' : null };
}

export function suggestedColorName(color) {
	const { hue, tone } = describeColor(color);
	const name = game.i18n.localize(`FOUNDRYSHOP.ColorNames.Hue.${hue}`);
	return tone ? game.i18n.format(`FOUNDRYSHOP.ColorNames.Tone.${tone}`, { color: name }) : name;
}
