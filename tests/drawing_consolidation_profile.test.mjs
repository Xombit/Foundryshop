import test from 'node:test';
import assert from 'node:assert/strict';
import { DrawingConsolidationProfile } from '../tools/drawing-consolidation-profile.mjs';

function fixture() {
	const defaults = {
		name: '', x: 10, y: 20, elevation: 0, sort: 0, levels: ['ground'], rotation: 0, bezierFactor: 0.5,
		shape: { type: 'p', width: 50, height: 30, points: [0, 0, 20, 30, 50, 0], radius: null },
		fillType: 0, fillColor: '#ffffff', fillAlpha: 0.5, strokeWidth: 6, strokeColor: '#c0b090', strokeAlpha: 1,
		texture: null, text: '', fontFamily: '', fontSize: 48, textColor: '#ffffff', textAlpha: 1,
		hidden: false, locked: false, interface: false, flags: {},
	};
	class Drawing {
		static metadata = { schemaVersion: '14.355' };
		constructor(source, { parent } = {}) {
			this.source = { ...structuredClone(defaults), ...structuredClone(source),
				shape: { ...structuredClone(defaults.shape), ...source.shape } };
			this.parent = parent;
			this.id = source._id;
			this.object = { shape: { geometry: { refCount: 0 }, position: {}, pivot: {}, rotation: 0 }, texture: { valid: true } };
		}
		getFlag(namespace, key) { return this.source.flags[namespace]?.[key]; }
		toObject() { return structuredClone(this.source); }
		async update(patch) { Object.assign(this.source, patch); }
	}
	class Drawings extends Map { get contents() { return [...this.values()]; } }
	const events = [], files = new Map(), originals = { id: 'original-scene' };
	const scene = {
		id: 'fixture', name: 'Profiling', levels: new Set(['ground']), drawings: new Drawings(), flags: {},
		getFlag(_namespace, key) { return this.flags[key]; },
		async setFlag(_namespace, key, value) {
			if (key === 'profilingRecovery.phase') this.flags.profilingRecovery.phase = value;
			else this.flags[key] = structuredClone(value);
			events.push(`phase:${this.flags.profilingRecovery.phase}`);
		},
		async createEmbeddedDocuments(_type, sources, options) {
			assert.equal(options.keepId, true);
			events.push(`create:${sources.length}`);
			for (const source of sources) {
				if (this.drawings.has(source._id)) throw new Error('Occupied ID');
				this.drawings.set(source._id, new Drawing(source, { parent: this }));
			}
		},
		async deleteEmbeddedDocuments(_type, ids) {
			events.push(`delete:${ids.length}`);
			for (const id of ids) this.drawings.delete(id);
		},
	};
	for (let i = 0; i < 2; i++) scene.drawings.set(`stroke${i}`, new Drawing({
		...defaults, _id: `stroke${i}`, author: 'gm', sort: i,
	}, { parent: scene }));
	let id = 0;
	globalThis.game = { version: '14.365', user: { id: 'gm', isGM: true, can: () => true }, i18n: { localize: k => k } };
	globalThis.canvas = {
		ready: true, scene, level: { id: 'ground' },
		drawings: { active: true, controlled: [], get placeables() { return scene.drawings.contents.map(d => d.object); } },
		app: { renderer: { render() {}, extract: { canvas: () => ({ toBlob(callback) { callback(new Blob(['image'], { type: 'image/png' })); } }) } } },
	};
	globalThis.document = { visibilityState: 'visible' };
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.getDocumentClass = () => Drawing;
	globalThis.foundry = {
		utils: { randomID: () => `id${++id}` }, canvas: { loadTexture: async () => ({ valid: true, width: 1600, height: 1000 }) },
		applications: { instances: new Map(), apps: { FilePicker: { implementation: {
			async browse() { return { files: [...files.keys()] }; },
			async upload(_type, root, file) {
				const path = `${root}/${file.name}`;
				events.push(`upload:${path}`);
				if (state.denyUpload) return false;
				files.set(path, new Uint8Array(await file.arrayBuffer()));
				return { path };
			},
		} } } },
	};
	const nativeFetch = globalThis.fetch;
	globalThis.fetch = async url => {
		const path = new URL(url).pathname.slice(1);
		events.push(`read:${path}`);
		return new Response(files.get(path) ?? '', { status: files.has(path) ? 200 : 404 });
	};
	class Container {
		children = [];
		addChild(child) { this.children.push(child); }
		destroy() { for (const child of this.children) child.geometry.refCount--; }
	}
	class Graphics {
		constructor(geometry) {
			this.geometry = geometry; geometry.refCount++;
			this.position = this.pivot = { copyFrom() {} };
		}
	}
	globalThis.PIXI = { Container, Graphics, RenderTexture: { create: () => ({ destroy() {} }) } };
	const profile = new DrawingConsolidationProfile();
	profile.profile.start = async () => { profile.profile.scene = scene; profile.profile.original = originals; };
	profile.profile.sample = async () => ({ count: scene.drawings.size });
	profile.profile.cleanup = async () => { events.push('cleanup'); profile.profile.scene = null; return { cleaned: true }; };
	const state = { profile, scene, files, events, originals, denyUpload: false, restoreFetch: () => { globalThis.fetch = nativeFetch; } };
	return state;
}

