/** @module {"owns":"magicCanvas toolbar session (render, bind, menu chrome)", "related":["drawingBoard.js","drawingToolbarMenu.js","drawingToolbarChrome.js"]} */
import { ACTION_ICONS, CARD_ICONS, DRAWING_ICONS, FORMAT_ICONS } from './icons.js';
import { ColorPicker, PALETTE_UNIFIED } from './colorPicker.js';
import { DrawingToolbarMenu, CHEVRON } from './drawingToolbarMenu.js';
import { Fullscreen } from './fullscreen.js';
import {
    getActiveBackground,
    PAGE_FORMATS, BACKGROUNDS
} from './canvasDocument.js';
import { CanvasViewport } from './canvasViewport.js';
import { showAppToast } from './toast.js';
import { FLOW_LABEL_MIN, FLOW_LABEL_MAX } from './flowchart.js';
import { stripRichText } from './richText.js';
import {
    migrateNoteCanvasTextFlags,
    resolveOverlayFontSize,
    overlayFontSizeToPercent,
    OVERLAY_FONT_MIN, OVERLAY_FONT_MAX, OVERLAY_FONT_STEP
} from './noteCanvasTextOverlay.js';
import {
    WIDTH_MIN, WIDTH_MAX,
    POINTER_ITEMS, SHAPE_ITEMS, GRID_BACKGROUNDS, WRITING_BACKGROUNDS,
    isDragShape, FORMAT_ITEMS
} from './drawingBoardCore.js';

export function updatePointerWidthLabel(board) {
        board.updateBrushSizeControls();
}

export function updateBrushSizeControls(board) {
        const width = board.currentBrush().width;
        const label = board.toolbarEl?.querySelector('#draw-brush-width');
        if (label) label.textContent = width + 'px';
        const smaller = board.toolbarEl?.querySelector('#draw-brush-smaller');
        const larger = board.toolbarEl?.querySelector('#draw-brush-larger');
        if (smaller) smaller.disabled = width <= WIDTH_MIN;
        if (larger) larger.disabled = width >= WIDTH_MAX;
}

export function updateColorChip(board, color) {
        const chip = board.toolbarEl?.querySelector('.drawing-color-chip');
        const btn = board.toolbarEl?.querySelector('#draw-color-btn');
        if (chip) chip.style.background = color;
        if (btn) btn.style.setProperty('--chip-color', color);
}

export function toggleColorRollout(board, anchor) {
        if (board.colorRolloutOpen) {
            ColorPicker.close();
            return;
        }
        ColorPicker.close();
        board.bgColorRolloutOpen = false;
        const brush = board.currentBrush();
        ColorPicker.open({
            anchor,
            presets: PALETTE_UNIFIED,
            value: brush.color,
            align: 'end',
            onSelect: (c) => board.setColor(c, { rerender: false }),
            onClose: () => { board.colorRolloutOpen = false; }
        });
        board.colorRolloutOpen = true;
        anchor?.setAttribute('aria-expanded', 'true');
}

export function currentToolEcho(board) {
        if (board.isLassoActive) {
            return { id: 'lasso', label: 'Select', icon: DRAWING_ICONS.lasso };
        }
        const tool = board.activeTool;
        if (tool === 'pan') {
            return { id: 'pan', label: 'Hand', icon: DRAWING_ICONS.hand };
        }
        if (tool === 'eraser') {
            return { id: 'eraser', label: 'Eraser', icon: DRAWING_ICONS.eraser };
        }
        if (tool === 'pointer') {
            return { id: 'pointer', label: 'Pointer', icon: DRAWING_ICONS.pointer };
        }
        if (tool === 'text') {
            return { id: 'text', label: 'Text', icon: DRAWING_ICONS.text };
        }
        if (tool === 'crop') {
            return { id: 'crop', label: 'Crop', icon: DRAWING_ICONS.crop };
        }
        if (isDragShape(tool)) {
            const shape = SHAPE_ITEMS.find((item) => item.id === tool);
            return {
                id: tool,
                label: shape?.label || 'Shape',
                icon: DRAWING_ICONS[tool] || DRAWING_ICONS.shapes
            };
        }
        if (tool === 'brush') {
            const style = POINTER_ITEMS.find((item) => item.id === board.activeStyle);
            return {
                id: board.activeStyle,
                label: style?.label || 'Brush',
                icon: DRAWING_ICONS[board.activeStyle] || DRAWING_ICONS.pen
            };
        }
        return {
            id: tool || 'pointer',
            label: tool || 'Pointer',
            icon: DRAWING_ICONS[tool] || DRAWING_ICONS.pointer
        };
}

