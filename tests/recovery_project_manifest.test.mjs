import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRecoveryProjectManifest, prepareRecoveryProjectManifest, RECOVERY_PROJECT_FORMAT,
	reconstructRecoveryProjectDrawings, recoveryProjectResources } from '../scripts/layers/recovery_project_manifest.js';
import { validateProjectPackage, canonicalJson, PROJECT_FORMAT } from '../scripts/layers/project_package.js';
import { exportProjectDrawing, discardInterruptedProjectImport } from '../scripts/layers/project_transfer_service.js';
import { optimizationArchiveDescriptor } from '../scripts/layers/optimization_recovery.js';
import { fileFingerprint } from '../scripts/verified_file_storage.js';
import { encodeRecoveryProjectBundle, decodeRecoveryProjectBundle, prepareRecoveryProjectBundle } from '../scripts/layers/recovery_project_bundle.js';
import { reviewRecoveryProjectExport, downloadRecoveryProjectExport, promptRecoveryProjectExport } from '../scripts/layers/recovery_project_export.js';
import { encodeStoredRecoveryZip, decodeStoredRecoveryZip } from '../scripts/layers/recovery_file_bundle.js';
import { inspectOptimizationImage } from '../scripts/optimization_media.js';
import { remapRecoveryProjectBundle } from '../scripts/layers/recovery_project_remap.js';
import { readOptimizationArchive, encodeOptimizationArchive } from '../scripts/layers/optimization_recovery.js';
import { prepareRecoveryImport } from '../scripts/layers/recovery_import_preparation.js';
import { effectiveLayerGate } from '../scripts/layers/layer_tree_store.js';
import { inspectRecoveryImport, inspectCompletedRecoveryImport, inspectClearedCompensatedRecoveryImport } from '../scripts/layers/recovery_import_reconciliation.js';
import { reviewCompensatedRecoveryImportClearing, clearCompensatedRecoveryImport,
	InterruptedRecoveryImportReceiptClearingError } from '../scripts/layers/recovery_import_receipt.js';
import { promptRecoveryImportApproval, RecoveryImportReviewCancelledError } from '../scripts/layers/recovery_import_dialogs.js';
import { encodeRecoveryImportReceipt, decodeRecoveryImportReceipt, reviewRecoveryImportReceiptPersistence,
	persistRecoveryImportReceipt, inspectStoredRecoveryImportReceipt, findStoredRecoveryImportReceipt,
	InterruptedRecoveryImportReceiptPersistenceError } from '../scripts/layers/recovery_import_receipt_storage.js';
import { retireCompensatedRecoveryImport,
	InterruptedCompensatedRecoveryImportRetirementError, importReviewedRecoveryProject,
	InterruptedReviewedRecoveryImportError } from '../scripts/layers/recovery_import_lifecycle.js';
import { reviewRecoveryImportActions, promptRecoveryImportActions,
	InterruptedRecoveryImportActionError } from '../scripts/layers/recovery_import_controller.js';
import { reviewRecoveryImportStaging, stageRecoveryImport, InterruptedRecoveryImportStagingError } from '../scripts/layers/recovery_import_execution.js';
import { isAuthorizedRecoveryImportCreate, isAuthorizedRecoveryImportDelete, isAuthorizedRecoveryImportUpdate } from '../scripts/layers/recovery_import_native_guard.js';
import { reviewRecoveryImportCompensation, compensateRecoveryImport, InterruptedRecoveryImportCompensationError } from '../scripts/layers/recovery_import_compensation.js';
import { reviewRecoveryImportFinalization, finalizeRecoveryImport, reviewRecoveryImportFinalizationResume,
	resumeRecoveryImportFinalization, InterruptedRecoveryImportFinalizationError } from '../scripts/layers/recovery_import_finalization.js';
import { recoveryImportSceneState } from '../scripts/layers/recovery_import_scene_state.js';
import { encodeRecoveryImportEvidence, decodeRecoveryImportEvidence, RECOVERY_IMPORT_EVIDENCE_FORMAT } from '../scripts/layers/recovery_import_evidence.js';
import { reviewRecoveryImport, beginRecoveryImportIntent, validateRecoveryImportIntent,
	UnverifiedRecoveryImportIntentError, uploadRecoveryImportAssets,
	InterruptedRecoveryImportAssetsError } from '../scripts/layers/recovery_import_intent.js';

const limits = { maxBytes: 1024 * 1024, maxEntries: 20 };
const png = new Uint8Array(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
const tree = { version: 1, revision: 0, nodes: [], presets: [] };
const level = { _id: 'level001', background: { src: null, color: '#335544' }, flags: {} };
const sceneContext = { width: 640, height: 400, padding: 0, grid: {} };
const drawing = id => ({
	_id: id, author: 'gm001', name: '', text: '', x: 10, y: 10, elevation: 0,
	levels: ['level001'], sort: 1024, rotation: 0, bezierFactor: 0,
	shape: { type: 'r', width: 10, height: 10, radius: null, points: [] },
	fillType: 1, fillColor: '#ffffff', fillAlpha: 1, strokeWidth: 0,
	strokeColor: '#000000', strokeAlpha: 1, fontFamily: 'Signika', fontSize: 24,
	textColor: '#ffffff', textAlpha: 1, texture: null, hidden: false, locked: false, interface: false, flags: {},
});
const reference = async (name, bytes) => ({
	version: 1, root: 'worlds/test/recovery', path: `worlds/test/recovery/${name}`,
	bytes: bytes.length, fingerprint: await fileFingerprint(bytes),
});
async function history() {
	const state = { drawings: new Map([['stroke001', drawing('stroke001')]]), tiles: new Map(),
		level: structuredClone(level), entries: [], files: [], archives: new Map() };
	state.apply = async function(token, type = 'Drawing', parentToken = null) {
		const original = [...this.drawings.values()][0];
		const output = await reference(`output-${token}.png`, png);
		const after = type === 'LevelBackground' ? { ...this.level, background: { ...this.level.background, src: output.path } }
			: type === 'Tile' ? { _id: `tile${token}`, levels: ['level001'], texture: { src: output.path }, hidden: false, flags: {} }
				: { ...drawing(`ink${token}`), fillType: 2, texture: output.path, flags: { foundryshop: { imageStamp: 1 } } };
		const parent = parentToken === null ? null : this.archives.get(parentToken);
		const backup = type === 'LevelBackground' && this.level.background.src
			? await reference(`original-${token}.png`, png) : null;
		const payload = {
			format: 'foundryshop-optimization-recovery', version: 1, id: token, sceneId: 'scene001', levelId: 'level001',
			scope: { kind: 'selection', layerId: null },
			context: { scene: sceneContext, layers: tree, level: structuredClone(this.level) },
			originals: [structuredClone(original)], replacement: { type, id: after._id,
				before: type === 'LevelBackground' ? structuredClone(this.level) : null,
				staged: type === 'LevelBackground' ? null : { ...after, hidden: true }, after },
			output, originalBackground: backup ? { src: this.level.background.src, file: backup } : null,
			parent: parent ? { file: parent.file, checksum: parent.checksum } : null,
		};
		const checksum = await fileFingerprint(new TextEncoder().encode(canonicalJson(payload)));
		const bytes = new TextEncoder().encode(JSON.stringify({ payload, checksum })), file = await reference(`recovery-${token}.json`, bytes);
		const descriptor = await optimizationArchiveDescriptor(new TextDecoder().decode(bytes));
		const entry = { ...descriptor, token, sceneId: 'scene001', levelId: 'level001', ownerId: 'gm001',
			action: 'apply', phase: 'complete', archive: file, parentToken };
		this.entries.push(entry); this.files.push({ reference: file, bytes }, { reference: output, bytes: png });
		if (backup) this.files.push({ reference: backup, bytes: png });
		this.archives.set(token, { payload, file, checksum, entry });
		this.drawings.delete(original._id);
		if (type === 'LevelBackground') this.level = after;
		else (type === 'Drawing' ? this.drawings : this.tiles).set(after._id, after);
	};
	state.restore = function(token) {
		const { payload, entry } = this.archives.get(token), replacement = payload.replacement;
		this.entries.push({ ...structuredClone(entry), action: 'restore', token: `restore${token}`, parentToken: token });
		if (replacement.type === 'LevelBackground') this.level = structuredClone(replacement.before);
		else (replacement.type === 'Drawing' ? this.drawings : this.tiles).delete(replacement.id);
		for (const source of payload.originals) this.drawings.set(source._id, structuredClone(source));
	};
	state.manifest = function(projectTree = tree) {
		const sources = [...this.drawings.values()];
		const imagePaths = new Set(sources.map(source => source.texture).filter(Boolean));
		const fonts = new Set(sources.filter(source => source.text).map(source => source.fontFamily));
		for (const { payload } of this.archives.values()) {
			imagePaths.add(payload.output.path);
			for (const source of payload.originals) {
				if (source.texture) imagePaths.add(source.texture);
				if (source.text && source.fontFamily) fonts.add(source.fontFamily);
			}
		}
		return {
			format: RECOVERY_PROJECT_FORMAT, version: 1,
			source: { sceneId: 'scene001', levelId: 'level001', scene: sceneContext, level: this.level },
			project: validateProjectPackage({ format: PROJECT_FORMAT, version: 1, scope: 'full', coordinateSpace: 'scene-pixels',
				name: 'Test', source: { foundry: '14.365', drawingSchema: '14.355' }, tree: projectTree,
				drawings: sources.map(source => exportProjectDrawing({ id: source._id, toObject: () => structuredClone(source) })),
				recovery: [], bounds: null, dependencies: {} }),
			authors: sources.map(source => ({ id: source._id, author: source.author })),
			tiles: [...this.tiles.values()], journal: { version: 1, revision: this.entries.length, entries: structuredClone(this.entries) },
			resources: { images: [...imagePaths].sort().map(source => ({
				source, file: this.files.find(file => file.reference.path === source)?.reference ?? null,
			})), fonts: [...fonts].sort() },
		};
	};
	return state;
}

test('validates live Drawing, Tile and background roots without changing manifest or files', async () => {
	for (const type of ['Drawing', 'Tile', 'LevelBackground']) {
		const h = await history(); await h.apply('one', type);
		const manifest = h.manifest(), before = structuredClone(manifest), files = structuredClone(h.files);
		assert.deepEqual(await validateRecoveryProjectManifest(manifest, h.files), before);
		assert.deepEqual(manifest, before); assert.deepEqual(h.files, files);
	}
});

test('rewinds Consolidate -> repeat -> Tile with ancestors absent from live artwork', async () => {
	const h = await history(); await h.apply('one'); await h.apply('two', 'Drawing', 'one'); await h.apply('three', 'Tile', 'two');
	assert.equal(h.drawings.size, 0);
	await validateRecoveryProjectManifest(h.manifest(), h.files);
	h.restore('three'); await validateRecoveryProjectManifest(h.manifest(), h.files);
	h.restore('two'); await validateRecoveryProjectManifest(h.manifest(), h.files);
	h.restore('one'); await validateRecoveryProjectManifest(h.manifest(), h.files);
});

test('retains later independent artwork through history verification', async () => {
	const h = await history(); await h.apply('one'); h.drawings.set('later001', { ...drawing('later001'), sort: 2048 });
	const result = await validateRecoveryProjectManifest(h.manifest(), h.files);
	assert.equal(result.project.drawings.length, 2);
});

test('refuses edited roots, occupied original identities and altered restored strokes', async () => {
	const h = await history(); await h.apply('one');
	h.drawings.get('inkone').x++;
	await assert.rejects(validateRecoveryProjectManifest(h.manifest(), h.files), /Live baked root/);
	h.drawings.get('inkone').x--;
	h.drawings.set('stroke001', drawing('stroke001'));
	await assert.rejects(validateRecoveryProjectManifest(h.manifest(), h.files), /unexpectedly live/);
	h.drawings.delete('stroke001'); h.restore('one'); h.drawings.get('stroke001').rotation++;
	await assert.rejects(validateRecoveryProjectManifest(h.manifest(), h.files), /Restored original/);
});

test('refuses semantic Scene/layer/Level conflicts but admits strictly newer revision-only context', async () => {
	const h = await history(); await h.apply('one');
	let manifest = h.manifest(); manifest.source.scene = { ...sceneContext, width: 641 };
	await assert.rejects(validateRecoveryProjectManifest(manifest, h.files), /Scene or layer context/);
	manifest = h.manifest(); manifest.project.tree.revision = 2;
	await validateRecoveryProjectManifest(manifest, h.files);
	manifest.project.tree.nodes.push({ id: 'newLayer', name: 'New', kind: 'layer', parentId: null, locked: false, playerAllowed: false, defaults: {} });
	await assert.rejects(validateRecoveryProjectManifest(manifest, h.files), /Scene or layer context/);
	manifest = h.manifest(); manifest.source.level = { ...manifest.source.level, name: 'Changed' };
	await assert.rejects(validateRecoveryProjectManifest(manifest, h.files), /Live baked root/);
});

test('refuses incomplete history, missing/corrupt files and untracked Tiles', async () => {
	const h = await history(); await h.apply('one');
	await assert.rejects(validateRecoveryProjectManifest(h.manifest(), h.files.slice(1)), /no typed recovery archive|Missing/);
	const files = structuredClone(h.files); files[1].bytes[0] ^= 1;
	await assert.rejects(validateRecoveryProjectManifest(h.manifest(), files), /verified bytes/);
	let manifest = h.manifest(); manifest.journal.entries[0].phase = 'intent';
	await assert.rejects(validateRecoveryProjectManifest(manifest, h.files), /complete operations/);
	manifest = h.manifest(); manifest.tiles.push({ _id: 'unrelatedTile' });
	await assert.rejects(validateRecoveryProjectManifest(manifest, h.files), /Untracked Tiles/);
});

test('refuses removed roots and forged native author inventory', async () => {
	const h = await history(); await h.apply('one');
	let manifest = h.manifest(); manifest.authors[0].author = 'forgedAuthor';
	await assert.rejects(validateRecoveryProjectManifest(manifest, h.files), /Live baked root/);
	h.drawings.clear();
	await assert.rejects(validateRecoveryProjectManifest(h.manifest(), h.files), /Live baked root/);
});

test('source collector preserves live project, native roots and full restored history without writes', async () => {
	const old = { game: globalThis.game, location: globalThis.location, fetch: globalThis.fetch,
		getDocumentClass: globalThis.getDocumentClass };
	const h = await history(); await h.apply('one'); await h.apply('two', 'Tile', 'one');
	const doc = source => ({ id: source._id, toObject: () => structuredClone(source) });
	let current = true, mutateOnRead = false;
	const scene = {
		id: 'scene001', name: 'Read-only recovery', ...sceneContext,
		levels: new Map([['level001', doc(h.level)]]),
		get drawings() { return new Map([...h.drawings].map(([id, source]) => [id, doc(source)])); },
		get tiles() { return new Map([...h.tiles].map(([id, source]) => [id, doc(source)])); },
		getFlag(namespace, key) {
			if (key === 'layers') return tree;
			if (key === 'optimizationJournal') return { version: 1, revision: h.entries.length, entries: h.entries };
		},
		toObject() { return { sceneContext, level: h.level, drawings: [...h.drawings.values()],
			tiles: [...h.tiles.values()], tree, entries: h.entries }; },
	};
	globalThis.game = { user: { id: 'gm001', isGM: true, can: () => true }, scenes: new Map([[scene.id, scene]]), version: '14.365' };
	globalThis.getDocumentClass = () => ({ metadata: { schemaVersion: '14.355' } });
	globalThis.location = { href: 'http://localhost:30000/game' };
	const byPath = new Map(h.files.map(file => [file.reference.path, file.bytes]));
	globalThis.fetch = async url => {
		if (mutateOnRead) h.tiles.get('tiletwo').hidden = true;
		return new Response(byPath.get(decodeURIComponent(url.pathname).slice(1)));
	};
	const options = { levelId: 'level001', maxBytes: 1024 * 1024, maxEntries: 20, isCurrent: () => current };
	try {
		const before = canonicalJson(scene.toObject());
		const result = await prepareRecoveryProjectManifest(scene, options);
		assert.equal(result.review.tileCount, 1);
		assert.equal(result.review.drawingCount, 0);
		assert.deepEqual(result.manifest.journal.entries.map(entry => entry.token), ['one', 'two']);
		assert.equal(canonicalJson(scene.toObject()), before);
		h.restore('two'); h.restore('one');
		const restored = await prepareRecoveryProjectManifest(scene, options);
		assert.equal(restored.review.drawingCount, 1);
		assert.equal(restored.manifest.journal.entries.length, 4);
		current = false;
		await assert.rejects(prepareRecoveryProjectManifest(scene, options), /Source context changed/);
		current = true;
		h.tiles.set('tiletwo', { _id: 'tiletwo', hidden: false });
		mutateOnRead = true;
		await assert.rejects(prepareRecoveryProjectManifest(scene, options), /context changed/);
	} finally {
		Object.assign(globalThis, old);
	}
});

test('inventories textures and fonts in archived originals even when only the Tile is live', async () => {
	const h = await history(), original = h.drawings.get('stroke001');
	original.texture = 'modules/foundryshop/assets/materials/timber-planks.png';
	original.fillType = 2; original.text = 'Original label';
	await h.apply('one'); await h.apply('two', 'Tile', 'one');
	const manifest = await validateRecoveryProjectManifest(h.manifest(), h.files);
	assert.deepEqual(manifest.resources.fonts, ['Signika']);
	assert.deepEqual(manifest.resources.images.filter(image => image.file === null),
		[{ source: original.texture, file: null }]);
	const altered = structuredClone(manifest);
	altered.resources.images = altered.resources.images.filter(image => image.file !== null);
	await assert.rejects(validateRecoveryProjectManifest(altered, h.files), /resource inventory/);
});

test('rewinds restored background and subsequent fresh Drawing operations chronologically', async () => {
	const h = await history(); await h.apply('background', 'LevelBackground'); h.restore('background');
	await h.apply('next');
	await validateRecoveryProjectManifest(h.manifest(), h.files);
	h.restore('next');
	await validateRecoveryProjectManifest(h.manifest(), h.files);
});

test('maps an original background source to its preserved byte copy, not an external path-only dependency', async () => {
	const h = await history(); h.level.background.src = 'maps/original.png';
	await h.apply('background', 'LevelBackground');
	const manifest = h.manifest(), backup = h.archives.get('background').payload.originalBackground;
	manifest.resources.images.push({ source: backup.src, file: backup.file });
	manifest.resources.images.sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
	await validateRecoveryProjectManifest(manifest, h.files);
	manifest.resources.images.find(image => image.source === backup.src).file = null;
	await assert.rejects(validateRecoveryProjectManifest(manifest, h.files), /resource inventory/);
});

test('enclosing ZIP preserves live Drawing, Tile and background projects with verified recovery history', async () => {
	for (const type of ['Drawing', 'Tile', 'LevelBackground']) {
		const h = await history(); await h.apply('one', type);
		const input = h.manifest(), before = structuredClone(input);
		const bytes = await encodeRecoveryProjectBundle(input, h.files, [], limits);
		const result = await decodeRecoveryProjectBundle(bytes, limits);
		assert.deepEqual(result.manifest, before);
		assert.deepEqual(result.recoveryFiles, h.files);
		assert.deepEqual(result.imageAssets, []);
		assert.deepEqual(input, before);
	}
});

test('enclosing ZIP retains every archived texture alias and font requirement, sharing identical image entries', async () => {
	const h = await history(), original = h.drawings.get('stroke001');
	original.texture = 'materials/ink.png'; original.fillType = 2; original.text = 'Label';
	await h.apply('one'); await h.apply('two', 'Tile', 'one');
	h.drawings.set('later', { ...drawing('later'), texture: 'materials/other.png', fillType: 2 });
	const assets = ['materials/ink.png', 'materials/other.png'].map(source => ({ source, bytes: png }));
	const bytes = await encodeRecoveryProjectBundle(h.manifest(), h.files, assets, limits);
	const decoded = await decodeRecoveryProjectBundle(bytes, limits), entries = decodeStoredRecoveryZip(bytes, limits);
	assert.deepEqual(decoded.imageAssets, assets);
	assert.deepEqual(decoded.manifest.resources.fonts, ['Signika']);
	assert.equal(Object.keys(entries).filter(path => path.endsWith('.png')).length, 1);
});

test('enclosing ZIP refuses incomplete, extra or duplicate ordinary image inventories', async () => {
	const h = await history(); h.drawings.get('stroke001').texture = 'materials/ink.png';
	await h.apply('one'); const manifest = h.manifest(), asset = { source: 'materials/ink.png', bytes: png };
	await assert.rejects(encodeRecoveryProjectBundle(manifest, h.files, [], limits), /All ordinary image bytes/);
	await assert.rejects(encodeRecoveryProjectBundle(manifest, h.files, [{ ...asset, source: 'unknown.png' }], limits), /inventory/);
	await assert.rejects(encodeRecoveryProjectBundle(manifest, h.files, [asset, asset], limits), /All ordinary image bytes/);
	await assert.rejects(encodeRecoveryProjectBundle(manifest, h.files, [{ ...asset, bytes: new TextEncoder().encode('GIF89a') }], limits), /static|unsupported|readable/);
});

test('enclosing ZIP validates declared image hashes/dimensions and refuses extra entries or omitted recovery', async () => {
	const h = await history(); h.drawings.get('stroke001').texture = 'materials/ink.png'; await h.apply('one');
	const texture = new Uint8Array(Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
	const bytes = await encodeRecoveryProjectBundle(h.manifest(), h.files, [{ source: 'materials/ink.png', bytes: texture }], limits);
	const edit = change => {
		const entries = decodeStoredRecoveryZip(bytes, limits),
			manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']));
		change(manifest, entries);
		entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
		return encodeStoredRecoveryZip(entries, limits);
	};
	await assert.rejects(decodeRecoveryProjectBundle(edit(manifest => manifest.images[0].width++), limits), /dimensions/);
	await assert.rejects(decodeRecoveryProjectBundle(edit(manifest => manifest.images[0].fingerprint = 'f'.repeat(64)), limits), /descriptor/);
	await assert.rejects(decodeRecoveryProjectBundle(edit((manifest, entries) => {
		const image = entries[manifest.images[0].entry]; image[45] ^= 1;
	}), limits), /Image bytes/);
	await assert.rejects(decodeRecoveryProjectBundle(edit((manifest, entries) => {
		entries[manifest.images[0].entry] = texture.subarray(0, texture.length - 1);
	}), limits), /truncated|incomplete|container|chunk/i);
	await assert.rejects(decodeRecoveryProjectBundle(edit((manifest, entries) => {
		entries[`files/${'f'.repeat(64)}.png`] = png;
	}), limits), /undeclared/);
	await assert.rejects(decodeRecoveryProjectBundle(edit((manifest, entries) => {
		delete entries[manifest.recovery[0].entry];
	}), limits), /Missing exact recovery/);
	await assert.rejects(decodeRecoveryProjectBundle(edit(manifest => manifest.project.authors[0].author = 'forged'), limits), /Live baked root/);
});

test('enclosing ZIP retains restored ancestors and refuses caller budgets without mutating input', async () => {
	const h = await history(); await h.apply('one'); await h.apply('two', 'Tile', 'one'); h.restore('two');
	const manifest = h.manifest(), before = structuredClone(manifest);
	const bytes = await encodeRecoveryProjectBundle(manifest, h.files, [], limits);
	const result = await decodeRecoveryProjectBundle(bytes, limits);
	assert.deepEqual(result.manifest.journal.entries.map(entry => entry.action), ['apply', 'apply', 'restore']);
	h.restore('one'); await h.apply('three', 'Tile');
	const reapplied = await decodeRecoveryProjectBundle(
		await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits), limits);
	assert.deepEqual(reapplied.manifest.journal.entries.map(entry => entry.action), ['apply', 'apply', 'restore', 'restore', 'apply']);
	await assert.rejects(encodeRecoveryProjectBundle(manifest, h.files, [], { ...limits, maxBytes: 100 }), /budget/);
	await assert.rejects(decodeRecoveryProjectBundle(bytes, { ...limits, maxEntries: 2 }), /entry count/);
	assert.deepEqual(manifest, before);
});

test('same-server project collector fetches and decodes archived textures, refuses external paths and detects stale reads', async () => {
	const old = { game: globalThis.game, location: globalThis.location, fetch: globalThis.fetch,
		getDocumentClass: globalThis.getDocumentClass, createImageBitmap: globalThis.createImageBitmap };
	const h = await history(); h.drawings.get('stroke001').texture = 'materials/ink.png';
	await h.apply('one', 'Tile');
	const doc = source => ({ id: source._id, toObject: () => structuredClone(source) });
	const scene = { id: 'scene001', name: 'Bundle source', ...sceneContext,
		levels: new Map([['level001', doc(h.level)]]),
		get drawings() { return new Map([...h.drawings].map(([id, source]) => [id, doc(source)])); },
		get tiles() { return new Map([...h.tiles].map(([id, source]) => [id, doc(source)])); },
		getFlag(namespace, key) {
			if (key === 'layers') return tree;
			if (key === 'optimizationJournal') return { version: 1, revision: 1, entries: h.entries };
		},
		toObject: () => ({ drawings: [...h.drawings.values()], tiles: [...h.tiles.values()], journal: h.entries }),
	};
	let stale = false, closed = 0, declaredBytes;
	const controller = new AbortController();
	let abortOnTexture = false;
	const requests = [], files = new Map(h.files.map(file => [file.reference.path, file.bytes]));
	files.set('materials/ink.png', png);
	globalThis.game = { user: { id: 'gm001', isGM: true, can: () => true }, scenes: new Map([[scene.id, scene]]), version: '14.365' };
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.getDocumentClass = () => ({ metadata: { schemaVersion: '14.355' } });
	globalThis.fetch = async (url, options) => {
		requests.push({ url: String(url), options });
		const path = decodeURIComponent(new URL(url).pathname).slice(1);
		if (stale && path === 'materials/ink.png') h.tiles.get('tileone').hidden = true;
		if (abortOnTexture && path === 'materials/ink.png') controller.abort();
		return new Response(files.get(path), { status: files.has(path) ? 200 : 404,
			headers: path === 'materials/ink.png' && declaredBytes ? { 'content-length': String(declaredBytes) } : {} });
	};
	globalThis.createImageBitmap = async blob => {
		const header = inspectOptimizationImage(new Uint8Array(await blob.arrayBuffer()));
		return { width: header.width, height: header.height, close() { closed++; } };
	};
	const options = { ...limits, levelId: 'level001', isCurrent: () => true };
	try {
		const before = canonicalJson(scene.toObject());
		const result = await prepareRecoveryProjectBundle(scene, options);
		const decoded = await decodeRecoveryProjectBundle(result.bytes, limits);
		assert.equal(result.review.ordinaryImageCount, 1);
		assert.deepEqual(decoded.imageAssets, [{ source: 'materials/ink.png', bytes: png }]);
		assert.equal(closed, 1);
		assert.equal(canonicalJson(scene.toObject()), before);
		const exportReview = await reviewRecoveryProjectExport(scene, options);
		assert.equal(exportReview.review.fingerprint, await fileFingerprint(result.bytes));
		assert.equal(exportReview.review.filename, 'Bundle_source.foundryshop-recovery.zip');
		assert.throws(() => exportReview.approve({ fingerprint: exportReview.review.fingerprint,
			downloadZip: true, retainServerFiles: false }), /retention/);
		const capability = exportReview.approve({ fingerprint: exportReview.review.fingerprint,
			downloadZip: true, retainServerFiles: true });
		const oldDocument = globalThis.document, oldFoundry = globalThis.foundry, oldI18n = game.i18n,
			create = URL.createObjectURL, revoke = URL.revokeObjectURL,
			oldTimer = globalThis.setTimeout;
		let downloaded, clicked = 0, removed = 0, revoked = 0;
		URL.createObjectURL = blob => { downloaded = blob; return 'blob:verified'; };
		URL.revokeObjectURL = () => { revoked++; };
		globalThis.setTimeout = (callback, delay) => {
			if (delay === 1000) { callback(); return 1; }
			return oldTimer(callback, delay);
		};
		globalThis.document = { body: { append() {} },
			createElement: () => ({ click() { clicked++; }, remove() { removed++; } }) };
		try {
			exportReview.review.fingerprint = 'forged'; exportReview.review.filename = 'forged';
			const receipt = downloadRecoveryProjectExport(capability);
			assert.equal(receipt.status, 'download-initiated');
			assert.equal(receipt.filename, 'Bundle_source.foundryshop-recovery.zip');
			assert.equal(downloaded.type, 'application/zip');
			assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), result.bytes);
			assert.equal(clicked, 1); assert.equal(removed, 1); assert.equal(revoked, 1);
			assert.throws(() => downloadRecoveryProjectExport(capability), /fresh reviewed/);
			assert.throws(() => downloadRecoveryProjectExport({}), /fresh reviewed/);
			const staleReview = await reviewRecoveryProjectExport(scene, options);
			const staleApproval = staleReview.approve({ fingerprint: staleReview.review.fingerprint,
				downloadZip: true, retainServerFiles: true });
			const tile = h.tiles.get('tileone'), hidden = tile.hidden;
			tile.hidden = !hidden;
			assert.throws(() => downloadRecoveryProjectExport(staleApproval), /context changed/);
			tile.hidden = hidden;
			const failedReview = await reviewRecoveryProjectExport(scene, options);
			const failedApproval = failedReview.approve({ fingerprint: failedReview.review.fingerprint,
				downloadZip: true, retainServerFiles: true });
			globalThis.document.createElement = () => ({ click() { throw new Error('download failed'); }, remove() { removed++; } });
			assert.throws(() => downloadRecoveryProjectExport(failedApproval), /download failed/);
			assert.throws(() => downloadRecoveryProjectExport(failedApproval), /fresh reviewed/);
			assert.equal(removed, 2); assert.equal(revoked, 2);
			game.i18n = { localize: key => key, format: (key, data) => `${key}: ${JSON.stringify(data)}` };
			globalThis.document.createElement = () => ({ append() {}, click() { clicked++; }, remove() {} });
			globalThis.foundry = { applications: { api: { DialogV2: { confirm: async () => false } } } };
			assert.deepEqual(await promptRecoveryProjectExport(scene, options), { status: 'cancelled' });
			assert.equal(clicked, 1);
			foundry.applications.api.DialogV2.confirm = async () => {
				h.tiles.get('tileone').hidden = true; return true;
			};
			await assert.rejects(promptRecoveryProjectExport(scene, options), /context changed/);
			h.tiles.get('tileone').hidden = false;
			assert.equal(clicked, 1);
		} finally {
			globalThis.document = oldDocument; URL.createObjectURL = create; URL.revokeObjectURL = revoke;
			globalThis.setTimeout = oldTimer;
			globalThis.foundry = oldFoundry; game.i18n = oldI18n;
		}
		const textureRequest = requests.find(request => request.url.endsWith('/materials/ink.png'));
		assert.equal(textureRequest.options.credentials, 'same-origin');
		assert.equal(textureRequest.options.redirect, 'error');
		// The texture alone fits maxBytes, but verified recovery bytes already occupy part of that budget.
		const closedBeforeBudgetRefusal = closed;
		declaredBytes = limits.maxBytes;
		await assert.rejects(prepareRecoveryProjectBundle(scene, options), /byte budget/);
		assert.equal(closed, closedBeforeBudgetRefusal);
		declaredBytes = undefined;
		files.delete('materials/ink.png');
		await assert.rejects(prepareRecoveryProjectBundle(scene, options), /HTTP 404/);
		files.set('materials/ink.png', png.subarray(0, 20));
		await assert.rejects(prepareRecoveryProjectBundle(scene, options), /truncated|incomplete|container|chunk|dimensions/i);
		files.set('materials/ink.png', png);
		abortOnTexture = true;
		await assert.rejects(prepareRecoveryProjectBundle(scene, { ...options, signal: controller.signal }), /context changed|cancelled/);
		abortOnTexture = false;
		stale = true;
		await assert.rejects(prepareRecoveryProjectBundle(scene, options), /context changed/);
		h.tiles.get('tileone').hidden = false; stale = false;
		// A later independent texture makes external preflight exercise a valid history.
		h.drawings.set('later', { ...drawing('later'), texture: 'https://example.org/not-requested.png' });
		const count = requests.length;
		await assert.rejects(prepareRecoveryProjectBundle(scene, options), /same-server/);
		assert.equal(requests.slice(count).some(request => request.url.startsWith('https://example.org')), false);
		assert.equal(requests.slice(count).some(request => request.url.endsWith('/materials/ink.png')), false);
	} finally { Object.assign(globalThis, old); }
});

