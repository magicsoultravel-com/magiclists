/** @module {"owns":"the cached workspace state the Application sessions share - user, items, categories, hidden categories, workspace mode and view settings; the one mutable store behind every session","related":["../app.js","listeners.js","services.js","drawingMode.js"],"state":"AppState"} */
import { DEFAULT_CATEGORIES } from '../categories.js';
import { normalizeViewMode } from '../viewSession.js';

export const AppState = {
    user: { isLoggedIn: false, token: null },
    items: [],
    categories: [...DEFAULT_CATEGORIES],
    hiddenCategories: JSON.parse(localStorage.getItem('matrix_hidden_categories') || '[]'),
    workspaceMode: (() => {
        const mode = localStorage.getItem('matrix_workspace_mode');
        return mode === 'drawing' ? 'drawing' : 'notes';
    })(),
    viewSettings: {
        sortBy: normalizeViewMode(
            localStorage.getItem('matrix_desktop_layout')
                || localStorage.getItem('matrix_preferred_view')
                || 'grid'
        ),
        fileCabinet: localStorage.getItem('matrix_file_cabinet') === 'true',
        currentView: 'active'
    }
};
