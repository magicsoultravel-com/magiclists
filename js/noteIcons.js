/** Curated stroke icons for inline note insertion (12×12, currentColor). */
function svg(body) {
    return `<svg class="note-inline-icon__svg" viewBox="0 0 12 12" width="1em" height="1em" focusable="false" aria-hidden="true">${body}</svg>`;
}

export const NOTE_ICONS = [
    { id: 'star', label: 'Star', svg: svg('<path d="M6 1.8 7.4 4.6 10.5 5l-2.2 2.1.5 3.1L6 9.4 3.2 10.2l.5-3.1L1.5 5 4.6 4.6 6 1.8z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/>') },
    { id: 'heart', label: 'Heart', svg: svg('<path d="M6 10.2S1.5 7.1 1.5 4.4a2.2 2.2 0 0 1 3.8-1.5L6 4.1l.7-.7A2.2 2.2 0 0 1 10.5 4.4C10.5 7.1 6 10.2 6 10.2z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/>') },
    { id: 'check', label: 'Check', svg: svg('<path d="M2.2 6.2l2.6 2.6L9.8 3.8" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>') },
    { id: 'pin', label: 'Pin', svg: svg('<circle cx="6" cy="3.4" r="2.1" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M6 5.4v4.8M4.6 10.2h2.8" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/>') },
    { id: 'calendar', label: 'Calendar', svg: svg('<rect x="1.5" y="2.5" width="9" height="8" rx="0.8" fill="none" stroke="currentColor" stroke-width="1"/><path d="M1.5 5.2h9M4 1.5v1.6M8 1.5v1.6" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>') },
    { id: 'clock', label: 'Clock', svg: svg('<circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M6 3.6V6l2 1.2" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/>') },
    { id: 'flag', label: 'Flag', svg: svg('<path d="M3.2 2.2v7.6M3.2 2.2h4.8c1 0 1.6.6 1.6 1.4s-.6 1.4-1.6 1.4H3.2" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>') },
    { id: 'bolt', label: 'Bolt', svg: svg('<path d="M6.8 1.8 4.2 6.4h2.4L5.2 10.2 7.8 5.6H5.4Z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/>') },
    { id: 'book', label: 'Book', svg: svg('<path d="M2.4 2.4h3.6v7.2H2.4zM6 2.4h3.6v7.2H6z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/>') },
    { id: 'tag', label: 'Tag', svg: svg('<path d="M2.4 2.4h3.6l4.8 4.8-2.4 2.4-4.8-4.8V2.4z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/><circle cx="4.8" cy="4.8" r="0.75" fill="currentColor"/>') },
    { id: 'link', label: 'Link', svg: svg('<path d="M4.6 7.4 2.8 5.6a1.8 1.8 0 0 1 0-2.6l1.2-1.2a1.8 1.8 0 0 1 2.6 0l.6.6M7.4 4.6l1.8 1.8a1.8 1.8 0 0 1 0 2.6l-1.2 1.2a1.8 1.8 0 0 1-2.6 0l-.6-.6" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/>') },
    { id: 'warning', label: 'Warning', svg: svg('<path d="M6 1.8 10.4 9.6H1.6Z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/><path d="M6 4.4v2.4M6 8.4h.01" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>') },
    { id: 'info', label: 'Info', svg: svg('<circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M6 5.2V8.4M6 3.6h.01" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>') },
    { id: 'arrow-right', label: 'Arrow right', svg: svg('<path d="M2 6h6.2M6.8 3.4 10 6l-3.2 2.6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>') },
    { id: 'arrow-left', label: 'Arrow left', svg: svg('<path d="M10 6H3.8M5.2 3.4 2 6l3.2 2.6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>') },
    { id: 'arrow-up', label: 'Arrow up', svg: svg('<path d="M6 10V3.8M3.4 5.2 6 2.8l2.6 2.4" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>') },
    { id: 'arrow-down', label: 'Arrow down', svg: svg('<path d="M6 2v6.2M3.4 6.8 6 9.2l2.6-2.4" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>') },
    { id: 'plus', label: 'Plus', svg: svg('<path d="M6 2.4v7.2M2.4 6h7.2" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/>') },
    { id: 'minus', label: 'Minus', svg: svg('<path d="M2.4 6h7.2" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/>') },
    { id: 'question', label: 'Question', svg: svg('<circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M4.6 4.6c0-1 .8-1.6 1.8-1.6.9 0 1.6.5 1.6 1.3 0 .8-.5 1.1-1.2 1.5-.5.3-.8.7-.8 1.4V8" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/><circle cx="6" cy="9.4" r="0.45" fill="currentColor"/>') },
    { id: 'home', label: 'Home', svg: svg('<path d="M2.4 5.6 6 2.4l3.6 3.2V9.6H2.4z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/>') },
    { id: 'user', label: 'User', svg: svg('<circle cx="6" cy="4.2" r="2" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M2.4 10.2c.8-2 2.4-3 3.6-3s2.8 1 3.6 3" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>') },
    { id: 'mail', label: 'Mail', svg: svg('<rect x="1.8" y="3.2" width="8.4" height="5.6" rx="0.6" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M1.8 3.8 6 7.2l4.2-3.4" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linejoin="round"/>') },
    { id: 'folder', label: 'Folder', svg: svg('<path d="M2.2 3.6h3l1 1.2h4.6v5.2H2.2z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/>') },
    { id: 'file', label: 'File', svg: svg('<path d="M3.6 2.2h3.2l2 2v5.6H3.6z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/><path d="M6.8 2.2V4.2H8.8" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linejoin="round"/>') },
    { id: 'image', label: 'Image', svg: svg('<rect x="2" y="2.8" width="8" height="6.4" rx="0.6" fill="none" stroke="currentColor" stroke-width="0.9"/><circle cx="4.4" cy="5.2" r="0.9" fill="none" stroke="currentColor" stroke-width="0.75"/><path d="M2.4 8.4l2.2-2 2.4 2.2 1.6-1.4 2 1.8" fill="none" stroke="currentColor" stroke-width="0.75" stroke-linejoin="round"/>') },
    { id: 'music', label: 'Music', svg: svg('<path d="M8.4 2.4v5.6c-.6-.4-1.4-.6-2.2-.4-1 .2-1.7 1-1.5 1.8s1 1.2 2 1 1.7-1 1.5-1.8V4.2l3.2-.8v3.2" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/>') },
    { id: 'sun', label: 'Sun', svg: svg('<circle cx="6" cy="6" r="2.2" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M6 1.4v1.2M6 9.4v1.2M1.4 6h1.2M9.4 6h1.2M2.8 2.8l.85.85M8.35 8.35l.85.85M9.2 2.8l-.85.85M3.65 8.35l-.85.85" fill="none" stroke="currentColor" stroke-width="0.75" stroke-linecap="round"/>') },
    { id: 'moon', label: 'Moon', svg: svg('<path d="M8.2 2.2a4 4 0 1 0 1.6 7.8A3.2 3.2 0 0 1 8.2 2.2z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/>') },
    { id: 'cloud', label: 'Cloud', svg: svg('<path d="M3.4 8.8h5.4a2.4 2.4 0 0 0 .2-4.8A3 3 0 0 0 3.6 2.6 2.6 2.6 0 0 0 1.2 6.2 2.4 2.4 0 0 0 3.4 8.8z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/>') },
    { id: 'target', label: 'Target', svg: svg('<circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.85"/><circle cx="6" cy="6" r="2.2" fill="none" stroke="currentColor" stroke-width="0.75"/><circle cx="6" cy="6" r="0.6" fill="currentColor"/>') }
];

