import { stripRichText } from './richText.js';
import { UNCATEGORIZED_CATEGORY } from './categories.js';

const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'at', 'is']);
const MIN_TOKEN_LENGTH = 2;
const MIN_QUERY_MEANINGFUL_LENGTH = 3;

const CAP_TITLES = 8;
const CAP_CONTENT = 10;
const CAP_CATEGORIES = 5;

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
        if (!norm.includes(term)) return false;
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
        const idx = norm.indexOf(term);
        if (idx >= 0) {
            positions.push({ start: idx, end: idx + term.length });
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
        let lastIdx = -1;
        let inOrder = true;
        for (const term of parsed.terms) {
            const idx = norm.indexOf(term, lastIdx + 1);
            if (idx < 0) {
                inOrder = false;
                break;
            }
            lastIdx = idx;
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
        const idx = norm.indexOf(term);
        if (idx >= 0) {
            return { start: idx, end: idx + term.length };
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

export function querySearch(items, categories, query) {
    const parsed = parseSearchQuery(query);
    if (!isSearchActive(parsed)) {
        return { titles: [], content: [], categories: [], parsed };
    }

    const safeItems = Array.isArray(items) ? items : [];
    const safeCategories = Array.isArray(categories) ? categories : [];
    const titles = [];
    const content = [];
    const categoryHits = [];

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

    const hasUncategorized = safeItems.some((item) => {
        const name = item?.categories?.[0];
        return typeof name !== 'string' || !name.trim();
    });

    for (const cat of safeCategories) {
        const name = typeof cat === 'string' ? cat : cat?.name;
        if (!name) continue;
        if (!itemMatchesQuery(name, parsed)) continue;
        categoryHits.push({
            name,
            color: cat?.color || '#64748b',
            score: scoreTextMatch(name, parsed),
            updatedAt: 0
        });
    }

    if (hasUncategorized && itemMatchesQuery(UNCATEGORIZED_CATEGORY, parsed)) {
        categoryHits.push({
            name: UNCATEGORIZED_CATEGORY,
            color: '#64748b',
            score: scoreTextMatch(UNCATEGORIZED_CATEGORY, parsed),
            updatedAt: 0
        });
    }

    categoryHits.sort(sortByScoreThenAge);

    return {
        titles: titles.slice(0, CAP_TITLES),
        content: content.slice(0, CAP_CONTENT),
        categories: categoryHits.slice(0, CAP_CATEGORIES),
        parsed
    };
}
