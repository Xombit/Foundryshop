import { prepareArtworkSnapshot, buildArtworkDisplay, publicationDimensions, PUBLICATION_LIMITS, PREVIEW_LIMITS } from './artwork_renderer.js';
import { validateLayerTree } from './layers/layer_tree_store.js';

const loc = key => game.i18n.localize(`FOUNDRYSHOP.Publication.${key}`);
const escapeXml = value => {
	const text = String(value);
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(text) || !text.isWellFormed()) throw new Error(loc('SVGText'));
	return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
};
const number = value => {
	if (!Number.isFinite(value)) throw new Error(loc('SVGGeometry'));
	return String(Object.is(value, -0) ? 0 : value);
};
const attribute = (key, value) => ` ${key}="${escapeXml(value)}"`;

export function svgFidelityDiagnostics(entries) {
	const project = prepareArtworkSnapshot(entries);
	return project.drawings.flatMap(({ id, data }) => {
		const messages = [];
		if (data.fillType === 2 || data.texture || data.flags.foundryshop?.imageStamp === 1) messages.push(loc('SVGRaster'));
		if (['r', 'e'].includes(data.shape.type)
			&& (data.shape.width <= data.strokeWidth || data.shape.height <= data.strokeWidth)) messages.push(loc('SVGDegenerate'));
		return messages.map(message => ({ id, name: data.name || id, message }));
	});
}

export function svgPolygonPath(points, factor, closed) {
	const commands = [];
	const record = (command, values = []) => commands.push(command + values.map(number).join(' '));
	const recorder = {
		moveTo: (...values) => record('M', values), quadraticCurveTo: (...values) => record('Q', values),
		bezierCurveTo: (...values) => record('C', values), closePath: () => record('Z'), finishPoly() {},
		drawShape: polygon => {
			for (let i = 0; i < polygon.points.length; i += 2) record(i ? 'L' : 'M', polygon.points.slice(i, i + 2));
			if (polygon.closeStroke) record('Z');
		},
		drawSmoothedPolygon: PIXI.Graphics.prototype.drawSmoothedPolygon,
	};
	const method = closed ? 'drawSmoothedPolygon' : 'drawSmoothedPath';
	if (typeof PIXI.Graphics.prototype[method] !== 'function') throw new Error(loc('SVGGeometry'));
	// Record the public native curve calls, retaining curves rather than rasterizing or reimplementing smoothing.
	PIXI.Graphics.prototype[method].call(recorder, points, factor * 2);
	if (!commands.length) throw new Error(loc('SVGGeometry'));
	return commands.join(' ');
}

function geometry(data, audience) {
	const alpha = audience === 'gm' && data.hidden ? 0.5 : 1;
	const style = attribute('fill', data.fillType ? data.fillColor : 'none')
		+ attribute('fill-opacity', data.fillAlpha * alpha) + attribute('fill-rule', 'nonzero')
		+ attribute('stroke', data.strokeWidth ? data.strokeColor : 'none') + attribute('stroke-width', data.strokeWidth)
		+ attribute('stroke-opacity', data.strokeAlpha * alpha)
		+ ' stroke-linejoin="miter" stroke-linecap="butt" stroke-miterlimit="10"';
	const { width, height, points, type } = data.shape, inset = data.strokeWidth / 2;
	if (type === 'r') return `<rect x="${number(inset)}" y="${number(inset)}" width="${number(Math.max(width - data.strokeWidth, 0))}" height="${number(Math.max(height - data.strokeWidth, 0))}"${style}/>`;
	if (type === 'e') return `<ellipse cx="${number(width / 2)}" cy="${number(height / 2)}" rx="${number(Math.max(width - data.strokeWidth, 0) / 2)}" ry="${number(Math.max(height - data.strokeWidth, 0) / 2)}"${style}/>`;
	const closed = !!data.fillType || points[0] === points.at(-2) && points[1] === points.at(-1);
	return `<path${attribute('d', svgPolygonPath(points, data.bezierFactor, closed))}${style}/>`;
}

