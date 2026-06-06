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

const THEME_PROPS = [
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

export function applyCardTheme(el, backgroundColor, { paintBackground = false } = {}) {
    if (!el) return;

    const rgb = parseCssColor(backgroundColor);
    if (!rgb) {
        el.classList.remove('has-custom-bg', 'card-theme-light', 'card-theme-dark');
        THEME_PROPS.forEach((prop) => el.style.removeProperty(prop));
        if (paintBackground) el.style.backgroundColor = '';
        return;
    }

    const lum = relativeLuminance(rgb);
    const light = lum > 0.55;
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };

    el.classList.add('has-custom-bg');
    el.classList.toggle('card-theme-light', light);
    el.classList.toggle('card-theme-dark', !light);

    el.style.setProperty('--card-fg', light ? '#121218' : '#ececf1');
    el.style.setProperty('--card-muted', light ? '#4b5563' : '#b0b0b8');
    el.style.setProperty('--card-action-bg', light ? 'rgba(255,255,255,0.9)' : 'rgba(12,12,16,0.82)');
    el.style.setProperty('--card-action-fg', light ? '#3f3f46' : '#d4d4d8');
    el.style.setProperty('--card-border-subtle', light ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.16)');
    el.style.setProperty('--card-focus-bg', light ? 'rgba(79,70,229,0.1)' : 'rgba(129,140,248,0.14)');
    el.style.setProperty('--card-focus-ring', light ? 'rgba(67,56,202,0.42)' : 'rgba(165,180,252,0.48)');
    el.style.setProperty('--card-link', light ? '#4338ca' : '#a5b4fc');
    el.style.setProperty('--card-placeholder', light ? '#6b7280' : '#9ca3af');
    el.style.setProperty('--card-input-bg', light ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.22)');
    el.style.setProperty('--card-toolbar-bg', toRgb(mixRgb(rgb, light ? black : black, light ? 0.06 : 0.22)));
    el.style.setProperty('--card-panel-bg', toRgb(mixRgb(rgb, light ? white : black, light ? 0.35 : 0.12)));

    if (paintBackground) el.style.backgroundColor = backgroundColor;
}
