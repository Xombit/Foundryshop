import { imageHeader } from './image_header.js';
import { validateStoredFile, fileFingerprint } from './verified_file_storage.js';

const signatures = {
	png: [137, 80, 78, 71, 13, 10, 26, 10],
};
const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const ascii = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));

function staticContainer(bytes, extension) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (extension === 'png') {
		if (!signatures.png.every((value, index) => bytes[index] === value)) throw new Error('Invalid PNG signature.');
		let offset = 8, ended = false, imageData = false, index = 0;
		while (offset + 12 <= bytes.length) {
			const size = view.getUint32(offset), type = ascii(bytes, offset + 4, 4);
			if (offset + size + 12 > bytes.length || !/^[A-Za-z]{4}$/.test(type)) throw new Error('Invalid PNG chunk boundary.');
			if (index === 0 ? type !== 'IHDR' || size !== 13 : type === 'IHDR') throw new Error('Invalid PNG header chunk.');
			if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw new Error('Animated PNG cannot be accepted as static baked output.');
			if (type === 'IDAT') imageData = true;
			offset += size + 12; index++;
			if (type === 'IEND') {
				if (size !== 0 || offset !== bytes.length) throw new Error('Invalid PNG end chunk.');
				ended = true; break;
			}
		}
		if (!ended || !imageData) throw new Error('PNG output is incomplete.');
	} else if (extension === 'webp') {
		if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error('WEBP container size does not match persisted bytes.');
		let offset = 12, images = 0;
		while (offset + 8 <= bytes.length) {
			const type = ascii(bytes, offset, 4), size = view.getUint32(offset + 4, true);
			if (offset + size + 8 + (size & 1) > bytes.length) throw new Error('Invalid WEBP chunk boundary.');
			if (['ANIM', 'ANMF'].includes(type) || type === 'VP8X' && bytes[offset + 8] & 2) {
				throw new Error('Animated WEBP cannot be accepted as static baked output.');
			}
			if (type === 'VP8X' && (offset !== 12 || size !== 10)) throw new Error('Invalid WEBP extended header.');
			if (['VP8 ', 'VP8L'].includes(type)) images++;
			offset += size + 8 + (size & 1);
		}
		if (offset !== bytes.length || images !== 1) throw new Error('WEBP output requires one complete static image.');
	} else if (bytes.length < 4 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) {
		throw new Error('JPEG output is incomplete or has unsupported trailing content.');
	}
}

function dimensions(expected) {
	if (!expected || !Number.isSafeInteger(expected.width) || !Number.isSafeInteger(expected.height)
		|| expected.width <= 0 || expected.height <= 0 || !Number.isSafeInteger(expected.width * expected.height)) {
		throw new Error('Persisted image acceptance requires exact positive safe-integer dimensions.');
	}
	return { width: expected.width, height: expected.height };
}

/** Static PNG/JPEG/WEBP capability only. Unsupported native media never falls back to its first frame. */
export function inspectOptimizationImage(bytes) {
	if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('Image acceptance requires persisted bytes.');
	// These are JavaScript representation limits, not publication/stamp pixel or GPU admission budgets.
	const header = imageHeader(bytes, { axis: Number.MAX_SAFE_INTEGER, pixels: Number.MAX_SAFE_INTEGER },
		key => new Error(key === 'Animated'
			? 'Animated images cannot be accepted as static baked output.'
			: 'Baked output must be a valid static PNG, JPEG or WEBP with readable dimensions; other media are unsupported by this adapter.'));
	staticContainer(bytes, header.extension);
	return { ...header, mime: mime[header.extension] };
}

/** Browser decode acceptance; it does not claim native GPU rendering or placement acceptance. */
export async function acceptOptimizationImage(bytes, reference, expected, { signal, isCurrent } = {}) {
	const file = validateStoredFile(reference), size = dimensions(expected);
	if (typeof isCurrent !== 'function') throw new Error('Image acceptance requires an explicit reviewed-context guard.');
	const check = () => {
		if (signal?.aborted || !game.user?.isGM || !isCurrent()) throw new Error('Image acceptance authority/context changed or was cancelled.');
	};
	check();
	if (!(bytes instanceof Uint8Array) || bytes.byteLength !== file.bytes
		|| await fileFingerprint(bytes) !== file.fingerprint) throw new Error('Image bytes do not match their persisted reference.');
	check();
	const header = inspectOptimizationImage(bytes);
	if (header.width !== size.width || header.height !== size.height) {
		throw new Error(`Persisted image dimensions ${header.width} x ${header.height} differ from reviewed ${size.width} x ${size.height}.`);
	}
	const extension = file.path.slice(file.path.lastIndexOf('.') + 1).toLowerCase();
	if (extension !== header.extension && !(extension === 'jpeg' && header.extension === 'jpg')) {
		throw new Error('Persisted image filename format differs from its bytes.');
	}
	if (typeof createImageBitmap !== 'function') throw new Error('This client does not support the required image decode API.');
	let bitmap;
	try {
		bitmap = await createImageBitmap(new Blob([bytes], { type: header.mime }), { imageOrientation: 'none' });
		check();
		if (bitmap.width !== size.width || bitmap.height !== size.height) {
			throw new Error('Browser-decoded image dimensions differ from the persisted header/review.');
		}
		return true;
	} finally { bitmap?.close(); }
}

/** Bind the reviewed file identity/dimensions once; another operation cannot reuse this acceptance callback. */
export function optimizationOutputVerifier(reference, expected, options) {
	const file = validateStoredFile(reference), size = dimensions(expected);
	return (bytes, supplied) => {
		const candidate = validateStoredFile(supplied);
		if (['version', 'root', 'path', 'bytes', 'fingerprint'].some(key => candidate[key] !== file[key])) {
			throw new Error('Output verifier was called with a different file reference.');
		}
		return acceptOptimizationImage(bytes, file, size, options);
	};
}
