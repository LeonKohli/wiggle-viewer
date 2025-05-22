class WigleExplorerApp {
    constructor() {
        this.db = null;
        this.map = null;
        this.currentView = 'heatmap';
        this.layers = {
            heatmap: null,
            markers: [],
            geoJsonLayer: null
        };
        this.data = {
            networks: [],
            locations: [],
            timeRange: { min: 0, max: 0 }
        };
        this.typeColors = {
            'W': '#FF6B6B',
            'B': '#4ECDC4', 
            'E': '#45B7D1',
            'G': '#96CEB4',
            'L': '#FECA57',
            'C': '#FF9FF3'
        };
        this.typeIcons = {};
        this.filteredData = [];
        this.animationTimer = null;
        this.loadingCancelled = false;
        this.init();
    }

    async init() {
        this.initMap();
        this.createCustomIcons();
        this.initEventListeners();
        await this.initSQLJS();
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
        // Initialize map with canvas renderer for better performance
        this.map = L.map('map', {
            preferCanvas: true,
            renderer: L.canvas({ padding: 0.5 })
        }).setView([40.7128, -74.0060], 10);
        
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '© OpenStreetMap contributors © CARTO',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(this.map);
    }

    createCustomIcons() {
        Object.entries(this.typeColors).forEach(([type, color]) => {
            this.typeIcons[type] = L.divIcon({
                className: 'custom-div-icon',
                html: `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });
        });
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

        // Heatmap controls
        document.getElementById('updateMap').addEventListener('click', () => {
            this.updateView();
        });

        // Heatmap sliders
        document.getElementById('intensitySlider').addEventListener('input', (e) => {
            document.getElementById('intensityValue').textContent = e.target.value;
            this.updateHeatmap();
        });

        document.getElementById('radiusSlider').addEventListener('input', (e) => {
            document.getElementById('radiusValue').textContent = e.target.value + 'px';
            this.updateHeatmap();
        });

        // Filter checkboxes
        ['W', 'B', 'E', 'G', 'L', 'C'].forEach(type => {
            document.getElementById(`filter${type}`).addEventListener('change', () => {
                this.updateView();
            });
        });

        // Marker controls
        document.getElementById('showMarkers').addEventListener('click', () => {
            this.showNetworkMarkers();
        });

        ['W', 'B', 'E', 'G', 'L', 'C'].forEach(type => {
            document.getElementById(`markers${type}`).addEventListener('change', () => {
                this.showNetworkMarkers();
            });
        });

        // Search
        document.getElementById('networkSearch').addEventListener('input', (e) => {
            this.searchNetworks(e.target.value);
        });

        // Signal filter
        document.getElementById('signalFilter').addEventListener('input', (e) => {
            document.getElementById('signalValue').textContent = e.target.value + ' dBm';
            this.showNetworkMarkers();
        });

        // Timeline controls
        document.getElementById('timeSlider').addEventListener('input', (e) => {
            this.updateTimeFilter(e.target.value);
        });

        document.getElementById('animateTime').addEventListener('click', () => {
            this.animateTimeline();
        });
    }

    switchView(viewName) {
        this.currentView = viewName;
        
        // Update tab appearance
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-view="${viewName}"]`).classList.add('active');

        // Update panel visibility
        document.querySelectorAll('.view-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        document.getElementById(`${viewName}-panel`).classList.add('active');

        // Update view
        this.updateView();
    }

    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.loadingCancelled = false;
        this.showLoading(true);
        this.updateProgress(0, 'Initializing...');
        
        try {
            this.updateProgress(5, 'Reading file...');
            const arrayBuffer = await file.arrayBuffer();
            
            if (this.loadingCancelled) return;
            
            this.updateProgress(15, 'Loading database...');
            const uint8Array = new Uint8Array(arrayBuffer);
            this.db = new window.SQL.Database(uint8Array);
            
            if (this.loadingCancelled) return;
            
            await this.loadData();
            
            if (this.loadingCancelled) return;
            
            this.updateProgress(85, 'Generating statistics...');
            this.updateStats();
            this.updateAnalysis();
            this.updateTimeline();
            
            this.updateProgress(95, 'Centering map...');
            this.centerMapOnData();
            this.updateView();
            this.enableControls();
            
            this.updateProgress(100, 'Complete!');
            await this.sleep(500); // Show completion briefly
            
        } catch (error) {
            if (this.loadingCancelled) {
                console.log('Loading cancelled by user');
            } else {
                console.error('Error loading database:', error);
                alert('Error loading database file. Please ensure it\'s a valid SQLite file.');
            }
        } finally {
            this.showLoading(false);
        }
    }

    cancelLoading() {
        this.loadingCancelled = true;
        this.showLoading(false);
        // Reset file input
        document.getElementById('fileInput').value = '';
    }

    enableControls() {
        document.getElementById('updateMap').disabled = false;
        document.getElementById('showMarkers').disabled = false;
        document.getElementById('animateTime').disabled = false;
    }

    async loadData() {
        this.updateProgress(20, 'Loading network data...');
        
        // Load network data with optimized query
        const networkQuery = `
            SELECT type, lastlat as lat, lastlon as lon, bestlevel, ssid, bssid, lasttime, frequency, capabilities
            FROM network 
            WHERE lastlat != 0 AND lastlon != 0
            ORDER BY lasttime DESC
        `;
        
        const networkResults = this.db.exec(networkQuery);
        if (networkResults.length > 0 && !this.loadingCancelled) {
            this.data.networks = [];
            const chunkSize = 2000; // Larger chunks for better performance
            const totalRows = networkResults[0].values.length;
            
            for (let i = 0; i < totalRows; i += chunkSize) {
                if (this.loadingCancelled) return;
                
                const chunk = networkResults[0].values.slice(i, i + chunkSize);
                const processedChunk = chunk.map(row => ({
                    type: row[0],
                    lat: row[1],
                    lon: row[2],
                    level: row[3],
                    ssid: row[4] || 'Hidden Network',
                    bssid: row[5],
                    lasttime: row[6],
                    frequency: row[7],
                    capabilities: row[8] || ''
                }));
                
                this.data.networks.push(...processedChunk);
                
                const progress = 20 + Math.round((i + chunkSize) / totalRows * 25); // 20-45%
                this.updateProgress(Math.min(progress, 45), `Processing ${this.data.networks.length} networks...`);
                
                if (i % (chunkSize * 2) === 0) { // Yield less frequently
                    await this.sleep(1);
                }
            }
        }

        if (this.loadingCancelled) return;
        
        this.updateProgress(50, 'Loading observation data...');
        
        // Optimized location query with sampling
        const locationCountQuery = `SELECT COUNT(*) FROM location WHERE lat != 0 AND lon != 0`;
        const countResult = this.db.exec(locationCountQuery);
        const locationCount = countResult[0]?.values[0][0] || 0;
        
        let locationQuery;
        if (locationCount > 15000) {
            // More aggressive sampling for very large datasets
            const sampleRate = Math.ceil(locationCount / 15000);
            locationQuery = `
                SELECT l.lat, l.lon, l.level, n.type, l.time
                FROM location l
                JOIN network n ON l.bssid = n.bssid
                WHERE l.lat != 0 AND l.lon != 0 AND l._id % ${sampleRate} = 0
                LIMIT 15000
            `;
        } else {
            locationQuery = `
                SELECT l.lat, l.lon, l.level, n.type, l.time
                FROM location l
                JOIN network n ON l.bssid = n.bssid
                WHERE l.lat != 0 AND l.lon != 0
            `;
        }
        
        const locationResults = this.db.exec(locationQuery);
        if (locationResults.length > 0 && !this.loadingCancelled) {
            this.data.locations = [];
            const chunkSize = 3000; // Even larger chunks
            const totalRows = locationResults[0].values.length;
            
            for (let i = 0; i < totalRows; i += chunkSize) {
                if (this.loadingCancelled) return;
                
                const chunk = locationResults[0].values.slice(i, i + chunkSize);
                const processedChunk = chunk.map(row => ({
                    lat: row[0],
                    lon: row[1],
                    level: row[2],
                    type: row[3],
                    time: row[4]
                }));
                
                this.data.locations.push(...processedChunk);
                
                const progress = 50 + Math.round((i + chunkSize) / totalRows * 25); // 50-75%
                this.updateProgress(Math.min(progress, 75), `Processing ${this.data.locations.length} observations...`);
                
                if (i % (chunkSize * 2) === 0) {
                    await this.sleep(1);
                }
            }
        }

        if (this.loadingCancelled) return;
        
        this.updateProgress(80, 'Calculating time range...');
        
        // Optimize time range calculation - just get min/max directly
        if (this.data.networks.length > 0) {
            const networkTimes = this.data.networks.map(n => n.lasttime).filter(t => t > 0);
            const locationTimes = this.data.locations.map(l => l.time).filter(t => t > 0);
            
            if (networkTimes.length > 0 || locationTimes.length > 0) {
                this.data.timeRange.min = Math.min(
                    ...(networkTimes.length > 0 ? networkTimes : [Infinity]),
                    ...(locationTimes.length > 0 ? locationTimes : [Infinity])
                );
                this.data.timeRange.max = Math.max(
                    ...(networkTimes.length > 0 ? networkTimes : [-Infinity]),
                    ...(locationTimes.length > 0 ? locationTimes : [-Infinity])
                );
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    updateLoadingMessage(message) {
        const loadingText = document.getElementById('loadingText');
        if (loadingText) {
            loadingText.textContent = message;
        }
    }

    updateProgress(percentage, message) {
        const loadingText = document.getElementById('loadingText');
        const progressFill = document.getElementById('progressFill');
        
        if (loadingText) {
            loadingText.textContent = message;
        }
        if (progressFill) {
            progressFill.style.width = `${percentage}%`;
        }
    }

    centerMapOnData() {
        const allPoints = [];
        
        this.data.networks.forEach(item => {
            allPoints.push([item.lat, item.lon]);
        });
        
        if (allPoints.length > 0) {
            const gridSize = 0.01;
            const grid = {};
            
            allPoints.forEach(([lat, lon]) => {
                const gridLat = Math.round(lat / gridSize) * gridSize;
                const gridLon = Math.round(lon / gridSize) * gridSize;
                const key = `${gridLat},${gridLon}`;
                grid[key] = (grid[key] || 0) + 1;
            });
            
            let maxCount = 0;
            let centerLat = 0;
            let centerLon = 0;
            
            Object.entries(grid).forEach(([key, count]) => {
                if (count > maxCount) {
                    maxCount = count;
                    const [lat, lon] = key.split(',').map(Number);
                    centerLat = lat;
                    centerLon = lon;
                }
            });
            
            this.map.setView([centerLat, centerLon], 13);
        }
    }

    updateView() {
        this.clearLayers();
        
        switch (this.currentView) {
            case 'heatmap':
                this.updateHeatmap();
                break;
            case 'markers':
                this.showNetworkMarkers();
                break;
            case 'analysis':
                // Analysis view doesn't need map updates
                break;
            case 'timeline':
                this.updateTimeFilter(document.getElementById('timeSlider').value);
                break;
        }
    }

    clearLayers() {
        if (this.layers.heatmap) {
            this.map.removeLayer(this.layers.heatmap);
            this.layers.heatmap = null;
        }
        
        this.layers.markers.forEach(marker => {
            this.map.removeLayer(marker);
        });
        this.layers.markers = [];

        if (this.layers.geoJsonLayer) {
            this.map.removeLayer(this.layers.geoJsonLayer);
            this.layers.geoJsonLayer = null;
        }
    }

    getActiveTypes(prefix = 'filter') {
        return ['W', 'B', 'E', 'G', 'L', 'C'].filter(type => 
            document.getElementById(`${prefix}${type}`)?.checked
        );
    }

    updateHeatmap() {
        if (this.layers.heatmap) {
            this.map.removeLayer(this.layers.heatmap);
        }

        const activeTypes = this.getActiveTypes();
        if (activeTypes.length === 0) return;

        const intensity = parseFloat(document.getElementById('intensitySlider').value);
        const radius = parseInt(document.getElementById('radiusSlider').value);

        const allPoints = [];
        const maxPoints = 25000; // Limit points for performance
        
        // Sample networks if too many
        const filteredNetworks = this.data.networks.filter(item => activeTypes.includes(item.type));
        const networkStep = Math.max(1, Math.ceil(filteredNetworks.length / (maxPoints * 0.3)));
        
        for (let i = 0; i < filteredNetworks.length; i += networkStep) {
            const item = filteredNetworks[i];
            allPoints.push([item.lat, item.lon, 0.8 * intensity]);
        }

        // Sample locations if too many
        const filteredLocations = this.data.locations.filter(item => activeTypes.includes(item.type));
        const locationStep = Math.max(1, Math.ceil(filteredLocations.length / (maxPoints * 0.7)));
        
        for (let i = 0; i < filteredLocations.length; i += locationStep) {
            const item = filteredLocations[i];
            const pointIntensity = Math.max(0.1, Math.min(1, (item.level + 100) / 70)) * intensity;
            allPoints.push([item.lat, item.lon, pointIntensity]);
        }

        if (allPoints.length > 0) {
            this.layers.heatmap = L.heatLayer(allPoints, {
                radius: radius,
                blur: Math.max(10, radius - 5),
                maxZoom: 18,
                gradient: {
                    0.0: 'blue',
                    0.2: 'cyan', 
                    0.4: 'lime',
                    0.6: 'yellow',
                    0.8: 'orange',
                    1.0: 'red'
                }
            }).addTo(this.map);
        }
    }

    showNetworkMarkers() {
        this.clearLayers();

        const activeTypes = this.getActiveTypes('markers');
        const searchTerm = document.getElementById('networkSearch').value.toLowerCase();
        const minSignal = parseInt(document.getElementById('signalFilter').value);

        let filteredNetworks = this.data.networks.filter(network => {
            if (!activeTypes.includes(network.type)) return false;
            if (network.level < minSignal) return false;
            if (searchTerm && !network.ssid.toLowerCase().includes(searchTerm) && 
                !network.bssid.toLowerCase().includes(searchTerm)) return false;
            return true;
        });

        // Always use high-performance GeoJSON canvas rendering
        this.showCanvasGeoJsonMarkers(filteredNetworks);
    }

    showCanvasGeoJsonMarkers(networks) {
        const maxNetworks = 100000; // Can handle much more with canvas
        const networksToShow = networks.slice(0, maxNetworks);

        // Convert networks to GeoJSON format
        const geoJsonData = {
            type: 'FeatureCollection',
            features: networksToShow.map(network => ({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [network.lon, network.lat]
                },
                properties: {
                    type: network.type,
                    ssid: network.ssid,
                    bssid: network.bssid,
                    level: network.level,
                    frequency: network.frequency,
                    capabilities: network.capabilities,
                    lasttime: network.lasttime
                }
            }))
        };

        // Create high-performance GeoJSON layer with canvas renderer
        this.layers.geoJsonLayer = L.geoJSON(geoJsonData, {
            pointToLayer: (feature, latlng) => {
                const networkType = feature.properties.type;
                return L.circleMarker(latlng, {
                    radius: this.getMarkerRadius(feature.properties.level),
                    fillColor: this.typeColors[networkType],
                    color: '#ffffff',
                    weight: 1,
                    opacity: 0.8,
                    fillOpacity: 0.7
                });
            },
            onEachFeature: (feature, layer) => {
                // Add hover tooltip
                const props = feature.properties;
                const tooltipContent = `${props.ssid} (${props.type})\n${props.level} dBm`;
                layer.bindTooltip(tooltipContent, { 
                    permanent: false, 
                    direction: 'top' 
                });

                // Add click popup
                layer.on('click', () => {
                    const popup = this.createNetworkPopupFromGeoJson(props);
                    layer.bindPopup(popup).openPopup();
                });
            }
        }).addTo(this.map);

        console.log(`Rendered ${networksToShow.length} networks using high-performance canvas GeoJSON`);
        
        if (networks.length > maxNetworks) {
            alert(`Showing ${networksToShow.length} of ${networks.length} networks. Use filters to narrow results.`);
        }
    }

    getMarkerRadius(signalLevel) {
        // Dynamic radius based on signal strength
        if (signalLevel > -40) return 6;
        if (signalLevel > -60) return 5;
        if (signalLevel > -80) return 4;
        return 3;
    }

    createNetworkPopupFromGeoJson(properties) {
        const lastSeen = new Date(properties.lasttime).toLocaleString();
        const security = this.parseSecurityInfo(properties.capabilities);
        
        return `
            <div class="popup-content">
                <h4>${this.escapeHtml(properties.ssid)}</h4>
                <div class="popup-field"><strong>Type:</strong> ${this.getTypeDescription(properties.type)}</div>
                <div class="popup-field"><strong>BSSID:</strong> ${properties.bssid}</div>
                <div class="popup-field"><strong>Signal:</strong> ${properties.level} dBm</div>
                <div class="popup-field"><strong>Frequency:</strong> ${properties.frequency} MHz</div>
                <div class="popup-field"><strong>Security:</strong> ${security}</div>
                <div class="popup-field"><strong>Last Seen:</strong> ${lastSeen}</div>
            </div>
        `;
    }


    createNetworkPopup(network) {
        const lastSeen = new Date(network.lasttime).toLocaleString();
        const security = this.parseSecurityInfo(network.capabilities);
        
        return `
            <div class="popup-content">
                <h4>${this.escapeHtml(network.ssid)}</h4>
                <div class="popup-field"><strong>Type:</strong> ${this.getTypeDescription(network.type)}</div>
                <div class="popup-field"><strong>BSSID:</strong> ${network.bssid}</div>
                <div class="popup-field"><strong>Signal:</strong> ${network.level} dBm</div>
                <div class="popup-field"><strong>Frequency:</strong> ${network.frequency} MHz</div>
                <div class="popup-field"><strong>Security:</strong> ${security}</div>
                <div class="popup-field"><strong>Last Seen:</strong> ${lastSeen}</div>
                <div class="popup-field"><strong>Location:</strong> ${network.lat.toFixed(6)}, ${network.lon.toFixed(6)}</div>
            </div>
        `;
    }

    parseSecurityInfo(capabilities) {
        if (!capabilities) return 'Unknown';
        if (capabilities.includes('WPA3')) return 'WPA3';
        if (capabilities.includes('WPA2')) return 'WPA2';
        if (capabilities.includes('WPA')) return 'WPA';
        if (capabilities.includes('WEP')) return 'WEP';
        return 'Open';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    searchNetworks(searchTerm) {
        if (this.currentView === 'markers') {
            this.showNetworkMarkers();
        }
    }

    updateStats() {
        const networkCounts = {};
        const securityCounts = {};
        let totalObservations = this.data.locations.length;
        
        this.data.networks.forEach(item => {
            networkCounts[item.type] = (networkCounts[item.type] || 0) + 1;
            const security = this.parseSecurityInfo(item.capabilities);
            securityCounts[security] = (securityCounts[security] || 0) + 1;
        });

        const statsHtml = `
            <div class="stats-item"><strong>Networks Found:</strong> ${this.data.networks.length}</div>
            <div class="stats-item"><strong>Observations:</strong> ${totalObservations}</div>
            <hr style="border-color: #555; margin: 10px 0;">
            ${Object.entries(networkCounts).map(([type, count]) => 
                `<div class="stats-item">
                    <span>${this.getTypeDescription(type)}:</span>
                    <span>${count}</span>
                </div>`
            ).join('')}
        `;
        
        document.getElementById('stats').innerHTML = statsHtml;
    }

    updateAnalysis() {
        if (this.data.networks.length === 0) {
            document.getElementById('detailedStats').innerHTML = '<div>No network data available</div>';
            document.getElementById('topNetworks').innerHTML = '<div>No network data available</div>';
            return;
        }

        const frequencyBands = {};
        const securityTypes = {};
        let signalStats = { min: 0, max: -200, total: 0, count: 0 };

        // Optimized single pass through networks
        this.data.networks.forEach(network => {
            // Frequency analysis
            if (network.frequency) {
                const band = this.getFrequencyBand(network.frequency);
                frequencyBands[band] = (frequencyBands[band] || 0) + 1;
            }

            // Security analysis
            const security = this.parseSecurityInfo(network.capabilities);
            securityTypes[security] = (securityTypes[security] || 0) + 1;

            // Signal strength analysis
            if (network.level !== undefined && network.level !== null) {
                if (network.level > signalStats.max) signalStats.max = network.level;
                if (signalStats.count === 0 || network.level < signalStats.min) signalStats.min = network.level;
                signalStats.total += network.level;
                signalStats.count++;
            }
        });

        const avgSignal = signalStats.count > 0 ? (signalStats.total / signalStats.count).toFixed(1) : 'N/A';

        const analysisHtml = `
            <div class="analysis-item"><span>Average Signal:</span><span>${avgSignal} dBm</span></div>
            <div class="analysis-item"><span>Signal Range:</span><span>${signalStats.min} to ${signalStats.max} dBm</span></div>
            <hr style="border-color: #555; margin: 10px 0;">
            <h4 style="color: #81C784; margin: 10px 0;">Frequency Bands</h4>
            ${Object.entries(frequencyBands).map(([band, count]) => 
                `<div class="analysis-item"><span>${band}:</span><span>${count}</span></div>`
            ).join('')}
            <hr style="border-color: #555; margin: 10px 0;">
            <h4 style="color: #81C784; margin: 10px 0;">Security Types</h4>
            ${Object.entries(securityTypes).map(([type, count]) => 
                `<div class="analysis-item"><span>${type}:</span><span>${count}</span></div>`
            ).join('')}
        `;

        document.getElementById('detailedStats').innerHTML = analysisHtml;

        // Simplified top networks - just show top by signal strength
        const topNetworks = this.data.networks
            .filter(n => n.level && n.ssid !== 'Hidden Network')
            .sort((a, b) => b.level - a.level)
            .slice(0, 10);

        const topNetworksHtml = topNetworks.map(network => `
            <div class="network-details" onclick="app.focusOnNetwork('${network.bssid}')">
                <div class="network-title">${this.escapeHtml(network.ssid)}</div>
                <div class="network-info">
                    ${network.bssid} • ${network.level} dBm<br>
                    ${this.getTypeDescription(network.type)} • ${this.parseSecurityInfo(network.capabilities)}
                </div>
            </div>
        `).join('');

        document.getElementById('topNetworks').innerHTML = topNetworks.length > 0 ? topNetworksHtml : 'No network data available';
    }

    focusOnNetwork(bssid) {
        const network = this.data.networks.find(n => n.bssid === bssid);
        if (network) {
            this.map.setView([network.lat, network.lon], 16);
            
            // Switch to markers view and show this network
            this.switchView('markers');
            document.getElementById('networkSearch').value = bssid;
            this.showNetworkMarkers();
        }
    }

    getFrequencyBand(frequency) {
        if (frequency >= 2400 && frequency <= 2500) return '2.4 GHz';
        if (frequency >= 5000 && frequency <= 6000) return '5 GHz';
        if (frequency >= 6000 && frequency <= 7000) return '6 GHz';
        if (frequency >= 900 && frequency <= 1000) return '900 MHz';
        if (frequency >= 1800 && frequency <= 2000) return '1800 MHz';
        return 'Other';
    }

    updateTimeline() {
        if (this.data.timeRange.min === 0) {
            document.getElementById('timelineInfo').innerHTML = '<div>No timestamp data available</div>';
            return;
        }

        const startDate = new Date(this.data.timeRange.min).toLocaleDateString();
        const endDate = new Date(this.data.timeRange.max).toLocaleDateString();
        const duration = Math.ceil((this.data.timeRange.max - this.data.timeRange.min) / (1000 * 60 * 60 * 24));

        document.getElementById('timelineInfo').innerHTML = `
            <div class="analysis-item"><span>Date Range:</span><span>${startDate} - ${endDate}</span></div>
            <div class="analysis-item"><span>Duration:</span><span>${duration} days</span></div>
            <div class="analysis-item"><span>Networks per Day:</span><span>${(this.data.networks.length / duration).toFixed(1)}</span></div>
        `;

        document.getElementById('timeStart').textContent = startDate;
        document.getElementById('timeEnd').textContent = endDate;
        document.getElementById('timeCurrent').textContent = endDate;
        document.getElementById('timeSliderContainer').style.display = 'block';
    }

    updateTimeFilter(sliderValue) {
        const percentage = sliderValue / 100;
        const timeRange = this.data.timeRange.max - this.data.timeRange.min;
        const currentTime = this.data.timeRange.min + (timeRange * percentage);
        
        document.getElementById('timeCurrent').textContent = new Date(currentTime).toLocaleDateString();

        // Filter data by time and update visualization
        const filteredNetworks = this.data.networks.filter(n => n.lasttime <= currentTime);
        const filteredLocations = this.data.locations.filter(l => l.time <= currentTime);

        // Update heatmap with filtered data
        this.updateTimelineHeatmap(filteredNetworks, filteredLocations);
    }

    updateTimelineHeatmap(networks, locations) {
        if (this.layers.heatmap) {
            this.map.removeLayer(this.layers.heatmap);
        }

        const activeTypes = this.getActiveTypes();
        const allPoints = [];
        
        networks
            .filter(item => activeTypes.includes(item.type))
            .forEach(item => {
                allPoints.push([item.lat, item.lon, 0.8]);
            });

        locations
            .filter(item => activeTypes.includes(item.type))
            .forEach(item => {
                const intensity = Math.max(0.1, Math.min(1, (item.level + 100) / 70));
                allPoints.push([item.lat, item.lon, intensity]);
            });

        if (allPoints.length > 0) {
            this.layers.heatmap = L.heatLayer(allPoints, {
                radius: 15,
                blur: 20,
                maxZoom: 18,
                gradient: {
                    0.0: 'blue',
                    0.2: 'cyan',
                    0.4: 'lime', 
                    0.6: 'yellow',
                    0.8: 'orange',
                    1.0: 'red'
                }
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
            if (currentValue > 100) {
                currentValue = 0;
            }
            
            document.getElementById('timeSlider').value = currentValue;
            this.updateTimeFilter(currentValue);
        }, 200);
    }

    getTypeDescription(type) {
        const descriptions = {
            'W': 'Wi-Fi',
            'B': 'Bluetooth Classic', 
            'E': 'Bluetooth LE',
            'G': 'GSM/UMTS',
            'L': 'LTE/NR',
            'C': 'CDMA'
        };
        return descriptions[type] || type;
    }

    showLoading(show) {
        const loadingElement = document.getElementById('loading');
        if (loadingElement) {
            loadingElement.style.display = show ? 'block' : 'none';
            if (show) {
                // Reset progress bar when showing
                const progressFill = document.getElementById('progressFill');
                if (progressFill) {
                    progressFill.style.width = '0%';
                }
            }
        }
    }
}

// Global app instance for access from HTML onclick handlers
let app;

document.addEventListener('DOMContentLoaded', () => {
    app = new WigleExplorerApp();
});