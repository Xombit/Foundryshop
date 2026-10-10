import { canonicalJson } from './project_package.js';
import { validateOptimizationArchive, optimizationArchiveDescriptor } from './optimization_recovery.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const phases = {
	apply: ['assets-verified', 'replacement-staged', 'sources-removed'],
	restore: ['assets-verified', 'originals-staged', 'replacement-reverted'],
};

export function assertOptimizationNativeSource(scene, type, source) {
	const Document = getDocumentClass(type);
	if (typeof Document !== 'function') throw new Error(`Native ${type} document class is unavailable.`);
	const checked = new Document(structuredClone(source), { parent: scene, strict: true }).toObject();
	if (!same(checked, source)) {
		throw new Error(`Native ${type} ${source._id} schema normalization changes the reviewed recovery source.`);
	}
}

/** Detached strict native documents only; no create/update hooks or world writes occur. */
export function assertOptimizationNativeSchemas(scene, input) {
	const payload = validateOptimizationArchive(input);
	if (!game.user?.isGM || !scene || scene.id !== payload.sceneId || !scene.levels?.has(payload.levelId)) {
		throw new Error('Native recovery schema validation requires GM access and the source Scene/Level.');
	}
	assertOptimizationNativeSource(scene, 'Level', payload.context.level);
	for (const original of payload.originals) {
		assertOptimizationNativeSource(scene, 'Drawing', original);
		assertOptimizationNativeSource(scene, 'Drawing', { ...original, hidden: true });
	}
	const { replacement } = payload;
	if (replacement.type === 'LevelBackground') {
		assertOptimizationNativeSource(scene, 'Level', replacement.before);
		assertOptimizationNativeSource(scene, 'Level', replacement.after);
	} else {
		assertOptimizationNativeSource(scene, replacement.type, replacement.staged);
		assertOptimizationNativeSource(scene, replacement.type, replacement.after);
	}
	return true;
}

/** Binds schema checks to the reviewed immutable archive. Geometry/stacking/audience acceptance is explicit. */
export async function optimizationNativeVerifier(scene, archiveText, { isCurrent, verifyPlacement } = {}) {
	if (typeof isCurrent !== 'function' || typeof verifyPlacement !== 'function') {
		throw new Error('Native acceptance requires explicit reviewed-context and placement/audience verification.');
	}
	const descriptor = await optimizationArchiveDescriptor(archiveText);
	const check = () => {
		if (!game.user?.isGM || !isCurrent()) throw new Error('Native acceptance reviewed context/authority changed.');
	};
	check();
	return async (input, operation) => {
		check();
		const payload = validateOptimizationArchive(input);
		// Canonical hashing also binds context, original backup and lineage, not just replacement IDs.
		const candidate = await optimizationArchiveDescriptor(JSON.stringify({
			payload, checksum: descriptor.archiveChecksum,
		}));
		if (!same(candidate, descriptor)) throw new Error('Native acceptance was invoked with a different recovery archive.');
		check();
		if (!operation || typeof operation.action !== 'string' || !Object.hasOwn(phases, operation.action)
			|| !phases[operation.action].includes(operation.phase)) {
			throw new Error('Native acceptance requires a supported apply/restore step.');
		}
		assertOptimizationNativeSchemas(scene, payload);
		if (await verifyPlacement(structuredClone(payload), { ...operation }) !== true) {
			throw new Error('Reviewed native placement/stacking/audience acceptance failed.');
		}
		check();
		return true;
	};
}
