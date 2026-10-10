import test from 'node:test';
import assert from 'node:assert/strict';
import { captureNativeDrawingCacheSnapshot, createNativeDrawingCacheCapture } from '../scripts/render_native_snapshot.js';

class Graphics {}
class Drawing {}
const transform = () => ({ position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, pivot: { x: 0, y: 0 },
	skew: { x: 0, y: 0 }, rotation: 0, alpha: 1, visible: true, renderable: true });
function fixture() {
	const stage = { ...transform(), parent: null };
	stage.scale = { x: 0.5, y: 0.5 };
	stage.position = { x: 128, y: 128 };
	stage.pivot = { x: 300, y: 400 };
	const primary = { ...transform(), parent: stage, children: [], sortDirty: false };
	const scene = { id: 'scene', levels: new Set(['level']), drawings: new Map() };
	for (const id of ['b', 'a']) {
		const source = { x: 10, y: 20, shape: { width: 40, height: 20, type: 'r' },
			rotation: 0, elevation: 0, sort: 0, levels: ['level'], interface: false, hidden: false,
			text: '', fillType: 1, texture: null, flags: {} };
		const document = { ...source, id, parent: scene, documentName: 'Drawing',
			getFlag: () => undefined, toObject: () => structuredClone({ ...source, _id: id }) };
		const shape = Object.assign(new Graphics(), transform(), { parent: primary, children: [],
			angle: 0, elevation: 0, sort: 0, sortLayer: 600, zIndex: 0 });
		shape.position = { x: 30, y: 30 };
		shape.pivot = { x: 20, y: 10 };
		shape.object = Object.assign(new Drawing(), { shape, document, renderFlags: new Set() });
		primary.children.push(shape);
		scene.drawings.set(id, document);
	}
	const canvas = { ready: true, stage, primary, scene, level: { id: 'level' },
		drawings: { controlled: [], preview: { children: [] } },
		app: { renderer: { screen: { width: 256, height: 256 }, resolution: 1, gl: { isContextLost: () => false } } } };
	const input = { canvas, GraphicsClass: Graphics, DrawingClass: Drawing, assetRevision: '1', rendererRevision: '1',
		options: { width: 256, height: 256, resolution: 1, maxBytes: 524288, reserveBytes: 262144, maxAxis: 4096 } };
	return { input, canvas, shape: primary.children[0], document: scene.drawings.get('b') };
}

test('complete stack preserves native ties and barriers while detaching authoritative artwork and viewport', () => {
	const { input, canvas } = fixture();
	const barrier = { ...transform(), elevation: -Infinity, sort: -Infinity };
	canvas.primary.children.unshift(barrier);
	const result = captureNativeDrawingCacheSnapshot(input);
	assert.deepEqual(result.stack.map(e => e.kind), ['barrier', 'drawing', 'drawing']);
	assert.deepEqual([...result.identities], [['slot:1', 'b'], ['slot:2', 'a']]);
	assert.deepEqual([...result.artwork.values()].map(e => e.id), ['b', 'a']);
	assert.equal(result.context.x, -22);
	assert.equal(result.context.y, -72);
	result.artwork.get('slot:1').data.shape.width = 100;
	result.options.width = 20;
	assert.equal(canvas.scene.drawings.get('b').shape.width, 40);
	assert.equal(input.options.width, 256);
	assert.equal(canvas.primary.children[0], barrier);
});

test('text, visibility, hidden, Level, descendants and altered display state remain ordered barriers', () => {
	for (const [modify, reason] of [
		({ document }) => { document.text = 'label'; },
		({ shape }) => { shape.visible = false; },
		({ document }) => { document.hidden = true; },
		({ document }) => { document.levels = ['other']; },
		({ shape }) => { shape.children = [{}]; },
		({ shape }) => { shape.alpha = 0.5; },
		({ shape }) => { shape.object = { ...shape.object }; },
	].map((modify, i) => [modify, ['text-or-descendants', 'not-rendered', 'hidden-alpha-unverified',
		'other-level', 'text-or-descendants', 'native-state-mismatch', 'custom-drawing'][i]])) {
		const f = fixture();
		modify(f);
		const result = captureNativeDrawingCacheSnapshot(f.input);
		assert.equal(result.stack[0].cacheable, false);
		assert.equal(result.excluded[0].reason, reason);
		assert.equal(result.artwork.has('slot:0'), false);
		assert.equal(result.stack[1].id, 'slot:1');
	}
});

test('editing, pending refresh, identity mismatch, context loss and unsupported viewport explicitly defer capture', () => {
	for (const modify of [
		f => { f.canvas.drawings.controlled.push(f.shape.object); },
		f => { f.canvas.drawings.preview.children.push({}); },
		f => { f.shape.object.renderFlags.add('refreshShape'); },
		f => { f.canvas.scene.drawings.delete('b'); },
		f => { f.canvas.app.renderer.gl.isContextLost = () => true; },
		f => { f.canvas.stage.scale.y = 2; },
		f => { f.canvas.primary.position.x = 1; },
		f => { f.input.options.resolution = 2; },
		f => { f.input.assetRevision = ''; },
		f => { f.canvas.primary.sortDirty = true; },
	]) {
		const f = fixture();
		modify(f);
		assert.throws(() => captureNativeDrawingCacheSnapshot(f.input));
	}
});

