// Shared freeform resize/drag chrome for desktop notes and tool panels.

const RESIZE_HANDLES_HTML = `
    <span class="ff-resize ff-resize-n" data-axis="n" aria-hidden="true"></span>
    <span class="ff-resize ff-resize-s" data-axis="s" aria-hidden="true"></span>
    <span class="ff-resize ff-resize-e" data-axis="e" aria-hidden="true"></span>
    <span class="ff-resize ff-resize-w" data-axis="w" aria-hidden="true"></span>
    <span class="ff-resize ff-resize-nw" data-axis="nw" aria-hidden="true"></span>
    <span class="ff-resize ff-resize-ne" data-axis="ne" aria-hidden="true"></span>
    <span class="ff-resize ff-resize-sw" data-axis="sw" aria-hidden="true"></span>
    <span class="ff-resize ff-resize-se" data-axis="se" aria-hidden="true"></span>
`;

function ensureResizeLayer(el, resizable) {
    let resizeLayer = el.querySelector('.ff-resize-layer');
    if (!resizeLayer) {
        resizeLayer = document.createElement('div');
        resizeLayer.className = 'ff-resize-layer';
        resizeLayer.setAttribute('aria-hidden', 'true');
    }
    if (resizable && !resizeLayer.querySelector('.ff-resize-se')) {
        resizeLayer.insertAdjacentHTML('beforeend', RESIZE_HANDLES_HTML);
    }
    return resizeLayer;
}

function insertChromeNode(el, node, insertBefore) {
    if (insertBefore && insertBefore.parentNode === el) {
        if (node.parentNode !== el) el.insertBefore(node, insertBefore);
        return;
    }
    if (!node.parentNode) el.appendChild(node);
}

/**
 * Mount ff-chrome + optional drag gutters (notes) and/or ff-resize-layer.
 * @param {HTMLElement} el
 * @param {{ resizable?: boolean, mode?: 'note'|'tool', insertBefore?: HTMLElement|null }} options
 */
export function mountFloatChrome(el, options = {}) {
    const { resizable = true, mode = 'tool', insertBefore = null } = options;
    const resizeLayer = ensureResizeLayer(el, resizable);

    if (mode === 'note') {
        let chrome = el.querySelector('.ff-chrome');
        if (!chrome) {
            chrome = document.createElement('div');
            chrome.className = 'ff-chrome';
        }

        chrome.querySelectorAll('.ff-resize').forEach((handle) => {
            resizeLayer.appendChild(handle);
        });

        insertChromeNode(el, chrome, insertBefore);
        insertChromeNode(el, resizeLayer, insertBefore);

        if (!chrome.querySelector('.ff-drag-gutter--edge')) {
            const gutter = document.createElement('span');
            gutter.className = 'ff-drag-gutter ff-drag-gutter--edge';
            gutter.title = 'Drag to move';
            chrome.insertBefore(gutter, chrome.firstChild);
        }
        if (!chrome.querySelector('.ff-drag-gutter--top')) {
            const topGutter = document.createElement('span');
            topGutter.className = 'ff-drag-gutter ff-drag-gutter--top';
            topGutter.title = 'Drag to move';
            chrome.appendChild(topGutter);
        }
        return { chrome, resizeLayer };
    }

    insertChromeNode(el, resizeLayer, insertBefore);
    return { resizeLayer };
}

/**
 * Bind 8-axis pointer resize on .ff-resize handles inside el.
 */
export function bindFloatResize(el, options = {}) {
    const {
        mins = { w: 120, h: 80 },
        onEnd,
        onResize,
        getBounds,
        pointerDelta,
        clampPosition,
        draggingClass = 'is-freeform-resizing',
        onBringToFront
    } = options;

    const handles = el.querySelectorAll('.ff-resize-layer .ff-resize, .ff-resize[data-axis]');
    if (!handles.length) return;

    let resizing = false;
    let activeHandle = null;
    let axis = 'se';
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let startW = 0;
    let startH = 0;

    const lockDimensions = () => {
        el.classList.remove('tool-panel--auto-height');
        el.style.width = `${el.offsetWidth}px`;
        el.style.height = `${el.offsetHeight}px`;
    };

    const applyResize = (dx, dy) => {
        const bounds = getBounds?.() || {
            left: 0,
            top: 0,
            right: window.innerWidth,
            bottom: window.innerHeight
        };

        let nextLeft = originLeft;
        let nextTop = originTop;
        let nextW = startW;
        let nextH = startH;

        if (axis.includes('e')) nextW = startW + dx;
        if (axis.includes('w')) {
            nextW = startW - dx;
            nextLeft = originLeft + dx;
        }
        if (axis.includes('s')) nextH = startH + dy;
        if (axis.includes('n')) {
            nextH = startH - dy;
            nextTop = originTop + dy;
        }

        nextW = Math.max(mins.w, nextW);
        nextH = Math.max(mins.h, nextH);

        if (axis.includes('w')) nextLeft = originLeft + (startW - nextW);
        if (axis.includes('n')) nextTop = originTop + (startH - nextH);

        nextLeft = Math.max(bounds.left, nextLeft);
        nextTop = Math.max(bounds.top, nextTop);
        nextW = Math.min(nextW, bounds.right - nextLeft - 8);
        nextH = Math.min(nextH, bounds.bottom - nextTop - 8);
        nextW = Math.max(mins.w, nextW);
        nextH = Math.max(mins.h, nextH);

        if (clampPosition) {
            const pos = clampPosition(el, nextLeft, nextTop);
            nextLeft = pos.x;
            nextTop = pos.y;
            nextW = Math.min(nextW, bounds.right - nextLeft - 8);
            nextH = Math.min(nextH, bounds.bottom - nextTop - 8);
        }

        el.style.left = `${nextLeft}px`;
        el.style.top = `${nextTop}px`;
        el.style.width = `${nextW}px`;
        el.style.height = `${nextH}px`;
        onResize?.();
    };

    const endResize = (e) => {
        if (!resizing) return;
        resizing = false;
        el.classList.remove(draggingClass);
        try {
            activeHandle?.releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }
        activeHandle = null;
        onEnd?.();
        onResize?.();
    };

    handles.forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            lockDimensions();
            resizing = true;
            axis = handle.dataset.axis || 'se';
            activeHandle = handle;
            startX = e.clientX;
            startY = e.clientY;
            originLeft = el.offsetLeft;
            originTop = el.offsetTop;
            startW = el.offsetWidth;
            startH = el.offsetHeight;
            handle.setPointerCapture(e.pointerId);
            el.classList.add(draggingClass);
            onBringToFront?.(el);
        });

        handle.addEventListener('pointermove', (e) => {
            if (!resizing || activeHandle !== handle) return;
            const { dx, dy } = pointerDelta(e.clientX, e.clientY, startX, startY);
            applyResize(dx, dy);
        });

        handle.addEventListener('pointerup', endResize);
        handle.addEventListener('pointercancel', endResize);
    });
}
