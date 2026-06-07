export const DEFAULT_CATEGORIES = [
    { name: "Lifestyle", color: "#64748b" },
    { name: "Work", color: "#3b82f6" },
    { name: "Personal", color: "#10b981" },
    { name: "Hobby", color: "#f59e0b" },
    { name: "Travel", color: "#ec4899" }
];

export function normalizeCategories(categories, { keepEmpty = false } = {}) {
    const mapped = (Array.isArray(categories) ? categories : [])
        .map(cat => typeof cat === 'string' ? { name: cat, color: '#64748b' } : cat)
        .filter(cat => cat?.name);

    if (mapped.length === 0) return keepEmpty ? [] : [...DEFAULT_CATEGORIES];
    return mapped;
}

export function readStoredCategories({ keepEmpty = false } = {}) {
    try {
        return normalizeCategories(JSON.parse(localStorage.getItem('matrix_custom_categories') || '[]'), { keepEmpty });
    } catch {
        return keepEmpty ? [] : [...DEFAULT_CATEGORIES];
    }
}

export function categoryKey(name) {
    return String(name || '').trim().toLowerCase();
}
