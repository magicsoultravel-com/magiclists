const STORAGE_KEY = 'matrix_global_drawing';

export const PAGE_FORMATS = {
    a2: { width: 2480, height: 3508, label: 'A2' },
    a3: { width: 1754, height: 2480, label: 'A3' },
    a4: { width: 1240, height: 1754, label: 'A4' },
    a5: { width: 874, height: 1240, label: 'A5' },
    a6: { width: 620, height: 874, label: 'A6' }
};

export const CANVAS_MODES = ['a2', 'a3', 'a4', 'a5', 'a6', 'infinite'];
export const BACKGROUNDS = ['blank', 'grid', 'dots', 'graph', 'coarse', 'isometric', 'ruled', 'hex', 'notebook', 'staff', 'football'];

function createId(prefix) {
    const p = prefix || 'page';
    return p + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function emptyPage(format, background, backgroundColor) {
    return {
        id: createId('page'),
        format: format || 'a4',
        background: background || 'blank',
        backgroundColor: backgroundColor || '',
        strokes: [],
        texts: [],
        images: []
    };
}

export function createEmptyDocument(canvasMode) {
    const mode = canvasMode || 'a4';
    const page = emptyPage(mode === 'infinite' ? 'a4' : mode);
    return {
        version: 2,
        canvasMode: mode,
        activePageId: page.id,
        pages: [page],
        infinite: {
            strokes: [],
            texts: [],
            images: [],
            background: 'blank',
            backgroundColor: '',
            bounds: { minX: 0, minY: 0, maxX: 3000, maxY: 3000 }
        },
        viewport: { scale: 1, offsetX: 0, offsetY: 0 }
    };
}

export function migrateDocument(raw) {
    if (!raw || typeof raw !== 'object') return createEmptyDocument();
    if (raw.version === 2) {
        const doc = Object.assign(createEmptyDocument(), raw);
        if (!Array.isArray(doc.pages) || !doc.pages.length) {
            doc.pages = [emptyPage()];
            doc.activePageId = doc.pages[0].id;
        }
        if (!doc.infinite) {
            doc.infinite = { strokes: [], texts: [], images: [], background: 'blank', backgroundColor: '', bounds: { minX: 0, minY: 0, maxX: 3000, maxY: 3000 } };
        }
        if (!Array.isArray(doc.infinite.images)) doc.infinite.images = [];
        if (!doc.viewport) doc.viewport = { scale: 1, offsetX: 0, offsetY: 0 };
        if (CANVAS_MODES.indexOf(doc.canvasMode) < 0) doc.canvasMode = 'a4';
        doc.pages.forEach((p) => {
            if (p.backgroundColor == null) p.backgroundColor = '';
            if (!Array.isArray(p.images)) p.images = [];
            if (!Array.isArray(p.texts)) p.texts = [];
            if (!Array.isArray(p.strokes)) p.strokes = [];
            if (p.format && !PAGE_FORMATS[p.format]) p.format = 'a4';
        });
        if (doc.infinite && doc.infinite.backgroundColor == null) doc.infinite.backgroundColor = '';
        normalizeInfiniteBounds(doc);
        promoteInfiniteLayerToActivePage(doc);
        return doc;
    }
    const strokes = Array.isArray(raw.strokes) ? raw.strokes : [];
    const page = emptyPage();
    page.strokes = strokes;
    return {
        version: 2,
        canvasMode: 'infinite',
        activePageId: page.id,
        pages: [page],
        infinite: {
            strokes: strokes.slice(),
            texts: [],
            images: [],
            background: 'blank',
            bounds: { minX: 0, minY: 0, maxX: 3000, maxY: 3000 }
        },
        viewport: { scale: 1, offsetX: 0, offsetY: 0 }
    };
}

export async function readDocument() {
    // Primary source: IndexedDB (no legacy migration here — handled below).
    try {
        const IndexedDBStore = await import('./storage/indexedDbCanvasStore.js');
        const result = await IndexedDBStore.getCanvasDocument(STORAGE_KEY);
        if (result !== null) {
            return migrateDocument(result);
        }
    } catch (e) {
        // Continue to fallback
    }

    // Fallback / migration source: legacy localStorage drawing data.
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const doc = migrateDocument(JSON.parse(raw));
            // Persist the migrated document to the primary store and keep localStorage as mirror.
            await writeDocument(doc);
            return doc;
        }
    } catch (e) {
        // Ignore parse errors and fall through to empty document
    }
    return createEmptyDocument();
}

export async function writeDocument(doc) {
    try {
        const IndexedDBStore = await import('./storage/indexedDbCanvasStore.js');
        await IndexedDBStore.setCanvasDocument(STORAGE_KEY, doc);
    } catch (e) {
        // If IndexedDB fails, localStorage below acts as the fallback mirror.
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    } catch (e) {
        // Ignore quota errors — IndexedDB is the primary store.
    }
}

