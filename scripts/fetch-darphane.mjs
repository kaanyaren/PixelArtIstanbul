#!/usr/bin/env node
// Fetch Darphane building/road footprints from OpenStreetMap main API.
// Stdlib only (Node 20+). No keys. Free. Source: OpenStreetMap, ODbL.
// Uses api.openstreetmap.org/api/0.6/map (Overpass 406/timeout locally).
// ponytail: Overture/Mapillary skipped until OSM proves thin
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CENTER = { lat: 41.0615, lon: 29.0125 };
const BBOX = { south: 41.057009, west: 29.006548, north: 41.065991, east: 29.018452 };
const MINT = { lat: 41.0578261, lon: 29.0082127 }; // Darphane ve Damga Matbaası (Nominatim)
const MS_URL =
  "https://bfppub.z5.web.core.windows.net/2026-08-13/global-buildings.geojsonl/RegionName=Turkey/quadkey=120323223/part-00092-110f5303-ff85-4c71-a2bf-c6070024fec8.c000.csv.gz";
const MS_CACHE = resolve(dirname(fileURLToPath(import.meta.url)), ".cache/ms-120323223.csv.gz");
const OSM_API = "https://api.openstreetmap.org/api/0.6/map";
const DEFAULT_OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public/data/darphane.json",
);

function help() {
  console.log(`fetch-darphane.mjs — fetch OSM footprints for Darphane tile

Usage:
  node scripts/fetch-darphane.mjs [--out <path>] [--dry-run] [--help]

Defaults:
  --out  ${DEFAULT_OUT}
  bbox    ${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east} (center ${CENTER.lat},${CENTER.lon}, r 500m)

Source: OpenStreetMap main API (${OSM_API}?bbox=${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}), license ODbL.
Plus Microsoft Global ML footprints tile (CDLA-2.0) cached to scripts/.cache, merged for OSM gaps.
On network failure: keeps existing JSON, warns, exits 0.`);
}

