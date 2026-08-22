/** @module {"owns":"shared sidebar note list row HTML", "related":["hamburger.js","mediaLibraryOverlay.js"]} */
import { escapeAttr, escapeHTML } from './domEscape.js';
import { resolveNoteColor } from './colorPicker.js';
import { NoteSurface } from './noteSurface.js';
import { stripRichText, hasRichMarkup } from './richText.js';

/**
 * @param {object} item
 */
export function buildSidebarNoteTitle(item) {
    const plainTitle = stripRichText(item.title || '') || 'Untitled';
    const titleRich = hasRichMarkup(item.title);
    const titleHtml = titleRich
        ? NoteSurface.renderRichHtml(item.title || '')
        : escapeHTML(plainTitle);
    return {
        titleAttr: escapeAttr(plainTitle),
        titleHtml,
        richClass: titleRich ? ' rich-text' : ''
    };
}

/**
 * @param {object} item
 * @param {{
 *   selected?: boolean,
 *   variant?: 'button' | 'with-act',
 *   trailingActionHtml?: string,
 *   extraClass?: string,
 *   dataIdAttr?: string
 * }} [opts]
 */
export function buildSidebarNoteListItemHtml(item, opts = {}) {
    const {
        selected = false,
        variant = 'button',
        trailingActionHtml = '',
        extraClass = '',
        dataIdAttr = 'data-id'
    } = opts;
    const accent = resolveNoteColor(item.backgroundColor);
    const { titleAttr, titleHtml, richClass } = buildSidebarNoteTitle(item);
    const dateLabel = NoteSurface.formatNoteListDate(item);
    const accentStyle = ` style="--note-accent:${escapeAttr(accent)}"`;
    const selectedClass = selected ? ' is-selected' : '';

    if (variant === 'with-act') {
        return `
            <div class="sidebar-notes-list-item has-note-color sidebar-notes-list-item--with-act${selectedClass}${extraClass}"${accentStyle}>
                <button type="button" class="sidebar-notes-list-item-main" ${dataIdAttr}="${escapeAttr(item.id)}" title="${titleAttr}">
                    <span class="sidebar-notes-list-item-title${richClass}">${titleHtml}</span>
                    <span class="sidebar-notes-list-date">${escapeHTML(dateLabel)}</span>
                </button>
                ${trailingActionHtml}
            </div>`;
    }

    return `
        <button type="button" class="sidebar-notes-list-item has-note-color${selectedClass}${extraClass}" ${dataIdAttr}="${escapeAttr(item.id)}" title="${titleAttr}"${accentStyle}>
            <span class="sidebar-notes-list-item-title${richClass}">${titleHtml}</span>
            <span class="sidebar-notes-list-date">${escapeHTML(dateLabel)}</span>
        </button>`;
}
