import { MODULE } from './constants.js';
import { readLayerWorkspace } from './layers/layer_manager.js';
import { effectiveLayerGate, layerSubtreeIds, validateLayerTree, emptyLayerTree } from './layers/layer_tree_store.js';
import { exportProjectDrawing } from './layers/project_transfer_service.js';
import { canonicalJson } from './layers/project_package.js';
import { renderArtworkWebp } from './artwork_renderer.js';
import { publicationBackgroundSnapshot } from './publication_background.js';
import { renderArtworkSvg } from './artwork_svg.js';
import { assertNoPendingPathOperation } from './path_operation_guard.js';

const loc = key => game.i18n.localize(`FOUNDRYSHOP.Publication.${key}`);
const publicationTree = scene => validateLayerTree(scene.getFlag(MODULE, 'layers') ?? emptyLayerTree());

export function publicationSnapshot(scene, levelId, { audience, nodeId, backgroundMode = 'transparent' }) {
	assertNoPendingPathOperation(scene);
	if (!game.user.isGM || !scene || !scene.levels.has(levelId)) throw new Error(loc('Changed'));
	if (!['player', 'gm'].includes(audience) || !(nodeId === null || typeof nodeId === 'string')
		|| !['transparent', 'level'].includes(backgroundMode)) throw new Error(loc('Options'));
	if (scene.getFlag(MODULE, 'projectImportJournal')) throw new Error(loc('PendingImport'));
	const tree = publicationTree(scene), workspace = readLayerWorkspace(scene);
	const members = nodeId === null ? null : layerSubtreeIds(tree, nodeId);
	const entries = [];
	for (const drawing of scene.drawings.values()) {
		const source = drawing.toObject(), id = source.flags?.[MODULE]?.layerId ?? null;
		if (!(source.levels ?? []).includes(levelId)) continue;
		if (source.flags?.[MODULE]?.importStaging) throw new Error(loc('PendingImport'));
		if (members && !members.has(id)) continue;
		if (audience === 'player' && source.hidden) continue;
		if (id !== null) {
			const managed = tree.nodes.some(node => node.id === id && node.kind === 'layer');
			if (!managed) {
				if (audience === 'player') continue;
			} else if (!effectiveLayerGate(tree, id, node => audience === 'player'
				? node.playerAllowed : !workspace.hiddenIds.includes(node.id))) continue;
		}
		entries.push(exportProjectDrawing(drawing));
	}
	return { entries, tree, background: backgroundMode === 'level' ? publicationBackgroundSnapshot(scene, levelId) : null,
		signature: publicationSignature(scene, levelId, tree, workspace) };
}

function publicationSignature(scene, levelId, tree = publicationTree(scene), workspace = readLayerWorkspace(scene)) {
	const rect = scene.getDimensions?.().sceneRect;
	return canonicalJson({ tree, rawTree: scene.getFlag(MODULE, 'layers'), workspace,
		drawings: [...scene.drawings.values()].map(drawing => drawing.toObject()),
		level: scene.levels.get(levelId)?.toObject?.() ?? null,
		dimensions: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
		journal: scene.getFlag(MODULE, 'projectImportJournal'), pathJournal: scene.getFlag(MODULE, 'pathJournal'),
		recovery: scene.getFlag(MODULE, 'recovery') });
}

function paragraph(content, value) {
	const p = document.createElement('p'); p.textContent = value; content.append(p);
}

