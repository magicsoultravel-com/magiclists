import { sanitizeRichHtml, stripRichText } from './richText.js';

export const SOFT_BREAK = '\u2028';

const STRIKE_TAGS = new Set(['S', 'STRIKE', 'DEL']);

export function splitLineIndent(line) {
    const s = String(line ?? '');
    const match = s.match(/^(\s*)([\s\S]*)$/);
    return { indent: match?.[1] || '', body: match?.[2] || '' };
}

export function indentLevelFromSpaces(indent) {
    return Math.min(4, Math.floor(String(indent || '').length / 2));
}

export function spacesForLevel(level) {
    const n = Number(level);
    if (!Number.isFinite(n) || n <= 0) return '';
    return ' '.repeat(Math.min(4, Math.floor(n)) * 2);
}

export function lineIsFullyStruck(html) {
    const { body } = splitLineIndent(html);
    const raw = body.trim();
    if (!raw || !/<[^>]+>/.test(raw)) return false;

    const tpl = document.createElement('template');
    tpl.innerHTML = raw;
    const meaningful = [...tpl.content.childNodes].filter((node) => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent.trim();
        return true;
    });
    if (meaningful.length !== 1 || meaningful[0].nodeType !== Node.ELEMENT_NODE) return false;
    if (!STRIKE_TAGS.has(meaningful[0].tagName)) return false;
    return stripRichText(meaningful[0].innerHTML).trim() === stripRichText(raw).trim();
}

export function wrapLineAsStruck(html) {
    const { indent, body } = splitLineIndent(html);
    if (!stripRichText(body).trim()) return html;
    if (lineIsFullyStruck(body)) return html;
    return `${indent}<s>${body}</s>`;
}

export function unwrapLineStrike(html) {
    const { indent, body } = splitLineIndent(html);
    if (!lineIsFullyStruck(body)) return html;
    const tpl = document.createElement('template');
    tpl.innerHTML = body.trim();
    const el = tpl.content.firstElementChild;
    const inner = el ? el.innerHTML : body;
    return `${indent}${sanitizeRichHtml(String(inner))}`;
}

export function parseContentLine(line) {
    const { indent, body } = splitLineIndent(line);
    const level = indentLevelFromSpaces(indent);

    if (lineIsFullyStruck(body)) {
        const tpl = document.createElement('template');
        tpl.innerHTML = body.trim();
        const el = tpl.content.firstElementChild;
        const inner = el ? el.innerHTML : body;
        const text = sanitizeRichHtml(String(inner).replace(/\u2028/g, '\n'));
        return { text, completed: true, level };
    }

    const text = sanitizeRichHtml(String(body).replace(/\u2028/g, '\n'));
    return { text, completed: false, level };
}

export function stepTextToContentLine(step) {
    const indent = spacesForLevel(step?.level);
    let body = String(step?.text || '').replace(/\n/g, SOFT_BREAK);
    if (step?.completed) body = wrapLineAsStruck(body);
    return indent + body;
}

export function contentHasConvertibleText(content) {
    return String(content || '')
        .split('\n')
        .some((line) => stripRichText(line).trim());
}

export function stepsHaveConvertibleText(steps) {
    return (steps || []).some((step) => stripRichText(step?.text || '').trim());
}

export function orderStepsActiveThenDone(steps) {
    const active = [];
    const done = [];
    (steps || []).forEach((step) => {
        if (step.completed) done.push(step);
        else active.push(step);
    });
    return [...active, ...done];
}

export function convertContentToChecklist(item, createStep) {
    const lines = String(item.content || '').split('\n');
    const steps = [];

    for (const line of lines) {
        if (!stripRichText(line).trim()) continue;
        const { text, completed, level } = parseContentLine(line);
        if (!stripRichText(text).trim()) continue;
        steps.push({
            ...createStep(),
            text,
            completed,
            level
        });
    }

    item.content = '';
    item.steps = steps;
    item.editorBodyLayout = 'checklist';
    return item;
}

export function convertChecklistToContent(item) {
    const ordered = orderStepsActiveThenDone(item.steps || []);
    const lines = ordered
        .filter((step) => stripRichText(step.text || '').trim())
        .map((step) => stepTextToContentLine(step));

    item.content = lines.join('\n');
    item.steps = [];
    item.editorBodyLayout = 'content';
    return item;
}
