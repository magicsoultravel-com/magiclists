export const DEFAULT_CATEGORIES = [
    { name: "Lifestyle", color: "#64748b" },
    { name: "Work", color: "#3b82f6" },
    { name: "Personal", color: "#10b981" },
    { name: "Hobby", color: "#f59e0b" },
    { name: "Travel", color: "#ec4899" }
];

export const UNCATEGORIZED_CATEGORY = 'Uncategorized';
export const UNCATEGORIZED_COLOR = '#64748b';
export const UNCATEGORIZED_CATEGORY_ID = 'cat_uncategorized';

export function createCategoryId() {
    return `cat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function assignCategoryId(cat) {
    if (!cat || typeof cat !== 'object') return cat;
    if (isUncategorizedCategory(cat.name)) {
        return { ...cat, id: UNCATEGORIZED_CATEGORY_ID, color: cat.color || UNCATEGORIZED_COLOR };
    }
    if (typeof cat.id === 'string' && cat.id.trim()) return cat;
    return { ...cat, id: createCategoryId() };
}

export function normalizeCategories(categories, { keepEmpty = false } = {}) {
    const mapped = (Array.isArray(categories) ? categories : [])
        .map((cat) => {
            if (typeof cat === 'string') {
                return assignCategoryId({ name: cat, color: '#64748b' });
            }
            if (!cat?.name) return null;
            return assignCategoryId({
                ...cat,
                name: String(cat.name),
                color: cat.color || '#64748b'
            });
        })
        .filter(Boolean);

    if (mapped.length === 0) {
        if (keepEmpty) return [];
        return DEFAULT_CATEGORIES.map((cat) => assignCategoryId({ ...cat }));
    }
    // Keep first-wins order; callers that persist should run dedupeCategories
    // so aliases can be applied to notes / layout keys.
    return mapped;
}

/**
 * Collapse registry rows that share a categoryKey (trim + lowercase).
 * Keeps the first row's display name, color, and id. Never drops notes —
 * callers remap item.categories via aliases.
 * @returns {{ categories: Array, aliases: Record<string, string> }}
 */
export function dedupeCategories(list) {
    const aliases = {};
    const categories = [];
    const seen = new Map();

    (Array.isArray(list) ? list : []).forEach((cat) => {
        const rawName = typeof cat === 'string' ? cat : cat?.name;
        if (!rawName && rawName !== 0) return;
        const raw = String(rawName);
        let name = raw.trim() || raw;
        let color = typeof cat === 'string' ? '#64748b' : (cat?.color || '#64748b');
        let id = typeof cat === 'object' && cat ? cat.id : undefined;

        if (isUncategorizedCategory(name)) {
            name = UNCATEGORIZED_CATEGORY;
            id = UNCATEGORIZED_CATEGORY_ID;
            color = color || UNCATEGORIZED_COLOR;
        }

        const key = categoryKey(name);
        if (!key) return;

        if (seen.has(key)) {
            const kept = seen.get(key);
            if (raw !== kept) aliases[raw] = kept;
            if (name !== kept && name !== raw) aliases[name] = kept;
            return;
        }

        seen.set(key, name);
        if (typeof cat === 'string') {
            categories.push(assignCategoryId({ name, color }));
        } else {
            categories.push(assignCategoryId({
                ...cat,
                name,
                color,
                ...(id ? { id } : {})
            }));
        }
    });

    return { categories, aliases };
}

/**
 * Remap item.categories[] in place using aliases (exact or categoryKey).
 * Skips names that already match the kept display name. Never deletes items.
 * @returns {number} count of items that changed
 */
export function applyCategoryAliasesToItems(items, aliases) {
    if (!Array.isArray(items) || !aliases || !Object.keys(aliases).length) return 0;
    const byKey = new Map();
    Object.entries(aliases).forEach(([from, to]) => {
        byKey.set(categoryKey(from), to);
    });

    let changedItems = 0;
    items.forEach((item) => {
        if (!item?.categories?.length) return;
        let changed = false;
        const mapped = item.categories.map((cat) => {
            const kept = byKey.get(categoryKey(cat));
            if (kept != null && cat !== kept) {
                changed = true;
                return kept;
            }
            return cat;
        });
        if (!changed) return;

        const next = [];
        const seen = new Set();
        mapped.forEach((cat) => {
            const key = categoryKey(cat);
            if (seen.has(key)) return;
            seen.add(key);
            next.push(cat);
        });
        item.categories = next;
        changedItems += 1;
    });
    return changedItems;
}

function applyCategoryAliasesToLayoutStores(aliases) {
    if (!aliases || !Object.keys(aliases).length) return;
    Object.entries(aliases).forEach(([from, to]) => {
        if (!from || !to || from === to) return;
        renameLocalStorageObjectKey('matrix_file_cabinet_order', from, to);
        renameLocalStorageStringArray('matrix_file_cabinet_filed_categories', from, to);
        renameLocalStorageStringArray('matrix_file_cabinet_category_order', from, to);
        renameLocalStorageStringArray('matrix_collapsed_categories', from, to);
        renameLocalStorageStringArray('matrix_hidden_categories', from, to);
        renameLocalStorageObjectKey('matrix_column_note_layout', from, to);
    });
    // Collapse duplicate entries left after multi-alias merges
    uniqueLocalStorageStringArray('matrix_file_cabinet_filed_categories');
    uniqueLocalStorageStringArray('matrix_file_cabinet_category_order');
    uniqueLocalStorageStringArray('matrix_collapsed_categories');
    uniqueLocalStorageStringArray('matrix_hidden_categories');
}

function uniqueLocalStorageStringArray(storageKey) {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        const next = [];
        const seen = new Set();
        parsed.forEach((entry) => {
            const key = categoryKey(entry);
            if (!key || seen.has(key)) return;
            seen.add(key);
            next.push(entry);
        });
        localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
        /* ignore */
    }
}

function applyCategoryAliasesToPersistedDatabase(aliases, categoryNames) {
    if (!aliases || !Object.keys(aliases).length) return;
    try {
        const raw = localStorage.getItem('matrix_database');
        if (!raw) return;
        const db = JSON.parse(raw);
        if (!db || !Array.isArray(db.items)) return;
        const changed = applyCategoryAliasesToItems(db.items, aliases);
        if (Array.isArray(categoryNames)) {
            db.settings = { ...(db.settings || {}), categories: categoryNames };
        }
        if (!changed && !Array.isArray(categoryNames)) return;
        localStorage.setItem('matrix_database', JSON.stringify(db));
    } catch {
        /* ignore */
    }
}

let _lastWriteAliases = {};

export function getLastCategoryWriteAliases() {
    return { ..._lastWriteAliases };
}

export function isUncategorizedCategory(name) {
    return categoryKey(name) === categoryKey(UNCATEGORIZED_CATEGORY);
}

export function ensureUncategorizedCategory(categories) {
    const normalized = normalizeCategories(categories, { keepEmpty: true });
    if (normalized.some((cat) => isUncategorizedCategory(cat.name))) return normalized;
    return [
        ...normalized,
        assignCategoryId({ name: UNCATEGORIZED_CATEGORY, color: UNCATEGORIZED_COLOR })
    ];
}

export function syncDbCategoryNames(categories) {
    const names = ensureUncategorizedCategory(categories).map((cat) => cat.name);
    try {
        const raw = localStorage.getItem('matrix_database');
        if (!raw) return;
        const db = JSON.parse(raw);
        db.settings = { ...(db.settings || {}), categories: names };
        localStorage.setItem('matrix_database', JSON.stringify(db));
    } catch {
        /* ignore */
    }
}

export function writeStoredCategories(categories, { keepEmpty = false } = {}) {
    const normalized = ensureUncategorizedCategory(normalizeCategories(categories, { keepEmpty: true }));
    const { categories: deduped, aliases } = dedupeCategories(normalized);
    localStorage.setItem('matrix_custom_categories', JSON.stringify(deduped));
    syncDbCategoryNames(deduped);
    if (Object.keys(aliases).length) {
        applyCategoryAliasesToLayoutStores(aliases);
        applyCategoryAliasesToPersistedDatabase(aliases, deduped.map((cat) => cat.name));
    }
    _lastWriteAliases = aliases;
    return deduped;
}

export function readStoredCategories({ keepEmpty = false } = {}) {
    try {
        const normalized = ensureUncategorizedCategory(
            normalizeCategories(JSON.parse(localStorage.getItem('matrix_custom_categories') || '[]'), { keepEmpty })
        );
        const { categories, aliases } = dedupeCategories(normalized);
        if (Object.keys(aliases).length) {
            return writeStoredCategories(normalized, { keepEmpty: true });
        }
        return categories;
    } catch {
        return ensureUncategorizedCategory(keepEmpty ? [] : [...DEFAULT_CATEGORIES]);
    }
}

export function categoryKey(name) {
    return String(name || '').trim().toLowerCase();
}

/**
 * Detect categories whose names collide after normalization (case/trim).
 * Diagnostics helper — prefer dedupeCategories() to merge.
 *
 * @param {Array} categories - category objects or name strings
 * @returns {Array<{ name: string, occurrences: number }>}
 */
export function detectDuplicateCategories(categories = []) {
    const counts = new Map();
    const firstByKey = new Map();
    (Array.isArray(categories) ? categories : []).forEach((cat) => {
        const name = typeof cat === 'string' ? cat : cat?.name;
        if (!name) return;
        const key = categoryKey(name);
        counts.set(key, (counts.get(key) || 0) + 1);
        if (!firstByKey.has(key)) firstByKey.set(key, name);
    });
    const duplicates = [];
    counts.forEach((occurrences, key) => {
        if (occurrences > 1) {
            duplicates.push({ name: firstByKey.get(key), occurrences });
        }
    });
    return duplicates;
}

export function resolveCategoryColor(name, categories, { fallback = UNCATEGORIZED_COLOR } = {}) {
    const key = categoryKey(name);
    if (!key) return fallback;
    const matched = (categories || []).find((cat) => {
        const catName = typeof cat === 'string' ? cat : cat?.name;
        return catName && categoryKey(catName) === key;
    });
    if (!matched) return fallback;
    if (typeof matched === 'string') return fallback;
    return matched.color || fallback;
}

export function getCardRenderContext(item, activeCategories) {
    const targetCatName = item?.categories?.[0] || '';
    const categoryColor = resolveCategoryColor(targetCatName, activeCategories);
    return { targetCatName, categoryColor };
}

function renameStringListKey(list, oldName, newName) {
    if (!Array.isArray(list)) return list;
    return list.map((entry) => (entry === oldName ? newName : entry));
}

function renameLocalStorageObjectKey(storageKey, oldName, newName) {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
        if (!(oldName in parsed)) return;
        if (!(newName in parsed)) {
            parsed[newName] = parsed[oldName];
        } else if (Array.isArray(parsed[oldName]) && Array.isArray(parsed[newName])) {
            const merged = [...parsed[newName]];
            parsed[oldName].forEach((id) => {
                if (!merged.includes(id)) merged.push(id);
            });
            parsed[newName] = merged;
        }
        delete parsed[oldName];
        localStorage.setItem(storageKey, JSON.stringify(parsed));
    } catch {
        /* ignore */
    }
}

function renameLocalStorageStringArray(storageKey, oldName, newName) {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        const next = renameStringListKey(parsed, oldName, newName);
        localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
        /* ignore */
    }
}

/**
 * Rename a category across the registry and name-keyed layout stores.
 * Does not patch note items — callers should handle AppState.items.
 * @returns {{ ok: true, oldName: string, newName: string } | { ok: false, error: string }}
 */
export function renameCategory(oldName, newName) {
    const from = String(oldName || '').trim();
    const to = String(newName || '').trim();
    if (!from || !to) return { ok: false, error: 'Name is required.' };
    if (from === to) return { ok: true, oldName: from, newName: to, unchanged: true };
    if (isUncategorizedCategory(from) || isUncategorizedCategory(to)) {
        return { ok: false, error: 'Uncategorized is reserved.' };
    }

    const categories = readStoredCategories({ keepEmpty: true });
    const fromKey = categoryKey(from);
    const toKey = categoryKey(to);
    const source = categories.find((cat) => categoryKey(cat.name) === fromKey);
    if (!source) return { ok: false, error: 'Category not found.' };
    if (categories.some((cat) => categoryKey(cat.name) === toKey && categoryKey(cat.name) !== fromKey)) {
        return { ok: false, error: 'That category name already exists.' };
    }

    const next = categories.map((cat) => (
        categoryKey(cat.name) === fromKey
            ? { ...cat, name: to }
            : cat
    ));
    writeStoredCategories(next, { keepEmpty: true });

    renameLocalStorageObjectKey('matrix_file_cabinet_order', from, to);
    renameLocalStorageStringArray('matrix_file_cabinet_filed_categories', from, to);
    renameLocalStorageStringArray('matrix_file_cabinet_category_order', from, to);
    renameLocalStorageStringArray('matrix_collapsed_categories', from, to);
    renameLocalStorageStringArray('matrix_hidden_categories', from, to);
    renameLocalStorageObjectKey('matrix_column_note_layout', from, to);

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('category:renamed', {
            detail: { oldName: from, newName: to }
        }));
    }

    return { ok: true, oldName: from, newName: to };
}
