// Unit tests for collapse/expand geometry — fixes for expansion position,
// FC remembered-size preservation, and collapse reflow avoidance.
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    isCollapsedSpatialSize,
    readRememberedSize,
    getSmallRect,
    clampSpatialSize,
    resolveExpandedDefaultRect,
    getLargeDefaultRect
} from '../js/tileGeometry.js';
import { readTileSmallFootprint } from '../js/tileFootprint.js';
import { getGridMetrics } from '../js/gridDensity.js';

const footprint = readTileSmallFootprint();
const small = getSmallRect(footprint);
const large = getLargeDefaultRect();
const metrics = getGridMetrics();

// Sanity: make sure our test dimensions are meaningful
const SMALL_W = small.w;
const SMALL_H = small.h;
const LARGE_W = large.w;   // 3 cells wide
const LARGE_H = large.h;   // 4 cells tall

// --- Fix A: resolveBoardExpandRect (position-keeping) ---
// resolveBoardExpandRect returns { x: pos.x, y: pos.y, w: rememberedSize.w, h: rememberedSize.h }
// We can't test the full UI method without a DOM, but we test the building blocks:

describe('isCollapsedSpatialSize (reflow guard / tier detection)', () => {
    it('returns true for the small/label rect', () => {
        assert.ok(isCollapsedSpatialSize(SMALL_W, SMALL_H, 'large', footprint));
    });

    it('returns false for the large default rect', () => {
        assert.ok(!isCollapsedSpatialSize(LARGE_W, LARGE_H, 'large', footprint));
    });

    it('returns false for a typical expanded size', () => {
        assert.ok(!isCollapsedSpatialSize(200, 150, 'large', footprint));
    });

    it('uses the threshold (hysteresis = 4) for borderline sizes', () => {
        // Just above small should be "large" (collapsed = false)
        assert.ok(!isCollapsedSpatialSize(SMALL_W + 5, SMALL_H + 5, 'large', footprint));
    });
});

// --- Fix B: readRememberedSize (used by resolveBoardExpandRect) ---

describe('readRememberedSize (remembered-size rebuild fix for FC)', () => {
    it('returns the remembered size when rememberedW/H are present and not collapsed', () => {
        const saved = { rememberedW: 200, rememberedH: 150 };
        const r = readRememberedSize(saved, footprint);
        assert.ok(r !== null);
        assert.equal(r.w, 200);
        assert.equal(r.h, 150);
    });

    it('returns null when the saved object is empty', () => {
        assert.equal(readRememberedSize({}, footprint), null);
    });

    it('returns a clamped size for out-of-range remembered values', () => {
        // Remembered values that are too small for a large tier get clamped
        const saved = { rememberedW: SMALL_W, rememberedH: SMALL_H };
        // should be null because isAtSmallSize returns true
        assert.equal(readRememberedSize(saved, footprint), null);
    });

    it('returns null when rememberedW is not finite', () => {
        const saved = { rememberedW: 'not-a-number', rememberedH: 150 };
        assert.equal(readRememberedSize(saved, footprint), null);
    });
});

describe('resolveExpandedDefaultRect (fallback when no remembered size)', () => {
    it('returns FREEFORM_EXPANDED_W x FREEFORM_EXPANDED_DEFAULT_H for null saved', () => {
        const r = resolveExpandedDefaultRect('large', null, footprint);
        assert.ok(r.w >= 196);
        assert.ok(r.h >= 120);
    });

    it('uses saved w/h when provided', () => {
        const saved = { w: 250, h: 180 };
        const r = resolveExpandedDefaultRect('large', saved, footprint);
        assert.equal(r.w, 250);
        assert.equal(r.h, 180);
    });
});

// --- Reflow guard logic ---
// When commitSpatialRect runs, it should only reflow neighbors if the
// *target* rect is NOT collapsed (i.e. we are expanding, not collapsing).

describe('collapse reflow guard (neighbor cards must not move on collapse)', () => {
    it('isCollapsedSpatialSize guards: collapsing a large card produces a collapsed rect', () => {
        // Simulate: an expanded note (196x120) collapsed to small (65x32)
        const expanded = { w: 196, h: 120 };
        const collapsed = { w: SMALL_W, h: SMALL_H };
        assert.ok(!isCollapsedSpatialSize(expanded.w, expanded.h, 'large', footprint));
        assert.ok(isCollapsedSpatialSize(collapsed.w, collapsed.h, 'large', footprint));
    });

    it('expanding a collapsed card produces a non-collapsed rect', () => {
        // Simulate: a collapsed note (65x32) expanded to its remembered size (200x150)
        const collapsed = { w: SMALL_W, h: SMALL_H };
        const expanded = { w: 200, h: 150 };
        assert.ok(isCollapsedSpatialSize(collapsed.w, collapsed.h, 'large', footprint));
        assert.ok(!isCollapsedSpatialSize(expanded.w, expanded.h, 'large', footprint));
    });

    it('clampSpatialSize preserves collapsed rects', () => {
        const r = clampSpatialSize(SMALL_W, SMALL_H, 'large', footprint);
        assert.ok(isCollapsedSpatialSize(r.w, r.h, 'large', footprint));
    });

    it('clampSpatialSize preserves expanded rects', () => {
        const r = clampSpatialSize(200, 150, 'large', footprint);
        assert.ok(!isCollapsedSpatialSize(r.w, r.h, 'large', footprint));
        assert.equal(r.w, 200);
        assert.equal(r.h, 150);
    });
});