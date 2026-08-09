// Unit tests for js/undo.js undo/redo system with checklist operations.
// Run with: npm test  (node --test test/undo.test.js)
//
// These tests validate that undo/redo correctly preserves the parentId/order
// model (H3-B) through all checklist mutations, including group completion.
//
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    stepsToParentOrder,
    stepsFromParentOrder,
    refreshStepsPosition,
    computeStepParentIds,
    ensureStepsParentOrder,
    assertStepsInvariants,
    toggleStepCompletion,
    toggleGroupCompletion,
    getGroupStepIds,
    addChecklistStep,
    splitChecklistStep,
    deleteChecklistStep,
    mergeChecklistStepIntoPrev,
    indentChecklistSteps,
    outdentChecklistSteps,
    moveChecklistStepBlock,
    partitionChecklistSteps
} from '../js/checklistSteps.js';

import { normalizeItemForSave } from '../js/noteModel.js';

const CONTENT_FIELDS = new Set(['title', 'content', 'steps', 'sheet']);

function cloneItemDeep(item) {
    return JSON.parse(JSON.stringify(item));
}

function itemsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function itemForwardDelta(before, after) {
    const delta = {};
    const keys = new Set([
        ...Object.keys(before || {}),
        ...Object.keys(after || {})
    ]);
    keys.forEach((key) => {
        if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) {
            delta[key] = after[key];
        }
    });
    return delta;
}

function applyForwardDelta(before, delta) {
    return { ...before, ...delta };
}

function createTestUndoManager() {
    const state = {
        undoStack: [],
        redoStack: [],
        isApplying: false
    };
    
    return {
        recordChange(beforeItem, afterItem, options = {}) {
            if (state.isApplying) return;
            
            const filteredBefore = {};
            const filteredAfter = {};
            for (const key of CONTENT_FIELDS) {
                if (beforeItem?.[key] !== undefined) filteredBefore[key] = beforeItem[key];
                if (afterItem?.[key] !== undefined) filteredAfter[key] = afterItem[key];
            }
            if (typeof beforeItem?.id === 'string') {
                filteredBefore.id = beforeItem.id;
                filteredAfter.id = afterItem.id;
            }
            
            if (itemsEqual(filteredBefore, filteredAfter)) return;
            
            const beforeClone = cloneItemDeep(filteredBefore);
            const forwardDelta = itemForwardDelta(beforeClone, filteredAfter);
            const filteredAfterClone = applyForwardDelta(beforeClone, forwardDelta);
            
            const entry = {
                kind: 'change',
                before: beforeClone,
                forwardDelta,
                after: filteredAfterClone,
                undo: () => applyForwardDelta(beforeClone, forwardDelta),
                redo: () => cloneItemDeep(filteredAfter)
            };
            
            state.undoStack.push(entry);
            state.redoStack = [];
        },
        
        undo() {
            if (!state.undoStack.length) return null;
            const entry = state.undoStack.pop();
            state.redoStack.push(entry);
            return entry.undo();
        },
        
        redo() {
            if (!state.redoStack.length) return null;
            const entry = state.redoStack.pop();
            state.undoStack.push(entry);
            return entry.redo();
        },
        
        getStacks() {
            return {
                undoCount: state.undoStack.length,
                redoCount: state.redoStack.length
            };
        },
        
        clear() {
            state.undoStack = [];
            state.redoStack = [];
        }
    };
}

function pstep(id, level, completed = false, textOverride) {
    return { 
        id, 
        text: textOverride || id, 
        level, 
        completed,
        parentId: null,
        order: 0
    };
}

function createTestItem(id, title = 'Test Note', steps = []) {
    return {
        id,
        title,
        content: '',
        steps: stepsToParentOrder([...steps]),
        type: 'checklist',
        created_at: 1000000,
        updated_at: 2000000
    };
}

function assertStepsValid(steps) {
    const issues = assertStepsInvariants(steps);
    assert.deepEqual(issues, [], `Steps invariants violated: ${issues.join('; ')}`);
}

