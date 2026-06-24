/**
 * Regenerates .cursor/rules/magiclists-architecture.mdc from index.html,
 * @css headers in css/*.css, @module headers in js/**/*.js, and @tool metadata.
 *
 * Run: node scripts/build-architecture-map.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildToolsRegistry } from './lib/parse-tool-meta.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const CSS_DIR = path.join(ROOT, 'css');
const JS_DIR = path.join(ROOT, 'js');
const OUT_MDC = path.join(ROOT, '.cursor', 'rules', 'magiclists-architecture.mdc');

const SKIP_JS_DIRS = new Set(['node_modules']);

function readHead(filePath, bytes = 4096) {
    return fs.readFileSync(filePath, 'utf8').slice(0, bytes);
}

function parseMetaTag(head, tag) {
    const match = head.match(new RegExp(`@${tag}\\s+(\\{.*?\\})`, 's'));
    if (!match) return null;
    try {
        return JSON.parse(match[1]);
    } catch {
        return null;
    }
}

function parseBannerTitle(head) {
    const match = head.match(/\/\* =+\s*\n\s*(.+?)\s*\n\s*=+ \*\//s);
    return match ? match[1].trim() : '';
}

function escapeMdCell(value) {
    return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function listCell(items) {
    if (!items) return '—';
    if (Array.isArray(items)) return items.length ? items.join(', ') : '—';
    return String(items);
}

function parseCssLinksFromIndex() {
    const html = fs.readFileSync(INDEX_HTML, 'utf8');
    const links = [];
    const re = /<link\s+[^>]*href="\.\/css\/([^"?]+\.css)[^"]*"[^>]*>/gi;
    let match;
    while ((match = re.exec(html)) !== null) {
        links.push(match[1].replace(/\\/g, '/'));
    }
    return links;
}

function listCssFilesOnDisk() {
    if (!fs.existsSync(CSS_DIR)) return [];
    return fs.readdirSync(CSS_DIR).filter((name) => name.endsWith('.css')).sort();
}

function buildCssSection(linkedFiles) {
    const rows = [];
    const warnings = [];
    const errors = [];

    linkedFiles.forEach((file, index) => {
        const abs = path.join(CSS_DIR, file);
        if (!fs.existsSync(abs)) {
            errors.push(`index.html links missing file: css/${file}`);
            return;
        }
        const head = readHead(abs);
        const meta = parseMetaTag(head, 'css');
        const banner = parseBannerTitle(head);
        if (!meta?.owns) {
            warnings.push(`css/${file}: missing @css header${banner ? ` (banner: ${banner})` : ''}`);
        }
        rows.push({
            file: `css/${file}`,
            owns: meta?.owns || banner || '(unknown)',
            js: listCell(meta?.js),
            notes: meta?.notes || '—',
            load: index + 1
        });
    });

    const linkedSet = new Set(linkedFiles);
    for (const file of listCssFilesOnDisk()) {
        if (!linkedSet.has(file)) {
            warnings.push(`css/${file}: on disk but not linked in index.html (orphan)`);
        }
    }

    return { rows, warnings, errors };
}

function walkJsFiles(dir, relPrefix = '') {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_JS_DIRS.has(entry.name)) continue;
        const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkJsFiles(abs, rel));
            continue;
        }
        if (!entry.name.endsWith('.js')) continue;
        results.push({ rel: rel.replace(/\\/g, '/'), abs });
    }
    return results;
}

function buildJsSection() {
    const rows = [];
    const warnings = [];

    for (const { rel, abs } of walkJsFiles(JS_DIR)) {
        const head = readHead(abs);
        const meta = parseMetaTag(head, 'module');
        if (!meta?.owns) continue;
        rows.push({
            file: `js/${rel}`,
            owns: meta.owns,
            related: listCell(meta.related),
            events: listCell(meta.events),
            notes: meta.notes || '—'
        });
    }

    rows.sort((a, b) => a.file.localeCompare(b.file));
    return { rows, warnings };
}

function buildToolsSection() {
    const tools = buildToolsRegistry(path.join(JS_DIR, 'tools')) || [];
    return tools.map((tool) => ({
        id: tool.id,
        label: tool.label,
        mountClass: tool.mountClass || '—',
        order: tool.order
    }));
}

function renderTable(headers, rows) {
    const lines = [
        `| ${headers.join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`
    ];
    for (const row of rows) {
        lines.push(`| ${headers.map((h) => escapeMdCell(row[h])).join(' | ')} |`);
    }
    return lines.join('\n');
}

function buildMdc({ cssRows, jsRows, toolsRows, warnings, errors }) {
    const timestamp = new Date().toISOString();
    const lines = [
        '---',
        'description: magiclists architecture map (auto-generated — do not edit by hand)',
        'alwaysApply: true',
        '---',
        '',
        '# Architecture map (generated)',
        '',
        `> Regenerate: \`node scripts/build-architecture-map.mjs\` — built ${timestamp}`,
        '',
        '## CSS load order',
        '',
        renderTable(
            ['file', 'owns', 'js', 'notes', 'load'],
            cssRows.map((r) => ({ file: r.file, owns: r.owns, js: r.js, notes: r.notes, load: r.load }))
        ),
        '',
        '## JS domains (@module)',
        '',
        renderTable(
            ['file', 'owns', 'related', 'events', 'notes'],
            jsRows.map((r) => ({ file: r.file, owns: r.owns, related: r.related, events: r.events, notes: r.notes }))
        ),
        '',
        '## Tools (@tool)',
        '',
        renderTable(
            ['id', 'label', 'mountClass', 'order'],
            toolsRows.map((r) => ({ id: r.id, label: r.label, mountClass: r.mountClass, order: r.order }))
        )
    ];

    if (warnings.length || errors.length) {
        lines.push('', '## Validation', '');
        for (const err of errors) lines.push(`- **ERROR:** ${err}`);
        for (const warn of warnings) lines.push(`- **WARN:** ${warn}`);
    }

    lines.push('');
    return lines.join('\n');
}

function main() {
    const linkedCss = parseCssLinksFromIndex();
    const { rows: cssRows, warnings: cssWarnings, errors } = buildCssSection(linkedCss);
    const { rows: jsRows, warnings: jsWarnings } = buildJsSection();
    const toolsRows = buildToolsSection();
    const warnings = [...cssWarnings, ...jsWarnings];

    if (errors.length) {
        for (const err of errors) console.error(`[build-architecture-map] ERROR: ${err}`);
        process.exit(1);
    }

    const mdc = buildMdc({ cssRows, jsRows, toolsRows, warnings, errors });
    fs.mkdirSync(path.dirname(OUT_MDC), { recursive: true });
    fs.writeFileSync(OUT_MDC, mdc, 'utf8');

    console.log(`[build-architecture-map] ${cssRows.length} CSS, ${jsRows.length} JS modules, ${toolsRows.length} tools → ${path.relative(ROOT, OUT_MDC)}`);
    for (const warn of warnings) console.warn(`[build-architecture-map] WARN: ${warn}`);
}

main();