test('borrowed textures are captured without loading, and divergent identities fail closed', () => {
	const f = fixture(), texture = { valid: true, baseTexture: {} };
	for (const shape of f.canvas.primary.children) {
		const doc = shape.object.document, source = doc.toObject();
		source.fillType = doc.fillType = 2;
		source.texture = doc.texture = 'map.webp';
		doc.toObject = () => structuredClone(source);
		shape.object.texture = texture;
	}
	const snapshot = captureNativeDrawingCacheSnapshot(f.input);
	assert.equal(snapshot.textures.get('map.webp'), texture);
	f.canvas.primary.children[1].object.texture = { valid: true, baseTexture: {} };
	assert.throws(() => captureNativeDrawingCacheSnapshot(f.input), /disagree/);
	f.canvas.primary.children[1].object.texture = { valid: false };
	assert.throws(() => captureNativeDrawingCacheSnapshot(f.input), /not ready/);
});

test('capture rejects excessive coordinate snapshots before exporting sources', () => {
	const f = fixture();
	f.document.shape.points = new Array(100001).fill(0);
	f.document.toObject = () => assert.fail('Oversized sources must not be exported.');
	assert.throws(() => captureNativeDrawingCacheSnapshot(f.input), /limits exceeded/);
});

test('cache snapshots use prepared document coordinates without changing stored export semantics', async () => {
	const { exportProjectDrawing } = await import('../scripts/layers/project_transfer_service.js');
	const f = fixture(), source = f.document.toObject();
	f.document.toObject = (stored = true) => ({ ...structuredClone(source), y: stored ? -100 : f.document.y,
		fillColor: stored ? '#abcdef' : { toString: () => '#abcdef' } });
	const snapshot = captureNativeDrawingCacheSnapshot(f.input);
	assert.equal(snapshot.artwork.get('slot:0').data.y, 20);
	assert.equal(snapshot.artwork.get('slot:0').data.fillColor, '#abcdef');
	assert.equal(exportProjectDrawing(f.document).data.y, -100);
	assert.equal(f.document.y, 20);
});

test('inherited opacity refuses capture rather than fading isolated runs with different compositing semantics', () => {
	for (const target of ['stage', 'primary']) {
		const f = fixture();
		f.canvas[target].alpha = 0.5;
		assert.throws(() => captureNativeDrawingCacheSnapshot(f.input), /transform or visibility/);
	}
});

test('shadow currentness catches unhooked source, viewport, geometry, stack and revision changes', () => {
	for (const modify of [
		f => { f.canvas.stage.pivot.x++; },
		f => { f.input.assetRevision = '2'; },
		f => { f.input.rendererRevision = '2'; },
		f => { f.canvas.primary.children.reverse(); },
		f => { f.shape.geometry = {}; },
		f => { f.shape.geometry.dirty++; },
		f => { f.document.shape.width++; },
		f => { const source = f.document.toObject(); f.document.toObject = () => ({ ...source, strokeWidth: 30 }); },
		f => { f.shape.visible = false; },
		f => { f.canvas.level = { id: 'level' }; },
	]) {
		const f = fixture();
		f.shape.geometry = { dirty: 0, batchDirty: 0, clearDirty: 0 };
		const snapshot = createNativeDrawingCacheCapture(() => f.input)();
		assert.equal(snapshot.isCurrent(), true);
		modify(f);
		assert.equal(snapshot.isCurrent(), false);
	}
});

test('shadow currentness surfaces editing/context errors and snapshots an immutable baseline', () => {
	const f = fixture(), capture = createNativeDrawingCacheCapture(() => f.input);
	const snapshot = capture();
	snapshot.artwork.get('slot:0').data.x = 999;
	assert.equal(snapshot.isCurrent(), true);
	f.canvas.drawings.controlled.push(f.shape.object);
	assert.throws(() => snapshot.isCurrent(), /edited/);
	f.canvas.drawings.controlled.length = 0;
	f.canvas.app.renderer.gl.isContextLost = () => true;
	assert.throws(() => snapshot.isCurrent(), /context loss/);
});

test('shadow currentness catches borrowed texture revisions and same-path replacement', () => {
	const f = fixture(), texture = { valid: true, width: 32, height: 32, baseTexture: { _updateID: 1, uid: 1 } };
	const source = f.document.toObject();
	source.fillType = f.document.fillType = 2;
	source.texture = f.document.texture = 'map.webp';
	f.document.toObject = () => structuredClone(source);
	f.shape.object.texture = texture;
	const capture = createNativeDrawingCacheCapture(() => f.input);
	let snapshot = capture();
	assert.equal(snapshot.isCurrent(), true);
	texture.baseTexture._updateID++;
	assert.equal(snapshot.isCurrent(), false);
	snapshot = capture();
	texture.frame = { x: 1, y: 0, width: 32, height: 32 };
	assert.equal(snapshot.isCurrent(), false);
	snapshot = capture();
	f.shape.object.texture = { ...texture };
	assert.equal(snapshot.isCurrent(), false);
});
