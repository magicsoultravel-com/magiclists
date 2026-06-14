/** Map IMGW icon codes (e.g. n5z80d) to compact condition keys for CSS/SVG. */
export function conditionFromIcon(icon) {
    if (!icon) return 'unknown';
    const s = String(icon).toLowerCase();
    if (/sn|s\d/.test(s)) return 'snow';
    if (/r\d|drizzle|rain/.test(s) || /0[5-9]|1[0-5]/.test(s)) return 'rain';
    if (/9[0-9]|storm|thunder/.test(s)) return 'storm';
    if (/z00|00d|00n/.test(s)) return 'clear';
    if (/z[34]|40|50/.test(s)) return 'partly-cloudy';
    if (/z[678]|80|70/.test(s)) return 'cloudy';
    if (/fog|mist|z10/.test(s)) return 'fog';
    return 'cloudy';
}

export function conditionLabel(condition) {
    const labels = {
        clear: 'Clear',
        'partly-cloudy': 'Partly cloudy',
        cloudy: 'Cloudy',
        rain: 'Rain',
        snow: 'Snow',
        storm: 'Storm',
        fog: 'Fog',
        unknown: '—'
    };
    return labels[condition] || labels.unknown;
}

export function weatherIconSvg(condition, { size = 16 } = {}) {
    const s = size;
    const icons = {
        clear: `<svg viewBox="0 0 16 16" width="${s}" height="${s}" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="currentColor" opacity="0.95"/></svg>`,
        'partly-cloudy': `<svg viewBox="0 0 16 16" width="${s}" height="${s}" aria-hidden="true"><circle cx="5.5" cy="5.5" r="2.2" fill="currentColor" opacity="0.85"/><path d="M3 11.5a3.5 3.5 0 0 1 6.8-1.1A3 3 0 0 1 13 13.5H4.5A2.5 2.5 0 0 1 3 11.5z" fill="currentColor" opacity="0.75"/></svg>`,
        cloudy: `<svg viewBox="0 0 16 16" width="${s}" height="${s}" aria-hidden="true"><path d="M2.5 11.5a3.5 3.5 0 0 1 6.8-1.1A3 3 0 0 1 12.5 13.5H4A2.5 2.5 0 0 1 2.5 11.5z" fill="currentColor" opacity="0.85"/></svg>`,
        rain: `<svg viewBox="0 0 16 16" width="${s}" height="${s}" aria-hidden="true"><path d="M2.5 9.5a3.5 3.5 0 0 1 6.8-1.1A3 3 0 0 1 12.5 11.5H4A2.5 2.5 0 0 1 2.5 9.5z" fill="currentColor" opacity="0.75"/><path d="M5 12.5v2M8 12v2M11 12.5v2" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/></svg>`,
        snow: `<svg viewBox="0 0 16 16" width="${s}" height="${s}" aria-hidden="true"><path d="M2.5 9a3.5 3.5 0 0 1 6.8-1.1A3 3 0 0 1 12.5 11H4A2.5 2.5 0 0 1 2.5 9z" fill="currentColor" opacity="0.75"/><circle cx="5.5" cy="13" r="0.55" fill="currentColor"/><circle cx="8" cy="12.5" r="0.55" fill="currentColor"/><circle cx="10.5" cy="13" r="0.55" fill="currentColor"/></svg>`,
        storm: `<svg viewBox="0 0 16 16" width="${s}" height="${s}" aria-hidden="true"><path d="M2.5 8.5a3.5 3.5 0 0 1 6.8-1.1A3 3 0 0 1 12.5 10.5H4A2.5 2.5 0 0 1 2.5 8.5z" fill="currentColor" opacity="0.75"/><path d="M7.5 10.5 6.5 13h1.5L7 15l2.5-3.5H8.5l-1-1.5z" fill="currentColor"/></svg>`,
        fog: `<svg viewBox="0 0 16 16" width="${s}" height="${s}" aria-hidden="true"><path d="M2 9h12M3 11.5h10M4 14h8" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" opacity="0.8"/></svg>`,
        unknown: `<svg viewBox="0 0 16 16" width="${s}" height="${s}" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="0.9" opacity="0.6"/></svg>`
    };
    return icons[condition] || icons.unknown;
}
