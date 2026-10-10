import { MODULE } from './constants.js';
import { validateAssetFolder } from './artwork_stamps.js';
import { parseProjectPackage, validateProjectPackage, serializeProjectPackage, PROJECT_LIMITS } from './layers/project_package.js';
import { SHAPE_FORMAT, validateShapePackage } from './shape_package.js';
import { normalizeLibraryMetadata } from './library_metadata.js';

export const LIBRARY_FOLDER = 'projectLibraryFolder';
export const LIBRARY_OPERATIONS = 'libraryFileOperations';
export const LIBRARY_CATALOG = 'libraryCatalog';
export const LIBRARY_CHANGED = 'foundryshopLibraryChanged';
export const LIBRARY_LIMITS = { entries: 100, bytes: 64 * 1024 * 1024, timeout: 10000 };
const loc = key => game.i18n.localize(`FOUNDRYSHOP.Library.${key}`);

function rootFolder() {
	if (!game.user.isGM || !game.user.can('FILES_BROWSE')) throw new Error(loc('Denied'));
	return validateLibraryFolder(game.settings.get(MODULE, LIBRARY_FOLDER));
}

export function validateLibraryFolder(value) {
	try { return validateAssetFolder(value); }
	catch (error) { throw new Error(loc('FolderInvalid'), { cause: error }); }
}

function packagePath(path, root) {
	if (typeof path !== 'string' || path.length > 400) throw new Error(loc('UnsafePath'));
	const decoded = decodeURIComponent(path);
	const prefix = `${root}/`, name = decoded.slice(prefix.length);
	if (!decoded.startsWith(prefix) || !name || !/^[a-zA-Z0-9 _().-]+\.json$/i.test(name)
		|| name.startsWith('.') || name.includes('/')) throw new Error(loc('UnsafePath'));
	return decoded;
}

async function readPackage(path, root, budget, signal) {
	path = packagePath(path, root);
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal?.addEventListener('abort', abort, { once: true });
	if (signal?.aborted) controller.abort();
	const timer = setTimeout(abort, LIBRARY_LIMITS.timeout);
	try {
		const url = new URL(path.split('/').map(encodeURIComponent).join('/'), location.href);
		const response = await fetch(url, {
			signal: controller.signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store',
		});
		if (!response.ok || !response.body) throw new Error(`${loc('ReadFailed')} HTTP ${response.status}`);
		const length = response.headers.get('content-length');
		if (length && Number(length) > PROJECT_LIMITS.bytes) throw new Error(loc('TooLarge'));
		const reader = response.body.getReader(), chunks = [];
		let size = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength; budget.bytes += value.byteLength;
				if (size > PROJECT_LIMITS.bytes || budget.bytes > LIBRARY_LIMITS.bytes) throw new Error(loc('TooLarge'));
				chunks.push(value);
			}
		} finally { await reader.cancel(); reader.releaseLock(); }
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		const input = JSON.parse(text);
		const shape = input?.format === SHAPE_FORMAT ? validateShapePackage(input) : null;
		const project = shape ? shape.project : parseProjectPackage(text);
		const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
		const fingerprint = [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('');
		if (controller.signal.aborted) throw new Error(loc('Cancelled'));
		return { project, shape, fingerprint, path };
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', abort);
	}
}

