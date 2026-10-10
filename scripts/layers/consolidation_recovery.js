import { validateProjectPackage, canonicalJson } from './project_package.js';
import { exportDrawingSelection, exportProjectDrawing } from './project_transfer_service.js';

export const CONSOLIDATION_ARCHIVE_FORMAT = 'foundryshop-consolidation-originals';
export const CONSOLIDATION_ARCHIVE_MAX_BYTES = 5 * 1024 * 1024;
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const bytes = text => new TextEncoder().encode(text);
const exactKeys = (object, keys) => object && typeof object === 'object' && !Array.isArray(object)
	&& Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(canonicalJson(value))))]
	.map(byte => byte.toString(16).padStart(2, '0')).join('');

function validatePayload(payload) {
	if (!exactKeys(payload, ['format', 'version', 'id', 'sceneId', 'levelId', 'project', 'originals', 'replacement'])
		|| payload.format !== CONSOLIDATION_ARCHIVE_FORMAT || payload.version !== 1
		|| ![payload.id, payload.sceneId, payload.levelId].every(validId)) {
		throw new Error('Invalid consolidation originals archive header.');
	}
	const project = validateProjectPackage(payload.project);
	if (!project.drawings.length || project.drawings.length > 1000
		|| project.drawings.some(e => e.data.levels.length !== 1 || e.data.levels[0] !== payload.levelId)
		|| !Array.isArray(payload.originals) || payload.originals.length !== project.drawings.length) {
		throw new Error('Consolidation archive requires bounded originals on one explicit Level.');
	}
	const seen = new Set(), entries = new Map(project.drawings.map(e => [e.id, e]));
	for (const source of payload.originals) {
		if (!source || !validId(source._id) || seen.has(source._id) || !entries.has(source._id)
			|| !validId(source.author)) throw new Error('Invalid original Drawing identity/author in archive.');
		seen.add(source._id);
		const entry = exportProjectDrawing({ id: source._id, toObject: () => structuredClone(source) });
		if (canonicalJson(entry) !== canonicalJson(entries.get(source._id))) {
			throw new Error('Archived originals do not match the verified source project.');
		}
	}
	const replacement = payload.replacement;
	const verified = validateProjectPackage({ ...project, drawings: [replacement], recovery: [] }).drawings[0];
	if (seen.has(verified.id) || verified.data.flags.foundryshop?.imageStamp !== 1
		|| verified.data.levels.length !== 1 || verified.data.levels[0] !== payload.levelId) {
		throw new Error('Archive replacement must be a distinct image Drawing on the source Level.');
	}
	return payload;
}

export function assertConsolidationSourcesCurrent(scene, payload) {
	if (!game.user.isGM || !scene?.levels?.has(payload.levelId) || scene.id !== payload.sceneId
		|| scene.getFlag('foundryshop', 'projectImportJournal')
		|| canonicalJson(exportDrawingSelection(scene, payload.originals.map(source => source._id))) !== canonicalJson(payload.project)
		|| payload.originals.some(source => canonicalJson(scene.drawings.get(source._id)?.toObject()) !== canonicalJson(source))) {
		throw new Error('Original Drawings changed during archive preparation or persistence.');
	}
}

/** Independent archive preparation only. Persist and read back successfully before deleting any originals. */
export async function createConsolidationArchive(scene, selectedIds, replacement, { id, levelId }) {
	if (!game.user.isGM || !scene.levels?.has(levelId)) throw new Error('Consolidation archive requires GM access and an existing Level.');
	if (!Array.isArray(selectedIds) || selectedIds.length > 1000) throw new RangeError('Consolidation archive selection exceeds 1000 originals.');
	const project = exportDrawingSelection(scene, selectedIds);
	const payload = {
		format: CONSOLIDATION_ARCHIVE_FORMAT, version: 1, id, sceneId: scene.id, levelId,
		project, originals: project.drawings.map(e => scene.drawings.get(e.id).toObject()),
		replacement: structuredClone(replacement),
	};
	validatePayload(payload);
	const before = canonicalJson(payload);
	if (bytes(before).length > CONSOLIDATION_ARCHIVE_MAX_BYTES) throw new RangeError('Consolidation archive exceeds 5 MiB.');
	if (canonicalJson(JSON.parse(JSON.stringify(payload))) !== before) {
		throw new Error('Original source contains values that cannot round-trip through the JSON archive.');
	}
	const checksum = await digest(payload);
	assertConsolidationSourcesCurrent(scene, payload);
	const text = JSON.stringify({ payload, checksum });
	if (bytes(text).length > CONSOLIDATION_ARCHIVE_MAX_BYTES) throw new RangeError('Consolidation archive exceeds 5 MiB.');
	return { text, checksum, sourceCount: project.drawings.length };
}

/** Read back the persisted bytes; successful serialization alone is not durable recovery. */
export async function readConsolidationArchive(text) {
	if (typeof text !== 'string' || bytes(text).length > CONSOLIDATION_ARCHIVE_MAX_BYTES) {
		throw new RangeError('Consolidation archive exceeds bounded input limits.');
	}
	const archive = JSON.parse(text);
	if (!exactKeys(archive, ['payload', 'checksum']) || !/^[a-f0-9]{64}$/.test(archive.checksum)) {
		throw new Error('Invalid consolidation archive envelope.');
	}
	validatePayload(archive.payload);
	if (await digest(archive.payload) !== archive.checksum) throw new Error('Consolidation archive checksum mismatch.');
	return structuredClone(archive);
}

/** Fail-closed restoration preview. No source creation or composite deletion occurs here. */
export async function prepareConsolidationRestore(scene, archiveText) {
	if (!game.user.isGM || !scene) throw new Error('Consolidation restore requires a GM and Scene.');
	const { payload, checksum } = await readConsolidationArchive(archiveText);
	if (!game.user.isGM) throw new Error('GM authority changed during recovery verification.');
	if (scene.id !== payload.sceneId || !scene.levels?.has(payload.levelId)
		|| scene.getFlag('foundryshop', 'projectImportJournal')) throw new Error('Archive Scene/Level mismatch or unfinished import.');
	const composite = scene.drawings.get(payload.replacement.id);
	if (!composite || canonicalJson(exportProjectDrawing(composite)) !== canonicalJson(payload.replacement)) {
		throw new Error('Composite is missing, edited or reassigned; review the conflict before restoring originals.');
	}
	if (payload.originals.some(source => scene.drawings.has(source._id))) {
		throw new Error('Original Drawing identities are already occupied; automatic restoration refused.');
	}
	const liveTree = scene.getFlag('foundryshop', 'layers');
	for (const original of payload.project.drawings) {
		if (original.layerId !== null && !liveTree?.nodes?.some(n => n.id === original.layerId && n.kind === 'layer')) {
			throw new Error('An original layer is missing; review destination membership before restoration.');
		}
	}
	return {
		strategy: 'restore-preview-only', archiveId: payload.id, checksum,
		create: structuredClone(payload.originals), removeCompositeId: composite.id,
		disclosure: 'A verified staged restoration transaction is required before deleting the composite. Newer/unrelated Drawings are not part of this plan.',
	};
}
