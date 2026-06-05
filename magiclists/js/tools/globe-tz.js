/** @tool {"label":"Global TZ","order":4,"icon":"globe-tz"} */
export default {
    container: null,
    interval: null,
    svg: null,
    projection: null,
    path: null,
    g: null,

    async init(mountZone) {
        this.container = mountZone;
        
        // Clear the container and set up a clean structure
        this.container.innerHTML = `
            <div style="width:100%; height:100%; display:flex; flex-direction:column; background:#0f172a;">
                <div id="globe-container" style="flex:1; position:relative; min-height:400px; background:#0f172a;"></div>
                <div style="padding:8px; text-align:center; color:#94a3b8; font-size:0.7rem; border-top:1px solid #334155;">
                    🖱️ Drag to rotate globe
                </div>
            </div>
        `;
        
        // Make sure dependencies are loaded
        await this.loadD3();
        await this.loadTopoJSON();
        
        // Small delay to ensure DOM is ready
        setTimeout(() => {
            this.renderGlobe();
            this.startTimeUpdates();
        }, 100);
    },

    loadD3() {
        return new Promise((resolve) => {
            if (window.d3) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://d3js.org/d3.v7.min.js';
            script.onload = () => {
                console.log('D3 loaded');
                resolve();
            };
            script.onerror = () => {
                console.error('Failed to load D3');
                resolve();
            };
            document.head.appendChild(script);
        });
    },

    loadTopoJSON() {
        return new Promise((resolve) => {
            if (window.topojson) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/topojson@3';
            script.onload = () => {
                console.log('TopoJSON loaded');
                resolve();
            };
            script.onerror = () => {
                console.error('Failed to load TopoJSON');
                resolve();
            };
            document.head.appendChild(script);
        });
    },

    async renderGlobe() {
        const container = document.getElementById('globe-container');
        if (!container) {
            console.error('Globe container not found');
            return;
        }

        // Clear any existing content
        container.innerHTML = '';
        
        const width = Math.min(500, container.clientWidth);
        const height = Math.min(500, container.clientHeight);
        
        console.log(`Rendering globe: ${width}x${height}`);
        
        // Create SVG
        this.svg = d3.select("#globe-container")
            .append("svg")
            .attr("width", width)
            .attr("height", height)
            .attr("viewBox", `0 0 ${width} ${height}`)
            .style("display", "block")
            .style("margin", "auto");
        
        // Setup projection
        this.projection = d3.geoOrthographic()
            .scale(width * 0.35)
            .translate([width / 2, height / 2])
            .rotate([0, 0]);
        
        this.path = d3.geoPath().projection(this.projection);
        
        // Draw ocean background
        this.svg.append("circle")
            .attr("cx", width / 2)
            .attr("cy", height / 2)
            .attr("r", width * 0.35)
            .attr("fill", "#1e3a8a")
            .attr("stroke", "#3b82f6")
            .attr("stroke-width", 2);
        
        // Load and draw world map with fallback URLs
        await this.loadAndDrawMap();
    },

    async loadAndDrawMap() {
        // Multiple fallback URLs for world map data
        const mapUrls = [
            'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json',
            'https://cdn.jsdelivr.net/npm/world-atlas@2/world/110m.json',
            'https://unpkg.com/world-atlas@2.0.2/countries-50m.json',
            'https://gist.githubusercontent.com/mbostock/4090846/raw/d534aba169207548a8a3d670c9c2cc719ff05c47/world-110m.json'
        ];
        
        let worldData = null;
        let successUrl = null;
        
        // Try each URL until one works
        for (const url of mapUrls) {
            try {
                console.log(`Trying to load map from: ${url}`);
                const response = await fetch(url);
                if (response.ok) {
                    worldData = await response.json();
                    successUrl = url;
                    console.log(`Successfully loaded map from: ${successUrl}`);
                    break;
                }
            } catch (error) {
                console.log(`Failed to load from ${url}:`, error.message);
            }
        }
        
        if (!worldData) {
            console.error('Failed to load world map from all sources');
            this.drawFallbackGrid();
            return;
        }
        
        try {
            // Try to get countries from the data structure
            let countries;
            if (worldData.objects.countries) {
                countries = topojson.feature(worldData, worldData.objects.countries);
            } else if (worldData.objects.land) {
                countries = topojson.feature(worldData, worldData.objects.land);
            } else {
                // Use the first available object
                const firstKey = Object.keys(worldData.objects)[0];
                countries = topojson.feature(worldData, worldData.objects[firstKey]);
            }
            
            console.log(`Loaded ${countries.features.length} features`);
            
            this.g = this.svg.append("g");
            
            // Draw countries
            this.g.selectAll("path")
                .data(countries.features)
                .enter()
                .append("path")
                .attr("d", this.path)
                .attr("fill", "#2d3748")
                .attr("stroke", "#4a5568")
                .attr("stroke-width", 0.5)
                .attr("stroke-opacity", 0.5);
            
            // Add drag interaction
            this.setupDrag();
            
            // Add some decorative elements
            this.addLatitudeLongitudeLines();
            
            console.log('Globe rendered successfully');
        } catch (error) {
            console.error('Error processing map data:', error);
            this.drawFallbackGrid();
        }
    },
    
    drawFallbackGrid() {
        // Draw a simple grid globe as fallback when map data can't be loaded
        console.log('Drawing fallback grid globe');
        const width = this.svg.attr('width');
        const height = this.svg.attr('height');
        
        this.g = this.svg.append("g");
        
        // Draw latitude lines
        for (let lat = -80; lat <= 80; lat += 30) {
            const points = [];
            for (let lon = -180; lon <= 180; lon += 5) {
                const [x, y] = this.projection([lon, lat]);
                if (x > 0 && x < width && y > 0 && y < height) {
                    points.push([x, y]);
                }
            }
            
            if (points.length > 1) {
                this.g.append("path")
                    .attr("d", `M ${points.map(p => `${p[0]},${p[1]}`).join(' L ')}`)
                    .attr("fill", "none")
                    .attr("stroke", "#4a5568")
                    .attr("stroke-width", 0.5)
                    .attr("stroke-opacity", 0.3);
            }
        }
        
        // Draw longitude lines
        for (let lon = -180; lon <= 180; lon += 30) {
            const points = [];
            for (let lat = -85; lat <= 85; lat += 5) {
                const [x, y] = this.projection([lon, lat]);
                if (x > 0 && x < width && y > 0 && y < height) {
                    points.push([x, y]);
                }
            }
            
            if (points.length > 1) {
                this.g.append("path")
                    .attr("d", `M ${points.map(p => `${p[0]},${p[1]}`).join(' L ')}`)
                    .attr("fill", "none")
                    .attr("stroke", "#4a5568")
                    .attr("stroke-width", 0.5)
                    .attr("stroke-opacity", 0.3);
            }
        }
        
        this.setupDrag();
    },
    
    addLatitudeLongitudeLines() {
        const width = this.svg.attr('width');
        const height = this.svg.attr('height');
        
        // Add equator
        const equatorPoints = [];
        for (let lon = -180; lon <= 180; lon += 5) {
            const [x, y] = this.projection([lon, 0]);
            if (x > 0 && x < width && y > 0 && y < height) {
                equatorPoints.push([x, y]);
            }
        }
        
        if (equatorPoints.length > 1) {
            this.g.append("path")
                .attr("d", `M ${equatorPoints.map(p => `${p[0]},${p[1]}`).join(' L ')}`)
                .attr("fill", "none")
                .attr("stroke", "#ef4444")
                .attr("stroke-width", 1)
                .attr("stroke-opacity", 0.5)
                .attr("stroke-dasharray", "4,4");
        }
    },

    setupDrag() {
        let dragActive = false;
        let lastX = 0;
        
        const dragBehavior = d3.drag()
            .on("start", (event) => {
                dragActive = true;
                lastX = event.x;
                this.svg.style("cursor", "grabbing");
                event.sourceEvent.stopPropagation();
            })
            .on("drag", (event) => {
                if (!dragActive) return;
                const deltaX = event.x - lastX;
                lastX = event.x;
                
                const rotate = this.projection.rotate();
                const lambda = rotate[0] + deltaX * 0.5;
                this.projection.rotate([lambda, rotate[1]]);
                
                // Update all paths
                this.g.selectAll("path").attr("d", this.path);
            })
            .on("end", () => {
                dragActive = false;
                this.svg.style("cursor", "grab");
            });
        
        this.svg.call(dragBehavior);
        this.svg.style("cursor", "grab");
    },

    startTimeUpdates() {
        this.updateTimeDisplay();
        this.interval = setInterval(() => this.updateTimeDisplay(), 1000);
    },

    updateTimeDisplay() {
        const container = document.getElementById('globe-container');
        if (!container) return;
        
        let overlay = document.getElementById('time-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'time-overlay';
            overlay.style.cssText = `
                position: absolute;
                bottom: 10px;
                left: 10px;
                background: rgba(0,0,0,0.7);
                color: white;
                padding: 8px 12px;
                border-radius: 8px;
                font-family: monospace;
                font-size: 11px;
                backdrop-filter: blur(4px);
                z-index: 10;
                pointer-events: none;
            `;
            container.appendChild(overlay);
        }
        
        const now = new Date();
        overlay.innerHTML = `
            <div>🕐 UTC: ${now.toUTCString().split(' ')[4]}</div>
            <div>📍 Local: ${now.toLocaleTimeString()}</div>
        `;
    },

    destroy() {
        if (this.interval) {
            clearInterval(this.interval);
        }
        if (this.container) {
            this.container.innerHTML = '';
        }
        this.svg = null;
        this.projection = null;
        this.path = null;
        this.g = null;
    }
};