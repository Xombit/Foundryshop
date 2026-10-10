export function normalizeLibraryMetadata(input, { identity = false } = {}) {
	if (!input || typeof input !== 'object' || Array.isArray(input)
		|| Object.keys(input).some(key => !['id', 'name', 'category', 'tags'].includes(key))
		|| typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80
		|| typeof input.category !== 'string' || !input.category.trim() || input.category.length > 40
		|| !Array.isArray(input.tags) || input.tags.length > 12
		|| input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 40)
		|| (identity && (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.id)))
		|| (!identity && Object.hasOwn(input, 'id'))) throw new Error('Invalid library name, category, tags or identity.');
	return { ...(identity ? { id: input.id } : {}), name: input.name.trim(), category: input.category.trim(),
		tags: [...new Set(input.tags.map(tag => tag.trim()))] };
}
