import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createBakeReplacement, prepareBakeOutputFile } from '../scripts/layers/bake_replacement.js';
import { publicationBackgroundSnapshot } from '../scripts/publication_background.js';

const doc = source => ({ toObject: () => structuredClone(source) });
let scene, level, rendered, output, options, current, normalize, constructions;
function nativeClass(type) {
	return class {
		constructor(input, context) {
			constructions.push({ type, context });
			this.source = structuredClone(input);
			if (type === 'Tile') {
				if (!Object.hasOwn(this.source, 'name')) this.source.name = undefined;
				this.source.x = Math.round(this.source.x);
				this.source.y = Math.round(this.source.y);
				this.source.texture.alphaThreshold ??= 0.75;
				this.source.video ??= { loop: true, autoplay: true, volume: 0 };
			}
			normalize?.(this.source, type);
		}
		toObject() { return structuredClone(this.source); }
	};
}
beforeEach(() => {
	current = true; normalize = null; constructions = [];
	globalThis.game = { user: { isGM: true }, i18n: { localize: key => key } };
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.getDocumentClass = nativeClass;
	level = { _id: 'level001', name: 'Ground', flags: {}, sort: 5,
		background: { src: 'maps/original.png', color: '#123456', tint: '#abcdef', alphaThreshold: 0.75 },
		elevation: { bottom: -10, top: 20 }, foreground: { src: 'maps/foreground.png' }, fog: { src: 'maps/fog.png' },
		textures: { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0, fit: 'fill', scaleX: 1, scaleY: 1, rotation: 0 },
		visibility: { levels: [] } };
	scene = { levels: new Map([[level._id, doc(level)]]), tiles: new Map(),
		getDimensions: () => ({ sceneRect: { x: 200, y: 100, width: 8000, height: 6000 } }) };
	const bounds = { x: -42, y: 30, width: 203, height: 186 };
	rendered = { ...bounds, bounds, review: { destination: 'tile', bounds, width: 203, height: 186, format: 'png' } };
	output = { version: 1, root: 'worlds/test', path: 'worlds/test/bake-token.png', bytes: 58, fingerprint: 'a'.repeat(64) };
	options = { levelId: level._id, output, rendered, audience: 'player', replacementId: 'BakeTile00000001',
		sort: 7, isCurrent: () => current };
});
const create = extra => createBakeReplacement(scene, { ...options, ...extra });
function background() {
	const snapshot = publicationBackgroundSnapshot(scene, level._id);
	rendered = { ...snapshot.rect, bounds: snapshot.rect, background: snapshot,
		review: { destination: 'background', bounds: snapshot.rect, width: 8000, height: 6000, format: 'png' } };
	options = { ...options, rendered, replacementId: undefined, sort: undefined };
}
function png() {
	const bytes = new Uint8Array(58), view = new DataView(bytes.buffer);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); view.setUint32(8, 13);
	bytes.set([... 'IHDR'].map(c => c.charCodeAt()), 12); view.setUint32(16, 203); view.setUint32(20, 186);
	view.setUint32(33, 1); bytes.set([... 'IDAT'].map(c => c.charCodeAt()), 37);
	bytes.set([... 'IEND'].map(c => c.charCodeAt()), 50); return bytes;
}

test('exact bytes produce a deterministic validated output reference; invalid MIME/token/root refuse', async () => {
	const blob = new Blob([png()], { type: 'image/png' });
	const file = await prepareBakeOutputFile(blob, 'worlds/test', 'token');
	assert.equal(file.path, output.path); assert.equal(file.bytes, blob.size);
	assert.match(file.fingerprint, /^[a-f0-9]{64}$/);
	assert.deepEqual(await prepareBakeOutputFile(blob, 'worlds/test', 'token'), file);
	await assert.rejects(prepareBakeOutputFile(new Blob([png()], { type: 'image/webp' }), 'worlds/test', 'token'), /MIME/);
	await assert.rejects(prepareBakeOutputFile(blob, 'worlds/test', '../token'), /token/);
	await assert.rejects(prepareBakeOutputFile(blob, '../test', 'token'), /Folder|folder/);
});

