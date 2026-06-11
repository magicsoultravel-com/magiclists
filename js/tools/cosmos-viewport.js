const ZOOM_MIN = 1;
const ZOOM_MAX = 12;
const ZOOM_WHEEL_STEP = 0.25;
const ZOOM_BTN_STEP = 0.5;

function clampZoom(v) {
    return Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v)) * 100) / 100;
}

function buildMarkers(markers) {
    if (!markers?.length) return null;
    const layer = document.createElement('div');
    layer.className = 'cosmos-markers';
    layer.setAttribute('aria-hidden', 'true');
    markers.forEach((m) => {
        const pin = document.createElement('div');
        pin.className = `cosmos-marker${m.role === 'observer' ? ' cosmos-marker--observer' : ''}`;
        pin.style.left = `${m.x * 100}%`;
        pin.style.top = `${m.y * 100}%`;
        const dot = document.createElement('span');
        dot.className = 'cosmos-marker__dot';
        const label = document.createElement('span');
        label.className = 'cosmos-marker__label';
        label.textContent = m.distance ? `${m.label} · ${m.distance}` : m.label;
        pin.append(dot, label);
        layer.appendChild(pin);
    });
    return layer;
}

export function createCosmosViewport({ container, view, interactive = false, onLoad, onError, onScaleChange }) {
    const viewport = document.createElement('div');
    viewport.className = 'cosmos-viewport';
    viewport.dataset.cosmosViewport = '';

    const inner = document.createElement('div');
    inner.className = 'cosmos-viewport__inner';
    inner.dataset.cosmosInner = '';

    const img = document.createElement('img');
    img.alt = view.title;
    img.decoding = 'async';
    img.loading = 'lazy';
    img.src = view.src;

    inner.appendChild(img);
    const markersEl = buildMarkers(view.markers);
    if (markersEl) inner.appendChild(markersEl);
    viewport.appendChild(inner);
    container.appendChild(viewport);

    let fitScale = 1;
    let userScale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let panning = false;
    let panStart = null;
    const cleanups = [];

    const applyTransform = () => {
        const scale = fitScale * userScale;
        inner.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        inner.style.transformOrigin = '0 0';
        onScaleChange?.(userScale);
    };

    const recenterFit = () => {
        const cw = viewport.clientWidth;
        const ch = viewport.clientHeight;
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        if (!cw || !ch || !iw || !ih) return;
        fitScale = Math.min(cw / iw, ch / ih);
        const scale = fitScale * userScale;
        offsetX = (cw - iw * scale) / 2;
        offsetY = (ch - ih * scale) / 2;
        applyTransform();
    };

    const reset = () => {
        userScale = 1;
        recenterFit();
    };

    const setUserScale = (next, pivotX, pivotY) => {
        const prev = userScale;
        const scale = clampZoom(next);
        if (pivotX != null && pivotY != null && prev !== scale) {
            const ratio = scale / prev;
            offsetX = pivotX - (pivotX - offsetX) * ratio;
            offsetY = pivotY - (pivotY - offsetY) * ratio;
        }
        userScale = scale;
        applyTransform();
    };

    const zoomIn = () => {
        const rect = viewport.getBoundingClientRect();
        setUserScale(userScale + ZOOM_BTN_STEP, rect.width / 2, rect.height / 2);
    };

    const zoomOut = () => {
        const rect = viewport.getBoundingClientRect();
        setUserScale(userScale - ZOOM_BTN_STEP, rect.width / 2, rect.height / 2);
    };

    const fitToContainer = () => {
        recenterFit();
    };

    const onWheel = (e) => {
        if (!interactive) return;
        e.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const pivotX = e.clientX - rect.left;
        const pivotY = e.clientY - rect.top;
        const delta = e.deltaY > 0 ? -ZOOM_WHEEL_STEP : ZOOM_WHEEL_STEP;
        setUserScale(userScale + delta, pivotX, pivotY);
    };

    const onPointerDown = (e) => {
        if (!interactive || e.button !== 0 || userScale <= 1) return;
        panning = true;
        panStart = { x: e.clientX - offsetX, y: e.clientY - offsetY, id: e.pointerId };
        viewport.setPointerCapture(e.pointerId);
        viewport.classList.add('is-panning');
        e.preventDefault();
    };

    const onPointerMove = (e) => {
        if (!panning || !panStart) return;
        offsetX = e.clientX - panStart.x;
        offsetY = e.clientY - panStart.y;
        applyTransform();
    };

    const endPan = (e) => {
        if (!panning) return;
        panning = false;
        panStart = null;
        viewport.classList.remove('is-panning');
        try { viewport.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };

    const onImgLoad = () => {
        reset();
        onLoad?.();
    };

    const onImgError = () => onError?.();

    img.addEventListener('load', onImgLoad);
    img.addEventListener('error', onImgError);

    if (img.complete && img.naturalWidth) onImgLoad();

    if (interactive) {
        viewport.addEventListener('wheel', onWheel, { passive: false });
        viewport.addEventListener('pointerdown', onPointerDown);
        viewport.addEventListener('pointermove', onPointerMove);
        viewport.addEventListener('pointerup', endPan);
        viewport.addEventListener('pointercancel', endPan);
        cleanups.push(() => {
            viewport.removeEventListener('wheel', onWheel);
            viewport.removeEventListener('pointerdown', onPointerDown);
            viewport.removeEventListener('pointermove', onPointerMove);
            viewport.removeEventListener('pointerup', endPan);
            viewport.removeEventListener('pointercancel', endPan);
        });
    }

    const resizeObs = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => recenterFit())
        : null;
    resizeObs?.observe(viewport);
    if (resizeObs) cleanups.push(() => resizeObs.disconnect());

    return {
        viewport,
        img,
        getScale: () => userScale,
        reset,
        zoomIn,
        zoomOut,
        fitToContainer,
        destroy() {
            cleanups.forEach((fn) => fn());
            img.removeEventListener('load', onImgLoad);
            img.removeEventListener('error', onImgError);
            viewport.remove();
        }
    };
}
