// src/npcs.js — procedural NPCs, zero external assets.
// Phaser 3 scene helpers. All textures drawn via Graphics/generateTexture.
// Cats: 6px white/gray/black wander. Cars: 12x6 boxes on road polylines.

const cats = [];
const cars = [];

// Tile step for cat wander (px). Cat sprite is 6px, fits inside one tile.
const CAT_TILE = 8;
const CAT_SPEED = 12; // px/s toward target tile
const CAR_SPEED = 20; // px/s along polyline, per spec

const CAT_KEYS = ['npc-cat-white', 'npc-cat-gray', 'npc-cat-black'];
const CAT_BODIES = [0xffffff, 0x9aa0a6, 0x202124];

const CAR_KEYS = ['npc-car-red', 'npc-car-blue', 'npc-car-yellow', 'npc-car-teal'];
const CAR_BODIES = [0xd23b3b, 0x3b7bd2, 0xe0b13b, 0x3bb8a6];

// Fallback road loops (closed polylines). Used when scene provides no roads.
// Coordinates assume ~800x600 world; clamped to camera bounds at spawn time.
const DEFAULT_ROADS = [
  [
    { x: 16, y: 120 },
    { x: 784, y: 120 },
    { x: 784, y: 184 },
    { x: 16, y: 184 },
  ],
  [
    { x: 16, y: 400 },
    { x: 784, y: 400 },
    { x: 784, y: 464 },
    { x: 16, y: 464 },
  ],
];

function getBounds(scene) {
  try {
    const cam = scene && scene.cameras && scene.cameras.main;
    if (cam && cam.width && cam.height) return { x0: 8, y0: 8, x1: cam.width - 8, y1: cam.height - 8 };
  } catch (e) { /* fall through to default */ }
  return { x0: 8, y0: 8, x1: 792, y1: 592 };
}

function getRoads(scene, bounds) {
  // Accept scene-defined roads when present, else fall back to defaults.
  // Supported shapes: scene.roads (array of point arrays), or scene.data 'roads'.
  try {
    if (scene && Array.isArray(scene.roads) && scene.roads.length > 0) return scene.roads;
    if (scene && scene.data && typeof scene.data.has === 'function' && scene.data.has('roads')) {
      const r = scene.data.get('roads');
      if (Array.isArray(r) && r.length > 0) return r;
    }
  } catch (e) { /* use defaults */ }
  void bounds;
  return DEFAULT_ROADS;
}

function clampRoads(roads, bounds) {
  return roads.map((line) =>
    line.map((p) => ({
      x: Math.min(Math.max(p.x, bounds.x0), bounds.x1),
      y: Math.min(Math.max(p.y, bounds.y0), bounds.y1),
    }))
  );
}

