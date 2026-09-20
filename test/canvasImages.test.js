// Unit tests for js/canvasImages.js helpers (geometry/size; no real Image/blob in Node).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    initialImageSize,
    drawImageObject,
    drawImageGhost,
    getImageSourceWindow,
    imageDrawArgs,
    cropMetrics,
    cropLimitRect,
    normalizeCropBox,
    resizeCropBox,
    moveCropBox,
    boxToCropPatch,
    INITIAL_MAX_SIDE,
    MIN_IMAGE_SIDE
} from '../js/canvasImages.js';

describe('canvasImages helpers', () => {
    it('initialImageSize scales down large images to INITIAL_MAX_SIDE', () => {
        const size = initialImageSize(1200, 800);
        assert.equal(size.width, INITIAL_MAX_SIDE);
        assert.equal(size.height, Math.round(800 * (INITIAL_MAX_SIDE / 1200)));
        assert.ok(size.width <= INITIAL_MAX_SIDE);
        assert.ok(size.height <= INITIAL_MAX_SIDE);
    });

    it('initialImageSize leaves small images unchanged (above min side)', () => {
        const size = initialImageSize(100, 80);
        assert.equal(size.width, 100);
        assert.equal(size.height, 80);
    });

    it('initialImageSize never goes below MIN_IMAGE_SIDE', () => {
        const size = initialImageSize(1, 1);
        assert.ok(size.width >= MIN_IMAGE_SIDE);
        assert.ok(size.height >= MIN_IMAGE_SIDE);
    });

    it('drawImageObject draws a placeholder when media is missing (mocked ctx)', () => {
        const calls = [];
        const ctx = {
            save() { calls.push('save'); },
            restore() { calls.push('restore'); },
            fillRect(...args) { calls.push(['fillRect', ...args]); },
            strokeRect(...args) { calls.push(['strokeRect', ...args]); },
            setLineDash() {},
            fillText() { calls.push('fillText'); },
            strokeStyle: '',
            fillStyle: '',
            lineWidth: 0,
            font: '',
            textAlign: '',
            textBaseline: ''
        };
        drawImageObject(ctx, { x: 10, y: 20, width: 100, height: 80, mediaId: 'missing' });
        assert.ok(calls.includes('save'));
        assert.ok(calls.includes('restore'));
        assert.ok(calls.includes('fillText'));
        assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'fillRect'));
    });
});

