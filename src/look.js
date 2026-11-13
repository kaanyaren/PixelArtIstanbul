// src/look.js — palette, seeded RNG, procedural pixel-art building/tree painters.
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
  stone: 0xB3A289, // kumtaş base course
  zinc: 0x4A4D52,
  dome: 0x6E747A,
  lead: 0x5F6A72,
};

export const STYLES = {
  ottoman: { facades: [0xE8B96A, 0xE0B584, 0xD99B8A, 0xC9A86A, 0xEBC98F], base: 0xB09B7E, roof: 'tile', arched: true },
  apartment: { facades: [0xF2E3C6, 0xF7F2E7, 0xE9D3B0, 0xE8B96A, 0xD99B8A], base: 0xB3A289, roof: 'tile' },
  block: { facades: [0xEFE9DA, 0xE4E2D6, 0xD6D9D4, 0xE8DCC0], base: 0xA9AFAF, roof: 'flat' },
  office: { facades: [0xD8DCE0, 0xC9D2D8, 0xE6E2D6], base: 0x9AA0A6, roof: 'flat', glassy: true },
  industrial: { facades: [0xC9C2B4, 0xB8B0A0, 0xD2CBBB], base: 0x8E8778, roof: 'zinc' },
  civic: { facades: [0xEDE3CC, 0xE4DCC8, 0xD9DCC6], base: 0xB5A88F, roof: 'flat' },
  religious: { facades: [0xE8E0CC, 0xDED6C2, 0xEADFC6], base: 0xA9977C, roof: 'dome' },
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

// Long axis of a footprint: the pair of furthest vertices. Hip roofs need it
// so the ridge reads as a ridge line, not a pyramid.
function principalAxis(pts) {
  let best = -1, a = 0, b = 1;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2;
      if (d > best) { best = d; a = i; b = j; }
    }
  }
  const dx = pts[b].x - pts[a].x, dy = pts[b].y - pts[a].y;
  const len = Math.hypot(dx, dy) || 1;
  return { ux: dx / len, uy: dy / len, px: -dy / len, py: dx / len };
}

// Shrink a ring toward its centroid: `along` along the long axis, `across` across.
function shrinkRing(pts, cx, cy, axis, along, across) {
  return pts.map((p) => {
    const dx = p.x - cx, dy = p.y - cy;
    const al = dx * axis.ux + dy * axis.uy;
    const ac = dx * axis.px + dy * axis.py;
    return {
      x: cx + axis.ux * al * along + axis.px * ac * across,
      y: cy + axis.uy * al * along + axis.py * ac * across,
    };
  });
}

export function styleFor(b) {
  const t = String((b && (b.type || b.building || b.kind)) || '').toLowerCase();
  const n = String((b && (b.name || b.landmark)) || '').toLowerCase();
  if (/mosque|cami|mescit|church|cathedral|synagogue|chapel|temple/.test(t + ' ' + n)) return 'religious';
  if (/industrial|warehouse|farm|barn|greenhouse|carport|factory|silo|tank/.test(t)) return 'industrial';
  if (/office|hotel|commercial|retail|mall|bank|shop/.test(t)) return 'block';
  if (/school|university|college|kindergarten|hospital|civic|public|government|train|station|prison|museum|court|municipality/.test(t)) return 'civic';
  if (/house|detached|semidetached|terrace|bungalow|hut|shed|garage/.test(t)) return 'ottoman';
  if (/apartment|residential/.test(t)) return 'apartment';
  return 'apartment';
}

