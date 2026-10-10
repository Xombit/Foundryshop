import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOptimizationArchive, readOptimizationArchive } from '../scripts/layers/optimization_recovery.js';
import { prepareOptimizationPlacement } from '../scripts/layers/optimization_placement.js';
import { optimizationNativeVerifier } from '../scripts/layers/optimization_native.js';

const transform = () => ({ anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0,
	fit: 'fill', scaleX: 1, scaleY: 1, rotation: 0 });
const doc = source => ({ id: source._id, toObject: () => structuredClone(source) });
const tileDoc = (source, bounds = source) => ({ ...doc(source), shape: { bounds } });
let scene, level, original, replacement, options, bounds, current;
beforeEach(() => {
	current = true;
	globalThis.game = { user: { isGM: true }, i18n: { localize: key => key } };
	bounds = { x: 10, y: 20, width: 100, height: 200 };
	level = { _id: 'level', elevation: { bottom: 0, top: 10 },
		background: { src: null, color: '#000000', tint: '#ffffff', alphaThreshold: 0.5 },
		textures: transform(), foreground: { src: 'maps/foreground.png' }, flags: {} };
	original = { _id: 'original', author: 'gm', levels: ['level'], flags: {}, shape: { type: 'p' },
		elevation: 0, interface: false, hidden: false };
	scene = { id: 'scene', width: 8000, height: 6000, padding: 0, grid: { toObject: () => ({ size: 100 }) },
		getDimensions: () => ({ sceneRect: { x: 0, y: 0, width: 8000, height: 6000 } }),
		levels: new Map([['level', doc(level)]]), drawings: new Map([['original', doc(original)]]),
		tiles: new Map(), getFlag: () => undefined };
	const output = { version: 1, root: 'worlds/test', path: 'worlds/test/output.webp', bytes: 10, fingerprint: 'a'.repeat(64) };
	const after = { _id: 'tile', ...bounds, levels: ['level'], flags: {}, elevation: 0, sort: 0,
		rotation: 0, alpha: 1, locked: true, hidden: false,
		texture: { src: output.path, anchorX: 0, anchorY: 0, scaleX: 1, scaleY: 1, fit: 'fill', tint: '#ffffff' },
		restrictions: { light: false, weather: false }, occlusion: { modes: [], alpha: 0 } };
	replacement = { type: 'Tile', id: 'tile', before: null, staged: { ...structuredClone(after), hidden: true }, after };
	options = { token: 'operation', levelId: 'level', scope: { kind: 'selection', layerId: null }, output };
});
const archive = () => createOptimizationArchive(scene, ['original'], replacement, options);
const prepare = async (overrides = {}) => prepareOptimizationPlacement(scene, (await archive()).text,
	{ bounds, audience: 'player', isCurrent: () => current, ...overrides });
const approve = p => p.approve({ [p.review.action === 'restore' ? 'restorePlacement' : 'flattenToGround']: true, overlappingTileIds: p.review.overlappingTileIds });
function background() {
	bounds = { x: 0, y: 0, width: 8000, height: 6000 };
	const after = structuredClone(level);
	after.background = { ...after.background, src: options.output.path, tint: '#ffffff', color: '#ffffff' };
	replacement = { type: 'LevelBackground', id: 'level', before: structuredClone(level), staged: null, after };
}

test('neutral locked Tile placement binds exact bounds/elevation and reviewed ground-depth decision', async () => {
	const created = await archive(), p = await prepareOptimizationPlacement(scene, created.text,
		{ bounds, audience: 'player', isCurrent: () => current });
	assert.deepEqual(p.review.bounds, bounds);
	assert.equal(p.review.groundElevation, 0);
	assert.equal(await approve(p)((await readOptimizationArchive(created.text)).payload), true);
	assert.throws(() => p.approve({ flattenToGround: false, overlappingTileIds: [] }), /ground-stacking/);
	assert.equal(scene.tiles.size, 0);
});

test('GM Tile output must remain hidden; player Tile output cannot remain hidden', async () => {
	await assert.rejects(prepare({ audience: 'gm' }), /audience/);
	replacement.after.hidden = true;
	assert.equal((await prepare({ audience: 'gm' })).review.audience, 'gm');
	await assert.rejects(prepare(), /audience/);
});

test('Tile offsets/scale/rotation/tint/occlusion/restrictions/membership and locks cannot alter baked appearance', async () => {
	const baseline = structuredClone(replacement);
	for (const modify of [
		after => after.x++, after => after.rotation = 10, after => after.alpha = 0.5,
		after => after.locked = false, after => after.elevation = 1,
		after => after.texture.scaleX = 2, after => after.texture.anchorX = 0.5,
		after => after.texture.tint = '#000000', after => after.texture.fit = 'contain',
		after => after.occlusion.modes = [1], after => after.restrictions.light = true,
		after => after.flags.foundryshop = { layerId: 'ink' },
	]) {
		replacement = structuredClone(baseline); modify(replacement.after);
		replacement.staged = { ...structuredClone(replacement.after), hidden: true };
		await assert.rejects(prepare(), /neutral locked/);
	}
});

