export const RESOURCE_CHECK_LIMIT = 128;
export const RESOURCE_CHECK_CONCURRENCY = 4;
export const RESOURCE_CHECK_TIMEOUT = 5000;

const plainObject = value => value !== null && typeof value === 'object'
	&& !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function validateResourceMappings(project, { assets = {}, fonts = {}, acknowledgeExternal = false } = {}) {
	for (const [kind, mappings] of [['assets', assets], ['fonts', fonts]]) {
		if (!plainObject(mappings) || Object.entries(mappings).some(([source, target]) =>
			!project.dependencies[kind].includes(source) || typeof target !== 'string' || !target.trim()
			|| target !== target.trim() || ['__proto__', 'constructor', 'prototype'].includes(source))) {
			throw new Error(game.i18n.localize(`FOUNDRYSHOP.Project.Invalid${kind === 'assets' ? 'Asset' : 'Font'}Mappings`));
		}
	}
	if (typeof acknowledgeExternal !== 'boolean') throw new Error(game.i18n.localize('FOUNDRYSHOP.Project.InvalidExternalAcknowledgement'));
	return { assets, fonts, acknowledgeExternal };
}

export function classifyTexturePath(path, baseUrl) {
	if (typeof path !== 'string' || !path.trim() || path !== path.trim() || /[\u0000-\u001f\\]/.test(path)) return { kind: 'invalid' };
	let url;
	try {
		url = new URL(path, baseUrl);
	} catch (error) {
		if (!(error instanceof TypeError)) throw error;
		return { kind: 'invalid' };
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return { kind: 'invalid' };
	if (url.origin !== new URL(baseUrl).origin) return { kind: 'external', url: url.href };
	return { kind: 'local', url: url.href };
}

export function availableProjectFonts() {
	const FontConfig = foundry.applications?.settings?.menus?.FontConfig;
	if (typeof FontConfig?.getAvailableFonts !== 'function') throw new Error(game.i18n.localize('FOUNDRYSHOP.Project.FontApiUnavailable'));
	const fonts = FontConfig.getAvailableFonts();
	if (!Array.isArray(fonts) || fonts.some(font => typeof font !== 'string')) throw new Error(game.i18n.localize('FOUNDRYSHOP.Project.FontApiUnavailable'));
	return [...fonts].sort();
}

export async function inspectProjectResources(project, options = {}) {
	const { assets, fonts, acknowledgeExternal } = validateResourceMappings(project, options);
	const available = availableProjectFonts();
	const knownFonts = new Set(available);
	const fontResults = project.dependencies.fonts.map(source => {
		const target = Object.hasOwn(fonts, source) ? fonts[source] : source;
		return { source, target, status: knownFonts.has(target) ? 'available' : 'missing' };
	});
	const baseUrl = globalThis.location?.href;
	if (!baseUrl) throw new Error(game.i18n.localize('FOUNDRYSHOP.Project.ResourceApiUnavailable'));
	if (typeof foundry.utils.fetchWithTimeout !== 'function') throw new Error(game.i18n.localize('FOUNDRYSHOP.Project.ResourceApiUnavailable'));
	const checks = new Map();
	const textures = project.dependencies.assets.map(source => {
		const target = Object.hasOwn(assets, source) ? assets[source] : source;
		const classified = classifyTexturePath(target, baseUrl);
		const result = { source, target, status: classified.kind, detail: '' };
		if (classified.kind === 'local') {
			if (!checks.has(classified.url)) checks.set(classified.url, []);
			checks.get(classified.url).push(result);
		}
		return result;
	});
	if (checks.size > RESOURCE_CHECK_LIMIT) throw new Error(game.i18n.format('FOUNDRYSHOP.Project.ResourceLimit', { count: RESOURCE_CHECK_LIMIT }));
	const pending = [...checks.entries()];
	let next = 0;
	const worker = async () => {
		while (next < pending.length) {
			const [url, results] = pending[next++];
			let status, detail = '';
			try {
				const response = await foundry.utils.fetchWithTimeout(url, {
					method: 'HEAD', redirect: 'manual', credentials: 'same-origin', cache: 'no-store',
				}, { timeoutMs: RESOURCE_CHECK_TIMEOUT });
				if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
					status = 'unverified'; detail = game.i18n.localize('FOUNDRYSHOP.Project.ResourceRedirect');
				} else if (!response.ok) {
					status = 'missing'; detail = `HTTP ${response.status}`;
				} else {
					const type = response.headers.get('content-type') ?? '';
					status = type.toLowerCase().startsWith('image/') ? 'available' : 'unverified';
					if (status === 'unverified') detail = game.i18n.localize('FOUNDRYSHOP.Project.ResourceNotImage');
				}
			} catch (error) {
				status = 'missing';
				detail = error instanceof Error ? error.message : String(error);
			}
			for (const result of results) Object.assign(result, { status, detail });
		}
	};
	await Promise.all(Array.from({ length: Math.min(RESOURCE_CHECK_CONCURRENCY, pending.length) }, worker));
	return {
		textures, fonts: fontResults, availableFonts: available,
		ready: fontResults.every(font => font.status === 'available')
			&& textures.every(texture => texture.status === 'available' || (texture.status === 'external' && acknowledgeExternal)),
	};
}

export function assertProjectResources(report) {
	if (report.ready) return;
	const missing = [
		...report.textures.filter(texture => texture.status !== 'available').map(texture =>
			`${texture.source} -> ${texture.target}: ${texture.status}${texture.detail ? ` (${texture.detail})` : ''}`),
		...report.fonts.filter(font => font.status !== 'available').map(font => `${font.source} -> ${font.target}: ${font.status}`),
	];
	throw new Error(`${game.i18n.localize('FOUNDRYSHOP.Project.ResourcesBlocked')} ${missing.join('; ')}`);
}
