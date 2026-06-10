/** @tool {"label":"Sudoku","order":8,"wide":true,"resizable":true,"resizeMode":"scale","mountClass":"tool-mount--sudoku","defaultSize":{"w":420,"h":640},"minSize":{"w":340,"h":480}} */
/** @tool-icon <rect x="2.2" y="2.2" width="7.6" height="7.6" rx="0.6" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M2.2 5.1h7.6M2.2 7.9h7.6M5.1 2.2v7.6M7.9 2.2v7.6" fill="none" stroke="currentColor" stroke-width="0.75"/> */
import { SudokuGame } from './sudoku-core/app.js';

export const Sudoku = {
    init(mountElement) {
        this.mount = mountElement;
        return SudokuGame.open(mountElement);
    },

    destroy() {
        SudokuGame.destroy();
        this.mount = null;
    },

    onPanelResize(bodyEl) {
        SudokuGame.onPanelResize(bodyEl);
    }
};
