/** @tool {"label":"Timezone","order":3,"resizable":true,"resizeMode":"fill","mountClass":"tool-mount--timezone","defaultSize":{"w":340,"h":440},"minSize":{"w":260,"h":280}} */
/** @tool-icon <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M6 3.6V6l2 1.2" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/> */
import { ACTION_ICONS, CARD_ICONS } from '../ui.js';

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
    compactMode: false,
    adjustOpen: false,
    savedPanelHeight: null,
    savedPanelWidth: null,
    onDocumentPointerDown: null,
    onKeyDown: null,
    onPanelIconClick: null,

    init(mountElement) {
        this.container = mountElement;
        const panel = mountElement.closest('.tool-panel');
        if (panel?.style.height) {
            this.savedPanelHeight = panel.style.height;
        }
        if (panel?.style.width) {
            this.savedPanelWidth = panel.style.width;
        }
        this.loadPrefs();
        this.render();
        this.bindPanelIcon();
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
            this.compactMode = this.filterSelectedOnly;
        } else {
            this.compactMode = compactSaved === '1';
        }
    },

    savePrefs() {
        localStorage.setItem(STORAGE_SELECTED, JSON.stringify([...this.selectedOffsets]));
        localStorage.setItem(STORAGE_FILTER, this.filterSelectedOnly ? '1' : '0');
        localStorage.setItem(STORAGE_COMPACT, this.compactMode ? '1' : '0');
    },

    render() {
        const now = new Date();
        const currentHours = now.getHours() + now.getMinutes() / 60;
        const filterClass = this.filterSelectedOnly ? ' tz-tool-stack--filter-selected' : '';
        const compactClass = this.compactMode ? ' tz-tool-stack--compact' : '';
        const toggleClass = this.compactMode ? ' collapsed' : '';

        this.container.innerHTML = `
            <div class="tool-stack tz-tool-stack${filterClass}${compactClass}">
                <div class="tz-list-header list-row--header" id="tz-list-header">
                    <span class="collapsable-heading">
                        <span class="collapsable-toggle${toggleClass}">▼</span>
                        <span>Timezones</span>
                    </span>
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
                <p class="tz-filter-hint tool-msg${this.filterSelectedOnly && !this.compactMode ? '' : ' is-hidden'}">Showing selected timezones only</p>
                <div id="tz-cards-stack" class="tz-cards-stack"></div>
            </div>
        `;

        this.buildZoneList();
        this.setupListeners();
        this.updateTimeMatrix(now);
        this.applyFilter();
        this.applyCompactMode();
        if (!this.compactMode) {
            requestAnimationFrame(() => this.scrollToUtc());
        }
    },

    buildZoneList() {
        const stack = document.getElementById('tz-cards-stack');
        if (!stack) return;

        stack.innerHTML = this.sortedZones.map((zone) => {
            const isUtc = zone.offsetMinutes === 0;
            const extraClass = isUtc ? ' tz-card--utc' : '';
            const compactClass = this.compactMode ? ' tz-card--compact' : '';
            const checked = this.selectedOffsets.has(zone.offsetMinutes) ? ' checked' : '';
            return `
                <div class="tz-card${extraClass}${compactClass}" data-offset="${zone.offsetMinutes}" data-zone-id="${zone.zoneId}" data-abbr="${zone.abbr}">
                    <input type="checkbox" class="tz-card-check"${checked} aria-label="Show ${zone.city}">
                    <span class="tz-card-label u-truncate">${zone.city}</span>
                    <span class="tz-card-abbr"></span>
                    <span class="tz-card-right">
                        <span class="tz-card-time"></span>
                        <span class="tz-card-date"></span>
                    </span>
                </div>
            `;
        }).join('');
    },

    setupListeners() {
        const slider = document.getElementById('tz-slider');
        const resetBtn = this.container?.querySelector('.tz-adjust-reset');
        const adjustBtn = this.container?.querySelector('.tz-adjust-btn');
        const adjustPopover = this.container?.querySelector('.tz-adjust-popover');
        const filterBtn = this.container?.querySelector('.tz-filter-btn');
        const listHeader = this.container?.querySelector('#tz-list-header');
        const stack = document.getElementById('tz-cards-stack');

        listHeader?.addEventListener('click', (e) => {
            if (e.target.closest('.tz-toolbar')) return;
            if (this.compactMode) return;
            this.compactMode = true;
            this.savePrefs();
            this.applyCompactMode();
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
            if (!this.compactMode) this.scrollToUtc();
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
                this.compactMode = true;
            }
            filterBtn.classList.toggle('is-active', this.filterSelectedOnly);
            filterBtn.setAttribute('aria-pressed', this.filterSelectedOnly ? 'true' : 'false');
            filterBtn.innerHTML = this.filterSelectedOnly ? CARD_ICONS.hide : CARD_ICONS.show;
            this.container?.querySelector('.tz-tool-stack')?.classList.toggle('tz-tool-stack--filter-selected', this.filterSelectedOnly);
            this.container?.querySelector('.tz-filter-hint')?.classList.toggle('is-hidden', !this.filterSelectedOnly || this.compactMode);
            this.savePrefs();
            this.applyFilter();
            this.applyCompactMode();
        });

        stack?.addEventListener('change', (e) => {
            const check = e.target.closest('.tz-card-check');
            if (!check) return;
            const card = check.closest('.tz-card');
            const offset = parseInt(card?.dataset.offset, 10);
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

    bindPanelIcon() {
        const panel = this.container?.closest('.tool-panel');
        const iconEl = panel?.querySelector('.tool-panel__icon');
        if (!iconEl) return;

        this.onPanelIconClick = (e) => {
            if (!this.compactMode) return;
            e.stopPropagation();
            this.compactMode = false;
            this.savePrefs();
            this.applyCompactMode();
        };
        iconEl.addEventListener('click', this.onPanelIconClick);
    },

    applyCompactMode() {
        const panel = this.container?.closest('.tool-panel');
        const iconEl = panel?.querySelector('.tool-panel__icon');
        const stack = this.container?.querySelector('.tz-tool-stack');
        const toggle = this.container?.querySelector('.collapsable-toggle');

        stack?.classList.toggle('tz-tool-stack--compact', this.compactMode);
        toggle?.classList.toggle('collapsed', this.compactMode);
        panel?.classList.toggle('tool-panel--tz-compact', this.compactMode);
        this.container?.querySelector('.tz-filter-hint')?.classList.toggle('is-hidden', !this.filterSelectedOnly || this.compactMode);

        if (iconEl) {
            if (this.compactMode) {
                iconEl.setAttribute('role', 'button');
                iconEl.setAttribute('tabindex', '0');
                iconEl.setAttribute('aria-label', 'Expand timezones');
                this.closeAdjustPopover();
            } else {
                iconEl.removeAttribute('role');
                iconEl.removeAttribute('tabindex');
                iconEl.removeAttribute('aria-label');
            }
        }

        this.container?.querySelectorAll('.tz-card').forEach((card) => {
            card.classList.toggle('tz-card--compact', this.compactMode);
        });

        this.syncPanelFit();
        this.syncPanelWidth();
    },

    syncPanelWidth() {
        const panel = this.container?.closest('.tool-panel');
        if (!panel) return;

        if (this.compactMode) {
            if (!this.savedPanelWidth) {
                this.savedPanelWidth = panel.style.width || `${panel.offsetWidth}px`;
            }
            requestAnimationFrame(() => {
                const body = panel.querySelector('.tool-panel__body');
                const cards = document.getElementById('tz-cards-stack');
                const header = panel.querySelector('.tool-panel__header');
                const bodyPad = body
                    ? (parseFloat(getComputedStyle(body).paddingLeft) || 0)
                        + (parseFloat(getComputedStyle(body).paddingRight) || 0)
                    : 16;
                const contentW = cards?.scrollWidth || 0;
                const headerW = header?.scrollWidth || 0;
                const fitW = Math.ceil(Math.max(contentW + bodyPad, headerW)) + 2;
                panel.style.width = `${Math.max(fitW, 88)}px`;
            });
        } else {
            panel.style.width = this.savedPanelWidth || `${340}px`;
        }
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
        const stack = document.getElementById('tz-cards-stack');
        if (!stack) return;

        const checkedCount = stack.querySelectorAll('.tz-card-check:checked').length;
        const filterActive = this.filterSelectedOnly && checkedCount > 0;

        stack.querySelectorAll('.tz-card').forEach((card) => {
            const check = card.querySelector('.tz-card-check');
            const show = !filterActive || check?.checked;
            card.classList.toggle('is-hidden', !show);
        });

        this.syncPanelFit();
        this.syncPanelWidth();
    },

    getVisibleRowCount() {
        const stack = document.getElementById('tz-cards-stack');
        if (!stack) return 0;
        return stack.querySelectorAll('.tz-card:not(.is-hidden)').length;
    },

    syncPanelFit() {
        const panel = this.container?.closest('.tool-panel');
        if (!panel) return;

        const visibleCount = this.getVisibleRowCount();
        const shouldFit = this.compactMode
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
        const utcRow = this.container?.querySelector('[data-offset="0"]:not(.is-hidden)');
        utcRow?.scrollIntoView({ block: 'center', behavior: 'auto' });
    },

    updateTimeMatrix(baseDate) {
        const stack = document.getElementById('tz-cards-stack');
        if (!stack) return;

        const localOffset = getZoneOffsetMinutes(baseDate, this.localZoneId);

        stack.querySelectorAll('.tz-card').forEach((card) => {
            const zoneId = card.dataset.zoneId;
            const offsetMinutes = parseInt(card.dataset.offset, 10);
            const fallbackAbbr = card.dataset.abbr || '';
            const isUtc = offsetMinutes === 0;
            const liveOffset = getZoneOffsetMinutes(baseDate, zoneId);

            const isLocal = localOffset !== null && liveOffset === localOffset && !isUtc;
            card.classList.toggle('tz-card--local', isLocal);

            const abbrEl = card.querySelector('.tz-card-abbr');
            const timeEl = card.querySelector('.tz-card-time');
            const dateEl = card.querySelector('.tz-card-date');

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

        if (this.compactMode) {
            this.syncPanelWidth();
        }
    },

    destroy() {
        this.closeAdjustPopover();
        const panel = this.container?.closest('.tool-panel');
        const iconEl = panel?.querySelector('.tool-panel__icon');
        if (iconEl && this.onPanelIconClick) {
            iconEl.removeEventListener('click', this.onPanelIconClick);
        }
        if (panel && this.compactMode) {
            panel.classList.remove('tool-panel--tz-compact', 'tool-panel--tz-fit', 'tool-panel--auto-height');
            if (this.savedPanelWidth) {
                panel.style.width = this.savedPanelWidth;
            }
        }
        if (this.onDocumentPointerDown) {
            document.removeEventListener('pointerdown', this.onDocumentPointerDown);
        }
        if (this.onKeyDown) {
            document.removeEventListener('keydown', this.onKeyDown);
        }
        this.onDocumentPointerDown = null;
        this.onKeyDown = null;
        this.onPanelIconClick = null;
        this.container = null;
    }
};
