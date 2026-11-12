#!/usr/bin/env node
// Merge Overture buildings (GeoJSON FeatureCollection, pre-downloaded via
// `overturemaps download --bbox=... -f geojson --type=building`) into
// public/data/darphane.json. Skips footprints already covered by OSM/MS.
// Stdlib only. Run: node scripts/merge-sources.mjs [overture.geojson]
// ponytail: one-shot gap-fill; custom areas stay OSM-only (browser feasible).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DATA = resolve("public/data/darphane.json");
const OV_PATH = process.argv[2] ?? "/tmp/overture-darphane.geojson";

if (!existsSync(OV_PATH)) {
  console.log("overture file missing, skipping (run overturemaps download first)");
  process.exit(0);
}

function centroid(pts) {
  let sx = 0;
  let sy = 0;
  for (const [lo, la] of pts) {
    sx += lo;
    sy += la;
  }
  return [sx / pts.length, sy / pts.length];
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

function inPoly(cx, cy, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const data = JSON.parse(readFileSync(DATA, "utf8"));
const ov = JSON.parse(readFileSync(OV_PATH, "utf8"));
const feats = ov.type === "FeatureCollection" ? ov.features : ov;

const grid = new Map();
const gk = (x, y) => `${Math.round(x * 500)},${Math.round(y * 500)}`;
for (const b of data.buildings) {
  const [cx, cy] = centroid(b.pts);
  const k = gk(cx, cy);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(b);
}
const covered = (cx, cy) => {
  const gx = Math.round(cx * 500);
  const gy = Math.round(cy * 500);
  for (let ix = -1; ix <= 1; ix++)
    for (let iy = -1; iy <= 1; iy++) {
      const cell = grid.get(`${gx + ix},${gy + iy}`);
      if (!cell) continue;
      for (const b of cell) if (inPoly(cx, cy, b.pts)) return true;
    }
  return false;
};

const bbox = data.meta.bbox;
let added = 0;
let skipped = 0;
feats.forEach((f, i) => {
  const geom = f.geometry;
  if (!geom) return;
  const polys = geom.type === "Polygon" ? [geom.coordinates[0]] : geom.type === "MultiPolygon" ? geom.coordinates.map((p) => p[0]) : [];
  // Largest ring wins (parts ignored).
  polys.sort((a, b) => ringArea(b) - ringArea(a));
  const ring = polys[0];
  if (!ring || ring.length < 3) return;
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
  if (mxx < bbox.west || mnx > bbox.east || mxy < bbox.south || mny > bbox.north) return;
  const [cx, cy] = [(mnx + mxx) / 2, (mny + mxy) / 2];
  if (covered(cx, cy)) {
    skipped++;
    return;
  }
  const pr = f.properties ?? {};
  const h = typeof pr.height === "number" && pr.height > 0 ? Math.round(pr.height) : 9;
  data.buildings.push({ id: `ov${i}`, pts: ring.map(([lo, la]) => [lo, la]), levels: 3, height: h, color: null, source: "ov" });
  // index new footprint so later Overture dups skip too
  const k = gk(cx, cy);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(data.buildings[data.buildings.length - 1]);
  added++;
});

data.meta.sources = [...new Set([...(data.meta.sources ?? [data.meta.source]), "OvertureMaps ODbL"])];
writeFileSync(DATA, JSON.stringify(data) + "\n");
console.log(`overture: +${added} new, ${skipped} already covered`);
console.log(`total buildings: ${data.buildings.length}`);
