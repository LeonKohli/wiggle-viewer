# Wigle Data Heatmap Viewer

An interactive web application for visualizing Wigle database data on a heatmap.

## Features

- Import SQLite Wigle database files
- Interactive heatmap visualization using Leaflet
- Filter by network types (Wi-Fi, Bluetooth, Cellular)
- Real-time statistics display
- Dark theme optimized for data visualization

## Network Types Supported

- **W** - Wi-Fi (Red)
- **B** - Bluetooth Classic (Teal)
- **E** - Bluetooth Low Energy (Blue)
- **G** - GSM/UMTS 2G & 3G (Green)
- **L** - LTE/NR 4G & 5G (Yellow)
- **C** - CDMA (Pink)

## Usage

1. Open `index.html` in a web browser
2. Click "Click to select SQLite database file" and choose your Wigle database
3. Wait for the data to load
4. Use the checkboxes to filter network types
5. Click "Update Heatmap" to refresh the visualization

## Technical Details

- Uses Leaflet.js for mapping
- SQL.js for SQLite database reading in browser
- Leaflet.heat for heatmap generation
- Signal strength data influences heatmap intensity
- Combines network discovery points with observation data

The heatmap intensity is calculated based on signal strength measurements, with stronger signals appearing more intensely on the map.