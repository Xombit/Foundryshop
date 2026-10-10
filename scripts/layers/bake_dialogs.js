const loc = key => game.i18n.localize(`FOUNDRYSHOP.Bake.${key}`);
const fmt = (key, data) => game.i18n.format(`FOUNDRYSHOP.Bake.${key}`, data);

export class BakeReviewCancelledError extends Error {
	constructor() { super(loc('Cancelled')); this.name = 'BakeReviewCancelledError'; }
}

function append(parent, tag, text, attributes = {}) {
	const element = document.createElement(tag);
	if (text !== undefined) element.textContent = String(text);
	for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
	parent.append(element);
	return element;
}

function list(parent, title, values) {
	append(parent, 'p', title);
	const ul = append(parent, 'ul');
	for (const value of values) append(ul, 'li', value);
	if (!values.length) append(ul, 'li', loc('None'));
}

/** Opt-in localized review callbacks only. No rendering, storage or native writes are started here. */
export function createBakeReviewDialogs({ isCurrent, signal } = {}) {
	if (typeof isCurrent !== 'function') throw new Error(loc('Changed'));
	const ownerId = game.user?.id;
	const check = () => {
		if (!game.user?.isGM || game.user.id !== ownerId || game.users?.activeGM?.id !== ownerId
			|| signal?.aborted || !isCurrent()) throw new Error(loc('Changed'));
	};
	check();
	const confirm = async (key, content) => {
		check();
		const label = append(content, 'label');
		append(label, 'input', undefined, { type: 'checkbox', name: 'acknowledge', required: '' });
		append(label, 'span', loc('Acknowledge'));
		const result = await FoundryshopDialog.prompt({
			classes: ['foundryshop-bake-review'], window: { title: loc(key) },
			content, modal: true, rejectClose: false,
			ok: { label: loc(key), callback: (event, button) => button.form.elements.acknowledge.checked === true },
		});
		check();
		if (result !== true) throw new BakeReviewCancelledError();
	};
	return {
		async approveScope(input) {
			const review = structuredClone(input), content = document.createElement('div');
			append(content, 'p', fmt('ScopeSummary', { included: review.includedCount, excluded: review.excludedCount,
				audience: loc(review.audience === 'gm' ? 'GM' : 'Players') }));
			list(content, loc('Sources'), review.included.map(entry => entry.id));
			list(content, loc('Exclusions'), review.excluded.map(entry => `${entry.id}: ${entry.reasons.join(', ')}`));
			list(content, loc('Blockers'), review.blockers);
			append(content, 'p', loc(review.destination === 'drawing' ? 'ConsolidationWarning' : 'GroundWarning'));
			if (review.destination === 'background') append(content, 'p', loc('BackgroundWarning'));
			append(content, 'p', loc('HiddenWarning'));
			if (review.blockers.length) throw new Error(`${loc('Blocked')} ${review.blockers.join(' ')}`);
			await confirm(review.destination === 'drawing' ? 'ReviewConsolidationScope' : 'ReviewScope', content);
			return { excludedIds: review.excluded.map(entry => entry.id), flattenToGround: true };
		},
		async approveRender(input) {
			const review = structuredClone(input), content = document.createElement('div');
			append(content, 'p', fmt('RenderSummary', { width: review.width, height: review.height,
				format: review.format.toUpperCase(), quality: review.quality, x: review.bounds.x, y: review.bounds.y }));
			append(content, 'p', fmt('Memory', { bytes: review.outputRgbaBytes }));
			list(content, loc('Cropped'), review.croppedSourceIds);
			list(content, loc('Outside'), review.fullyOutsideSourceIds);
			append(content, 'p', loc('RenderWarning'));
			await confirm('ReviewRender', content);
			return { proceed: true, width: review.width, height: review.height, format: review.format,
				quality: review.quality, croppedSourceIds: [...review.croppedSourceIds] };
		},
		async approvePlacement(input) {
			const review = structuredClone(input), content = document.createElement('div');
			if (review.action === 'restore') {
				append(content, 'p', loc('RestorePlacementWarning'));
				list(content, loc('Overlaps'), review.overlappingTileIds);
				await confirm('ReviewRestorePlacement', content);
				return { restorePlacement: true, overlappingTileIds: [...review.overlappingTileIds] };
			}
			append(content, 'p', loc(review.destination === 'Drawing' ? 'ConsolidationWarning' : 'GroundWarning'));
			if (review.destination === 'LevelBackground') append(content, 'p', loc('BackgroundWarning'));
			append(content, 'p', fmt(review.destination === 'Drawing' ? 'ConsolidationElevationSummary' : 'PlacementSummary', { elevation: review.groundElevation,
				audience: loc(review.audience === 'gm' ? 'GM' : 'Players') }));
			if (review.destination === 'Drawing') append(content, 'p', fmt('ConsolidationPlacement', {
				layer: review.layerId ?? loc('None'), sort: review.sort,
			}));
			list(content, loc('Overlaps'), review.overlappingTileIds);
			append(content, 'p', loc(review.destination === 'Drawing' ? 'ConsolidationStackWarning' : 'OverlapWarning'));
			await confirm(review.destination === 'Drawing' ? 'ReviewConsolidationPlacement' : 'ReviewPlacement', content);
			return { flattenToGround: true, overlappingTileIds: [...review.overlappingTileIds] };
		},
		async approveExecution(input) {
			const review = structuredClone(input), content = document.createElement('div');
			append(content, 'p', fmt('ExecutionSummary', { token: review.token, action: review.action,
				phase: review.phase, count: review.sourceIds.length }));
			if (review.layerRevisionChange) append(content, 'p', fmt('RestoreLayerRevision', review.layerRevisionChange));
			list(content, loc('Sources'), review.sourceIds);
			list(content, loc('Missing'), review.missingSourceIds);
			list(content, loc('Staged'), review.stagedSourceIds);
			append(content, 'p', loc('ApplyWarning'));
			await confirm(review.replacementType === 'Drawing' ? 'ReviewConsolidationApply' : 'ReviewApply', content);
			return { resumeOperation: true, sourceIds: [...review.sourceIds] };
		},
		async approveRestoreIntent(input) {
			const review = structuredClone(input), content = document.createElement('div');
			append(content, 'p', fmt('RestoreIntentSummary', { token: review.token, count: review.sourceIds.length }));
			if (review.layerRevisionChange) append(content, 'p', fmt('RestoreLayerRevision', review.layerRevisionChange));
			list(content, loc('Sources'), review.sourceIds);
			append(content, 'p', loc('RestoreIntentWarning'));
			await confirm('ReviewRestoreIntent', content);
			return true;
		},
		async approveTakeover(input) {
			const review = structuredClone(input), content = document.createElement('div');
			append(content, 'p', fmt('TakeoverSummary', { token: review.token, action: review.action,
				phase: review.phase, owner: review.previousOwner, count: review.sourceIds.length }));
			list(content, loc('Sources'), review.sourceIds);
			append(content, 'p', loc('TakeoverWarning'));
			await confirm('ReviewTakeover', content);
			return true;
		},
		async approvePersistence(input) {
			const review = structuredClone(input), content = document.createElement('div');
			list(content, loc('Paths'), review.paths);
			append(content, 'p', loc('PersistWarning'));
			await confirm('ReviewPersistence', content);
			return { approvedPaths: [...review.paths] };
		},
		async approvePreview(blob, input) {
			check();
			if (!(blob instanceof Blob) || !blob.size || !['image/png', 'image/webp'].includes(blob.type)) {
				throw new Error(loc('InvalidPreview'));
			}
			const review = structuredClone(input), content = document.createElement('div');
			const url = URL.createObjectURL(blob);
			try {
				const image = append(content, 'img', undefined, { src: url, alt: loc('PreviewAlt'),
					style: 'display:block;max-width:100%;max-height:50vh;object-fit:contain;background:repeating-conic-gradient(#ddd 0% 25%,#aaa 0% 50%) 0 / 20px 20px' });
				await image.decode();
				check();
				if (image.naturalWidth !== review.render.width || image.naturalHeight !== review.render.height) {
					throw new Error(loc('InvalidPreview'));
				}
				append(content, 'p', fmt('PreviewSize', { width: review.render.width, height: review.render.height }));
				append(content, 'p', loc('PreviewWarning'));
				await confirm('ReviewPreview', content);
				return true;
			} finally { URL.revokeObjectURL(url); }
		},
	};
}
import { FoundryshopDialog } from '../dialogs.js';
