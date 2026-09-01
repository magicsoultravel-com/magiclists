// test/backupClaim.test.js
// Unit tests for the cross-tab scheduled-backup claim/lease helpers.
// These are pure functions (no DOM / BroadcastChannel / timers), so they run
// directly under node --test.
//
// Scenario being guarded: N tabs share one localStorage config and each runs
// its own tick. Without a claim, every tab can see "due" at the same moment and
// all export — multiplying backups and double-advancing the media ZIP chain.
//
// Run with: npm test  (node --test test/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    CLAIM_TTL_MS,
    createClaim,
    finalizeClaim,
    isClaimActive,
    mayCommit,
    normalizeClaim,
    scheduleNextDue
} from '../js/backupClaim.js';

/** Minimal shared-config shape the scheduler writes. */
function baseConfig(overrides = {}) {
    return {
        enabled: true,
        paused: false,
        amount: 30,
        unit: 'minutes',
        nextDueAt: 1000,
        runningClaim: null,
        notes: {
            enabled: true,
            format: 'json',
            lastFingerprint: 'a',
            lastExportAt: 100
        },
        media: {
            enabled: false,
            incremental: false,
            zipSnapshot: {},
            lastZipFingerprint: null,
            lastZipExportAt: null
        },
        ...overrides
    };
}

describe('backup claim — normalize + liveness', () => {
    it('normalizes a valid claim and rejects garbage', () => {
        const valid = normalizeClaim({ token: 't1', startedAt: 123 });
        assert.deepEqual(valid, { token: 't1', startedAt: 123 });

        assert.equal(normalizeClaim(null), null);
        assert.equal(normalizeClaim(undefined), null);
        assert.equal(normalizeClaim('nope'), null);
        assert.equal(normalizeClaim({ token: 't1' }), null);
        assert.equal(normalizeClaim({ startedAt: 123 }), null);
        assert.equal(normalizeClaim({ token: '', startedAt: 123 }), null);
    });

    it('reports a fresh claim active and an expired claim inactive', () => {
        const now = 10_000;
        assert.equal(isClaimActive(null, now, CLAIM_TTL_MS), false);
        assert.equal(isClaimActive(undefined, now, CLAIM_TTL_MS), false);

        const fresh = normalizeClaim({ token: 't1', startedAt: now - 1 });
        assert.equal(isClaimActive(fresh, now, CLAIM_TTL_MS), true);

        const justExpired = normalizeClaim({ token: 't1', startedAt: now - CLAIM_TTL_MS });
        assert.equal(isClaimActive(justExpired, now, CLAIM_TTL_MS), false);

        const old = normalizeClaim({ token: 't1', startedAt: now - CLAIM_TTL_MS - 60_000 });
        assert.equal(isClaimActive(old, now, CLAIM_TTL_MS), false);
    });

    it('mints unique tokens per call', () => {
        const a = createClaim(10_000);
        const b = createClaim(10_001);
        assert.ok(a.token);
        assert.ok(b.token);
        assert.notEqual(a.token, b.token);
        assert.equal(a.startedAt, 10_000);
        assert.equal(b.startedAt, 10_001);
    });
describe('backup claim — two-tab single-writer simulation', () => {
    it('only the tab whose claim survives the settle window may commit', () => {
        const now = 10_000;

        // Both tabs tick at the same due moment and both bid.
        const tabA = createClaim(now);
        const tabB = createClaim(now + 10);

        // Shared config; B's bid lands last (last-write-wins).
        let shared = baseConfig({ runningClaim: tabA });
        shared = { ...shared, runningClaim: tabB };

        // Winner: exactly one of the two bids survives the compare.
        assert.equal(mayCommit(tabA, shared), false);
        assert.equal(mayCommit(tabB, shared), true);
    });

    it('the winner can finalize and clear the claim; the loser is a no-op', () => {
        const now = 10_000;
        const winner = createClaim(now);
        const loser = createClaim(now + 5);

        const shared = baseConfig({ runningClaim: winner });

        // Loser tries to commit first — must be a no-op.
        const loserMerged = finalizeClaim(loser.token, shared, {
            notes: { lastFingerprint: 'NOT-MINE', lastExportAt: 999 }
        });
        assert.equal(loserMerged, null);
        assert.equal(shared.runningClaim.token, winner.token); // untouched

        // Winner commits and merges its results onto the fresh config.
        const merged = finalizeClaim(winner.token, shared, {
            notes: { lastFingerprint: 'w1', lastExportAt: 1001 },
            media: { zipSnapshot: { fileA: 7 } }
        });
        assert.ok(merged);
        assert.equal(merged.runningClaim, null);
        assert.equal(merged.notes.lastFingerprint, 'w1');
        assert.equal(merged.notes.lastExportAt, 1001);
        assert.deepEqual(merged.media.zipSnapshot, { fileA: 7 });
        // Unrelated fields survive untouched.
        assert.equal(merged.enabled, true);
        assert.equal(merged.notes.format, 'json');
    });

    it('a stale/expired claim does not block a new bid', () => {
        const now = 10_000;
        const expiredClaim = normalizeClaim({ token: 'dead', startedAt: now - CLAIM_TTL_MS - 1 });

        const shared = baseConfig({ runningClaim: expiredClaim });
        const fresh = createClaim(now);

        // Active check reflects the expiry...
        assert.equal(isClaimActive(shared.runningClaim, now, CLAIM_TTL_MS), false);
        // ...and the new bid can take over the slot even though it is "due".
        const next = { ...shared, nextDueAt: 1000, runningClaim: fresh };
        assert.equal(mayCommit(fresh, next), true);
    });
});

describe('backup claim — next-due scheduling is stop/pause safe', () => {
    it('re-arms nextDueAt only for a live, unpaused schedule', () => {
        const interval = 600_000; // 10 min

        const live = scheduleNextDue(baseConfig(), interval, 20_000);
        assert.equal(live.nextDueAt, 20_000 + interval);

        const paused = scheduleNextDue(baseConfig({ paused: true }), interval, 20_000);
        assert.equal(paused.paused, true);
        assert.equal(paused.nextDueAt, 1000); // original value untouched

        const stopped = scheduleNextDue(baseConfig({ enabled: false }), interval, 20_000);
        assert.equal(stopped.enabled, false);
        assert.equal(stopped.nextDueAt, 1000); // original value untouched
    });
});
});