**Play:** https://kaanyaren.github.io/PixelArtIstanbul/

# PixelArt Istanbul

Walkable, procedurally rendered pixel-art map of Istanbul in the browser. Built with [Phaser 3](https://phaser.io/) and [Vite](https://vite.dev/). Default area: Darphane / Beşiktaş; any area in Istanbul (and beyond) can be loaded by dropping a pin.

![Fractal Darphane](https://img.shields.io/badge/status-live-brightgreen) ![Phaser 3](https://img.shields.io/badge/phaser-3.80-blue) ![Vite](https://img.shields.io/badge/vite-6.x-646CFF)

## Features

- **Isometric city view** — roads, pavements, parks/green space, water, and buildings drawn from real map geometry.
- **Procedural pixel-art buildings** — per-type facades (ottoman/apartment/block/civic/industrial/religious), hip/tile/zinc/flat roofs with ridges, kumtaş base courses, windows, balconies, shopfronts, domes/minarets.
- **Street life** — walkers, cats, dogs, cars (incl. taxi/dolmuş), simitçi cart, gulls; day/golden/night moods.
- **Points of interest** — benches, lamps, fountains, cafés/shops, transit stops, trees and other OSM POIs rendered as props with labels.
- **Any location** — “Change area” pin drop (Leaflet + Nominatim search) fetches live OSM data (+ supplemental Microsoft building footprints where available).
- **HUD & controls** — minimap, area stats, zoom, fullscreen, recenter, help, settings (speed, zoom, time of day, labels, street life density, radius).
- **Shareable URL** — `?lat=<lat>&lon=<lon>` opens a specific pin.

## Controls

| Input | Action |
|---|---|
| `WASD` / Arrow keys | Walk (screen-relative) |
| Mouse wheel / `+` `−` | Zoom |
| On-screen D-pad | Touch walk |
| `☀️ Day` / `🌅 Golden` / `🌙 Night` | Time of day |
| `📍 Change area` | Pick/search any area |
| `⚙️ Settings` | Speed, zoom, labels, street life, radius |
| `?` / `⛶` / `⌖` | Help, fullscreen, recenter on pin |

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # production build -> dist/
npm run preview  # preview dist/
```

## Data

- Default dataset: `public/data/darphane.json` (v2: `buildings`, `roads`, `greens`, `waters`, `pois`).
- Regenerate the Darphane snapshot: `npm run data:fetch` (`scripts/fetch-darphane.mjs`, merges sources).
- Live “Change area” loads: browser fetch from OpenStreetMap API / Overpass + pre-baked MS building cells (`public/data/ms/*.json`) when present.

## Deploy

GitHub Actions workflow `.github/workflows/deploy.yml` builds and deploys `dist/` to GitHub Pages on push to `main`.

## Attribution

- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).
- Building footprints: [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints), [CDLA-2.0](https://cdla.dev/permissive-2-0/) (supplemental, where used).

## License

No license file is included in this repository yet. Map/building data above are used under their respective licenses.
