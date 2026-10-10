import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryImportReviewDialogs, promptRecoveryImportApproval,
	RecoveryImportReviewCancelledError } from '../scripts/layers/recovery_import_dialogs.js';

class Element {
	constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.textContent = ''; }
	append(child) { this.children.push(child); }
	setAttribute(key, value) { this.attributes[key] = value; }
}
const all = element => [element, ...element.children.flatMap(all)];
let current, prompts, unchecked, close, during;
beforeEach(() => {
	current = true; prompts = []; unchecked = new Set(); close = false; during = () => {};
	globalThis.game = { user: { id: 'gm', isGM: true }, users: { activeGM: { id: 'gm' } },
		i18n: { localize: key => key, format: (key, values) => `${key}: ${JSON.stringify(values)}` } };
	globalThis.document = { createElement: tag => new Element(tag) };
	globalThis.foundry = { applications: { api: { DialogV2: { prompt: async options => {
		prompts.push(options); during();
		if (close) return null;
		const elements = Object.fromEntries(all(options.content).filter(e => e.tag === 'input')
			.map(e => [e.attributes.name, { checked: !unchecked.has(e.attributes.name) }]));
		return options.ok.callback(null, { form: { elements } });
	} } } } };
});
const dialogs = options => createRecoveryImportReviewDialogs({ isCurrent: () => current, ...options });
const review = () => ({ token: '<img src=x>', planDigest: 'hash', drawingIds: ['drawing'], tileIds: ['tile'],
	retainedPaths: ['worlds/test/private.json'], phase: 'history-installed', resume: true,
	requiredDecisions: ['resume-finalize-import', 'native-tile-visibility', 'level-background-replacement-and-visibility'],
	nativeState: { finalDrawingIds: ['drawing'], finalTileIds: [] },
	beforeLevel: { background: { src: 'before.png' } }, afterLevel: { background: { src: 'after.png' } } });

test('resume review shows exact phase, identities and Level targets safely and independently acknowledges each decision', async () => {
	const input = review();
	during = () => { input.requiredDecisions.push('forged'); input.token = 'changed'; };
	assert.deepEqual(await dialogs().approveFinalization(input), { token: '<img src=x>', planDigest: 'hash',
		decisions: ['resume-finalize-import', 'native-tile-visibility', 'level-background-replacement-and-visibility'] });
	const elements = all(prompts[0].content), checks = elements.filter(e => e.tag === 'input');
	assert.equal(checks.length, 3);
	assert.equal(checks.every(e => e.attributes.required === '' && e.attributes.checked === undefined), true);
	assert.equal(elements.some(e => e.tag === 'img'), false);
	for (const value of ['<img src=x>', 'history-installed', 'before.png', 'after.png']) {
		assert.ok(elements.some(e => e.textContent.includes(value)));
	}
	assert.equal(prompts[0].modal, true); assert.equal(prompts[0].rejectClose, false);
	assert.equal(prompts[0].window.title, 'FOUNDRYSHOP.RecoveryImport.ResumeTitle');
});

test('hidden staging, compensation and clearing return distinct exact approval shapes', async () => {
	const d = dialogs(), r = review();
	assert.deepEqual(await d.approveStaging(r), { token: r.token, planDigest: 'hash', stageHidden: true });
	assert.deepEqual(await d.approveCompensation(r), {
		token: r.token, planDigest: 'hash', deleteHiddenStaging: true, retainFiles: true,
	});
	assert.deepEqual(await d.approveClearing(r), {
		token: r.token, planDigest: 'hash', clearCompensatedReceipt: true, retainFiles: true,
	});
	assert.ok(all(prompts[2].content).some(e => e.textContent === 'worlds/test/private.json'));
});

