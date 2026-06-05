/** @tool {"label":"Calendar","order":0,"icon":"calendar"} */
import { Calendar } from '../calendar.js';
import { ToolsManager } from '../toolsManager.js';

export const CalendarTool = {
    init(mountElement) {
        const items = ToolsManager.getItems?.() || [];
        Calendar.open(items, {
            mount: mountElement,
            inline: true,
            onClose: () => ToolsManager.close()
        });
    },

    destroy() {
        Calendar.onInlineClose = null;
        if (Calendar.mountZone) Calendar.mountZone.innerHTML = '';
        Calendar.inlineMode = false;
    }
};
