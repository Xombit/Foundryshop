import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { validatePackage } from '../tools/validate-package.mjs';

function fixture(t) {
	const directory = mkdtempSync(join(tmpdir(), 'foundryshop-package-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const source = join(directory, 'source'), output = join(directory, 'output');
	const manifest = JSON.parse(readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
	Object.assign(manifest, { version: '1.0.0', styles: ['styles/module.css'],
		languages: [{ path: 'languages/en.json' }] });
	for (const key of ['url', 'manifest', 'download', 'license', 'readme', 'changelog']) delete manifest[key];
	const files = {
		'module.json': JSON.stringify(manifest),
		'setup.js': "import './scripts/main.js';",
		'scripts/main.js': "const button = ['import', 'Import project'];",
		'templates/main.hbs': '<div></div>',
		'languages/en.json': '{}',
		'styles/module.css': '',
		'assets/materials/test.png': 'test image',
		'README.md': 'readme', LICENSE: 'license', 'CHANGELOG.md': 'changelog',
	};
	const write = (root, path, value) => {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), value);
	};
	for (const [path, value] of Object.entries(files)) write(source, path, value);
	cpSync(source, output, { recursive: true });
	return { source, output, manifest, write };
}

test('release validator accepts complete contents and ignores import-named UI actions', t => {
	const { source, output } = fixture(t);
	assert.equal(validatePackage(output, source).version, '1.0.0');
});

test('release validator rejects missing or stale runtime assets', t => {
	const { source, output, write } = fixture(t);
	rmSync(join(output, 'assets', 'materials', 'test.png'));
	assert.throws(() => validatePackage(output, source), /ENOENT/);
	write(output, 'assets/materials/test.png', 'stale image');
	assert.throws(() => validatePackage(output, source), /Missing or stale runtime file/);
});

test('release validator rejects unresolved manifests and missing hard dependencies', t => {
	const { source, output, manifest, write } = fixture(t);
	manifest.version = '#{VERSION}#';
	write(output, 'module.json', JSON.stringify(manifest));
	assert.throws(() => validatePackage(output, source), /Unresolved manifest placeholders/);
	manifest.version = '1.0.0';
	manifest.relationships.requires = [];
	write(output, 'module.json', JSON.stringify(manifest));
	assert.throws(() => validatePackage(output, source), /hard dependency/);
});

test('release validator rejects missing transitive imports and escaping file references', t => {
	const { source, output, write } = fixture(t);
	for (const root of [source, output]) write(root, 'scripts/main.js', "export { value } from './missing.js';");
	assert.throws(() => validatePackage(output, source), /ENOENT/);
	for (const root of [source, output]) write(root, 'scripts/main.js', "import '../../outside.js';");
	assert.throws(() => validatePackage(output, source), /escapes module directory/);
});

test('release dependency remains required without an arbitrary version floor', () => {
	const manifest = JSON.parse(readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
	const dependency = manifest.relationships.requires.find(entry => entry.id === 'precise-drawing-tools');
	assert.equal(dependency.type, 'module');
	assert.equal(dependency.compatibility?.minimum, undefined);
});
