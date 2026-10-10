import { canonicalJson, validateProjectPackage, PROJECT_FORMAT, PROJECT_VERSION } from './project_package.js';
import { exportProjectDrawing } from './project_transfer_service.js';
import { readLayerTree } from './layer_manager.js';
import { optimizationSceneGrid } from './optimization_scene_data.js';
import { readOptimizationJournal, validateOptimizationJournal } from './optimization_journal.js';
import { readOptimizationArchive, optimizationArchiveDescriptor } from './optimization_recovery.js';
import { prepareRecoveryFileBundle, decodeRecoveryFileBundle, verifyRecoveryBundleFiles } from './recovery_file_bundle.js';

export const RECOVERY_PROJECT_FORMAT = 'foundryshop-recovery-project';
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
	&& Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = message => { throw new Error(`Recovery project: ${message}`); };

export function reconstructRecoveryProjectDrawings(project, authors) {
	if (!Array.isArray(authors) || authors.length !== project.drawings.length) fail('Invalid native author inventory.');
	const identities = new Map();
	for (const author of authors) {
		if (!exact(author, ['id', 'author']) || identities.has(author.id)
			|| typeof author.author !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(author.author)) {
			fail('Invalid or duplicate native author identity.');
		}
		identities.set(author.id, author.author);
	}
	return project.drawings.map(entry => {
		if (!identities.has(entry.id)) fail('Missing native author identity.');
		const data = structuredClone(entry.data);
		if (entry.layerId !== null) {
			data.flags.foundryshop ??= {};
			data.flags.foundryshop.layerId = entry.layerId;
		}
		return { ...data, _id: entry.id, author: identities.get(entry.id) };
	});
}

function layersMatch(current, archived) {
	return same(current, archived) || current.revision > archived.revision
		&& same({ ...current, revision: archived.revision }, archived);
}

export function recoveryProjectResources(project, archives, files) {
	const images = new Set(project.dependencies.assets), fonts = new Set(project.dependencies.fonts);
	const references = new Map(files.filter(file => !file.reference.path.endsWith('.json'))
		.map(file => [file.reference.path, file.reference]));
	for (const { payload } of archives.values()) {
		for (const node of payload.context.layers.nodes) if (node.defaults.texture) images.add(node.defaults.texture);
		for (const source of payload.originals) {
			if (source.texture) images.add(source.texture);
			if (source.text && source.fontFamily) fonts.add(source.fontFamily);
		}
		images.add(payload.output.path);
		if (payload.originalBackground) {
			const { src, file } = payload.originalBackground, known = references.get(src);
			if (known && (known.bytes !== file.bytes || known.fingerprint !== file.fingerprint)) {
				fail('Original background resource has conflicting preserved bytes.');
			}
			references.set(src, known ?? file);
			images.add(src);
		}
	}
	return { images: [...images].sort().map(source => ({ source, file: references.get(source) ?? null })),
		fonts: [...fonts].sort() };
}

