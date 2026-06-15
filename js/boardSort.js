import { getItemCategoryName } from './focusFilter.js';
import { DrawingToolbarMenu } from './drawingToolbarMenu.js';
import { readBoardSort, writeBoardSort, isBoardSortCustomized } from './sidebarPrefs.js';

export function compareBoardItems(a, b, { field, dir }) {
    const d = dir === 'asc' ? 1 : -1;
    if (field === 'name') {
        const left = (a.title || '').trim().toLowerCase();
        const right = (b.title || '').trim().toLowerCase();
        const emptyRank = (value) => (value ? 0 : 1);
        const rank = emptyRank(left) - emptyRank(right);
        if (rank !== 0) return rank * d;
        return left.localeCompare(right) * d;
    }
    if (field === 'category') {
        const leftCat = getItemCategoryName(a).toLowerCase();
        const rightCat = getItemCategoryName(b).toLowerCase();
        const catCmp = leftCat.localeCompare(rightCat);
        if (catCmp !== 0) return catCmp * d;
        const left = (a.title || '').trim().toLowerCase();
        const right = (b.title || '').trim().toLowerCase();
        const emptyRank = (value) => (value ? 0 : 1);
        const rank = emptyRank(left) - emptyRank(right);
        if (rank !== 0) return rank * d;
        return left.localeCompare(right) * d;
    }
    if (field === 'edited') {
        const leftTime = Number(a.updated_at || a.created_at || 0);
        const rightTime = Number(b.updated_at || b.created_at || 0);
        return (leftTime - rightTime) * d;
    }
    const leftTime = Number(a.created_at || 0);
    const rightTime = Number(b.created_at || 0);
    return (leftTime - rightTime) * d;
}

export function sortBoardItems(items, sortPrefs) {
    return [...(items || [])].sort((a, b) => compareBoardItems(a, b, sortPrefs));
}

function buildMenuItems(prefs) {
    return [
        { heading: 'Direction' },
        { id: 'dir:horizontal', label: 'Horizontally', selected: prefs.direction === 'horizontal' },
        { id: 'dir:vertical', label: 'Vertically', selected: prefs.direction === 'vertical' },
        { divider: true },
        { heading: 'Sort by' },
        { id: 'field:date', label: 'Date', selected: prefs.field === 'date' },
        { id: 'field:name', label: 'Name', selected: prefs.field === 'name' },
        { id: 'field:category', label: 'Category', selected: prefs.field === 'category' },
        { id: 'field:edited', label: 'Last edited', selected: prefs.field === 'edited' },
        { divider: true },
        { heading: 'Order' },
        { id: 'order:asc', label: 'Ascending', selected: prefs.dir === 'asc' },
        { id: 'order:desc', label: 'Descending', selected: prefs.dir === 'desc' },
        { divider: true },
        { heading: 'Expanded layout' },
        {
            checkbox: true,
            id: 'alignExpanded',
            inputId: 'board-sort-align-expanded',
            label: 'Align expanded',
            hint: 'Bento mosaic for expanded notes; direction applies to collapsed only',
            checked: prefs.alignExpanded === true
        }
    ];
}

function sortFieldLabel(field) {
    if (field === 'name') return 'name';
    if (field === 'category') return 'category';
    if (field === 'edited') return 'last edited';
    return 'date';
}

export const BoardSort = {
    ctx: null,
    triggerBtn: null,
    boundHandler: null,

    init(ctx) {
        this.ctx = ctx;
    },

    applyPref(id) {
        const prefs = readBoardSort();
        if (id.startsWith('dir:')) prefs.direction = id.slice(4) === 'vertical' ? 'vertical' : 'horizontal';
        else if (id.startsWith('field:')) {
            const field = id.slice(6);
            if (['date', 'name', 'category', 'edited'].includes(field)) prefs.field = field;
        } else if (id.startsWith('order:')) prefs.dir = id.slice(6) === 'asc' ? 'asc' : 'desc';
        writeBoardSort(prefs);
        this.ctx?.onSort?.(prefs);
        this.syncButtonState();
        if (DrawingToolbarMenu.isOpen()) {
            DrawingToolbarMenu.setItems(buildMenuItems(prefs));
        }
    },

    toggleAlignExpanded(checked) {
        const prefs = readBoardSort();
        prefs.alignExpanded = !!checked;
        writeBoardSort(prefs);
        this.ctx?.onSort?.(prefs);
        this.syncButtonState();
        if (DrawingToolbarMenu.isOpen()) {
            DrawingToolbarMenu.setItems(buildMenuItems(prefs));
        }
    },

    syncButtonState() {
        if (!this.triggerBtn) return;
        const prefs = readBoardSort();
        this.triggerBtn.classList.toggle('is-active', isBoardSortCustomized(prefs));
        const dirLabel = prefs.direction === 'vertical' ? 'vertically' : 'horizontally';
        const orderLabel = prefs.dir === 'asc' ? 'ascending' : 'descending';
        const alignSuffix = prefs.alignExpanded ? ', align expanded' : '';
        const title = `Sort board (${sortFieldLabel(prefs.field)}, ${orderLabel}, ${dirLabel}${alignSuffix})`;
        this.triggerBtn.title = title;
        this.triggerBtn.setAttribute('aria-label', title);
    },

    rebindTrigger() {
        const btn = document.getElementById('btn-board-sort');
        if (!btn) return;
        if (this.triggerBtn && this.boundHandler) {
            this.triggerBtn.removeEventListener('click', this.boundHandler);
        }
        this.triggerBtn = btn;
        this.boundHandler = (e) => {
            e.stopPropagation();
            const prefs = readBoardSort();
            DrawingToolbarMenu.toggle({
                anchor: btn,
                ariaLabel: 'Sort board',
                items: buildMenuItems(prefs),
                closeOnSelect: false,
                onSelect: (id) => this.applyPref(id),
                onToggle: (id, checked) => {
                    if (id === 'alignExpanded') this.toggleAlignExpanded(checked);
                }
            });
        };
        btn.addEventListener('click', this.boundHandler);
        btn.setAttribute('aria-haspopup', 'menu');
        btn.setAttribute('aria-expanded', 'false');
        this.syncButtonState();
    }
};
