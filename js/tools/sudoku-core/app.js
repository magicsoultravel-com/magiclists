import { Sudoku } from './engine.js';
import { LessonsBasics, LessonsAdvanced } from './lessons.js';
import { initSudokuTheme } from './theme.js';
import { renderSudokuTemplate } from './template.js';
import CatCompanion from './cat.js';
import { mountCatModel } from './cat-models.js';

const STATE_KEY = 'magiclists-sudoku-game';
const SEED_KEY = 'magiclists-sudoku-seeds';
const STATS_KEY = 'magiclists-sudoku-stats';
const ZEN_KEY = 'magiclists-sudoku-zen';
const CAT_KEY = 'magiclists-sudoku-cat';

const MAX_SEEDS = 10;
const HISTORY_LIMIT = 10;
const GENERATE_PROGRESS_DELAY_MS = 500;
const GENERATE_CLEAR_MS = 280;
const GENERATE_READY_MS = 200;
const SCALE_BASELINE = 460;
const SCALE_HEIGHT_BASELINE = 700;

let mountEl = null;
let rootEl = null;
let boardEl = null;
let boardWrap = null;
let numpadEl = null;
let statusEl = null;
let timerEl = null;
let difficultyEl = null;
let navMenu = null;
let btnMenu = null;
let btnUndo = null;
let btnRedo = null;
let btnPencil = null;
let btnZen = null;
let btnZenExit = null;
let btnCat = null;
let boardCat = null;
let cellPicker = null;
let generateOverlay = null;
let generateLabel = null;
let generateProgress = null;
let generateBar = null;
let lessonsDialog = null;
let lessonsBasics = null;
let lessonsAdvanced = null;
let seedsDialog = null;
let confirmDialog = null;
let confirmMessage = null;
let confirmOk = null;
let confirmCancel = null;
let seedList = null;
let currentSeedEl = null;
let statsStartedEl = null;
let statsCompletedEl = null;
let menuScrim = null;

let puzzle = [];
let solution = [];
let given = [];
let notes = [];
let selected = null;
let activeNumber = null;
let activePencilSet = new Set();
let pencilMode = false;
let zenMode = false;
let catEnabled = false;
let timerInterval = null;
let timerRunning = false;
let animateBoardReveal = false;
let saveInterval = null;
let seconds = 0;
let gameWon = false;
let history = [];
let future = [];
let currentSeed = null;
let currentDifficulty = null;
let seedHistory = [];
let menuOpen = false;
let confirmCallback = null;
let cellPickerOpen = false;
let cellPickerCell = null;
let pickerNoteBatch = false;
let gamesStarted = 0;
let gamesCompleted = 0;
let generateToken = 0;
let themeCleanup = null;
let resizeObserver = null;
let _cleanups = [];

function q(name) {
    return mountEl?.querySelector(`[data-sudoku="${name}"]`) || null;
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function on(target, eventName, handler, options) {
    if (!target) return;
    target.addEventListener(eventName, handler, options);
    _cleanups.push(() => target.removeEventListener(eventName, handler, options));
}

function emptyNotes() {
    return Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));
}

function cloneNotes(src) {
    return src.map((row) => row.map((set) => new Set(set)));
}

function serializeNotes() {
    return notes.map((row) => row.map((set) => [...set]));
}

function deserializeNotes(data) {
    return data.map((row) => row.map((arr) => new Set(arr)));
}

function snapshot() {
    return { puzzle: puzzle.map((row) => [...row]), notes: cloneNotes(notes) };
}

function serializeSnapshot(snap) {
    return { puzzle: snap.puzzle, notes: snap.notes.map((row) => row.map((set) => [...set])) };
}

function deserializeSnapshot(data) {
    return { puzzle: data.puzzle.map((row) => [...row]), notes: data.notes.map((row) => row.map((arr) => new Set(arr))) };
}

function serializeStack(stack) {
    return stack.map(serializeSnapshot);
}

function deserializeStack(data) {
    if (!Array.isArray(data)) return [];
    return data.slice(-HISTORY_LIMIT).map(deserializeSnapshot);
}

function trimStack(stack) {
    while (stack.length > HISTORY_LIMIT) stack.shift();
}

function applySnapshot(snap) {
    puzzle = snap.puzzle.map((row) => [...row]);
    notes = cloneNotes(snap.notes);
}

function pushHistory() {
    history.push(snapshot());
    trimStack(history);
    future = [];
    updateUndoRedo();
}

function updateUndoRedo() {
    if (btnUndo) btnUndo.disabled = history.length === 0 || gameWon;
    if (btnRedo) btnRedo.disabled = future.length === 0 || gameWon;
}

function undo() {
    if (!history.length || gameWon) return;
    future.push(snapshot());
    trimStack(future);
    applySnapshot(history.pop());
    clearErrors();
    setStatus('');
    renderBoard();
    updateUndoRedo();
    saveGame();
}

function redo() {
    if (!future.length || gameWon) return;
    history.push(snapshot());
    trimStack(history);
    applySnapshot(future.pop());
    clearErrors();
    setStatus('');
    renderBoard();
    updateUndoRedo();
    saveGame();
}

function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    if (navMenu) navMenu.hidden = true;
    if (menuScrim) menuScrim.hidden = true;
    rootEl?.classList.remove('menu-open');
    btnMenu?.classList.remove('active');
    btnMenu?.setAttribute('aria-expanded', 'false');
}

