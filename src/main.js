import * as Phaser from 'phaser';
import { cartToIso } from './iso.js';
import { spawnCats, spawnCars, updateNPCs } from './npcs.js';

const PX_M = 8; // vertical pixels per meter of height
const OX = 400;
const OY = 120;
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
    playerTint = parseInt(btn.dataset.tint, 10);
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

class MainScene extends Phaser.Scene {
  constructor() {
    super('main');
  }

  create() {
    this.cartX = 15;
    this.cartY = 20;
    this.speed = 12; // meters per second
    this.bboxes = [];
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D');

    fetch('data/darphane.json')
      .then((r) => (r.ok ? r.json() : FALLBACK))
      .catch(() => FALLBACK)
      .then((data) => this.buildWorld(data));
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

    // Roads as dark strips.
    (data.roads || []).forEach((road) => {
      const raw = Array.isArray(road[0]) ? road : road.pts || [];
      const line = raw.map(toCart);
      for (let i = 0; i + 1 < line.length; i++) {
        const a = toScreen(line[i][0], line[i][1]);
        const b = toScreen(line[i + 1][0], line[i + 1][1]);
        g.lineStyle(10, 0x2b2e36, 1);
        g.lineBetween(a.x, a.y, b.x, b.y);
        g.lineStyle(6, 0x3a3e48, 1);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
    });

    // Buildings: footprint extrude box, 3 shades + window grid by floors.
    (data.buildings || []).forEach((b) => {
      const cart = b.pts.map(toCart);
      const base = cart.map(([x, y]) => toScreen(x, y));
      const top = base.map((p) => ({ x: p.x, y: p.y - b.height * PX_M }));
      const n = base.length;

      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const p1 = base[i];
        const p2 = base[j];
        const q1 = top[i];
        const q2 = top[j];
        // Shade by facing: +x edge darker, -x edge mid.
        const shade = p2.x - p1.x > 0 ? 0x8a8f9e : 0x6e7384;
        g.fillStyle(shade, 1);
        g.fillPoints(
          [new Phaser.Geom.Point(p1.x, p1.y), new Phaser.Geom.Point(p2.x, p2.y),
           new Phaser.Geom.Point(q2.x, q2.y), new Phaser.Geom.Point(q1.x, q1.y)],
          true,
        );
      }

      // Roof (lightest of the 3 shades).
      g.fillStyle(0xb9bfd0, 1);
      g.fillPoints(top.map((p) => new Phaser.Geom.Point(p.x, p.y)), true);

      // Window grid by floors on the widest front-facing wall.
      const floors = Math.max(1, Math.round(b.height / 3));
      let best = 0;
      let bestLen = -1;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const len = Math.hypot(base[j].x - base[i].x, base[j].y - base[i].y);
        if (base[j].x - base[i].x > 0 && len > bestLen) {
          bestLen = len;
          best = i;
        }
      }
      const j = (best + 1) % n;
      const cols = 4;
      for (let f = 0; f < floors; f++) {
        for (let c = 0; c < cols; c++) {
          const t = (c + 0.5) / cols;
          const wx = base[best].x + (base[j].x - base[best].x) * t;
          const wyTop = top[best].y + (top[j].y - top[best].y) * t;
          const wyBase = base[best].y + (base[j].y - base[best].y) * t;
          const wy = wyTop + ((wyBase - wyTop) * (f + 0.5)) / floors;
          g.fillStyle(0x23262e, 1);
          g.fillRect(Math.round(wx) - 2, Math.round(wy) - 3, 4, 5);
        }
      }

      this.bboxes.push(bboxOf(cart));
    });

    // Screen-space road loops for cars (NPC module reads scene.roads).
    this.roads = (data.roads || []).map((road) => {
      const raw = Array.isArray(road[0]) ? road : road.pts || [];
      return raw.map(([a, b]) => {
        const [x, y] = toCart([a, b]);
        return toScreen(x, y);
      });
    });

    // Character: rect body + face, tint selectable (no external art).
    const tint = window.__playerTint || playerTint;
    this.player = this.add.container(0, 0);
    const body = this.add.rectangle(0, -8, 10, 14, tint);
    const face = this.add.rectangle(0, -12, 6, 4, 0xf5e6c8);
    this.player.add([body, face]);
    this.playerBody = body;
    window.__setTint = (t) => this.playerBody.setFillStyle(t);
    document.querySelectorAll('#select button').forEach((btn) => {
      btn.addEventListener('click', () => window.__setTint(parseInt(btn.dataset.tint, 10)));
    });

    this.syncPlayer();
    this.cameras.main.startFollow(this.player, true, 0.2, 0.2);
    spawnCats(this, 8);
    spawnCars(this, 5);
  }

  blocked(nx, ny) {
    const r = 0.6; // player radius in meters
    return this.bboxes.some(
      (b) => nx + r > b.minX && nx - r < b.maxX && ny + r > b.minY && ny - r < b.maxY,
    );
  }

  update(_time, delta) {
    if (!this.player) return;
    const dt = delta / 1000;
    updateNPCs(dt);
    let dx = 0;
    let dy = 0;
    if (this.cursors.left.isDown || this.keys.A.isDown) dx -= 1;
    if (this.cursors.right.isDown || this.keys.D.isDown) dx += 1;
    if (this.cursors.up.isDown || this.keys.W.isDown) dy -= 1;
    if (this.cursors.down.isDown || this.keys.S.isDown) dy += 1;
    if (dx === 0 && dy === 0) return;
    const len = Math.hypot(dx, dy);
    dx = (dx / len) * this.speed * dt;
    dy = (dy / len) * this.speed * dt;
    // Axis-separated bbox block so player slides along walls.
    if (!this.blocked(this.cartX + dx, this.cartY)) this.cartX += dx;
    if (!this.blocked(this.cartX, this.cartY + dy)) this.cartY += dy;
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
  backgroundColor: '#15171d',
  pixelArt: true,
  roundPixels: true,
  scene: [MainScene],
};

new Phaser.Game(config);
