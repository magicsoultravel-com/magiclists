/** @module {"owns":"the two pieces of board state the ui sessions read - the id->item lookup that render fills and the mutations update, plus the view mode the spatial layer falls back to; accessors only, so no session reaches into another session's closure", "related":["ui.js","ui/spatial.js","ui/render.js"]} */

// The lookup is replaced wholesale by render() (after clearing), so the seam is
// a setter - not just set/delete - and readers must go through the accessor
// instead of capturing the Map.
let boardItemsById = new Map();
let activeBoardViewMode = 'grid';

export function getBoardItemsMap() {
    return boardItemsById;
}

export function replaceBoardItemsMap(next) {
    boardItemsById = next instanceof Map ? next : new Map();
}

export function getBoardItem(itemId) {
    if (!itemId) return null;
    return boardItemsById.get(itemId) || null;
}

export function setBoardItem(item) {
    if (!item?.id) return;
    boardItemsById.set(item.id, item);
}

export function clearBoardItems() {
    boardItemsById.clear();
}

export function readActiveBoardViewMode() {
    return activeBoardViewMode;
}

export function writeActiveBoardViewMode(mode) {
    activeBoardViewMode = mode;
}