function windowGrid(g, A, B, At, Bt, rng, floors, o) {
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  const k = Math.max(1, Math.min(8, Math.round(len / 40)));
  for (let f = 1; f <= floors; f++) {
    const v = f / (floors + 0.6);
    for (let i = 0; i < k; i++) {
      const u = (i + 1) / (k + 1);
      const p = wallPoint(A, B, At, Bt, u, v);
      if (o.shutter !== null) {
        g.fillStyle(o.shutter, 1);
        g.fillRect(p.x - 8, p.y - 5, 4, 10);
        g.fillRect(p.x + 4, p.y - 5, 4, 10);
        g.lineStyle(1, shade(o.shutter, 0.7), 1);
        g.lineBetween(p.x - 6, p.y - 1, p.x - 4, p.y - 1);
        g.lineBetween(p.x + 4, p.y - 1, p.x + 6, p.y - 1);
      }
      g.fillStyle(PAL.trim, 1);
      g.fillRect(p.x - 5, p.y - 6, 10, 12);
      const lit = rng() < 0.18;
      g.fillStyle(lit ? 0xEFD27A : PAL.glass, 1);
      g.fillRect(p.x - 3.5, p.y - 4.5, 7, 9);
      if (o.arched) {
        g.fillStyle(lit ? 0xEFD27A : PAL.glass, 1);
        g.fillRect(p.x - 2, p.y - 6, 4, 2);
        g.fillStyle(PAL.trim, 1);
        g.fillRect(p.x - 5, p.y - 6, 2, 1);
        g.fillRect(p.x + 3, p.y - 6, 2, 1);
      }
      // Muntins and frame depth.
      g.lineStyle(1, shade(PAL.trim, 0.85), 1);
      g.lineBetween(p.x, p.y - 4.5, p.x, p.y + 4.5);
      g.lineBetween(p.x - 3.5, p.y, p.x + 3.5, p.y);
      g.fillStyle(PAL.trim, 1);
      g.fillRect(p.x - 6, p.y + 6, 12, 2);
      if (rng() < 0.5) {
        g.fillStyle(lit ? 0xFFF2A8 : 0xF5EDD6, 1);
        g.fillRect(p.x - 3.5, p.y - 4.5, 2, 9);
      }
      g.lineStyle(1, 0xBFD9E5, lit ? 0.4 : 0.9);
      g.lineBetween(p.x - 3, p.y + 2, p.x + 1, p.y - 3);
      if (rng() < 0.24) {
        g.fillStyle(0xC96F4A, 1);
        g.fillRect(p.x - 5, p.y + 6, 10, 3);
        g.fillStyle(0x5A7A5A, 1);
        g.fillRect(p.x - 4, p.y + 4, 8, 3);
        if (rng() < 0.4) { g.fillStyle(0xD43B3B, 1); g.fillRect(p.x - 1, p.y + 3, 2, 2); }
      }
    }
  }
}

// Hip roof: eave ring -> ridge ring, per-face shading from a single sun vector.
function hipRoof(g, eave, cx, cy, rh, faceCol, rng, opts = {}) {
  const axis = principalAxis(eave);
  const along = opts.along ?? 0.46;
  const across = opts.across ?? 0.16;
  const ridge = shrinkRing(eave, cx, cy, axis, along, across).map((p) => ({ x: p.x, y: p.y - rh }));
  // Sun from upper-right of the screen.
  const LX = 0.55, LY = -0.83;
  for (let i = 0; i < eave.length; i++) {
    const j = (i + 1) % eave.length;
    const A = eave[i], B = eave[j];
    let nx = -(B.y - A.y), ny = B.x - A.x;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
    const dot = Math.max(0, nx * LX + ny * LY);
    const f = 0.78 + 0.30 * dot;
    g.fillStyle(shade(faceCol, f), 1);
    g.fillPoints([A, B, ridge[j], ridge[i]], true);
    // Tile courses running parallel to the eave.
    if (opts.courses !== false) {
      g.lineStyle(1, shade(faceCol, 0.72), 0.5);
      for (let k = 1; k <= 2; k++) {
        const t = k / 3;
        g.lineBetween(
          lerp(A.x, ridge[i].x, t), lerp(A.y, ridge[i].y, t),
          lerp(B.x, ridge[j].x, t), lerp(B.y, ridge[j].y, t),
        );
      }
    }
  }
  g.fillStyle(opts.topCol ?? shade(faceCol, 1.12), 1);
  g.fillPoints(ridge, true);
  g.lineStyle(2, opts.ridgeCol ?? shade(faceCol, 1.28), 1);
  g.strokePoints(ridge, true);
  return ridge;
}

