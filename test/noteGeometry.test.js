// Unit tests for js/board/noteGeometry.js (pure grid geometry + packing).
// Run with: npm test   (node --test test/)
//
// These assert on the default grid metrics, which are deterministic when no
// user prefs exist (fineness step 1 => cellS 32, gap 1, stride 33,
// placement stride 8, origin 2, edgePad 1). See getGridMetrics().
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    rectsOverlap,
    gridColumnStride,
    snapGridCoord,
    snapCanvasCoord,
    clampNoteToBoardEdges,
    clampManualNoteRect,
    snapNotePosition,
    snapNoteRect,
    findFirstCanvasSlot,
    packTwoSetRects,
    pushGridCardRect,
    resolveGridPushLayout
} from '../js/board/noteGeometry.js';
import { getGridMetrics } from '../js/gridDensity.js';

const M = getGridMetrics();

describe('getGridMetrics (fixed 8px placement stride)', () => {
    it('locks placement stride at a quarter-cell (8px)', () => {
        assert.equal(M.cellS, 32);
        assert.equal(M.placementStrideX, 8);
        assert.equal(M.placementStrideY, 8);
    });
});

describe('rectsOverlap', () => {
    it('returns false for separated rects', () => {
        assert.equal(
            rectsOverlap({ x: 0, y: 0, w: 65, h: 32 }, { x: 200, y: 200, w: 65, h: 32 }),
            false
        );
    });

    it('returns true for overlapping rects', () => {
        assert.equal(
            rectsOverlap({ x: 0, y: 0, w: 65, h: 32 }, { x: 10, y: 10, w: 65, h: 32 }),
            true
        );
    });

    it('treats exactly-gap-apart rects as non-overlapping', () => {
        assert.equal(
            rectsOverlap({ x: 0, y: 0, w: 65, h: 32 }, { x: 66, y: 0, w: 65, h: 32 }, 1),
            false
        );
    });
});

describe('gridColumnStride', () => {
    it('returns w + gap for collapsed size', () => {
        assert.equal(gridColumnStride(65, 32, M), 66);
    });

    it('returns a cell-aligned span for an enlarged rect', () => {
        // 3-cell width: round(3 * 32 + 2 * 1) = 98, then + gap = 99
        assert.equal(gridColumnStride(98, 131, M), 99);
    });
});

describe('snapGridCoord / snapCanvasCoord', () => {
    it('snaps toward the nearest stride multiple, never below 0', () => {
        assert.equal(snapGridCoord(37, 32), 32);
        assert.equal(snapGridCoord(50, 32), 64);
        assert.equal(snapGridCoord(-5, 32), 0);
    });

    it('anchors canvas coords to the layout origin', () => {
        assert.equal(snapCanvasCoord(40, 2, 32), 34);
        assert.equal(snapCanvasCoord(2, 2, 32), 2);
    });
});

describe('clampNoteToBoardEdges', () => {
    it('clamps into the padded board bounds', () => {
        assert.deepEqual(
            clampNoteToBoardEdges(
                { x: 0, y: 0, w: 65, h: 32 },
                { packW: 200, maxH: 200, origin: 2, edgePad: 1 }
            ),
            { x: 3, y: 3, w: 65, h: 32 }
        );
    });
});

describe('clampManualNoteRect', () => {
    it('enforces minimum freeform size', () => {
        assert.deepEqual(clampManualNoteRect({ x: 0, y: 0, w: 10, h: 10 }), {
            x: 0,
            y: 0,
            w: 65,
            h: 32
        });
    });

    it('clamps to maxW/maxH when provided', () => {
        assert.deepEqual(
            clampManualNoteRect({ x: 0, y: 0, w: 200, h: 200 }, { maxW: 100, maxH: 100 }),
            { x: 0, y: 0, w: 100, h: 100 }
        );
    });
});

describe('snapNotePosition', () => {
    it('snaps and clamps to origin + edgePad', () => {
        assert.deepEqual(
            snapNotePosition({ x: 0, y: 0, w: 65, h: 32 }, { maxW: 200, maxH: 200, origin: 2, edgePad: 1 }),
            { x: 3, y: 3, w: 65, h: 32 }
        );
    });

    it('snaps to the 8px placement ruler', () => {
        const rect = snapNotePosition(
            { x: 12, y: 20, w: 65, h: 32 },
            { maxW: 400, maxH: 400, origin: 2, edgePad: 1 }
        );
        assert.equal(rect.x % 8, 0);
        assert.equal(rect.y % 8, 0);
        assert.equal(rect.x, 16);
        assert.equal(rect.y, 24);
    });

    it('keeps the rect inside maxW/maxH boundaries', () => {
        // Even with a tiny max, clamped position stays valid (w/h unchanged).
        const rect = snapNotePosition(
            { x: 500, y: 500, w: 65, h: 32 },
            { maxW: 100, maxH: 100, origin: 2, edgePad: 1 }
        );
        assert.ok(rect.x + rect.w <= 3 + 100 + 1);
        assert.ok(rect.y + rect.h <= 99 + 1);
    });
});