export function getActivePage(doc) {
    return doc.pages.find(function (p) { return p.id === doc.activePageId; }) || doc.pages[0];
}

function layerIsEmpty(layer) {
    return !layer
        || ((!layer.strokes || !layer.strokes.length)
            && (!layer.texts || !layer.texts.length)
            && (!layer.images || !layer.images.length));
}

/** One-time reconcile: page store is canonical; lift legacy infinite content onto the active page. */
function promoteInfiniteLayerToActivePage(doc) {
    if (!doc || !doc.infinite) return;
    var page = getActivePage(doc);
    if (!page || !layerIsEmpty(page)) return;
    if (layerIsEmpty(doc.infinite)) return;
    page.strokes = Array.isArray(doc.infinite.strokes) ? doc.infinite.strokes.slice() : [];
    page.texts = Array.isArray(doc.infinite.texts) ? doc.infinite.texts.slice() : [];
    page.images = Array.isArray(doc.infinite.images) ? doc.infinite.images.slice() : [];
    if (doc.infinite.background) page.background = doc.infinite.background;
    if (doc.infinite.backgroundColor) page.backgroundColor = doc.infinite.backgroundColor;
}

export function getActiveStrokes(doc) {
    var page = getActivePage(doc);
    return page ? page.strokes : [];
}

export function getActiveTexts(doc) {
    var page = getActivePage(doc);
    return page ? page.texts : [];
}

export function getActiveImages(doc) {
    var page = getActivePage(doc);
    return page ? (page.images || []) : [];
}

export function setActiveStrokes(doc, strokes) {
    var page = getActivePage(doc);
    if (page) page.strokes = strokes;
}

export function setActiveTexts(doc, texts) {
    var page = getActivePage(doc);
    if (page) page.texts = texts;
}

export function setActiveImages(doc, images) {
    var page = getActivePage(doc);
    if (page) page.images = images;
}

export function getActiveBackground(doc) {
    var page = getActivePage(doc);
    return page ? page.background || 'blank' : 'blank';
}

export function setActiveBackground(doc, background) {
    var page = getActivePage(doc);
    if (page) page.background = background;
}

export function getActiveBackgroundColor(doc) {
    var page = getActivePage(doc);
    return page && page.backgroundColor ? page.backgroundColor : '';
}

export function setActiveBackgroundColor(doc, color) {
    const hex = color || '';
    var page = getActivePage(doc);
    if (page) page.backgroundColor = hex;
}

export function getPageDimensions(doc) {
    if (doc.canvasMode === 'infinite') {
        var b = doc.infinite.bounds;
        return { width: Math.max(800, b.maxX - b.minX), height: Math.max(600, b.maxY - b.minY) };
    }
    var page = getActivePage(doc);
    var fmt = PAGE_FORMATS[page && page.format] || PAGE_FORMATS.a4;
    return { width: fmt.width, height: fmt.height };
}

/** Pin infinite origin at (0,0); only the right/bottom edge may grow. */
export function normalizeInfiniteBounds(doc) {
    if (!doc || !doc.infinite) return;
    var b = doc.infinite.bounds || { minX: 0, minY: 0, maxX: 3000, maxY: 3000 };
    var extentX = Math.max(3000, (b.maxX || 0) - Math.min(0, b.minX || 0), b.maxX || 0);
    var extentY = Math.max(3000, (b.maxY || 0) - Math.min(0, b.minY || 0), b.maxY || 0);
    doc.infinite.bounds = {
        minX: 0,
        minY: 0,
        maxX: Math.max(3000, extentX),
        maxY: Math.max(3000, extentY)
    };
}

/**
 * Switch canvas mode while keeping the active drawing visible.
 * Content lives on pages in every mode; Infinite only changes viewport bounds.
 */
export function switchCanvasMode(doc, mode) {
    if (!doc || CANVAS_MODES.indexOf(mode) < 0) return false;
    if (doc.canvasMode === mode) {
        if (mode !== 'infinite') {
            var samePage = getActivePage(doc);
            if (samePage) samePage.format = mode;
        }
        return false;
    }

    var prevMode = doc.canvasMode;
    var prevDims = getPageDimensions(doc);

    doc.canvasMode = mode;

    if (mode !== 'infinite') {
        var page = getActivePage(doc);
        if (page) page.format = mode;
    } else if (prevMode !== 'infinite') {
        if (!doc.infinite) {
            doc.infinite = {
                strokes: [],
                texts: [],
                images: [],
                background: 'blank',
                backgroundColor: '',
                bounds: { minX: 0, minY: 0, maxX: 3000, maxY: 3000 }
            };
        }
        var b = doc.infinite.bounds || { minX: 0, minY: 0, maxX: 3000, maxY: 3000 };
        b.minX = 0;
        b.minY = 0;
        b.maxX = Math.max(b.maxX, 3000, prevDims.width);
        b.maxY = Math.max(b.maxY, 3000, prevDims.height);
        doc.infinite.bounds = b;
    }
    return true;
}