test('cross-elevation, interface and hidden originals refuse ground conversion', async () => {
	for (const patch of [{ elevation: 10 }, { interface: true }, { hidden: true }]) {
		const before = structuredClone(original); Object.assign(original, patch);
		await assert.rejects(prepare(), /exact Level-background/);
		Object.assign(original, before);
	}
});

test('public full-resolution background requires identity transforms without moving foreground or double tint', async () => {
	background();
	const p = await prepare();
	assert.equal(p.review.destination, 'LevelBackground');
	assert.equal(await approve(p)((await readOptimizationArchive((await archive()).text)).payload), true);
	assert.deepEqual(replacement.after.foreground, level.foreground);
	await assert.rejects(prepare({ audience: 'gm' }), /public/);
	await assert.rejects(prepare({ bounds: { ...bounds, width: 4000 } }), /full-scene/);
});

test('background shared nonidentity transforms and repeated tint/alpha-threshold changes refuse', async () => {
	level.textures.rotation = 30; background();
	await assert.rejects(prepare(), /inverse-mapping/);
	level.textures = transform(); background();
	replacement.after.background.tint = '#abcdef';
	await assert.rejects(prepare(), /neutral tint/);
	background(); replacement.after.background.alphaThreshold = 0.75;
	await assert.rejects(prepare(), /alpha-threshold/);
});

test('Tile overlap review lists conservative rotated bounds and exact acknowledgement is mandatory', async () => {
	scene.tiles.set('overlap', tileDoc({ _id: 'overlap', x: 0, y: 0, width: 50, height: 50, rotation: 45, elevation: 0, levels: ['level'] },
		{ x: -36, y: 0, width: 72, height: 72 }));
	scene.tiles.set('far', tileDoc({ _id: 'far', x: 10000, y: 10000, width: 10, height: 10, elevation: 0, levels: ['level'] }));
	const p = await prepare();
	assert.deepEqual(p.review.overlappingTileIds, ['overlap']);
	assert.throws(() => p.approve({ flattenToGround: true, overlappingTileIds: [] }), /exact listed/);
	assert.throws(() => p.approve({ flattenToGround: true, overlappingTileIds: ['overlap', 'overlap'] }), /exact listed/);
	approve(p);
});

test('owned staged Tile is ignored on resume; unrelated Tile edits/additions invalidate review', async () => {
	const created = await archive(), p = await prepareOptimizationPlacement(scene, created.text,
		{ bounds, audience: 'player', isCurrent: () => current });
	const verify = approve(p), payload = (await readOptimizationArchive(created.text)).payload;
	scene.tiles.set('tile', doc(replacement.staged));
	assert.equal(await verify(payload), true);
	scene.tiles.set('new', tileDoc({ _id: 'new', x: 0, y: 0, width: 10, height: 10, elevation: 0, levels: ['level'] }));
	await assert.rejects(verify(payload), /placement context/);
});

test('overlap uses native anchored/rotated shape bounds, not source-origin circles', async () => {
	scene.tiles.set('anchored', tileDoc({
		_id: 'anchored', x: 150, y: 50, width: 80, height: 40, rotation: 90,
		texture: { anchorX: 0.25, anchorY: 0.75 }, elevation: 0, levels: ['level'],
	}, { x: 140, y: 30, width: 40, height: 80 }));
	scene.tiles.set('centered', tileDoc({
		_id: 'centered', x: 140, y: 100, width: 100, height: 40, rotation: 0,
		texture: { anchorX: 0.5, anchorY: 0.5 }, elevation: 0, levels: ['level'],
	}, { x: 90, y: 80, width: 100, height: 40 }));
	const p = await prepare();
	assert.deepEqual(p.review.overlappingTileIds, ['centered']);
	scene.tiles.get('centered').shape.bounds.x = 111;
	const created = await archive();
	await assert.rejects(async () => approve(p)((await readOptimizationArchive(created.text)).payload), /placement context/);
});

test('missing, nonfinite and overflowing native Tile bounds fail closed; other Levels are excluded', async () => {
	const source = { _id: 'existing', x: 10, y: 20, width: 100, height: 100, elevation: 0, levels: ['level'] };
	for (const shapeBounds of [undefined, { x: NaN, y: 0, width: 1, height: 1 },
		{ x: Number.MAX_VALUE, y: 0, width: Number.MAX_VALUE, height: 1 }]) {
		scene.tiles.set('existing', { ...doc(source), shape: { bounds: shapeBounds } });
		await assert.rejects(prepare(), /finite positive/);
	}
	scene.tiles.set('existing', doc({ ...source, levels: ['anotherLevel'] }));
	assert.deepEqual((await prepare()).review.overlappingTileIds, []);
});

test('archive tampering, cancelled review, Scene bounds change and absent guards refuse acceptance', async () => {
	const created = await archive(), p = await prepare(), verify = approve(p), payload = (await readOptimizationArchive(created.text)).payload;
	payload.originals[0].name = 'changed';
	await assert.rejects(verify(payload), /different reviewed/);
	current = false;
	await assert.rejects(verify(payload), /context/);
	current = true;
	scene.getDimensions = () => ({ sceneRect: { x: 0, y: 0, width: 4000, height: 6000 } });
	assert.throws(() => approve(p), /placement context/);
	await assert.rejects(prepareOptimizationPlacement(scene, created.text, { bounds, audience: 'player' }), /explicit/);
});

