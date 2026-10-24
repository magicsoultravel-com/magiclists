/** @module {"owns":"the two-step setup wizard - preset picker, block assignment with drag and drop, the reset control, and the draft it edits before anything is committed to the note", "related":["magicFocus.js","magicFocus/model.js","magicFocus/layout.js","magicFocus/paneMarkup.js"]} */
import { NoteSurface } from '../noteSurface.js';
import { escapeAttr, escapeHTML } from '../domEscape.js';
import {
    BLOCKS,
    PRESET_META,
    BLOCK_ICONS,
    PRESET_ZONE_COUNTS,
    emptyZoom,
    asBlockList,
    allPlacedBlocks,
    removeBlockFromZones,
    createDefaultFocus,
    normalizeFocus,
    focusIsConfigured,
    blockLabel
} from './model.js';
import { layoutForFocus } from './layout.js';
import { presetGlyphHtml } from './paneMarkup.js';


export function renderSetup(magicFocus, item) {
    if (!magicFocus.bodyEl) return;
    if (magicFocus.setupStep === 'assign' && magicFocus.setupDraft) {
        magicFocus._renderAssignStep(item);
    } else {
        magicFocus._renderLayoutStep(item);
    }
}

export function _renderLayoutStep(magicFocus, item) {
    const selected = magicFocus.setupDraft?.preset || null;
    const presetsHtml = PRESET_META.map((p) => `
        <button type="button" class="magic-focus__preset${p.id === selected ? ' is-active' : ''}" data-focus-preset="${p.id}" title="${escapeAttr(p.label)}" aria-label="${escapeAttr(p.label)}">
            ${presetGlyphHtml(p.id)}
        </button>
    `).join('');

    magicFocus.bodyEl.innerHTML = `
        <div class="magic-focus__setup magic-focus__setup--layout">
            <div class="magic-focus__setup-hero">
                <h2 class="magic-focus__setup-heading">Layout</h2>
            </div>
            <div class="magic-focus__presets" role="listbox" aria-label="Layout">${presetsHtml}</div>
            <div class="magic-focus__setup-actions">
                <button type="button" class="btn btn--compact" data-focus-setup-reset>Reset</button>
                <button type="button" class="btn btn--compact" data-focus-setup-cancel>Cancel</button>
            </div>
        </div>
    `;
    magicFocus._bindLayoutStepEvents(item);
}

export function _renderAssignStep(magicFocus, item) {
    const draft = magicFocus.setupDraft;
    if (!draft) {
        magicFocus.setupStep = 'layout';
        magicFocus._renderLayoutStep(item);
        return;
    }
    const count = PRESET_ZONE_COUNTS[draft.preset] || 2;
    const placed = allPlacedBlocks(draft.zones);
    const layout = layoutForFocus(draft);

    const paletteHtml = BLOCKS.map((b) => `
        <div class="magic-focus__tile${placed.has(b.id) ? ' is-placed' : ''}"
             draggable="${placed.has(b.id) ? 'false' : 'true'}"
             data-focus-tile="${b.id}"
             title="${escapeAttr(b.label)}">
            <span class="magic-focus__tile-icon" aria-hidden="true">${BLOCK_ICONS[b.id] || ''}</span>
            <span class="magic-focus__tile-label">${escapeHTML(b.label)}</span>
        </div>
    `).join('');

    const zoneSlots = [];
    for (let i = 0; i < count; i += 1) {
        const zid = `z${i}`;
        const blocks = asBlockList(draft.zones[zid]);
        const tiles = blocks.map((block) => `
            <div class="magic-focus__tile magic-focus__tile--in-zone" draggable="true" data-focus-tile="${block}" data-from-zone="${zid}">
                <span class="magic-focus__tile-icon" aria-hidden="true">${BLOCK_ICONS[block] || ''}</span>
                <span class="magic-focus__tile-label">${escapeHTML(blockLabel(block))}</span>
            </div>
        `).join('');
        zoneSlots.push(`
            <div class="magic-focus__zone-slot${blocks.length ? ' has-block' : ''}" data-focus-zone="${zid}" style="grid-area:${zid}">
                ${blocks.length
                    ? tiles
                    : `<span class="magic-focus__zone-placeholder">${escapeHTML(String.fromCharCode(65 + i))}</span>`}
            </div>
        `);
    }

    magicFocus.bodyEl.innerHTML = `
        <div class="magic-focus__setup magic-focus__setup--assign">
            <div class="magic-focus__assign-chrome">
                <div class="magic-focus__palette magic-focus__palette--row" data-focus-palette aria-label="Blocks">
                    ${paletteHtml}
                </div>
                <div class="magic-focus__assign-tools">
                    <button type="button" class="btn btn--compact magic-focus__change-layout" data-focus-change-layout title="Change layout" aria-label="Change layout">
                        ${presetGlyphHtml(draft.preset)}
                    </button>
                    <button type="button" class="btn btn--compact" data-focus-setup-reset>Reset</button>
                    <button type="button" class="btn btn--compact" data-focus-setup-back>Back</button>
                    <button type="button" class="btn btn--compact" data-focus-setup-cancel>Cancel</button>
                    <button type="button" class="btn btn--compact magic-focus__btn-apply" data-focus-setup-apply>Apply</button>
                </div>
            </div>
            <div class="magic-focus__layout-preview" data-focus-zones>
                ${zoneSlots.join('')}
            </div>
        </div>
    `;
    const preview = magicFocus.bodyEl.querySelector('[data-focus-zones]');
    if (preview) {
        preview.style.gridTemplateColumns = layout.columns;
        preview.style.gridTemplateRows = layout.rows;
        preview.style.gridTemplateAreas = layout.areas;
    }
    magicFocus._bindAssignStepEvents(item);
}

