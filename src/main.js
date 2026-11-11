import * as Phaser from 'phaser';
import { cartToIso } from './iso.js';
import { PAL, mulberry32, hashStr, drawBuilding, drawTree } from './look.js';
import { spawnCats, spawnCars, spawnPeople, spawnGulls, updateNPCs } from './npcs.js';

const PX_M = 8; // vertical pixels per meter of height
const OX = 400;
const OY = 140;
const FALLBACK = {
  meta: { name: 'Darphane fallback' },
  buildings: [
    { id: 'b1', pts: [[0, 0], [10, 0], [10, 8], [0, 8]], height: 9 },
    { id: 'b2', pts: [[16, 4], [24, 4], [24, 12], [16, 12]], height: 6 },
  ],
  roads: [[[0, 14], [30, 14]]],
};

let playerTint = 0x4dc26b;

document.querySelectorAll('#select button').forEach((btn) => {
  btn.addEventListener('click', () => {
    playerTint = Number(btn.dataset.tint);
    window.__playerTint = playerTint;
  });
});

function toScreen(x, y) {
  const p = cartToIso(x, y);
  return { x: Math.round(p.x + OX), y: Math.round(p.y + OY) };
}

function bboxOf(pts) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function lerpInt(a, b, t) {
  return Math.round(a + (b - a) * t);
}

class MainScene extends Phaser.Scene {
  constructor() {
    super('main');
  }

  create() {
    this.cartX = 15;
    this.cartY = 20;
    this.velX = 0;
    this.velY = 0;
    this.speed = 14; // meters per second
    this.walkPhase = 0;
    this.bboxes = [];
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D');

    this.paintSky();

    fetch('data/darphane.json')
      .then((r) => (r.ok ? r.json() : FALLBACK))
      .catch(() => FALLBACK)
      .then((data) => this.buildWorld(data));
  }

