import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	inspectProjectResources, assertProjectResources, classifyTexturePath, validateResourceMappings,
	availableProjectFonts, RESOURCE_CHECK_LIMIT, RESOURCE_CHECK_CONCURRENCY, RESOURCE_CHECK_TIMEOUT,
} from '../scripts/layers/project_resources.js';

let requests;
const project = (assets = [], fonts = []) => ({ dependencies: { assets, fonts, modules: [] } });
const response = (type = 'image/webp', status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => type } });
beforeEach(() => {
	requests = [];
	globalThis.location = { href: 'http://localhost:30000/game' };
	globalThis.game = { i18n: { localize: key => key, format: (key, { count }) => `${key}: ${count}` } };
	globalThis.foundry = {
		applications: { settings: { menus: { FontConfig: { getAvailableFonts: () => ['Signika', 'Arial'] } } } },
		utils: { fetchWithTimeout: async (...args) => { requests.push(args); return response(); } },
	};
});

test('same-origin image requests are bounded HEAD checks with no redirects and explicit timeout', async () => {
	const report = await inspectProjectResources(project(['art/map.webp', '/art/other.webp'], ['Signika']));
	assert.equal(report.ready, true);
	assert.equal(report.textures[0].status, 'available');
	assert.equal(report.fonts[0].status, 'available');
	assert.equal(requests.length, 2);
	for (const [url, options, timing] of requests) {
		assert.ok(url.startsWith('http://localhost:30000/'));
		assert.deepEqual(options, { method: 'HEAD', redirect: 'manual', credentials: 'same-origin', cache: 'no-store' });
		assert.equal(timing.timeoutMs, RESOURCE_CHECK_TIMEOUT);
	}
	assertProjectResources(report);
});

test('external resources are never requested and require explicit acknowledgement', async () => {
	const pkg = project(['https://example.invalid/private-map.webp', '//other.invalid/map.webp']);
	const blocked = await inspectProjectResources(pkg);
	assert.equal(blocked.ready, false);
	assert.ok(blocked.textures.every(entry => entry.status === 'external'));
	assert.equal(requests.length, 0);
	assert.throws(() => assertProjectResources(blocked), /ResourcesBlocked.*external/);
	const accepted = await inspectProjectResources(pkg, { acknowledgeExternal: true });
	assert.equal(accepted.ready, true);
	assert.equal(requests.length, 0);
});

test('unsafe schemes, URL credentials, controls and backslashes stay invalid even when external URLs are accepted', async () => {
	const paths = ['javascript:alert(1)', 'data:image/png;base64,AAA', 'file:///C:/map.webp',
		'http://user:password@localhost:30000/map.webp', 'art\\map.webp', 'art/\nmap.webp', ' map.webp'];
	const report = await inspectProjectResources(project(paths), { acknowledgeExternal: true });
	assert.equal(report.ready, false);
	assert.ok(report.textures.every(entry => entry.status === 'invalid'));
	assert.equal(requests.length, 0);
	assert.equal(classifyTexturePath('art/my map.webp', location.href).kind, 'local');
});

test('missing fonts block and explicit replacement targets must be available', async () => {
	const pkg = project([], ['MissingFont']);
	assert.equal((await inspectProjectResources(pkg)).ready, false);
	const replaced = await inspectProjectResources(pkg, { fonts: { MissingFont: 'Arial' } });
	assert.equal(replaced.ready, true);
	assert.deepEqual(replaced.fonts, [{ source: 'MissingFont', target: 'Arial', status: 'available' }]);
	assert.equal((await inspectProjectResources(pkg, { fonts: { MissingFont: 'AnotherMissing' } })).ready, false);
	assert.equal(requests.length, 0);
});

test('texture replacements are checked instead of missing originals and deduplicated by resolved destination', async () => {
	const report = await inspectProjectResources(project(['missing-a.webp', 'missing-b.webp']), {
		assets: { 'missing-a.webp': 'art/shared.webp', 'missing-b.webp': '/art/shared.webp' },
	});
	assert.equal(report.ready, true);
	assert.equal(requests.length, 1);
	assert.equal(report.textures.length, 2);
	assert.ok(requests.every(([url]) => !url.includes('missing')));
});

test('network errors and timeouts are reported with actionable failure detail, not swallowed as success', async () => {
	foundry.utils.fetchWithTimeout = async () => { throw new Error('Timed Out after 5 seconds'); };
	const report = await inspectProjectResources(project(['art/map.webp']));
	assert.equal(report.ready, false);
	assert.match(report.textures[0].detail, /Timed Out/);
	assert.throws(() => assertProjectResources(report), /Timed Out/);
});

test('redirects, HTML fallbacks and missing MIME are unverified and cannot be bypassed with external acknowledgement', async () => {
	for (const result of [response('text/html'), response(''), { type: 'opaqueredirect', status: 0 }, response('image/png', 302)]) {
		foundry.utils.fetchWithTimeout = async () => result;
		const report = await inspectProjectResources(project(['map.webp']), { acknowledgeExternal: true });
		assert.equal(report.ready, false);
		assert.equal(report.textures[0].status, 'unverified');
	}
	foundry.utils.fetchWithTimeout = async () => response('text/html', 404);
	assert.equal((await inspectProjectResources(project(['missing.webp']))).textures[0].status, 'missing');
});

test('resource requests never exceed the concurrency limit', async () => {
	let active = 0, max = 0;
	foundry.utils.fetchWithTimeout = async () => {
		active++; max = Math.max(max, active);
		await new Promise(resolve => setTimeout(resolve, 2));
		active--;
		return response();
	};
	assert.equal((await inspectProjectResources(project(Array.from({ length: 16 }, (_, index) => `${index}.webp`)))).ready, true);
	assert.equal(max, RESOURCE_CHECK_CONCURRENCY);
});

test('exact resource count limit passes and over-limit checks perform no requests', async () => {
	const paths = Array.from({ length: RESOURCE_CHECK_LIMIT }, (_, index) => `${index}.webp`);
	assert.equal((await inspectProjectResources(project(paths))).ready, true);
	assert.equal(requests.length, RESOURCE_CHECK_LIMIT);
	requests = [];
	await assert.rejects(inspectProjectResources(project([...paths, 'extra.webp'])), /ResourceLimit/);
	assert.equal(requests.length, 0);
});

test('mapping validation rejects unknown keys, nonplain objects, unsafe metadata and invalid acknowledgement', () => {
	for (const options of [
		{ assets: [] }, { fonts: null }, { assets: { unknown: 'a.webp' } },
		{ fonts: { Signika: '' } }, { fonts: { Signika: ' Arial ' } },
		{ assets: new Date() }, { acknowledgeExternal: 'true' },
		{ assets: JSON.parse('{"__proto__":"a.webp"}') },
	]) assert.throws(() => validateResourceMappings(project(['a.webp'], ['Signika']), options));
});

test('missing native APIs fail explicitly instead of fabricating available resources', async () => {
	delete foundry.applications.settings.menus.FontConfig;
	assert.throws(() => availableProjectFonts(), /FontApiUnavailable/);
	foundry.applications.settings.menus.FontConfig = { getAvailableFonts: () => ['Signika'] };
	delete foundry.utils.fetchWithTimeout;
	await assert.rejects(inspectProjectResources(project()), /ResourceApiUnavailable/);
});
