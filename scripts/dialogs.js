function optionsWithScrolling(options) {
	return { ...options, classes: [...new Set([...(options.classes ?? []), 'fshop-dialog'])] };
}

export const FoundryshopDialog = {
	prompt(options) { return foundry.applications.api.DialogV2.prompt(optionsWithScrolling(options)); },
	confirm(options) { return foundry.applications.api.DialogV2.confirm(optionsWithScrolling(options)); },
	wait(options) { return foundry.applications.api.DialogV2.wait(optionsWithScrolling(options)); },
};
