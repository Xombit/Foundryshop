/** Capture the documented Scene grid data shape across Foundry clients exposing an object or DataModel. */
export function optimizationSceneGrid(scene) {
	const grid = scene?.grid;
	const value = typeof grid?.toObject === 'function' ? grid.toObject() : grid;
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Optimization requires readable Scene grid data.');
	}
	const snapshot = { ...value };
	if (snapshot.color !== null && typeof snapshot.color === 'object') {
		const color = String(snapshot.color);
		if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('Optimization requires a serializable Scene grid color.');
		snapshot.color = color;
	}
	return structuredClone(snapshot);
}
