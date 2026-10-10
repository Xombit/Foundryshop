import { MODULE } from '../constants.js';
import { updateDrawingConfig } from '../drawing_config.js';
import {
	layerError, layerNode, orderedLayerNodes, layerSubtreeIds, layerVisibilitySummary, lockedLayerIds, UNASSIGNED,
} from './layer_tree_store.js';
import {
	LAYER_CHANGED, readLayerTree, readLayerWorkspace, activeLayer, createLayer, renameLayer,
	reorderLayer, setActiveLayer, toggleWorkspaceVisibility, setPlayerPresentation,
	layerMembershipIndex, assignDrawings, reconcileDrawingOrder, saveLayerDefaults, clearLayerDefaults, reportLayerError,
	setSubtreePresentation, setSubtreeWorkspaceVisibility, toggleGroupCollapsed, deleteLayerSubtree, setLayerLocked,
	duplicateLayer, DELETE_ARTWORK,
} from './layer_manager.js';
import {
	presentationPreset, analyzePresentationPreset, capturePresentationPreset, recapturePresentationPreset,
	renamePresentationPreset, removePresentationPreset, applyPresentationPreset,
} from './presentation_service.js';
import { promptProjectExport, promptProjectImport, promptDiscardProjectImport } from './project_dialogs.js';
import { createTracingTile, removeTracingTile, tracingTiles } from './tracing_tile.js';
import { promptRetainedPathRecovery } from '../path_transactions.js';
import { copyDrawingsToLayer } from './layer_copy.js';
import { FoundryshopDialog } from '../dialogs.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const loc = key => game.i18n.localize(`FOUNDRYSHOP.Layers.${key}`);

export class LayerPanel extends HandlebarsApplicationMixin(ApplicationV2) {
	static instance = null;
	static opening = null;
	static openInToolbox = null;
	static DEFAULT_OPTIONS = {
		id: 'foundryshop-layers', classes: ['fshop-layers'],
		window: { title: 'FOUNDRYSHOP.Layers.Title', icon: 'fas fa-layer-group', resizable: true },
		position: { width: 640, height: 'auto' },
		actions: {
			add: LayerPanel.onAction, activate: LayerPanel.onAction, workspace: LayerPanel.onAction,
			present: LayerPanel.onAction, rename: LayerPanel.onAction, up: LayerPanel.onAction,
			down: LayerPanel.onAction, assign: LayerPanel.onAction, reconcile: LayerPanel.onAction,
			copySelected: LayerPanel.onAction,
			defaults: LayerPanel.onAction, clearDefaults: LayerPanel.onAction,
			addGroup: LayerPanel.onAction, collapseGroup: LayerPanel.onAction,
			move: LayerPanel.onAction, deleteNode: LayerPanel.onAction,
			lock: LayerPanel.onAction, rowMenu: LayerPanel.onAction, duplicate: LayerPanel.onAction,
			tracing: LayerPanel.onAction, tracingRemove: LayerPanel.onAction,
			exportProject: LayerPanel.onAction, importProject: LayerPanel.onAction,
			discardImport: LayerPanel.onAction,
			recoverPath: LayerPanel.onAction,
			showWorkspaceAll: LayerPanel.onAction, hideWorkspaceAll: LayerPanel.onAction,
			showPlayersAll: LayerPanel.onAction, hidePlayersAll: LayerPanel.onAction,
			presetCapture: LayerPanel.onAction, presetApply: LayerPanel.onAction,
			presetRecapture: LayerPanel.onAction, presetRename: LayerPanel.onAction, presetRemove: LayerPanel.onAction,
		},
	};
	static PARTS = { main: { template: `modules/${MODULE}/templates/layer-panel.hbs` } };

	static init() {
		Hooks.on('getSceneControlButtons', controls => {
			if (!game.user.isGM || !controls.drawings?.tools) return;
			controls.drawings.tools['foundryshop-layers'] = {
				name: 'foundryshop-layers', icon: 'fas fa-layer-group',
				title: 'FOUNDRYSHOP.Layers.Title', button: true,
				order: Math.max(-1, ...Object.values(controls.drawings.tools).map(tool => tool.order ?? -1)) + 1,
				onChange: () => LayerPanel.toggle(),
			};
		});
		Hooks.on(LAYER_CHANGED, () => {
			const app = LayerPanel.instance;
			if (app?.rendered) {
				if (!game.user.isGM || !canvas.ready) app.close().catch(reportLayerError);
				else app.render().catch(reportLayerError);
			}
		});
	}