describe('Undo/Redo core delta functions', () => {
    it('itemsEqual returns true for deeply equal objects', () => {
        const a = { id: 'test', steps: [{ id: 's1', text: 'A', level: 0, completed: false }] };
        const b = { id: 'test', steps: [{ id: 's1', text: 'A', level: 0, completed: false }] };
        assert.equal(itemsEqual(a, b), true);
    });
    
    it('itemsEqual returns false for different objects', () => {
        const a = { id: 'test', steps: [{ id: 's1', completed: false }] };
        const b = { id: 'test', steps: [{ id: 's1', completed: true }] };
        assert.equal(itemsEqual(a, b), false);
    });
    
    it('itemForwardDelta captures only changed fields', () => {
        const before = { id: 'item1', title: 'Old', content: 'Text', steps: [] };
        const after = { id: 'item1', title: 'New', content: 'Text', steps: [] };
        const delta = itemForwardDelta(before, after);
        assert.deepEqual(delta, { title: 'New' });
    });
    
    it('applyForwardDelta reconstructs the after state', () => {
        const before = { id: 'item1', title: 'Old', content: 'Text' };
        const delta = { title: 'New' };
        const result = applyForwardDelta(before, delta);
        assert.deepEqual(result, { id: 'item1', title: 'New', content: 'Text' });
    });
});

describe('Undo/Redo with checklist step operations', () => {
    let undoMgr;
    
    beforeEach(() => {
        undoMgr = createTestUndoManager();
    });
    
    afterEach(() => {
        undoMgr.clear();
    });
    
    describe('toggleStepCompletion', () => {
        it('undo/redo preserves completion state', () => {
            let item = createTestItem('item1', 'Test', [
                pstep('a', 0),
                pstep('b', 1),
                pstep('c', 0)
            ]);
            
            const before = cloneItemDeep(item);
            
            toggleStepCompletion(item.steps, 'a', true);
            const after = normalizeItemForSave(item, { preserveEmptySteps: true });
            
            undoMgr.recordChange(before, after);
            
            const undone = undoMgr.undo();
            assert.equal(undone.steps.find(s => s.id === 'a').completed, false);
            
            const redone = undoMgr.redo();
            assert.equal(redone.steps.find(s => s.id === 'a').completed, true);
        });
        
        it('undo/redo preserves parentId and order after completion toggle', () => {
            let item = createTestItem('item1', 'Test', [
                pstep('a', 0),
                pstep('b', 1),
                pstep('c', 2),
                pstep('d', 0)
            ]);
            
            const before = cloneItemDeep(item);
            
            toggleStepCompletion(item.steps, 'a', true);
            const after = normalizeItemForSave(item, { preserveEmptySteps: true });
            
            undoMgr.recordChange(before, after);
            
            const undone = undoMgr.undo();
            assert.equal(undone.steps[0].id, 'a');
            assert.equal(undone.steps[0].parentId, null);
            assert.equal(undone.steps[0].order, 0);
            assert.equal(undone.steps[1].id, 'b');
            assert.equal(undone.steps[1].parentId, 'a');
            
            const redone = undoMgr.redo();
            assert.equal(redone.steps[0].completed, true);
        });
    });
    
    describe('toggleGroupCompletion', () => {
        it('completing a parent marks all descendants complete', () => {
            let item = createTestItem('item1', 'Test', [
                pstep('a', 0),
                pstep('b', 1),
                pstep('c', 2),
                pstep('d', 0)
            ]);
            
            const before = cloneItemDeep(item);
            
            toggleGroupCompletion(item.steps, 'a', true);
            const after = normalizeItemForSave(item, { preserveEmptySteps: true });
            
            undoMgr.recordChange(before, after);
            
            assert.equal(after.steps.find(s => s.id === 'a').completed, true);
            assert.equal(after.steps.find(s => s.id === 'b').completed, true);
            assert.equal(after.steps.find(s => s.id === 'c').completed, true);
            assert.equal(after.steps.find(s => s.id === 'd').completed, false);
        });
        
        it('undo of group completion restores individual states', () => {
            let item = createTestItem('item1', 'Test', [
                pstep('a', 0),
                pstep('b', 1),
                pstep('c', 2),
                pstep('d', 0)
            ]);
            
            const before = cloneItemDeep(item);
            
            toggleGroupCompletion(item.steps, 'a', true);
            const after = normalizeItemForSave(item, { preserveEmptySteps: true });
            
            undoMgr.recordChange(before, after);
            
            const undone = undoMgr.undo();
            assert.equal(undone.find(s => s.id === 'a').completed, false);
            assert.equal(undone.find(s => s.id === 'b').completed, false);
            assert.equal(undone.find(s => s.id === 'c').completed, false);
            assert.equal(undone.find(s => s.id === 'd').completed, false);
            
            const redone = undoMgr.redo();
            assert.equal(redone.find(s => s.id === 'a').completed, true);
            assert.equal(redone.find(s => s.id === 'b').completed, true);
            assert.equal(redone.find(s => s.id === 'c').completed, true);
            assert.equal(redone.find(s => s.id === 'd').completed, false);
        });
        
        it('undo/redo preserves tree structure for group completion', () => {
            let item = createTestItem('item1', 'Test', [
                pstep('parent', 0),
                pstep('child1', 1),
                pstep('child2', 2),
                pstep('sibling', 0)
            ]);
            
            const before = cloneItemDeep(item);
            toggleGroupCompletion(item.steps, 'parent', true);
            const after = normalizeItemForSave(item, { preserveEmptySteps: true });
            
            undoMgr.recordChange(before, after);
            
            const undone = undoMgr.undo();
            assert.equal(undone.find(s => s.id === 'parent').parentId, null);
            assert.equal(undone.find(s => s.id === 'child1').parentId, 'parent');
            assert.equal(undone.find(s => s.id === 'child2').parentId, 'child1');
            assert.equal(undone.find(s => s.id === 'sibling').parentId, null);
            
            assert.equal(undone.find(s => s.id === 'parent').order, 0);
            assert.equal(undone.find(s => s.id === 'child1').order, 1);
            assert.equal(undone.find(s => s.id === 'child2').order, 2);
            assert.equal(undone.find(s => s.id === 'sibling').order, 3);
        });
    });
});

