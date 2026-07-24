/** @module {"owns":"checklist/content conversion, plain copy text", "related":["noteSurface.js","checklistSteps.js","richText.js"]} */
import { sanitizeRichHtml, stripRichText } from './richText.js';
import { sheetIsActive, sheetToTsv, getCellValue } from './sheet.js';

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

function isBlockTag(tag) {
    return tag === 'DIV' || tag === 'P' || tag === 'LI' || /^H[1-6]$/.test(tag);
}

export function splitContentLines(content) {
    const raw = String(content || '').replace(/\u2028/g, '\n');
    if (!raw.trim()) return [];
    if (!/<[^>]+>/.test(raw)) {
        return raw.split('\n').filter((line) => stripRichText(line).trim());
    }

    const tpl = document.createElement('template');
    tpl.innerHTML = raw;
    const lines = [];
    let buf = document.createElement('span');

    const flush = () => {
        const html = buf.innerHTML.trim();
        buf = document.createElement('span');
        if (stripRichText(html).trim()) lines.push(sanitizeRichHtml(html));
    };

    const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            buf.appendChild(node.cloneNode());
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.tagName === 'BR') {
            flush();
            return;
        }
        if (isBlockTag(node.tagName)) {
            flush();
            Array.from(node.childNodes).forEach(walk);
            flush();
            return;
        }
        buf.appendChild(node.cloneNode(true));
    };

    Array.from(tpl.content.childNodes).forEach(walk);
    flush();
    return lines;
}

