import { escapeHTML } from './domEscape.js';

export const SHEET_DEFAULT_ROWS = 6;
export const SHEET_DEFAULT_COLS = 4;
export const MEETING_SHEET_ROWS = 2;
export const MEETING_SHEET_COLS = 6;
export const SHEET_MIN_ROWS = 1;
export const SHEET_MIN_COLS = 1;

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

export function parseCellKey(key) {
    const [row, col] = String(key).split(':').map(Number);
    return { row, col };
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

function purgeSheetLine(sheet, { row = null, col = null } = {}) {
    if (!sheet?.cells) return;
    for (const key of Object.keys(sheet.cells)) {
        const pos = parseCellKey(key);
        if (row != null && pos.row === row) delete sheet.cells[key];
        if (col != null && pos.col === col) delete sheet.cells[key];
    }
}

export function removeSheetRow(sheet) {
    if (!sheet || (sheet.rows || 1) <= SHEET_MIN_ROWS) return false;
    const lastRow = sheet.rows - 1;
    purgeSheetLine(sheet, { row: lastRow });
    sheet.rows -= 1;
    return true;
}

export function removeSheetCol(sheet) {
    if (!sheet || (sheet.cols || 1) <= SHEET_MIN_COLS) return false;
    const lastCol = sheet.cols - 1;
    purgeSheetLine(sheet, { col: lastCol });
    sheet.cols -= 1;
    return true;
}

export function growSheetCell(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
}

export function growSheetCells(block) {
    block?.querySelectorAll('[data-sheet-cell]').forEach((el) => growSheetCell(el));
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
                body += `<td class="sheet-grid__cell"><textarea class="sheet-cell-input form-input" data-sheet-cell data-row="${r}" data-col="${c}" rows="1" spellcheck="false" aria-label="Cell ${r + 1}, ${c + 1}">${escapeHTML(value)}</textarea></td>`;
            } else {
                body += `<td class="sheet-grid__cell"><span class="sheet-cell-read">${escapeHTML(value)}</span></td>`;
            }
        }
        body += '</tr>';
    }

    const canRemoveRow = rows > SHEET_MIN_ROWS;
    const canRemoveCol = cols > SHEET_MIN_COLS;
    const toolbar = canEdit && inModalEditor
        ? `<div class="sheet-toolbar">
            <button type="button" class="btn btn--compact sheet-remove-row-btn" title="Remove last row" aria-label="Remove last row"${canRemoveRow ? '' : ' disabled'}>− row</button>
            <button type="button" class="btn btn--compact sheet-add-row-btn" title="Add row" aria-label="Add row">+ row</button>
            <button type="button" class="btn btn--compact sheet-remove-col-btn" title="Remove last column" aria-label="Remove last column"${canRemoveCol ? '' : ' disabled'}>− column</button>
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
    inModalEditor = false,
    localOnly = false,
    prepareSnapshot = null,
    commitCellEdit = null,
    commitStructure = null,
    onUndo = null,
    onRedo = null
} = {}) {
    const block = root?.querySelector?.('[data-sheet-block]') || root?.closest?.('[data-sheet-block]');
    if (!block || !item || !sheetIsActive(item)) return;

    ensureItemSheet(item, defaultSheetDimsForTemplate(resolveNoteTemplate(item)));
    growSheetCells(block);

    if (block.dataset.sheetBound === 'true') return;
    block.dataset.sheetBound = 'true';

    let editBefore = null;

    block.querySelectorAll('[data-sheet-cell]').forEach((input) => {
        input.addEventListener('focus', () => {
            if (!editBefore && prepareSnapshot) {
                editBefore = prepareSnapshot();
            }
        });

        input.addEventListener('input', () => {
            syncSheetFromDom(block, item);
            growSheetCell(input);
            onChange();
        });

        input.addEventListener('blur', () => {
            if (input.dataset.skipBlurSave === '1') {
                delete input.dataset.skipBlurSave;
                return;
            }
            syncSheetFromDom(block, item);
            growSheetCell(input);
            if (editBefore && commitCellEdit) {
                commitCellEdit(editBefore);
                editBefore = null;
            }
            onChange();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                const inputs = [...block.querySelectorAll('[data-sheet-cell]')];
                const idx = inputs.indexOf(input);
                if (idx < 0) return;
                e.preventDefault();
                const next = e.shiftKey ? inputs[idx - 1] : inputs[idx + 1];
                if (next) next.focus();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                if (localOnly) return;
                editBefore = null;
                onUndo?.();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                e.stopPropagation();
                if (localOnly) return;
                editBefore = null;
                onRedo?.();
            }
        });
    });

    if (!inModalEditor) return;

    const runStructure = (mutator) => {
        syncSheetFromDom(block, item);
        const before = prepareSnapshot?.() ?? null;
        mutator();
        editBefore = null;
        if (commitStructure && before) commitStructure(before);
        refresh();
        onChange();
    };

    block.querySelector('.sheet-add-row-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        runStructure(() => addSheetRow(item.sheet));
    });

    block.querySelector('.sheet-add-col-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        runStructure(() => addSheetCol(item.sheet));
    });

    block.querySelector('.sheet-remove-row-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        if ((item.sheet?.rows || 1) <= SHEET_MIN_ROWS) return;
        runStructure(() => removeSheetRow(item.sheet));
    });

    block.querySelector('.sheet-remove-col-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        if ((item.sheet?.cols || 1) <= SHEET_MIN_COLS) return;
        runStructure(() => removeSheetCol(item.sheet));
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
