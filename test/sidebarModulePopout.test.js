// test/sidebarModulePopout.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transferShellState } from '../js/sidebarModulePopoutShell.js';
import { SIDEBAR_MODULE_UNDOCKED } from '../js/sidebarUndock.js';

function mockClassList(initial = []) {
    const set = new Set(initial);
    return {
        add(...cls) { cls.forEach((c) => set.add(c)); },
        remove(...cls) { cls.forEach((c) => set.delete(c)); },
        contains(c) { return set.has(c); },
        *[Symbol.iterator]() { yield* set; }
    };
}

function mockStyle(initial = {}) {
    const props = new Map(Object.entries(initial));
    return {
        getPropertyValue(key) {
            return props.get(key) || '';
        },
        setProperty(key, value) {
            props.set(key, value);
        },
        removeProperty(key) {
            props.delete(key);
        }
    };
}

describe('sidebar module popout shell transfer', () => {
    it('copies undocked position classes onto placeholder and back onto live root', () => {
        const live = {
            classList: mockClassList(['sidebar-module', 'sidebar-tools', SIDEBAR_MODULE_UNDOCKED]),
            style: mockStyle({ left: '120px', top: '80px', '--sidebar-module-width': '220px' })
        };
        const placeholder = {
            classList: mockClassList(['sidebar-module', 'sidebar-module--popout-placeholder']),
            style: mockStyle({})
        };

        transferShellState(live, placeholder);
        assert.ok(placeholder.classList.contains(SIDEBAR_MODULE_UNDOCKED));
        assert.equal(placeholder.style.getPropertyValue('left'), '120px');
        assert.equal(placeholder.style.getPropertyValue('top'), '80px');

        const restored = {
            classList: mockClassList(['sidebar-module', 'sidebar-module--popout']),
            style: mockStyle({})
        };
        transferShellState(placeholder, restored);
        assert.ok(restored.classList.contains(SIDEBAR_MODULE_UNDOCKED));
        assert.equal(restored.style.getPropertyValue('left'), '120px');
        assert.equal(restored.style.getPropertyValue('top'), '80px');
        assert.ok(!restored.classList.contains('sidebar-module--popout-placeholder'));
    });
});
