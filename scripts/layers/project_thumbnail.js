import { imageHeader } from '../image_header.js';

export const THUMBNAIL_LIMITS = { bytes: 256 * 1024, axis: 512, pixels: 512 * 512 };
const fail = () => { throw new Error('Foundryshop JSON: Invalid embedded WEBP thumbnail.'); };

export function validateProjectThumbnail(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).some(key => !['mime', 'scope', 'width', 'height', 'data'].includes(key))
		|| value.mime !== 'image/webp' || value.scope !== 'full-artwork'
		|| !Number.isInteger(value.width) || !Number.isInteger(value.height)
		|| value.width < 1 || value.height < 1 || value.width > THUMBNAIL_LIMITS.axis
		|| value.height > THUMBNAIL_LIMITS.axis || value.width * value.height > THUMBNAIL_LIMITS.pixels
		|| typeof value.data !== 'string' || !value.data.length
		|| value.data.length > 4 * Math.ceil(THUMBNAIL_LIMITS.bytes / 3)
		|| value.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) fail();
	const binary = atob(value.data);
	if (binary.length > THUMBNAIL_LIMITS.bytes || btoa(binary) !== value.data) fail();
	const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
	const text = (offset, count) => String.fromCharCode(...bytes.slice(offset, offset + count));
	const view = new DataView(bytes.buffer);
	if (bytes.length < 30 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WEBP'
		|| view.getUint32(4, true) + 8 !== bytes.length) fail();
	const header = imageHeader(bytes);
	if (header.extension !== 'webp' || header.width !== value.width || header.height !== value.height) fail();
	let offset = 12, images = 0;
	while (offset < bytes.length) {
		if (offset + 8 > bytes.length) fail();
		const kind = text(offset, 4), size = view.getUint32(offset + 4, true);
		const end = offset + 8 + size;
		if (!size || end + (size % 2) > bytes.length || ['ANIM', 'ANMF'].includes(kind)) fail();
		if (kind === 'VP8X' && (offset !== 12 || size !== 10)) fail();
		if (['VP8 ', 'VP8L'].includes(kind)) {
			images++;
			// Inspect the image bitstream too, not just a potentially forged VP8X canvas.
			const image = new Uint8Array(12 + 8 + Math.max(size, 10));
			image.set(bytes.slice(0, 12));
			image.set(bytes.slice(offset, end), 12);
			const dimensions = imageHeader(image);
			if (dimensions.width !== value.width || dimensions.height !== value.height) fail();
		}
		if (size % 2 && bytes[end] !== 0) fail();
		offset = end + (size % 2);
	}
	if (images !== 1) fail();
	return { mime: value.mime, scope: value.scope, width: value.width, height: value.height, data: value.data };
}

export function thumbnailFromPreview(preview) {
	const prefix = 'data:image/webp;base64,';
	if (!preview.src?.startsWith(prefix)) fail();
	return validateProjectThumbnail({
		mime: 'image/webp', scope: 'full-artwork', width: preview.width, height: preview.height,
		data: preview.src.slice(prefix.length),
	});
}
