import { classifyTexturePath } from './layers/project_resources.js';

const fail = () => { throw new Error(game.i18n.localize('FOUNDRYSHOP.Publication.BackgroundInvalid')); };

export function validatePublicationBackground(input) {
	if (!input || !input.rect || !input.texture || !input.transform
		|| ![input.rect.x, input.rect.y, input.rect.width, input.rect.height, input.elevation,
			...['anchorX', 'anchorY', 'offsetX', 'offsetY', 'scaleX', 'scaleY', 'rotation'].map(key => input.transform[key])].every(Number.isFinite)
		|| input.rect.width <= 0 || input.rect.height <= 0
		|| !['fill', 'cover', 'contain', 'width', 'height'].includes(input.transform.fit)
		|| input.transform.scaleX === 0 || input.transform.scaleY === 0
		|| !/^#[0-9a-f]{6}$/i.test(input.texture.color) || !/^#[0-9a-f]{6}$/i.test(input.texture.tint)
		|| !(input.texture.src === null || typeof input.texture.src === 'string'
			&& classifyTexturePath(input.texture.src, location.href).kind !== 'invalid')) fail();
	return structuredClone(input);
}

export function publicationBackgroundSnapshot(scene, levelId) {
	const level = scene.levels.get(levelId);
	if (!level || typeof level.toObject !== 'function' || typeof scene.getDimensions !== 'function') fail();
	const source = level.toObject(), rect = scene.getDimensions().sceneRect;
	return validatePublicationBackground({
		rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
		texture: { src: source.background.src, color: String(source.background.color), tint: String(source.background.tint) },
		transform: { ...source.textures }, elevation: source.elevation.bottom,
	});
}

export function backgroundTextureScale(background, width, height) {
	if (![width, height].every(value => Number.isFinite(value) && value > 0)) fail();
	const { rect, transform } = validatePublicationBackground(background);
	let x = rect.width / width, y = rect.height / height;
	if (transform.fit === 'cover') x = y = Math.max(x, y);
	else if (transform.fit === 'contain') x = y = Math.min(x, y);
	else if (transform.fit === 'width') y = x;
	else if (transform.fit === 'height') x = y;
	return { x: x * transform.scaleX, y: y * transform.scaleY };
}

export function buildPublicationBackground(background, texture) {
	const input = validatePublicationBackground(background), { rect, transform } = input;
	const root = new PIXI.Container();
	try {
		const color = new PIXI.Graphics();
		root.addChild(color);
		color.beginFill(input.texture.color).drawRect(rect.x, rect.y, rect.width, rect.height).endFill();
		if (input.texture.src) {
			if (!texture?.valid) fail();
			const sprite = new PIXI.Sprite(texture); root.addChild(sprite);
			const scale = backgroundTextureScale(input, texture.width, texture.height);
			sprite.anchor.set(transform.anchorX, transform.anchorY);
			sprite.position.set(rect.x + rect.width / 2 + transform.offsetX, rect.y + rect.height / 2 + transform.offsetY);
			sprite.scale.set(scale.x, scale.y); sprite.angle = transform.rotation; sprite.tint = input.texture.tint;
		}
		return root;
	} catch (error) { root.destroy({ children: true }); throw error; }
}