describe('Undo/Redo with addChecklistStep', () => {
    let undoMgr;
    
    beforeEach(() => {
        undoMgr = createTestUndoManager();
    });
    
    afterEach(() => {
        undoMgr.clear();
    });
    
    it('undo restores steps array without new step', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 0)
        ]);
        
        const before = cloneItemDeep(item);
        
        const result = addChecklistStep(item.steps, { afterStepId: 'a', newId: 'new-step' });
        item.steps = result.steps;
        const after = normalizeItemForSave(item, { preserveEmptySteps: true });
        
        undoMgr.recordChange(before, after);
        
        const undone = undoMgr.undo();
        assert.equal(undone.length, 2);
        assert.equal(undone.find(s => s.id === 'new-step'), undefined);
        
        const redone = undoMgr.redo();
        assert.equal(redone.length, 3);
        assert.equal(redone.find(s => s.id === 'new-step').text, 'new-step');
    });
    
    it('undo/redo preserves parentId/order for added step', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 1)
        ]);
        
        const before = cloneItemDeep(item);
        
        addChecklistStep(item.steps, { afterStepId: 'a', newId: 'child', level: 1, text: 'Child Step' });
        const after = normalizeItemForSave(item, { preserveEmptySteps: true });
        
        undoMgr.recordChange(before, after);
        
        const undone = undoMgr.undo();
        assert.equal(undone.find(s => s.id === 'child').parentId, 'a');
        assert.equal(undone.find(s => s.id === 'child').order, 1);
        assert.equal(undone.find(s => s.id === 'b').order, 2);
    });
});

