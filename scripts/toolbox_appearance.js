export const TOOLBOX_THEMES = ['slate', 'foundry', 'system'];
export const TOOLBOX_SCALE = Object.freeze({ min: 50, max: 125, step: 5, default: 100 });

export function validateToolboxScale(value) {
	if (!Number.isInteger(value) || value < TOOLBOX_SCALE.min || value > TOOLBOX_SCALE.max
		|| value % TOOLBOX_SCALE.step !== 0) {
		throw new Error(game.i18n.localize('FOUNDRYSHOP.Toolbox.InvalidScale'));
	}
	return value;
}

export function resolveToolboxTheme(value) {
	return TOOLBOX_THEMES.includes(value) ? value : 'slate';
}

export function flyoutPosition(anchor, panel, viewport, gap = 8) {
	const margin = 8;
	const width = Math.min(panel.width, Math.max(0, viewport.width - margin * 2));
	const height = Math.min(panel.height, Math.max(0, viewport.height - margin * 2));
	const right = anchor.right + gap;
	const left = anchor.left - gap - width;
	const side = right + width <= viewport.width - margin || anchor.left < viewport.width - anchor.right ? 'right' : 'left';
	return {
		left: Math.max(margin, Math.min(side === 'right' ? right : left, viewport.width - margin - width)),
		top: Math.max(margin, Math.min(anchor.top, viewport.height - margin - height)),
		width, height, side,
	};
}
