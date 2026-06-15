/** @tool {"label":"Timezone","order":3,"resizable":true,"resizeMode":"fill","mountClass":"tool-mount--timezone","defaultSize":{"w":340,"h":440},"minSize":{"w":260,"h":280}} */
/** @tool-icon <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M6 3.6V6l2 1.2" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/> */
import { ACTION_ICONS, CARD_ICONS } from '../icons.js';

const STORAGE_SELECTED = 'tz_selected_offsets';
const STORAGE_FILTER = 'tz_filter_selected';
const STORAGE_COMPACT = 'tz_compact';
const DEFAULT_PANEL_HEIGHT = 440;
const FIT_VISIBLE_THRESHOLD = 6;

const OFFSET_ZONES = [
    { offsetMinutes: -720, city: 'Baker Island', zoneId: 'Etc/GMT+12', abbr: 'BIT' },
    { offsetMinutes: -660, city: 'Pago Pago', zoneId: 'Pacific/Pago_Pago', abbr: 'SST' },
    { offsetMinutes: -600, city: 'Honolulu', zoneId: 'Pacific/Honolulu', abbr: 'HST' },
    { offsetMinutes: -540, city: 'Anchorage', zoneId: 'America/Anchorage', abbr: 'AKST' },
    { offsetMinutes: -480, city: 'Los Angeles', zoneId: 'America/Los_Angeles', abbr: 'PST' },
    { offsetMinutes: -420, city: 'Denver', zoneId: 'America/Denver', abbr: 'MST' },
    { offsetMinutes: -360, city: 'Chicago', zoneId: 'America/Chicago', abbr: 'CST' },
    { offsetMinutes: -300, city: 'New York', zoneId: 'America/New_York', abbr: 'EST' },
    { offsetMinutes: -240, city: 'Halifax', zoneId: 'America/Halifax', abbr: 'AST' },
    { offsetMinutes: -180, city: 'São Paulo', zoneId: 'America/Sao_Paulo', abbr: 'BRT' },
    { offsetMinutes: -120, city: 'Noronha', zoneId: 'America/Noronha', abbr: 'FNT' },
    { offsetMinutes: -60, city: 'Azores', zoneId: 'Atlantic/Azores', abbr: 'AZOT' },
    { offsetMinutes: 0, city: 'UTC', zoneId: 'UTC', abbr: 'UTC' },
    { offsetMinutes: 60, city: 'Warsaw', zoneId: 'Europe/Warsaw', abbr: 'CET' },
    { offsetMinutes: 120, city: 'Cairo', zoneId: 'Africa/Cairo', abbr: 'EET' },
    { offsetMinutes: 180, city: 'Moscow', zoneId: 'Europe/Moscow', abbr: 'MSK' },
    { offsetMinutes: 210, city: 'Tehran', zoneId: 'Asia/Tehran', abbr: 'IRST' },
    { offsetMinutes: 240, city: 'Dubai', zoneId: 'Asia/Dubai', abbr: 'GST' },
    { offsetMinutes: 270, city: 'Kabul', zoneId: 'Asia/Kabul', abbr: 'AFT' },
    { offsetMinutes: 300, city: 'Karachi', zoneId: 'Asia/Karachi', abbr: 'PKT' },
    { offsetMinutes: 330, city: 'New Delhi', zoneId: 'Asia/Kolkata', abbr: 'IST' },
    { offsetMinutes: 345, city: 'Kathmandu', zoneId: 'Asia/Kathmandu', abbr: 'NPT' },
    { offsetMinutes: 360, city: 'Dhaka', zoneId: 'Asia/Dhaka', abbr: 'BST' },
    { offsetMinutes: 390, city: 'Yangon', zoneId: 'Asia/Yangon', abbr: 'MMT' },
    { offsetMinutes: 420, city: 'Bangkok', zoneId: 'Asia/Bangkok', abbr: 'ICT' },
    { offsetMinutes: 480, city: 'Shanghai', zoneId: 'Asia/Shanghai', abbr: 'CST' },
    { offsetMinutes: 525, city: 'Eucla', zoneId: 'Australia/Eucla', abbr: 'ACWST' },
    { offsetMinutes: 540, city: 'Tokyo', zoneId: 'Asia/Tokyo', abbr: 'JST' },
    { offsetMinutes: 570, city: 'Adelaide', zoneId: 'Australia/Adelaide', abbr: 'ACST' },
    { offsetMinutes: 600, city: 'Sydney', zoneId: 'Australia/Sydney', abbr: 'AEST' },
    { offsetMinutes: 630, city: 'Lord Howe', zoneId: 'Australia/Lord_Howe', abbr: 'LHST' },
    { offsetMinutes: 660, city: 'Nouméa', zoneId: 'Pacific/Noumea', abbr: 'NCT' },
    { offsetMinutes: 720, city: 'Auckland', zoneId: 'Pacific/Auckland', abbr: 'NZST' },
    { offsetMinutes: 765, city: 'Chatham', zoneId: 'Pacific/Chatham', abbr: 'CHAST' },
    { offsetMinutes: 780, city: 'Apia', zoneId: 'Pacific/Apia', abbr: 'WST' },
    { offsetMinutes: 840, city: 'Kiritimati', zoneId: 'Pacific/Kiritimati', abbr: 'LINT' }
];

