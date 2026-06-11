/** @tool {"label":"Cosmos","order":9,"wide":true,"resizable":true,"resizeMode":"fill","mountClass":"tool-mount--cosmos","defaultSize":{"w":720,"h":560},"minSize":{"w":400,"h":360}} */
/** @tool-icon <circle cx="6" cy="6" r="1.1" fill="currentColor" opacity="0.9"/><circle cx="9.2" cy="4.2" r="0.55" fill="none" stroke="currentColor" stroke-width="0.75"/><path d="M2.5 8.5c1.2-1.8 2.8-2.7 4.8-2.7M9.8 3.2l.4 1.1 1.1.2-.9.7.3 1.1-1-.7-1 .7.3-1.1-.9-.7 1.1-.2z" fill="none" stroke="currentColor" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round"/> */
import { COSMOS_VIEWS } from './cosmos-data.js';
import { createCosmosViewport } from './cosmos-viewport.js';
import { ACTION_ICONS } from '../ui.js';

const STORAGE_KEY = 'cosmos_view';

function appendSep(parent) {
    parent.appendChild(document.createTextNode(' · '));
}

function renderCaption(el, view) {
    el.textContent = '';
    el.appendChild(document.createTextNode(view.caption));
    appendSep(el);
    el.appendChild(document.createTextNode(view.credit));
    if (view.sourceUrl) {
        appendSep(el);
        const link = document.createElement('a');
        link.className = 'cosmos-source-link';
        link.href = view.sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = view.sourceLabel || 'Source';
        el.appendChild(link);
    }
    if (view.id === 'deep') {
        appendSep(el);
        el.appendChild(document.createTextNode('Distances illustrative · not to scale'));
    }
}

function zoomControlsHtml(prefix) {
    return `<span class="cosmos-tool__zoom display-options-stepper" aria-label="Zoom">
        <button type="button" class="btn btn--compact btn--icon display-options-stepper-btn" data-cosmos-zoom-out="${prefix}" title="Zoom out" aria-label="Zoom out">−</button>
        <span class="display-options-stepper-value" data-cosmos-zoom-label="${prefix}">100%</span>
        <button type="button" class="btn btn--compact btn--icon display-options-stepper-btn" data-cosmos-zoom-in="${prefix}" title="Zoom in" aria-label="Zoom in">+</button>
        <button type="button" class="btn btn--compact" data-cosmos-zoom-reset="${prefix}">Reset</button>
    </span>`;
}

