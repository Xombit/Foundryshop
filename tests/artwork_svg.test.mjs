import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { starterShape } from '../scripts/starter_shapes.js';
import { renderArtworkSvg, svgFidelityDiagnostics, svgPolygonPath } from '../scripts/artwork_svg.js';

let destroyed, fontReady;
const entry = () => {
	const value = structuredClone(starterShape('round-tree').project.drawings[0]);
	Object.assign(value.data, { name: 'Ink <&" test', hidden: false, texture: null, fillType: 1, elevation: 0, interface: false,
		text: '', shape: { type: 'r', width: 40, height: 20, points: [], radius: null }, strokeWidth: 4,
		fillAlpha: 0.8, strokeAlpha: 0.6, rotation: 30, x: 10, y: 20, sort: 0 });
	return value;
};
const options = () => ({ audience: 'player', crop: 'custom', bounds: { x: -10, y: 20, width: 100, height: 50 },
	scale: 2, acknowledgeFidelity: true });
class Container {
	constructor() {
		this.children = [];
		for (const key of ['position', 'pivot', 'scale', 'anchor']) this[key] = { set() {} };
	}
	addChild(child) { this.children.push(child); }
	getLocalBounds() { return { x: -2.5, y: 10.25, width: 42.5, height: 30.5 }; }
	destroy() { destroyed++; this.children.forEach(child => child.destroy()); }
}
class Graphics extends Container {
	constructor() { super(); this.line = { reset() {} }; }
	lineStyle() {}
	beginTextureFill() {}
	endFill() {}
	drawRect() {}
	drawEllipse() {}
	drawSmoothedPolygon(points, factor) {
		if (!factor) return this.drawShape?.({ points, closeStroke: true });
		this.moveTo?.(points[0], points[1]); this.bezierCurveTo?.(1, 2, 3, 4, points[2], points[3]); this.closePath?.(); this.finishPoly?.();
	}
	drawSmoothedPath(points, factor) {
		if (!factor) return this.drawShape?.({ points, closeStroke: false });
		this.moveTo?.(points[0], points[1]); this.quadraticCurveTo?.(1, 2, points[2], points[3]); this.finishPoly?.();
	}
}
beforeEach(() => {
	destroyed = 0; fontReady = true;
	globalThis.game = { version: '14.365', user: { isGM: true }, i18n: { localize: key => key } };
	globalThis.getDocumentClass = () => ({ metadata: { schemaVersion: '14.355' } });
	globalThis.document = { fonts: { check: () => fontReady } };
	globalThis.CONFIG = { defaultFontFamily: 'Signika', Drawing: { objectClass: class {
		_getTextStyle() { return { fontFamily: 'Signika', fontSize: this.document.fontSize, fill: this.document.textColor,
			stroke: '#111111', strokeThickness: 2, fontStyle: 'normal', fontWeight: 'normal', fontVariant: 'normal',
			align: 'center', textBaseline: 'alphabetic', trim: false,
			letterSpacing: 0, leading: 0, lineJoin: 'miter', miterLimit: 10,
			dropShadow: true, dropShadowBlur: 2, dropShadowAngle: 0, dropShadowDistance: 0, dropShadowAlpha: 1, dropShadowColor: '#000000' }; }
	} } };
	globalThis.foundry = { applications: { settings: { menus: { FontConfig: { getAvailableFonts: () => ['Signika'] } } } },
		canvas: { containers: { PreciseText: class extends Container {} } } };
	globalThis.PIXI = { Graphics, Container,
		TextMetrics: { measureText: () => ({ lines: ['A <&"', 'second'], width: 40, lineHeight: 20, height: 40, fontProperties: { ascent: 15, descent: 5 } }) } };
});
test('strict SVG preserves transformed geometry, output viewBox, styles and escaped names', async () => {
	const result = await renderArtworkSvg([entry()], options()), xml = await result.blob.text();
	assert.equal(result.blob.type, 'image/svg+xml'); assert.equal(result.width, 200); assert.equal(result.height, 100);
	assert.match(xml, /viewBox="-10 20 100 50"/); assert.match(xml, /Ink &lt;&amp;&quot; test/);
	assert.match(xml, /translate\(30 30\) rotate\(30\) translate\(-20 -10\)/);
	assert.match(xml, /<rect x="2" y="2" width="36" height="16"/);
	assert.match(xml, /stroke-linejoin="miter" stroke-linecap="butt" stroke-miterlimit="10"/);
	assert.equal(destroyed, 2); assert.doesNotMatch(xml, /<image|<script|href=|<foreignObject/);
});
test('native curve adapter records exact commands and open/closed topology without rasterization', () => {
	assert.equal(svgPolygonPath([0, 0, 10, 20], 0, false), 'M0 0 L10 20');
	assert.equal(svgPolygonPath([0, 0, 10, 20], 0, true), 'M0 0 L10 20 Z');
	assert.equal(svgPolygonPath([0, 0, 10, 20], 0.5, false), 'M0 0 Q1 2 10 20');
	assert.equal(svgPolygonPath([0, 0, 10, 20], 0.5, true), 'M0 0 C1 2 3 4 10 20 Z');
	assert.throws(() => svgPolygonPath([0, NaN, 10, 20], 0, false), /SVGGeometry/);
});
test('ellipse and smoothed paths remain vector; hidden GM opacity affects geometry not text', async () => {
	const a = entry(); a.data.shape.type = 'e'; a.data.hidden = true;
	const xml = await (await renderArtworkSvg([a], { ...options(), audience: 'gm' })).blob.text();
	assert.match(xml, /<ellipse cx="20" cy="10" rx="18" ry="8"/);
	assert.match(xml, /fill-opacity="0.4"/); assert.match(xml, /stroke-opacity="0.3"/);
	a.data.hidden = false; a.data.shape = { type: 'p', width: 40, height: 20, points: [0, 0, 10, 20, 40, 0], radius: null };
	a.data.bezierFactor = 0.5;
	assert.match(await (await renderArtworkSvg([a], options())).blob.text(), /<path d="M0 0 C1 2 3 4 10 20 Z"/);
});
test('native stack order is preserved across repeated named ancestor groups', async () => {
	const a = entry(), b = entry(), c = entry(); a.id = 'a'; b.id = 'b'; c.id = 'c';
	a.layerId = c.layerId = 'ink'; b.layerId = 'other'; a.data.sort = 1; b.data.sort = 2; c.data.sort = 3;
	const tree = { version: 1, revision: 0, presets: [], nodes: [
		{ id: 'group', name: 'Group <&', kind: 'group', parentId: null, locked: false, playerAllowed: true, defaults: {} },
		...['ink', 'other'].map(id => ({ id, name: id, kind: 'layer', parentId: 'group', locked: false, playerAllowed: true, defaults: {} })),
	] };
	const xml = await (await renderArtworkSvg([c, a, b], { ...options(), tree })).blob.text();
	assert.ok(xml.indexOf('data-drawing-id="a"') < xml.indexOf('data-drawing-id="b"'));
	assert.ok(xml.indexOf('data-drawing-id="b"') < xml.indexOf('data-drawing-id="c"'));
	assert.equal(xml.match(/data-layer-id="group"/g).length, 3); assert.match(xml, /Group &lt;&amp;/);
});
test('text uses native wrap metrics, explicit outlines/shadows, independent opacity and escaped spans', async () => {
	const a = entry(); a.data.text = 'A <&"\nsecond'; a.data.hidden = true; a.data.textAlpha = 0.75;
	const xml = await (await renderArtworkSvg([a], { ...options(), audience: 'gm' })).blob.text();
	assert.match(xml, /<g opacity="0.75" filter="url\(#shadow-0\)"/);
	assert.match(xml, /<feDropShadow/); assert.match(xml, /<tspan x="20" y="6">A &lt;&amp;&quot;<\/tspan>/);
	assert.match(xml, /<tspan x="20" y="26">second<\/tspan>/);
	assert.equal(destroyed, 3);
	fontReady = false;
	await assert.rejects(renderArtworkSvg([a], { ...options(), audience: 'gm' }), /SVGFont/);
	assert.equal(destroyed, 3);
});
test('raster diagnostics block every affected drawing without contacting resources or generating a partial SVG', async () => {
	const a = entry(), b = entry(); a.data.texture = 'maps/texture.png'; b.id = 'stamp';
	b.data.texture = 'maps/stamp.png'; b.data.flags.foundryshop = { imageStamp: 1 };
	const diagnostics = svgFidelityDiagnostics([a, b]); assert.equal(diagnostics.length, 2);
	await assert.rejects(renderArtworkSvg([a, b], options()), /SVGBlocked[\s\S]*SVGRaster/);
	assert.equal(destroyed, 0);
});
test('explicit fidelity/audience/crop, size, XML validity and cancellation are enforced', async () => {
	await assert.rejects(renderArtworkSvg([entry()], { ...options(), acknowledgeFidelity: false }), /Options/);
	await assert.rejects(renderArtworkSvg([entry()], { ...options(), crop: 'scene' }), /Options/);
	await assert.rejects(renderArtworkSvg([entry()], { ...options(), bounds: { x: 0, y: 0, width: 8193, height: 1 }, scale: 1 }), /Limit/);
	const a = entry(); a.data.name = 'invalid\u0001';
	await assert.rejects(renderArtworkSvg([a], options()), /SVGText/);
	a.data.hidden = true; await assert.rejects(renderArtworkSvg([a], options()), /Options/);
	const controller = new AbortController(); controller.abort();
	await assert.rejects(renderArtworkSvg([entry()], { ...options(), signal: controller.signal }), { name: 'AbortError' });
	game.user.isGM = false; await assert.rejects(renderArtworkSvg([entry()], options()), /Changed/);
});
test('measured bounds use native display metrics and dispose graphics even on later XML failure', async () => {
	const result = await renderArtworkSvg([entry()], { ...options(), crop: 'artwork', scale: 1 });
	assert.deepEqual(result.bounds, { x: -4, y: 9, width: 45, height: 33 });
	assert.equal(destroyed, 2);
});
test('degenerate geometry, oversized text and unsupported native text effects fail without partial output', async () => {
	const a = entry(); a.data.shape.width = a.data.strokeWidth;
	assert.equal(svgFidelityDiagnostics([a])[0].message, 'FOUNDRYSHOP.Publication.SVGDegenerate');
	await assert.rejects(renderArtworkSvg([a], options()), /SVGBlocked/);
	a.data.shape.width = 40; a.data.text = 'Text';
	const measure = PIXI.TextMetrics.measureText;
	PIXI.TextMetrics.measureText = (...args) => ({ ...measure(...args), height: 8193 });
	await assert.rejects(renderArtworkSvg([a], options()), /SVGText/);
	PIXI.TextMetrics.measureText = measure;
	const style = CONFIG.Drawing.objectClass.prototype._getTextStyle;
	CONFIG.Drawing.objectClass.prototype._getTextStyle = function() { return { ...style.call(this), fill: 'url(https://example.invalid)' }; };
	await assert.rejects(renderArtworkSvg([a], options()), /SVGText/);
	assert.equal(destroyed, 0);
});