describe('snapNoteRect', () => {
    it('normalizes a collapsed footprint then snaps position', () => {
        assert.deepEqual(
            snapNoteRect({ x: 0, y: 0, w: 65, h: 32 }, { maxW: 200, maxH: 200, origin: 2, edgePad: 1 }),
            { x: 3, y: 3, w: 65, h: 32 }
        );
    });

    it('sizes enlarged rects to grid cells before snapping position', () => {
        // 131 -> spanToCellsW round((131+1)/33)=4 -> cellsToSpanW(4)=131
        // 65  -> spanToCellsH round((65+1)/33)=2 -> cellsToSpanH(2)=65
        assert.deepEqual(
            snapNoteRect({ x: 0, y: 0, w: 131, h: 65 }, { maxW: 200, maxH: 200, origin: 2, edgePad: 1 }),
            { x: 3, y: 3, w: 131, h: 65 }
        );
    });
});

describe('findFirstCanvasSlot (horizontal & vertical)', () => {
    it('returns the first padded slot on an empty canvas', () => {
        const h = findFirstCanvasSlot(65, 32, [], 0, { origin: 2, edgePad: 1 });
        const v = findFirstCanvasSlot(65, 32, [], 0, { origin: 2, edgePad: 1, direction: 'vertical' });
        assert.deepEqual(h, { x: 3, y: 3, w: 65, h: 32 });
        assert.deepEqual(v, { x: 3, y: 3, w: 65, h: 32 });
    });

    it('returns a slot that does not overlap existing placed rects', () => {
        const placed = [{ x: 3, y: 3, w: 65, h: 32 }];
        const h = findFirstCanvasSlot(65, 32, placed, 0, { origin: 2, edgePad: 1 });
        const v = findFirstCanvasSlot(65, 32, placed, 0, { origin: 2, edgePad: 1, direction: 'vertical' });
        assert.equal(
            placed.some((p) => rectsOverlap(h, p, M.gap)),
            false
        );
        assert.equal(
            placed.some((p) => rectsOverlap(v, p, M.gap)),
            false
        );
    });

    it('vertical packing escapes around a blocker when there is room', () => {
        const placed = [{ x: 3, y: 3, w: 65, h: 32 }];
        const slot = findFirstCanvasSlot(65, 32, placed, 200, {
            origin: 2,
            edgePad: 1,
            maxH: 120,
            direction: 'vertical'
        });
        assert.ok(slot.y + slot.h <= 120 + 1);
        assert.equal(placed.some((p) => rectsOverlap(slot, p, M.gap)), false);
    });

    it('vertical packing snaps below a blocker when the 8px ruler has room', () => {
        // With the 8px placement stride, y=36 snaps to 40, which clears the
        // 32px-tall blocker at y=3 (bottom+gap = 36). Previously a 32px
        // stride snapped 36 back onto the blocker and hit the guard fallback.
        const placed = [{ x: 3, y: 3, w: 65, h: 32 }];
        const slot = findFirstCanvasSlot(65, 32, placed, 0, {
            origin: 2,
            edgePad: 1,
            maxH: 80,
            direction: 'vertical'
        });
        assert.equal(placed.some((p) => rectsOverlap(slot, p, M.gap)), false);
        assert.ok(slot.y >= 36);
        assert.ok(slot.y + slot.h <= 80 + 1);
    });
});

describe('pushGridCardRect', () => {
    it('pushing into an occupied slot yields a non-overlapping candidate', () => {
        const rect = { x: 3, y: 3, w: 65, h: 32 };
        const placed = [{ x: 3, y: 3, w: 65, h: 32 }];
        const next = pushGridCardRect(rect, placed, { packW: 300, origin: 2, maxH: 400, edgePad: 1 });
        assert.ok(Number.isFinite(next.x) && Number.isFinite(next.y));
        assert.equal(placed.some((p) => rectsOverlap(next, p, M.gap)), false);
    });
});

