/** @module {"owns":"section/subsection Focus-spawn tray button HTML and click binding", "related":["magicFocus.js","noteSurfaceHtml.js","plannerUi.js","noteAttachmentsUi.js","noteSurfaceEditing.js"]} */
import { CARD_ICONS } from './icons.js';
import { escapeAttr } from './domEscape.js';

const SPAWN_LABELS = Object.freeze({
    content: 'Content',
    text: 'Text',
    checklist: 'Checklist',
    planner: 'Plan',
    table: 'Table',
    chart: 'Chart',
    kanban: 'Kanban',
    wbs: 'WBS',
    canvas: 'Canvas'
});

/**
 * @param {string} spawnKey
 * @param {string} [label]
 * @param {{ className?: string }} [opts] — use the host tray’s button class so it matches siblings
 * @returns {string}
 */
export function renderFocusSpawnBtnHtml(spawnKey, label, { className = 'card-act planner-section__module-btn' } = {}) {
    const key = String(spawnKey || '').trim();
    if (!key) return '';
    const title = label || SPAWN_LABELS[key] || key;
    const cls = String(className || 'card-act planner-section__module-btn').trim();
    return `<button type="button" class="${escapeAttr(cls)}" data-focus-spawn="${escapeAttr(key)}" title="Focus ${escapeAttr(title)}" aria-label="Focus ${escapeAttr(title)}">${CARD_ICONS.expandMedia}</button>`;
}

/** Hover-reveal tray matching Plan modules — for headers that have no other actions. */
export function renderFocusSpawnTrayHtml(spawnKey, label) {
    const btn = renderFocusSpawnBtnHtml(spawnKey, label);
    if (!btn) return '';
    return `<div class="planner-section__modules" role="group" aria-label="Focus">${btn}</div>`;
}

/** Hover-reveal tray matching Kanban/WBS tools — for subs that have no other tools. */
export function renderFocusSpawnSubTrayHtml(spawnKey, label) {
    const btn = renderFocusSpawnBtnHtml(spawnKey, label, {
        className: 'card-act planner-section__module-btn'
    });
    if (!btn) return '';
    return `<div class="planner-sub__tools" role="group" aria-label="Focus">${btn}</div>`;
}

/**
 * @param {string} spawnKey
 * @param {object} item
 * @param {HTMLElement|null} [contextEl]
 * @returns {string[]}
 */
export function resolveFocusSpawnBlocks(spawnKey, item, contextEl = null) {
    const key = String(spawnKey || '').trim();
    switch (key) {
        case 'text':
            return ['text'];
        case 'checklist':
            return ['checklist'];
        case 'table':
            return ['table'];
        case 'chart':
            return ['chart'];
        case 'kanban':
            return ['kanban'];
        case 'wbs':
            return ['wbs'];
        case 'canvas':
            return ['canvas'];
        // Parent sections always spawn every subsection in one expanded pane.
        case 'content':
            return ['text', 'checklist'];
        case 'planner':
            return ['table', 'chart', 'kanban', 'wbs'];
        default:
            return [];
    }
}

/**
 * @param {HTMLElement} root
 * @param {object} item
 */
export function bindFocusSpawnButtons(root, item) {
    if (!root || !item?.id) return;
    if (root.closest?.('.magic-focus__pane')) return;
    if (root.dataset.focusSpawnBound === '1') return;
    root.dataset.focusSpawnBound = '1';
    // Capture so parent section headers that stopPropagation on bubble still work.
    root.addEventListener('click', (e) => {
        const btn = e.target.closest?.('[data-focus-spawn]');
        if (!btn || !root.contains(btn)) return;
        if (btn.closest?.('.magic-focus__pane')) return;
        e.preventDefault();
        e.stopPropagation();
        const spawnKey = btn.getAttribute('data-focus-spawn') || '';
        const blocks = resolveFocusSpawnBlocks(spawnKey, item, btn);
        if (!blocks.length) return;
        import('./magicFocus.js').then(({ MagicFocus }) => {
            MagicFocus.openExpandedBlocks(item, blocks);
        }).catch(() => {});
    }, true);
}
