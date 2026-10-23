// test/bootWatchdog.test.js
// The fail-safe that replaced "stuck on Loading workspace… forever".
//
// #app-boot is a full-screen overlay removed only by BootProgress.complete(),
// which runs at the end of Application.init(). Anything that prevents app.js
// from evaluating (stale cached module, link error) or that blocks init() in an
// await leaves the overlay up with no feedback. index.html now carries an
// inline classic-script watchdog; these tests execute it for real against a
// fake DOM.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { BootProgress } from '../js/bootProgress.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const WATCHDOG_SOURCE = [...HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((source) => source.includes('__magicnotesBooted'));

function makeEl(extra = {}) {
    const classes = new Set();
    const el = {
        style: {},
        children: [],
        handlers: {},
        attrs: {},
        textContent: '',
        classes,
        classList: {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name)),
            contains: (name) => classes.has(name)
        },
        setAttribute(name, value) { el.attrs[name] = String(value); },
        getAttribute(name) { return el.attrs[name] ?? null; },
        appendChild(child) { el.children.push(child); return child; },
        addEventListener(type, fn) { (el.handlers[type] ||= []).push(fn); },
        ...extra
    };
    return el;
}

function createFakePage() {
    const panel = makeEl();
    const rootEl = makeEl({ querySelector: (selector) => (selector === '.app-boot__panel' ? panel : null) });
    rootEl.classes.add('is-indeterminate');
    const bar = makeEl();
    const status = makeEl({ textContent: 'Loading workspace…' });
    const byId = new Map([
        ['app-boot', rootEl],
        ['app-boot-bar', bar],
        ['app-boot-status', status]
    ]);
    const body = makeEl();
    body.attrs['aria-busy'] = 'true';
    body.removeAttribute = (name) => { delete body.attrs[name]; };
    body.hasAttribute = (name) => Object.hasOwn(body.attrs, name);

    const created = [];
    const document = {
        body,
        getElementById: (id) => byId.get(id) ?? null,
        createElement: () => {
            const el = makeEl();
            created.push(el);
            return el;
        }
    };
    return { document, rootEl, panel, bar, status, body, created, byId };
}