export async function indexProjectLibrary(signal) {
	const root = rootFolder();
	readLibraryOperations();
	readLibraryCatalog();
	const listing = await foundry.applications.apps.FilePicker.implementation.browse('data', root);
	if (signal?.aborted) throw new Error(loc('Cancelled'));
	if (!Array.isArray(listing.files)) throw new Error(loc('ReadFailed'));
	const paths = listing.files.filter(path => typeof path === 'string' && /\.json$/i.test(path));
	if (paths.length > LIBRARY_LIMITS.entries) throw new Error(loc('TooMany'));
	const entries = [], budget = { bytes: 0 }, seen = new Set(), identities = new Set();
	for (const path of paths.sort()) {
		if (signal?.aborted || rootFolder() !== root) throw new Error(loc('Changed'));
		if (budget.bytes >= LIBRARY_LIMITS.bytes) throw new Error(loc('TooLarge'));
		try {
			const normalized = packagePath(path, root);
			if (seen.has(normalized)) throw new Error(loc('Duplicate'));
			seen.add(normalized);
			const { project, shape, fingerprint } = await readPackage(normalized, root, budget, signal);
			const identity = shape ? `shape:${shape.id}` : project.library ? `project:${project.library.id}` : null;
			if (identity) {
				if (identities.has(identity)) throw new Error(loc('Duplicate'));
				identities.add(identity);
			}
			entries.push(libraryMetadata({ path: normalized, root, fingerprint, project, shape }));
		} catch (error) {
			if (signal?.aborted) throw error;
			console.warn('Foundryshop | Library file refused:', path, error);
			entries.push({ path, root, name: path.split('/').pop(), error: error.message });
		}
	}
	for (const operation of readLibraryOperations().entries.filter(entry => entry.root === root)) {
		const entry = entries.find(entry => entry.path === operation.path);
		if (entry) Object.assign(entry, { repair: operation,
			error: `${loc('RepairRequired')}${entry.error ? ` ${entry.error}` : ''}` });
		else entries.push({ path: operation.path, root, name: operation.path.split('/').pop(),
			repair: operation, error: loc('RepairMissing') });
	}
	for (const removed of readLibraryCatalog().entries.filter(entry => entry.root === root)) {
		const entry = entries.find(entry => entry.path === removed.path);
		if (entry) Object.assign(entry, { removed, kind: entry.kind ?? removed.kind,
			name: entry.fingerprint ? entry.name : removed.name, catalogChanged: entry.fingerprint !== removed.fingerprint
			|| entry.kind !== removed.kind || (entry.id ?? null) !== removed.id });
		else entries.push({ ...removed, removed, error: loc('CatalogMissing') });
	}
	if (rootFolder() !== root) throw new Error(loc('Changed'));
	return entries;
}

export function searchProjectLibrary(entries, query) {
	const term = String(query).trim().toLocaleLowerCase();
	return entries.filter(entry => `${entry.name} ${entry.path} ${(entry.tags ?? []).join(' ')} ${entry.category ?? ''}`
		.toLocaleLowerCase().includes(term));
}

async function readLibraryEntry(entry, signal, { allowRemoved = false } = {}) {
	const root = rootFolder();
	const checkCatalog = () => {
		if (!allowRemoved && readLibraryCatalog().entries.some(item => item.root === root && item.path === entry.path)) throw new Error(loc('CatalogRemoved'));
	};
	checkCatalog();
	if (readLibraryOperations().entries.some(operation => operation.path === entry.path && operation.root === root)) throw new Error(loc('RepairRequired'));
	if (entry.root !== root || !/^[a-f0-9]{64}$/.test(entry.fingerprint)) throw new Error(loc('Changed'));
	const loaded = await readPackage(entry.path, root, { bytes: 0 }, signal);
	if (rootFolder() !== root || loaded.fingerprint !== entry.fingerprint) throw new Error(loc('Changed'));
	if (readLibraryOperations().entries.some(operation => operation.path === entry.path && operation.root === root)) throw new Error(loc('RepairRequired'));
	checkCatalog();
	return loaded;
}

export async function readLibraryProject(entry, signal) {
	const loaded = await readLibraryEntry(entry, signal);
	if (loaded.shape) throw new Error(loc('WrongKind'));
	return loaded.project;
}

export async function readLibraryShape(entry, signal) {
	const loaded = await readLibraryEntry(entry, signal);
	if (!loaded.shape) throw new Error(loc('WrongKind'));
	return loaded.shape;
}

function libraryMetadata({ path, root, fingerprint, project, shape }) {
	return { path, root, fingerprint, name: shape?.name ?? project.name, kind: shape ? 'shape' : 'project',
		...(shape ? { id: shape.id, tags: shape.tags, category: shape.category }
			: project.library ? { ...project.library } : {}),
		drawings: project.drawings.length, thumbnail: project.thumbnail ?? null };
}

export async function saveLibraryShape(input, options) {
	const shape = validateShapePackage(input);
	return saveLibraryPackage(shape, `shape-${shape.id}.json`, options);
}

