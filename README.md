# Wigle Explorer

A simple, high-performance web app for visualizing Wigle database files with interactive maps and analytics.

## Features

- **Interactive heatmaps** with density visualization
- **Canvas-rendered markers** for 100k+ networks
- **Real-time filtering** by type, signal, search
- **Timeline animation** showing data over time
- **Detailed analytics** with frequency/security analysis
- **One-click network focusing** from analysis results

## Quick Start

1. Open `index.html` in your browser
2. Select your Wigle SQLite database file
3. Explore with the 4 view tabs: Heatmap, Markers, Analysis, Timeline

## Network Types

- **W** - Wi-Fi (Red)
- **B** - Bluetooth Classic (Teal) 
- **E** - Bluetooth LE (Blue)
- **G** - GSM/UMTS (Green)
- **L** - LTE/NR (Yellow)
- **C** - CDMA (Pink)

## Performance

- Handles 100k+ networks smoothly with canvas rendering
- Smart sampling for huge datasets  
- Chunked processing prevents UI blocking
- Progress tracking with cancellation support

## Code Structure

Simple single-file architecture (`app.js`) with clean organization:
- Configuration constants at top
- Logical method grouping with comments
- Modern ES6+ but readable and maintainable
- High performance without over-engineering

Perfect for a side project - easy to understand and extend!

## Browser Support

Modern browsers with ES6+ support (Chrome 60+, Firefox 55+, Safari 12+)