export function _resetFocusConfig(magicFocus, item) {
    NoteSurface.mutateItem(item, (it) => {
        it.focus = null;
    }, { preserveView: true, skipRerender: true });
    magicFocus.setupDraft = null;
    magicFocus.setupStep = 'layout';
    magicFocus.renderSetup(magicFocus.resolveItem() || item);
}

export function _bindLayoutStepEvents(magicFocus, item) {
    const root = magicFocus.bodyEl;
    root.querySelectorAll('[data-focus-preset]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const preset = btn.getAttribute('data-focus-preset');
            const prevZones = magicFocus.setupDraft?.zones || {};
            const prevZoom = magicFocus.setupDraft?.zoom || item?.focus?.zoom;
            const next = createDefaultFocus(preset);
            next.zoom = emptyZoom(PRESET_ZONE_COUNTS[preset], prevZoom);
            const seen = new Set();
            for (let i = 0; i < PRESET_ZONE_COUNTS[preset]; i += 1) {
                const key = `z${i}`;
                asBlockList(prevZones[key]).forEach((id) => {
                    if (seen.has(id)) return;
                    next.zones[key].push(id);
                    seen.add(id);
                });
            }
            magicFocus.setupDraft = next;
            magicFocus.setupStep = 'assign';
            magicFocus.renderSetup(item);
        });
    });

    root.querySelector('[data-focus-setup-reset]')?.addEventListener('click', () => {
        magicFocus._resetFocusConfig(item);
    });

    root.querySelector('[data-focus-setup-cancel]')?.addEventListener('click', async () => {
        if (focusIsConfigured(item.focus)) {
            magicFocus.showingSetup = false;
            await magicFocus.renderWork(item);
        } else {
            await magicFocus.close();
        }
    });
}

export function _bindAssignStepEvents(magicFocus, item) {
    const root = magicFocus.bodyEl;

    root.querySelector('[data-focus-change-layout]')?.addEventListener('click', () => {
        magicFocus.setupStep = 'layout';
        magicFocus.renderSetup(item);
    });
    root.querySelector('[data-focus-setup-back]')?.addEventListener('click', () => {
        magicFocus.setupStep = 'layout';
        magicFocus.renderSetup(item);
    });
    root.querySelector('[data-focus-setup-reset]')?.addEventListener('click', () => {
        magicFocus._resetFocusConfig(item);
    });

    let dragTile = null;

    root.querySelectorAll('[data-focus-tile]').forEach((tile) => {
        tile.addEventListener('dragstart', (e) => {
            if (tile.classList.contains('is-placed')) {
                e.preventDefault();
                return;
            }
            dragTile = tile.getAttribute('data-focus-tile');
            tile.classList.add('is-dragging');
            e.dataTransfer?.setData('text/plain', dragTile);
            e.dataTransfer.effectAllowed = 'move';
        });
        tile.addEventListener('dragend', () => {
            tile.classList.remove('is-dragging');
            dragTile = null;
        });
    });

    const assignToZone = (zoneId, blockId) => {
        if (!magicFocus.setupDraft || !blockId) return;
        removeBlockFromZones(magicFocus.setupDraft.zones, blockId);
        const list = asBlockList(magicFocus.setupDraft.zones[zoneId]);
        list.push(blockId);
        magicFocus.setupDraft.zones[zoneId] = list;
        magicFocus.renderSetup(item);
    };

    root.querySelectorAll('[data-focus-zone]').forEach((slot) => {
        slot.addEventListener('dragover', (e) => {
            e.preventDefault();
            slot.classList.add('is-dragover');
        });
        slot.addEventListener('dragleave', () => slot.classList.remove('is-dragover'));
        slot.addEventListener('drop', (e) => {
            e.preventDefault();
            slot.classList.remove('is-dragover');
            const blockId = dragTile || e.dataTransfer?.getData('text/plain');
            assignToZone(slot.getAttribute('data-focus-zone'), blockId);
        });
        slot.addEventListener('dblclick', (e) => {
            // Double-click a tile to remove it; empty zone click clears nothing useful
            const tile = e.target.closest?.('[data-focus-tile][data-from-zone]');
            if (tile && magicFocus.setupDraft) {
                removeBlockFromZones(magicFocus.setupDraft.zones, tile.getAttribute('data-focus-tile'));
                magicFocus.renderSetup(item);
            }
        });
    });

    const palette = root.querySelector('[data-focus-palette]');
    palette?.addEventListener('dragover', (e) => e.preventDefault());
    palette?.addEventListener('drop', (e) => {
        e.preventDefault();
        const blockId = dragTile || e.dataTransfer?.getData('text/plain');
        if (!blockId || !magicFocus.setupDraft) return;
        removeBlockFromZones(magicFocus.setupDraft.zones, blockId);
        magicFocus.renderSetup(item);
    });

    root.querySelector('[data-focus-setup-cancel]')?.addEventListener('click', async () => {
        if (focusIsConfigured(item.focus)) {
            magicFocus.showingSetup = false;
            await magicFocus.renderWork(item);
        } else {
            await magicFocus.close();
        }
    });

    root.querySelector('[data-focus-setup-apply]')?.addEventListener('click', async () => {
        const draft = normalizeFocus(magicFocus.setupDraft);
        NoteSurface.mutateItem(item, (it) => {
            it.focus = draft;
        }, { preserveView: true, skipRerender: true });
        magicFocus.showingSetup = false;
        magicFocus.setupDraft = null;
        magicFocus.setupStep = 'layout';
        await magicFocus.renderWork(magicFocus.resolveItem() || item);
    });
}
