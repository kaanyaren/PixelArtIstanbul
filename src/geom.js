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
