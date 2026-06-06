/** @tool {"label":"Calculator","order":1} */
/** @tool-icon <rect x="2" y="1.8" width="8" height="8.4" rx="0.8" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M4 4.2h4M4 6h1.6M6.4 6H8M4 7.8h4" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/> */
export const Calculator = {
    container: null,

    init(mountElement) {
        this.container = mountElement;
        this.render();
    },

    render() {
        this.container.innerHTML = `
            <h4 class="tool-heading">Workspace Calculator</h4>
            <div class="tool-stack">
                <input type="text" id="calc-display" class="calc-display" readonly>
                <div class="tool-grid-4">
                    <button class="btn btn--danger calc-btn" data-val="C">C</button>
                    <button class="btn calc-btn" data-val="(">(</button>
                    <button class="btn calc-btn" data-val=")">)</button>
                    <button class="btn btn--operator calc-btn" data-val="/">/</button>
                    <button class="btn calc-btn" data-val="7">7</button>
                    <button class="btn calc-btn" data-val="8">8</button>
                    <button class="btn calc-btn" data-val="9">9</button>
                    <button class="btn btn--operator calc-btn" data-val="*">*</button>
                    <button class="btn calc-btn" data-val="4">4</button>
                    <button class="btn calc-btn" data-val="5">5</button>
                    <button class="btn calc-btn" data-val="6">6</button>
                    <button class="btn btn--operator calc-btn" data-val="-">-</button>
                    <button class="btn calc-btn" data-val="1">1</button>
                    <button class="btn calc-btn" data-val="2">2</button>
                    <button class="btn calc-btn" data-val="3">3</button>
                    <button class="btn btn--operator calc-btn" data-val="+">+</button>
                    <button class="btn calc-btn calc-btn--wide" data-val="0">0</button>
                    <button class="btn calc-btn" data-val=".">.</button>
                    <button class="btn btn--accent calc-btn" data-val="=">=</button>
                </div>
            </div>
        `;

        this.container.querySelectorAll('.calc-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleInput(e.target.getAttribute('data-val')));
        });
    },

    handleInput(val) {
        const display = document.getElementById('calc-display');
        if (!display) return;

        if (val === 'C') {
            display.value = '';
        } else if (val === '=') {
            try {
                if (display.value.trim() !== '') {
                    display.value = Function(`"use strict"; return (${display.value})`)();
                }
            } catch (err) {
                display.value = 'Error';
            }
        } else {
            if (display.value === 'Error') display.value = '';
            display.value += val;
        }
    },

    destroy() {
        this.container = null;
    }
};
