import { stripRichText } from './richText.js';
import { normalizeTileSize } from './tileGeometry.js';

export function deriveNoteTitle({ title = '', content = '', steps = [] } = {}) {
    const trimmedTitle = stripRichText(title).trim();
    if (trimmedTitle) return trimmedTitle;

    const contentLine = stripRichText(content)
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
    if (contentLine) return contentLine.slice(0, 72);

    for (const step of steps || []) {
        const text = stripRichText(step?.text || '').trim();
        if (!text) continue;
        const label = text.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
        return (label || text).slice(0, 72);
    }

    return 'Untitled';
}

export function createNoteId() {
    return `item_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function noteHasSavableContent({ title = '', content = '', steps = [] } = {}) {
    if (stripRichText(title).trim()) return true;
    if (stripRichText(content).trim()) return true;
    return (steps || []).some((step) => stripRichText(step?.text || '').trim());
}

export function formatLocalDateTimeParts(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return {
        date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        time: `${pad(date.getHours())}:${pad(date.getMinutes())}`
    };
}

export function defaultStartDateTimeNow() {
    const { date, time } = formatLocalDateTimeParts();
    return `${date}T${time}`;
}

export function normalizeItemForSave(item, { preserveEmptySteps = false } = {}) {
    if (!item) return item;

    const content = String(item.content || '');
    const allSteps = item.steps || [];
    const steps = preserveEmptySteps
        ? [...allSteps]
        : allSteps.filter((step) => stripRichText(step?.text || '').trim());
    const hasTitle = stripRichText(item.title || '').trim();
    const startDateTime = String(item.startDateTime || '').trim()
        ? item.startDateTime
        : defaultStartDateTimeNow();

    return {
        ...item,
        steps,
        type: steps.length > 0 ? 'checklist' : 'note',
        title: hasTitle ? item.title : deriveNoteTitle({ content, steps }),
        startDateTime,
        tileSize: normalizeTileSize(item.tileSize)
    };
}
