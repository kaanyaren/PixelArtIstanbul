#!/usr/bin/env node
// Split Microsoft building tile into 0.01° static cells near a center so the
// browser can fetch just the cells covering its bbox (404-tolerant).
// Simplifies rings (1.2m DP) + drops sheds <12m² to keep cells small.
// Usage: node scripts/split-ms.mjs [centerLon centerLat radiusDeg]
// Defaults: Darphane 29.0125 41.0615 0.03 (~3km box). Free data CDLA-2.0.
// ponytail: stdlib only; cells committed under public/data/ms/.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";

const TILE = resolve("scripts/.cache/ms-120323223.csv.gz");
const OUTDIR = resolve("public/data/ms");
const [cLon, cLat, rDeg] = [parseFloat(process.argv[2] ?? "29.0125"), parseFloat(process.argv[3] ?? "41.0615"), parseFloat(process.argv[4] ?? "0.03")];

function ringAreaM(ring) {
  let mx = 0;
  let my = 0;
  for (const [lo, la] of ring) {
    mx += lo;
    my += la;
  }
  mx /= ring.length;
  my /= ring.length;
  const kx = 111320 * Math.cos((my * Math.PI) / 180);
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const x1 = (ring[i][0] - mx) * kx;
    const y1 = (ring[i][1] - my) * 111320;
    const x2 = (ring[(i + 1) % ring.length][0] - mx) * kx;
    const y2 = (ring[(i + 1) % ring.length][1] - my) * 111320;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

function perpD(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
}

// Douglas-Peucker in meters, epsilon 1.2m.
function simplify(ring) {
  const kx = 111320 * Math.cos((ring[0][1] * Math.PI) / 180);
  const pts = ring.map(([lo, la]) => [lo * kx, la * 111320]);
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let dmax = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpD(pts[i], pts[s], pts[e]);
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (dmax > 1.2 && idx > 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push([+(pts[i][0] / kx).toFixed(6), +(pts[i][1] / 111320).toFixed(6)]);
  return out.length >= 4 ? out : ring.map(([lo, la]) => [+lo.toFixed(6), +la.toFixed(6)]);
}

const cells = new Map();
let n = 0;
const rl = createInterface({ input: createReadStream(TILE).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line || line[0] !== "{") continue;
  let f;
  try {
    f = JSON.parse(line);
  } catch {
    continue;
  }
  const geom = f.geometry;
  if (!geom || geom.type !== "Polygon" || !geom.coordinates?.[0]?.length) continue;
  const ring = geom.coordinates[0];
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  if (Math.abs(cx - cLon) > rDeg || Math.abs(cy - cLat) > rDeg) continue;
  if (ringAreaM(ring) < 12) continue;
  const simp = simplify(ring);
  const key = `${Math.floor(cx * 100)}_${Math.floor(cy * 100)}`;
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push({ pts: simp });
  n++;
}
mkdirSync(OUTDIR, { recursive: true });
let files = 0;
for (const [key, list] of cells) {
  writeFileSync(resolve(OUTDIR, `ms-${key}.json`), JSON.stringify({ cell: key, buildings: list }) + "\n");
  files++;
}
console.log(`ms cells: ${files} files, ${n} buildings near ${cLon},${cLat} r=${rDeg}`);
