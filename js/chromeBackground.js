import { PALETTE_CHROME, THEME_DEFAULT_COLOR } from './colorPicker.js';
import { createThemePicker } from './themePicker.js';

export const ChromeBackground = createThemePicker({
    storageKey: 'matrix_chrome_bg',
    defaultColor: THEME_DEFAULT_COLOR,
    presets: PALETTE_CHROME,
    cssVar: '--chrome-bg',
    ariaLabel: 'Panel and header background'
});
