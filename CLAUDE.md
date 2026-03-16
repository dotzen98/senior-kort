# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Danish senior center funding visualization — an interactive map portal showing funding allocations to senior clubs across Copenhagen. Two views: public map and admin panel.

## Running the Project

```bash
# Start the server (serves on http://localhost:8000)
.venv/Scripts/python server.py

# Convert source Excel data to JSON (only needed when xlsx changes)
.venv/Scripts/python convert_data.py
```

No build step, no npm, no test framework.

## Architecture

**Single-page app with a minimal Python backend:**

- `server.py` — Python `SimpleHTTPRequestHandler` serving static files + one endpoint: `POST /api/save` writes updated `data.json`
- `data.json` — the live dataset, auto-generated from xlsx and editable via admin
- `convert_data.py` — one-time (or ad hoc) script that reads `Overblik over beviligede puljemidler i AFF.xlsx` and produces `data.json`

**Public map view (`index.html` + `map.js` + `style.css`):**
- Leaflet.js map centered on Copenhagen; circle markers sized and colored (6-tier OrRd gradient) by total funding
- Left sidebar: search, program/year checkboxes, amount range slider
- Right panel: per-club funding breakdown shown on marker click
- All filtering is client-side in real-time

**Admin panel (`admin.html` + `admin.js` + `admin.css`):**
- Club list (left) + editor (right): name, lat/lng, funding rows keyed by `"Program Year"` strings
- Adding a club uses a mini Leaflet map to pick coordinates
- Dirty-state tracking; saves via `POST /api/save`
- Programs and year dropdowns are derived dynamically from current `data.json`

**Data schema (`data.json`):**
```json
[
  {
    "name": "Club Name",
    "lat": 55.708,
    "lng": 12.531,
    "totalFunding": 9893.28,
    "funding": {
      "Seniorklubber 2024": 5000,
      "Civilsamfunds-puljen 2025": 4893.28
    }
  }
]
```

`totalFunding` is stored explicitly and must be kept in sync with the `funding` entries (admin.js does this on save).
