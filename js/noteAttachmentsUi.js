/** @module {"owns":"note card attached-media section HTML and hydrate", "related":["noteAttachmentsUi/lightbox.js","noteAttachmentsUi/lightboxMath.js","noteAttachmentsUi/media.js","noteAttachmentsUi/canvas.js","noteAttachmentsUi/shared.js","mediaAttachments.js","mediaLibrary.js","noteSurfaceHtml.js","mediaLibraryOverlay.js","mediaQuickActions.js","scribbleInk.js"]} */
// Facade: every implementation file lives one level down. The public surface
// stays on this module so existing importers and tests resolve unchanged names.
export {
    LIGHTBOX_ZOOM_MIN,
    LIGHTBOX_ZOOM_MAX,
    normalizeLightboxRotation,
    rotateLightboxStep,
    clampLightboxZoom,
    nextLightboxZoom,
    anchorLightboxPan,
    lightboxFitScaleForRotation,
    lightboxCanPan,
    LIGHTBOX_DOODLE_COLORS,
    LIGHTBOX_DOODLE_CUSTOM_INDEX,
    LIGHTBOX_DOODLE_WIDTH,
    LIGHTBOX_DOODLE_WIDTH_MIN,
    LIGHTBOX_DOODLE_WIDTH_MAX,
    LIGHTBOX_DOODLE_WIDTH_DEFAULT,
    clampLightboxDoodleWidth,
    stepLightboxDoodleWidth,
    normalizeLightboxDoodleColor,
    eraseLightboxDoodlesAt,
    normalizeLightboxDoodlePoint,
    lightboxDoodleToLayout,
    lightboxDoodleFromVisual,
    lightboxDoodleToVisual
} from './noteAttachmentsUi/lightboxMath.js';

export {
    measureLightboxLayout,
    openMediaLightbox,
    closeMediaLightbox
} from './noteAttachmentsUi/lightbox.js';

export {
    buildNoteAttachmentsListHtml,
    buildNoteAttachmentsSectionHtml,
    syncNoteAttachmentsDom,
    bindNoteAttachments
} from './noteAttachmentsUi/media.js';

export {
    sizeCanvasViewport,
    buildNoteCanvasSectionHtml,
    syncNoteCanvasDom,
    bindNoteCanvas,
    dumpNoteCanvasState
} from './noteAttachmentsUi/canvas.js';
