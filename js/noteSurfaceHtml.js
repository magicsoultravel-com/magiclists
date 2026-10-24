/** @module {"owns":"note HTML facade - re-exports the card/body/shell/checklist builders from js/noteSurfaceHtml/*; NoteSurface and magicFocus.js import the whole surface from here", "related":["noteSurfaceHtml/card.js","noteSurfaceHtml/shell.js","noteSurfaceHtml/body.js","noteSurfaceHtml/checklistMarkup.js","noteSurfaceHtml/metaFooter.js","noteSurfaceHtml/quickActions.js","noteSurface.js"], "events":[]} */
export { buildNoteQuickActionsHtml } from './noteSurfaceHtml/quickActions.js';

export {
    buildNoteMetaFooterHtml,
    formatNoteLineCount,
    computeNoteSizeKb,
    computeNoteLineCount
} from './noteSurfaceHtml/metaFooter.js';

export { buildExpandedChecklistHtml } from './noteSurfaceHtml/checklistMarkup.js';

export {
    resolveNoteBodyVisibility,
    buildNoteBodyHtml,
    buildNoteContentFieldHtml,
    buildNoteBodyConvertButtonsHtml,
    updateConvertButtons,
    renderRichHtml,
    canInlineEditText,
    prepareContentForEdit,
    buildNoteBodySection,
    bindNoteBodySections,
    bindNoteContentSubToggles,
    buildMeetingBodyHtml
} from './noteSurfaceHtml/body.js';

export {
    buildNoteTitleHtml,
    buildNoteFormatPanelHtml,
    buildNoteConfigPanelHtml,
    buildNoteEditorShell,
    bindCollapsable,
    flashCopyFeedback
} from './noteSurfaceHtml/shell.js';

export {
    applyItemCardTheme,
    applyCardCategoryBand,
    createCardComponent,
    renderBoardEditorCard,
    refreshBoardChecklistBody,
    refreshBoardEditorCard,
    refreshNoteBody
} from './noteSurfaceHtml/card.js';

// Re-exported for callers that import the checklist row builder from this module.
export { buildChecklistRowHtml } from './noteSurfaceChecklist.js';
