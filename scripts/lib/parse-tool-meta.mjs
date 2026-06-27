import fs from 'fs';
import path from 'path';

export function humanizeToolId(id) {
    return id.replace(/[-_]/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Brace-balanced JSON after @tag (nested objects in @tool headers). */
export function extractMetaJson(head, tag) {
    const tagMatch = head.match(new RegExp(`@${tag}\\s+`));
    if (!tagMatch) return null;

    const jsonStart = head.indexOf('{', tagMatch.index);
    if (jsonStart < 0) return null;

    let depth = 0;
    for (let i = jsonStart; i < head.length; i++) {
        const char = head[i];
        if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(head.slice(jsonStart, i + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

export function parseToolFile(filePath) {
    const id = path.basename(filePath, '.js');
    if (!id || id[0] === '_' || id === 'registry') return null;

    const head = fs.readFileSync(filePath, 'utf8').slice(0, 4096);
    if (!/@tool\b/.test(head)) return null;

    let label = humanizeToolId(id);
    let order = 100;
    let wide = false;
    let mountClass = '';
    let resizable = false;
    let resizeMode = '';
    let defaultSize = null;
    let minSize = null;
    let icon = '';

    const meta = extractMetaJson(head, 'tool');
    if (meta) {
        if (meta?.label) label = meta.label;
        if (meta?.order != null) order = Number(meta.order);
        if (meta?.wide) wide = true;
        if (meta?.mountClass) mountClass = String(meta.mountClass);
        if (meta?.resizable) resizable = true;
        if (meta?.resizeMode) resizeMode = String(meta.resizeMode);
        if (meta?.defaultSize) defaultSize = meta.defaultSize;
        if (meta?.minSize) minSize = meta.minSize;
        if (meta?.icon) icon = String(meta.icon);
    }

    const iconMatch = head.match(/@tool-icon\s+(.+?)\s*\*\//s);
    if (iconMatch) {
        icon = iconMatch[1].trim();
    }

    const entry = { id, label, order, icon, wide, mountClass };
    if (resizable) entry.resizable = true;
    if (resizeMode) entry.resizeMode = resizeMode;
    if (defaultSize) entry.defaultSize = defaultSize;
    if (minSize) entry.minSize = minSize;
    return entry;
}

export function buildToolsRegistry(toolsDir) {
    if (!fs.existsSync(toolsDir)) return null;

    const tools = fs
        .readdirSync(toolsDir)
        .filter((name) => name.endsWith('.js') && name !== 'registry.js')
        .map((name) => parseToolFile(path.join(toolsDir, name)))
        .filter(Boolean);

    tools.sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    });

    return tools;
}