test('disposable benchmark persists verified recovery, swaps, restores exact sources and retains only its files', async () => {
	const f = fixture();
	try {
		await f.profile.start('assets/profiling', 2);
		const before = f.scene.drawings.contents.map(d => d.toObject());
		const saved = await f.profile.prepare();
		assert.equal(saved.originals, 2);
		assert.equal(f.files.size, 2);
		assert.equal(f.scene.drawings.size, 2);
		assert.equal(f.events.some(e => e.startsWith('delete:')), false);
		assert.equal(f.profile.files.every(file => file.verified), true);
		await f.profile.consolidate();
		assert.equal(f.scene.drawings.size, 1);
		assert.ok(f.events.indexOf('phase:verified') < f.events.indexOf('delete:2'));
		assert.ok(f.events.indexOf('phase:staged') < f.events.indexOf('delete:2'));
		const restored = await f.profile.restore();
		assert.equal(restored.exactSources, true);
		assert.deepEqual(f.scene.drawings.contents.map(d => d.toObject()), before);
		assert.equal((await f.profile.cleanup()).retainedFiles.length, 2);
		assert.equal(f.files.size, 2);
	} finally { f.restoreFetch(); }
});

test('denied upload never permits deletion or consolidation and leaves originals intact', async () => {
	const f = fixture();
	try {
		await f.profile.start('assets/profiling', 2);
		const before = f.scene.drawings.contents.map(d => d.toObject());
		f.denyUpload = true;
		await assert.rejects(f.profile.prepare(), /exact path/);
		await assert.rejects(f.profile.consolidate(), /requires state verified/);
		assert.deepEqual(f.scene.drawings.contents.map(d => d.toObject()), before);
		assert.equal(f.files.size, 0);
		assert.equal(f.events.some(e => e.startsWith('delete:')), false);
		await f.profile.cleanup();
	} finally { f.restoreFetch(); }
});

test('changed durable image refuses the swap before creating or deleting Drawings', async () => {
	const f = fixture();
	try {
		await f.profile.start('assets/profiling', 2);
		await f.profile.prepare();
		f.files.set(f.profile.files[0].path, new TextEncoder().encode('changed'));
		await assert.rejects(f.profile.consolidate(), /image changed/);
		assert.equal(f.scene.drawings.size, 2);
		assert.equal(f.events.some(e => /^(create|delete):/.test(e)), false);
		await f.profile.cleanup();
	} finally { f.restoreFetch(); }
});

test('restore refuses edited composite and leaves its document untouched', async () => {
	const f = fixture();
	try {
		await f.profile.start('assets/profiling', 2);
		await f.profile.prepare();
		await f.profile.consolidate();
		f.scene.drawings.contents[0].source.x++;
		await assert.rejects(f.profile.restore(), /edited/);
		assert.equal(f.scene.drawings.size, 1);
		assert.equal(f.scene.flags.profilingRecovery.phase, 'composite');
		await f.profile.cleanup();
	} finally { f.restoreFetch(); }
});

test('benchmark guards states, limits, permissions and original Scene ownership', async () => {
	const f = fixture();
	try {
		await assert.rejects(f.profile.consolidate(), /requires state verified/);
		for (const count of [0, 1001, 1.5]) await assert.rejects(f.profile.start('assets/profiling', count), /1-1000/);
		game.user.can = () => false;
		await assert.rejects(f.profile.start('assets/profiling', 2), /permission/);
		game.user.can = () => true;
		await f.profile.start('assets/profiling', 2);
		f.profile.profile.scene = f.originals;
		await assert.rejects(f.profile.cleanup(), /ownership changed/);
		await assert.rejects(f.profile.prepare(), /context changed/);
		assert.equal(f.events.includes('cleanup'), false);
		f.profile.profile.scene = f.scene;
		await f.profile.cleanup();
	} finally { f.restoreFetch(); }
});