function openMenu() {
    if (menuOpen || zenMode) return;
    menuOpen = true;
    if (navMenu) navMenu.hidden = false;
    if (menuScrim) menuScrim.hidden = false;
    rootEl?.classList.add('menu-open');
    btnMenu?.classList.add('active');
    btnMenu?.setAttribute('aria-expanded', 'true');
}

function toggleMenu() {
    if (menuOpen) closeMenu();
    else openMenu();
}

function showConfirm(message, onConfirm) {
    if (!confirmDialog || !confirmMessage) return;
    confirmMessage.textContent = message;
    confirmCallback = onConfirm;
    confirmDialog.showModal();
}

function closeConfirm() {
    confirmCallback = null;
    confirmDialog?.close();
}

function setZen(enabled) {
    zenMode = !!enabled;
    rootEl?.classList.toggle('zen', zenMode);
    btnZen?.classList.toggle('active', zenMode);
    btnZenExit?.classList.toggle('active', zenMode);
    btnZen?.setAttribute('title', zenMode ? 'Exit zen mode' : 'Zen mode — focus on the puzzle');
    try {
        localStorage.setItem(ZEN_KEY, zenMode ? '1' : '0');
    } catch {
        /* noop */
    }
    if (zenMode) closeMenu();
}

function setCatEnabled(enabled) {
    catEnabled = !!enabled;
    if (boardCat) {
        boardCat.hidden = !catEnabled;
        boardCat.setAttribute('aria-hidden', catEnabled ? 'false' : 'true');
    }
    btnCat?.classList.toggle('active', catEnabled);
    btnCat?.setAttribute('title', catEnabled ? 'Hide companion cat' : 'Companion cat');
    try {
        localStorage.setItem(CAT_KEY, catEnabled ? '1' : '0');
    } catch {
        /* noop */
    }
    if (catEnabled) CatCompanion.start();
    else CatCompanion.stop();
}

function toggleCat() {
    setCatEnabled(!catEnabled);
}

function initPreferences() {
    setZen(localStorage.getItem(ZEN_KEY) === '1');
    const savedCat = localStorage.getItem(CAT_KEY);
    setCatEnabled(savedCat === '1' || (parseInt(savedCat || '0', 10) || 0) > 0);
}

function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
}

function resetTimer() {
    stopTimer();
    seconds = 0;
    timerRunning = false;
    if (timerEl) timerEl.textContent = formatTime(0);
}

