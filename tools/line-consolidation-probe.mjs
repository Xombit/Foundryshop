import { analyseStraightLineConsolidation } from '../scripts/layers/line_consolidation_analysis.js';
import { prepareArtworkSnapshot, buildArtworkDisplay } from '../scripts/artwork_renderer.js';
import { compareRenderPixels } from './drawing-render-probe.mjs';

/** Bounded detached candidate fidelity only. Never creates or deletes Scene documents. */
export function runLineConsolidationProbe({ PIXI, renderer, project, resolution = 1 }) {
	if (![1, 1.5, 2].includes(resolution)) throw new RangeError('Line probe resolution must be 1, 1.5 or 2.');
	const ids = project.drawings.map(e => e.id);
	const analysis = analyseStraightLineConsolidation(project, ids, ids);
	const replacements = new Map(analysis.candidates.map(c => [c.sourceIds[0], { id: c.sourceIds[0], layerId: c.layerId, data: c.data }]));
	const removed = new Set(analysis.candidates.flatMap(c => c.sourceIds.slice(1)));
	const proposed = project.drawings.filter(e => !removed.has(e.id)).map(e => replacements.get(e.id) ?? e);
	let source, merged, target;
	try {
		source = buildArtworkDisplay(prepareArtworkSnapshot(project.drawings));
		merged = buildArtworkDisplay(prepareArtworkSnapshot(proposed));
		target = PIXI.RenderTexture.create({ width: 256, height: 128, resolution, multisample: 0 });
		const pixels = () => {
			const mode = target.baseTexture.alphaMode;
			try { target.baseTexture.alphaMode = PIXI.ALPHA_MODES.NPM; return renderer.extract.pixels(target); }
			finally { target.baseTexture.alphaMode = mode; }
		};
		const comparisons = [];
		for (const scale of [0.2, 1, 2]) {
			for (const root of [source, merged]) { root.scale.set(scale); root.position.set(13.5, 7.25); }
			renderer.render(source, { renderTexture: target, clear: true });
			const before = pixels();
			renderer.render(merged, { renderTexture: target, clear: true });
			comparisons.push({ scale, ...compareRenderPixels(before, pixels()) });
		}
		return { resolution, sourceDrawings: ids.length, proposedDrawings: proposed.length, comparisons,
			potentialDocumentReduction: analysis.potentialDocumentReduction,
			disclosure: 'Detached geometry fidelity, not native document transaction, recovery, hit testing or performance proof.' };
	} finally {
		source?.destroy({ children: true });
		merged?.destroy({ children: true });
		target?.destroy(true);
	}
}
