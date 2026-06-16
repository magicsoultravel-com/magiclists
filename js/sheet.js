import { escapeHTML } from './domEscape.js';
import { ACTION_ICONS } from './icons.js';

export const SHEET_DEFAULT_ROWS = 6;
export const SHEET_DEFAULT_COLS = 4;
export const MEETING_SHEET_ROWS = 2;
export const MEETING_SHEET_COLS = 6;
export const SHEET_MIN_ROWS = 1;
export const SHEET_MIN_COLS = 1;
export const SHEET_DEFAULT_COL_WIDTH_PX = 45;
export const SHEET_MIN_COL_WIDTH_PX = 30;
export const SHEET_MAX_COL_WIDTH_PX = 400;
export const SHEET_ROW_HEAD_WIDTH_PX = 35;
export const SHEET_STRUCT_COL_WIDTH_PX = 34;

function clampColWidth(px) {
    const n = Number(px);
    if (!Number.isFinite(n)) return SHEET_DEFAULT_COL_WIDTH_PX;
    return Math.min(SHEET_MAX_COL_WIDTH_PX, Math.max(SHEET_MIN_COL_WIDTH_PX, Math.round(n)));
}

function ensureColWidths(sheet) {
    if (!sheet) return;
    const cols = sheet.cols || 1;
    if (!Array.isArray(sheet.colWidths)) sheet.colWidths = [];
    while (sheet.colWidths.length < cols) {
        sheet.colWidths.push(SHEET_DEFAULT_COL_WIDTH_PX);
    }
    if (sheet.colWidths.length > cols) {
        sheet.colWidths.length = cols;
    }
    sheet.colWidths = sheet.colWidths.map(clampColWidth);
}

export function getColWidth(sheet, col) {
    ensureColWidths(sheet);
    return sheet.colWidths[col] ?? SHEET_DEFAULT_COL_WIDTH_PX;
}

export function setColWidth(sheet, col, px) {
    if (!sheet) return;
    ensureColWidths(sheet);
    if (col < 0 || col >= (sheet.cols || 0)) return;
    sheet.colWidths[col] = clampColWidth(px);
}

export function sheetGridTotalWidthPx(sheet, { includeStructCol = false } = {}) {
    ensureColWidths(sheet);
    const cols = sheet.cols || 0;
    let sum = SHEET_ROW_HEAD_WIDTH_PX;
    for (let c = 0; c < cols; c++) {
        sum += getColWidth(sheet, c);
    }
    if (includeStructCol) sum += SHEET_STRUCT_COL_WIDTH_PX;
    return sum;
}

/** Spreadsheet-style column label: 0 → A, 25 → Z, 26 → AA */
export function sheetColLabel(index) {
    let n = index;
    let label = '';
    do {
        label = String.fromCharCode(65 + (n % 26)) + label;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
}

function renderSheetStructActions({ addClass, removeClass, addTitle, removeTitle, canRemove }) {
    const disabled = canRemove ? '' : ' disabled';
    return `<span class="sheet-struct-actions">
            <button type="button" class="card-act ${addClass}" title="${addTitle}" aria-label="${addTitle}">${ACTION_ICONS.plus}</button>
            <button type="button" class="card-act ${removeClass}" title="${removeTitle}" aria-label="${removeTitle}"${disabled}>${ACTION_ICONS.minus}</button>
        </span>`;
}

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
    const sheet = { rows, cols, cells: {} };
    ensureColWidths(sheet);
    return sheet;
}

export function ensureItemSheet(item, { rows = SHEET_DEFAULT_ROWS, cols = SHEET_DEFAULT_COLS } = {}) {
    if (!item) return null;
    if (!item.sheet || typeof item.sheet !== 'object') {
        item.sheet = createDefaultSheet({ rows, cols });
    }
    if (!Number.isFinite(item.sheet.rows) || item.sheet.rows < 1) item.sheet.rows = rows;
    if (!Number.isFinite(item.sheet.cols) || item.sheet.cols < 1) item.sheet.cols = cols;
    if (!item.sheet.cells || typeof item.sheet.cells !== 'object') item.sheet.cells = {};
    ensureColWidths(item.sheet);
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
    ensureColWidths(sheet);
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
    ensureColWidths(sheet);
    return true;
}