function startTimer(fromSeconds = 0) {
    stopTimer();
    seconds = fromSeconds;
    if (timerEl) timerEl.textContent = formatTime(seconds);
    if (gameWon) return;
    timerRunning = true;
    timerInterval = setInterval(() => {
        seconds += 1;
        if (timerEl) timerEl.textContent = formatTime(seconds);
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function ensureTimerRunning() {
    if (gameWon || timerRunning) return;
    startTimer(0);
}

function startAutoSave() {
    if (saveInterval) clearInterval(saveInterval);
    saveInterval = setInterval(saveGame, 15000);
}

function setStatus(msg, type = '') {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'status' + (type ? ` ${type}` : '');
}

function saveGame() {
    if (!puzzle.length || !solution.length) return;
    const state = {
        v: 1,
        puzzle,
        solution,
        given,
        notes: serializeNotes(),
        seed: currentSeed,
        difficulty: currentDifficulty,
        seconds,
        gameWon,
        pencilMode,
        activeNumber,
        activePencilNumbers: [...activePencilSet],
        selected,
        difficultyPref: difficultyEl?.value || 'medium',
        history: serializeStack(history),
        future: serializeStack(future)
    };
    try {
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
        /* noop */
    }
}

function tryLoadGame() {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return false;
    try {
        const state = JSON.parse(raw);
        if (state.v !== 1 || !Array.isArray(state.puzzle) || state.puzzle.length !== 9) return false;
        puzzle = state.puzzle.map((row) => [...row]);
        solution = state.solution.map((row) => [...row]);
        given = state.given.map((row) => [...row]);
        notes = deserializeNotes(state.notes);
        currentSeed = state.seed;
        currentDifficulty = state.difficulty;
        seconds = state.seconds || 0;
        gameWon = !!state.gameWon;
        pencilMode = !!state.pencilMode;
        activeNumber = state.activeNumber ?? null;
        activePencilSet = new Set(Array.isArray(state.activePencilNumbers) ? state.activePencilNumbers : []);
        if (pencilMode) activeNumber = null;
        else activePencilSet.clear();
        selected = state.selected ?? null;
        history = deserializeStack(state.history);
        future = deserializeStack(state.future);
        if (state.difficultyPref && difficultyEl) difficultyEl.value = state.difficultyPref;
        btnPencil?.classList.toggle('active', pencilMode);
        setStatus(gameWon ? 'Solved!' : '', gameWon ? 'ok' : '');
        renderBoard();
        if (gameWon) {
            if (timerEl) timerEl.textContent = formatTime(seconds);
            timerRunning = false;
        } else if (seconds > 0) {
            startTimer(seconds);
        } else {
            resetTimer();
        }
        updateUndoRedo();
        return true;
    } catch {
        return false;
    }
}

function cellTitle(row, col) {
    const parts = [];
    if (given[row][col]) parts.push(`Given ${puzzle[row][col]}`);
    else if (puzzle[row][col]) parts.push(`Your entry: ${puzzle[row][col]}`);
    else if (notes[row][col].size) parts.push(`Notes: ${[...notes[row][col]].sort().join(', ')}`);
    else parts.push('Empty cell');

    if (!given[row][col] && !gameWon) {
        if (pencilMode && activePencilSet.size) parts.push(`Pencil ${[...activePencilSet].sort((a, b) => a - b).join(', ')} — click to mark`);
        else if (pencilMode) parts.push('Pick note(s) on the numpad');
        else if (activeNumber) parts.push('Tap a number to fill');
        else parts.push('Tap cell to pick a number');
    }
    return parts.join(' · ');
}

function buildNumpad() {
    if (!numpadEl) return;
    numpadEl.innerHTML = '';
    for (let n = 1; n <= 9; n += 1) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn';
        btn.textContent = String(n);
        btn.dataset.num = String(n);
        btn.title = `Select ${n}`;
        on(btn, 'click', () => onNumpadClick(n));
        numpadEl.appendChild(btn);
    }
}

function buildCellPicker() {
    if (!cellPicker) return;
    cellPicker.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'cell-picker-grid';
    for (let n = 1; n <= 9; n += 1) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cell-picker-btn';
        btn.textContent = String(n);
        btn.dataset.num = String(n);
        on(btn, 'click', (e) => onCellPickerClick(n, e));
        grid.appendChild(btn);
    }
    cellPicker.appendChild(grid);

    const pencilBtn = document.createElement('button');
    pencilBtn.type = 'button';
    pencilBtn.className = 'cell-picker-pencil';
    pencilBtn.title = 'Pencil marks';
    pencilBtn.setAttribute('aria-label', 'Toggle pencil marks');
    pencilBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 4l2 2" stroke="currentColor" stroke-width="1.2"/></svg>';
    on(pencilBtn, 'click', (e) => {
        e.stopPropagation();
        togglePencilFromPicker();
    });
    cellPicker.appendChild(pencilBtn);
    on(cellPicker, 'pointerdown', (e) => e.stopPropagation());
}

function togglePencilFromPicker() {
    pencilMode = !pencilMode;
    btnPencil?.classList.toggle('active', pencilMode);
    if (pencilMode) activeNumber = null;
    else activePencilSet.clear();
    syncCellPicker();
    saveGame();
}

function shouldShowCellPicker(row, col) {
    if (gameWon || given[row][col]) return false;
    if (activeNumber !== null) return false;
    if (pencilMode) return puzzle[row][col] === 0;
    if (activePencilSet.size > 0) return false;
    return true;
}

function closeCellPicker() {
    if (!cellPickerOpen || !cellPicker) return;
    cellPickerOpen = false;
    cellPickerCell = null;
    pickerNoteBatch = false;
    cellPicker.classList.remove('is-open');
    cellPicker.hidden = true;
}

function syncCellPicker() {
    if (!cellPickerCell || !cellPicker) return;
    const { row, col } = cellPickerCell;
    cellPicker.querySelectorAll('.cell-picker-btn').forEach((btn) => {
        const num = Number(btn.dataset.num);
        const blocked = !pencilMode && !Sudoku.isValid(puzzle, row, col, num);
        btn.disabled = blocked;
        btn.classList.toggle('active', pencilMode && notes[row][col].has(num));
    });
    const pencilBtn = cellPicker.querySelector('.cell-picker-pencil');
    if (pencilBtn) pencilBtn.classList.toggle('active', pencilMode);
}

function positionCellPicker(row, col) {
    if (!cellPicker || !boardEl || !boardWrap) return;
    const cell = boardEl.children[row * 9 + col];
    if (!cell) return;
    cellPicker.hidden = false;
    cellPicker.classList.remove('is-open');
    const wrapRect = boardWrap.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const pickerW = cellPicker.offsetWidth || Math.min(boardWrap.clientWidth * 0.42, 116);
    const pickerH = cellPicker.offsetHeight || pickerW;
    let left = cellRect.left - wrapRect.left + cellRect.width / 2 - pickerW / 2;
    let top = cellRect.top - wrapRect.top + cellRect.height / 2 - pickerH / 2;
    left = Math.max(2, Math.min(left, boardWrap.clientWidth - pickerW - 2));
    top = Math.max(2, Math.min(top, boardWrap.clientHeight - pickerH - 2));
    cellPicker.style.left = `${left}px`;
    cellPicker.style.top = `${top}px`;
}

function openCellPicker(row, col) {
    cellPickerCell = { row, col };
    cellPickerOpen = true;
    pickerNoteBatch = false;
    positionCellPicker(row, col);
    syncCellPicker();
    requestAnimationFrame(() => {
        cellPicker?.classList.add('is-open');
    });
}

function refreshPickerCell() {
    if (!cellPickerCell || !boardEl) return;
    const { row, col } = cellPickerCell;
    const cell = boardEl.children[row * 9 + col];
    if (!cell || puzzle[row][col] !== 0) return;
    cell.innerHTML = '';
    if (notes[row][col].size) renderNotes(cell, row, col);
}

function toggleNoteInPicker(row, col, num) {
    if (given[row][col] || puzzle[row][col] !== 0 || gameWon) return;
    if (!pickerNoteBatch) {
        pushHistory();
        pickerNoteBatch = true;
    }
    if (notes[row][col].has(num)) notes[row][col].delete(num);
    else notes[row][col].add(num);
    ensureTimerRunning();
    clearErrors();
    refreshPickerCell();
    syncCellPicker();
    saveGame();
}

function onCellPickerClick(num, e) {
    e.stopPropagation();
    e.preventDefault();
    if (!cellPickerCell || gameWon) return;
    const { row, col } = cellPickerCell;
    if (given[row][col]) return;
    selected = { row, col };
    if (pencilMode) {
        if (puzzle[row][col] === 0) toggleNoteInPicker(row, col, num);
        return;
    }
    if (!Sudoku.isValid(puzzle, row, col, num)) return;
    placeNumber(num, { keepActive: false });
    closeCellPicker();
}

function getHighlightNumber() {
    return pencilMode ? null : activeNumber;
}

function togglePencilNumber(num) {
    if (activePencilSet.has(num)) activePencilSet.delete(num);
    else activePencilSet.add(num);
}

function applyPencilToCell(row, col) {
    if (given[row][col] || puzzle[row][col] !== 0 || gameWon || !activePencilSet.size) return;
    pushHistory();
    for (const num of activePencilSet) {
        if (notes[row][col].has(num)) notes[row][col].delete(num);
        else notes[row][col].add(num);
    }
    ensureTimerRunning();
    clearErrors();
    renderBoard();
    saveGame();
}

function blockedCellsForNumber(num) {
    const blocked = new Set();
    if (!num) return blocked;
    for (let r = 0; r < 9; r += 1) {
        for (let c = 0; c < 9; c += 1) {
            if (!Sudoku.isValid(puzzle, r, c, num)) blocked.add(`${r},${c}`);
        }
    }
    return blocked;
}

function countRemaining(num) {
    let count = 0;
    for (let r = 0; r < 9; r += 1) {
        for (let c = 0; c < 9; c += 1) {
            if (puzzle[r][c] === num) count += 1;
        }
    }
    return 9 - count;
}

function updateNumpad() {
    numpadEl?.querySelectorAll('.btn').forEach((btn) => {
        const num = Number(btn.dataset.num);
        if (pencilMode) btn.classList.toggle('active', activePencilSet.has(num));
        else btn.classList.toggle('active', activeNumber === num);
        btn.classList.toggle('exhausted', countRemaining(num) === 0);
    });
}

function renderNotes(cellEl, row, col) {
    const grid = document.createElement('div');
    grid.className = 'notes';
    for (let n = 1; n <= 9; n += 1) {
        const span = document.createElement('span');
        span.className = 'note';
        if (notes[row][col].has(n)) span.textContent = String(n);
        grid.appendChild(span);
    }
    cellEl.appendChild(grid);
}

function renderBoard() {
    if (!boardEl) return;
    boardEl.innerHTML = '';
    const hlNum = getHighlightNumber();
    const blocked = hlNum ? blockedCellsForNumber(hlNum) : new Set();
    for (let r = 0; r < 9; r += 1) {
        for (let c = 0; c < 9; c += 1) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'cell';
            btn.setAttribute('role', 'gridcell');
            btn.title = cellTitle(r, c);
            if (c === 2 || c === 5) btn.classList.add('box-right');
            if (r === 2 || r === 5) btn.classList.add('box-bottom');
            const val = puzzle[r][c];
            if (val !== 0) btn.textContent = String(val);
            else if (notes[r][c].size) renderNotes(btn, r, c);
            if (given[r][c]) btn.classList.add('given');
            if (selected && selected.row === r && selected.col === c) btn.classList.add('selected');
            if (hlNum && blocked.has(`${r},${c}`)) btn.classList.add('blocked');
            if (animateBoardReveal) {
                btn.classList.add('cell-reveal');
                btn.style.animationDelay = `${(r * 9 + c) * 6}ms`;
            }
            on(btn, 'click', () => selectCell(r, c));
            on(btn, 'mouseenter', () => {
                if (!gameWon) btn.title = cellTitle(r, c);
            });
            boardEl.appendChild(btn);
        }
    }
    if (animateBoardReveal) animateBoardReveal = false;
    updateNumpad();
    if (cellPickerOpen && cellPickerCell) {
        const { row, col } = cellPickerCell;
        requestAnimationFrame(() => {
            positionCellPicker(row, col);
            syncCellPicker();
        });
    }
}

