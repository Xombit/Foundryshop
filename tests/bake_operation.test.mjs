import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prepareBakeOperation } from '../scripts/layers/bake_operation.js';
import { canonicalJson } from '../scripts/layers/project_package.js';
import { fileFingerprint } from '../scripts/verified_file_storage.js';
import { readOptimizationJournal, beginOptimizationOperation } from '../scripts/layers/optimization_journal.js';
import { readOptimizationArchive } from '../scripts/layers/optimization_recovery.js';
import { inspectOptimizationImage } from '../scripts/optimization_media.js';
import { optimizationOutputVerifier } from '../scripts/optimization_media.js';
import { resumeOptimizationOperation } from '../scripts/layers/optimization_executor.js';
import { prepareOptimizationScope } from '../scripts/layers/optimization_scope.js';
import { reviewBakeAssetRecovery } from '../scripts/layers/bake_asset_recovery.js';
import { assertOptimizationNativeSchemas } from '../scripts/layers/optimization_native.js';
import { prepareOptimizationPlacement } from '../scripts/layers/optimization_placement.js';
import { publicationBackgroundSnapshot } from '../scripts/publication_background.js';
import { reviewOptimizationExecution } from '../scripts/layers/optimization_execution_review.js';

const root = 'worlds/test/recovery', token = 'bake001';
let scene, source, level, files, events, current, params, failUpload;
const doc = data => ({ id: data._id, toObject: () => structuredClone(data) });
function png(width, height) {
	const bytes = new Uint8Array(58), view = new DataView(bytes.buffer);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); view.setUint32(8, 13);
	bytes.set([... 'IHDR'].map(c => c.charCodeAt()), 12);
	view.setUint32(16, width); view.setUint32(20, height);
	view.setUint32(33, 1); bytes.set([... 'IDAT'].map(c => c.charCodeAt()), 37);
	bytes.set([... 'IEND'].map(c => c.charCodeAt()), 50); return bytes;
}
beforeEach(async () => {
	current = true; files = new Map(); events = []; failUpload = false;
	source = { _id: 'stroke001', author: 'gm001', levels: ['level001'], flags: {},
		shape: { type: 'r', width: 100, height: 50 }, x: 0, y: 0, hidden: false };
	level = { _id: 'level001', background: { src: null, color: '#000000', tint: '#ffffff', alphaThreshold: 0.5 },
		textures: { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0, fit: 'fill', scaleX: 1, scaleY: 1, rotation: 0 },
		elevation: { bottom: 0, top: 10 }, flags: {} };
	scene = { id: 'scene001', width: 100, height: 50, padding: 0,
		grid: { toObject: () => ({ size: 100 }) }, levels: new Map([['level001', doc(level)]]),
		drawings: new Map([['stroke001', doc(source)]]), tiles: new Map(), flags: {},
		getFlag(ns, key) { return this.flags[key]; }, canUserModify: () => true,
		async update(patch) {
			const journal = patch['flags.foundryshop.optimizationJournal'];
			events.push(`journal:${journal.entries.at(-1).phase}`);
			this.flags.optimizationJournal = structuredClone(journal);
		} };
	globalThis.game = { user: { id: 'gm001', isGM: true, can: () => true },
		users: { activeGM: { id: 'gm001' } }, scenes: new Map([[scene.id, scene]]),
		i18n: { localize: key => key }, settings: { get: () => ({ version: 1, scenes: {} }) } };
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.foundry = { applications: { apps: { FilePicker: { implementation: {
		browse: async () => ({ files: [...files.keys()] }),
		upload: async (type, folder, file) => {
			const path = `${folder}/${file.name}`; events.push(`upload:${path}`);
			files.set(path, new Uint8Array(await file.arrayBuffer()));
			if (failUpload) { failUpload = false; throw new Error('upload response lost'); }
			return { path };
		},
	} } } } };
	globalThis.fetch = async url => {
		const path = decodeURIComponent(url.pathname).slice(1);
		return new Response(files.get(path), { status: files.has(path) ? 200 : 404 });
	};
	globalThis.createImageBitmap = async blob => {
		const header = inspectOptimizationImage(new Uint8Array(await blob.arrayBuffer()));
		return { width: header.width, height: header.height, close() {} };
	};
	const bounds = { x: 0, y: 0, width: 100, height: 50 }, after = {
		_id: 'tile001', levels: ['level001'], flags: {}, texture: { src: `${root}/bake-${token}.png` },
		...bounds, hidden: false, locked: true,
	};
	params = { token, root, sourceIds: ['stroke001'], levelId: 'level001', scope: { kind: 'all', layerId: null },
		rendered: { blob: new Blob([png(100, 50)], { type: 'image/png' }), ...bounds, bounds,
			sourceDigest: await fileFingerprint(new TextEncoder().encode(canonicalJson([source]))),
			review: { destination: 'tile', format: 'png', quality: 0.9, width: 100, height: 50, bounds, sourceIds: ['stroke001'] } },
		replacement: { type: 'Tile', id: 'tile001', before: null, staged: { ...after, hidden: true }, after },
		isCurrent: () => current, verifyNative: async () => true };
});
const prepare = extra => prepareBakeOperation(scene, { ...params, ...extra });
function nativeMocks() {
	const collections = { Drawing: scene.drawings, Tile: scene.tiles, Level: scene.levels };
	scene.createEmbeddedDocuments = async (type, sources) => {
		for (const data of sources) collections[type].set(data._id, doc(data));
	};
	scene.deleteEmbeddedDocuments = async (type, ids) => {
		for (const id of ids) collections[type].delete(id);
	};
	scene.updateEmbeddedDocuments = async (type, patches) => {
		for (const patch of patches) {
			const data = { ...collections[type].get(patch._id).toObject(), ...patch };
			collections[type].set(patch._id, doc(data));
		}
	};
}
const outputVerifier = prepared => optimizationOutputVerifier(prepared.output, { width: 100, height: 50 },
	{ isCurrent: () => current });