function applyColWidthToDom(block, sheet, col, widthPx, { includeStructCol = false } = {}) {
    const table = block?.querySelector('.sheet-grid');
    if (!table) return;
    const colEl = table.querySelector(`colgroup col[data-col="${col}"]`);
    if (colEl) colEl.style.width = `${widthPx}px`;
    table.style.width = `${sheetGridTotalWidthPx(sheet, { includeStructCol })}px`;
}

export function growSheetCell(el) {
    if (!el) return;
    el.style.height = '0';
    el.style.height = `${el.scrollHeight}px`;
}

export function growSheetRowCells(rowEl) {
    if (!rowEl) return;
    let maxH = 0;
    const cells = [...rowEl.querySelectorAll('[data-sheet-cell]')];
    cells.forEach((el) => {
        el.style.height = '0';
        maxH = Math.max(maxH, el.scrollHeight);
    });
    cells.forEach((el) => {
        el.style.height = `${maxH}px`;
    });
}

export function growSheetCells(block) {
    block?.querySelectorAll('.sheet-grid tbody tr:not(.sheet-grid__struct-row)').forEach((row) => growSheetRowCells(row));
}

export function renderSheetHtml(sheet, { canEdit = false, inModalEditor = false } = {}) {
    const rows = sheet?.rows || SHEET_DEFAULT_ROWS;
    const cols = sheet?.cols || SHEET_DEFAULT_COLS;
    ensureColWidths(sheet);
    const showStruct = canEdit && inModalEditor;
    const canRemoveRow = rows > SHEET_MIN_ROWS;
    const canRemoveCol = cols > SHEET_MIN_COLS;

    let colgroup = `<col class="sheet-grid__row-head-col" style="width:${SHEET_ROW_HEAD_WIDTH_PX}px">`;
    for (let c = 0; c < cols; c++) {
        const w = getColWidth(sheet, c);
        colgroup += `<col data-col="${c}" style="width:${w}px">`;
    }
    if (showStruct) {
        colgroup += `<col class="sheet-grid__struct-col" style="width:${SHEET_STRUCT_COL_WIDTH_PX}px">`;
    }

    let colHead = '<th class="sheet-grid__corner" scope="col"></th>';
    for (let c = 0; c < cols; c++) {
        const label = sheetColLabel(c);
        if (canEdit) {
            colHead += `<th class="sheet-grid__col-head" scope="col" data-col="${c}"><span class="sheet-col-head__label">${label}</span><span class="sheet-col-resize" data-col="${c}" title="Drag to resize; double-click label to set width (px)"></span></th>`;
        } else {
            colHead += `<th class="sheet-grid__col-head" scope="col">${label}</th>`;
        }
    }
    if (showStruct) {
        colHead += `<th class="sheet-grid__struct sheet-grid__struct--col" scope="col">${renderSheetStructActions({
            addClass: 'sheet-add-col-btn',
            removeClass: 'sheet-remove-col-btn',
            addTitle: 'Add column',
            removeTitle: 'Remove last column',
            canRemove: canRemoveCol
        })}</th>`;
    }

    let body = '';
    for (let r = 0; r < rows; r++) {
        body += `<tr><th class="sheet-grid__row-head" scope="row">${r + 1}</th>`;
        for (let c = 0; c < cols; c++) {
            const colLabel = sheetColLabel(c);
            const value = getCellValue(sheet, r, c);
            if (canEdit) {
                body += `<td class="sheet-grid__cell"><textarea class="sheet-cell-input form-input" data-sheet-cell data-row="${r}" data-col="${c}" rows="1" spellcheck="false" aria-label="Cell row ${r + 1}, column ${colLabel}">${escapeHTML(value)}</textarea></td>`;
            } else {
                body += `<td class="sheet-grid__cell"><span class="sheet-cell-read">${escapeHTML(value)}</span></td>`;
            }
        }
        if (showStruct) {
            body += '<td class="sheet-grid__struct-pad"></td>';
        }
        body += '</tr>';
    }

    if (showStruct) {
        body += `<tr class="sheet-grid__struct-row"><th class="sheet-grid__struct sheet-grid__struct--row" scope="row">${renderSheetStructActions({
            addClass: 'sheet-add-row-btn',
            removeClass: 'sheet-remove-row-btn',
            addTitle: 'Add row',
            removeTitle: 'Remove last row',
            canRemove: canRemoveRow
        })}</th><td colspan="${cols + 1}" class="sheet-grid__struct-pad"></td></tr>`;
    }

    const tableWidth = sheetGridTotalWidthPx(sheet, { includeStructCol: showStruct });
    return `<div class="sheet-block" data-sheet-block><div class="sheet-grid-wrap"><table class="sheet-grid" style="width:${tableWidth}px"><colgroup>${colgroup}</colgroup><thead><tr>${colHead}</tr></thead><tbody>${body}</tbody></table></div></div>`;
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
    const includeStructCol = inModalEditor && !!block.querySelector('.sheet-grid__struct-col');

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
            growSheetRowCells(input.closest('tr'));
            onChange();
        });

        input.addEventListener('blur', () => {
            if (input.dataset.skipBlurSave === '1') {
                delete input.dataset.skipBlurSave;
                return;
            }
            syncSheetFromDom(block, item);
            growSheetRowCells(input.closest('tr'));
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

    const runStructure = (mutator, { refreshDom = true } = {}) => {
        syncSheetFromDom(block, item);
        const before = prepareSnapshot?.() ?? null;
        mutator();
        editBefore = null;
        if (commitStructure && before) commitStructure(before);
        if (refreshDom) refresh();
        onChange();
    };

    block.querySelectorAll('.sheet-col-resize').forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            const col = Number(handle.dataset.col);
            if (!Number.isFinite(col)) return;

            syncSheetFromDom(block, item);
            const before = prepareSnapshot?.() ?? null;
            const startX = e.clientX;
            const startW = getColWidth(item.sheet, col);
            let moved = false;

            const onMove = (ev) => {
                const dx = ev.clientX - startX;
                if (!moved && Math.abs(dx) < 2) return;
                moved = true;
                const next = clampColWidth(startW + dx);
                setColWidth(item.sheet, col, next);
                applyColWidthToDom(block, item.sheet, col, next, { includeStructCol });
            };

            const onEnd = (ev) => {
                try {
                    handle.releasePointerCapture(ev.pointerId);
                } catch { /* ignore */ }
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onEnd);
                document.removeEventListener('pointercancel', onEnd);
                growSheetCells(block);
                editBefore = null;
                if (moved && commitStructure && before) commitStructure(before);
                if (moved) onChange();
            };

            handle.setPointerCapture(e.pointerId);
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onEnd);
            document.addEventListener('pointercancel', onEnd);
        });
    });

    block.addEventListener('dblclick', (e) => {
        const label = e.target.closest('.sheet-col-head__label');
        if (!label || label.closest('[data-sheet-block]') !== block) return;
        e.preventDefault();
        e.stopPropagation();

        const th = label.closest('.sheet-grid__col-head');
        const col = Number(th?.dataset.col);
        if (!Number.isFinite(col)) return;

        const current = getColWidth(item.sheet, col);
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'sheet-col-head__input form-input';
        input.min = String(SHEET_MIN_COL_WIDTH_PX);
        input.max = String(SHEET_MAX_COL_WIDTH_PX);
        input.step = '1';
        input.value = String(current);
        input.setAttribute('aria-label', `Column ${sheetColLabel(col)} width in pixels`);
        label.replaceWith(input);
        input.focus();
        input.select();

        let committed = false;
        const finish = (apply) => {
            if (committed) return;
            committed = true;
            if (apply) {
                runStructure(() => setColWidth(item.sheet, col, input.value), { refreshDom: false });
                applyColWidthToDom(block, item.sheet, col, getColWidth(item.sheet, col), { includeStructCol });
                growSheetCells(block);
            }
            const newLabel = document.createElement('span');
            newLabel.className = 'sheet-col-head__label';
            newLabel.textContent = sheetColLabel(col);
            input.replaceWith(newLabel);
        };

        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                finish(true);
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                finish(false);
            }
        });
        input.addEventListener('blur', () => finish(true));
    });

    if (!inModalEditor) return;

    block.querySelectorAll('.sheet-add-row-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            runStructure(() => addSheetRow(item.sheet));
        });
    });

    block.querySelectorAll('.sheet-add-col-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            runStructure(() => addSheetCol(item.sheet));
        });
    });

    block.querySelectorAll('.sheet-remove-row-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if ((item.sheet?.rows || 1) <= SHEET_MIN_ROWS) return;
            runStructure(() => removeSheetRow(item.sheet));
        });
    });

    block.querySelectorAll('.sheet-remove-col-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if ((item.sheet?.cols || 1) <= SHEET_MIN_COLS) return;
            runStructure(() => removeSheetCol(item.sheet));
        });
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
