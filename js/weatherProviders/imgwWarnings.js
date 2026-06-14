const WARNINGS_URL = 'https://danepubliczne.imgw.pl/api/data/warningsmeteo';
const OSMET_URL = 'https://meteo.imgw.pl/api/meteo/messages/v1/osmet/latest/osmet-teryt';

/** Default TERYT for Warsaw area (m.st. Warszawa). */
export const DEFAULT_TERYT = '146501';

export const ImgwWarningsProvider = {
    id: 'imgw-warnings',
    label: 'IMGW warnings',
    kind: 'alert',
    defaultEnabled: true,
    ttlMs: 10 * 60 * 1000,

    async fetch(ctx) {
        const { signal, teryt } = ctx;
        const [official, enhanced] = await Promise.all([
            fetchJson(WARNINGS_URL, signal),
            fetchJson(OSMET_URL, signal).catch(() => null)
        ]);
        return { official, enhanced, teryt: teryt || DEFAULT_TERYT };
    },

    normalize(raw) {
        const teryt = String(raw?.teryt || DEFAULT_TERYT);
        const terytPrefix = teryt.slice(0, 4);
        const alerts = [];

        const pushAlert = (item, source) => {
            if (!item) return;
            const level = num(item.level) ?? num(item.stopien) ?? 1;
            const codes = normalizeTerytList(item.teryt || item.terytCodes || item.areas);
            const applies = !codes.length || codes.some((c) => {
                const code = String(c);
                return teryt.startsWith(code) || code.startsWith(terytPrefix);
            });
            alerts.push({
                id: String(item.ID || item.id || `${source}-${item.name || item.title}-${item.startdate || item.validFrom}`),
                level,
                name: item.name || item.title || item.phenomenon || 'Warning',
                text: item.content || item.description || item.text || '',
                validFrom: item.startdate || item.validFrom || item.start || null,
                validTo: item.enddate || item.validTo || item.end || null,
                teryt: codes,
                applies,
                source
            });
        };

        const official = raw?.official;
        if (Array.isArray(official)) {
            official.forEach((item) => pushAlert(item, 'IMGW'));
        } else if (official && typeof official === 'object') {
            Object.values(official).flat().forEach((item) => pushAlert(item, 'IMGW'));
        }

        const enhanced = raw?.enhanced;
        if (Array.isArray(enhanced)) {
            enhanced.forEach((item) => pushAlert(item, 'OSMET'));
        } else if (enhanced?.messages) {
            (enhanced.messages || []).forEach((item) => pushAlert(item, 'OSMET'));
        } else if (enhanced && typeof enhanced === 'object') {
            Object.values(enhanced).flat().forEach((item) => pushAlert(item, 'OSMET'));
        }

        const deduped = dedupeAlerts(alerts);
        const active = deduped.filter((a) => a.applies);

        return {
            alerts: active.length ? active : deduped,
            alertsUnfiltered: deduped.length > active.length,
            alertCount: active.length || deduped.length
        };
    }
};

async function fetchJson(url, signal) {
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function normalizeTerytList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string') return value.split(/[,;\s]+/).filter(Boolean);
    return [];
}

function dedupeAlerts(alerts) {
    const seen = new Set();
    return alerts.filter((a) => {
        const key = `${a.name}|${a.validFrom}|${a.level}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