async function execution(prepared, operationToken = token, extra = {}) {
	const reviewed = await reviewOptimizationExecution(scene, operationToken,
		{ isCurrent: () => current, verifyOutput: outputVerifier(prepared), ...extra });
	return { reviewed, approval: reviewed.approve({ sourceIds: reviewed.review.sourceIds, resumeOperation: true }) };
}
function background() {
	level.background.src = 'maps/original.png';
	const before = structuredClone(level), after = structuredClone(level);
	after.background.src = `${root}/bake-${token}.png`; after.background.color = '#ffffff';
	params.replacement = { type: 'LevelBackground', id: level._id, before, staged: null, after };
	params.rendered.review.destination = 'background';
	params.rendered.background = { rect: params.rendered.bounds,
		texture: { src: level.background.src, color: level.background.color, tint: level.background.tint }, transform: level.textures };
}

test('prepares without uploads and persists intent before verified archive/output, without native removal', async () => {
	const prepared = await prepare();
	assert.deepEqual(events, []);
	const result = await prepared.persist();
	assert.equal(result.phase, 'assets-verified');
	assert.equal(events[0], 'journal:intent');
	assert.equal(events.at(-1), 'journal:assets-verified');
	assert.equal(files.size, 2); assert.equal(scene.drawings.size, 1); assert.equal(scene.tiles.size, 0);
	const stored = readOptimizationJournal(scene).entries[0];
	assert.deepEqual(stored.archive, prepared.intent.archive);
	const archive = await readOptimizationArchive(new TextDecoder().decode(files.get(stored.archive.path)));
	assert.deepEqual(archive.payload.originals, [source]);
});

test('constructs detached native Tile from exact output and passes schema/placement acceptance through persistence', async () => {
	globalThis.getDocumentClass = type => class {
		constructor(input) {
			this.source = structuredClone(input);
			if (type === 'Tile') {
				this.source.texture.alphaThreshold ??= 0.75;
				this.source.video ??= { loop: true, autoplay: true, volume: 0 };
			}
		}
		toObject() { return structuredClone(this.source); }
	};
	source.elevation = 0; source.interface = false;
	params.rendered.sourceDigest = await fileFingerprint(new TextEncoder().encode(canonicalJson([source])));
	scene.getDimensions = () => ({ sceneRect: params.rendered.bounds });
	const prepared = await prepare({ replacement: undefined, audience: 'player',
		replacementId: 'BakeTile00000001', sort: 0, verifyNative: async payload => {
			assertOptimizationNativeSchemas(scene, payload);
			const checksum = await fileFingerprint(new TextEncoder().encode(canonicalJson(payload)));
			const placement = await prepareOptimizationPlacement(scene, JSON.stringify({ payload, checksum }),
				{ bounds: params.rendered.bounds, audience: 'player', isCurrent: () => current });
			return placement.approve({ flattenToGround: true, overlappingTileIds: [] })(payload);
		} });
	await prepared.persist();
	const text = new TextDecoder().decode(files.get(prepared.intent.archive.path));
	const placement = await prepareOptimizationPlacement(scene, text,
		{ bounds: params.rendered.bounds, audience: 'player', isCurrent: () => current });
	const verify = placement.approve({ flattenToGround: true, overlappingTileIds: [] });
	await verify((await readOptimizationArchive(text)).payload);
	assert.equal(scene.tiles.size, 0); assert.equal(scene.drawings.size, 1);
	const payload = (await readOptimizationArchive(text)).payload;
	assert.equal(payload.replacement.after.texture.src, prepared.output.path);
	assert.equal(payload.replacement.after.locked, true);
	assert.equal(payload.replacement.staged.hidden, true);
});

test('construction options cannot be ignored beside an explicit replacement', async () => {
	await assert.rejects(prepare({ audience: 'gm' }), /not both/);
	assert.deepEqual(events, []);
});

test('constructed background preserves exact native settings and journals the original image backup', async () => {
	globalThis.getDocumentClass = () => class {
		constructor(input) { this.source = structuredClone(input); }
		toObject() { return structuredClone(this.source); }
	};
	background();
	scene.getDimensions = () => ({ sceneRect: params.rendered.bounds });
	params.rendered.background = publicationBackgroundSnapshot(scene, level._id);
	const blob = new Blob([png(100, 50)], { type: 'image/png' });
	params.rendered.originalImage = { path: level.background.src, blob, bytes: blob.size,
		fingerprint: await fileFingerprint(await blob.arrayBuffer()) };
	const prepared = await prepare({ replacement: undefined, audience: 'player',
		verifyNative: payload => assertOptimizationNativeSchemas(scene, payload) });
	await prepared.persist();
	const payload = (await readOptimizationArchive(new TextDecoder().decode(files.get(prepared.intent.archive.path)))).payload;
	assert.deepEqual(payload.replacement.before, level);
	assert.deepEqual(payload.replacement.after, { ...level, background: {
		...level.background, src: prepared.output.path, color: '#ffffff', tint: '#ffffff' } });
	assert.equal(payload.originalBackground.file.path, `${root}/background-original-${token}.png`);
	assert.equal(files.size, 3); assert.equal(level.background.src, 'maps/original.png');
});

test('uncertain upload retains durable intent; retry verifies existing bytes instead of uploading twice', async () => {
	const prepared = await prepare(); failUpload = true;
	await assert.rejects(prepared.persist(), /unverified.*upload response lost/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'intent');
	assert.equal(files.size, 1);
	await prepared.persist();
	assert.equal(events.filter(event => event === `upload:${root}/recovery-${token}.json`).length, 1);
	const count = events.length;
	await prepared.persist();
	assert.equal(events.length, count);
});

