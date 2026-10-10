import { canonicalJson } from './project_package.js';
import { fileFingerprint, validateStoredFile } from '../verified_file_storage.js';
import { inspectOptimizationImage } from '../optimization_media.js';
import { publicationBackgroundSnapshot } from '../publication_background.js';
import { MODULE } from '../constants.js';
import { consolidationRun } from './consolidation_placement.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const rectangle = source => Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, source?.[key]]));

/** One deterministic output descriptor shared by native construction and durable preparation. */
export async function prepareBakeOutputFile(blob, root, token) {
	if (!(blob instanceof Blob) || !blob.size || !/^[a-zA-Z0-9_-]{1,64}$/.test(token)) {
		throw new Error('Bake output requires exact nonempty bytes and a valid operation token.');
	}
	const bytes = await blob.arrayBuffer(), header = inspectOptimizationImage(new Uint8Array(bytes));
	if (!['png', 'webp'].includes(header.extension) || blob.type !== header.mime) {
		throw new Error('Bake output must be static PNG/WEBP bytes with their exact MIME type.');
	}
	return validateStoredFile({ version: 1, root, path: `${root}/bake-${token}.${header.extension}`,
		bytes: blob.size, fingerprint: await fileFingerprint(bytes) });
}

function matchesRequested(actual, requested) {
	return Object.entries(requested).every(([key, value]) => value && typeof value === 'object' && !Array.isArray(value)
		? actual?.[key] && matchesRequested(actual[key], value) : same(actual?.[key], value));
}

function nativeSource(scene, type, requested, defaults = false) {
	const Document = getDocumentClass(type);
	if (typeof Document !== 'function') throw new Error(`Native ${type} document class is unavailable.`);
	const source = new Document(structuredClone(requested), { parent: scene, strict: true }).toObject();
	if (defaults ? !matchesRequested(source, requested) : !same(source, requested)) {
		throw new Error(`Native ${type} schema normalization changes the requested bake replacement.`);
	}
	const roundTrip = new Document(structuredClone(source), { parent: scene, strict: true }).toObject();
	if (!same(roundTrip, source)) throw new Error(`Native ${type} bake source cannot round-trip exactly.`);
	return source;
}

