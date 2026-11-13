// src/props.js — pixel-art sprites for OpenStreetMap points of interest.
// Standalone: no Phaser import, no DOM, no timers, no import-time side effects.
// Anchor rule: (x, y) is the prop's ground anchor; every pixel is drawn upward from it.

const PALETTE = {
  stone: 0xb3a289, // kumtaş
  cream: 0xf7f2e7,
  roofRed: 0xb5432f,
  roofTop: 0xc9563c,
  green: 0x4e7a52,
  glass: 0x2e3a44,
  timber: 0x6b4a30,
  zinc: 0x4a4d52,
  water: 0x5b8db8,
  red: 0xc0392b,
  awning: 0xc0392b,
  signBlue: 0x2e5fa3,
  lamp: 0xffe9a8,
  darkGreen: 0x2e4a38,
  grey: 0x6e7278,
  dark: 0x33383d,
  teal: 0x2a9d8f,
  bronze: 0x8e8778,
  gold: 0xc9a227,
};

function shade(hex, f) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function mulberry32(seedInt) {
  let a = seedInt >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rect(g, x, y, w, h, color) {
  g.fillStyle(color, 1);
  g.fillRect(x, y, w, h);
}

// Filled box with a 1px darker outline drawn inside its bounds.
function box(g, x, y, w, h, color, outline = shade(color, 0.68)) {
  rect(g, x, y, w, h, color);
  rect(g, x, y, w, 1, outline);
  rect(g, x, y + h - 1, w, 1, outline);
  if (h > 2) {
    rect(g, x, y + 1, 1, h - 2, outline);
    rect(g, x + w - 1, y + 1, 1, h - 2, outline);
  }
}

// Wobbly filled polygon, like the tree canopies in src/look.js.
function blobPts(cx, cy, r, rng, wob = 0.16) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const k = 1 + (rng() - 0.5) * wob * 2;
    pts.push({ x: cx + Math.cos(a) * r * k, y: cy + Math.sin(a) * r * k * 0.86 });
  }
  return pts;
}

function grow(pts, cx, cy, f) {
  return pts.map((p) => ({ x: cx + (p.x - cx) * f, y: cy + (p.y - cy) * f }));
}

// --- individual props -------------------------------------------------------

function treeProp(g, x, y, rng) {
  const dark = shade(PALETTE.green, 0.55);
  const b1 = blobPts(x - 5, y - 16, 5, rng);
  const b2 = blobPts(x + 5, y - 16, 5, rng);
  const b3 = blobPts(x, y - 20, 6.5, rng);
  const b4 = blobPts(x - 2, y - 22, 3.4, rng);
  // Dark halo first, then the green fill on top -> 1px outline.
  g.fillStyle(dark, 1);
  g.fillPoints(grow(b1, x - 5, y - 16, 1.2), true);
  g.fillPoints(grow(b2, x + 5, y - 16, 1.2), true);
  g.fillPoints(grow(b3, x, y - 20, 1.16), true);
  g.fillStyle(PALETTE.green, 1);
  g.fillPoints(b1, true);
  g.fillPoints(b2, true);
  g.fillPoints(b3, true);
  g.fillStyle(shade(PALETTE.green, 1.45), 1);
  g.fillPoints(b4, true);
  rect(g, x - 1, y - 14, 3, 14, PALETTE.timber);
  rect(g, x - 1, y - 14, 1, 14, shade(PALETTE.timber, 0.7));
}

function benchProp(g, x, y) {
  box(g, x - 7, y - 11, 15, 2, PALETTE.timber); // backrest slat
  box(g, x - 7, y - 7, 15, 2, PALETTE.timber); // seat slat
  box(g, x - 7, y - 4, 15, 2, PALETTE.timber); // seat slat
  rect(g, x - 6, y - 11, 1, 11, PALETTE.dark); // legs double as back posts
  rect(g, x + 5, y - 11, 1, 11, PALETTE.dark);
}

