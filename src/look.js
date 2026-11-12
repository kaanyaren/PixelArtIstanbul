export const PAL = {
  facades: [0xF2E3C6, 0xF7F2E7, 0xE8B96A, 0xD99B8A, 0xA8B89A, 0xF2E3C6],
  roofFace: 0xB5432F,
  roofTop: 0xC9563C,
  roofRidge: 0xD4694E,
  wallLeft: 0xD9C6A3,
  wallRight: 0xF7F2E7,
  trim: 0xF7F2E7,
  glass: 0x2E3A44,
  shutter: [0x5A7A5A, 0x4A6E8A, 0x7A5230],
  awning: [0xC0392B, 0x2A9D8F, 0xE67E22],
};

export function mulberry32(seedInt) {
  let a = seedInt >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function shade(hex, f) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function ell(g, cx, cy, rx, ry, color, alpha) {
  const pts = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  g.fillStyle(color, alpha);
  g.fillPoints(pts, true);
}

function blob(g, cx, cy, r, color, rng, wob = 0.18) {
  const pts = [];
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (rng() - 0.5) * wob * 2;
    pts.push({ x: cx + Math.cos(a) * r * k, y: cy + Math.sin(a) * r * k * 0.86 });
  }
  g.fillStyle(color, 1);
  g.fillPoints(pts, true);
}

const lerp = (a, b, t) => a + (b - a) * t;

function wallPoint(A, B, At, Bt, u, v) {
  const bx = lerp(A.x, B.x, u), by = lerp(A.y, B.y, u);
  const tx = lerp(At.x, Bt.x, u), ty = lerp(At.y, Bt.y, u);
  return { x: lerp(bx, tx, v), y: lerp(by, ty, v) };
}

function windowsOnWall(g, A, B, At, Bt, rng, floors) {
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  const k = Math.max(1, Math.min(8, Math.round(len / 40)));
  for (let f = 1; f <= floors; f++) {
    const v = f / (floors + 0.6);
    for (let i = 0; i < k; i++) {
      const u = (i + 1) / (k + 1);
      const p = wallPoint(A, B, At, Bt, u, v);
      const sh = rng() < 0.5 ? PAL.shutter[(rng() * PAL.shutter.length) | 0] : null;
      if (sh !== null) {
        g.fillStyle(sh, 1);
        g.fillRect(p.x - 8, p.y - 5, 4, 10);
        g.fillRect(p.x + 4, p.y - 5, 4, 10);
      }
      g.fillStyle(PAL.trim, 1);
      g.fillRect(p.x - 5, p.y - 6, 10, 12);
      g.fillStyle(PAL.glass, 1);
      g.fillRect(p.x - 3.5, p.y - 4.5, 7, 9);
      if (rng() < 0.5) {
        g.fillStyle(0xF5EDD6, 1);
        g.fillRect(p.x - 3.5, p.y - 4.5, 2, 9);
        g.fillRect(p.x + 1.5, p.y - 4.5, 2, 9);
      }
      g.lineStyle(1, 0xBFD9E5, 0.9);
      g.lineBetween(p.x - 3, p.y + 2, p.x + 1, p.y - 3);
      if (rng() < 0.3) {
        g.fillStyle(0xC96F4A, 1);
        g.fillRect(p.x - 5, p.y + 6, 10, 3);
        g.fillStyle(0x5A7A5A, 1);
        g.fillRect(p.x - 4, p.y + 4, 8, 3);
      }
    }
  }
}

