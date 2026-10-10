import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { MATERIAL_SIZE, STARTER_MATERIALS } from '../scripts/starter_materials.js';

const wrap = (n, period) => ((n % period) + period) % period;
const smooth = n => n * n * (3 - 2 * n);
const mix = (a, b, t) => a + (b - a) * t;
const hash = (x, y, seed = 0) => {
	let n = Math.imul(x + seed * 137, 374761393) + Math.imul(y + seed * 79, 668265263);
	n = Math.imul(n ^ (n >>> 13), 1274126177);
	return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
function noise(x, y, cells, seed) {
	const gx = wrap(x, MATERIAL_SIZE) * cells / MATERIAL_SIZE;
	const gy = wrap(y, MATERIAL_SIZE) * cells / MATERIAL_SIZE;
	const ix = Math.floor(gx), iy = Math.floor(gy);
	const h = (dx, dy) => hash(wrap(ix + dx, cells), wrap(iy + dy, cells), seed);
	return mix(mix(h(0, 0), h(1, 0), smooth(gx - ix)), mix(h(0, 1), h(1, 1), smooth(gx - ix)), smooth(gy - iy));
}
function cellsAt(x, y, cells, seed) {
	const gx = x * cells / MATERIAL_SIZE, gy = y * cells / MATERIAL_SIZE;
	let first = Infinity, second = Infinity, shade = 0;
	for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
		const cx = Math.floor(gx) + dx, cy = Math.floor(gy) + dy;
		const hx = wrap(cx, cells), hy = wrap(cy, cells);
		const px = cx + 0.2 + hash(hx, hy, seed) * 0.6;
		const py = cy + 0.2 + hash(hx, hy, seed + 1) * 0.6;
		const d = Math.hypot(gx - px, gy - py);
		if (d < first) { second = first; first = d; shade = hash(hx, hy, seed + 2); }
		else if (d < second) second = d;
	}
	return { distance: first, edge: second - first, shade };
}
const wave = n => Math.cos(n * Math.PI * 2);
const edge = (position, period) => Math.min(wrap(position, period), period - wrap(position, period));

export function materialPixel(id, x, y) {
	x = wrap(x, MATERIAL_SIZE); y = wrap(y, MATERIAL_SIZE);
	const n = (cells, seed = 1) => noise(x, y, cells, seed) - 0.5;
	const grain = n(64, 7) * 6;
	let value;
	switch (id) {
		case 'rough-stone': value = 186 + n(4) * 30 + n(16) * 18 + grain; break;
		case 'flagstone': {
			const row = Math.floor(y / 64), px = x + (row % 2) * 32;
			const mortar = Math.min(edge(px, 64), edge(y, 64));
			value = mortar < 3.5 ? 110 + grain : 194 + hash(Math.floor(wrap(px, 256) / 64), row, 5) * 20 + n(16) * 12;
			break;
		}
		case 'brick': {
			const row = Math.floor(y / 32), px = x + (row % 2) * 32;
			value = Math.min(edge(px, 64), edge(y, 32)) < 3 ? 116 + grain
				: 180 + hash(Math.floor(wrap(px, 256) / 64), row, 2) * 22 + n(32) * 14;
			break;
		}
		case 'cobblestone': {
			const cell = cellsAt(x, y, 6, 12);
			value = cell.edge < 0.045 ? 108 + grain : 180 + cell.shade * 30 + Math.min(cell.edge * 50, 18) + grain;
			break;
		}
		case 'timber-planks':
			value = edge(x, 64) < 3 ? 115 + grain : 190 + wave(x / 16 + n(4, 9) * 0.7) * 10 + n(16, 4) * 8 + grain;
			break;
		case 'wood-grain': value = 201 + wave(x / 12.8 + n(4, 9) * 1.8) * 12 + n(16, 4) * 8 + grain; break;
		case 'packed-earth': value = 186 + n(8, 3) * 24 + n(32, 5) * 16 + grain; break;
		case 'sand': value = 218 + wave(y / 64 + n(4, 8)) * 7 + n(32, 8) * 9 + grain * 0.7; break;
		case 'gravel': {
			const cell = cellsAt(x, y, 28, 31);
			value = cell.edge < 0.04 ? 142 : 177 + cell.shade * 43 + grain;
			break;
		}
		case 'grass': {
			const cx = Math.floor(x / 16), cy = Math.floor(y / 16);
			const px = wrap(x, 16) - 8, py = wrap(y, 16) - 8;
			const lean = (hash(cx, cy, 22) - 0.5) * 0.9;
			const blade = Math.abs(px - py * lean) < 1.3 && Math.abs(py) < 5.5;
			value = 197 + n(8, 13) * 18 + (blade ? -30 : 0) + grain;
			break;
		}
		case 'forest-floor': {
			const cell = cellsAt(x, y, 16, 43);
			value = 171 + n(8, 2) * 22 + (cell.distance < 0.3 ? cell.shade * 35 : 0) + grain;
			break;
		}
		case 'water-ripples': value = 216 + wave(y / 32 + wave(x / 128) * 0.3) * 13 + n(8, 15) * 8; break;
		case 'snow': value = 239 + n(4, 27) * 12 + n(32, 29) * 5 + grain * 0.3; break;
		case 'ice': {
			const cell = cellsAt(x, y, 3, 52);
			value = cell.edge < 0.025 ? 165 : 220 + cell.shade * 12 + n(16, 32) * 9;
			break;
		}
		case 'parchment': value = 227 + n(4, 14) * 16 + n(32, 18) * 7 + grain * 0.5; break;
		default: throw new Error(`Unknown material: ${id}`);
	}
	return Math.max(0, Math.min(255, Math.round(value)));
}

function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
	const name = Buffer.from(type);
	const out = Buffer.alloc(data.length + 12);
	out.writeUInt32BE(data.length); name.copy(out, 4); data.copy(out, 8);
	out.writeUInt32BE(crc32(Buffer.concat([name, data])), out.length - 4);
	return out;
}
export function materialPng(id) {
	const raw = Buffer.alloc((MATERIAL_SIZE + 1) * MATERIAL_SIZE);
	for (let y = 0; y < MATERIAL_SIZE; y++) for (let x = 0; x < MATERIAL_SIZE; x++) {
		raw[y * (MATERIAL_SIZE + 1) + x + 1] = materialPixel(id, x, y);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(MATERIAL_SIZE); header.writeUInt32BE(MATERIAL_SIZE, 4); header[8] = 8;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	const folder = fileURLToPath(new URL('../assets/materials/', import.meta.url));
	await mkdir(folder, { recursive: true });
	let bytes = 0;
	for (const entry of STARTER_MATERIALS) {
		const png = materialPng(entry.id);
		await writeFile(resolve(folder, `${entry.id}.png`), png); bytes += png.length;
	}
	console.log(`Generated ${STARTER_MATERIALS.length} original ${MATERIAL_SIZE}px seamless grayscale materials (${bytes} bytes).`);
}