test('occupied mismatching recovery path refuses after intent without overwriting bytes', async () => {
	const prepared = await prepare();
	files.set(prepared.intent.archive.path, new Uint8Array([1, 2, 3]));
	await assert.rejects(prepared.persist(), /truncated|size|fingerprint/);
	assert.equal(events.some(event => event.startsWith('upload:')), false);
	assert.deepEqual(files.get(prepared.intent.archive.path), new Uint8Array([1, 2, 3]));
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'intent');
});

test('exact preserved background bytes and native settings are journal-reachable before output upload', async () => {
	background();
	const blob = new Blob([png(100, 50)], { type: 'image/png' });
	params.rendered.originalImage = { path: level.background.src, blob, bytes: blob.size,
		fingerprint: await fileFingerprint(await blob.arrayBuffer()) };
	const prepared = await prepare();
	await prepared.persist();
	assert.equal(files.size, 3);
	const p = (await readOptimizationArchive(new TextDecoder().decode(files.get(prepared.intent.archive.path)))).payload;
	assert.equal(p.originalBackground.src, 'maps/original.png');
	assert.equal(p.originalBackground.file.path, `${root}/background-original-${token}.png`);
	assert.deepEqual(files.get(p.originalBackground.file.path), png(100, 50));
	assert.equal(level.background.src, 'maps/original.png');
});

test('wrong source digest, missing backup, native rejection and destination mismatch prevent any journal or upload', async () => {
	await assert.rejects(prepare({ rendered: { ...params.rendered, sourceDigest: '0'.repeat(64) } }), /different exact/);
	await assert.rejects(prepare({ verifyNative: async () => false }), /acceptance failed/);
	const replacement = structuredClone(params.replacement); replacement.after.width = 99;
	await assert.rejects(prepare({ replacement }), /placement dimensions/);
	background();
	await assert.rejects(prepare(), /retained original byte Blob/);
	assert.deepEqual(events, []);
});

test('changed originals or reviewed context refuse before intent; wrong designated GM never uploads', async () => {
	const prepared = await prepare();
	source.x = 100;
	await assert.rejects(prepared.persist(), /conflict|changed/);
	source.x = 0; current = false;
	await assert.rejects(prepared.persist(), /context changed/);
	current = true; game.users.activeGM.id = 'otherGM';
	await assert.rejects(prepared.persist(), /authority/);
	assert.deepEqual(events, []);
});

test('lost journal acknowledgement stops all uploads, and retry reconciles the exact written intent', async () => {
	const prepared = await prepare(), update = scene.update.bind(scene);
	scene.update = async patch => { await update(patch); throw new Error('journal response lost'); };
	await assert.rejects(prepared.persist(), /journal write is unverified/);
	assert.equal(files.size, 0);
	scene.update = update;
	await prepared.persist();
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'assets-verified');
});

test('caller edits to exposed intent/reference cannot redirect captured asset uploads', async () => {
	const prepared = await prepare();
	prepared.intent.asset.path = 'worlds/test/recovery/forged.png';
	prepared.output.path = 'worlds/test/recovery/forged.png';
	params.rendered.review.bounds.width = 1;
	await prepared.persist();
	assert.equal(files.has(`${root}/bake-${token}.png`), true);
	assert.equal(files.has('worlds/test/recovery/forged.png'), false);
});

test('lost asset-phase acknowledgement retries from persisted evidence without duplicate uploads', async () => {
	const prepared = await prepare(), update = scene.update.bind(scene);
	scene.update = async patch => {
		await update(patch);
		if (patch['flags.foundryshop.optimizationJournal'].entries.at(-1).phase === 'assets-verified') {
			throw new Error('phase response lost');
		}
	};
	await assert.rejects(prepared.persist(), /journal write is unverified/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'assets-verified');
	scene.update = update;
	await prepared.persist();
	assert.equal(events.filter(event => event.startsWith('upload:')).length, 2);
});

test('source edit during upload retains recoverable intent and refuses asset phase advancement', async () => {
	const prepared = await prepare(), picker = foundry.applications.apps.FilePicker.implementation;
	const upload = picker.upload;
	picker.upload = async (...args) => {
		const result = await upload(...args); source.x = 100; return result;
	};
	await assert.rejects(prepared.persist(), /conflict|changed/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'intent');
	assert.equal(scene.drawings.size, 1); assert.equal(scene.tiles.size, 0);
});

test('encoding MIME or reviewed format mismatch and invalid timeout are rejected before intent', async () => {
	await assert.rejects(prepare({ rendered: { ...params.rendered, blob: new Blob([png(100, 50)], { type: 'image/webp' }) } }), /MIME/);
	await assert.rejects(prepare({ rendered: { ...params.rendered, review: { ...params.rendered.review, format: 'webp' } } }), /encoding options/);
	await assert.rejects(prepare({ timeout: -1 }), /exact rendered bytes/);
	assert.deepEqual(events, []);
});

test('native acceptance editing sources is not treated as approval', async () => {
	await assert.rejects(prepare({ verifyNative: async () => { source.x = 100; return true; } }), /conflict|changed/);
	assert.deepEqual(events, []);
});

test('prepared verified assets feed resumable apply and exact restore while preserving later strokes', async () => {
	const prepared = await prepare();
	await prepared.persist();
	nativeMocks();
	const approved = await execution(prepared);
	const options = { isCurrent: () => current, approvedExecution: approved.approval, verifyNative: params.verifyNative,
		verifyOutput: outputVerifier(prepared) };
	await resumeOptimizationOperation(scene, token, options);
	assert.equal(scene.drawings.size, 0);
	assert.deepEqual(scene.tiles.get('tile001').toObject(), params.replacement.after);
	const later = { ...structuredClone(source), _id: 'later001', x: 200 };
	scene.drawings.set(later._id, doc(later));
	const journal = readOptimizationJournal(scene), applied = journal.entries[0];
	await beginOptimizationOperation(scene, journal, { ...applied, token: 'restore001',
		action: 'restore', phase: 'intent', parentToken: token },
	{ isCurrent: () => current, verifyIntent: async () => true });
	const restore = await execution(prepared, 'restore001');
	await resumeOptimizationOperation(scene, 'restore001', { ...options, approvedExecution: restore.approval });
	assert.deepEqual(scene.drawings.get(source._id).toObject(), source);
	assert.deepEqual(scene.drawings.get(later._id).toObject(), later);
	assert.equal(scene.tiles.size, 0);
	assert.equal(readOptimizationJournal(scene).entries.every(entry => entry.phase === 'complete'), true);
});

