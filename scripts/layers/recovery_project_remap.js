import { decodeRecoveryProjectBundle, encodeRecoveryProjectBundle } from './recovery_project_bundle.js';
import { recoveryZipBudget } from './recovery_file_bundle.js';
import { reconstructRecoveryProjectDrawings, recoveryProjectResources, validateRecoveryProjectManifest } from './recovery_project_manifest.js';
import { encodeOptimizationArchive, readOptimizationArchive, optimizationArchiveDescriptor, prepareOptimizationArchiveFile } from './optimization_recovery.js';
import { canonicalJson, validateProjectPackage } from './project_package.js';
import { exportProjectDrawing } from './project_transfer_service.js';
import { validateStoredFile, fileFingerprint } from '../verified_file_storage.js';
import { inspectOptimizationImage } from '../optimization_media.js';
import { validateLayerTree } from './layer_tree_store.js';

const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value) && value !== '__unassigned__';
const fail = message => { throw new Error(`Recovery remapping: ${message}`); };
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

/**
 * Pure destination-bound evidence planning, not import authorization.
 * No hidden wrapper, additive merge, native document validation or persistence occurs here.
 */
export async function remapRecoveryProjectBundle(input, destination, options) {
	const limits = recoveryZipBudget(options);
	if (!destination || ![destination.sceneId, destination.level?._id, destination.authorId].every(id)
		|| !destination.scene || typeof destination.root !== 'string'
		|| !Array.isArray(destination.reservedIds) || destination.reservedIds.some(value => !id(value))
		|| !Array.isArray(destination.reservedPaths) || destination.reservedPaths.some(value => typeof value !== 'string')
		|| typeof options.createId !== 'function') fail('Explicit destination context, reserved identities/paths and ID allocator are required.');
	const target = structuredClone(destination), source = await decodeRecoveryProjectBundle(input, limits),
		{ manifest, recoveryFiles, imageAssets } = source;
	const records = new Map();
	for (const entry of manifest.journal.entries.filter(entry => entry.action === 'apply')) {
		const file = recoveryFiles.find(file => file.reference.path === entry.archive.path);
		records.set(entry.token, await readOptimizationArchive(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)));
	}
	const native = reconstructRecoveryProjectDrawings(manifest.project, manifest.authors);
	const keys = { nodes: new Set(manifest.project.tree.nodes.map(node => node.id)),
		presets: new Set(manifest.project.tree.presets.map(preset => preset.id)),
		drawings: new Set(native.map(drawing => drawing._id)), tiles: new Set(manifest.tiles.map(tile => tile._id)),
		operations: new Set(manifest.journal.entries.map(entry => entry.token)) };
	for (const { payload } of records.values()) {
		for (const original of payload.originals) keys.drawings.add(original._id);
		if (payload.replacement.type === 'Drawing') keys.drawings.add(payload.replacement.id);
		if (payload.replacement.type === 'Tile') keys.tiles.add(payload.replacement.id);
	}
	const forbidden = new Set([target.sceneId, target.level._id, target.authorId, manifest.source.sceneId,
		manifest.source.levelId, ...target.reservedIds, ...Object.values(keys).flatMap(set => [...set])]);
	for (const { payload } of records.values()) for (const original of payload.originals) forbidden.add(original.author);
	for (const author of manifest.authors) forbidden.add(author.author);
	const fresh = () => {
		const value = options.createId();
		if (!id(value) || forbidden.has(value)) fail('ID allocator returned an invalid, occupied or reused identity.');
		forbidden.add(value);
		return value;
	};
	const importId = fresh(), maps = Object.fromEntries(Object.entries(keys)
		.map(([kind, values]) => [kind, new Map([...values].map(value => [value, fresh()]))]));
	const presentation = options.presentation;
	if (presentation !== undefined && (!presentation || !Number.isSafeInteger(presentation.revision)
		|| presentation.revision < 0)) fail('Explicit destination layer revision is required for hidden presentation.');
	const needsUnassigned = [...native, ...[...records.values()].flatMap(({ payload }) => [
		...payload.originals, ...(payload.replacement.type === 'Drawing'
			? [payload.replacement.staged, payload.replacement.after] : []),
	])].some(source => source.flags.foundryshop?.layerId == null);
	const presentationIds = presentation ? { rootId: fresh(), presetId: fresh(),
		unassignedId: needsUnassigned ? fresh() : null } : null;
	const mapped = (map, value) => {
		if (!map.has(value)) fail(`Unmapped retained identity: ${value}.`);
		return map.get(value);
	};
	const fileMap = new Map(), uploads = new Map(), paths = new Set([
		...target.reservedPaths, ...recoveryFiles.map(file => file.reference.path),
		...manifest.resources.images.map(image => image.source),
	]);
	const reserve = reference => {
		if (paths.has(reference.path)) fail('Destination file path is occupied or would reuse a source path.');
		paths.add(reference.path);
		return reference;
	};
	const imageReference = (reference, filename) => reserve(validateStoredFile({
		...reference, root: target.root, path: `${target.root}/${filename}`,
	}));
	const bytesByPath = new Map(recoveryFiles.map(file => [file.reference.path, file.bytes]));
	let imageIndex = 0;
	for (const file of recoveryFiles.filter(file => !file.reference.path.endsWith('.json'))) {
		const extension = file.reference.path.split('.').at(-1);
		const reference = imageReference(file.reference, `image-${importId}-${imageIndex++}.${extension}`);
		fileMap.set(file.reference.path, reference);
		uploads.set(reference.path, { reference, bytes: file.bytes });
	}
	const imageMap = new Map();
	for (const image of manifest.resources.images) {
		let reference = fileMap.get(image.source);
		if (!reference) {
			const bytes = image.file ? bytesByPath.get(image.file.path)
				: imageAssets.find(asset => asset.source === image.source)?.bytes;
			if (!bytes) fail('Image source has no verified bytes.');
			// Ordinary assets and preserved background aliases need upload paths too.
			const referenceInput = { version: 1, bytes: bytes.length, fingerprint: await fileFingerprint(bytes) };
			reference = imageReference(referenceInput,
				`image-${importId}-${imageIndex++}.${inspectOptimizationImage(bytes).extension}`);
			uploads.set(reference.path, { reference, bytes });
		}
		imageMap.set(image.source, reference.path);
	}
	const texture = value => value ? mapped(imageMap, value) : value;
	const tree = value => {
		const result = {
		...structuredClone(value),
		nodes: value.nodes.map(node => ({ ...structuredClone(node), id: mapped(maps.nodes, node.id),
			parentId: node.parentId === null ? null : mapped(maps.nodes, node.parentId),
			defaults: { ...structuredClone(node.defaults), ...(node.defaults.texture ? { texture: texture(node.defaults.texture) } : {}) } })),
		presets: value.presets.map(preset => ({ ...structuredClone(preset), id: mapped(maps.presets, preset.id),
			entries: preset.entries.map(entry => ({ ...entry, nodeId: mapped(maps.nodes, entry.nodeId) })) })),
		};
		if (!presentationIds) return result;
		const { rootId, presetId, unassignedId } = presentationIds;
		const node = (id, name, kind) => ({ id, name, kind, parentId: kind === 'group' ? null : rootId,
			playerAllowed: false, locked: false, defaults: {} });
		const imported = result.nodes.map(node => ({ ...node, parentId: node.parentId === null ? rootId : node.parentId }));
		const unassigned = unassignedId ? [node(unassignedId, 'Imported Unassigned', 'layer')] : [];
		const desired = [{ nodeId: rootId, playerAllowed: true },
			...imported.map(node => ({ nodeId: node.id, playerAllowed: node.playerAllowed })),
			...(unassignedId ? [{ nodeId: unassignedId, playerAllowed: true }] : [])];
		const names = new Set(result.presets.map(preset => preset.name.toLowerCase()));
		let name = 'Imported Presentation';
		for (let index = 2; names.has(name.toLowerCase()); index++) name = `Imported Presentation (${index})`;
		return validateLayerTree({ ...result, revision: presentation.revision,
			nodes: [node(rootId, manifest.project.name, 'group'), ...imported, ...unassigned],
			presets: [...result.presets.map(preset => ({ ...preset, entries: [
				{ nodeId: rootId, playerAllowed: true }, ...preset.entries,
				...(unassignedId ? [{ nodeId: unassignedId, playerAllowed: false }] : []),
			] })), { id: presetId, name, entries: desired }] });
	};
	const document = (value, type) => {
		const result = structuredClone(value);
		result._id = mapped(type === 'Drawing' ? maps.drawings : maps.tiles, value._id);
		result.levels = [target.level._id];
		if (type === 'Drawing') { result.author = target.authorId; result.texture = texture(result.texture); }
		else result.texture.src = texture(result.texture.src);
		if (result.flags.foundryshop?.layerId) result.flags.foundryshop.layerId = mapped(maps.nodes, result.flags.foundryshop.layerId);
		else if (type === 'Drawing' && presentationIds?.unassignedId) {
			result.flags.foundryshop ??= {};
			result.flags.foundryshop.layerId = presentationIds.unassignedId;
		}
		return result;
	};
	const hasBackground = [...records.values()].some(record => record.payload.replacement.type === 'LevelBackground');
	const level = value => {
		const result = structuredClone(target.level);
		if (hasBackground) {
			result.background = structuredClone(value.background);
			result.background.src = texture(result.background.src);
			if (Object.hasOwn(value, 'textures')) result.textures = structuredClone(value.textures);
			else delete result.textures;
		}
		return result;
	};
	const remappedFiles = [...fileMap].map(([path, reference]) => ({ reference, bytes: bytesByPath.get(path) }));
	const archives = new Map(), entries = [];
	for (const entry of manifest.journal.entries) {
		const token = mapped(maps.operations, entry.token), parentToken = entry.parentToken === null ? null : mapped(maps.operations, entry.parentToken);
		let descriptor, reference;
		if (entry.action === 'apply') {
			const { payload: original } = records.get(entry.token), payload = structuredClone(original);
			payload.id = token; payload.sceneId = target.sceneId; payload.levelId = target.level._id;
			payload.scope.layerId = payload.scope.layerId === null ? null : mapped(maps.nodes, payload.scope.layerId);
			payload.context = { scene: structuredClone(target.scene), layers: tree(original.context.layers), level: level(original.context.level) };
			payload.originals = original.originals.map(source => document(source, 'Drawing'));
			payload.output = fileMap.get(original.output.path);
			payload.originalBackground = original.originalBackground ? {
				src: texture(original.originalBackground.src), file: fileMap.get(original.originalBackground.file.path),
			} : null;
			payload.parent = parentToken === null ? null : {
				file: archives.get(parentToken).reference, checksum: archives.get(parentToken).descriptor.archiveChecksum,
			};
			const replacement = original.replacement;
			payload.replacement = replacement.type === 'LevelBackground'
				? { type: replacement.type, id: target.level._id, before: level(replacement.before), staged: null, after: level(replacement.after) }
				: { type: replacement.type, id: mapped(replacement.type === 'Drawing' ? maps.drawings : maps.tiles, replacement.id),
					before: null, staged: document(replacement.staged, replacement.type), after: document(replacement.after, replacement.type) };
			const { text } = await encodeOptimizationArchive(payload);
			descriptor = await optimizationArchiveDescriptor(text);
			reference = reserve(await prepareOptimizationArchiveFile(text, target.root));
			const bytes = new TextEncoder().encode(text);
			remappedFiles.push({ reference, bytes }); uploads.set(reference.path, { reference, bytes });
			archives.set(token, { payload, reference, descriptor });
		} else {
			({ reference, descriptor } = archives.get(parentToken));
		}
		entries.push({ ...descriptor, token, sceneId: target.sceneId, levelId: target.level._id,
			ownerId: target.authorId, action: entry.action, phase: 'complete', archive: reference, parentToken });
	}
	const live = native.map(source => document(source, 'Drawing'));
	const project = validateProjectPackage({ ...manifest.project, tree: tree(manifest.project.tree),
		drawings: live.map(source => exportProjectDrawing({ id: source._id, toObject: () => structuredClone(source) })),
		bounds: null, dependencies: {} });
	const result = { ...manifest, source: { sceneId: target.sceneId, levelId: target.level._id,
		scene: structuredClone(target.scene), level: level(manifest.source.level) },
		project, authors: live.map(source => ({ id: source._id, author: source.author })),
		tiles: manifest.tiles.map(source => document(source, 'Tile')),
		journal: { version: 1, revision: manifest.journal.revision, entries },
		resources: recoveryProjectResources(project, archives, remappedFiles) };
	const validated = await validateRecoveryProjectManifest(result, remappedFiles);
	const ordinary = validated.resources.images.filter(image => image.file === null)
		.map(image => ({ source: image.source, bytes: uploads.get(image.source).bytes }));
	const bytes = await encodeRecoveryProjectBundle(validated, remappedFiles, ordinary, limits);
	await decodeRecoveryProjectBundle(bytes, limits);
	if (!same(reconstructRecoveryProjectDrawings(validated.project, validated.authors), live)) fail('Remapped native artwork did not round-trip exactly.');
	if ([...uploads.values()].reduce((sum, file) => sum + file.bytes.length, 0) > limits.maxBytes) fail('Planned uploads exceed the reviewed byte budget.');
	return { bytes, manifest: validated, recoveryFiles: remappedFiles, imageAssets: ordinary, uploads: [...uploads.values()],
		destinationBaseline: target, presentation: presentationIds,
		mappings: Object.fromEntries(Object.entries(maps).map(([kind, map]) => [kind, [...map]])),
		provenance: { importId, sourceSceneId: manifest.source.sceneId, sourceLevelId: manifest.source.levelId,
			authors: [...new Map([...native, ...[...records.values()].flatMap(record => record.payload.originals)]
				.map(source => [source._id, { id: source._id, author: source.author }])).values()] },
		review: { coordinatePolicy: 'unchanged-scene-pixels', elevationPolicy: 'retain-numeric',
			hasBackground, backgroundPolicy: hasBackground ? 'import-source-background-and-texture-transform' : 'preserve-destination',
			uploadCount: uploads.size,
			disclosure: 'Pure destination-bound recovery evidence. Not an authorized import: hidden staging/presentation, additive ordering, background approval, durable intent, uploads and native validation/Restore acceptance remain required.' } };
}