function onNumpadClick(num) {
    closeCellPicker();
    if (pencilMode) {
        togglePencilNumber(num);
        renderBoard();
        saveGame();
        return;
    }
    if (activeNumber === num) {
        activeNumber = null;
        renderBoard();
        saveGame();
        return;
    }
    if (selected && !gameWon && !given[selected.row][selected.col] && Sudoku.isValid(puzzle, selected.row, selected.col, num)) {
        placeNumber(num, { keepActive: true });
        return;
    }
    activeNumber = num;
    renderBoard();
    saveGame();
}

function toggleNoteAt(row, col, num) {
    if (given[row][col] || puzzle[row][col] !== 0 || gameWon) return;
    pushHistory();
    if (notes[row][col].has(num)) notes[row][col].delete(num);
    else notes[row][col].add(num);
    ensureTimerRunning();
    clearErrors();
    renderBoard();
    saveGame();
}

function selectCell(row, col) {
    if (gameWon) return;
    if (activeNumber !== null && !given[row][col] && !pencilMode && Sudoku.isValid(puzzle, row, col, activeNumber)) {
        selected = { row, col };
        placeNumber(activeNumber, { keepActive: true });
        closeCellPicker();
        return;
    }
    if (selected && selected.row === row && selected.col === col) {
        if (cellPickerOpen && cellPickerCell?.row === row && cellPickerCell?.col === col) return;
        selected = null;
        activeNumber = null;
        closeCellPicker();
        clearErrors();
        renderBoard();
        saveGame();
        return;
    }
    selected = { row, col };
    if (shouldShowCellPicker(row, col)) {
        clearErrors();
        renderBoard();
        openCellPicker(row, col);
        saveGame();
        return;
    }
    if (pencilMode && activePencilSet.size && puzzle[row][col] === 0 && !given[row][col]) {
        applyPencilToCell(row, col);
        return;
    }
    closeCellPicker();
    clearErrors();
    renderBoard();
    saveGame();
}