export function updateToolEcho(board) {
        const echo = board.currentToolEcho();
        const root = document.getElementById('draw-tool-echo');
        const iconEl = document.getElementById('draw-tool-echo-icon');
        const labelEl = document.getElementById('draw-tool-echo-label');
        if (!root || !iconEl || !labelEl) return;
        iconEl.innerHTML = echo.icon || '';
        labelEl.textContent = echo.label;
        root.dataset.tool = echo.id;
        root.setAttribute('aria-label', `Current tool: ${echo.label}`);
        root.title = `Current tool: ${echo.label}`;
}

export function updateNoteToolbarChrome(board) {
        const titleEl = document.getElementById('draw-note-title');
        const contentBtn = document.getElementById('draw-note-show-content');
        const checklistBtn = document.getElementById('draw-note-show-checklist');
        const plannerTableBtn = document.getElementById('draw-note-show-planner-table');
        const plannerChartBtn = document.getElementById('draw-note-show-planner-chart');
        const sizeGroup = document.getElementById('draw-note-overlay-size-group');
        const sizeLabel = document.getElementById('draw-note-overlay-size');
        const smallerBtn = document.getElementById('draw-note-overlay-smaller');
        const largerBtn = document.getElementById('draw-note-overlay-larger');
        const noteMode = !!(board.isNoteCanvasMode && board.noteCanvasItem);
        const plannerActive = !!(board.noteCanvasItem?.planner && !board.noteCanvasItem?.plannerHidden);
        if (board.noteCanvasItem) migrateNoteCanvasTextFlags(board.noteCanvasItem);

        if (titleEl) {
            if (noteMode) {
                const full = stripRichText(board.noteCanvasItem.title || '').trim() || 'Untitled';
                titleEl.textContent = full;
                titleEl.title = full;
                titleEl.setAttribute('aria-label', full);
                titleEl.hidden = false;
                titleEl.classList.remove('is-hidden');
            } else {
                titleEl.textContent = '';
                titleEl.removeAttribute('title');
                titleEl.removeAttribute('aria-label');
                titleEl.hidden = true;
                titleEl.classList.add('is-hidden');
            }
        }

        const bindToggle = (btn, { on, titleOn, titleOff, icon, flag, visible = noteMode }) => {
            if (!btn) return;
            if (visible) {
                btn.hidden = false;
                btn.classList.remove('is-hidden');
                btn.classList.toggle('active', on);
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                btn.title = on ? titleOn : titleOff;
                btn.setAttribute('aria-label', on ? titleOn : titleOff);
                if (!btn.dataset.bound) {
                    btn.dataset.bound = '1';
                    btn.innerHTML = icon;
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        board.toggleNoteTextOverlayLayer(flag);
                    });
                }
            } else {
                btn.hidden = true;
                btn.classList.add('is-hidden');
                btn.classList.remove('active');
                btn.setAttribute('aria-pressed', 'false');
            }
        };

        bindToggle(contentBtn, {
            on: !!board.noteCanvasItem?.canvasShowNoteContent,
            titleOn: 'Hide note content',
            titleOff: 'Show note content',
            icon: DRAWING_ICONS.text,
            flag: 'content'
        });
        bindToggle(checklistBtn, {
            on: !!board.noteCanvasItem?.canvasShowNoteChecklist,
            titleOn: 'Hide checklist',
            titleOff: 'Show checklist',
            icon: FORMAT_ICONS.toChecklist,
            flag: 'checklist'
        });
        bindToggle(plannerTableBtn, {
            on: !!board.noteCanvasItem?.canvasShowNotePlannerTable,
            titleOn: 'Hide planner table',
            titleOff: 'Show planner table',
            icon: CARD_ICONS.plannerTable,
            flag: 'plannerTable',
            visible: noteMode && plannerActive
        });
        bindToggle(plannerChartBtn, {
            on: !!board.noteCanvasItem?.canvasShowNotePlannerChart,
            titleOn: 'Hide planner chart',
            titleOff: 'Show planner chart',
            icon: CARD_ICONS.plannerChart,
            flag: 'plannerChart',
            visible: noteMode && plannerActive
        });

        if (sizeGroup) {
            if (noteMode) {
                sizeGroup.hidden = false;
                sizeGroup.classList.remove('is-hidden');
                const size = resolveOverlayFontSize(board.noteCanvasItem);
                const percent = overlayFontSizeToPercent(size);
                if (sizeLabel) {
                    sizeLabel.textContent = `${percent}%`;
                    sizeLabel.title = `Text height ${size} (canvas units)`;
                }
                if (smallerBtn) {
                    smallerBtn.disabled = size <= OVERLAY_FONT_MIN;
                    smallerBtn.title = 'Smaller overlay text';
                    smallerBtn.setAttribute('aria-label', 'Smaller overlay text');
                    if (!smallerBtn.dataset.bound) {
                        smallerBtn.dataset.bound = '1';
                        smallerBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            board.nudgeNoteOverlayFontSize(-OVERLAY_FONT_STEP);
                        });
                    }
                }
                if (largerBtn) {
                    largerBtn.disabled = size >= OVERLAY_FONT_MAX;
                    largerBtn.title = 'Larger overlay text';
                    largerBtn.setAttribute('aria-label', 'Larger overlay text');
                    if (!largerBtn.dataset.bound) {
                        largerBtn.dataset.bound = '1';
                        largerBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            board.nudgeNoteOverlayFontSize(OVERLAY_FONT_STEP);
                        });
                    }
                }
            } else {
                sizeGroup.hidden = true;
                sizeGroup.classList.add('is-hidden');
            }
        }
}

