/** @tool {"label":"Cosmos","order":9,"wide":true,"resizable":true,"resizeMode":"fill","mountClass":"tool-mount--cosmos","defaultSize":{"w":720,"h":560},"minSize":{"w":400,"h":360}} */
/** @tool-icon <circle cx="6" cy="6" r="1.1" fill="currentColor" opacity="0.9"/><circle cx="9.2" cy="4.2" r="0.55" fill="none" stroke="currentColor" stroke-width="0.75"/><path d="M2.5 8.5c1.2-1.8 2.8-2.7 4.8-2.7M9.8 3.2l.4 1.1 1.1.2-.9.7.3 1.1-1-.7-1 .7.3-1.1-.9-.7 1.1-.2z" fill="none" stroke="currentColor" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round"/> */
import { COSMOS_VIEWS } from './cosmos-data.js';

const STORAGE_KEY = 'cosmos_view';

export const Cosmos = {
    container: null,
    activeViewId: null,
    onKeyDown: null,

    init(mountElement) {
        this.container = mountElement;
        const saved = localStorage.getItem(STORAGE_KEY);
        const valid = COSMOS_VIEWS.some((v) => v.id === saved);
        this.activeViewId = valid ? saved : COSMOS_VIEWS[0].id;
        this.renderShell();
        this.bindListeners();
        this.renderView(this.activeViewId);
    },

    renderShell() {
        const tabs = COSMOS_VIEWS.map((view) => `
            <button type="button" class="btn btn--compact cosmos-tab-btn${view.id === this.activeViewId ? ' active' : ''}" data-view="${view.id}">${view.label}</button>
        `).join('');

        this.container.innerHTML = `
            <div class="cosmos-tool">
                <div class="cosmos-tool__tabs map-tool__control-row">${tabs}</div>
                <figure class="cosmos-figure">
                    <div class="cosmos-figure__stage" data-cosmos-stage></div>
                    <figcaption class="cosmos-figure__caption tool-msg" data-cosmos-caption></figcaption>
                </figure>
            </div>
        `;
    },

    bindListeners() {
        this.container.querySelectorAll('.cosmos-tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-view');
                if (id) this.selectView(id);
            });
        });

        this.onKeyDown = (e) => {
            if (!this.container?.isConnected) return;
            const idx = COSMOS_VIEWS.findIndex((v) => v.id === this.activeViewId);
            if (e.key === 'ArrowRight' && idx < COSMOS_VIEWS.length - 1) {
                this.selectView(COSMOS_VIEWS[idx + 1].id);
            } else if (e.key === 'ArrowLeft' && idx > 0) {
                this.selectView(COSMOS_VIEWS[idx - 1].id);
            }
        };
        document.addEventListener('keydown', this.onKeyDown);
    },

    selectView(id) {
        if (id === this.activeViewId) return;
        this.activeViewId = id;
        localStorage.setItem(STORAGE_KEY, id);
        this.container.querySelectorAll('.cosmos-tab-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-view') === id);
        });
        this.renderView(id);
    },

    renderView(id) {
        const view = COSMOS_VIEWS.find((v) => v.id === id);
        const stage = this.container?.querySelector('[data-cosmos-stage]');
        const caption = this.container?.querySelector('[data-cosmos-caption]');
        const figure = this.container?.querySelector('.cosmos-figure');
        if (!view || !stage || !caption) return;

        caption.textContent = `${view.caption} · ${view.credit}`;

        figure?.classList.add('is-loading');
        figure?.classList.remove('is-error');
        stage.innerHTML = '';

        const img = document.createElement('img');
        img.alt = view.title;
        img.decoding = 'async';
        img.loading = 'lazy';

        const finish = () => figure?.classList.remove('is-loading');

        img.addEventListener('load', finish);
        img.addEventListener('error', () => {
            finish();
            figure?.classList.add('is-error');
            stage.innerHTML = `
                <div class="cosmos-figure__error">
                    <p class="tool-msg tool-msg--error">Could not load image.</p>
                    <button type="button" class="btn btn--compact cosmos-retry-btn">Retry</button>
                </div>
            `;
            stage.querySelector('.cosmos-retry-btn')?.addEventListener('click', () => this.renderView(id));
        });

        img.src = view.src;
        stage.appendChild(img);
    },

    onPanelResize() {},

    destroy() {
        if (this.onKeyDown) {
            document.removeEventListener('keydown', this.onKeyDown);
            this.onKeyDown = null;
        }
        this.container = null;
    }
};