function clearErrors() {
    boardEl?.querySelectorAll('.cell.error').forEach((el) => el.classList.remove('error'));
}

function clearNotesAt(row, col) {
    notes[row][col].clear();
}

function removeNoteFromPeers(row, col, num) {
    for (let i = 0; i < 9; i += 1) {
        notes[row][i].delete(num);
        notes[i][col].delete(num);
    }
    const br = Math.floor(row / 3) * 3;
    const bc = Math.floor(col / 3) * 3;
    for (let r = br; r < br + 3; r += 1) {
        for (let c = bc; c < bc + 3; c += 1) notes[r][c].delete(num);
    }
}

function placeNumber(num, { keepActive = false } = {}) {
    if (!selected || given[selected.row][selected.col] || gameWon) return;
    const { row, col } = selected;
    if (pencilMode) {
        activeNumber = keepActive ? num : null;
        if (puzzle[row][col] === 0) toggleNoteAt(row, col, num);
        else {
            renderBoard();
            saveGame();
        }
        return;
    }
    pushHistory();
    puzzle[row][col] = num;
    clearNotesAt(row, col);
    removeNoteFromPeers(row, col, num);
    activeNumber = keepActive ? num : null;
    ensureTimerRunning();
    clearErrors();
    renderBoard();
    checkWin();
    saveGame();
}

function eraseCell() {
    if (!selected || given[selected.row][selected.col] || gameWon) return;
    const { row, col } = selected;
    if (puzzle[row][col] === 0 && notes[row][col].size === 0) return;
    pushHistory();
    puzzle[row][col] = 0;
    notes[row][col].clear();
    ensureTimerRunning();
    clearErrors();
    closeCellPicker();
    renderBoard();
    setStatus('');
    saveGame();
}

function togglePencil() {
    pencilMode = !pencilMode;
    btnPencil?.classList.toggle('active', pencilMode);
    if (pencilMode) activeNumber = null;
    else activePencilSet.clear();
    if (cellPickerOpen) syncCellPicker();
    else closeCellPicker();
    renderBoard();
    saveGame();
}

function notesDiffer(a, b) {
    if (a.size !== b.size) return true;
    for (const n of a) if (!b.has(n)) return true;
    return false;
}

function fillAllPencil() {
    if (gameWon) return;
    const nextNotes = emptyNotes();
    let changed = false;
    for (let r = 0; r < 9; r += 1) {
        for (let c = 0; c < 9; c += 1) {
            if (given[r][c] || puzzle[r][c] !== 0) continue;
            for (let n = 1; n <= 9; n += 1) {
                if (Sudoku.isValid(puzzle, r, c, n)) nextNotes[r][c].add(n);
            }
            if (notesDiffer(notes[r][c], nextNotes[r][c])) changed = true;
        }
    }
    if (!changed) return;
    pushHistory();
    for (let r = 0; r < 9; r += 1) {
        for (let c = 0; c < 9; c += 1) {
            if (!given[r][c] && puzzle[r][c] === 0) notes[r][c] = new Set(nextNotes[r][c]);
        }
    }
    ensureTimerRunning();
    clearErrors();
    renderBoard();
    saveGame();
}

function clearAllPencil() {
    if (gameWon) return;
    let changed = false;
    for (let r = 0; r < 9; r += 1) {
        for (let c = 0; c < 9; c += 1) {
            if (notes[r][c].size) changed = true;
        }
    }
    if (!changed) return;
    pushHistory();
    for (let r = 0; r < 9; r += 1) {
        for (let c = 0; c < 9; c += 1) notes[r][c].clear();
    }
    ensureTimerRunning();
    clearErrors();
    renderBoard();
    saveGame();
}

function restartGame() {
    if (!puzzle.length) return;
    closeMenu();
    gameWon = false;
    selected = null;
    activeNumber = null;
    activePencilSet.clear();
    history = [];
    future = [];
    clearErrors();
    setStatus('');
    boardWrap?.classList.add('is-clearing');
    setTimeout(() => {
        for (let r = 0; r < 9; r += 1) {
            for (let c = 0; c < 9; c += 1) if (!given[r][c]) puzzle[r][c] = 0;
        }
        notes = emptyNotes();
        renderBoard();
        boardWrap?.classList.remove('is-clearing');
        resetTimer();
        updateUndoRedo();
        saveGame();
    }, 220);
}

