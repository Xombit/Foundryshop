import { DrawingSessionProfile } from './drawing-session-profile.mjs';
import { profileDrawingDirectory } from './drawing-directory-profile.mjs';
import { createConsolidationArchive, readConsolidationArchive, prepareConsolidationRestore } from '../scripts/layers/consolidation_recovery.js';
import { exportProjectDrawing } from '../scripts/layers/project_transfer_service.js';
import { canonicalJson } from '../scripts/layers/project_package.js';
import { validateAssetFolder } from '../scripts/artwork_stamps.js';

const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
	.map(byte => byte.toString(16).padStart(2, '0')).join('');
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

async function readBytes(path, limit) {
	const response = await fetch(new URL(path.split('/').map(encodeURIComponent).join('/'), location.href), {
		credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
	});
	if (!response.ok || !response.body) throw new Error(`Profiling asset readback failed: HTTP ${response.status}.`);
	const reader = response.body.getReader(), chunks = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) throw new Error('Profiling asset exceeds its readback budget.');
			chunks.push(value);
		}
	} finally { await reader.cancel(); reader.releaseLock(); }
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
	return bytes;
}

/** Authorized disposable-Scene benchmark only; not a production consolidation transaction. */
export class DrawingConsolidationProfile {
	profile = new DrawingSessionProfile();
	results = {};
	files = [];
	#state = 'new';
	#busy = false;
	#root;
	#id;
	#originals;
	#replacement;
	#archivePath;
	#imagePath;
	#imageHash;
	#scene;

	async #run(state, operation) {
		if (this.#busy || this.#state !== state) throw new Error(`Profile requires state ${state}; current state is ${this.#state}.`);
		this.#busy = true;
		try { return await operation(); }
		finally { this.#busy = false; }
	}

	#check() {
		if (!game.user.isGM || !canvas.ready || !this.#scene || this.profile.scene !== this.#scene
			|| this.#scene === this.profile.original || canvas.scene !== this.#scene
			|| !canvas.drawings.active || canvas.drawings.controlled.length || document.visibilityState !== 'visible') {
			throw new Error('Disposable consolidation profile context changed.');
		}
	}