test('execution approval guards unrelated Drawings/Tiles/Levels/grid/workspace and exact original sources', async () => {
	const prepared = await prepare(); await prepared.persist();
	const { approval } = await execution(prepared);
	const assertChanged = change => {
		const undo = change(); assert.throws(approval.assertCurrent, /stale|original/); undo();
		assert.equal(approval.assertCurrent(), true);
	};
	assertChanged(() => { scene.drawings.set('later', doc({ ...source, _id: 'later' })); return () => scene.drawings.delete('later'); });
	assertChanged(() => { scene.tiles.set('other', doc({ _id: 'other' })); return () => scene.tiles.delete('other'); });
	assertChanged(() => { scene.levels.set('other', doc({ _id: 'other' })); return () => scene.levels.delete('other'); });
	assertChanged(() => { scene.width++; return () => scene.width--; });
	assertChanged(() => { source.x++; return () => source.x--; });
	const get = game.settings.get;
	game.settings.get = () => ({ version: 1, scenes: { [scene.id]: { activeLayerId: null, hiddenIds: ['ink'] } } });
	assert.throws(approval.assertCurrent, /stale/); game.settings.get = get;
});

test('execution review requires exact private approval and rechecks callback-driven native changes', async () => {
	const prepared = await prepare(); await prepared.persist();
	const { reviewed } = await execution(prepared);
	reviewed.review.sourceIds.length = 0;
	assert.throws(() => reviewed.approve({ sourceIds: [], resumeOperation: true }), /all archived/);
	assert.throws(() => reviewed.approve({ sourceIds: ['stroke001'] }), /resuming/);
	assert.equal(reviewed.approve({ sourceIds: ['stroke001'], resumeOperation: true }).assertCurrent(), true);
	await assert.rejects(execution(prepared, token, { verifyOutput: async () => {
		scene.tiles.set('foreign', doc({ _id: 'foreign' })); return true;
	} }), /changed during evidence/);
});

test('own replacement edits, premature source removal, wrong revisions and immutable journal changes refuse', async () => {
	const prepared = await prepare(); await prepared.persist();
	const { approval } = await execution(prepared);
	scene.drawings.delete(source._id);
	assert.throws(approval.assertCurrent, /Native execution state/);
	scene.drawings.set(source._id, doc(source));
	scene.tiles.set('tile001', doc({ ...params.replacement.staged, x: 99 }));
	assert.throws(approval.assertCurrent, /Native execution state/);
	scene.tiles.clear();
	const journal = structuredClone(scene.flags.optimizationJournal);
	scene.flags.optimizationJournal.revision++;
	assert.throws(approval.assertCurrent, /stale/); scene.flags.optimizationJournal = structuredClone(journal);
	scene.flags.optimizationJournal.entries[0].ownerId = 'otherGM';
	assert.throws(approval.assertCurrent, /stale/); scene.flags.optimizationJournal = structuredClone(journal);
	scene.flags.optimizationJournal.entries[0].phase = 'sources-removed';
	scene.flags.optimizationJournal.revision += 2;
	assert.throws(approval.assertCurrent, /Native execution state/);
});

test('unrelated native changes inside write callbacks stop execution before source deletion', async () => {
	const prepared = await prepare(); await prepared.persist(); nativeMocks();
	const { approval } = await execution(prepared), create = scene.createEmbeddedDocuments;
	scene.createEmbeddedDocuments = async (...args) => {
		await create(...args); scene.drawings.set('new', doc({ ...source, _id: 'new' }));
	};
	await assert.rejects(resumeOptimizationOperation(scene, token, {
		isCurrent: approval.assertCurrent, verifyOutput: outputVerifier(prepared), verifyNative: async () => true,
	}), /stale/);
	assert.equal(scene.drawings.has(source._id), true);
	assert.equal(scene.tiles.get('tile001').toObject().hidden, true);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'assets-verified');
});

test('fresh execution review resumes a partial deletion while retaining unrelated baseline artwork', async () => {
	const second = { ...structuredClone(source), _id: 'stroke002', x: 20 };
	scene.drawings.set(second._id, doc(second));
	params.sourceIds.push(second._id); params.rendered.review.sourceIds.push(second._id);
	params.rendered.sourceDigest = await fileFingerprint(new TextEncoder().encode(canonicalJson([source, second])));
	const prepared = await prepare(); await prepared.persist(); nativeMocks();
	const { approval } = await execution(prepared);
	const remove = scene.deleteEmbeddedDocuments;
	scene.deleteEmbeddedDocuments = async (type, ids) => {
		scene.drawings.delete(ids[0]); throw new Error('partial deletion acknowledgement lost');
	};
	await assert.rejects(resumeOptimizationOperation(scene, token, {
		isCurrent: approval.assertCurrent, verifyOutput: outputVerifier(prepared), verifyNative: async () => true,
	}), /partial deletion/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'replacement-staged');
	assert.equal(scene.drawings.size, 1);
	const later = { ...structuredClone(source), _id: 'later001' }; scene.drawings.set(later._id, doc(later));
	scene.deleteEmbeddedDocuments = remove;
	const fresh = await execution(prepared);
	assert.equal(fresh.reviewed.review.missingSourceIds.length, 1);
	await resumeOptimizationOperation(scene, token, {
		isCurrent: fresh.approval.assertCurrent, verifyOutput: outputVerifier(prepared), verifyNative: async () => true,
	});
	assert.deepEqual(scene.drawings.get(later._id).toObject(), later);
	assert.equal(scene.drawings.size, 1);
	assert.equal(scene.tiles.get('tile001').toObject().hidden, false);
	assert.equal(fresh.approval.assertCurrent(), true);
});

