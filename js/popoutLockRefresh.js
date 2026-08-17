/** @module {"owns":"popout lock board refresh filter", "related":["app.js","notePopoutBridge.js"]} */

/**
 * Whether a board card needs a lock-chrome refresh for popout claim state.
 * @param {string} noteId
 * @param {{ classList?: { contains: (cls: string) => boolean } }} card
 * @param {{ isClaimedByOther: (id: string) => boolean, isPoppedOut: (id: string) => boolean }} bridge
 */
export function shouldRefreshPopoutLockedCard(noteId, card, bridge) {
    const claimed = bridge.isClaimedByOther(noteId);
    const popped = bridge.isPoppedOut(noteId);
    const domLocked = card?.classList?.contains('is-popout-locked') ?? false;

    if (!claimed && !popped && !domLocked) return false;
    if (domLocked === claimed && claimed) return false;

    return true;
}