function parseNum(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function footprintArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

// Minimal OSM XML parse via regex (stdlib only, no deps).
function parseOsmXml(xml) {
  const nodes = new Map();
  for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
    const t = m[0];
    const id = /id="(-?\d+)"/.exec(t)?.[1];
    const lat = /lat="([\d.\-]+)"/.exec(t)?.[1];
    const lon = /lon="([\d.\-]+)"/.exec(t)?.[1];
    if (id && lat && lon) nodes.set(id, [parseFloat(lon), parseFloat(lat)]);
  }
  const buildings = [];
  const roads = [];
  for (const m of xml.matchAll(/<way\b[^>]*id="(-?\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const id = m[1];
    const body = m[2];
    const refs = [...body.matchAll(/<nd\b[^>]*ref="(-?\d+)"/g)].map((r) => r[1]);
    const tags = {};
    for (const t of body.matchAll(/<tag\b[^>]*k="([^"]+)"[^>]*v="([^"]*)"/g)) tags[t[1]] = t[2];
    const pts = refs.map((r) => nodes.get(r)).filter(Boolean);
    if (pts.length < 2) continue;
    if (tags.building) {
      const h = parseNum(tags.height ?? tags["building:height"]);
      const lv = parseNum(tags["building:levels"]);
      const levels = lv ?? (h != null ? Math.max(1, Math.round(h / 3)) : 3);
      const height = h ?? levels * 3 ?? 9;
      buildings.push({
        id: `w${id}`,
        pts,
        levels,
        height,
        color: tags["building:colour"] ?? tags.colour ?? tags.color ?? null,
      });
    } else if (tags.highway) {
      if (/^(residential|service|footway|steps|pedestrian|path|living_street|unclassified|tertiary|secondary)$/.test(tags.highway))
        roads.push({ id: `w${id}`, pts, name: tags.name ?? null, kind: tags.highway, refs });
    }
  }
  // associatedStreet relations: street name lives on the relation, not the ways.
  const relNames = new Map(); // wayId -> name
  for (const m of xml.matchAll(/<relation\b[^>]*>([\s\S]*?)<\/relation>/g)) {
    const body = m[1];
    const tags = {};
    for (const t of body.matchAll(/<tag\b[^>]*k="([^"]+)"[^>]*v="([^"]*)"/g)) tags[t[1]] = t[2];
    if (tags.type === 'associatedStreet' && tags.name) {
      for (const w of body.matchAll(/<member\b[^>]*type="way"[^>]*ref="(-?\d+)"/g)) {
        if (!relNames.has(w[1])) relNames.set(w[1], tags.name);
      }
    }
  }
  for (const r of roads) {
    if (!r.name) {
      const wid = r.id.slice(1);
      if (relNames.has(wid)) {
        r.name = relNames.get(wid);
        r.fromRelation = true;
      }
    }
  }
  const nodeNames = new Map();
  for (const r of roads) {
    if (!r.name) continue;
    for (const n of r.refs) {
      if (!nodeNames.has(n)) nodeNames.set(n, new Map());
      const m = nodeNames.get(n);
      m.set(r.name, (m.get(r.name) ?? 0) + 1);
    }
  }
  for (const r of roads) {
    if (r.name || r.kind === 'footway' || r.kind === 'steps' || r.kind === 'path') continue;
    const votes = new Map();
    for (const n of r.refs) {
      const m = nodeNames.get(n);
      if (m) for (const [nm, c] of m) votes.set(nm, (votes.get(nm) ?? 0) + c);
    }
    const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length && sorted[0][1] >= 2 && (sorted.length < 2 || sorted[0][1] >= 2 * sorted[1][1])) {
      r.name = sorted[0][0];
      r.inferred = true;
    }
    delete r.refs;
  }
  for (const r of roads) delete r.refs;
  buildings.sort((a, b) => footprintArea(b.pts) - footprintArea(a.pts));
  // Darphane landmark: biggest footprint within 100m of the Mint.
  {
    const kx = 111320 * Math.cos((CENTER.lat * Math.PI) / 180);
    const dx = (lon) => (lon - MINT.lon) * kx;
    const dy = (lat) => (MINT.lat - lat) * 111320;
    let bestB = null;
    let bestA = -1;
    for (const b of buildings) {
      let sx = 0;
      let sy = 0;
      for (const [lo, la] of b.pts) {
        sx += dx(lo);
        sy += dy(la);
      }
      const cx = sx / b.pts.length;
      const cy = sy / b.pts.length;
      if (Math.hypot(cx, cy) < 100) {
        const a = footprintArea(b.pts);
        if (a > bestA) {
          bestA = a;
          bestB = b;
        }
      }
    }
    if (bestB) bestB.landmark = 'DARPHANE';
  }
  return {
    meta: { center: CENTER, bbox: BBOX, source: "OpenStreetMap ODbL", sources: ["OpenStreetMap ODbL"] },
    buildings: buildings.slice(0, 500),
    roads,
  };
}

