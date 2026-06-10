export const LessonsBasics = [
    { title: 'The goal', body: 'Fill every row, column, and 3×3 box with digits 1–9. Each digit may appear only once per row, column, and box.' },
    { title: 'How puzzles are made', body: 'Every game is procedurally generated from a seed (key icon in the menu). The same seed and difficulty always produces the same puzzle.' },
    { title: 'Start with certainties', body: 'Scan rows, columns, and boxes for cells where only one number can fit.' },
    { title: 'Use pencil marks', body: 'Toggle pencil mode, pick a number on the numpad, then tap empty cells to mark candidates.' },
    { title: 'Naked singles', body: 'If a cell has only one possible candidate left, place that digit.' },
    { title: 'Hidden singles', body: 'Sometimes a digit can only go in one cell within a row, column, or box.' },
    { title: 'Work in passes', body: 'After each placement, rescan the board.' },
    { title: 'When stuck', body: 'Use Check to verify mistakes without revealing answers.' }
];

export const LessonsAdvanced = [
    { title: 'Pointing pairs & triples', body: 'If candidates for a digit in a box are confined to one row or column, eliminate that digit from the rest of that line outside the box.' },
    { title: 'Naked pairs & triples', body: 'When two cells in a unit contain exactly the same two candidates, those digits belong to those cells.' },
    { title: 'Hidden pairs & triples', body: 'Two digits appear as candidates in only two cells of a unit — strip other candidates from those cells.' },
    { title: 'Box-line reduction', body: 'If a row\'s candidates for a number all lie in one box, that number cannot appear elsewhere in the box on a different row.' },
    { title: 'X-Wing', body: 'A digit appears in exactly two cells in two rows, aligned in the same two columns — eliminate from those columns.' },
    { title: 'Swordfish', body: 'Extension of X-Wing across three rows and three columns.' },
    { title: 'XY-Wing', body: 'Three cells with paired candidates force an elimination in a cell that sees both wings.' },
    { title: 'Unique rectangles', body: 'Four corners with matching pairs can force a unique solution — eliminate extra candidates.' },
    { title: 'Coloring & chains', body: 'Track a single candidate in strong links; same-colored cells that see each other are impossible.' },
    { title: 'When to guess', body: 'A well-generated puzzle never requires guessing. Revisit pencil marks first.' }
];