function showErrors(errorSet) {
    errorSet.forEach((key) => {
        const [r, c] = key.split(',').map(Number);
        const cell = boardEl?.children[r * 9 + c];
        if (cell) cell.classList.add('error');
    });
}

function checkSolution() {
    if (gameWon) return;
    const errors = Sudoku.findErrors(puzzle, solution);
    if (errors.size > 0) {
        showErrors(errors);
        setStatus(`${errors.size} mistake${errors.size > 1 ? 's' : ''}`, 'err');
        return;
    }
    if (!Sudoku.isComplete(puzzle)) {
        setStatus('No mistakes so far', 'ok');
        return;
    }
    winGame();
}

function checkWin() {
    if (!Sudoku.isComplete(puzzle)) return;
    const errors = Sudoku.findErrors(puzzle, solution);
    if (errors.size === 0) winGame();
}

function winGame() {
    gameWon = true;
    stopTimer();
    timerRunning = false;
    recordGameCompleted();
    setStatus('Solved!', 'ok');
    updateUndoRedo();
    saveGame();
}

function loadStats() {
    try {
        const stats = JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
        gamesStarted = Number.isFinite(stats.started) ? stats.started : 0;
        gamesCompleted = Number.isFinite(stats.completed) ? stats.completed : 0;
    } catch {
        gamesStarted = 0;
        gamesCompleted = 0;
    }
    renderStats();
}

function saveStats() {
    try {
        localStorage.setItem(STATS_KEY, JSON.stringify({ started: gamesStarted, completed: gamesCompleted }));
    } catch {
        /* noop */
    }
}

function renderStats() {
    if (statsStartedEl) statsStartedEl.textContent = String(gamesStarted);
    if (statsCompletedEl) statsCompletedEl.textContent = String(gamesCompleted);
}

function recordGameStarted() {
    gamesStarted += 1;
    renderStats();
    saveStats();
}

function recordGameCompleted() {
    gamesCompleted += 1;
    renderStats();
    saveStats();
}

function loadSeedHistory() {
    try {
        seedHistory = JSON.parse(localStorage.getItem(SEED_KEY) || '[]');
    } catch {
        seedHistory = [];
    }
}

function saveSeedHistory() {
    localStorage.setItem(SEED_KEY, JSON.stringify(seedHistory));
}

function recordSeed(seed, difficulty) {
    currentSeed = seed;
    currentDifficulty = difficulty;
    seedHistory = seedHistory.filter((entry) => entry.seed !== seed);
    seedHistory.unshift({ seed, difficulty, at: Date.now() });
    if (seedHistory.length > MAX_SEEDS) seedHistory.length = MAX_SEEDS;
    saveSeedHistory();
}

function renderSeeds() {
    if (currentSeedEl) currentSeedEl.textContent = currentSeed ? `${currentSeed} · ${currentDifficulty}` : '—';
    if (!seedList) return;
    seedList.innerHTML = '';
    if (!seedHistory.length) {
        const li = document.createElement('li');
        li.textContent = 'No seeds yet';
        seedList.appendChild(li);
        return;
    }
    seedHistory.forEach((entry) => {
        const li = document.createElement('li');
        li.textContent = `${entry.seed} · ${entry.difficulty}`;
        if (entry.seed === currentSeed) li.classList.add('current');
        li.title = new Date(entry.at).toLocaleString();
        seedList.appendChild(li);
    });
}

function openSeeds() {
    closeMenu();
    renderSeeds();
    seedsDialog?.showModal();
}

function applyGameResult(result) {
    puzzle = result.puzzle.map((row) => [...row]);
    solution = result.solution;
    given = result.given;
    notes = emptyNotes();
    recordSeed(result.seed, result.difficulty);
}

function setGenerateProgress(p, label) {
    const pct = Math.round(p * 100);
    if (generateBar) generateBar.style.width = `${pct}%`;
    generateProgress?.setAttribute('aria-valuenow', String(pct));
    if (label && generateLabel) generateLabel.textContent = label;
}

function hideGenerateOverlay() {
    if (!generateOverlay) return;
    generateOverlay.classList.remove('is-visible');
    generateOverlay.hidden = true;
    generateOverlay.setAttribute('aria-hidden', 'true');
    setGenerateProgress(0, 'Generating puzzle…');
}

function showGenerateOverlay() {
    if (!generateOverlay) return;
    setGenerateProgress(0.08, 'Generating puzzle…');
    generateOverlay.hidden = false;
    generateOverlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => generateOverlay.classList.add('is-visible'));
}

