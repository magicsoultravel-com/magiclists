import { escapeAttr, escapeHTML } from './domEscape.js';

export const SHEET_DEFAULT_ROWS = 6;
export const SHEET_DEFAULT_COLS = 4;
export const MEETING_SHEET_ROWS = 2;
export const MEETING_SHEET_COLS = 6;

export function resolveNoteTemplate(item) {
    const t = item?.noteTemplate;
    if (t === 'sheet' || t === 'meeting') return t;
    return 'default';
}

export function isSheetTemplateActive(item) {
    return resolveNoteTemplate(item) === 'sheet';
}

export function isMeetingTemplateActive(item) {
    return resolveNoteTemplate(item) === 'meeting';
}

export function sheetIsActive(item) {
    const t = resolveNoteTemplate(item);
    return t === 'sheet' || t === 'meeting';
}

export function createDefaultSheet({ rows = SHEET_DEFAULT_ROWS, cols = SHEET_DEFAULT_COLS } = {}) {
    return { rows, cols, cells: {} };
}

export function ensureItemSheet(item, { rows = SHEET_DEFAULT_ROWS, cols = SHEET_DEFAULT_COLS } = {}) {
    if (!item) return null;
    if (!item.sheet || typeof item.sheet !== 'object') {
        item.sheet = createDefaultSheet({ rows, cols });
    }
    if (!Number.isFinite(item.sheet.rows) || item.sheet.rows < 1) item.sheet.rows = rows;
    if (!Number.isFinite(item.sheet.cols) || item.sheet.cols < 1) item.sheet.cols = cols;
    if (!item.sheet.cells || typeof item.sheet.cells !== 'object') item.sheet.cells = {};
    return item.sheet;
}

export function defaultSheetDimsForTemplate(template) {
    if (template === 'meeting') {
        return { rows: MEETING_SHEET_ROWS, cols: MEETING_SHEET_COLS };
    }
    if (template === 'sheet') {
        return { rows: SHEET_DEFAULT_ROWS, cols: SHEET_DEFAULT_COLS };
    }
    return { rows: SHEET_DEFAULT_ROWS, cols: SHEET_DEFAULT_COLS };
}

export function cellKey(row, col) {
    return `${row}:${col}`;
}

export function getCellValue(sheet, row, col) {
    return sheet?.cells?.[cellKey(row, col)]?.v ?? '';
}

export function setCellValue(sheet, row, col, value) {
    if (!sheet) return;
    if (!sheet.cells) sheet.cells = {};
    const key = cellKey(row, col);
    const text = String(value ?? '');
    if (!text.trim()) {
        delete sheet.cells[key];
    } else {
        sheet.cells[key] = { v: text };
    }
}

export function sheetHasContent(sheet) {
    if (!sheet?.cells) return false;
    return Object.values(sheet.cells).some((cell) => String(cell?.v ?? '').trim());
}

export function sheetCellTexts(sheet) {
    if (!sheet?.cells) return [];
    return Object.values(sheet.cells)
        .map((cell) => String(cell?.v ?? '').trim())
        .filter(Boolean);
}

export function sheetFirstCellText(sheet) {
    if (!sheet?.cells) return '';
    const rows = sheet.rows || 0;
    const cols = sheet.cols || 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const text = String(getCellValue(sheet, r, c)).trim();
            if (text) return text;
        }
    }
    return '';
}

export function sheetToTsv(sheet) {
    if (!sheet) return '';
    const rows = sheet.rows || 0;
    const cols = sheet.cols || 0;
    const lines = [];
    for (let r = 0; r < rows; r++) {
        const rowCells = [];
        for (let c = 0; c < cols; c++) {
            rowCells.push(String(getCellValue(sheet, r, c)).replace(/\t/g, ' '));
        }
        lines.push(rowCells.join('\t'));
    }
    return lines.join('\n').replace(/\n+$/, '');
}

export function addSheetRow(sheet) {
    if (!sheet) return;
    sheet.rows = (sheet.rows || 1) + 1;
}

export function addSheetCol(sheet) {
    if (!sheet) return;
    sheet.cols = (sheet.cols || 1) + 1;
}