test('close or any unchecked decision refuses approval, including independent Tile and background consent', async () => {
	for (const name of ['decision0', 'decision1', 'decision2']) {
		unchecked = new Set([name]);
		await assert.rejects(dialogs().approveFinalization(review()), RecoveryImportReviewCancelledError);
	}
	unchecked = new Set(['retain']);
	await assert.rejects(dialogs().approveClearing(review()), RecoveryImportReviewCancelledError);
	close = true;
	await assert.rejects(dialogs().approveStaging(review()), RecoveryImportReviewCancelledError);
});

test('receipt storage review discloses exact file and requires independent persistence and retention consent', async () => {
	const input = { token: 'import', planDigest: 'plan', reference: {
		path: 'worlds/test/receipt.json', bytes: 123, fingerprint: 'exactHash',
	} };
	assert.deepEqual(await dialogs().approveReceiptPersistence(input), {
		fingerprint: 'exactHash', persistReceipt: true, retainFiles: true,
	});
	assert.ok(all(prompts[0].content).some(e => e.textContent.includes('123') && e.textContent.includes('exactHash')));
	for (const name of ['persist', 'retain']) {
		unchecked = new Set([name]);
		await assert.rejects(dialogs().approveReceiptPersistence(input), RecoveryImportReviewCancelledError);
	}
});

test('initial import review discloses exact uploads/resources and separately approves metadata and native visibility', async () => {
	const input = { ...review(), sceneId: 'destination', levelId: 'floor', uploadBytes: 12345, uploadCount: 4,
		coordinatePolicy: 'unchanged-scene-pixels', elevationPolicy: 'retain-numeric',
		fonts: ['Font'], modules: ['metadata'], backgroundBefore: { background: { src: 'before' } },
		backgroundAfter: { background: { src: 'after' } },
		requiredApprovals: ['project-import', 'native-tile-visibility', 'level-background-replacement-and-visibility', 'empty-metadata-replacement'] };
	assert.deepEqual(await dialogs().approveImport(input), { planDigest: input.planDigest, decisions: input.requiredApprovals });
	const text = all(prompts[0].content).map(e => e.textContent).join(' ');
	for (const value of ['12345', 'Font', 'metadata', 'destination', 'floor', 'worlds/test/private.json']) assert.ok(text.includes(value));
	assert.equal(all(prompts[0].content).filter(e => e.tag === 'input').length, 4);
	unchecked = new Set(['decision3']);
	await assert.rejects(dialogs().approveImport(input), RecoveryImportReviewCancelledError);
	await assert.rejects(dialogs().approveImport({ ...input, requiredApprovals: ['project-import', 'unknown'] }), /InvalidDecisions/);
});
test('lost context, cancellation and owner authority during modal refuse approval', async () => {
	const controller = new AbortController(), d = dialogs({ signal: controller.signal });
	during = () => { current = false; };
	await assert.rejects(d.approveClearing(review()), /Changed/);
	current = true; during = () => controller.abort();
	await assert.rejects(d.approveStaging(review()), /Changed/);
	during = () => { game.users.activeGM.id = 'other'; };
	await assert.rejects(dialogs().approveCompensation(review()), /Changed/);
});

test('unsupported, duplicate or wrong-mode visibility decisions refuse before opening a dialog', async () => {
	for (const requiredDecisions of [['finalize-import'], ['resume-finalize-import', 'unknown'],
		['resume-finalize-import', 'resume-finalize-import']]) {
		await assert.rejects(dialogs().approveFinalization({ ...review(), requiredDecisions }), /InvalidDecisions/);
	}
	await assert.rejects(promptRecoveryImportApproval({}, 'unknown', { isCurrent: () => true }), /InvalidAction/);
	assert.equal(prompts.length, 0);
	const r = review(); r.resume = false; r.requiredDecisions = ['finalize-import'];
	assert.deepEqual((await dialogs().approveFinalization(r)).decisions, ['finalize-import']);
	assert.equal(prompts[0].window.title, 'FOUNDRYSHOP.RecoveryImport.FinalizeTitle');
});