export const NOTE_ICON_BY_ID = Object.fromEntries(NOTE_ICONS.map((icon) => [icon.id, icon]));

export function isNoteIconId(id) {
    return Boolean(NOTE_ICON_BY_ID[id]);
}

export function noteIconTokenMarkup(id) {
    if (!isNoteIconId(id)) return '';
    return `<span class="note-inline-icon" data-note-icon="${id}" contenteditable="false">\u200b</span>`;
}

export function hydrateNoteIconsHtml(html) {
    if (!html || !html.includes('data-note-icon')) return html;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    tpl.content.querySelectorAll('[data-note-icon]').forEach((span) => {
        const id = span.getAttribute('data-note-icon');
        const icon = NOTE_ICON_BY_ID[id];
        if (!icon) {
            span.remove();
            return;
        }
        span.classList.add('note-inline-icon');
        span.setAttribute('contenteditable', 'false');
        span.innerHTML = icon.svg;
    });
    return tpl.innerHTML;
}

export function hydrateNoteIcons(root) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('[data-note-icon]').forEach((span) => {
        const id = span.getAttribute('data-note-icon');
        const icon = NOTE_ICON_BY_ID[id];
        if (!icon) {
            span.remove();
            return;
        }
        span.classList.add('note-inline-icon');
        span.setAttribute('contenteditable', 'false');
        if (!span.querySelector('.note-inline-icon__svg')) {
            span.innerHTML = icon.svg;
        }
    });
}

export function pickerTileSvg(icon) {
    return icon.svg.replace('width="1em" height="1em"', 'width="14" height="14"');
}
