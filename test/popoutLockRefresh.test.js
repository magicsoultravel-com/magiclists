// test/popoutLockRefresh.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRefreshPopoutLockedCard } from '../js/popoutLockRefresh.js';

function mockCard(locked = false) {
    return { classList: { contains: (cls) => cls === 'is-popout-locked' && locked } };
}

function mockBridge({ claimed = new Set(), popped = new Set() } = {}) {
    return {
        isClaimedByOther: (id) => claimed.has(id),
        isPoppedOut: (id) => popped.has(id)
    };
}

describe('shouldRefreshPopoutLockedCard', () => {
    it('skips unlocked cards with no popout claim', () => {
        const bridge = mockBridge();
        assert.equal(shouldRefreshPopoutLockedCard('note-b', mockCard(false), bridge), false);
    });

    it('skips cards that already show lock chrome while claimed', () => {
        const bridge = mockBridge({ claimed: new Set(['note-a']), popped: new Set(['note-a']) });
        assert.equal(shouldRefreshPopoutLockedCard('note-a', mockCard(true), bridge), false);
    });

    it('refreshes when a note is newly popped out', () => {
        const bridge = mockBridge({ claimed: new Set(['note-a']), popped: new Set(['note-a']) });
        assert.equal(shouldRefreshPopoutLockedCard('note-a', mockCard(false), bridge), true);
    });

    it('refreshes when a note is popped back in and DOM lock is stale', () => {
        const bridge = mockBridge();
        assert.equal(shouldRefreshPopoutLockedCard('note-a', mockCard(true), bridge), true);
    });

    it('does not refresh unrelated unlocked cards during claim heartbeat', () => {
        const bridge = mockBridge({ claimed: new Set(['note-a']), popped: new Set(['note-a']) });
        assert.equal(shouldRefreshPopoutLockedCard('note-b', mockCard(false), bridge), false);
    });
});