export function drawBuilding(g, base, opts = {}) {
  const { heightPx = 60, seed = 1, floors = 3, facade } = opts;
  const rng = mulberry32(typeof seed === "number" ? seed : hashStr(String(seed)));
  const n = base.length;
  let minX = Infinity, maxX = -Infinity, sumX = 0, sumY = 0;
  base.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); sumX += p.x; sumY += p.y; });
  const cx = sumX / n, gy = sumY / n;
  ell(g, cx, gy + 4, Math.min((maxX - minX) / 2 + 12, 60), 9, 0x3A2A20, 0.18);

  const fc = facade ?? PAL.facades[(rng() * PAL.facades.length) | 0];
  let f = 0;
  base.forEach((p, i) => { if (p.y > base[f].y || (p.y === base[f].y && p.x > base[f].x)) f = i; });
  const pF = base[f], pA = base[(f - 1 + n) % n], pB = base[(f + 1) % n];
  const top = (p) => ({ x: p.x, y: p.y - heightPx });
  const tF = top(pF), tA = top(pA), tB = top(pB);

  g.fillStyle(shade(fc, 0.8), 1);
  g.fillPoints([pF, pA, tA, tF], true);
  g.fillStyle(shade(fc, 0.95), 1);
  g.fillPoints([pF, tF, tB, pB], true);

  g.lineStyle(1, PAL.trim, 0.7);
  for (let i = 1; i <= floors; i++) {
    const v = i / (floors + 0.6);
    const a1 = wallPoint(pF, pA, tF, tA, 0.02, v), b1 = wallPoint(pF, pA, tF, tA, 0.98, v);
    const a2 = wallPoint(pF, pB, tF, tB, 0.02, v), b2 = wallPoint(pF, pB, tF, tB, 0.98, v);
    g.lineBetween(a1.x, a1.y, b1.x, b1.y);
    g.lineBetween(a2.x, a2.y, b2.x, b2.y);
  }
  windowsOnWall(g, pF, pA, tF, tA, rng, floors);
  windowsOnWall(g, pF, pB, tF, tB, rng, floors);

  const tAll = base.map(top);
  const tcx = tAll.reduce((s, p) => s + p.x, 0) / tAll.length;
  const tcy = tAll.reduce((s, p) => s + p.y, 0) / tAll.length;
  const rh = 13 + rng() * 10;
  const roofRoll = rng();
  const isFlat = roofRoll >= 0.7 && roofRoll < 0.9;
  const isZinc = roofRoll >= 0.9;
  const zinc = 0x4A4D52;
  if (isFlat) {
    // Flat gray roof: gray top + parapet rim.
    g.fillStyle(0x8A8D90, 1);
    g.fillPoints(tAll, true);
    g.lineStyle(2, PAL.trim, 0.9);
    g.strokePoints(tAll, true);
    // White rooftop water tank box on legs.
    const wx = tcx + (rng() - 0.5) * 14, wy = tcy - 8;
    g.fillStyle(0x5A5A5A, 1);
    g.fillRect(wx - 4, wy, 1.5, 6);
    g.fillRect(wx + 3, wy, 1.5, 6);
    g.fillStyle(0xF7F2E7, 1);
    g.fillRect(wx - 5, wy - 8, 10, 8);
    g.fillStyle(0xD8D8D8, 1);
    g.fillRect(wx - 5, wy - 9, 10, 1.5);
    // Small gray satellite dish.
    const dx = tcx + 10 + rng() * 6;
    g.lineStyle(1, 0x5A5A5A, 1);
    g.lineBetween(dx, tcy - 2, dx, tcy - 7);
    g.fillStyle(0xB8B0A0, 1);
    g.fillRect(dx - 3, tcy - 10, 6, 4);
  } else {
    // Fitted hip roof: outer top rim + inner ridge ring scaled toward centroid.
    const face = isZinc ? zinc : PAL.roofFace;
    const ridge = tAll.map((p) => ({ x: tcx + (p.x - tcx) * 0.45, y: tcy + (p.y - tcy) * 0.45 - rh }));
    g.fillStyle(shade(face, 0.92), 1);
    g.fillPoints(tAll, true);
    for (let i = 0; i < tAll.length; i++) {
      const j = (i + 1) % tAll.length;
      g.fillStyle(shade(face, i % 2 ? 1.06 : 0.98), 1);
      g.fillPoints([tAll[i], tAll[j], ridge[j], ridge[i]], true);
    }
    g.fillStyle(isZinc ? shade(zinc, 1.15) : PAL.roofTop, 1);
    g.fillPoints(ridge, true);
    g.lineStyle(2, isZinc ? shade(zinc, 1.3) : PAL.roofRidge, 1);
    g.strokePoints(ridge, true);
    g.lineStyle(2, PAL.trim, 0.9);
    g.strokePoints(tAll, true);
    if (!isZinc && rng() < 0.5) {
      // Dormer on tile roofs only.
      const dw = 10, dh = 8;
      g.fillStyle(shade(fc, 0.95), 1);
      g.fillRect(tcx - dw / 2, tcy - rh - 2, dw, dh);
      g.fillStyle(PAL.trim, 1);
      g.fillRect(tcx - dw / 2 - 1, tcy - rh - 4, dw + 2, 3);
      g.fillStyle(PAL.glass, 1);
      g.fillRect(tcx - 3, tcy - rh, 6, 5);
    }
  }

  if (rng() < 0.7) {
    const chx = tcx + (rng() - 0.5) * 20;
    g.fillStyle(0xC96F4A, 1);
    g.fillRect(chx - 3, tcy - rh - 14, 7, 14);
    g.fillStyle(PAL.trim, 1);
    g.fillRect(chx - 4, tcy - rh - 16, 9, 3);
  }

  const longA = Math.hypot(pB.x - pF.x, pB.y - pF.y) >= Math.hypot(pA.x - pF.x, pA.y - pF.y);
  const Q = longA ? pB : pA, tQ = longA ? tB : tA;

  if (rng() < 0.4 && floors >= 2) {
    // Balcony on longer front face, middle floor.
    const mf = Math.max(1, Math.ceil(floors / 2));
    const c = wallPoint(pF, Q, tF, tQ, 0.5, mf / (floors + 0.6));
    g.fillStyle(0x4A3226, 1);
    g.fillRect(c.x - 5, c.y - 10, 10, 15);
    g.fillStyle(PAL.glass, 1);
    g.fillRect(c.x - 3, c.y - 8, 6, 8);
    g.fillStyle(0xB8B0A0, 1);
    g.fillRect(c.x - 13, c.y + 5, 26, 3);
    g.fillStyle(0x2E3A44, 1);
    for (let b = -1; b <= 1; b++) g.fillRect(c.x + b * 8 - 1, c.y - 1, 2, 6);
  }

  if (rng() < 0.3) {
    // AC units: 1-2 small light-gray boxes with darker fan dot.
    const nAC = 1 + (rng() < 0.4 ? 1 : 0);
    for (let a = 0; a < nAC; a++) {
      const useQ = rng() < 0.5;
      const S = useQ ? Q : (Q === pB ? pA : pB), tS = useQ ? tQ : (Q === pB ? tA : tB);
      const p = wallPoint(pF, S, tF, tS, 0.2 + rng() * 0.6, (1 + ((rng() * floors) | 0)) / (floors + 0.6));
      g.fillStyle(0xD8D8D8, 1);
      g.fillRect(p.x + 6, p.y - 2, 7, 5);
      g.fillStyle(0x666666, 1);
      g.fillRect(p.x + 8, p.y, 3, 2);
    }
  }

  const isShop = rng() < 0.35;
  if (isShop) {
    // Shopfront: colored sign band spanning front face + tiny door + step.
    const band = [0xC0392B, 0x2A9D8F, 0xE67E22, 0x2E5FA3][(rng() * 4) | 0];
    const l = wallPoint(pF, Q, tF, tQ, 0.08, 0.1), r = wallPoint(pF, Q, tF, tQ, 0.92, 0.1);
    g.fillStyle(band, 1);
    g.fillRect(Math.min(l.x, r.x), Math.min(l.y, r.y) - 3, Math.abs(r.x - l.x), 6);
    g.fillStyle(0xF7F2E7, 1);
    g.fillRect(Math.min(l.x, r.x) + 2, Math.min(l.y, r.y) - 2, Math.min(20, Math.abs(r.x - l.x) / 3), 4);
    const d = wallPoint(pF, Q, tF, tQ, 0.5, 0.0);
    g.fillStyle(0x2E3A44, 1);
    g.fillRect(d.x - 4, d.y - 12, 8, 12);
    g.lineStyle(1, 0xB8B0A0, 1);
    g.lineBetween(d.x - 5, d.y, d.x + 5, d.y);
  } else {
    // Entrance door: centered ground-floor dark wood + steps + 50% canopy.
    const d = wallPoint(pF, Q, tF, tQ, 0.5, 0.0);
    g.fillStyle(0x4A3226, 1);
    g.fillRect(d.x - 4, d.y - 13, 8, 13);
    g.fillStyle(0x6B4A30, 1);
    g.fillRect(d.x - 4, d.y - 13, 2, 13);
    g.lineStyle(1, 0xB8B0A0, 1);
    g.lineBetween(d.x - 6, d.y, d.x + 6, d.y);
    g.lineBetween(d.x - 6, d.y + 2, d.x + 6, d.y + 2);
    if (rng() < 0.5) {
      g.fillStyle(shade(fc, 0.7), 1);
      g.fillRect(d.x - 7, d.y - 16, 14, 3);
    }
  }

  if (rng() < 0.3) {
    const aw = PAL.awning[(rng() * PAL.awning.length) | 0];
    const y0 = wallPoint(pF, Q, tF, tQ, 0.5, 0.06);
    for (let i = 0; i < 6; i++) {
      const u0 = 0.15 + (0.7 * i) / 6, u1 = 0.15 + (0.7 * (i + 1)) / 6;
      const a = wallPoint(pF, Q, tF, tQ, u0, 0.06), b = wallPoint(pF, Q, tF, tQ, u1, 0.06);
      g.fillStyle(i % 2 ? 0xF7F2E7 : aw, 1);
      g.fillRect(Math.min(a.x, b.x), y0.y - 2, Math.abs(b.x - a.x) + 1, 7);
    }
    g.fillStyle(0x2E3A44, 1);
    g.fillRect(y0.x - 16, y0.y - 12, 32, 7);
    g.fillStyle(PAL.glass, 1);
    g.fillRect(y0.x - 8, y0.y + 5, 16, 12);
  }

  if (rng() < 0.6) {
    // Facade grime: 1px darker damp strip along wall bottom.
    g.lineStyle(1, shade(fc, 0.65), 1);
    g.lineBetween(pF.x, pF.y - 1, pA.x, pA.y - 1);
    g.lineBetween(pF.x, pF.y - 1, pB.x, pB.y - 1);
  }
}

export function drawTree(g, x, y, seed, s = 1) {
  const rng = mulberry32(typeof seed === "number" ? seed : hashStr(String(seed)));
  ell(g, x, y + 2 * s, 10 * s, 3.5 * s, 0x3A2A20, 0.15);
  g.fillStyle(0x7A5230, 1);
  g.fillRect(x - 2 * s, y - 15 * s, 4 * s, 15 * s);
  blob(g, x - 7 * s, y - 16 * s, 7 * s, 0x4E7A52, rng);
  blob(g, x + 7 * s, y - 16 * s, 7 * s, 0x4E7A52, rng);
  blob(g, x, y - 22 * s, 9.5 * s, 0x6E9B6A, rng);
  blob(g, x - 3 * s, y - 24 * s, 4 * s, 0xA8C69A, rng);
}
