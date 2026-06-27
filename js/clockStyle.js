import { ACTION_ICONS } from './icons.js';
import { positionPopoverBelowAnchor } from './popoverPosition.js';

const STORAGE_KEY = 'matrix_clock_style';
const HIDDEN_STORAGE_KEY = 'matrix_clock_hidden';

export const CLOCK_STYLES = [
    { id: 'digital', label: 'Digital', desc: 'Hours & minutes' },
    { id: 'digital-seconds', label: 'With seconds', desc: 'Live ticking seconds' },
    { id: 'analog', label: 'Analog', desc: 'Station clock with date' },
    { id: 'compact', label: 'Compact', desc: 'Date & time inline' },
    { id: 'military', label: '24-hour', desc: 'Military time' },
    { id: 'retro', label: 'Retro LED', desc: 'Glowing display' },
    { id: 'segment', label: '7-segment', desc: 'Classic 88 display' },
    { id: 'mantel', label: 'Mantel', desc: 'Vintage desk clock' }
];

const SEG_POS = {
    a: [3, 1, 10, 2],
    b: [12, 3, 2, 7],
    c: [12, 12, 2, 7],
    d: [3, 20, 10, 2],
    e: [1, 12, 2, 7],
    f: [1, 3, 2, 7],
    g: [3, 10.5, 10, 2]
};

const DIGIT_ON = {
    '0': 'abcdef',
    '1': 'bc',
    '2': 'abdeg',
    '3': 'abcdg',
    '4': 'bcfg',
    '5': 'acdfg',
    '6': 'acdefg',
    '7': 'abc',
    '8': 'abcdefg',
    '9': 'abcdfg'
};

function segmentRects(activeSegs, { ghost = false } = {}) {
    return 'abcdefg'.split('').map((seg) => {
        const [x, y, w, h] = SEG_POS[seg];
        const lit = activeSegs.includes(seg);
        if (ghost) {
            return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.8" class="seg seg--ghost"/>`;
        }
        if (!lit) return '';
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.8" class="seg seg--on"/>`;
    }).join('');
}

function segmentDigitSvg(char, sizeClass = '') {
    if (char === ':') {
        return `<svg class="seg-colon ${sizeClass}" viewBox="0 0 6 24" aria-hidden="true"><circle cx="3" cy="7" r="1.6" class="seg seg--on"/><circle cx="3" cy="17" r="1.6" class="seg seg--on"/></svg>`;
    }
    const on = DIGIT_ON[char] || '';
    return `<svg class="seg-digit ${sizeClass}" viewBox="0 0 16 24" aria-hidden="true">${segmentRects('abcdefg', { ghost: true })}${segmentRects(on)}</svg>`;
}

function renderSegmentRow(str, sizeClass = '') {
    return str.split('').map((char) => segmentDigitSvg(char, sizeClass)).join('');
}

function formatSegmentTime(now) {
    const h = now.getHours() % 12 || 12;
    const m = now.getMinutes();
    const s = now.getSeconds();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

const ANALOG_MARKS = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * 30 - 90) * (Math.PI / 180);
    const x1 = 50 + 40 * Math.cos(angle);
    const y1 = 50 + 40 * Math.sin(angle);
    const x2 = 50 + 46 * Math.cos(angle);
    const y2 = 50 + 46 * Math.sin(angle);
    const major = i % 3 === 0;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="${major ? 1.6 : 0.8}" stroke-linecap="round" opacity="${major ? 0.9 : 0.45}"/>`;
}).join('');

const ANALOG_SVG_INNER = `
    <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"/>
    ${ANALOG_MARKS}
    <line class="clock-hand clock-hand--hour" x1="50" y1="50" x2="50" y2="30" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <line class="clock-hand clock-hand--minute" x1="50" y1="50" x2="50" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line class="clock-hand clock-hand--second" x1="50" y1="54" x2="50" y2="16" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.75"/>
    <circle cx="50" cy="50" r="2.5" fill="currentColor"/>
