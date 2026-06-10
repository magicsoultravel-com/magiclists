const SIZE = 9;
const BOX = 3;
const CLUES = { easy: 40, medium: 32, hard: 26 };

function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function mulberry32(a) {
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function createSeed() {
    const bytes = new Uint32Array(2);
    crypto.getRandomValues(bytes);
    return bytes[0].toString(36) + bytes[1].toString(36);
}

function shuffle(arr, rng) {
    const a = [...arr];
    const rand = rng || Math.random;
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function emptyGrid() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function cloneGrid(grid) {
    return grid.map((row) => [...row]);
}

function isValid(grid, row, col, num) {
    for (let i = 0; i < SIZE; i++) {
        if (grid[row][i] === num || grid[i][col] === num) return false;
    }
    const br = Math.floor(row / BOX) * BOX;
    const bc = Math.floor(col / BOX) * BOX;
    for (let r = br; r < br + BOX; r++) {
        for (let c = bc; c < bc + BOX; c++) {
            if (grid[r][c] === num) return false;
        }
    }
    return true;
}

function fillBox(grid, row, col, rng) {
    const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
    let i = 0;
    for (let r = row; r < row + BOX; r++) {
        for (let c = col; c < col + BOX; c++) {
            grid[r][c] = nums[i++];
        }
    }
}

function fillDiagonal(grid, rng) {
    for (let i = 0; i < SIZE; i += BOX) {
        fillBox(grid, i, i, rng);
    }
}

function solve(grid, rng) {
    const rand = rng || Math.random;
    for (let row = 0; row < SIZE; row++) {
        for (let col = 0; col < SIZE; col++) {
            if (grid[row][col] !== 0) continue;
            const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rand);
            for (const num of nums) {
                if (isValid(grid, row, col, num)) {
                    grid[row][col] = num;
                    if (solve(grid, rand)) return true;
                    grid[row][col] = 0;
                }
            }
            return false;
        }
    }
    return true;
}

function countSolutions(grid, limit = 2) {
    let count = 0;
    function backtrack() {
        if (count >= limit) return;
        for (let row = 0; row < SIZE; row++) {
            for (let col = 0; col < SIZE; col++) {
                if (grid[row][col] !== 0) continue;
                for (let num = 1; num <= 9; num++) {
                    if (isValid(grid, row, col, num)) {
                        grid[row][col] = num;
                        backtrack();
                        grid[row][col] = 0;
                        if (count >= limit) return;
                    }
                }
                return;
            }
        }
        count++;
    }
    backtrack();
    return count;
}

function createPuzzle(solution, clueCount, rng) {
    const puzzle = cloneGrid(solution);
    const cells = [];
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) cells.push([r, c]);
    }
    shuffle(cells, rng);
    let removed = 0;
    const target = SIZE * SIZE - clueCount;
    for (const [row, col] of cells) {
        if (removed >= target) break;
        const backup = puzzle[row][col];
        puzzle[row][col] = 0;
        const test = cloneGrid(puzzle);
        if (countSolutions(test, 2) === 1) removed++;
        else puzzle[row][col] = backup;
    }
    return puzzle;
}

function tick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function createPuzzleAsync(solution, clueCount, rng, onProgress) {
    const puzzle = cloneGrid(solution);
    const cells = [];
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) cells.push([r, c]);
    }
    shuffle(cells, rng);
    let removed = 0;
    const target = SIZE * SIZE - clueCount;
    let step = 0;
    for (const [row, col] of cells) {
        if (removed >= target) break;
        step++;
        if (step % 3 === 0) {
            if (typeof onProgress === 'function') {
                onProgress(0.28 + (removed / Math.max(target, 1)) * 0.68);
            }
            await tick();
        }
        const backup = puzzle[row][col];
        puzzle[row][col] = 0;
        const test = cloneGrid(puzzle);
        if (countSolutions(test, 2) === 1) removed++;
        else puzzle[row][col] = backup;
    }
    return puzzle;
}

function generate(difficulty = 'medium', seed = null) {
    const actualSeed = seed || createSeed();
    const rng = mulberry32(hashSeed(`${actualSeed}:${difficulty}`));
    const grid = emptyGrid();
    fillDiagonal(grid, rng);
    solve(grid, rng);
    const solution = cloneGrid(grid);
    const clueCount = CLUES[difficulty] ?? CLUES.medium;
    const puzzle = createPuzzle(solution, clueCount, rng);
    const given = puzzle.map((row) => row.map((v) => v !== 0));
    return { puzzle, solution, given, seed: actualSeed, difficulty };
}

async function generateAsync(difficulty = 'medium', seed = null, onProgress) {
    const report = (p, label) => {
        if (typeof onProgress === 'function') {
            onProgress(Math.min(1, Math.max(0, p)), label);
        }
    };
    report(0.06, 'Building grid…');
    await tick();
    const actualSeed = seed || createSeed();
    const rng = mulberry32(hashSeed(`${actualSeed}:${difficulty}`));
    const grid = emptyGrid();
    fillDiagonal(grid, rng);
    report(0.18, 'Solving pattern…');
    await tick();
    solve(grid, rng);
    const solution = cloneGrid(grid);
    const clueCount = CLUES[difficulty] ?? CLUES.medium;
    report(0.26, 'Carving puzzle…');
    const puzzle = await createPuzzleAsync(solution, clueCount, rng, (p) => {
        report(p, 'Carving puzzle…');
    });
    const given = puzzle.map((row) => row.map((v) => v !== 0));
    report(1, 'Ready');
    return { puzzle, solution, given, seed: actualSeed, difficulty };
}

function isComplete(grid) {
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (grid[r][c] === 0) return false;
        }
    }
    return true;
}

function hasConflicts(grid) {
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const val = grid[r][c];
            if (val === 0) continue;
            grid[r][c] = 0;
            if (!isValid(grid, r, c, val)) {
                grid[r][c] = val;
                return true;
            }
            grid[r][c] = val;
        }
    }
    return false;
}

function findErrors(grid, solution) {
    const errors = new Set();
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const val = grid[r][c];
            if (val === 0) continue;
            if (val !== solution[r][c]) errors.add(`${r},${c}`);
        }
    }
    return errors;
}

export const Sudoku = {
    SIZE,
    generate,
    generateAsync,
    createSeed,
    isComplete,
    hasConflicts,
    findErrors,
    isValid
};