export async function saveLibraryProject(input, { id, ...options } = {}) {
	if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error(loc('IdentityInvalid'));
	if (input.library && input.library.id !== id) throw new Error(loc('IdentityInvalid'));
	return saveLibraryPackage(validateProjectPackage(input), `project-${id}.json`, options);
}

let saving = false;
async function saveLibraryPackage(input, filename, { isCurrent = () => true, signal, verifySource } = {}) {
	if (saving) throw new Error(loc('SaveBusy'));
	const root = rootFolder();
	const path = packagePath(`${root}/${filename}`, root);
	if (readLibraryOperations().entries.some(entry => entry.root === root && entry.path === path)) throw new Error(loc('RepairRequired'));
	const text = serializeProjectPackage(input), bytes = new TextEncoder().encode(text);
	const check = () => {
		if (signal?.aborted) throw new Error(loc('Cancelled'));
		if (!game.user.can('FILES_UPLOAD')) throw new Error(loc('SaveDenied'));
		if (rootFolder() !== root || !isCurrent()) throw new Error(loc('Changed'));
	};
	check();
	saving = true;
	let attempted = false;
	try {
		const picker = foundry.applications.apps.FilePicker.implementation;
		const listing = await picker.browse('data', root);
		check();
		if (!Array.isArray(listing.files)) throw new Error(loc('ReadFailed'));
		if (listing.files.filter(file => /\.json$/i.test(file)).length >= LIBRARY_LIMITS.entries) throw new Error(loc('TooMany'));
		if (listing.files.some(file => decodeURIComponent(file).toLocaleLowerCase() === path.toLocaleLowerCase())) {
			throw new Error(loc('Collision'));
		}
		check();
		if (verifySource) await verifySource();
		check();
		attempted = true;
		const upload = await picker.upload('data', root, new File([bytes], path.slice(root.length + 1),
			{ type: 'application/json' }), {}, { notify: false });
		if (!upload?.path || packagePath(upload.path, root) !== path) throw new Error(loc('UnsafePath'));
		check();
		const saved = await readPackage(path, root, { bytes: 0 }, signal);
		const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
		const fingerprint = [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('');
		if (saved.fingerprint !== fingerprint) throw new Error(loc('Changed'));
		check();
		return libraryMetadata({ ...saved, root });
	} catch (error) {
		if (attempted) throw new Error(`${loc('SaveUnverified')} ${path}: ${error.message}`, { cause: error });
		throw error;
	} finally { saving = false; }
}

function validateLibraryOperations(input) {
	if (!input || input.version !== 1 || !Number.isSafeInteger(input.revision) || input.revision < 0
		|| !Array.isArray(input.entries) || input.entries.length > LIBRARY_LIMITS.entries
		|| Object.keys(input).some(key => !['version', 'revision', 'entries'].includes(key))) throw new Error(loc('OperationsInvalid'));
	const paths = new Set(), tokens = new Set();
	for (const entry of input.entries) {
		if (!entry || Object.keys(entry).some(key => !['token', 'root', 'path', 'before', 'after'].includes(key))
			|| typeof entry.token !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.token)
			|| !/^[a-f0-9]{64}$/.test(entry.before) || !/^[a-f0-9]{64}$/.test(entry.after)
			|| validateLibraryFolder(entry.root) !== entry.root || packagePath(entry.path, entry.root) !== entry.path
			|| paths.has(entry.path) || tokens.has(entry.token)) throw new Error(loc('OperationsInvalid'));
		paths.add(entry.path); tokens.add(entry.token);
	}
	return structuredClone(input);
}

export function readLibraryOperations() {
	return validateLibraryOperations(game.settings.get(MODULE, LIBRARY_OPERATIONS));
}

async function writeOperations(before, entries) {
	if (!game.user.isGM || !game.user.can('SETTINGS_MODIFY')) throw new Error(loc('ManageDenied'));
	if (JSON.stringify(readLibraryOperations()) !== JSON.stringify(before)) throw new Error(loc('Changed'));
	const next = validateLibraryOperations({ version: 1, revision: before.revision + 1, entries });
	await game.settings.set(MODULE, LIBRARY_OPERATIONS, next);
	if (JSON.stringify(readLibraryOperations()) !== JSON.stringify(next)) throw new Error(loc('OperationsWriteFailed'));
	Hooks.callAll(LIBRARY_CHANGED);
	return next;
}