async function newGame({ skipQuote = true } = {}) {
    void skipQuote;
    const token = ++generateToken;
    closeMenu();
    closeCellPicker();
    gameWon = false;
    selected = null;
    activeNumber = null;
    activePencilSet.clear();
    history = [];
    future = [];
    setStatus('');

    boardWrap?.classList.add('is-clearing');
    await wait(GENERATE_CLEAR_MS);
    if (token !== generateToken) return;
    boardWrap?.classList.add('is-generating');
    boardWrap?.classList.remove('is-clearing');

    let overlayShown = false;
    let progressTimer = null;
    let lastProgress = 0;
    let lastProgressLabel = 'Generating puzzle…';
    const revealProgress = () => {
        if (token !== generateToken || overlayShown) return;
        overlayShown = true;
        showGenerateOverlay();
        setGenerateProgress(Math.max(lastProgress, 0.08), lastProgressLabel);
    };
    progressTimer = setTimeout(revealProgress, GENERATE_PROGRESS_DELAY_MS);

    const difficulty = difficultyEl?.value || 'medium';
    let result;
    try {
        result = await Sudoku.generateAsync(difficulty, null, (p, label) => {
            if (token !== generateToken) return;
            lastProgress = p;
            if (label) lastProgressLabel = label;
            if (overlayShown) setGenerateProgress(p, label);
        });
    } catch (error) {
        console.error(error);
        clearTimeout(progressTimer);
        if (token !== generateToken) return;
        hideGenerateOverlay();
        boardWrap?.classList.remove('is-generating');
        setStatus('Could not generate puzzle — try again', 'err');
        return;
    }

    clearTimeout(progressTimer);
    if (token !== generateToken) return;
    if (overlayShown) {
        setGenerateProgress(1, 'Ready');
        await wait(GENERATE_READY_MS);
        if (token !== generateToken) return;
        hideGenerateOverlay();
    }
    boardWrap?.classList.remove('is-generating');
    applyGameResult(result);
    recordGameStarted();
    animateBoardReveal = true;
    renderBoard();
    resetTimer();
    setStatus('');
    updateUndoRedo();
    saveGame();
}

function fillLessons(container, lessons) {
    if (!container) return;
    container.innerHTML = '';
    lessons.forEach((lesson) => {
        const article = document.createElement('article');
        article.className = 'lesson';
        article.innerHTML = `<h3>${lesson.title}</h3><p>${lesson.body}</p>`;
        container.appendChild(article);
    });
}

function switchLessonTab(tab) {
    const isBasics = tab === 'basics';
    const basicsTab = q('tab-basics');
    const advancedTab = q('tab-advanced');
    basicsTab?.classList.toggle('active', isBasics);
    advancedTab?.classList.toggle('active', !isBasics);
    basicsTab?.setAttribute('aria-selected', isBasics ? 'true' : 'false');
    advancedTab?.setAttribute('aria-selected', !isBasics ? 'true' : 'false');
    if (lessonsBasics) lessonsBasics.hidden = !isBasics;
    if (lessonsAdvanced) lessonsAdvanced.hidden = isBasics;
}

function openLessons() {
    closeMenu();
    if (lessonsBasics && !lessonsBasics.childElementCount) {
        fillLessons(lessonsBasics, LessonsBasics);
        fillLessons(lessonsAdvanced, LessonsAdvanced);
    }
    switchLessonTab('basics');
    lessonsDialog?.showModal();
}

function handleKeydown(e) {
    if (!mountEl?.isConnected) return;
    if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undo();
            return;
        }
        if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
            e.preventDefault();
            redo();
            return;
        }
    }
    if (e.key === 'p' && !e.ctrlKey && !e.metaKey) {
        togglePencil();
        return;
    }
    if (gameWon) return;

    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9) {
        onNumpadClick(num);
        return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        eraseCell();
        return;
    }
    if (!selected) return;

    const { row, col } = selected;
    let nr = row;
    let nc = col;
    switch (e.key) {
        case 'ArrowUp':
            nr = Math.max(0, row - 1);
            break;
        case 'ArrowDown':
            nr = Math.min(8, row + 1);
            break;
        case 'ArrowLeft':
            nc = Math.max(0, col - 1);
            break;
        case 'ArrowRight':
            nc = Math.min(8, col + 1);
            break;
        default:
            return;
    }
    e.preventDefault();
    selectCell(nr, nc);
}

function bindElements(mount) {
    mountEl = mount;
    rootEl = q('root');
    boardEl = q('board');
    boardWrap = q('board-wrap');
    numpadEl = q('numpad');
    statusEl = q('status');
    timerEl = q('timer');
    difficultyEl = q('difficulty');
    navMenu = q('menu');
    btnMenu = q('btn-menu');
    btnUndo = q('btn-undo');
    btnRedo = q('btn-redo');
    btnPencil = q('btn-pencil');
    btnZen = q('btn-zen');
    btnZenExit = q('btn-zen-exit');
    btnCat = q('btn-cat');
    boardCat = q('board-cat');
    cellPicker = q('cell-picker');
    generateOverlay = q('generate-overlay');
    generateLabel = q('generate-label');
    generateProgress = q('generate-progress');
    generateBar = q('generate-bar');
    lessonsDialog = q('lessons-dialog');
    lessonsBasics = q('lessons-basics');
    lessonsAdvanced = q('lessons-advanced');
    seedsDialog = q('seeds-dialog');
    confirmDialog = q('confirm-dialog');
    confirmMessage = q('confirm-message');
    confirmOk = q('confirm-ok');
    confirmCancel = q('confirm-cancel');
    seedList = q('seed-list');
    currentSeedEl = q('current-seed');
    statsStartedEl = q('stats-started');
    statsCompletedEl = q('stats-completed');
    menuScrim = q('menu-scrim');
}

