import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const destination = new URL('../scripts/vendor/', import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(new URL('../node_modules/fflate/esm/browser.js', import.meta.url),
	new URL('fflate.js', destination));
await copyFile(new URL('../node_modules/fflate/LICENSE', import.meta.url),
	new URL('fflate.LICENSE.txt', destination));

const hashes = new URL('noble-hashes/', destination);
await mkdir(hashes, { recursive: true });
for (const file of ['sha2.js', '_md.js', '_u64.js', 'utils.js', 'crypto.js']) {
	const source = new URL(`../node_modules/@noble/hashes/esm/${file}`, import.meta.url);
	if (file === 'utils.js') {
		const code = await readFile(source, 'utf8');
		if (!code.includes("from '@noble/hashes/crypto'")) throw new Error('Unexpected noble hashes crypto import.');
		await writeFile(new URL(file, hashes), code.replace("from '@noble/hashes/crypto'", "from './crypto.js'"));
	} else await copyFile(source, new URL(file, hashes));
}
await copyFile(new URL('../node_modules/@noble/hashes/LICENSE', import.meta.url), new URL('LICENSE', hashes));
