// Unit tests for js/canvasImages.js helpers (geometry/size; no real Image/blob in Node).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    initialImageSize,
    drawImageObject,
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