function updateScale(targetMount) {
    const host = targetMount || mountEl;
    if (!host) return;
    const panel = host.closest('.tool-panel');
    const width = panel?.offsetWidth || host.offsetWidth || SCALE_BASELINE;
    const isAutoHeight = panel?.classList.contains('tool-panel--auto-height');
    let scale = width / SCALE_BASELINE;
    if (!isAutoHeight && panel) {
        const headerH = panel.querySelector('.tool-panel__header')?.offsetHeight || 32;
        const bodyH = panel.offsetHeight - headerH;
        const heightScale = bodyH / SCALE_HEIGHT_BASELINE;
        scale = Math.min(scale, heightScale);
    }
    scale = Math.min(1.3, Math.max(0.7, scale));
    host.style.setProperty('--sudoku-scale', String(scale));
}

function bindEvents() {
    on(btnMenu, 'click', toggleMenu);
    on(menuScrim, 'click', closeMenu);
    on(btnZen, 'click', () => {
        setZen(true);
        saveGame();
    });
    on(btnZenExit, 'click', () => {
        setZen(false);
        saveGame();
    });
    on(q('btn-new'), 'click', () => {
        newGame({ skipQuote: true });
    });
    on(q('btn-restart'), 'click', restartGame);
    on(q('btn-check'), 'click', checkSolution);
    on(q('btn-erase'), 'click', eraseCell);
    on(btnPencil, 'click', togglePencil);
    on(q('btn-pencil-fill'), 'click', () => showConfirm('Fill every empty cell with valid pencil marks?', () => fillAllPencil()));
    on(q('btn-pencil-clear'), 'click', () => showConfirm('Clear all pencil marks from the board?', () => clearAllPencil()));
    on(confirmOk, 'click', () => {
        const action = confirmCallback;
        closeConfirm();
        if (action) action();
    });
    on(confirmCancel, 'click', closeConfirm);
    on(confirmDialog, 'cancel', (e) => {
        e.preventDefault();
        closeConfirm();
    });
    on(btnCat, 'click', toggleCat);
    on(q('btn-lessons'), 'click', openLessons);
    on(q('btn-seeds'), 'click', openSeeds);
    on(q('lessons-close'), 'click', () => lessonsDialog?.close());
    on(q('seeds-close'), 'click', () => seedsDialog?.close());
    on(lessonsDialog, 'click', (e) => {
        if (e.target === lessonsDialog) lessonsDialog.close();
    });
    on(seedsDialog, 'click', (e) => {
        if (e.target === seedsDialog) seedsDialog.close();
    });
    on(q('tab-basics'), 'click', () => switchLessonTab('basics'));
    on(q('tab-advanced'), 'click', () => switchLessonTab('advanced'));
    on(btnUndo, 'click', undo);
    on(btnRedo, 'click', redo);
    on(document, 'keydown', handleKeydown);
    on(document, 'click', (e) => {
        const target = e.target;
        if (menuOpen && !(target instanceof Element && (target.closest('[data-sudoku="menu"]') || target.closest('[data-sudoku="btn-menu"]')))) {
            closeMenu();
        }
        if (cellPickerOpen && !(target instanceof Element && (target.closest('[data-sudoku="cell-picker"]') || target.closest('.cell')))) {
            closeCellPicker();
        }
    });
    on(document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveGame();
    });
    on(window, 'beforeunload', saveGame);
}

function resetState() {
    puzzle = [];
    solution = [];
    given = [];
    notes = [];
    selected = null;
    activeNumber = null;
    activePencilSet = new Set();
    pencilMode = false;
    zenMode = false;
    catEnabled = false;
    seconds = 0;
    gameWon = false;
    history = [];
    future = [];
    currentSeed = null;
    currentDifficulty = null;
    seedHistory = [];
    menuOpen = false;
    confirmCallback = null;
    cellPickerOpen = false;
    cellPickerCell = null;
    pickerNoteBatch = false;
    gamesStarted = 0;
    gamesCompleted = 0;
    generateToken = 0;
}

export const SudokuGame = {
    async open(mount) {
        this.destroy();
        resetState();
        mount.innerHTML = renderSudokuTemplate();
        bindElements(mount);
        if (!rootEl) return;

        themeCleanup = initSudokuTheme(rootEl);
        mountCatModel(boardCat);
        CatCompanion.init(boardWrap, boardCat, q('cat-mouse'), q('cat-speech'));

        initPreferences();
        loadStats();
        loadSeedHistory();
        buildNumpad();
        buildCellPicker();
        bindEvents();
        startAutoSave();

        if (!tryLoadGame()) {
            await newGame({ skipQuote: true });
        }

        if (typeof ResizeObserver !== 'undefined') {
            const panel = mount.closest('.tool-panel');
            if (panel) {
                resizeObserver = new ResizeObserver(() => updateScale(mount));
                resizeObserver.observe(panel);
            }
        }
        updateScale(mount);
    },

    destroy() {
        generateToken += 1;
        saveGame();
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        if (saveInterval) {
            clearInterval(saveInterval);
            saveInterval = null;
        }
        CatCompanion.stop();
        if (themeCleanup) {
            themeCleanup();
            themeCleanup = null;
        }
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }
        for (const cleanup of _cleanups.splice(0)) {
            try {
                cleanup();
            } catch {
                /* noop */
            }
        }
        if (mountEl) mountEl.innerHTML = '';
        mountEl = null;
        rootEl = null;
    },

    onPanelResize(mount) {
        updateScale(mount || mountEl);
    }
};