test('private layer ancestry cannot be flattened into a public Tile or background', async () => {
	original.flags.foundryshop = { layerId: 'ink' };
	const layers = { version: 1, revision: 0, nodes: [
		{ id: 'parent', kind: 'group', name: 'Private group', parentId: null, playerAllowed: false, locked: false, defaults: {} },
		{ id: 'ink', kind: 'layer', name: 'Ink', parentId: 'parent', playerAllowed: true, locked: false, defaults: {} },
	], presets: [] };
	scene.getFlag = (namespace, key) => key === 'layers' ? layers : undefined;
	await assert.rejects(prepare(), /GM-private/);
	replacement.after.hidden = true;
	assert.equal((await prepare({ audience: 'gm' })).review.audience, 'gm');
	background();
	await assert.rejects(prepare(), /GM-private/);
});

test('placement adapter composes with archive-bound strict native verifier for apply/restore', async () => {
	const created = await archive(), p = await prepareOptimizationPlacement(scene, created.text,
		{ bounds, audience: 'player', isCurrent: () => current });
	globalThis.getDocumentClass = () => class {
		constructor(source) { this.source = structuredClone(source); }
		toObject() { return structuredClone(this.source); }
	};
	const verifyNative = await optimizationNativeVerifier(scene, created.text, {
		isCurrent: () => current, verifyPlacement: approve(p),
	});
	const payload = (await readOptimizationArchive(created.text)).payload;
	assert.equal(await verifyNative(payload, { action: 'apply', phase: 'assets-verified' }), true);
	scene.tiles.set('tile', doc(replacement.staged));
	assert.equal(await verifyNative(payload, { action: 'apply', phase: 'replacement-staged' }), true);
	assert.equal(await verifyNative(payload, { action: 'restore', phase: 'originals-staged' }), true);
	scene.tiles.set('new', tileDoc({ _id: 'new', x: 0, y: 0, width: 10, height: 10, elevation: 0, levels: ['level'] }));
	await assert.rejects(verifyNative(payload, { action: 'apply', phase: 'sources-removed' }), /placement context/);
});

test('Restore permits exact archived private originals under public Tile/background replacements without new exposure approval', async () => {
	original.flags.foundryshop = { layerId: 'ink' };
	const layers = { version: 1, revision: 1, nodes: [
		{ id: 'ink', kind: 'layer', name: 'Imported ink', parentId: null, playerAllowed: false, locked: false, defaults: {} },
	], presets: [] };
	scene.getFlag = (namespace, key) => key === 'layers' ? layers : undefined;
	for (const destination of ['Tile', 'LevelBackground']) {
		if (destination === 'LevelBackground') background();
		await assert.rejects(prepare(), /GM-private/);
		const created = await archive(), p = await prepare({ action: 'restore' });
		assert.equal(p.review.action, 'restore');
		assert.throws(() => p.approve({ flattenToGround: true, overlappingTileIds: [] }), /Restore placement/);
		const accepted = approve(p), payload = (await readOptimizationArchive(created.text)).payload;
		assert.equal(await accepted(payload), true);
		const changed = structuredClone(payload); changed.originals[0].hidden = true;
		await assert.rejects(accepted(changed), /different reviewed archive/);
	}
});

test('Restore does not impose new background Bake bounds/transforms but still binds native Scene and Tile context', async () => {
	background();
	const created = await archive();
	scene.getDimensions = () => ({ sceneRect: { x: 0, y: 0, width: 1000, height: 700 } });
	const p = await prepareOptimizationPlacement(scene, created.text, { bounds, audience: 'player',
		action: 'restore', isCurrent: () => current }), accepted = approve(p);
	assert.equal(await accepted((await readOptimizationArchive(created.text)).payload), true);
	scene.getDimensions = () => ({ sceneRect: { x: 0, y: 0, width: 1001, height: 700 } });
	await assert.rejects(accepted((await readOptimizationArchive(created.text)).payload), /placement context/);
	await assert.rejects(prepare({ action: 'unknown' }), /supported action/);
});

test('review snapshots caller bounds and public overlap lists cannot alter authoritative acceptance', async () => {
	const created = await archive(), p = await prepareOptimizationPlacement(scene, created.text,
		{ bounds, audience: 'player', isCurrent: () => current });
	bounds.width = 10;
	p.review.bounds.width = 1;
	p.review.overlappingTileIds.push('invented');
	assert.throws(() => approve(p), /exact listed/);
	const verify = p.approve({ flattenToGround: true, overlappingTileIds: [] });
	assert.equal(await verify((await readOptimizationArchive(created.text)).payload), true);
});

test('large/long-axis placement has no fixed module image-size cap', async () => {
	bounds = { x: 0, y: 0, width: 20000, height: 1000 };
	Object.assign(replacement.after, bounds);
	replacement.staged = { ...structuredClone(replacement.after), hidden: true };
	assert.deepEqual((await prepare()).review.bounds, bounds);
});