export function addPage(doc) {
    var fmt = PAGE_FORMATS[doc.canvasMode] ? doc.canvasMode : 'a4';
    var page = emptyPage(fmt, getActiveBackground(doc), getActiveBackgroundColor(doc));
    doc.pages.push(page);
    doc.activePageId = page.id;
    return page;
}

export function nextPage(doc) {
    var idx = doc.pages.findIndex(function (p) { return p.id === doc.activePageId; });
    if (idx < doc.pages.length - 1) {
        doc.activePageId = doc.pages[idx + 1].id;
        return true;
    }
    return false;
}

export function prevPage(doc) {
    var idx = doc.pages.findIndex(function (p) { return p.id === doc.activePageId; });
    if (idx > 0) {
        doc.activePageId = doc.pages[idx - 1].id;
        return true;
    }
    return false;
}

const INFINITE_MIN_SIZE = 3000;
const INFINITE_BOUNDS_MARGIN = 400;

function contentBoundsFromActivePage(doc) {
    var items = []
        .concat(getActiveStrokes(doc) || [])
        .concat(getActiveTexts(doc) || [])
        .concat(getActiveImages(doc) || []);
    if (!items.length) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, empty: true };
    }

    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;

    items.forEach(function (item) {
        if (!item) return;
        if (Array.isArray(item.points) && item.points.length) {
            item.points.forEach(function (point) {
                if (!point) return;
                if (point.x < minX) minX = point.x;
                if (point.x > maxX) maxX = point.x;
                if (point.y < minY) minY = point.y;
                if (point.y > maxY) maxY = point.y;
            });
            return;
        }
        if (item.x0 != null && item.y0 != null && item.x1 != null && item.y1 != null) {
            minX = Math.min(minX, item.x0, item.x1);
            maxX = Math.max(maxX, item.x0, item.x1);
            minY = Math.min(minY, item.y0, item.y1);
            maxY = Math.max(maxY, item.y0, item.y1);
            return;
        }
        if (item.x != null && item.y != null) {
            var w = Number(item.width) || Number(item.fontSize) || 0;
            var h = Number(item.height) || Number(item.fontSize) || 0;
            minX = Math.min(minX, item.x);
            maxX = Math.max(maxX, item.x + w);
            minY = Math.min(minY, item.y);
            maxY = Math.max(maxY, item.y + h);
        }
    });

    if (minX === Infinity) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, empty: true };
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, empty: false };
}

export function expandInfiniteBounds(doc, x, y, margin) {
    var m = margin == null ? INFINITE_BOUNDS_MARGIN : margin;
    var b = doc.infinite.bounds;
    var prev = { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
    // Top/left are fixed at the origin; only grow right and down.
    b.minX = 0;
    b.minY = 0;
    b.maxX = Math.max(b.maxX, x + m, 0);
    b.maxY = Math.max(b.maxY, y + m, 0);
    return b.minX !== prev.minX || b.minY !== prev.minY || b.maxX !== prev.maxX || b.maxY !== prev.maxY;
}

/**
 * Fit infinite bounds to active-page content (+ margin), never below MIN_SIZE.
 * Intended for activate / page change / clear — not per-stroke.
 */
export function shrinkInfiniteBounds(doc, options) {
    if (!doc || doc.canvasMode !== 'infinite' || !doc.infinite) return false;
    var margin = options && options.margin != null ? options.margin : INFINITE_BOUNDS_MARGIN;
    var minSize = options && options.minSize != null ? options.minSize : INFINITE_MIN_SIZE;
    if (!doc.infinite.bounds) {
        doc.infinite.bounds = { minX: 0, minY: 0, maxX: minSize, maxY: minSize };
    }
    var b = doc.infinite.bounds;
    var prev = { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
    var content = contentBoundsFromActivePage(doc);
    var nextMaxX = minSize;
    var nextMaxY = minSize;
    if (!content.empty) {
        nextMaxX = Math.max(minSize, content.maxX + margin);
        nextMaxY = Math.max(minSize, content.maxY + margin);
    }
    b.minX = 0;
    b.minY = 0;
    b.maxX = nextMaxX;
    b.maxY = nextMaxY;
    return b.minX !== prev.minX || b.minY !== prev.minY || b.maxX !== prev.maxX || b.maxY !== prev.maxY;
}

export { STORAGE_KEY, createId, INFINITE_MIN_SIZE, INFINITE_BOUNDS_MARGIN };
