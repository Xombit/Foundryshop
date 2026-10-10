import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prepareMaterialSelection, applyMaterialSelection } from '../scripts/material_selection.js';

let scene, documents, config, writes;
beforeEach(() => {
	globalThis.game = { user: { isGM: true }, i18n: { localize: key => key } };
	config = { fillType: 2, texture: 'stone.png', fillColor: '#abcdef', fillAlpha: 0.6, materialRepeat: 2 };
	writes = [];
	scene = { grid: { type: 1, size: 100 }, drawings: new Map(), getFlag: () => undefined,
		async updateEmbeddedDocuments(type, updates) {
			assert.equal(type, 'Drawing');
			writes.push(structuredClone(updates));
			for (const update of updates) {
				const data = this.drawings.get(update._id).data;
				data._stats.modifiedTime++;
				for (const [key, value] of Object.entries(update)) {
					if (key === 'flags.foundryshop.materialRepeat') {
						data.flags.foundryshop.materialRepeat = value;
					} else if (key === 'flags.foundryshop.-=materialRepeat') {
						delete data.flags.foundryshop.materialRepeat;
					} else data[key] = value;
				}
			}
		},
	};
	documents = ['one', 'two'].map(id => {
		const data = { _id: id, fillType: 1, fillColor: '#ffffff', fillAlpha: 1, texture: null,
			_stats: { modifiedTime: 1 },
			x: 23, rotation: 42, shape: { type: 'r', width: 70, height: 40 }, text: 'Hall',
			strokeColor: '#123456', strokeWidth: 2, flags: { foundryshop: { provenance: { source: 'example' } } } };
		const document = { id, parent: scene, data, locked: false, canUserModify: () => true,
			getFlag: (namespace, key) => data.flags[namespace]?.[key], toObject: () => structuredClone(data) };
		scene.drawings.set(id, document);
		return document;
	});
});

test('explicit material application batches exact fills and preserves unrelated artwork data', async () => {
	const before = structuredClone(documents[0].data);
	const plan = prepareMaterialSelection(scene, documents, config);
	let checked = 0;
	assert.equal(await applyMaterialSelection(plan, { verify: async path => { assert.equal(path, 'stone.png'); checked++; } }), 2);
	assert.equal(checked, 1);
	assert.equal(writes.length, 1);
	assert.equal(documents[0].data.flags.foundryshop.materialRepeat, 200);
	for (const field of ['shape', 'x', 'rotation', 'text', 'strokeColor', 'strokeWidth']) {
		assert.deepEqual(documents[0].data[field], before[field]);
	}
	assert.deepEqual(documents[0].data.flags.foundryshop.provenance, before.flags.foundryshop.provenance);
	const repeat = prepareMaterialSelection(scene, documents, config);
	assert.equal(await applyMaterialSelection(repeat, { verify: async () => {} }), 0);
	assert.equal(writes.length, 1);
});

test('solid and no-fill replacement clear repeat metadata and texture without touching stamps', async () => {
	for (const fillType of [1, 0]) {
		documents[0].data.flags.foundryshop.materialRepeat = 123;
		const plan = prepareMaterialSelection(scene, documents, { ...config, fillType });
		await applyMaterialSelection(plan);
		assert.equal(documents[0].data.texture, null);
		assert.equal(documents[0].data.flags.foundryshop.materialRepeat, undefined);
		assert.equal(documents[0].data.fillType, fillType);
	}
	documents[1].data.flags.foundryshop.imageStamp = 1;
	assert.throws(() => prepareMaterialSelection(scene, documents, config), /ImageStamp/);
});

test('permissions, document/layer locks, pending imports and missing patterns block the whole batch', () => {
	documents[1].locked = true;
	assert.throws(() => prepareMaterialSelection(scene, documents, config), /SelectionLocked/);
	documents[1].locked = false;
	documents[1].canUserModify = () => false;
	assert.throws(() => prepareMaterialSelection(scene, documents, config), /SelectionLocked/);
	documents[1].canUserModify = () => true;
	documents[1].data.flags.foundryshop.importStaging = 'pending';
	assert.throws(() => prepareMaterialSelection(scene, documents, config), /SelectionLocked/);
	delete documents[1].data.flags.foundryshop.importStaging;
	documents[1].data.flags.foundryshop.layerId = 'locked';
	scene.getFlag = () => ({ version: 1, revision: 0, nodes: [
		{ id: 'locked', kind: 'layer', name: 'Locked', locked: true, playerAllowed: false, parentId: null, defaults: {} },
	] });
	assert.throws(() => prepareMaterialSelection(scene, documents, config), /SelectionLocked/);
	assert.throws(() => prepareMaterialSelection(scene, documents, { ...config, texture: null }), /MissingTexture/);
	game.user.isGM = false;
	assert.throws(() => prepareMaterialSelection(scene, documents, config), /SelectionLocked/);
	assert.equal(writes.length, 0);
});

test('asynchronous texture verification rejects changed artwork, deletion, grid, locks and context', async () => {
	const mutations = [
		() => { documents[0].data.text = 'Changed'; },
		() => { scene.drawings.delete('two'); },
		() => { scene.grid.size = 200; },
		() => { documents[1].locked = true; },
	];
	for (const mutate of mutations) {
		const saved = documents.map(document => structuredClone(document.data));
		const plan = prepareMaterialSelection(scene, documents, config);
		await assert.rejects(applyMaterialSelection(plan, { verify: async () => mutate() }), /SelectionChanged|SelectionLocked/);
		documents.forEach((document, i) => {
			Object.assign(document.data, saved[i]); document.locked = false; scene.drawings.set(document.id, document);
		});
		scene.grid.size = 100;
	}
	const plan = prepareMaterialSelection(scene, documents, config);
	await assert.rejects(applyMaterialSelection(plan, { checkContext: () => { throw new Error('stale selection'); } }), /stale/);
	await assert.rejects(applyMaterialSelection(plan, { verify: async () => { throw new Error('decode failure'); } }), /decode/);
	assert.equal(writes.length, 0);
});

test('failed, partial or normalized writes are explicit errors, never success or destructive rollback', async () => {
	const plan = prepareMaterialSelection(scene, documents, config);
	scene.updateEmbeddedDocuments = async () => { documents[0].data.fillColor = '#000000'; };
	await assert.rejects(applyMaterialSelection(plan, { verify: async () => {} }), /ApplyFailed/);
	assert.equal(documents[0].data.fillColor, '#000000', 'no rollback overwrites concurrent data');
	const next = prepareMaterialSelection(scene, documents, config);
	scene.updateEmbeddedDocuments = async () => { throw new Error('server refused'); };
	await assert.rejects(applyMaterialSelection(next, { verify: async () => {} }), /server refused/);
});

test('gridless application uses 100px and empty or duplicate selections are refused', async () => {
	scene.grid = { type: 0, size: 350 };
	await applyMaterialSelection(prepareMaterialSelection(scene, documents, config), { verify: async () => {} });
	assert.equal(documents[0].data.flags.foundryshop.materialRepeat, 200);
	assert.throws(() => prepareMaterialSelection(scene, [], config), /SelectArtwork/);
	assert.throws(() => prepareMaterialSelection(scene, [documents[0], documents[0]], config), /SelectArtwork/);
});