function ensureCatTextures(scene) {
  for (let i = 0; i < CAT_KEYS.length; i++) {
    const key = CAT_KEYS[i];
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    const body = CAT_BODIES[i];
    // 6x6 cat: body, ears, tail (1px pixels, no smoothing).
    g.fillStyle(body, 1);
    g.fillRect(1, 2, 4, 3); // torso
    g.fillRect(1, 1, 1, 1); // left ear
    g.fillRect(4, 1, 1, 1); // right ear
    g.fillRect(5, 3, 1, 2); // tail
    g.fillStyle(0x111111, 1);
    g.fillRect(2, 3, 1, 1); // eye
    g.generateTexture(key, 6, 6);
    g.destroy();
    const tex = scene.textures.get(key);
    if (tex && typeof tex.setFilter === 'function') {
      tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
  }
}

function ensureCarTextures(scene) {
  for (let i = 0; i < CAR_KEYS.length; i++) {
    const key = CAR_KEYS[i];
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    // 12x6 car: body box, cabin window, 2 wheels. Top-down-ish side view.
    g.fillStyle(CAR_BODIES[i], 1);
    g.fillRect(0, 1, 12, 4); // chassis
    g.fillStyle(0xdfe9f2, 1);
    g.fillRect(7, 2, 3, 2); // windshield / cabin
    g.fillStyle(0x111111, 1);
    g.fillRect(2, 5, 2, 1); // rear wheel
    g.fillRect(8, 5, 2, 1); // front wheel
    g.generateTexture(key, 12, 6);
    g.destroy();
    const tex = scene.textures.get(key);
    if (tex && typeof tex.setFilter === 'function') {
      tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
  }
}

function randBetween(a, b) {
  return a + Math.random() * (b - a);
}

function pickNeighborTile(x, y, bounds) {
  // Random neighbor tile: 8-way step of CAT_TILE, clamped to bounds.
  const dx = (Math.floor(Math.random() * 3) - 1) * CAT_TILE;
  const dy = (Math.floor(Math.random() * 3) - 1) * CAT_TILE;
  return {
    x: Math.min(Math.max(x + dx, bounds.x0), bounds.x1),
    y: Math.min(Math.max(y + dy, bounds.y0), bounds.y1),
  };
}

// Spawn `count` wandering cats at random positions.
export function spawnCats(scene, count) {
  ensureCatTextures(scene);
  const bounds = getBounds(scene);
  const n = Math.max(0, Math.floor(count || 0));
  for (let i = 0; i < n; i++) {
    const key = CAT_KEYS[Math.floor(Math.random() * CAT_KEYS.length)];
    const x = randBetween(bounds.x0, bounds.x1);
    const y = randBetween(bounds.y0, bounds.y1);
    const sprite = scene.add.image(x, y, key);
    sprite.setDepth(x + y);
    const target = pickNeighborTile(x, y, bounds);
    cats.push({
      sprite,
      bounds,
      tx: target.x,
      ty: target.y,
      timer: randBetween(1, 3),
    });
  }
}

// Spawn `count` cars distributed over road polylines. Each car loops its line at 20px/s.
export function spawnCars(scene, count) {
  ensureCarTextures(scene);
  const bounds = getBounds(scene);
  const roads = clampRoads(getRoads(scene, bounds), bounds).filter((line) => line.length >= 2);
  if (roads.length === 0) return;
  const n = Math.max(0, Math.floor(count || 0));
  for (let i = 0; i < n; i++) {
    const pts = roads[i % roads.length];
    const key = CAR_KEYS[Math.floor(Math.random() * CAR_KEYS.length)];
    // Spread cars along the loop: start at vertex (i % len), fraction by index.
    const seg = Math.floor(Math.random() * pts.length) % pts.length;
    const start = pts[seg];
    const sprite = scene.add.image(start.x, start.y, key);
    sprite.setDepth(start.y);
    cars.push({ sprite, pts, seg, speed: CAR_SPEED });
  }
}

function updateCat(c, dt) {
  c.timer -= dt;
  if (c.timer <= 0) {
    const t = pickNeighborTile(c.sprite.x, c.sprite.y, c.bounds);
    c.tx = t.x;
    c.ty = t.y;
    c.timer = randBetween(1, 3);
  }
  const dx = c.tx - c.sprite.x;
  const dy = c.ty - c.sprite.y;
  const d = Math.hypot(dx, dy);
  if (d > 0.5) {
    const step = Math.min(d, CAT_SPEED * dt);
    c.sprite.x += (dx / d) * step;
    c.sprite.y += (dy / d) * step;
    c.sprite.setFlipX(dx < 0);
  }
  c.sprite.setDepth(c.sprite.x + c.sprite.y);
}

function updateCar(c, dt) {
  let remaining = c.speed * dt;
  let guard = 0;
  while (remaining > 0 && guard++ < 8) {
    const target = c.pts[(c.seg + 1) % c.pts.length];
    const dx = target.x - c.sprite.x;
    const dy = target.y - c.sprite.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.001) {
      c.seg = (c.seg + 1) % c.pts.length;
      continue;
    }
    if (remaining < d) {
      c.sprite.x += (dx / d) * remaining;
      c.sprite.y += (dy / d) * remaining;
      c.sprite.setFlipX(dx < 0);
      remaining = 0;
    } else {
      c.sprite.x = target.x;
      c.sprite.y = target.y;
      c.seg = (c.seg + 1) % c.pts.length;
      remaining -= d;
    }
  }
  c.sprite.setDepth(c.sprite.y);
}

// Advance all spawned cats and cars. dt is seconds (clamped internally).
export function updateNPCs(dt) {
  if (!dt || dt <= 0) return;
  const step = Math.min(dt, 0.1);
  for (const c of cats) {
    if (c.sprite && c.sprite.active !== false) updateCat(c, step);
  }
  for (const c of cars) {
    if (c.sprite && c.sprite.active !== false) updateCar(c, step);
  }
}