// Microsoft Global ML footprints (CDLA-2.0): extra source for OSM gaps.
// Cached tile download; stream-filtered to bbox; deduped vs OSM by centroid.
async function fetchMsSupplement(osmBuildings) {
  const { createGunzip } = await import('node:zlib');
  const { pipeline } = await import('node:stream/promises');
  const { createWriteStream, createReadStream, existsSync, statSync } = await import('node:fs');
  mkdirSync(dirname(MS_CACHE), { recursive: true });
  if (!existsSync(MS_CACHE)) {
    console.log('ms: downloading tile (40MB, once)...');
    const res = await fetch(MS_URL, { headers: { 'User-Agent': 'PixelArtIstanbul/0.1' } });
    if (!res.ok) throw new Error(`MS HTTP ${res.status}`);
    await pipeline(res.body, createWriteStream(MS_CACHE));
    console.log(`ms: cached ${Math.round(statSync(MS_CACHE).size / 1e6)}MB`);
  }
  // OSM centroid grid for overlap skip.
  const grid = new Map();
  const gk = (x, y) => `${Math.round(x * 500)},${Math.round(y * 500)}`;
  for (const b of osmBuildings) {
    let sx = 0;
    let sy = 0;
    for (const [lo, la] of b.pts) {
      sx += lo;
      sy += la;
    }
    const cx = sx / b.pts.length;
    const cy = sy / b.pts.length;
    const k = gk(cx, cy);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(b);
  }
  const inOsm = (cx, cy) => {
    const gx = Math.round(cx * 500);
    const gy = Math.round(cy * 500);
    for (let ix = -1; ix <= 1; ix++)
      for (let iy = -1; iy <= 1; iy++) {
        const cell = grid.get(`${gx + ix},${gy + iy}`);
        if (!cell) continue;
        for (const b of cell) {
          let inside = false;
          const p = b.pts;
          for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
            const [xi, yi] = p[i];
            const [xj, yj] = p[j];
            if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
          }
          if (inside) return true;
        }
      }
    return false;
  };
  const out = [];
  let seen = 0;
  const rl = (await import('node:readline')).createInterface({
    input: createReadStream(MS_CACHE).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line || line[0] !== '{') continue;
    let f;
    try {
      f = JSON.parse(line);
    } catch {
      continue;
    }
    const geom = f.geometry;
    if (!geom || geom.type !== 'Polygon' || !geom.coordinates?.[0]?.length) continue;
    const ring = geom.coordinates[0];
    let mnx = 1e9;
    let mxx = -1e9;
    let mny = 1e9;
    let mxy = -1e9;
    for (const [lo, la] of ring) {
      if (lo < mnx) mnx = lo;
      if (lo > mxx) mxx = lo;
      if (la < mny) mny = la;
      if (la > mxy) mxy = la;
    }
    if (mxx < BBOX.west || mnx > BBOX.east || mxy < BBOX.south || mny > BBOX.north) continue;
    seen++;
    const cx = (mnx + mxx) / 2;
    const cy = (mny + mxy) / 2;
    if (inOsm(cx, cy)) continue;
    const pr = f.properties ?? {};
    const h = parseNum(pr.height ?? pr.HEIGHT ?? pr.min_height);
    out.push({
      id: `ms${seen}`,
      pts: ring.map(([lo, la]) => [lo, la]),
      levels: 3,
      height: h != null && h > 0 ? Math.round(h) : 9,
      color: null,
      source: 'ms',
    });
    if (out.length >= 2000) break;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    help();
    return;
  }
  let out = DEFAULT_OUT;
  const oi = args.indexOf("--out");
  if (oi !== -1) out = resolve(args[oi + 1] ?? out);
  const dryRun = args.includes("--dry-run");

  let json;
  try {
    const url = `${OSM_API}?bbox=${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`;
    const res = await fetch(url, { headers: { "User-Agent": "PixelArtIstanbul/0.1" } });
    if (!res.ok) throw new Error(`OSM HTTP ${res.status}`);
    const xml = await res.text();
    json = parseOsmXml(xml);
    try {
      const ms = await fetchMsSupplement(json.buildings);
      console.log(`ms: +${ms.length} supplemental buildings`);
      json.buildings = [...json.buildings, ...ms];
      json.meta.sources.push("Microsoft GlobalMLBuildingFootprints CDLA-2.0");
    } catch (e) {
      console.warn(`warn: MS supplement skipped (${e.message})`);
    }
  } catch (err) {
    console.warn(`warn: OSM fetch failed (${err.message}); keeping starter JSON.`);
    return; // exit 0
  }

  console.log(`buildings=${json.buildings.length} roads=${json.roads.length}`);
  if (dryRun) return;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(json) + "\n");
  console.log(`wrote ${out}`);
}

main();
