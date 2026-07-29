import { PALETTE_CHROME, THEME_DEFAULT_COLOR } from './colorPicker.js';
import { createThemePicker } from './themePicker.js';
import { readUserTheme, writeUserTheme, applyUserTheme, DEFAULT_TOKENS } from './appTheme.js';

export const ChromeBackground = createThemePicker({
    storageKey: 'matrix_custom_theme_tokens',
    tokenKey: '--chrome-bg',
    defaultColor: THEME_DEFAULT_COLOR,
    presets: PALETTE_CHROME,
    cssVar: '--chrome-bg',
    ariaLabel: 'Panel and header background',
    onApply(value) {
        // Update user theme
        const userTheme = readUserTheme();
        userTheme['--chrome-bg'] = value;
        writeUserTheme(userTheme);
    }
});