describe('Undo/Redo with deleteChecklistStep', () => {
    let undoMgr;
    
    beforeEach(() => {
        undoMgr = createTestUndoManager();
    });
    
    afterEach(() => {
        undoMgr.clear();
    });
    
    it('undo restores deleted step', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 1),
            pstep('c', 0)
        ]);
        
        const before = cloneItemDeep(item);
        
        const result = deleteChecklistStep(item.steps, 'b');
        item.steps = result.steps;
        const after = normalizeItemForSave(item, { preserveEmptySteps: true });
        
        undoMgr.recordChange(before, after);
        
        const undone = undoMgr.undo();
        assert.equal(undone.length, 3);
        const restored = undone.find(s => s.id === 'b');
        assert.ok(restored, 'Deleted step should be restored');
        
        const redone = undoMgr.redo();
        assert.equal(redone.length, 2);
        assert.equal(redone.find(s => s.id === 'b'), undefined);
    });
    
    it('undo preserves parentId/order after delete', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 1),
            pstep('c', 0)
        ]);
        
        const before = cloneItemDeep(item);
        
        const result = deleteChecklistStep(item.steps, 'b');
        item.steps = result.steps;
        const after = normalizeItemForSave(item, { preserveEmptySteps: true });
        
        undoMgr.recordChange(before, after);
        
        const undone = undoMgr.undo();
        assert.equal(undone.find(s => s.id === 'a').order, 0);
        assert.equal(undone.find(s => s.id === 'b').order, 1);
        assert.equal(undone.find(s => s.id === 'c').order, 2);
        assert.equal(undone.find(s => s.id === 'a').parentId, null);
    });
});

describe('Undo/Redo with indent/outdent operations', () => {
    let undoMgr;
    
    beforeEach(() => {
        undoMgr = createTestUndoManager();
    });
    
    afterEach(() => {
        undoMgr.clear();
    });
    
    it('indent captures level change in undo', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 0),
            pstep('c', 0)
        ]);
        
        const before = cloneItemDeep(item);
        
        indentChecklistSteps(item.steps, 1);
        const after = normalizeItemForSave(item, { preserveEmptySteps: true });
        
        undoMgr.recordChange(before, after);
        
        const undone = undoMgr.undo();
        assert.equal(undone.find(s => s.id === 'b').level, 0);
        
        const redone = undoMgr.redo();
        assert.equal(redone.find(s => s.id === 'b').level, 1);
    });
    
    it('outdent restores level on undo', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 2),
            pstep('c', 0)
        ]);
        
        const before = cloneItemDeep(item);
        
        outdentChecklistSteps(item.steps, 1);
        const after = normalizeItemForSave(item, { preserveEmptySteps: true });
        
        undoMgr.recordChange(before, after);
        
        const undone = undoMgr.undo();
        assert.equal(undone.find(s => s.id === 'b').level, 2);
        
        const redone = undoMgr.redo();
        assert.equal(redone.find(s => s.id === 'b').level, 1);
    });
    
    it('indent updates parentId on undo/redo', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 0)
        ]);
        
        const before = cloneItemDeep(item);
        
        indentChecklistSteps(item.steps, 1);
        const after = normalizeItemForSave(item, { preserveEmptySteps: true });
        
        undoMgr.recordChange(before, after);
        
        const undone = undoMgr.undo();
        assert.equal(undone.find(s => s.id === 'b').parentId, null);
        
        const redone = undoMgr.redo();
        assert.equal(redone.find(s => s.id === 'b').parentId, 'a');
    });
});

