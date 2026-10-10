/** Foundry changes these bookkeeping values on our own writes; all substantive state remains compared. */
export function recoveryImportSceneState(source) {
	const state = structuredClone(source);
	if (state._stats) {
		delete state._stats.modifiedTime;
		delete state._stats.lastModifiedBy;
	}
	return state;
}
