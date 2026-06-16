import { stripRichText } from './richText.js';
import { sheetCellTexts, sheetIsActive } from './sheet.js';

const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'at', 'is']);
const MIN_TOKEN_LENGTH = 2;
const MIN_QUERY_MEANINGFUL_LENGTH = 3;

const CAP_TITLES = 8;
const CAP_CONTENT = 10;
const FUZZY_MIN_TERM_LENGTH = 5;
const FUZZY_MAX_DISTANCE = 1;
const FUZZY_SCORE_PENALTY = 100;

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(text) {
    return stripRichText(text || '').toLowerCase();
}

function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    let prev = new Array(n + 1);
    let curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                curr[j - 1] + 1,
                prev[j] + 1,
                prev[j - 1] + cost
            );
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

function findTermMatch(norm, term) {
    if (!norm || !term) return null;

    const exactIdx = norm.indexOf(term);
    if (exactIdx >= 0) {
        return { start: exactIdx, end: exactIdx + term.length, fuzzy: false, distance: 0 };
    }

    if (term.length < FUZZY_MIN_TERM_LENGTH) return null;

    let best = null;
    const minSize = Math.max(1, term.length - FUZZY_MAX_DISTANCE);
    const maxSize = term.length + FUZZY_MAX_DISTANCE;

    for (let size = minSize; size <= maxSize; size++) {
        if (size > norm.length) continue;
        for (let i = 0; i <= norm.length - size; i++) {
            const slice = norm.slice(i, i + size);
            const distance = levenshtein(slice, term);
            if (distance > FUZZY_MAX_DISTANCE) continue;

            const candidate = { start: i, end: i + size, fuzzy: true, distance };
            if (!best
                || candidate.distance < best.distance
                || (candidate.distance === best.distance && candidate.start < best.start)) {
                best = candidate;
            }
        }
    }

    return best;
}

function findTermMatchFrom(norm, term, fromIndex = 0) {
    const match = findTermMatch(norm.slice(fromIndex), term);
    if (!match) return null;
    return {
        ...match,
        start: match.start + fromIndex,
        end: match.end + fromIndex
    };
}

function meaningfulLength(parsed) {
    const phraseLen = parsed.phrases.reduce((sum, phrase) => sum + phrase.length, 0);
    const termLen = parsed.terms.reduce((sum, term) => sum + term.length, 0);
    return phraseLen + termLen;
}

export function parseSearchQuery(raw) {
    const input = String(raw || '').trim();
    const phrases = [];
    const terms = [];

    const quoteRegex = /"([^"]*)"/g;
    let match;
    while ((match = quoteRegex.exec(input)) !== null) {
        const phrase = match[1].trim().toLowerCase();
        if (phrase) phrases.push(phrase);
    }

    const remainder = input.replace(/"[^"]*"/g, ' ').trim();
    const tokens = remainder.split(/\s+/).filter(Boolean);

    for (const token of tokens) {
        const required = token.startsWith('+');
        const word = (required ? token.slice(1) : token).toLowerCase();
        if (!word) continue;
        if (!required && STOPWORDS.has(word)) continue;
        if (word.length < MIN_TOKEN_LENGTH) continue;
        terms.push(word);
    }

    return {
        phrases,
        terms,
        required: [...phrases, ...terms],
        raw: input
    };
}

export function isSearchActive(query) {
    const parsed = typeof query === 'string' ? parseSearchQuery(query) : query;
    if (!parsed?.required?.length) return false;
    return meaningfulLength(parsed) >= MIN_QUERY_MEANINGFUL_LENGTH;
}

export function itemMatchesQuery(text, parsed) {
    if (!parsed?.required?.length) return false;
    const norm = normalizeText(text);
    if (!norm) return false;

    for (const phrase of parsed.phrases) {
        if (!norm.includes(phrase)) return false;
    }
    for (const term of parsed.terms) {
        if (!findTermMatch(norm, term)) return false;
    }
    return true;
}

export function scoreTextMatch(text, parsed) {
    const norm = normalizeText(text);
    if (!norm || !itemMatchesQuery(text, parsed)) return -1;

    let score = 0;
    const positions = [];

    for (const phrase of parsed.phrases) {
        const idx = norm.indexOf(phrase);
        if (idx >= 0) {
            score += 5000;
            positions.push({ start: idx, end: idx + phrase.length });
        }
    }

    for (const term of parsed.terms) {
        const match = findTermMatch(norm, term);
        if (!match) continue;
        positions.push({ start: match.start, end: match.end });
        if (match.fuzzy) {
            score -= FUZZY_SCORE_PENALTY;
        } else {
            const wordRe = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i');
            if (wordRe.test(norm)) score += 50;
        }
    }

    if (positions.length) {
        const firstStart = Math.min(...positions.map((p) => p.start));
        const lastEnd = Math.max(...positions.map((p) => p.end));
        const span = lastEnd - firstStart;
        score += Math.max(0, 500 - span);
        score += Math.max(0, 100 - firstStart);
    }

    if (parsed.terms.length > 1) {
        let searchFrom = 0;
        let inOrder = true;
        for (const term of parsed.terms) {
            const match = findTermMatchFrom(norm, term, searchFrom);
            if (!match) {
                inOrder = false;
                break;
            }
            searchFrom = match.end;
        }
        if (inOrder) score += 30;
    }

    return score;
}