function fountainProp(g, x, y) {
  box(g, x - 8, y - 5, 16, 5, PALETTE.stone);
  rect(g, x - 8, y - 5, 16, 1, shade(PALETTE.stone, 1.18));
  rect(g, x - 6, y - 4, 12, 2, PALETTE.water);
  rect(g, x - 6, y - 4, 12, 1, shade(PALETTE.water, 1.3));
  rect(g, x - 1, y - 6, 2, 2, shade(PALETTE.stone, 0.85));
  rect(g, x - 1, y - 12, 2, 7, shade(PALETTE.water, 1.2));
  rect(g, x - 1, y - 14, 2, 2, PALETTE.cream);
}

function busStopProp(g, x, y) {
  rect(g, x, y - 12, 1, 12, PALETTE.zinc);
  box(g, x - 4, y - 17, 9, 5, PALETTE.signBlue);
  rect(g, x - 2, y - 16, 5, 2, PALETTE.cream);
  rect(g, x - 2, y - 14, 5, 1, PALETTE.cream);
  rect(g, x - 1, y - 13, 2, 1, PALETTE.cream);
}

// Outdoor cafe set: table + two chairs, optional striped awning.
function cafeSet(g, x, y, accent, awning) {
  if (awning) {
    for (let i = 0; i < 5; i++) rect(g, x - 10 + i * 4, y - 16, 4, 3, i % 2 ? PALETTE.cream : accent);
    rect(g, x - 10, y - 16, 20, 1, shade(PALETTE.cream, 0.85));
    rect(g, x - 10, y - 13, 1, 9, PALETTE.zinc);
    rect(g, x + 9, y - 13, 1, 9, PALETTE.zinc);
  }
  box(g, x - 5, y - 7, 10, 2, PALETTE.timber);
  rect(g, x - 1, y - 5, 2, 5, shade(PALETTE.timber, 0.8));
  box(g, x - 10, y - 5, 4, 2, accent);
  box(g, x + 6, y - 5, 4, 2, accent);
}

function crateShop(g, x, y, accent) {
  for (let i = 0; i < 6; i++) rect(g, x - 9 + i * 3, y - 13, 3, 3, i % 2 ? PALETTE.cream : accent);
  rect(g, x - 9, y - 13, 18, 1, shade(PALETTE.cream, 0.82));
  box(g, x - 7, y - 6, 14, 6, PALETTE.timber);
  rect(g, x - 7, y - 4, 14, 1, shade(PALETTE.timber, 0.82));
  rect(g, x - 5, y - 8, 2, 2, PALETTE.green);
  rect(g, x - 2, y - 8, 2, 2, PALETTE.roofTop);
  rect(g, x + 1, y - 8, 2, 2, PALETTE.green);
}

function pharmacyProp(g, x, y) {
  box(g, x - 5, y - 11, 10, 9, PALETTE.cream, shade(PALETTE.stone, 0.7));
  rect(g, x - 1, y - 9, 2, 5, PALETTE.green);
  rect(g, x - 3, y - 7, 6, 2, PALETTE.green);
}

// Civic panel sign on a pole: hospital (cross) / school (flag).
function civicSign(g, x, y, band, glyph) {
  rect(g, x - 1, y - 8, 2, 8, PALETTE.zinc);
  box(g, x - 7, y - 18, 14, 10, PALETTE.cream, shade(PALETTE.stone, 0.7));
  rect(g, x - 7, y - 18, 14, 3, band);
  if (glyph === 'cross') {
    rect(g, x - 1, y - 13, 2, 4, PALETTE.red);
    rect(g, x - 3, y - 11, 6, 2, PALETTE.red);
  } else {
    rect(g, x - 1, y - 26, 1, 8, PALETTE.zinc);
    box(g, x, y - 26, 5, 3, PALETTE.red);
  }
}