	static async toggle() {
		try {
			if (!game.user.isGM) throw layerError('GMOnly');
			if (!canvas.ready || !canvas.scene) throw layerError('NoScene');
			if (LayerPanel.openInToolbox) return await LayerPanel.openInToolbox('layers');
			if (LayerPanel.opening) await LayerPanel.opening;
			if (LayerPanel.instance?.rendered) return await LayerPanel.instance.close();
			const app = LayerPanel.instance = new LayerPanel();
			LayerPanel.opening = app.render({ force: true });
			return await LayerPanel.opening;
		} catch (error) {
			reportLayerError(error);
		} finally {
			LayerPanel.opening = null;
		}
	}

	static embedded(owner) {
		const controller = Object.create(LayerPanel.prototype);
		controller.render = () => owner.render();
		return {
			context() { return controller._prepareContext(); },
			async render(tab) {
				const context = await controller._prepareContext();
				return foundry.applications.handlebars.renderTemplate(LayerPanel.PARTS.main.template, {
					...context, showLayers: tab === 'layers', showPresets: tab === 'presentation', showExchange: tab === 'library',
				});
			},
			bind(root) { controller.bindLayerEvents(root); },
			action(event, target) { return LayerPanel.onAction.call(controller, event, target); },
		};
	}

	async _prepareContext() {
		if (!game.user.isGM) throw layerError('GMOnly');
		const scene = canvas.scene;
		if (!canvas.ready || !scene) throw layerError('NoScene');
		const tree = readLayerTree(scene);
		const workspace = readLayerWorkspace(scene);
		const hidden = new Set(workspace.hiddenIds);
		const collapsed = new Set(workspace.collapsedIds);
		const active = activeLayer(tree, workspace);
		const locked = lockedLayerIds(tree);
		const members = layerMembershipIndex(scene, tree);
		const entries = orderedLayerNodes(tree);
		const localSummary = layerVisibilitySummary(tree, node => !hidden.has(node.id));
		const playerSummary = layerVisibilitySummary(tree, node => node.playerAllowed);
		const counts = new Map();
		const hiddenRows = new Set();
		const siblingsByParent = new Map();
		for (const { node } of entries) {
			counts.set(node.id, members.get(node.id)?.length ?? 0);
			if (node.parentId !== null && (hiddenRows.has(node.parentId) || collapsed.has(node.parentId))) hiddenRows.add(node.id);
			if (!siblingsByParent.has(node.parentId)) siblingsByParent.set(node.parentId, []);
			siblingsByParent.get(node.parentId).push(node.id);
		}
		for (const { node } of [...entries].reverse()) {
			if (node.parentId !== null) counts.set(node.parentId, counts.get(node.parentId) + counts.get(node.id));
		}
		const visibilityFields = (summary, prefix, audience) => ({
			[`${prefix}Aria`]: summary.state === 'mixed' ? 'mixed' : String(summary.state === 'visible'),
			[`${prefix}Icon`]: summary.state === 'mixed' ? 'fa-adjust'
				: summary.state === 'visible' ? 'fa-eye' : 'fa-eye-slash',
			[`${prefix}Title`]: `${loc(audience)}: ${loc(`State.${summary.state}`)}; ${loc(summary.gateEnabled ? 'GateOn' : 'GateOff')}${summary.ancestorBlocked ? ` (${loc('AncestorHidden')})` : ''}`,
		});
		this.scene = scene;
		this.revision = tree.revision;
		return {
			showLayers: true, showPresets: true, showExchange: true,
			sceneName: scene.name,
			hasImportJournal: !!scene.getFlag(MODULE, 'projectImportJournal'),
			hasPathJournal: scene.getFlag(MODULE, 'pathJournal') !== undefined,
			canCapturePreset: tree.nodes.length > 0,
			presets: tree.presets.map(preset => {
				const analysis = analyzePresentationPreset(tree, preset);
				return {
					id: preset.id, name: preset.name, matches: analysis.matches,
					canApply: analysis.missingIds.length === 0,
					missingCount: analysis.missingIds.length, newCount: analysis.newIds.length,
					missingHint: analysis.missingIds.length
						? game.i18n.format('FOUNDRYSHOP.Layers.PresetMissingHint', { count: analysis.missingIds.length }) : '',
					newHint: analysis.newIds.length
						? game.i18n.format('FOUNDRYSHOP.Layers.PresetNewHint', { count: analysis.newIds.length }) : '',
				};
			}),
			rows: entries.filter(({ node }) => !hiddenRows.has(node.id)).map(({ node, depth }) => {
				const siblings = siblingsByParent.get(node.parentId);
				const index = siblings.indexOf(node.id);
				return {
					...node, depth, isLayer: node.kind === 'layer', isGroup: node.kind === 'group',
					effectiveLocked: locked.has(node.id),
					lockTitle: loc(node.locked ? 'Unlock' : locked.has(node.id) ? 'InheritedLock' : 'Lock'),
					collapsed: collapsed.has(node.id), expanded: !collapsed.has(node.id),
					active: node.id === active?.id,
					menuOpen: node.id === this.menuId,
					hasTracing: node.kind === 'layer' && !!scene.tiles && tracingTiles(scene, node.id).length > 0,
					localVisible: !hidden.has(node.id),
					effectiveLocal: localSummary.get(node.id).effective,
					count: counts.get(node.id),
					canUp: index > 0, canDown: index < siblings.length - 1,
					hasDefaults: Object.keys(node.defaults).length > 0,
					...visibilityFields(localSummary.get(node.id), 'local', 'Workspace'),
					...visibilityFields(playerSummary.get(node.id), 'player', 'Players'),
				};
			}),
			unassignedCount: members.get(UNASSIGNED).length,
			unassigned: UNASSIGNED,
			background: canvas.level?.background?.src || loc('NoBackground'),
		};
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		this.bindLayerEvents(this.element);
	}