function flatRoof(g, tAll, tcx, tcy, rng, st) {
  g.fillStyle(0x8A8D90, 1);
  g.fillPoints(tAll, true);
  // Parapet wall ring.
  const para = shrinkRing(tAll, tcx, tcy, principalAxis(tAll), 0.97, 0.97);
  g.lineStyle(3, 0xB8B0A0, 1);
  g.strokePoints(para, true);
  g.lineStyle(1, 0xD8D0C0, 0.9);
  g.strokePoints(tAll, true);
  // Rooftop water tank on legs.
  const wx = tcx + (rng() - 0.5) * 14, wy = tcy - 8;
  g.fillStyle(0x5A5A5A, 1);
  g.fillRect(wx - 4, wy, 1.5, 6);
  g.fillRect(wx + 3, wy, 1.5, 6);
  g.fillStyle(0xF7F2E7, 1);
  g.fillRect(wx - 5, wy - 8, 10, 8);
  g.fillStyle(0xD8D8D8, 1);
  g.fillRect(wx - 5, wy - 9, 10, 1.5);
  // Satellite dish.
  const dx = tcx + 10 + rng() * 6;
  g.lineStyle(1, 0x5A5A5A, 1);
  g.lineBetween(dx, tcy - 2, dx, tcy - 7);
  g.fillStyle(0xB8B0A0, 1);
  g.fillRect(dx - 3, tcy - 10, 6, 4);
  // Vent / AC block.
  if (rng() < 0.6) {
    const vx = tcx - 8 + rng() * 6;
    g.fillStyle(0x7A7E82, 1);
    g.fillRect(vx, tcy - 6, 8, 5);
    g.fillStyle(0x65696D, 1);
    g.fillRect(vx + 1, tcy - 5, 6, 3);
  }
}

function domeRoof(g, tAll, tcx, tcy, rng, st) {
  // Lead-grey dome with ribs and a finial.
  const rx = Math.max(10, Math.min(46, (Math.max(...tAll.map((p) => p.x)) - Math.min(...tAll.map((p) => p.x))) * 0.36));
  const ry = rx * 0.72;
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI + (i / 16) * Math.PI;
    pts.push({ x: tcx + Math.cos(a) * rx, y: tcy - Math.sin(a) * ry });
  }
  pts.push({ x: tcx - rx, y: tcy });
  pts.push({ x: tcx + rx, y: tcy });
  g.fillStyle(PAL.dome, 1);
  g.fillPoints(pts, true);
  g.lineStyle(1, shade(PAL.dome, 0.72), 0.8);
  for (let i = 1; i < 8; i++) {
    const a = Math.PI + (i / 8) * Math.PI;
    g.lineBetween(tcx, tcy - ry, tcx + Math.cos(a) * rx, tcy - Math.sin(a) * ry);
  }
  g.fillStyle(shade(PAL.dome, 1.25), 0.85);
  g.fillPoints([
    { x: tcx - rx * 0.55, y: tcy - ry * 0.55 },
    { x: tcx - rx * 0.2, y: tcy - ry * 0.8 },
    { x: tcx - rx * 0.34, y: tcy - ry * 0.1 },
  ], true);
  g.lineStyle(2, shade(PAL.dome, 1.35), 1);
  g.strokePoints(pts.slice(0, 17), true);
  // Finial.
  g.fillStyle(0xE5C158, 1);
  g.fillRect(tcx - 1, tcy - ry - 6, 2, 6);
  g.fillCircle(tcx, tcy - ry - 7, 1.6);
}

function minaret(g, px, py, h) {
  g.fillStyle(0xDED6C2, 1);
  g.fillRect(px - 2, py - h, 5, h);
  g.fillStyle(0xC4BBA6, 1);
  g.fillRect(px + 1, py - h, 2, h);
  // Şerefe balcony.
  g.fillStyle(0xB8B0A0, 1);
  g.fillRect(px - 4, py - h * 0.62, 9, 3);
  g.fillStyle(0x8E8778, 1);
  g.fillRect(px - 3, py - h * 0.62 + 3, 7, 1.5);
  // Conical cap.
  g.fillStyle(PAL.lead, 1);
  g.fillPoints([
    { x: px - 2, y: py - h },
    { x: px + 3, y: py - h },
    { x: px + 0.5, y: py - h - 8 },
  ], true);
}