export function pointerSelected(board) {
        return board.activeStyle;
}

export function pointerTriggerIcon(board) {
        return DRAWING_ICONS[board.activeStyle] || DRAWING_ICONS.pen;
}

export function shapeTriggerIcon(board) {
        return DRAWING_ICONS.shapes || DRAWING_ICONS.line;
}

export function pointerMenuItems(board) {
        return board.menuItemsWithIcons(POINTER_ITEMS);
}

export function openPointerMenu(board, anchor) {
        DrawingToolbarMenu.toggle({
            anchor,
            ariaLabel: 'Pointer tools',
            items: board.pointerMenuItems(),
            selected: board.pointerSelected(),
            onSelect: (id) => {
                board.setStyle(id);
                board.renderToolbar();
            }
        });
}

export function formatTriggerLabel(board) {
        if (board.doc.canvasMode === 'infinite') return '∞';
        return board.doc.canvasMode.toUpperCase();
}

export function typeTriggerIcon(board) {
        const bg = getActiveBackground(board.doc);
        return DRAWING_ICONS[bg === 'blank' ? 'rect' : bg] || DRAWING_ICONS.grid;
}

export function menuItemsWithIcons(board, items) {
        return items.map((item) => {
            if (item.heading || item.divider || item.stepper) return { ...item };
            return {
                ...item,
                icon: item.icon || DRAWING_ICONS[item.id] || DRAWING_ICONS[item.iconKey || item.id] || ''
            };
        });
}

export function formatMenuItems(board) {
        return board.menuItemsWithIcons(FORMAT_ITEMS.map((item) => {
            const fmt = PAGE_FORMATS[item.id];
            const meta = fmt
                ? `(${fmt.mmW}×${fmt.mmH} mm · ${fmt.width}×${fmt.height} px)`
                : '';
            return {
                ...item,
                meta,
                selected: item.id === board.doc.canvasMode
            };
        }));
}

export function backgroundMenuItems(board, bg = getActiveBackground(this.doc)) {
        const withSel = (list) => board.menuItemsWithIcons(list.map((item) => ({
            ...item,
            iconKey: item.iconKey || item.id,
            selected: item.id === bg
        })));
        const items = [];
        items.push(...withSel([{ id: 'blank', label: 'Blank', iconKey: 'blank' }]));
        items.push({ heading: 'Grids' });
        items.push(...withSel(GRID_BACKGROUNDS));
        items.push({ heading: 'Writing' });
        items.push(...withSel(WRITING_BACKGROUNDS));
        return items;
}

export function handleFormatMenu(board, id) {
        if (FORMAT_ITEMS.some((item) => item.id === id)) {
            board.setCanvasMode(id);
        }
}

export function handleBackgroundMenu(board, id) {
        if (BACKGROUNDS.includes(id)) {
            board.setBackground(id);
        }
}

