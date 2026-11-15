/** @module {"owns":"magicCanvas per-item z-level (top/middle/bottom) normalisation and the one paint order shared by the board, note previews and hit-testing","related":["drawingBoard/view.js","noteCanvasRenderer.js","lassoGeometry.js","canvasDocument.js","drawingBoard/zLevel.js"]} */

/**
 * Three layers, stored per item as `zLevel`. The middle layer is the default and
 * is represented by the *absence* of the field, so a document drawn before
 * layers existed loads as a pure middle-layer stack and a middle-layer save is
 * byte-identical to an old one.
 */
export const Z_BOTTOM = -1;
export const Z_MIDDLE = 0;
export const Z_TOP = 1;

export const Z_LEVELS = [Z_BOTTOM, Z_MIDDLE, Z_TOP];

/** Map any stored value onto a real level; anything odd is the middle layer. */
export function normalizeZLevel(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return Z_MIDDLE;
    const level = Math.trunc(n);
    return Z_LEVELS.includes(level) ? level : Z_MIDDLE;
}

/** Level of one item. Missing field (old saves, new items) means middle. */
export function zLevelOf(item) {
    return normalizeZLevel(item && item.zLevel);
}

/**
 * Kind rank inside a single level. The board has always painted images, then
 * strokes, then texts, and it still does — a level only reorders whole items
 * against items on the other two levels, never the kind ladder inside one.
 */
const KIND_RANK = { images: 0, strokes: 1, texts: 2 };

function usesLevels(list) {
    return list.some((item) => zLevelOf(item) !== Z_MIDDLE);
}

/**
 * The document's items in paint order (bottom-most first): z-level ascending,
 * then kind (images → strokes → texts), then array index (last = on top).
 *
 * Every consumer that has to agree about "what is in front" goes through here —
 * the painter, the note preview, the clipboard bitmap and click hit-testing —
 * because two orderings that drift apart is how a click starts selecting the
 * item that is not visually on top.
 *
 * @param {{ images?: Array, strokes?: Array, texts?: Array }} [layers]
 * @returns {Array<{ kind: 'images'|'strokes'|'texts', item: Object }>}
 */
export function orderedItems(layers = {}) {
    const images = Array.isArray(layers.images) ? layers.images : [];
    const strokes = Array.isArray(layers.strokes) ? layers.strokes : [];
    const texts = Array.isArray(layers.texts) ? layers.texts : [];

    // Fast path: nobody uses a layer, so keep the historic three-pass order and
    // skip the sort. This runs on every frame while drawing.
    if (!usesLevels(images) && !usesLevels(strokes) && !usesLevels(texts)) {
        return [
            ...images.map((item) => ({ kind: 'images', item })),
            ...strokes.map((item) => ({ kind: 'strokes', item })),
            ...texts.map((item) => ({ kind: 'texts', item }))
        ];
    }

    const entries = [];
    const collect = (kind, list) => {
        list.forEach((item, index) => {
            entries.push({ kind, item, level: zLevelOf(item), rank: KIND_RANK[kind], index });
        });
    };
    collect('images', images);
    collect('strokes', strokes);
    collect('texts', texts);

    // Composite tuple, not a stable-sort shortcut: the result must be identical
    // in every engine, not merely identical where sort happens to be stable.
    entries.sort((a, b) => (a.level - b.level) || (a.rank - b.rank) || (a.index - b.index));
    return entries.map(({ kind, item }) => ({ kind, item }));
}
