/**
 * Wigle Explorer - A simple, high-performance Wigle database visualizer
 * 
 * Main application class that handles everything in one place but with clean organization.
 * Perfect for a side project - easy to understand and modify.
 */

// Configuration constants
const CONFIG = {
    NETWORK_TYPES: {
        'W': { name: 'Wi-Fi', color: '#FF6B6B' },
        'B': { name: 'Bluetooth Classic', color: '#4ECDC4' },
        'E': { name: 'Bluetooth LE', color: '#45B7D1' },
        'G': { name: 'GSM/UMTS', color: '#96CEB4' },
        'L': { name: 'LTE/NR', color: '#FECA57' },
        'C': { name: 'CDMA', color: '#FF9FF3' }
    },
    LIMITS: {
        MAX_HEATMAP_POINTS: 100000,
        MAX_CANVAS_MARKERS: 200000,
        MAX_LOCATION_SAMPLES: 30000,
        CHUNK_SIZE: 2000
    },
    MAP_LAYERS: {
        'dark': {
            name: 'Dark Theme',
            url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            attribution: '© OpenStreetMap contributors © CARTO'
        },
        'light': {
            name: 'Light Theme',
            url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
            attribution: '© OpenStreetMap contributors © CARTO'
        },
        'satellite': {
            name: 'Satellite',
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: '© Esri'
        },
        'terrain': {
            name: 'Terrain',
            url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
            attribution: '© OpenTopoMap contributors'
        },
        'osm': {
            name: 'OpenStreetMap',
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            attribution: '© OpenStreetMap contributors'
        }
    }
};

class WigleExplorer {
    constructor() {
        // Core state
        this.db = null;
        this.map = null;
        this.currentView = 'heatmap';
        this.loadingCancelled = false;
        this.animationTimer = null;

        // Data storage
        this.data = {
            networks: [],
            locations: [],
            timeRange: { min: 0, max: 0 }
        };

        // Map layers
        this.layers = {
            heatmap: null,
            geoJsonLayer: null,
            baseLayers: {},
            overlayLayers: {},
            layerControl: null
        };

        this.init();
    }

    // =================
    // INITIALIZATION
    // =================

    async init() {
        await this.initSQLJS();
        this.initMap();
        this.initEventListeners();
        console.log('Wigle Explorer ready');
    }

    async initSQLJS() {
        try {
            const sqlPromise = initSqlJs({
                locateFile: file => `https://unpkg.com/sql.js@1.8.0/dist/${file}`
            });
            window.SQL = await sqlPromise;
        } catch (error) {
            console.error('Failed to initialize SQL.js:', error);
        }
    }

    initMap() {
        // High-performance map with canvas renderer
        this.map = L.map('map', {
            preferCanvas: true,
            renderer: L.canvas({ padding: 0.5 })
        }).setView([40.7128, -74.0060], 10);

        // Create base layers
        Object.keys(CONFIG.MAP_LAYERS).forEach(key => {
            const layerConfig = CONFIG.MAP_LAYERS[key];
            this.layers.baseLayers[layerConfig.name] = L.tileLayer(layerConfig.url, {
                attribution: layerConfig.attribution,
                subdomains: 'abcd',
                maxZoom: 20
            });
        });

        // Add default layer (dark theme)
        this.layers.baseLayers['Dark Theme'].addTo(this.map);

        // Initialize overlays (will be populated when data is loaded)
        this.layers.overlayLayers = {};

        // Create layer control
        this.layers.layerControl = L.control.layers(
            this.layers.baseLayers, 
            this.layers.overlayLayers,
            { position: 'topright', collapsed: true }
        ).addTo(this.map);
    }

