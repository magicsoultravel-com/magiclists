/** @tool {"label":"Calendar","order":0,"wide":true,"resizable":true,"resizeMode":"fill","mountClass":"tool-mount--calendar","defaultSize":{"w":720,"h":560},"minSize":{"w":480,"h":400}} */
/** @tool-icon <rect x="1.5" y="2.5" width="9" height="8" rx="0.8" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M1.5 5.2h9M4 1.5v1.6M8 1.5v1.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/> */
import { Calendar } from '../calendar.js';
import { ToolsManager } from '../toolsManager.js';

export const CalendarTool = {
    init(mountElement) {
        const items = ToolsManager.getItems?.() || [];
        Calendar.open(items, {
            mount: mountElement,
            inline: true,
            onClose: () => ToolsManager.dismiss('calendar')
        });
    },

    destroy() {
        Calendar.onInlineClose = null;
        if (Calendar.mountZone) Calendar.mountZone.innerHTML = '';
        Calendar.inlineMode = false;
    }
};