function textMarkup(data, index) {
	if (!data.text) return '';
	const style = CONFIG.Drawing.objectClass.prototype._getTextStyle.call({ document: data });
	if (!document.fonts.check(`${data.fontSize}px "${data.fontFamily || CONFIG.defaultFontFamily}"`)) throw new Error(loc('SVGFont'));
	const metrics = PIXI.TextMetrics.measureText(data.text, style);
	const numeric = [metrics.width, metrics.lineHeight, metrics.height, metrics.fontProperties.ascent, metrics.fontProperties.descent,
		style.strokeThickness, style.letterSpacing, style.leading];
	if (!numeric.every(Number.isFinite) || !metrics.lines?.length
		|| !['normal', 'italic', 'oblique'].includes(style.fontStyle)
		|| style.align !== 'center' || style.textBaseline !== 'alphabetic' || style.trim
		|| !['normal', 'small-caps'].includes(style.fontVariant)
		|| !/^(normal|bold|bolder|lighter|[1-9]00)$/.test(String(style.fontWeight))
		|| !/^#[0-9a-f]{6}$/i.test(style.fill) || !/^#[0-9a-f]{6}$/i.test(style.stroke)
		|| !['miter', 'round', 'bevel'].includes(style.lineJoin)
		|| !Number.isFinite(style.miterLimit) || style.miterLimit <= 0) throw new Error(loc('SVGText'));
	if (metrics.width > PREVIEW_LIMITS.textAxis || metrics.height > PREVIEW_LIMITS.textAxis
		|| metrics.width * metrics.height > PUBLICATION_LIMITS.pixels) throw new Error(loc('SVGText'));
	const lineHeight = metrics.lineHeight + style.leading;
	const top = data.shape.height / 2 - metrics.height / 2;
	const baseline = top + style.strokeThickness / 2 + metrics.fontProperties.ascent;
	let filter = '', filterAttribute = '';
	if (style.dropShadow) {
		const values = [style.dropShadowAngle, style.dropShadowDistance, style.dropShadowBlur, style.dropShadowAlpha];
		if (!values.every(Number.isFinite) || !/^#[0-9a-f]{6}$/i.test(style.dropShadowColor)) throw new Error(loc('SVGText'));
		filter = `<defs><filter id="shadow-${index}" x="-100%" y="-100%" width="300%" height="300%"><feDropShadow dx="${number(Math.cos(style.dropShadowAngle) * style.dropShadowDistance)}" dy="${number(Math.sin(style.dropShadowAngle) * style.dropShadowDistance)}" stdDeviation="${number(style.dropShadowBlur / 2)}"${attribute('flood-color', style.dropShadowColor)}${attribute('flood-opacity', style.dropShadowAlpha)}/></filter></defs>`;
		filterAttribute = attribute('filter', `url(#shadow-${index})`);
	}
	const spans = metrics.lines.map((line, i) => `<tspan x="${number(data.shape.width / 2)}" y="${number(baseline + i * lineHeight)}">${escapeXml(line)}</tspan>`).join('');
	return filter + `<g opacity="${number(data.textAlpha)}"${filterAttribute}><text xml:space="preserve" text-anchor="middle" paint-order="stroke fill"${attribute('font-family', style.fontFamily)}${attribute('font-size', data.fontSize)}${attribute('font-weight', style.fontWeight)}${attribute('font-style', style.fontStyle)}${attribute('font-variant', style.fontVariant)}${attribute('letter-spacing', style.letterSpacing)}${attribute('fill', style.fill)}${attribute('stroke', style.stroke)}${attribute('stroke-width', style.strokeThickness)}${attribute('stroke-linejoin', style.lineJoin)}${attribute('stroke-miterlimit', style.miterLimit)}>${spans}</text></g>`;
}

function namedGroups(markup, layerId, tree) {
	const ancestors = [];
	let node = tree?.nodes.find(node => node.id === layerId);
	while (node) {
		ancestors.unshift(node);
		node = tree.nodes.find(parent => parent.id === node.parentId);
		if (ancestors.length > tree.nodes.length) throw new Error(loc('SVGGeometry'));
	}
	if (!ancestors.length) return `<g><title>${escapeXml(layerId ? loc('SVGOrphan') : loc('SVGUnassigned'))}</title>${markup}</g>`;
	for (const node of ancestors.reverse()) markup = `<g${attribute('data-layer-id', node.id)}><title>${escapeXml(node.name)}</title>${markup}</g>`;
	return markup;
}

export async function renderArtworkSvg(entries, options = {}) {
	const check = () => {
		if (options.signal?.aborted) throw new DOMException('Publication cancelled.', 'AbortError');
		if (!game.user.isGM) throw new Error(loc('Changed'));
	};
	check();
	if (!['player', 'gm'].includes(options.audience) || !['artwork', 'custom'].includes(options.crop)
		|| options.background || options.acknowledgeFidelity !== true) throw new Error(loc('Options'));
	publicationDimensions(options.crop === 'custom' ? options.bounds : { x: 0, y: 0, width: 1, height: 1 }, options.scale);
	const diagnostics = svgFidelityDiagnostics(entries);
	if (diagnostics.length) throw new Error(`${loc('SVGBlocked')}\n${diagnostics.map(item => `${item.name} (${item.id}): ${item.message}`).join('\n')}`);
	const project = prepareArtworkSnapshot(entries);
	if (!project.drawings.length) throw new Error(game.i18n.localize('FOUNDRYSHOP.Preview.Empty'));
	if (options.audience === 'player' && project.drawings.some(({ data }) => data.hidden)) throw new Error(loc('Options'));
	const tree = options.tree ? validateLayerTree(options.tree) : null;
	const texts = project.drawings.map(({ data }, index) => textMarkup(data, index));
	const display = buildArtworkDisplay(project, new Map(), { publication: true, nativeHidden: options.audience === 'gm' });
	let bounds;
	try {
		const measured = display.getLocalBounds();
		bounds = options.crop === 'custom' ? { ...options.bounds } : { x: Math.floor(measured.x) - 1, y: Math.floor(measured.y) - 1,
			width: Math.ceil(measured.x + measured.width) - Math.floor(measured.x) + 2,
			height: Math.ceil(measured.y + measured.height) - Math.floor(measured.y) + 2 };
	} finally { display.destroy({ children: true }); }
	const { width, height } = publicationDimensions(bounds, options.scale);
	const memberships = new Map(entries.map(entry => [entry.id, entry.layerId]));
	const body = project.drawings.map(({ id, data }, index) => {
		check();
		const transform = `translate(${number(data.x + data.shape.width / 2)} ${number(data.y + data.shape.height / 2)}) rotate(${number(data.rotation)}) translate(${number(-data.shape.width / 2)} ${number(-data.shape.height / 2)})`;
		return namedGroups(`<g${attribute('data-drawing-id', id)}${attribute('transform', transform)}><title>${escapeXml(data.name || id)}</title>${geometry(data, options.audience)}${texts[index]}</g>`, memberships.get(id), tree);
	}).join('');
	const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${[bounds.x, bounds.y, bounds.width, bounds.height].map(number).join(' ')}" overflow="hidden"><desc>${escapeXml(loc('SVGDescription'))}</desc>${body}</svg>`;
	const blob = new Blob([svg], { type: 'image/svg+xml' });
	if (blob.size > PUBLICATION_LIMITS.encodedBytes) throw new Error(loc('Limit'));
	check();
	return { blob, width, height, bounds, drawings: project.drawings.length };
}
