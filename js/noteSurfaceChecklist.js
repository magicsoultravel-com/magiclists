/** @module {"owns":"checklist operations, drag/drop, state management", "related":["noteSurface.js","checklistSteps.js","noteBodyConversion.js","richText.js","noteSurfaceChecklist/collapse.js","noteSurfaceChecklist/ops.js"], "events":[]} */
// Barrel for the split-out checklist surface. The work lives in
// js/noteSurfaceChecklist/:
//
//   rows.js          markup for one step row (checkbox, text, controls, guides)
//   collapse.js      which groups/done sections are collapsed + expand-all UI
//   targeting.js     what is on screen right now; where a pointer lands
//   ops.js           insert/remove and the Backspace/Delete/Enter key paths
//   drag.js          pointer drag reordering
//   interactions.js  the delegated click/change/keydown handler
//
// Nothing but re-exports belongs in this file: callers import from here so the
// public surface stays one module, and a caller that needs a single cluster
// should reach for its submodule directly.
export {
    getChecklistCollapsedKeys,
    getChecklistDoneCollapsed,
    toggleChecklistDoneSection,
    toggleChecklistExpandCollapseAll,
    expandChecklistAncestorsForStep,
    isChecklistDoneSectionCollapsed,
    getChecklistCollapsibleKeys,
    checklistGroupsAnyExpanded,
    collapseAllChecklistGroups,
    expandAllChecklistGroups,
    buildChecklistExpandCollapseAllHtml
} from './noteSurfaceChecklist/collapse.js';
export {
    attachChecklistDrag
} from './noteSurfaceChecklist/drag.js';
export {
    isChecklistInteraction,
    bindChecklistInteractions
} from './noteSurfaceChecklist/interactions.js';
export {
    insertChecklistStep,
    removeChecklistStepAndFocus,
    handleChecklistEnter,
    prepareInlineOpSnapshot,
    handleChecklistBackspace,
    handleChecklistDelete,
    createStepId
} from './noteSurfaceChecklist/ops.js';
export {
    buildChecklistRowHtml
} from './noteSurfaceChecklist/rows.js';
export {
    getActiveRows
} from './noteSurfaceChecklist/targeting.js';
