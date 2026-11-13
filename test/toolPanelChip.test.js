// test/toolPanelChip.test.js
// Collapse-to-chip geometry: the TOOLS token and its panel share a top-left
// anchor, so collapsing and expanding again must be a positional no-op. These
// helpers used to be inlined in js/toolPanelChrome.js (and duplicated in
// js/drawingToolbarChrome.js) with a top-right chip anchor whose expanded panel
// ignored the token's position entirely — dragging the token then expanding
// teleported the panel back to its stored coordinates.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    CHIP_ANCHOR_INSET,
    canAnimateElement,
    chipOriginForPanel,
    chipScaleForPanel,
    prefersReducedMotion,
    resolveExpandedPanelOrigin
} from '../js/chipMotion.js';

const BOUNDS = { left: 0, top: 0, right: 1200, bottom: 800 };

const reducedWin = { matchMedia: () => ({ matches: true }) };
const motionWin = { matchMedia: () => ({ matches: false }) };

describe('chipOriginForPanel / resolveExpandedPanelOrigin', () => {
    it('round-trips: a token at the panel origin reopens the panel in place', () => {
        const origin = chipOriginForPanel(320, 140);
        assert.deepEqual(origin, { x: 320, y: 140 });
        assert.deepEqual(
            resolveExpandedPanelOrigin({
                chipX: origin.x,
                chipY: origin.y,
                panelWidth: 340,
                panelHeight: 380,
                bounds: BOUNDS
            }),
            { x: 320, y: 140 }
        );
    });

    it('shares one anchor inset between placing and resolving', () => {
        const origin = chipOriginForPanel(10, 20, 4);
        assert.deepEqual(origin, { x: 14, y: 24 });
        assert.deepEqual(
            resolveExpandedPanelOrigin({
                chipX: origin.x,
                chipY: origin.y,
                panelWidth: 100,
                panelHeight: 100,
                bounds: BOUNDS,
                inset: 4
            }),
            { x: 10, y: 20 }
        );
        assert.equal(CHIP_ANCHOR_INSET, 0);
    });

    it('clamps a bottom-right token inward instead of flipping the anchor', () => {
        const origin = resolveExpandedPanelOrigin({
            chipX: 1100,
            chipY: 760,
            panelWidth: 340,
            panelHeight: 380,
            bounds: BOUNDS
        });
        // Exactly the clamp — a flip would return chipX - panelWidth instead.
        assert.deepEqual(origin, { x: 1200 - 340, y: 800 - 380 });
        assert.ok(origin.x + 340 <= BOUNDS.right);
        assert.ok(origin.y + 380 <= BOUNDS.bottom);
    });

    it('pins to the bounds when the token sits past the top-left edge', () => {
        assert.deepEqual(
            resolveExpandedPanelOrigin({
                chipX: 4,
                chipY: 6,
                panelWidth: 340,
                panelHeight: 380,
                bounds: { left: 24, top: 12, right: 1200, bottom: 800 }
            }),
            { x: 24, y: 12 }
        );
    });

    it('degenerates safely when the panel is bigger than the bounds', () => {
        assert.deepEqual(
            resolveExpandedPanelOrigin({
                chipX: 50,
                chipY: 60,
                panelWidth: 900,
                panelHeight: 900,
                bounds: { left: 10, top: 10, right: 500, bottom: 500 }
            }),
            { x: 10, y: 10 }
        );
    });

    it('tolerates missing bounds and non-numeric input', () => {
        assert.deepEqual(
            resolveExpandedPanelOrigin({ chipX: 30, chipY: 40, panelWidth: 100, panelHeight: 120 }),
            { x: 30, y: 40 }
        );
        assert.deepEqual(
            resolveExpandedPanelOrigin({
                chipX: NaN,
                chipY: undefined,
                panelWidth: 100,
                panelHeight: 120,
                bounds: BOUNDS
            }),
            { x: 0, y: 0 }
        );
    });
});

describe('chipScaleForPanel', () => {
    it('maps the panel rect exactly onto the token rect', () => {
        const { sx, sy } = chipScaleForPanel(340, 380, 40, 40);
        assert.equal(sx * 340, 40);
        assert.equal(sy * 380, 40);
        assert.ok(sx > sy, 'a wider-than-tall panel compresses the x axis less');
    });

    it('uses the wide readout token width, so nothing overhangs', () => {
        const { sx } = chipScaleForPanel(340, 380, 76, 40);
        assert.equal(sx * 340, 76);
    });

    it('never divides by zero', () => {
        const { sx, sy } = chipScaleForPanel(0, 0, 0, 0);
        assert.equal(sx, 0.01);
        assert.equal(sy, 0.01);
        assert.ok(Number.isFinite(chipScaleForPanel(undefined, undefined, 40, 40).sx));
    });
});

describe('prefersReducedMotion / canAnimateElement', () => {
    it('honours the media query', () => {
        assert.equal(prefersReducedMotion(reducedWin), true);
        assert.equal(prefersReducedMotion(motionWin), false);
    });

    it('fails open when matchMedia is missing or throws', () => {
        assert.equal(prefersReducedMotion({}), false);
        assert.equal(prefersReducedMotion(undefined), false);
        assert.equal(
            prefersReducedMotion({
                matchMedia: () => {
                    throw new Error('no media query support');
                }
            }),
            false
        );
    });

    it('requires WAAPI support and no reduced-motion preference', () => {
        const el = { animate() {} };
        assert.equal(canAnimateElement(el, motionWin), true);
        assert.equal(canAnimateElement(el, reducedWin), false);
        assert.equal(canAnimateElement({}, motionWin), false);
        assert.equal(canAnimateElement(null, motionWin), false);
    });
});