test('selection binding permits automatic owned-source deselection but refuses unrelated selection changes', async () => {
	const prepared = await prepare(); await prepared.persist(); nativeMocks();
	let selected = ['stroke001'];
	const { approval } = await execution(prepared, token, { readSelection: () => selected });
	selected = []; assert.throws(approval.assertCurrent, /selection changed/); selected = ['stroke001'];
	const remove = scene.deleteEmbeddedDocuments;
	scene.deleteEmbeddedDocuments = async (...args) => { await remove(...args); selected = []; };
	await resumeOptimizationOperation(scene, token, {
		isCurrent: approval.assertCurrent, verifyOutput: outputVerifier(prepared), verifyNative: async () => true,
	});
	assert.equal(approval.assertCurrent(), true);
});

test('background execution approval permits only exact own Level transition and restore', async () => {
	background();
	const blob = new Blob([png(100, 50)], { type: 'image/png' });
	params.rendered.originalImage = { path: level.background.src, blob, bytes: blob.size,
		fingerprint: await fileFingerprint(await blob.arrayBuffer()) };
	const prepared = await prepare(); await prepared.persist(); nativeMocks();
	const approved = await execution(prepared);
	await resumeOptimizationOperation(scene, token, {
		isCurrent: approved.approval.assertCurrent, verifyOutput: outputVerifier(prepared), verifyNative: async () => true,
	});
	assert.deepEqual(scene.levels.get(level._id).toObject(), params.replacement.after);
	const journal = readOptimizationJournal(scene);
	await beginOptimizationOperation(scene, journal, { ...journal.entries[0], token: 'restore001',
		action: 'restore', phase: 'intent', parentToken: token }, { isCurrent: () => current, verifyIntent: async () => true });
	const restore = await execution(prepared, 'restore001');
	await resumeOptimizationOperation(scene, 'restore001', {
		isCurrent: restore.approval.assertCurrent, verifyOutput: outputVerifier(prepared), verifyNative: async () => true,
	});
	assert.deepEqual(scene.levels.get(level._id).toObject(), level);
	assert.deepEqual(scene.drawings.get(source._id).toObject(), source);
});

test('executor rejects approval for another Scene/token and approval stops after authority loss/cancellation', async () => {
	const prepared = await prepare(); await prepared.persist(); nativeMocks();
	const { approval } = await execution(prepared);
	const options = { isCurrent: () => current, approvedExecution: approval,
		verifyOutput: outputVerifier(prepared), verifyNative: async () => true };
	await assert.rejects(resumeOptimizationOperation(scene, 'different', options), /different Scene\/operation/);
	assert.throws(() => approval.assertOperation({ ...scene }, token), /different Scene\/operation/);
	await assert.rejects(resumeOptimizationOperation(scene, token, { ...options, approvedExecution: {} }), /matching real/);
	game.users.activeGM.id = 'otherGM'; assert.throws(approval.assertCurrent, /authority/);
	game.users.activeGM.id = 'gm001'; current = false; assert.throws(approval.assertCurrent, /context changed/);
	current = true;
	const controller = new AbortController(), cancellable = await execution(prepared, token, { signal: controller.signal });
	controller.abort(); assert.throws(cancellable.approval.assertCurrent, /cancelled/);
	assert.equal(scene.drawings.size, 1); assert.equal(scene.tiles.size, 0);
});

test('phase regression after a reviewed own advancement refuses even with a matching old revision', async () => {
	const prepared = await prepare(); await prepared.persist();
	const { approval } = await execution(prepared), journal = structuredClone(scene.flags.optimizationJournal);
	scene.tiles.set('tile001', doc(params.replacement.staged));
	scene.flags.optimizationJournal.revision++;
	scene.flags.optimizationJournal.entries[0].phase = 'replacement-staged';
	assert.equal(approval.assertCurrent(), true);
	scene.flags.optimizationJournal = journal;
	assert.throws(approval.assertCurrent, /phase regression/);
});

test('restore review resumes hidden originals after a lost creation acknowledgement', async () => {
	const prepared = await prepare(); await prepared.persist(); nativeMocks();
	let approved = await execution(prepared);
	const options = { isCurrent: () => current, approvedExecution: approved.approval,
		verifyOutput: outputVerifier(prepared), verifyNative: async () => true };
	await resumeOptimizationOperation(scene, token, options);
	const journal = readOptimizationJournal(scene);
	await beginOptimizationOperation(scene, journal, { ...journal.entries[0], token: 'restore001',
		action: 'restore', phase: 'intent', parentToken: token }, { isCurrent: () => current, verifyIntent: async () => true });
	approved = await execution(prepared, 'restore001');
	const create = scene.createEmbeddedDocuments;
	scene.createEmbeddedDocuments = async (...args) => { await create(...args); throw new Error('restore creation response lost'); };
	await assert.rejects(resumeOptimizationOperation(scene, 'restore001', { ...options, approvedExecution: approved.approval }),
		/restore creation response lost/);
	assert.equal(scene.drawings.get(source._id).toObject().hidden, true);
	assert.equal(readOptimizationJournal(scene).entries.at(-1).phase, 'assets-verified');
	scene.createEmbeddedDocuments = create;
	const fresh = await execution(prepared, 'restore001');
	assert.deepEqual(fresh.reviewed.review.stagedSourceIds, ['stroke001']);
	await resumeOptimizationOperation(scene, 'restore001', { ...options, approvedExecution: fresh.approval });
	assert.deepEqual(scene.drawings.get(source._id).toObject(), source);
	assert.equal(scene.tiles.size, 0);
});

