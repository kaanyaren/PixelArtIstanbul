function meanLat(pts) {
  if (!pts.length) return 0;
  let s = 0;
  for (const p of pts) s += p[1];
  return s / pts.length;
}

function metersPerDeg(lat) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  return { kx, ky: 111320 };
}

function toXY(p, latRef) {
  const { kx, ky } = metersPerDeg(latRef);
  return [p[0] * kx, p[1] * ky];
}

function perpDistM(p, a, b, latRef) {
  const [px, py] = toXY(p, latRef);
  const [ax, ay] = toXY(a, latRef);
  const [bx, by] = toXY(b, latRef);
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return Math.hypot(px - cx, py - cy);
}

export function simplifyRDP(points, epsMeters, latRef = meanLat(points)) {
  if (!Array.isArray(points) || points.length <= 2 || !(epsMeters > 0)) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDistM(points[i], points[s], points[e], latRef);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > epsMeters) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out.length >= 2 ? out : points;
}

function simplifyRing(points, epsMeters) {
  if (!Array.isArray(points) || points.length <= 4 || !(epsMeters > 0)) return points;
  const closed = points.length > 2 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1];
  const open = closed ? points.slice(0, -1) : points;
  const latRef = meanLat(open);
  let simp = simplifyRDP(open, epsMeters, latRef);
  if (simp.length < 3) simp = open;
  if (closed) {
    const last = simp[simp.length - 1];
    const first = simp[0];
    if (!last || last[0] !== first[0] || last[1] !== first[1]) simp = simp.concat([first.slice ? first.slice() : [first[0], first[1]]]);
  }
  return simp;
}

// --- Road-strip geometry -------------------------------------------------
// Pure helpers used by the street renderer. No DOM, no Phaser.

function readPoint(p) {
  if (Array.isArray(p)) return [Number(p[0]), Number(p[1])];
  return [Number(p && p.x), Number(p && p.y)];
}

function isFinitePoint(p) {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

function dedupePoints(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push(p);
  }
  return out;
}

function resampleByLength(poly, spacing) {
  if (poly.length < 2) return poly.map(([x, y]) => [x, y]);
  const out = [[poly[0][0], poly[0][1]]];
  let carried = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (segLen < 1e-9) continue;
    let pos = 0;
    while (carried + (segLen - pos) >= spacing) {
      pos += spacing - carried;
      carried = 0;
      const f = pos / segLen;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    carried += segLen - pos;
  }
  const last = poly[poly.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > 1e-6) out.push([last[0], last[1]]);
  return out;
}

function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

// Centripetal Catmull-Rom through the input points, resampled to roughly
// uniform cartesian-metre spacing. Returns [x, y] pairs.
export function smoothPolyline(points, spacingMeters = 1) {
  const input = (points || []).map(readPoint).filter(isFinitePoint);
  const clean = dedupePoints(input);
  if (clean.length < 3) return clean.map(([x, y]) => [x, y]);
  const closed = Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) <= 1e-6;
  const base = closed ? clean.slice(0, -1) : clean;
  const n = base.length;
  if (n < 3) return clean.map(([x, y]) => [x, y]);
  const spacing = spacingMeters > 0 ? spacingMeters : 1;
  const alpha = 0.5;
  const at = (i) => base[((i % n) + n) % n];
  const dense = [];
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const p1 = base[i];
    const p2 = closed ? at(i + 1) : base[i + 1];
    const p0 = closed ? at(i - 1) : i > 0 ? base[i - 1] : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
    const p3 = closed ? at(i + 2) : i + 2 < n ? base[i + 2] : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
    const d01 = Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), alpha) || 1e-4;
    const d12 = Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), alpha) || 1e-4;
    const d23 = Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), alpha) || 1e-4;
    const t0 = 0;
    const t1 = t0 + d01;
    const t2 = t1 + d12;
    const t3 = t2 + d23;
    const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.min(200, Math.max(2, Math.ceil(chord / (spacing / 3))));
    for (let s = 0; s < steps; s++) {
      const t = t1 + ((t2 - t1) * s) / steps;
      const a1x = ((t1 - t) / (t1 - t0)) * p0[0] + ((t - t0) / (t1 - t0)) * p1[0];
      const a1y = ((t1 - t) / (t1 - t0)) * p0[1] + ((t - t0) / (t1 - t0)) * p1[1];
      const a2x = ((t2 - t) / (t2 - t1)) * p1[0] + ((t - t1) / (t2 - t1)) * p2[0];
      const a2y = ((t2 - t) / (t2 - t1)) * p1[1] + ((t - t1) / (t2 - t1)) * p2[1];
      const a3x = ((t3 - t) / (t3 - t2)) * p2[0] + ((t - t2) / (t3 - t2)) * p3[0];
      const a3y = ((t3 - t) / (t3 - t2)) * p2[1] + ((t - t2) / (t3 - t2)) * p3[1];
      const b1x = ((t2 - t) / (t2 - t0)) * a1x + ((t - t0) / (t2 - t0)) * a2x;
      const b1y = ((t2 - t) / (t2 - t0)) * a1y + ((t - t0) / (t2 - t0)) * a2y;
      const b2x = ((t3 - t) / (t3 - t1)) * a2x + ((t - t1) / (t3 - t1)) * a3x;
      const b2y = ((t3 - t) / (t3 - t1)) * a2y + ((t - t1) / (t3 - t1)) * a3y;
      const cx = ((t2 - t) / (t2 - t1)) * b1x + ((t - t1) / (t2 - t1)) * b2x;
      const cy = ((t2 - t) / (t2 - t1)) * b1y + ((t - t1) / (t2 - t1)) * b2y;
      if (Number.isFinite(cx) && Number.isFinite(cy)) dense.push([cx, cy]);
    }
  }
  const end = closed ? base[0] : base[n - 1];
  dense.push([end[0], end[1]]);
  const out = resampleByLength(dense, spacing);
  if (closed && out.length > 1) out[out.length - 1] = [out[0][0], out[0][1]];
  return out;
}

