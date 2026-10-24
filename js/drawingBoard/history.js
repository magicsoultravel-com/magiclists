/** @module {"owns":"magicCanvas undo/redo stacks and their toolbar wiring","related":["drawingBoard.js","drawingBoardCore.js","drawingBoard/document.js"]} */
import { HISTORY_MAX } from '../drawingBoardCore.js';

export function trimDrawingStack(stack) {
    while (stack.length > HISTORY_MAX) stack.shift();
}

export class DrawingHistory {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.onChange = null;
    }
    /** Fire after every stack move so the toolbar follows canUndo/canRedo. */
    notifyChange() {
        if (typeof this.onChange === 'function') this.onChange();
    }
    push(snapshot) {
        const serialized = JSON.stringify(snapshot);
        // Defence in depth: a repeat of the newest entry means nothing changed,
        // so it would only light up Undo for a step that cannot do anything.
        if (this.undoStack[this.undoStack.length - 1] === serialized) return;
        this.undoStack.push(serialized);
        trimDrawingStack(this.undoStack);
        this.redoStack = [];
        this.notifyChange();
    }
    undo(current) {
        if (!this.undoStack.length) return null;
        this.redoStack.push(JSON.stringify(current));
        trimDrawingStack(this.redoStack);
        const snapshot = JSON.parse(this.undoStack.pop());
        this.notifyChange();
        return snapshot;
    }
    redo(current) {
        if (!this.redoStack.length) return null;
        this.undoStack.push(JSON.stringify(current));
        trimDrawingStack(this.undoStack);
        const snapshot = JSON.parse(this.redoStack.pop());
        this.notifyChange();
        return snapshot;
    }
    clear() {
        const had = this.undoStack.length > 0 || this.redoStack.length > 0;
        this.undoStack = [];
        this.redoStack = [];
        if (had) this.notifyChange();
    }
    get canUndo() { return this.undoStack.length > 0; }
    get canRedo() { return this.redoStack.length > 0; }
}

/**
 * Bind a board's history stacks to its toolbar affordances. Every mutation path
 * pushes through DrawingHistory, so this is the single place that keeps the
 * undo/redo buttons honest between full toolbar renders.
 */
export function wireHistoryToolbar(board) {
    board.history.onChange = () => board.updateToolbarState();
}
