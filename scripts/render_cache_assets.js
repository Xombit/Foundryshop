/** Include texture-view revisions as well as shared-base uploads; dimensions alone miss frame changes. */
export function drawingCacheTextureRevision(texture) {
	const rectangle = value => {
		if (value == null) return null;
		const result = { x: value.x, y: value.y, width: value.width, height: value.height };
		if (!Object.values(result).every(Number.isFinite)) throw new Error('Cache texture rectangle is invalid.');
		return result;
	};
	if (!texture?.valid || !texture.baseTexture) throw new Error('Cache texture is not ready.');
	return {
		uid: texture.baseTexture.uid, update: texture.baseTexture._updateID,
		textureUpdate: texture._updateID, width: texture.width, height: texture.height,
		frame: rectangle(texture.frame), orig: rectangle(texture.orig), trim: rectangle(texture.trim),
		rotate: texture.rotate,
	};
}
