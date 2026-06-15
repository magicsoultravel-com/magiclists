/** @tool {"label":"Timezone","order":3,"resizable":true,"resizeMode":"fill","mountClass":"tool-mount--timezone","defaultSize":{"w":340,"h":440},"minSize":{"w":260,"h":280}} */
/** @tool-icon <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M6 3.6V6l2 1.2" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/> */

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
    { offsetMinutes: 60, city: 'Paris', zoneId: 'Europe/Paris' },
    { offsetMinutes: 120, city: 'Cairo', zoneId: 'Africa/Cairo' },
    { offsetMinutes: 180, city: 'Moscow', zoneId: 'Europe/Moscow' },
    { offsetMinutes: 210, city: 'Tehran', zoneId: 'Asia/Tehran' },
    { offsetMinutes: 240, city: 'Dubai', zoneId: 'Asia/Dubai' },
    { offsetMinutes: 270, city: 'Kabul', zoneId: 'Asia/Kabul' },
    { offsetMinutes: 300, city: 'Karachi', zoneId: 'Asia/Karachi' },
    { offsetMinutes: 330, city: 'Kolkata', zoneId: 'Asia/Kolkata' },
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

    init(mountElement) {
        this.container = mountElement;
        this.render();
    },

    render() {
        const now = new Date();
        const currentHours = now.getHours() + now.getMinutes() / 60;

        this.container.innerHTML = `
            <div class="tool-stack tz-tool-stack">
                <div id="tz-cards-stack" class="tz-cards-stack"></div>
                <div class="form-group form-group--compact tz-scrubber">
                    <label class="list-row list-row--muted">
                        <span>Adjust time</span>
                        <button type="button" id="tz-reset-btn" class="btn btn--compact">Reset</button>
                    </label>
                    <input type="range" id="tz-slider" class="tz-slider" min="0" max="24" step="0.25" value="${currentHours}">
                </div>
            </div>
        `;

        this.buildZoneList();
        this.setupListeners();
        this.updateTimeMatrix(now);
        requestAnimationFrame(() => this.scrollToUtc());
    },

    buildZoneList() {
        const stack = document.getElementById('tz-cards-stack');
        if (!stack) return;

        stack.innerHTML = this.sortedZones.map((zone) => {
            const isUtc = zone.offsetMinutes === 0;
            const extraClass = isUtc ? ' tz-card--utc' : '';
            return `
                <div class="tz-card${extraClass}" data-offset="${zone.offsetMinutes}" data-zone-id="${zone.zoneId}">
                    <span class="tz-card-label u-truncate">${zone.city}</span>
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
        const resetBtn = document.getElementById('tz-reset-btn');

        slider.addEventListener('input', (e) => {
            const targetHours = parseFloat(e.target.value);
            const targetDate = new Date();
            const hours = Math.floor(targetHours);
            const minutes = Math.round((targetHours - hours) * 60);
            targetDate.setHours(hours, minutes, 0, 0);
            this.updateTimeMatrix(targetDate);
        });

        resetBtn.addEventListener('click', () => {
            const now = new Date();
            slider.value = now.getHours() + now.getMinutes() / 60;
            this.updateTimeMatrix(now);
            this.scrollToUtc();
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

            const offsetEl = card.querySelector('.tz-card-offset');
            const timeEl = card.querySelector('.tz-card-time');
            const dateEl = card.querySelector('.tz-card-date');

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
        this.container = null;
    }
};
