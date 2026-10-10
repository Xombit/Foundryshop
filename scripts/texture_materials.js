import { classifyTexturePath } from './layers/project_resources.js';
import { loadArtworkTexture } from './artwork_renderer.js';

export async function verifyLocalMaterial(path, { signal } = {}, load = loadArtworkTexture) {
	if (typeof path !== 'string' || path.length > 2048
		|| classifyTexturePath(path, globalThis.location?.href).kind !== 'local') {
		throw new Error(game.i18n.localize('FOUNDRYSHOP.Materials.LocalOnly'));
	}
	let asset;
	try {
		asset = await load(path, signal);
		if (signal?.aborted) throw new DOMException('Material selection cancelled.', 'AbortError');
		return { path, width: asset.bitmap.width, height: asset.bitmap.height };
	} finally {
		asset?.texture.destroy(true);
		asset?.bitmap.close();
	}
}