	async start(root, count = 500) {
		return this.#run('new', async () => {
			if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('Profile count must be 1-1000.');
			this.#root = validateAssetFolder(root);
			if (!game.user.isGM || !game.user.can('FILES_UPLOAD') || !game.user.can('FILES_BROWSE')) {
				throw new Error('GM upload/browse permission is required for the authorized benchmark.');
			}
			await this.profile.start('map');
			this.#scene = this.profile.scene;
			this.#state = 'originals';
			this.results.baseline = await this.profile.sample(count);
			return this.results.baseline;
		});
	}

	async diagnose() {
		return this.#run(this.#state, async () => {
			if (!['originals', 'composite', 'restored'].includes(this.#state)) throw new Error('No measurable benchmark state.');
			this.#check();
			const result = await profileDrawingDirectory();
			this.results[this.#state] = result;
			return result;
		});
	}

	async #upload(blob, filename) {
		this.#check();
		const picker = foundry.applications.apps.FilePicker.implementation;
		const listing = await picker.browse('data', this.#root);
		const path = `${this.#root}/${filename}`;
		if (!Array.isArray(listing.files) || listing.files.some(file => decodeURIComponent(file).toLowerCase() === path.toLowerCase())) {
			throw new Error('Profiling asset listing is invalid or the unique path is already occupied.');
		}
		this.#check();
		if (!game.user.can('FILES_UPLOAD')) throw new Error('Upload permission changed.');
		this.files.push({ path, verified: false });
		const result = await picker.upload('data', this.#root, new File([blob], filename, { type: blob.type }), {}, { notify: false });
		if (!result?.path || decodeURIComponent(result.path) !== path) throw new Error(`Profiling upload did not return its exact path: ${path}.`);
		const persisted = await readBytes(path, 5 * 1024 * 1024);
		if (await hash(persisted) !== await hash(await blob.arrayBuffer())) throw new Error(`Profiling readback differs: ${path}.`);
		this.#check();
		this.files.at(-1).verified = true;
		return { path, bytes: persisted };
	}

	async prepare() {
		return this.#run('originals', async () => {
			this.#check();
			const scene = this.profile.scene;
			this.#id ??= foundry.utils.randomID();
			this.#originals = scene.drawings.contents.map(d => d.toObject());
			if (this.#originals.some(source => Object.values(source).includes(undefined))) {
				throw new Error('Profiling originals must have explicit JSON-round-trippable optional fields.');
			}
			const blob = await this.#capture();
			if (!same(scene.drawings.contents.map(d => d.toObject()), this.#originals)) throw new Error('Profiling originals changed during rasterization.');
			const image = await this.#upload(blob, `profile-${this.#id}.png`);
			this.#imagePath = image.path;
			this.#imageHash = await hash(image.bytes);
			const texture = await foundry.canvas.loadTexture(image.path);
			if (!texture?.valid || texture.width !== 1600 || texture.height !== 1000) throw new Error('Persisted profiling image did not decode at its expected size.');
			const source = {
				_id: foundry.utils.randomID(), author: game.user.id, name: '', text: '',
				x: 0, y: 0, shape: { type: 'r', width: 1600, height: 1000 },
				levels: [canvas.level.id], elevation: 0, sort: 0, rotation: 0,
				strokeWidth: 0, fillType: 2, fillColor: '#ffffff', fillAlpha: 1,
				texture: image.path, flags: { foundryshop: { imageStamp: 1 } },
			};
			const Drawing = getDocumentClass('Drawing');
			this.#replacement = new Drawing(source, { parent: scene }).toObject();
			const archive = await createConsolidationArchive(scene, this.#originals.map(d => d._id),
				exportProjectDrawing({ id: source._id, toObject: () => structuredClone(this.#replacement) }),
				{ id: this.#id, levelId: canvas.level.id });
			const saved = await this.#upload(new Blob([archive.text], { type: 'application/json' }), `profile-${this.#id}-originals.json`);
			const archiveText = new TextDecoder('utf-8', { fatal: true }).decode(saved.bytes);
			this.#archivePath = saved.path;
			const verified = await readConsolidationArchive(archiveText);
			if (verified.checksum !== archive.checksum || !same(verified.payload.originals, this.#originals)) throw new Error('Persisted archive does not match all exact originals.');
			this.#check();
			if (!same(scene.drawings.contents.map(d => d.toObject()), this.#originals)) throw new Error('Profiling originals changed before archive verification.');
			await scene.setFlag('foundryshop', 'profilingRecovery', {
				archive: saved.path, image: image.path, checksum: archive.checksum, phase: 'verified',
				originalIds: this.#originals.map(d => d._id), compositeId: this.#replacement._id,
			});
			this.#state = 'verified';
			this.results.persistence = { files: structuredClone(this.files), checksum: archive.checksum,
				imageBytes: image.bytes.length, archiveBytes: saved.bytes.length, originals: this.#originals.length };
			return this.results.persistence;
		});
	}

	async #capture() {
		const renderer = canvas.app.renderer, root = new PIXI.Container(), borrowed = [];
		let target;
		try {
			for (const drawing of canvas.drawings.placeables) {
				const source = drawing.shape, geometry = source.geometry;
				borrowed.push({ geometry, refs: geometry.refCount });
				const shape = new PIXI.Graphics(geometry);
				root.addChild(shape);
				shape.position.copyFrom(source.position);
				shape.pivot.copyFrom(source.pivot);
				shape.rotation = source.rotation;
			}
			target = PIXI.RenderTexture.create({ width: 1600, height: 1000, resolution: 1, multisample: 0 });
			renderer.render(root, { renderTexture: target, clear: true });
			const image = renderer.extract.canvas(target);
			const blob = await new Promise(resolve => image.toBlob(resolve, 'image/png'));
			if (!blob || blob.type !== 'image/png' || blob.size > 5 * 1024 * 1024) throw new Error('Profiling image encoding failed or exceeded budget.');
			return blob;
		} finally {
			root.destroy({ children: true });
			target?.destroy(true);
			if (borrowed.some(({ geometry, refs }) => geometry.refCount !== refs)) throw new Error('Profiling geometry references were not restored.');
		}
	}

	async consolidate() {
		return this.#run('verified', async () => {
			this.#check();
			const scene = this.profile.scene;
			const archive = await readConsolidationArchive(new TextDecoder().decode(await readBytes(this.#archivePath, 5 * 1024 * 1024)));
			if (archive.checksum !== this.results.persistence.checksum || archive.payload.sceneId !== scene.id
				|| !same(archive.payload.replacement, exportProjectDrawing({
					id: this.#replacement._id, toObject: () => structuredClone(this.#replacement),
				})) || !same(archive.payload.originals, this.#originals)
				|| !same(scene.drawings.contents.map(d => d.toObject()), this.#originals)) throw new Error('Originals or durable recovery changed before replacement.');
			if (await hash(await readBytes(this.#imagePath, 5 * 1024 * 1024)) !== this.#imageHash) {
				throw new Error('Persisted profiling image changed before replacement.');
			}
			this.#check();
			const started = performance.now();
			await scene.createEmbeddedDocuments('Drawing', [{ ...this.#replacement, hidden: true }], { keepId: true });
			const composite = scene.drawings.get(this.#replacement._id);
			if (!composite || !same({ ...composite.toObject(), hidden: false }, this.#replacement)
				|| !composite.object?.shape || !composite.object.texture?.valid) throw new Error('Staged profiling composite was not verified.');
			this.#check();
			await scene.setFlag('foundryshop', 'profilingRecovery.phase', 'staged');
			for (let i = 0; i < this.#originals.length; i += 100) {
				this.#check();
				const sources = this.#originals.slice(i, i + 100);
				if (sources.some(source => !same(scene.drawings.get(source._id)?.toObject(), source))) throw new Error('An original changed during the disposable swap.');
				await scene.deleteEmbeddedDocuments('Drawing', sources.map(source => source._id));
			}
			await composite.update({ hidden: false });
			if (scene.drawings.size !== 1 || !same(composite.toObject(), this.#replacement)) throw new Error('Profiling replacement did not match the archive.');
			await scene.setFlag('foundryshop', 'profilingRecovery.phase', 'composite');
			this.#state = 'composite';
			this.results.swapMs = performance.now() - started;
			await new Promise(resolve => setTimeout(resolve, 500));
			return { count: scene.drawings.size, swapMs: this.results.swapMs, archive: this.#archivePath };
		});
	}

	async restore() {
		return this.#run('composite', async () => {
			this.#check();
			const scene = this.profile.scene, started = performance.now();
			const text = new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(this.#archivePath, 5 * 1024 * 1024));
			const plan = await prepareConsolidationRestore(scene, text);
			if (plan.removeCompositeId !== this.#replacement._id || !same(plan.create, this.#originals)) throw new Error('Restore preview did not match benchmark ownership.');
			this.#check();
			await scene.setFlag('foundryshop', 'profilingRecovery.phase', 'restoring');
			for (let i = 0; i < plan.create.length; i += 100) {
				this.#check();
				await scene.createEmbeddedDocuments('Drawing', plan.create.slice(i, i + 100), { keepId: true });
			}
			if (plan.create.some(source => !same(scene.drawings.get(source._id)?.toObject(), source))) throw new Error('Restored originals failed exact native-source verification.');
			const composite = scene.drawings.get(plan.removeCompositeId);
			if (!composite || !same(composite.toObject(), this.#replacement)) throw new Error('Composite changed during profiling restoration.');
			this.#check();
			await scene.deleteEmbeddedDocuments('Drawing', [plan.removeCompositeId]);
			if (scene.drawings.size !== this.#originals.length) throw new Error('Restoration Drawing count differs.');
			await scene.setFlag('foundryshop', 'profilingRecovery.phase', 'restored');
			this.#state = 'restored';
			this.results.restore = { ms: performance.now() - started, exactSources: true, count: scene.drawings.size };
			await new Promise(resolve => setTimeout(resolve, 500));
			return this.results.restore;
		});
	}

	async cleanup() {
		if (this.#busy) throw new Error('Wait for the current consolidation checkpoint before cleanup.');
		if (this.profile.scene && (this.profile.scene !== this.#scene || this.profile.scene === this.profile.original)) {
			throw new Error('Profiling Scene ownership changed; cleanup refused to delete another Scene.');
		}
		const result = await this.profile.cleanup();
		const app = foundry.applications.instances.get('foundryshop-toolbox');
		if (!canvas.drawings.active && app?.rendered) await app.close({ foundryshopHide: true });
		this.#state = 'cleaned';
		return { ...result, benchmark: this.results, retainedFiles: this.files };
	}
}
