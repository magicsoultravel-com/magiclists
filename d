import re

with open('d:/Projekt/magiclists/js/noteSurfaceChecklist.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add collectStepSubtree to the first checklistSteps import
content = content.replace(
    "import { getStepLevel, partitionChecklistSteps, checklistHasIndentations, stepHasDescendants } from './checklistSteps.js';",
    "import { getStepLevel, partitionChecklistSteps, checklistHasIndentations, stepHasDescendants, collectStepSubtree } from './checklistSteps.js';"
)

# 2. Add splitInlineEditAtCaret and insertTextAtCaret to the noteSurfaceEditing import
content = content.replace(
    "import { focusInlineEdit, canInlineEditText, renderRichHtml } from './noteSurfaceEditing.js';",
    "import { focusInlineEdit, canInlineEditText, renderRichHtml, splitInlineEditAtCaret, insertTextAtCaret } from './noteSurfaceEditing.js';"
)

# 3. Add SOFT_BREAK constant after DRAG_THRESHOLD
content = content.replace(
    'const DRAG_THRESHOLD = 4;\n',
    'const DRAG_THRESHOLD = 4;\nconst SOFT_BREAK = "\u2028";\n'
)

# 4. Replace the handleChecklistEnter function
old_func = """export function handleChecklistEnter(e, item, { localOnly = false, onChange = () => {} } = {}) {
    if (!item || !item.steps) return false;
    const active = document.activeElement;
    if (!active?.classList?.contains('step-text')) return false;

    const stepId = active.dataset.stepId;
    const stepIdx = item.steps.findIndex((s) => s.id === stepId);
    if (stepIdx < 0) return false;

    const step = item.steps[stepIdx];
    const text = active.textContent || '';

    if (e.shiftKey) {
        // Shift+Enter: create a nested step (level + 1)
        const newStep = {
            id: createStepId(),
            text: '',
            completed: false,
            level: getStepLevel(step) + 1
        };
        item.steps.splice(stepIdx + 1, 0, newStep);

        if (!localOnly) {
            mutateItem(item, () => {}, { preserveView: true, skipRerender: true });
        }
        onChange();
        return true;
    }

    // Enter: create a sibling step (same level)
    insertChecklistStep(item, {
        afterStepId: stepId,
        text: '',
        localOnly,
        onChange
    });
    return true;
}"""

new_func = """export function handleChecklistEnter(e, item, { localOnly = false, onChange = () => {} } = {}) {
    if (!item || !item.steps) return false;
    const active = document.activeElement;
    if (!active?.classList?.contains('step-text')) return false;

    const stepId = active.dataset.stepId;
    const stepIdx = item.steps.findIndex((s) => s.id === stepId);
    if (stepIdx < 0) return false;

    const step = item.steps[stepIdx];
    const text = active.textContent || '';

    if (e.shiftKey) {
        // Shift+Enter: insert a soft line break within the same step text
        insertTextAtCaret(active, SOFT_BREAK);
        syncStepTextToItem(active, item);
        if (!localOnly) {
            mutateItem(item, () => {}, { preserveView: true, skipRerender: true });
        }
        onChange();
        return { wasShiftEnter: true };
    }

    // Enter: split text at caret position and create a new step
    const { before, after } = splitInlineEditAtCaret(active);
    
    // Update current step's text to be the "before" part
    step.text = before;
    
    // Find the correct insertion index (after the current step's subtree)
    const subtree = collectStepSubtree(item.steps, stepIdx);
    const insertIdx = stepIdx + subtree.length;
    
    // Create a new step with the "after" text
    const newStep = {
        id: createStepId(),
        text: after,
        completed: false,
        level: getStepLevel(step)
    };
    
    item.steps.splice(insertIdx, 0, newStep);

    if (!localOnly) {
        mutateItem(item, () => {}, { preserveView: true, skipRerender: true });
    }
    onChange();
    return { wasShiftEnter: false };
}"""

content = content.replace(old_func, new_func)

with open('d:/Projekt/magiclists/js/noteSurfaceChecklist.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('All changes applied successfully')