function runWatchdog(page, { booted = false } = {}) {
    const listeners = [];
    const timers = [];
    let reloads = 0;
    const sandbox = {
        console,
        document: page.document,
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        window: {
            __magicnotesBooted: booted,
            location: { reload: () => { reloads += 1; } },
            addEventListener(type, fn) { listeners.push({ type, fn }); }
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(WATCHDOG_SOURCE, sandbox);

    const fire = (type, event) => listeners.filter((item) => item.type === type).forEach((item) => item.fn(event));
    return {
        window: sandbox.window,
        timers,
        reloads: () => reloads,
        fireError: (event) => fire('error', event),
        fireRejection: (event) => fire('unhandledrejection', event)
    };
}

describe('boot watchdog · markup contract', () => {
    it('ships the overlay, an inline fail-safe and keeps them in the right order', () => {
        assert.match(HTML, /id="app-boot"/);
        assert.match(HTML, /id="app-boot-status"/);
        assert.ok(WATCHDOG_SOURCE, 'inline watchdog script is present');

        const overlayIndex = HTML.indexOf('id="app-boot"');
        const watchdogIndex = HTML.indexOf(WATCHDOG_SOURCE);
        const moduleIndex = HTML.search(/<script[^>]*type="module"/);

        assert.ok(overlayIndex < watchdogIndex, 'watchdog runs after the overlay exists');
        assert.ok(watchdogIndex < moduleIndex, 'watchdog runs before the module entry script');
        assert.match(WATCHDOG_SOURCE, /__magicnotesBooted/);
    });
});

describe('boot watchdog · failure reporting', () => {
    it('reports a module asset that failed to load', () => {
        const page = createFakePage();
        const run = runWatchdog(page);

        run.fireError({ target: { src: 'https://example.test/js/shellResize.js?v=abc12345' }, message: '' });

        assert.equal(run.window.__magicnotesBootFailed, true);
        assert.equal(page.rootEl.classes.has('is-indeterminate'), false);
        assert.equal(page.bar.style.width, '100%');
        assert.match(page.status.textContent, /Couldn’t finish loading/);
        assert.equal(page.body.hasAttribute('aria-busy'), false);

        const detail = page.created.find((el) => el.id === 'app-boot-failure-detail');
        assert.ok(detail, 'explains what happened');
        assert.match(detail.textContent, /shellResize\.js/);

        const button = page.created.find((el) => el.id === 'app-boot-retry');
        assert.ok(button, 'offers a recovery action');
        assert.equal(button.textContent, 'Reload');
        assert.ok(page.panel.children.includes(button));

        button.handlers.click[0]();
        assert.equal(run.reloads(), 1);
    });

    it('reports a link-time export mismatch (the stale-module crash)', () => {
        const page = createFakePage();
        const run = runWatchdog(page);

        run.fireError({
            target: run.window,
            message: "Uncaught SyntaxError: The requested module './shellResize.js' does not provide an export named 'clampSidebarWidth'"
        });

        assert.equal(run.window.__magicnotesBootFailed, true);
        const detail = page.created.find((el) => el.id === 'app-boot-failure-detail');
        assert.match(detail.textContent, /does not provide an export named/);
    });

    it('reports a failed dynamic import', () => {
        const page = createFakePage();
        const run = runWatchdog(page);

        run.fireRejection({
            reason: new Error('Failed to fetch dynamically imported module: https://example.test/js/plannerUi.js')
        });

        assert.equal(run.window.__magicnotesBootFailed, true);
    });

    it('reports a boot that silently never finishes', () => {
        const page = createFakePage();
        const run = runWatchdog(page);

        assert.equal(run.timers.length, 1);
        assert.equal(run.timers[0].ms, 15000);
        run.timers[0].fn();

        assert.equal(run.window.__magicnotesBootFailed, true);
        assert.match(page.status.textContent, /Couldn’t finish loading/);
    });

    it('keeps waiting while the storage-quota prompt is open', () => {
        const page = createFakePage();
        page.document.querySelector = (selector) => (selector === '.storage-quota-overlay' ? makeEl() : null);
        const run = runWatchdog(page);

        run.timers[0].fn();

        assert.equal(run.window.__magicnotesBootFailed, undefined);
        assert.equal(run.timers.length, 2, 're-arms the timeout instead of reporting a hang');
    });

    it('stays quiet once the app reports a completed boot', () => {
        const page = createFakePage();
        const run = runWatchdog(page, { booted: true });

        run.fireError({ message: "does not provide an export named 'x'" });
        run.fireRejection({ reason: new Error('Failed to fetch dynamically imported module') });
        run.timers.forEach((timer) => timer.fn());

        assert.equal(run.window.__magicnotesBootFailed, undefined);
        assert.equal(page.created.length, 0);
        assert.match(page.status.textContent, /Loading workspace/);
    });

    it('ignores unrelated runtime errors during boot', () => {
        const page = createFakePage();
        const run = runWatchdog(page);

        run.fireError({ target: run.window, message: 'Uncaught TypeError: casting SDK is unavailable' });

        assert.equal(run.window.__magicnotesBootFailed, undefined);
        assert.equal(page.created.length, 0);
    });
});

describe('bootProgress · boot signal', () => {
    it('flags completion even when the overlay is already gone', async () => {
        // First use of the module in this process: no overlay captured yet.
        const page = createFakePage();
        page.byId.delete('app-boot');
        globalThis.document = page.document;
        globalThis.window = {};

        await BootProgress.complete();

        assert.equal(globalThis.window.__magicnotesBooted, true);
        assert.equal(page.body.hasAttribute('aria-busy'), false);
    });

    it('removes the overlay, then flags the boot as complete', async () => {
        const page = createFakePage();
        let removed = false;
        page.rootEl.remove = () => { removed = true; };
        globalThis.document = page.document;
        globalThis.window = {};
        BootProgress.init();

        const realSetTimeout = globalThis.setTimeout;
        globalThis.setTimeout = (fn) => { fn(); return 0; };
        try {
            await BootProgress.complete();
        } finally {
            globalThis.setTimeout = realSetTimeout;
        }

        assert.equal(removed, true);
        assert.equal(globalThis.window.__magicnotesBooted, true);
    });
});
