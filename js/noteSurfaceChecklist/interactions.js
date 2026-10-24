/** @module {"owns":"the delegated click/change/keydown handler behind a rendered checklist - checkbox toggles with done-section moves, copy, delete, indent/outdent, collapse, add-step and the Enter/arrow key paths", "related":["noteSurfaceChecklist.js","noteSurfaceChecklist/ops.js","noteSurfaceChecklist/collapse.js","noteSurfaceChecklist/targeting.js","dragdrop.js"]} */
import { CARD_ICONS } from '../icons.js';
import { getStepLevel, stepHasDescendants, indentChecklistSteps, outdentChecklistSteps, toggleStepCompletion, toggleGroupCompletion } from '../checklistSteps.js';
import { stripRichText } from '../richText.js';
import { syncItemBodyFromDom, commitInlineChecklistOp, flushDesktopAutoSave } from '../noteSurfaceMutations.js';
import { handleInlineEditArrowNav } from '../noteSurfaceEditing.js';
import { copyPlainTextToClipboard } from '../clipboard.js';
import { getChecklistCollapsedKeys, toggleChecklistDoneSection, toggleChecklistExpandCollapseAll } from './collapse.js';
import { findStepInsertionPosition } from './targeting.js';
import { setPendingChecklistFocus, syncFocusedStepTextToItem, insertChecklistStep, removeChecklistStepAndFocus, handleChecklistEnter, prepareInlineOpSnapshot } from './ops.js';

/**
 * Check if a target element is a checklist interaction element.
 * Used by dragdrop.js to determine if pointer events should yield to checklist interactions.
 * @param {Element} target - The target element to check
 * @returns {boolean} - True if the target is a checklist interaction element
 */
export function isChecklistInteraction(target) {
    if (!target) return false;
    return !!target.closest(
        '.step-check, .step-delete-btn, .step-collapse-btn, .grab-handle--step, ' +
        '.step-nest-controls, .step-row-actions, .expanded-checklist-add-btn, ' +
        '.checklist-expand-collapse-all-btn, .step-text, .checklist-done-toggle'
    );
}

/**
 * Bind all checklist action buttons (copy, delete, indent, outdent,
 * collapse/expand, checkbox toggle, add-step, done-section toggle,
 * expand/collapse-all). Call this after the checklist HTML is rendered.
 */