export async function editLibraryMetadata(entry, metadata, { signal, isCurrent = () => true } = {}) {
	if (saving) throw new Error(loc('SaveBusy'));
	const normalized = normalizeLibraryMetadata(metadata);
	const root = rootFolder();
	const check = () => {
		if (signal?.aborted || !isCurrent() || rootFolder() !== root) throw new Error(loc('Changed'));
		if (!game.user.can('FILES_UPLOAD') || !game.user.can('SETTINGS_MODIFY')) throw new Error(loc('ManageDenied'));
	};
	check();
	saving = true;
	let operation;
	try {
		const loaded = await readLibraryEntry(entry, signal);
		check();
		const { project, shape } = loaded;
		const input = shape ? validateShapePackage({ ...shape, ...normalized, project: { ...project, name: normalized.name } })
			: validateProjectPackage({ ...project, name: normalized.name, library: {
				id: project.library?.id ?? foundry.utils.randomID(), category: normalized.category, tags: normalized.tags,
			} });
		if (JSON.stringify(input) === JSON.stringify(shape ?? project)) return libraryMetadata({ ...loaded, root });
		const bytes = new TextEncoder().encode(serializeProjectPackage(input));
		const after = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
		check();
		const before = readLibraryOperations();
		if (before.entries.length >= LIBRARY_LIMITS.entries) throw new Error(loc('TooMany'));
		operation = { token: foundry.utils.randomID(), root, path: entry.path, before: loaded.fingerprint, after };
		if (before.entries.some(item => item.token === operation.token)) throw new Error(loc('Collision'));
		await writeOperations(before, [...before.entries, operation]);
		check();
		const current = await readPackage(entry.path, root, { bytes: 0 }, signal);
		if (current.fingerprint !== operation.before) throw new Error(loc('Changed'));
		check();
		const journal = readLibraryOperations();
		if (!journal.entries.some(item => JSON.stringify(item) === JSON.stringify(operation))) throw new Error(loc('Changed'));
		const picker = foundry.applications.apps.FilePicker.implementation;
		const upload = await picker.upload('data', root, new File([bytes], entry.path.slice(root.length + 1),
			{ type: 'application/json' }), {}, { notify: false });
		if (!upload?.path || packagePath(upload.path, root) !== entry.path) throw new Error(loc('UnsafePath'));
		const saved = await readPackage(entry.path, root, { bytes: 0 }, signal);
		if (saved.fingerprint !== after) throw new Error(loc('Changed'));
		check();
		await writeOperations(journal, journal.entries.filter(item => item.token !== operation.token));
		return libraryMetadata({ ...saved, root });
	} catch (error) {
		if (operation) throw new Error(`${loc('EditUnverified')} ${entry.path}: ${error.message}`, { cause: error });
		throw error;
	} finally { saving = false; }
}

export async function duplicateLibraryEntry(entry, metadata, { signal, isCurrent = () => true } = {}) {
	const normalized = normalizeLibraryMetadata(metadata);
	const loaded = await readLibraryEntry(entry, signal);
	if (signal?.aborted || !isCurrent()) throw new Error(loc('Changed'));
	const id = foundry.utils.randomID();
	if (loaded.shape?.id === id || loaded.project.library?.id === id) throw new Error(loc('Collision'));
	const options = { signal, isCurrent, verifySource: () => readLibraryEntry(entry, signal) };
	if (loaded.shape) return saveLibraryShape({ ...loaded.shape, ...normalized, id,
		project: { ...loaded.project, name: normalized.name } }, options);
	return saveLibraryProject({ ...loaded.project, name: normalized.name,
		library: { id, category: normalized.category, tags: normalized.tags } }, { ...options, id });
}

export async function inspectLibraryRepair(operation, signal) {
	const root = rootFolder();
	if (operation.root !== root || !readLibraryOperations().entries.some(entry => JSON.stringify(entry) === JSON.stringify(operation))) throw new Error(loc('Changed'));
	const loaded = await readPackage(operation.path, root, { bytes: 0 }, signal);
	if (rootFolder() !== root) throw new Error(loc('Changed'));
	return libraryMetadata({ ...loaded, root });
}