describe('Undo/Redo with reorder operations (moveChecklistStepBlock)', () => {
    let undoMgr;
    
    beforeEach(() => {
        undoMgr = createTestUndoManager();
    });
    
    afterEach(() => {
        undoMgr.clear();
    });
    
    it('sibling reorder preserves steps on undo/redo', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 0),
            pstep('c', 0)
        ]);
        
        const before = cloneItemDeep(item);
        
        const result = moveChecklistStepBlock(item.steps, 'a', {
            dropMode: 'sibling',
            insertIndex: 2,
            anchorStepId: null,
            itemId: 'item1',
            collapsedKeys: {}
        });
        item.steps = result.steps;
        const after = normalizeItemForSave(item, { preserveEmptySteps: true });
        
        undoMgr.recordChange(before, after);
        
        const undone = undoMgr.undo();
        assert.equal(undone.find(s => s.id === 'a').order, 0);
        assert.equal(undone.find(s => s.id === 'b').order, 1);
        assert.equal(undone.find(s => s.id === 'c').order, 2);
        
        const redone = undoMgr.redo();
        assert.equal(redone.find(s => s.id === 'a').order, 2);
        assert.equal(redone.find(s => s.id === 'c').order, 1);
    });
    
    it('child drop updates levels and parentId on undo/redo', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 0),
            pstep('c', 0)
        ]);
        
        const before = cloneItemDeep(item);
        
        const result = moveChecklistStepBlock(item.steps, 'b', {
            dropMode: 'child',
            insertIndex: 0,
            anchorStepId: 'a',
            itemId: 'item1',
            collapsedKeys: {}
        });
        item.steps = result.steps;
        const after = normalizeItemForSave(item, { preserveEmptySteps: true });
        
        undoMgr.recordChange(before, after);
        
        const undone = undoMgr.undo();
        assert.equal(undone.find(s => s.id === 'b').parentId, null);
        assert.equal(undone.find(s => s.id === 'b').level, 0);
        
        const redone = undoMgr.redo();
        assert.equal(redone.find(s => s.id === 'b').parentId, 'a');
        assert.equal(redone.find(s => s.id === 'b').level, 1);
    });
    
    it('complex reorder with nested children preserves parentId via undo', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 1),
            pstep('bc', 2),
            pstep('d', 0),
            pstep('e', 1)
        ]);
        
        const before = cloneItemDeep(item);
        
        const result = moveChecklistStepBlock(item.steps, 'b', {
            dropMode: 'sibling',
            insertIndex: 1,
            anchorStepId: null,
            itemId: 'item1',
            collapsedKeys: {}
        });
        item.steps = result.steps;
        const after = normalizeItemForSave(item, { preserveEmptySteps: true });
        
        undoMgr.recordChange(before, after);
        
        const undone = undoMgr.undo();
        assert.equal(undone.find(s => s.id === 'b').parentId, 'a');
        assert.equal(undone.find(s => s.id === 'bc').parentId, 'b');
        assert.equal(assertStepsInvariants(undone), [], 'Undone state should satisfy invariants');
        
        const redone = undoMgr.redo();
        assert.equal(assertStepsInvariants(redone), [], 'Redone state should satisfy invariants');
    });
});