const destination = () => ({
	sceneId: 'destination001', authorId: 'importingGM',
	scene: { width: 1280, height: 720, padding: 0.25, grid: { type: 1, size: 100 } },
	level: { _id: 'destinationLevel', background: { src: 'maps/destination.png', color: '#112233' },
		elevation: { bottom: 7, top: 30 }, foreground: { src: 'maps/foreground.png' },
		textures: { fit: 'fill', scaleX: 1, scaleY: 1 }, flags: { destination: { preserved: true } } },
	root: 'worlds/destination/assets', reservedIds: ['existingDrawing'], reservedPaths: ['worlds/destination/assets/occupied.png'],
});
const remapOptions = () => {
	let counter = 0;
	return { ...limits, createId: () => `fresh${++counter}` };
};
const archivesIn = async result => Promise.all(result.recoveryFiles.filter(file => file.reference.path.endsWith('.json'))
	.map(file => readOptimizationArchive(new TextDecoder().decode(file.bytes))));

test('destination remapping rebuilds every generation, native author/Level and immutable checksum without scaling', async () => {
	const h = await history(); h.drawings.get('stroke001').elevation = 20;
	await h.apply('one'); await h.apply('two', 'Tile', 'one');
	const input = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits),
		before = input.slice(), target = destination(), targetBefore = structuredClone(target);
	const result = await remapRecoveryProjectBundle(input, target, remapOptions());
	const archives = await archivesIn(result);
	assert.equal(archives.length, 2);
	for (const { payload } of archives) {
		assert.equal(payload.sceneId, target.sceneId); assert.equal(payload.levelId, target.level._id);
		assert.deepEqual(payload.context.scene, target.scene);
		assert.deepEqual(payload.context.level, target.level);
		assert.equal(payload.originals[0].author, target.authorId);
		assert.deepEqual(payload.originals[0].levels, [target.level._id]);
		assert.equal(payload.originals[0].x, 10); assert.equal(payload.originals[0].y, 10);
		assert.equal(payload.output.root, target.root);
	}
	assert.equal(archives[0].payload.originals[0].elevation, 20);
	assert.deepEqual(archives[1].payload.originals[0], archives[0].payload.replacement.after);
	assert.equal(archives[1].payload.parent.checksum, archives[0].checksum);
	assert.equal(result.manifest.tiles[0]._id, archives[1].payload.replacement.id);
	assert.deepEqual(result.manifest.source.level, target.level);
	assert.notEqual(archives[0].checksum, h.archives.get('one').checksum);
	assert.equal(result.manifest.journal.entries.every(entry => entry.ownerId === target.authorId), true);
	assert.deepEqual(result.provenance.authors.find(author => author.id === 'stroke001'), { id: 'stroke001', author: 'gm001' });
	assert.equal(result.uploads.every(file => file.reference.root === target.root), true);
	assert.equal(new Set(result.uploads.map(file => file.reference.path)).size, result.uploads.length);
	assert.deepEqual(input, before); assert.deepEqual(target, targetBefore);
	await validateRecoveryProjectManifest(result.manifest, result.recoveryFiles);
	await decodeRecoveryProjectBundle(result.bytes, limits);
});

test('destination remapping retains completed Restores and fresh reapply history', async () => {
	const h = await history(); await h.apply('one'); await h.apply('two', 'Tile', 'one');
	h.restore('two'); h.restore('one'); await h.apply('three');
	const input = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits);
	const result = await remapRecoveryProjectBundle(input, destination(), remapOptions());
	assert.deepEqual(result.manifest.journal.entries.map(entry => entry.action), ['apply', 'apply', 'restore', 'restore', 'apply']);
	const entries = result.manifest.journal.entries;
	for (const [restoreIndex, applyIndex] of [[2, 1], [3, 0]]) {
		assert.deepEqual(entries[restoreIndex].archive, entries[applyIndex].archive);
		assert.deepEqual(entries[restoreIndex].replacement, entries[applyIndex].replacement);
		assert.equal(entries[restoreIndex].sourceDigest, entries[applyIndex].sourceDigest);
		assert.equal(entries[restoreIndex].parentToken, entries[applyIndex].token);
	}
	await validateRecoveryProjectManifest(result.manifest, result.recoveryFiles);
});

test('destination remapping maps layer hierarchy, scope/presets and archived ordinary textures consistently', async () => {
	const h = await history();
	h.drawings.get('stroke001').texture = 'materials/ink.png';
	h.drawings.get('stroke001').text = 'Text'; h.drawings.get('stroke001').fillType = 2;
	await h.apply('one');
	// Refresh a valid source archive with its complete canonical layer context.
	const layerTree = { version: 1, revision: 0, nodes: [
		{ id: 'group001', kind: 'group', name: 'Group', parentId: null, locked: false, playerAllowed: false, defaults: {} },
		{ id: 'layer001', kind: 'layer', name: 'Ink', parentId: 'group001', locked: false, playerAllowed: true,
			defaults: { texture: 'materials/ink.png' } },
	], presets: [{ id: 'preset001', name: 'Reveal', entries: [{ nodeId: 'layer001', playerAllowed: true }] }] };
	const payload = structuredClone(h.archives.get('one').payload);
	payload.context.layers = layerTree; payload.scope = { kind: 'layer', layerId: 'layer001' };
	payload.originals[0].flags = { foundryshop: { layerId: 'layer001' } };
	payload.replacement.after.flags.foundryshop.layerId = 'layer001';
	payload.replacement.staged.flags.foundryshop.layerId = 'layer001';
	const { text } = await encodeOptimizationArchive(payload), bytes = new TextEncoder().encode(text);
	const archiveReference = await reference('recovery-one.json', bytes), descriptor = await optimizationArchiveDescriptor(text);
	h.files[0] = { reference: archiveReference, bytes };
	h.entries[0] = { ...h.entries[0], ...descriptor, archive: archiveReference };
	h.drawings.set('inkone', structuredClone(payload.replacement.after));
	const manifest = h.manifest(layerTree);
	const input = await encodeRecoveryProjectBundle(manifest, h.files, [{ source: 'materials/ink.png', bytes: png }], limits);
	const result = await remapRecoveryProjectBundle(input, destination(), remapOptions()),
		[{ payload: mapped }] = await archivesIn(result), nodes = result.manifest.project.tree.nodes;
	assert.equal(nodes[1].parentId, nodes[0].id);
	assert.equal(mapped.scope.layerId, nodes[1].id);
	assert.equal(mapped.originals[0].flags.foundryshop.layerId, nodes[1].id);
	assert.equal(result.manifest.project.drawings[0].layerId, nodes[1].id);
	assert.equal(nodes[1].defaults.texture, mapped.originals[0].texture);
	assert.equal(result.manifest.project.tree.presets[0].entries[0].nodeId, nodes[1].id);
	assert.equal(result.manifest.resources.fonts[0], 'Signika');
	assert.equal(result.imageAssets[0].source, mapped.originals[0].texture);
	assert.notEqual(nodes[0].id, 'group001');
	await withImportDestination(async ({ scene, options }) => {
		const prepared = await prepareRecoveryImport(scene, input, options()),
			[{ payload: archive }] = await archivesIn(prepared), hiddenTree = prepared.manifest.project.tree,
			importedLayer = hiddenTree.nodes.find(node => node.name === 'Ink');
		assert.equal(effectiveLayerGate(hiddenTree, importedLayer.id, node => node.playerAllowed), false);
		assert.equal(importedLayer.playerAllowed, true);
		assert.equal(prepared.presentation.unassignedId, null);
		assert.deepEqual(archive.context.layers, hiddenTree);
		assert.equal(archive.scope.layerId, importedLayer.id);
		const originalPreset = hiddenTree.presets.find(preset => preset.name === 'Reveal');
		assert.equal(originalPreset.entries.find(entry => entry.nodeId === prepared.presentation.rootId).playerAllowed, true);
	});
});