/** Rewind every complete operation, including Restores, to verify live roots without requiring historical composites to remain live. */
export async function validateRecoveryProjectManifest(input, files) {
	if (!exact(input, ['format', 'version', 'source', 'project', 'authors', 'tiles', 'journal', 'resources'])
		|| input.format !== RECOVERY_PROJECT_FORMAT || input.version !== 1
		|| !exact(input.source, ['sceneId', 'levelId', 'scene', 'level'])
		|| !exact(input.source.scene, ['width', 'height', 'padding', 'grid'])
		|| input.source.level?._id !== input.source.levelId || !Array.isArray(input.tiles)) {
		fail('Invalid versioned manifest or source context.');
	}
	const manifest = structuredClone(input), project = validateProjectPackage(manifest.project);
	if (!Array.isArray(files) || files.some(file => !(file?.bytes instanceof Uint8Array))) fail('Verified recovery files are required.');
	files = await verifyRecoveryBundleFiles(files.map(file => ({
		reference: structuredClone(file.reference), bytes: file.bytes.slice(),
	})));
	if (!same(project, manifest.project)) fail('Project metadata must be canonical.');
	const journal = validateOptimizationJournal(manifest.journal, manifest.source.sceneId);
	if (!journal.entries.length || journal.entries.some(entry => entry.phase !== 'complete'
		|| entry.levelId !== manifest.source.levelId)) fail('History must contain complete operations on one explicit Level.');
	const drawings = new Map(reconstructRecoveryProjectDrawings(project, manifest.authors).map(source => [source._id, source]));
	if ([...drawings.values()].some(source => source.levels.length !== 1 || source.levels[0] !== manifest.source.levelId)) {
		fail('Live artwork must belong only to the chosen Level.');
	}
	const tiles = new Map();
	for (const tile of manifest.tiles) {
		if (!tile || typeof tile._id !== 'string' || tiles.has(tile._id)) fail('Invalid or duplicate live Tile identity.');
		tiles.set(tile._id, tile);
	}
	if (!Array.isArray(files)) fail('Verified recovery files are required.');
	const byPath = new Map(files.map(file => [file.reference.path, file]));
	if (byPath.size !== files.length) fail('Duplicate recovery file references.');
	const archives = new Map(), usedFiles = new Set();
	for (const entry of journal.entries.filter(entry => entry.action === 'apply')) {
		const file = byPath.get(entry.archive.path);
		if (!file || !same(file.reference, entry.archive)) fail('Missing exact journal archive.');
		const text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
		const archive = await readOptimizationArchive(text), descriptor = await optimizationArchiveDescriptor(text);
		const payload = archive.payload;
		if (payload.id !== entry.token || payload.sceneId !== manifest.source.sceneId
			|| payload.levelId !== manifest.source.levelId
			|| !same(descriptor, { archiveChecksum: entry.archiveChecksum, sourceCount: entry.sourceCount,
				sourceDigest: entry.sourceDigest, asset: entry.asset, replacement: entry.replacement })) {
			fail('Archive differs from its chronological operation.');
		}
		const parent = entry.parentToken === null ? null : archives.get(entry.parentToken);
		if (entry.parentToken !== null && !parent || !same(payload.parent,
			parent ? { file: parent.entry.archive, checksum: parent.entry.archiveChecksum } : null)) {
			fail('Archive parent differs from the chronological journal.');
		}
		for (const reference of [entry.archive, entry.asset,
			...(payload.originalBackground ? [payload.originalBackground.file] : [])]) {
			if (!same(byPath.get(reference.path)?.reference, reference)) fail('Missing exact operation file.');
			usedFiles.add(reference.path);
		}
		archives.set(entry.token, { payload, entry });
	}
	if (usedFiles.size !== byPath.size) fail('Recovery files are outside the retained journal.');
	if (!same(manifest.resources, recoveryProjectResources(project, archives, files))) fail('Cross-generation resource inventory differs from retained artwork.');
	const liveTileIds = new Set();
	let level = structuredClone(manifest.source.level);
	for (const entry of [...journal.entries].reverse()) {
		const record = archives.get(entry.action === 'apply' ? entry.token : entry.parentToken);
		if (!record) fail('Restore has no retained apply archive.');
		const { payload } = record, replacement = payload.replacement;
		if (!same(manifest.source.scene, payload.context.scene)
			|| !layersMatch(project.tree, payload.context.layers)) fail('Scene or layer context cannot preserve this recovery history.');
		const collection = replacement.type === 'Drawing' ? drawings : tiles;
		if (entry.action === 'restore') {
			for (const source of payload.originals) {
				if (!same(drawings.get(source._id), source)) fail('Restored original was edited, removed or reassigned.');
			}
			if (replacement.type === 'LevelBackground') {
				if (!same(level, replacement.before)) fail('Restored background differs from its archived state.');
				level = structuredClone(replacement.after);
			} else {
				if (!same(level, payload.context.level) || collection.has(replacement.id)) fail('Restored replacement identity or Level conflicts.');
				collection.set(replacement.id, replacement.after);
			}
			for (const source of payload.originals) drawings.delete(source._id);
		} else {
			if (payload.originals.some(source => drawings.has(source._id))) fail('Archived original identity is unexpectedly live.');
			if (replacement.type === 'LevelBackground') {
				if (!same(level, replacement.after)) fail('Live baked background differs from recovery.');
				level = structuredClone(replacement.before);
			} else {
				if (!same(level, payload.context.level) || !same(collection.get(replacement.id), replacement.after)) {
					fail('Live baked root was edited, removed or reassigned.');
				}
				if (replacement.type === 'Tile' && manifest.tiles.some(tile => tile._id === replacement.id)) liveTileIds.add(replacement.id);
				collection.delete(replacement.id);
			}
			for (const source of payload.originals) drawings.set(source._id, source);
		}
	}
	if (manifest.tiles.some(tile => !liveTileIds.has(tile._id))) fail('Untracked Tiles are not recovery-project artwork.');
	return manifest;
}