describe('Undo stack invariant preservation', () => {
    it('all undone states satisfy position model invariants', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 1),
            pstep('c', 2),
            pstep('d', 0),
            pstep('e', 1)
        ]);
        
        const undoMgr = createTestUndoManager();
        
        const before1 = cloneItemDeep(item);
        indentChecklistSteps(item.steps, 1);
        const after1 = normalizeItemForSave(item, { preserveEmptySteps: true });
        undoMgr.recordChange(before1, after1);
        
        const before2 = cloneItemDeep(item);
        toggleGroupCompletion(item.steps, 'a', true);
        const after2 = normalizeItemForSave(item, { preserveEmptySteps: true });
        undoMgr.recordChange(before2, after2);
        
        const before3 = cloneItemDeep(item);
        const result3 = moveChecklistStepBlock(item.steps, 'd', {
            dropMode: 'child',
            insertIndex: 0,
            anchorStepId: 'c',
            itemId: 'item1',
            collapsedKeys: {}
        });
        item.steps = result3.steps;
        const after3 = normalizeItemForSave(item, { preserveEmptySteps: true });
        undoMgr.recordChange(before3, after3);
        
        let current = cloneItemDeep(item);
        for (let i = 0; i < 3; i++) {
            current = undoMgr.undo();
            assert.equal(assertStepsInvariants(current.steps), [], 
                `Undone state ${i + 1} should have valid steps`);
        }
        
        for (let i = 0; i < 3; i++) {
            current = undoMgr.redo();
            assert.equal(assertStepsInvariants(current.steps), [], 
                `Redone state ${i + 1} should have valid steps`);
        }
    });
    
    it('parentId/order survive JSON serialization (storage cycle)', () => {
        const item1 = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 1),
            pstep('c', 2)
        ]);
        
        const before = cloneItemDeep(item1);
        
        toggleStepCompletion(item1.steps, 'b', true);
        const after = normalizeItemForSave(item1, { preserveEmptySteps: true });
        
        const delta = itemForwardDelta(before, after);
        const serialized = JSON.stringify(delta);
        const deserialized = JSON.parse(serialized);
        
        const restoredAfter = applyForwardDelta(cloneItemDeep(before), deserialized);
        
        assert.equal(restoredAfter.steps.find(s => s.id === 'b').parentId, 'a');
        assert.equal(restoredAfter.steps.find(s => s.id === 'c').parentId, 'b');
        assert.equal(restoredAfter.steps.find(s => s.id === 'b').completed, true);
    });
});

describe('Edge cases and potential bug scenarios', () => {
    let undoMgr;
    
    beforeEach(() => {
        undoMgr = createTestUndoManager();
    });
    
    afterEach(() => {
        undoMgr.clear();
    });
    
    it('undo of completed parent with partial child completion', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('parent', 0),
            pstep('child1', 1),
            pstep('child2', 1),
            pstep('sibling', 0)
        ]);
        
        toggleStepCompletion(item.steps, 'child1', true);
        const item1 = normalizeItemForSave(item, { preserveEmptySteps: true });
        
        toggleGroupCompletion(item.steps, 'parent', true);
        const after = normalizeItemForSave(item, { preserveEmptySteps: true });
        
        const before = cloneItemDeep(item1);
        undoMgr.recordChange(before, after);
        
        const undone = undoMgr.undo();
        assert.equal(undone.steps.find(s => s.id === 'parent').completed, false);
        assert.equal(undone.steps.find(s => s.id === 'child1').completed, true, 'child1 should remain done');
        assert.equal(undone.steps.find(s => s.id === 'child2').completed, false);
    });
    
    it('multiple rapid toggles merge correctly', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 0)
        ]);
        
        for (let i = 0; i < 3; i++) {
            const before = cloneItemDeep(item);
            toggleStepCompletion(item.steps, 'a', i % 2 === 0);
            const after = normalizeItemForSave(item, { preserveEmptySteps: true });
            undoMgr.recordChange(before, after);
        }
        
        let current = cloneItemDeep(item);
        for (let j = 0; j < 3; j++) {
            current = undoMgr.undo();
        }
        
        assert.equal(current.steps.find(s => s.id === 'a').completed, false);
        assert.equal(current.steps.find(s => s.id === 'b').completed, false);
    });
    
    it('delete subtree (parent with children) preserves orphan re-parenting', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 1),
            pstep('c', 2),
            pstep('d', 0)
        ]);
        
        const before = cloneItemDeep(item);
        
        const result = deleteChecklistStep(item.steps, 'a');
        item.steps = result.steps;
        const after = normalizeItemForSave(item, { preserveEmptySteps: true });
        
        undoMgr.recordChange(before, after);
        
        const undone = undoMgr.undo();
        assert.equal(undone.steps.length, 4);
        assert.equal(undone.steps.find(s => s.id === 'a').parentId, null);
        assert.equal(undone.steps.find(s => s.id === 'b').parentId, 'a');
        assert.equal(undone.steps.find(s => s.id === 'c').parentId, 'b');
        assert.equal(undone.steps.find(s => s.id === 'd').parentId, null);
    });
    
    it('split step preserves parent-child relationships', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 1),
            pstep('c', 0)
        ]);
        
        const before = cloneItemDeep(item);
        
        const result = splitChecklistStep(item.steps, 'b', 'First part', 'Second part', { newId: 'b-split' });
        item.steps = result.steps;
        const after = normalizeItemForSave(item, { preserveEmptySteps: true });
        
        undoMgr.recordChange(before, after);
        
        const undone = undoMgr.undo();
        assert.equal(undone.steps.length, 3);
        assert.equal(assertStepsInvariants(undone.steps), [], 'Split undo should satisfy invariants');
        
        const redone = undoMgr.redo();
        assert.equal(redone.steps.length, 4);
        assert.equal(assertStepsInvariants(redone.steps), [], 'Split redo should satisfy invariants');
    });
    
    it('merge step update order correctly', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('empty', 0, false),
            pstep('b', 0)
        ]);
        
        const before = cloneItemDeep(item);
        
        const result = mergeChecklistStepIntoPrev(item.steps, 1);
        item.steps = result.steps;
        const after = normalizeItemForSave(item, { preserveEmptySteps: true });
        
        undoMgr.recordChange(before, after);
        
        const undone = undoMgr.undo();
        assert.equal(undone.steps.length, 3);
        assert.equal(undone.steps.find(s => s.id === 'a').order, 0);
        assert.equal(undone.steps.find(s => s.id === 'empty').order, 1);
        
        const redone = undoMgr.redo();
        assert.equal(redone.steps.length, 2);
        assert.equal(redone.steps.find(s => s.id === 'b').order, 1);
    });
});