export function bindChecklistInteractions(root, item, {
    refresh = () => {},
    localOnly = false,
    onChange = () => {}
} = {}) {
    if (!root || !item) return;
    if (root.dataset.checklistInteractionsBound === item.id) return;
    root.dataset.checklistInteractionsBound = item.id;

    // --- step checkbox (toggle completion) ---
    // Update DOM immediately for responsive UX, then refresh to sync state.
    // Local class toggles (done section, completed text) show instant feedback;
    // refresh() ensures the done section moves on the board surface too.
    root.addEventListener('change', (e) => {
        const cb = e.target.closest('.step-check');
        if (!cb || !root.contains(cb)) return;
        const row = cb.closest('.step-row--display');
        if (!row) return;
        const stepId = row.dataset.stepId;
        if (!stepId) return;
        const step = (item.steps || []).find(s => s.id === stepId);
        if (!step) return;
        
        const newCompleted = cb.checked;
        const wasCompleted = step.completed;

        // Snapshot before mutating so undo/persist see the prior state.
        const beforeItem = wasCompleted !== newCompleted
            ? prepareInlineOpSnapshot(root, item, localOnly)
            : null;
        
        // Check if this is a parent step (has descendants)
        const stepIdx = (item.steps || []).findIndex(s => s.id === stepId);
        const hasDescendants = stepHasDescendants(item.steps, stepIdx);
        
        // For non-structural updates (checkbox toggle), update the model in place
        // and keep the DOM as a render of the model. Positions/order are untouched.
        if (wasCompleted !== newCompleted) {
            // Use group completion for parents, single for leaves
            let affectedStepIds;
            if (newCompleted && hasDescendants) {
                // Completing a parent: mark all descendants too
                affectedStepIds = toggleGroupCompletion(item.steps, stepId, newCompleted);
            } else {
                toggleStepCompletion(item.steps, stepId, newCompleted);
                affectedStepIds = [stepId];
            }
            
            // Update row classes for all affected rows
            const doneSection = root.querySelector('.checklist-done-section');
            const addBtn = root.querySelector('.expanded-checklist-add-btn');
            const doneToggle = root.querySelector('.checklist-done-toggle');
            
            // Collect all DOM rows for affected steps (in DOM order, parent first)
            const affectedRows = affectedStepIds
                .map(id => root.querySelector(`.step-row--display[data-step-id="${id}"]`))
                .filter(r => r)
                .sort((a, b) => a.comparePosition ? 0 : a.compareDocumentPosition(b) < 14 ? -1 : 1);
            
            // Update each row's classes
            for (const r of affectedRows) {
                r.classList.toggle('step-row--done', newCompleted);
                const stepTextEl = r.querySelector('.step-text');
                if (stepTextEl) {
                    stepTextEl.classList.toggle('completed', newCompleted);
                }
            }
            
            if (newCompleted && doneSection) {
                // Move all rows together to done section (in reverse order to maintain sequence)
                for (let i = affectedRows.length - 1; i >= 0; i--) {
                    doneSection.appendChild(affectedRows[i]);
                }
            } else if (!newCompleted && doneSection) {
                // When uncompleting, only the parent row is moved back
                // (children stay done -- they can be toggled individually)
                const parentRow = row;
                const insertRef = findStepInsertionPosition(parentRow, item, addBtn);
                if (insertRef) {
                    insertRef.parentNode.insertBefore(parentRow, insertRef.nextSibling);
                } else if (addBtn.parentNode) {
                    addBtn.parentNode.insertBefore(parentRow, addBtn);
                }
            }
            
            // Update done toggle visibility
            if (doneSection) {
                const doneRows = doneSection.querySelectorAll('.step-row--display');
                doneSection.classList.toggle('is-hidden', doneRows.length === 0);
                if (doneToggle) {
                    doneToggle.setAttribute('aria-expanded', doneRows.length > 0 ? 'true' : 'false');
                }
            }
        }
        
        // Always persist immediately — even in the modal (localOnly=true) — so
        // toggles are not lost if close races the debounced autosave.
        if (beforeItem) {
            syncItemBodyFromDom(root, item);
            commitInlineChecklistOp(item, beforeItem, { localOnly: false });
        }
        onChange();
        refresh();
    });

    // --- generic click delegation for all other step buttons ---
    root.addEventListener('click', (e) => {
        // --- step delete ---
        const delBtn = e.target.closest('.step-delete-btn');
        if (delBtn && root.contains(delBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const row = delBtn.closest('.step-row--display');
            const stepId = row?.dataset?.stepId;
            if (!stepId) return;
            const focusStepId = removeChecklistStepAndFocus(root, item, stepId, { localOnly, onChange });
            if (focusStepId) setPendingChecklistFocus(root, focusStepId, 'end');
            // Always refresh (matches indent/outdent) so the row disappears
            // immediately on the board surface too (localOnly=false), not just
            // in the modal editor.
            refresh();
            return;
        }

        // --- step copy ---
        const copyBtn = e.target.closest('.step-copy-btn');
        if (copyBtn && root.contains(copyBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const row = copyBtn.closest('.step-row--display');
            const stepId = row?.dataset?.stepId;
            if (!stepId) return;
            const step = (item.steps || []).find(s => s.id === stepId);
            if (!step) return;
            const text = stripRichText(step.text || '');
            copyPlainTextToClipboard(text);
            // Simple flash feedback without triggering circular import
            const prevTitle = copyBtn.getAttribute('title');
            const prevHtml = copyBtn.innerHTML;
            copyBtn.innerHTML = CARD_ICONS.save;
            copyBtn.setAttribute('title', 'Copied!');
            copyBtn.setAttribute('aria-label', 'Copied!');
            setTimeout(() => {
                copyBtn.innerHTML = prevHtml;
                if (prevTitle != null) copyBtn.setAttribute('title', prevTitle);
                else copyBtn.removeAttribute('title');
                copyBtn.setAttribute('aria-label', 'Copy step');
            }, 1400);
            return;
        }

 // --- step indent ---
          const indentBtn = e.target.closest('.step-indent-btn');
          if (indentBtn && root.contains(indentBtn)) {
              e.preventDefault();
              e.stopPropagation();
              if (indentBtn.disabled) return;
              const row = indentBtn.closest('.step-row--display');
              const stepId = row?.dataset?.stepId;
              if (!stepId) return;
              // Flush any pending autosave before DOM operations
              flushDesktopAutoSave(root, item);
              syncItemBodyFromDom(root, item);
              const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
              const stepIdx = item.steps.findIndex((s) => s.id === stepId);
              if (stepIdx < 0) return;
              indentChecklistSteps(item.steps, stepIdx);
              // Set pending focus so refreshNoteBody restores caret on the same step
              setPendingChecklistFocus(root, stepId, 'end');
              // Always persist immediately — even in the modal — matching Enter-split.
              if (beforeItem) commitInlineChecklistOp(item, beforeItem, { localOnly: false });
              onChange();
              // Full refresh so tree guides and button states update on ALL rows
              refresh();
              return;
          }

         // --- step outdent ---
         const outdentBtn = e.target.closest('.step-outdent-btn');
         if (outdentBtn && root.contains(outdentBtn)) {
             e.preventDefault();
             e.stopPropagation();
             if (outdentBtn.disabled) return;
             const row = outdentBtn.closest('.step-row--display');
             const stepId = row?.dataset?.stepId;
             if (!stepId) return;
             const step = (item.steps || []).find(s => s.id === stepId);
             if (!step || getStepLevel(step) <= 0) return;
             // Flush any pending autosave before DOM operations
             flushDesktopAutoSave(root, item);
             syncItemBodyFromDom(root, item);
             const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
             const stepIdx = item.steps.findIndex((s) => s.id === stepId);
             if (stepIdx < 0) return;
             outdentChecklistSteps(item.steps, stepIdx);
             // Set pending focus so refreshNoteBody restores caret on the same step
             setPendingChecklistFocus(root, stepId, 'end');
            // Always persist immediately — even in the modal — matching Enter-split.
            if (beforeItem) commitInlineChecklistOp(item, beforeItem, { localOnly: false });
            onChange();
            // Full refresh so tree guides and button states update on ALL rows
            refresh();
            return;
        }

        // --- step collapse/expand ---
        const collapseBtn = e.target.closest('.step-collapse-btn');
        if (collapseBtn && root.contains(collapseBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const key = collapseBtn.dataset.collapseKey;
            if (!key) return;
            const collapsed = getChecklistCollapsedKeys();
            if (collapsed[key]) {
                delete collapsed[key];
            } else {
                collapsed[key] = true;
            }
            localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
            refresh();
            return;
        }

        // --- expand/collapse all ---
        const expandAllBtn = e.target.closest('.checklist-expand-collapse-all-btn');
        if (expandAllBtn && root.contains(expandAllBtn)) {
            e.preventDefault();
            e.stopPropagation();
            toggleChecklistExpandCollapseAll(item);
            refresh();
            return;
        }

        // --- done section toggle ---
        const doneToggle = e.target.closest('.checklist-done-toggle');
        if (doneToggle && root.contains(doneToggle)) {
            e.preventDefault();
            e.stopPropagation();
            toggleChecklistDoneSection(item.id);
            refresh();
            return;
        }

    // --- add step ---
    const addBtn = e.target.closest('.expanded-checklist-add-btn');
    if (addBtn && root.contains(addBtn)) {
        e.preventDefault();
        e.stopPropagation();
        // Flush any pending autosave AND synchronously sync the focused step's
        // text to the model BEFORE inserting a new row. This prevents typed text
        // from being lost during re-render / rapid-fire clicks.
        flushDesktopAutoSave(root, item);
        syncFocusedStepTextToItem(root, item);
        const newStepId = insertChecklistStep(root, item, { localOnly, onChange });
        // The insert is surgical (row already in DOM). Do NOT call refresh() here —
        // a full re-render would race with the focused text sync. Focus is handled
        // by setPendingChecklistFocus on the next refresh cycle if needed.
        if (newStepId) setPendingChecklistFocus(root, newStepId, 'start');
        return;
    }
    });

    // --- step-text keydown: Enter creates sibling, Shift+Enter inserts line break ---
    root.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const active = e.target;
        if (!active?.classList?.contains('step-text')) return;
        e.preventDefault();
        const result = handleChecklistEnter(root, item, e, { localOnly, onChange });
        if (result === false) return;
        if (result === 'stay') return;
        // No refresh() - handleChecklistEnter does surgical DOM insertion
    });

    // --- step-text arrow key navigation: navigate between steps on visual edge ---
    root.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        const active = e.target;
        if (!active?.classList?.contains('step-text')) return;
        if (!handleInlineEditArrowNav(e, root, active)) return;
        e.preventDefault();
        e.stopPropagation();
    });
}