export function drawBuilding(g, base, opts = {}) {
  const { heightPx = 60, seed = 1, floors = 3, facade, style = 'apartment' } = opts;
  const st = STYLES[style] || STYLES.apartment;
  const rng = mulberry32(typeof seed === "number" ? seed : hashStr(String(seed)));
  const n = base.length;
  let minX = Infinity, maxX = -Infinity, sumX = 0, sumY = 0;
  base.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); sumX += p.x; sumY += p.y; });
  const cx = sumX / n, gy = sumY / n;

  // Ground shadow: footprint slid away from the sun (upper-right).
  const off = { x: -heightPx * 0.38, y: heightPx * 0.13 };
  g.fillStyle(0x3A2A20, 0.13);
  g.fillPoints(base.map((p) => ({ x: p.x + off.x, y: p.y + off.y })), true);
  ell(g, cx, gy + 3, Math.min((maxX - minX) / 2 + 14, 64), 8, 0x3A2A20, 0.12);

  const fc = facade ?? st.facades[(rng() * st.facades.length) | 0];
  let f = 0;
  base.forEach((p, i) => { if (p.y > base[f].y || (p.y === base[f].y && p.x > base[f].x)) f = i; });
  const pF = base[f], pA = base[(f - 1 + n) % n], pB = base[(f + 1) % n];
  const top = (p) => ({ x: p.x, y: p.y - heightPx });
  const tF = top(pF), tA = top(pA), tB = top(pB);

  // Walls.
  g.fillStyle(shade(fc, 0.78), 1);
  g.fillPoints([pF, pA, tA, tF], true);
  g.fillStyle(shade(fc, 0.94), 1);
  g.fillPoints([pF, tF, tB, pB], true);

  // Kumtaş base course on the ground floor.
  const baseH = Math.min(heightPx * 0.18, 16);
  g.fillStyle(shade(st.base, 0.88), 1);
  g.fillPoints([pF, pA, { x: pA.x, y: pA.y - baseH }, { x: pF.x, y: pF.y - baseH }], true);
  g.fillStyle(shade(st.base, 1.02), 1);
  g.fillPoints([pF, { x: pF.x, y: pF.y - baseH }, { x: pB.x, y: pB.y - baseH }, pB], true);
  g.lineStyle(1, shade(st.base, 1.18), 0.8);
  g.lineBetween(pF.x, pF.y - baseH, pA.x, pA.y - baseH);
  g.lineBetween(pF.x, pF.y - baseH, pB.x, pB.y - baseH);

  // Sunlit top edge + soft AO at the wall base.
  g.lineStyle(2, 0xfff3d0, 0.75);
  g.lineBetween(tF.x, tF.y, tA.x, tA.y);
  g.lineBetween(tF.x, tF.y, tB.x, tB.y);
  g.lineStyle(3, shade(fc, 0.55), 0.5);
  g.lineBetween(pF.x, pF.y - 1, pA.x, pA.y - 1);
  g.lineBetween(pF.x, pF.y - 1, pB.x, pB.y - 1);

  // Floor separation lines + cornice band.
  g.lineStyle(1, PAL.trim, 0.7);
  for (let i = 1; i <= floors; i++) {
    const v = i / (floors + 0.6);
    const a1 = wallPoint(pF, pA, tF, tA, 0.02, v), b1 = wallPoint(pF, pA, tF, tA, 0.98, v);
    const a2 = wallPoint(pF, pB, tF, tB, 0.02, v), b2 = wallPoint(pF, pB, tF, tB, 0.98, v);
    g.lineBetween(a1.x, a1.y, b1.x, b1.y);
    g.lineBetween(a2.x, a2.y, b2.x, b2.y);
  }
  // Cornice under eave.
  g.lineStyle(2, shade(fc, 1.08), 0.9);
  g.lineBetween(tF.x, tF.y + 2, tA.x, tA.y + 2);
  g.lineBetween(tF.x, tF.y + 2, tB.x, tB.y + 2);


  const shutterCol = PAL.shutter[(rng() * PAL.shutter.length) | 0];
  windowGrid(g, pF, pA, tF, tA, rng, floors, { shutter: shutterCol, arched: st.arched });
  windowGrid(g, pF, pB, tF, tB, rng, floors, { shutter: shutterCol, arched: st.arched });

  // Roof.
  const tAll = base.map(top);
  const tcx = tAll.reduce((s, p) => s + p.x, 0) / tAll.length;
  const tcy = tAll.reduce((s, p) => s + p.y, 0) / tAll.length;
  const diag = Math.hypot(maxX - minX, (base[0] && 0) || 0);
  const rh = 10 + Math.min(18, (maxX - minX) * 0.05);

  const roofRoll = rng();
  let roofKind = st.roof;
  if (roofKind === 'tile') roofKind = roofRoll < 0.62 ? 'tile' : roofRoll < 0.85 ? 'zinc' : 'flat';
  else if (roofKind === 'flat') roofKind = roofRoll < 0.78 ? 'flat' : 'zinc';

  const eave = shrinkRing(tAll, tcx, tcy, principalAxis(tAll), 1, 1).map((p) => {
    const dx = p.x - tcx, dy = p.y - tcy;
    const d = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / d) * 4, y: p.y + (dy / d) * 4 };
  });

  if (roofKind === 'dome') {
    domeRoof(g, tAll, tcx, tcy, rng, st);
    minaret(g, pF.x - 10, pF.y, heightPx * 2.4);
  } else if (roofKind === 'flat') {
    flatRoof(g, tAll, tcx, tcy, rng, st);
  } else {
    const faceCol = roofKind === 'zinc' ? PAL.zinc : PAL.roofFace;
    hipRoof(g, eave, tcx, tcy, rh, faceCol, rng, {
      along: 0.5, across: 0.18,
      topCol: roofKind === 'zinc' ? shade(PAL.zinc, 1.18) : PAL.roofTop,
      ridgeCol: roofKind === 'zinc' ? shade(PAL.zinc, 1.35) : PAL.roofRidge,
    });
    // Eave trim.
    g.lineStyle(2, PAL.trim, 0.9);
    g.strokePoints(eave, true);
    // Dormer on tile roofs only.
    if (roofKind === 'tile' && rng() < 0.45) {
      const dw = 10, dh = 8;
      g.fillStyle(shade(fc, 0.95), 1);
      g.fillRect(tcx - dw / 2, tcy - rh - 2, dw, dh);
      g.fillStyle(PAL.trim, 1);
      g.fillRect(tcx - dw / 2 - 1, tcy - rh - 4, dw + 2, 3);
      g.fillStyle(PAL.glass, 1);
      g.fillRect(tcx - 3, tcy - rh, 6, 5);
    }
  }

  // Chimney / antenna.
  if (rng() < 0.65) {
    const chx = tcx + (rng() - 0.5) * 20;
    g.fillStyle(0xC96F4A, 1);
    g.fillRect(chx - 3, tcy - rh - 14, 7, 14);
    g.fillStyle(PAL.trim, 1);
    g.fillRect(chx - 4, tcy - rh - 16, 9, 3);
  } else {
    // Slim TV antenna.
    const ax = tcx + (rng() - 0.5) * 18;
    g.lineStyle(1, 0x5A5A5A, 1);
    g.lineBetween(ax, tcy - rh - 2, ax, tcy - rh - 16);
    g.lineBetween(ax - 4, tcy - rh - 12, ax, tcy - rh - 16);
    g.lineBetween(ax + 4, tcy - rh - 12, ax, tcy - rh - 16);
  }


  const longA = Math.hypot(pB.x - pF.x, pB.y - pF.y) >= Math.hypot(pA.x - pF.x, pA.y - pF.y);
  const Q = longA ? pB : pA, tQ = longA ? tB : tA;

  const hasBalcony = floors >= 2 && rng() < 0.4;
  if (hasBalcony) {
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
    if (rng() < 0.3) {
      g.fillStyle(0xC92A2A, 1);
      g.fillRect(c.x - 4, c.y - 1, 8, 6);
      g.fillStyle(0xFFFFFF, 1);
      g.fillRect(c.x - 1, c.y + 1, 1, 1);
    }
  } else if (floors >= 2 && rng() < 0.3) {
    const c = wallPoint(pF, Q, tF, tQ, 0.5, 2 / (floors + 0.6));
    g.fillStyle(0x4A3226, 1);
    g.fillRect(c.x - 6, c.y + 7, 3, 4);
    g.fillRect(c.x + 3, c.y + 7, 3, 4);
    g.fillStyle(0x6B4A30, 1);
    g.fillRect(c.x - 9, c.y - 7, 18, 14);
    g.fillStyle(PAL.trim, 1);
    g.fillRect(c.x - 7, c.y - 5, 6, 9);
    g.fillRect(c.x + 1, c.y - 5, 6, 9);
    g.fillStyle(PAL.glass, 1);
    g.fillRect(c.x - 6, c.y - 4, 4, 7);
    g.fillRect(c.x + 2, c.y - 4, 4, 7);
    g.fillStyle(PAL.trim, 1);
    g.fillRect(c.x - 6, c.y, 4, 1);
    g.fillRect(c.x + 2, c.y, 4, 1);
    g.fillStyle(PAL.roofFace, 1);
    g.fillRect(c.x - 10, c.y - 9, 20, 2);
  }

  if (rng() < 0.3) {
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

  const isShop = rng() < 0.38;
  const d = wallPoint(pF, Q, tF, tQ, 0.5, 0.0);
  if (isShop) {
    const band = [0xC0392B, 0x2A9D8F, 0xE67E22, 0x2E5FA3, 0x7A5230][(rng() * 5) | 0];
    let l = wallPoint(pF, Q, tF, tQ, 0.06, 0.12), r = wallPoint(pF, Q, tF, tQ, 0.94, 0.12);
    if (Math.abs(r.x - l.x) > 120) {
      const cc = (l.x + r.x) / 2;
      l = { x: cc - 60, y: l.y };
      r = { x: cc + 60, y: r.y };
    }
    const lx = Math.min(l.x, r.x), ly = Math.min(l.y, r.y), lw = Math.abs(r.x - l.x);
    // Sign band + awning stripes.
    g.fillStyle(band, 1);
    g.fillRect(lx, ly - 4, lw, 7);
    for (let i = 0; i < 6; i++) {
      g.fillStyle(i % 2 ? 0xF7F2E7 : shade(band, 0.85), 1);
      g.fillRect(lx + (lw * i) / 6, ly + 3, lw / 6 + 0.5, 4);
    }
    g.fillStyle(0xF7F2E7, 1);
    g.fillRect(lx + 3, ly - 3, Math.min(22, lw / 3), 4);
    // Shop window + door.
    g.fillStyle(0xCFE4EE, 1);
    g.fillRect(d.x - 14, d.y - 14, 10, 10);
    g.fillStyle(0x2E3A44, 1);
    g.fillRect(d.x - 2, d.y - 13, 9, 13);
    g.fillStyle(0x4A3226, 1);
    g.fillRect(d.x, d.y - 12, 5, 12);
    g.lineStyle(1, 0xB8B0A0, 1);
    g.lineBetween(d.x - 15, d.y, d.x + 8, d.y);
  } else {
    g.fillStyle(0x4A3226, 1);
    g.fillRect(d.x - 4, d.y - 13, 8, 13);
    g.fillStyle(0x6B4A30, 1);
    g.fillRect(d.x - 4, d.y - 13, 2, 13);
    g.fillStyle(0xD4AF37, 1);
    g.fillRect(d.x + 2, d.y - 7, 1, 1);
    g.lineStyle(1, 0xB8B0A0, 1);
    g.lineBetween(d.x - 6, d.y, d.x + 6, d.y);
    g.lineBetween(d.x - 6, d.y + 2, d.x + 6, d.y + 2);
    if (rng() < 0.55) {
      g.fillStyle(shade(fc, 0.7), 1);
      g.fillRect(d.x - 7, d.y - 16, 14, 3);
    }
  }


  const potSides = rng() < 0.5 ? [-1, 1] : [rng() < 0.5 ? -1 : 1];
  for (const s of potSides) {
    const px = s < 0 ? d.x - 9 : d.x + 7;
    g.fillStyle(0xC25D38, 1);
    g.fillRect(px, d.y - 3, 3, 3);
    g.fillStyle(0x4E7A52, 1);
    g.fillRect(px, d.y - 5, 3, 2);
    g.fillStyle(0xD43B3B, 1);
    g.fillRect(px + 1, d.y - 6, 1, 1);
  }

  if (rng() < 0.3) {
    const aw = PAL.awning[(rng() * PAL.awning.length) | 0];
    const y0 = wallPoint(pF, Q, tF, tQ, 0.5, 0.06);
    const faceLen = Math.max(1, Math.hypot(Q.x - pF.x, Q.y - pF.y));
    const span = Math.min(0.7, 120 / faceLen);
    const a0 = 0.5 - span / 2;
    for (let i = 0; i < 6; i++) {
      const u0 = a0 + (span * i) / 6, u1 = a0 + (span * (i + 1)) / 6;
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
    g.lineStyle(1, shade(fc, 0.65), 1);
    g.lineBetween(pF.x, pF.y - 1, pA.x, pA.y - 1);
    g.lineBetween(pF.x, pF.y - 1, pB.x, pB.y - 1);
  }
}

export function drawTree(g, x, y, seed, s = 1) {
  const rng = mulberry32(typeof seed === "number" ? seed : hashStr(String(seed)));
  const roll = rng();
  ell(g, x, y + 2 * s, 10 * s, 3.5 * s, 0x3A2A20, 0.15);
  if (roll < 0.22) {
    // Cypress: thin dark column, very Istanbul.
    g.fillStyle(0x2E4A2E, 1);
    g.fillRect(x - 3 * s, y - 34 * s, 6 * s, 34 * s);
    g.fillStyle(0x3E5E3A, 1);
    g.fillRect(x - 2 * s, y - 34 * s, 2 * s, 34 * s);
    g.fillPoints(
      [{ x: x - 3 * s, y: y - 34 * s }, { x: x + 3 * s, y: y - 34 * s }, { x, y: y - 39 * s }],
      true,
    );
    return;
  }
  if (roll < 0.45) {
    // Erguvan (Judas tree in bloom): magenta-pink flowering canopy.
    g.fillStyle(0x5A3E26, 1);
    g.fillRect(x - 2 * s, y - 16 * s, 4 * s, 16 * s);
    blob(g, x - 7 * s, y - 17 * s, 7.5 * s, 0xB8326E, rng);
    blob(g, x + 7 * s, y - 17 * s, 7.5 * s, 0xB8326E, rng);
    blob(g, x, y - 23 * s, 10 * s, 0xD44D88, rng);
    blob(g, x - 3 * s, y - 25 * s, 4.5 * s, 0xEE7CB2, rng);
    return;
  }
  if (roll < 0.72) {
    // Çınar (Plane tree): wide majestic spreading canopy with sturdy trunk.
    g.fillStyle(0x6B4A30, 1);
    g.fillRect(x - 2.5 * s, y - 18 * s, 5 * s, 18 * s);
    blob(g, x - 11 * s, y - 18 * s, 8 * s, 0x3E5E3A, rng);
    blob(g, x + 11 * s, y - 18 * s, 8 * s, 0x3E5E3A, rng);
    blob(g, x, y - 24 * s, 12 * s, 0x5C8054, rng);
    blob(g, x - 4 * s, y - 27 * s, 6 * s, 0x82A876, rng);
    return;
  }
  // Classic Mediterranean stone pine / olive green shade tree.
  g.fillStyle(0x7A5230, 1);
  g.fillRect(x - 2 * s, y - 15 * s, 4 * s, 15 * s);
  blob(g, x - 7 * s, y - 16 * s, 7 * s, 0x4E7A52, rng);
  blob(g, x + 7 * s, y - 16 * s, 7 * s, 0x4E7A52, rng);
  blob(g, x, y - 22 * s, 9.5 * s, 0x6E9B6A, rng);
  blob(g, x - 3 * s, y - 24 * s, 4 * s, 0xA8C69A, rng);
}
