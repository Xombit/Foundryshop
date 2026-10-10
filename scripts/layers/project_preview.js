import { exportProjectDrawing } from './project_transfer_service.js';
import { renderArtworkPreview } from '../artwork_renderer.js';

const loc = key => game.i18n.localize(`FOUNDRYSHOP.Project.${key}`);

export function projectPreviewEntries(plan) {
	return plan.data.map(source => {
		const data = structuredClone(source);
		delete data.flags.foundryshop.importStaging;
		return exportProjectDrawing({ id: data._id, toObject: () => data });
	});
}

export function projectPreviewPlaceholder() {
	const section = document.createElement('section');
	section.setAttribute('data-project-preview', '');
	section.setAttribute('aria-label', loc('ArtworkPreview'));
	section.setAttribute('style', 'margin:12px 0;padding:8px;border:1px solid #888;border-radius:4px;');
	const scope = document.createElement('p');
	scope.textContent = loc('PreviewScope');
	const status = document.createElement('p');
	status.setAttribute('data-preview-status', '');
	status.setAttribute('role', 'status');
	status.textContent = loc('PreviewLoading');
	section.append(scope, status);
	return section;
}

export async function populateProjectPreview(section, plan, options, signal, render = renderArtworkPreview) {
	const status = section.querySelector('[data-preview-status]');
	try {
		if (!options.isCurrent()) throw new Error(loc('Changed'));
		const result = await render(projectPreviewEntries(plan), {
			width: 384, height: 256, padding: 8, acknowledgeExternal: options.acknowledgeExternal, signal,
		});
		if (signal.aborted) return;
		if (!options.isCurrent()) throw new Error(loc('Changed'));
		const image = document.createElement('img');
		image.setAttribute('src', result.src);
		image.setAttribute('alt', loc(result.empty ? 'PreviewEmpty' : 'ArtworkPreview'));
		image.setAttribute('width', result.width);
		image.setAttribute('height', result.height);
		image.setAttribute('style', 'display:block;width:100%;height:auto;background:#fff;');
		section.append(image);
		status.textContent = loc(result.empty ? 'PreviewEmpty' : 'PreviewReady');
		section.setAttribute('data-preview-state', 'ready');
	} catch (error) {
		if (signal.aborted) return;
		status.textContent = `${loc('PreviewUnavailable')} ${error.message}`;
		section.setAttribute('data-preview-state', 'error');
		console.warn('Foundryshop | JSON artwork preview failed:', error);
	}
}
