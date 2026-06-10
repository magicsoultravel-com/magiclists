const STORAGE_KEY = 'matrix_global_drawing';

export const PAGE_FORMATS = {
    a5: { width: 874, height: 1240, label: 'A5' },
    a4: { width: 1240, height: 1754, label: 'A4' },
    a3: { width: 1754, height: 2480, label: 'A3' }
};

export const CANVAS_MODES = ['a4', 'a5', 'a3', 'infinite'];
export const BACKGROUNDS = ['blank', 'grid', 'dots', 'graph', 'coarse', 'isometric', 'ruled', 'hex', 'notebook', 'staff'];

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
        texts: []
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
            doc.infinite = { strokes: [], texts: [], background: 'blank', backgroundColor: '', bounds: { minX: 0, minY: 0, maxX: 3000, maxY: 3000 } };
        }
        if (!doc.viewport) doc.viewport = { scale: 1, offsetX: 0, offsetY: 0 };
        if (CANVAS_MODES.indexOf(doc.canvasMode) < 0) doc.canvasMode = 'a4';
        doc.pages.forEach((p) => { if (p.backgroundColor == null) p.backgroundColor = ''; });
        if (doc.infinite && doc.infinite.backgroundColor == null) doc.infinite.backgroundColor = '';
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
            background: 'blank',
            bounds: { minX: 0, minY: 0, maxX: 3000, maxY: 3000 }
        },
        viewport: { scale: 1, offsetX: 0, offsetY: 0 }
    };
}

export function readDocument() {
    try {
        return migrateDocument(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
    } catch (e) {
        return createEmptyDocument();
    }
}

export function writeDocument(doc) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
}

export function getActivePage(doc) {
    return doc.pages.find(function (p) { return p.id === doc.activePageId; }) || doc.pages[0];
}

export function getActiveStrokes(doc) {
    if (doc.canvasMode === 'infinite') return doc.infinite.strokes;
    var page = getActivePage(doc);
    return page ? page.strokes : [];
}

export function getActiveTexts(doc) {
    if (doc.canvasMode === 'infinite') return doc.infinite.texts;
    var page = getActivePage(doc);
    return page ? page.texts : [];
}

export function setActiveStrokes(doc, strokes) {
    if (doc.canvasMode === 'infinite') doc.infinite.strokes = strokes;
    else {
        var page = getActivePage(doc);
        if (page) page.strokes = strokes;
    }
}

export function setActiveTexts(doc, texts) {
    if (doc.canvasMode === 'infinite') doc.infinite.texts = texts;
    else {
        var page = getActivePage(doc);
        if (page) page.texts = texts;
    }
}

export function getActiveBackground(doc) {
    if (doc.canvasMode === 'infinite') return doc.infinite.background || 'blank';
    var page = getActivePage(doc);
    return page ? page.background || 'blank' : 'blank';
}

export function setActiveBackground(doc, background) {
    if (doc.canvasMode === 'infinite') doc.infinite.background = background;
    else {
        var page = getActivePage(doc);
        if (page) page.background = background;
    }
}

export function getActiveBackgroundColor(doc) {
    if (doc.canvasMode === 'infinite') return doc.infinite.backgroundColor || '';
    var page = getActivePage(doc);
    return page && page.backgroundColor ? page.backgroundColor : '';
}

export function setActiveBackgroundColor(doc, color) {
    const hex = color || '';
    if (doc.canvasMode === 'infinite') doc.infinite.backgroundColor = hex;
    else {
        var page = getActivePage(doc);
        if (page) page.backgroundColor = hex;
    }
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

export function addPage(doc) {
    var fmt = doc.canvasMode === 'infinite' ? 'a4' : (PAGE_FORMATS[doc.canvasMode] ? doc.canvasMode : 'a4');
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

export function expandInfiniteBounds(doc, x, y, margin) {
    var m = margin || 400;
    var b = doc.infinite.bounds;
    b.minX = Math.min(b.minX, x - m);
    b.minY = Math.min(b.minY, y - m);
    b.maxX = Math.max(b.maxX, x + m);
    b.maxY = Math.max(b.maxY, y + m);
}

export { STORAGE_KEY, createId };