test('destination background remapping uses preserved alias bytes and retains unrelated native Level settings', async () => {
	const h = await history(); h.level.background.src = 'https://example.org/old-background.png';
	await h.apply('background', 'LevelBackground');
	const manifest = h.manifest(), backup = h.archives.get('background').payload.originalBackground;
	manifest.resources.images.push({ source: backup.src, file: backup.file });
	manifest.resources.images.sort((a, b) => a.source < b.source ? -1 : 1);
	const input = await encodeRecoveryProjectBundle(manifest, h.files, [], limits), target = destination();
	const result = await remapRecoveryProjectBundle(input, target, remapOptions()),
		[{ payload }] = await archivesIn(result);
	assert.equal(result.review.hasBackground, true);
	assert.notEqual(payload.originalBackground.src, payload.originalBackground.file.path);
	assert.equal(payload.replacement.before.background.src, payload.originalBackground.src);
	assert.equal(payload.replacement.after.background.src, payload.output.path);
	assert.deepEqual(payload.context.level.foreground, target.level.foreground);
	assert.deepEqual(payload.context.level.elevation, target.level.elevation);
	assert.deepEqual(payload.context.level.flags, target.level.flags);
	assert.equal(result.uploads.some(file => file.reference.path === payload.originalBackground.src), true);
	assert.equal(result.uploads.some(file => file.reference.path === payload.originalBackground.file.path), true);
	assert.equal(JSON.stringify(result.manifest).includes('https://example.org'), false);
	// Exercise the complete restored-background state as well.
	h.restore('background'); const restored = h.manifest();
	restored.resources.images.push({ source: backup.src, file: backup.file });
	restored.resources.images.sort((a, b) => a.source < b.source ? -1 : 1);
	const restoredResult = await remapRecoveryProjectBundle(
		await encodeRecoveryProjectBundle(restored, h.files, [], limits), target, remapOptions());
	await validateRecoveryProjectManifest(restoredResult.manifest, restoredResult.recoveryFiles);
});

test('destination remapping refuses occupied IDs/paths, invalid context, input corruption and budgets', async () => {
	const h = await history(); await h.apply('one');
	const bytes = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits);
	for (const value of ['stroke001', 'existingDrawing', 'bad id', 'gm001']) {
		await assert.rejects(remapRecoveryProjectBundle(bytes, destination(), { ...limits, createId: () => value }), /allocator/);
	}
	await assert.rejects(remapRecoveryProjectBundle(bytes, destination(), { ...limits, createId: () => 'repeat' }), /allocator/);
	const target = destination(); target.reservedPaths.push(`${target.root}/image-fresh1-0.png`);
	await assert.rejects(remapRecoveryProjectBundle(bytes, target, remapOptions()), /occupied/);
	const malformed = destination(); malformed.scene.width = -1;
	await assert.rejects(remapRecoveryProjectBundle(bytes, malformed, remapOptions()), /archive/);
	const unsafe = destination(); unsafe.root = '../escape';
	const oldGame = globalThis.game;
	globalThis.game = { i18n: { localize: key => key } };
	try {
		await assert.rejects(remapRecoveryProjectBundle(bytes, unsafe, remapOptions()), /Stamps.Folder/);
	} finally { globalThis.game = oldGame; }
	await assert.rejects(remapRecoveryProjectBundle(bytes, destination(), { ...remapOptions(), maxBytes: 100 }), /budget/);
	await assert.rejects(remapRecoveryProjectBundle(bytes.subarray(0, bytes.length - 1), destination(), remapOptions()), /container/);
});

test('each remapped Tile and Drawing generation can return to its exact destination-bound originals', async () => {
	const h = await history(); h.drawings.get('stroke001').texture = 'materials/original.png';
	h.drawings.get('stroke001').fillType = 2; h.drawings.get('stroke001').rotation = 37;
	await h.apply('one'); await h.apply('two', 'Drawing', 'one'); await h.apply('three', 'Tile', 'two');
	const input = await encodeRecoveryProjectBundle(h.manifest(), h.files,
		[{ source: 'materials/original.png', bytes: png }], limits);
	const result = await remapRecoveryProjectBundle(input, destination(), remapOptions());
	const archives = await archivesIn(result), current = structuredClone(result.manifest),
		records = new Map(archives.map(archive => [archive.payload.id, archive]));
	for (const [index, archive] of [...archives].reverse().entries()) {
		const { payload } = archive, replacement = payload.replacement;
		const drawings = new Map(reconstructRecoveryProjectDrawings(current.project, current.authors).map(source => [source._id, source]));
		if (replacement.type === 'Tile') current.tiles = current.tiles.filter(tile => tile._id !== replacement.id);
		else drawings.delete(replacement.id);
		for (const original of payload.originals) drawings.set(original._id, structuredClone(original));
		const apply = current.journal.entries.find(entry => entry.token === payload.id);
		current.journal.entries.push({ ...structuredClone(apply), action: 'restore', token: `verifiedRestore${index}`, parentToken: apply.token });
		current.journal.revision++;
		current.project = validateProjectPackage({ ...current.project, bounds: null, dependencies: {},
			drawings: [...drawings.values()].map(source => exportProjectDrawing({ id: source._id, toObject: () => structuredClone(source) })) });
		current.authors = [...drawings.values()].map(source => ({ id: source._id, author: source.author }));
		current.resources = recoveryProjectResources(current.project, records, result.recoveryFiles);
		await validateRecoveryProjectManifest(current, result.recoveryFiles);
		assert.deepEqual(reconstructRecoveryProjectDrawings(current.project, current.authors), payload.originals);
	}
	const restored = reconstructRecoveryProjectDrawings(current.project, current.authors)[0];
	assert.equal(restored.rotation, 37);
	assert.equal(restored.author, destination().authorId);
	assert.equal(restored.texture, result.imageAssets[0].source);
	assert.deepEqual(restored.shape, drawing('stroke001').shape);
});

async function withImportDestination(run) {
	const old = { game: globalThis.game, foundry: globalThis.foundry, getDocumentClass: globalThis.getDocumentClass };
	const target = destination(), flags = {}, nativeChecks = [], model = { normalize: null }, access = { current: true };
	const scene = { id: target.sceneId, ...target.scene, drawings: new Map(), tiles: new Map(),
		_stats: { createdTime: 100, modifiedTime: 100, lastModifiedBy: target.authorId, coreVersion: '14.365' },
		touch() { this._stats.modifiedTime++; this._stats.lastModifiedBy = game.user.id; },
		levels: new Map([[target.level._id, { toObject: () => structuredClone(target.level) }]]),
		getFlag: (namespace, key) => flags[key], canUserModify: () => true,
		toObject() { return { id: this.id, width: this.width, grid: this.grid, flags: { foundryshop: flags }, _stats: structuredClone(this._stats),
			levels: [...this.levels.values()].map(document => document.toObject()),
			drawings: [...this.drawings.values()].map(document => document.toObject?.() ?? structuredClone(document)),
			tiles: [...this.tiles.values()].map(document => document.toObject?.() ?? structuredClone(document)) }; } };
	globalThis.game = { user: { id: target.authorId, isGM: true, can: () => true },
		users: { activeGM: { id: target.authorId } }, scenes: new Map([[scene.id, scene]]), modules: new Map(),
		i18n: { localize: key => key } };
	globalThis.foundry = { applications: { settings: { menus: { FontConfig: { getAvailableFonts: () => ['Signika'] } } } } };
	globalThis.getDocumentClass = type => class {
		constructor(source, options) { assert.equal(options.parent, scene); assert.equal(options.strict, true);
			this.source = structuredClone(source); nativeChecks.push({ type, source: structuredClone(source) });
			model.normalize?.(this.source, type); }
		toObject() { return this.source; }
	};
	const options = () => ({ ...remapOptions(), levelId: target.level._id, root: target.root,
		reservedPaths: target.reservedPaths, isCurrent: () => access.current });
	try { await run({ scene, target, flags, nativeChecks, model, access, options }); }
	finally { Object.assign(globalThis, old); }
}

test('guarded import preparation conceals live and archived Unassigned Drawings behind the same hidden wrapper', async () => {
	const h = await history(); await h.apply('one');
	const input = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits);
	await withImportDestination(async ({ scene, options, nativeChecks }) => {
		const before = canonicalJson(scene.toObject()), result = await prepareRecoveryImport(scene, input, options()),
			[{ payload }] = await archivesIn(result), { rootId, unassignedId, presetId } = result.presentation;
		assert.equal(result.manifest.project.tree.revision, 1);
		assert.equal(result.drawings[0].flags.foundryshop.layerId, unassignedId);
		assert.equal(payload.originals[0].flags.foundryshop.layerId, unassignedId);
		assert.deepEqual(payload.context.layers, result.manifest.project.tree);
		assert.equal(effectiveLayerGate(result.manifest.project.tree, unassignedId, node => node.playerAllowed), false);
		const reveal = result.manifest.project.tree.presets.find(preset => preset.id === presetId);
		assert.equal(reveal.entries.find(entry => entry.nodeId === rootId).playerAllowed, true);
		assert.equal(reveal.entries.find(entry => entry.nodeId === unassignedId).playerAllowed, true);
		assert.equal(result.stagedDrawings[0].hidden, true);
		assert.equal(result.stagedDrawings[0].flags.foundryshop.importStaging, result.provenance.importId);
		assert.equal(result.drawings[0].flags.foundryshop.importStaging, undefined);
		assert.equal(nativeChecks.some(check => check.source._id === payload.originals[0]._id), true);
		assert.deepEqual(result.review.requiredApprovals, ['project-import']);
		assert.equal(canonicalJson(scene.toObject()), before);
		await validateRecoveryProjectManifest(result.manifest, result.recoveryFiles);
	});
});

test('guarded import preparation requests distinct native Tile/background visibility approvals and hidden Tile staging', async () => {
	for (const type of ['Tile', 'LevelBackground']) {
		const h = await history(); await h.apply('one', type);
		const input = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits);
		await withImportDestination(async ({ scene, options }) => {
			const before = canonicalJson(scene.toObject()), result = await prepareRecoveryImport(scene, input, options());
			assert.deepEqual(result.review.requiredApprovals, ['project-import',
				type === 'Tile' ? 'native-tile-visibility' : 'level-background-replacement-and-visibility']);
			if (type === 'Tile') {
				assert.equal(result.stagedTiles[0].hidden, true);
				assert.equal(result.manifest.tiles[0].hidden, false);
				assert.equal(result.review.nativeTiles[0].hidden, false);
				assert.deepEqual(result.manifest.source.level, destination().level);
			} else {
				assert.notEqual(result.manifest.source.level.background.src, destination().level.background.src);
				assert.deepEqual(result.destinationBaseline.level, destination().level);
			}
			assert.equal(canonicalJson(scene.toObject()), before);
		});
	}
});

test('guarded import preparation refuses nonempty projects, retained metadata without approval and existing journals', async () => {
	const h = await history(); await h.apply('one');
	const input = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits);
	await withImportDestination(async ({ scene, flags, options }) => {
		for (const collection of [scene.drawings, scene.tiles]) {
			collection.set('occupied', {}); await assert.rejects(prepareRecoveryImport(scene, input, options()), /empty Drawing\/Tile/);
			collection.clear();
		}
		for (const key of ['projectImportJournal', 'optimizationJournal', 'recovery']) {
			flags[key] = {}; await assert.rejects(prepareRecoveryImport(scene, input, options()), /Resolve destination/); delete flags[key];
		}
		flags.layers = { version: 1, revision: 4, nodes: [
			{ id: 'oldLayer', name: 'Old', kind: 'layer', parentId: null, playerAllowed: true, locked: false, defaults: {} },
		], presets: [] };
		await assert.rejects(prepareRecoveryImport(scene, input, options()), /replacement approval/);
		const result = await prepareRecoveryImport(scene, input, { ...options(), replaceEmptyMetadata: true });
		assert.equal(result.manifest.project.tree.revision, 5);
		assert.equal(result.before.nodes[0].id, 'oldLayer');
		assert.equal(result.manifest.project.tree.nodes.some(node => node.id === 'oldLayer'), false);
		flags.layers = { version: 1, revision: Number.MAX_SAFE_INTEGER, nodes: [], presets: [] };
		await assert.rejects(prepareRecoveryImport(scene, input, options()), /revision is exhausted/);
	});
});

test('guarded import preparation rejects archived schema normalization, missing historical fonts/modules and altered staging', async () => {
	const h = await history(); h.drawings.get('stroke001').text = 'Archived text';
	h.drawings.get('stroke001').flags = { requiredModule: { example: true } };
	await h.apply('one', 'Tile');
	const input = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits);
	await withImportDestination(async ({ scene, model, options }) => {
		await assert.rejects(prepareRecoveryImport(scene, input, options()), /metadata modules/);
		game.modules.set('requiredModule', { active: true });
		foundry.applications.settings.menus.FontConfig.getAvailableFonts = () => [];
		await assert.rejects(prepareRecoveryImport(scene, input, options()), /Install fonts/);
		foundry.applications.settings.menus.FontConfig.getAvailableFonts = () => ['Signika'];
		model.normalize = (source, type) => { if (type === 'Drawing') source.x++; };
		await assert.rejects(prepareRecoveryImport(scene, input, options()), /schema normalization/);
		model.normalize = source => { if (source.flags.foundryshop?.importStaging) delete source.flags.foundryshop.importStaging; };
		await assert.rejects(prepareRecoveryImport(scene, input, options()), /schema normalization/);
		model.normalize = null;
		const result = await prepareRecoveryImport(scene, input, options());
		assert.deepEqual(result.review.modules, ['requiredModule']);
		assert.deepEqual(result.review.fonts, ['Signika']);
	});
});

test('guarded import preparation rejects stale/aborted or non-designated GM context without writes', async () => {
	const h = await history(); await h.apply('one');
	const input = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits);
	await withImportDestination(async ({ scene, options, access, model }) => {
		const before = canonicalJson(scene.toObject());
		game.users.activeGM.id = 'anotherGM';
		await assert.rejects(prepareRecoveryImport(scene, input, options()), /authority/);
		game.users.activeGM.id = game.user.id;
		const controller = new AbortController(); controller.abort();
		await assert.rejects(prepareRecoveryImport(scene, input, { ...options(), signal: controller.signal }), /cancelled/);
		access.current = false; await assert.rejects(prepareRecoveryImport(scene, input, options()), /context changed/); access.current = true;
		model.normalize = () => { access.current = false; };
		await assert.rejects(prepareRecoveryImport(scene, input, options()), /context changed/);
		access.current = true; model.normalize = null;
		const candidate = options(); candidate.createId = () => { scene.width++; return 'changedID'; };
		await assert.rejects(prepareRecoveryImport(scene, input, candidate), /allocator|context changed/);
		scene.width = destination().scene.width;
		assert.equal(canonicalJson(scene.toObject()), before);
	});

});

test('hidden import preparation rebuilds restored/reapplied histories against one destination presentation context', async () => {
	const h = await history(); await h.apply('one'); await h.apply('two', 'Tile', 'one');
	h.restore('two'); h.restore('one'); await h.apply('three');
	const input = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits);
	await withImportDestination(async ({ scene, options }) => {
		const result = await prepareRecoveryImport(scene, input, options()), archives = await archivesIn(result);
		assert.equal(archives.every(archive => canonicalJson(archive.payload.context.layers) === canonicalJson(result.manifest.project.tree)), true);
		assert.equal(archives.every(archive => archive.payload.originals.every(source =>
			source.flags.foundryshop.layerId === result.presentation.unassignedId)), true);
		assert.equal(result.manifest.journal.entries.length, 5);
		await validateRecoveryProjectManifest(result.manifest, result.recoveryFiles);
	});

});

test('guarded import preparation refuses live sort repair and historical mixed render order without rewriting artwork', async () => {
	const h = await history(); await h.apply('one');
	h.drawings.set('later', { ...drawing('later'), sort: 1024 });
	const tied = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits);
	await withImportDestination(async ({ scene, options }) => {
		await assert.rejects(prepareRecoveryImport(scene, tied, options()), /Drawing order needs repair/);
	});

	const mixed = await history(); mixed.drawings.get('stroke001').elevation = 20;
	await mixed.apply('one');
	mixed.drawings.set('later', { ...drawing('later'), sort: 2048 });
	const bytes = await encodeRecoveryProjectBundle(mixed.manifest(), mixed.files, [], limits);
	await withImportDestination(async ({ scene, options }) => {
		await assert.rejects(prepareRecoveryImport(scene, bytes, options()), /MixedRenderOrder/);
	});
});

	test('exact-plan approval persists version4 intent before uploads and survives JSON roundtrip', async () => {
		const h = await history(); await h.apply('one', 'Tile');
		const bytes = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits);
		await withImportDestination(async ({ scene, flags, options }) => {
			const plan = await prepareRecoveryImport(scene, bytes, options()), writes = [];
			scene.update = async (patch, updateOptions) => {
				writes.push({ patch: structuredClone(patch), options: updateOptions });
				flags.projectImportJournal = structuredClone(patch['flags.foundryshop.projectImportJournal']);
			};
			const review = await reviewRecoveryImport(scene, plan, { isCurrent: () => true, maxBytes: limits.maxBytes });
			assert.equal(writes.length, 0);
			await assert.rejects(beginRecoveryImportIntent(scene, { token: plan.provenance.importId }), /fresh exact-plan/);
			assert.throws(() => review.approve({ planDigest: review.review.planDigest, decisions: ['project-import'] }), /every required/);
			const approval = review.approve({ planDigest: review.review.planDigest, decisions: review.review.requiredApprovals });
			const intent = await beginRecoveryImportIntent(scene, approval);
			assert.equal(writes.length, 1);
			assert.equal(intent.phase, 'intent'); assert.equal(intent.version, 4);
			assert.equal(intent.bundle.path.endsWith('.json'), true);
			assert.deepEqual(intent.decisions, ['project-import', 'native-tile-visibility']);
			assert.deepEqual(validateRecoveryImportIntent(JSON.parse(JSON.stringify(intent)), scene.id), intent);
			assert.deepEqual(intent.optimization, plan.manifest.journal);
			assert.equal(intent.tiles[0].id, plan.manifest.tiles[0]._id);
			assert.equal(intent.tiles[0].afterDigest, await fileFingerprint(new TextEncoder().encode(canonicalJson(plan.manifest.tiles[0]))));
			assert.equal(intent.uploads.length, plan.uploads.length);
			assert.equal(scene.drawings.size, 0); assert.equal(scene.tiles.size, 0);
			await assert.rejects(discardInterruptedProjectImport(scene), /Invalid import journal/);
			assert.deepEqual(flags.projectImportJournal, intent);
			await assert.rejects(beginRecoveryImportIntent(scene, approval), /fresh exact-plan/);
		});
	});

	test('intent reviews refuse forged/edited plans, evidence-path collision, upload budgets and stale dependencies', async () => {
		const h = await history(); h.drawings.get('stroke001').text = 'Archived label'; await h.apply('one');
		const bytes = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits);
		await withImportDestination(async ({ scene, options, access }) => {
			const plan = await prepareRecoveryImport(scene, bytes, options()), opts = { isCurrent: () => access.current, maxBytes: limits.maxBytes };
			await assert.rejects(reviewRecoveryImport(scene, structuredClone(plan), opts), /fabricated/);
			const original = plan.bytes[0]; plan.bytes[0] ^= 1;
			await assert.rejects(reviewRecoveryImport(scene, plan, opts), /changed/); plan.bytes[0] = original;
			await assert.rejects(reviewRecoveryImport(scene, plan, { ...opts, maxBytes: 1 }), /byte budget|upload budget/);
			const review = await reviewRecoveryImport(scene, plan, opts);
			assert.throws(() => review.approve({ planDigest: 'f'.repeat(64), decisions: review.review.requiredApprovals }), /exact plan/);
			foundry.applications.settings.menus.FontConfig.getAvailableFonts = () => [];
			assert.throws(() => review.approve({ planDigest: review.review.planDigest, decisions: review.review.requiredApprovals }), /fonts\/modules/);
			foundry.applications.settings.menus.FontConfig.getAvailableFonts = () => ['Signika'];
			access.current = false;
			assert.throws(() => review.approve({ planDigest: review.review.planDigest, decisions: review.review.requiredApprovals }), /context/);
			access.current = true;
			const colliding = options();
			colliding.reservedPaths = [`${colliding.root}/import-fresh1.json`];
			const collisionPlan = await prepareRecoveryImport(scene, bytes, colliding);
			await assert.rejects(reviewRecoveryImport(scene, collisionPlan, opts), /evidence path is occupied/);
		});
	});

	test('background and retained metadata decisions bind to durable intent without changing native Level', async () => {
		const h = await history(); await h.apply('one', 'LevelBackground');
		const bytes = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits);
		await withImportDestination(async ({ scene, options, flags, target }) => {
			flags.layers = { version: 1, revision: 2, nodes: [
				{ id: 'old', name: 'Old', kind: 'layer', parentId: null, locked: false, playerAllowed: true, defaults: {} },
			], presets: [] };
			const plan = await prepareRecoveryImport(scene, bytes, { ...options(), replaceEmptyMetadata: true });
			const review = await reviewRecoveryImport(scene, plan, { isCurrent: () => true, maxBytes: limits.maxBytes });
			assert.deepEqual(review.review.requiredApprovals, ['project-import', 'level-background-replacement-and-visibility', 'empty-metadata-replacement']);
			scene.update = async patch => { flags.projectImportJournal = patch['flags.foundryshop.projectImportJournal']; };
			const intent = await beginRecoveryImportIntent(scene,
				review.approve({ planDigest: review.review.planDigest, decisions: review.review.requiredApprovals }));
			assert.deepEqual(intent.before.level, target.level);
			assert.notEqual(intent.after.level.background.src, target.level.background.src);
			assert.equal(scene.getFlag('foundryshop', 'layers').revision, 2);
			assert.deepEqual(scene.levels.get(target.level._id).toObject(), target.level);
			const corrupt = structuredClone(intent); corrupt.decisions = ['project-import'];
			assert.throws(() => validateRecoveryImportIntent(corrupt, scene.id), /required separate approval/);
		});
	});

	test('intent persistence failures retain ambiguous evidence and consume the approval without success-shaped fallback', async () => {
		const h = await history(); await h.apply('one');
		const bytes = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits);
		for (const mode of ['before-write', 'after-write', 'readback', 'unrelated-change', 'authority-loss', 'cancelled', 'stale']) {
			await withImportDestination(async ({ scene, options, flags, access }) => {
				const plan = await prepareRecoveryImport(scene, bytes, options());
				const controller = new AbortController();
				const reviewed = await reviewRecoveryImport(scene, plan, {
					isCurrent: () => access.current, signal: controller.signal, maxBytes: limits.maxBytes,
				});
				const capability = reviewed.approve({ planDigest: reviewed.review.planDigest, decisions: reviewed.review.requiredApprovals });
				let writes = 0;
				scene.update = async patch => {
					writes++;
					if (mode === 'before-write') throw new Error('transport failure');
					flags.projectImportJournal = structuredClone(patch['flags.foundryshop.projectImportJournal']);
					if (mode === 'after-write') throw new Error('lost acknowledgement');
					if (mode === 'readback') flags.projectImportJournal.planDigest = 'f'.repeat(64);
					if (mode === 'unrelated-change') scene.width++;
					if (mode === 'authority-loss') game.user.isGM = false;
					if (mode === 'cancelled') controller.abort();
					if (mode === 'stale') access.current = false;
				};
				await assert.rejects(beginRecoveryImportIntent(scene, capability), error =>
					error instanceof UnverifiedRecoveryImportIntentError && error.token === plan.provenance.importId);
				assert.equal(writes, 1);
				assert.equal(scene.drawings.size, 0); assert.equal(scene.tiles.size, 0);
				assert.equal(flags.projectImportJournal !== undefined, mode !== 'before-write');
				game.user.isGM = true;
				await assert.rejects(beginRecoveryImportIntent(scene, capability), /fresh exact-plan/);
				assert.equal(writes, 1);
			});
		}
	});

	test('intent validator rejects malformed history references, duplicate paths, descriptors and unsafe decisions', async () => {
		const h = await history(); await h.apply('one', 'Tile');
		const bytes = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits);
		await withImportDestination(async ({ scene, options, flags }) => {
			const plan = await prepareRecoveryImport(scene, bytes, options());
			const review = await reviewRecoveryImport(scene, plan, { isCurrent: () => true, maxBytes: limits.maxBytes });
			scene.update = async patch => { flags.projectImportJournal = patch['flags.foundryshop.projectImportJournal']; };
			const intent = await beginRecoveryImportIntent(scene, review.approve({ planDigest: review.review.planDigest, decisions: review.review.requiredApprovals }));
			for (const change of [
				input => input.version = 3,
				input => input.phase = 'unknown-phase',
				input => input.uploads.push(input.uploads[0]),
				input => input.bundle = input.uploads[0],
				input => input.tiles[0].stagedDigest = 'invalid',
				input => input.optimization.entries[0].asset.path = `${input.bundle.root}/missing.png`,
				input => input.decisions.push('unknown-decision'),
				input => input.decisions = ['project-import'],
				input => input.after.layers.revision = -1,
			]) {
				const corrupt = structuredClone(intent); change(corrupt);
				assert.throws(() => validateRecoveryImportIntent(corrupt, scene.id));
			}
			assert.throws(() => validateRecoveryImportIntent(intent, 'anotherScene'), /durable intent/);
			});
	});