describe('resolveGridPushLayout', () => {
    it('preserves pinned positions and produces an overlap-free layout for every card', () => {
        const cardEntries = [
            { id: 'a', rect: { x: 3, y: 3, w: 65, h: 32 } },
            { id: 'b', rect: { x: 3, y: 36, w: 65, h: 32 } },
            { id: 'c', rect: { x: 69, y: 3, w: 65, h: 32 } }
        ];
        const pinnedIds = new Set(['a']);
        const layout = resolveGridPushLayout({
            cardEntries,
            pinnedIds,
            packW: 300,
            origin: 2,
            maxH: 400,
            edgePad: 1
        });

        // Every card must be placed.
        assert.deepEqual([...layout.keys()].sort(), ['a', 'b', 'c']);

        // Pinned cards keep their exact rect (no re-snap).
        assert.deepEqual(layout.get('a'), { x: 3, y: 3, w: 65, h: 32 });

        // Non-overlapping neighbors stay put — the push engine must not
        // re-snap the whole board when nothing collides.
        assert.deepEqual(layout.get('b'), { x: 3, y: 36, w: 65, h: 32 });
        assert.deepEqual(layout.get('c'), { x: 69, y: 3, w: 65, h: 32 });

        // No placed rect overlaps any other.
        const all = [...layout.values()];
        for (let i = 0; i < all.length; i += 1) {
            for (let j = i + 1; j < all.length; j += 1) {
                assert.equal(rectsOverlap(all[i], all[j], M.gap), false);
            }
        }
    });

    it('pushes only the overlapping neighbor of the actor, leaving others still', () => {
        const actorRect = { x: 3, y: 3, w: 65, h: 32 };
        const far = { x: 200, y: 200, w: 65, h: 32 };
        const layout = resolveGridPushLayout({
            cardEntries: [
                { id: 'actor', rect: actorRect },
                { id: 'hit', rect: { x: 10, y: 10, w: 65, h: 32 } },
                { id: 'far', rect: far }
            ],
            actorId: 'actor',
            actorRect,
            pinnedIds: new Set(),
            packW: 400,
            origin: 2,
            maxH: 400,
            edgePad: 1
        });
        assert.deepEqual(layout.get('far'), far);
        assert.equal(rectsOverlap(layout.get('actor'), layout.get('hit'), M.gap), false);
        assert.equal(rectsOverlap(layout.get('actor'), layout.get('far'), M.gap), false);
    });
});


describe('packTwoSetRects (board sort bin-packing)', () => {
    it('packs collapsed cards first at their real small size (no flattening)', () => {
        const { rects } = packTwoSetRects({
            collapsed: [
                { id: 'a', w: 65, h: 32 },
                { id: 'b', w: 65, h: 32 },
                { id: 'c', w: 65, h: 32 }
            ],
            expanded: [],
            origin: 2,
            packW: 500,
            maxH: 400,
            edgePad: 1,
            direction: 'horizontal'
        });
        const cols = rects.filter((r) => r.set === 'collapsed');
        assert.equal(cols.length, 3);
        cols.forEach(({ rect }) => {
            assert.equal(rect.w, 65);
            assert.equal(rect.h, 32);
        });
        assert.equal(cols[0].rect.y, 3);
    });

    it('packs expanded notes into a second block below, each at real size (no flattening)', () => {
        const { rects } = packTwoSetRects({
            collapsed: [
                { id: 'c1', w: 65, h: 32 },
                { id: 'c2', w: 65, h: 32 }
            ],
            expanded: [
                { id: 'e1', w: 98, h: 131 },
                { id: 'e2', w: 65, h: 98 }
            ],
            origin: 2,
            packW: 500,
            maxH: 400,
            edgePad: 1,
            direction: 'horizontal'
        });
        const collapsedRects = rects.filter((r) => r.set === 'collapsed').map((r) => r.rect);
        const expandedRects = rects.filter((r) => r.set === 'expanded').map((r) => r.rect);
        const bottomCol = Math.max(...collapsedRects.map((r) => r.y + r.h));
        expandedRects.forEach((r) => assert.ok(r.y >= bottomCol, 'expanded should be below collapsed'));
        assert.equal(expandedRects[0].w, 98);
        assert.equal(expandedRects[0].h, 131);
        assert.equal(expandedRects[1].w, 65);
        assert.equal(expandedRects[1].h, 98);
        const all = [...collapsedRects, ...expandedRects];
        for (let i = 0; i < all.length; i += 1) {
            for (let j = i + 1; j < all.length; j += 1) {
                assert.equal(rectsOverlap(all[i], all[j], M.gap), false);
            }
        }
    });

    it('vertical packs expanded notes to the right of the collapsed set', () => {
        const { rects } = packTwoSetRects({
            collapsed: [
                { id: 'c1', w: 65, h: 32 },
                { id: 'c2', w: 65, h: 32 }
            ],
            expanded: [{ id: 'e1', w: 98, h: 98 }],
            origin: 2,
            packW: 500,
            maxH: 400,
            edgePad: 1,
            direction: 'vertical'
        });
        const collapsedRects = rects.filter((r) => r.set === 'collapsed').map((r) => r.rect);
        const expandedRects = rects.filter((r) => r.set === 'expanded').map((r) => r.rect);
        const rightCol = Math.max(...collapsedRects.map((r) => r.x + r.w));
        expandedRects.forEach((r) => assert.ok(r.x >= rightCol, 'expanded should be right of collapsed'));
        assert.equal(expandedRects[0].w, 98);
        assert.equal(expandedRects[0].h, 98);
    });

    it('packs around pre-placed (pinned) rects without overlapping them', () => {
        const pinned = { x: 3, y: 3, w: 65, h: 32 };
        const { rects } = packTwoSetRects({
            collapsed: [{ id: 'c1', w: 65, h: 32 }],
            expanded: [],
            placed: [pinned],
            origin: 2,
            packW: 500,
            maxH: 400,
            edgePad: 1,
            direction: 'horizontal'
        });
        assert.equal(rects[0].set, 'collapsed');
        assert.equal(rectsOverlap(rects[0].rect, pinned, M.gap), false);
    });
});
