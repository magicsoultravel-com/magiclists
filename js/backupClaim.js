/**
 * @module {"owns":"cross-tab scheduled-backup claim/lease coordination", "related":["scheduledBackup.js","backup.js","mediaBackup.js"]}
 *
 * Pure, DOM-free helpers that let a background scheduler with multiple
 * open tabs act as a SINGLE writer without coordinated clocks or CRDTs.
 *
 * Every tab shares one localStorage config (`matrix_scheduled_export`) and
 * each runs its own tick. Without coordination, all tabs can observe the same
 * due time and all fire an export — multiplying backups and, worse for the
 * media ZIP chain, double-advancing the incremental snapshot.
 *
 * The protocol is a short claim (lease) plus confirm-before-commit:
 *
 *   1. claimAndFire (the tab whose tick is due):
 *        - writes a claim { token, startedAt } and already advances nextDueAt,
 *          so no other tab sees "due" again for this interval;
 *        - waits a settle window so concurrent bids across tabs settle into a
 *          single survivor (last-write-wins);
 *        - re-reads the config and checks mayCommit() — if its token is no
 *          longer the stored claim it stands down WITHOUT exporting.
 *   2. finalizeClaim (the confirmed winner):
 *        - merges export results (fingerprints / timestamps / zip snapshot)
 *          onto a FRESH read of the config, so a Stop/Pause clicked in ANY
 *          tab during the export is never overwritten (no resurrection);
 *        - clears the claim, and only re-arms nextDueAt when the schedule is
 *          still enabled and not paused.
 *
 * A claim left by a crashed/closed tab expires via TTL (isClaimActive), after
 * which the next due tick claims normally again.
 */

export const CLAIM_TTL_MS = 5 * 60 * 1000;
export const CLAIM_SETTLE_MS = 1200;
/** Random extra wait (0..MAX) added to CLAIM_SETTLE_MS to stagger simultaneous bids. */
export const CLAIM_JITTER_MAX_MS = 1000;

/**
 * Coerce a stored raw value into a claim shape, or null when absent/garbage.
 * @param {*} raw
 * @returns {{ token: string, startedAt: number } | null}
 */
export function normalizeClaim(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const token = typeof raw.token === 'string' && raw.token ? raw.token : null;
    const startedAt = Number.isFinite(Number(raw.startedAt)) ? Number(raw.startedAt) : null;
    if (!token || !startedAt) return null;
    return { token, startedAt };
}

/**
 * True while a claim is fresh enough that its owner may still be exporting.
 * @param {{ token: string, startedAt: number } | null} claim
 * @param {number} [now]
 * @param {number} [ttl]
 */
export function isClaimActive(claim, now = Date.now(), ttl = CLAIM_TTL_MS) {
    if (!claim) return false;
    if (!Number.isFinite(claim.startedAt)) return false;
    return now - claim.startedAt < ttl;
}

/**
 * Mint a brand-new claim token for this tab/window.
 * @param {number} [now]
 */
export function createClaim(now = Date.now()) {
    const fallback = () => `bk_${now}_${Math.random().toString(36).slice(2, 9)}`;
    let token = fallback();
    try {
        token = crypto.randomUUID?.() || fallback();
    } catch {
        /* keep fallback */
    }
    return { token, startedAt: now };
}

/**
 * Did OUR bid survive the settle window? A tab must check this right before
 * starting its (side-effectful) export. Exactly one concurrent bid can pass.
 * @param {{ token: string }|null} claim  our own claim object
 * @param {object} latest                 fresh config re-read from storage
 * @param {string} [token]                optional explicit token (defaults to claim.token)
 */
export function mayCommit(claim, latest, token = null) {
    const stored = normalizeClaim(latest?.runningClaim);
    if (!stored) return false;
    const own = token || claim?.token;
    return !!own && stored.token === own;
}

/**
 * Merge export results onto the fresh config and clear the claim. Pure — the
 * caller persists the returned object. Returns null when the claim was lost
 * or already expired (nothing to merge — the caller should stand down).
 *
 * @param {string} claimToken
 * @param {object} latest            fresh config re-read from storage
 * @param {{ notes?: object, media?: object }} results
 * @returns {object|null}
 */
export function finalizeClaim(claimToken, latest, results = {}) {
    const stored = normalizeClaim(latest?.runningClaim);
    if (!claimToken || !stored || stored.token !== claimToken) return null;
    const merged = {
        ...latest,
        runningClaim: null
    };
    if (results?.notes && latest.notes) {
        merged.notes = { ...latest.notes, ...results.notes };
    }
    if (results?.media && latest.media) {
        merged.media = { ...latest.media, ...results.media };
    }
    return merged;
}

/**
 * Advance nextDueAt AFTER a successful export. Only re-arms when the schedule
 * is still enabled and not paused, so Stop/Pause clicked in another tab during
 * the export takes effect (no resurrection).
 *
 * @param {object} config   the merged/post-finalize config
 * @param {number} interval interval in ms
 * @param {number} [now]
 */
export function scheduleNextDue(config, interval, now = Date.now()) {
    if (!config || !config.enabled || config.paused) return config;
    return { ...config, nextDueAt: now + interval };
}