// Crop support: an item keeps its visible rect (x/y/width/height) and stores the
// sampled source window in `crop`, in natural image pixels. The media file is
// never modified, so the same media can be cropped differently per placement.
describe('canvasImages crop helpers', () => {
    const makeCtx = (calls) => ({
        save() {},
        restore() {},
        drawImage(...args) { calls.push(args); }
    });

    it('getImageSourceWindow returns the full bitmap when uncropped', () => {
        assert.deepEqual(
            getImageSourceWindow({ naturalWidth: 400, naturalHeight: 200, width: 120, height: 60 }),
            { x: 0, y: 0, width: 400, height: 200 }
        );
    });

    it('getImageSourceWindow returns the stored crop window', () => {
        assert.deepEqual(
            getImageSourceWindow({
                naturalWidth: 400,
                naturalHeight: 200,
                width: 100,
                height: 50,
                crop: { x: 100, y: 40, width: 200, height: 100 }
            }),
            { x: 100, y: 40, width: 200, height: 100 }
        );
    });

    it('getImageSourceWindow clamps a crop that points outside the bitmap', () => {
        assert.deepEqual(
            getImageSourceWindow({
                naturalWidth: 100,
                naturalHeight: 100,
                width: 50,
                height: 50,
                crop: { x: 90, y: -20, width: 400, height: 30 }
            }),
            { x: 0, y: 0, width: 100, height: 30 }
        );
    });

    it('getImageSourceWindow ignores an invalid crop window', () => {
        assert.deepEqual(
            getImageSourceWindow({
                naturalWidth: 80,
                naturalHeight: 40,
                width: 80,
                height: 40,
                crop: { x: 5, y: 5, width: 0, height: 10 }
            }),
            { x: 0, y: 0, width: 80, height: 40 }
        );
    });

    it('imageDrawArgs keeps the plain frame for an uncropped item', () => {
        const args = imageDrawArgs(
            { x: 10, y: 20, width: 120, height: 60, naturalWidth: 400, naturalHeight: 200 },
            { naturalWidth: 400, naturalHeight: 200 }
        );
        assert.deepEqual(args, {
            sx: 0, sy: 0, sw: 400, sh: 200,
            dx: 10, dy: 20, dw: 120, dh: 60,
            cropped: false
        });
    });

    it('imageDrawArgs samples the source window for a cropped item', () => {
        const args = imageDrawArgs(
            {
                x: 10,
                y: 20,
                width: 100,
                height: 50,
                naturalWidth: 400,
                naturalHeight: 200,
                crop: { x: 200, y: 50, width: 200, height: 100 }
            },
            { naturalWidth: 400, naturalHeight: 200 }
        );
        assert.equal(args.cropped, true);
        assert.deepEqual([args.sx, args.sy, args.sw, args.sh], [200, 50, 200, 100]);
        assert.deepEqual([args.dx, args.dy, args.dw, args.dh], [10, 20, 100, 50]);
    });

    it('imageDrawArgs prefers the live bitmap size when item metadata is stale', () => {
        const args = imageDrawArgs(
            {
                x: 0,
                y: 0,
                width: 50,
                height: 50,
                naturalWidth: 9999,
                naturalHeight: 9999,
                crop: { x: 0, y: 0, width: 50, height: 50 }
            },
            { naturalWidth: 100, naturalHeight: 100 }
        );
        assert.deepEqual([args.sw, args.sh], [50, 50]);
        assert.equal(args.cropped, true);
    });

    it('cropMetrics maps the uncropped item to its own rect at bitmap density', () => {
        const metrics = cropMetrics({
            tool: 'image',
            mediaId: 'm1',
            x: 100,
            y: 200,
            width: 400,
            height: 200,
            naturalWidth: 800,
            naturalHeight: 400
        });
        assert.deepEqual(metrics.src, { x: 0, y: 0, width: 800, height: 400 });
        assert.equal(metrics.sx, 0.5);
        assert.equal(metrics.sy, 0.5);
        assert.equal(metrics.originX, 100);
        assert.equal(metrics.originY, 200);
        assert.deepEqual(cropLimitRect(metrics), {
            x: 100,
            y: 200,
            width: 400,
            height: 200
        });
    });

    it('cropLimitRect extrapolates the full original frame for a cropped item', () => {
        const metrics = cropMetrics({
            tool: 'image',
            mediaId: 'm1',
            x: 0,
            y: 0,
            width: 200,
            height: 100,
            naturalWidth: 800,
            naturalHeight: 400,
            crop: { x: 400, y: 100, width: 400, height: 200 }
        });
        assert.equal(metrics.sx, 0.5);
        assert.equal(metrics.sy, 0.5);
        assert.equal(metrics.originX, -200);
        assert.equal(metrics.originY, -50);
        assert.deepEqual(cropLimitRect(metrics), {
            x: -200,
            y: -50,
            width: 400,
            height: 200
        });
    });

    it('normalizeCropBox clamps a box into the frame without collapsing it', () => {
        const limit = { x: 10, y: 10, width: 100, height: 100 };
        assert.deepEqual(
            normalizeCropBox({ x: -50, y: -50, width: 200, height: 200 }, limit),
            { x: 10, y: 10, width: 100, height: 100 }
        );
        const tiny = normalizeCropBox({ x: 20, y: 20, width: 2, height: 2 }, limit);
        assert.equal(tiny.width, MIN_IMAGE_SIDE);
        assert.equal(tiny.height, MIN_IMAGE_SIDE);
        assert.deepEqual(
            normalizeCropBox({ x: 20, y: 20, width: 2, height: 2 }, limit, 2),
            { x: 20, y: 20, width: 2, height: 2 }
        );
        assert.equal(normalizeCropBox(null, limit), null);
    });

    it('resizeCropBox drags one edge and never leaves the frame', () => {
        const limit = { x: 0, y: 0, width: 200, height: 200 };
        const box = { x: 50, y: 50, width: 100, height: 100 };
        assert.deepEqual(
            resizeCropBox(box, 'e', 180, 50, limit),
            { x: 50, y: 50, width: 130, height: 100 }
        );
        assert.deepEqual(
            resizeCropBox(box, 'nw', 20, 30, limit),
            { x: 20, y: 30, width: 130, height: 120 }
        );
        // Clamped at the frame edge …
        assert.deepEqual(
            resizeCropBox(box, 'e', 500, 50, limit),
            { x: 50, y: 50, width: 150, height: 100 }
        );
        // … and never below the minimum side.
        assert.deepEqual(
            resizeCropBox(box, 'w', 149, 50, limit),
            { x: 126, y: 50, width: MIN_IMAGE_SIDE, height: 100 }
        );
        assert.equal(resizeCropBox(null, 'e', 1, 1, limit), null);
    });

    it('moveCropBox slides the window inside the frame', () => {
        const limit = { x: 0, y: 0, width: 200, height: 200 };
        const box = { x: 50, y: 50, width: 100, height: 100 };
        assert.deepEqual(
            moveCropBox(box, 20, -10, limit),
            { x: 70, y: 40, width: 100, height: 100 }
        );
        assert.deepEqual(
            moveCropBox(box, 500, 500, limit),
            { x: 100, y: 100, width: 100, height: 100 }
        );
    });

    it('boxToCropPatch maps a world box back to item geometry', () => {
        const metrics = cropMetrics({
            tool: 'image',
            mediaId: 'm1',
            x: 100,
            y: 200,
            width: 400,
            height: 200,
            naturalWidth: 800,
            naturalHeight: 400
        });
        const patch = boxToCropPatch(metrics, { x: 100, y: 200, width: 200, height: 100 });
        assert.deepEqual(patch, {
            x: 100,
            y: 200,
            width: 200,
            height: 100,
            crop: { x: 0, y: 0, width: 400, height: 200 }
        });
        assert.equal(boxToCropPatch(null, { x: 0, y: 0, width: 1, height: 1 }), null);
    });

    it('boxToCropPatch grows back out to the original frame', () => {
        const metrics = cropMetrics({
            tool: 'image',
            mediaId: 'm1',
            x: 0,
            y: 0,
            width: 200,
            height: 100,
            naturalWidth: 800,
            naturalHeight: 400,
            crop: { x: 400, y: 100, width: 400, height: 200 }
        });
        const limit = cropLimitRect(metrics);
        const patch = boxToCropPatch(metrics, limit);
        assert.deepEqual(patch, {
            x: -200,
            y: -50,
            width: 400,
            height: 200,
            crop: { x: 0, y: 0, width: 800, height: 400 }
        });
    });

    it('normalized live-drag boxes map back to item geometry', () => {
        const item = {
            tool: 'image',
            mediaId: 'm1',
            x: 10,
            y: 10,
            width: 100,
            height: 100,
            naturalWidth: 100,
            naturalHeight: 100
        };
        const metrics = cropMetrics(item);
        const box = normalizeCropBox({ x: -50, y: -50, width: 60, height: 60 }, cropLimitRect(metrics));
        assert.deepEqual(box, { x: 10, y: 10, width: 60, height: 60 });
        assert.deepEqual(boxToCropPatch(metrics, box), {
            x: 10,
            y: 10,
            width: 60,
            height: 60,
            crop: { x: 0, y: 0, width: 60, height: 60 }
        });
    });

    it('drawImageObject samples the crop window when the item is cropped', () => {
        const calls = [];
        const bitmap = { naturalWidth: 400, naturalHeight: 200 };
        drawImageObject(
            makeCtx(calls),
            {
                x: 10,
                y: 20,
                width: 100,
                height: 50,
                naturalWidth: 400,
                naturalHeight: 200,
                crop: { x: 200, y: 50, width: 200, height: 100 }
            },
            bitmap
        );
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0], [bitmap, 200, 50, 200, 100, 10, 20, 100, 50]);
    });

    it('drawImageObject draws full-frame when the item is not cropped', () => {
        const calls = [];
        const bitmap = { naturalWidth: 400, naturalHeight: 200 };
        drawImageObject(
            makeCtx(calls),
            { x: 10, y: 20, width: 100, height: 50, naturalWidth: 400, naturalHeight: 200 },
            bitmap
        );
        assert.deepEqual(calls[0], [bitmap, 10, 20, 100, 50]);
    });

    it('drawImageGhost paints the discarded original dimmed behind the crop', () => {
        const item = {
            mediaId: 'm1',
            x: 0,
            y: 0,
            width: 200,
            height: 100,
            naturalWidth: 800,
            naturalHeight: 400,
            crop: { x: 400, y: 100, width: 400, height: 200 }
        };
        const bitmap = { naturalWidth: 800, naturalHeight: 400 };
        const calls = [];
        const painted = drawImageGhost(
            makeCtx(calls),
            item,
            { img: bitmap, limitRect: { x: -200, y: -50, width: 400, height: 200 } }
        );
        assert.equal(painted, true);
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0], [bitmap, 0, 0, 800, 400, -200, -50, 400, 200]);
    });

    it('drawImageGhost skips uncropped items and missing bitmaps', () => {
        const calls = [];
        const full = {
            mediaId: 'm1',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            naturalWidth: 100,
            naturalHeight: 100
        };
        assert.equal(drawImageGhost(makeCtx(calls), full, { img: { naturalWidth: 100, naturalHeight: 100 } }), false);
        assert.equal(drawImageGhost(makeCtx(calls), full), false);
        assert.equal(calls.length, 0);
    });
});