export const Cosmos = {
    container: null,
    activeViewId: null,
    onKeyDown: null,
    panelViewport: null,
    lightbox: null,
    lightboxViewport: null,
    lightboxOnKeyDown: null,
    expandBtn: null,

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
                <div class="cosmos-tool__tabs map-tool__control-row">
                    ${tabs}
                    <span class="cosmos-tool__tabs-spacer" aria-hidden="true"></span>
                    <button type="button" class="btn btn--compact btn--icon cosmos-expand-btn" title="Expand" aria-label="Expand">${ACTION_ICONS.fullscreenEnter}</button>
                </div>
                <div class="cosmos-tool__hint tool-msg">Double-click image to expand · Scroll to zoom in overlay</div>
                <figure class="cosmos-figure">
                    <div class="cosmos-figure__stage" data-cosmos-stage></div>
                    <figcaption class="cosmos-figure__caption tool-msg" data-cosmos-caption></figcaption>
                </figure>
            </div>
        `;
        this.expandBtn = this.container.querySelector('.cosmos-expand-btn');
    },

    bindListeners() {
        this.container.querySelectorAll('.cosmos-tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-view');
                if (id) this.selectView(id);
            });
        });

        this.expandBtn?.addEventListener('click', () => {
            const view = COSMOS_VIEWS.find((v) => v.id === this.activeViewId);
            if (view) this.openLightbox(view);
        });

        this.onKeyDown = (e) => {
            if (!this.container?.isConnected) return;
            if (this.lightbox) return;
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
        this.closeLightbox();
        this.activeViewId = id;
        localStorage.setItem(STORAGE_KEY, id);
        this.container.querySelectorAll('.cosmos-tab-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-view') === id);
        });
        this.renderView(id);
    },

    getActiveView() {
        return COSMOS_VIEWS.find((v) => v.id === this.activeViewId);
    },

    renderView(id) {
        const view = COSMOS_VIEWS.find((v) => v.id === id);
        const stage = this.container?.querySelector('[data-cosmos-stage]');
        const caption = this.container?.querySelector('[data-cosmos-caption]');
        const figure = this.container?.querySelector('.cosmos-figure');
        if (!view || !stage || !caption) return;

        renderCaption(caption, view);

        this.panelViewport?.destroy();
        this.panelViewport = null;

        figure?.classList.add('is-loading');
        figure?.classList.remove('is-error');
        stage.innerHTML = '';

        this.panelViewport = createCosmosViewport({
            container: stage,
            view,
            interactive: false,
            onLoad: () => figure?.classList.remove('is-loading'),
            onError: () => {
                figure?.classList.remove('is-loading');
                figure?.classList.add('is-error');
                stage.innerHTML = `
                    <div class="cosmos-figure__error">
                        <p class="tool-msg tool-msg--error">Could not load image.</p>
                        <button type="button" class="btn btn--compact cosmos-retry-btn">Retry</button>
                    </div>
                `;
                stage.querySelector('.cosmos-retry-btn')?.addEventListener('click', () => this.renderView(id));
            }
        });

        const openExpand = () => this.openLightbox(view);
        this.panelViewport.viewport.addEventListener('dblclick', openExpand);
        this.panelViewport._onDblClick = openExpand;
    },

    openLightbox(view) {
        if (this.lightbox) this.closeLightbox();

        const overlay = document.createElement('div');
        overlay.className = 'overlay cosmos-lightbox is-open';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', view.title);
        overlay.innerHTML = `
            <div class="cosmos-lightbox__panel">
                <div class="cosmos-lightbox__header map-tool__control-row">
                    <span class="cosmos-lightbox__title"></span>
                    ${zoomControlsHtml('lb')}
                    <button type="button" class="btn btn--compact btn--icon cosmos-lightbox__close" title="Close" aria-label="Close">×</button>
                </div>
                <p class="cosmos-lightbox__hint tool-msg">Scroll to zoom · Drag to pan</p>
                <div class="cosmos-lightbox__stage" data-cosmos-lightbox-stage></div>
                <p class="cosmos-lightbox__caption tool-msg" data-cosmos-lightbox-caption></p>
            </div>
        `;

        document.body.appendChild(overlay);
        this.lightbox = overlay;

        const titleEl = overlay.querySelector('.cosmos-lightbox__title');
        if (titleEl) titleEl.textContent = view.title;

        const captionEl = overlay.querySelector('[data-cosmos-lightbox-caption]');
        renderCaption(captionEl, view);

        const stage = overlay.querySelector('[data-cosmos-lightbox-stage]');
        stage.classList.add('is-loading');

        this.lightboxViewport = createCosmosViewport({
            container: stage,
            view,
            interactive: true,
            onLoad: () => {
                stage.classList.remove('is-loading');
                const label = overlay.querySelector('[data-cosmos-zoom-label="lb"]');
                if (label) label.textContent = `${Math.round(this.lightboxViewport.getScale() * 100)}%`;
            },
            onError: () => {
                stage.classList.remove('is-loading');
                stage.innerHTML = '<p class="tool-msg tool-msg--error">Could not load image.</p>';
            },
            onScaleChange: (scale) => {
                const label = overlay.querySelector('[data-cosmos-zoom-label="lb"]');
                if (label) label.textContent = `${Math.round(scale * 100)}%`;
            }
        });

        overlay.querySelector('[data-cosmos-zoom-in="lb"]')?.addEventListener('click', () => this.lightboxViewport?.zoomIn());
        overlay.querySelector('[data-cosmos-zoom-out="lb"]')?.addEventListener('click', () => this.lightboxViewport?.zoomOut());
        overlay.querySelector('[data-cosmos-zoom-reset="lb"]')?.addEventListener('click', () => this.lightboxViewport?.reset());

        overlay.querySelector('.cosmos-lightbox__close')?.addEventListener('click', () => this.closeLightbox());

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeLightbox();
        });

        this.lightboxOnKeyDown = (e) => {
            if (e.key === 'Escape') this.closeLightbox();
        };
        document.addEventListener('keydown', this.lightboxOnKeyDown);

        overlay.querySelector('.cosmos-lightbox__close')?.focus();
    },

    closeLightbox() {
        if (this.lightboxOnKeyDown) {
            document.removeEventListener('keydown', this.lightboxOnKeyDown);
            this.lightboxOnKeyDown = null;
        }
        this.lightboxViewport?.destroy();
        this.lightboxViewport = null;
        this.lightbox?.remove();
        this.lightbox = null;
        this.expandBtn?.focus();
    },

    onPanelResize() {
        this.panelViewport?.fitToContainer();
    },

    destroy() {
        this.closeLightbox();
        if (this.panelViewport) {
            if (this.panelViewport._onDblClick) {
                this.panelViewport.viewport?.removeEventListener('dblclick', this.panelViewport._onDblClick);
            }
            this.panelViewport.destroy();
            this.panelViewport = null;
        }
        if (this.onKeyDown) {
            document.removeEventListener('keydown', this.onKeyDown);
            this.onKeyDown = null;
        }
        this.container = null;
    }
};
