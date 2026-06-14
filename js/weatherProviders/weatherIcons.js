/**
 * Map IMGW HYBRID icon codes (e.g. n0z00d, n5z80d) to forecast condition keys.
 * Pattern: [optional n/d][precip 0-9]z[cloud 00-99][d/n]
 */
export function conditionFromIcon(icon) {
    if (!icon) return 'unknown';
    const s = String(icon).toLowerCase();

    const imgw = s.match(/^[nd]?(\d)z(\d{2})/);
    if (imgw) {
        const precip = parseInt(imgw[1], 10);
        const cloud = parseInt(imgw[2], 10);
        if (precip >= 7 || cloud >= 95) return 'storm';
        if (precip >= 1) return 'rain';
        if (cloud >= 75) return 'cloudy';
        if (cloud >= 35) return 'partly-cloudy';
        if (cloud >= 10) return 'fog';
        return 'clear';
    }

    if (/sn|snow/.test(s)) return 'snow';
    if (/storm|thunder|9[0-9]/.test(s)) return 'storm';
    if (/rain|drizzle|r\d|d\d/.test(s)) return 'rain';
    if (/z00|00d|00n/.test(s)) return 'clear';
    if (/z[34]|40|50/.test(s)) return 'partly-cloudy';
    if (/z[678]|80|70/.test(s)) return 'cloudy';
    if (/fog|mist|z10/.test(s)) return 'fog';
    return 'cloudy';
}

export function conditionFromMetrics({ cloud, precip, rain, snow } = {}) {
    if (snow != null && snow > 0) return 'snow';
    if ((rain != null && rain > 0) || (precip != null && precip > 0)) return 'rain';
    if (cloud != null && cloud >= 80) return 'cloudy';
    if (cloud != null && cloud >= 40) return 'partly-cloudy';
    if (cloud != null && cloud >= 15) return 'fog';
    return 'clear';
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
        clear: `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6"/></g></svg>`,
        'partly-cloudy': `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><circle cx="8.5" cy="9" r="3.2" fill="currentColor"/><path d="M5 17.5a4.5 4.5 0 0 1 8.7-1.4A3.8 3.8 0 0 1 19.5 19.5H7A3.5 3.5 0 0 1 5 17.5z" fill="currentColor" opacity="0.82"/></svg>`,
        cloudy: `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path d="M5 17.5a4.5 4.5 0 0 1 8.7-1.4A3.8 3.8 0 0 1 19.5 19.5H7A3.5 3.5 0 0 1 5 17.5z" fill="currentColor" opacity="0.9"/></svg>`,
        rain: `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path d="M5 15.5a4.5 4.5 0 0 1 8.7-1.4A3.8 3.8 0 0 1 19.5 17.5H7A3.5 3.5 0 0 1 5 15.5z" fill="currentColor" opacity="0.82"/><path d="M8 19.5v2.5M12 18.5v2.5M16 19.5v2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
        snow: `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path d="M5 15a4.5 4.5 0 0 1 8.7-1.4A3.8 3.8 0 0 1 19.5 17H7A3.5 3.5 0 0 1 5 15z" fill="currentColor" opacity="0.82"/><circle cx="8.5" cy="20" r="1" fill="currentColor"/><circle cx="12" cy="19.2" r="1" fill="currentColor"/><circle cx="15.5" cy="20" r="1" fill="currentColor"/></svg>`,
        storm: `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path d="M5 14a4.5 4.5 0 0 1 8.7-1.4A3.8 3.8 0 0 1 19.5 16H7A3.5 3.5 0 0 1 5 14z" fill="currentColor" opacity="0.82"/><path d="M11.5 16.5 10 20h2.2l-1.2 3 3.5-4.8H12.2l-0.7-2.7z" fill="currentColor"/></svg>`,
        fog: `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path d="M3 13h18M4.5 16.5h15M6 20h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.85"/></svg>`,
        unknown: `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path d="M5 17a4.5 4.5 0 0 1 8.7-1.4A3.8 3.8 0 0 1 19.5 19H7A3.5 3.5 0 0 1 5 17z" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.55"/></svg>`
    };
    return icons[condition] || icons.unknown;
}

export function weatherIconSvgFromCode(iconCode, metrics, { size = 16 } = {}) {
    const condition = iconCode
        ? conditionFromIcon(iconCode)
        : conditionFromMetrics(metrics);
    return weatherIconSvg(condition, { size });
}

export function resolveCondition(iconCode, metrics) {
    if (iconCode) return conditionFromIcon(iconCode);
    return conditionFromMetrics(metrics);
}
