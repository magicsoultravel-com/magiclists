/** @tool {"label":"Alphabets","order":7,"resizable":true,"resizeMode":"fill","mountClass":"tool-mount--alphabets","defaultSize":{"w":380,"h":480},"minSize":{"w":300,"h":360}} */
/** @tool-icon <path d="M2.5 3.2h2.1c.9 0 1.5.5 1.5 1.2 0 .5-.3.9-.8 1.1.6.2 1 .7 1 1.3V9H4.8V6.9c0-.4-.2-.6-.6-.6H3.8V9H2.5V3.2zm5.2 0h1.3V9H7.7V3.2zm3.1 0c1.1 0 1.9.8 1.9 2.5V9h-1.3V5.9c0-.8-.4-1.2-1-1.2-.6 0-1 .4-1 1.2V9H8.1V3.2h1.3v.5z" fill="currentColor"/> */
import { ALPHABETS } from './alphabets-data.js';

const STORAGE_KEY = 'alphabets_index';

export const Alphabets = {
    container: null,
    index: 0,
    onKeyDown: null,
    onDocumentPointerDown: null,
    menuOpen: false,

    init(mountElement) {
        this.container = mountElement;
        const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
        if (!Number.isNaN(saved) && saved >= 0) {
            this.index = Math.min(saved, ALPHABETS.length - 1);
        }
        this.renderShell();
        this.bindShellListeners();
        this.renderContent();
    },

    renderShell() {
        this.container.innerHTML = `
            <div class="tool-stack alphabet-tool">
                <div class="toolbar toolbar--spread alphabet-tool__toolbar">
                    <div class="alphabet-tool__nav">
                        <div class="alphabet-tool__nav-start">
                            <button type="button" class="btn btn--compact btn-icon alphabet-tool__menu-btn" data-alph-menu aria-label="Alphabet list" aria-expanded="false" aria-haspopup="true">☰</button>
                            <div class="alphabet-tool__menu is-hidden" data-alph-menu-panel role="menu">
                                <div class="toolbox-list" data-alph-menu-list></div>
                            </div>
                        </div>
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
        this.renderMenuList();
    },

    getMenuGlyph(page) {
        if (page.layout === 'case') {
            return `${page.chars[0].charUpper}${page.chars[0].charLower}`;
        }
        if (page.layout === 'arabic') {
            return page.letters[0].isolated;
        }
        if (page.layout === 'kana') {
            return page.rows[0].chars[0].char;
        }
        if (page.layout === 'sections') {
            return page.sections[0].chars[0].char;
        }
        if (page.id === 'morse') {
            return '·−';
        }
        if (page.id === 'braille') {
            return '⠁';
        }
        if (page.chars?.length) {
            return page.chars[0].char;
        }
        return 'Aa';
    },

    renderMenuList() {
        const listEl = this.container?.querySelector('[data-alph-menu-list]');
        if (!listEl) return;

        listEl.innerHTML = ALPHABETS.map((page, idx) => {
            const activeClass = idx === this.index ? ' is-on-desktop' : '';
            const glyph = this.getMenuGlyph(page);
            const fontStyle = page.fontFamily ? ` style="font-family:${page.fontFamily}"` : '';
            return `<button type="button" class="btn btn--compact menu-tool-trigger${activeClass}" data-alph-jump="${idx}" role="menuitem">
                <span class="menu-tool-icon alphabet-tool__menu-glyph"${fontStyle}>${glyph}</span>
                <span class="menu-tool-label">${page.title}</span>
            </button>`;
        }).join('');
    },

    bindShellListeners() {
        const prev = this.container.querySelector('[data-alph-prev]');
        const next = this.container.querySelector('[data-alph-next]');
        const menuBtn = this.container.querySelector('[data-alph-menu]');
        const menuPanel = this.container.querySelector('[data-alph-menu-panel]');
        const menuList = this.container.querySelector('[data-alph-menu-list]');
        const content = this.container.querySelector('[data-alph-content]');

        prev?.addEventListener('click', () => this.navigate(-1));
        next?.addEventListener('click', () => this.navigate(1));
        menuBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMenu();
        });
        menuList?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-alph-jump]');
            if (!btn) return;
            const idx = parseInt(btn.getAttribute('data-alph-jump'), 10);
            if (!Number.isNaN(idx)) {
                this.goTo(idx);
                this.closeMenu();
            }
        });

        this.onDocumentPointerDown = (e) => {
            if (!this.menuOpen || !menuPanel || !menuBtn) return;
            if (menuPanel.contains(e.target) || menuBtn.contains(e.target)) return;
            this.closeMenu();
        };
        document.addEventListener('pointerdown', this.onDocumentPointerDown);

        this.onKeyDown = (e) => {
            if (e.key === 'Escape' && this.menuOpen) {
                e.preventDefault();
                this.closeMenu();
                return;
            }
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

    toggleMenu() {
        if (this.menuOpen) {
            this.closeMenu();
        } else {
            this.openMenu();
        }
    },

    openMenu() {
        const menuBtn = this.container?.querySelector('[data-alph-menu]');
        const menuPanel = this.container?.querySelector('[data-alph-menu-panel]');
        if (!menuBtn || !menuPanel) return;
        this.menuOpen = true;
        menuPanel.classList.remove('is-hidden');
        menuBtn.setAttribute('aria-expanded', 'true');
        this.updateMenuActiveState();
    },

    closeMenu() {
        const menuBtn = this.container?.querySelector('[data-alph-menu]');
        const menuPanel = this.container?.querySelector('[data-alph-menu-panel]');
        if (!menuBtn || !menuPanel) return;
        this.menuOpen = false;
        menuPanel.classList.add('is-hidden');
        menuBtn.setAttribute('aria-expanded', 'false');
    },

    updateMenuActiveState() {
        this.container?.querySelectorAll('[data-alph-jump]').forEach((btn) => {
            const idx = parseInt(btn.getAttribute('data-alph-jump'), 10);
            btn.classList.toggle('is-on-desktop', idx === this.index);
        });
    },

    goTo(index) {
        if (index < 0 || index >= ALPHABETS.length || index === this.index) return;
        this.index = index;
        localStorage.setItem(STORAGE_KEY, String(this.index));
        this.renderContent();
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
        } else if (page.layout === 'sections') {
            contentEl.innerHTML = this.renderSections(page);
        } else if (page.layout === 'case') {
            contentEl.innerHTML = this.renderCaseGrid(page);
        } else if (page.layout === 'arabic') {
            contentEl.innerHTML = this.renderArabic(page);
        } else if (page.layout === 'hebrew') {
            contentEl.innerHTML = this.renderHebrewGrid(page);
        } else {
            contentEl.innerHTML = this.renderGrid(page);
        }

        this.updateMenuActiveState();
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

    renderCaseCell(entry, scriptFont) {
        return `
            <div class="alphabet-cell alphabet-cell--case">
                <span class="alphabet-cell__case-pair" style="font-family:${scriptFont}">
                    <span class="alphabet-cell__char">${entry.charUpper}</span>
                    <span class="alphabet-cell__char alphabet-cell__char--lower">${entry.charLower}</span>
                </span>
                <span class="alphabet-cell__roman">${entry.roman}</span>
            </div>
        `;
    },

    renderCaseGrid(page) {
        const scriptFont = page.fontFamily || 'inherit';
        const cells = (page.chars || []).map((entry) => this.renderCaseCell(entry, scriptFont)).join('');
        return `<div class="alphabet-grid">${cells}</div>`;
    },

    renderHebrewCell(entry, scriptFont) {
        const formsHtml = entry.charFinal
            ? `<span class="alphabet-cell__hebrew-forms" style="font-family:${scriptFont}">
                    <span class="alphabet-cell__char">${entry.char}</span>
                    <span class="alphabet-cell__form-sep">·</span>
                    <span class="alphabet-cell__char alphabet-cell__char--final">${entry.charFinal}</span>
               </span>
               <span class="alphabet-cell__gloss">final</span>`
            : `<span class="alphabet-cell__char" style="font-family:${scriptFont}">${entry.char}</span>`;
        return `
            <div class="alphabet-cell alphabet-cell--hebrew">
                ${formsHtml}
                <span class="alphabet-cell__roman">${entry.roman}</span>
            </div>
        `;
    },

    renderHebrewGrid(page) {
        const scriptFont = page.fontFamily || 'inherit';
        const cells = (page.chars || []).map((entry) => this.renderHebrewCell(entry, scriptFont)).join('');
        return `<div class="alphabet-grid alphabet-grid--hebrew">${cells}</div>`;
    },

    renderArabicForm(form, scriptFont) {
        if (!form) {
            return '<span class="alphabet-arabic__form alphabet-arabic__form--empty">—</span>';
        }
        return `<span class="alphabet-arabic__form" style="font-family:${scriptFont}">${form}</span>`;
    },

    renderArabic(page) {
        const scriptFont = page.fontFamily || 'inherit';
        const rows = (page.letters || []).map((letter) => `
            <div class="alphabet-arabic__row">
                <span class="alphabet-arabic__roman">${letter.roman}</span>
                ${this.renderArabicForm(letter.isolated, scriptFont)}
                ${this.renderArabicForm(letter.initial, scriptFont)}
                ${this.renderArabicForm(letter.medial, scriptFont)}
                ${this.renderArabicForm(letter.final, scriptFont)}
            </div>
        `).join('');
        return `
            <div class="alphabet-arabic">
                <div class="alphabet-arabic__header">
                    <span class="alphabet-arabic__roman">name</span>
                    <span>isolated</span>
                    <span>initial</span>
                    <span>medial</span>
                    <span>final</span>
                </div>
                ${rows}
            </div>
        `;
    },

    getGridClass(page) {
        const variant = page.gridClass || (page.id === 'chinese' ? 'chinese' : '');
        return variant ? `alphabet-grid alphabet-grid--${variant}` : 'alphabet-grid';
    },

    renderGrid(page) {
        const scriptFont = page.fontFamily || 'inherit';
        const cells = (page.chars || []).map((entry) => this.renderCell(entry, scriptFont)).join('');
        return `<div class="${this.getGridClass(page)}">${cells}</div>`;
    },

    renderSections(page) {
        const scriptFont = page.fontFamily || 'inherit';
        const blocks = (page.sections || []).map((section) => {
            const cells = section.chars.map((entry) => this.renderCell(entry, scriptFont)).join('');
            return `
                <h4 class="alphabet-section__title">${section.title}</h4>
                <div class="${this.getGridClass(page)}">${cells}</div>
            `;
        }).join('');
        return `<div class="alphabet-sections">${blocks}</div>`;
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
        this.closeMenu();
        const content = this.container?.querySelector('[data-alph-content]');
        if (content && this.onKeyDown) {
            content.removeEventListener('keydown', this.onKeyDown);
        }
        if (this.onDocumentPointerDown) {
            document.removeEventListener('pointerdown', this.onDocumentPointerDown);
        }
        this.onKeyDown = null;
        this.onDocumentPointerDown = null;
        this.container = null;
    },
};
