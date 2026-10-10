import { renderReviewedBake } from '../scripts/bake_render_review.js';
import { renderBakeRaster } from '../scripts/bake_raster.js';

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const fixtures = [
	{ name: 'opaque-rectangle', shape: { type: 'r', width: 140, height: 90 }, fillAlpha: 1 },
	{ name: 'rotated-ellipse', shape: { type: 'e', width: 140, height: 90 }, rotation: 37 },
	{ name: 'transparent-overlap', shape: { type: 'r', width: 140, height: 90 }, fillAlpha: 0.35, overlap: true },
	{ name: 'smoothed-open-path', shape: { type: 'p', width: 140, height: 90,
		points: [0, 45, 30, 10, 70, 80, 110, 20, 140, 45] }, fillType: 0, bezierFactor: 0.5 },
	{ name: 'smoothed-filled-polygon', shape: { type: 'p', width: 140, height: 90,
		points: [0, 45, 30, 0, 140, 20, 100, 90, 0, 45] }, bezierFactor: 0.3, rotation: 21 },
	{ name: 'rotated-text', shape: { type: 'r', width: 220, height: 110 },
		text: 'Bake fidelity\nAa 0123', fontSize: 24, rotation: 17, textAlpha: 0.65 },
	...[
		{ name: 'texture-fill', flags: {} },
		{ name: 'image-stamp', flags: { foundryshop: { imageStamp: 1 } } },
		{ name: 'material-repeat', flags: { foundryshop: { materialRepeat: 2 } } },
	].map(fixture => ({ shape: { type: 'r', width: 220, height: 140 }, fillType: 2,
		textureFixture: true,
		rotation: 13, ...fixture })),
];

function nativeDisplay(drawings) {
	const root = new PIXI.Container();
	try {
		for (const drawing of drawings) {
			const shape = drawing.shape;
			if (!shape?.geometry) throw new Error('Native Drawing geometry is unavailable.');
			const graphic = new PIXI.Graphics(shape.geometry);
			root.addChild(graphic);
			graphic.position.copyFrom(shape.position);
			graphic.pivot.copyFrom(shape.pivot);
			graphic.scale.copyFrom(shape.scale);
			graphic.rotation = shape.rotation;
			graphic.alpha = shape.alpha;
			if (drawing.text) {
				drawing.text.updateText(true);
				const text = new PIXI.Sprite(drawing.text.texture);
				graphic.addChild(text);
				text.position.copyFrom(drawing.text.position);
				text.anchor.copyFrom(drawing.text.anchor);
				text.scale.copyFrom(drawing.text.scale);
				text.rotation = drawing.text.rotation;
				text.alpha = drawing.text.alpha;
			}
		}
		return root;
	} catch (error) { root.destroy({ children: true }); throw error; }
}

async function pixels(blob) {
	const bitmap = await createImageBitmap(blob);
	try {
		const surface = document.createElement('canvas');
		surface.width = bitmap.width; surface.height = bitmap.height;
		const context = surface.getContext('2d', { willReadFrequently: true });
		if (!context) throw new Error('Fidelity comparison canvas is unavailable.');
		context.drawImage(bitmap, 0, 0);
		return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
	} finally { bitmap.close(); }
}

export class BakeFidelityAcceptance {
	scene;
	original;
	results = [];

	constructor({ texturePath } = {}) { this.texturePath = texturePath; }

	async start() {
		if (!game.user.isGM || game.users.activeGM?.id !== game.user.id || !canvas.ready || this.scene) {
			throw new Error('Fidelity acceptance requires a ready designated-GM client and a new fixture.');
		}
		this.original = canvas.scene;
		this.originalSource = JSON.stringify(this.original.toObject());
		this.scene = await getDocumentClass('Scene').create({
			name: 'Foundryshop disposable Bake fidelity acceptance', width: 640, height: 480,
			padding: 0, grid: { type: 0, size: 100 }, backgroundColor: '#202020',
		});
		await this.scene.view();
		return { sceneId: this.scene.id, fixtures: fixtures.map(f => f.name) };
	}

