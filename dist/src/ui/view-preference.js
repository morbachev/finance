/** Last opened Finance menu, tab-scoped. No account or financial data is stored. */
export const VIEW_STORAGE_KEY = 'finance.ui.last-view.v1';
export const FINANCE_VIEWS = ['import', 'manage', 'summary', 'rules', 'assets', 'future', 'settings'];
export function readLastView(storage) {
    try {
        const stored = storage?.getItem(VIEW_STORAGE_KEY);
        return FINANCE_VIEWS.find(view => view === stored) ?? null;
    }
    catch {
        return null; // Private mode, disabled storage or browser restrictions.
    }
}
export function saveLastView(storage, view) {
    try {
        storage?.setItem(VIEW_STORAGE_KEY, view);
    }
    catch {
        // Navigation remains functional when session storage is unavailable.
    }
}
