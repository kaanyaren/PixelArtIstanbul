#!/usr/bin/env node
// Zero-dependency checks for the road-strip geometry helpers in src/geom.js.
// Recorded baseline 2026-11-15: draw+bake 17571 ms, 128 RenderTexture chunks,
// 1036 buildings, default area 41.057/29.0082 r=500 (software WebGL).
// Usage: node scripts/check-geom.mjs
import assert from "node:assert/strict";
import { smoothPolyline, offsetPolyline, strokeStrips } from "../src/geom.js";

const EPS = 1e-6;

function area(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function properIntersect(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

function assertNoSelfIntersection(poly, label) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = [poly[i].x, poly[i].y];
    const b = [poly[(i + 1) % n].x, poly[(i + 1) % n].y];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = [poly[j].x, poly[j].y];
      const d = [poly[(j + 1) % n].x, poly[(j + 1) % n].y];
      assert.ok(!properIntersect(a, b, c, d), `${label}: edges ${i} and ${j} cross`);
    }
  }
}

function project([x, y]) {
  return [8 * x - 8 * y, 4 * x + 4 * y];
}

function arcPoints(radiusM, headingDeg, spacingM = 1) {
  const circumference = 2 * Math.PI * radiusM;
  const steps = Math.max(8, Math.round(circumference / spacingM));
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2 + (headingDeg * Math.PI) / 180;
    pts.push(project([Math.cos(t) * radiusM, Math.sin(t) * radiusM]));
  }
  return pts;
}

function assertCapsCoverRuns(result, hw, label) {
  for (const cap of result.caps) {
    assert.equal(cap.r, hw, `${label}: cap radius`);
    assert.ok(Number.isFinite(cap.x) && Number.isFinite(cap.y), `${label}: cap coordinates`);
  }
  if (result.polygons.length > 1) {
    assert.equal(result.caps.length, result.polygons.length + 1, `${label}: one cap per run boundary`);
  }
  for (const poly of result.polygons) {
    const ends = [poly[0], poly[poly.length - 1]];
    for (const end of ends) {
      let best = Infinity;
      for (const cap of result.caps) best = Math.min(best, Math.hypot(end.x - cap.x, end.y - cap.y));
      assert.ok(best <= hw + 1e-6, `${label}: run end not covered by a cap (${best})`);
    }
  }
}

// 1. Degenerate input
assert.deepEqual(smoothPolyline([]), []);
assert.deepEqual(smoothPolyline([[1, 2]]), [[1, 2]]);
assert.deepEqual(smoothPolyline([[1, 2], [3, 4]]), [[1, 2], [3, 4]]);
assert.deepEqual(offsetPolyline([], 5), []);
assert.equal(offsetPolyline([[1, 2]], 5).length, 1);
assert.deepEqual(strokeStrips([], 5), { polygons: [], caps: [] });
const single = strokeStrips([[10, 20]], 6);
assert.equal(single.caps.length, 1);
assert.equal(single.caps[0].r, 6);

// 2. Duplicate points never produce NaN
const dup = smoothPolyline([[0, 0], [0, 0], [10, 0], [10, 0], [20, 5]], 1);
assert.ok(dup.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), "smoothPolyline NaN with duplicates");
const dupStrip = strokeStrips([[0, 0], [0, 0], [10, 0]], 4);
assert.ok(
  dupStrip.polygons.every((poly) => poly.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))),
  "strokeStrips NaN with duplicates",
);

// 3. Closed ring stays closed
const ring = [];
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  ring.push([Math.cos(a) * 20, Math.sin(a) * 20]);
}
ring.push([ring[0][0], ring[0][1]]);
const closed = smoothPolyline(ring, 2);
assert.ok(Math.abs(closed[0][0] - closed[closed.length - 1][0]) < 1e-9, "closed ring start x");
assert.ok(Math.abs(closed[0][1] - closed[closed.length - 1][1]) < 1e-9, "closed ring start y");

// 4. First and last point preserved
const line = [[0, 0], [5, 3], [10, 0], [15, 6]];
const smooth = smoothPolyline(line, 1);
assert.deepEqual(smooth[0], [0, 0]);
assert.deepEqual(smooth[smooth.length - 1], [15, 6]);

// 5. Interior spacing within tolerance
const steps = [];
for (let i = 1; i < smooth.length; i++) {
  steps.push(Math.hypot(smooth[i][0] - smooth[i - 1][0], smooth[i][1] - smooth[i - 1][1]));
}
for (let i = 1; i + 1 < steps.length; i++) {
  assert.ok(steps[i] > 0.65 && steps[i] < 1.5, `interior spacing ${steps[i]}`);
}

// 6. Every emitted polygon is non-degenerate
const straight = strokeStrips(smooth, 8);
assert.ok(straight.polygons.length >= 1, "straight strip produced no polygon");
for (const poly of straight.polygons) {
  assert.ok(poly.length >= 3, "polygon has fewer than 3 points");
  assert.ok(Math.abs(area(poly)) > EPS, "polygon is collinear");
}
assertCapsCoverRuns(straight, 8, "straight");

// 7. Arcs at 124 px and 60 px screen scale, 4 headings
const cases = [
  { radiusM: 124 / 11.314, label: "124px" },
  { radiusM: 60 / 11.314, label: "60px" },
];
for (const { radiusM, label } of cases) {
  for (const heading of [0, 30, 60, 90]) {
    const pts = arcPoints(radiusM, heading);
    const hw = 69;
    const result = strokeStrips(pts, hw);
    assert.ok(result.polygons.length >= 1, `${label}/${heading}: no polygons`);
    for (const poly of result.polygons) {
      assert.ok(Math.abs(area(poly)) > EPS, `${label}/${heading}: collinear polygon`);
      assertNoSelfIntersection(poly, `${label}/${heading}`);
    }
    assertCapsCoverRuns(result, hw, `${label}/${heading}`);
  }
}

// 8. Tight arc must exercise run splitting
const tight = strokeStrips(arcPoints(5.3, 0), 69);
assert.ok(tight.polygons.length > 1, "tight arc did not split into runs");

console.log(
  `PASS geom: degenerate input, duplicates, closed ring, endpoints, spacing, ${cases.length * 4} arc cases, run splitting + caps`,
);
