/** @tool {"label":"Globe","order":5,"defaultSize":{"w":480,"h":520},"minSize":{"w":320,"h":400}} */
/** @tool-icon <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M1.8 6h8.4M6 1.8c1.2 1.4 1.8 3 1.8 4.2S7.2 8.8 6 10.2M6 1.8C4.8 3.2 4.2 4.8 4.2 6s.6 2.8 1.8 4.2" fill="none" stroke="currentColor" stroke-width="0.85"/> */
export const Globe = {
    container: null,
    globeInstance: null,
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    currentLayer: 'political',
    layers: { political: null, geological: null, timezones: null },
    animationId: null,
    labelGroup: null,
    threeLoaded: false,

    async init(mountElement) {
        this.container = mountElement;
        this.render();
        
        // Wait for Three.js to load globally
        if (typeof THREE === 'undefined') {
            await this.loadThreeJS();
        }
        
        setTimeout(() => {
            this.initThree();
            this.loadPoliticalLayer();
        }, 100);
    },

    loadThreeJS() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
            script.onload = () => {
                // Also load OrbitControls
                const controlsScript = document.createElement('script');
                controlsScript.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js';
                controlsScript.onload = () => resolve();
                document.head.appendChild(controlsScript);
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },

    render() {
        this.container.innerHTML = `
            <div class="globe-tool">
                <div class="globe-tool__controls map-tool__control-row">
                    <button type="button" class="btn btn--compact globe-layer-btn active" data-layer="political">Political</button>
                    <button type="button" class="btn btn--compact globe-layer-btn" data-layer="geological">Geological</button>
                    <button type="button" class="btn btn--compact globe-layer-btn" data-layer="timezones">Timezones</button>
                </div>
                <div id="globe-canvas-container" class="globe-tool__canvas-wrap"></div>
                <div class="globe-tool__hint tool-msg">Drag to rotate · Scroll to zoom</div>
            </div>
        `;

        const btns = this.container.querySelectorAll('.globe-layer-btn');
        btns.forEach((btn) => {
            btn.addEventListener('click', () => {
                const layer = btn.getAttribute('data-layer');
                this.switchLayer(layer);
                btns.forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    },

    initThree() {
        const containerEl = this.container.querySelector('#globe-canvas-container');
        if (!containerEl) return;
        
        const width = containerEl.clientWidth;
        const height = containerEl.clientHeight;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x050510);

        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        this.camera.position.set(0, 0, 3.5);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(width, height);
        containerEl.appendChild(this.renderer.domElement);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableZoom = true;
        this.controls.enablePan = false;
        this.controls.rotateSpeed = 0.8;

        // Stars, lighting, globe (same as before)
        this.addStars();
        this.addLights();
        this.addGlobe();

        const animate = () => {
            this.animationId = requestAnimationFrame(animate);
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
        };
        animate();

        new ResizeObserver(() => this.handleResize()).observe(containerEl);
    },

    addStars() {
        const starGeometry = new THREE.BufferGeometry();
        const starCount = 2000;
        const starPositions = new Float32Array(starCount * 3);
        for (let i = 0; i < starCount; i++) {
            starPositions[i*3] = (Math.random() - 0.5) * 2000;
            starPositions[i*3+1] = (Math.random() - 0.5) * 2000;
            starPositions[i*3+2] = (Math.random() - 0.5) * 500 - 100;
        }
        starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
        const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.3 }));
        this.scene.add(stars);
    },

    addLights() {
        const ambientLight = new THREE.AmbientLight(0x404060);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
        directionalLight.position.set(5, 3, 5);
        this.scene.add(directionalLight);
        
        const backLight = new THREE.DirectionalLight(0x88aaff, 0.4);
        backLight.position.set(-3, -1, -4);
        this.scene.add(backLight);
    },

    addGlobe() {
        const textureLoader = new THREE.TextureLoader();
        const earthTexture = textureLoader.load('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg');
        const globeGeometry = new THREE.SphereGeometry(1, 128, 128);
        const earthMaterial = new THREE.MeshStandardMaterial({ map: earthTexture, roughness: 0.5, metalness: 0.1 });
        this.globeInstance = new THREE.Mesh(globeGeometry, earthMaterial);
        this.scene.add(this.globeInstance);
    },

    onPanelResize() {
        this.handleResize();
    },

    handleResize() {
        const container = this.container?.querySelector('#globe-canvas-container');
        if (!container) return;
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (width === 0 || height === 0) return;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    },

    // Include all the layer methods from your original code (loadPoliticalLayer, loadGeologicalLayer, loadTimezonesLayer, etc.)
    // They remain exactly the same as before
    
    async loadPoliticalLayer() {
        this.clearPolygonLayer('political');
        const countriesData = this.generateSimplifiedCountries();
        const polygons = [];
        
        countriesData.forEach(country => {
            const points = country.border.map(coord => {
                const lat = coord[1] * Math.PI / 180;
                const lng = coord[0] * Math.PI / 180;
                const x = 1.005 * Math.cos(lat) * Math.cos(lng);
                const y = 1.005 * Math.sin(lat);
                const z = 1.005 * Math.cos(lat) * Math.sin(lng);
                return new THREE.Vector3(x, y, z);
            });
            
            const geometry = new THREE.BufferGeometry();
            const vertices = points.flatMap(v => [v.x, v.y, v.z]);
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
            
            let hash = 0;
            for (let i = 0; i < country.name.length; i++) hash = ((hash << 5) - hash) + country.name.charCodeAt(i);
            const hue = Math.abs(hash % 360);
            
            const material = new THREE.LineBasicMaterial({ color: `hsl(${hue}, 70%, 55%)` });
            const polygon = new THREE.LineLoop(geometry, material);
            this.scene.add(polygon);
            polygons.push(polygon);
        });
        
        this.layers.political = polygons;
        this.addLabels(countriesData);
    },

    async loadGeologicalLayer() {
        this.clearPolygonLayer('geological');
        this.clearLabels();
        
        const plates = [];
        const numPlates = 24;
        
        for (let i = 0; i < numPlates; i++) {
            const centerLat = (Math.random() - 0.5) * 160;
            const centerLng = (Math.random() - 0.5) * 360;
            const radius = 8 + Math.random() * 12;
            
            const points = [];
            for (let ang = 0; ang <= 360; ang += 20) {
                const rad = ang * Math.PI / 180;
                const dLat = radius * Math.cos(rad) * 0.8;
                const dLng = radius * Math.sin(rad) / Math.max(0.2, Math.cos(centerLat * Math.PI / 180));
                let lat = centerLat + dLat;
                let lng = centerLng + dLng;
                if (lat > 85) lat = 85;
                if (lat < -85) lat = -85;
                
                const latRad = lat * Math.PI / 180;
                const lngRad = lng * Math.PI / 180;
                const x = 1.008 * Math.cos(latRad) * Math.cos(lngRad);
                const y = 1.008 * Math.sin(latRad);
                const z = 1.008 * Math.cos(latRad) * Math.sin(lngRad);
                points.push(new THREE.Vector3(x, y, z));
            }
            
            const geometry = new THREE.BufferGeometry();
            const vertices = points.flatMap(v => [v.x, v.y, v.z]);
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
            
            const rockColors = [0x8B5A2B, 0x6B4E3A, 0x9B6E4A, 0x7B5E3A, 0x5B3E2A, 0xAB7E5A];
            const material = new THREE.LineBasicMaterial({ color: rockColors[i % rockColors.length] });
            const plateRing = new THREE.LineLoop(geometry, material);
            this.scene.add(plateRing);
            plates.push(plateRing);
        }
        
        this.layers.geological = plates;
    },

    async loadTimezonesLayer() {
        this.clearPolygonLayer('timezones');
        this.clearLabels();
        
        const zones = [];
        
        for (let offset = -11; offset <= 12; offset++) {
            const lngStart = offset * 15;
            const lngEnd = lngStart + 15;
            
            const points = [];
            
            for (let lng = lngStart; lng <= lngEnd; lng += 2) {
                const lat = 85;
                const latRad = lat * Math.PI / 180;
                const lngRad = lng * Math.PI / 180;
                const x = 1.008 * Math.cos(latRad) * Math.cos(lngRad);
                const y = 1.008 * Math.sin(latRad);
                const z = 1.008 * Math.cos(latRad) * Math.sin(lngRad);
                points.push(new THREE.Vector3(x, y, z));
            }
            
            for (let lat = 85; lat >= -85; lat -= 2) {
                const latRad = lat * Math.PI / 180;
                const lngRad = lngEnd * Math.PI / 180;
                const x = 1.008 * Math.cos(latRad) * Math.cos(lngRad);
                const y = 1.008 * Math.sin(latRad);
                const z = 1.008 * Math.cos(latRad) * Math.sin(lngRad);
                points.push(new THREE.Vector3(x, y, z));
            }
            
            for (let lng = lngEnd; lng >= lngStart; lng -= 2) {
                const lat = -85;
                const latRad = lat * Math.PI / 180;
                const lngRad = lng * Math.PI / 180;
                const x = 1.008 * Math.cos(latRad) * Math.cos(lngRad);
                const y = 1.008 * Math.sin(latRad);
                const z = 1.008 * Math.cos(latRad) * Math.sin(lngRad);
                points.push(new THREE.Vector3(x, y, z));
            }
            
            for (let lat = -85; lat <= 85; lat += 2) {
                const latRad = lat * Math.PI / 180;
                const lngRad = lngStart * Math.PI / 180;
                const x = 1.008 * Math.cos(latRad) * Math.cos(lngRad);
                const y = 1.008 * Math.sin(latRad);
                const z = 1.008 * Math.cos(latRad) * Math.sin(lngRad);
                points.push(new THREE.Vector3(x, y, z));
            }
            
            const geometry = new THREE.BufferGeometry();
            const vertices = points.flatMap(v => [v.x, v.y, v.z]);
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
            
            const hue = 200 + (offset + 11) * 6;
            const material = new THREE.LineBasicMaterial({ color: `hsl(${hue}, 70%, 55%)` });
            const zone = new THREE.Line(geometry, material);
            this.scene.add(zone);
            zones.push(zone);
        }
        
        this.layers.timezones = zones;
    },

    addLabels(countriesData) {
        this.clearLabels();
        this.labelGroup = new THREE.Group();
        
        const majorCountries = ['United States', 'China', 'Russia', 'Canada', 'Brazil', 'Australia', 'India', 'Argentina', 'Mexico', 'Indonesia', 'Saudi Arabia', 'South Africa', 'Egypt', 'Turkey', 'France', 'Spain', 'Germany', 'Norway', 'United Kingdom', 'Japan'];
        
        countriesData.forEach(country => {
            if (!majorCountries.includes(country.name)) return;
            
            let avgLat = 0, avgLng = 0;
            country.border.forEach(coord => {
                avgLat += coord[1];
                avgLng += coord[0];
            });
            avgLat /= country.border.length;
            avgLng /= country.border.length;
            
            const latRad = avgLat * Math.PI / 180;
            const lngRad = avgLng * Math.PI / 180;
            const x = 1.08 * Math.cos(latRad) * Math.cos(lngRad);
            const y = 1.08 * Math.sin(latRad);
            const z = 1.08 * Math.cos(latRad) * Math.sin(lngRad);
            
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 256;
            canvas.height = 64;
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.font = 'Bold 14px "Segoe UI", Arial';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.fillText(country.name, canvas.width / 2, 32);
            
            const texture = new THREE.CanvasTexture(canvas);
            const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
            const sprite = new THREE.Sprite(material);
            sprite.scale.set(0.3, 0.08, 1);
            sprite.position.set(x, y, z);
            this.labelGroup.add(sprite);
        });
        
        this.scene.add(this.labelGroup);
    },

    clearLabels() {
        if (this.labelGroup) {
            this.scene.remove(this.labelGroup);
            this.labelGroup = null;
        }
    },

    clearPolygonLayer(layerName) {
        if (this.layers[layerName]) {
            this.layers[layerName].forEach(obj => {
                this.scene.remove(obj);
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) obj.material.dispose();
            });
            this.layers[layerName] = null;
        }
    },

    switchLayer(layer) {
        this.currentLayer = layer;
        
        Object.keys(this.layers).forEach(key => {
            if (this.layers[key]) {
                this.layers[key].forEach(obj => obj.visible = false);
            }
        });
        
        if (this.layers[layer]) {
            this.layers[layer].forEach(obj => obj.visible = true);
        } else {
            if (layer === 'political') this.loadPoliticalLayer();
            else if (layer === 'geological') this.loadGeologicalLayer();
            else if (layer === 'timezones') this.loadTimezonesLayer();
        }
        
        if (this.labelGroup) {
            this.labelGroup.visible = (layer === 'political');
        }
    },

    generateSimplifiedCountries() {
        return [
            { name: 'United States', border: [[-125, 48], [-100, 48], [-100, 25], [-125, 25], [-125, 48]] },
            { name: 'Canada', border: [[-140, 70], [-60, 70], [-60, 48], [-140, 48], [-140, 70]] },
            { name: 'Russia', border: [[30, 75], [180, 75], [180, 45], [30, 45], [30, 75]] },
            { name: 'China', border: [[75, 45], [135, 45], [135, 15], [75, 15], [75, 45]] },
            { name: 'Brazil', border: [[-70, 5], [-35, 5], [-35, -35], [-70, -35], [-70, 5]] },
            { name: 'Australia', border: [[110, -10], [155, -10], [155, -40], [110, -40], [110, -10]] },
            { name: 'India', border: [[68, 35], [88, 35], [88, 8], [68, 8], [68, 35]] },
            { name: 'Argentina', border: [[-70, -20], [-55, -20], [-55, -55], [-70, -55], [-70, -20]] },
            { name: 'Mexico', border: [[-115, 30], [-85, 30], [-85, 15], [-115, 15], [-115, 30]] },
            { name: 'Indonesia', border: [[95, 5], [140, 5], [140, -10], [95, -10], [95, 5]] },
            { name: 'Saudi Arabia', border: [[35, 30], [55, 30], [55, 15], [35, 15], [35, 30]] },
            { name: 'South Africa', border: [[16, -22], [33, -22], [33, -35], [16, -35], [16, -22]] },
            { name: 'Egypt', border: [[25, 32], [35, 32], [35, 22], [25, 22], [25, 32]] },
            { name: 'Turkey', border: [[26, 42], [45, 42], [45, 36], [26, 36], [26, 42]] },
            { name: 'France', border: [[-5, 51], [8, 51], [8, 42], [-5, 42], [-5, 51]] },
            { name: 'Spain', border: [[-9, 44], [3, 44], [3, 36], [-9, 36], [-9, 44]] },
            { name: 'Germany', border: [[5, 55], [15, 55], [15, 47], [5, 47], [5, 55]] },
            { name: 'Norway', border: [[4, 71], [31, 71], [31, 57], [4, 57], [4, 71]] },
            { name: 'United Kingdom', border: [[-8, 60], [2, 60], [2, 50], [-8, 50], [-8, 60]] },
            { name: 'Japan', border: [[128, 46], [146, 46], [146, 31], [128, 31], [128, 46]] }
        ];
    },

    destroy() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        if (this.renderer) this.renderer.dispose();
        if (this.scene) {
            this.scene.traverse((object) => {
                if (object.isMesh) {
                    if (object.geometry) object.geometry.dispose();
                    if (object.material) object.material.dispose();
                }
            });
        }
        this.container = null;
        this.globeInstance = null;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.layers = { political: null, geological: null, timezones: null };
        this.labelGroup = null;
    }
};