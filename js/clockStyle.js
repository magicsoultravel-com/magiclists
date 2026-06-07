import { ACTION_ICONS } from './ui.js';

const STORAGE_KEY = 'matrix_clock_style';

export const CLOCK_STYLES = [
    { id: 'digital', label: 'Digital', desc: 'Hours & minutes' },
    { id: 'digital-seconds', label: 'With seconds', desc: 'Live ticking seconds' },
    { id: 'analog', label: 'Analog', desc: 'Classic clock face' },
    { id: 'compact', label: 'Compact', desc: 'Date & time inline' },
    { id: 'military', label: '24-hour', desc: 'Military time' },
    { id: 'retro', label: 'Retro LED', desc: 'Glowing display' }
];

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
    if (style === 'digital-seconds') {
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
        return `<span class="clock-style-preview clock-style-preview--analog">${analogSvgHtml('clock-style-preview-face')}</span>`;
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
    triggerBtn: null,
    popover: null,
    intervalId: null,
    currentStyle: 'digital',
    outsideHandler: null,
    keyHandler: null,
    previewIntervalId: null,

    init() {
        this.zone = document.getElementById('digital-clock');
        this.dateEl = document.getElementById('clock-date');
        this.timeEl = document.getElementById('clock-time');
        this.analogEl = document.getElementById('clock-analog');
        if (!this.zone || !this.dateEl || !this.timeEl) return;

        if (this.analogEl && !this.analogEl.innerHTML.trim()) {
            this.analogEl.innerHTML = analogSvgHtml();
        }

        this.currentStyle = this.readStored();
        this.applyStyle(this.currentStyle, { silent: true });

        this.triggerBtn = document.getElementById('btn-clock-style');
        if (this.triggerBtn) {
            this.triggerBtn.innerHTML = ACTION_ICONS.clockStyle;
            this.triggerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePopover();
            });
        }

        this.tick();
        this.intervalId = setInterval(() => this.tick(), 1000);
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

    applyStyle(styleId, { silent = false } = {}) {
        const style = CLOCK_STYLES.find((s) => s.id === styleId)?.id || 'digital';
        this.currentStyle = style;
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
            if (!preview || style === 'analog') {
                if (style === 'analog') {
                    updateAnalogHands(preview?.querySelector('.clock-style-preview-face'), now);
                }
                return;
            }
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
        if (!this.triggerBtn) return;
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

        popover.innerHTML = `<div class="clock-style-list">${optionsHtml}</div>`;

        popover.querySelectorAll('.clock-style-option').forEach((btn) => {
            btn.addEventListener('mousedown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.applyStyle(btn.dataset.style);
                this.closePopover();
            });
        });

        popover.classList.remove('is-hidden');
        this.positionPopover(this.triggerBtn);
        this.triggerBtn.setAttribute('aria-expanded', 'true');

        this.refreshPreviewTimes();
        this.previewIntervalId = setInterval(() => this.refreshPreviewTimes(), 1000);

        this.outsideHandler = (e) => {
            if (popover.contains(e.target) || this.triggerBtn.contains(e.target)) return;
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
    },

    positionPopover(anchor) {
        if (!this.popover || !anchor) return;
        const rect = anchor.getBoundingClientRect();
        const gap = 8;
        const margin = 8;
        const popRect = this.popover.getBoundingClientRect();

        let top = rect.bottom + gap;
        let left = rect.right - popRect.width;

        left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));
        if (top + popRect.height > window.innerHeight - margin) {
            top = rect.top - popRect.height - gap;
        }
        top = Math.max(margin, top);

        this.popover.style.top = `${top}px`;
        this.popover.style.left = `${left}px`;
    }
};
