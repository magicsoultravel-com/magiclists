/** @module {"owns":"note card meta footer - created/modified dates, line count and payload size, plus the pure stat helpers behind them", "related":["noteSurfaceHtml.js","richText.js","sheet.js"]} */
import { UNCATEGORIZED_COLOR } from '../categories.js';
import { stripRichText } from '../richText.js';
import { isSheetTemplateActive } from '../sheet.js';
import { escapeHTML, escapeAttr } from '../domEscape.js';
export function formatNoteLineCount(n) {
    return n === 1 ? '1 line' : `${n} lines`;
}

export function computeNoteSizeKb(item) {
    if (!item) return '0';
    const payload = {
        title: item.title || '',
        content: item.content || '',
        steps: item.steps || [],
        type: item.type || 'note',
        categories: item.categories || [],
        noteTemplate: item.noteTemplate || '',
        sheet: isSheetTemplateActive(item) ? item.sheet : undefined
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    if (bytes === 0) return '0';
    const kb = bytes / 1024;
    if (kb < 0.1) return '<0.1';
    return kb < 10 ? kb.toFixed(1) : String(Math.round(kb));
}

export function computeNoteLineCount(item) {
    if (!item) return 0;
    let count = 0;
    const countText = (text) => {
        const plain = stripRichText(text || '');
        if (!plain) return;
        count += plain.split(/\r?\n/).length;
    };
    countText(item.content);
    for (const step of item.steps || []) countText(step.text);
    if (isSheetTemplateActive(item) && item.sheet) {
        count += sheetCellTexts(item.sheet).length;
    }
    return count;
}

export function sheetCellTexts(sheet) {
    if (!sheet?.rows || !Array.isArray(sheet.rows)) return [];
    return sheet.rows.reduce((acc, row) => {
        const cells = row.cells || [];
        return acc.concat(cells.map(c => c?.text || ''));
    }, []);
}

export function buildNoteMetaFooterHtml(item, { targetCatName = '', categoryColor = UNCATEGORIZED_COLOR } = {}) {
    const createdLabel = formatCreatedDate(item.created_at);
    const modifiedLabel = formatModifiedDate(item.updated_at);
    const sizeLabel = computeNoteSizeKb(item);
    const lineLabel = formatNoteLineCount(computeNoteLineCount(item));
    const createdHtml = createdLabel
        ? `<span class="editor-created-date" title="Created">${createdLabel}</span>`
        : '';
    const modifiedHtml = modifiedLabel
        ? `<span class="editor-modified-date" title="Last modified">${modifiedLabel}</span>`
        : '';
    const sizeHtml = `<span class="editor-note-size" title="Note content size">${sizeLabel} KB</span>`;
    const lineHtml = `<span class="editor-note-lines" title="Number of lines">${lineLabel}</span>`;
    const statsHtml = `${sizeHtml}${lineHtml}${createdHtml}${modifiedHtml}`;

    return `
            <div class="editor-meta-row editor-meta-row--footer editor-meta-row--inline">
                <span class="editor-meta-badges">
                    <span class="badge-dot" style="background-color: ${categoryColor};" title="${escapeAttr(targetCatName || 'Uncategorized')}"></span>
                    ${targetCatName ? `<span class="category-name">${escapeHTML(targetCatName)}</span>` : ''}
                </span>
                <span class="editor-meta-stats">
                    ${statsHtml}
                </span>
            </div>
        `;
}

export function formatCreatedDate(timestamp) {
    if (!timestamp) return '';
    const d = new Date(Number(timestamp) * 1000);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatModifiedDate(timestamp) {
    if (!timestamp) return '';
    const d = new Date(Number(timestamp) * 1000);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
