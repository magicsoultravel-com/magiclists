import { PALETTE_DESKTOP, THEME_DEFAULT_COLOR } from './colorPicker.js';
import { createThemePicker } from './themePicker.js';
import { readUserTheme, writeUserTheme } from './appTheme.js';

export const DesktopBackground = createThemePicker({
    storageKey: 'matrix_custom_theme_tokens',
    tokenKey: '--desktop-bg',
    defaultColor: THEME_DEFAULT_COLOR,
    presets: PALETTE_DESKTOP,
    cssVar: '--desktop-bg',
    ariaLabel: 'Desktop background',
    onApply(value) {
        // Update user theme
        const userTheme = readUserTheme();
        userTheme['--desktop-bg'] = value;
        writeUserTheme(userTheme);
        document.body.style.backgroundColor = value;
    }
});