export function flowchartToolbarRowHtml(board) {
        const grid = board.flowchartGrid();
        const snapOn = grid.snap !== false;
        const routing = board.flowchartRouting === 'elbow' ? 'elbow' : 'straight';
        const fcColor = board.flowchartColor();
        const fcWidth = board.flowchartWidth();
        const tools = [
            ['rect', 'Process', 'rect'],
            ['rounded_rect', 'Rounded', 'rounded_rect'],
            ['diamond', 'Decision', 'diamond'],
            ['ellipse', 'Terminator', 'ellipse'],
            ['parallelogram', 'Input', 'parallelogram'],
            ['triangle', 'Triangle', 'triangle']
        ];
        const toolBtns = tools.map(function (t) {
            return '<button type="button" class="btn btn--compact btn--icon" data-flow-tool="' + t[0] + '" title="' + t[1] + '" aria-label="' + t[1] + '">' + (DRAWING_ICONS[t[2]] || DRAWING_ICONS.shapes) + '</button>';
        }).join('');
        return '<div class="drawing-toolbar-row drawing-toolbar-row--flowchart" aria-label="Flowchart tools">'
            + '<span class="drawing-toolbar-row__label">Flow</span>'
            + toolBtns
            + '<button type="button" class="btn btn--compact btn--icon' + (board.activeTool === 'connector' ? ' active' : '') + '" data-flow-tool="connector" title="Connector (drag shape to shape)" aria-label="Connector">' + DRAWING_ICONS.arrow + '</button>'
            + '<button type="button" class="btn btn--compact btn--icon' + (routing === 'elbow' ? ' active' : '') + '" id="draw-flow-routing" title="Toggle elbow routing" aria-label="Toggle elbow routing" aria-pressed="' + (routing === 'elbow' ? 'true' : 'false') + '">' + (DRAWING_ICONS.connectorElbow || DRAWING_ICONS.arrow) + '</button>'
            + '<span class="drawing-toolbar-group" data-flow-connector-group>'
            + '<button type="button" class="btn btn--compact btn--icon drawing-color-chip-btn" id="draw-flow-connector-color" title="Stroke color" aria-label="Stroke color" aria-expanded="false" style="--chip-color:' + fcColor + '"><span class="drawing-color-chip" style="background:' + fcColor + '"></span></button>'
            + '<button type="button" class="btn btn--compact btn--icon" id="draw-flow-connector-smaller" title="Thinner stroke" aria-label="Thinner stroke">' + ACTION_ICONS.minus + '</button>'
            + '<span class="drawing-brush-size__value" id="draw-flow-connector-width" aria-live="polite">' + fcWidth + 'px</span>'
            + '<button type="button" class="btn btn--compact btn--icon" id="draw-flow-connector-larger" title="Thicker stroke" aria-label="Thicker stroke">' + ACTION_ICONS.plus + '</button>'
            + '</span>'
            + '<span class="format-toolbar-sep" aria-hidden="true"></span>'
            + '<span class="drawing-toolbar-group" data-flow-label-group>'
            + '<button type="button" class="btn btn--compact btn--icon" id="draw-flow-label-edit" title="Edit shape text" aria-label="Edit shape text">' + DRAWING_ICONS.text + '</button>'
            + '<button type="button" class="btn btn--compact btn--icon" id="draw-flow-label-color" title="Label color" aria-label="Label color" aria-expanded="false" style="--chip-color:' + (board.flowLabelTargetShape()?.label?.color || fcColor) + '"><span class="drawing-color-chip" style="background:' + (board.flowLabelTargetShape()?.label?.color || fcColor) + '"></span></button>'
            + '<button type="button" class="btn btn--compact btn--icon" id="draw-flow-label-smaller" title="Smaller label text" aria-label="Smaller label text">' + ACTION_ICONS.minus + '</button>'
            + '<span class="drawing-brush-size__value" id="draw-flow-label-size" aria-live="polite">' + board.flowLabelFontSize() + 'px</span>'
            + '<button type="button" class="btn btn--compact btn--icon" id="draw-flow-label-larger" title="Larger label text" aria-label="Larger label text">' + ACTION_ICONS.plus + '</button>'
            + '</span>'
            + '<span class="format-toolbar-sep" aria-hidden="true"></span>'
            + '<button type="button" class="btn btn--compact btn--icon' + (snapOn ? ' active' : '') + '" id="draw-flow-snap" title="Snap to grid" aria-label="Snap to grid" aria-pressed="' + (snapOn ? 'true' : 'false') + '">' + DRAWING_ICONS.gridSnap + '</button>'
            + '<button type="button" class="btn btn--compact btn--icon" id="draw-flow-grid-minus" title="Coarser grid" aria-label="Coarser grid">' + ACTION_ICONS.minus + '</button>'
            + '<span class="drawing-brush-size__value" id="draw-flow-grid-size" aria-live="polite">' + grid.size + 'px</span>'
            + '<button type="button" class="btn btn--compact btn--icon" id="draw-flow-grid-plus" title="Finer grid" aria-label="Finer grid">' + ACTION_ICONS.plus + '</button>'
            + '<button type="button" class="btn btn--compact drawing-toolbar-dropdown" id="draw-flow-grid-type" title="Grid style" aria-label="Grid style"><span class="drawing-dropdown-label">' + grid.type + '</span><span class="drawing-dropdown-chevron">' + CHEVRON + '</span></button>'
            + '</div>';
}

