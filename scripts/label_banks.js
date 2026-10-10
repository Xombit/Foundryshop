import { MODULE } from './constants.js';
import { normalizeLabelStyle, STARTER_LABELS, starterLabels } from './label_styles.js';

export const PERSONAL_LABELS = 'personalLabels';
export const CAMPAIGN_LABELS = 'campaignLabels';
export const LABELS_CHANGED = 'foundryshopLabelsChanged';
export const MAX_LABELS = 128;
export const MAX_LABEL_NAME_LENGTH = 80;
export const MAX_LABEL_TEXT_LENGTH = 200;
export const STARTER_LABEL_KEYS = STARTER_LABELS.map(entry => entry.key);

const queues = new Map();

export function labelBankKey(scope) {
	if (scope === 'personal') return PERSONAL_LABELS;
	if (scope === 'campaign') return CAMPAIGN_LABELS;
	throw new Error('Invalid label bank scope.');
}

export function normalizeLabelText(text) {
	if (typeof text !== 'string') {
		throw new Error(game.i18n.format('FOUNDRYSHOP.Labels.InvalidText', { max: MAX_LABEL_TEXT_LENGTH }));
	}
	text = text.replace(/\r\n?/g, '\n').trim();
	if (!text || text.length > MAX_LABEL_TEXT_LENGTH) {
		throw new Error(game.i18n.format('FOUNDRYSHOP.Labels.InvalidText', { max: MAX_LABEL_TEXT_LENGTH }));
	}
	return text;
}

export function normalizeLabelName(name, text) {
	if (typeof name !== 'string' || name.trim().length > MAX_LABEL_NAME_LENGTH) {
		throw new Error(game.i18n.format('FOUNDRYSHOP.Labels.InvalidName', { max: MAX_LABEL_NAME_LENGTH }));
	}
	return name.trim() || text.split('\n')[0].trim().slice(0, MAX_LABEL_NAME_LENGTH);
}

export function validateLabelBank(data) {
	if (!data || data.schemaVersion !== 1 || !Array.isArray(data.labels) || data.labels.length > MAX_LABELS) {
		throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.InvalidBank'));
	}
	const ids = new Set();
	const labels = data.labels.map(entry => {
		if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) {
			throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.InvalidBank'));
		}
		ids.add(entry.id);
		const text = normalizeLabelText(entry.text);
		const style = normalizeLabelStyle(entry.style);
		return { id: entry.id, name: normalizeLabelName(entry.name, text), text, ...(style ? { style } : {}) };
	});
	if (data.startersInitialized !== undefined && typeof data.startersInitialized !== 'boolean') {
		throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.InvalidBank'));
	}
	return { schemaVersion: 1, labels, ...(data.startersInitialized !== undefined
		? { startersInitialized: data.startersInitialized } : {}) };
}

const STARTER_KEY_PREFIX = 'FOUNDRYSHOP.Labels.';

// Settings defaults are built before translations load, so stored starters may hold raw i18n keys.
function localizeStarterKey(value) {
	return typeof value === 'string' && value.startsWith(STARTER_KEY_PREFIX) && game.i18n.has?.(value)
		? game.i18n.localize(value) : value;
}

export function readLabelBank(scope) {
	const bank = validateLabelBank(game.settings.get(MODULE, labelBankKey(scope)));
	for (const entry of bank.labels) {
		entry.text = localizeStarterKey(entry.text);
		entry.name = localizeStarterKey(entry.name);
	}
	return bank;
}

export function canEditLabelBank(scope) {
	labelBankKey(scope);
	return scope === 'personal' || game.user.isGM;
}

function mutateBank(scope, mutate) {
	const key = labelBankKey(scope);
	if (!canEditLabelBank(scope)) {
		return Promise.reject(new Error(game.i18n.localize('FOUNDRYSHOP.Labels.GMOnly')));
	}
	const previous = queues.get(key) ?? Promise.resolve();
	const operation = previous.then(async () => {
		if (!canEditLabelBank(scope)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.GMOnly'));
		const bank = readLabelBank(scope);
		const before = JSON.stringify(bank);
		mutate(bank.labels, bank);
		const validated = validateLabelBank(bank);
		if (JSON.stringify(validated) === before) return validated;
		await game.settings.set(MODULE, key, validated);
		return validated;
	});
	// Callers receive the original rejection; a failed operation must not poison the next edit.
	const settled = operation.then(() => {}, () => {});
	queues.set(key, settled);
	settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
	return operation;
}

function sameEntry(entry, expected) {
	return entry && entry.id === expected.id && entry.name === expected.name && entry.text === expected.text
		&& JSON.stringify(entry.style) === JSON.stringify(expected.style);
}

export function saveLabel(scope, text, name = '', style) {
	text = normalizeLabelText(text);
	name = normalizeLabelName(name, text);
	style = normalizeLabelStyle(style);
	return mutateBank(scope, labels => {
		if (labels.length >= MAX_LABELS) throw new Error(game.i18n.format('FOUNDRYSHOP.Labels.Full', { max: MAX_LABELS }));
		labels.push({ id: foundry.utils.randomID(), name, text, ...(style ? { style } : {}) });
	});
}

export function editLabel(scope, expected, text, name = '', style = expected.style) {
	text = normalizeLabelText(text);
	name = normalizeLabelName(name, text);
	style = normalizeLabelStyle(style === null ? undefined : style);
	return mutateBank(scope, labels => {
		const entry = labels.find(entry => entry.id === expected.id);
		if (!sameEntry(entry, expected)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.Changed'));
		Object.assign(entry, { name, text });
		if (style) entry.style = style;
		else delete entry.style;
	});
}

export function deleteLabel(scope, expected) {
	return mutateBank(scope, labels => {
		const index = labels.findIndex(entry => entry.id === expected.id);
		if (!sameEntry(labels[index], expected)) throw new Error(game.i18n.localize('FOUNDRYSHOP.Labels.Changed'));
		labels.splice(index, 1);
	});
}

/** Add localized starter labels whose text is not already present. */
export function addStarterLabels(scope) {
	const examples = starterLabels();
	return mutateBank(scope, labels => {
		const additions = examples.filter(example => !labels.some(entry => entry.text === example.text));
		if (labels.length + additions.length > MAX_LABELS) {
			throw new Error(game.i18n.format('FOUNDRYSHOP.Labels.Full', { max: MAX_LABELS }));
		}

		for (const example of additions) labels.push({ ...example, id: foundry.utils.randomID() });
	});
}

export function ensureStarterLabels(scope) {
	if (readLabelBank(scope).startersInitialized || !canEditLabelBank(scope)) return Promise.resolve();
	return mutateBank(scope, (labels, bank) => {
		if (bank.startersInitialized) return;
		const additions = starterLabels().filter(example => !labels.some(entry => entry.text === example.text));
		if (labels.length + additions.length > MAX_LABELS) {
			throw new Error(game.i18n.format('FOUNDRYSHOP.Labels.Full', { max: MAX_LABELS }));
		}
		labels.push(...additions);
		bank.startersInitialized = true;
	});
}