`;

function analogSvgHtml(className = 'clock-analog-face') {
    return `<svg class="${className}" viewBox="0 0 100 100" aria-hidden="true">${ANALOG_SVG_INNER}</svg>`;
}

function formatTime(now, style) {
    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();
    const pad = (n) => String(n).padStart(2, '0');

    if (style === 'military') {
        return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }
    if (style === 'digital-seconds' || style === 'segment') {
        return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(now, style) {
    const weekday = now.toLocaleDateString('en-US', { weekday: 'short' });
    const dateString = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (style === 'compact') return `${weekday} ${dateString}`;
    return `${weekday}, ${dateString}`;
}

function formatStationDate(now) {
    const weekday = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const day = String(now.getDate()).padStart(2, '0');
    const month = now.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    return `${weekday} · ${day} ${month}`;
}

function setHandRotation(svg, selector, degrees) {
    const hand = svg?.querySelector(selector);
    if (hand) hand.setAttribute('transform', `rotate(${degrees} 50 50)`);
}

function updateAnalogHands(svg, now) {
    if (!svg) return;
    const h = now.getHours() % 12;
    const m = now.getMinutes();
    const s = now.getSeconds();
    setHandRotation(svg, '.clock-hand--hour', (h + m / 60) * 30);
    setHandRotation(svg, '.clock-hand--minute', (m + s / 60) * 6);
    setHandRotation(svg, '.clock-hand--second', s * 6);
}

function previewMarkup(style, now) {
    if (style === 'analog') {
        const date = formatStationDate(now);
        return `<span class="clock-style-preview clock-style-preview--analog clock-style-preview--departure">
            ${analogSvgHtml('clock-style-preview-face')}
            <span class="clock-style-preview-departure-date">${date}</span>
        </span>`;
    }
    if (style === 'segment') {
        return `<span class="clock-style-preview clock-style-preview--segment"><span class="clock-style-preview-segment-row">${renderSegmentRow(formatSegmentTime(now), 'seg-digit--preview')}</span></span>`;
    }
    if (style === 'mantel') {
        const date = formatStationDate(now);
        const time = formatTime(now, 'digital');
        return `<span class="clock-style-preview clock-style-preview--mantel"><span class="clock-style-preview-mantel-face"><span class="clock-style-preview-mantel-date">${date}</span><span class="clock-style-preview-mantel-time">${time}</span></span></span>`;
    }
    const time = formatTime(now, style === 'compact' ? 'digital' : style);
    const date = formatDate(now, style);
    if (style === 'compact') {
        return `<span class="clock-style-preview clock-style-preview--compact">${date} · ${time}</span>`;
    }
    if (style === 'retro') {
        return `<span class="clock-style-preview clock-style-preview--retro"><span class="clock-style-preview-date">${date}</span><span class="clock-style-preview-time">${time}</span></span>`;
    }
    return `<span class="clock-style-preview clock-style-preview--digital"><span class="clock-style-preview-date">${date}</span><span class="clock-style-preview-time">${time}</span></span>`;
}

export const ClockStyle = {
    zone: null,
    dateEl: null,
    timeEl: null,
    analogEl: null,
    analogDateEl: null,
    segmentTimeEl: null,
    mantelDateEl: null,
    mantelTimeEl: null,
    triggerBtn: null,
    showBtn: null,
    clockChromeEl: null,
    popover: null,
    intervalId: null,
    currentStyle: 'digital',
    isHidden: false,
    outsideHandler: null,
    keyHandler: null,
    previewIntervalId: null,
    _themeAutoActive: false,
    _styleBeforeThemeAuto: null,

    init() {
        this.zone = document.getElementById('digital-clock');
        this.dateEl = document.getElementById('clock-date');
        this.timeEl = document.getElementById('clock-time');
        this.analogEl = document.getElementById('clock-analog');
        this.analogDateEl = document.getElementById('clock-analog-date');
        this.segmentTimeEl = document.getElementById('clock-segment-time');
        this.mantelDateEl = document.getElementById('clock-mantel-date');
        this.mantelTimeEl = document.getElementById('clock-mantel-time');
        if (!this.zone || !this.dateEl || !this.timeEl) return;

        const analogFaceMount = this.analogEl?.querySelector('.clock-departure-face');
        if (analogFaceMount && !analogFaceMount.innerHTML.trim()) {
            analogFaceMount.innerHTML = analogSvgHtml();
        }

        this.triggerBtn = document.getElementById('clock-display');
        this.clockChromeEl = this.zone?.closest('.sidebar-clock') ?? this.zone?.closest('.side-panel-clock');

        this.showBtn = document.getElementById('btn-show-clock');
        this.isHidden = this.readHidden();
        this.applyHidden(this.isHidden, { silent: true });

        const themeId = document.documentElement.dataset.appTheme || 'dark';
        syncClockStyleForTheme(themeId);
        if (!this._themeAutoActive) {
            this.applyStyle(this.readStored(), { silent: true });
        }

        if (this.triggerBtn && this.triggerBtn.dataset.clockBound !== 'true') {
            this.triggerBtn.dataset.clockBound = 'true';
            this.triggerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.isHidden) return;
                this.togglePopover();
            });
        }

        this.tick();
        this.intervalId = setInterval(() => this.tick(), 1000);
    },

    rebindTrigger() {
        this.showBtn = document.getElementById('btn-show-clock');
        if (!this.showBtn) {
            this.syncShowBtn();
            return;
        }
        this.showBtn.innerHTML = ACTION_ICONS.clockStyle;
        this.showBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closePopover();
            this.setHidden(false);
        });
        this.syncShowBtn();
    },

    readHidden() {
        try {
            return localStorage.getItem(HIDDEN_STORAGE_KEY) === '1';
        } catch {
            return false;
        }
    },

    getPopoverAnchor() {
        return this.triggerBtn;
    },

    repositionPopover() {
        if (!this.popover || this.popover.classList.contains('is-hidden')) return;
        const anchor = this.getPopoverAnchor();
        if (anchor) positionPopoverBelowAnchor(this.popover, anchor);
    },

    syncShowBtn() {
        if (!this.showBtn) return;
        this.showBtn.title = 'Show clock';
        this.showBtn.setAttribute('aria-label', 'Show clock');
        this.showBtn.classList.toggle('is-hidden', !this.isHidden);
    },

    applyHidden(hidden, { silent = false } = {}) {
        this.isHidden = hidden;
        this.clockChromeEl?.classList.toggle('is-hidden', hidden);
        this.syncShowBtn();
        if (hidden) {
            this.triggerBtn?.setAttribute('aria-expanded', 'false');
            this.closePopover();
        }
        if (!silent) {
            try {
                localStorage.setItem(HIDDEN_STORAGE_KEY, hidden ? '1' : '0');
            } catch {
                /* ignore */
            }
        }
    },

    setHidden(hidden, { keepPopoverOpen = false } = {}) {
        const wasOpen = keepPopoverOpen && this.popover && !this.popover.classList.contains('is-hidden');
        this.applyHidden(hidden);
        if (wasOpen && !hidden) {
            requestAnimationFrame(() => this.openPopover());
        }
    },

    readStored() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored && CLOCK_STYLES.some((s) => s.id === stored)) return stored;
        } catch {
            /* ignore */
        }
        return 'digital';
    },

    applyStyle(styleId, { silent = false, manual = false } = {}) {
        if (manual) {
            this._themeAutoActive = false;
            this._styleBeforeThemeAuto = null;
        }
        const style = CLOCK_STYLES.find((s) => s.id === styleId)?.id || 'digital';
        this.currentStyle = style;
        if (!this.zone) {
            if (!silent) {
                try {
                    localStorage.setItem(STORAGE_KEY, style);
                } catch {
                    /* ignore */
                }
            }
            return;
        }
        this.zone.dataset.clockStyle = style;
        if (!silent) {
            try {
                localStorage.setItem(STORAGE_KEY, style);
            } catch {
                /* ignore */
            }
        }
        this.tick();
    },

    tick() {
        const now = new Date();
        const style = this.currentStyle;

        if (style === 'analog') {
            updateAnalogHands(this.analogEl?.querySelector('.clock-analog-face'), now);
            if (this.analogDateEl) this.analogDateEl.textContent = formatStationDate(now);
            return;
        }

        if (style === 'segment') {
            if (this.segmentTimeEl) {
                const segmentStr = formatSegmentTime(now);
                this.segmentTimeEl.innerHTML = renderSegmentRow(segmentStr);
                this.segmentTimeEl.setAttribute('aria-label', segmentStr);
            }
            return;
        }

        if (style === 'mantel') {
            const dateStr = formatStationDate(now);
            const timeStr = formatTime(now, 'digital');
            if (this.mantelDateEl) this.mantelDateEl.textContent = dateStr;
            if (this.mantelTimeEl) this.mantelTimeEl.textContent = timeStr;
            return;
        }

        const timeStr = formatTime(now, style);
        const dateStr = formatDate(now, style);

        if (style === 'compact') {
            this.timeEl.textContent = `${dateStr} · ${timeStr}`;
            this.dateEl.textContent = '';
            return;
        }

        this.timeEl.textContent = timeStr;
        this.dateEl.textContent = dateStr;
    },

    ensurePopover() {
        if (!this.popover) {
            this.popover = document.createElement('div');
            this.popover.className = 'clock-style-popover is-hidden';
            this.popover.setAttribute('role', 'menu');
            this.popover.setAttribute('aria-label', 'Clock style');
            document.body.appendChild(this.popover);
        }
        return this.popover;
    },

    closePopover() {
        if (!this.popover) return;
        this.popover.classList.add('is-hidden');
        this.triggerBtn?.setAttribute('aria-expanded', 'false');
        if (this.outsideHandler) {
            document.removeEventListener('mousedown', this.outsideHandler, true);
            this.outsideHandler = null;
        }
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
        if (this.previewIntervalId) {
            clearInterval(this.previewIntervalId);
            this.previewIntervalId = null;
        }
    },

    refreshPreviewTimes() {
        if (!this.popover || this.popover.classList.contains('is-hidden')) return;
        const now = new Date();
        this.popover.querySelectorAll('.clock-style-option').forEach((btn) => {
            const style = btn.dataset.style;
            const preview = btn.querySelector('.clock-style-preview');
            if (style === 'analog') {
                updateAnalogHands(preview?.querySelector('.clock-style-preview-face'), now);
                const dateEl = preview?.querySelector('.clock-style-preview-departure-date');
                if (dateEl) dateEl.textContent = formatStationDate(now);
                return;
            }
            if (style === 'segment') {
                const row = preview?.querySelector('.clock-style-preview-segment-row');
                if (row) row.innerHTML = renderSegmentRow(formatSegmentTime(now), 'seg-digit--preview');
                return;
            }
            if (style === 'mantel') {
                const dateEl = preview?.querySelector('.clock-style-preview-mantel-date');
                const timeEl = preview?.querySelector('.clock-style-preview-mantel-time');
                if (dateEl) dateEl.textContent = formatStationDate(now);
                if (timeEl) timeEl.textContent = formatTime(now, 'digital');
                return;
            }
            if (!preview) return;
            const time = formatTime(now, style === 'compact' ? 'digital' : style);
            const date = formatDate(now, style);
            if (style === 'compact') {
                preview.textContent = `${date} · ${time}`;
                return;
            }
            const dateEl = preview.querySelector('.clock-style-preview-date');
            const timeEl = preview.querySelector('.clock-style-preview-time');
            if (dateEl) dateEl.textContent = date;
            if (timeEl) timeEl.textContent = time;
        });
    },

    openPopover() {
        if (this.isHidden) return;
        const anchor = this.getPopoverAnchor();
        if (!anchor) return;
        this.closePopover();

        const popover = this.ensurePopover();
        const now = new Date();

        const optionsHtml = CLOCK_STYLES.map((style) => {
            const selected = style.id === this.currentStyle;
            return `<button type="button" class="clock-style-option${selected ? ' is-selected' : ''}" data-style="${style.id}" role="menuitemradio" aria-checked="${selected}">
                ${previewMarkup(style.id, now)}
                <span class="clock-style-meta">
                    <span class="clock-style-label">${style.label}</span>
                    <span class="clock-style-desc">${style.desc}</span>
                </span>
                ${selected ? '<span class="clock-style-check" aria-hidden="true">✓</span>' : ''}
            </button>`;
        }).join('');

        popover.innerHTML = `
            <label class="clock-style-hide-row" for="clock-opt-hidden">
                <input type="checkbox" class="display-options-checkbox" id="clock-opt-hidden"${this.isHidden ? ' checked' : ''}>
                <span class="clock-style-hide-label">Hide clock</span>
                <span class="clock-style-hide-hint">Quick actions</span>
            </label>
            <div class="clock-style-divider" role="separator"></div>
            <div class="clock-style-list">${optionsHtml}</div>
        `;

        popover.querySelector('#clock-opt-hidden')?.addEventListener('change', (e) => {
            e.stopPropagation();
            this.setHidden(e.target.checked, { keepPopoverOpen: true });
        });
        popover.querySelector('.clock-style-hide-row')?.addEventListener('mousedown', (e) => e.stopPropagation());

        popover.querySelectorAll('.clock-style-option').forEach((btn) => {
            btn.addEventListener('mousedown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.applyStyle(btn.dataset.style, { manual: true });
                if (this.isHidden) this.applyHidden(false);
                this.closePopover();
            });
        });

        popover.classList.remove('is-hidden');
        positionPopoverBelowAnchor(popover, anchor);
        anchor.setAttribute('aria-expanded', 'true');

        this.refreshPreviewTimes();
        this.previewIntervalId = setInterval(() => this.refreshPreviewTimes(), 1000);

        this.outsideHandler = (e) => {
            if (popover.contains(e.target)) return;
            if (this.triggerBtn?.contains(e.target)) return;
            if (this.showBtn?.contains(e.target)) return;
            this.closePopover();
        };
        this.keyHandler = (e) => {
            if (e.key === 'Escape') this.closePopover();
        };
        requestAnimationFrame(() => {
            document.addEventListener('mousedown', this.outsideHandler, true);
            document.addEventListener('keydown', this.keyHandler);
        });
    },

    togglePopover() {
        if (this.popover && !this.popover.classList.contains('is-hidden')) {
            this.closePopover();
        } else {
            this.openPopover();
        }
    }
};

const THEME_CLOCK_STYLE = {
    wood: 'mantel'
};

export function syncClockStyleForTheme(themeId) {
    const autoStyle = THEME_CLOCK_STYLE[themeId];
    if (autoStyle) {
        if (!ClockStyle._themeAutoActive) {
            ClockStyle._styleBeforeThemeAuto = ClockStyle.currentStyle;
            ClockStyle._themeAutoActive = true;
        }
        ClockStyle.applyStyle(autoStyle, { silent: true });
        return;
    }
    if (ClockStyle._themeAutoActive) {
        ClockStyle._themeAutoActive = false;
        const restore = ClockStyle._styleBeforeThemeAuto || 'digital';
        ClockStyle._styleBeforeThemeAuto = null;
        ClockStyle.applyStyle(restore, { silent: true });
    }
}