export async function acceptLibraryRepair(operation, reviewed, { signal, isCurrent = () => true } = {}) {
	if (saving) throw new Error(loc('SaveBusy'));
	saving = true;
	try {
		const before = readLibraryOperations();
		const loaded = await inspectLibraryRepair(operation, signal);
		if (signal?.aborted || !isCurrent() || loaded.path !== reviewed.path || loaded.fingerprint !== reviewed.fingerprint) throw new Error(loc('Changed'));
		await writeOperations(before, before.entries.filter(entry => entry.token !== operation.token));
		return loaded;
	} finally { saving = false; }
}

function validateCatalog(input) {
	if (!input || input.version !== 1 || !Number.isSafeInteger(input.revision) || input.revision < 0
		|| !Array.isArray(input.entries) || input.entries.length > LIBRARY_LIMITS.entries
		|| Object.keys(input).some(key => !['version', 'revision', 'entries'].includes(key))) throw new Error(loc('CatalogInvalid'));
	const paths = new Set();
	for (const entry of input.entries) {
		if (!entry || Object.keys(entry).some(key => !['root', 'path', 'kind', 'id', 'name', 'fingerprint'].includes(key))
			|| !['shape', 'project'].includes(entry.kind)
			|| !(entry.id === null || typeof entry.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(entry.id))
			|| entry.kind === 'shape' && entry.id === null
			|| typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 80
			|| typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(entry.fingerprint)
			|| validateLibraryFolder(entry.root) !== entry.root || packagePath(entry.path, entry.root) !== entry.path
			|| paths.has(entry.path)) throw new Error(loc('CatalogInvalid'));
		paths.add(entry.path);
	}
	return structuredClone(input);
}

export function readLibraryCatalog() {
	return validateCatalog(game.settings.get(MODULE, LIBRARY_CATALOG));
}

export async function setLibraryCatalogRemoved(entry, removed, { signal, isCurrent = () => true } = {}) {
	if (saving) throw new Error(loc('SaveBusy'));
	if (typeof removed !== 'boolean' || !entry || entry.builtinId) throw new Error(loc('Changed'));
	const root = rootFolder();
	const check = () => {
		if (signal?.aborted || !isCurrent() || rootFolder() !== root || entry.root !== root) throw new Error(loc('Changed'));
		if (!game.user.can('SETTINGS_MODIFY')) throw new Error(loc('CatalogDenied'));
	};
	check();
	saving = true;
	let attempted = false;
	try {
		const before = readLibraryCatalog();
		if (removed && before.entries.length >= LIBRARY_LIMITS.entries) throw new Error(loc('CatalogFull'));
		const existing = before.entries.find(item => item.root === root && item.path === entry.path);
		if (removed ? !!existing : !existing || JSON.stringify(existing) !== JSON.stringify(entry.removed)) throw new Error(loc('Changed'));
		const loaded = await readLibraryEntry(entry, signal, { allowRemoved: !removed });
		check();
		const metadata = libraryMetadata({ ...loaded, root });
		const entries = removed ? [...before.entries, { root, path: metadata.path, kind: metadata.kind,
			id: metadata.id ?? null, name: metadata.name, fingerprint: metadata.fingerprint }]
			: before.entries.filter(item => item.path !== entry.path);
		const next = validateCatalog({ version: 1, revision: before.revision + 1, entries });
		if (JSON.stringify(readLibraryCatalog()) !== JSON.stringify(before)) throw new Error(loc('Changed'));
		check();
		attempted = true;
		await game.settings.set(MODULE, LIBRARY_CATALOG, next);
		if (JSON.stringify(readLibraryCatalog()) !== JSON.stringify(next)) throw new Error(loc('CatalogWriteFailed'));
		check();
		Hooks.callAll(LIBRARY_CHANGED);
		return metadata;
	} catch (error) {
		if (attempted) throw new Error(`${loc('CatalogUnverified')} ${entry.path}: ${error.message}`, { cause: error });
		throw error;
	} finally { saving = false; }
}