export async function promptArtworkPublication({ signal, isOpen = () => true, format = 'webp',
	render = format === 'svg' ? renderArtworkSvg : renderArtworkWebp,
	download = downloadPublication } = {}) {
	if (!['webp', 'svg'].includes(format)) throw new Error(loc('Options'));
	const vector = format === 'svg';
	const scene = canvas.scene, levelId = canvas.level?.id;
	const check = () => {
		assertNoPendingPathOperation(scene);
		if (!game.user.isGM || !canvas.ready || canvas.scene !== scene || canvas.level?.id !== levelId
			|| !isOpen() || signal?.aborted) throw new Error(loc('Changed'));
	};
	check();
	const tree = publicationTree(scene), content = document.createElement('div');
	const initial = publicationSignature(scene, levelId);
	paragraph(content, loc(vector ? 'SVGHint' : 'Hint')); paragraph(content, loc('GMWarning')); paragraph(content, loc(vector ? 'SVGLimits' : 'Limits'));
	function select(name, label, choices) {
		const wrapper = document.createElement('label'); wrapper.textContent = label;
		const input = document.createElement('select'); input.setAttribute('name', name);
		if (name === 'audience') input.setAttribute('required', '');
		for (const [value, text] of choices) {
			const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option);
		}
		wrapper.append(input); content.append(wrapper);
	}
	select('audience', loc('Audience'), [['', loc('ChooseAudience')], ['player', loc('Player')], ['gm', loc('GM')]]);
	select('nodeId', loc('Scope'), [['', loc('Whole')], ...tree.nodes.map(node => [node.id, node.name])]);
	if (!vector) {
		select('backgroundMode', loc('Background'), [['transparent', loc('Transparent')], ['level', loc('LevelBackground')]]);
		paragraph(content, loc('BackgroundHint'));
	}
	select('crop', loc('Crop'), [['artwork', loc('ArtworkBounds')], ['custom', loc('CustomBounds')],
		...(!vector ? [['scene', loc('SceneBounds')]] : [])]);
	for (const [name, value, min, max, step] of [
		['scale', 1, 0.1, 4, 0.1], ['x', 0, -10000000, 10000000, 1], ['y', 0, -10000000, 10000000, 1],
		['width', 1024, 1, 81920, 1], ['height', 1024, 1, 81920, 1], ['quality', 0.9, 0.1, 1, 0.05],
	]) {
		if (vector && name === 'quality') continue;
		const label = document.createElement('label'); label.textContent = loc(name);
		if (['x', 'y', 'width', 'height'].includes(name)) label.setAttribute('data-publication-crop', '');
		const input = document.createElement('input');
		for (const [key, field] of Object.entries({ type: name === 'quality' ? 'range' : 'number', name, value, min, max, step })) input.setAttribute(key, String(field));
		label.append(input); content.append(label);
		if (name === 'quality') {
			const output = document.createElement('output'); output.setAttribute('data-publication-quality', '');
			output.textContent = '90%'; content.append(output);
		}
	}
	if (vector) paragraph(content, loc('SVGFidelity'));
	const label = document.createElement('label'), consent = document.createElement('input');
	label.setAttribute('data-publication-consent', '');
	consent.setAttribute('type', 'checkbox'); consent.setAttribute('name', vector ? 'acknowledgeFidelity' : 'acknowledgeExternal');
	if (vector) consent.setAttribute('required', '');
	label.append(consent); const span = document.createElement('span'); span.textContent = loc(vector ? 'SVGConsent' : 'External'); label.append(span); content.append(label);
	const selected = await FoundryshopDialog.prompt({
		classes: ['foundryshop-publication'], window: { title: loc(vector ? 'SVGTitle' : 'Title') }, content, modal: true, rejectClose: false,
		render: (event, dialog) => {
			const root = dialog.element, fields = root.querySelector('form').elements;
			const update = () => {
				if (!vector) {
					fields.crop.querySelector('option[value="scene"]').disabled = fields.backgroundMode.value !== 'level';
					if (fields.backgroundMode.value !== 'level' && fields.crop.value === 'scene') fields.crop.value = 'artwork';
					root.querySelector('[data-publication-quality]').textContent = `${Math.round(Number(fields.quality.value) * 100)}%`;
				}
				for (const label of root.querySelectorAll('[data-publication-crop]')) label.hidden = fields.crop.value !== 'custom';
			};
			fields.crop.addEventListener('change', update);
			if (!vector) {
				fields.quality.addEventListener('input', update); fields.backgroundMode.addEventListener('change', update);
			}
			for (const input of root.querySelectorAll('input[type="number"]')) {
				input.addEventListener('wheel', event => {
					if (document.activeElement !== input || !event.deltaY) return;
					event.preventDefault();
					if (event.deltaY < 0) input.stepUp(); else input.stepDown();
					input.dispatchEvent(new Event('input', { bubbles: true }));
				}, { passive: false });
			}
			update();
		},
		ok: { label: loc('Download'), callback: (event, button) => {
			const fields = button.form.elements;
			return { audience: fields.audience.value, nodeId: fields.nodeId.value || null, crop: fields.crop.value,
				backgroundMode: vector ? 'transparent' : fields.backgroundMode.value,
				scale: Number(fields.scale.value), quality: vector ? undefined : Number(fields.quality.value),
				bounds: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(fields[key].value)])),
				...(vector ? { acknowledgeFidelity: fields.acknowledgeFidelity.checked }
					: { acknowledgeExternal: fields.acknowledgeExternal.checked }) };
		} },
	});
	if (!selected) return null;
	check();
	const snapshot = publicationSnapshot(scene, levelId, selected);
	if (snapshot.signature !== initial) throw new Error(loc('Changed'));
	const controller = new AbortController(), abort = () => controller.abort();
	signal?.addEventListener('abort', abort, { once: true });
	const timer = setInterval(() => {
		try {
			check();
			if (publicationSnapshot(scene, levelId, selected).signature !== snapshot.signature) {
				clearInterval(timer); controller.abort();
			}
		} catch (error) { clearInterval(timer); controller.abort(); console.warn('Foundryshop | Publication context changed:', error); }
	}, 250);
	try {
		ui.notifications.info(loc('Rendering'));
		const result = await render(snapshot.entries, { ...selected, tree: snapshot.tree, background: snapshot.background, signal: controller.signal });
		check();
		if (publicationSnapshot(scene, levelId, selected).signature !== snapshot.signature) throw new Error(loc('Changed'));
		if (controller.signal.aborted) throw new Error(loc('Changed'));
		download(result.blob, `${scene.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'artwork'}-${selected.audience}.${format}`);
		return result;
	} finally { clearInterval(timer); controller.abort(); signal?.removeEventListener('abort', abort); }
}

export function downloadPublication(blob, filename) {
	if (!game.user.isGM || !(blob instanceof Blob)
		|| !(['image/webp', 'image/svg+xml'].includes(blob.type))
		|| typeof filename !== 'string' || !filename.endsWith(blob.type === 'image/webp' ? '.webp' : '.svg')) throw new Error(loc('Options'));
	const url = URL.createObjectURL(blob), link = document.createElement('a');
	link.href = url; link.download = filename; document.body.append(link);
	try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
import { FoundryshopDialog } from './dialogs.js';