async function withAssetImport(run, type = 'Tile', configureHistory = async () => {}) {
	const h = await history(); h.drawings.get('stroke001').text = 'Archived label';
	if (type === 'LevelBackground') h.level.background.src = 'maps/original.png';
	await h.apply('one', type);
	await configureHistory(h);
	const manifest = h.manifest();
	if (type === 'LevelBackground') {
		const backup = h.archives.get('one').payload.originalBackground;
		manifest.resources.images.push({ source: backup.src, file: backup.file });
		manifest.resources.images.sort((a, b) => a.source < b.source ? -1 : 1);
	}
	const input = await encodeRecoveryProjectBundle(manifest, h.files, [], limits);
	await withImportDestination(async context => {
			const { scene, flags, options } = context;
			const old = { fetch: globalThis.fetch, location: globalThis.location };
			const files = new Map(), uploads = [], writes = [], faults = {};
			const picker = {
				browse: async () => {
					await faults.browse?.();
					return { files: [...files.keys()] };
				},
				upload: async (source, root, file) => {
					const path = `${root}/${file.name}`;
					uploads.push(path);
					files.set(path, new Uint8Array(await file.arrayBuffer()));
					await faults.upload?.(path);
					return { path };
				},
			};
			foundry.applications.apps = { FilePicker: { implementation: picker } };
			globalThis.location = { href: 'http://localhost:30000/game' };
			globalThis.fetch = async url => {
				const path = decodeURIComponent(url.pathname).slice(1);
				await faults.read?.(path);
				return new Response(files.get(path), { status: files.has(path) ? 200 : 404 });
			};
			scene.update = async patch => {
				scene.touch();
				const value = structuredClone(patch['flags.foundryshop.projectImportJournal']);
				writes.push(value.phase);
				flags.projectImportJournal = value;
				await faults.write?.(value);
			};
			try {
				const plan = await prepareRecoveryImport(scene, input, options());
				const review = await reviewRecoveryImport(scene, plan, { isCurrent: () => true, maxBytes: limits.maxBytes });
				const capability = review.approve({ planDigest: review.review.planDigest, decisions: review.review.requiredApprovals });
				const intent = await beginRecoveryImportIntent(scene, capability);
				await run({ ...context, plan, intent, capability, files, uploads, writes, faults, picker });
			} finally { Object.assign(globalThis, old); }
	});
}

test('asset stage uploads validated JSON evidence first, verifies every immutable file and advances only the journal', async () => {
	await withAssetImport(async ({ scene, capability, intent, plan, uploads, writes, files, flags }) => {
			const result = await uploadRecoveryImportAssets(scene, capability, { isCurrent: () => true });
			assert.deepEqual(writes, ['intent', 'assets-verified']);
			assert.equal(uploads[0], intent.bundle.path);
			assert.deepEqual(uploads.slice(1), plan.uploads.map(file => file.reference.path));
			assert.equal(files.size, intent.uploads.length + 1);
			assert.deepEqual(await decodeRecoveryImportEvidence(files.get(intent.bundle.path), limits),
				await decodeRecoveryProjectBundle(plan.bytes, limits));
			assert.equal(result.phase, 'assets-verified');
			assert.deepEqual(validateRecoveryImportIntent(JSON.parse(JSON.stringify(result)), scene.id), result);
			assert.deepEqual(flags.projectImportJournal, result);
			assert.equal(scene.drawings.size, 0); assert.equal(scene.tiles.size, 0);
			assert.deepEqual(scene.levels.get(intent.levelId).toObject(), intent.before.level);
			assert.equal(scene.getFlag('foundryshop', 'optimizationJournal'), undefined);
			await assert.rejects(uploadRecoveryImportAssets(scene, capability, { isCurrent: () => true }), /unused asset stage/);
			assert.equal(uploads.length, intent.uploads.length + 1);
	});
});

test('asset preflight refuses any occupied path before evidence upload, including encoded case variants', async () => {
	await withAssetImport(async ({ scene, capability, intent, files, uploads, writes }) => {
			const path = intent.uploads.at(-1).path;
			files.set(encodeURI(path.toUpperCase()), new Uint8Array([1]));
			await assert.rejects(uploadRecoveryImportAssets(scene, capability, { isCurrent: () => true }), /occupied/);
			assert.deepEqual(uploads, []); assert.deepEqual(writes, ['intent']);
			assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'intent');
			assert.deepEqual([...files.values()], [new Uint8Array([1])]);
	});
});

test('asset storage refuses late collisions and retains prior evidence without replacing occupied bytes', async () => {
	await withAssetImport(async ({ scene, capability, intent, files, uploads, faults }) => {
			const occupied = intent.uploads[0].path, sentinel = new Uint8Array([8, 9]);
			faults.upload = path => { if (path === intent.bundle.path) files.set(occupied, sentinel); };
			await assert.rejects(uploadRecoveryImportAssets(scene, capability, { isCurrent: () => true }), /occupied/);
			assert.deepEqual(uploads, [intent.bundle.path]);
			assert.deepEqual(files.get(occupied), sentinel);
			assert.equal(files.has(intent.bundle.path), true);
			assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'intent');
	});
});

test('ambiguous asset upload and corrupted readback preserve intent/files without native writes or retries', async () => {
	for (const mode of ['upload-rejection', 'corrupt-immediate', 'corrupt-final']) {
			await withAssetImport(async ({ scene, capability, intent, files, uploads, writes, faults }) => {
				faults.upload = path => {
					if (mode === 'upload-rejection' && path === intent.uploads[0].path) throw new Error('lost upload acknowledgement');
					if (mode === 'corrupt-immediate' && path === intent.uploads[0].path) files.get(path)[0] ^= 1;
					if (mode === 'corrupt-final' && path === intent.uploads.at(-1).path) files.get(intent.bundle.path)[0] ^= 1;
				};
				await assert.rejects(uploadRecoveryImportAssets(scene, capability, { isCurrent: () => true }), error =>
					error instanceof InterruptedRecoveryImportAssetsError && error.token === intent.token);
				assert.deepEqual(writes, ['intent']);
				assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'intent');
				assert.equal(files.has(intent.bundle.path), true);
				assert.equal(scene.drawings.size, 0); assert.equal(scene.tiles.size, 0);
				const attempted = uploads.length;
				await assert.rejects(uploadRecoveryImportAssets(scene, capability, { isCurrent: () => true }), /unused asset stage/);
				assert.equal(uploads.length, attempted);
			});
	}
});

test('asset stage refuses authority, cancellation, journal/source changes and lost fonts during reads', async () => {
	for (const mode of ['authority', 'abort', 'journal', 'source', 'stale', 'fonts']) {
			await withAssetImport(async ({ scene, capability, intent, faults, uploads, files, flags }) => {
				const controller = new AbortController(); let current = true;
				faults.upload = path => {
					if (path !== intent.bundle.path) return;
					if (mode === 'authority') game.user.can = () => false;
					if (mode === 'abort') controller.abort();
					if (mode === 'journal') flags.projectImportJournal.ownerId = 'otherGM';
					if (mode === 'source') scene.width++;
					if (mode === 'stale') current = false;
					if (mode === 'fonts') foundry.applications.settings.menus.FontConfig.getAvailableFonts = () => [];
				};
				await assert.rejects(uploadRecoveryImportAssets(scene, capability, {
					isCurrent: () => current, signal: controller.signal,
				}), /assets stopped/);
				assert.deepEqual(uploads, [intent.bundle.path]);
				assert.equal(files.has(intent.bundle.path), true);
				assert.equal(scene.drawings.size, 0); assert.equal(scene.tiles.size, 0);
			});
	}
});

test('uncertain assets-verified phase writes retain every file and never authorize native execution', async () => {
	for (const mode of ['acknowledgement', 'readback', 'source-change']) {
			await withAssetImport(async ({ scene, capability, intent, uploads, faults, files, flags }) => {
				faults.write = value => {
					if (value.phase !== 'assets-verified') return;
					if (mode === 'acknowledgement') throw new Error('lost journal acknowledgement');
					if (mode === 'readback') flags.projectImportJournal.phase = 'intent';
					if (mode === 'source-change') scene.width++;
				};
				await assert.rejects(uploadRecoveryImportAssets(scene, capability, { isCurrent: () => true }), error =>
					error instanceof InterruptedRecoveryImportAssetsError
					&& error.cause instanceof UnverifiedRecoveryImportIntentError
					&& error.cause.phase === 'assets-verified');
				assert.equal(uploads.length, intent.uploads.length + 1);
				assert.equal(files.size, intent.uploads.length + 1);
				assert.equal(scene.drawings.size, 0); assert.equal(scene.tiles.size, 0);
				assert.equal(flags.projectImportJournal !== undefined, true);
			});
	}
});

const inspectionOptions = () => ({ ...limits, isCurrent: () => true });

test('versioned JSON import evidence preserves exact portable ZIP and validates bounded multi-chunk bytes', async () => {
	const h = await history(); h.drawings.get('stroke001').text = 'Archived text '.repeat(2000);
	await h.apply('one');
	const zip = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits);
	assert.equal(zip.length > 16384, true);
	const json = await encodeRecoveryImportEvidence(zip, limits), record = JSON.parse(new TextDecoder().decode(json));
	assert.equal(record.format, RECOVERY_IMPORT_EVIDENCE_FORMAT);
	assert.equal(record.bundle.encoding, 'base64');
	assert.equal(record.bundle.bytes, zip.length);
	assert.equal(record.bundle.fingerprint, await fileFingerprint(zip));
	assert.deepEqual(new Uint8Array(Buffer.from(record.bundle.data, 'base64')), zip);
	assert.deepEqual(await decodeRecoveryImportEvidence(json, limits), await decodeRecoveryProjectBundle(zip, limits));
	await encodeRecoveryImportEvidence(zip, { ...limits, maxBytes: json.length });
	await decodeRecoveryImportEvidence(json, { ...limits, maxBytes: json.length });
	await assert.rejects(encodeRecoveryImportEvidence(zip, { ...limits, maxBytes: json.length - 1 }), /byte budget/);
	await assert.rejects(decodeRecoveryImportEvidence(json, { ...limits, maxBytes: json.length - 1 }), /byte budget/);
	await assert.rejects(decodeRecoveryImportEvidence(zip, limits));
});

test('JSON import evidence refuses unsupported schemas, malformed base64, sizes, hashes and inner ZIP corruption', async () => {
	const h = await history(); await h.apply('one');
	const zip = await encodeRecoveryProjectBundle(h.manifest(), h.files, [], limits),
		bytes = await encodeRecoveryImportEvidence(zip, limits), original = JSON.parse(new TextDecoder().decode(bytes));
	for (const change of [
		record => record.version++,
		record => record.format = 'unknown',
		record => record.extra = true,
		record => record.bundle.extra = true,
		record => record.bundle.encoding = 'hex',
		record => record.bundle.bytes = limits.maxBytes + 1,
		record => record.bundle.bytes = 0,
		record => record.bundle.bytes++,
		record => record.bundle.fingerprint = 'f'.repeat(64),
		record => record.bundle.data = `!${record.bundle.data.slice(1)}`,
		record => record.bundle.data = record.bundle.data.slice(1),
	]) {
		const record = structuredClone(original); change(record);
		await assert.rejects(decodeRecoveryImportEvidence(new TextEncoder().encode(JSON.stringify(record)), limits));
	}
	const broken = zip.slice(); broken[0] ^= 1;
	const record = structuredClone(original);
	record.bundle.data = Buffer.from(broken).toString('base64'); record.bundle.fingerprint = await fileFingerprint(broken);
	await assert.rejects(decodeRecoveryImportEvidence(new TextEncoder().encode(JSON.stringify(record)), limits));
	await assert.rejects(encodeRecoveryImportEvidence(broken, limits));
	await assert.rejects(decodeRecoveryImportEvidence(bytes, { ...limits, maxEntries: 2 }), /entry count/);
});

test('durable JSON evidence uses supported content type and intent refuses ZIP paths', async () => {
	await withAssetImport(async ({ scene, capability, intent, files, picker }) => {
		const upload = picker.upload, types = [];
		picker.upload = async (source, root, file) => { types.push({ name: file.name, type: file.type }); return upload(source, root, file); };
		await uploadRecoveryImportAssets(scene, capability, { isCurrent: () => true });
		assert.equal(types[0].name, intent.bundle.path.split('/').at(-1));
		assert.equal(types[0].type, 'application/json');
		assert.equal(types.some(file => file.name.endsWith('.zip')), false);
		const record = JSON.parse(new TextDecoder().decode(files.get(intent.bundle.path)));
		assert.equal(record.format, RECOVERY_IMPORT_EVIDENCE_FORMAT);
		const forged = structuredClone(intent); forged.bundle.path = forged.bundle.path.replace(/\.json$/, '.zip');
		assert.throws(() => validateRecoveryImportIntent(forged, scene.id), /JSON envelope/);
	});
});

test('post-write Scene comparison excludes only host modification bookkeeping without mutating snapshots', () => {
	const before = { _stats: { createdTime: 100, modifiedTime: 100, lastModifiedBy: 'gm',
		coreVersion: '14.365', systemId: 'D35E', compendiumSource: null }, width: 640, flags: { retained: true } };
	const after = structuredClone(before); after._stats.modifiedTime = 200; after._stats.lastModifiedBy = 'another';
	assert.deepEqual(recoveryImportSceneState(after), recoveryImportSceneState(before));
	assert.equal(after._stats.modifiedTime, 200);
	assert.equal(before._stats.modifiedTime, 100);
	for (const key of ['createdTime', 'coreVersion', 'systemId', 'compendiumSource']) {
		const edited = structuredClone(after); edited._stats[key] = 'changed';
		assert.notDeepEqual(recoveryImportSceneState(edited), recoveryImportSceneState(before));
	}
	after.width++;
	assert.notDeepEqual(recoveryImportSceneState(after), recoveryImportSceneState(before));
	assert.deepEqual(recoveryImportSceneState({ width: 640 }), { width: 640 });
});

test('fresh evidence inspection still rejects stable Scene metadata edits despite host modification timestamp changes', async () => {
	for (const key of ['createdTime', 'coreVersion']) {
		await withAssetImport(async ({ scene, capability, faults }) => {
			faults.write = value => {
				if (value.phase === 'assets-verified') scene._stats[key] = 'changed';
			};
			await assert.rejects(uploadRecoveryImportAssets(scene, capability, { isCurrent: () => true }), /Destination changed/);
			await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()), /baseline/);
		});
	}
});

test('review approval still binds the full snapshot including modification bookkeeping before any write', async () => {
	await withFinalization(async ({ scene, finalApproval, finalReview, intent, releaseWrites }) => {
		scene.touch();
		assert.throws(() => finalReview.approve({ token: intent.token, planDigest: finalReview.review.planDigest,
			decisions: finalReview.review.requiredDecisions }), /review context changed/);
		await assert.rejects(finalizeRecoveryImport(scene, finalApproval), /review context changed/);
		assert.deepEqual(releaseWrites, []);
	});
});

async function withNativeStaging(run, type = 'Tile', configureHistory) {
	await withAssetImport(async context => {
		const { scene, flags, capability, writes } = context;
		await uploadRecoveryImportAssets(scene, capability, { isCurrent: () => true });
		const faults = {}, nativeWrites = [], optionsUsed = [];
		scene.update = async patch => {
			scene.touch();
			if (Object.hasOwn(patch, 'flags.foundryshop.layers')) {
				flags.layers = structuredClone(patch['flags.foundryshop.layers']); nativeWrites.push('tree');
				await faults.tree?.();
			} else {
				const value = structuredClone(patch['flags.foundryshop.projectImportJournal']);
				flags.projectImportJournal = value; writes.push(value.phase);
				await faults.phase?.(value);
			}
		};
		scene.createEmbeddedDocuments = async (documentType, data, options) => {
			scene.touch();
			nativeWrites.push(documentType); optionsUsed.push(options);
			const collection = documentType === 'Drawing' ? scene.drawings : scene.tiles;
			for (const source of data) {
				const stored = structuredClone(source);
				const doc = { id: stored._id, parent: scene, toObject: () => structuredClone(stored),
					getFlag: (namespace, key) => stored.flags[namespace]?.[key] };
				assert.equal(isAuthorizedRecoveryImportCreate(doc, options), true);
				assert.equal(isAuthorizedRecoveryImportCreate(doc, structuredClone(options)), true);
				assert.equal(isAuthorizedRecoveryImportCreate(doc, {}), false);
				assert.equal(isAuthorizedRecoveryImportCreate({ ...doc, toObject: () => ({ ...stored, x: 99 }) }, options), false);
				collection.set(stored._id, doc);
				await faults.create?.(documentType, stored);
			}
		};
		const review = await reviewRecoveryImportStaging(scene, inspectionOptions());
		const approval = review.approve({ token: review.review.token, planDigest: review.review.planDigest, stageHidden: true });
		await run({ ...context, review, approval, nativeWrites, stagingFaults: faults, optionsUsed });
	}, type, configureHistory);
}

