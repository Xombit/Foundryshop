import { canonicalJson } from './project_package.js';
import { prepareOptimizationScope } from './optimization_scope.js';
import { inspectBakeDrawing } from '../bake_drawings.js';
import { renderReviewedBake } from '../bake_render_review.js';
import { prepareBakeOperation } from './bake_operation.js';
import { assertOptimizationNativeSchemas } from './optimization_native.js';
import { prepareOptimizationPlacement } from './optimization_placement.js';
import { reviewOptimizationExecution } from './optimization_execution_review.js';
import { resumeOptimizationOperation } from './optimization_executor.js';
import { optimizationOutputVerifier } from '../optimization_media.js';
import { fileFingerprint } from '../verified_file_storage.js';
import { readOptimizationJournal } from './optimization_journal.js';
import { validateAssetFolder } from '../artwork_stamps.js';
import { verifyBakeTileDisplay, verifyBakeBackgroundDisplay, verifyConsolidationDisplay } from '../bake_display.js';
import { publicationBackgroundSnapshot } from '../publication_background.js';
import { loadBakeImage } from '../bake_resources.js';
import { verifyConsolidationLineage } from './consolidation_placement.js';
import { reviewBakeStorage, BAKE_RECOVERY_FOLDER } from './bake_storage.js';
import { MODULE } from '../constants.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const running = new Set();

/** Opt-in GM workflow. Preparation renders only; file/journal writes and native apply are separate approvals. */
export async function prepareReviewedTileBake(scene, options = {}) {
	return prepareReviewedBake(scene, { ...options, destination: 'tile' });
}

/** Advanced opt-in workflow: composes the existing Level background and archives it before replacement. */
export async function prepareReviewedBackgroundBake(scene, options = {}) {
	return prepareReviewedBake(scene, { ...options, destination: 'background' });
}

export async function prepareReviewedConsolidation(scene, options = {}) {
	return prepareReviewedBake(scene, { ...options, destination: 'drawing' });
}

