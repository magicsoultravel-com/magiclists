import { applyAppTheme, AppTheme } from './appTheme.js';
import { DisplayOptions } from './displayOptions.js';
import { DesktopBackground } from './desktopBackground.js';
import { ChromeBackground } from './chromeBackground.js';
import { ClockStyle } from './clockStyle.js';
import { DesktopZoom } from './desktopZoom.js';
import { NoteFontScale } from './noteFontScale.js';

const CUSTOMIZATION_KEYS = [
    'matrix_app_theme',
    'matrix_desktop_bg',
    'matrix_chrome_bg',
    'matrix_clock_style',
    'matrix_clock_hidden',
    'matrix_editor_zoom',
    'matrix_note_font',
    'matrix_note_font_scale',
    'matrix_display_options'
];

const DISPLAY_DEFAULTS = {
    showCategoryName: true,
    showCreatedDate: true,
    desktopGradient: false,
    cardAnimations: true,
    noteFontId: 'default'
};

export function resetCustomizationToDefaults() {
    if (!window.confirm('Reset all appearance settings to defaults? Your notes, layouts, and saved views are not affected.')) {
        return false;
    }

    CUSTOMIZATION_KEYS.forEach((key) => {
        try {
            localStorage.removeItem(key);
        } catch {
            /* ignore */
        }
    });

    applyAppTheme('dark');
    AppTheme.currentId = 'dark';
    AppTheme.syncButtonState();

    DesktopBackground.applyStored();
    ChromeBackground.applyStored();

    DisplayOptions.setOptions({ ...DISPLAY_DEFAULTS });

    ClockStyle.applyStyle('digital', { silent: true });
    ClockStyle.applyHidden(false, { silent: true });

    DesktopZoom.setScale(1);
    NoteFontScale.setScale(1);

    window.dispatchEvent(new CustomEvent('customization:reset'));
    return true;
}
