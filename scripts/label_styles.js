export function normalizeLabelStyle(style) {
	if (style === undefined) return undefined;
	if (!style || typeof style !== 'object' || Array.isArray(style)
		|| Object.keys(style).some(key => !['fontFamily', 'fontSize', 'textColor', 'textAlpha'].includes(key))
		|| typeof style.fontFamily !== 'string' || !style.fontFamily.trim() || style.fontFamily.length > 100
		|| /["\\\r\n<>;]/.test(style.fontFamily)
		|| !Number.isInteger(style.fontSize) || style.fontSize < 8 || style.fontSize > 256
		|| !/^#[0-9a-f]{6}$/i.test(style.textColor)
		|| (style.textAlpha !== undefined && (!Number.isFinite(style.textAlpha) || style.textAlpha < 0 || style.textAlpha > 1))) {
		throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.InvalidStyle'));
	}
	return { fontFamily: style.fontFamily.trim(), fontSize: style.fontSize, textColor: style.textColor,
		...(style.textAlpha === undefined ? {} : { textAlpha: style.textAlpha }) };
}

export const STARTER_LABELS = [
	...['Entrance', 'Hall', 'Storage', 'StairsUp', 'StairsDown', 'Cave', 'River', 'Ruins'].map(key => ({
		key, style: { fontFamily: key === 'River' || key === 'Ruins' ? 'Amiri' : 'Signika',
			fontSize: key === 'River' || key === 'Ruins' ? 36 : 24, textColor: '#302b26' },
	})),
	{ key: 'WhisperingWoods', style: { fontFamily: 'Amiri', fontSize: 48, textColor: '#31513b' } },
	{ key: 'SilverRiver', style: { fontFamily: 'Amiri', fontSize: 40, textColor: '#395d72' } },
	{ key: 'OldWatchtower', style: { fontFamily: 'Amiri', fontSize: 36, textColor: '#302b26' } },
	{ key: 'DungeonTitle', style: { fontFamily: 'Modesto Condensed', fontSize: 64, textColor: '#302b26' } },
	{ key: 'TavernTitle', style: { fontFamily: 'Modesto Condensed', fontSize: 48, textColor: '#302b26' } },
	{ key: 'MapNote', style: { fontFamily: 'Signika', fontSize: 22, textColor: '#302b26' } },
];

export function starterLabels() {
	return STARTER_LABELS.map(({ key, style }) => ({
		id: `example-${key}`, name: game.i18n.localize(`FOUNDRYSHOP.Labels.${key === 'MapNote' ? 'ExampleName' : 'Starter'}.${key}`),
		text: game.i18n.localize(`FOUNDRYSHOP.Labels.Starter.${key}`), style: { ...style },
	}));
}