    initEventListeners() {
        // File upload
        document.getElementById('fileInput').addEventListener('change', (e) => {
            this.handleFileUpload(e);
        });

        // View tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchView(e.target.dataset.view);
            });
        });

        // Controls with simple event handling
        this.setupControls();
        this.setupSidebarResize();
    }

    setupControls() {
        // Heatmap controls
        document.getElementById('updateMap')?.addEventListener('click', () => this.updateView());
        document.getElementById('intensitySlider')?.addEventListener('input', (e) => {
            document.getElementById('intensityValue').textContent = e.target.value;
            this.updateHeatmap();
        });
        document.getElementById('radiusSlider')?.addEventListener('input', (e) => {
            document.getElementById('radiusValue').textContent = e.target.value + 'px';
            this.updateHeatmap();
        });

        // Filter controls
        ['W', 'B', 'E', 'G', 'L', 'C'].forEach(type => {
            document.getElementById(`filter${type}`)?.addEventListener('change', () => this.updateView());
            document.getElementById(`markers${type}`)?.addEventListener('change', () => this.showNetworkMarkers());
        });

        // Marker controls
        document.getElementById('showMarkers')?.addEventListener('click', () => this.showNetworkMarkers());
        document.getElementById('networkSearch')?.addEventListener('input', () => this.showNetworkMarkers());
        document.getElementById('signalFilter')?.addEventListener('input', (e) => {
            document.getElementById('signalValue').textContent = e.target.value + ' dBm';
            this.showNetworkMarkers();
        });

        // Security filter checkboxes
        ['secOpen', 'secWEP', 'secWPA', 'secWPA3', 'secHidden'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => this.showNetworkMarkers());
        });

        // Timeline controls
        document.getElementById('timeSlider')?.addEventListener('input', (e) => this.updateTimeFilter(e.target.value));
        document.getElementById('animateTime')?.addEventListener('click', () => this.animateTimeline());
    }

    // =================
    // FILE HANDLING
    // =================

    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.loadingCancelled = false;
        this.showLoading(true);
        this.updateProgress(0, 'Reading file...');

        try {
            // Load file and database
            const arrayBuffer = await file.arrayBuffer();
            if (this.loadingCancelled) return;

            this.updateProgress(15, 'Loading database...');
            const uint8Array = new Uint8Array(arrayBuffer);
            this.db = new window.SQL.Database(uint8Array);

            // Load data
            await this.loadData();
            if (this.loadingCancelled) return;

            // Process and display
            this.updateProgress(85, 'Generating analytics...');
            this.updateStats();
            this.updateAnalysis();
            this.updateTimeline();

            this.updateProgress(95, 'Centering map...');
            this.centerMapOnData();
            this.updateView();
            this.enableControls();

            this.updateProgress(100, 'Complete!');
            await this.sleep(500);

        } catch (error) {
            console.error('Error loading database:', error);
            alert('Error loading database file. Please ensure it\'s a valid SQLite file.');
        } finally {
            this.showLoading(false);
        }
    }

    async loadData() {
        this.updateProgress(20, 'Loading networks...');
        
        // Load networks with chunked processing
        const networkQuery = `
            SELECT type, lastlat as lat, lastlon as lon, bestlevel, ssid, bssid, lasttime, frequency, capabilities
            FROM network WHERE lastlat != 0 AND lastlon != 0 ORDER BY lasttime DESC
        `;
        
        const networkResults = this.db.exec(networkQuery);
        if (networkResults.length > 0) {
            this.data.networks = await this.processInChunks(networkResults[0].values, (row) => ({
                type: row[0], lat: row[1], lon: row[2], level: row[3],
                ssid: row[4] || 'Hidden Network', bssid: row[5],
                lasttime: row[6], frequency: row[7], capabilities: row[8] || ''
            }), 'networks');
        }

        if (this.loadingCancelled) return;

        this.updateProgress(50, 'Loading observations...');
        
        // Load locations with smart sampling
        const locationCountQuery = `SELECT COUNT(*) FROM location WHERE lat != 0 AND lon != 0`;
        const countResult = this.db.exec(locationCountQuery);
        const locationCount = countResult[0]?.values[0][0] || 0;

        let locationQuery;
        if (locationCount > CONFIG.LIMITS.MAX_LOCATION_SAMPLES) {
            const sampleRate = Math.ceil(locationCount / CONFIG.LIMITS.MAX_LOCATION_SAMPLES);
            locationQuery = `
                SELECT l.lat, l.lon, l.level, n.type, l.time
                FROM location l JOIN network n ON l.bssid = n.bssid
                WHERE l.lat != 0 AND l.lon != 0 AND l._id % ${sampleRate} = 0
                LIMIT ${CONFIG.LIMITS.MAX_LOCATION_SAMPLES}
            `;
        } else {
            locationQuery = `
                SELECT l.lat, l.lon, l.level, n.type, l.time
                FROM location l JOIN network n ON l.bssid = n.bssid
                WHERE l.lat != 0 AND l.lon != 0
            `;
        }

        const locationResults = this.db.exec(locationQuery);
        if (locationResults.length > 0) {
            this.data.locations = await this.processInChunks(locationResults[0].values, (row) => ({
                lat: row[0], lon: row[1], level: row[2], type: row[3], time: row[4]
            }), 'observations');
        }

        // Calculate time range
        this.calculateTimeRange();
    }

    // Helper: Process large arrays in chunks to prevent UI blocking
    async processInChunks(data, transformer, label) {
        const result = [];
        const chunkSize = CONFIG.LIMITS.CHUNK_SIZE;

        for (let i = 0; i < data.length; i += chunkSize) {
            if (this.loadingCancelled) return [];

            const chunk = data.slice(i, i + chunkSize);
            result.push(...chunk.map(transformer));

            const progress = Math.round((i + chunkSize) / data.length * 100);
            this.updateProgress(20 + progress * 0.3, `Processing ${result.length} ${label}...`);

            if (i % (chunkSize * 2) === 0) await this.sleep(1);
        }

        return result;
    }

    // =================
    // VIEW MANAGEMENT
    // =================

    switchView(viewName) {
        this.currentView = viewName;

        // Update UI
        document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
        document.querySelector(`[data-view="${viewName}"]`)?.classList.add('active');

        document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
        document.getElementById(`${viewName}-panel`)?.classList.add('active');

        this.updateView();
    }

    updateView() {
        if (this.data.networks.length === 0) return;

        this.clearLayers();

        switch (this.currentView) {
            case 'heatmap':
                this.updateHeatmap();
                break;
            case 'markers':
                this.showNetworkMarkers();
                break;
            case 'timeline':
                this.updateTimeFilter(document.getElementById('timeSlider')?.value || 100);
                break;
        }
    }

    // =================
    // MAP RENDERING
    // =================

    updateHeatmap() {
        this.clearLayers();

        const activeTypes = this.getActiveTypes();
        if (activeTypes.length === 0) return;

        const intensity = parseFloat(document.getElementById('intensitySlider')?.value || 1);
        const radius = parseInt(document.getElementById('radiusSlider')?.value || 15);

        // Smart sampling for performance
        const allPoints = [];
        const maxPoints = CONFIG.LIMITS.MAX_HEATMAP_POINTS;

        // Sample networks
        const filteredNetworks = this.data.networks.filter(n => activeTypes.includes(n.type));
        const networkStep = Math.max(1, Math.ceil(filteredNetworks.length / (maxPoints * 0.3)));
        for (let i = 0; i < filteredNetworks.length; i += networkStep) {
            const item = filteredNetworks[i];
            allPoints.push([item.lat, item.lon, 0.8 * intensity]);
        }

        // Sample locations
        const filteredLocations = this.data.locations.filter(l => activeTypes.includes(l.type));
        const locationStep = Math.max(1, Math.ceil(filteredLocations.length / (maxPoints * 0.7)));
        for (let i = 0; i < filteredLocations.length; i += locationStep) {
            const item = filteredLocations[i];
            const pointIntensity = Math.max(0.1, Math.min(1, (item.level + 100) / 70)) * intensity;
            allPoints.push([item.lat, item.lon, pointIntensity]);
        }

        if (allPoints.length > 0) {
            this.layers.heatmap = L.heatLayer(allPoints, {
                radius, blur: Math.max(10, radius - 5), maxZoom: 18,
                gradient: { 0.0: 'blue', 0.2: 'cyan', 0.4: 'lime', 0.6: 'yellow', 0.8: 'orange', 1.0: 'red' }
            });
            
            // Add to layer control as overlay
            this.layers.layerControl.addOverlay(this.layers.heatmap, 'Network Heatmap');
            this.layers.heatmap.addTo(this.map);
        }
    }

    showNetworkMarkers() {
        this.clearLayers();

        const filteredNetworks = this.getFilteredNetworks();
        const maxNetworks = CONFIG.LIMITS.MAX_CANVAS_MARKERS;
        const networksToShow = filteredNetworks.slice(0, maxNetworks);

        if (networksToShow.length === 0) return;

        // High-performance GeoJSON canvas rendering
        const geoJsonData = {
            type: 'FeatureCollection',
            features: networksToShow.map(network => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [network.lon, network.lat] },
                properties: network
            }))
        };

        this.layers.geoJsonLayer = L.geoJSON(geoJsonData, {
            pointToLayer: (feature, latlng) => {
                const { type, level } = feature.properties;
                const radius = this.getMarkerRadius(level);
                return L.circleMarker(latlng, {
                    radius: radius,
                    fillColor: CONFIG.NETWORK_TYPES[type]?.color || '#808080',
                    color: '#ffffff', 
                    weight: window.innerWidth < 768 ? 2 : 1, // Thicker borders on mobile
                    opacity: 0.9, 
                    fillOpacity: 0.8,
                    // Make click targets larger
                    className: 'network-marker'
                });
            },
            onEachFeature: (feature, layer) => {
                const props = feature.properties;
                layer.bindTooltip(`${props.ssid} (${props.type})\n${props.level} dBm`);
                layer.on('click', () => {
                    layer.bindPopup(this.createNetworkPopup(props)).openPopup();
                });
            }
        });
        
        // Add to layer control as overlay
        this.layers.layerControl.addOverlay(this.layers.geoJsonLayer, 'Network Markers');
        this.layers.geoJsonLayer.addTo(this.map);

        if (filteredNetworks.length > maxNetworks) {
            console.log(`Showing ${networksToShow.length} of ${filteredNetworks.length} networks`);
        }
    }

    // =================
    // HELPER FUNCTIONS
    // =================

    getActiveTypes(prefix = 'filter') {
        return ['W', 'B', 'E', 'G', 'L', 'C'].filter(type => 
            document.getElementById(`${prefix}${type}`)?.checked
        );
    }

    getFilteredNetworks() {
        const activeTypes = this.getActiveTypes('markers');
        const searchTerm = document.getElementById('networkSearch')?.value?.toLowerCase() || '';
        const minSignal = parseInt(document.getElementById('signalFilter')?.value || '-100');

        // Security filters
        const securityFilters = {
            open: document.getElementById('secOpen')?.checked ?? true,
            wep: document.getElementById('secWEP')?.checked ?? true,
            wpa: document.getElementById('secWPA')?.checked ?? true,
            wpa3: document.getElementById('secWPA3')?.checked ?? true,
            hidden: document.getElementById('secHidden')?.checked ?? true
        };

        return this.data.networks.filter(network => {
            // Type filter
            if (!activeTypes.includes(network.type)) return false;
            
            // Signal filter
            if (network.level < minSignal) return false;
            
            // Search filter
            if (searchTerm && !network.ssid.toLowerCase().includes(searchTerm) && 
                !network.bssid.toLowerCase().includes(searchTerm)) return false;
            
            // Security filter (only for Wi-Fi)
            if (network.type === 'W') {
                const security = this.parseSecurityInfo(network.capabilities);
                const isHidden = !network.ssid || network.ssid === '' || network.ssid === 'Hidden Network';
                
                if (isHidden && !securityFilters.hidden) return false;
                if (!isHidden) {
                    if (security === 'Open' && !securityFilters.open) return false;
                    if (security === 'WEP' && !securityFilters.wep) return false;
                    if ((security === 'WPA' || security === 'WPA2') && !securityFilters.wpa) return false;
                    if (security === 'WPA3' && !securityFilters.wpa3) return false;
                }
            }
            
            return true;
        });
    }

    getMarkerRadius(signalLevel) {
        // Larger, more touch-friendly markers
        const baseSize = window.innerWidth < 768 ? 3 : 2; // Bigger on mobile
        if (signalLevel > -40) return 8 + baseSize;
        if (signalLevel > -60) return 7 + baseSize;
        if (signalLevel > -80) return 6 + baseSize;
        return 5 + baseSize;
    }

    createNetworkPopup(network) {
        const lastSeen = new Date(network.lasttime).toLocaleString();
        const security = this.parseSecurityInfo(network.capabilities);
        const networkType = CONFIG.NETWORK_TYPES[network.type];

        return `
            <div class="popup-content">
                <h4>${this.escapeHtml(network.ssid)}</h4>
                <div class="popup-field"><strong>Type:</strong> ${networkType?.name || network.type}</div>
                <div class="popup-field"><strong>BSSID:</strong> ${network.bssid}</div>
                <div class="popup-field"><strong>Signal:</strong> ${network.level} dBm</div>
                <div class="popup-field"><strong>Frequency:</strong> ${network.frequency} MHz</div>
                <div class="popup-field"><strong>Security:</strong> ${security}</div>
                <div class="popup-field"><strong>Last Seen:</strong> ${lastSeen}</div>
            </div>
        `;
    }

    clearLayers() {
        // Remove heatmap from both map and layer control
        if (this.layers.heatmap) {
            this.map.removeLayer(this.layers.heatmap);
            this.layers.layerControl.removeLayer(this.layers.heatmap);
            this.layers.heatmap = null;
        }
        
        // Remove markers from both map and layer control
        if (this.layers.geoJsonLayer) {
            this.map.removeLayer(this.layers.geoJsonLayer);
            this.layers.layerControl.removeLayer(this.layers.geoJsonLayer);
            this.layers.geoJsonLayer = null;
        }
    }


    // =================
    // ANALYTICS & UI
    // =================

    updateStats() {
        const networkCounts = {};
        this.data.networks.forEach(n => {
            networkCounts[n.type] = (networkCounts[n.type] || 0) + 1;
        });

        const statsHtml = `
            <div class="stats-item"><strong>Networks:</strong> ${this.data.networks.length}</div>
            <div class="stats-item"><strong>Observations:</strong> ${this.data.locations.length}</div>
            <hr style="border-color: #555; margin: 10px 0;">
            ${Object.entries(networkCounts).map(([type, count]) => 
                `<div class="stats-item">
                    <span>${CONFIG.NETWORK_TYPES[type]?.name || type}:</span>
                    <span>${count}</span>
                </div>`
            ).join('')}
        `;
        
        document.getElementById('stats').innerHTML = statsHtml;
    }

    updateAnalysis() {
        const analysis = this.generateWardrivingAnalysis();
        
        // Main discovery insights
        const insightsHtml = `
            <div class="insight-card">
                <h4>🎯 Discovery Summary</h4>
                <div class="insight-item">📊 <strong>${analysis.totalNetworks}</strong> networks discovered across <strong>${analysis.coverageArea}</strong></div>
                <div class="insight-item">📡 <strong>${analysis.wifiNetworks}</strong> Wi-Fi networks, <strong>${analysis.bluetoothDevices}</strong> Bluetooth devices</div>
                <div class="insight-item">🔐 <strong>${analysis.openNetworks}</strong> open networks found (${analysis.openPercentage}% of Wi-Fi)</div>
                <div class="insight-item">🏢 <strong>${analysis.uniqueSSIDs}</strong> unique network names discovered</div>
                ${analysis.timeInsight ? `<div class="insight-item">⏱️ ${analysis.timeInsight}</div>` : ''}
            </div>
        `;

        // Network type breakdown
        const typeBreakdownHtml = `
            <div class="analysis-section">
                <h4>📡 Network Type Discovery</h4>
                ${Object.entries(analysis.networkTypes).map(([type, data]) => `
                    <div class="bar-item">
                        <div class="bar-label">
                            <span>${CONFIG.NETWORK_TYPES[type]?.name || type}</span>
                            <span><strong>${data.count}</strong> networks</span>
                        </div>
                        <div class="bar-container">
                            <div class="bar-fill type-${type}" style="width: ${data.percentage}%"></div>
                        </div>
                        <div class="bar-insight">${this.getTypeInsight(type, data)}</div>
                    </div>
                `).join('')}
            </div>
        `;

        // Security landscape for Wi-Fi
        const securityHtml = `
            <div class="analysis-section">
                <h4>🔒 Wi-Fi Security Landscape</h4>
                ${Object.entries(analysis.wifiSecurity).map(([type, data]) => `
                    <div class="bar-item">
                        <div class="bar-label">
                            <span>${type}</span>
                            <span><strong>${data.count}</strong> networks (${data.percentage}%)</span>
                        </div>
                        <div class="bar-container">
                            <div class="bar-fill ${this.getSecurityColor(type)}" style="width: ${data.percentage}%"></div>
                        </div>
                        <div class="bar-insight">${this.getSecurityInsight(type, data)}</div>
                    </div>
                `).join('')}
            </div>
        `;

        // Most discovered networks (sighting analysis)
        const sightingsHtml = `
            <div class="analysis-section">
                <h4>📈 Most Frequently Sighted</h4>
                <div class="sightings-note">Networks you encountered most often during scanning</div>
                ${analysis.topSightings.map(network => `
                    <div class="sighting-item" onclick="app.focusOnNetwork('${network.bssid}')">
                        <div class="sighting-main">
                            <span class="sighting-ssid">${this.escapeHtml(network.ssid)}</span>
                            <span class="sighting-count">${network.sightings} sightings</span>
                        </div>
                        <div class="sighting-details">
                            ${CONFIG.NETWORK_TYPES[network.type]?.name} • ${this.parseSecurityInfo(network.capabilities)}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        // Interesting discoveries
        const findingsHtml = `
            <div class="analysis-section">
                <h4>🔍 Notable Discoveries</h4>
                ${analysis.findings.map(finding => `
                    <div class="finding-item">
                        <span class="finding-icon">${finding.icon}</span>
                        <span class="finding-text">${finding.text}</span>
                        ${finding.action ? `<span class="finding-action" onclick="${finding.action}">🎯 View</span>` : ''}
                    </div>
                `).join('')}
            </div>
        `;

        document.getElementById('detailedStats').innerHTML = insightsHtml + typeBreakdownHtml + securityHtml + sightingsHtml + findingsHtml;

        // Update categorized networks display
        this.updateTopNetworksDisplay(analysis);
    }

    generateWardrivingAnalysis() {
        const networks = this.data.networks;
        const totalNetworks = networks.length;
        
        // Separate Wi-Fi from other network types
        const wifiNetworks = networks.filter(n => n.type === 'W');
        const bluetoothNetworks = networks.filter(n => n.type === 'B' || n.type === 'E');
        const cellularNetworks = networks.filter(n => n.type === 'G' || n.type === 'L' || n.type === 'C');

        // Network type breakdown
        const networkTypes = {};
        ['W', 'B', 'E', 'G', 'L', 'C'].forEach(type => {
            const count = networks.filter(n => n.type === type).length;
            if (count > 0) {
                networkTypes[type] = {
                    count,
                    percentage: Math.round((count / totalNetworks) * 100)
                };
            }
        });

        // Wi-Fi security analysis (only for Wi-Fi networks)
        const wifiSecurityCounts = {};
        const uniqueSSIDs = new Set();
        
        wifiNetworks.forEach(network => {
            const security = this.parseSecurityInfo(network.capabilities);
            wifiSecurityCounts[security] = (wifiSecurityCounts[security] || 0) + 1;
            
            if (network.ssid && network.ssid !== '' && network.ssid !== 'Hidden Network') {
                uniqueSSIDs.add(network.ssid);
            }
        });

        const wifiSecurity = {};
        Object.entries(wifiSecurityCounts).forEach(([type, count]) => {
            wifiSecurity[type] = {
                count,
                percentage: wifiNetworks.length > 0 ? Math.round((count / wifiNetworks.length) * 100) : 0
            };
        });

        // Get sighting data from location table
        const topSightings = this.getTopSightings();

        // Coverage estimation
        const coverageArea = this.estimateCoverageArea();

        // Generate wardriving-specific findings
        const findings = this.generateWardrivingFindings(networks, wifiNetworks, bluetoothNetworks, uniqueSSIDs.size);

        // Time insights
        const timeInsight = this.generateTimeInsight();

        const openNetworks = wifiSecurityCounts['Open'] || 0;
        const openPercentage = wifiNetworks.length > 0 ? Math.round((openNetworks / wifiNetworks.length) * 100) : 0;

        return {
            totalNetworks,
            wifiNetworks: wifiNetworks.length,
            bluetoothDevices: bluetoothNetworks.length,
            cellularNetworks: cellularNetworks.length,
            uniqueSSIDs: uniqueSSIDs.size,
            openNetworks,
            openPercentage,
            coverageArea,
            networkTypes,
            wifiSecurity,
            topSightings,
            findings,
            timeInsight
        };
    }

    getTopSightings() {
        // Calculate sightings based on location data
        const sightings = {};
        
        this.data.locations.forEach(location => {
            // Find matching network
            const network = this.data.networks.find(n => 
                n.type === location.type && 
                Math.abs(n.lat - location.lat) < 0.001 && 
                Math.abs(n.lon - location.lon) < 0.001
            );
            
            if (network && network.ssid && network.ssid !== '' && network.ssid !== 'Hidden Network') {
                if (!sightings[network.bssid]) {
                    sightings[network.bssid] = {
                        ssid: network.ssid,
                        bssid: network.bssid,
                        type: network.type,
                        capabilities: network.capabilities,
                        sightings: 0
                    };
                }
                sightings[network.bssid].sightings++;
            }
        });

        // Return top 8 most sighted networks
        return Object.values(sightings)
            .sort((a, b) => b.sightings - a.sightings)
            .slice(0, 8);
    }

    generateWardrivingFindings(networks, wifiNetworks, bluetoothNetworks, uniqueSSIDs) {
        const findings = [];

        // Open network security risk
        const openNetworks = wifiNetworks.filter(n => this.parseSecurityInfo(n.capabilities) === 'Open').length;
        if (openNetworks > 5) {
            findings.push({
                icon: '⚠️',
                text: `${openNetworks} open Wi-Fi networks detected - potential security risks`,
                action: `app.showOpenNetworks()`
            });
        }

        // WEP networks (very insecure)
        const wepNetworks = wifiNetworks.filter(n => this.parseSecurityInfo(n.capabilities) === 'WEP').length;
        if (wepNetworks > 0) {
            findings.push({
                icon: '🔓',
                text: `${wepNetworks} WEP networks found - easily hackable, recommend avoiding`
            });
        }

        // WPA3 adoption
        const wpa3Networks = wifiNetworks.filter(n => this.parseSecurityInfo(n.capabilities) === 'WPA3').length;
        if (wpa3Networks > 0) {
            findings.push({
                icon: '🛡️',
                text: `${wpa3Networks} WPA3 networks found - latest security standard in use`
            });
        }

        // Bluetooth device discovery
        if (bluetoothNetworks.length > 50) {
            findings.push({
                icon: '📱',
                text: `High Bluetooth activity: ${bluetoothNetworks.length} devices discovered`
            });
        }

        // Network diversity analysis
        const diversityRatio = uniqueSSIDs / wifiNetworks.length;
        if (diversityRatio < 0.3) {
            findings.push({
                icon: '🏢',
                text: `Low network diversity detected - suggests corporate/institutional area`
            });
        } else if (diversityRatio > 0.8) {
            findings.push({
                icon: '🏘️',
                text: `High network diversity - typical residential area pattern`
            });
        }

        // Popular network names
        const commonNames = ['FRITZ!Box', 'Vodafone', 'Telekom', 'eduroam', 'Guest'];
        const foundCommon = commonNames.filter(name => 
            wifiNetworks.some(n => n.ssid && n.ssid.includes(name))
        );
        if (foundCommon.length > 2) {
            findings.push({
                icon: '🌍',
                text: `Common network patterns detected: ${foundCommon.join(', ')}`
            });
        }

        return findings.slice(0, 5);
    }

    analyzeSignalDistribution(signalLevels) {
        const distribution = {
            excellent: { count: 0, min: -20, max: -50 },
            good: { count: 0, min: -50, max: -70 },
            fair: { count: 0, min: -70, max: -85 },
            poor: { count: 0, min: -200, max: -85 }
        };

        signalLevels.forEach(level => {
            if (level >= -50) distribution.excellent.count++;
            else if (level >= -70) distribution.good.count++;
            else if (level >= -85) distribution.fair.count++;
            else distribution.poor.count++;
        });

        return distribution;
    }

    determineOverallSignalQuality(distribution) {
        const total = Object.values(distribution).reduce((sum, cat) => sum + cat.count, 0);
        if (total === 0) return 'Unknown';

        const excellentPercent = (distribution.excellent.count / total) * 100;
        const goodPercent = (distribution.good.count / total) * 100;

        if (excellentPercent > 30) return 'Excellent';
        if (excellentPercent + goodPercent > 60) return 'Good';
        if (distribution.poor.count / total < 0.5) return 'Fair';
        return 'Poor';
    }

    estimateCoverageArea() {
        if (this.data.networks.length < 10) return 'small area';
        
        const lats = this.data.networks.map(n => n.lat);
        const lons = this.data.networks.map(n => n.lon);
        
        const latRange = Math.max(...lats) - Math.min(...lats);
        const lonRange = Math.max(...lons) - Math.min(...lons);
        
        // Rough area estimation
        const area = latRange * lonRange * 111 * 111; // Convert to km²
        
        if (area < 1) return 'neighborhood';
        if (area < 10) return 'district';
        if (area < 100) return 'city area';
        return 'large region';
    }

    generateFindings(networks, uniqueSSIDs, hiddenNetworks, signalDistribution) {
        const findings = [];

        // Hidden networks
        if (hiddenNetworks > 0) {
            const percentage = Math.round((hiddenNetworks / networks.length) * 100);
            findings.push({
                icon: '🕵️',
                text: `${hiddenNetworks} hidden networks found (${percentage}%) - potentially security-conscious users`
            });
        }

        // SSID diversity
        const diversityRatio = uniqueSSIDs / networks.length;
        if (diversityRatio < 0.3) {
            findings.push({
                icon: '🏢',
                text: `Low SSID diversity suggests corporate/institutional environment with many APs`
            });
        }

        // Signal quality insights
        const poorSignalPercent = (signalDistribution.poor.count / networks.length) * 100;
        if (poorSignalPercent > 40) {
            findings.push({
                icon: '📶',
                text: `${Math.round(poorSignalPercent)}% networks have poor signal - consider moving closer or better antennas`
            });
        }

        // Open networks warning
        const openNetworks = networks.filter(n => this.parseSecurityInfo(n.capabilities) === 'Open').length;
        if (openNetworks > 10) {
            findings.push({
                icon: '⚠️',
                text: `${openNetworks} open networks detected - potential security risks in area`
            });
        }

        // Strong signal networks
        const strongNetworks = networks.filter(n => n.level && n.level > -50);
        if (strongNetworks.length > 0) {
            findings.push({
                icon: '🎯',
                text: `${strongNetworks.length} networks with excellent signal strength found`,
                action: `app.showStrongNetworks()`
            });
        }

        // Frequency congestion
        const freq24Count = networks.filter(n => this.getFrequencyBand(n.frequency) === '2.4 GHz').length;
        if (freq24Count > networks.length * 0.7) {
            findings.push({
                icon: '🚦',
                text: `High 2.4GHz congestion detected - 5GHz networks recommended for better performance`
            });
        }

        return findings.slice(0, 5); // Limit to 5 most interesting findings
    }

    generateTimeInsight() {
        if (this.data.timeRange.min === 0) return null;
        
        const duration = (this.data.timeRange.max - this.data.timeRange.min) / (1000 * 60 * 60 * 24);
        const networksPerDay = (this.data.networks.length / duration).toFixed(1);
        
        if (duration < 1) return `Discovered ${this.data.networks.length} networks in one session`;
        if (duration < 7) return `${networksPerDay} networks/day over ${Math.round(duration)} days of scanning`;
        return `Long-term data: ${Math.round(duration)} days, ${networksPerDay} networks/day average`;
    }

    updateTopNetworksDisplay(analysis) {
        // Analyze common network patterns for more detailed insights
        const commonNetworks = this.analyzeCommonNetworks();
        
        const categoriesHtml = `
            <div class="network-category">
                <h5>🏢 Common Network Patterns</h5>
                <div class="pattern-note">Frequently encountered network types in your area</div>
                ${commonNetworks.map(pattern => `
                    <div class="pattern-item">
                        <div class="pattern-header">
                            <span class="pattern-name">${pattern.name}</span>
                            <span class="pattern-count">${pattern.count} networks</span>
                        </div>
                        <div class="pattern-description">${pattern.description}</div>
                        ${pattern.examples.length > 0 ? `
                            <div class="pattern-examples">
                                <strong>Examples:</strong> ${pattern.examples.slice(0, 3).map(ex => this.escapeHtml(ex)).join(', ')}
                                ${pattern.examples.length > 3 ? ` and ${pattern.examples.length - 3} more` : ''}
                            </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        `;

        document.getElementById('topNetworks').innerHTML = categoriesHtml || 'No network pattern data available';
    }

    analyzeCommonNetworks() {
        const wifiNetworks = this.data.networks.filter(n => n.type === 'W' && n.ssid && n.ssid !== '' && n.ssid !== 'Hidden Network');
        const patterns = [];

        // FRITZ!Box analysis
        const fritzNetworks = wifiNetworks.filter(n => n.ssid.includes('FRITZ!Box'));
        if (fritzNetworks.length > 0) {
            patterns.push({
                name: 'FRITZ!Box Routers',
                count: fritzNetworks.length,
                description: 'Popular German home routers by AVM. Commonly found in residential areas across Germany and Europe.',
                examples: [...new Set(fritzNetworks.map(n => n.ssid))].slice(0, 5)
            });
        }

        // Vodafone networks
        const vodafoneNetworks = wifiNetworks.filter(n => n.ssid.toLowerCase().includes('vodafone'));
        if (vodafoneNetworks.length > 0) {
            patterns.push({
                name: 'Vodafone Networks',
                count: vodafoneNetworks.length,
                description: 'Vodafone ISP infrastructure including home routers and public hotspots. Major European telecom provider.',
                examples: [...new Set(vodafoneNetworks.map(n => n.ssid))].slice(0, 5)
            });
        }

        // Educational networks
        const eduNetworks = wifiNetworks.filter(n => 
            n.ssid.toLowerCase().includes('eduroam') || 
            n.ssid.toLowerCase().includes('campus') || 
            n.ssid.toLowerCase().includes('university') ||
            n.ssid.toLowerCase().includes('up-') // University of Potsdam pattern
        );
        if (eduNetworks.length > 0) {
            patterns.push({
                name: 'Educational Networks',
                count: eduNetworks.length,
                description: 'University and educational institution networks. Eduroam provides international academic access.',
                examples: [...new Set(eduNetworks.map(n => n.ssid))].slice(0, 5)
            });
        }

        // Public/Guest networks
        const guestNetworks = wifiNetworks.filter(n => 
            n.ssid.toLowerCase().includes('guest') || 
            n.ssid.toLowerCase().includes('public') ||
            n.ssid.toLowerCase().includes('free') ||
            n.ssid.toLowerCase().includes('hotspot')
        );
        if (guestNetworks.length > 0) {
            patterns.push({
                name: 'Guest & Public Networks',
                count: guestNetworks.length,
                description: 'Open or guest access networks for visitors. Often found in businesses, hotels, and public spaces.',
                examples: [...new Set(guestNetworks.map(n => n.ssid))].slice(0, 5)
            });
        }

        // Business/Corporate patterns
        const businessNetworks = wifiNetworks.filter(n => 
            n.ssid.toLowerCase().includes('office') || 
            n.ssid.toLowerCase().includes('corp') ||
            n.ssid.toLowerCase().includes('company') ||
            n.ssid.toLowerCase().includes('store') ||
            /^[A-Z]{2,}-[A-Z0-9]+$/.test(n.ssid) // Corporate naming pattern
        );
        if (businessNetworks.length > 0) {
            patterns.push({
                name: 'Business Networks',
                count: businessNetworks.length,
                description: 'Corporate and business networks with structured naming conventions.',
                examples: [...new Set(businessNetworks.map(n => n.ssid))].slice(0, 5)
            });
        }

        // Carrier networks (LTE/Mobile)
        const carrierNetworks = wifiNetworks.filter(n => 
            n.ssid.toLowerCase().includes('telekom') || 
            n.ssid.toLowerCase().includes('o2') ||
            n.ssid.toLowerCase().includes('lte') ||
            n.ssid.toLowerCase().includes('4g') ||
            n.ssid.toLowerCase().includes('5g')
        );
        if (carrierNetworks.length > 0) {
            patterns.push({
                name: 'Carrier Networks',
                count: carrierNetworks.length,
                description: 'Mobile carrier infrastructure and LTE/5G networks providing cellular data services.',
                examples: [...new Set(carrierNetworks.map(n => n.ssid))].slice(0, 5)
            });
        }

        // Generic/Default router names
        const defaultNetworks = wifiNetworks.filter(n => 
            /^WiFi-[A-F0-9]+$/i.test(n.ssid) ||
            /^Network-[0-9]+$/i.test(n.ssid) ||
            /^Router[0-9]*$/i.test(n.ssid) ||
            n.ssid.toLowerCase() === 'wifi' ||
            n.ssid.toLowerCase() === 'internet'
        );
        if (defaultNetworks.length > 0) {
            patterns.push({
                name: 'Default Router Names',
                count: defaultNetworks.length,
                description: 'Networks using default or generic router names, often indicating basic home setups.',
                examples: [...new Set(defaultNetworks.map(n => n.ssid))].slice(0, 5)
            });
        }

        return patterns.sort((a, b) => b.count - a.count).slice(0, 6); // Top 6 patterns
    }

    // Helper functions for analysis styling
    getSecurityColor(type) {
        const colors = {
            'WPA3': 'security-excellent',
            'WPA2': 'security-good', 
            'WPA': 'security-fair',
            'WEP': 'security-poor',
            'Open': 'security-danger'
        };
        return colors[type] || 'security-unknown';
    }

    getSecurityInsight(type, data) {
        const insights = {
            'WPA3': 'Latest security standard - excellent protection',
            'WPA2': 'Strong security - widely compatible',
            'WPA': 'Older standard - consider upgrading',
            'WEP': 'Deprecated - easily crackable',
            'Open': 'No encryption - avoid for sensitive data'
        };
        return insights[type] || 'Unknown security type';
    }

    getFrequencyInsight(band, data) {
        const insights = {
            '2.4 GHz': 'Longer range but slower speeds, often congested',
            '5 GHz': 'Faster speeds with less congestion',
            '6 GHz': 'Latest Wi-Fi 6E standard - highest performance',
            'Other': 'Non-Wi-Fi frequencies (cellular, etc.)'
        };
        return insights[band] || 'Unknown frequency band';
    }

    // Helper functions for new analysis
    getTypeInsight(type, data) {
        const insights = {
            'W': 'Wi-Fi access points and routers',
            'B': 'Bluetooth Classic devices (older standard)',
            'E': 'Bluetooth Low Energy devices (modern)',
            'G': 'GSM/UMTS cellular towers',
            'L': 'LTE/5G cellular infrastructure',
            'C': 'CDMA cellular networks'
        };
        return insights[type] || 'Unknown network type';
    }

    // Feature: Show open networks on map
    showOpenNetworks() {
        this.switchView('markers');
        // Uncheck all security except open
        document.getElementById('secOpen').checked = true;
        document.getElementById('secWEP').checked = false;
        document.getElementById('secWPA').checked = false;
        document.getElementById('secWPA3').checked = false;
        document.getElementById('secHidden').checked = false;
        this.showNetworkMarkers();
    }

    // Feature: Show strong networks on map
    showStrongNetworks() {
        this.switchView('markers');
        // Set filters to show only strong networks
        document.getElementById('signalFilter').value = -50;
        document.getElementById('signalValue').textContent = '-50 dBm';
        this.showNetworkMarkers();
    }

    updateTimeline() {
        if (this.data.timeRange.min === 0) {
            document.getElementById('timelineInfo').innerHTML = '<div>No timestamp data available</div>';
            return;
        }

        const startDate = new Date(this.data.timeRange.min).toLocaleDateString();
        const endDate = new Date(this.data.timeRange.max).toLocaleDateString();
        const durationDays = Math.ceil((this.data.timeRange.max - this.data.timeRange.min) / (1000 * 60 * 60 * 24));

        document.getElementById('timelineInfo').innerHTML = `
            <div class="analysis-item"><span>Date Range:</span><span>${startDate} - ${endDate}</span></div>
            <div class="analysis-item"><span>Duration:</span><span>${durationDays} days</span></div>
            <div class="analysis-item"><span>Networks/Day:</span><span>${(this.data.networks.length / durationDays).toFixed(1)}</span></div>
        `;

        document.getElementById('timeStart').textContent = startDate;
        document.getElementById('timeEnd').textContent = endDate;
        document.getElementById('timeCurrent').textContent = endDate;
        document.getElementById('timeSliderContainer').style.display = 'block';
    }

    // =================
    // TIMELINE FEATURES
    // =================

    updateTimeFilter(sliderValue) {
        const percentage = sliderValue / 100;
        const timeRange = this.data.timeRange.max - this.data.timeRange.min;
        const currentTime = this.data.timeRange.min + (timeRange * percentage);
        
        document.getElementById('timeCurrent').textContent = new Date(currentTime).toLocaleDateString();

        const filteredNetworks = this.data.networks.filter(n => n.lasttime <= currentTime);
        const filteredLocations = this.data.locations.filter(l => l.time <= currentTime);

        this.renderTimelineHeatmap(filteredNetworks, filteredLocations);
    }

    renderTimelineHeatmap(networks, locations) {
        this.clearLayers();
        const activeTypes = this.getActiveTypes();
        const allPoints = [];
        
        networks.filter(n => activeTypes.includes(n.type)).forEach(n => {
            allPoints.push([n.lat, n.lon, 0.8]);
        });

        locations.filter(l => activeTypes.includes(l.type)).forEach(l => {
            const intensity = Math.max(0.1, Math.min(1, (l.level + 100) / 70));
            allPoints.push([l.lat, l.lon, intensity]);
        });

        if (allPoints.length > 0) {
            this.layers.heatmap = L.heatLayer(allPoints, {
                radius: 15, blur: 20, maxZoom: 18,
                gradient: { 0.0: 'blue', 0.2: 'cyan', 0.4: 'lime', 0.6: 'yellow', 0.8: 'orange', 1.0: 'red' }
            }).addTo(this.map);
        }
    }

    animateTimeline() {
        if (this.animationTimer) {
            clearInterval(this.animationTimer);
            this.animationTimer = null;
            document.getElementById('animateTime').textContent = 'Animate Over Time';
            return;
        }

        document.getElementById('animateTime').textContent = 'Stop Animation';
        let currentValue = 0;
        
        this.animationTimer = setInterval(() => {
            currentValue += 2;
            if (currentValue > 100) currentValue = 0;
            
            document.getElementById('timeSlider').value = currentValue;
            this.updateTimeFilter(currentValue);
        }, 200);
    }

    // =================
    // UTILITY FUNCTIONS
    // =================

    centerMapOnData() {
        if (this.data.networks.length === 0) return;

        // Simple center calculation - find most dense area
        const gridSize = 0.01;
        const grid = {};

        this.data.networks.forEach(({ lat, lon }) => {
            const key = `${Math.round(lat / gridSize) * gridSize},${Math.round(lon / gridSize) * gridSize}`;
            grid[key] = (grid[key] || 0) + 1;
        });

        let maxCount = 0, centerLat = 0, centerLon = 0;
        Object.entries(grid).forEach(([key, count]) => {
            if (count > maxCount) {
                maxCount = count;
                [centerLat, centerLon] = key.split(',').map(Number);
            }
        });

        this.map.setView([centerLat, centerLon], 13);
    }

    focusOnNetwork(bssid) {
        const network = this.data.networks.find(n => n.bssid === bssid);
        if (network) {
            this.map.setView([network.lat, network.lon], 16);
            this.switchView('markers');
            document.getElementById('networkSearch').value = bssid;
            this.showNetworkMarkers();
        }
    }

    calculateTimeRange() {
        const allTimes = [
            ...this.data.networks.map(n => n.lasttime),
            ...this.data.locations.map(l => l.time)
        ].filter(t => t > 0);

        if (allTimes.length > 0) {
            this.data.timeRange.min = Math.min(...allTimes);
            this.data.timeRange.max = Math.max(...allTimes);
        }
    }

    cancelLoading() {
        this.loadingCancelled = true;
        this.showLoading(false);
        document.getElementById('fileInput').value = '';
    }

    enableControls() {
        ['updateMap', 'showMarkers', 'animateTime'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = false;
        });
    }

    // Simple utility functions
    sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    setupSidebarResize() {
        const sidebar = document.getElementById('sidebar');
        const resizeHandle = document.getElementById('resizeHandle');
        
        if (!sidebar || !resizeHandle || window.innerWidth < 768) return;

        let isResizing = false;

        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        const handleMouseMove = (e) => {
            if (!isResizing) return;
            
            const newWidth = e.clientX;
            const minWidth = 250;
            const maxWidth = 500;
            
            if (newWidth >= minWidth && newWidth <= maxWidth) {
                sidebar.style.width = newWidth + 'px';
                // Trigger map resize after sidebar resize
                setTimeout(() => {
                    if (this.map) this.map.invalidateSize();
                }, 10);
            }
        };

        const handleMouseUp = () => {
            isResizing = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }


    parseSecurityInfo(capabilities) {
        if (!capabilities) return 'Unknown';
        if (capabilities.includes('WPA3')) return 'WPA3';
        if (capabilities.includes('WPA2')) return 'WPA2';
        if (capabilities.includes('WPA')) return 'WPA';
        if (capabilities.includes('WEP')) return 'WEP';
        return 'Open';
    }

    getFrequencyBand(frequency) {
        if (frequency >= 2400 && frequency <= 2500) return '2.4 GHz';
        if (frequency >= 5000 && frequency <= 6000) return '5 GHz';
        if (frequency >= 6000 && frequency <= 7000) return '6 GHz';
        return 'Other';
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.style.display = show ? 'block' : 'none';
            if (show) document.getElementById('progressFill').style.width = '0%';
        }
    }

    updateProgress(percentage, message) {
        const text = document.getElementById('loadingText');
        const fill = document.getElementById('progressFill');
        if (text) text.textContent = message;
        if (fill) fill.style.width = `${percentage}%`;
    }
}

// Global app instance for HTML onclick handlers
let app;

document.addEventListener('DOMContentLoaded', () => {
    app = new WigleExplorer();
});