function mosqueProp(g, x, y) {
  // Slim minaret on the right, domed prayer hall on the left.
  rect(g, x + 6, y - 20, 2, 20, PALETTE.cream);
  rect(g, x + 6, y - 20, 1, 20, shade(PALETTE.cream, 0.85));
  rect(g, x + 5, y - 16, 4, 2, PALETTE.stone);
  g.fillStyle(PALETTE.zinc, 1);
  g.fillPoints([{ x: x + 6, y: y - 20 }, { x: x + 8, y: y - 20 }, { x: x + 7, y: y - 24 }], true);
  box(g, x - 8, y - 9, 14, 9, PALETTE.cream, shade(PALETTE.stone, 0.72));
  rect(g, x - 3, y - 5, 4, 5, shade(PALETTE.stone, 0.88));
  // Lead-grey dome sitting on the roof line (arc bulges upward).
  const base = y - 9;
  const dome = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + (i / 12) * Math.PI;
    dome.push({ x: x - 1 + Math.cos(a) * 7, y: base + Math.sin(a) * 6 });
  }
  g.fillStyle(shade(PALETTE.zinc, 0.6), 1);
  g.fillPoints(dome, true);
  g.fillStyle(PALETTE.zinc, 1);
  g.fillPoints(grow(dome, x - 1, base, 0.92), true);
  g.fillStyle(shade(PALETTE.zinc, 1.35), 1);
  g.fillPoints([{ x: x - 5, y: y - 12 }, { x: x - 2, y: y - 14 }, { x: x - 3, y: y - 10 }], true);
  rect(g, x - 2, y - 19, 2, 4, PALETTE.gold);
  rect(g, x - 2, y - 20, 2, 1, PALETTE.gold);
}

function wasteBasketProp(g, x, y) {
  rect(g, x - 4, y - 9, 8, 2, shade(PALETTE.darkGreen, 0.8));
  box(g, x - 3, y - 7, 6, 7, PALETTE.darkGreen, shade(PALETTE.darkGreen, 0.65));
  rect(g, x - 2, y - 6, 1, 5, shade(PALETTE.darkGreen, 1.3));
  rect(g, x + 1, y - 6, 1, 5, shade(PALETTE.darkGreen, 1.3));
}

function atmProp(g, x, y) {
  box(g, x - 4, y - 11, 8, 11, PALETTE.grey);
  rect(g, x - 3, y - 10, 6, 5, PALETTE.glass);
  rect(g, x - 3, y - 10, 6, 1, shade(PALETTE.glass, 1.6));
  rect(g, x - 2, y - 4, 4, 2, PALETTE.cream);
  rect(g, x - 2, y - 2, 4, 1, shade(PALETTE.grey, 0.85));
}

function fuelProp(g, x, y) {
  for (let i = 0; i < 5; i++) rect(g, x - 8 + i * 4, y - 15, 4, 3, i % 2 ? PALETTE.cream : PALETTE.red);
  rect(g, x - 8, y - 15, 20, 1, shade(PALETTE.cream, 0.82));
  box(g, x - 1, y - 12, 3, 12, PALETTE.grey);
  rect(g, x - 1, y - 10, 3, 3, PALETTE.red);
  rect(g, x - 3, y - 2, 7, 2, shade(PALETTE.stone, 0.8));
}

function parkingProp(g, x, y) {
  rect(g, x - 1, y - 7, 2, 7, PALETTE.zinc);
  box(g, x - 5, y - 15, 10, 8, PALETTE.signBlue);
  rect(g, x - 2, y - 13, 1, 5, PALETTE.cream);
  rect(g, x - 1, y - 13, 2, 1, PALETTE.cream);
  rect(g, x - 1, y - 11, 2, 1, PALETTE.cream);
}

function playgroundProp(g, x, y) {
  box(g, x - 8, y - 6, 16, 2, PALETTE.timber);
  g.fillStyle(PALETTE.zinc, 1);
  g.fillPoints([{ x: x - 2, y: y - 4 }, { x: x + 2, y: y - 4 }, { x: x, y: y }], true);
  box(g, x + 1, y - 14, 5, 2, PALETTE.roofTop);
  g.lineStyle(3, PALETTE.roofTop, 1);
  g.lineBetween(x + 4, y - 13, x + 7, y - 3);
  g.lineStyle(2, PALETTE.zinc, 1);
  g.lineBetween(x + 1, y - 13, x - 1, y - 3);
  g.lineBetween(x + 1, y - 13, x + 2, y - 3);
}
function postBoxProp(g, x, y) {
  box(g, x - 3, y - 9, 6, 9, PALETTE.red);
  rect(g, x - 2, y - 8, 4, 2, PALETTE.glass);
  rect(g, x - 2, y - 5, 4, 1, shade(PALETTE.red, 1.25));
  rect(g, x - 4, y - 1, 8, 1, shade(PALETTE.red, 0.75));
}

