import {
    UNCATEGORIZED_CATEGORY,
    categoryKey,
    isUncategorizedCategory
} from './categories.js';

export function itemHasCategory(item) {
    const name = item?.categories?.[0];
    return typeof name === 'string' && name.trim() !== '';
}

export function getItemCategoryName(item) {
    return itemHasCategory(item) ? item.categories[0] : UNCATEGORIZED_CATEGORY;
}

export function isFocusActive(focusCategories) {
    return Array.isArray(focusCategories) && focusCategories.length > 0;
}

export function itemMatchesFocus(item, focusCategories) {
    if (!isFocusActive(focusCategories)) return true;
    const focusSet = new Set(focusCategories.map(categoryKey));
    return focusSet.has(categoryKey(getItemCategoryName(item)));
}

export function categoryMatchesFocus(catName, focusCategories) {
    if (!isFocusActive(focusCategories)) return true;
    return new Set(focusCategories.map(categoryKey)).has(categoryKey(catName));
}

export function applyFocusToItems(items, focusCategories) {
    if (!isFocusActive(focusCategories)) return items;
    return items.filter((item) => itemMatchesFocus(item, focusCategories));
}

export function applyFocusToCategories(categories, focusCategories) {
    if (!isFocusActive(focusCategories)) return categories;
    return categories.filter((cat) => {
        const name = typeof cat === 'string' ? cat : cat?.name;
        return name && categoryMatchesFocus(name, focusCategories);
    });
}

export function focusIncludesUncategorized(focusCategories) {
    if (!isFocusActive(focusCategories)) return true;
    return focusCategories.some((name) => isUncategorizedCategory(name));
}