async function withCompensation(run, type = 'Tile', stage = true) {
	await withNativeStaging(async context => {
		const { scene, approval } = context, faults = {}, deletes = [], deleteOptions = [];
		if (stage) await stageRecoveryImport(scene, approval);
		scene.deleteEmbeddedDocuments = async (documentType, ids, options) => {
			scene.touch();
			const collection = documentType === 'Drawing' ? scene.drawings : scene.tiles;
			deletes.push({ type: documentType, ids }); deleteOptions.push(options);
			for (const id of ids) {
				const doc = collection.get(id);
				assert.equal(isAuthorizedRecoveryImportDelete(doc, options), true);
				assert.equal(isAuthorizedRecoveryImportDelete(doc, structuredClone(options)), true);
				assert.equal(isAuthorizedRecoveryImportDelete(doc, {}), false);
				assert.equal(isAuthorizedRecoveryImportDelete({ ...doc, toObject: () => ({ ...doc.toObject(), x: 999 }) }, options), false);
				collection.delete(id);
				await faults.delete?.(documentType, id);
			}
		};
		const review = await reviewRecoveryImportCompensation(scene, inspectionOptions());
		const compensation = review.approve({ token: review.review.token, planDigest: review.review.planDigest,
			deleteHiddenStaging: true, retainFiles: true });
		await run({ ...context, compensation, compensationReview: review, compensationFaults: faults, deletes, deleteOptions });
	}, type);
}

test('reviewed compensation removes only hidden owned Drawing/Tile staging and retains exact files, Level and receipt', async () => {
	for (const type of ['Drawing', 'Tile', 'LevelBackground']) {
		await withCompensation(async ({ scene, compensation, intent, files, writes, deletes, deleteOptions }) => {
			const beforeFiles = structuredClone(files), docs = [...scene.drawings.values(), ...scene.tiles.values()];
			const result = await compensateRecoveryImport(scene, compensation);
			assert.equal(result.phase, 'compensated');
			assert.deepEqual(writes.slice(-2), ['compensating', 'compensated']);
			assert.equal(scene.drawings.size, 0); assert.equal(scene.tiles.size, 0);
			assert.deepEqual(scene.getFlag('foundryshop', 'layers'), intent.before.layers);
			assert.deepEqual(scene.levels.get(intent.levelId).toObject(), intent.before.level);
			assert.deepEqual(files, beforeFiles);
			assert.equal(deletes.length, type === 'LevelBackground' ? 0 : 1);
			for (const doc of docs) assert.equal(isAuthorizedRecoveryImportDelete(doc, deleteOptions[0]), false);
			const inspected = await inspectRecoveryImport(scene, inspectionOptions());
			assert.equal(inspected.review.state, 'compensated-retained-evidence');
			await assert.rejects(reviewRecoveryImportCompensation(scene, inspectionOptions()), /unfinished import/);
			await assert.rejects(compensateRecoveryImport(scene, compensation), /Fresh exact compensation/);
		}, type);
	}
});

test('compensated receipt clearing preserves exact native baseline and files across output types', async () => {
	for (const type of ['Drawing', 'Tile', 'LevelBackground']) {
		await withCompensation(async ({ scene, compensation, files, flags }) => {
			const receipt = await compensateRecoveryImport(scene, compensation),
				beforeFiles = structuredClone(files), baseline = recoveryImportSceneState(scene.toObject());
			delete baseline.flags.foundryshop.projectImportJournal;
			const review = await reviewCompensatedRecoveryImportClearing(scene, inspectionOptions());
			assert.deepEqual(review.review.retainedPaths, [receipt.bundle.path, ...receipt.uploads.map(file => file.path)]);
			assert.throws(() => review.approve({ token: receipt.token, planDigest: receipt.planDigest,
				clearCompensatedReceipt: true, retainFiles: false }), /Explicit exact receipt/);
			const capability = review.approve({ token: receipt.token, planDigest: receipt.planDigest,
				clearCompensatedReceipt: true, retainFiles: true });
			await assert.rejects(clearCompensatedRecoveryImport(scene, { token: receipt.token }), /Fresh receipt/);
			scene.unsetFlag = async (namespace, key) => {
				assert.equal(namespace, 'foundryshop'); assert.equal(key, 'projectImportJournal');
				scene.touch(); delete flags.projectImportJournal;
			};
			assert.deepEqual(await clearCompensatedRecoveryImport(scene, capability), receipt);
			assert.deepEqual(recoveryImportSceneState(scene.toObject()), baseline);
			assert.deepEqual(files, beforeFiles);
			assert.equal((await inspectClearedCompensatedRecoveryImport(scene, JSON.parse(JSON.stringify(receipt)),
				inspectionOptions())).review.state, 'cleared-compensated-import');
			await assert.rejects(clearCompensatedRecoveryImport(scene, capability), /Fresh receipt/);
			await assert.rejects(inspectCompletedRecoveryImport(scene, receipt, inspectionOptions()), /complete receipt/);
		}, type);
	}
});

test('receipt clearing refuses non-compensated state, stale approval, authority loss and corrupt evidence', async () => {
	for (const mode of ['context', 'authority', 'cancelled', 'evidence']) {
		await withCompensation(async ({ scene, compensation, files, intent }) => {
			await assert.rejects(reviewCompensatedRecoveryImportClearing(scene, inspectionOptions()), /compensated state/);
			await compensateRecoveryImport(scene, compensation);
			const controller = new AbortController(), options = { ...inspectionOptions(), signal: controller.signal },
				review = await reviewCompensatedRecoveryImportClearing(scene, options),
				capability = review.approve({ token: intent.token, planDigest: intent.planDigest,
					clearCompensatedReceipt: true, retainFiles: true });
			let clears = 0;
			scene.unsetFlag = async () => { clears++; };
			if (mode === 'context') scene.width++;
			if (mode === 'authority') game.users.activeGM = { id: 'foreign' };
			if (mode === 'cancelled') controller.abort();
			if (mode === 'evidence') files.get(intent.bundle.path)[0] ^= 1;
			await assert.rejects(clearCompensatedRecoveryImport(scene, capability), /context changed|fingerprint/);
			assert.equal(clears, 0);
			assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'compensated');
			if (mode === 'evidence') await assert.rejects(clearCompensatedRecoveryImport(scene, capability), /Fresh receipt/);
		});
	}
});

test('uncertain receipt removal provides read-only verification and never retries automatically', async () => {
	for (const mode of ['before', 'after', 'edited']) {
		await withCompensation(async ({ scene, compensation, flags }) => {
			const receipt = await compensateRecoveryImport(scene, compensation),
				review = await reviewCompensatedRecoveryImportClearing(scene, inspectionOptions()),
				capability = review.approve({ token: receipt.token, planDigest: receipt.planDigest,
					clearCompensatedReceipt: true, retainFiles: true });
			let clears = 0, error;
			scene.unsetFlag = async () => {
				clears++; scene.touch();
				if (mode === 'before') throw new Error('unacknowledged before removal');
				delete flags.projectImportJournal;
				if (mode === 'after') throw new Error('unacknowledged after removal');
				scene.width++;
			};
			await assert.rejects(clearCompensatedRecoveryImport(scene, capability), candidate => {
				error = candidate; return candidate instanceof InterruptedRecoveryImportReceiptClearingError;
			});
			assert.deepEqual(error.receipt, receipt);
			if (mode === 'before') {
				assert.equal((await inspectRecoveryImport(scene, inspectionOptions())).review.state, 'compensated-retained-evidence');
				await assert.rejects(inspectClearedCompensatedRecoveryImport(scene, error.receipt, inspectionOptions()), /context changed/);
			} else if (mode === 'after') {
				assert.equal((await inspectClearedCompensatedRecoveryImport(scene, error.receipt,
					inspectionOptions())).review.state, 'cleared-compensated-import');
			} else await assert.rejects(inspectClearedCompensatedRecoveryImport(scene, error.receipt, inspectionOptions()), /baseline/);
			await assert.rejects(clearCompensatedRecoveryImport(scene, capability), /Fresh receipt/);
			assert.equal(clears, 1);
		});
	}
});

test('cleared compensated inspection refuses changed receipts, missing evidence and edited baseline without writes', async () => {
	await withCompensation(async ({ scene, compensation, files, flags }) => {
		const receipt = await compensateRecoveryImport(scene, compensation),
			review = await reviewCompensatedRecoveryImportClearing(scene, inspectionOptions());
		scene.unsetFlag = async () => { scene.touch(); delete flags.projectImportJournal; };
		await clearCompensatedRecoveryImport(scene, review.approve({ token: receipt.token, planDigest: receipt.planDigest,
			clearCompensatedReceipt: true, retainFiles: true }));
		const before = canonicalJson(scene.toObject()), changed = structuredClone(receipt);
		changed.phase = 'complete';
		await assert.rejects(inspectClearedCompensatedRecoveryImport(scene, changed, inspectionOptions()), /compensated receipt/);
		changed.phase = 'compensated'; changed.after.layers.revision++;
		await assert.rejects(inspectClearedCompensatedRecoveryImport(scene, changed, inspectionOptions()), /differs/);
		const bytes = files.get(receipt.bundle.path);
		files.delete(receipt.bundle.path);
		await assert.rejects(inspectClearedCompensatedRecoveryImport(scene, receipt, inspectionOptions()), /missing durable evidence/);
		files.set(receipt.bundle.path, bytes);
		assert.equal(canonicalJson(scene.toObject()), before);
		scene.width++;
		await assert.rejects(inspectClearedCompensatedRecoveryImport(scene, receipt, inspectionOptions()), /baseline/);
	});
});

test('cleared compensated receipt permits only fresh preparation with new identities and retained collision inventory', async () => {
	await withCompensation(async ({ scene, compensation, flags, plan: previousPlan, files, intent }) => {
		const receipt = await compensateRecoveryImport(scene, compensation);
		await assert.rejects(prepareRecoveryImport(scene, previousPlan.bytes, {
			...inspectionOptions(), levelId: intent.levelId, root: intent.bundle.root,
			reservedPaths: [...files.keys()], replaceEmptyMetadata: true,
		}), /Resolve destination/);
		const review = await reviewCompensatedRecoveryImportClearing(scene, inspectionOptions()),
			capability = review.approve({ token: receipt.token, planDigest: receipt.planDigest,
				clearCompensatedReceipt: true, retainFiles: true });
		scene.unsetFlag = async () => { scene.touch(); delete flags.projectImportJournal; };
		await clearCompensatedRecoveryImport(scene, capability);
		let retryId = 0;
		const plan = await prepareRecoveryImport(scene, previousPlan.bytes, {
			...inspectionOptions(), levelId: intent.levelId, root: intent.bundle.root,
			reservedPaths: [...files.keys()], replaceEmptyMetadata: true, createId: () => `retry${++retryId}`,
		});
		assert.notEqual(plan.provenance.importId, receipt.token);
		assert.equal(plan.uploads.every(upload => !files.has(upload.reference.path)), true);
		assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
		await assert.rejects(beginRecoveryImportIntent(scene, capability), /Fresh|approval/);
		const oldFiles = structuredClone(files), next = await reviewRecoveryImport(scene, plan, inspectionOptions()),
			newApproval = next.approve({ planDigest: next.review.planDigest, decisions: next.review.requiredApprovals }),
			newIntent = await beginRecoveryImportIntent(scene, newApproval);
		assert.notEqual(newIntent.token, receipt.token);
		await uploadRecoveryImportAssets(scene, newApproval, inspectionOptions());
		assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'assets-verified');
		for (const [path, bytes] of oldFiles) assert.deepEqual(files.get(path), bytes);
		await assert.rejects(inspectClearedCompensatedRecoveryImport(scene, receipt, inspectionOptions()), /context changed/);
	});
});

test('localized fresh clearing dialog grants only genuine journal-clearing authority and catches source drift', async () => {
	await withCompensation(async ({ scene, compensation, flags }) => {
		const receipt = await compensateRecoveryImport(scene, compensation),
			old = { document: globalThis.document, i18n: game.i18n },
			oldApi = foundry.applications.api;
		class Element {
			constructor() { this.children = []; }
			append(child) { this.children.push(child); }
			setAttribute() {}
		}
		let mode = 'cancel';
		globalThis.document = { createElement: () => new Element() };
		game.i18n = { localize: key => key, format: key => key };
		foundry.applications.api = { DialogV2: { prompt: async options => {
			if (mode === 'cancel') return null;
			if (mode === 'drift') scene.width++;
			return options.ok.callback(null, { form: { elements: { clear: { checked: true }, retain: { checked: true } } } });
		} } };
		try {
			await assert.rejects(promptRecoveryImportApproval(scene, 'clear', inspectionOptions()), RecoveryImportReviewCancelledError);
			assert.equal(flags.projectImportJournal.phase, 'compensated');
			mode = 'drift';
			await assert.rejects(promptRecoveryImportApproval(scene, 'clear', inspectionOptions()), /review context changed/);
			scene.width--; mode = 'approve';
			const capability = await promptRecoveryImportApproval(scene, 'clear', inspectionOptions());
			assert.equal(flags.projectImportJournal.phase, 'compensated');
			scene.unsetFlag = async () => { scene.touch(); delete flags.projectImportJournal; };
			assert.deepEqual(await clearCompensatedRecoveryImport(scene, capability), receipt);
		} finally {
			globalThis.document = old.document; game.i18n = old.i18n; foundry.applications.api = oldApi;
		}
	});
});

test('durable compensated receipt survives journal clearing and fresh read-only file inspection', async () => {
	await withCompensation(async ({ scene, compensation, flags, files }) => {
		const receipt = await compensateRecoveryImport(scene, compensation),
			options = { ...inspectionOptions(), maxReceiptBytes: 128 * 1024 },
			snapshot = canonicalJson(scene.toObject()), review = await reviewRecoveryImportReceiptPersistence(scene, receipt, options);
		assert.throws(() => review.approve({ fingerprint: review.review.reference.fingerprint,
			persistReceipt: true, retainFiles: false }), /Exact receipt/);
		const capability = review.approve({ fingerprint: review.review.reference.fingerprint, persistReceipt: true, retainFiles: true });
		const missing = await findStoredRecoveryImportReceipt(scene, receipt, options);
		assert.equal(missing.status, 'not-found');
		assert.deepEqual(missing.reference, review.review.reference);
		await assert.rejects(persistRecoveryImportReceipt(scene, { fingerprint: capability.fingerprint }), /Fresh receipt/);
		const stored = await persistRecoveryImportReceipt(scene, capability);
		assert.deepEqual(stored.receipt, receipt);
		assert.equal(canonicalJson(scene.toObject()), snapshot);
		assert.ok(files.has(stored.reference.path));
		assert.equal((await findStoredRecoveryImportReceipt(scene, receipt, options)).status, 'verified');
		await assert.rejects(persistRecoveryImportReceipt(scene, capability), /Fresh receipt/);
		const clearing = await reviewCompensatedRecoveryImportClearing(scene, options);
		scene.unsetFlag = async () => { scene.touch(); delete flags.projectImportJournal; };
		await clearCompensatedRecoveryImport(scene, clearing.approve({ token: receipt.token, planDigest: receipt.planDigest,
			clearCompensatedReceipt: true, retainFiles: true }));
		const fresh = await inspectStoredRecoveryImportReceipt(scene, JSON.parse(JSON.stringify(stored.reference)), options);
		assert.deepEqual(fresh.receipt, receipt);
		assert.equal(fresh.review.state, 'cleared-compensated-import');
		assert.deepEqual((await findStoredRecoveryImportReceipt(scene, receipt, options)).reference, stored.reference);
		files.get(stored.reference.path)[0] ^= 1;
		await assert.rejects(inspectStoredRecoveryImportReceipt(scene, stored.reference, options), /fingerprint/);
	});
});

test('receipt envelope enforces exact byte budget, terminal phases, strict schema and lossless native data', async () => {
	await withCompensation(async ({ scene, compensation }) => {
		const active = scene.getFlag('foundryshop', 'projectImportJournal');
		assert.throws(() => encodeRecoveryImportReceipt(active, { maxReceiptBytes: 128 * 1024 }), /complete or compensated/);
		const receipt = await compensateRecoveryImport(scene, compensation),
			bytes = encodeRecoveryImportReceipt(receipt, { maxReceiptBytes: 128 * 1024 });
		assert.deepEqual(decodeRecoveryImportReceipt(bytes, { maxReceiptBytes: bytes.length }), receipt);
		assert.equal(encodeRecoveryImportReceipt(receipt, { maxReceiptBytes: bytes.length }).length, bytes.length);
		assert.throws(() => encodeRecoveryImportReceipt(receipt, { maxReceiptBytes: bytes.length - 1 }), /budget/);
		assert.throws(() => decodeRecoveryImportReceipt(bytes, { maxReceiptBytes: bytes.length - 1 }), /budget/);
		assert.throws(() => decodeRecoveryImportReceipt(bytes), /budget/);
		const envelope = JSON.parse(new TextDecoder().decode(bytes));
		envelope.extra = true;
		assert.throws(() => decodeRecoveryImportReceipt(new TextEncoder().encode(JSON.stringify(envelope)),
			{ maxReceiptBytes: 128 * 1024 }), /envelope/);
		const changed = structuredClone(receipt); changed.before.level.example = undefined;
		await assert.rejects(reviewRecoveryImportReceiptPersistence(scene, changed,
			{ ...inspectionOptions(), maxReceiptBytes: 128 * 1024 }), /losslessly/);
	});
});

test('exact receipt discovery refuses path aliases, invalid listings and context drift during browse', async () => {
	for (const mode of ['alias', 'duplicate', 'invalid', 'context']) {
		await withCompensation(async ({ scene, compensation }) => {
			const receipt = await compensateRecoveryImport(scene, compensation),
				options = { ...inspectionOptions(), maxReceiptBytes: 128 * 1024 },
				expected = (await findStoredRecoveryImportReceipt(scene, receipt, options)).reference,
				picker = foundry.applications.apps.FilePicker.implementation, browse = picker.browse;
			let browses = 0;
			picker.browse = async (...args) => {
				const listing = await browse(...args);
				// First browse belongs to fresh evidence reconciliation; second is exact receipt discovery.
				if (++browses === 2) {
					if (mode === 'alias') return { files: [expected.path.toUpperCase()] };
					if (mode === 'duplicate') return { files: [expected.path, expected.path] };
					if (mode === 'invalid') return { files: [null] };
					scene.width++;
				}
				return listing;
			};
			await assert.rejects(findStoredRecoveryImportReceipt(scene, receipt, options), /alias|listing|context changed/);
		});
	}
});

test('receipt persistence refuses stale context and evidence and reports uncertain upload with exact reference', async () => {
	for (const mode of ['context', 'evidence', 'upload', 'occupied']) {
		await withCompensation(async ({ scene, compensation, files }) => {
			const receipt = await compensateRecoveryImport(scene, compensation),
				options = { ...inspectionOptions(), maxReceiptBytes: 128 * 1024 },
				review = await reviewRecoveryImportReceiptPersistence(scene, receipt, options),
				capability = review.approve({ fingerprint: review.review.reference.fingerprint, persistReceipt: true, retainFiles: true });
			if (mode === 'context') scene.width++;
			if (mode === 'evidence') files.get(receipt.bundle.path)[0] ^= 1;
			if (mode === 'occupied') files.set(review.review.reference.path, new Uint8Array([0]));
			const picker = foundry.applications.apps.FilePicker.implementation, upload = picker.upload;
			if (mode === 'upload') picker.upload = async (...args) => { await upload(...args); throw new Error('lost upload acknowledgement'); };
			await assert.rejects(persistRecoveryImportReceipt(scene, capability), error => {
				if (mode === 'context') return /context changed/.test(error.message);
				assert.ok(error instanceof InterruptedRecoveryImportReceiptPersistenceError);
				assert.deepEqual(error.reference, review.review.reference); return true;
			});
			if (mode !== 'context') await assert.rejects(persistRecoveryImportReceipt(scene, capability), /Fresh receipt/);
			assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'compensated');
			if (mode === 'upload') {
				assert.equal((await inspectStoredRecoveryImportReceipt(scene, review.review.reference, options)).review.state,
					'compensated-retained-evidence');
			}
		});
	}
});