function clockProp(g, x, y) {
  rect(g, x - 1, y - 9, 2, 9, PALETTE.zinc);
  g.fillStyle(shade(PALETTE.stone, 0.6), 1);
  g.fillCircle(x, y - 13, 4);
  g.fillStyle(PALETTE.cream, 1);
  g.fillCircle(x, y - 13, 3);
  g.lineStyle(1, PALETTE.glass, 1);
  g.lineBetween(x, y - 13, x, y - 15);
  g.lineBetween(x, y - 13, x + 2, y - 12);
}

function bellTowerProp(g, x, y) {
  box(g, x - 6, y - 28, 12, 28, PALETTE.stone);
  rect(g, x - 6, y - 12, 12, 1, shade(PALETTE.stone, 0.85));
  rect(g, x - 3, y - 22, 6, 7, PALETTE.glass);
  rect(g, x - 2, y - 23, 4, 1, PALETTE.glass);
  rect(g, x - 1, y - 24, 2, 1, PALETTE.glass);
  g.fillStyle(PALETTE.roofTop, 1);
  g.fillPoints([{ x: x - 7, y: y - 28 }, { x: x + 7, y: y - 28 }, { x: x, y: y - 34 }], true);
  g.fillStyle(shade(PALETTE.roofRed, 0.8), 1);
  g.fillPoints([{ x: x - 7, y: y - 28 }, { x: x, y: y - 34 }, { x: x, y: y - 28 }], true);
}

function plinthProp(g, x, y, blockColor, plaque) {
  box(g, x - 6, y - 4, 12, 4, PALETTE.stone);
  box(g, x - 3, y - 12, 6, 8, blockColor);
  if (plaque) {
    rect(g, x - 2, y - 10, 4, 1, PALETTE.cream);
    rect(g, x - 2, y - 8, 4, 1, PALETTE.cream);
  }
}

function statueProp(g, x, y) {
  box(g, x - 5, y - 4, 10, 4, PALETTE.stone);
  box(g, x - 2, y - 12, 4, 7, PALETTE.bronze);
  g.fillStyle(PALETTE.bronze, 1);
  g.fillCircle(x, y - 14, 2);
  g.fillStyle(shade(PALETTE.bronze, 1.3), 1);
  g.fillCircle(x - 0.5, y - 14.5, 0.9);
}

function viewpointProp(g, x, y) {
  rect(g, x - 1, y - 11, 2, 11, PALETTE.timber);
  box(g, x - 7, y - 13, 11, 4, PALETTE.cream, shade(PALETTE.stone, 0.72));
  g.fillStyle(PALETTE.signBlue, 1);
  g.fillPoints([{ x: x - 5, y: y - 12 }, { x: x - 1, y: y - 11 }, { x: x - 5, y: y - 10 }], true);
}

// Generic panel sign on a post with a coloured band.
function bandSign(g, x, y, band) {
  rect(g, x - 1, y - 8, 2, 8, PALETTE.zinc);
  box(g, x - 7, y - 17, 14, 9, PALETTE.cream, shade(PALETTE.stone, 0.7));
  rect(g, x - 7, y - 17, 14, 3, band);
  rect(g, x - 5, y - 12, 10, 1, shade(PALETTE.stone, 0.86));
  rect(g, x - 5, y - 10, 6, 1, shade(PALETTE.stone, 0.86));
}

// Small neutral marker with an optional accent stripe.
function neutralMarker(g, x, y, accent) {
  rect(g, x - 1, y - 5, 2, 5, PALETTE.zinc);
  box(g, x - 3, y - 10, 6, 5, PALETTE.cream, shade(PALETTE.stone, 0.72));
  if (accent) rect(g, x - 2, y - 9, 4, 1, accent);
}

function streetLampProp(g, x, y) {
  rect(g, x, y - 18, 1, 18, PALETTE.dark);
  rect(g, x - 2, y - 21, 5, 3, PALETTE.lamp);
  rect(g, x - 2, y - 22, 5, 1, PALETTE.dark);
  rect(g, x - 2, y - 19, 1, 1, shade(PALETTE.lamp, 0.85));
}

