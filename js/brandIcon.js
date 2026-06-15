export const DEFAULT_BRAND_ICON_ID = 'clipboard';

export const BRAND_ICONS = [
    {
        id: 'clipboard',
        label: 'Clipboard',
        svg: './assets/brand/icon-clipboard.svg',
        ico: './assets/brand/favicon-clipboard.ico',
        appleTouch: './assets/brand/apple-touch-clipboard.png'
    },
    {
        id: 'easel',
        label: 'Easel',
        svg: './assets/brand/icon-easel.svg',
        ico: './assets/brand/favicon-easel.ico',
        appleTouch: './assets/brand/apple-touch-easel.png'
    },
    {
        id: 'block',
        label: 'Wood block',
        svg: './assets/brand/icon-block.svg',
        ico: './assets/brand/favicon-block.ico',
        appleTouch: './assets/brand/apple-touch-block.png'
    },
    {
        id: 'tile',
        label: 'Neon tile',
        svg: './assets/brand/icon-tile.svg',
        ico: './assets/brand/favicon-tile.ico',
        appleTouch: './assets/brand/apple-touch-tile.png'
    }
];

const BRAND_ICON_BY_ID = Object.fromEntries(BRAND_ICONS.map((icon) => [icon.id, icon]));

export function isBrandIconId(id) {
    return Boolean(BRAND_ICON_BY_ID[id]);
}

export function resolveBrandIconId(id) {
    return isBrandIconId(id) ? id : DEFAULT_BRAND_ICON_ID;
}

export function getBrandIcon(id = DEFAULT_BRAND_ICON_ID) {
    return BRAND_ICON_BY_ID[resolveBrandIconId(id)];
}

export function isBrandIconCustomized(id) {
    return resolveBrandIconId(id) !== DEFAULT_BRAND_ICON_ID;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function buildBrandIconOptionsHtml(selectedId = DEFAULT_BRAND_ICON_ID) {
    const activeId = resolveBrandIconId(selectedId);
    return BRAND_ICONS.map((icon) => {
        const selected = icon.id === activeId ? ' is-selected' : '';
        return `<button type="button" class="brand-icon-option${selected}" data-brand-icon="${icon.id}" title="${escapeHtml(icon.label)}" aria-label="${escapeHtml(icon.label)}" aria-pressed="${selected ? 'true' : 'false'}">
            <img class="brand-icon-preview" src="${icon.svg}" alt="" width="32" height="32" decoding="async">
            <span class="brand-icon-option-label">${escapeHtml(icon.label)}</span>
        </button>`;
    }).join('');
}

export function applyBrandIcon(id = DEFAULT_BRAND_ICON_ID) {
    const icon = getBrandIcon(id);
    const root = document.documentElement;
    root.dataset.brandIcon = icon.id;

    document.querySelectorAll('#nav-panel-toggle .app-brand__icon, #nav-panel-toggle-fab .app-brand__icon')
        .forEach((el) => el.setAttribute('src', icon.svg));
    document.getElementById('favicon-ico')?.setAttribute('href', icon.ico);
    document.getElementById('favicon-svg')?.setAttribute('href', icon.svg);
    document.getElementById('apple-touch-icon')?.setAttribute('href', icon.appleTouch);
}
