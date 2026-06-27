/** @tool {"label":"Unit Converter","order":2,"resizable":true,"mountClass":"tool-mount--converter","defaultSize":{"w":340,"h":320}} */
/** @tool-icon <path d="M3.2 4.2h5.2M7.6 3.4 8.8 4.2 7.6 5" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.8 7.8H3.6M4.4 7 3.2 7.8 4.4 8.6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/> */
export const Converter = {
    container: null,
    conversionData: {
        length: {
            label: "Length",
            units: ["Meters", "Kilometers", "Miles", "Feet"],
            convert: (val, from, to) => {
                let meters = val;
                if (from === "Kilometers") meters = val * 1000;
                if (from === "Miles") meters = val * 1609.34;
                if (from === "Feet") meters = val * 0.3048;

                if (to === "Meters") return meters;
                if (to === "Kilometers") return meters / 1000;
                if (to === "Miles") return meters / 1609.34;
                if (to === "Feet") return meters / 0.3048;
                return val;
            }
        },
        weight: {
            label: "Weight",
            units: ["Kilograms", "Grams", "Pounds", "Ounces"],
            convert: (val, from, to) => {
                let kg = val;
                if (from === "Grams") kg = val / 1000;
                if (from === "Pounds") kg = val * 0.453592;
                if (from === "Ounces") kg = val * 0.0283495;

                if (to === "Kilograms") return kg;
                if (to === "Grams") return kg * 1000;
                if (to === "Pounds") return kg / 0.453592;
                if (to === "Ounces") return kg / 0.0283495;
                return val;
            }
        },
        temperature: {
            label: "Temperature",
            units: ["Celsius", "Fahrenheit", "Kelvin"],
            convert: (val, from, to) => {
                let celsius = val;
                if (from === "Fahrenheit") celsius = (val - 32) * 5 / 9;
                if (from === "Kelvin") celsius = val - 273.15;

                if (to === "Celsius") return celsius;
                if (to === "Fahrenheit") return (celsius * 9 / 5) + 32;
                if (to === "Kelvin") return celsius + 273.15;
                return val;
            }
        }
    },

    init(mountElement) {
        this.container = mountElement;
        this.render();
    },

    render() {
        this.container.innerHTML = `
            <div class="tool-stack">
                <div class="form-group">
                    <label>Conversion Type</label>
                    <select id="conv-type" class="form-input">
                        <option value="length">Length (m, km, mi, ft)</option>
                        <option value="weight">Weight (kg, g, lb, oz)</option>
                        <option value="temperature">Temperature (°C, °F, K)</option>
                    </select>
                </div>

                <div class="tool-grid-2">
                    <div class="form-group">
                        <label>From</label>
                        <select id="conv-from" class="form-input"></select>
                    </div>
                    <div class="form-group">
                        <label>To</label>
                        <select id="conv-to" class="form-input"></select>
                    </div>
                </div>

                <div class="tool-grid-2">
                    <input type="number" id="conv-input" class="form-input conv-input" value="1">
                    <div id="conv-output" class="conv-output tool-readout">0</div>
                </div>
            </div>
        `;

        this.setupListeners();
        this.updateUnits();
    },

    setupListeners() {
        const typeSelect = document.getElementById('conv-type');
        const fromSelect = document.getElementById('conv-from');
        const toSelect = document.getElementById('conv-to');
        const valInput = document.getElementById('conv-input');

        typeSelect.addEventListener('change', () => {
            this.updateUnits();
            this.calculate();
        });

        fromSelect.addEventListener('change', () => this.calculate());
        toSelect.addEventListener('change', () => this.calculate());
        valInput.addEventListener('input', () => this.calculate());
    },

    updateUnits() {
        const type = document.getElementById('conv-type').value;
        const fromSelect = document.getElementById('conv-from');
        const toSelect = document.getElementById('conv-to');
        
        if (!fromSelect || !toSelect) return;

        const units = this.conversionData[type].units;
        const optionsHtml = units.map(unit => `<option value="${unit}">${unit}</option>`).join('');
        
        fromSelect.innerHTML = optionsHtml;
        toSelect.innerHTML = optionsHtml;

        if (toSelect.options.length > 1) {
            toSelect.selectedIndex = 1;
        }
    },

    calculate() {
        const type = document.getElementById('conv-type').value;
        const from = document.getElementById('conv-from').value;
        const to = document.getElementById('conv-to').value;
        const inputVal = parseFloat(document.getElementById('conv-input').value);
        const outputDisplay = document.getElementById('conv-output');

        if (!outputDisplay) return;

        if (isNaN(inputVal)) {
            outputDisplay.textContent = '--';
            return;
        }

        if (from === to) {
            outputDisplay.textContent = inputVal;
            return;
        }

        const result = this.conversionData[type].convert(inputVal, from, to);
        outputDisplay.textContent = Number(result.toFixed(5)).toString();
    },

    destroy() {
        this.container = null;
    }
};