	async sample(index) {
		if (!canvas.ready || canvas.scene !== this.scene || !fixtures[index]) throw new Error('Invalid fidelity checkpoint.');
		const fixture = structuredClone(fixtures[index]), overlap = fixture.overlap;
		delete fixture.overlap;
		if (fixture.textureFixture) {
			if (typeof this.texturePath !== 'string' || !this.texturePath) throw new Error('Texture fixtures require an explicit existing image path.');
			fixture.texture = this.texturePath;
			delete fixture.textureFixture;
		}
		if (this.scene.drawings.size) await this.scene.deleteEmbeddedDocuments('Drawing', [...this.scene.drawings.keys()]);
		const source = {
			x: 160, y: 160, elevation: canvas.level.elevation.bottom, levels: [canvas.level.id], sort: 10,
			rotation: 0, fillType: 1, fillColor: '#d83b3b', fillAlpha: 0.8,
			strokeWidth: 5, strokeColor: '#6e1111', strokeAlpha: 0.7, bezierFactor: 0,
			text: '', fontFamily: CONFIG.defaultFontFamily, fontSize: 24, textColor: '#ffffff', textAlpha: 1,
			hidden: false, locked: false, interface: false, flags: {}, ...fixture,
		};
		const inputs = [source];
		if (overlap) inputs.push({ ...structuredClone(source), name: 'overlap', x: 200, y: 190,
			sort: 20, fillColor: '#3278d4' });
		const created = await this.scene.createEmbeddedDocuments('Drawing', inputs);
		const deadline = performance.now() + 10000;
		while (created.some(d => !d.object?.shape || d.texture && !d.object.texture?.valid)) {
			if (canvas.scene !== this.scene || performance.now() > deadline) {
				throw new Error('Native Drawing render/resources did not become ready for comparison.');
			}
			await frame();
		}
		await frame(); await frame();
		const drawings = [...this.scene.drawings.values()].sort((a, b) => a.sort - b.sort)
			.map(d => d.object);
		const references = drawings.map(d => d.shape.geometry.refCount);
		const isCurrent = () => canvas.ready && canvas.scene === this.scene;
		const bounds = { x: 80, y: 80, width: 480, height: 320 };
		const baked = await renderReviewedBake(drawings.map(d => d.document.toObject()), {
			bounds, format: 'png', quality: 1, isCurrent,
			approveReview: r => ({ proceed: true, width: r.width, height: r.height, format: r.format,
				quality: r.quality, croppedSourceIds: r.croppedSourceIds }),
		});
		const native = await renderBakeRaster({ bounds, format: 'png', quality: 1, isCurrent,
			buildDisplay: () => nativeDisplay(drawings) });
		const a = await pixels(baked.blob), b = await pixels(native.blob);
		let changed = 0, maximum = 0, total = 0, ink = 0;
		for (let i = 0; i < a.length; i += 4) {
			if (a[i + 3] || b[i + 3]) ink++;
			let difference = 0;
			for (let c = 0; c < 4; c++) {
				const delta = Math.abs(a[i + c] - b[i + c]);
				maximum = Math.max(maximum, delta); total += delta;
				difference = Math.max(difference, delta);
			}
			if (difference) changed++;
		}
		if (drawings.some((d, i) => d.shape.geometry.refCount !== references[i] || d.shape.destroyed)) {
			throw new Error('Native reference rendering leaked or destroyed live geometry.');
		}
		const result = { name: fixture.name, changedPixels: changed, inkPixels: ink,
			maximumChannelDelta: maximum, meanChannelDelta: total / a.length,
			exact: changed === 0, croppedSourceIds: baked.review.croppedSourceIds,
			disclosure: 'Native geometry/text texture versus Bake graph through identical raster/PNG extraction; not live primary/Tile shader certification.' };
		this.results.push(result);
		return result;
	}

	async cleanup() {
		if (this.scene) {
			await this.original.view();
			if (canvas.scene !== this.original || !canvas.ready) throw new Error('Original view restoration did not finish.');
			await this.scene.delete();
			this.scene = null;
		}
		if (JSON.stringify(this.original.toObject()) !== this.originalSource) {
			throw new Error('Original Scene source changed during fidelity acceptance.');
		}
		return { cleaned: true, results: this.results };
	}
}