test('reviewed retirement persists before clearing, retains references on cancellation and reuses only verified storage', async () => {
	for (const mode of ['complete', 'cancel-storage', 'cancel-clear', 'corrupt-clear', 'unknown-clear']) {
		await withCompensation(async ({ scene, compensation, flags, files }) => {
			await compensateRecoveryImport(scene, compensation);
			const oldDocument = globalThis.document, oldI18n = game.i18n, oldApi = foundry.applications.api,
				options = { ...inspectionOptions(), maxReceiptBytes: 128 * 1024 }, prompts = [];
			class Element {
				constructor() { this.children = []; }
				append(child) { this.children.push(child); }
				setAttribute() {}
			}
			globalThis.document = { createElement: () => new Element() };
			game.i18n = { localize: key => key, format: key => key };
			let resumed = false, clears = 0;
			foundry.applications.api = { DialogV2: { prompt: async input => {
				const title = input.window.title; prompts.push(title);
				if (title.endsWith('ReceiptTitle') && mode === 'cancel-storage') return null;
				if (title.endsWith('ClearTitle')) {
					assert.ok([...files.keys()].some(path => path.includes('/receipt-')));
					assert.equal(flags.projectImportJournal.phase, 'compensated');
					if (mode === 'cancel-clear' && !resumed) return null;
					if (mode === 'corrupt-clear') {
						const path = [...files.keys()].find(path => path.includes('/receipt-')); files.get(path)[0] ^= 1;
					}
				}
				return input.ok.callback(null, { form: { elements: {
					persist: { checked: true }, retain: { checked: true }, clear: { checked: true },
				} } });
			} } };
			scene.unsetFlag = async () => {
				clears++; scene.touch(); delete flags.projectImportJournal;
				if (mode === 'unknown-clear') throw new Error('removal acknowledgement lost');
			};
			const originalFileCount = files.size;
			try {
				if (mode === 'complete') {
					const result = await retireCompensatedRecoveryImport(scene, options);
					assert.equal(result.status, 'compensated-import-retired');
					assert.equal((await inspectStoredRecoveryImportReceipt(scene, result.reference, options)).review.state,
						'cleared-compensated-import');
					assert.equal(clears, 1); assert.equal(files.size, originalFileCount + 1);
				} else {
					let error;
					await assert.rejects(retireCompensatedRecoveryImport(scene, options), candidate => {
						error = candidate; return candidate instanceof InterruptedCompensatedRecoveryImportRetirementError;
					});
					assert.equal(error.receipt.phase, 'compensated');
					if (mode === 'cancel-storage') {
						assert.equal(error.reference, undefined); assert.equal(files.size, originalFileCount);
					} else assert.ok(error.reference.path.includes('/receipt-'));
					assert.equal(clears, mode === 'unknown-clear' ? 1 : 0);
					if (mode === 'cancel-clear') {
						resumed = true; const before = files.size;
						const result = await retireCompensatedRecoveryImport(scene, { ...options, retainedReceiptReference: error.reference });
						assert.deepEqual(result.reference, error.reference);
						assert.equal(files.size, before);
						assert.equal(prompts.filter(title => title.endsWith('ReceiptTitle')).length, 1);
					}
					if (mode === 'unknown-clear') {
						assert.equal((await inspectStoredRecoveryImportReceipt(scene, error.reference, options)).review.state,
							'cleared-compensated-import');
						await assert.rejects(retireCompensatedRecoveryImport(scene, { ...options, retainedReceiptReference: error.reference }));
					}
				}
			} finally {
				globalThis.document = oldDocument; game.i18n = oldI18n; foundry.applications.api = oldApi;
			}
		});
	}
});

test('compensation requires genuine exact deletion/file-retention approval and refuses stale review', async () => {
	await withCompensation(async ({ scene, compensation, compensationReview, intent, deletes }) => {
		await assert.rejects(compensateRecoveryImport(scene, { token: intent.token }), /Fresh exact compensation/);
		assert.throws(() => compensationReview.approve({ token: intent.token, planDigest: compensationReview.review.planDigest,
			deleteHiddenStaging: true, retainFiles: false }), /Explicit exact-plan/);
		scene.width++;
		await assert.rejects(compensateRecoveryImport(scene, compensation), /review context changed/);
		assert.deepEqual(deletes, []);
		assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'native-staged');
	});
});

test('compensation refuses missing/corrupt evidence and rereads files before intent or deletion', async () => {
	await withCompensation(async ({ scene, compensation, files, intent, deletes }) => {
		files.get(intent.bundle.path)[0] ^= 1;
		await assert.rejects(compensateRecoveryImport(scene, compensation), /fingerprint/);
		assert.deepEqual(deletes, []);
		assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'native-staged');
		await assert.rejects(compensateRecoveryImport(scene, compensation), /Fresh exact compensation/);
	});
	await withCompensation(async ({ scene, files, intent, deletes }) => {
		files.delete(intent.bundle.path);
		await assert.rejects(reviewRecoveryImportCompensation(scene, inspectionOptions()), /missing durable evidence/);
		assert.deepEqual(deletes, []);
	});
});

test('compensation records intent before deletion and fresh review handles a lost delete acknowledgement', async () => {
	await withCompensation(async ({ scene, compensation, compensationFaults, files, deletes, intent }) => {
		compensationFaults.delete = () => {
			assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'compensating');
			throw new Error('lost delete acknowledgement');
		};
		await assert.rejects(compensateRecoveryImport(scene, compensation), error => error instanceof InterruptedRecoveryImportCompensationError);
		assert.equal(scene.tiles.size, 0);
		assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'compensating');
		assert.equal(files.size > 0, true);
		assert.equal((await inspectRecoveryImport(scene, inspectionOptions())).review.state, 'compensation-in-progress');
		await assert.rejects(compensateRecoveryImport(scene, compensation), /Fresh exact compensation/);
		compensationFaults.delete = null;
		const fresh = await reviewRecoveryImportCompensation(scene, inspectionOptions());
		assert.deepEqual(fresh.review.tileIds, []);
		await compensateRecoveryImport(scene, fresh.approve({ token: intent.token, planDigest: fresh.review.planDigest,
			deleteHiddenStaging: true, retainFiles: true }));
		assert.equal(deletes.length, 1);
		assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'compensated');
	});
});

test('uncertain compensation phase/tree writes retain evidence and reconcile exact partial states', async () => {
	for (const mode of ['intent-ack', 'tree-ack', 'final-ack', 'tree-divergence']) {
		await withCompensation(async ({ scene, compensation, stagingFaults, flags, deletes }) => {
			stagingFaults.phase = value => {
				if (mode === 'intent-ack' && value.phase === 'compensating'
					|| mode === 'final-ack' && value.phase === 'compensated') throw new Error('lost phase acknowledgement');
			};
			stagingFaults.tree = () => {
				if (mode === 'tree-ack') throw new Error('lost tree acknowledgement');
				if (mode === 'tree-divergence') flags.layers.revision++;
			};
			await assert.rejects(compensateRecoveryImport(scene, compensation), /compensation stopped/);
			assert.equal(deletes.length, mode === 'intent-ack' ? 0 : 1);
			assert.equal(flags.projectImportJournal !== undefined, true);
			if (mode === 'tree-divergence') await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()), /exact retained import state/);
			else assert.equal((await inspectRecoveryImport(scene, inspectionOptions())).review.state,
				mode === 'final-ack' ? 'compensated-retained-evidence' : 'compensation-in-progress');
		});
	}
});

test('compensation checks authority, context and owned edits after deletion before further writes', async () => {
	for (const mode of ['authority', 'context', 'owned']) {
		await withCompensation(async ({ scene, compensation, compensationFaults, flags, deletes }) => {
			compensationFaults.delete = () => {
				if (mode === 'authority') game.user.can = () => false;
				if (mode === 'context') scene.width++;
				if (mode === 'owned') scene.tiles.set('foreign', { toObject: () => ({ _id: 'foreign' }) });
			};
			await assert.rejects(compensateRecoveryImport(scene, compensation), /compensation stopped/);
			assert.equal(deletes.length, 1);
			assert.equal(flags.projectImportJournal.phase, 'compensating');
			assert.equal(flags.layers.nodes.length > 0, true);
			await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()));
		});
	}
});

test('compensation supports pre-native full evidence and exact partial hidden staging without automatic retry', async () => {
	await withCompensation(async ({ scene, compensation, deletes }) => {
		await compensateRecoveryImport(scene, compensation);
		assert.deepEqual(deletes, []);
		assert.equal((await inspectRecoveryImport(scene, inspectionOptions())).review.state, 'compensated-retained-evidence');
	}, 'Tile', false);
	await withNativeStaging(async ({ scene, approval, stagingFaults, intent }) => {
		stagingFaults.create = () => { throw new Error('partial hidden create'); };
		await assert.rejects(stageRecoveryImport(scene, approval), /staging stopped/);
		const fresh = await reviewRecoveryImportCompensation(scene, inspectionOptions());
		scene.deleteEmbeddedDocuments = async (type, ids) => { for (const id of ids) scene.tiles.delete(id); };
		await compensateRecoveryImport(scene, fresh.approve({ token: intent.token, planDigest: fresh.review.planDigest,
			deleteHiddenStaging: true, retainFiles: true }));
		assert.equal(scene.tiles.size, 0);
		assert.equal((await inspectRecoveryImport(scene, inspectionOptions())).review.state, 'compensated-retained-evidence');
	});
});

async function withFinalization(run, type = 'Tile', configureHistory) {
	await withNativeStaging(async context => {
		const { scene, approval, flags } = context;
		await stageRecoveryImport(scene, approval);
		const faults = {}, releaseWrites = [], releaseOptions = [], oldUpdate = scene.update,
			old = { canvas: globalThis.canvas, Hooks: globalThis.Hooks };
		globalThis.canvas = { ready: false };
		globalThis.Hooks = { callAll: () => {} };
		const doc = stored => ({ id: stored._id, parent: scene, toObject: () => structuredClone(stored),
			getFlag: (namespace, key) => stored.flags?.[namespace]?.[key] });
		scene.update = async patch => {
			if (Object.hasOwn(patch, 'flags.foundryshop.optimizationJournal')) {
				scene.touch();
				flags.optimizationJournal = structuredClone(patch['flags.foundryshop.optimizationJournal']);
				releaseWrites.push('history'); await faults.history?.();
			} else await oldUpdate(patch);
		};
		scene.updateEmbeddedDocuments = async (documentType, patches, options) => {
			scene.touch();
			releaseWrites.push(documentType); releaseOptions.push(options);
			if (documentType === 'Level') {
				assert.equal(options.recursive, false);
				for (const patch of patches) {
					const source = scene.levels.get(patch._id).toObject();
					for (const [key, value] of Object.entries(patch)) {
						if (key.startsWith('-=')) delete source[key.slice(2)];
						else source[key] = structuredClone(value);
					}
					scene.levels.set(source._id, doc(source));
					await faults.native?.(documentType, source._id);
				}
			} else {
				const collection = documentType === 'Drawing' ? scene.drawings : scene.tiles;
				for (const patch of patches) {
					const document = collection.get(patch._id), source = document.toObject();
					assert.equal(isAuthorizedRecoveryImportUpdate(document, patch, options), true);
					assert.equal(isAuthorizedRecoveryImportUpdate(document, patch, structuredClone(options)), true);
					assert.equal(isAuthorizedRecoveryImportUpdate(document, patch, {}), false);
					assert.equal(isAuthorizedRecoveryImportUpdate(document, { ...patch, x: 999 }, options), false);
					assert.equal(isAuthorizedRecoveryImportUpdate({ ...document, toObject: () => ({ ...source, x: 999 }) }, patch, options), false);
					source.hidden = patch.hidden;
					if (Object.hasOwn(patch, 'flags.-=foundryshop')) delete source.flags.foundryshop;
					else delete source.flags.foundryshop.importStaging;
					collection.set(source._id, doc(source));
					await faults.native?.(documentType, source._id);
				}
			}
		};
		scene.unsetFlag = async (namespace, key) => {
			scene.touch();
			assert.equal(namespace, 'foundryshop'); assert.equal(key, 'projectImportJournal');
			releaseWrites.push('clear');
			await faults.beforeClear?.();
			delete flags.projectImportJournal;
			await faults.clear?.();
		};
		try {
			const review = await reviewRecoveryImportFinalization(scene, inspectionOptions());
			const finalApproval = review.approve({ token: review.review.token, planDigest: review.review.planDigest,
				decisions: review.review.requiredDecisions });
			await run({ ...context, finalApproval, finalReview: review, releaseFaults: faults, releaseWrites, releaseOptions });
		} finally {
			await new Promise(resolve => setTimeout(resolve, 40));
			Object.assign(globalThis, old);
		}
	}, type, configureHistory);
}

test('reviewed full entry workflow uses separate approvals and retains precise interruption evidence', async () => {
	for (const [mode, type] of [
		...['Drawing', 'Tile', 'LevelBackground'].map(type => ['complete', type]),
		...['cancel-entry', 'cancel-stage', 'cancel-release', 'cancel-receipt', 'upload-failure', 'receipt-budget'].map(mode => [mode, 'Tile']),
	]) {
		await withFinalization(async ({ scene, flags, plan: oldPlan, files, faults, releaseWrites }) => {
			scene.drawings.clear(); scene.tiles.clear();
			delete flags.layers; delete flags.projectImportJournal; delete flags.optimizationJournal;
			const oldDocument = globalThis.document, oldI18n = game.i18n, oldApi = foundry.applications.api;
			class Element {
				constructor() { this.children = []; }
				append(child) { this.children.push(child); }
				setAttribute() {}
			}
			globalThis.document = { createElement: () => new Element() };
			game.i18n = { localize: key => key, format: key => key };
			const prompts = [], initialFiles = files.size;
			foundry.applications.api = { DialogV2: { prompt: async input => {
				const title = input.window.title; prompts.push(title);
				if (title.endsWith('ImportTitle')) {
					assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
					assert.equal(files.size, initialFiles);
					if (mode === 'cancel-entry') return null;
				}
				if (title.endsWith('StageTitle')) {
					assert.equal(flags.projectImportJournal.phase, 'assets-verified');
					assert.equal(scene.tiles.size, 0);
					if (mode === 'cancel-stage') return null;
				}
				if (title.endsWith('FinalizeTitle')) {
					assert.equal(flags.projectImportJournal.phase, 'native-staged');
					assert.equal([...scene.drawings.values(), ...scene.tiles.values()].every(doc => doc.toObject().hidden), true);
					if (mode === 'cancel-release') return null;
				}
				if (title.endsWith('ReceiptTitle')) {
					assert.equal(flags.projectImportJournal, undefined);
					if (mode === 'cancel-receipt') return null;
				}
				return input.ok.callback(null, { form: { elements: {
					decision0: { checked: true }, decision1: { checked: true }, stage: { checked: true },
					persist: { checked: true }, retain: { checked: true },
				} } });
			} } };
			let id = 0;
			const options = { ...inspectionOptions(), maxReceiptBytes: 128 * 1024,
				root: oldPlan.destinationBaseline.root, levelId: oldPlan.manifest.source.levelId,
				reservedPaths: [...files.keys()], createId: () => `entry${++id}` };
			if (mode === 'upload-failure') faults.upload = () => { throw new Error('unknown upload outcome'); };
			if (mode === 'receipt-budget') options.maxReceiptBytes = 1;
			releaseWrites.length = 0;
			try {
				if (mode === 'complete') {
					const result = await importReviewedRecoveryProject(scene, oldPlan.bytes, options);
					assert.equal(result.status, 'recovery-import-complete');
					assert.equal((await inspectStoredRecoveryImportReceipt(scene, result.reference, options)).review.state, 'completed-import');
					assert.deepEqual(prompts, ['ImportTitle', 'StageTitle', 'FinalizeTitle', 'ReceiptTitle']
						.map(key => `FOUNDRYSHOP.RecoveryImport.${key}`));
				} else {
					let stopped;
					await assert.rejects(importReviewedRecoveryProject(scene, oldPlan.bytes, options), error => {
						stopped = error;
						return mode === 'receipt-budget' ? /Receipt exceeds/.test(error.message)
							: mode === 'cancel-entry' ? error instanceof RecoveryImportReviewCancelledError
							: error instanceof InterruptedReviewedRecoveryImportError;
					}, type);
					if (mode === 'cancel-entry' || mode === 'receipt-budget') {
						assert.equal(flags.projectImportJournal, undefined); assert.equal(files.size, initialFiles);
					}
					if (mode === 'receipt-budget') assert.equal(prompts.length, 0);
					if (mode === 'cancel-stage') assert.equal(flags.projectImportJournal.phase, 'assets-verified');
					if (mode === 'cancel-release') assert.equal(flags.projectImportJournal.phase, 'native-staged');
					if (mode === 'upload-failure') assert.equal(flags.projectImportJournal.phase, 'intent');
					if (mode === 'cancel-receipt') {
						assert.equal(flags.projectImportJournal, undefined); assert.equal(stopped.receipt.phase, 'complete');
						assert.equal((await inspectCompletedRecoveryImport(scene, stopped.receipt, options)).review.state, 'completed-import');
					} else assert.equal(releaseWrites.length, 0);
				}
			} finally {
				globalThis.document = oldDocument; game.i18n = oldI18n; foundry.applications.api = oldApi;
			}
		});
	}
});

test('evidence-derived recovery action review exposes only valid native steps and defaults to read-only inspection', async () => {
	await withNativeStaging(async ({ scene, approval, flags }) => {
		const options = { ...inspectionOptions(), maxReceiptBytes: 128 * 1024 },
			before = canonicalJson(scene.toObject()), initial = await reviewRecoveryImportActions(scene, options);
		assert.deepEqual(initial.review.actions, ['inspect', 'stage', 'compensate']);
		initial.review.actions.push('resume');
		await assert.rejects(initial.execute('resume'), /InvalidAction/);
		assert.equal((await initial.execute('inspect')).status, 'inspected');
		assert.equal(canonicalJson(scene.toObject()), before);
		await stageRecoveryImport(scene, approval);
		await assert.rejects(initial.execute('stage'), /Changed/);
		const staged = await reviewRecoveryImportActions(scene, options);
		assert.deepEqual(staged.review.actions, ['inspect', 'finalize', 'compensate']);
		const oldDocument = globalThis.document, oldI18n = game.i18n, oldApi = foundry.applications.api;
		class Element {
			constructor() { this.children = []; }
			append(...children) { this.children.push(...children); }
		}
		globalThis.document = { createElement: () => new Element() };
		game.i18n = { localize: key => key, format: key => key };
		foundry.applications.api = { DialogV2: { prompt: async input => input.ok.callback() } };
		try {
			assert.equal((await promptRecoveryImportActions(scene, options)).status, 'inspected');
			assert.equal(flags.projectImportJournal.phase, 'native-staged');
			foundry.applications.api.DialogV2.prompt = async () => null;
			await assert.rejects(promptRecoveryImportActions(scene, options), RecoveryImportReviewCancelledError);
		} finally {
			globalThis.document = oldDocument; game.i18n = oldI18n; foundry.applications.api = oldApi;
		}
	});
});

test('missing upload evidence offers inspection only and never authorizes retry, staging or compensation', async () => {
	await withAssetImport(async ({ scene, files }) => {
		files.clear();
		const reviewed = await reviewRecoveryImportActions(scene, { ...inspectionOptions(), maxReceiptBytes: 128 * 1024 });
		assert.deepEqual(reviewed.review.actions, ['inspect']);
		assert.equal(reviewed.review.state, 'missing-project-evidence');
		for (const action of ['stage', 'finalize', 'resume', 'compensate', 'retry-upload', 'retire']) {
			await assert.rejects(reviewed.execute(action), /InvalidAction/);
		}
		assert.ok((await reviewed.execute('inspect')).review.missingPaths.length > 0);
		assert.equal(files.size, 0);
	});
});