/** Detached native sources only. This constructs neither a Placeable nor a world document. */
export function createBakeReplacement(scene, {
	levelId, output, rendered, audience, replacementId, sort, sourceIds, isCurrent,
} = {}) {
	if (!game.user?.isGM || !scene?.levels?.has(levelId) || typeof isCurrent !== 'function' || !isCurrent()
		|| !['gm', 'player'].includes(audience)) {
		throw new Error('Bake replacement requires GM access, an existing Level, exact audience and a current review.');
	}
	const file = validateStoredFile(output), bounds = rectangle(rendered?.bounds), review = rendered?.review;
	if (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))
		|| ![bounds.width, bounds.height].every(value => Number.isSafeInteger(value) && value > 0)
		|| ![bounds.x + bounds.width, bounds.y + bounds.height].every(Number.isFinite)
		|| rendered.width !== bounds.width || rendered.height !== bounds.height
		|| !review || !same(review.bounds, bounds) || review.width !== bounds.width || review.height !== bounds.height
		|| !['png', 'webp'].includes(review.format) || !file.path.endsWith(`.${review.format}`)
		|| !['tile', 'background', 'drawing'].includes(review.destination)) {
		throw new Error('Bake replacement requires exact reviewed dimensions, crop, destination and output encoding.');
	}
	const level = scene.levels.get(levelId).toObject(), ground = level.elevation?.bottom;
	if (!Number.isFinite(ground)) throw new Error('Bake replacement requires a finite Level ground elevation.');
	let replacement;
	if (review.destination === 'drawing') {
		if (typeof replacementId !== 'string' || !/^[a-zA-Z0-9]{16}$/.test(replacementId)
			|| !scene.drawings || scene.drawings.has(replacementId) || sort !== undefined || !Array.isArray(sourceIds)
			|| sourceIds.some(id => !scene.drawings.has(id))) {
			throw new Error('Consolidate requires an unoccupied Drawing identity and exact source IDs, not a custom sort.');
		}
		const run = consolidationRun(scene, levelId, sourceIds.map(id => scene.drawings.get(id).toObject()));
		const after = nativeSource(scene, 'Drawing', {
			_id: replacementId, name: '', text: '', author: game.user.id,
			x: bounds.x, y: bounds.y, levels: [levelId], elevation: run.elevation, sort: run.sort,
			shape: { type: 'r', width: bounds.width, height: bounds.height, points: [] },
			rotation: 0, strokeWidth: 0, fillType: 2, fillColor: '#ffffff', fillAlpha: 1,
			texture: file.path, hidden: false, locked: false, interface: false,
			flags: { [MODULE]: { imageStamp: 1, ...(run.layerId === null ? {} : { layerId: run.layerId }) } },
		}, true);
		if (!same(after.flags, { [MODULE]: { imageStamp: 1, ...(run.layerId === null ? {} : { layerId: run.layerId }) } })) {
			throw new Error('Native Consolidate Drawing defaults added unreviewed renderer metadata.');
		}
		const staged = nativeSource(scene, 'Drawing', { ...structuredClone(after), hidden: true });
		replacement = { type: 'Drawing', id: replacementId, before: null, staged, after };
	} else if (review.destination === 'tile') {
		if (typeof replacementId !== 'string' || !/^[a-zA-Z0-9]{16}$/.test(replacementId)
			|| !Number.isSafeInteger(sort) || scene.tiles?.has(replacementId)) {
			throw new Error('Bake Tile requires an unoccupied native 16-character identity and explicit integer sort.');
		}
		const after = nativeSource(scene, 'Tile', {
			_id: replacementId, name: '', ...bounds, levels: [levelId], elevation: ground, sort,
			texture: { src: file.path, anchorX: 0, anchorY: 0, fit: 'fill',
				scaleX: 1, scaleY: 1, tint: '#ffffff' },
			rotation: 0, alpha: 1, hidden: audience === 'gm', locked: true,
			restrictions: { light: false, weather: false }, occlusion: { modes: [], alpha: 0 }, flags: {},
		}, true);
		if (!same(after.flags, {})) throw new Error('Native Bake Tile defaults added unreviewed renderer metadata.');
		const staged = nativeSource(scene, 'Tile', { ...structuredClone(after), hidden: true });
		replacement = { type: 'Tile', id: replacementId, before: null, staged, after };
	} else {
		if (audience !== 'player' || replacementId !== undefined || sort !== undefined) {
			throw new Error('Background bake requires public audience and no Tile identity/sort options.');
		}
		const background = publicationBackgroundSnapshot(scene, levelId);
		if (!same(rendered.background, background) || !same(bounds, background.rect)
			|| !same(background.transform, { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0,
				fit: 'fill', scaleX: 1, scaleY: 1, rotation: 0 })) {
			throw new Error('Background bake requires the exact full Scene and current identity-transform Level snapshot.');
		}
		const before = nativeSource(scene, 'Level', level);
		const after = nativeSource(scene, 'Level', { ...structuredClone(before),
			background: { ...before.background, src: file.path, color: '#ffffff', tint: '#ffffff' } });
		replacement = { type: 'LevelBackground', id: levelId, before, staged: null, after };
	}
	if (!game.user?.isGM || !isCurrent() || !same(scene.levels.get(levelId)?.toObject(), level)
		|| replacement.type === 'Tile' && scene.tiles?.has(replacement.id)
		|| replacement.type === 'Drawing' && scene.drawings?.has(replacement.id)) {
		throw new Error('Bake replacement native context changed during detached construction.');
	}
	return structuredClone(replacement);
}