const ABBR_BY_ZONE = Object.fromEntries(OFFSET_ZONES.map((z) => [z.zoneId, z.abbr]));

function isGmtStyleAbbr(value) {
    return /^GMT|^UTC|[+-]\d/.test(String(value || '').trim());
}

function isLetterAbbr(value) {
    return /^[A-Z]{2,5}$/i.test(String(value || '').trim());
}

function getZoneOffsetMinutes(date, timeZone) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'shortOffset'
        }).formatToParts(date);
        const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || '';
        const match = tzName.match(/(?:GMT|UTC)([+-])(\d{1,2})(?::(\d{2}))?/);
        if (match) {
            const sign = match[1] === '+' ? 1 : -1;
            const hours = parseInt(match[2], 10);
            const mins = match[3] ? parseInt(match[3], 10) : 0;
            return sign * (hours * 60 + mins);
        }
    } catch {
        /* fall through */
    }
    return null;
}

function getZoneAbbr(date, timeZone, fallbackAbbr = '') {
    if (timeZone === 'UTC') return 'UTC';
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'short'
        }).formatToParts(date);
        const intlAbbr = parts.find((p) => p.type === 'timeZoneName')?.value || '';
        if (intlAbbr && !isGmtStyleAbbr(intlAbbr) && isLetterAbbr(intlAbbr)) {
            return intlAbbr.toUpperCase();
        }
    } catch {
        /* fall through */
    }
    return fallbackAbbr || ABBR_BY_ZONE[timeZone] || '';
}

function formatZoneTime(date, timeZone) {
    return {
        time: date.toLocaleTimeString('en-US', {
            timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }),
        date: date.toLocaleDateString('en-US', {
            timeZone,
            month: 'short',
            day: 'numeric'
        })
    };
}

