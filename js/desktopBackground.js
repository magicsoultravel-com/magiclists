import { ACTION_ICONS } from './ui.js';
import { PALETTE_DESKTOP, THEME_DEFAULT_COLOR } from './colorPicker.js';
import { createThemePicker } from './themePicker.js';

export const DesktopBackground = createThemePicker({
    storageKey: 'matrix_desktop_bg',
    defaultColor: THEME_DEFAULT_COLOR,
    presets: PALETTE_DESKTOP,
    cssVar: '--desktop-bg',
    buttonId: 'btn-desktop-bg',
    ariaLabel: 'Desktop background',
    iconHtml: ACTION_ICONS.desktopBg,
    onApply(value) {
        document.body.style.backgroundColor = value;
    }
});
