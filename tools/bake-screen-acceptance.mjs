import { promptReviewedTileBake, promptRestoreTileBake } from '../scripts/layers/bake_entry.js';
import { canonicalJson } from '../scripts/layers/project_package.js';
import { renderReviewedBake } from '../scripts/bake_render_review.js';
import { prepareBakeDrawingDisplay } from '../scripts/bake_drawings.js';

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const views = [
	{ name: '100%-aligned', zoom: 1, aligned: true },
	{ name: '100%-fractional', zoom: 1, aligned: false },
	{ name: '125%', zoom: 1.25, aligned: false },
	{ name: '150%', zoom: 1.5, aligned: false },
];

function compare(a, b) {
	if (a.length !== b.length) throw new Error('Screen sample dimensions changed.');
	let changed = 0, maximum = 0, total = 0, aboveTwo = 0;
	for (let i = 0; i < a.length; i += 4) {
		let difference = 0;
		for (let channel = 0; channel < 4; channel++) {
			const delta = Math.abs(a[i + channel] - b[i + channel]);
			maximum = Math.max(maximum, delta);
			total += delta;
			difference = Math.max(difference, delta);
		}
		if (difference) changed++;
		if (difference > 2) aboveTwo++;
	}
	return { pixels: a.length / 4, changedPixels: changed, pixelsAboveTwo: aboveTwo,
		maximumChannelDelta: maximum, meanChannelDelta: total / a.length };
}

async function decodedPixels(blob) {
	const bitmap = await createImageBitmap(blob);
	try {
		const surface = document.createElement('canvas');
		surface.width = bitmap.width; surface.height = bitmap.height;
		const context = surface.getContext('2d', { willReadFrequently: true });
		if (!context) throw new Error('Precision comparison canvas is unavailable.');
		context.drawImage(bitmap, 0, 0);
		return context.getImageData(0, 0, surface.width, surface.height).data;
	} finally { bitmap.close(); }
}

function cropPixels(pixels, sourceWidth, bounds) {
	const result = new Uint8Array(bounds.width * bounds.height * 4);
	for (let y = 0; y < bounds.height; y++) {
		const offset = ((bounds.y + y) * sourceWidth + bounds.x) * 4;
		result.set(pixels.subarray(offset, offset + bounds.width * 4), y * bounds.width * 4);
	}
	return result;
}

/** Explicit live framebuffer experiment. It uploads retained evidence only after exact review. */
export class BakeScreenAcceptance {
	constructor({ root } = {}) { this.root = root; this.results = []; }

