/** Shared SVG icons for tool menu rows (12×12, matches tile icon style). */
const SVG = (body) =>
    `<svg viewBox="0 0 12 12" width="12" height="12" focusable="false" aria-hidden="true">${body}</svg>`;

export const TOOL_ICONS = {
    calendar: SVG('<rect x="1.5" y="2.5" width="9" height="8" rx="0.8" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M1.5 5.2h9M4 1.5v1.6M8 1.5v1.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/>'),
    calculator: SVG('<rect x="2" y="1.8" width="8" height="8.4" rx="0.8" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M4 4.2h4M4 6h1.6M6.4 6H8M4 7.8h4" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/>'),
    converter: SVG('<path d="M3.2 4.2h5.2M7.6 3.4 8.8 4.2 7.6 5" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.8 7.8H3.6M4.4 7 3.2 7.8 4.4 8.6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>'),
    timezone: SVG('<circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M6 3.6V6l2 1.2" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>'),
    globe: SVG('<circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M1.8 6h8.4M6 1.8c1.2 1.4 1.8 3 1.8 4.2S7.2 8.8 6 10.2M6 1.8C4.8 3.2 4.2 4.8 4.2 6s.6 2.8 1.8 4.2" fill="none" stroke="currentColor" stroke-width="0.85"/>'),
    'globe-tz': SVG('<circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M1.8 6h8.4M3.5 4h5M3.5 8h5" fill="none" stroke="currentColor" stroke-width="0.85"/>'),
    default: SVG('<rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M4.5 6h3" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>')
};

export function getToolIcon(iconKey, toolId) {
    const key = iconKey || toolId || 'default';
    return TOOL_ICONS[key] || TOOL_ICONS[toolId] || TOOL_ICONS.default;
}
