// src/npcs.js — procedural Istanbul street life, zero external assets (Graphics + NEAREST).
const cats = [], cars = [], people = [], gulls = [];
let gullTime = 0;
const CAT_TILE = 10, CAT_SPEED = 12, CAR_SPEED = 24, PERSON_TILE = 12, PERSON_SPEED = 20;
const WAG_TIME = 0.4, WALK_TIME = 0.25;
const CAT_DEFS = [
  { name: 'orange', body: 0xd98a3d, stripe: 0x8a5220 },
  { name: 'gray', body: 0x8a8f98, stripe: 0x5a5e66 },
  { name: 'black', body: 0x2b2b2e, stripe: 0x101012 },
  { name: 'white', body: 0xf5f0e6, stripe: 0xc9c2b2 },
];
const CAR_DEFS = [{ name: 'white', body: 0xf2f2f2 }, { name: 'red', body: 0xc93a3a }, { name: 'navy', body: 0x2a3f66 }, { name: 'taxi', body: 0xf2c230 }];
const SHIRTS = [0xc94f4f, 0x4f7ac9, 0x53a05a, 0x8a5ac9, 0xd98a3d, 0x3bb8a6, 0xe2e2e2, 0x30303a];
const SKIN = 0xe8b88a, PANTS = 0x2e3440;
const DEFAULT_ROADS = [[{ x: 16, y: 120 }, { x: 784, y: 120 }, { x: 784, y: 184 }, { x: 16, y: 184 }], [{ x: 16, y: 400 }, { x: 784, y: 400 }, { x: 784, y: 464 }, { x: 16, y: 464 }]];
function getBounds(scene) {
  if (scene && scene.npcCenter) {
    const { x, y } = scene.npcCenter;
    return { x0: x - 350, y0: y - 250, x1: x + 350, y1: y + 250 };
  }
  try {
    const cam = scene && scene.cameras && scene.cameras.main;
    if (cam && cam.width && cam.height) return { x0: 8, y0: 8, x1: cam.width - 8, y1: cam.height - 8 };
  } catch (e) { /* default */ }
  return { x0: 8, y0: 8, x1: 792, y1: 592 };
}
function getRoads(scene) {
  try {
    if (scene && Array.isArray(scene.roads) && scene.roads.length > 0) return scene.roads;
    if (scene && scene.data && typeof scene.data.has === 'function' && scene.data.has('roads')) {
      const r = scene.data.get('roads');
      if (Array.isArray(r) && r.length > 0) return r;
    }
  } catch (e) { /* defaults */ }
  return DEFAULT_ROADS;
}
function clampRoads(roads, bounds) {
  return roads.map((line) => line.map((p) => ({ x: Math.min(Math.max(p.x, bounds.x0), bounds.x1), y: Math.min(Math.max(p.y, bounds.y0), bounds.y1) }))).filter((l) => l.length >= 2);
}
function nearest(scene, key) {
  try {
    const tex = scene.textures.get(key);
    if (tex && typeof tex.setFilter === 'function') tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  } catch (e) { /* Phaser global may be absent in tests */ }
}
function randBetween(a, b) { return a + Math.random() * (b - a); }
function pickTile(x, y, bounds, step) {
  const dx = (Math.floor(Math.random() * 3) - 1) * step, dy = (Math.floor(Math.random() * 3) - 1) * step;
  return { x: Math.min(Math.max(x + dx, bounds.x0), bounds.x1), y: Math.min(Math.max(y + dy, bounds.y0), bounds.y1) };
}
function stepToward(s, tx, ty, speed, dt) {
  const dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy);
  if (d <= 0.5) return;
  const step = Math.min(d, speed * dt);
  s.x += (dx / d) * step; s.y += (dy / d) * step;
  s.setFlipX(dx < 0);
}
// 8x7 cat: ears/head/body, 2 tail frames, tabby stripes, shadow ellipse.
function ensureCatTextures(scene) {
  for (const def of CAT_DEFS) for (let f = 0; f < 2; f++) {
    const key = `npc-cat-${def.name}-${f}`;
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0x000000, 0.28); g.fillEllipse(4, 6.3, 6, 1.4);
    g.fillStyle(def.body, 1);
    g.fillRect(1, 0, 1, 1); g.fillRect(3, 0, 1, 1); g.fillRect(0, 1, 5, 2); g.fillRect(0, 3, 6, 3);
    if (f === 0) g.fillRect(6, 1, 1, 4);
    else { g.fillRect(6, 3, 2, 1); g.fillRect(7, 2, 1, 1); }
    g.fillStyle(0x1a1a1a, 1); g.fillRect(1, 2, 1, 1); g.fillRect(3, 2, 1, 1);
    if (def.name === 'orange' || def.name === 'gray') { g.fillStyle(def.stripe, 1); g.fillRect(2, 3, 1, 3); g.fillRect(0, 4, 6, 1); }
    g.generateTexture(key, 8, 7); g.destroy(); nearest(scene, key);
  }
}
// 16x8 cars: chassis, windows, wheels, headlights. Taxi adds checker + roof sign.
function ensureCarTextures(scene) {
  for (const def of CAR_DEFS) {
    const key = `npc-car-${def.name}`;
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    if (def.name === 'taxi') { g.fillStyle(0xf5f0e6, 1); g.fillRect(7, 0, 3, 1); }
    g.fillStyle(def.body, 1); g.fillRect(0, 2, 16, 4);
    g.fillStyle(0xcfe4ee, 1); g.fillRect(3, 1, 4, 2); g.fillRect(9, 1, 4, 2);
    g.fillStyle(def.body, 1); g.fillRect(7, 1, 2, 2);
    if (def.name === 'taxi') {
      g.fillStyle(0x1a1a1a, 1);
      for (let x = 0; x < 16; x += 2) g.fillRect(x, 4, 1, 1);
      g.fillRect(8, 0, 1, 1);
    } else { g.fillStyle(0x9aa0a6, 1); g.fillRect(0, 5, 1, 1); g.fillRect(15, 5, 1, 1); }
    g.fillStyle(0xfff6c9, 1); g.fillRect(15, 3, 1, 1);
    g.fillStyle(0x8a1f1f, 1); g.fillRect(0, 3, 1, 1);
    g.fillStyle(0x111111, 1); g.fillRect(2, 6, 3, 2); g.fillRect(11, 6, 3, 2);
    g.fillStyle(0x9aa0a6, 1); g.fillRect(3, 6, 1, 1); g.fillRect(12, 6, 1, 1);
    g.generateTexture(key, 16, 8); g.destroy(); nearest(scene, key);
  }
}
// 8x14 walker: hair/head/shirt, 2 stride frames, shoes, shadow.
function ensurePeopleTextures(scene) {
  for (let i = 0; i < SHIRTS.length; i++) for (let f = 0; f < 2; f++) {
    const key = `npc-person-${i}-${f}`;
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0x000000, 0.25); g.fillEllipse(4, 13.4, 5, 1.2);
    g.fillStyle(0x3a2a20, 1); g.fillRect(2, 0, 4, 1);
    g.fillStyle(SKIN, 1); g.fillRect(2, 1, 4, 3); g.fillRect(1, 4, 6, 5); // head + shirt reuse
    g.fillStyle(SHIRTS[i], 1); g.fillRect(1, 4, 6, 5);
    g.fillStyle(SKIN, 1); g.fillRect(0, 5, 1, 2); g.fillRect(7, 5, 1, 2);
    g.fillStyle(PANTS, 1);
    if (f === 0) { g.fillRect(2, 9, 2, 4); g.fillRect(4, 9, 2, 3); } else { g.fillRect(2, 9, 2, 3); g.fillRect(4, 9, 2, 4); }
    g.fillStyle(0x111111, 1);
    if (f === 0) { g.fillRect(2, 12, 2, 1); g.fillRect(4, 11, 2, 1); } else { g.fillRect(2, 11, 2, 1); g.fillRect(4, 12, 2, 1); }
    g.generateTexture(key, 8, 14); g.destroy(); nearest(scene, key);
  }
}
// 6x3 gull: frame 0 V flap, frame 1 flat glide.
function ensureGullTextures(scene) {
  const shapes = [[[0, 0], [1, 1], [2, 2], [3, 2], [4, 1], [5, 0]], [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]];
  for (let f = 0; f < 2; f++) {
    const key = `npc-gull-${f}`;
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1);
    for (const [x, y] of shapes[f]) g.fillRect(x, y, 1, 1);
    g.generateTexture(key, 6, 3); g.destroy(); nearest(scene, key);
  }
}
export function spawnCats(scene, count) {
  ensureCatTextures(scene);
  const bounds = getBounds(scene), n = Math.max(0, Math.floor(count || 0));
  for (let i = 0; i < n; i++) {
    const ci = Math.floor(Math.random() * CAT_DEFS.length), sitting = Math.random() < 0.3;
    const x = randBetween(bounds.x0, bounds.x1), y = randBetween(bounds.y0, bounds.y1);
    const sprite = scene.add.image(x, y, `npc-cat-${CAT_DEFS[ci].name}-0`);
    sprite.setDepth(x + y + 20000);
    const t = pickTile(x, y, bounds, CAT_TILE);
    cats.push({ sprite, bounds, ci, frame: 0, wag: randBetween(0, WAG_TIME), sitting, tx: t.x, ty: t.y, timer: randBetween(1, 3) });
  }
}
export function spawnCars(scene, count) {
  ensureCarTextures(scene);
  const bounds = getBounds(scene), roads = clampRoads(getRoads(scene), bounds);
  if (roads.length === 0) return;
  const n = Math.max(0, Math.floor(count || 0)), parked = Math.floor(n / 2);
  for (let i = 0; i < n; i++) {
    const pts = roads[i % roads.length];
    const key = `npc-car-${CAR_DEFS[Math.floor(Math.random() * CAR_DEFS.length)].name}`;
    if (i < parked) {
      const p = pts[i % pts.length];
      const sprite = scene.add.image(p.x, p.y + 8, key);
      sprite.setDepth(p.y + 8 + 20000);
      cars.push({ sprite, pts, seg: 0, speed: 0, parked: true });
    } else {
      const seg = Math.floor(Math.random() * pts.length) % pts.length;
      const sprite = scene.add.image(pts[seg].x, pts[seg].y, key);
      sprite.setDepth(pts[seg].y + 20000);
      cars.push({ sprite, pts, seg, speed: CAR_SPEED, parked: false });
    }
  }
}
export function spawnPeople(scene, count) {
  ensurePeopleTextures(scene);
  const bounds = getBounds(scene), roads = clampRoads(getRoads(scene), bounds), n = Math.max(0, Math.floor(count || 0));
  for (let i = 0; i < n; i++) {
    const si = Math.floor(Math.random() * SHIRTS.length);
    let x = randBetween(bounds.x0, bounds.x1), y = randBetween(bounds.y0, bounds.y1);
    if (roads.length > 0) {
      const pts = roads[i % roads.length], p = pts[Math.floor(Math.random() * pts.length)];
      x = Math.min(Math.max(p.x + randBetween(-40, 40), bounds.x0), bounds.x1);
      y = Math.min(Math.max(p.y + (Math.random() < 0.5 ? -12 : 12), bounds.y0), bounds.y1);
    }
    const sprite = scene.add.image(x, y, `npc-person-${si}-0`);
    sprite.setDepth(x + y + 20000);
    const t = pickTile(x, y, bounds, PERSON_TILE);
    people.push({ sprite, bounds, si, frame: 0, walk: 0, tx: t.x, ty: t.y, timer: randBetween(1, 3) });
  }
}
export function spawnGulls(scene, count) {
  ensureGullTextures(scene);
  const bounds = getBounds(scene), n = Math.max(0, Math.floor(count || 0));
  const skyY1 = bounds.y0 + (bounds.y1 - bounds.y0) * 0.3;
  for (let i = 0; i < n; i++) {
    const sprite = scene.add.image(randBetween(bounds.x0, bounds.x1), randBetween(bounds.y0, skyY1), `npc-gull-${i % 2}`);
    sprite.setDepth(30000);
    const dir = Math.random() < 0.5 ? -1 : 1;
    gulls.push({ sprite, bounds, vx: dir * randBetween(12, 28), baseY: sprite.y, phase: randBetween(0, 6.28), flap: randBetween(0, WAG_TIME), frame: 0 });
  }
}
function updateCat(c, dt) {
  c.wag += dt;
  if (c.wag >= WAG_TIME) { c.wag = 0; c.frame = 1 - c.frame; c.sprite.setTexture(`npc-cat-${CAT_DEFS[c.ci].name}-${c.frame}`); }
  if (c.sitting) return;
  c.timer -= dt;
  if (c.timer <= 0) { const t = pickTile(c.sprite.x, c.sprite.y, c.bounds, CAT_TILE); c.tx = t.x; c.ty = t.y; c.timer = randBetween(1, 3); }
  stepToward(c.sprite, c.tx, c.ty, CAT_SPEED, dt);
  c.sprite.setDepth(c.sprite.x + c.sprite.y + 20000);
}
function updateCar(c, dt) {
  if (c.parked) return;
  let remaining = c.speed * dt, guard = 0;
  while (remaining > 0 && guard++ < 8) {
    const target = c.pts[(c.seg + 1) % c.pts.length];
    const dx = target.x - c.sprite.x, dy = target.y - c.sprite.y, d = Math.hypot(dx, dy);
    if (d < 0.001) { c.seg = (c.seg + 1) % c.pts.length; continue; }
    if (remaining < d) { c.sprite.x += (dx / d) * remaining; c.sprite.y += (dy / d) * remaining; c.sprite.setFlipX(dx < 0); remaining = 0; }
    else { c.sprite.x = target.x; c.sprite.y = target.y; c.seg = (c.seg + 1) % c.pts.length; remaining -= d; }
  }
  c.sprite.setDepth(c.sprite.y + 20000);
}
function updatePerson(p, dt) {
  p.walk += dt;
  if (p.walk >= WALK_TIME) { p.walk = 0; p.frame = 1 - p.frame; p.sprite.setTexture(`npc-person-${p.si}-${p.frame}`); }
  p.timer -= dt;
  if (p.timer <= 0) { const t = pickTile(p.sprite.x, p.sprite.y, p.bounds, PERSON_TILE); p.tx = t.x; p.ty = t.y; p.timer = randBetween(1, 3); }
  stepToward(p.sprite, p.tx, p.ty, PERSON_SPEED, dt);
  p.sprite.setDepth(p.sprite.x + p.sprite.y + 20000);
}
function updateGull(gl, dt) {
  gl.flap += dt;
  if (gl.flap >= WAG_TIME) { gl.flap = 0; gl.frame = 1 - gl.frame; gl.sprite.setTexture(`npc-gull-${gl.frame}`); }
  gl.sprite.x += gl.vx * dt;
  gl.sprite.y = gl.baseY + Math.sin(gullTime + gl.phase) * 6;
  const m = 10, sky = 0.3 * (gl.bounds.y1 - gl.bounds.y0);
  if (gl.vx > 0 && gl.sprite.x > gl.bounds.x1 + m) { gl.sprite.x = gl.bounds.x0 - m; gl.baseY = randBetween(gl.bounds.y0, gl.bounds.y0 + sky); }
  if (gl.vx < 0 && gl.sprite.x < gl.bounds.x0 - m) { gl.sprite.x = gl.bounds.x1 + m; gl.baseY = randBetween(gl.bounds.y0, gl.bounds.y0 + sky); }
}
export function updateNPCs(dt) {
  if (!dt || dt <= 0) return;
  const step = Math.min(dt, 0.1);
  gullTime += step;
  for (const c of cats) if (c.sprite && c.sprite.active !== false) updateCat(c, step);
  for (const c of cars) if (c.sprite && c.sprite.active !== false) updateCar(c, step);
  for (const p of people) if (p.sprite && p.sprite.active !== false) updatePerson(p, step);
  for (const gl of gulls) if (gl.sprite && gl.sprite.active !== false) updateGull(gl, step);
}
