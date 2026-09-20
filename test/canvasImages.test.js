// Unit tests for js/canvasImages.js helpers (geometry/size; no real Image/blob in Node).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    initialImageSize,
    drawImageObject,
    getImageSourceWindow,
    imageDrawArgs,
    computeImageCrop,
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

    it('computeImageCrop keeps a quadrant and maps it to the source window', () => {
        const item = {
            tool: 'image',
            mediaId: 'm1',
            x: 100,
            y: 200,
            width: 400,
            height: 200,
            naturalWidth: 800,
            naturalHeight: 400
        };
        const patch = computeImageCrop(item, { minX: 100, minY: 200, maxX: 300, maxY: 300 });
        assert.deepEqual(patch, {
            x: 100,
            y: 200,
            width: 200,
            height: 100,
            crop: { x: 0, y: 0, width: 400, height: 200 }
        });
    });

    it('computeImageCrop composes on an already cropped image', () => {
        const item = {
            tool: 'image',
            mediaId: 'm1',
            x: 0,
            y: 0,
            width: 200,
            height: 100,
            naturalWidth: 800,
            naturalHeight: 400,
            crop: { x: 400, y: 100, width: 400, height: 200 }
        };
        const patch = computeImageCrop(item, { minX: 100, minY: 50, maxX: 200, maxY: 100 });
        assert.deepEqual(patch, {
            x: 100,
            y: 50,
            width: 100,
            height: 50,
            crop: { x: 600, y: 200, width: 200, height: 100 }
        });
    });

    it('computeImageCrop clamps a rect that extends past the image', () => {
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
        const patch = computeImageCrop(item, { minX: -50, minY: -50, maxX: 60, maxY: 60 });
        assert.deepEqual(patch, {
            x: 10,
            y: 10,
            width: 50,
            height: 50,
            crop: { x: 0, y: 0, width: 50, height: 50 }
        });
    });

    it('computeImageCrop rejects a miss or a too-small rect', () => {
        const item = {
            tool: 'image',
            mediaId: 'm1',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            naturalWidth: 100,
            naturalHeight: 100
        };
        assert.equal(computeImageCrop(item, { minX: 200, minY: 200, maxX: 300, maxY: 300 }), null);
        assert.equal(computeImageCrop(item, { minX: 0, minY: 0, maxX: 4, maxY: 4 }), null);
        assert.ok(computeImageCrop(item, { minX: 0, minY: 0, maxX: 4, maxY: 4 }, { minSide: 2 }));
        assert.equal(computeImageCrop(null, { minX: 0, minY: 0, maxX: 4, maxY: 4 }), null);
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
});