// Screen-space parallel offset with clamped miter joins. Returns {x, y} points.
export function offsetPolyline(points, distancePx, miterLimit = 1.8) {
  const pts = (points || []).map(readPoint).filter(isFinitePoint);
  if (pts.length === 0) return [];
  if (pts.length === 1) return [{ x: pts[0][0], y: pts[0][1] }];
  const segs = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    segs.push(len < 1e-9 ? null : { nx: -dy / len, ny: dx / len });
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = i > 0 ? segs[i - 1] : null;
    const next = i < segs.length ? segs[i] : null;
    let nx;
    let ny;
    let scale = 1;
    if (prev && next) {
      let mx = prev.nx + next.nx;
      let my = prev.ny + next.ny;
      const ml = Math.hypot(mx, my);
      if (ml < 1e-6) {
        nx = next.nx;
        ny = next.ny;
      } else {
        mx /= ml;
        my /= ml;
        const dot = mx * prev.nx + my * prev.ny;
        scale = Math.min(miterLimit, 1 / Math.max(0.35, dot));
        nx = mx;
        ny = my;
      }
    } else if (next) {
      nx = next.nx;
      ny = next.ny;
    } else if (prev) {
      nx = prev.nx;
      ny = prev.ny;
    } else {
      out.push({ x: pts[i][0], y: pts[i][1] });
      continue;
    }
    out.push({ x: pts[i][0] + nx * distancePx * scale, y: pts[i][1] + ny * distancePx * scale });
  }
  return out;
}

// Closed strip outline(s) for a screen-space polyline, split into runs where
// the inner offset would fold, plus a round cap at every run boundary.
export function strokeStrips(pointsPx, halfWidthPx, options = {}) {
  const { miterLimit = 1.8, maxTurnDeg = 12, foldGuard = 0.8 } = options;
  const pts = (pointsPx || []).map(readPoint).filter(isFinitePoint);
  const hw = Math.max(0.01, Number(halfWidthPx) || 0.01);
  const polygons = [];
  const caps = [];
  if (pts.length === 0) return { polygons, caps };
  if (pts.length === 1) {
    caps.push({ x: pts[0][0], y: pts[0][1], r: hw });
    return { polygons, caps };
  }
  const segLen = [];
  const dirs = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    segLen.push(len);
    dirs.push(len < 1e-9 ? null : [dx / len, dy / len]);
  }
  const maxTurn = (maxTurnDeg * Math.PI) / 180;
  const splits = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const d0 = dirs[i - 1];
    const d1 = dirs[i];
    if (!d0 || !d1) continue;
    const cross = d0[0] * d1[1] - d0[1] * d1[0];
    const dot = d0[0] * d1[0] + d0[1] * d1[1];
    const turn = Math.abs(Math.atan2(cross, dot));
    const local = Math.min(segLen[i - 1] || Infinity, segLen[i] || Infinity);
    if (turn > maxTurn || hw * turn > local * foldGuard) splits.push(i);
  }
  const bounds = [0, ...splits, pts.length - 1];
  const seen = new Set();
  const addCap = (x, y) => {
    const key = `${x.toFixed(3)},${y.toFixed(3)}`;
    if (seen.has(key)) return;
    seen.add(key);
    caps.push({ x, y, r: hw });
  };
  for (let b = 0; b + 1 < bounds.length; b++) {
    const start = bounds[b];
    const end = bounds[b + 1];
    addCap(pts[start][0], pts[start][1]);
    addCap(pts[end][0], pts[end][1]);
    const run = pts.slice(start, end + 1);
    if (run.length < 2) continue;
    const left = offsetPolyline(run, hw, miterLimit);
    const right = offsetPolyline(run, -hw, miterLimit);
    const poly = left.concat(right.reverse());
    if (poly.length < 3 || Math.abs(polygonArea(poly)) < 1e-6) continue;
    polygons.push(poly);
  }
  return { polygons, caps };
}

export function simplifyAreaData(data, epsMeters = 1.5) {
  if (!data || !(epsMeters > 0)) return data;
  const out = { ...data };
  if (Array.isArray(data.roads)) {
    out.roads = data.roads.map((r) => (r?.pts?.length > 2 ? { ...r, pts: simplifyRDP(r.pts, epsMeters) } : r));
  }
  if (Array.isArray(data.buildings)) {
    out.buildings = data.buildings.map((b) => (b?.pts?.length > 4 ? { ...b, pts: simplifyRing(b.pts, Math.min(epsMeters, 1.0)) } : b));
  }
  if (Array.isArray(data.greens)) {
    out.greens = data.greens.map((g) => (g?.pts?.length > 4 ? { ...g, pts: simplifyRing(g.pts, epsMeters) } : g));
  }
  if (Array.isArray(data.waters)) {
    out.waters = data.waters.map((w) => (w?.pts?.length > 4 ? { ...w, pts: simplifyRing(w.pts, epsMeters) } : w));
  }
  return out;
}
