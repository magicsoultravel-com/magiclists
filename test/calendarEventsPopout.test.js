// test/calendarEventsPopout.test.js
// Calendar day popout ("Events for <date>"): the close button must actually
// close, only one popout may exist at a time, and closing must release every
// document listener it registered.
//
// The regression this pins: the button used to be reached through
// document.getElementById('close-notes-list'). Two popouts (a day click firing
// the day handler twice, because every render re-bound every cell inside
// setTimeout) meant the id resolved to the *hidden* copy, so the visible X did
// nothing. Delegation on [data-close-events] inside the popout removes the
// shared id from the picture entirely.
//
// js/calendar.js needs a DOM for this; the stub below implements only what
// showEventsList()/closeEventsList() touch, in the same spirit as
// test/magicFocusSplitters.test.js.
//
// Run with: npm test  (node --test)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => void memory.set(key, String(value)),
    removeItem: (key) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (index) => [...memory.keys()][index] ?? null,
    get length() {
        return memory.size;
    }
};

const { Calendar } = await import('../js/calendar.js');

/** Minimal element: listener registry honouring AbortController signals. */
class StubElement {
    constructor(tagName) {
        this.tagName = tagName;
        this.className = '';
        this.innerHTML = '';
        this.dataset = {};
        this.parentNode = null;
        this.children = [];
        this.listeners = [];
    }

    appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        return child;
    }

    addEventListener(type, handler, options = {}) {
        if (options.signal?.aborted) return;
        const entry = { type, handler };
        this.listeners.push(entry);
        options.signal?.addEventListener('abort', () => {
            this.listeners = this.listeners.filter((listener) => listener !== entry);
        });
    }

    closest() {
        return null;
    }

    contains(node) {
        return node === this;
    }

    remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
        this.parentNode = null;
    }

    dispatch(type, event = {}) {
        for (const listener of [...this.listeners]) {
            if (listener.type === type) listener.handler(event);
        }
    }
}

const documentStub = new StubElement('#document');
documentStub.body = new StubElement('body');
documentStub.createElement = (tagName) => new StubElement(tagName);
documentStub.querySelectorAll = (selector) => {
    if (selector !== '.calendar-notes-modal') return [];
    return documentStub.body.children.filter((el) => el.className.split(/\s+/).includes('calendar-notes-modal'));
};
globalThis.document = documentStub;

/** A click target whose closest() only matches the given selector. */
const targetMatching = (selector) => ({
    closest: (candidate) => (candidate === selector ? {} : null)
});

const openPopout = (events = []) => {
    Calendar.showEventsList(events, new Date(2026, 10, 11));
    const modals = documentStub.querySelectorAll('.calendar-notes-modal');
    assert.ok(modals.length >= 1, 'popout was appended to the body');
    return modals[modals.length - 1];
};

describe('calendar · day popout', () => {
    beforeEach(() => {
        Calendar.closeEventsList();
        documentStub.body.children = [];
    });

    it('renders an X wired through data-close-events, not a shared id', () => {
        const modal = openPopout();
        assert.match(modal.innerHTML, /data-close-events/);
        assert.match(modal.innerHTML, /calendar-notes-close/);
        assert.doesNotMatch(modal.innerHTML, /close-notes-list/);
        assert.match(modal.innerHTML, /<svg/, 'close icon is inlined with the markup');
    });

    it('closes when the X is clicked', () => {
        const modal = openPopout();

        modal.dispatch('click', {
            target: targetMatching('[data-close-events]'),
            stopPropagation() {}
        });

        assert.equal(Calendar.eventsModal, null);
        assert.equal(documentStub.body.children.length, 0);
    });

    it('keeps a single popout when the same day is opened twice', () => {
        openPopout();
        openPopout();

        assert.equal(documentStub.body.children.length, 1, 'stale popout was replaced');
        assert.ok(Calendar.eventsModal);
    });

    it('closes on Escape and drops its document listeners', () => {
        const before = documentStub.listeners.length;
        openPopout();
        assert.equal(documentStub.listeners.length, before + 2, 'keydown + pointerdown registered');

        documentStub.dispatch('keydown', { key: 'Escape' });

        assert.equal(Calendar.eventsModal, null);
        assert.equal(documentStub.body.children.length, 0);
        assert.equal(documentStub.listeners.length, before, 'no listeners survive the close');
    });

    it('closes on a pointerdown outside the popout', () => {
        openPopout();

        documentStub.dispatch('pointerdown', { target: {} });

        assert.equal(documentStub.body.children.length, 0);
    });

    it('closes when the calendar tool closes', () => {
        openPopout();
        Calendar.close();

        assert.equal(Calendar.eventsModal, null);
        assert.equal(documentStub.body.children.length, 0);
    });
});
