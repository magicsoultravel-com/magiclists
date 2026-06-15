/** @tool {"label":"Timezone","order":3,"resizable":true,"resizeMode":"fill","mountClass":"tool-mount--timezone","defaultSize":{"w":340,"h":440},"minSize":{"w":260,"h":280}} */
/** @tool-icon <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M6 3.6V6l2 1.2" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/> */
import { ACTION_ICONS, CARD_ICONS } from '../ui.js';

const STORAGE_SELECTED = 'tz_selected_offsets';
const STORAGE_FILTER = 'tz_filter_selected';

const OFFSET_ZONES = [
    { offsetMinutes: -720, city: 'Baker Island', zoneId: 'Etc/GMT+12' },
    { offsetMinutes: -660, city: 'Pago Pago', zoneId: 'Pacific/Pago_Pago' },
    { offsetMinutes: -600, city: 'Honolulu', zoneId: 'Pacific/Honolulu' },
    { offsetMinutes: -540, city: 'Anchorage', zoneId: 'America/Anchorage' },
    { offsetMinutes: -480, city: 'Los Angeles', zoneId: 'America/Los_Angeles' },
    { offsetMinutes: -420, city: 'Denver', zoneId: 'America/Denver' },
    { offsetMinutes: -360, city: 'Chicago', zoneId: 'America/Chicago' },
    { offsetMinutes: -300, city: 'New York', zoneId: 'America/New_York' },
    { offsetMinutes: -240, city: 'Halifax', zoneId: 'America/Halifax' },
    { offsetMinutes: -180, city: 'São Paulo', zoneId: 'America/Sao_Paulo' },
    { offsetMinutes: -120, city: 'Noronha', zoneId: 'America/Noronha' },
    { offsetMinutes: -60, city: 'Azores', zoneId: 'Atlantic/Azores' },
    { offsetMinutes: 0, city: 'UTC', zoneId: 'UTC' },
    { offsetMinutes: 60, city: 'Warsaw', zoneId: 'Europe/Warsaw' },
    { offsetMinutes: 120, city: 'Cairo', zoneId: 'Africa/Cairo' },
    { offsetMinutes: 180, city: 'Moscow', zoneId: 'Europe/Moscow' },
    { offsetMinutes: 210, city: 'Tehran', zoneId: 'Asia/Tehran' },
    { offsetMinutes: 240, city: 'Dubai', zoneId: 'Asia/Dubai' },
    { offsetMinutes: 270, city: 'Kabul', zoneId: 'Asia/Kabul' },
    { offsetMinutes: 300, city: 'Karachi', zoneId: 'Asia/Karachi' },
    { offsetMinutes: 330, city: 'New Delhi', zoneId: 'Asia/Kolkata' },
    { offsetMinutes: 345, city: 'Kathmandu', zoneId: 'Asia/Kathmandu' },
    { offsetMinutes: 360, city: 'Dhaka', zoneId: 'Asia/Dhaka' },
    { offsetMinutes: 390, city: 'Yangon', zoneId: 'Asia/Yangon' },
    { offsetMinutes: 420, city: 'Bangkok', zoneId: 'Asia/Bangkok' },
    { offsetMinutes: 480, city: 'Shanghai', zoneId: 'Asia/Shanghai' },
    { offsetMinutes: 525, city: 'Eucla', zoneId: 'Australia/Eucla' },
    { offsetMinutes: 540, city: 'Tokyo', zoneId: 'Asia/Tokyo' },
    { offsetMinutes: 570, city: 'Adelaide', zoneId: 'Australia/Adelaide' },
    { offsetMinutes: 600, city: 'Sydney', zoneId: 'Australia/Sydney' },
    { offsetMinutes: 630, city: 'Lord Howe', zoneId: 'Australia/Lord_Howe' },
    { offsetMinutes: 660, city: 'Nouméa', zoneId: 'Pacific/Noumea' },
    { offsetMinutes: 720, city: 'Auckland', zoneId: 'Pacific/Auckland' },
    { offsetMinutes: 765, city: 'Chatham', zoneId: 'Pacific/Chatham' },
    { offsetMinutes: 780, city: 'Apia', zoneId: 'Pacific/Apia' },
    { offsetMinutes: 840, city: 'Kiritimati', zoneId: 'Pacific/Kiritimati' }
];

