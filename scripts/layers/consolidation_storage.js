import {
	readConsolidationArchive, assertConsolidationSourcesCurrent, CONSOLIDATION_ARCHIVE_MAX_BYTES,
} from './consolidation_recovery.js';
import {
	persistVerifiedFile, readVerifiedFile, validateStoredFile, fileFingerprint, UnverifiedFileError,
} from '../verified_file_storage.js';

const FORMAT = 'foundryshop-consolidation-reference';
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);

function validateReference(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 7
		|| !['format', 'version', 'archiveId', 'sceneId', 'levelId', 'checksum', 'file'].every(key => Object.hasOwn(input, key))
		|| input.format !== FORMAT || input.version !== 1
		|| ![input.archiveId, input.sceneId, input.levelId].every(id)
		|| typeof input.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(input.checksum)) {
		throw new Error('Invalid consolidation recovery reference.');
	}
	const file = validateStoredFile(input.file);
	if (!file.path.endsWith('.json') || file.bytes > CONSOLIDATION_ARCHIVE_MAX_BYTES) {
		throw new Error('Invalid consolidation recovery file size/type.');
	}
	return { ...structuredClone(input), file };
}

/** Prepares a deterministic recovery reference for the caller's durable intent journal. No upload occurs. */
export async function prepareConsolidationPersistence(scene, archiveText, { root, token } = {}) {
	if (!id(token)) throw new Error('Consolidation persistence requires a unique operation token.');
	const { payload, checksum } = await readConsolidationArchive(archiveText);
	assertConsolidationSourcesCurrent(scene, payload);
	const blob = new Blob([archiveText], { type: 'application/json' });
	const fingerprint = await fileFingerprint(await blob.arrayBuffer());
	assertConsolidationSourcesCurrent(scene, payload);
	return validateReference({
		format: FORMAT, version: 1, archiveId: payload.id, sceneId: payload.sceneId,
		levelId: payload.levelId, checksum,
		file: { version: 1, root, path: `${root}/consolidation-${payload.id}-${token}.json`, bytes: blob.size, fingerprint },
	});
}

/** Caller must journal the prepared reference before this step. Never writes/deletes Drawing documents. */
export async function persistConsolidationArchive(scene, archiveText, reference, { signal, isCurrent } = {}) {
	const expected = validateReference(reference);
	if (typeof isCurrent !== 'function') throw new Error('Consolidation persistence requires an explicit journal/context guard.');
	const { payload, checksum } = await readConsolidationArchive(archiveText);
	if (payload.id !== expected.archiveId || payload.sceneId !== expected.sceneId
		|| payload.levelId !== expected.levelId || checksum !== expected.checksum) {
		throw new Error('Consolidation archive does not match its prepared reference.');
	}
	const check = () => {
		assertConsolidationSourcesCurrent(scene, payload);
		if (!isCurrent()) throw new Error('Consolidation persistence journal/context changed.');
		return true;
	};
	check();
	const blob = new Blob([archiveText], { type: 'application/json' });
	const fingerprint = await fileFingerprint(await blob.arrayBuffer());
	check();
	if (blob.size !== expected.file.bytes || fingerprint !== expected.file.fingerprint) {
		throw new Error('Consolidation archive bytes differ from its prepared reference.');
	}
	const file = await persistVerifiedFile(blob, {
		root: expected.file.root, filename: expected.file.path.slice(expected.file.root.length + 1),
		signal, isCurrent: check,
	});
	try {
		await readStoredConsolidationArchive({ ...expected, file }, { signal, isCurrent: check });
		check();
	} catch (error) { throw new UnverifiedFileError(file.path, error); }
	return { ...expected, file };
}

/** Reload-safe read: both persisted bytes and archive identity/checksum must match the retained reference. */
export async function readStoredConsolidationArchive(reference, options = {}) {
	const expected = validateReference(reference);
	const bytes = await readVerifiedFile(expected.file, options);
	const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	const archive = await readConsolidationArchive(text);
	const { payload, checksum } = archive;
	if (payload.id !== expected.archiveId || payload.sceneId !== expected.sceneId
		|| payload.levelId !== expected.levelId || checksum !== expected.checksum) {
		throw new Error('Stored consolidation archive identity/checksum differs from its reference.');
	}
	if (options.signal?.aborted || !game.user.isGM || !game.user.can('FILES_BROWSE')
		|| (options.isCurrent && !options.isCurrent())) {
		throw new Error('Recovery authority/context changed during archive verification.');
	}
	return { ...archive, text };
}