test('GM-hidden replacements whose staged/final sources are identical pass every execution phase', async () => {
	params.replacement.after.hidden = true;
	const prepared = await prepare(); await prepared.persist(); nativeMocks();
	const { approval } = await execution(prepared);
	await resumeOptimizationOperation(scene, token, {
		isCurrent: () => current, approvedExecution: approval, verifyOutput: outputVerifier(prepared), verifyNative: async () => true,
	});
	assert.equal(scene.tiles.get('tile001').toObject().hidden, true);
	assert.equal(scene.drawings.size, 0);
	assert.equal(approval.assertCurrent(), true);
});

test('missing/corrupt durable evidence and already complete operations cannot receive execution approval', async () => {
	const prepared = await prepare(); await prepared.persist(); nativeMocks();
	const output = files.get(prepared.output.path);
	files.delete(prepared.output.path);
	await assert.rejects(execution(prepared), /HTTP 404/);
	files.set(prepared.output.path, new Uint8Array([1, 2, 3]));
	await assert.rejects(execution(prepared), /truncated|size/);
	files.set(prepared.output.path, output);
	const { approval } = await execution(prepared);
	await resumeOptimizationOperation(scene, token, {
		isCurrent: () => current, approvedExecution: approval, verifyOutput: outputVerifier(prepared), verifyNative: async () => true,
	});
	await assert.rejects(execution(prepared), /final unfinished/);
});

test('overlapping persistence refuses and a revised journal invalidates prepared intent before uploads', async () => {
	let release, entered;
	const started = new Promise(resolve => { entered = resolve; });
	let pause = false;
	const prepared = await prepare({ verifyNative: async () => {
		if (pause) { entered(); await new Promise(resolve => { release = resolve; }); pause = false; }
		return true;
	} });
	pause = true;
	const pending = prepared.persist();
	await started;
	await assert.rejects(prepared.persist(), /already running/);
	release(); await pending;
	assert.equal(files.size, 2);
});

test('changed journal before intent creation refuses all uploads', async () => {
	const prepared = await prepare();
	scene.flags.optimizationJournal = { version: 1, revision: 1, entries: [] };
	await assert.rejects(prepared.persist(), /journal changed/);
	assert.deepEqual(events, []);
});

function approvedScope(extra = {}) {
	source.sort = 1; source.elevation = 0;
	source.locked = false; source.interface = false;
	const scope = prepareOptimizationScope(scene, 'level001', { kind: 'all', audience: 'player', destination: 'tile',
		isCurrent: () => current, inspectSource: () => ({ supported: true }), ...extra });
	return scope.approve({ excludedIds: [], flattenToGround: true });
}
async function scopedPreparation(extra = {}) {
	const manifest = approvedScope(extra);
	params.rendered.sourceDigest = await fileFingerprint(new TextEncoder().encode(canonicalJson([source])));
	const operation = await prepare({ approvedScope: manifest });
	return { manifest, operation };
}

test('approved scope tolerates only its own exact intent/assets journal while retaining original strict review', async () => {
	const { manifest, operation } = await scopedPreparation();
	await operation.persist();
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'assets-verified');
	assert.throws(() => manifest.assertCurrent(), /unfinished|context/);
	await operation.persist();
	assert.equal(events.filter(event => event.startsWith('upload:')).length, 2);
});

test('bound scope rejects new strokes, Tile/workspace/grid changes and unrelated journal writes during preparation', async () => {
	const { operation } = await scopedPreparation();
	scene.drawings.set('newer001', doc({ ...source, _id: 'newer001' }));
	await assert.rejects(operation.persist(), /Bound bake scope/);
	scene.drawings.delete('newer001');
	scene.tiles.set('other001', doc({ _id: 'other001' }));
	await assert.rejects(operation.persist(), /Bound bake scope/);
	scene.tiles.delete('other001');
	scene.grid.toObject = () => ({ size: 200 });
	await assert.rejects(operation.persist(), /Bound bake scope/);
	scene.grid.toObject = () => ({ size: 100 });
	scene.flags.optimizationJournal = { version: 1, revision: 1, entries: [] };
	await assert.rejects(operation.persist(), /journal changed/);
	assert.deepEqual(events, []);
});

test('scope audience and exact source membership cannot be changed by public manifest mutation', async () => {
	const manifest = approvedScope();
	params.rendered.sourceDigest = await fileFingerprint(new TextEncoder().encode(canonicalJson([source])));
	manifest.sourceIds = ['forged']; manifest.audience = 'gm'; manifest.scope.kind = 'selection';
	const hidden = structuredClone(params.replacement);
	hidden.after.hidden = true;
	await assert.rejects(prepare({ approvedScope: manifest, replacement: hidden }), /audience or destination/);
	const operation = await prepare({ approvedScope: manifest });
	await operation.persist();
	assert.equal(scene.drawings.size, 1);
});

test('selection stays bound through own journal changes and changing selected IDs prevents further uploads', async () => {
	let selected = ['stroke001'];
	params.scope = { kind: 'selection', layerId: null };
	const manifest = approvedScope({ kind: 'selection', readSelection: () => selected });
	params.rendered.sourceDigest = await fileFingerprint(new TextEncoder().encode(canonicalJson([source])));
	const prepared = await prepare({ approvedScope: manifest });
	const upload = foundry.applications.apps.FilePicker.implementation.upload;
	foundry.applications.apps.FilePicker.implementation.upload = async (...args) => {
		const result = await upload(...args); selected = ['different']; return result;
	};
	await assert.rejects(prepared.persist(), /selection.*changed/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'intent');
	assert.equal(files.size, 1);
});

