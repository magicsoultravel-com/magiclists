export const DEFAULT_CATEGORIES = [
    { name: "Lifestyle", color: "#64748b" },
    { name: "Work", color: "#3b82f6" },
    { name: "Personal", color: "#10b981" },
    { name: "Hobby", color: "#f59e0b" },
    { name: "Travel", color: "#ec4899" }
];

export const UNCATEGORIZED_CATEGORY = 'Uncategorized';
export const UNCATEGORIZED_COLOR = '#64748b';

export function normalizeCategories(categories, { keepEmpty = false } = {}) {
    const mapped = (Array.isArray(categories) ? categories : [])
        .map(cat => typeof cat === 'string' ? { name: cat, color: '#64748b' } : cat)
        .filter(cat => cat?.name);

    if (mapped.length === 0) return keepEmpty ? [] : [...DEFAULT_CATEGORIES];
    return mapped;
}

export function isUncategorizedCategory(name) {
    return categoryKey(name) === categoryKey(UNCATEGORIZED_CATEGORY);
}

export function ensureUncategorizedCategory(categories) {
    const normalized = normalizeCategories(categories, { keepEmpty: true });
    if (normalized.some((cat) => isUncategorizedCategory(cat.name))) return normalized;
    return [...normalized, { name: UNCATEGORIZED_CATEGORY, color: UNCATEGORIZED_COLOR }];
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
    localStorage.setItem('matrix_custom_categories', JSON.stringify(normalized));
    syncDbCategoryNames(normalized);
    return normalized;
}

export function readStoredCategories({ keepEmpty = false } = {}) {
    try {
        return ensureUncategorizedCategory(
            normalizeCategories(JSON.parse(localStorage.getItem('matrix_custom_categories') || '[]'), { keepEmpty })
        );
    } catch {
        return ensureUncategorizedCategory(keepEmpty ? [] : [...DEFAULT_CATEGORIES]);
    }
}

export function categoryKey(name) {
    return String(name || '').trim().toLowerCase();
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
