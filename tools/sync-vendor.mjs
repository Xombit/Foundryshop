import { copyFile, mkdir } from 'node:fs/promises';

const destination = new URL('../scripts/vendor/', import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(new URL('../node_modules/fflate/esm/browser.js', import.meta.url),
	new URL('fflate.js', destination));
await copyFile(new URL('../node_modules/fflate/LICENSE', import.meta.url),
	new URL('fflate.LICENSE.txt', destination));
