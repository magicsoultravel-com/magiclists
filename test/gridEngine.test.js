// Unit tests for js/board/gridEngine.js computeBoardLayout.
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeBoardLayout } from '../js/board/gridEngine.js';

function identityRect(rect) {
    return { ...rect };
}

function layoutOpts(saved) {
    return {
        getLayout: () => saved,
        isExpanded: () => true,
        resolveSpatialSize: () => ({ w: 65, h: 32 }),
        getTileDefaultRect: () => ({ w: 65, h: 32 }),
        resolveTileSize: () => 'small',
        findSlot: (w, h) => ({ x: 8, y: 8, w, h }),
        snapRect: identityRect,
        clampRect: identityRect
    };
}

describe('computeBoardLayout (id lookup, not list-index zip)', () => {
    it('returns each saved rect under its own item id even when list order differs from spatial order', () => {
        const saved = {
            a: { x: 10, y: 10, w: 65, h: 32 },
            b: { x: 100, y: 50, w: 65, h: 32 },
            c: { x: 40, y: 200, w: 65, h: 32 }
        };
        // Item list order is NOT spatial (y,x) order. Spatial sort is a, b, c.
        const items = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
        const { placed, placedById } = computeBoardLayout(
            {},
            items,
            { origin: 2, packW: 800, maxH: 800, edgePad: 1 },
            layoutOpts(saved)
        );

        assert.equal(placedById.get('a').x, 10);
        assert.equal(placedById.get('a').y, 10);
        assert.equal(placedById.get('b').x, 100);
        assert.equal(placedById.get('b').y, 50);
        assert.equal(placedById.get('c').x, 40);
        assert.equal(placedById.get('c').y, 200);

        // `placed` is spatially sorted (a, b, c). Zipping it with `items`
        // (c, a, b) would assign every card the wrong rect — the File Cabinet
        // drop bug. Callers must use placedById.
        assert.deepEqual(placed[0], saved.a);
        assert.notEqual(items[0].id, 'a');
    });
});