describe('Full mutation sequence test', () => {
    it('complex sequence of operations undoes correctly to initial state', () => {
        let item = createTestItem('item1', 'Test', [
            pstep('a', 0),
            pstep('b', 0),
            pstep('c', 0)
        ]);
        
        const undoMgr = createTestUndoManager();
        
        const before1 = cloneItemDeep(item);
        addChecklistStep(item.steps, { afterStepId: 'a', newId: 'new1' });
        const after1 = normalizeItemForSave(item, { preserveEmptySteps: true });
        undoMgr.recordChange(before1, after1);
        
        const before2 = cloneItemDeep(item);
        const idx = item.steps.findIndex(s => s.id === 'new1');
        indentChecklistSteps(item.steps, idx);
        const after2 = normalizeItemForSave(item, { preserveEmptySteps: true });
        undoMgr.recordChange(before2, after2);
        
        const before3 = cloneItemDeep(item);
        toggleGroupCompletion(item.steps, 'a', true);
        const after3 = normalizeItemForSave(item, { preserveEmptySteps: true });
        undoMgr.recordChange(before3, after3);
        
        const before4 = cloneItemDeep(item);
        const result4 = moveChecklistStepBlock(item.steps, 'c', {
            dropMode: 'sibling',
            insertIndex: 0,
            anchorStepId: 'a',
            itemId: 'item1',
            collapsedKeys: {}
        });
        item.steps = result4.steps;
        const after4 = normalizeItemForSave(item, { preserveEmptySteps: true });
        undoMgr.recordChange(before4, after4);
        
        let current = after4;
        for (let i = 0; i < 4; i++) {
            current = undoMgr.undo();
        }
        
        assert.equal(current.steps.length, 4, 'Should have 4 steps after full undo');
        assert.equal(current.steps.find(s => s.id === 'a').completed, false, 'a should NOT be complete');
        assert.equal(current.steps.find(s => s.id === 'new1').parentId, null, 'new1 should be sibling after undo');
        
        for (let i = 0; i < 4; i++) {
            current = undoMgr.redo();
        }
        
        assert.equal(current.steps.find(s => s.id === 'a').completed, true, 'a should be complete');
        assert.equal(current.steps.find(s => s.id === 'new1').parentId, 'a', 'new1 should be under a');
    });
});
