import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseStraightLineConsolidation } from '../scripts/layers/line_consolidation_analysis.js';

export function lineProject() {
	const entry = (id, x) => ({ id, layerId: null, data: {
		name: '', x, y: 32, elevation: 0, sort: x, levels: ['ground'], rotation: 0, bezierFactor: 0,
		shape: { type: 'p', width: 40, height: 0, points: [0, 0, 40, 0], radius: null },
		fillType: 0, fillColor: '#ffffff', fillAlpha: 0, strokeWidth: 8, strokeColor: '#8040ff', strokeAlpha: 1,
		texture: null, text: '', fontFamily: '', fontSize: 48, textColor: '#ffffff', textAlpha: 1,
		hidden: false, locked: false, interface: false, flags: {},
	} });
	return { format: 'foundryshop-drawing-project', version: 1, scope: 'full', coordinateSpace: 'scene-pixels',
		name: 'Lines', source: { foundry: '14.365', drawingSchema: '14.355' },
		tree: { version: 1, revision: 0, nodes: [], presets: [] }, drawings: [entry('a', 16), entry('b', 56), entry('c', 96)],
		recovery: [], dependencies: {}, bounds: null };
}
test('analysis joins consecutive opaque collinear segments with exact endpoints and detached source data', () => {
	const p = lineProject(), before = structuredClone(p);
	const result = analyseStraightLineConsolidation(p, ['a', 'b', 'c'], ['c', 'a', 'b']);
	assert.equal(result.strategy, 'analysis-only');
	assert.equal(result.potentialDocumentReduction, 2);
	assert.equal(result.potentialRemaining, 1);
	assert.deepEqual(result.candidates[0].sourceIds, ['a', 'b', 'c']);
	assert.deepEqual(result.candidates[0].data.shape.points, [0, 0, 120, 0]);
	assert.equal(result.candidates[0].data.x, 16);
	assert.equal(result.candidates[0].data.sort, 16);
	result.candidates[0].data.strokeWidth = 100;
	assert.deepEqual(p, before);
});
test('native barriers and unselected strokes prevent cross-stack merging', () => {
	const p = lineProject();
	assert.equal(analyseStraightLineConsolidation(p, ['a', null, 'b', null, 'c'], ['a', 'b', 'c']).potentialDocumentReduction, 0);
	assert.equal(analyseStraightLineConsolidation(p, ['a', 'b', 'c'], ['a', 'c']).potentialDocumentReduction, 0);
});
test('unsupported style, metadata, curve, context and near connections are explicitly retained', () => {
	for (const modify of [
		d => { d.strokeAlpha = 0.5; }, d => { d.bezierFactor = 0.5; },
		d => { d.rotation = 30; }, d => { d.hidden = true; }, d => { d.locked = true; },
		d => { d.flags = { custom: { keep: true } }; }, d => { d.name = 'Named'; },
		d => { d.x += 0.001; }, d => { d.strokeColor = '#ff0000'; }, d => { d.elevation = 1; },
		d => { d.shape.points = [0, 0, 40, 20]; }, d => { d.shape.points = [0, 0, -40, 0]; },
	]) {
		const p = lineProject(); modify(p.drawings[1].data);
		const result = analyseStraightLineConsolidation(p, ['a', 'b', 'c'], ['a', 'b', 'c']);
		assert.equal(result.potentialDocumentReduction, 0);
		assert.equal(result.skipped.length, 3);
	}
});
test('reversed endpoint orientation is accepted without inventing paths', () => {
	const p = lineProject();
	p.drawings[1].data.shape.points = [40, 0, 0, 0];
	assert.equal(analyseStraightLineConsolidation(p, ['a', 'b', 'c'], ['a', 'b', 'c']).potentialDocumentReduction, 2);
});
test('ambiguous selections and malformed complete-stack IDs refuse analysis', () => {
	for (const [order, selected] of [[['a', 'b'], []], [['a', 'a'], ['a']], [['a'], ['b']], [['unknown'], ['a']], [['a'], ['a', 'a']]]) {
		assert.throws(() => analyseStraightLineConsolidation(lineProject(), order, selected));
	}
});