	bindLayerEvents(root) {
		const scene = this.scene;
		const revision = this.revision;
		for (const handle of root.querySelectorAll('[data-layer-drag]')) {
			handle.addEventListener('dragstart', event => {
				event.dataTransfer.setData('application/x-foundryshop-layer', JSON.stringify({
					sceneId: scene.id, revision, id: handle.dataset.layerDrag,
				}));
				event.dataTransfer.effectAllowed = 'move';
			});
		}
		for (const row of root.querySelectorAll('[data-layer-id]')) {
			const dropPosition = event => {
				const bounds = row.getBoundingClientRect();
				const fraction = (event.clientY - bounds.top) / bounds.height;
				if (row.dataset.layerKind === 'group' && fraction >= 0.25 && fraction <= 0.75) return 'inside';
				return fraction < 0.5 ? 'before' : 'after';
			};
			row.addEventListener('dragover', event => {
				if (!event.dataTransfer.types.includes('application/x-foundryshop-layer')) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = 'move';
				row.dataset.dropPosition = dropPosition(event);
			});
			row.addEventListener('dragleave', event => {
				if (!row.contains(event.relatedTarget)) delete row.dataset.dropPosition;
			});
			row.addEventListener('drop', async event => {
				event.preventDefault();
				delete row.dataset.dropPosition;
				if (this.busy) return;
				this.busy = true;
				try {
					if (scene !== canvas.scene || !game.user.isGM) throw layerError('Changed');
					const payload = JSON.parse(event.dataTransfer.getData('application/x-foundryshop-layer'));
					if (!payload || payload.sceneId !== scene.id || payload.revision !== revision
						|| typeof payload.id !== 'string') throw layerError('InvalidDrop');
					await reorderLayer(scene, payload.id, row.dataset.layerId,
						dropPosition(event), revision);
					await this.render();
				} catch (error) {
					reportLayerError(error);
				} finally {
					this.busy = false;
				}
			});
		}
	}