export function stepFlowchartGrid(board, delta) {
        const steps = [8, 12, 16, 24, 32, 48];
        const grid = board.flowchartGrid();
        let idx = steps.indexOf(grid.size);
        if (idx < 0) {
            let best = 0;
            let bestD = Infinity;
            steps.forEach(function (s, i) {
                const d = Math.abs(s - grid.size);
                if (d < bestD) { bestD = d; best = i; }
            });
            idx = best;
        }
        const next = steps[Math.max(0, Math.min(steps.length - 1, idx + delta))];
        if (next === grid.size) return;
        board.persistFlowchartGrid({ size: next });
        board.redrawBackground();
        board.renderToolbar();
}

export function renderToolbar(board) {
        if (!board.toolbarEl) return;
        const wasColorOpen = board.colorRolloutOpen;
        const wasBgColorOpen = board.bgColorRolloutOpen;
        DrawingToolbarMenu.close();
        const brush = board.currentBrush();
        const bgSwatch = board.pageBackgroundSwatch();
        const isPointerActive = board.activeTool === 'pointer' || board.activeTool === 'brush';
        const isEraserActive = board.activeTool === 'eraser';
        const isPanActive = board.activeTool === 'pan';
        const isCropActive = board.activeTool === 'crop';
        const pageIdx = board.doc.pages.findIndex((p) => p.id === board.doc.activePageId);
        const pageCount = board.doc.pages.length;
        const canPrev = pageIdx > 0;
        const canNext = pageIdx >= 0 && pageIdx < pageCount - 1;
        const exitBtn = (board.isNoteCanvasMode || board.isFlowchartMode)
            ? `<button type="button" class="btn btn--compact btn--icon" id="draw-back-to-note" title="Back to note" aria-label="Back to note">${ACTION_ICONS.viewFree}</button>`
            : `<button type="button" class="btn btn--compact btn--icon" id="draw-exit-drawing" title="Exit drawing mode" aria-label="Exit drawing mode">${ACTION_ICONS.viewFree}</button>`;
        const flowchartRow = board.isFlowchartMode ? board.flowchartToolbarRowHtml() : '';

        board.toolbarEl.innerHTML = `
            <div class="drawing-toolbar-row">
                <button type="button" class="btn btn--compact drawing-toolbar-dropdown ${isPointerActive ? 'active' : ''}" id="draw-menu-pointer" aria-haspopup="menu" aria-expanded="false" title="Pointer tools" aria-label="Pointer tools">
                    <span class="drawing-dropdown-icon">${board.pointerTriggerIcon()}</span>
                    <span class="drawing-dropdown-chevron">${CHEVRON}</span>
                </button>
                <span class="drawing-brush-size" id="draw-brush-size-group" aria-label="Brush size">
                    <button type="button" class="btn btn--compact btn--icon drawing-brush-size__btn" id="draw-brush-smaller" title="Decrease brush size" aria-label="Decrease brush size">${ACTION_ICONS.minus}</button>
                    <span class="drawing-brush-size__value" id="draw-brush-width" aria-live="polite">${brush.width}px</span>
                    <button type="button" class="btn btn--compact btn--icon drawing-brush-size__btn" id="draw-brush-larger" title="Increase brush size" aria-label="Increase brush size">${ACTION_ICONS.plus}</button>
                </span>
                <button type="button" class="btn btn--compact btn--icon ${isEraserActive ? 'active' : ''}" id="draw-eraser" title="Eraser" aria-label="Eraser" aria-pressed="${isEraserActive ? 'true' : 'false'}">${DRAWING_ICONS.eraser}</button>
                <span class="format-toolbar-sep" aria-hidden="true"></span>
                <div class="drawing-color-group" id="draw-color-group">
                    <button type="button" class="btn btn--compact btn--icon drawing-color-chip-btn" id="draw-color-btn" title="Color" aria-label="Color" aria-expanded="false" style="--chip-color:${brush.color}">
                        <span class="drawing-color-chip" style="background:${brush.color}"></span>
                    </button>
                </div>
                <span class="format-toolbar-sep" aria-hidden="true"></span>
                <button type="button" class="btn btn--compact drawing-toolbar-dropdown" id="draw-menu-shapes" aria-haspopup="menu" aria-expanded="false" title="Shapes" aria-label="Shapes">
                    <span class="drawing-dropdown-icon">${board.shapeTriggerIcon()}</span>
                    <span class="drawing-dropdown-chevron">${CHEVRON}</span>
                </button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-insert-image" title="Insert image" aria-label="Insert image" aria-haspopup="menu">${DRAWING_ICONS.image}</button>
                <button type="button" class="btn btn--compact btn--icon ${isCropActive ? 'active' : ''}" id="draw-crop" title="Crop image — drag the frame edges, drag back out to restore" aria-label="Crop image" aria-pressed="${isCropActive ? 'true' : 'false'}">${DRAWING_ICONS.crop}</button>
                <button type="button" class="btn btn--compact btn--icon ${board.isLassoActive ? 'active' : ''}" id="draw-lasso" title="Rectangle select" aria-label="Rectangle select" aria-pressed="${board.isLassoActive ? 'true' : 'false'}">${DRAWING_ICONS.lasso}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-fullscreen" title="Full screen" aria-label="Full screen" aria-pressed="false">${ACTION_ICONS.fullscreenEnter}</button>
                <span class="format-toolbar-sep" aria-hidden="true"></span>
                <button type="button" class="btn btn--compact btn--icon ${isPanActive ? 'active' : ''}" id="draw-pan" title="Hand tool — pan canvas. Scroll also pans; Ctrl+scroll zooms; Space+drag pans." aria-label="Hand tool" aria-pressed="${isPanActive ? 'true' : 'false'}">${DRAWING_ICONS.hand}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-zoom-out" title="Zoom out" aria-label="Zoom out">${DRAWING_ICONS.zoomOut}</button>
                <span class="drawing-zoom-level" id="draw-zoom-level" title="Zoom level" aria-label="Zoom level">100%</span>
                <button type="button" class="btn btn--compact btn--icon" id="draw-zoom-in" title="Zoom in" aria-label="Zoom in">${DRAWING_ICONS.zoomIn}</button>
                <span class="format-toolbar-sep" aria-hidden="true"></span>
                <button type="button" class="btn btn--compact btn--icon" id="draw-undo" title="Undo" aria-label="Undo" ${board.history.canUndo ? '' : 'disabled'}>${ACTION_ICONS.undo}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-redo" title="Redo" aria-label="Redo" ${board.history.canRedo ? '' : 'disabled'}>${ACTION_ICONS.redo}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-clear" title="Clear" aria-label="Clear">${ACTION_ICONS.layoutReset}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-toolbar-hide" title="Hide toolbar" aria-label="Hide toolbar">${ACTION_ICONS.collapseAll}</button>
                ${exitBtn}
            </div>
            <div class="drawing-toolbar-row drawing-toolbar-row--meta">
                <button type="button" class="btn btn--compact drawing-toolbar-dropdown" id="draw-menu-format" aria-haspopup="menu" aria-expanded="false" title="Page format" aria-label="Page format">
                    <span class="drawing-dropdown-label">${board.formatTriggerLabel()}</span>
                    <span class="drawing-dropdown-chevron">${CHEVRON}</span>
                </button>
                <button type="button" class="btn btn--compact drawing-toolbar-dropdown" id="draw-menu-background" aria-haspopup="menu" aria-expanded="false" title="Background" aria-label="Background">
                    <span class="drawing-dropdown-icon">${board.typeTriggerIcon()}</span>
                    <span class="drawing-dropdown-label">BG</span>
                    <span class="drawing-dropdown-chevron">${CHEVRON}</span>
                </button>
                <button type="button" class="btn btn--compact btn--icon drawing-color-chip-btn" id="draw-bg-color-btn" title="Background fill color" aria-label="Background fill color" aria-expanded="false" style="--chip-color:${bgSwatch}">
                    <span class="drawing-bg-color-chip drawing-color-chip" style="background:${bgSwatch}"></span>
                </button>
                <span class="drawing-page-nav" aria-label="Page navigation">
                    <button type="button" class="btn btn--compact btn--icon" id="draw-page-prev" title="Previous page" aria-label="Previous page" ${canPrev ? '' : 'disabled'}>${DRAWING_ICONS.pagePrev}</button>
                    <span class="drawing-page-label" id="draw-page-label" title="Current page">${board.pageLabel()}</span>
                    <button type="button" class="btn btn--compact btn--icon" id="draw-page-next" title="Next page" aria-label="Next page" ${canNext ? '' : 'disabled'}>${DRAWING_ICONS.pageNext}</button>
                    <button type="button" class="btn btn--compact btn--icon" id="draw-page-add" title="Add page" aria-label="Add page">${DRAWING_ICONS.pageAdd}</button>
                </span>
            </div>
            ${flowchartRow}
        `;
        board.bindToolbar();
        board.updateZoomLevel();
        board.updateToolEcho();
        board.updateNoteToolbarChrome();
        board.updateBrushSizeControls();
        if (wasColorOpen) {
            board.colorRolloutOpen = false;
            const btn = board.toolbarEl.querySelector('#draw-color-btn');
            if (btn) board.toggleColorRollout(btn);
        } else if (wasBgColorOpen) {
            board.bgColorRolloutOpen = false;
            const btn = board.toolbarEl.querySelector('#draw-bg-color-btn');
            if (btn) board.openPageBackgroundPicker(btn);
        }
}

