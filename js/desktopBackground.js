import { PALETTE_DESKTOP, THEME_DEFAULT_COLOR } from './colorPicker.js';
import { createThemePicker } from './themePicker.js';

export const DesktopBackground = createThemePicker({
    storageKey: 'matrix_desktop_bg',
    defaultColor: THEME_DEFAULT_COLOR,
    presets: PALETTE_DESKTOP,
    cssVar: '--desktop-bg',
    ariaLabel: 'Desktop background',
    onApply(value) {
        document.body.style.backgroundColor = value;
    }
});
