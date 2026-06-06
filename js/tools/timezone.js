/** @tool {"label":"Timezone","order":3} */
/** @tool-icon <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M6 3.6V6l2 1.2" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/> */
export const Timezone = {
    container: null,
    zones: [
        { label: "Local Workspace Time", id: "local" },
        { label: "Universal Baseline (UTC)", id: "UTC" },
        { label: "US Eastern Time (EST/EDT)", id: "America/New_York" },
        { label: "US Pacific Time (PST/PDT)", id: "America/Los_Angeles" },
        { label: "Japan Standard (JST)", id: "Asia/Tokyo" }
    ],

    init(mountElement) {
        this.container = mountElement;
        this.render();
    },

    render() {
        const now = new Date();
        const currentHours = now.getHours() + (now.getMinutes() / 60);

        this.container.innerHTML = `
            <h4 class="tool-heading">Matrix Timezone Converter</h4>
            <div class="tool-stack">
                <div id="tz-cards-stack" class="tz-cards-stack"></div>

                <div class="form-group panel-surface">
                    <label class="list-row">
                        <span>Adjust Local Matrix Clock</span>
                        <button type="button" id="tz-reset-btn" class="tz-reset-btn">[Reset to Now]</button>
                    </label>
                    <input type="range" id="tz-slider" class="tz-slider" min="0" max="24" step="0.25" value="${currentHours}">
                </div>
            </div>
        `;

        this.setupListeners();
        this.updateTimeMatrix(now);
    },

    setupListeners() {
        const slider = document.getElementById('tz-slider');
        const resetBtn = document.getElementById('tz-reset-btn');

        slider.addEventListener('input', (e) => {
            const targetHours = parseFloat(e.target.value);
            const targetDate = new Date();
            const hours = Math.floor(targetHours);
            const minutes = Math.round((targetHours - hours) * 60);
            targetDate.setHours(hours, minutes, 0, 0);
            this.updateTimeMatrix(targetDate);
        });

        resetBtn.addEventListener('click', () => {
            const now = new Date();
            const currentHours = now.getHours() + (now.getMinutes() / 60);
            slider.value = currentHours;
            this.updateTimeMatrix(now);
        });
    },

    updateTimeMatrix(baseDate) {
        const stack = document.getElementById('tz-cards-stack');
        if (!stack) return;

        stack.innerHTML = this.zones.map(zone => {
            let displayTime = "";
            let displayDate = "";

            try {
                if (zone.id === 'local') {
                    displayTime = baseDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                    displayDate = baseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                } else {
                    displayTime = baseDate.toLocaleTimeString('en-US', { timeZone: zone.id, hour: '2-digit', minute: '2-digit', hour12: false });
                    displayDate = baseDate.toLocaleDateString('en-US', { timeZone: zone.id, month: 'short', day: 'numeric' });
                }
            } catch (e) {
                displayTime = "Error parsing zone configuration";
            }

            const isLocal = zone.id === 'local';

            return `
                <div class="tz-card${isLocal ? ' tz-card--active' : ''}">
                    <div>
                        <div class="tz-card-label">${zone.label}</div>
                        <div class="tz-card-zone">${zone.id === 'local' ? 'System Host' : zone.id}</div>
                    </div>
                    <div>
                        <div class="tz-card-time">${displayTime}</div>
                        <div class="tz-card-date">${displayDate}</div>
                    </div>
                </div>
            `;
        }).join('');
    },

    destroy() {
        this.container = null;
    }
};
