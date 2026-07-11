/**
 * Canvas Export Utility
 * Handles PNG and PDF export with template backgrounds, orientation support, and adaptive scaling.
 */

// ============================================================================
// PAGE FORMAT SPECIFICATIONS
// ============================================================================

export const PAGE_FORMATS = {
    a3: { width: 1754, height: 2480, label: 'A3' },
    a4: { width: 1240, height: 1754, label: 'A4' },
    a5: { width: 874, height: 1240, label: 'A5' }
};

// Default settings for template rendering
const DEFAULT_SETTINGS = {
    lineSpacing: 10,
    staffGap: 96,
    gridSpacing: 48,
    margin: 40
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if orientation is landscape
 */
function isLandscapeOrientation(orientation) {
    return orientation === 'horizontal' || orientation === 'landscape';
}

/**
 * Get format dimensions, swapping for landscape orientation
 */
function getFormatDimensions(format, orientation) {
    const fmt = PAGE_FORMATS[format] || PAGE_FORMATS.a4;
    if (isLandscapeOrientation(orientation)) {
        return { width: fmt.height, height: fmt.width };
    }
    return { width: fmt.width, height: fmt.height };
}

/**
 * Pixel-snapped coordinate to prevent blurry canvas rendering
 */
function snapCoord(coord) {
    return Math.floor(coord) + 0.5;
}

/**
 * Draw a line with pixel snapping
 */
function drawSnappedLine(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(snapCoord(x1), snapCoord(y1));
    ctx.lineTo(snapCoord(x2), snapCoord(y2));
    ctx.stroke();
}

/**
 * Draw a rectangle outline with pixel snapping
 */
function drawSnappedRect(ctx, x, y, width, height) {
    ctx.beginPath();
    ctx.rect(snapCoord(x), snapCoord(y), width, height);
    ctx.stroke();
}

/**
 * Draw an arc with pixel snapping
 */
function drawSnappedArc(ctx, x, y, radius, startAngle, endAngle, anticlockwise = false) {
    ctx.beginPath();
    ctx.arc(snapCoord(x), snapCoord(y), radius, startAngle, endAngle, anticlockwise);
    ctx.stroke();
}

// ============================================================================
// TEMPLATE RENDERING FUNCTIONS
// ============================================================================

/**
 * Draw music staff template
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {Object} settings - Settings with lineSpacing and staffGap
 */
export function drawMusicStaff(ctx, width, height, settings = {}) {
    const lineSpacing = settings.lineSpacing || DEFAULT_SETTINGS.lineSpacing;
    const staffGap = settings.staffGap || DEFAULT_SETTINGS.staffGap;
    const margin = settings.margin || DEFAULT_SETTINGS.margin;
    
    // Calculate staff system height (5 lines + 4 gaps between lines)
    const staffHeight = 5 * lineSpacing;
    
    // Calculate available space for staff systems
    const usableHeight = height - 2 * margin;
    
    // Calculate number of staff systems that fit
    const systemSpacing = staffGap;
    const totalSystemHeight = staffHeight + systemSpacing;
    const numSystems = Math.max(1, Math.floor(usableHeight / totalSystemHeight));
    
    // Adjust to ensure last staff doesn't overflow bottom margin
    const actualSystemSpacing = (usableHeight - numSystems * staffHeight) / (numSystems + 1);
    
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    
    for (let i = 0; i < numSystems; i++) {
        const top = margin + actualSystemSpacing + i * (staffHeight + actualSystemSpacing);
        
        // Draw 5 lines of the staff
        for (let line = 0; line < 5; line++) {
            const y = snapCoord(top + line * lineSpacing);
            ctx.beginPath();
            ctx.moveTo(snapCoord(margin), y);
            ctx.lineTo(snapCoord(width - margin), y);
            ctx.stroke();
        }
    }
}

/**
 * Draw football/soccer field template
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {Object} settings - Settings with margin
 */
export function drawFootballField(ctx, width, height, settings = {}) {
    const margin = settings.margin || DEFAULT_SETTINGS.margin;
    
    // Calculate field boundaries
    const fieldLeft = snapCoord(margin);
    const fieldRight = snapCoord(width - margin);
    const fieldTop = snapCoord(margin);
    const fieldBottom = snapCoord(height - margin);
    
    const fieldWidth = fieldRight - fieldLeft;
    const fieldHeight = fieldBottom - fieldTop;
    
    // Center line
    const centerX = (fieldLeft + fieldRight) / 2;
    
    // Center circle
    const centerCircleRadius = fieldWidth * 0.10; // ~10% of field width
    
    // Penalty areas
    const penaltyAreaLength = fieldHeight * 0.15; // ~15% of field length
    const penaltyAreaWidth = fieldWidth * 0.40; // ~40% of field width
    
    // Penalty spots
    const penaltySpotX = fieldLeft + penaltyAreaLength;
    const penaltySpotXR = fieldRight - penaltyAreaLength;
    const penaltySpotY = fieldTop + fieldHeight / 2;
    
    // Goal boxes
    const goalBoxLength = fieldHeight * 0.06; // ~6% of field length
    const goalBoxWidth = fieldWidth * 0.20; // ~20% of field width
    
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.5;
    
    // Outer boundary
    drawSnappedRect(ctx, fieldLeft, fieldTop, fieldWidth, fieldHeight);
    
    // Center line
    drawSnappedLine(ctx, centerX, fieldTop, centerX, fieldBottom);
    
    // Center circle
    ctx.beginPath();
    ctx.arc(snapCoord(centerX), snapCoord(penaltySpotY), centerCircleRadius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Left penalty area
    const leftPenaltyTop = fieldTop + (fieldHeight - penaltyAreaWidth) / 2;
    const leftPenaltyBottom = fieldTop + (fieldHeight + penaltyAreaWidth) / 2;
    
    // Left penalty box
    drawSnappedRect(ctx, fieldLeft, leftPenaltyTop, penaltyAreaLength, penaltyAreaWidth);
    
    // Left penalty spot
    ctx.beginPath();
    ctx.arc(snapCoord(penaltySpotX), snapCoord(penaltySpotY), 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Left penalty arc
    ctx.beginPath();
    ctx.arc(snapCoord(penaltySpotX), snapCoord(penaltySpotY), 8, Math.PI, 1.5 * Math.PI);
    ctx.stroke();
    
    // Right penalty area
    const rightPenaltyTop = leftPenaltyTop;
    const rightPenaltyBottom = leftPenaltyBottom;
    
    // Right penalty box
    drawSnappedRect(ctx, fieldRight - penaltyAreaLength, rightPenaltyTop, penaltyAreaLength, penaltyAreaWidth);
    
    // Right penalty spot
    ctx.beginPath();
    ctx.arc(snapCoord(penaltySpotXR), snapCoord(penaltySpotY), 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Right penalty arc
    ctx.beginPath();
    ctx.arc(snapCoord(penaltySpotXR), snapCoord(penaltySpotY), 8, 1.5 * Math.PI, 2 * Math.PI);
    ctx.stroke();
    
    // Goal boxes (smaller areas at each end)
    const goalBoxTop = fieldTop + (fieldHeight - goalBoxWidth) / 2;
    const goalBoxBottom = fieldTop + (fieldHeight + goalBoxWidth) / 2;
    
    // Left goal box
    drawSnappedRect(ctx, fieldLeft, goalBoxTop, goalBoxLength, goalBoxWidth);
    
    // Right goal box
    drawSnappedRect(ctx, fieldRight - goalBoxLength, goalBoxTop, goalBoxLength, goalBoxWidth);
    
    // Corner arc ticks (small arcs at corners)
    const cornerRadius = 12;
    
    // Top-left corner tick
    ctx.beginPath();
    ctx.arc(snapCoord(fieldLeft + cornerRadius), snapCoord(fieldTop + cornerRadius), cornerRadius, Math.PI, 1.5 * Math.PI);
    ctx.stroke();
    
    // Top-right corner tick
    ctx.beginPath();
    ctx.arc(snapCoord(fieldRight - cornerRadius), snapCoord(fieldTop + cornerRadius), cornerRadius, 1.5 * Math.PI, 2 * Math.PI);
    ctx.stroke();
    
    // Bottom-left corner tick
    ctx.beginPath();
    ctx.arc(snapCoord(fieldLeft + cornerRadius), snapCoord(fieldBottom - cornerRadius), cornerRadius, 0.5 * Math.PI, Math.PI);
    ctx.stroke();
    
    // Bottom-right corner tick
    ctx.beginPath();
    ctx.arc(snapCoord(fieldRight - cornerRadius), snapCoord(fieldBottom - cornerRadius), cornerRadius, 0, 0.5 * Math.PI);
    ctx.stroke();
}

/**
 * Draw grid pattern template
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {Object} settings - Settings with gridSpacing
 */
export function drawGridPattern(ctx, width, height, settings = {}) {
    const spacing = settings.gridSpacing || DEFAULT_SETTINGS.gridSpacing;
    const margin = settings.margin || DEFAULT_SETTINGS.margin;
    
    const minor = 'rgba(255,255,255,0.08)';
    const major = 'rgba(255,255,255,0.16)';
    
    // Vertical lines
    let xi = 0;
    for (let x = margin + spacing; x < width - margin; x += spacing) {
        xi += 1;
        ctx.beginPath();
        ctx.strokeStyle = xi % 5 === 0 ? major : minor;
        ctx.moveTo(snapCoord(x), snapCoord(margin));
        ctx.lineTo(snapCoord(x), snapCoord(height - margin));
        ctx.stroke();
    }
    
    // Horizontal lines
    let yi = 0;
    for (let y = margin + spacing; y < height - margin; y += spacing) {
        yi += 1;
        ctx.beginPath();
        ctx.strokeStyle = yi % 5 === 0 ? major : minor;
        ctx.moveTo(snapCoord(margin), snapCoord(y));
        ctx.lineTo(snapCoord(width - margin), snapCoord(y));
        ctx.stroke();
    }
}

/**
 * Draw ruled paper pattern
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {Object} settings - Settings with lineSpacing
 */
export function drawRuledPattern(ctx, width, height, settings = {}) {
    const lineSpacing = settings.lineSpacing || DEFAULT_SETTINGS.lineSpacing;
    const margin = settings.margin || DEFAULT_SETTINGS.margin;
    
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    
    for (let y = margin + lineSpacing; y < height - margin; y += lineSpacing) {
        ctx.beginPath();
        ctx.moveTo(snapCoord(margin), snapCoord(y));
        ctx.lineTo(snapCoord(width - margin), snapCoord(y));
        ctx.stroke();
    }
}

/**
 * Render background based on type
 */
function renderBackground(ctx, type, width, height, options = {}) {
    const fillColor = options.fillColor || '';
    
    ctx.clearRect(0, 0, width, height);
    
    // Fill background
    const fallback = getComputedStyle(document.documentElement).getPropertyValue('--desktop-bg').trim()
        || getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim()
        || '#121214';
    const bg = fillColor || fallback;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    
    if (type === 'blank' || !type) return;
    
    ctx.save();
    ctx.lineWidth = 1;
    
    switch (type) {
        case 'grid':
            drawGridPattern(ctx, width, height, options);
            break;
        case 'dots':
            drawDotGrid(ctx, width, height, options.gridSpacing || DEFAULT_SETTINGS.gridSpacing);
            break;
        case 'graph':
            drawSquareGrid(ctx, width, height, 12, 5);
            break;
        case 'coarse':
            drawSquareGrid(ctx, width, height, 48);
            break;
        case 'isometric':
            drawIsometricGrid(ctx, width, height, options.gridSpacing || DEFAULT_SETTINGS.gridSpacing);
            break;
        case 'ruled':
            drawRuledPattern(ctx, width, height, options);
            break;
        case 'hex':
            drawHexGrid(ctx, width, height, options.gridSpacing || DEFAULT_SETTINGS.gridSpacing);
            break;
        case 'notebook':
            drawNotebookPattern(ctx, width, height, options);
            break;
        case 'staff':
            drawMusicStaff(ctx, width, height, options);
            break;
        case 'football':
            drawFootballField(ctx, width, height, options);
            break;
    }
    
    ctx.restore();
}

// ============================================================================
// ADDITIONAL GRID HELPERS (for backgrounds)
// ============================================================================

function drawDotGrid(ctx, width, height, spacing) {
    const r = Math.max(1, spacing * 0.08);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    for (let y = spacing; y < height; y += spacing) {
        for (let x = spacing; x < width; x += spacing) {
            ctx.beginPath();
            ctx.arc(snapCoord(x), snapCoord(y), r, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawSquareGrid(ctx, width, height, spacing, majorEvery = 0) {
    const minor = 'rgba(255,255,255,0.08)';
    const major = 'rgba(255,255,255,0.16)';
    
    let xi = 0;
    for (let x = spacing; x < width; x += spacing) {
        xi += 1;
        ctx.beginPath();
        ctx.strokeStyle = majorEvery && xi % majorEvery === 0 ? major : minor;
        ctx.moveTo(snapCoord(x), snapCoord(0));
        ctx.lineTo(snapCoord(x), snapCoord(height));
        ctx.stroke();
    }
    
    let yi = 0;
    for (let y = spacing; y < height; y += spacing) {
        yi += 1;
        ctx.beginPath();
        ctx.strokeStyle = majorEvery && yi % majorEvery === 0 ? major : minor;
        ctx.moveTo(snapCoord(0), snapCoord(y));
        ctx.lineTo(snapCoord(width), snapCoord(y));
        ctx.stroke();
    }
}

function drawIsometricGrid(ctx, width, height, spacing) {
    const stroke = 'rgba(255,255,255,0.08)';
    const diag = spacing * Math.sqrt(3);
    ctx.strokeStyle = stroke;
    
    for (let x = 0; x < width + height; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(snapCoord(x), snapCoord(0));
        ctx.lineTo(snapCoord(x - height), snapCoord(height));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(snapCoord(x), snapCoord(0));
        ctx.lineTo(snapCoord(x + height), snapCoord(height));
        ctx.stroke();
    }
    
    for (let y = 0; y < height; y += diag) {
        ctx.beginPath();
        ctx.moveTo(snapCoord(0), snapCoord(y));
        ctx.lineTo(snapCoord(width), snapCoord(y));
        ctx.stroke();
    }
}

function drawHexCell(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 3) * i - Math.PI / 6;
        const x = cx + r * Math.cos(ang);
        const y = cy + r * Math.sin(ang);
        if (i === 0) ctx.moveTo(snapCoord(x), snapCoord(y));
        else ctx.lineTo(snapCoord(x), snapCoord(y));
    }
    ctx.closePath();
    ctx.stroke();
}

function drawHexGrid(ctx, width, height, spacing) {
    const r = spacing * 0.45;
    const rowH = spacing * 0.78;
    const colW = spacing * 0.9;
    
    let row = 0;
    for (let y = r; y < height + r; y += rowH, row++) {
        const offset = row % 2 ? colW * 0.5 : 0;
        for (let x = r + offset; x < width + r; x += colW) {
            drawHexCell(ctx, x, y, r);
        }
    }
}

function drawNotebookPattern(ctx, width, height, options) {
    const margin = options.margin || DEFAULT_SETTINGS.margin;
    ctx.strokeStyle = 'rgba(248,113,113,0.35)';
    
    ctx.beginPath();
    ctx.moveTo(snapCoord(margin), snapCoord(0));
    ctx.lineTo(snapCoord(margin), snapCoord(height));
    ctx.stroke();
    
    drawRuledPattern(ctx, width, height, options);
}

// ============================================================================
// STROKE RENDERING
// ============================================================================

/**
 * Render strokes to canvas context
 * Handles brush, text, and shape strokes
 */
function renderStrokesToContext(ctx, strokes, texts) {
    if (!strokes) return;
    
    strokes.forEach((s) => {
        if (s.tool === 'brush') {
            drawBrushStroke(ctx, s);
        } else if (s.tool === 'text') {
            drawTextObject(ctx, s);
        } else {
            drawShapeStroke(ctx, s);
        }
    });
    
    if (texts && texts.length) {
        texts.forEach((t) => drawTextObject(ctx, t));
    }
}

/**
 * Draw brush stroke
 */
function drawBrushStroke(ctx, stroke) {
    const pts = stroke.points;
    if (!pts?.length) return;
    
    ctx.save();
    ctx.strokeStyle = stroke.color || '#ffffff';
    ctx.fillStyle = stroke.color || '#ffffff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Simple line drawing for brush strokes
    if (pts.length === 1) {
        const w = stroke.width || 2;
        ctx.beginPath();
        ctx.arc(snapCoord(pts[0].x), snapCoord(pts[0].y), w / 2, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.moveTo(snapCoord(pts[0].x), snapCoord(pts[0].y));
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(snapCoord(pts[i].x), snapCoord(pts[i].y));
        }
        ctx.stroke();
    }
    
    ctx.restore();
}

/**
 * Draw shape stroke
 */
function drawShapeStroke(ctx, stroke) {
    if (!stroke) return;
    
    ctx.save();
    ctx.strokeStyle = stroke.color || '#ffffff';
    ctx.fillStyle = stroke.color || '#ffffff';
    ctx.lineWidth = stroke.width || 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    const { x0, y0, x1, y1, tool } = stroke;
    
    switch (tool) {
        case 'line':
            ctx.beginPath();
            ctx.moveTo(snapCoord(x0), snapCoord(y0));
            ctx.lineTo(snapCoord(x1), snapCoord(y1));
            ctx.stroke();
            break;
        case 'rect':
            const rw = Math.abs(x1 - x0);
            const rh = Math.abs(y1 - y0);
            ctx.strokeRect(snapCoord(Math.min(x0, x1)), snapCoord(Math.min(y0, y1)), rw, rh);
            break;
        case 'ellipse':
            const cx = (x0 + x1) / 2;
            const cy = (y0 + y1) / 2;
            const rx = Math.abs(x1 - x0) / 2;
            const ry = Math.abs(y1 - y0) / 2;
            ctx.beginPath();
            ctx.ellipse(snapCoord(cx), snapCoord(cy), rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
            break;
        default:
            // Fallback for other shapes
            if (x0 !== undefined && y0 !== undefined) {
                ctx.beginPath();
                ctx.moveTo(snapCoord(x0), snapCoord(y0));
                if (x1 !== undefined && y1 !== undefined) {
                    ctx.lineTo(snapCoord(x1), snapCoord(y1));
                }
                ctx.stroke();
            }
    }
    
    ctx.restore();
}

/**
 * Draw text object
 */
function drawTextObject(ctx, textObj) {
    if (!textObj?.text) return;
    
    ctx.save();
    ctx.fillStyle = textObj.color || '#f1f5f9';
    ctx.font = `${textObj.fontSize || 24}px ${textObj.fontFamily || 'Inter, sans-serif'}`;
    ctx.textBaseline = 'top';
    
    String(textObj.text).split('\n').forEach((line, i) => {
        ctx.fillText(line, textObj.x, textObj.y + i * (textObj.fontSize || 24) * 1.25);
    });
    
    ctx.restore();
}

// ============================================================================
// PAGE RENDERING
// ============================================================================

/**
 * Read document from localStorage
 */
function readDocument() {
    try {
        const raw = localStorage.getItem('matrix_global_drawing');
        if (!raw) return createEmptyDocument();
        return JSON.parse(raw);
    } catch (e) {
        return createEmptyDocument();
    }
}

/**
 * Get active page from document
 */
function getActivePage(doc) {
    return doc.pages?.find(p => p.id === doc.activePageId) || doc.pages?.[0] || createEmptyPage();
}

/**
 * Create empty document
 */
function createEmptyDocument() {
    return {
        version: 2,
        canvasMode: 'a4',
        activePageId: null,
        pages: [],
        infinite: {
            strokes: [],
            texts: [],
            background: 'blank',
            backgroundColor: '',
            bounds: { minX: 0, minY: 0, maxX: 3000, maxY: 3000 }
        },
        viewport: { scale: 1, offsetX: 0, offsetY: 0 }
    };
}

/**
 * Create empty page
 */
function createEmptyPage(format, background, backgroundColor) {
    return {
        id: 'page_' + Date.now(),
        format: format || 'a4',
        background: background || 'blank',
        backgroundColor: backgroundColor || '',
        strokes: [],
        texts: []
    };
}

/**
 * Render a page to canvas
 * @param {Object} page - Page object
 * @param {Object} doc - Document object
 * @returns {HTMLCanvasElement}
 */
export function renderPageToCanvas(page, doc) {
    const orientation = doc.orientation || page.orientation || 'portrait';
    const { width, height } = getFormatDimensions(page.format || doc.canvasMode || 'a4', orientation);
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d');
    
    // Determine background settings
    const isInfinite = doc.canvasMode === 'infinite';
    const bg = isInfinite 
        ? (doc.infinite?.background || 'blank') 
        : (page.background || 'blank');
    const fillColor = isInfinite 
        ? (doc.infinite?.backgroundColor || '') 
        : (page.backgroundColor || '');
    
    // Render background
    renderBackground(ctx, bg, width, height, { fillColor });
    
    // Get strokes and texts
    const strokes = isInfinite 
        ? (doc.infinite?.strokes || []) 
        : (page.strokes || []);
    const texts = isInfinite 
        ? (doc.infinite?.texts || []) 
        : (page.texts || []);
    
    // Render strokes using global helper if available, otherwise use local fallback
    if (typeof renderStrokesToContext === 'function') {
        renderStrokesToContext(ctx, strokes, texts);
    } else {
        // Fallback: iterate through page elements
        const elements = page.elements || [];
        elements.forEach((el) => {
            if (el.type === 'stroke') {
                if (el.tool === 'brush') drawBrushStroke(ctx, el);
                else if (el.tool === 'text') drawTextObject(ctx, el);
                else drawShapeStroke(ctx, el);
            }
        });
        renderStrokesToContext(ctx, strokes, texts);
    }
    
    return canvas;
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

/**
 * Export canvas as JSON
 */
export function exportCanvasJson() {
    const doc = readDocument();
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `magicCanvas_${Math.floor(Date.now() / 1000)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
}

/**
 * Export canvas as PNG
 * @param {Object} options - Options with allPages flag
 */
export function exportCanvasPng({ allPages = false } = {}) {
    const doc = readDocument();
    
    if (allPages && doc.canvasMode !== 'infinite' && doc.pages?.length > 1) {
        // Calculate dynamic dimensions for multi-page export
        let maxWidth = 0;
        let totalHeight = 0;
        
        const canvases = doc.pages.map((page) => {
            const c = renderPageToCanvas(page, { ...doc, canvasMode: page.format ? doc.canvasMode : 'a4', activePageId: page.id });
            maxWidth = Math.max(maxWidth, c.width);
            totalHeight += c.height;
            return c;
        });
        
        // Create master canvas with calculated dimensions
        const out = document.createElement('canvas');
        out.width = maxWidth;
        out.height = totalHeight;
        const ctx = out.getContext('2d');
        
        // Stitch pages together
        let yOffset = 0;
        canvases.forEach((c) => {
            ctx.drawImage(c, 0, yOffset);
            yOffset += c.height;
        });
        
        downloadCanvas(out, 'magicCanvas_pages.png');
        return;
    }
    
    // Single page export
    const page = getActivePage(doc);
    const c = renderPageToCanvas(page, doc);
    downloadCanvas(c, 'magicCanvas.png');
}

/**
 * Export canvas as PDF (via print)
 */
export function exportCanvasPdf() {
    const doc = readDocument();
    
    const pages = doc.canvasMode === 'infinite'
        ? [{ ...getActivePage(doc), strokes: doc.infinite?.strokes || [], texts: doc.infinite?.texts || [] }]
        : (doc.pages || []);
    
    const images = pages.map((page) => {
        const c = renderPageToCanvas(page, doc);
        return c.toDataURL('image/png');
    });
    
    const win = window.open('', '_blank');
    if (!win) {
        alert('Allow pop-ups to export PDF via print dialog.');
        return;
    }
    
    // Build HTML with proper CSS for PDF export
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>magicCanvas export</title>
    <style>
        body { margin: 0; padding: 0; }
        img { 
            display: block; 
            width: 100%; 
            max-width: 100%; 
            height: auto;
            page-break-after: always;
        }
        @media print {
            img { page-break-after: always; }
            body { margin: 0; }
        }
    </style>
</head>
<body>
    ${images.map((src) => `<img src="${src}" alt="page">`).join('')}
</body>
</html>`;
    
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
}

/**
 * Download canvas as file
 */
function downloadCanvas(canvas, filename) {
    canvas.toBlob((blob) => {
        if (!blob) return;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }, 'image/png');
}

// ============================================================================
// MUSIC STAFF HELPERS
// ============================================================================

/**
 * Draw treble clef for music staff
 */
function drawTrebleClef(ctx, x, staffTop, lineGap) {
    const gLine = staffTop + lineGap * 3;
    const s = lineGap * 0.72;
    
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(1.1, lineGap * 0.14);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.translate(x, gLine);
    ctx.scale(s, s);
    
    ctx.beginPath();
    ctx.moveTo(2, 5.5);
    ctx.bezierCurveTo(-6, 5, -9, -1, -5, -7);
    ctx.bezierCurveTo(-1, -12, 7, -9, 6, -3);
    ctx.bezierCurveTo(5, 2, -1, 5, -4, 4);
    ctx.bezierCurveTo(-8, 2, -6, -4, -1, -3);
    ctx.bezierCurveTo(4, -2, 6, 3, 3, 6.5);
    ctx.bezierCurveTo(1, 8.5, -2, 9, -3.5, 8);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(3, 7);
    ctx.bezierCurveTo(5, 9, 4, 11.5, 1.5, 12);
    ctx.bezierCurveTo(-0.5, 12.4, -2, 11, -1, 9);
    ctx.stroke();
    
    ctx.restore();
}

/**
 * Draw staff block with treble clef
 */
function drawStaffBlock(ctx, width, top, lineGap, lineStartX) {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    drawTrebleClef(ctx, 28, top, lineGap);
    
    for (let i = 0; i < 5; i++) {
        const y = top + i * lineGap;
        ctx.beginPath();
        ctx.moveTo(snapCoord(lineStartX), snapCoord(y));
        ctx.lineTo(snapCoord(width - 24), snapCoord(y));
        ctx.stroke();
    }
}