	static async promptName(title, value = '', nameLabel = 'Name') {
		const content = document.createElement('div');
		const label = document.createElement('label');
		label.textContent = loc(nameLabel);
		const input = document.createElement('input');
		input.setAttribute('type', 'text');
		input.setAttribute('name', 'layerName');
		input.setAttribute('maxlength', '80');
		input.setAttribute('required', '');
		input.setAttribute('value', value);
		label.append(input);
		content.append(label);
		return DialogV2.prompt({
			window: { title: loc(title) }, content, modal: true, rejectClose: false,
			ok: { callback: (event, button, dialog) => dialog.element.querySelector('[name="layerName"]').value },
		});
	}

	static async promptDestination(title, options, selected, hint) {
		const content = document.createElement('div');
		const description = document.createElement('p');
		description.textContent = loc(hint);
		content.append(description);
		const label = document.createElement('label');
		label.textContent = loc('Destination');
		const select = document.createElement('select');
		select.setAttribute('name', 'destinationId');
		for (const { id, name } of options) {
			const option = document.createElement('option');
			option.setAttribute('value', id);
			if (id === selected) option.setAttribute('selected', '');
			option.textContent = name;
			select.append(option);
		}
		label.append(select);
		content.append(label);
		return DialogV2.prompt({
			window: { title: loc(title) }, content, modal: true, rejectClose: false,
			ok: { callback: (event, button, dialog) => dialog.element.querySelector('[name="destinationId"]').value },
		});
	}