test('one approval cannot bind two different intents even before either has persisted', async () => {
	const { manifest } = await scopedPreparation();
	const nextToken = 'bake002', replacement = structuredClone(params.replacement);
	replacement.after.texture.src = replacement.staged.texture.src = `${root}/bake-${nextToken}.png`;
	await assert.rejects(prepare({ token: nextToken, replacement, approvedScope: manifest }), /already bound/);
	assert.deepEqual(events, []);
});

test('workspace changes after asset intent refuse next uploads rather than weakening approved visibility', async () => {
	const { operation } = await scopedPreparation();
	const workspace = { version: 1, scenes: { scene001: { activeLayerId: null, hiddenIds: [], collapsedIds: [] } } };
	game.settings.get = () => workspace;
	// This workspace has the same effective baseline values until hidden IDs change.
	const upload = foundry.applications.apps.FilePicker.implementation.upload;
	foundry.applications.apps.FilePicker.implementation.upload = async (...args) => {
		const result = await upload(...args); workspace.scenes.scene001.hiddenIds.push('newHidden'); return result;
	};
	await assert.rejects(operation.persist(), /Bound bake scope/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'intent');
	assert.equal(files.size, 1);
});

test('changing operator identity invalidates review even if the new user is also a GM', () => {
	const manifest = approvedScope();
	game.user.id = 'gm002';
	assert.throws(() => manifest.assertCurrent(), /context changed/);
});

const reloadOptions = () => ({ isCurrent: () => current, verifyNative: params.verifyNative,
	verifyOutput: optimizationOutputVerifier(readOptimizationJournal(scene).entries[0].asset,
		{ width: 100, height: 50 }, { isCurrent: () => current }) });
async function interruptedAssets() {
	const prepared = await prepare();
	failUpload = true;
	await assert.rejects(prepared.persist(), /unverified/);
	return prepared;
}

test('fresh reload inventory distinguishes missing output and recovers only exact supplied pixels', async () => {
	const prepared = await interruptedAssets();
	const reloaded = await reviewBakeAssetRecovery(scene, token, reloadOptions());
	assert.deepEqual(reloaded.review.assets.map(asset => asset.status), ['verified', 'missing']);
	assert.deepEqual(reloaded.review.missingPaths, [prepared.output.path]);
	const count = events.filter(event => event.startsWith('upload:')).length;
	await reloaded.recover({ approvedMissingPaths: [prepared.output.path], blobs: { [prepared.output.path]: params.rendered.blob } });
	assert.equal(events.filter(event => event.startsWith('upload:')).length, count + 1);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'assets-verified');
	assert.equal(scene.drawings.size, 1); assert.equal(scene.tiles.size, 0);
	await assert.rejects(reloaded.recover({ approvedMissingPaths: [] }), /consumed/);
});

test('missing archive blocks reload unless exact original archive bytes are supplied', async () => {
	const prepared = await interruptedAssets(), bytes = files.get(prepared.intent.archive.path);
	files.delete(prepared.intent.archive.path);
	const blocked = await reviewBakeAssetRecovery(scene, token, reloadOptions());
	assert.equal(blocked.review.blocked, true);
	assert.equal(blocked.recover, undefined);
	await assert.rejects(reviewBakeAssetRecovery(scene, token, { ...reloadOptions(), archiveBlob: new Blob(['wrong']) }), /immutable/);
	const review = await reviewBakeAssetRecovery(scene, token, { ...reloadOptions(), archiveBlob: new Blob([bytes]) });
	assert.deepEqual(review.review.missingPaths, [prepared.output.path, prepared.intent.archive.path].sort());
	await review.recover({ approvedMissingPaths: review.review.missingPaths, blobs: { [prepared.output.path]: params.rendered.blob } });
	assert.equal(files.size, 2);
});

test('existing conflicting archive or output is never classified missing or overwritten', async () => {
	const prepared = await prepare(); await prepared.persist();
	const original = files.get(prepared.output.path);
	files.set(prepared.output.path, new Uint8Array([1]));
	await assert.rejects(reviewBakeAssetRecovery(scene, token, reloadOptions()), /truncated|size/);
	files.set(prepared.output.path, original);
	files.set(prepared.intent.archive.path, new Uint8Array([2]));
	await assert.rejects(reviewBakeAssetRecovery(scene, token, reloadOptions()), /truncated|size/);
	assert.equal(events.filter(event => event.startsWith('upload:')).length, 2);
});

test('exact missing-path approval and all byte validation precede every recovery upload', async () => {
	const prepared = await interruptedAssets();
	const review = await reviewBakeAssetRecovery(scene, token, reloadOptions());
	const count = events.length;
	await assert.rejects(review.recover({ approvedMissingPaths: [], blobs: {} }), /exact missing/);
	await assert.rejects(review.recover({ approvedMissingPaths: review.review.missingPaths,
		blobs: { [prepared.output.path]: new Blob(['bad']) } }), /immutable/);
	assert.equal(events.length, count);
	review.review.missingPaths.length = 0;
	await assert.rejects(review.recover({ approvedMissingPaths: [], blobs: {} }), /exact missing/);
});

test('changed journal, source or native replacement invalidates reload review without uploads', async () => {
	const prepared = await interruptedAssets();
	const review = await reviewBakeAssetRecovery(scene, token, reloadOptions());
	source.x = 10;
	await assert.rejects(review.recover({ approvedMissingPaths: [prepared.output.path],
		blobs: { [prepared.output.path]: params.rendered.blob } }), /conflict|context changed/);
	source.x = 0;
	scene.flags.optimizationJournal.revision++;
	await assert.rejects(review.recover({ approvedMissingPaths: [prepared.output.path],
		blobs: { [prepared.output.path]: params.rendered.blob } }), /journal changed/);
	scene.flags.optimizationJournal.revision--;
	scene.tiles.set('tile001', doc(params.replacement.staged));
	await assert.rejects(reviewBakeAssetRecovery(scene, token, reloadOptions()), /untouched/);
	assert.equal(files.size, 1);
});

