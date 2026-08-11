// Unit tests for js/storage/indexedDbStore.js getAll() memory-fallback path.
// Run with: npm test  (node --test test/)
//
// Node has no IndexedDB, so openDb() resolves to null and the store transparently
// uses its in-memory Map. getAll() (added for the js/sidebarStats.js IndexedDB
// sizing read) must round-trip through that fallback and return { key, value }
// records matching the real store shape.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IndexedDBStore } from '../js/storage/indexedDbStore.js';

describe('IndexedDBStore.getAll (memory fallback)', () => {
    beforeEach(async () => {
        await IndexedDBStore.clear();
    });

    it('returns an empty array when nothing is stored', async () => {
        assert.deepEqual(await IndexedDBStore.getAll(), []);
    });

    it('returns key/value records for every stored entry', async () => {
        await IndexedDBStore.set('a', 'hello');
        await IndexedDBStore.set('b', { n: 42 });
        const all = await IndexedDBStore.getAll();
        assert.equal(all.length, 2);
        const byKey = Object.fromEntries(all.map(r => [r.key, r.value]));
        assert.equal(byKey['a'], 'hello');
        assert.deepEqual(byKey['b'], { n: 42 });
    });

    it('reflects removals and clears', async () => {
        await IndexedDBStore.set('a', 1);
        await IndexedDBStore.set('b', 2);
        await IndexedDBStore.remove('a');
        assert.deepEqual(await IndexedDBStore.getAll(), [{ key: 'b', value: 2 }]);
        await IndexedDBStore.clear();
        assert.deepEqual(await IndexedDBStore.getAll(), []);
    });
});