	static async onAction(event, target) {
		if (this.busy) return;
		this.busy = true;
		try {
			if (!game.user.isGM) throw layerError('GMOnly');
			const scene = this.scene;
			if (!scene || scene !== canvas.scene || !canvas.ready) throw layerError('Changed');
			const tree = readLayerTree(scene);
			if (tree.revision !== this.revision) throw layerError('Changed');
			const id = target.dataset.id;
			const action = target.dataset.action;
			if (action.startsWith('preset')) {
				await this.runPresetAction(scene, tree, action, id);
				await this.render();
				return;
			}
			const node = id && id !== UNASSIGNED ? layerNode(tree, id) : null;
			if (action === 'rowMenu') {
				this.menuId = this.menuId === id ? null : id;
				await this.render();
				return;
			}
			if (!['up', 'down', 'lock', 'workspace', 'present', 'defaults', 'clearDefaults'].includes(action)) this.menuId = null;
			switch (action) {
				case 'exportProject': await promptProjectExport(scene, tree.revision); break;
				case 'importProject': await promptProjectImport(scene, tree.revision); break;
				case 'discardImport': await promptDiscardProjectImport(scene); break;
				case 'recoverPath': await promptRetainedPathRecovery(scene); break;
				case 'lock': await setLayerLocked(scene, id, !node.locked, tree.revision); break;
				case 'add':
				case 'addGroup': {
					const kind = target.dataset.action === 'addGroup' ? 'group' : 'layer';
					if (node && node.kind !== 'group') throw layerError('InvalidDrop');
					const name = await LayerPanel.promptName(kind === 'group' ? 'AddGroup' : 'Add');
					if (name === null || name === undefined) break;
					if (scene !== canvas.scene) throw layerError('Changed');
					await createLayer(scene, name, kind, node?.id ?? null, tree.revision);
					break;
				}
				case 'activate':
					await setActiveLayer(scene, id);
					if (Object.keys(node.defaults).length) await updateDrawingConfig(node.defaults, { source: 'layers' });
					break;
				case 'workspace': await toggleWorkspaceVisibility(scene, id); break;
				case 'collapseGroup': await toggleGroupCollapsed(scene, id); break;
				case 'present': await setPlayerPresentation(scene, id, !node.playerAllowed, tree.revision); break;
				case 'showWorkspaceAll':
				case 'hideWorkspaceAll':
					await setSubtreeWorkspaceVisibility(scene, id, target.dataset.action === 'showWorkspaceAll', tree.revision);
					break;
				case 'showPlayersAll':
				case 'hidePlayersAll': {
					const show = target.dataset.action === 'showPlayersAll';
					if (show) {
						const confirmed = await DialogV2.confirm({
							window: { title: loc('ShowPlayersAll') }, content: loc('ShowPlayersAllPrompt'),
							modal: true, rejectClose: false,
						});
						if (!confirmed) break;
						if (scene !== canvas.scene) throw layerError('Changed');
					}
					await setSubtreePresentation(scene, id, show, tree.revision);
					break;
				}
				case 'move': {
					const excluded = layerSubtreeIds(tree, id);
					const destinations = [{ id: '', name: loc('Root') },
						...orderedLayerNodes(tree).filter(({ node: entry }) =>
							entry.kind === 'group' && !excluded.has(entry.id))
							.map(({ node: entry, depth }) => ({ id: entry.id, name: `${'  '.repeat(depth)}${entry.name}` }))];
					const destination = await LayerPanel.promptDestination('Move', destinations, node.parentId ?? '', 'MoveHint');
					if (destination === null || destination === undefined) break;
					if (scene !== canvas.scene) throw layerError('Changed');
					if (!destinations.some(entry => entry.id === destination)) throw layerError('InvalidDrop');
					if (destination === (node.parentId ?? '')) break;
					await reorderLayer(scene, id, destination || null, destination ? 'inside' : 'root', tree.revision);
					break;
				}
				case 'deleteNode': {
					const removed = layerSubtreeIds(tree, id);
					const locked = lockedLayerIds(tree);
					const destinations = [{ id: UNASSIGNED, name: loc('Unassigned') },
						...orderedLayerNodes(tree).filter(({ node: entry }) =>
							entry.kind === 'layer' && !locked.has(entry.id) && !removed.has(entry.id))
							.map(({ node: entry }) => ({ id: entry.id, name: entry.name })),
						{ id: DELETE_ARTWORK, name: loc('DeleteArtworkOption') }];
					const destination = await LayerPanel.promptDestination('Delete', destinations, UNASSIGNED, 'DeleteHint');
					if (destination === null || destination === undefined) break;
					if (scene !== canvas.scene) throw layerError('Changed');
					if (!destinations.some(entry => entry.id === destination)) throw layerError('InvalidDestination');
					const affectedPresets = tree.presets.filter(preset =>
						preset.entries.some(entry => removed.has(entry.nodeId)));
					const content = document.createElement('div');
					const explanation = document.createElement('p');
					const drawingCount = [...scene.drawings.values()]
						.filter(drawing => removed.has(drawing.getFlag(MODULE, 'layerId'))).length;
					explanation.textContent = destination === DELETE_ARTWORK
						? game.i18n.format('FOUNDRYSHOP.Layers.DeleteArtworkPrompt', { count: drawingCount })
						: loc('DeletePrompt');
					content.append(explanation);
					if (affectedPresets.length) {
						const warning = document.createElement('p');
						warning.textContent = game.i18n.format('FOUNDRYSHOP.Layers.DeletePresetHint', { count: affectedPresets.length });
						content.append(warning);
					}
					const confirmed = await DialogV2.confirm({
						window: { title: loc('Delete') }, content,
						modal: true, rejectClose: false,
					});
					if (!confirmed) break;
					if (scene !== canvas.scene) throw layerError('Changed');
					await deleteLayerSubtree(scene, id, destination, tree.revision);
					break;
				}
				case 'tracing': {
					if (node?.kind !== 'layer') throw layerError('TracingGroup');
					ui.notifications.info(loc('TracingWorking'));
					await createTracingTile(scene, id);
					ui.notifications.info(loc('TracingDone'));
					break;
				}
				case 'tracingRemove': await removeTracingTile(scene, id); break;
				case 'duplicate': {
					if (node?.kind !== 'layer') throw layerError('DuplicateGroup');
					const name = await LayerPanel.promptName('Duplicate',
						game.i18n.format('FOUNDRYSHOP.Layers.CopyName', { name: node.name }).slice(0, 80));
					if (name === null || name === undefined) break;
					if (scene !== canvas.scene) throw layerError('Changed');
					await duplicateLayer(scene, id, name, tree.revision);
					break;
				}
				case 'rename': {
					const name = await LayerPanel.promptName('Rename', node.name);
					if (name === null || name === undefined) break;
					if (scene !== canvas.scene) throw layerError('Changed');
					await renameLayer(scene, id, name, tree.revision);
					break;
				}
				case 'up':
				case 'down': {
					const siblings = tree.nodes.filter(entry => entry.parentId === node.parentId);
					const up = target.dataset.action === 'up';
					const other = siblings[siblings.indexOf(node) + (up ? -1 : 1)];
					if (!other) throw layerError('InvalidDrop');
					await reorderLayer(scene, id, other.id, up ? 'before' : 'after', tree.revision);
					break;
				}
				case 'copySelected': {
					const ids = (canvas.drawings?.controlled ?? []).map(object => object.document.id);
					const selection = () => (canvas.drawings?.controlled ?? []).map(object => object.document.id).sort().join(',');
					const selected = [...ids].sort().join(',');
					const result = await copyDrawingsToLayer(scene, ids, id, {
						expectedRevision: tree.revision,
						isCurrent: () => canvas.ready && canvas.scene === scene && selection() === selected,
						approvePathLoss: warnings => {
							const content = document.createElement('div');
							const hint = document.createElement('p'); hint.textContent = loc('CopyPathLoss'); content.append(hint);
							for (const warning of warnings) {
								const p = document.createElement('p');
								p.textContent = `${warning.name}: ${game.i18n.localize(`FOUNDRYSHOP.Paths.PortableReason.${warning.reason}`)}`;
								content.append(p);
							}
							return FoundryshopDialog.confirm({ window: { title: loc('CopySelected') }, content,
								modal: true, rejectClose: false });
						},
					});
					if (result) ui.notifications.info(loc('CopiedSelected'));
					break;
				}
				case 'assign': {
					const ids = (canvas.drawings?.controlled ?? []).map(object => object.document.id);
					if (!ids.length) throw layerError('NoSelection');
					if (id === UNASSIGNED) {
						const confirmed = await DialogV2.confirm({
							window: { title: loc('Unassign') }, content: loc('UnassignPrompt'),
							modal: true, rejectClose: false,
						});
						if (!confirmed) break;
						if (scene !== canvas.scene) throw layerError('Changed');
					}
					await assignDrawings(scene, ids, id, tree.revision);
					break;
				}
				case 'reconcile': await reconcileDrawingOrder(scene); break;
				case 'defaults': await saveLayerDefaults(scene, id, tree.revision); break;
				case 'clearDefaults': await clearLayerDefaults(scene, id, tree.revision); break;
				default: throw layerError('Changed');
			}
			await this.render();
		} catch (error) {
			reportLayerError(error);
		} finally {
			this.busy = false;
		}
	}

