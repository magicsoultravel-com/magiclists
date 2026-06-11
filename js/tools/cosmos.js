/** @tool {"label":"Cosmos","order":9,"wide":true,"resizable":true,"resizeMode":"fill","mountClass":"tool-mount--cosmos","defaultSize":{"w":720,"h":560},"minSize":{"w":400,"h":360}} */
/** @tool-icon <circle cx="6" cy="6" r="1.1" fill="currentColor" opacity="0.9"/><circle cx="9.2" cy="4.2" r="0.55" fill="none" stroke="currentColor" stroke-width="0.75"/><path d="M2.5 8.5c1.2-1.8 2.8-2.7 4.8-2.7M9.8 3.2l.4 1.1 1.1.2-.9.7.3 1.1-1-.7-1 .7.3-1.1-.9-.7 1.1-.2z" fill="none" stroke="currentColor" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round"/> */
import { COSMOS_VIEWS } from './cosmos-data.js';

const STORAGE_KEY = 'cosmos_view';

const SOLAR_BODIES = [
    { name: 'Mercury', color: '#b5b5b5', orbit: 0.39, size: 4 },
    { name: 'Venus', color: '#e8cda2', orbit: 0.72, size: 6 },
    { name: 'Earth', color: '#6b9bd1', orbit: 1.0, size: 6.5 },
    { name: 'Mars', color: '#c1440e', orbit: 1.52, size: 5 },
    { name: 'Jupiter', color: '#c9a066', orbit: 2.1, size: 14 },
    { name: 'Saturn', color: '#e4d3a5', orbit: 2.7, size: 12, ring: true },
    { name: 'Uranus', color: '#9ad5e5', orbit: 3.2, size: 9 },
    { name: 'Neptune', color: '#5b7fde', orbit: 3.6, size: 9 }
];

function solarSystemSvg() {
    const cx = 400;
    const cy = 280;
    const scale = 72;
    const orbits = SOLAR_BODIES.map((body) => {
        const r = body.orbit * scale;
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;
    }).join('');

    const planets = SOLAR_BODIES.map((body, i) => {
        const angle = (i / SOLAR_BODIES.length) * Math.PI * 1.6 - Math.PI * 0.3;
        const r = body.orbit * scale;
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        const ring = body.ring
            ? `<ellipse cx="${px}" cy="${py}" rx="${body.size + 5}" ry="${body.size * 0.35}" fill="none" stroke="rgba(228,211,165,0.55)" stroke-width="1"/>`
            : '';
        return `${ring}<circle cx="${px}" cy="${py}" r="${body.size}" fill="${body.color}" stroke="rgba(0,0,0,0.35)" stroke-width="0.5"/>
            <text x="${px}" y="${py + body.size + 11}" fill="rgba(255,255,255,0.72)" font-size="10" text-anchor="middle" font-family="inherit">${body.name}</text>`;
    }).join('');

    return `<svg class="cosmos-solar-svg" viewBox="0 0 800 560" xmlns="http://www.w3.org/2000/svg" aria-label="Solar system diagram">
        <rect width="800" height="560" fill="#050510"/>
        ${orbits}
        <circle cx="${cx}" cy="${cy}" r="22" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.5"/>
        <text x="${cx}" y="${cy + 38}" fill="rgba(255,255,255,0.85)" font-size="11" text-anchor="middle" font-family="inherit">Sun</text>
        ${planets}
        <text x="400" y="24" fill="rgba(255,255,255,0.45)" font-size="10" text-anchor="middle" font-family="inherit">Not to scale</text>
    </svg>`;
}

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

        if (view.type === 'diagram') {
            figure?.classList.remove('is-loading', 'is-error');
            stage.innerHTML = solarSystemSvg();
            return;
        }

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