async function prepareReviewedBake(scene, {
	token, root, levelId, replacementId, sort, audience, kind = 'layer', layerId = null, readSelection,
	parentToken = null, bounds, format = 'webp', quality = 0.9, tileAxis = 1024,
	acknowledgeExternal = false, timeout = 30000, signal, isCurrent, onProgress,
	approveScope, approveRender, approvePlacement, approvePreview,
	destination,
	verifyDisplay = input => ({ background: verifyBakeBackgroundDisplay, tile: verifyBakeTileDisplay,
		drawing: verifyConsolidationDisplay }[destination])(
		input, { isCurrent, signal }),
} = {}) {
	if (destination === 'background' && (audience !== 'player' || replacementId !== undefined || sort !== undefined
		|| bounds !== undefined)) {
		throw new Error('Background Bake requires public audience, full Scene bounds and no Tile identity/sort options.');
	}
	if (destination === 'drawing' && (!['layer', 'selection'].includes(kind) || bounds !== undefined || sort !== undefined)) {
		throw new Error('Consolidate supports one leaf layer or Selected Drawings, automatic uncropped bounds and retained native sort.');
	}
	if ([isCurrent, approveScope, approveRender, approvePlacement, verifyDisplay].some(callback => typeof callback !== 'function')) {
		throw new Error('Bake workflow requires explicit context, scope/render/placement approvals and native display acceptance.');
	}
	if (approvePreview !== undefined && typeof approvePreview !== 'function') {
		throw new Error('Bake preview approval must be an explicit callback.');
	}
	const ownerId = game.user?.id;
	const configuredStorage = root === undefined;
	if (configuredStorage) root = game.settings.get(MODULE, BAKE_RECOVERY_FOLDER);
	const check = () => {
		if (!game.user?.isGM || game.user.id !== ownerId || game.users?.activeGM?.id !== ownerId
			|| game.scenes?.get(scene?.id) !== scene || !scene.canUserModify(game.user, 'update')
			|| !game.user.can('FILES_BROWSE') || !game.user.can('FILES_UPLOAD')
			|| !scene.levels?.has(levelId) || signal?.aborted || !isCurrent()
			|| configuredStorage && game.settings.get(MODULE, BAKE_RECOVERY_FOLDER) !== root) {
			throw new Error('Bake requires the designated GM, current Scene/Level and unchanged context.');
		}
		return true;
	};
	check();
	validateAssetFolder(root);
	if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(token)
		|| destination === 'tile' && (typeof replacementId !== 'string' || !/^[a-zA-Z0-9]{16}$/.test(replacementId)
			|| !Number.isSafeInteger(sort) || scene.tiles.has(replacementId))
		|| destination === 'drawing' && (typeof replacementId !== 'string' || !/^[a-zA-Z0-9]{16}$/.test(replacementId)
			|| scene.drawings.has(replacementId))
		|| !Number.isSafeInteger(timeout) || timeout < 0
		|| readOptimizationJournal(scene).entries.some(entry => entry.token === token)) {
		throw new Error('Bake requires a unique operation, valid destination options and valid timeout.');
	}
	if (running.has(scene)) throw new Error('A reviewed Bake workflow is already preparing or writing this Scene.');
	running.add(scene);
	try {
		const storage = await reviewBakeStorage({ root: configuredStorage ? undefined : root, isCurrent: check, signal });
		const scope = prepareOptimizationScope(scene, levelId, {
			kind, layerId, audience, destination, readSelection, isCurrent: check,
			inspectSource: source => inspectBakeDrawing(source, { allowTextureFills: true }),
		});
		const scopeDecision = await approveScope(structuredClone(scope.review));
		check();
		const approvedScope = scope.approve(scopeDecision);
		{
			const parents = readOptimizationJournal(scene).entries.filter(entry => entry.action === 'apply'
				&& entry.phase === 'complete' && entry.replacement.type === 'Drawing'
				&& approvedScope.sourceIds.includes(entry.replacement.id));
			if (parents.length > 1 || parentToken !== null && (parents.length || destination === 'drawing')
				&& parents[0]?.token !== parentToken) {
				throw new Error('Optimization can retain one exact Drawing parent lineage; restore multiple composites before combining them.');
			}
			if (parents.length) {
				parentToken = parents[0].token;
				await verifyConsolidationLineage(scene, levelId,
					{ file: parents[0].archive, checksum: parents[0].archiveChecksum },
					{ isCurrent: approvedScope.assertCurrent, signal, timeout });
			}
		}
		let image;
		let rendered;
		try {
			const background = destination === 'background' ? publicationBackgroundSnapshot(scene, levelId) : undefined;
			if (background?.texture.src) image = await loadBakeImage(background.texture.src, {
				isCurrent: approvedScope.assertCurrent, signal, acknowledgeExternal, timeout,
			});
			rendered = await renderReviewedBake(approvedScope.sources, {
				bounds, background, image, destination, format, quality, tileAxis, acknowledgeExternal, timeout, signal, onProgress,
				isCurrent: approvedScope.assertCurrent, approveReview: approveRender,
			});
		} finally { image?.destroy(); }
		check(); approvedScope.assertCurrent();
		let placement = null, capturedPayload = null;
		const verifyNative = async (payload, operation) => {
			check();
			assertOptimizationNativeSchemas(scene, payload);
			await verifyConsolidationLineage(scene, levelId, payload.parent,
				{ isCurrent: check, signal, timeout });
			if (!placement) {
				const checksum = await fileFingerprint(new TextEncoder().encode(canonicalJson(payload)));
				const reviewed = await prepareOptimizationPlacement(scene, JSON.stringify({ payload, checksum }),
					{ bounds: rendered.bounds, audience, isCurrent: check });
				const decision = await approvePlacement(structuredClone(reviewed.review));
				check(); approvedScope.assertCurrent();
				placement = reviewed.approve(decision);
				capturedPayload = structuredClone(payload);
			}
			if (!same(payload, capturedPayload)) throw new Error('Bake native acceptance belongs to another archive.');
			await placement(payload);
			if (await verifyDisplay({ blob: rendered.blob, output: structuredClone(payload.output),
				replacement: structuredClone(payload.replacement), width: rendered.width, height: rendered.height,
				operation: operation ? { ...operation } : null }) !== true) {
				throw new Error('Native display capability was not accepted; no Bake apply is permitted.');
			}
			check();
			await placement(payload);
			return true;
		};
		const prepared = await prepareBakeOperation(scene, {
			token, root, levelId, replacementId, sort, audience, parentToken,
			sourceIds: approvedScope.sourceIds, scope: approvedScope.scope, rendered, approvedScope,
			isCurrent: check, verifyNative, signal, timeout,
		});
		if (approvePreview && await approvePreview(rendered.blob, {
			token, sceneId: scene.id, levelId, audience, render: structuredClone(rendered.review),
		}) !== true) throw new Error('Rendered Bake preview was not accepted.');
		check(); approvedScope.assertCurrent();
		const paths = [prepared.intent.archive.path, prepared.output.path,
			...(prepared.originalBackground ? [prepared.originalBackground.file.path] : [])].sort();
		const verifyOutput = optimizationOutputVerifier(prepared.output,
			{ width: rendered.width, height: rendered.height }, { signal, isCurrent: check });
		let busy = false, persisted = false, consumed = false, executionReview = null;
		const reviewExecution = () => reviewOptimizationExecution(scene, token, {
			isCurrent: check, verifyOutput, signal, timeout,
			readSelection: kind === 'selection' ? readSelection : undefined,
		});
		const exclusive = async callback => {
			check();
			if (busy || running.has(scene)) throw new Error('A reviewed Bake workflow is already preparing or writing this Scene.');
			if (consumed) throw new Error('Bake workflow has completed; use a fresh recovery review.');
			busy = true; running.add(scene);
			try { return await callback(); }
			finally { busy = false; running.delete(scene); }
		};
		return {
			review: { token, sceneId: scene.id, levelId, audience,
				scope: structuredClone(scope.review), render: structuredClone(rendered.review),
				storage: structuredClone(storage.review),
				intent: structuredClone(prepared.intent), paths: [...paths],
				disclosure: 'Preparation changed no files or native documents. Persist exact recovery/output paths before separately approving native apply. Interrupted writes retain recovery evidence.' },
			preview: rendered.blob,
			persistAssets({ approvedPaths } = {}) {
				return exclusive(async () => {
					if (!Array.isArray(approvedPaths) || !same([...approvedPaths].sort(), paths)) {
						throw new Error('Approve exactly the listed recovery and output paths before durable preparation.');
					}
					await storage.assertAvailable();
					const result = await prepared.persist();
					executionReview = await reviewExecution();
					persisted = true;
					return result;
				});
			},
			apply({ approveExecution } = {}) {
				return exclusive(async () => {
					if (!persisted || typeof approveExecution !== 'function') {
						throw new Error('Persist verified assets and provide a separate execution approval before Bake apply.');
					}
					const reviewed = executionReview ?? await reviewExecution();
					const decision = await approveExecution(structuredClone(reviewed.review));
					check();
					const approvedExecution = reviewed.approve(decision);
					// A failed native write needs a fresh partial-state review, not the pre-write snapshot.
					executionReview = null;
					const journal = await resumeOptimizationOperation(scene, token, {
						isCurrent: check, approvedExecution, verifyOutput, verifyNative, signal, timeout,
					});
					if (readOptimizationJournal(scene).entries.find(entry => entry.token === token)?.phase !== 'complete') {
						throw new Error('Bake completion was not persisted.');
					}
					consumed = true;
					return journal;
				});
			},
		};
	} finally { running.delete(scene); }
}
