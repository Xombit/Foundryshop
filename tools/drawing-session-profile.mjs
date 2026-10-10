const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));

/** Explicit disposable-world experiment, not startup code. One checkpoint per call keeps work bounded. */
export class DrawingSessionProfile {
	scene;
	original;
	results = [];
	#originalView;
	#originalLayer;
	#originalViewPosition;
	#count = 0;
	#profile;
	#baseline;
	#busy = false;
	#started = false;

	async start(profile) {
		if (!game.user.isGM || !canvas.ready || !canvas.scene || this.#started || !['map', 'detail'].includes(profile)) {
			throw new Error('Profile requires an idle GM canvas and a new map/detail fixture.');
		}
		if (canvas.activeLayer.controlled?.length) throw new Error('Deselect objects before starting the profile.');
		this.#started = true;
		this.original = canvas.scene;
		this.#originalView = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, scale: canvas.stage.scale.x };
		this.#originalLayer = canvas.activeLayer;
		this.#originalViewPosition = this.original._viewPosition;
		this.#profile = profile;
		this.#baseline = JSON.stringify(this.original.toObject());
		try {
			this.scene = await getDocumentClass('Scene').create({
				name: `Foundryshop disposable drawing profile (${profile})`, width: 1600, height: 1000,
				padding: 0, grid: { type: 0, size: 100 }, backgroundColor: '#202020',
			});
			await this.scene.view();
			canvas.pan({ x: 800, y: 500, scale: 1 });
			canvas.drawings.activate();
			await frame();
			return await this.sample(0);
		} catch (error) {
			try { await this.cleanup(); }
			catch (cleanup) { throw new AggregateError([error, cleanup], 'Profile startup and cleanup failed.'); }
			throw error;
		}
	}

