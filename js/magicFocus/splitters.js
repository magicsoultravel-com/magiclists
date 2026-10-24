/** @module {"owns":"the resize handles between panes - mounting one splitter per descriptor, positioning it against the measured work rect, and the drag that rewrites ratios on release", "related":["magicFocus.js","magicFocus/layout.js","magicFocus/model.js"]} */
import { NoteSurface } from '../noteSurface.js';
import { defaultRatios, createDefaultFocus, normalizeFocus } from './model.js';
import { layoutForFocus } from './layout.js';


export function _mountSplitters(magicFocus, focus, layout) {
    const work = magicFocus.bodyEl?.querySelector('[data-magic-focus-work]');
    if (!work) return;
    work.querySelectorAll('.magic-focus__splitter').forEach((el) => el.remove());

    (layout.splitters || []).forEach((split) => {
        const el = document.createElement('div');
        el.className = `magic-focus__splitter magic-focus__splitter--${split.type}`;
        el.dataset.ratioIndex = String(split.ratioIndex);
        magicFocus._positionSplitter(el, split, work, focus);
        work.appendChild(el);
        magicFocus._bindSplitterDrag(el, split, focus, work);
    });
}

export function _positionSplitter(magicFocus, el, split, work, focus = null) {
    const rect = work.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (split.type === 'col') {
        el.style.left = `${split.pos * 100}%`;
        el.style.right = '';
        if (split.band === 'bottom') {
            const rowPos = focus?.ratios?.[0] ?? 0.45;
            el.style.top = `${rowPos * 100}%`;
            el.style.bottom = '0';
        } else if (split.band === 'top') {
            const rowPos = focus?.ratios?.[0] ?? 0.45;
            el.style.top = '0';
            el.style.bottom = `${(1 - rowPos) * 100}%`;
        } else {
            el.style.top = '0';
            el.style.bottom = '0';
        }
    } else {
        el.style.top = `${split.pos * 100}%`;
        el.style.left = '0';
        el.style.right = '0';
        el.style.bottom = '';
    }
}

export function _bindSplitterDrag(magicFocus, el, split, focus, work) {
    el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        el.classList.add('is-dragging');
        el.setPointerCapture?.(e.pointerId);
        const rect = work.getBoundingClientRect();
        // Only couple dual ratios when both splitters share an axis (3-col / 3-row).
        const sameAxisOrdered = focus.preset === 'split3-cols' || focus.preset === 'split3-rows';

        const onMove = (ev) => {
            let pos;
            if (split.type === 'col') {
                pos = (ev.clientX - rect.left) / rect.width;
            } else {
                pos = (ev.clientY - rect.top) / rect.height;
            }
            pos = Math.min(0.92, Math.max(0.08, pos));
            const ratios = [...(focus.ratios || defaultRatios(focus.preset))];
            ratios[split.ratioIndex] = pos;
            if (sameAxisOrdered && ratios.length >= 2) {
                if (split.ratioIndex === 0 && ratios[1] != null) {
                    ratios[0] = Math.min(pos, (ratios[1] || 0.66) - 0.08);
                }
                if (split.ratioIndex === 1 && ratios[0] != null) {
                    ratios[1] = Math.max(pos, (ratios[0] || 0.33) + 0.08);
                }
            }
            focus.ratios = ratios;
            const layout = layoutForFocus(focus);
            work.style.gridTemplateColumns = layout.columns;
            work.style.gridTemplateRows = layout.rows;
            split.pos = ratios[split.ratioIndex];
            magicFocus._positionSplitter(el, { ...split, pos: ratios[split.ratioIndex] }, work, focus);
            work.querySelectorAll('.magic-focus__splitter').forEach((sib) => {
                if (sib === el) return;
                const idx = Number(sib.dataset.ratioIndex);
                const sibSplit = layout.splitters.find((s) => s.ratioIndex === idx);
                if (sibSplit) magicFocus._positionSplitter(sib, sibSplit, work, focus);
            });
        };

        const onUp = () => {
            el.classList.remove('is-dragging');
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            const item = magicFocus.resolveItem();
            if (!item) return;
            NoteSurface.mutateItem(item, (it) => {
                if (!it.focus) it.focus = createDefaultFocus(focus.preset);
                it.focus = normalizeFocus({
                    ...it.focus,
                    ratios: focus.ratios,
                    preset: focus.preset,
                    zones: focus.zones,
                    zoom: focus.zoom
                });
            }, { preserveView: true, skipRerender: true });
            import('../drawingBoard.js').then(({ DrawingBoard }) => {
                if (DrawingBoard.active) DrawingBoard.resize?.();
            }).catch(() => {});
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    });
}
