#!/usr/bin/env node
// Fetch Darphane building/road footprints from OpenStreetMap main API.
// Stdlib only (Node 20+). No keys. Free. Source: OpenStreetMap, ODbL.
// Uses api.openstreetmap.org/api/0.6/map (Overpass 406/timeout locally).
// ponytail: Overture/Mapillary skipped until OSM proves thin
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CENTER = { lat: 41.0615, lon: 29.0125 };
const BBOX = { south: 41.05835, west: 29.0085, north: 41.06465, east: 29.0165 };
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
  bbox    ${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east} (center ${CENTER.lat},${CENTER.lon}, r 350m)

Source: OpenStreetMap main API (${OSM_API}?bbox=${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}), license ODbL.
On network failure: keeps existing JSON, warns, exits 0.`);
}

function parseNum(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
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
  // Name propagation: split OSM ways share nodes; unnamed vehicular segments
  // inherit the name when shared-node votes clearly agree (best >= 2, 2x runner-up).
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
  return {
    meta: { center: CENTER, bbox: BBOX, source: "OpenStreetMap ODbL" },
    buildings: buildings.slice(0, 500),
    roads,
  };
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