  // Warm daylight sky: fixed bands top #FFE9C4 -> horizon #FFD9A8.
  paintSky() {
    const g = this.add.graphics();
    g.setScrollFactor(0);
    g.setDepth(-1000);
    const W = 800;
    const H = 600;
    const N = 14;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const r = lerpInt(0xff, 0xff, t);
      const gg = lerpInt(0xe9, 0xd9, t);
      const b = lerpInt(0xc4, 0xa8, t);
      g.fillStyle((r << 16) | (gg << 8) | b, 1);
      g.fillRect(0, Math.floor((i * H) / N), W, Math.ceil(H / N) + 1);
    }
  }

  buildWorld(data) {
    const g = this.add.graphics();
    const meta = data.meta || {};
    const center = meta.center || { lat: 41.0615, lon: 29.0125 };
    const kx = 111320 * Math.cos((center.lat * Math.PI) / 180);
    const toCart = ([a, b]) =>
      a > 10 && Math.abs(b) > 10
        ? [(a - center.lon) * kx, (center.lat - b) * 111320]
        : [a, b];

    const buildings = (data.buildings || []).map((b, i) => {
      const cart = b.pts.map(toCart);
      return { b, cart, bb: bboxOf(cart), i };
    });
    const roadLines = (data.roads || []).map((road) => {
      const raw = Array.isArray(road[0]) ? road : road.pts || [];
      return raw.map(toCart);
    });

    // Ground base #E8DCC0 with subtle block variation.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const { cart } of buildings) {
      for (const [x, y] of cart) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    for (const line of roadLines) {
      for (const [x, y] of line) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      maxX = 30;
      minY = 0;
      maxY = 20;
    }
    const pad = 30;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;

    const c00 = toScreen(minX, minY);
    const c10 = toScreen(maxX, minY);
    const c11 = toScreen(maxX, maxY);
    const c01 = toScreen(minX, maxY);
    g.fillStyle(0xe8dcc0, 1);
    g.fillPoints(
      [
        new Phaser.Geom.Point(c00.x, c00.y),
        new Phaser.Geom.Point(c10.x, c10.y),
        new Phaser.Geom.Point(c11.x, c11.y),
        new Phaser.Geom.Point(c01.x, c01.y),
      ],
      true,
    );
    // Subtle block variation: 8m iso cells in 3 warm shades.
    const cell = 8;
    const nx = Math.ceil((maxX - minX) / cell);
    const ny = Math.ceil((maxY - minY) / cell);
    if (nx * ny <= 4000) {
      const shades = [0xe8dcc0, 0xe3d2b2, 0xede1c2];
      const rand = mulberry32(7);
      for (let ix = 0; ix < nx; ix++) {
        for (let iy = 0; iy < ny; iy++) {
          const shade = shades[Math.floor(rand() * shades.length) % shades.length];
          if (shade === 0xe8dcc0) continue;
          const x0 = minX + ix * cell;
          const y0 = minY + iy * cell;
          const p0 = toScreen(x0, y0);
          const p1 = toScreen(x0 + cell, y0);
          const p2 = toScreen(x0 + cell, y0 + cell);
          const p3 = toScreen(x0, y0 + cell);
          g.fillStyle(shade, 1);
          g.fillPoints(
            [
              new Phaser.Geom.Point(p0.x, p0.y),
              new Phaser.Geom.Point(p1.x, p1.y),
              new Phaser.Geom.Point(p2.x, p2.y),
              new Phaser.Geom.Point(p3.x, p3.y),
            ],
            true,
          );
        }
      }
    }

    // Streets: cobble #9A9184 with sidewalk borders #D8CCB4 + center dashes.
    for (const line of roadLines) {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = toScreen(line[i][0], line[i][1]);
        const b = toScreen(line[i + 1][0], line[i + 1][1]);
        g.lineStyle(14, 0xd8ccb4, 1);
        g.lineBetween(a.x, a.y, b.x, b.y);
        g.lineStyle(10, 0x9a9184, 1);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
      // Center dashes every ~2m, 1m long.
      for (let i = 0; i + 1 < line.length; i++) {
        const [ax, ay] = line[i];
        const [bx, by] = line[i + 1];
        const segLen = Math.hypot(bx - ax, by - ay);
        if (segLen < 0.5) continue;
        g.lineStyle(2, 0xf5ead0, 1);
        for (let d = 0; d < segLen; d += 2) {
          const t0 = d / segLen;
          const t1 = Math.min(1, (d + 1) / segLen);
          const p0 = toScreen(ax + (bx - ax) * t0, ay + (by - ay) * t0);
          const p1 = toScreen(ax + (bx - ax) * t1, ay + (by - ay) * t1);
          g.lineBetween(p0.x, p0.y, p1.x, p1.y);
        }
      }
    }

    // Buildings far-first: sort by (minX + minY), seeded facade via look.js.
    buildings.sort((p, q) => p.bb.minX + p.bb.minY - (q.bb.minX + q.bb.minY));
    for (const { b, cart, bb } of buildings) {
      const base = cart.map(([x, y]) => toScreen(x, y));
      const seed = hashStr(String(b.id ?? `${bb.minX},${bb.minY}`));
      const facade = b.color ?? PAL.facades[seed % PAL.facades.length];
      const floors = Math.max(1, Math.round(b.height / 3));
      drawBuilding(g, base, { heightPx: b.height * PX_M, seed, floors, facade });
      this.bboxes.push(bb);
    }

    // Trees: seeded along each road every ~14m, alternating sides.
    roadLines.forEach((line, ri) => {
      const cum = [0];
      for (let i = 0; i + 1 < line.length; i++) {
        cum.push(cum[i] + Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]));
      }
      const total = cum[cum.length - 1];
      if (total < 7) return;
      const rand = mulberry32(hashStr(`road-${ri}`));
      const count = Math.floor((total - 7) / 14);
      for (let k = 0; k <= count; k++) {
        const s = 7 + k * 14;
        let seg = 0;
        while (seg + 1 < cum.length - 1 && cum[seg + 1] < s) seg++;
        const segLen = cum[seg + 1] - cum[seg];
        if (segLen < 0.001) continue;
        const t = (s - cum[seg]) / segLen;
        const [ax, ay] = line[seg];
        const [bx, by] = line[seg + 1];
        const dx = (bx - ax) / segLen;
        const dy = (by - ay) / segLen;
        const side = k % 2 === 0 ? 1 : -1;
        const px = ax + (bx - ax) * t + -dy * 4 * side;
        const py = ay + (by - ay) * t + dx * 4 * side;
        void dx;
        void dy;
        const p = toScreen(px, py);
        drawTree(g, p.x, p.y, Math.floor(rand() * 1e9));
      }
    });
    // Courtyard trees behind some buildings (far side = smaller x+y).
    for (const { bb } of buildings) {
      const seed = hashStr(`${bb.minX},${bb.minY}`);
      if (seed % 3 !== 0) continue;
      const cx = (bb.minX + bb.maxX) / 2;
      const p = toScreen(cx, bb.minY - 3);
      drawTree(g, p.x, p.y, seed ^ 0x9e37);
    }

    // Screen-space road loops for cars (NPC module reads scene.roads).
    this.roads = roadLines.map((line) => line.map(([x, y]) => toScreen(x, y)));

    // Player start: middle of first road, else first building, else default.
    if (roadLines.length > 0 && roadLines[0].length > 0) {
      const mid = roadLines[0][Math.floor(roadLines[0].length / 2)];
      this.cartX = mid[0];
      this.cartY = mid[1] + 3;
    } else if (buildings.length > 0) {
      this.cartX = (buildings[0].bb.minX + buildings[0].bb.maxX) / 2;
      this.cartY = buildings[0].bb.maxY + 3;
    }

    // Character: tiny 8x14 pixel walker, 2-frame legs, head + hair, tint shirt.
    const tint = window.__playerTint ?? playerTint;
    this.player = this.add.container(0, 0);
    this.legL = this.add.rectangle(-2, -1, 2, 3, 0x3a3a4a);
    this.legR = this.add.rectangle(2, -1, 2, 3, 0x3a3a4a);
    this.shirt = this.add.rectangle(0, -6, 8, 6, tint);
    const head = this.add.rectangle(0, -11, 6, 4, 0xf2c89b);
    const hair = this.add.rectangle(0, -12, 6, 2, 0x5a3a22);
    this.player.add([this.legL, this.legR, this.shirt, head, hair]);
    this.playerBody = this.shirt;
    window.__setTint = (t) => this.shirt.setFillStyle(t);
    document.querySelectorAll('#select button').forEach((btn) => {
      btn.addEventListener('click', () => window.__setTint(Number(btn.dataset.tint)));
    });

    this.syncPlayer();
    this.cameras.main.startFollow(this.player, true, 0.2, 0.2);
    this.cameras.main.setZoom(1.2);
    spawnCats(this, 8);
    spawnCars(this, 5);
    spawnPeople(this, 6);
    spawnGulls(this, 5);
  }

  blocked(nx, ny) {
    const r = 0.6; // player radius in meters
    return this.bboxes.some(
      (b) => nx + r > b.minX && nx - r < b.maxX && ny + r > b.minY && ny - r < b.maxY,
    );
  }

  update(_time, delta) {
    if (!this.player) return;
    const dt = Math.min(delta / 1000, 0.1);
    updateNPCs(dt);
    let ix = 0;
    let iy = 0;
    if (this.cursors.left.isDown || this.keys.A.isDown) ix -= 1;
    if (this.cursors.right.isDown || this.keys.D.isDown) ix += 1;
    if (this.cursors.up.isDown || this.keys.W.isDown) iy -= 1;
    if (this.cursors.down.isDown || this.keys.S.isDown) iy += 1;
    const len = Math.hypot(ix, iy);
    const tx = len > 0 ? (ix / len) * this.speed : 0;
    const ty = len > 0 ? (iy / len) * this.speed : 0;
    // Smooth accel toward target velocity.
    const k = Math.min(1, 8 * dt);
    this.velX += (tx - this.velX) * k;
    this.velY += (ty - this.velY) * k;
    if (len === 0 && Math.hypot(this.velX, this.velY) < 0.3) {
      this.velX = 0;
      this.velY = 0;
    }
    const stepX = this.velX * dt;
    const stepY = this.velY * dt;
    // Axis-separated bbox block so player slides along walls.
    if (!this.blocked(this.cartX + stepX, this.cartY)) this.cartX += stepX;
    if (!this.blocked(this.cartX, this.cartY + stepY)) this.cartY += stepY;
    // 2-frame leg animation while moving; rest pose when idle.
    if (Math.hypot(this.velX, this.velY) > 1) {
      this.walkPhase += dt * 10;
      const o = Math.floor(this.walkPhase) % 2 === 0 ? 1 : -1;
      this.legL.y = -1 + o;
      this.legR.y = -1 - o;
    } else {
      this.legL.y = -1;
      this.legR.y = -1;
    }
    this.syncPlayer();
  }

  syncPlayer() {
    const p = toScreen(this.cartX, this.cartY);
    this.player.setPosition(p.x, p.y);
    this.player.setDepth(p.x + p.y);
  }
}

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 800,
  height: 600,
  backgroundColor: '#FFD9A8',
  pixelArt: true,
  roundPixels: true,
  scene: [MainScene],
};

new Phaser.Game(config);
