import { UNCATEGORIZED_CATEGORY } from './categories.js';

export function itemHasCategory(item) {
    const name = item?.categories?.[0];
    return typeof name === 'string' && name.trim() !== '';
}

export function getItemCategoryName(item) {
    return itemHasCategory(item) ? item.categories[0] : UNCATEGORIZED_CATEGORY;
}