export const Timezone = {
    container: null,
    localZoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
    sortedZones: [...OFFSET_ZONES].sort((a, b) => a.offsetMinutes - b.offsetMinutes),
    selectedOffsets: new Set(),
    filterSelectedOnly: false,
    sectionCollapsed: false,
    adjustOpen: false,
    savedPanelHeight: null,
    onDocumentPointerDown: null,
    onKeyDown: null,

    init(mountElement) {
        this.container = mountElement;
        const panel = mountElement.closest('.tool-panel');
        if (panel?.style.height) {
            this.savedPanelHeight = panel.style.height;
        }
        this.loadPrefs();
        this.render();
    },

    loadPrefs() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_SELECTED) || 'null');
            if (Array.isArray(saved)) {
                this.selectedOffsets = new Set(saved.filter((n) => Number.isFinite(n)));
            } else {
                this.selectedOffsets = new Set();
            }
        } catch {
            this.selectedOffsets = new Set();
        }

        if (!this.selectedOffsets.size) {
            this.selectedOffsets.add(0);
            const now = new Date();
            const localOffset = getZoneOffsetMinutes(now, this.localZoneId);
            if (localOffset !== null && localOffset !== 0) {
                this.selectedOffsets.add(localOffset);
            }
        }

        this.filterSelectedOnly = localStorage.getItem(STORAGE_FILTER) === '1';

        const compactSaved = localStorage.getItem(STORAGE_COMPACT);
        if (compactSaved === null) {
            this.sectionCollapsed = this.filterSelectedOnly;
        } else {
            this.sectionCollapsed = compactSaved === '1';
        }
    },

    savePrefs() {
        localStorage.setItem(STORAGE_SELECTED, JSON.stringify([...this.selectedOffsets]));
        localStorage.setItem(STORAGE_FILTER, this.filterSelectedOnly ? '1' : '0');
        localStorage.setItem(STORAGE_COMPACT, this.sectionCollapsed ? '1' : '0');
    },

    render() {
        const now = new Date();
        const currentHours = now.getHours() + now.getMinutes() / 60;
        const filterClass = this.filterSelectedOnly ? ' tz-tool-stack--filter-selected' : '';
        const toggleClass = this.sectionCollapsed ? ' collapsed' : '';

        this.container.innerHTML = `
            <div class="tool-stack tz-tool-stack${filterClass}">
                <div class="collapsable-header list-row--header" id="tz-section-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle${toggleClass}">▼</span>Timezones</span>
                    <div class="tz-tool__compact" data-tz-compact></div>
                    <div class="tz-toolbar toolbar toolbar--end">
                        <div class="tz-toolbar__adjust-wrap">
                            <button type="button" class="btn btn--compact btn-icon tz-adjust-btn" aria-haspopup="dialog" aria-expanded="false" aria-label="Adjust time">${ACTION_ICONS.clockStyle}</button>
                            <div class="tz-adjust-popover is-hidden" role="dialog" aria-label="Adjust time">
                                <input type="range" id="tz-slider" class="tz-slider" min="0" max="24" step="0.25" value="${currentHours}">
                                <button type="button" class="tz-adjust-reset">Reset</button>
                            </div>
                        </div>
                        <button type="button" class="btn btn--compact btn-icon tz-filter-btn${this.filterSelectedOnly ? ' is-active' : ''}" aria-pressed="${this.filterSelectedOnly ? 'true' : 'false'}" aria-label="Show selected only">${this.filterSelectedOnly ? CARD_ICONS.hide : CARD_ICONS.show}</button>
                    </div>
                </div>
                <div class="collapsable-section${this.sectionCollapsed ? ' collapsed' : ''}" id="tz-section">
                    <p class="tz-filter-hint tool-msg${this.filterSelectedOnly && !this.sectionCollapsed ? '' : ' is-hidden'}">Showing selected timezones only</p>
                    <div class="tz-table-wrap">
                        <table class="tz-table">
                            <thead>
                                <tr>
                                    <th class="tz-col-check"><span class="is-hidden">Select</span></th>
                                    <th class="tz-col-city">City</th>
                                    <th class="tz-col-abbr">TZ</th>
                                    <th class="tz-col-time">Time</th>
                                    <th class="tz-col-date">Date</th>
                                </tr>
                            </thead>
                            <tbody id="tz-table-body"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

        this.buildZoneList();
        this.setupListeners();
        this.applySectionCollapsed(false);
        this.updateTimeMatrix(now);
        this.applyFilter();
        if (!this.sectionCollapsed) {
            requestAnimationFrame(() => this.scrollToUtc());
        }
    },

    buildZoneList() {
        const tbody = document.getElementById('tz-table-body');
        if (!tbody) return;

        tbody.innerHTML = this.sortedZones.map((zone) => {
            const isUtc = zone.offsetMinutes === 0;
            const extraClass = isUtc ? ' tz-row--utc' : '';
            const checked = this.selectedOffsets.has(zone.offsetMinutes) ? ' checked' : '';
            return `
                <tr class="tz-row${extraClass}" data-offset="${zone.offsetMinutes}" data-zone-id="${zone.zoneId}" data-abbr="${zone.abbr}">
                    <td class="tz-col-check">
                        <input type="checkbox" class="tz-row-check"${checked} aria-label="Show ${zone.city}">
                    </td>
                    <td class="tz-col-city u-truncate">${zone.city}</td>
                    <td class="tz-col-abbr"></td>
                    <td class="tz-col-time"></td>
                    <td class="tz-col-date"></td>
                </tr>
            `;
        }).join('');
    },

    setupListeners() {
        const slider = document.getElementById('tz-slider');
        const resetBtn = this.container?.querySelector('.tz-adjust-reset');
        const adjustBtn = this.container?.querySelector('.tz-adjust-btn');
        const adjustPopover = this.container?.querySelector('.tz-adjust-popover');
        const filterBtn = this.container?.querySelector('.tz-filter-btn');
        const toggle = this.container?.querySelector('#tz-section-header .collapsable-toggle');
        const tbody = document.getElementById('tz-table-body');

        toggle?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.sectionCollapsed = !this.sectionCollapsed;
            this.savePrefs();
            this.applySectionCollapsed(true);
        });

        slider?.addEventListener('input', (e) => {
            const targetHours = parseFloat(e.target.value);
            const targetDate = new Date();
            const hours = Math.floor(targetHours);
            const minutes = Math.round((targetHours - hours) * 60);
            targetDate.setHours(hours, minutes, 0, 0);
            this.updateTimeMatrix(targetDate);
        });

        resetBtn?.addEventListener('click', () => {
            const now = new Date();
            if (slider) slider.value = now.getHours() + now.getMinutes() / 60;
            this.updateTimeMatrix(now);
            if (!this.sectionCollapsed) this.scrollToUtc();
        });

        adjustBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.adjustOpen) {
                this.closeAdjustPopover();
            } else {
                this.openAdjustPopover();
            }
        });

        filterBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.filterSelectedOnly = !this.filterSelectedOnly;
            if (this.filterSelectedOnly && localStorage.getItem(STORAGE_COMPACT) === null) {
                this.sectionCollapsed = true;
            }
            filterBtn.classList.toggle('is-active', this.filterSelectedOnly);
            filterBtn.setAttribute('aria-pressed', this.filterSelectedOnly ? 'true' : 'false');
            filterBtn.innerHTML = this.filterSelectedOnly ? CARD_ICONS.hide : CARD_ICONS.show;
            this.container?.querySelector('.tz-tool-stack')?.classList.toggle('tz-tool-stack--filter-selected', this.filterSelectedOnly);
            this.container?.querySelector('.tz-filter-hint')?.classList.toggle('is-hidden', !this.filterSelectedOnly || this.sectionCollapsed);
            this.savePrefs();
            this.applyFilter();
            this.applySectionCollapsed(false);
        });

        tbody?.addEventListener('change', (e) => {
            const check = e.target.closest('.tz-row-check');
            if (!check) return;
            const row = check.closest('.tz-row');
            const offset = parseInt(row?.dataset.offset, 10);
            if (!Number.isFinite(offset)) return;
            if (check.checked) {
                this.selectedOffsets.add(offset);
            } else {
                this.selectedOffsets.delete(offset);
            }
            this.savePrefs();
            this.applyFilter();
        });

        this.onDocumentPointerDown = (e) => {
            if (!this.adjustOpen || !adjustPopover || !adjustBtn) return;
            if (adjustPopover.contains(e.target) || adjustBtn.contains(e.target)) return;
            this.closeAdjustPopover();
        };
        document.addEventListener('pointerdown', this.onDocumentPointerDown);

        this.onKeyDown = (e) => {
            if (e.key === 'Escape' && this.adjustOpen) {
                e.preventDefault();
                this.closeAdjustPopover();
            }
        };
        document.addEventListener('keydown', this.onKeyDown);
    },

    applySectionCollapsed(scrollOnExpand) {
        const section = this.container?.querySelector('#tz-section');
        const toggle = this.container?.querySelector('#tz-section-header .collapsable-toggle');

        section?.classList.toggle('collapsed', this.sectionCollapsed);
        toggle?.classList.toggle('collapsed', this.sectionCollapsed);
        this.container?.querySelector('.tz-filter-hint')?.classList.toggle('is-hidden', !this.filterSelectedOnly || this.sectionCollapsed);

        if (this.sectionCollapsed) {
            this.closeAdjustPopover();
        } else if (scrollOnExpand) {
            requestAnimationFrame(() => this.scrollToUtc());
        }

        this.syncPanelFit();
        this.updateCompactPreview();
    },

    openAdjustPopover() {
        const adjustBtn = this.container?.querySelector('.tz-adjust-btn');
        const adjustPopover = this.container?.querySelector('.tz-adjust-popover');
        if (!adjustBtn || !adjustPopover) return;
        adjustPopover.classList.remove('is-hidden');
        adjustBtn.setAttribute('aria-expanded', 'true');
        this.adjustOpen = true;
    },

    closeAdjustPopover() {
        const adjustBtn = this.container?.querySelector('.tz-adjust-btn');
        const adjustPopover = this.container?.querySelector('.tz-adjust-popover');
        if (!adjustBtn || !adjustPopover) return;
        adjustPopover.classList.add('is-hidden');
        adjustBtn.setAttribute('aria-expanded', 'false');
        this.adjustOpen = false;
    },

    applyFilter() {
        const tbody = document.getElementById('tz-table-body');
        if (!tbody) return;

        const checkedCount = tbody.querySelectorAll('.tz-row-check:checked').length;
        const filterActive = this.filterSelectedOnly && checkedCount > 0;

        tbody.querySelectorAll('.tz-row').forEach((row) => {
            const check = row.querySelector('.tz-row-check');
            const show = !filterActive || check?.checked;
            row.classList.toggle('is-hidden', !show);
        });

        this.syncPanelFit();
        this.updateCompactPreview();
    },

    getVisibleRows() {
        const tbody = document.getElementById('tz-table-body');
        if (!tbody) return [];
        return [...tbody.querySelectorAll('.tz-row:not(.is-hidden)')];
    },

    getVisibleRowCount() {
        return this.getVisibleRows().length;
    },

    updateCompactPreview() {
        const mount = this.container?.querySelector('[data-tz-compact]');
        if (!mount) return;

        const rows = this.getVisibleRows();
        if (!rows.length) {
            mount.innerHTML = '<span class="tz-compact-empty">No timezones</span>';
            return;
        }

        mount.innerHTML = rows.map((row) => {
            const city = row.querySelector('.tz-col-city')?.textContent?.trim() || '';
            const time = row.querySelector('.tz-col-time')?.textContent?.trim() || '—';
            const extraClass = row.classList.contains('tz-row--utc') || row.classList.contains('tz-row--local')
                ? ' tz-compact-row--accent'
                : '';
            return `<div class="tz-compact-row${extraClass}"><span class="tz-compact-city u-truncate">${city}</span><span class="tz-compact-time">${time}</span></div>`;
        }).join('');
    },

    syncPanelFit() {
        const panel = this.container?.closest('.tool-panel');
        if (!panel) return;

        const visibleCount = this.getVisibleRowCount();
        const shouldFit = this.sectionCollapsed
            || (this.filterSelectedOnly && visibleCount > 0 && visibleCount <= FIT_VISIBLE_THRESHOLD);

        if (shouldFit) {
            if (!this.savedPanelHeight && panel.style.height) {
                this.savedPanelHeight = panel.style.height;
            }
            panel.classList.add('tool-panel--auto-height', 'tool-panel--tz-fit');
            panel.style.height = '';
        } else {
            panel.classList.remove('tool-panel--auto-height', 'tool-panel--tz-fit');
            if (this.savedPanelHeight) {
                panel.style.height = this.savedPanelHeight;
            } else {
                panel.style.height = `${DEFAULT_PANEL_HEIGHT}px`;
            }
        }
    },

    scrollToUtc() {
        const utcRow = this.container?.querySelector('#tz-table-body .tz-row[data-offset="0"]:not(.is-hidden)');
        utcRow?.scrollIntoView({ block: 'center', behavior: 'auto' });
    },

    updateTimeMatrix(baseDate) {
        const tbody = document.getElementById('tz-table-body');
        if (!tbody) return;

        const localOffset = getZoneOffsetMinutes(baseDate, this.localZoneId);

        tbody.querySelectorAll('.tz-row').forEach((row) => {
            const zoneId = row.dataset.zoneId;
            const offsetMinutes = parseInt(row.dataset.offset, 10);
            const fallbackAbbr = row.dataset.abbr || '';
            const isUtc = offsetMinutes === 0;
            const liveOffset = getZoneOffsetMinutes(baseDate, zoneId);

            const isLocal = localOffset !== null && liveOffset === localOffset && !isUtc;
            row.classList.toggle('tz-row--local', isLocal);

            const abbrEl = row.querySelector('.tz-col-abbr');
            const timeEl = row.querySelector('.tz-col-time');
            const dateEl = row.querySelector('.tz-col-date');

            if (abbrEl) abbrEl.textContent = getZoneAbbr(baseDate, zoneId, fallbackAbbr);

            try {
                const formatted = formatZoneTime(baseDate, zoneId);
                if (timeEl) timeEl.textContent = formatted.time;
                if (dateEl) dateEl.textContent = formatted.date;
            } catch {
                if (timeEl) timeEl.textContent = '—';
                if (dateEl) dateEl.textContent = '';
            }
        });

        this.updateCompactPreview();
    },

    destroy() {
        this.closeAdjustPopover();
        const panel = this.container?.closest('.tool-panel');
        if (panel) {
            panel.classList.remove('tool-panel--tz-fit', 'tool-panel--auto-height');
        }
        if (this.onDocumentPointerDown) {
            document.removeEventListener('pointerdown', this.onDocumentPointerDown);
        }
        if (this.onKeyDown) {
            document.removeEventListener('keydown', this.onKeyDown);
        }
        this.onDocumentPointerDown = null;
        this.onKeyDown = null;
        this.container = null;
    }
};
