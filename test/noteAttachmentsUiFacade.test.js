import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../js/noteAttachmentsUi.js';
import * as lightboxMath from '../js/noteAttachmentsUi/lightboxMath.js';

/**
 * The public surface of noteAttachmentsUi.js is frozen here on purpose: the
 * implementation lives in noteAttachmentsUi/*.js, and importers (app, editor,
 * magicFocus, noteSurfaceHtml, drawingBoard, mediaQuickActions, …) must never
 * have to change when a submodule is split further.
 */
const EXPECTED_EXPORTS = [
    'LIGHTBOX_DOODLE_COLORS',
    'LIGHTBOX_DOODLE_CUSTOM_INDEX',
    'LIGHTBOX_DOODLE_WIDTH',
    'LIGHTBOX_DOODLE_WIDTH_DEFAULT',
    'LIGHTBOX_DOODLE_WIDTH_MAX',
    'LIGHTBOX_DOODLE_WIDTH_MIN',
    'LIGHTBOX_ZOOM_MAX',
    'LIGHTBOX_ZOOM_MIN',
    'anchorLightboxPan',
    'bindNoteAttachments',
    'bindNoteCanvas',
    'buildNoteAttachmentsListHtml',
    'buildNoteAttachmentsSectionHtml',
    'buildNoteCanvasSectionHtml',
    'clampLightboxDoodleWidth',
    'clampLightboxZoom',
    'closeMediaLightbox',
    'dumpNoteCanvasState',
    'eraseLightboxDoodlesAt',
    'lightboxCanPan',
    'lightboxDoodleFromVisual',
    'lightboxDoodleToLayout',
    'lightboxDoodleToVisual',
    'lightboxFitScaleForRotation',
    'measureLightboxLayout',
    'nextLightboxZoom',
    'normalizeLightboxDoodleColor',
    'normalizeLightboxDoodlePoint',
    'normalizeLightboxRotation',
    'openMediaLightbox',
    'rotateLightboxStep',
    'sizeCanvasViewport',
    'stepLightboxDoodleWidth',
    'syncNoteAttachmentsDom',
    'syncNoteCanvasDom'
];

describe('noteAttachmentsUi facade', () => {
    it('exports exactly the documented surface', () => {
        assert.deepEqual(Object.keys(facade).sort(), EXPECTED_EXPORTS);
    });

    it('re-exports lightbox math as the same bindings, not copies', () => {
        for (const [name, value] of Object.entries(lightboxMath)) {
            assert.equal(facade[name], value, `${name} must be the lightboxMath binding`);
        }
    });

    it('keeps every non-math export callable', () => {
        for (const name of EXPECTED_EXPORTS) {
            if (name in lightboxMath) continue;
            assert.equal(typeof facade[name], 'function', `${name} must stay a function`);
        }
    });
});