test('public Tile is neutral, locked, ground-aligned and exact-crop; only staged hidden differs', () => {
	const replacement = create(), after = replacement.after;
	assert.equal(replacement.type, 'Tile'); assert.equal(after.elevation, -10); assert.equal(after.sort, 7);
	assert.equal(after.name, '');
	assert.equal(after.texture.anchorX, 0); assert.equal(after.texture.anchorY, 0);
	assert.equal(after.texture.src, output.path); assert.equal(after.texture.alphaThreshold, 0.75);
	assert.equal(after.x, -42); assert.equal(after.locked, true); assert.equal(after.hidden, false);
	assert.deepEqual(after.flags, {}); assert.deepEqual(after.levels, [level._id]);
	assert.deepEqual(replacement.staged, { ...after, hidden: true });
	assert.equal(scene.tiles.size, 0);
	assert.ok(constructions.every(({ context }) => context.parent === scene && context.strict === true));
});

test('GM Tile stays hidden in both staged and final sources; returned sources do not share references', () => {
	const replacement = create({ audience: 'gm' });
	assert.deepEqual(replacement.staged, replacement.after);
	replacement.staged.texture.tint = '#000000';
	assert.equal(replacement.after.texture.tint, '#ffffff');
	assert.equal(create().after.texture.tint, '#ffffff');
});

test('identity collisions, absent sort, invalid native identity and mixed background options refuse', () => {
	scene.tiles.set(options.replacementId, {});
	assert.throws(create, /unoccupied/); scene.tiles.clear();
	for (const patch of [{ replacementId: 'short' }, { replacementId: 'Bake_Tile0000001' },
		{ sort: undefined }, { sort: 0.5 }]) assert.throws(() => create(patch), /identity|integer/);
	background();
	assert.throws(() => create({ audience: 'gm' }), /public/);
	assert.throws(() => create({ sort: 0 }), /identity\/sort/);
});

test('full-scene background changes only source/color/tint and preserves all original native settings', () => {
	background();
	const replacement = create();
	assert.deepEqual(replacement.before, level);
	assert.deepEqual(replacement.after, { ...level, background: {
		...level.background, src: output.path, color: '#ffffff', tint: '#ffffff' } });
	assert.equal(replacement.staged, null);
	replacement.before.foreground.src = 'changed';
	assert.equal(replacement.after.foreground.src, level.foreground.src);
	assert.equal(scene.levels.get(level._id).toObject().background.src, 'maps/original.png');
});

test('changed background/Scene snapshot and shared nonidentity transforms refuse', () => {
	background(); level.background.tint = '#000000';
	assert.throws(create, /snapshot/);
	background(); scene.getDimensions = () => ({ sceneRect: { x: 0, y: 0, width: 8000, height: 6000 } });
	assert.throws(create, /snapshot/);
	level.textures.rotation = 10; background();
	assert.throws(create, /identity-transform/);
});

test('dimensions, crop, encoding and destination cannot silently normalize or resize', () => {
	for (const patch of [
		{ width: 200 }, { bounds: { ...rendered.bounds, width: 203.5 } },
		{ bounds: { ...rendered.bounds, x: Infinity } },
		{ review: { ...rendered.review, width: 200 } }, { review: { ...rendered.review, format: 'webp' } },
		{ review: { ...rendered.review, destination: 'region' } },
	]) assert.throws(() => create({ rendered: { ...rendered, ...patch } }), /exact reviewed/);
	rendered.bounds.width = rendered.width = rendered.review.width = 20000;
	assert.equal(create().after.width, 20000);
});

test('native normalization, unreviewed metadata and unstable native round trips refuse', () => {
	rendered.bounds.x = -42.5;
	assert.throws(create, /normalization/);
	rendered.bounds.x = -42;
	normalize = source => source.x = 0;
	assert.throws(create, /normalization/);
	normalize = source => source.flags.foreign = { renderer: true };
	assert.throws(create, /renderer metadata/);
	normalize = source => { if (source.video) source.video.volume++; };
	assert.throws(create, /round-trip/);
	background(); normalize = source => source.name = 'normalized';
	assert.throws(create, /normalization/);
});

test('GM, Level, finite ground, currentness and changes during construction are rechecked', () => {
	assert.throws(() => create({ isCurrent: undefined }), /current review/);
	current = false; assert.throws(create, /current review/); current = true;
	game.user.isGM = false; assert.throws(create, /GM access/); game.user.isGM = true;
	assert.throws(() => create({ levelId: 'absent' }), /existing Level/);
	level.elevation.bottom = Infinity; assert.throws(create, /ground elevation/); level.elevation.bottom = -10;
	normalize = () => level.sort++;
	assert.throws(create, /context changed/);
});