	async start() {
		if (!game.user.isGM || game.users.activeGM?.id !== game.user.id || !canvas.ready || this.scene) {
			throw new Error('Screen acceptance requires a ready designated GM and a new fixture.');
		}
		this.original = canvas.scene;
		this.originalSource = canonicalJson(this.original.toObject());
		this.originalView = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, scale: canvas.stage.scale.x };
		this.scene = await getDocumentClass('Scene').create({
			name: 'Foundryshop disposable Tile screen acceptance', width: 640, height: 480,
			padding: 0, grid: { type: 0, size: 100 }, backgroundColor: '#202020',
		});
		await this.scene.view();
		const base = {
			name: '', x: 70, y: 70, elevation: canvas.level.elevation.bottom, levels: [canvas.level.id],
			sort: 10, rotation: 0, fillType: 1, fillColor: '#d83b3b', fillAlpha: 0.6,
			strokeWidth: 5, strokeColor: '#6e1111', strokeAlpha: 0.8, bezierFactor: 0,
			shape: { type: 'r', width: 120, height: 90 }, text: '', fontFamily: CONFIG.defaultFontFamily,
			fontSize: 24, textColor: '#ffffff', textAlpha: 0.65,
			hidden: false, locked: false, interface: false, flags: {},
		};
		await this.scene.createEmbeddedDocuments('Drawing', [
			base,
			{ ...base, x: 110, y: 100, sort: 20, fillColor: '#3278d4', fillAlpha: 0.35 },
			{ ...base, x: 280, sort: 30, rotation: 37, shape: { type: 'e', width: 120, height: 90 } },
			{ ...base, x: 450, sort: 40, rotation: 21, bezierFactor: 0.3,
				shape: { type: 'p', width: 120, height: 90, points: [0, 45, 30, 0, 120, 20, 100, 90, 0, 45] } },
			{ ...base, x: 70, y: 270, sort: 50, fillType: 0, bezierFactor: 0.5,
				shape: { type: 'p', width: 140, height: 90, points: [0, 45, 30, 10, 70, 80, 110, 20, 140, 45] } },
			{ ...base, x: 330, y: 270, sort: 60, rotation: 17,
				shape: { type: 'r', width: 220, height: 110 }, text: 'Tile fidelity\nAa 0123' },
		]);
		await frame(); await frame();
		this.originals = [...this.scene.drawings.values()].map(d => d.toObject());
		this.dialogs = {
			approveScope: async r => {
				if (r.includedCount !== 6 || r.excludedCount || r.blockers.length) throw new Error('Screen fixture scope changed.');
				return { excludedIds: [], flattenToGround: true };
			},
			approveRender: async r => {
				if (r.croppedSourceIds.length) throw new Error('Screen fixture ink would be cropped.');
				return { proceed: true, width: r.width, height: r.height, format: r.format,
					quality: r.quality, croppedSourceIds: [] };
			},
			approvePlacement: async r => ({ flattenToGround: true, overlappingTileIds: r.overlappingTileIds }),
			approvePreview: async () => true,
			approvePersistence: async r => ({ approvedPaths: r.paths }),
			approveExecution: async r => ({ resumeOperation: true, sourceIds: r.sourceIds }),
			approveRestoreIntent: async () => true,
		};
		return { sceneId: this.scene.id, drawings: this.originals.length };
	}

	async capture({ zoom, aligned = false }) {
		if (!canvas.ready || canvas.scene !== this.scene) throw new Error('Screen fixture is not displayed.');
		canvas.pan({ x: 320, y: 240, scale: zoom });
		await frame(); await frame();
		canvas.app.render();
		if (canvas.stage.scale.x !== zoom) throw new Error('Foundry constrained the requested zoom; do not label it as measured.');
		if (aligned) {
			const transform = canvas.stage.worldTransform;
			canvas.pan({ x: canvas.stage.pivot.x + (transform.tx - Math.floor(transform.tx)) / zoom,
				y: canvas.stage.pivot.y + (transform.ty - Math.floor(transform.ty)) / zoom, scale: zoom });
			await frame(); await frame();
			canvas.app.render();
		}
		const renderer = canvas.app.renderer, matrix = canvas.stage.worldTransform;
		const left = Math.floor(matrix.tx), top = Math.floor(matrix.ty);
		const width = Math.round(640 * matrix.a), height = Math.round(480 * matrix.d);
		if (left < 0 || top < 0 || left + width > renderer.width || top + height > renderer.height
			|| renderer.resolution !== 1) throw new Error('Screen fixture is clipped or uses an unverified resolution.');
		const all = renderer.extract.pixels();
		if (all.length !== renderer.width * renderer.height * 4) throw new Error('Screen readback is incomplete.');
		const pixels = new Uint8Array(width * height * 4);
		for (let y = 0; y < height; y++) {
			const offset = ((top + y) * renderer.width + left) * 4;
			pixels.set(all.subarray(offset, offset + width * 4), y * width * 4);
		}
		return { pixels, left, top, width, height, actualZoom: matrix.a, translationX: matrix.tx, translationY: matrix.ty };
	}

	async baseline() {
		this.baselines = new Map();
		for (const view of views) {
			const first = await this.capture(view), second = await this.capture(view);
			const result = compare(first.pixels, second.pixels);
			if (result.changedPixels) throw new Error('Native screen reference is unstable.');
			this.baselines.set(view.name, first);
		}
		return { stable: true, views };
	}

	async precision() {
		const screen = await this.capture(views[0]);
		const sources = [...this.scene.drawings.values()].map(d => d.toObject());
		if (sources.length !== 6 || this.scene.tiles.size) throw new Error('Precision isolation requires exact native fixture state.');
		const renderer = canvas.app.renderer;
		const bounds = [
			{ x: 0, y: 0, width: 640, height: 480 },
			{ x: 67, y: 42, width: 522, height: 368 },
			{ x: -screen.translationX, y: -screen.translationY, width: renderer.width, height: renderer.height },
		];
		const samples = [];
		for (const crop of bounds) {
			const rendered = await renderReviewedBake(sources, {
				bounds: crop, format: 'png', quality: 1,
				isCurrent: () => canvas.ready && canvas.scene === this.scene,
				approveReview: r => {
					if (r.croppedSourceIds.length) throw new Error('Precision comparison clips fixture ink.');
					return { proceed: true, width: r.width, height: r.height, format: r.format,
						quality: r.quality, croppedSourceIds: [] };
				},
			});
			samples.push(await decodedPixels(rendered.blob));
		}
		const tight = bounds[1];
		const reference = cropPixels(samples[0], 640, tight);
		const translated = cropPixels(samples[2], renderer.width, {
			...tight, x: tight.x + screen.translationX, y: tight.y + screen.translationY,
		});
		return {
			tightVersusSceneOrigin: compare(samples[1], reference),
			screenTranslationVersusSceneOrigin: compare(translated, reference),
			screenTranslationVersusTight: compare(translated, samples[1]),
			disclosure: 'Same Bake graph and PNG pipeline at different integer translations/target sizes; no Tile shader or native primary graph involved.',
		};
	}

	async primaryIsolation() {
		const view = views[0], reference = await this.capture(view);
		const primaryPixels = canvas.app.renderer.extract.pixels(canvas.primary.renderTexture);
		const backgroundOffset = ((reference.top + 20) * canvas.app.renderer.width + reference.left + 20) * 4;
		const background = Array.from(primaryPixels.slice(backgroundOffset, backgroundOffset + 4));
		const drawings = [...this.scene.drawings.values()].map(d => d.object);
		const visibility = drawings.map(d => d.shape.visible);
		const sources = drawings.map(d => d.document.toObject());
		const isCurrent = () => canvas.ready && canvas.scene === this.scene;
		const prepared = prepareBakeDrawingDisplay(sources, { isCurrent });
		const rendered = await renderReviewedBake(sources, {
			format: 'png', quality: 1, isCurrent,
			approveReview: r => ({ proceed: true, width: r.width, height: r.height,
				format: r.format, quality: r.quality, croppedSourceIds: r.croppedSourceIds }),
		});
		let graph, sprite, texture, bitmap, raw, screenRaw, opaqueRaw;
		try {
			drawings.forEach(d => { d.shape.visible = false; });
			graph = prepared.buildDisplay();
			canvas.primary.addChild(graph);
			canvas.primary.renderDirty = true;
			const graphScreen = await this.capture(view);
			graph.parent.removeChild(graph);
			graph.destroy({ children: true }); graph = null;
			bitmap = await createImageBitmap(rendered.blob);
			texture = PIXI.Texture.from(bitmap);
			sprite = new PIXI.Sprite(texture);
			sprite.position.set(rendered.bounds.x, rendered.bounds.y);
			canvas.primary.addChild(sprite);
			canvas.primary.renderDirty = true;
			const spriteScreen = await this.capture(view);
			sprite.parent.removeChild(sprite); sprite.destroy(); sprite = null;
			graph = prepared.buildDisplay();
			graph.position.set(-rendered.bounds.x, -rendered.bounds.y);
			raw = PIXI.RenderTexture.create({ width: rendered.width, height: rendered.height, resolution: 1 });
			canvas.app.renderer.render(graph, { renderTexture: raw, clear: true });
			graph.destroy({ children: true }); graph = null;
			sprite = new PIXI.Sprite(raw);
			sprite.position.set(rendered.bounds.x, rendered.bounds.y);
			canvas.primary.addChild(sprite);
			canvas.primary.renderDirty = true;
			const rawScreen = await this.capture(view);
			sprite.parent.removeChild(sprite); sprite.destroy(); sprite = null;
			graph = prepared.buildDisplay();
			graph.position.set(reference.translationX, reference.translationY);
			screenRaw = PIXI.RenderTexture.create({
				width: canvas.app.renderer.width, height: canvas.app.renderer.height, resolution: 1,
			});
			canvas.app.renderer.render(graph, { renderTexture: screenRaw, clear: true });
			graph.destroy({ children: true }); graph = null;
			sprite = new PIXI.Sprite(screenRaw);
			sprite.position.set(-reference.translationX, -reference.translationY);
			canvas.primary.addChild(sprite);
			canvas.primary.renderDirty = true;
			const matchedScreen = await this.capture(view);
			sprite.parent.removeChild(sprite); sprite.destroy(); sprite = null;
			graph = prepared.buildDisplay();
			graph.position.set(reference.translationX, reference.translationY);
			opaqueRaw = PIXI.RenderTexture.create({
				width: canvas.app.renderer.width, height: canvas.app.renderer.height, resolution: 1,
				format: PIXI.FORMATS.RGB, scaleMode: PIXI.SCALE_MODES.NEAREST,
			});
			opaqueRaw.baseTexture.clearColor = background.map(value => value / 255);
			canvas.app.renderer.render(graph, { renderTexture: opaqueRaw, clear: true });
			graph.destroy({ children: true }); graph = null;
			sprite = new PIXI.Sprite(opaqueRaw);
			sprite.position.set(-reference.translationX, -reference.translationY);
			canvas.primary.addChild(sprite);
			canvas.primary.renderDirty = true;
			const opaqueScreen = await this.capture(view);
			return {
				plainGraphVersusNativePrimary: compare(graphScreen.pixels, reference.pixels),
				pngSpriteVersusNativePrimary: compare(spriteScreen.pixels, reference.pixels),
				pngSpriteVersusPlainGraph: compare(spriteScreen.pixels, graphScreen.pixels),
				rawRasterVersusNativePrimary: compare(rawScreen.pixels, reference.pixels),
				pngVersusRawRaster: compare(spriteScreen.pixels, rawScreen.pixels),
				matchedProjectionRasterVersusNative: compare(matchedScreen.pixels, reference.pixels),
				opaqueBackdropRasterVersusNative: compare(opaqueScreen.pixels, reference.pixels),
				diagnosticBackdrop: background,
				disclosure: 'Owned plain graph/PNG Sprite in the actual primary group, native shapes temporarily hidden without document writes; no native Tile shader.',
			};
		} finally {
			if (graph) { graph.parent?.removeChild(graph); graph.destroy({ children: true }); }
			if (sprite) { sprite.parent?.removeChild(sprite); sprite.destroy(); }
			texture?.destroy(true);
			raw?.destroy(true);
			screenRaw?.destroy(true);
			opaqueRaw?.destroy(true);
			bitmap?.close();
			drawings.forEach((d, i) => { d.shape.visible = visibility[i]; });
			canvas.primary.renderDirty = true;
			const restored = await this.capture(view);
			if (compare(restored.pixels, reference.pixels).changedPixels) {
				throw new Error('Primary isolation did not restore exact native screen state.');
			}
		}
	}

	async apply() {
		this.token = `ScreenBake${foundry.utils.randomID()}`;
		const result = await promptReviewedTileBake(this.scene, {
			token: this.token, root: this.root, levelId: canvas.level.id,
			kind: 'all', audience: 'player', sort: 0, format: 'png', quality: 1,
		}, { reviewDialogs: this.dialogs });
		if (result.status !== 'complete' || this.scene.drawings.size || this.scene.tiles.size !== 1) {
			throw new Error('Screen Bake did not complete with one replacement.');
		}
		this.tile = [...this.scene.tiles.values()][0];
		this.files = result.journal.entries.at(-1);
		return { token: this.token, archive: this.files.archive, asset: this.files.asset };
	}

	async measure() {
		const results = [];
		for (const view of views) {
			const sample = await this.capture(view), baseline = this.baselines.get(view.name);
			if (['left', 'top', 'width', 'height'].some(key => sample[key] !== baseline[key])) {
				throw new Error('Screen viewport changed between native and Tile rendering.');
			}
			results.push({ name: view.name, zoom: sample.actualZoom,
				translationX: sample.translationX, translationY: sample.translationY,
				...compare(sample.pixels, baseline.pixels) });
		}
		this.results = results;
		return results;
	}

	async hidden() {
		await this.tile.update({ hidden: true });
		try {
			const sample = await this.capture(views[0]), baseline = this.baselines.get(views[0].name);
			return { hidden: true, ...compare(sample.pixels, baseline.pixels),
				disclosure: 'GM hidden Tile dimming is intentional, not equality with visible originals.' };
		} finally { await this.tile.update({ hidden: false }); }
	}

	async restore() {
		const result = await promptRestoreTileBake(this.scene, this.token, {}, { reviewDialogs: this.dialogs });
		if (result.status !== 'complete' || this.scene.tiles.size || this.scene.drawings.size !== this.originals.length
			|| this.originals.some(o => canonicalJson(this.scene.drawings.get(o._id)?.toObject()) !== canonicalJson(o))) {
			throw new Error('Screen fixture exact restoration failed.');
		}
		return { exactRestoration: true };
	}

	async cleanup() {
		await this.original.view();
		if (!canvas.ready || canvas.scene !== this.original) throw new Error('Original Scene view did not restore.');
		canvas.pan(this.originalView);
		await this.scene.delete();
		if (canonicalJson(this.original.toObject()) !== this.originalSource) throw new Error('Original Scene source changed.');
		return { cleaned: true };
	}
}