	async runPresetAction(scene, tree, action, id) {
		if (action === 'presetCapture') {
			const name = await LayerPanel.promptName('PresetCapture', '', 'PresetName');
			if (name === null || name === undefined) return;
			if (scene !== canvas.scene || !canvas.ready) throw layerError('Changed');
			await capturePresentationPreset(scene, name, tree.revision);
			return;
		}
		const preset = presentationPreset(tree, id);
		if (action === 'presetRename') {
			const name = await LayerPanel.promptName('PresetRename', preset.name, 'PresetName');
			if (name === null || name === undefined) return;
			if (scene !== canvas.scene || !canvas.ready) throw layerError('Changed');
			await renamePresentationPreset(scene, id, name, tree.revision);
			return;
		}
		const confirmationKeys = {
			presetApply: ['PresetApply', 'PresetApplyPrompt'],
			presetRecapture: ['PresetRecapture', 'PresetRecapturePrompt'],
			presetRemove: ['PresetRemove', 'PresetRemovePrompt'],
		};
		const keys = confirmationKeys[action];
		if (!keys) throw layerError('Changed');
		const content = document.createElement('div');
		const explanation = document.createElement('p');
		explanation.textContent = loc(keys[1]);
		const name = document.createElement('strong');
		name.textContent = preset.name;
		content.append(name);
		content.append(explanation);
		const confirmed = await DialogV2.confirm({
			window: { title: loc(keys[0]) }, content, modal: true, rejectClose: false,
		});
		if (!confirmed) return;
		if (scene !== canvas.scene || !canvas.ready) throw layerError('Changed');
		if (action === 'presetApply') await applyPresentationPreset(scene, id, tree.revision);
		else if (action === 'presetRecapture') await recapturePresentationPreset(scene, id, tree.revision);
		else await removePresentationPreset(scene, id, tree.revision);
	}
}
import { FoundryshopDialog as DialogV2 } from '../dialogs.js';
