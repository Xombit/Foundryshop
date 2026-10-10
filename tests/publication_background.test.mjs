import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicationBackground, publicationBackgroundSnapshot, backgroundTextureScale,
	buildPublicationBackground } from '../scripts/publication_background.js';

export const backgroundFixture = () => ({
	rect: { x: 100, y: 200, width: 400, height: 300 }, elevation: 0,
	texture: { src: 'maps/background.webp', color: '#123456', tint: '#abcdef' },
	transform: { anchorX: 0.25, anchorY: 0.75, offsetX: 20, offsetY: -10, scaleX: -2, scaleY: 0.5, rotation: 30, fit: 'fill' },
});
beforeEach(() => {
	globalThis.game = { i18n: { localize: key => key } }; globalThis.location = { href: 'http://localhost/game' };
});
test('all five fit modes match native resize with signed independent scales', () => {
	const background = backgroundFixture();
	const expected = { fill: [-4, 3], cover: [-12, 3], contain: [-4, 1], width: [-4, 1], height: [-12, 3] };
	for (const [fit, [x, y]] of Object.entries(expected)) {
		background.transform.fit = fit;
		assert.deepEqual(backgroundTextureScale(background, 200, 50), { x, y });
	}
});
test('background snapshot copies selected-Level fields and exact Scene rect without live canvas texture references', () => {
	const input = backgroundFixture();
	const source = { background: input.texture, textures: input.transform, elevation: { bottom: input.elevation } };
	const scene = { levels: new Map([['level', { toObject: () => structuredClone(source) }]]),
		getDimensions: () => ({ sceneRect: input.rect }) };
	const snapshot = publicationBackgroundSnapshot(scene, 'level');
	assert.deepEqual(snapshot, input);
	snapshot.transform.rotation = 90; assert.equal(input.transform.rotation, 30);
	assert.throws(() => publicationBackgroundSnapshot(scene, 'missing'), /BackgroundInvalid/);
});
test('invalid paths/color/fit/geometry and zero/NaN transforms fail explicitly', () => {
	for (const modify of [
		b => b.texture.src = 'data:image/png;base64,x', b => b.texture.tint = 'red',
		b => b.transform.fit = 'stretch', b => b.transform.scaleX = 0, b => b.transform.rotation = NaN,
		b => b.rect.width = 0, b => b.elevation = Infinity,
	]) {
		const value = backgroundFixture(); modify(value);
		assert.throws(() => validatePublicationBackground(value), /BackgroundInvalid/);
	}
	const colorOnly = backgroundFixture(); colorOnly.texture.src = null;
	assert.equal(validatePublicationBackground(colorOnly).texture.src, null);
});
test('background graph draws base color first, then positioned/rotated/tinted image without native hooks', () => {
	class Container {
		constructor() { this.children = []; for (const key of ['anchor', 'position', 'scale']) this[key] = { set: (...args) => this[key].values = args }; }
		addChild(child) { this.children.push(child); return child; }
		destroy() { this.destroyed = true; }
	}
	class Graphics extends Container {
		beginFill(color) { this.color = color; return this; }
		drawRect(...args) { this.rect = args; return this; }
		endFill() { return this; }
	}
	globalThis.PIXI = { Container, Graphics, Sprite: class extends Container { constructor(texture) { super(); this.texture = texture; } } };
	const root = buildPublicationBackground(backgroundFixture(), { valid: true, width: 200, height: 50 });
	assert.deepEqual(root.children[0].rect, [100, 200, 400, 300]); assert.equal(root.children[0].color, '#123456');
	const sprite = root.children[1];
	assert.deepEqual(sprite.position.values, [320, 340]); assert.deepEqual(sprite.anchor.values, [0.25, 0.75]);
	assert.deepEqual(sprite.scale.values, [-4, 3]); assert.equal(sprite.angle, 30); assert.equal(sprite.tint, '#abcdef');
	assert.throws(() => buildPublicationBackground(backgroundFixture(), null), /BackgroundInvalid/);
});
