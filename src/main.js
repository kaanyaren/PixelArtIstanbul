import * as Phaser from 'phaser';
import { cartToIso } from './iso.js';
import { PAL, mulberry32, hashStr, drawBuilding, drawTree } from './look.js';
import { spawnCats, spawnCars, spawnPeople, spawnGulls, updateNPCs } from './npcs.js';
import { areaFromURL, gotoArea, fetchArea } from './area.js';

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

let areaMap = null;
let areaMarker = null;

function wireAreaPicker() {
  const openBtn = document.getElementById('change-area');
  const modal = document.getElementById('area-modal');
  if (!openBtn || !modal || openBtn.dataset.wired) return;
  openBtn.dataset.wired = '1';
  const cancel = document.getElementById('area-cancel');
  const play = document.getElementById('area-play');
  const home = document.getElementById('area-home');
  openBtn.addEventListener('click', () => {
    modal.style.display = 'block';
    if (!areaMap) {
      const c = window.__areaCenter || { lat: 41.0615, lon: 29.0125 };
      areaMap = window.L.map('area-map').setView([c.lat, c.lon], 15);
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(areaMap);
      areaMarker = window.L.marker([c.lat, c.lon], { draggable: true }).addTo(areaMap);
      areaMap.on('click', (e) => areaMarker.setLatLng(e.latlng));
    } else {
      const c = window.__areaCenter || { lat: 41.0615, lon: 29.0125 };
      areaMap.setView([c.lat, c.lon], 15);
      areaMarker.setLatLng([c.lat, c.lon]);
    }
    setTimeout(() => areaMap && areaMap.invalidateSize(), 50);
  });
  if (cancel) cancel.addEventListener('click', () => { modal.style.display = 'none'; });
  if (play) play.addEventListener('click', () => {
    const ll = areaMarker.getLatLng();
    gotoArea(ll.lat, ll.lng);
  });
  if (home) home.addEventListener('click', () => {
    window.location.search = '';
  });
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
    this.touch = { up: false, down: false, left: false, right: false };
    // D-pad + zoom buttons (wired in buildWorld; elements live in index.html).
    this.input.on('wheel', (_p, _o, _dx, dy) => {
      const cam = this.cameras.main;
      const z = Math.max(0.6, Math.min(2.6, cam.zoom * (dy > 0 ? 0.9 : 1.12)));
      cam.setZoom(z);
    });

    this.paintSky();

    wireAreaPicker();
    const a = areaFromURL();
    if (a) {
      const loading = document.getElementById('area-loading');
      if (loading) loading.style.display = 'block';
      fetchArea(a.lat, a.lon)
        .then((data) => {
          if (loading) loading.style.display = 'none';
          this.buildWorld(data);
        })
        .catch((err) => {
          if (loading) loading.style.display = 'none';
          const toast = document.getElementById('area-err');
          if (toast) {
            toast.textContent = String((err && err.message) || err || 'Area load failed');
            toast.style.display = 'block';
            setTimeout(() => { toast.style.display = 'none'; }, 4000);
          }
          fetch('data/darphane.json')
            .then((r) => (r.ok ? r.json() : FALLBACK))
            .catch(() => FALLBACK)
            .then((data) => this.buildWorld(data));
        });
    } else {
      fetch('data/darphane.json')
        .then((r) => (r.ok ? r.json() : FALLBACK))
        .catch(() => FALLBACK)
        .then((data) => this.buildWorld(data));
    }
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
    window.__areaCenter = center;
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
      const raw = Array.isArray(road) ? road : road.pts || [];
      return raw.map(toCart);
    });
    const roadMeta = (data.roads || []).map((road) =>
      Array.isArray(road) ? { name: null, kind: null } : { name: road.name ?? null, kind: road.kind ?? null },
    );

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
    // Subtle block variation: 16m iso cells in 3 warm shades.
    const cell = 16;
    const nx = Math.ceil((maxX - minX) / cell);
    const ny = Math.ceil((maxY - minY) / cell);
    if (nx * ny <= 4000) {
      const shades = [0xe8dcc0, 0xdcc9a4, 0xf2e7cc];
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

    // Street furniture + labels (read road.name / road.kind where road is object).
    {
      const lampKinds = new Set(['tertiary', 'secondary', 'residential']);
      const crossKinds = new Set(['tertiary', 'secondary', 'primary', 'residential']);
      const labelCands = [];
      roadLines.forEach((line, ri) => {
        const meta = roadMeta[ri] || { name: null, kind: null };
        if (line.length < 2) return;
        const scr = line.map(([x, y]) => toScreen(x, y));
        let screenLen = 0;
        let cartLen = 0;
        let bestLen = -1;
        let bestA = null;
        let bestB = null;
        for (let i = 0; i + 1 < line.length; i++) {
          const cl = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
          cartLen += cl;
          const sl = Math.hypot(scr[i + 1].x - scr[i].x, scr[i + 1].y - scr[i].y);
          screenLen += sl;
          if (sl > bestLen) {
            bestLen = sl;
            bestA = scr[i];
            bestB = scr[i + 1];
          }
        }
        // Crosswalks: zebra of 5 white bars perpendicular at midpoint.
        if (crossKinds.has(meta.kind) && cartLen > 80) {
          const half = cartLen / 2;
          let acc = 0;
          let mi = 0;
          while (mi + 1 < line.length - 1 && acc + Math.hypot(line[mi + 1][0] - line[mi][0], line[mi + 1][1] - line[mi][1]) < half) {
            acc += Math.hypot(line[mi + 1][0] - line[mi][0], line[mi + 1][1] - line[mi][1]);
            mi++;
          }
          const [ax, ay] = line[mi];
          const [bx, by] = line[mi + 1];
          const segLen = Math.hypot(bx - ax, by - ay) || 1;
          const dx = (bx - ax) / segLen;
          const dy = (by - ay) / segLen;
          const t = (half - acc) / segLen;
          const mx = ax + (bx - ax) * t;
          const my = ay + (by - ay) * t;
          const px = -dy;
          const py = dx;
          g.lineStyle(2, 0xffffff, 0.9);
          for (let k = -2; k <= 2; k++) {
            const cx = mx + dx * k * 2;
            const cy = my + dy * k * 2;
            const e0 = toScreen(cx + px * 3, cy + py * 3);
            const e1 = toScreen(cx - px * 3, cy - py * 3);
            g.lineBetween(e0.x, e0.y, e1.x, e1.y);
          }
        }
        // Street lamps: every ~45m, alternating sides.
        if (lampKinds.has(meta.kind) && cartLen > 45) {
          const cum = [0];
          for (let i = 0; i + 1 < line.length; i++) {
            cum.push(cum[i] + Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]));
          }
          let side = 1;
          for (let s = 22.5; s < cartLen; s += 45) {
            let seg = 0;
            while (seg + 1 < cum.length - 1 && cum[seg + 1] < s) seg++;
            const sLen = cum[seg + 1] - cum[seg] || 1;
            const t = (s - cum[seg]) / sLen;
            const [ax, ay] = line[seg];
            const [bx, by] = line[seg + 1];
            const dx = (bx - ax) / sLen;
            const dy = (by - ay) / sLen;
            const lx = ax + (bx - ax) * t + -dy * 4 * side;
            const ly = ay + (by - ay) * t + dx * 4 * side;
            side = -side;
            const p = toScreen(lx, ly);
            g.lineStyle(3, 0x555555, 1);
            g.lineBetween(p.x, p.y, p.x, p.y - 18);
            g.fillStyle(0x333333, 1);
            g.fillRect(p.x - 2, p.y - 22, 4, 4);
            g.fillStyle(0xffe9a8, 1);
            g.fillCircle(p.x, p.y - 18, 2);
          }
        }
        // Street name label candidate: keep full screen polyline; placed near player later.
        if (meta.name && screenLen > 120) {
          labelCands.push({ name: meta.name, scr });
        }
      });
      this._labelCands = labelCands;
    }

    // Buildings far-first: sort by (minX + minY), seeded facade via look.js.
    buildings.sort((p, q) => p.bb.minX + p.bb.minY - (q.bb.minX + q.bb.minY));
    for (const { b, cart, bb } of buildings) {
      const base = cart.map(([x, y]) => toScreen(x, y));
      // Warm courtyard parcel under each building.
      g.fillStyle(0xefe3cb, 1);
      g.fillPoints(base.map((p) => new Phaser.Geom.Point(p.x, p.y + 2)), true);
      const seed = hashStr(String(b.id ?? `${bb.minX},${bb.minY}`));
      const facade = b.color ?? PAL.facades[seed % PAL.facades.length];
      const floors = Math.max(1, Math.round(b.height / 3));
      drawBuilding(g, base, { heightPx: b.height * PX_M, seed, floors, facade });
      this.bboxes.push(bb);
      if (b.landmark) {
        const lcx = base.reduce((s, p) => s + p.x, 0) / base.length;
        const topY = Math.min(...base.map((p) => p.y)) - b.height * PX_M - 30;
        this.add
          .text(lcx, topY, b.landmark, {
            fontFamily: 'monospace',
            fontSize: '24px',
            fontStyle: 'bold',
            color: '#8A1F1F',
            backgroundColor: '#F7ECC8',
            padding: { x: 8, y: 4 },
          })
          .setOrigin(0.5)
          .setDepth(lcx + topY + 20001);
      }
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

    // Player start: exactly the dropped pin (area center = 0,0), spiralled out of walls.
    this.cartX = 0;
    this.cartY = 3;
    if (this.blocked(this.cartX, this.cartY)) {
      let found = false;
      for (let r = 2; r <= 40 && !found; r += 2) {
        for (let a = 0; a < 8 && !found; a++) {
          const nx = r * Math.cos((a * Math.PI) / 4);
          const ny = r * Math.sin((a * Math.PI) / 4) + 3;
          if (!this.blocked(nx, ny)) {
            this.cartX = nx;
            this.cartY = ny;
            found = true;
          }
        }
      }
    }

    // Character: 12x18 walker textures, 3 looks x 2 frames (legs apart/together).
    const WALK = { Green: 0x4dc26b, Blue: 0x4d8ac2, Red: 0xc25d4d };
    this.walkSet = 'Green';
    for (const [name, shirt] of Object.entries(WALK)) {
      for (let f = 0; f < 2; f++) {
        const key = `walk-${name}-${f}`;
        if (this.textures.exists(key)) continue;
        const wg = this.make.graphics({ x: 0, y: 0, add: false });
        if (name === 'Green') {
          // Woman: long dark hair sides, green dress.
          wg.fillStyle(0x3a2a1a, 1).fillRect(2, 0, 8, 2);
          wg.fillStyle(0x3a2a1a, 1).fillRect(1, 0, 2, 10).fillRect(9, 0, 2, 10);
          wg.fillStyle(0xf2c89b, 1).fillRect(3, 2, 6, 4);
          wg.fillStyle(0x222222, 1).fillRect(4, 4, 1, 1).fillRect(7, 4, 1, 1);
          wg.fillStyle(shirt, 1).fillRect(2, 6, 8, 7);
          wg.fillStyle(0xf2c89b, 1);
          if (f === 0) wg.fillRect(3, 13, 2, 3).fillRect(7, 13, 2, 3);
          else wg.fillRect(5, 13, 2, 3);
          wg.fillStyle(0x2e3440, 1);
          if (f === 0) wg.fillRect(3, 16, 2, 2).fillRect(7, 16, 2, 2);
          else wg.fillRect(5, 16, 2, 2);
        } else if (name === 'Blue') {
          // Man: short hair + cap, blue jacket, jeans.
          wg.fillStyle(0x5a3a22, 1).fillRect(2, 2, 1, 2).fillRect(9, 2, 1, 2);
          wg.fillStyle(0xf2c89b, 1).fillRect(3, 2, 6, 4);
          wg.fillStyle(0x222222, 1).fillRect(4, 4, 1, 1).fillRect(7, 4, 1, 1);
          wg.fillStyle(0x2a4a6b, 1).fillRect(2, 0, 8, 2).fillRect(1, 1, 10, 1);
          wg.fillStyle(shirt, 1).fillRect(2, 6, 8, 6);
          wg.fillStyle(0x3a4a5a, 1);
          if (f === 0) wg.fillRect(3, 12, 2, 4).fillRect(7, 12, 2, 4);
          else wg.fillRect(5, 12, 2, 4);
          wg.fillStyle(0x222222, 1);
          if (f === 0) wg.fillRect(3, 16, 2, 2).fillRect(7, 16, 2, 2);
          else wg.fillRect(5, 16, 2, 2);
        } else {
          // Kid: red hoodie with hood, shorts.
          wg.fillStyle(shirt, 1).fillRect(2, 0, 8, 6);
          wg.fillStyle(0xf2c89b, 1).fillRect(4, 2, 4, 4);
          wg.fillStyle(0x222222, 1).fillRect(5, 4, 1, 1).fillRect(7, 4, 1, 1);
          wg.fillStyle(shirt, 1).fillRect(2, 6, 8, 6);
          wg.fillStyle(0xd8ccb4, 1).fillRect(5, 8, 2, 2);
          wg.fillStyle(0x3a4a5a, 1).fillRect(3, 12, 6, 2);
          wg.fillStyle(0xf2c89b, 1);
          if (f === 0) wg.fillRect(3, 14, 2, 2).fillRect(7, 14, 2, 2);
          else wg.fillRect(5, 14, 2, 2);
          wg.fillStyle(0x222222, 1);
          if (f === 0) wg.fillRect(3, 16, 2, 2).fillRect(7, 16, 2, 2);
          else wg.fillRect(5, 16, 2, 2);
        }
        wg.generateTexture(key, 12, 18);
        wg.destroy();
      }
    }
    const tint0 = window.__playerTint ?? playerTint;
    if (tint0 === 0x4d8ac2) this.walkSet = 'Blue';
    if (tint0 === 0xc25d4d) this.walkSet = 'Red';
    this.player = this.add.image(0, 0, `walk-${this.walkSet}-0`);
    window.__setTint = (t) => {
      this.walkSet = t === 0x4d8ac2 ? 'Blue' : t === 0xc25d4d ? 'Red' : 'Green';
      this.player.setTexture(`walk-${this.walkSet}-0`);
    };
    document.querySelectorAll('#select button').forEach((btn) => {
      btn.addEventListener('click', () => window.__setTint(Number(btn.dataset.tint)));
    });

    this.syncPlayer();
    this.cameras.main.startFollow(this.player, true, 0.2, 0.2);
    this.cameras.main.setZoom(1.2);
    this.npcCenter = { x: this.player.x, y: this.player.y };
    // On-screen D-pad (hold to walk) + zoom buttons.
    {
      const bind = (id, key) => {
        const el = document.getElementById(id);
        if (!el || !this.touch) return;
        const on = (e) => {
          e.preventDefault();
          this.touch[key] = true;
        };
        const off = (e) => {
          if (e) e.preventDefault();
          this.touch[key] = false;
        };
        el.addEventListener('pointerdown', on);
        el.addEventListener('pointerup', off);
        el.addEventListener('pointerleave', off);
        el.addEventListener('pointercancel', off);
      };
      bind('dpad-up', 'up');
      bind('dpad-down', 'down');
      bind('dpad-left', 'left');
      bind('dpad-right', 'right');
      const zoomBy = (f) => {
        const cam = this.cameras.main;
        cam.setZoom(Math.max(0.6, Math.min(2.6, cam.zoom * f)));
      };
      const zi = document.getElementById('zoom-in');
      const zo = document.getElementById('zoom-out');
      if (zi) zi.addEventListener('click', () => zoomBy(1.25));
      if (zo) zo.addEventListener('click', () => zoomBy(0.8));
    }
    // Street name labels at road points nearest the player (max 12, within 700px).
    {
      const px = this.player.x;
      const py = this.player.y;
      const placed = [];
      for (const c of this._labelCands || []) {
        let bd = Infinity;
        let bx = 0;
        let by = 0;
        let ba = 0;
        for (let i = 0; i + 1 < c.scr.length; i++) {
          const A = c.scr[i];
          const B = c.scr[i + 1];
          const vx = B.x - A.x;
          const vy = B.y - A.y;
          const L2 = vx * vx + vy * vy || 1;
          let t = ((px - A.x) * vx + (py - A.y) * vy) / L2;
          t = Math.max(0, Math.min(1, t));
          const qx = A.x + vx * t;
          const qy = A.y + vy * t;
          const d = Math.hypot(px - qx, py - qy);
          if (d < bd) {
            bd = d;
            bx = qx;
            by = qy;
            ba = Math.atan2(vy, vx);
          }
        }
        if (bd < 1400) placed.push({ name: c.name, d: bd, x: bx, y: by, ang: ba });
      }
      placed.sort((a, b) => a.d - b.d);
      const shown = [];
      for (const c of placed) {
        if (shown.length >= 30) break;
        if (shown.some((s) => Math.hypot(s.x - c.x, s.y - c.y) < 60)) continue;
        shown.push(c);
        let ang = c.ang;
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang < -Math.PI / 2) ang += Math.PI;
        this.add
          .text(c.x, c.y - 10, c.name, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#4a3f30',
            backgroundColor: '#f5ead0',
            padding: { x: 4, y: 2 },
          })
          .setOrigin(0.5)
          .setRotation(ang)
          .setDepth(c.x + c.y + 20000);
      }
    }
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
    // Screen-relative movement: screen-up = cart(-1,-1), screen-right = cart(1,-1).
    // Arrow keys, WASD and on-screen D-pad all follow the screen, never diagonal drift.
    const t = this.touch || {};
    const su =
      (this.cursors.up.isDown || this.keys.W.isDown || t.up ? 1 : 0) -
      (this.cursors.down.isDown || this.keys.S.isDown || t.down ? 1 : 0);
    const sr =
      (this.cursors.right.isDown || this.keys.D.isDown || t.right ? 1 : 0) -
      (this.cursors.left.isDown || this.keys.A.isDown || t.left ? 1 : 0);
    const ix = sr - su;
    const iy = -su - sr;
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
    // 2-frame walk animation while moving; rest pose when idle.
    if (Math.hypot(this.velX, this.velY) > 1) {
      this.walkPhase += dt * 10;
      this.player.setTexture(`walk-${this.walkSet}-${Math.floor(this.walkPhase) % 2}`);
    } else {
      this.player.setTexture(`walk-${this.walkSet}-0`);
    }
    this.syncPlayer();
  }

  syncPlayer() {
    const p = toScreen(this.cartX, this.cartY);
    this.player.setPosition(p.x, p.y);
    this.player.setDepth(p.x + p.y + 20000);
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

window.__game = new Phaser.Game(config);
window.addEventListener('error', (e) => { window.__err = String((e && e.message) || e); });
