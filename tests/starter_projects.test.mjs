import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { starterProjects, starterProject } from '../scripts/starter_projects.js';
import { validateProjectPackage, parseProjectPackage, serializeProjectPackage } from '../scripts/layers/project_package.js';
import { effectiveLayerGate } from '../scripts/layers/layer_tree_store.js';
import { prepareArtworkSnapshot } from '../scripts/artwork_renderer.js';
import { STARTER_MATERIALS } from '../scripts/starter_materials.js';

beforeEach(() => {
	const translations = JSON.parse(readFileSync(new URL('../languages/en.json', import.meta.url), 'utf8'));
	globalThis.game = { version: '14.365', i18n: { localize: key => translations[key] ?? key } };
	globalThis.getDocumentClass = () => ({ metadata: { schemaVersion: '14.355' } });
});

test('two complete examples are detached bounded JSON projects with shipped assets and native fonts', () => {
	const examples = starterProjects();
	assert.equal(examples.length, 2);
	assert.deepEqual(starterProjects(), examples);
	for (const { id, project } of examples) {
		assert.deepEqual(validateProjectPackage(project), project);
		assert.deepEqual(parseProjectPackage(serializeProjectPackage(project)), project);
		assert.ok(project.drawings.length >= 15 && project.drawings.length <= 60);
		assert.equal(project.tree.nodes.length, 7);
		assert.equal(project.tree.presets.length, 3);
		assert.equal(project.recovery.length, 0);
		assert.deepEqual(project.dependencies.modules, []);
		assert.ok(project.dependencies.assets.length >= 3);
		assert.ok(project.dependencies.assets.every(asset => STARTER_MATERIALS.some(material => material.path === asset)));
		assert.ok(project.dependencies.fonts.includes('Signika'));
		assert.ok(project.dependencies.fonts.every(font => ['Signika', 'Amiri', 'Modesto Condensed'].includes(font)));
		assert.ok(project.bounds.width < 2500 && project.bounds.height < 2000);
		assert.doesNotThrow(() => prepareArtworkSnapshot(project.drawings));
		for (const { data, layerId } of project.drawings) {
			assert.ok(project.tree.nodes.some(node => node.id === layerId && node.kind === 'layer'));
			assert.equal(data.hidden, false);
			assert.equal(data.locked, false);
			assert.deepEqual(data.levels, []);
			if (data.texture) assert.ok(data.flags.foundryshop.materialRepeat > 0);
		}
		project.drawings[0].data.x = 9999;
		assert.notEqual(starterProject(id).drawings[0].data.x, 9999);
	}
	assert.throws(() => starterProject('missing'), /Unknown example/);
});

test('example layer sorts and full presentation snapshots demonstrate overview, terrain and notes explicitly', () => {
	for (const { project } of starterProjects()) {
		const { tree, drawings } = project;
		for (const [index, id] of ['ground', 'structure', 'features', 'labels', 'notes'].entries()) {
			const members = drawings.filter(drawing => drawing.layerId === id);
			assert.ok(members.length > 0);
			if (index) {
				const earlier = drawings.filter(drawing => ['ground', 'structure', 'features', 'labels', 'notes'].indexOf(drawing.layerId) < index);
				assert.ok(Math.min(...members.map(entry => entry.data.sort)) > Math.max(...earlier.map(entry => entry.data.sort)));
			}
		}
		assert.equal(effectiveLayerGate(tree, 'notes', node => node.playerAllowed), false);
		for (const preset of tree.presets) {
			assert.equal(preset.entries.length, tree.nodes.length);
			const gates = new Map(preset.entries.map(entry => [entry.nodeId, entry.playerAllowed]));
			const visible = ['ground', 'structure', 'features', 'labels', 'notes'].filter(id =>
				effectiveLayerGate(tree, id, node => gates.get(node.id)));
			assert.deepEqual(visible, preset.id === 'terrain' ? ['ground'] : preset.id === 'overview'
				? ['ground', 'structure', 'features', 'labels'] : ['ground', 'structure', 'features', 'labels', 'notes']);
		}
	}
});
