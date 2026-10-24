/** @module {"owns":"note card quick-action toolbar markup - the filed/open toggle, pin, color, media, planner, flowchart and more menu", "related":["noteSurfaceHtml.js","noteQuickActions.js","icons.js"]} */
import { CARD_ICONS } from '../icons.js';
import { escapeHTML, escapeAttr } from '../domEscape.js';
import { LEGACY_TILE_SIZE, isCollapsedSpatialSize } from '../tileGeometry.js';
import { normalizeAttachments } from '../mediaAttachments.js';

export function buildNoteQuickActionsHtml(item, {
    surface = 'board',
    isExpanded = false,
    pinned = false,
    showDrag = false,
    showArchive = false,
    spatialTile = false,
    tileSize = LEGACY_TILE_SIZE,
    tileW = 0,
    tileH = 0,
    calHidden = !!(item?.hideFromCalendar),
    poppedOut = false,
    windowCollapsed = false
} = {}) {
    const isModal = surface === 'modal';
    const isPopout = surface === 'popout';
    let expandTitle;
    let lastIcon;
    if (isModal) {
        expandTitle = 'Show on board';
        lastIcon = CARD_ICONS.collapse;
    } else if (spatialTile) {
        const atSmall = isCollapsedSpatialSize(tileW, tileH, tileSize);
        expandTitle = atSmall ? 'Expand' : 'Collapse to small';
        lastIcon = atSmall ? CARD_ICONS.expand : CARD_ICONS.collapse;
    } else {
        expandTitle = isExpanded ? 'Collapse note' : 'Expand note';
        lastIcon = isExpanded ? CARD_ICONS.collapse : CARD_ICONS.expand;
    }
    const lastClass = isModal ? 'card-act--close' : 'card-act--toggle';
    const lastId = isModal ? ' id="modal-close-btn"' : '';
    const pinTitle = pinned ? 'Unpin position (locks drag)' : 'Pin position (locks drag)';
    const pinBtn = (isModal || isPopout)
        ? ''
        : `<button type="button" class="card-act card-act--pin${pinned ? ' is-active' : ''}" title="${pinTitle}" aria-label="${pinTitle}" aria-pressed="${pinned ? 'true' : 'false'}">${pinned ? CARD_ICONS.unpin : CARD_ICONS.pin}</button>`;
    const calTitle = calHidden
        ? 'Hidden from calendar — click to show'
        : 'Shown on calendar — click to hide';
    const calBtn = `<button type="button" class="card-act card-act--cal${calHidden ? ' is-off' : ' is-on'}" title="${escapeAttr(calTitle)}" aria-label="${escapeAttr(calTitle)}">${CARD_ICONS.calendar}</button>`;
    // Board/modal: popout is a normal suite icon. Popout window: omit it (close = pop in).
    const popTitle = poppedOut ? 'Focus popout window' : 'Pop out note';
    const popBtn = isPopout
        ? ''
        : `<button type="button" class="card-act card-act--popout${poppedOut ? ' is-active' : ''}" data-note-id="${escapeAttr(item?.id || '')}" title="${escapeAttr(popTitle)}" aria-label="${escapeAttr(popTitle)}" aria-pressed="${poppedOut ? 'true' : 'false'}">${poppedOut ? CARD_ICONS.popoutExit : CARD_ICONS.popout}</button>`;
    const canvasActive = !!(item?.canvas && !item?.canvasHidden);
    const drawTitle = canvasActive ? 'Hide note canvas' : 'Show note canvas';
    const drawBtn = isPopout
        ? ''
        : `<button type="button" class="card-act card-act--draw${canvasActive ? ' is-active' : ''}" data-note-id="${escapeAttr(item?.id || '')}" title="${escapeAttr(drawTitle)}" aria-label="${escapeAttr(drawTitle)}" aria-pressed="${canvasActive ? 'true' : 'false'}">${CARD_ICONS.drawingPencil}</button>`;
    const plannerActive = !!(item?.planner && !item?.plannerHidden);
    const plannerTitle = plannerActive ? 'Hide planner' : 'Show planner';
    const plannerBtn = isPopout
        ? ''
        : `<button type="button" class="card-act card-act--planner${plannerActive ? ' is-active' : ''}" data-note-id="${escapeAttr(item?.id || '')}" title="${escapeAttr(plannerTitle)}" aria-label="${escapeAttr(plannerTitle)}" aria-pressed="${plannerActive ? 'true' : 'false'}">${CARD_ICONS.planner}</button>`;
    const flowchartActive = !!(item?.flowchart && !item?.flowchartHidden);
    const flowchartTitle = flowchartActive ? 'Hide flowchart' : 'Show flowchart';
    const flowchartBtn = isPopout
        ? ''
        : `<button type="button" class="card-act card-act--flowchart${flowchartActive ? ' is-active' : ''}" data-note-id="${escapeAttr(item?.id || '')}" title="${escapeAttr(flowchartTitle)}" aria-label="${escapeAttr(flowchartTitle)}" aria-pressed="${flowchartActive ? 'true' : 'false'}">${CARD_ICONS.flowchart}</button>`;
    const isFocusSurface = surface === 'focus';
    let focusActive = false;
    try {
        // Lazy: MagicFocus may not be loaded yet during first paint
        focusActive = !!(typeof window !== 'undefined' && window.__MagicFocusIsOpenFor?.(item?.id));
    } catch { /* ignore */ }
    const focusTitle = focusActive ? 'Exit magicFocus' : 'Open magicFocus';
    const focusBtn = (!isPopout && plannerActive)
        ? `<button type="button" class="card-act card-act--focus${focusActive || isFocusSurface ? ' is-active' : ''}" data-note-id="${escapeAttr(item?.id || '')}" title="${escapeAttr(focusTitle)}" aria-label="${escapeAttr(focusTitle)}" aria-pressed="${focusActive || isFocusSurface ? 'true' : 'false'}">${CARD_ICONS.focus}</button>`
        : '';
    // Board/modal: while a popout owns the note, offer a recall action that
    // returns it to the board (closes the popout after saving).
    const popinTitle = 'Pop in (return note to board)';
    const popinBtn = (!isPopout && poppedOut)
        ? `<button type="button" class="card-act card-act--popin" title="${popinTitle}" aria-label="${popinTitle}">${CARD_ICONS.popin}</button>`
        : '';
    // Popout window: pop-in sits next to calendar (left side of the suite).
    const closeTitle = 'Pop in (close window)';
    const closeBtn = isPopout
        ? `<button type="button" class="card-act card-act--close" id="modal-close-btn" title="${closeTitle}" aria-label="${closeTitle}">${CARD_ICONS.popoutExit}</button>`
        : '';
    const windowSizeTitle = windowCollapsed ? 'Expand window' : 'Collapse window';
    const windowSizeIcon = windowCollapsed ? CARD_ICONS.expand : CARD_ICONS.collapse;
    const windowSizeBtn = isPopout
        ? `<button type="button" class="card-act card-act--window-size" title="${windowSizeTitle}" aria-label="${windowSizeTitle}" aria-pressed="${windowCollapsed ? 'true' : 'false'}">${windowSizeIcon}</button>`
        : '';
    const showDragIcon = !isPopout && (isModal || (showDrag && !pinned));
    const dragBtn = showDragIcon
        ? `<button type="button" class="card-act card-act--drag" title="Drag to move" aria-label="Drag to move">${CARD_ICONS.drag}</button>`
        : '';
    const editTitle = isPopout ? 'Pop in' : (isModal ? 'Close' : 'Edit note');
    const editBtn = isPopout
        ? ''
        : `<button type="button" class="card-act card-act--edit" title="${editTitle}" aria-label="${editTitle}">${CARD_ICONS.edit}</button>`;
    const hideBtn = isPopout
        ? ''
        : `<button type="button" class="card-act card-act--hide" title="Hide from board" aria-label="Hide from board">${CARD_ICONS.hide}</button>`;
    const attachCount = normalizeAttachments(item?.attachments).length;
    const attachTitle = attachCount
        ? `Attach media (${attachCount})`
        : 'Attach media';
    const attachBtn = `<button type="button" class="card-act card-act--attach${attachCount ? ' is-active' : ''}" title="${escapeAttr(attachTitle)}" aria-label="${escapeAttr(attachTitle)}" aria-pressed="${attachCount ? 'true' : 'false'}">${CARD_ICONS.attach}</button>`;
    // Board: popout, draw, planner, [focus], cal, popin (popped only), emoji, copy, note-package, [pin], color, attach, hide, edit, [drag], toggle
    // Popout: cal, close (pop in), emoji, copy, note-package, color, attach, window-size
    let actionCount = isPopout ? 8 : 13;
    if (!isModal && !isPopout && showDragIcon) actionCount += 1;
    if (!isPopout && poppedOut) actionCount += 1; // popin
    if (focusBtn) actionCount += 1;

    if (showArchive) actionCount += 1;
    const archiveBtn = showArchive
        ? `<button type="button" id="modal-archive-btn" class="card-act card-act--archive" title="Move to Archive" aria-label="Move to Archive">${CARD_ICONS.delete}</button>`
        : '';
    const lastBtn = isPopout
        ? windowSizeBtn
        : `<button type="button" class="card-act ${lastClass}"${lastId} title="${escapeHTML(expandTitle).replace(/"/g, "")}" aria-label="${escapeHTML(expandTitle).replace(/"/g, "")}">${lastIcon}</button>`;
    const actionsHtml = `<div class="card-actions${(isModal || isPopout || isFocusSurface) ? ' modal-card-actions' : ''}" data-action-count="${actionCount}" data-surface="${surface}">
            ${popBtn}
            ${drawBtn}
            ${plannerBtn}
            ${flowchartBtn}
            ${focusBtn}
            ${calBtn}
            ${closeBtn}
            ${popinBtn}
            <button type="button" class="card-act card-act--emoji" title="Insert emoji" aria-label="Insert emoji" aria-haspopup="dialog" aria-expanded="false">${CARD_ICONS.insertEmoji}</button>
            <button type="button" class="card-act card-act--copy" title="Copy note as text" aria-label="Copy note as text">${CARD_ICONS.copy}</button>
            <button type="button" class="card-act card-act--note-package" title="Export note" aria-label="Export note">${CARD_ICONS.download}</button>
            ${pinBtn}
            <button type="button" class="card-act card-act--color" title="Note color" aria-label="Note color" aria-haspopup="dialog">${CARD_ICONS.color}</button>
            ${attachBtn}
            ${hideBtn}
            ${editBtn}
            ${dragBtn}

            ${lastBtn}
        </div>`;
    return (isModal || isPopout || isFocusSurface) ? `${archiveBtn}${actionsHtml}` : actionsHtml;
}