test('asset-phase reload re-verifies files without uploads and wrong owner/native acceptance refuse', async () => {
	const prepared = await prepare(); await prepared.persist();
	const review = await reviewBakeAssetRecovery(scene, token, reloadOptions());
	assert.deepEqual(review.review.missingPaths, []);
	const count = events.length;
	await review.recover({ approvedMissingPaths: [] });
	assert.equal(events.length, count);
	game.users.activeGM.id = 'otherGM';
	await assert.rejects(reviewBakeAssetRecovery(scene, token, reloadOptions()), /authority/);
	game.users.activeGM.id = 'gm001';
	await assert.rejects(reviewBakeAssetRecovery(scene, token, { ...reloadOptions(), verifyNative: async () => false }), /acceptance failed/);
});

test('lost recovery upload response retains reviewable intent and next fresh inventory reconciles written bytes', async () => {
	const prepared = await interruptedAssets();
	const review = await reviewBakeAssetRecovery(scene, token, reloadOptions());
	failUpload = true;
	await assert.rejects(review.recover({ approvedMissingPaths: [prepared.output.path],
		blobs: { [prepared.output.path]: params.rendered.blob } }), /unverified/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'intent');
	const reloaded = await reviewBakeAssetRecovery(scene, token, reloadOptions());
	assert.deepEqual(reloaded.review.missingPaths, []);
	await reloaded.recover({ approvedMissingPaths: [] });
	assert.equal(events.filter(event => event.startsWith('upload:')).length, 2);
});

test('missing original background is recovered from exact backup bytes, never from its source URL', async () => {
	background();
	const blob = new Blob([png(100, 50)], { type: 'image/png' });
	params.rendered.originalImage = { path: level.background.src, blob, bytes: blob.size,
		fingerprint: await fileFingerprint(await blob.arrayBuffer()) };
	const prepared = await prepare(); await prepared.persist();
	files.delete(prepared.originalBackground.file.path);
	const review = await reviewBakeAssetRecovery(scene, token, reloadOptions());
	assert.deepEqual(review.review.missingPaths, [prepared.originalBackground.file.path]);
	await review.recover({ approvedMissingPaths: review.review.missingPaths,
		blobs: { [prepared.originalBackground.file.path]: blob } });
	assert.deepEqual(files.get(prepared.originalBackground.file.path), png(100, 50));
	assert.equal(level.background.src, 'maps/original.png');
});

test('reload review refuses changed unrelated strokes and native callback changes to Tile/workspace context', async () => {
	const prepared = await interruptedAssets();
	const review = await reviewBakeAssetRecovery(scene, token, reloadOptions());
	scene.drawings.set('later', doc({ ...source, _id: 'later' }));
	await assert.rejects(review.recover({ approvedMissingPaths: [prepared.output.path],
		blobs: { [prepared.output.path]: params.rendered.blob } }), /native\/workspace context changed/);
	scene.drawings.delete('later');
	await assert.rejects(reviewBakeAssetRecovery(scene, token, { ...reloadOptions(),
		verifyNative: async () => { scene.tiles.set('other', doc({ _id: 'other' })); return true; } }), /context changed/);
	assert.equal(files.size, 1);
});

test('read errors and invalid folder listings are explicit failures, never reported as missing bytes', async () => {
	await interruptedAssets();
	foundry.applications.apps.FilePicker.implementation.browse = async () => ({ files: null });
	await assert.rejects(reviewBakeAssetRecovery(scene, token, reloadOptions()), /absence cannot be inferred/);
	foundry.applications.apps.FilePicker.implementation.browse = async () => ({ files: [...files.keys()] });
	globalThis.fetch = async () => new Response(null, { status: 403 });
	await assert.rejects(reviewBakeAssetRecovery(scene, token, reloadOptions()), /HTTP 403/);
});

test('a previously verified file disappearing after review requires new review before any guessed upload', async () => {
	const prepared = await interruptedAssets();
	const review = await reviewBakeAssetRecovery(scene, token, reloadOptions());
	files.delete(prepared.intent.archive.path);
	await assert.rejects(review.recover({ approvedMissingPaths: [prepared.output.path],
		blobs: { [prepared.output.path]: params.rendered.blob } }), /Previously verified asset disappeared/);
	assert.equal(files.size, 0);
});

test('native execution phases are refused by asset-only reload recovery', async () => {
	await interruptedAssets();
	scene.flags.optimizationJournal.entries[0].phase = 'replacement-staged';
	await assert.rejects(reviewBakeAssetRecovery(scene, token, reloadOptions()), /before native execution/);
});

test('lost recovery phase acknowledgement is reconciled by a fresh assets-verified review', async () => {
	const prepared = await interruptedAssets();
	const review = await reviewBakeAssetRecovery(scene, token, reloadOptions()), update = scene.update.bind(scene);
	scene.update = async patch => { await update(patch); throw new Error('phase acknowledgement lost'); };
	await assert.rejects(review.recover({ approvedMissingPaths: [prepared.output.path],
		blobs: { [prepared.output.path]: params.rendered.blob } }), /journal write is unverified/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'assets-verified');
	scene.update = update;
	const fresh = await reviewBakeAssetRecovery(scene, token, reloadOptions());
	await fresh.recover({ approvedMissingPaths: [] });
	assert.equal(events.filter(event => event.startsWith('upload:')).length, 2);
});

test('failed persisted output acceptance never advances recovery phase', async () => {
	await interruptedAssets();
	files.set(`${root}/bake-${token}.png`, png(100, 50));
	await assert.rejects(reviewBakeAssetRecovery(scene, token, { ...reloadOptions(), verifyOutput: async () => false }), /acceptance failed/);
	assert.equal(readOptimizationJournal(scene).entries[0].phase, 'intent');
});
