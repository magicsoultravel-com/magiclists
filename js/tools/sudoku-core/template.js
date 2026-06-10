import { renderThemeDots } from './theme.js';

export function renderSudokuTemplate() {
    return `
        <section class="sudoku-tool" data-sudoku="root">
            <header class="sudoku-header">
                <div class="sudoku-header__left">
                    <button type="button" class="btn btn-icon" data-sudoku="btn-menu" aria-label="Toggle menu" aria-expanded="false" title="Menu">
                        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </button>
                    <button type="button" class="btn btn-icon" data-sudoku="btn-zen" aria-label="Zen mode" title="Zen mode — focus on the puzzle">
                        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5.2 6.4c.45-.45 1.05-.45 1.5 0M9.3 6.4c.45-.45 1.05-.45 1.5 0" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><path d="M5.5 10.2c1.15 1 3.85 1 5 0" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
                    </button>
                    <button type="button" class="btn btn-icon" data-sudoku="btn-zen-exit" aria-label="Exit zen mode" title="Exit zen mode">
                        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </button>
                </div>
                <div class="sudoku-header__meta">
                    <p class="sudoku-stats" data-sudoku="stats"><span data-sudoku="stats-started">0</span> started · <span data-sudoku="stats-completed">0</span> done</p>
                    <p class="sudoku-timer" data-sudoku="timer">0:00</p>
                </div>
            </header>

            <nav class="sudoku-menu" data-sudoku="menu" hidden aria-label="Sudoku menu">
                <div class="sudoku-menu__actions">
                    <button type="button" class="btn btn--compact btn-icon" data-sudoku="btn-new" title="New game">New</button>
                    <button type="button" class="btn btn--compact btn-icon" data-sudoku="btn-restart" title="Restart">Restart</button>
                    <button type="button" class="btn btn--compact btn-icon" data-sudoku="btn-undo" title="Undo" disabled>Undo</button>
                    <button type="button" class="btn btn--compact btn-icon" data-sudoku="btn-redo" title="Redo" disabled>Redo</button>
                    <button type="button" class="btn btn--compact btn-icon" data-sudoku="btn-pencil" title="Pencil">Pencil</button>
                    <button type="button" class="btn btn--compact btn-icon" data-sudoku="btn-erase" title="Erase">Erase</button>
                    <button type="button" class="btn btn--compact btn-icon" data-sudoku="btn-check" title="Check">Check</button>
                    <button type="button" class="btn btn--compact btn-icon" data-sudoku="btn-pencil-fill" title="Fill notes">Fill notes</button>
                    <button type="button" class="btn btn--compact btn-icon" data-sudoku="btn-pencil-clear" title="Clear notes">Clear notes</button>
                    <button type="button" class="btn btn--compact btn-icon" data-sudoku="btn-lessons" title="Lessons">Lessons</button>
                    <button type="button" class="btn btn--compact btn-icon" data-sudoku="btn-seeds" title="Seeds">Seeds</button>
                    <button type="button" class="btn btn--compact btn-icon" data-sudoku="btn-cat" title="Companion cat">Cat</button>
                </div>
                <div class="sudoku-menu__theme" data-sudoku="theme-dots">
                    ${renderThemeDots()}
                </div>
                <label class="sudoku-menu__difficulty">
                    <span>Difficulty</span>
                    <select class="btn btn--compact" data-sudoku="difficulty">
                        <option value="easy">Easy</option>
                        <option value="medium" selected>Medium</option>
                        <option value="hard">Hard</option>
                    </select>
                </label>
            </nav>
            <button type="button" class="sudoku-menu-scrim" data-sudoku="menu-scrim" hidden aria-label="Close menu"></button>

            <main class="sudoku-main">
                <div class="board-wrap" data-sudoku="board-wrap">
                    <div class="generate-overlay" data-sudoku="generate-overlay" hidden aria-hidden="true">
                        <div class="generate-panel">
                            <p class="generate-label" data-sudoku="generate-label">Generating puzzle…</p>
                            <div class="generate-progress" data-sudoku="generate-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                                <div class="generate-bar" data-sudoku="generate-bar"></div>
                            </div>
                        </div>
                    </div>
                    <div class="board" data-sudoku="board" role="grid" aria-label="Sudoku board"></div>
                    <div class="cell-picker" data-sudoku="cell-picker" hidden role="group" aria-label="Pick a number"></div>
                    <div class="board-cat" data-sudoku="board-cat" data-pose="walk" hidden aria-hidden="true" title="Click to pet · drag to toss"></div>
                    <div class="cat-speech" data-sudoku="cat-speech" hidden aria-hidden="true"><span>Meow!</span></div>
                    <svg class="cat-mouse" data-sudoku="cat-mouse" viewBox="0 0 10 8" width="10" height="8" hidden aria-hidden="true" shape-rendering="crispEdges">
                        <rect class="cf" x="2" y="2" width="6" height="4"></rect>
                        <rect class="cf" x="7" y="1" width="2" height="2"></rect>
                        <rect class="ce" x="8" y="2" width="1" height="1"></rect>
                        <rect class="cf" x="1" y="4" width="1" height="1"></rect>
                        <rect class="cf" x="0" y="3" width="1" height="1"></rect>
                        <rect class="cf" x="3" y="6" width="1" height="1"></rect>
                        <rect class="cf" x="6" y="6" width="1" height="1"></rect>
                    </svg>
                </div>
                <div class="numpad" data-sudoku="numpad" role="group" aria-label="Number pad"></div>
            </main>

            <footer class="sudoku-footer">
                <span class="status" data-sudoku="status" role="status"></span>
            </footer>

            <dialog class="dialog" data-sudoku="lessons-dialog">
                <div class="dialog-header">
                    <h2 class="dialog-title">Lessons &amp; tips</h2>
                    <button type="button" class="btn btn-icon" data-sudoku="lessons-close" aria-label="Close">
                        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </button>
                </div>
                <div class="dialog-tabs" role="tablist">
                    <button class="tab active" type="button" role="tab" aria-selected="true" data-sudoku="tab-basics" data-tab="basics">Basics</button>
                    <button class="tab" type="button" role="tab" aria-selected="false" data-sudoku="tab-advanced" data-tab="advanced">Advanced</button>
                </div>
                <div class="dialog-body tab-panel" data-sudoku="lessons-basics"></div>
                <div class="dialog-body tab-panel" data-sudoku="lessons-advanced" hidden></div>
            </dialog>

            <dialog class="dialog" data-sudoku="seeds-dialog">
                <div class="dialog-header">
                    <h2 class="dialog-title">Puzzle seeds</h2>
                    <button type="button" class="btn btn-icon" data-sudoku="seeds-close" aria-label="Close">
                        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    </button>
                </div>
                <div class="dialog-body">
                    <p class="dialog-hint">Same seed + difficulty always gives the same puzzle.</p>
                    <div class="seeds-current"><span class="seeds-label">Current</span> <span class="current-seed" data-sudoku="current-seed">—</span></div>
                    <p class="seeds-label">Last 10</p>
                    <ol class="seed-list" data-sudoku="seed-list"></ol>
                </div>
            </dialog>

            <dialog class="dialog confirm-dialog" data-sudoku="confirm-dialog">
                <div class="dialog-body">
                    <p class="confirm-message" data-sudoku="confirm-message"></p>
                    <div class="confirm-actions">
                        <button type="button" class="btn" data-sudoku="confirm-cancel">Cancel</button>
                        <button type="button" class="btn" data-sudoku="confirm-ok">Confirm</button>
                    </div>
                </div>
            </dialog>
        </section>
    `;
}
