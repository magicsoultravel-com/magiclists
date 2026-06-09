/** @tool {"label":"Alphabets","order":7,"resizable":true,"mountClass":"tool-mount--alphabets","defaultSize":{"w":380,"h":480},"minSize":{"w":300,"h":360}} */
/** @tool-icon <path d="M2.5 3.2h2.1c.9 0 1.5.5 1.5 1.2 0 .5-.3.9-.8 1.1.6.2 1 .7 1 1.3V9H4.8V6.9c0-.4-.2-.6-.6-.6H3.8V9H2.5V3.2zm5.2 0h1.3V9H7.7V3.2zm3.1 0c1.1 0 1.9.8 1.9 2.5V9h-1.3V5.9c0-.8-.4-1.2-1-1.2-.6 0-1 .4-1 1.2V9H8.1V3.2h1.3v.5z" fill="currentColor"/> */
import { ALPHABETS } from './alphabets-data.js';

const STORAGE_KEY = 'alphabets_index';

export const Alphabets = {
    container: null,
    index: 0,
    onKeyDown: null,

    init(mountElement) {
        this.container = mountElement;
        const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
        if (!Number.isNaN(saved) && saved >= 0 && saved < ALPHABETS.length) {
            this.index = saved;
        }
        this.renderShell();
        this.bindShellListeners();
        this.renderContent();
    },

    renderShell() {
        this.container.innerHTML = `
            <div class="tool-stack alphabet-tool">
                <div class="toolbar toolbar--spread alphabet-tool__toolbar">
                    <div class="calendar-nav">
                        <button type="button" class="btn btn--compact btn-icon" data-alph-prev aria-label="Previous alphabet">◀</button>
                        <span class="calendar-title" data-alph-title></span>
                        <button type="button" class="btn btn--compact btn-icon" data-alph-next aria-label="Next alphabet">▶</button>
                    </div>
                    <span class="alphabet-tool__counter" data-alph-counter></span>
                </div>
                <p class="alphabet-tool__subtitle" data-alph-subtitle></p>
                <div class="alphabet-tool__content" data-alph-content tabindex="0"></div>
            </div>
        `;
    },

    bindShellListeners() {
        const prev = this.container.querySelector('[data-alph-prev]');
        const next = this.container.querySelector('[data-alph-next]');
        const content = this.container.querySelector('[data-alph-content]');

        prev?.addEventListener('click', () => this.navigate(-1));
        next?.addEventListener('click', () => this.navigate(1));

        this.onKeyDown = (e) => {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.navigate(-1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.navigate(1);
            }
        };
        content?.addEventListener('keydown', this.onKeyDown);
    },

    navigate(delta) {
        const total = ALPHABETS.length;
        this.index = (this.index + delta + total) % total;
        localStorage.setItem(STORAGE_KEY, String(this.index));
        this.renderContent();
    },

    renderContent() {
        const page = ALPHABETS[this.index];
        const titleEl = this.container.querySelector('[data-alph-title]');
        const counterEl = this.container.querySelector('[data-alph-counter]');
        const subtitleEl = this.container.querySelector('[data-alph-subtitle]');
        const contentEl = this.container.querySelector('[data-alph-content]');

        if (!page || !titleEl || !counterEl || !subtitleEl || !contentEl) return;

        titleEl.textContent = page.title;
        counterEl.textContent = `${this.index + 1} / ${ALPHABETS.length}`;
        subtitleEl.textContent = page.subtitle || '';
        contentEl.style.fontFamily = page.fontFamily || 'inherit';

        if (page.layout === 'kana') {
            contentEl.innerHTML = this.renderKana(page);
        } else {
            contentEl.innerHTML = this.renderGrid(page);
        }
    },

    renderCell(entry, scriptFont) {
        const glossHtml = entry.gloss
            ? `<span class="alphabet-cell__gloss">${entry.gloss}</span>`
            : '';
        return `
            <div class="alphabet-cell">
                <span class="alphabet-cell__char" style="font-family:${scriptFont}">${entry.char}</span>
                <span class="alphabet-cell__roman">${entry.roman}</span>
                ${glossHtml}
            </div>
        `;
    },

    renderGrid(page) {
        const scriptFont = page.fontFamily || 'inherit';
        const cells = (page.chars || []).map((entry) => this.renderCell(entry, scriptFont)).join('');
        const gridClass = page.id === 'chinese' ? 'alphabet-grid alphabet-grid--chinese' : 'alphabet-grid';
        return `<div class="${gridClass}">${cells}</div>`;
    },

    renderKana(page) {
        const scriptFont = page.fontFamily || 'inherit';
        const rows = (page.rows || []).map((row) => {
            const cells = row.chars.map((entry) => this.renderCell(entry, scriptFont)).join('');
            return `
                <div class="alphabet-kana-row">
                    <span class="alphabet-kana-row__label">${row.label}</span>
                    <div class="alphabet-kana-row__cells">${cells}</div>
                </div>
            `;
        }).join('');
        return `<div class="alphabet-kana">${rows}</div>`;
    },

    destroy() {
        const content = this.container?.querySelector('[data-alph-content]');
        if (content && this.onKeyDown) {
            content.removeEventListener('keydown', this.onKeyDown);
        }
        this.onKeyDown = null;
        this.container = null;
    },
};