export function updateZoomLevel(board) {
        const el = board.toolbarEl?.querySelector('#draw-zoom-level');
        if (!el) return;
        el.textContent = `${Math.round(CanvasViewport.scale * 100)}%`;
}

export function bindToolbar(board) {
        if (!board.toolbarEl) return;
        const q = (sel) => board.toolbarEl.querySelector(sel);

        q('#draw-toolbar-hide')?.addEventListener('click', () => board.hideToolbar());
        q('#draw-exit-drawing')?.addEventListener('click', () => { board.app.switchWorkspaceMode('notes'); });
        q('#draw-back-to-note')?.addEventListener('click', () => { board.exitFromToolbar(); });
        q('#draw-undo')?.addEventListener('click', () => board.undo());
        q('#draw-redo')?.addEventListener('click', () => board.redo());
        q('#draw-clear')?.addEventListener('click', () => board.clearAll());
        q('#draw-color-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.toggleColorRollout(e.currentTarget);
        });
        q('#draw-bg-color-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.openPageBackgroundPicker(e.currentTarget);
        });
        q('#draw-zoom-in')?.addEventListener('click', () => { CanvasViewport.stepZoom(0.1); board.persistViewport(); });
        q('#draw-zoom-out')?.addEventListener('click', () => { CanvasViewport.stepZoom(-0.1); board.persistViewport(); });
        q('#draw-pan')?.addEventListener('click', () => {
            if (board.activeTool === 'pan') board.setStyle(board.activeStyle || 'pen');
            else board.setTool('pan');
        });
        const fsBtn = q('#draw-fullscreen');
        if (fsBtn) Fullscreen.registerButton(fsBtn);

        q('#draw-menu-pointer')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.openPointerMenu(e.currentTarget);
        });

        q('#draw-brush-smaller')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.adjustWidth(-1);
        });
        q('#draw-brush-larger')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.adjustWidth(1);
        });

        q('#draw-eraser')?.addEventListener('click', () => {
            board.setTool('eraser');
        });

        q('#draw-menu-shapes')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const selected = SHAPE_ITEMS.some((item) => item.id === board.activeTool) ? board.activeTool : 'line';
            DrawingToolbarMenu.toggle({
                anchor: e.currentTarget,
                ariaLabel: 'Shapes',
                items: board.menuItemsWithIcons(SHAPE_ITEMS),
                selected,
                onSelect: (id) => {
                    board.setTool(id);
                    board.renderToolbar();
                }
            });
        });

        q('#draw-insert-image')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.openImageInsertMenu(e.currentTarget);
        });

        q('#draw-crop')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (board.activeTool === 'crop') {
                board.setTool('pointer');
            } else {
                board.selectedStrokes.clear();
                board.setTool('crop');
                showAppToast('Crop: drag the frame edges — the dimmed area gets discarded');
            }
        });

        q('#draw-menu-format')?.addEventListener('click', (e) => {
            e.stopPropagation();
            DrawingToolbarMenu.toggle({
                anchor: e.currentTarget,
                ariaLabel: 'Page format',
                items: board.formatMenuItems(),
                selected: board.doc.canvasMode,
                onSelect: (id) => board.handleFormatMenu(id)
            });
        });

        q('#draw-menu-background')?.addEventListener('click', (e) => {
            e.stopPropagation();
            DrawingToolbarMenu.toggle({
                anchor: e.currentTarget,
                ariaLabel: 'Background',
                items: board.backgroundMenuItems(),
                selected: getActiveBackground(board.doc),
                onSelect: (id) => board.handleBackgroundMenu(id)
            });
        });

        q('#draw-page-prev')?.addEventListener('click', () => board.goToPrevPage());
        q('#draw-page-next')?.addEventListener('click', () => board.goToNextPage());
        q('#draw-page-add')?.addEventListener('click', () => board.addCanvasPage());

        // Lasso button click handler
        q('#draw-lasso')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.toggleLassoMode();
        });

        // Flowchart row: shape tools, connector routing, labels, snap + grid density
        board.toolbarEl.querySelectorAll('[data-flow-tool]')?.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                board.setTool(btn.dataset.flowTool);
            });
        });
        q('#draw-flow-routing')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.flowchartRouting = board.flowchartRouting === 'elbow' ? 'straight' : 'elbow';
            if (board.activeTool === 'connector') board.renderToolbar();
            else board.renderToolbar();
            showAppToast(board.flowchartRouting === 'elbow' ? 'Connectors: elbow routing' : 'Connectors: straight routing');
        });
        q('#draw-flow-snap')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const grid = board.flowchartGrid();
            board.persistFlowchartGrid({ snap: !(grid.snap !== false) });
            board.renderToolbar();
        });
        q('#draw-flow-grid-minus')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.stepFlowchartGrid(-1);
        });
        q('#draw-flow-grid-plus')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.stepFlowchartGrid(1);
        });
        q('#draw-flow-grid-type')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const order = ['dots', 'grid', 'graph'];
            const grid = board.flowchartGrid();
            const next = order[(order.indexOf(grid.type) + 1) % order.length];
            board.persistFlowchartGrid({ type: next });
            board.setBackground(next);
        });
        q('#draw-flow-label-edit')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.editSelectedFlowchartLabel();
        });
        q('#draw-flow-label-smaller')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.nudgeSelectedFlowchartLabel(-2);
        });
        q('#draw-flow-label-larger')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.nudgeSelectedFlowchartLabel(2);
        });

        // Connector stroke color — opens the shared color picker, persists to the diagram.
        q('#draw-flow-connector-color')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.openFlowchartColorPicker(e.currentTarget);
        });
        q('#draw-flow-connector-smaller')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.adjustFlowchartWidth(-1);
        });
        q('#draw-flow-connector-larger')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.adjustFlowchartWidth(1);
        });
        // Label color — opens the shared color picker, persists to the selected label.
        q('#draw-flow-label-color')?.addEventListener('click', (e) => {
            e.stopPropagation();
            board.openFlowLabelColorPicker(e.currentTarget);
        });
}

