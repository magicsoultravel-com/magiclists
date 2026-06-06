/** @tool {"label":"Map","order":6,"wide":true,"mountClass":"tool-mount--map"} */
/** @tool-icon <path d="M2.2 3.2 6 1.8l3.8 1.4v5.6L6 10.2 2.2 8.8V3.2z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/><path d="M6 1.8v8.4M9.8 3.2v5.6" fill="none" stroke="currentColor" stroke-width="0.85"/> */
export const Map = {
    container: null,
    map: null,
    currentMapType: 'streets',
    resizeObserver: null,
    leafletLoaded: false,
    timezonesLayer: null,
    timezonesLabelLayer: null,
    timezonesVisible: false,
    timezonesScriptLoaded: false,
    timezonesLabelMinZoom: 2,
    airportsLayer: null,
    airportsVisible: false,

    timezoneLineStyle: {
        color: '#000000',
        weight: 1,
        opacity: 0.85,
        dashArray: '3, 5',
        fillOpacity: 0
    },

    airportMarkerStyle: {
        radius: 3,
        color: '#000000',
        weight: 1,
        fillColor: '#000000',
        fillOpacity: 0.8,
        opacity: 0.9
    },

    tileLayers: {
        streets: {
            url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        },
        topo: {
            url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
            attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Style: &copy; OpenTopoMap (CC-BY-SA)'
        },
        satellite: {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: 'Tiles &copy; Esri'
        },
        sentinel: {
            url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
            attribution: 'Sentinel-2 cloudless by EOX IT Services GmbH'
        },
        esriLabels: {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
            attribution: 'Labels &copy; Esri'
        }
    },

    async init(mountElement) {
        this.container = mountElement;
        this.render();
        await this.ensureLeaflet();
        requestAnimationFrame(() => this.initMap());
    },

    ensureLeaflet() {
        if (typeof L !== 'undefined') {
            this.leafletLoaded = true;
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            if (!document.querySelector('link[data-map-tool-leaflet]')) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
                link.setAttribute('data-map-tool-leaflet', '1');
                document.head.appendChild(link);
            }

            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js';
            script.onload = () => {
                this.leafletLoaded = true;
                resolve();
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },

    render() {
        this.container.innerHTML = `
            <div class="map-tool">
                <div class="map-tool__controls">
                    <div class="map-tool__control-row">
                        <button type="button" class="map-tool__btn map-tool__btn--active" data-layer="streets">Streets</button>
                        <button type="button" class="map-tool__btn" data-layer="topo">Topographic</button>
                        <button type="button" class="map-tool__btn" data-layer="satellite">Satellite</button>
                        <button type="button" class="map-tool__btn" data-layer="sentinel">Sentinel-2</button>
                        <button type="button" class="map-tool__btn" data-layer="satelliteLabels">Satellite + Labels</button>
                        <button type="button" class="map-tool__btn map-tool__btn--overlay" data-overlay="timezones">Timezones</button>
                        <button type="button" class="map-tool__btn map-tool__btn--overlay" data-overlay="airports">Airports</button>
                    </div>
                </div>
                <div id="map-tool-canvas" class="map-tool__canvas" role="application" aria-label="Interactive map"></div>
            </div>
        `;

        this.container.querySelectorAll('.map-tool__btn[data-layer]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const layer = btn.getAttribute('data-layer');
                this.switchBasemap(layer);
                this.container.querySelectorAll('.map-tool__btn[data-layer]').forEach((b) => {
                    b.classList.toggle('map-tool__btn--active', b === btn);
                });
            });
        });

        const timezonesBtn = this.container.querySelector('[data-overlay="timezones"]');
        timezonesBtn?.addEventListener('click', () => this.toggleTimezones(timezonesBtn));

        const airportsBtn = this.container.querySelector('[data-overlay="airports"]');
        airportsBtn?.addEventListener('click', () => this.toggleAirports(airportsBtn));
    },

    getDataPath(filename) {
        const pagePath = window.location.pathname.replace(/\/[^/]*$/, '/');
        return `${pagePath}data/${filename}`;
    },

    ensureTimezonesPlugin() {
        if (typeof L !== 'undefined' && L.timezones) {
            return Promise.resolve();
        }

        if (this.timezonesScriptLoaded) {
            return new Promise((resolve) => {
                const check = () => (L.timezones ? resolve() : setTimeout(check, 50));
                check();
            });
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@kngai/leaflet.timezones@1.0.0/L.timezones.js';
            script.onload = () => {
                this.timezonesScriptLoaded = true;
                resolve();
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },

    formatTimezoneOffset(props) {
        const zone = props.zone;
        if (zone === 0) return 'UTC';

        if (typeof zone === 'number' && Number.isFinite(zone)) {
            if (Number.isInteger(zone)) {
                return zone > 0 ? `+${zone}` : `${zone}`;
            }
            const sign = zone > 0 ? '+' : '-';
            const abs = Math.abs(zone);
            const hours = Math.floor(abs);
            const mins = Math.round((abs - hours) * 60);
            return mins ? `${sign}${hours}:${String(mins).padStart(2, '0')}` : `${sign}${hours}`;
        }

        const match = (props.utc_format || props.time_zone || '').match(/UTC([+-])(\d{1,2})(?::(\d{2}))?/);
        if (match) {
            const sign = match[1];
            const hours = parseInt(match[2], 10);
            const mins = match[3];
            if (sign === '+' && hours === 0 && (!mins || mins === '00')) return 'UTC';
            if (mins && mins !== '00') return `${sign}${hours}:${mins}`;
            return `${sign}${hours}`;
        }

        return props.name || '';
    },

    getZoneTopLabelLatLng(layer) {
        const bounds = layer.getBounds();
        const north = bounds.getNorth();
        const south = bounds.getSouth();
        const span = Math.max(0, north - south);
        const inset = Math.min(5, Math.max(0.4, span * 0.1));
        return L.latLng(north - inset, bounds.getCenter().lng);
    },

    buildTimezoneLabels(boundaryLayer) {
        const labelLayer = L.layerGroup();

        boundaryLayer.eachLayer((zoneLayer) => {
            const props = zoneLayer.feature?.properties;
            if (!props) return;

            const text = this.formatTimezoneOffset(props);
            if (!text) return;

            const latlng = this.getZoneTopLabelLatLng(zoneLayer);
            const marker = L.marker(latlng, {
                interactive: false,
                keyboard: false,
                icon: L.divIcon({
                    className: 'map-tool-tz-offset',
                    html: `<span>${text}</span>`,
                    iconSize: [0, 0],
                    iconAnchor: [0, 0]
                })
            });

            labelLayer.addLayer(marker);
        });

        return labelLayer;
    },

    updateTimezoneLabelVisibility() {
        if (!this.map || !this.timezonesLabelLayer || !this.timezonesVisible) return;

        const show = this.map.getZoom() >= this.timezonesLabelMinZoom;
        if (show && !this.map.hasLayer(this.timezonesLabelLayer)) {
            this.timezonesLabelLayer.addTo(this.map);
        } else if (!show && this.map.hasLayer(this.timezonesLabelLayer)) {
            this.map.removeLayer(this.timezonesLabelLayer);
        }
    },

    handleTimezoneZoom() {
        this.updateTimezoneLabelVisibility();
    },

    setTimezonesVisible(onMap) {
        if (!this.map) return;

        if (onMap) {
            this.timezonesLayer.addTo(this.map);
            this.updateTimezoneLabelVisibility();
            this.map.on('zoomend', this.handleTimezoneZoom, this);
        } else {
            this.map.off('zoomend', this.handleTimezoneZoom, this);
            this.map.removeLayer(this.timezonesLayer);
            if (this.timezonesLabelLayer) {
                this.map.removeLayer(this.timezonesLabelLayer);
            }
        }
    },

    buildTimezonesLayer() {
        const layer = L.timezones.bindPopup((layer) => {
            const props = layer.feature?.properties || {};
            const tzName = props.tz_name1st || props.time_zone;
            if (!tzName) return props.time_zone || 'Timezone';

            try {
                return new Date().toLocaleString(undefined, {
                    timeZone: tzName,
                    timeZoneName: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            } catch {
                return props.time_zone || tzName;
            }
        });

        layer.setStyle(this.timezoneLineStyle);
        this.timezonesLabelLayer = this.buildTimezoneLabels(layer);
        return layer;
    },

    async toggleTimezones(buttonEl) {
        if (!this.map) return;

        try {
            if (!this.timezonesLayer) {
                await this.ensureTimezonesPlugin();
                this.timezonesLayer = this.buildTimezonesLayer();
            }

            this.timezonesVisible = !this.timezonesVisible;
            this.setTimezonesVisible(this.timezonesVisible);
            buttonEl?.classList.toggle('map-tool__btn--active', this.timezonesVisible);
        } catch (error) {
            console.error('[Map] Failed to load timezone overlay:', error);
        }
    },

    async loadAirportsGeoJson() {
        const response = await fetch(`${this.getDataPath('airports-major.json')}?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
    },

    buildAirportsLayer(geojson) {
        return L.geoJSON(geojson, {
            pointToLayer: (_feature, latlng) => L.circleMarker(latlng, this.airportMarkerStyle),
            onEachFeature: (feature, layer) => {
                const props = feature.properties || {};
                const iata = props.iata || '';
                const name = props.name || 'Airport';
                const city = props.city || '';
                const country = props.country || '';
                const icao = props.icao || '';
                const place = [city, country].filter(Boolean).join(', ');

                layer.bindPopup(
                    `<strong>${iata}</strong> — ${name}` +
                    (place ? `<br>${place}` : '') +
                    (icao ? `<br>${icao}` : '')
                );

                if (iata) {
                    layer.bindTooltip(iata, {
                        className: 'map-tool-airport-label',
                        direction: 'top',
                        offset: [0, -4],
                        opacity: 0.95
                    });
                }
            }
        });
    },

    async toggleAirports(buttonEl) {
        if (!this.map) return;

        try {
            if (!this.airportsLayer) {
                buttonEl?.classList.add('map-tool__btn--loading');
                const geojson = await this.loadAirportsGeoJson();
                this.airportsLayer = this.buildAirportsLayer(geojson);
                buttonEl?.classList.remove('map-tool__btn--loading');
            }

            this.airportsVisible = !this.airportsVisible;

            if (this.airportsVisible) {
                this.airportsLayer.addTo(this.map);
            } else {
                this.map.removeLayer(this.airportsLayer);
            }

            buttonEl?.classList.toggle('map-tool__btn--active', this.airportsVisible);
        } catch (error) {
            buttonEl?.classList.remove('map-tool__btn--loading');
            console.error('[Map] Failed to load airports overlay:', error);
        }
    },

    initMap() {
        if (this.map || typeof L === 'undefined') return;

        const canvas = this.container.querySelector('#map-tool-canvas');
        if (!canvas) return;

        this.map = L.map(canvas, { zoomControl: true });
        this.switchBasemap('streets');
        this.map.setView([20, 0], 2);

        this.resizeObserver = new ResizeObserver(() => {
            if (this.map) {
                this.map.invalidateSize({ animate: false });
            }
        });
        this.resizeObserver.observe(canvas);

        setTimeout(() => {
            if (this.map) this.map.invalidateSize({ animate: false });
        }, 150);
    },

    clearBasemaps() {
        if (!this.map) return;
        this.map.eachLayer((layer) => {
            if (layer.getAttribution && layer.getAttribution()) {
                this.map.removeLayer(layer);
            }
        });
    },

    switchBasemap(layerName) {
        if (!this.map) return;

        this.clearBasemaps();
        this.currentMapType = layerName;
        const maxZoom = 19;

        if (layerName === 'satelliteLabels') {
            L.tileLayer(this.tileLayers.satellite.url, {
                maxZoom,
                attribution: this.tileLayers.satellite.attribution
            }).addTo(this.map);

            L.tileLayer(this.tileLayers.esriLabels.url, {
                maxZoom,
                attribution: this.tileLayers.esriLabels.attribution
            }).addTo(this.map);
            return;
        }

        const config = this.tileLayers[layerName];
        if (!config) return;

        L.tileLayer(config.url, {
            maxZoom,
            attribution: config.attribution
        }).addTo(this.map);
    },

    destroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
        if (this.map) {
            this.map.off('zoomend', this.handleTimezoneZoom, this);
        }
        this.timezonesLayer = null;
        this.timezonesLabelLayer = null;
        this.timezonesVisible = false;
        this.airportsLayer = null;
        this.airportsVisible = false;
        this.container = null;
        this.currentMapType = 'streets';
    }
};
