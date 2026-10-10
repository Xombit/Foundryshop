import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function filesIn(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? filesIn(path) : [path];
	});
}

export function validatePackage(directory, source = sourceRoot) {
	const root = resolve(directory);
	const requireFile = path => {
		const target = resolve(root, path);
		const local = relative(root, target);
		assert.ok(!isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`),
			`File escapes module directory: ${path}`);
		assert.ok(statSync(target).isFile(), `Not a file: ${path}`);
		return target;
	};
	const text = readFileSync(requireFile('module.json'), 'utf8');
	assert.doesNotMatch(text, /#\{[^}]+\}#/, 'Unresolved manifest placeholders');
	const manifest = JSON.parse(text);
	assert.equal(manifest.id, 'foundryshop');
	assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
	const dependency = manifest.relationships.requires.find(entry => entry.id === 'precise-drawing-tools');
	assert.ok(dependency, 'Precise Drawing Tools must be a hard dependency');
	assert.equal(dependency.type, 'module');
	assert.equal(dependency.manifest, 'https://github.com/shemetz/precise-drawing-tools/releases/latest/download/module.json');
	for (const path of [...manifest.esmodules, ...manifest.scripts, ...manifest.styles,
		...manifest.languages.map(language => language.path)]) requireFile(path);
	for (const language of manifest.languages) JSON.parse(readFileSync(requireFile(language.path), 'utf8'));

	const shipped = ['setup.js', 'README.md', 'LICENSE', 'CHANGELOG.md'];
	for (const folder of ['scripts', 'templates', 'languages', 'assets']) {
		shipped.push(...filesIn(resolve(source, folder)).map(path => relative(source, path)));
	}
	shipped.push(...filesIn(resolve(source, 'styles')).filter(path => path.endsWith('.css'))
		.map(path => relative(source, path)));
	for (const path of shipped) {
		assert.deepEqual(readFileSync(requireFile(path)), readFileSync(resolve(source, path)),
			`Missing or stale runtime file: ${path}`);
	}
	for (const path of shipped.filter(path => path.endsWith('.js'))) {
		const code = readFileSync(requireFile(path), 'utf8');
		// Covers literal static imports, re-exports and dynamic imports.
		const imports = [
			...code.matchAll(/^\s*(?:import|export)\s+(?:[^;'"]*\s+from\s*)?['"]([^'"]+)['"]/gm),
			...code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
		];
		for (const match of imports) {
			assert.ok(match[1].startsWith('.'), `Unbundled import in ${path}: ${match[1]}`);
			requireFile(relative(root, resolve(dirname(resolve(root, path)), match[1])));
		}
		for (const match of code.matchAll(/modules\/foundryshop\/([^'"`\s]+)/g)) {
			if (!match[1].includes('${')) requireFile(match[1]);
		}
	}
	return { version: manifest.version, files: shipped.length + 1 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	assert.ok(process.argv[2], 'Usage: node tools\\validate-package.mjs <module-directory>');
	const result = validatePackage(process.argv[2]);
	console.log(`Validated Foundryshop ${result.version}: ${result.files} files, imports and hard dependency.`);
}