export function updateToolbarState(board) {
        if (!board.toolbarEl) return;
        board.toolbarEl.querySelector('#draw-undo')?.toggleAttribute('disabled', !board.history.canUndo);
        board.toolbarEl.querySelector('#draw-redo')?.toggleAttribute('disabled', !board.history.canRedo);
        board.updatePointerWidthLabel();
        board.updateFlowLabelControls();
}

    /**
     * Keep the flowchart label group honest: text actions need a selected shape
     * or connector, and A-/A+ clamp at the label size bounds.
     */
export function updateFlowLabelControls(board) {
        if (!board.toolbarEl) return;
        const group = board.toolbarEl.querySelector('[data-flow-label-group]');
        if (!group) return;
        const target = board.flowLabelTargetShape();
        const hasTarget = !!target;
        const size = board.flowLabelFontSize();
        group.querySelector('#draw-flow-label-edit')?.toggleAttribute('disabled', !hasTarget);
        group.querySelector('#draw-flow-label-smaller')?.toggleAttribute('disabled', !hasTarget || size <= FLOW_LABEL_MIN);
        group.querySelector('#draw-flow-label-larger')?.toggleAttribute('disabled', !hasTarget || size >= FLOW_LABEL_MAX);
        const readout = group.querySelector('#draw-flow-label-size');
        if (readout) readout.textContent = size + 'px';
        // Label color chip reflects the selected label (or the diagram default).
        const labelChip = group.querySelector('#draw-flow-label-color');
        if (labelChip) {
            const color = (target?.label?.color || board.flowchartColor());
            labelChip.style.setProperty('--chip-color', color);
            const swatch = labelChip.querySelector('.drawing-color-chip');
            if (swatch) swatch.style.background = color;
            labelChip.toggleAttribute('disabled', !hasTarget);
        }
        // Connector width readout always reflects the diagram setting.
        const connWidth = board.toolbarEl.querySelector('#draw-flow-connector-width');
        if (connWidth) connWidth.textContent = board.flowchartWidth() + 'px';
}