export function contentHasConvertibleText(content) {
    return splitContentLines(content).some((line) => stripRichText(line).trim());
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

export function deriveEditorBodyLayout(item) {
    const hasContent = !!stripRichText(item?.content || '').trim();
    const hasSteps = stepsHaveConvertibleText(item?.steps);
    if (hasContent && hasSteps) return 'both';
    if (hasContent) return 'content';
    if (hasSteps) return 'checklist';
    return 'both';
}

export function convertContentToChecklist(item, createStep) {
    const lines = splitContentLines(item.content);
    const stepsFromContent = [];

    for (const line of lines) {
        if (!stripRichText(line).trim()) continue;
        const { text, completed, level } = parseContentLine(line);
        if (!stripRichText(text).trim()) continue;
        stepsFromContent.push({
            ...createStep(),
            text,
            completed,
            level
        });
    }

    item.content = '';
    item.steps = [...stepsFromContent, ...(item.steps || [])];
    item.editorBodyLayout = deriveEditorBodyLayout(item);
    return item;
}

export function convertChecklistToContent(item) {
    const ordered = orderStepsActiveThenDone(item.steps || []);
    const lines = ordered
        .filter((step) => stripRichText(step.text || '').trim())
        .map((step) => stepTextToContentLine(step));

    const fromSteps = lines.join('\n');
    const existing = String(item.content || '').trim();
    item.content = existing && fromSteps
        ? `${existing.replace(/\n+$/, '')}\n${fromSteps}`
        : (existing || fromSteps);
    item.steps = [];
    item.editorBodyLayout = deriveEditorBodyLayout(item);
    return item;
}

export function stepToPlainCopyLine(step) {
    const line = stepTextToContentLine(step);
    const { indent, body } = splitLineIndent(line);
    return indent + stripRichText(body).replace(/\u2028/g, '\n');
}

export function itemToPlainCopyText(item) {
    const blocks = [];
    const title = stripRichText(item?.title || '').trim();
    if (title) blocks.push(title);

    const template = item?.noteTemplate;
    if (template === 'meeting') {
        const attendees = sheetIsActive(item) && item.sheet ? sheetToTsv(item.sheet).trim() : '';
        if (attendees) blocks.push(`Attendees:\n${attendees}`);
        const content = stripRichText(item?.content || '').replace(/\u2028/g, '\n').trim();
        if (content) blocks.push(`Agenda:\n${content}`);
        const lines = orderStepsActiveThenDone(item?.steps || [])
            .map(stepToPlainCopyLine)
            .filter((l) => l.trim());
        if (lines.length) blocks.push(`Action Items:\n${lines.join('\n')}`);
        return blocks.join('\n\n');
    }

    if (template === 'sheet' && item?.sheet) {
        const tsv = sheetToTsv(item.sheet).trim();
        if (tsv) blocks.push(tsv);
        return blocks.join('\n\n');
    }

    const content = stripRichText(item?.content || '').replace(/\u2028/g, '\n').trim();
    if (content) blocks.push(content);
    const lines = orderStepsActiveThenDone(item?.steps || [])
        .map(stepToPlainCopyLine)
        .filter((l) => l.trim());
    if (lines.length) blocks.push(lines.join('\n'));
    return blocks.join('\n\n');
}

/**
 * Converts a checklist step to Markdown format.
 * @param {object} step - The step object with text, completed, and level properties
 * @returns {string} Markdown formatted line like "  - [ ] text" or "  - [x] text"
 */
export function stepToMarkdownLine(step) {
    const level = Math.min(4, Math.max(0, Number(step?.level) || 0));
    const indent = '  '.repeat(level);
    const checkbox = step?.completed ? '[x]' : '[ ]';
    const text = stripRichText(step?.text || '').replace(/\u2028/g, '\n').trim();
    return text ? `${indent}- ${checkbox} ${text}` : '';
}

/**
 * Converts a sheet (table) to Markdown pipe table format.
 * @param {object} sheet - The sheet object with rows, cols, and cells
 * @returns {string} Markdown pipe table string
 */
export function sheetToMarkdown(sheet) {
    if (!sheet) return '';
    const rows = sheet.rows || 0;
    const cols = sheet.cols || 0;
    if (rows === 0 || cols === 0) return '';

    const lines = [];
    // Build header row
    const headerCells = [];
    for (let c = 0; c < cols; c++) {
        headerCells.push(String(getCellValue(sheet, 0, c) || '').trim());
    }
    lines.push('| ' + headerCells.join(' | ') + ' |');

    // Build separator row
    const separatorCells = [];
    for (let c = 0; c < cols; c++) {
        separatorCells.push('---');
    }
    lines.push('| ' + separatorCells.join(' | ') + ' |');

    // Build data rows
    for (let r = 1; r < rows; r++) {
        const rowCells = [];
        for (let c = 0; c < cols; c++) {
            rowCells.push(String(getCellValue(sheet, r, c) || '').trim());
        }
        lines.push('| ' + rowCells.join(' | ') + ' |');
    }

    return lines.join('\n');
}

/**
 * Converts an item to text export format with metadata.
 * @param {object} item - The note item
 * @returns {string} Formatted text with metadata and content
 */
export function itemToTxtExportText(item) {
    const lines = [];

    // Title
    const title = stripRichText(item?.title || '').trim();
    if (title) {
        lines.push(`Title: ${title}`);
    }

    // Category
    const categories = Array.isArray(item?.categories) ? item.categories.filter(Boolean) : [];
    const category = categories.length > 0 ? categories.join(', ') : 'Uncategorized';
    lines.push(`Category: ${category}`);

    // Status
    const status = item?.status || 'active';
    lines.push(`Status: ${status}`);

    // Created Date
    const createdDate = formatDateForExport(item?.id);
    lines.push(`Created: ${createdDate}`);

    // Modified Date
    const modifiedDate = formatDateForExport(item?.updatedAt || item?.startDateTime);
    lines.push(`Modified: ${modifiedDate}`);

    lines.push(''); // Empty line after metadata

    // Content
    const template = item?.noteTemplate;
    if (template === 'meeting') {
        // Meeting template: sheet as attendees, content as agenda, steps as action items
        if (sheetIsActive(item) && item.sheet) {
            const mdTable = sheetToMarkdown(item.sheet);
            if (mdTable) {
                lines.push('Attendees:');
                lines.push(mdTable);
                lines.push('');
            }
        }
        const content = stripRichText(item?.content || '').replace(/\u2028/g, '\n').trim();
        if (content) {
            lines.push('Agenda:');
            lines.push(content);
            lines.push('');
        }
        const stepLines = orderStepsActiveThenDone(item?.steps || [])
            .map(stepToMarkdownLine)
            .filter((l) => l.trim());
        if (stepLines.length) {
            lines.push('Action Items:');
            lines.push(stepLines.join('\n'));
        }
    } else if (template === 'sheet' && item?.sheet) {
        // Sheet template: convert to Markdown table
        const mdTable = sheetToMarkdown(item.sheet);
        if (mdTable) {
            lines.push(mdTable);
        }
    } else {
        // Default: content and checklist
        const content = stripRichText(item?.content || '').replace(/\u2028/g, '\n').trim();
        if (content) {
            lines.push(content);
            lines.push('');
        }
        const stepLines = orderStepsActiveThenDone(item?.steps || [])
            .map(stepToMarkdownLine)
            .filter((l) => l.trim());
        if (stepLines.length) {
            lines.push(stepLines.join('\n'));
        }
    }

    return lines.join('\n');
}

/**
 * Formats a date for export display.
 * @param {string|number} dateInput - Date string or timestamp
 * @returns {string} Formatted date string
 */
function formatDateForExport(dateInput) {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

/**
 * Sorts items by category (primary) and date (secondary, newest first).
 * Uncategorized items are placed at the end.
 * @param {Array} items - Array of note items
 * @returns {Array} Sorted array of items
 */
export function sortItemsForTxtExport(items) {
    const uncategorized = [];
    const categorized = [];

    items.forEach((item) => {
        const categories = Array.isArray(item?.categories) ? item.categories.filter(Boolean) : [];
        if (categories.length === 0) {
            uncategorized.push(item);
        } else {
            categorized.push(item);
        }
    });

    // Sort categorized items by first category, then by date (newest first)
    categorized.sort((a, b) => {
        const catA = a.categories[0] || '';
        const catB = b.categories[0] || '';
        if (catA < catB) return -1;
        if (catA > catB) return 1;
        // Same category - sort by date (newest first)
        const dateA = new Date(a.startDateTime || a.id || 0);
        const dateB = new Date(b.startDateTime || b.id || 0);
        return dateB - dateA;
    });

    // Sort uncategorized items by date (newest first)
    uncategorized.sort((a, b) => {
        const dateA = new Date(a.startDateTime || a.id || 0);
        const dateB = new Date(b.startDateTime || b.id || 0);
        return dateB - dateA;
    });

    return [...categorized, ...uncategorized];
}