test('action controller completes explicit release, resume or compensation then independently retains terminal receipt', async () => {
	for (const action of ['finalize', 'resume', 'compensate', 'cancel-storage']) {
		await withFinalization(async ({ scene, finalApproval, releaseFaults, flags }) => {
			const options = { ...inspectionOptions(), maxReceiptBytes: 128 * 1024 };
			if (action === 'resume') {
				releaseFaults.native = () => { throw new Error('controlled interruption'); };
				await assert.rejects(finalizeRecoveryImport(scene, finalApproval));
				releaseFaults.native = undefined;
			}
			scene.deleteEmbeddedDocuments = async (type, ids) => {
				const collection = type === 'Drawing' ? scene.drawings : scene.tiles;
				for (const id of ids) collection.delete(id);
				scene.touch();
			};
			const oldDocument = globalThis.document, oldI18n = game.i18n, oldApi = foundry.applications.api;
			class Element {
				constructor() { this.children = []; }
				append(...children) { this.children.push(...children); }
				setAttribute() {}
			}
			globalThis.document = { createElement: () => new Element() };
			game.i18n = { localize: key => key, format: key => key };
			foundry.applications.api = { DialogV2: { prompt: async input => {
				if (action === 'cancel-storage' && input.window.title.endsWith('ReceiptTitle')) return null;
				return input.ok.callback(null, { form: { elements: {
					decision0: { checked: true }, decision1: { checked: true }, delete: { checked: true },
					retain: { checked: true }, persist: { checked: true },
					clear: { checked: true },
				} } });
			} } };
			try {
				const reviewed = await reviewRecoveryImportActions(scene, options),
					selected = action === 'cancel-storage' ? 'finalize' : action;
				if (action === 'cancel-storage') {
					let stopped;
					await assert.rejects(reviewed.execute(selected), error => {
						stopped = error; return error instanceof InterruptedRecoveryImportActionError;
					});
					assert.equal(stopped.receipt.phase, 'complete');
					assert.equal(flags.projectImportJournal, undefined);
					assert.equal((await inspectCompletedRecoveryImport(scene, stopped.receipt, options)).review.state, 'completed-import');
				} else {
					const result = await reviewed.execute(selected);
					assert.equal(result.status, 'receipt-retained');
					assert.equal(result.receipt.phase, action === 'compensate' ? 'compensated' : 'complete');
					assert.equal((await inspectStoredRecoveryImportReceipt(scene, result.reference, options)).receipt.phase, result.receipt.phase);
					if (action === 'compensate') {
						assert.equal(flags.projectImportJournal.phase, 'compensated');
						const fresh = await reviewRecoveryImportActions(scene, options);
						assert.deepEqual(fresh.review.actions, ['inspect', 'retire', 'retain-receipt']);
						// Fresh discovery verifies already-retained bytes without opening another storage prompt.
						assert.deepEqual((await fresh.execute('retain-receipt')).reference, result.reference);
						await assert.rejects(fresh.execute('retain-receipt'), /ActionReviewConsumed/);
						const retire = await reviewRecoveryImportActions(scene, options);
						const retired = await retire.execute('retire');
						assert.equal(retired.status, 'compensated-import-retired');
						assert.deepEqual(retired.reference, result.reference);
						assert.equal(flags.projectImportJournal, undefined);
					} else {
						const fresh = await reviewRecoveryImportActions(scene, { ...options, retainedReceiptReference: result.reference });
						assert.deepEqual(fresh.review.actions, ['inspect', 'retain-receipt']);
					}
				}
			} finally {
				globalThis.document = oldDocument; game.i18n = oldI18n; foundry.applications.api = oldApi;
			}
		});
	}
});

test('reviewed finalization installs exact history, releases native sources and clears intent only after final evidence checks', async () => {
	for (const type of ['Drawing', 'Tile', 'LevelBackground']) {
		await withFinalization(async ({ scene, finalApproval, plan, files, writes, releaseWrites, releaseOptions }) => {
			const beforeFiles = structuredClone(files), beforeTree = structuredClone(scene.getFlag('foundryshop', 'layers'));
			const result = await finalizeRecoveryImport(scene, finalApproval);
			assert.equal(result.phase, 'complete');
			assert.equal(scene.getFlag('foundryshop', 'projectImportJournal'), undefined);
			assert.deepEqual(scene.getFlag('foundryshop', 'optimizationJournal'), plan.manifest.journal);
			assert.deepEqual(scene.getFlag('foundryshop', 'layers'), beforeTree);
			assert.deepEqual([...scene.drawings.values()].map(document => document.toObject()), plan.drawings);
			assert.deepEqual([...scene.tiles.values()].map(document => document.toObject()), plan.manifest.tiles);
			assert.deepEqual(scene.levels.get(result.levelId).toObject(), result.after.level);
			assert.deepEqual(files, beforeFiles);
			assert.deepEqual(writes.slice(-4), ['releasing', 'history-installed', 'native-released', 'complete']);
			assert.deepEqual(releaseWrites, ['history', type === 'LevelBackground' ? 'Level' : type, 'clear']);
			for (const document of [...scene.drawings.values(), ...scene.tiles.values()]) {
				assert.equal(document.getFlag('foundryshop', 'importStaging'), undefined);
				assert.equal(isAuthorizedRecoveryImportUpdate(document, { _id: document.id }, releaseOptions[0]), false);
			}
			assert.equal((await inspectCompletedRecoveryImport(scene, JSON.parse(JSON.stringify(result)), inspectionOptions())).review.state, 'completed-import');
			await assert.rejects(finalizeRecoveryImport(scene, finalApproval), /Fresh finalization/);
		}, type);
	}
});

test('finalization explicitly reapproves native Tile/background visibility and refuses forged or stale approvals', async () => {
	for (const type of ['Drawing', 'Tile', 'LevelBackground']) {
		await withFinalization(async ({ scene, finalApproval, finalReview, intent, releaseWrites }) => {
			const extra = type === 'Drawing' ? [] : [type === 'Tile' ? 'native-tile-visibility' : 'level-background-replacement-and-visibility'];
			assert.deepEqual(finalReview.review.requiredDecisions, ['finalize-import', ...extra]);
			assert.throws(() => finalReview.approve({ token: intent.token, planDigest: finalReview.review.planDigest,
				decisions: [] }), /separate native visibility approvals/);
			await assert.rejects(finalizeRecoveryImport(scene, { token: intent.token }), /Fresh finalization/);
			scene.width++;
			await assert.rejects(finalizeRecoveryImport(scene, finalApproval), /review context changed/);
			assert.deepEqual(releaseWrites, []);
		}, type);
	}
	await withNativeStaging(async ({ scene }) => {
		await assert.rejects(reviewRecoveryImportFinalization(scene, inspectionOptions()), /complete hidden native staging/);
	});
});

test('finalization rereads evidence and repeats native schemas and dependencies before release intent', async () => {
	for (const mode of ['bytes', 'schema', 'font']) {
		await withFinalization(async ({ scene, finalApproval, files, intent, model, releaseWrites }) => {
			if (mode === 'bytes') files.get(intent.bundle.path)[0] ^= 1;
			if (mode === 'schema') model.normalize = source => { source.x = 99; };
			if (mode === 'font') foundry.applications.settings.menus.FontConfig.getAvailableFonts = () => [];
			await assert.rejects(finalizeRecoveryImport(scene, finalApproval), /fingerprint|normalization|fonts\/modules/);
			assert.deepEqual(releaseWrites, []);
			assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'native-staged');
			await assert.rejects(finalizeRecoveryImport(scene, finalApproval), /Fresh finalization/);
		});
	}
});

test('uncertain release intent, history install and phase writes retain exact inspectable evidence without native retry', async () => {
	for (const mode of ['intent-ack', 'history-ack', 'phase-ack', 'history-divergence']) {
		await withFinalization(async ({ scene, finalApproval, stagingFaults, releaseFaults, releaseWrites, flags }) => {
			stagingFaults.phase = value => {
				if (mode === 'intent-ack' && value.phase === 'releasing'
					|| mode === 'phase-ack' && value.phase === 'history-installed') throw new Error('lost phase acknowledgement');
			};
			releaseFaults.history = () => {
				if (mode === 'history-ack') throw new Error('lost history acknowledgement');
				if (mode === 'history-divergence') flags.optimizationJournal.entries[0].ownerId = 'foreign';
			};
			await assert.rejects(finalizeRecoveryImport(scene, finalApproval), error => error instanceof InterruptedRecoveryImportFinalizationError);
			assert.deepEqual(releaseWrites, mode === 'intent-ack' ? [] : ['history']);
			assert.equal([...scene.tiles.values()][0].toObject().hidden, true);
			if (mode === 'history-divergence') await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()), /exact retained import state/);
			else assert.equal((await inspectRecoveryImport(scene, inspectionOptions())).review.state, 'native-release-in-progress');
			if (mode === 'history-divergence') await assert.rejects(reviewRecoveryImportFinalizationResume(scene, inspectionOptions()), /exact retained import state/);
			await assert.rejects(reviewRecoveryImportCompensation(scene, inspectionOptions()));
			await assert.rejects(reviewRecoveryImportFinalization(scene, inspectionOptions()));
			await assert.rejects(finalizeRecoveryImport(scene, finalApproval), /Fresh finalization/);
		});
	}
});

test('partial native release and Level acknowledgement loss remain exact final-or-staged states for read-only inspection', async () => {
	for (const type of ['Drawing', 'Tile', 'LevelBackground']) {
		await withFinalization(async ({ scene, finalApproval, releaseFaults, releaseWrites, intent }) => {
			releaseFaults.native = () => { throw new Error('lost native acknowledgement'); };
			await assert.rejects(finalizeRecoveryImport(scene, finalApproval), /Native visibility\/background may have changed/);
			assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'history-installed');
			assert.deepEqual(releaseWrites, ['history', type === 'LevelBackground' ? 'Level' : type]);
			const fresh = await inspectRecoveryImport(scene, inspectionOptions());
			assert.equal(fresh.review.state, 'native-release-in-progress');
			assert.equal(fresh.nativeState.history, 'after');
			if (type === 'Drawing') assert.deepEqual(fresh.nativeState.finalDrawingIds, intent.drawings.map(source => source.id));
			if (type === 'Tile') assert.deepEqual(fresh.nativeState.finalTileIds, intent.tiles.map(source => source.id));
			if (type === 'LevelBackground') assert.equal(fresh.nativeState.level, 'after');
			await assert.rejects(reviewRecoveryImportCompensation(scene, inspectionOptions()), /unfinished import/);
		}, type);
	}
});

test('fresh explicitly reviewed release resume finishes only remaining steps across retained release phases', async () => {
	for (const type of ['Drawing', 'Tile', 'LevelBackground']) {
		for (const mode of ['intent-ack', 'history-ack', 'phase-ack', 'native-ack', 'released-ack', 'complete-ack', 'clear-before']) {
			await withFinalization(async ({ scene, finalApproval, stagingFaults, releaseFaults, releaseWrites }) => {
				stagingFaults.phase = value => {
					if (mode === 'intent-ack' && value.phase === 'releasing'
						|| mode === 'phase-ack' && value.phase === 'history-installed'
						|| mode === 'released-ack' && value.phase === 'native-released'
						|| mode === 'complete-ack' && value.phase === 'complete') throw new Error('acknowledgement lost');
				};
				releaseFaults.history = () => { if (mode === 'history-ack') throw new Error('acknowledgement lost'); };
				releaseFaults.native = () => { if (mode === 'native-ack') throw new Error('acknowledgement lost'); };
				releaseFaults.beforeClear = () => { if (mode === 'clear-before') throw new Error('acknowledgement lost'); };
				await assert.rejects(finalizeRecoveryImport(scene, finalApproval), /finalization stopped/);
				stagingFaults.phase = undefined;
				for (const key of Object.keys(releaseFaults)) delete releaseFaults[key];
				releaseWrites.length = 0;
				const review = await reviewRecoveryImportFinalizationResume(scene, inspectionOptions()),
					capability = review.approve({ token: review.review.token, planDigest: review.review.planDigest,
						decisions: review.review.requiredDecisions });
				assert.equal(review.review.resume, true);
				assert.equal(review.review.requiredDecisions[0], 'resume-finalize-import');
				assert.throws(() => review.approve({ token: review.review.token, planDigest: review.review.planDigest,
					decisions: ['finalize-import'] }), /separate native visibility approvals/);
				await assert.rejects(finalizeRecoveryImport(scene, capability), /Fresh finalization/);
				const receipt = await resumeRecoveryImportFinalization(scene, capability);
				assert.equal(receipt.phase, 'complete');
				assert.equal((await inspectCompletedRecoveryImport(scene, receipt, inspectionOptions())).review.state, 'completed-import');
				const nativeType = type === 'LevelBackground' ? 'Level' : type;
				assert.deepEqual(releaseWrites, mode === 'intent-ack' ? ['history', nativeType, 'clear']
					: ['history-ack', 'phase-ack'].includes(mode) ? [nativeType, 'clear'] : ['clear']);
				await assert.rejects(resumeRecoveryImportFinalization(scene, capability), /Fresh finalization/);
			}, type);
		}
	}
});

test('localized resume dialog reapproves native visibility without performing implicit release writes', async () => {
	await withFinalization(async ({ scene, finalApproval, releaseFaults, releaseWrites }) => {
		releaseFaults.native = () => { throw new Error('controlled stop'); };
		await assert.rejects(finalizeRecoveryImport(scene, finalApproval), /finalization stopped/);
		releaseFaults.native = undefined;
		const oldDocument = globalThis.document, oldI18n = game.i18n, oldApi = foundry.applications.api;
		class Element {
			constructor() { this.children = []; }
			append(child) { this.children.push(child); }
			setAttribute() {}
		}
		globalThis.document = { createElement: () => new Element() };
		game.i18n = { localize: key => key, format: key => key };
		let tileApproved = false;
		foundry.applications.api = { DialogV2: { prompt: async options => options.ok.callback(null, {
			form: { elements: { decision0: { checked: true }, decision1: { checked: tileApproved } } },
		}) } };
		try {
			releaseWrites.length = 0;
			await assert.rejects(promptRecoveryImportApproval(scene, 'resume', inspectionOptions()), RecoveryImportReviewCancelledError);
			tileApproved = true;
			const capability = await promptRecoveryImportApproval(scene, 'resume', inspectionOptions());
			assert.deepEqual(releaseWrites, []);
			await resumeRecoveryImportFinalization(scene, capability);
			assert.deepEqual(releaseWrites, ['clear']);
		} finally {
			globalThis.document = oldDocument; game.i18n = oldI18n; foundry.applications.api = oldApi;
		}
	});
});

test('release resume finishes mixed final Drawing and staged Tile without rewriting the Drawing', async () => {
	await withFinalization(async ({ scene, finalApproval, releaseFaults, releaseWrites }) => {
		releaseFaults.native = type => { if (type === 'Drawing') throw new Error('stop after Drawing'); };
		await assert.rejects(finalizeRecoveryImport(scene, finalApproval), /finalization stopped/);
		releaseFaults.native = undefined;
		const before = [...scene.drawings.values()].map(document => document.toObject()),
			review = await reviewRecoveryImportFinalizationResume(scene, inspectionOptions());
		assert.equal(review.review.nativeState.finalDrawingIds.length, 1);
		assert.equal(review.review.nativeState.finalTileIds.length, 0);
		releaseWrites.length = 0;
		await resumeRecoveryImportFinalization(scene, review.approve({ token: review.review.token,
			planDigest: review.review.planDigest, decisions: review.review.requiredDecisions }));
		assert.deepEqual(releaseWrites, ['Tile', 'clear']);
		assert.deepEqual([...scene.drawings.values()].map(document => document.toObject()), before);
	}, 'Tile', async h => {
		const original = drawing('stroke002'); original.hidden = true; original.sort = 4096;
		h.drawings.set(original._id, original);
	});
});

test('release resume updates only staged members of a partially released native collection', async () => {
	await withFinalization(async ({ scene, finalApproval, releaseFaults, intent }) => {
		let stopped = false;
		releaseFaults.native = type => {
			if (type === 'Drawing' && !stopped) { stopped = true; throw new Error('stop after first Drawing'); }
		};
		await assert.rejects(finalizeRecoveryImport(scene, finalApproval), /finalization stopped/);
		releaseFaults.native = undefined;
		const review = await reviewRecoveryImportFinalizationResume(scene, inspectionOptions());
		assert.equal(review.review.nativeState.finalDrawingIds.length, 1);
		assert.equal(intent.drawings.length, 2);
		const first = scene.drawings.get(review.review.nativeState.finalDrawingIds[0]).toObject(),
			update = scene.updateEmbeddedDocuments, drawingPatches = [];
		scene.updateEmbeddedDocuments = async (type, patches, options) => {
			if (type === 'Drawing') drawingPatches.push(...patches);
			return update(type, patches, options);
		};
		await resumeRecoveryImportFinalization(scene, review.approve({ token: review.review.token,
			planDigest: review.review.planDigest, decisions: review.review.requiredDecisions }));
		assert.equal(drawingPatches.length, 1);
		assert.notEqual(drawingPatches[0]._id, first._id);
		assert.deepEqual(scene.drawings.get(first._id).toObject(), first);
	}, 'Tile', async h => {
		for (const [index, id] of ['stroke002', 'stroke003'].entries()) {
			const original = drawing(id); original.hidden = true; original.sort = 4096 * (index + 1);
			h.drawings.set(id, original);
		}
	});
});

test('release resume refuses hidden staging, changed review context and changed evidence without release writes', async () => {
	await withFinalization(async ({ scene, finalApproval, releaseFaults, releaseWrites, files, intent }) => {
		await assert.rejects(reviewRecoveryImportFinalizationResume(scene, inspectionOptions()));
		releaseFaults.native = () => { throw new Error('acknowledgement lost'); };
		await assert.rejects(finalizeRecoveryImport(scene, finalApproval), /finalization stopped/);
		releaseFaults.native = undefined;
		const review = await reviewRecoveryImportFinalizationResume(scene, inspectionOptions()),
			capability = review.approve({ token: review.review.token, planDigest: review.review.planDigest,
				decisions: review.review.requiredDecisions });
		releaseWrites.length = 0;
		const width = scene.width; scene.width++;
		await assert.rejects(resumeRecoveryImportFinalization(scene, capability), /review context changed/);
		scene.width = width;
		files.set(intent.uploads[0].path, new Uint8Array([0]));
		await assert.rejects(resumeRecoveryImportFinalization(scene, capability), /finalization stopped/);
		assert.deepEqual(releaseWrites, []);
		await assert.rejects(resumeRecoveryImportFinalization(scene, capability), /Fresh finalization/);
	});
});

test('interrupted explicit resume retains inspectable state and requires another fresh approval', async () => {
	await withFinalization(async ({ scene, finalApproval, stagingFaults, releaseFaults, releaseWrites }) => {
		stagingFaults.phase = value => { if (value.phase === 'releasing') throw new Error('stop at release intent'); };
		await assert.rejects(finalizeRecoveryImport(scene, finalApproval), /finalization stopped/);
		stagingFaults.phase = undefined;
		const review = await reviewRecoveryImportFinalizationResume(scene, inspectionOptions()),
			capability = review.approve({ token: review.review.token, planDigest: review.review.planDigest,
				decisions: review.review.requiredDecisions });
		await assert.rejects(resumeRecoveryImportFinalization(scene, { token: review.review.token }), /Fresh finalization/);
		releaseFaults.native = () => { throw new Error('stop during explicit resume'); };
		await assert.rejects(resumeRecoveryImportFinalization(scene, capability), error =>
			error instanceof InterruptedRecoveryImportFinalizationError && error.receipt.phase === 'history-installed');
		await assert.rejects(resumeRecoveryImportFinalization(scene, capability), /Fresh finalization/);
		assert.equal((await inspectRecoveryImport(scene, inspectionOptions())).review.state, 'native-release-in-progress');
		releaseFaults.native = undefined;
		releaseWrites.length = 0;
		const fresh = await reviewRecoveryImportFinalizationResume(scene, inspectionOptions());
		await resumeRecoveryImportFinalization(scene, fresh.approve({ token: fresh.review.token,
			planDigest: fresh.review.planDigest, decisions: fresh.review.requiredDecisions }));
		assert.deepEqual(releaseWrites, ['clear']);
	});
});

test('native release rejects unrelated edits, edited owned sources and dependency/authority loss before journal completion', async () => {
	for (const mode of ['context', 'owned', 'authority', 'font', 'level', 'history']) {
		await withFinalization(async ({ scene, finalApproval, releaseFaults, flags, releaseWrites }) => {
			releaseFaults.native = () => {
				if (mode === 'context') scene.width++;
				if (mode === 'owned') scene.tiles.set('foreign', { toObject: () => ({ _id: 'foreign' }) });
				if (mode === 'authority') game.user.can = () => false;
				if (mode === 'font') foundry.applications.settings.menus.FontConfig.getAvailableFonts = () => [];
				if (mode === 'level') scene.levels.get(flags.projectImportJournal.levelId).toObject = () => ({ _id: flags.projectImportJournal.levelId });
				if (mode === 'history') flags.optimizationJournal.entries = [];
			};
			await assert.rejects(finalizeRecoveryImport(scene, finalApproval), /finalization stopped/);
			assert.deepEqual(releaseWrites, ['history', 'Tile']);
			assert.equal(flags.projectImportJournal.phase, 'history-installed');
			await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()));
			await assert.rejects(reviewRecoveryImportFinalizationResume(scene, inspectionOptions()));
		});
	}
});