/** Read-only project/history capture. The returned recovery ZIP remains a separate evidence container, not public exchange. */
export async function prepareRecoveryProjectManifest(scene, options = {}) {
	const { levelId, isCurrent } = options;
	if (!game.user?.isGM || typeof isCurrent !== 'function' || !scene?.levels?.has(levelId)
		|| scene.getFlag('foundryshop', 'recovery') !== undefined) fail('GM access, current Level and supported recovery metadata are required.');
	const snapshot = canonicalJson(scene.toObject()), owner = game.user.id;
	const check = () => {
		if (!game.user?.isGM || game.user.id !== owner || options.signal?.aborted || !isCurrent()
			|| game.scenes?.get(scene.id) !== scene || canonicalJson(scene.toObject()) !== snapshot) fail('Source context changed.');
		return true;
	};
	check();
	const bundle = await prepareRecoveryFileBundle(scene, { ...options, isCurrent: check });
	const files = await decodeRecoveryFileBundle(bundle.bytes, options);
	check();
	const sourceDrawings = [...scene.drawings.values()].filter(drawing => drawing.toObject().levels.includes(levelId));
	const journal = readOptimizationJournal(scene);
	const retained = { ...journal, entries: journal.entries.filter(entry => entry.levelId === levelId) };
	const tileIds = new Set(retained.entries.filter(entry => entry.action === 'apply'
		&& entry.replacement.type === 'Tile').map(entry => entry.replacement.id));
	const manifest = {
		format: RECOVERY_PROJECT_FORMAT, version: 1,
		source: { sceneId: scene.id, levelId,
			scene: { width: scene.width, height: scene.height, padding: scene.padding, grid: optimizationSceneGrid(scene) },
			level: scene.levels.get(levelId).toObject() },
		project: validateProjectPackage({
			format: PROJECT_FORMAT, version: PROJECT_VERSION, scope: 'full', coordinateSpace: 'scene-pixels',
			name: scene.name.slice(0, 80), source: { foundry: game.version, drawingSchema: getDocumentClass('Drawing').metadata.schemaVersion },
			tree: readLayerTree(scene), drawings: sourceDrawings.map(drawing => {
				const stored = drawing.toObject();
				if (stored.name === undefined || stored.text === undefined) fail('Native optional strings must round-trip exactly for recovery exchange.');
				return exportProjectDrawing(drawing);
			}), recovery: [], bounds: null, dependencies: {},
		}),
		authors: sourceDrawings.map(drawing => ({ id: drawing.id, author: drawing.toObject().author })),
		tiles: [...scene.tiles.values()].filter(tile => tileIds.has(tile.id)).map(tile => tile.toObject()),
		journal: retained, resources: null,
	};
	const archives = new Map();
	for (const file of files.filter(file => file.reference.path.endsWith('.json'))) {
		const archive = await readOptimizationArchive(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes));
		archives.set(archive.payload.id, archive);
	}
	manifest.resources = recoveryProjectResources(manifest.project, archives, files);
	const validated = await validateRecoveryProjectManifest(manifest, files);
	const reconstructed = reconstructRecoveryProjectDrawings(validated.project, validated.authors);
	if (sourceDrawings.some(drawing => !same(reconstructed.find(source => source._id === drawing.id), drawing.toObject()))) {
		fail('Live Drawing metadata does not round-trip exactly through the project manifest.');
	}
	check();
	return { manifest: validated, recoveryFiles: files, recoveryZip: bundle.bytes,
		review: { ...bundle.review, drawingCount: sourceDrawings.length, tileCount: manifest.tiles.length,
			missingImageBytes: manifest.resources.images.filter(image => image.file === null).map(image => image.source),
			fonts: manifest.resources.fonts,
			disclosure: 'Read-only source project and verified history. Ordinary textures/fonts remain references. No enclosing project ZIP, destination remapping, durable import or portable Restore is provided.' } };
}