function itemTimestamp(item) {
    return Number(item?.updated_at || item?.created_at || 0);
}

function getItemCombinedText(item) {
    const parts = [
        stripRichText(item?.title || ''),
        stripRichText(item?.content || '')
    ];
    (item?.steps || []).forEach((step) => {
        parts.push(stripRichText(step?.text || ''));
    });
    if (sheetIsActive(item) && item?.sheet) {
        parts.push(...sheetCellTexts(item.sheet));
    }
    return parts.filter(Boolean).join(' ');
}

function sortByScoreThenAge(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return b.updatedAt - a.updatedAt;
}

function findMatchRange(norm, parsed) {
    for (const phrase of parsed.phrases) {
        const idx = norm.indexOf(phrase);
        if (idx >= 0) {
            return { start: idx, end: idx + phrase.length };
        }
    }
    for (const term of parsed.terms) {
        const match = findTermMatch(norm, term);
        if (match) {
            return { start: match.start, end: match.end };
        }
    }
    return null;
}

export function buildMatchSnippet(text, parsed, { before = 40, after = 60 } = {}) {
    const norm = normalizeText(text);
    if (!norm) return { snippetHtml: '', plainSnippet: '' };

    const range = findMatchRange(norm, parsed);
    if (!range) {
        const preview = norm.slice(0, before + after);
        return {
            snippetHtml: escapeHtml(preview) + (norm.length > preview.length ? '…' : ''),
            plainSnippet: preview
        };
    }

    const sliceStart = Math.max(0, range.start - before);
    const sliceEnd = Math.min(norm.length, range.end + after);
    const prefix = sliceStart > 0 ? '…' : '';
    const suffix = sliceEnd < norm.length ? '…' : '';

    const beforeText = norm.slice(sliceStart, range.start);
    const hitText = norm.slice(range.start, range.end);
    const afterText = norm.slice(range.end, sliceEnd);

    const snippetHtml = `${prefix}${escapeHtml(beforeText)}<mark class="search-hit">${escapeHtml(hitText)}</mark>${escapeHtml(afterText)}${suffix}`;
    return {
        snippetHtml,
        plainSnippet: norm.slice(sliceStart, sliceEnd)
    };
}

function plainTitle(item) {
    return stripRichText(item?.title || '') || 'Untitled';
}

export function querySearch(items, query) {
    const parsed = parseSearchQuery(query);
    if (!isSearchActive(parsed)) {
        return { titles: [], content: [], parsed };
    }

    const safeItems = Array.isArray(items) ? items : [];
    const titles = [];
    const content = [];

    for (const item of safeItems) {
        const titleText = stripRichText(item.title || '');
        const updatedAt = itemTimestamp(item);

        if (titleText && itemMatchesQuery(titleText, parsed)) {
            titles.push({
                item,
                score: scoreTextMatch(titleText, parsed),
                updatedAt,
                title: plainTitle(item),
                category: item.categories?.[0] || '',
                type: item.type || (item.steps?.length ? 'checklist' : 'note')
            });
        }

        const combined = getItemCombinedText(item);
        if (!itemMatchesQuery(combined, parsed)) continue;

        const bodyText = stripRichText(item.content || '');
        if (bodyText && itemMatchesQuery(bodyText, parsed)) {
            const snippet = buildMatchSnippet(bodyText, parsed);
            content.push({
                item,
                field: 'body',
                score: scoreTextMatch(bodyText, parsed),
                updatedAt,
                title: plainTitle(item),
                snippetHtml: snippet.snippetHtml,
                stepLabel: null
            });
        }

        (item.steps || []).forEach((step) => {
            const stepText = stripRichText(step?.text || '');
            if (!stepText || !itemMatchesQuery(stepText, parsed)) return;
            const snippet = buildMatchSnippet(stepText, parsed);
            content.push({
                item,
                field: 'step',
                stepId: step.id,
                score: scoreTextMatch(stepText, parsed),
                updatedAt,
                title: plainTitle(item),
                snippetHtml: snippet.snippetHtml,
                stepLabel: 'Step'
            });
        });
    }

    titles.sort(sortByScoreThenAge);
    content.sort(sortByScoreThenAge);

    return {
        titles: titles.slice(0, CAP_TITLES),
        content: content.slice(0, CAP_CONTENT),
        parsed
    };
}