	#sources(start, end) {
		const level = canvas.level.id, sources = [];
		for (let i = start; i < end; i++) {
			const detail = this.#profile === 'detail', extent = detail ? 24 : 180, coordinates = detail ? 64 : 24;
			const x = detail ? 540 + (i * 37 % 400) : 80 + (i * 73 % 1260);
			const y = detail ? 300 + (i * 53 % 350) : 80 + (i * 97 % 620);
			const points = [];
			for (let j = 0; j < coordinates / 2; j++) {
				points.push(j * extent / (coordinates / 2 - 1), extent / 2 + Math.sin(j * 0.7 + i) * extent / 3);
			}
			sources.push({
				x, y, shape: { type: 'p', width: extent, height: extent, points },
				levels: [level], elevation: 0, sort: i, rotation: 0, bezierFactor: 0.5,
				fillType: 0, strokeWidth: detail ? 2 : 6, strokeColor: '#c0b090', strokeAlpha: i % 5 ? 1 : 0.5,
				name: '', text: '', hidden: false, locked: false, interface: false,
			});
		}
		return sources;
	}

	async sample(count) {
		if (this.#busy || !this.scene || !game.user.isGM || !canvas.ready
			|| canvas.scene !== this.scene || this.scene.drawings.size !== this.#count || !Number.isInteger(count)
			|| count < this.#count || count > 2000 || document.visibilityState !== 'visible') {
			throw new Error('Invalid profile checkpoint or inactive fixture.');
		}
		this.#busy = true;
		try { return await this.#sample(count); }
		finally { this.#busy = false; }
	}

	async #sample(count) {
		const start = performance.now(), created = count - this.#count;
		for (let i = this.#count; i < count; i += 100) {
			const end = Math.min(i + 100, count);
			try {
				await this.scene.createEmbeddedDocuments('Drawing', this.#sources(i, end));
			} finally {
				this.#count = this.scene.drawings.size;
			}
			if (this.#count !== end) throw new Error('Profile batch did not create exactly the requested Drawings.');
		}
		const creationMs = performance.now() - start;
		await new Promise(resolve => setTimeout(resolve, 300));
		const intervals = [];
		let previous = await frame();
		for (let i = 0; i < 90; i++) {
			const current = await frame();
			intervals.push(current - previous);
			previous = current;
		}
		const interaction = [];
		const drawing = canvas.drawings.placeables.at(-1);
		if (drawing) {
			for (let i = 0; i < 5; i++) {
				const begin = performance.now();
				if (!drawing.control({ releaseOthers: true })) throw new Error('Profile control failed.');
				drawing.renderFlags.set({ refreshShape: true });
				await frame();
				drawing.release();
				await frame();
				interaction.push(performance.now() - begin);
			}
		}
		const serializedBytes = new TextEncoder().encode(JSON.stringify([...this.scene.drawings.values()].map(d => d.toObject()))).length;
		const result = {
			profile: this.#profile, count, coordinates: count * (this.#profile === 'detail' ? 64 : 24),
			created, creationMs, creationMsPerDrawing: created ? creationMs / created : 0,
			frameMedianMs: percentile(intervals, 0.5), frameP95Ms: percentile(intervals, 0.95),
			frameMaxMs: Math.max(...intervals), framesOver25Ms: intervals.filter(t => t > 25).length,
			controlRefreshReleaseMedianMs: interaction.length ? percentile(interaction, 0.5) : null,
			serializedBytes, ink: this.#inkCoverage(),
			viewport: { width: canvas.app.renderer.screen.width, height: canvas.app.renderer.screen.height,
				resolution: canvas.app.renderer.resolution, zoom: canvas.stage.scale.x },
		};
		this.results.push(result);
		return result;
	}

	#inkCoverage() {
		const renderer = canvas.app.renderer, root = new PIXI.Container(), borrowed = [];
		let target;
		try {
			root.position.set(canvas.stage.position.x - canvas.stage.pivot.x * canvas.stage.scale.x,
				canvas.stage.position.y - canvas.stage.pivot.y * canvas.stage.scale.y);
			root.scale.set(canvas.stage.scale.x);
			for (const drawing of canvas.drawings.placeables) {
				const source = drawing.shape, geometry = source.geometry;
				borrowed.push({ geometry, references: geometry.refCount });
				const shape = new PIXI.Graphics(geometry);
				root.addChild(shape);
				shape.position.copyFrom(source.position);
				shape.pivot.copyFrom(source.pivot);
				shape.rotation = source.rotation;
			}
			target = PIXI.RenderTexture.create({ width: renderer.screen.width, height: renderer.screen.height,
				resolution: renderer.resolution, multisample: 0 });
			renderer.render(root, { renderTexture: target, clear: true });
			const pixels = renderer.extract.pixels(target);
			let inkPixels = 0;
			for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) inkPixels++;
			return { pixels: inkPixels, viewportPixels: pixels.length / 4, percent: inkPixels * 400 / pixels.length };
		} finally {
			root.destroy({ children: true });
			target?.destroy(true);
			if (borrowed.some(({ geometry, references }) => geometry.refCount !== references)) {
				throw new Error('Coverage measurement did not restore borrowed geometry references.');
			}
		}
	}

	async cleanup() {
		if (this.#busy) throw new Error('Wait for the current profile checkpoint before cleanup.');
		const errors = [];
		if (this.original && canvas.scene === this.scene) {
			try {
				await this.original.view();
				canvas.pan(this.#originalView);
				this.original._viewPosition = this.#originalViewPosition;
				this.#originalLayer.activate();
				await frame();
			} catch (error) { errors.push(error); }
		}
		if (this.scene) {
			try {
				await this.scene.delete();
				this.scene = null;
			} catch (error) { errors.push(error); }
		}
		if (this.original && JSON.stringify(this.original.toObject()) !== this.#baseline) {
			errors.push(new Error('Original Scene source changed during profiling.'));
		}
		if (errors.length) throw new AggregateError(errors, 'Profile cleanup failed; inspect the original view and disposable Scene.');
		const clientRestored = !this.original || (canvas.scene === this.original && canvas.activeLayer === this.#originalLayer
			&& canvas.stage.pivot.x === this.#originalView.x && canvas.stage.pivot.y === this.#originalView.y
			&& canvas.stage.scale.x === this.#originalView.scale && this.original._viewPosition === this.#originalViewPosition);
		return { cleaned: true, originalUnchanged: true, clientRestored, results: this.results };
	}
}
