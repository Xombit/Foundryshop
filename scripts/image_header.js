export const IMAGE_LIMITS = { axis: 4096, pixels: 16000000 };

export function imageHeader(bytes, limits = IMAGE_LIMITS,
	error = key => new Error(game.i18n.localize(`FOUNDRYSHOP.Stamps.${key}`))) {
	const fail = key => { throw error(key); };
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const text = (start, count) => String.fromCharCode(...bytes.slice(start, start + count));
	let width, height, extension;
	if (bytes.length >= 33 && text(1, 3) === 'PNG' && bytes[0] === 137 && text(12, 4) === 'IHDR') {
		width = view.getUint32(16); height = view.getUint32(20); extension = 'png';
		for (let offset = 8; offset + 12 <= bytes.length;) {
			const size = view.getUint32(offset);
			if (text(offset + 4, 4) === 'acTL') fail('Animated');
			if (offset + size + 12 > bytes.length) fail('Image');
			offset += size + 12;
		}
	} else if (bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
		extension = 'webp';
		if (text(12, 4) === 'VP8X') {
			if (bytes[20] & 2) fail('Animated');
			width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
			height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
		} else if (text(12, 4) === 'VP8L' && bytes[20] === 47) {
			width = 1 + bytes[21] + ((bytes[22] & 63) << 8);
			height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10);
		} else if (text(12, 4) === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
			width = view.getUint16(26, true) & 16383; height = view.getUint16(28, true) & 16383;
		}
	} else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
		extension = 'jpg';
		let offset = 2;
		while (offset + 4 <= bytes.length) {
			if (bytes[offset++] !== 255) fail('Image');
			while (bytes[offset] === 255) offset++;
			const marker = bytes[offset++];
			if (marker === 217 || marker === 218) break;
			if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
			if (offset + 2 > bytes.length) fail('Image');
			const size = view.getUint16(offset);
			if (size < 2 || offset + size > bytes.length) fail('Image');
			if ([192, 193, 194].includes(marker) && size >= 8) {
				height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
			}
			offset += size;
		}
	}
	if (!width || !height || width > limits.axis || height > limits.axis
		|| width * height > limits.pixels) fail('Image');
	return { width, height, extension };
}