export function renderSheetHtml(sheet, { canEdit = false, inModalEditor = false } = {}) {
    const rows = sheet?.rows || SHEET_DEFAULT_ROWS;
    const cols = sheet?.cols || SHEET_DEFAULT_COLS;

    let colHead = '<th class="sheet-grid__corner" scope="col"></th>';
    for (let c = 0; c < cols; c++) {
        colHead += `<th class="sheet-grid__col-head" scope="col">${c + 1}</th>`;
    }

    let body = '';
    for (let r = 0; r < rows; r++) {
        body += `<tr><th class="sheet-grid__row-head" scope="row">${r + 1}</th>`;
        for (let c = 0; c < cols; c++) {
            const value = getCellValue(sheet, r, c);
            if (canEdit) {
                body += `<td class="sheet-grid__cell"><input type="text" class="sheet-cell-input form-input" data-sheet-cell data-row="${r}" data-col="${c}" value="${escapeAttr(value)}" spellcheck="false" aria-label="Cell ${r + 1}, ${c + 1}"></td>`;
            } else {
                body += `<td class="sheet-grid__cell"><span class="sheet-cell-read">${escapeHTML(value)}</span></td>`;
            }
        }
        body += '</tr>';
    }

    const toolbar = canEdit && inModalEditor
        ? `<div class="sheet-toolbar">
            <button type="button" class="btn btn--compact sheet-add-row-btn" title="Add row" aria-label="Add row">+ row</button>
            <button type="button" class="btn btn--compact sheet-add-col-btn" title="Add column" aria-label="Add column">+ column</button>
        </div>`
        : '';

    return `<div class="sheet-block" data-sheet-block>${toolbar}<div class="sheet-grid-wrap"><table class="sheet-grid"><thead><tr>${colHead}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}

export function syncSheetFromDom(root, item) {
    const block = root?.querySelector?.('[data-sheet-block]') || root?.closest?.('[data-sheet-block]');
    if (!block || !item) return;
    const sheet = ensureItemSheet(item);
    block.querySelectorAll('[data-sheet-cell]').forEach((input) => {
        const row = Number(input.dataset.row);
        const col = Number(input.dataset.col);
        if (!Number.isFinite(row) || !Number.isFinite(col)) return;
        setCellValue(sheet, row, col, input.value);
    });
}

export function attachSheetInteractions(root, item, {
    onChange = () => {},
    refresh = () => {},
    inModalEditor = false
} = {}) {
    const block = root?.querySelector?.('[data-sheet-block]') || root?.closest?.('[data-sheet-block]');
    if (!block || !item || !sheetIsActive(item)) return;

    ensureItemSheet(item, defaultSheetDimsForTemplate(resolveNoteTemplate(item)));

    if (block.dataset.sheetBound === 'true') return;
    block.dataset.sheetBound = 'true';

    block.querySelectorAll('[data-sheet-cell]').forEach((input) => {
        input.addEventListener('input', () => {
            syncSheetFromDom(block, item);
            onChange();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const inputs = [...block.querySelectorAll('[data-sheet-cell]')];
            const idx = inputs.indexOf(input);
            if (idx < 0) return;
            e.preventDefault();
            const next = e.shiftKey ? inputs[idx - 1] : inputs[idx + 1];
            if (next) next.focus();
        });
    });

    if (!inModalEditor) return;

    block.querySelector('.sheet-add-row-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        syncSheetFromDom(block, item);
        addSheetRow(item.sheet);
        refresh();
        onChange();
    });

    block.querySelector('.sheet-add-col-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        syncSheetFromDom(block, item);
        addSheetCol(item.sheet);
        refresh();
        onChange();
    });
}

export function buildSheetDraftItem(baseFields = {}) {
    return {
        ...baseFields,
        noteTemplate: 'sheet',
        sheet: createDefaultSheet(),
        content: '',
        steps: [],
        editorBodyLayout: 'content'
    };
}

export function buildMeetingDraftItem(baseFields = {}) {
    return {
        ...baseFields,
        noteTemplate: 'meeting',
        sheet: createDefaultSheet({ rows: MEETING_SHEET_ROWS, cols: MEETING_SHEET_COLS }),
        content: '',
        steps: [],
        editorBodyLayout: 'both'
    };
}

export function formatMeetingDateTimeBadge(startDateTime) {
    if (!startDateTime) return '';
    let date = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(startDateTime)) {
        date = new Date(`${startDateTime}T00:00:00`);
    } else if (startDateTime.includes('T')) {
        date = new Date(startDateTime);
    } else {
        date = new Date(startDateTime);
    }
    if (!date || Number.isNaN(date.getTime())) return '';

    const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const hasTime = startDateTime.includes('T') && /T\d{2}:\d{2}/.test(startDateTime);
    if (hasTime) {
        const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `@ ${timePart} on ${datePart}`;
    }
    return `@ ${datePart}`;
}
