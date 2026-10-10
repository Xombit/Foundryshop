import { prepareRecoveryProjectBundle } from './recovery_project_bundle.js';
import { canonicalJson } from './project_package.js';
import { fileFingerprint } from '../verified_file_storage.js';

const approvals = new WeakMap();
const loc = key => game.i18n.localize(`FOUNDRYSHOP.RecoveryExport.${key}`);

/** Internal reviewed export only; no toolbar registration or portable import authority. */
export async function reviewRecoveryProjectExport(scene, options = {}) {
	options = { ...options };
	const owner = game.user?.id, snapshot = canonicalJson(scene.toObject());
	const check = () => {
		if (!game.user?.isGM || game.user.id !== owner || options.signal?.aborted
			|| typeof options.isCurrent !== 'function' || !options.isCurrent()
			|| game.scenes?.get(scene.id) !== scene || canonicalJson(scene.toObject()) !== snapshot) {
			throw new Error('Recovery export source authority/context changed.');
		}
	};
	check();
	const collected = await prepareRecoveryProjectBundle(scene, options);
	const bytes = collected.bytes.slice(), fingerprint = await fileFingerprint(bytes);
	check();
	const filename = `${scene.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'drawing-project'}.foundryshop-recovery.zip`;
	const review = { ...collected.review, sceneId: scene.id, levelId: options.levelId,
		filename, fingerprint,
		disclosure: 'Download exact verified portable ZIP bytes and complete recovery ancestry for this Level. Images and historical GM-private artwork may be included; fonts/modules are not embedded. Keep server recovery files. Browser download initiation does not prove disk completion. No import, upload, native writes or approval to expose artwork.' };
	return {
		review: structuredClone(review),
		approve({ fingerprint: approvedHash, downloadZip, retainServerFiles } = {}) {
			check();
			if (approvedHash !== fingerprint || downloadZip !== true || retainServerFiles !== true) {
				throw new Error('Approve the exact recovery ZIP fingerprint, download and server-file retention.');
			}
			const capability = Object.freeze({ fingerprint });
			approvals.set(capability, { bytes, review, check, consumed: false });
			return capability;
		},
	};
}

export function downloadRecoveryProjectExport(capability) {
	const approval = approvals.get(capability);
	if (!approval || approval.consumed) throw new Error('A fresh reviewed recovery ZIP download approval is required.');
	approval.check();
	approval.consumed = true;
	const blob = new Blob([approval.bytes], { type: 'application/zip' });
	const url = URL.createObjectURL(blob);
	let link;
	try {
		link = document.createElement('a');
		link.href = url; link.download = approval.review.filename;
		document.body.append(link);
		approval.check();
		link.click();
	} finally {
		link?.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		approvals.delete(capability);
	}
	return { status: 'download-initiated', filename: approval.review.filename,
		bytes: blob.size, fingerprint: approval.review.fingerprint };
}

/** Review stays internal until broader exchange gates pass. */
export async function promptRecoveryProjectExport(scene, options = {}) {
	const reviewed = await reviewRecoveryProjectExport(scene, options), r = reviewed.review;
	const content = document.createElement('div');
	for (const text of [loc('Disclosure'), `${r.filename} (${r.zipBytes} bytes)`, r.fingerprint,
		game.i18n.format('FOUNDRYSHOP.RecoveryExport.Requirements', {
			fonts: r.fonts.join(', ') || loc('None'),
		})]) {
		const paragraph = document.createElement('p');
		paragraph.textContent = text; content.append(paragraph);
	}
	const accepted = await FoundryshopDialog.confirm({
		window: { title: loc('Title') }, content, modal: true, rejectClose: false,
		yes: { label: loc('Download') },
	});
	if (accepted !== true) return { status: 'cancelled' };
	return downloadRecoveryProjectExport(reviewed.approve({
		fingerprint: r.fingerprint, downloadZip: true, retainServerFiles: true,
	}));
}
import { FoundryshopDialog } from '../dialogs.js';