function formatOffsetLabel(minutes) {
    if (minutes === 0) return 'UTC';
    const sign = minutes > 0 ? '+' : '−';
    const abs = Math.abs(minutes);
    const hours = Math.floor(abs / 60);
    const mins = abs % 60;
    if (mins) return `UTC${sign}${hours}:${String(mins).padStart(2, '0')}`;
    return `UTC${sign}${hours}`;
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

function getZoneAbbr(date, timeZone) {
    if (timeZone === 'UTC') return 'UTC';
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'short'
        }).formatToParts(date);
        return parts.find((p) => p.type === 'timeZoneName')?.value || '';
    } catch {
        return '';
    }
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
    adjustOpen: false,
    onDocumentPointerDown: null,
    onKeyDown: null,

    init(mountElement) {
        this.container = mountElement;
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
    },

    savePrefs() {
        localStorage.setItem(STORAGE_SELECTED, JSON.stringify([...this.selectedOffsets]));
        localStorage.setItem(STORAGE_FILTER, this.filterSelectedOnly ? '1' : '0');
    },

    render() {
        const now = new Date();
        const currentHours = now.getHours() + now.getMinutes() / 60;
        const filterClass = this.filterSelectedOnly ? ' tz-tool-stack--filter-selected' : '';

        this.container.innerHTML = `
            <div class="tool-stack tz-tool-stack${filterClass}">
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
                <p class="tz-filter-hint tool-msg${this.filterSelectedOnly ? '' : ' is-hidden'}">Showing selected timezones only</p>
                <div id="tz-cards-stack" class="tz-cards-stack"></div>
            </div>
        `;

        this.buildZoneList();
        this.setupListeners();
        this.updateTimeMatrix(now);
        this.applyFilter();
        requestAnimationFrame(() => this.scrollToUtc());
    },

    buildZoneList() {
        const stack = document.getElementById('tz-cards-stack');
        if (!stack) return;

        stack.innerHTML = this.sortedZones.map((zone) => {
            const isUtc = zone.offsetMinutes === 0;
            const extraClass = isUtc ? ' tz-card--utc' : '';
            const checked = this.selectedOffsets.has(zone.offsetMinutes) ? ' checked' : '';
            return `
                <div class="tz-card${extraClass}" data-offset="${zone.offsetMinutes}" data-zone-id="${zone.zoneId}">
                    <input type="checkbox" class="tz-card-check"${checked} aria-label="Show ${zone.city}">
                    <span class="tz-card-label u-truncate">${zone.city}</span>
                    <span class="tz-card-abbr"></span>
                    <span class="tz-card-offset"></span>
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
        const stack = document.getElementById('tz-cards-stack');

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
            this.scrollToUtc();
        });

        adjustBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.adjustOpen) {
                this.closeAdjustPopover();
            } else {
                this.openAdjustPopover();
            }
        });

        filterBtn?.addEventListener('click', () => {
            this.filterSelectedOnly = !this.filterSelectedOnly;
            filterBtn.classList.toggle('is-active', this.filterSelectedOnly);
            filterBtn.setAttribute('aria-pressed', this.filterSelectedOnly ? 'true' : 'false');
            filterBtn.innerHTML = this.filterSelectedOnly ? CARD_ICONS.hide : CARD_ICONS.show;
            this.container?.querySelector('.tz-tool-stack')?.classList.toggle('tz-tool-stack--filter-selected', this.filterSelectedOnly);
            this.container?.querySelector('.tz-filter-hint')?.classList.toggle('is-hidden', !this.filterSelectedOnly);
            this.savePrefs();
            this.applyFilter();
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
    },

    scrollToUtc() {
        const utcRow = this.container?.querySelector('[data-offset="0"]');
        utcRow?.scrollIntoView({ block: 'center', behavior: 'auto' });
    },

    updateTimeMatrix(baseDate) {
        const stack = document.getElementById('tz-cards-stack');
        if (!stack) return;

        const localOffset = getZoneOffsetMinutes(baseDate, this.localZoneId);

        stack.querySelectorAll('.tz-card').forEach((card) => {
            const zoneId = card.dataset.zoneId;
            const offsetMinutes = parseInt(card.dataset.offset, 10);
            const isUtc = offsetMinutes === 0;
            const liveOffset = getZoneOffsetMinutes(baseDate, zoneId);
            const offsetLabel = liveOffset !== null
                ? formatOffsetLabel(liveOffset)
                : formatOffsetLabel(offsetMinutes);

            const isLocal = localOffset !== null && liveOffset === localOffset && !isUtc;
            card.classList.toggle('tz-card--local', isLocal);

            const abbrEl = card.querySelector('.tz-card-abbr');
            const offsetEl = card.querySelector('.tz-card-offset');
            const timeEl = card.querySelector('.tz-card-time');
            const dateEl = card.querySelector('.tz-card-date');

            if (abbrEl) abbrEl.textContent = getZoneAbbr(baseDate, zoneId);
            if (offsetEl) offsetEl.textContent = offsetLabel;

            try {
                const formatted = formatZoneTime(baseDate, zoneId);
                if (timeEl) timeEl.textContent = formatted.time;
                if (dateEl) dateEl.textContent = formatted.date;
            } catch {
                if (timeEl) timeEl.textContent = '—';
                if (dateEl) dateEl.textContent = '';
            }
        });
    },

    destroy() {
        this.closeAdjustPopover();
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