test('completion and cleanup acknowledgement loss retain a complete receipt for exact read-only verification', async () => {
	for (const mode of ['released-ack', 'complete-ack', 'clear-before', 'clear-after', 'clear-edit']) {
		await withFinalization(async ({ scene, finalApproval, stagingFaults, releaseFaults, flags }) => {
			stagingFaults.phase = value => {
				if (mode === 'released-ack' && value.phase === 'native-released'
					|| mode === 'complete-ack' && value.phase === 'complete') throw new Error('lost last phase acknowledgement');
			};
			releaseFaults.beforeClear = () => { if (mode === 'clear-before') throw new Error('journal removal not acknowledged'); };
			releaseFaults.clear = () => {
				if (mode === 'clear-edit') scene.width++;
				if (mode === 'clear-after') throw new Error('journal removal acknowledgement lost');
			};
			let error;
			await assert.rejects(finalizeRecoveryImport(scene, finalApproval), candidate => {
				error = candidate; return candidate instanceof InterruptedRecoveryImportFinalizationError;
			});
			if (['released-ack', 'complete-ack', 'clear-before'].includes(mode)) {
				assert.equal((await inspectRecoveryImport(scene, inspectionOptions())).review.state, 'native-release-in-progress');
				if (mode === 'clear-before') await assert.rejects(inspectCompletedRecoveryImport(scene, error.receipt, inspectionOptions()), /context changed/);
			} else {
				assert.equal(flags.projectImportJournal, undefined);
				assert.equal(error.receipt.phase, 'complete');
				if (mode === 'clear-edit') await assert.rejects(inspectCompletedRecoveryImport(scene, error.receipt, inspectionOptions()), /baseline/);
				else assert.equal((await inspectCompletedRecoveryImport(scene, JSON.parse(JSON.stringify(error.receipt)), inspectionOptions())).review.state, 'completed-import');
			}
		});
	}
});

test('final imported multi-generation history stays bound to exact native artwork, tree and preserved files', async () => {
	await withFinalization(async ({ scene, finalApproval, files, plan }) => {
		const receipt = await finalizeRecoveryImport(scene, finalApproval);
		assert.equal(receipt.optimization.entries.length, 2);
		const fresh = await inspectCompletedRecoveryImport(scene, receipt, inspectionOptions());
		await validateRecoveryProjectManifest(fresh.evidence.manifest, fresh.evidence.recoveryFiles);
		assert.deepEqual(fresh.evidence.manifest.journal, plan.manifest.journal);
		assert.deepEqual([...scene.tiles.values()].map(document => document.toObject()), fresh.evidence.manifest.tiles);
		for (const reference of receipt.uploads) assert.equal(await fileFingerprint(files.get(reference.path)), reference.fingerprint);
		scene.tiles.get(plan.manifest.tiles[0]._id).toObject = () => ({ ...plan.manifest.tiles[0], hidden: true });
		await assert.rejects(inspectCompletedRecoveryImport(scene, receipt, inspectionOptions()), /exact hidden staging or approved final source/);
	}, 'Drawing', async h => { await h.apply('two', 'Tile'); });
});

test('completed import receipts persist without native writes and reject subsequent native drift', async () => {
	await withFinalization(async ({ scene, finalApproval, releaseWrites }) => {
		const receipt = await finalizeRecoveryImport(scene, finalApproval),
			options = { ...inspectionOptions(), maxReceiptBytes: 128 * 1024 },
			review = await reviewRecoveryImportReceiptPersistence(scene, receipt, options);
		releaseWrites.length = 0;
		const stored = await persistRecoveryImportReceipt(scene, review.approve({
			fingerprint: review.review.reference.fingerprint, persistReceipt: true, retainFiles: true,
		}));
		assert.deepEqual(releaseWrites, []);
		assert.equal((await inspectStoredRecoveryImportReceipt(scene, stored.reference, options)).review.state, 'completed-import');
		scene.width++;
		await assert.rejects(inspectStoredRecoveryImportReceipt(scene, stored.reference, options), /baseline/);
	});
});

test('fresh release inspection recognizes mixed final/staged artwork but rejects falsely completed phases and unowned edits', async () => {
	await withFinalization(async ({ scene, finalApproval, releaseFaults, flags, intent }) => {
		releaseFaults.native = type => { if (type === 'Drawing') throw new Error('lost first collection acknowledgement'); };
		await assert.rejects(finalizeRecoveryImport(scene, finalApproval), /finalization stopped/);
		const fresh = await inspectRecoveryImport(scene, inspectionOptions());
		assert.equal(fresh.nativeState.finalDrawingIds.length, 1);
		assert.equal(fresh.nativeState.finalTileIds.length, 0);
		assert.deepEqual(fresh.nativeState.presentTileIds, intent.tiles.map(source => source.id));
		assert.equal([...scene.drawings.values()][0].toObject().hidden, true);
		flags.projectImportJournal.phase = 'native-released';
		await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()), /release phase differs/);
		flags.projectImportJournal.phase = 'history-installed';
		scene.drawings.get(intent.drawings[0].id).toObject = () => ({ _id: intent.drawings[0].id, hidden: true });
		await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()), /exact hidden staging or approved final source/);
	}, 'Tile', async h => {
		const original = drawing('stroke002'); original.hidden = true; original.sort = 4096;
		h.drawings.set(original._id, original);
	});
});

test('complete receipt inspection is read-only and refuses altered receipts, files or native background state', async () => {
	await withFinalization(async ({ scene, finalApproval, files, flags }) => {
		const receipt = await finalizeRecoveryImport(scene, finalApproval), before = canonicalJson(scene.toObject());
		await inspectCompletedRecoveryImport(scene, receipt, inspectionOptions());
		assert.equal(canonicalJson(scene.toObject()), before);
		const changed = structuredClone(receipt); changed.phase = 'history-installed';
		await assert.rejects(inspectCompletedRecoveryImport(scene, changed, inspectionOptions()), /complete receipt/);
		changed.phase = 'complete'; changed.optimization.revision++;
		await assert.rejects(inspectCompletedRecoveryImport(scene, changed, inspectionOptions()), /exact retained import state/);
		const retainedBytes = files.get(receipt.bundle.path);
		files.delete(receipt.bundle.path);
		await assert.rejects(inspectCompletedRecoveryImport(scene, receipt, inspectionOptions()), /missing durable evidence/);
		files.set(receipt.bundle.path, retainedBytes);
		const doc = scene.levels.get(receipt.levelId);
		doc.toObject = () => ({ ...receipt.after.level, background: receipt.before.level.background });
		await assert.rejects(inspectCompletedRecoveryImport(scene, receipt, inspectionOptions()), /exact retained import state|release phase differs/);
		assert.equal(flags.projectImportJournal, undefined);
	}, 'LevelBackground');
});

test('native staging installs exact hidden tree/documents and journal phases without visibility/background/history release', async () => {
	for (const type of ['Drawing', 'Tile', 'LevelBackground']) {
		await withNativeStaging(async ({ scene, approval, intent, plan, writes, nativeWrites, optionsUsed }) => {
			const result = await stageRecoveryImport(scene, approval);
			assert.deepEqual(writes, ['intent', 'assets-verified', 'tree-installed', 'native-staged']);
			assert.equal(result.phase, 'native-staged');
			assert.deepEqual(validateRecoveryImportIntent(JSON.parse(JSON.stringify(result)), scene.id), result);
			assert.deepEqual(scene.getFlag('foundryshop', 'layers'), plan.manifest.project.tree);
			assert.deepEqual(scene.levels.get(intent.levelId).toObject(), intent.before.level);
			assert.equal(scene.getFlag('foundryshop', 'optimizationJournal'), undefined);
			const collection = type === 'Drawing' ? scene.drawings : scene.tiles;
			for (const document of collection.values()) {
				assert.equal(document.toObject().hidden, true);
				assert.equal(document.getFlag('foundryshop', 'importStaging'), intent.token);
				assert.equal(isAuthorizedRecoveryImportCreate(document, optionsUsed[0]), false);
			}
			assert.deepEqual(nativeWrites, type === 'LevelBackground' ? ['tree'] : ['tree', type]);
			if (type === 'Drawing') assert.deepEqual([...scene.drawings.values()].map(doc => doc.toObject()), plan.stagedDrawings);
			if (type === 'Tile') assert.deepEqual([...scene.tiles.values()].map(doc => doc.toObject()), plan.stagedTiles);
			const inspected = await inspectRecoveryImport(scene, inspectionOptions());
			assert.equal(inspected.review.state, 'hidden-native-staging');
			assert.deepEqual(inspected.nativeState.missingDrawingIds, []);
			assert.deepEqual(inspected.nativeState.missingTileIds, []);
			await assert.rejects(stageRecoveryImport(scene, approval), /Fresh hidden-staging/);
		}, type);
	}
});

test('native staging rejects forged/cancelled approvals and rechecks byte evidence before tree writes', async () => {
	await withNativeStaging(async ({ scene, approval, review, intent, files, nativeWrites }) => {
		await assert.rejects(stageRecoveryImport(scene, { token: intent.token }), /Fresh hidden-staging/);
		assert.throws(() => review.approve({ token: intent.token, planDigest: review.review.planDigest, stageHidden: false }), /Explicit exact-plan/);
		files.get(intent.bundle.path)[0] ^= 1;
		await assert.rejects(stageRecoveryImport(scene, approval), /fingerprint/);
		assert.deepEqual(nativeWrites, []);
		assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'assets-verified');
	});
});

test('uncertain tree and phase writes retain precise journal/hidden tree instead of automatic cleanup', async () => {
	for (const mode of ['tree-ack', 'tree-divergence', 'phase-ack', 'phase-divergence']) {
		await withNativeStaging(async ({ scene, approval, stagingFaults, flags, nativeWrites, files }) => {
			stagingFaults.tree = () => {
				if (mode === 'tree-ack') throw new Error('lost tree acknowledgement');
				if (mode === 'tree-divergence') flags.layers.nodes[0].name = 'changed';
			};
			stagingFaults.phase = value => {
				if (value.phase !== 'tree-installed') return;
				if (mode === 'phase-ack') throw new Error('lost phase acknowledgement');
				if (mode === 'phase-divergence') flags.projectImportJournal.phase = 'assets-verified';
			};
			await assert.rejects(stageRecoveryImport(scene, approval), error => error instanceof InterruptedRecoveryImportStagingError);
			assert.deepEqual(nativeWrites, ['tree']);
			assert.equal(flags.layers !== undefined, true);
			assert.equal(flags.projectImportJournal !== undefined, true);
			assert.equal(files.size > 0, true);
			assert.equal(scene.drawings.size, 0); assert.equal(scene.tiles.size, 0);
			if (mode !== 'tree-divergence') {
				const inspected = await inspectRecoveryImport(scene, inspectionOptions());
				assert.equal(inspected.review.state, 'hidden-native-staging');
				assert.equal(inspected.nativeState.missingTileIds.length, 1);
			}
			await assert.rejects(stageRecoveryImport(scene, approval), /Fresh hidden-staging/);
		});
	}
});

test('partial create, changed unrelated state and final phase failures preserve staged documents without release', async () => {
	for (const mode of ['partial-create', 'context-change', 'final-phase']) {
		await withNativeStaging(async ({ scene, approval, stagingFaults, flags, nativeWrites }) => {
			stagingFaults.create = () => {
				if (mode === 'partial-create') throw new Error('create acknowledgement lost');
				if (mode === 'context-change') scene.width++;
			};
			stagingFaults.phase = value => {
				if (mode === 'final-phase' && value.phase === 'native-staged') throw new Error('last journal acknowledgement lost');
			};
			await assert.rejects(stageRecoveryImport(scene, approval), /staging stopped/);
			assert.deepEqual(nativeWrites, ['tree', 'Tile']);
			assert.equal(scene.tiles.size, 1);
			assert.equal([...scene.tiles.values()][0].toObject().hidden, true);
			assert.equal(flags.projectImportJournal.phase, mode === 'final-phase' ? 'native-staged' : 'tree-installed');
			assert.equal(flags.optimizationJournal, undefined);
			if (mode !== 'context-change') {
				const inspected = await inspectRecoveryImport(scene, inspectionOptions());
				assert.equal(inspected.review.state, 'hidden-native-staging');
				assert.equal(inspected.nativeState.presentTileIds.length, 1);
			}
		});
	}
});

test('native review refuses incomplete intent and execution catches authority or dependency loss', async () => {
	await withAssetImport(async ({ scene }) => {
		await assert.rejects(reviewRecoveryImportStaging(scene, inspectionOptions()), /Fresh complete evidence/);
	});
	for (const mode of ['authority', 'fonts', 'stale']) {
		await withNativeStaging(async ({ scene, approval, stagingFaults, nativeWrites }) => {
			stagingFaults.tree = () => {
				if (mode === 'authority') game.user.can = () => false;
				if (mode === 'fonts') foundry.applications.settings.menus.FontConfig.getAvailableFonts = () => [];
				if (mode === 'stale') scene.width++;
			};
			await assert.rejects(stageRecoveryImport(scene, approval), /staging stopped/);
			assert.deepEqual(nativeWrites, ['tree']);
			assert.equal(scene.tiles.size, 0);
		});
	}
});

test('fresh partial-native reconciliation refuses edited owned documents, unowned artwork and false completed staging', async () => {
	for (const mode of ['edited', 'unowned', 'missing-complete', 'foreign-staging']) {
		await withNativeStaging(async ({ scene, approval, intent }) => {
			await stageRecoveryImport(scene, approval);
			const source = [...scene.tiles.values()][0].toObject();
			if (mode === 'edited') source.hidden = false;
			if (mode === 'foreign-staging') source.flags.foundryshop.importStaging = 'foreignToken';
			if (mode === 'missing-complete') scene.tiles.clear();
			else {
				scene.tiles.set(source._id, { id: source._id, toObject: () => structuredClone(source) });
				if (mode === 'unowned') scene.tiles.set('unowned', { id: 'unowned',
					toObject: () => ({ ...structuredClone(source), _id: 'unowned' }) });
			}
			await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()), /hidden staging|Unowned|phase differs/);
			assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').token, intent.token);
			assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'native-staged');
		});
	}
});

test('fresh reconciliation reports missing evidence and partial assets without uploads or phase advancement', async () => {
	await withAssetImport(async ({ scene, intent, files, plan, writes, uploads, flags }) => {
		// Serialized journal and disk bytes only; no approval capability is passed to inspection.
		flags.projectImportJournal = JSON.parse(JSON.stringify(intent));
		let result = await inspectRecoveryImport(scene, inspectionOptions());
		assert.equal(result.review.state, 'missing-project-evidence');
		assert.equal(result.evidence, null);
		assert.deepEqual(result.review.missingPaths, [intent.bundle.path, ...intent.uploads.map(file => file.path)]);
		files.set(intent.bundle.path, await encodeRecoveryImportEvidence(plan.bytes, limits));
		result = await inspectRecoveryImport(scene, inspectionOptions());
		assert.equal(result.review.state, 'partial-assets');
		assert.deepEqual(result.evidence.manifest, plan.manifest);
		for (const file of plan.uploads) files.set(file.reference.path, file.bytes.slice());
		result = await inspectRecoveryImport(scene, inspectionOptions());
		assert.equal(result.review.state, 'all-assets-verified');
		assert.equal(result.intent.phase, 'intent');
		assert.deepEqual(writes, ['intent']); assert.deepEqual(uploads, []);
		assert.equal(scene.drawings.size, 0); assert.equal(scene.tiles.size, 0);
	});
});

test('fresh reconciliation verifies uploaded Drawing/Tile/background evidence including preserved background aliases', async () => {
	for (const type of ['Drawing', 'Tile', 'LevelBackground']) {
		await withAssetImport(async ({ scene, capability, uploads, writes, flags, plan }) => {
			await uploadRecoveryImportAssets(scene, capability, { isCurrent: () => true });
			flags.projectImportJournal = JSON.parse(JSON.stringify(flags.projectImportJournal));
			const before = canonicalJson(scene.toObject()), count = uploads.length;
			const result = await inspectRecoveryImport(scene, inspectionOptions());
			assert.equal(result.review.state, 'all-assets-verified');
			assert.equal(result.intent.phase, 'assets-verified');
			assert.deepEqual(result.review.missingPaths, []);
			assert.deepEqual(result.evidence.manifest, plan.manifest);
			assert.equal(uploads.length, count); assert.deepEqual(writes, ['intent', 'assets-verified']);
			assert.equal(canonicalJson(scene.toObject()), before);
		}, type);
	}
});

test('reconciliation refuses missing verified evidence, corrupt bytes and alias conflicts rather than trusting phase', async () => {
	for (const mode of ['missing', 'corrupt', 'alias', 'duplicate-alias']) {
		await withAssetImport(async ({ scene, capability, files, intent }) => {
			await uploadRecoveryImportAssets(scene, capability, { isCurrent: () => true });
			const path = intent.uploads[0].path;
			if (mode === 'missing') files.delete(path);
			if (mode === 'corrupt') files.get(path)[0] ^= 1;
			if (mode === 'alias') { const bytes = files.get(path); files.delete(path); files.set(path.toUpperCase(), bytes); }
			if (mode === 'duplicate-alias') files.set(path.toUpperCase(), files.get(path));
			await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()), /missing durable|fingerprint|path alias|Ambiguous/);
			assert.equal(scene.getFlag('foundryshop', 'projectImportJournal').phase, 'assets-verified');
		});
	}
});

test('reconciliation binds native staged/final digests and exact upload inventory to retained ZIP', async () => {
	for (const mode of ['native-digest', 'target', 'extra-file']) {
		await withAssetImport(async ({ scene, files, intent, plan, flags }) => {
			files.set(intent.bundle.path, await encodeRecoveryImportEvidence(plan.bytes, limits));
			if (mode === 'native-digest') flags.projectImportJournal.tiles[0].afterDigest = 'f'.repeat(64);
			if (mode === 'target') flags.projectImportJournal.after.layers.revision++;
			if (mode === 'extra-file') flags.projectImportJournal.uploads.push({
				...intent.uploads[0], path: `${intent.bundle.root}/unexpected.png`,
			});
			await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()), /digests|targets|inventory/);
		});
	}
});

test('reconciliation budgets and destination baseline refuse before file reads; async guards and native normalization refuse', async () => {
	await withAssetImport(async ({ scene, capability, files, uploads, faults, model, flags }) => {
		await uploadRecoveryImportAssets(scene, capability, { isCurrent: () => true });
		const before = canonicalJson(scene.toObject()), count = uploads.length;
		let reads = 0;
		faults.read = () => { reads++; };
		await assert.rejects(inspectRecoveryImport(scene, { ...inspectionOptions(), maxBytes: 1 }), /budget/);
		await assert.rejects(inspectRecoveryImport(scene, { ...inspectionOptions(), maxEntries: 2 }), /budget/);
		scene.width++;
		await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()), /baseline/);
		scene.width--; assert.equal(reads, 0);
		model.normalize = source => { source.hidden = !source.hidden; };
		await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()), /schema normalization/);
		model.normalize = null;
		foundry.applications.settings.menus.FontConfig.getAvailableFonts = () => [];
		await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()), /fonts\/modules/);
		foundry.applications.settings.menus.FontConfig.getAvailableFonts = () => ['Signika'];
		faults.read = () => { flags.projectImportJournal.planDigest = 'f'.repeat(64); };
		await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()), /context changed/);
		assert.equal(uploads.length, count); assert.equal(files.size, count);
		assert.notEqual(canonicalJson(scene.toObject()), before);
	});
});

test('reconciliation refuses cancellation and a different owner, and catches changes after folder listing', async () => {
	await withAssetImport(async ({ scene, faults }) => {
		await assert.rejects(inspectRecoveryImport(scene, { ...inspectionOptions(), signal: AbortSignal.abort() }), /cancelled/);
		game.users.activeGM.id = 'differentGM';
		await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()), /authority/);
		game.users.activeGM.id = game.user.id;
		await assert.rejects(inspectRecoveryImport(scene, { ...inspectionOptions(), isCurrent: () => false }), /context/);
		faults.browse = () => { scene.width++; };
		await assert.rejects(inspectRecoveryImport(scene, inspectionOptions()), /context changed/);
	});
});
