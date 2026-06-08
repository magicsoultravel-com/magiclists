/** @tool {"label":"Calculator","order":1,"resizable":true,"mountClass":"tool-mount--calculator","defaultSize":{"w":320},"minSize":{"w":260,"h":280}} */
/** @tool-icon <rect x="2" y="1.8" width="8" height="8.4" rx="0.8" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M4 4.2h4M4 6h1.6M6.4 6H8M4 7.8h4" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/> */

const HISTORY_KEY = 'calc_history';
const HISTORY_CAP = 50;
const SCALE_BASELINE = 320;

export const Calculator = {
    container: null,
    history: [],
    historyOpen: false,
    resizeObserver: null,

    init(mountElement) {
        this.container = mountElement;
        this.loadHistory();
        this.render();
        this.bindResize();
    },

    loadHistory() {
        try {
            this.history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
            if (!Array.isArray(this.history)) this.history = [];
        } catch {
            this.history = [];
        }
    },

    saveHistory() {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history.slice(0, HISTORY_CAP)));
    },

    pushHistory(expression, result) {
        this.history.unshift({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            expression,
            result: String(result),
            ts: Date.now()
        });
        if (this.history.length > HISTORY_CAP) {
            this.history = this.history.slice(0, HISTORY_CAP);
        }
        this.saveHistory();
        this.renderHistory();
    },

    render() {
        this.container.innerHTML = `
            <div class="tool-stack calc-tool-stack">
                <input type="text" id="calc-display" class="calc-display tool-readout" autocomplete="off" spellcheck="false">
                <div class="tool-grid-4 calc-keypad">
                    <button type="button" class="btn btn--danger calc-btn" data-val="C">C</button>
                    <button type="button" class="btn calc-btn" data-val="(">(</button>
                    <button type="button" class="btn calc-btn" data-val=")">)</button>
                    <button type="button" class="btn btn--operator calc-btn" data-val="/">/</button>
                    <button type="button" class="btn calc-btn" data-val="7">7</button>
                    <button type="button" class="btn calc-btn" data-val="8">8</button>
                    <button type="button" class="btn calc-btn" data-val="9">9</button>
                    <button type="button" class="btn btn--operator calc-btn" data-val="*">*</button>
                    <button type="button" class="btn calc-btn" data-val="4">4</button>
                    <button type="button" class="btn calc-btn" data-val="5">5</button>
                    <button type="button" class="btn calc-btn" data-val="6">6</button>
                    <button type="button" class="btn btn--operator calc-btn" data-val="-">-</button>
                    <button type="button" class="btn calc-btn" data-val="1">1</button>
                    <button type="button" class="btn calc-btn" data-val="2">2</button>
                    <button type="button" class="btn calc-btn" data-val="3">3</button>
                    <button type="button" class="btn btn--operator calc-btn" data-val="+">+</button>
                    <button type="button" class="btn calc-btn calc-btn--wide" data-val="0">0</button>
                    <button type="button" class="btn calc-btn" data-val=".">.</button>
                    <button type="button" class="btn btn--accent calc-btn" data-val="=">=</button>
                </div>
                <div class="calc-history-block">
                    <div class="calc-history-header" id="calc-history-header" role="button" tabindex="0" aria-expanded="false">
                        <span class="collapsable-heading">
                            <span class="collapsable-toggle collapsed" id="calc-history-toggle">▼</span>History
                        </span>
                    </div>
                    <div class="calc-history-section" id="calc-history-section">
                        <div id="calc-history" class="calc-history" aria-label="Calculation history"></div>
                    </div>
                </div>
            </div>
        `;

        this.container.querySelectorAll('.calc-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.handleInput(btn.getAttribute('data-val')));
        });

        const historyHeader = this.container.querySelector('#calc-history-header');
        historyHeader?.addEventListener('click', () => this.toggleHistory());
        historyHeader?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggleHistory();
            }
        });

        this.renderHistory();
        this.updateScale();
    },

    toggleHistory() {
        this.historyOpen = !this.historyOpen;
        const section = this.container.querySelector('#calc-history-section');
        const toggle = this.container.querySelector('#calc-history-toggle');
        const header = this.container.querySelector('#calc-history-header');
        section?.classList.toggle('is-open', this.historyOpen);
        toggle?.classList.toggle('collapsed', !this.historyOpen);
        header?.setAttribute('aria-expanded', this.historyOpen ? 'true' : 'false');
    },

    renderHistory() {
        const list = this.container?.querySelector('#calc-history');
        if (!list) return;

        if (!this.history.length) {
            list.innerHTML = '<p class="tool-msg">No history yet</p>';
            return;
        }

        list.innerHTML = this.history.map((entry) => `
            <div class="calc-history-row" data-id="${entry.id}" title="Restore expression">
                <span class="calc-history-expr">${this.escapeHtml(entry.expression)}</span>
                <span class="calc-history-result">= ${this.escapeHtml(entry.result)}</span>
            </div>
        `).join('');

        list.querySelectorAll('.calc-history-row').forEach((row) => {
            row.addEventListener('click', () => {
                const entry = this.history.find((h) => h.id === row.dataset.id);
                if (!entry) return;
                const display = this.getDisplay();
                if (!display) return;
                display.value = entry.expression;
                display.focus();
                const len = display.value.length;
                display.setSelectionRange(len, len);
            });
        });
    },

    escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    },

    getDisplay() {
        return this.container?.querySelector('#calc-display');
    },

    handleInput(val) {
        const display = this.getDisplay();
        if (!display) return;

        if (val === 'C') {
            display.value = '';
            return;
        }

        if (val === '=') {
            const expr = display.value.trim();
            if (!expr || expr === 'Error') return;
            try {
                const result = Function(`"use strict"; return (${expr})`)();
                this.pushHistory(expr, result);
                display.value = String(result);
            } catch {
                display.value = 'Error';
            }
            return;
        }

        if (display.value === 'Error') display.value = '';
        display.value += val;
        display.focus();
    },

    bindResize() {
        if (!this.container || typeof ResizeObserver === 'undefined') return;
        this.resizeObserver = new ResizeObserver(() => this.updateScale());
        this.resizeObserver.observe(this.container);
        this.updateScale();
    },

    updateScale() {
        if (!this.container) return;
        const panel = this.container.closest('.tool-panel');
        const width = panel?.offsetWidth || this.container.offsetWidth || SCALE_BASELINE;
        const scale = Math.min(1.4, Math.max(0.85, width / SCALE_BASELINE));
        this.container.style.setProperty('--calc-scale', String(scale));
    },

    onPanelResize() {
        this.updateScale();
    },

    destroy() {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.container = null;
    }
};