function bollardProp(g, x, y) {
  rect(g, x - 1, y - 6, 2, 6, PALETTE.dark);
  rect(g, x - 1, y - 6, 2, 1, shade(PALETTE.dark, 1.4));
  rect(g, x - 1, y - 4, 2, 1, PALETTE.cream);
}

function hydrantProp(g, x, y) {
  box(g, x - 2, y - 6, 4, 6, PALETTE.red);
  rect(g, x - 1, y - 7, 2, 1, shade(PALETTE.red, 1.25));
  box(g, x + 2, y - 5, 2, 2, PALETTE.red);
  rect(g, x - 3, y - 1, 6, 1, shade(PALETTE.red, 0.75));
}

// --- public API -------------------------------------------------------------

export function drawPropShadow(g, x, y) {
  if (!g) return;
  const cx = Math.round(x);
  const cy = Math.round(y) - 3;
  g.fillStyle(0x3a2a20, 0.1);
  g.fillEllipse(cx, cy, 14, 6);
  g.fillStyle(0x3a2a20, 0.14);
  g.fillEllipse(cx, cy + 1, 8, 4);
}

// kind -> painter. Anything unknown falls back to the neutral marker.
const KINDS = {
  tree: treeProp,
  bench: benchProp,
  fountain: fountainProp,
  drinking_water: (g, x, y) => neutralMarker(g, x, y, PALETTE.water),
  cafe: (g, x, y) => cafeSet(g, x, y, PALETTE.teal, false),
  restaurant: (g, x, y) => cafeSet(g, x, y, PALETTE.awning, true),
  bar: (g, x, y) => cafeSet(g, x, y, PALETTE.roofRed, false),
  pub: (g, x, y) => cafeSet(g, x, y, PALETTE.roofRed, false),
  shop: (g, x, y) => crateShop(g, x, y, PALETTE.signBlue),
  market: (g, x, y) => crateShop(g, x, y, PALETTE.awning),
  pharmacy: pharmacyProp,
  hospital: (g, x, y) => civicSign(g, x, y, PALETTE.red, 'cross'),
  school: (g, x, y) => civicSign(g, x, y, PALETTE.signBlue, 'flag'),
  mosque: mosqueProp,
  bus_stop: busStopProp,
  waste_basket: wasteBasketProp,
  toilet: (g, x, y) => neutralMarker(g, x, y, PALETTE.signBlue),
  atm: atmProp,
  fuel: fuelProp,
  bank: (g, x, y) => bandSign(g, x, y, PALETTE.signBlue),
  hotel: (g, x, y) => bandSign(g, x, y, PALETTE.roofTop),
  artwork: (g, x, y) => plinthProp(g, x, y, PALETTE.bronze, false),
  memorial: (g, x, y) => plinthProp(g, x, y, shade(PALETTE.stone, 1.05), true),
  statue: statueProp,
  viewpoint: viewpointProp,
  parking: parkingProp,
  bicycle_parking: (g, x, y) => neutralMarker(g, x, y, PALETTE.signBlue),
  police: (g, x, y) => bandSign(g, x, y, PALETTE.signBlue),
  post: postBoxProp,
  townhall: (g, x, y) => bandSign(g, x, y, PALETTE.roofRed),
  library: (g, x, y) => bandSign(g, x, y, PALETTE.green),
  museum: (g, x, y) => bandSign(g, x, y, PALETTE.zinc),
  playground: playgroundProp,
  clock: clockProp,
  bell_tower: bellTowerProp,
  street_lamp: streetLampProp,
  bollard: bollardProp,
  hydrant: hydrantProp,
  other: (g, x, y) => neutralMarker(g, x, y, null),
};

export function drawProp(g, x, y, kind, seed) {
  if (!g) return;
  const k = String(kind == null ? '' : kind).toLowerCase();
  const px = Math.round(x);
  const py = Math.round(y);
  const rng = mulberry32(typeof seed === 'number' ? seed >>> 0 : hashStr(String(seed == null ? k : seed)));
  const paint = KINDS[k] || KINDS.other;
  paint(g, px, py, rng);
}
