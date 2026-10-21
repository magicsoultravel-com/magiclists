// test/linksModel.test.js
// Pure model guards for the Links module: URL normalization/dedup semantics,
// display helpers, favicon/screenshot URLs, layered thumb markup and sorting.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    LINK_SCREENSHOT_SERVICE,
    LINK_TITLE_MAX,
    LINKS_SIDEBAR_LIMIT,
    buildLinkThumbHtml,
    buildLinkUrlKey,
    linkDisplayTitle,
    linkFaviconUrl,
    linkHostLabel,
    linkLetter,
    linkScreenshotUrl,
    linkUrlLabel,
    normalizeLinkRecord,
    normalizeLinkSort,
    normalizeLinkUrl,
    normalizeLinksPayload,
    sortLinks
} from '../js/linksModel.js';

describe('linksModel · URL normalization', () => {
    it('adds https:// to bare domains and keeps path/query case', () => {
        const result = normalizeLinkUrl('Example.com/Docs?Q=AbC');
        assert.equal(result.ok, true);
        assert.equal(result.url, 'https://example.com/Docs?Q=AbC');
        assert.equal(result.key, 'example.com/Docs?Q=AbC');
        assert.equal(result.host, 'example.com');
        assert.equal(result.origin, 'https://example.com');
    });

    it('lowercases only the host; path, query and trailing slash stay intact', () => {
        assert.equal(
            buildLinkUrlKey('https://EXAMPLE.com/Path/To?Token=AbC#section'),
            'example.com/Path/To?Token=AbC'
        );
        assert.equal(buildLinkUrlKey('https://example.com/A'), 'example.com/A');
        assert.equal(buildLinkUrlKey('https://example.com/A/'), 'example.com/A/');
        assert.notEqual(buildLinkUrlKey('https://example.com/A'), buildLinkUrlKey('https://example.com/A/'));
        assert.notEqual(buildLinkUrlKey('https://example.com/Path'), buildLinkUrlKey('https://example.com/path'));
        assert.notEqual(buildLinkUrlKey('https://example.com/?Q=1'), buildLinkUrlKey('https://example.com/?q=1'));
    });

    it('ignores protocol and fragment in the dedup key only', () => {
        assert.equal(
            buildLinkUrlKey('http://example.com/Page?q=1#one'),
            buildLinkUrlKey('https://example.com/Page?q=1#two')
        );
        assert.equal(
            normalizeLinkUrl('http://example.com/Page#one').url,
            'http://example.com/Page#one'
        );
    });

    it('keeps ports in the host key', () => {
        assert.equal(buildLinkUrlKey('localhost:3000/a'), 'localhost:3000/a');
        assert.notEqual(buildLinkUrlKey('localhost:3000/a'), buildLinkUrlKey('localhost:4000/a'));
    });

    it('rejects empty, malformed, non-http and credential URLs', () => {
        assert.equal(normalizeLinkUrl('').ok, false);
        assert.equal(normalizeLinkUrl('   ').ok, false);
        assert.equal(normalizeLinkUrl('ftp://example.com/file').ok, false);
        assert.equal(normalizeLinkUrl('javascript://alert(1)').ok, false);
        assert.equal(normalizeLinkUrl('https://user:pass@example.com/').ok, false);
        assert.equal(normalizeLinkUrl('http://').ok, false);
    });
});

describe('linksModel · record and payload normalization', () => {
    it('clamps titles and backfills timestamps/ids', () => {
        const record = normalizeLinkRecord({
            url: 'example.com',
            title: 'x'.repeat(LINK_TITLE_MAX + 20)
        }, { now: 1234 });
        assert.equal(record.url, 'https://example.com/');
        assert.equal(record.title.length, LINK_TITLE_MAX);
        assert.equal(record.createdAt, 1234);
        assert.equal(record.updatedAt, 1234);
        assert.match(record.id, /^link_/);
    });

    it('drops duplicate dedup keys and duplicate ids', () => {
        const payload = normalizeLinksPayload({
            version: 1,
            updatedAt: 50,
            links: [
                { id: 'link_a', url: 'https://Example.com/A', title: 'First' },
                { id: 'link_b', url: 'http://example.com/A#frag', title: 'Duplicate key' },
                { id: 'link_a', url: 'https://example.com/B', title: 'Duplicate id' },
                { id: 'link_c', url: 'not a url at all', title: 'Invalid' }
            ]
        });
        assert.equal(payload.version, 1);
        assert.equal(payload.updatedAt, 50);
        assert.deepEqual(payload.links.map((link) => link.url), [
            'https://example.com/A',
            'https://example.com/B'
        ]);
        assert.notEqual(payload.links[0].id, payload.links[1].id);
    });
});

describe('linksModel · display helpers', () => {
    const link = {
        id: 'link_1',
        url: 'https://www.Example.com/Docs?Q=1#top',
        title: '',
        createdAt: 10,
        updatedAt: 10
    };

    it('falls back to the hostname and derives a letter', () => {
        assert.equal(linkDisplayTitle(link), 'example.com');
        assert.equal(linkHostLabel(link), 'example.com');
        assert.equal(linkUrlLabel(link), 'www.example.com/Docs?Q=1#top');
        assert.equal(linkLetter(link), 'E');
        assert.equal(linkLetter({ title: '— 7 things' }), '7');
    });

    it('builds direct favicon and thum.io screenshot URLs', () => {
        assert.equal(linkFaviconUrl(link), 'https://www.example.com/favicon.ico');
        const shot = linkScreenshotUrl(link);
        assert.ok(shot.startsWith(`${LINK_SCREENSHOT_SERVICE}/get/width/640/crop/400/noanimate/`));
        assert.ok(shot.includes('https://www.example.com/Docs?Q=1'));
        assert.equal(shot.includes('#top'), false);
    });

    it('renders layered thumb markup only when screenshot opt-in is requested', () => {
        const plain = buildLinkThumbHtml(link);
        assert.ok(plain.includes('link-thumb__letter'));
        assert.ok(plain.includes('link-thumb__favicon'));
        assert.equal(plain.includes('link-thumb__screenshot'), false);
        assert.ok(plain.includes('referrerpolicy="no-referrer"'));

        const preview = buildLinkThumbHtml(link, { showScreenshot: true, modifier: 'detail' });
        assert.ok(preview.includes('link-thumb--detail'));
        assert.ok(preview.includes('link-thumb__screenshot'));
        assert.ok(preview.includes('image.thum.io'));
    });
});

describe('linksModel · sorting', () => {
    const links = [
        { id: 'b', url: 'https://b.example/', title: 'Beta', createdAt: 20 },
        { id: 'a', url: 'https://a.example/', title: 'alpha', createdAt: 10 }
    ];

    it('normalizes unknown sort modes to newest-first', () => {
        assert.equal(normalizeLinkSort('nope'), 'date-desc');
        assert.deepEqual(sortLinks(links).map((link) => link.id), ['b', 'a']);
    });

    it('sorts by name and date without mutating the input', () => {
        assert.deepEqual(sortLinks(links, 'name-asc').map((link) => link.id), ['a', 'b']);
        assert.deepEqual(sortLinks(links, 'name-desc').map((link) => link.id), ['b', 'a']);
        assert.deepEqual(sortLinks(links, 'date-asc').map((link) => link.id), ['a', 'b']);
        assert.equal(links[0].id, 'b');
    });

    it('keeps the documented sidebar cap', () => {
        assert.equal(LINKS_SIDEBAR_LIMIT, 60);
    });
});

