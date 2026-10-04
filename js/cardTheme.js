function parseCssColor(input) {
    if (!input || typeof input !== 'string') return null;
    const s = input.trim();
    if (s.startsWith('#')) {
        let hex = s.slice(1);
        if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
        if (hex.length !== 6) return null;
        const n = Number.parseInt(hex, 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
    return null;
}

function toRgb({ r, g, b }) {
    return `rgb(${r}, ${g}, ${b})`;
}

function mixRgb(a, b, amount) {
    return {
        r: Math.round(a.r + (b.r - a.r) * amount),
        g: Math.round(a.g + (b.g - a.g) * amount),
        b: Math.round(a.b + (b.b - a.b) * amount)
    };
}

function relativeLuminance({ r, g, b }) {
    const linear = [r, g, b].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export const THEME_PROPS = [
    '--card-fg',
    '--card-muted',
    '--card-action-bg',
    '--card-action-fg',
    '--card-border-subtle',
    '--card-focus-bg',
    '--card-focus-ring',
    '--card-link',
    '--card-placeholder',
    '--card-input-bg',
    '--card-toolbar-bg',
    '--card-panel-bg'
];

function isThemeSkinLocked() {
    return typeof document !== 'undefined'
        && document.documentElement?.dataset?.themeSkin === '1';
}

/**
 * Inline solid fill + contrast tokens for surfaces outside note shells (e.g. kanban cards).
 * @param {string} hex
 * @returns {{ style: string, className: string }}
 */
export function surfaceThemeInline(hex) {
    const color = String(hex || '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { style: '', className: '' };
    const parts = [
        `--kanban-card-color:${color}`,
        `background:${color}`,
        `border-color:${color}`
    ];
    if (isThemeSkinLocked()) {
        return {
            style: ` style="${parts.join(';')}"`,
            className: ' has-custom-bg'
        };
    }
    const tokens = contrastTokensForBackground(color);
    if (tokens?.props) {
        for (const [prop, value] of Object.entries(tokens.props)) {
            parts.push(`${prop}:${value}`);
        }
    }
    const themeClass = tokens
        ? ` has-custom-bg ${tokens.light ? 'card-theme-light' : 'card-theme-dark'}`
        : ' has-custom-bg';
    return {
        style: ` style="${parts.join(';')}"`,
        className: themeClass
    };
}

/* The .has-custom-bg class lives on the .editor-note-shell, but several CSS
   selectors (e.g. .mini-card:not(.has-custom-bg)) key off the .mini-card
   ancestor. Keep those classes in sync on the nearest .mini-card so the
   :not() rules correctly exclude custom-background cards. */
function syncCardAncestorClasses(el, { hasCustomBg, light }) {
    const card = el.closest('.mini-card');
    if (!card) return;
    card.classList.toggle('has-custom-bg', hasCustomBg);
    card.classList.toggle('card-theme-light', hasCustomBg && light);
    card.classList.toggle('card-theme-dark', hasCustomBg && !light);
}

/**
 * Luminance contrast tokens for a solid background (same values applyCardTheme paints).
 * @param {string} backgroundColor
 * @returns {null|{ light: boolean, props: Record<string, string> }}
 */
export function contrastTokensForBackground(backgroundColor) {
    const rgb = parseCssColor(backgroundColor);
    if (!rgb) return null;
    const light = relativeLuminance(rgb) > 0.55;
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    return {
        light,
        props: {
            '--card-fg': light ? '#121218' : '#ececf1',
            '--card-muted': light ? '#4b5563' : '#b0b0b8',
            '--card-action-bg': light ? 'rgba(255,255,255,0.9)' : 'rgba(12,12,16,0.82)',
            '--card-action-fg': light ? '#3f3f46' : '#d4d4d8',
            '--card-border-subtle': light ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.16)',
            '--card-focus-bg': light ? 'rgba(79,70,229,0.1)' : 'rgba(129,140,248,0.14)',
            '--card-focus-ring': light ? 'rgba(67,56,202,0.42)' : 'rgba(165,180,252,0.48)',
            '--card-link': light ? '#4338ca' : '#a5b4fc',
            '--card-placeholder': light ? '#6b7280' : '#9ca3af',
            '--card-input-bg': light ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.22)',
            '--card-toolbar-bg': toRgb(mixRgb(rgb, black, light ? 0.06 : 0.22)),
            '--card-panel-bg': toRgb(mixRgb(rgb, light ? white : black, light ? 0.35 : 0.12))
        }
    };
}

/** Strip luminance contrast overrides so fancy-skin --card-fg inherits from html. */
export function clearCardThemeContrast(el) {
    if (!el) return;
    THEME_PROPS.forEach((prop) => el.style.removeProperty(prop));
    el.classList.remove('card-theme-light', 'card-theme-dark');
    const card = el.closest('.mini-card');
    if (card) card.classList.remove('card-theme-light', 'card-theme-dark');
}

export function applyCardTheme(el, backgroundColor, { paintBackground = false } = {}) {
    if (!el) return;

    const skinLocked = isThemeSkinLocked();
    const tokens = contrastTokensForBackground(backgroundColor);

    if (!tokens) {
        el.classList.remove('has-custom-bg', 'card-theme-light', 'card-theme-dark');
        THEME_PROPS.forEach((prop) => el.style.removeProperty(prop));
        if (paintBackground) el.style.backgroundColor = '';
        syncCardAncestorClasses(el, { hasCustomBg: false, light: false });
        return;
    }

    /* Fancy skins lock note fill + text; do not apply per-note luminance contrast. */
    if (skinLocked) {
        clearCardThemeContrast(el);
        el.classList.add('has-custom-bg');
        syncCardAncestorClasses(el, { hasCustomBg: true, light: false });
        if (paintBackground) el.style.backgroundColor = backgroundColor;
        return;
    }

    const { light, props } = tokens;
    el.classList.add('has-custom-bg');
    el.classList.toggle('card-theme-light', light);
    el.classList.toggle('card-theme-dark', !light);
    syncCardAncestorClasses(el, { hasCustomBg: true, light });

    for (const [prop, value] of Object.entries(props)) {
        el.style.setProperty(prop, value);
    }

    if (paintBackground) el.style.backgroundColor = backgroundColor;
}
