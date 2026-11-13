import * as Phaser from 'phaser';
import { cartToIso } from './iso.js';
import { PAL, STYLES, styleFor, mulberry32, hashStr, drawBuilding, drawTree } from './look.js';
import { drawProp, drawPropShadow } from './props.js';
import { spawnCats, spawnCars, spawnPeople, spawnGulls, updateNPCs } from './npcs.js';
import { areaFromURL, gotoArea, fetchArea } from './area.js';
import { SETTINGS, loadSettings, saveSettings, resetSettings } from './settings.js';

const PX_M = 8; // vertical pixels per meter of height
const OX = 400;
const OY = 140;
const DEFAULT_CENTER = { lat: 40.9968, lon: 28.8525, name: 'Barbaros 1. Sokak' };
const FALLBACK = {
  meta: { name: 'Barbaros 1. Sokak fallback', center: { lat: 40.9968, lon: 28.8525 } },
  buildings: [
    { id: 'b1', pts: [[0, 0], [10, 0], [10, 8], [0, 8]], height: 9 },
    { id: 'b2', pts: [[16, 4], [24, 4], [24, 12], [16, 12]], height: 6 },
  ],
  roads: [[[0, 14], [30, 14]]],
  greens: [],
  waters: [],
  pois: [],
};


let playerTint = 0x4dc26b;

const walkerBtns = document.querySelectorAll('.walker-btn');
walkerBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    walkerBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
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

function pointInPoly(cx, cy, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function chaikin(pts, iters = 2) {
  let cur = pts;
  for (let k = 0; k < iters; k++) {
    if (cur.length < 3) return cur;
    const out = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const [ax, ay] = cur[i];
      const [bx, by] = cur[i + 1];
      out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      out.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

function distPtSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  const t = ab2 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0;
  const cx = ax + abx * t, cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
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
      const c = window.__areaCenter || DEFAULT_CENTER;
      areaMap = window.L.map('area-map').setView([c.lat, c.lon], 15);

      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(areaMap);
      areaMarker = window.L.marker([c.lat, c.lon], { draggable: true }).addTo(areaMap);
      areaMap.on('click', (e) => areaMarker.setLatLng(e.latlng));
    } else {
      const c = window.__areaCenter || DEFAULT_CENTER;
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
    gotoArea(DEFAULT_CENTER.lat, DEFAULT_CENTER.lon);
  });

  const searchInput = document.getElementById('area-search-input');
  const searchBtn = document.getElementById('area-search-btn');
  const searchStatus = document.getElementById('area-search-status');
  const doSearch = () => {
    const q = (searchInput?.value || '').trim();
    if (!q) return;
    if (searchStatus) searchStatus.textContent = 'Searching OpenStreetMap…';
    fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q.includes('Istanbul') || q.includes('İstanbul') ? q : q + ', Istanbul'))
      .then((r) => r.json())
      .then((res) => {
        if (!res?.[0] || !areaMap || !areaMarker) {
          if (searchStatus) searchStatus.textContent = 'Address not found. Try street name or neighborhood.';
          return;
        }
        areaMap.setView([parseFloat(res[0].lat), parseFloat(res[0].lon)], 16);
        areaMarker.setLatLng([parseFloat(res[0].lat), parseFloat(res[0].lon)]);
        if (searchStatus) searchStatus.textContent = 'Found: ' + res[0].display_name.slice(0, 50) + '…';
      })
      .catch(() => {
        if (searchStatus) searchStatus.textContent = 'Address not found. Try street name or neighborhood.';
      });
  };
  if (searchBtn) searchBtn.addEventListener('click', doSearch);
  if (searchInput) searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
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
    this.cfg = loadSettings();
    this.speed = this.cfg.speed; // meters per second
    this.labelObjects = [];
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

    this.applyTimeOfDay();
    this.scale.on('resize', () => this.applyTimeOfDay());

    const todBtns = document.querySelectorAll('.tod-btn');
    const updateTodActive = () => {
      todBtns.forEach((b) => b.classList.toggle('active', b.dataset.tod === this.cfg.timeOfDay));
    };
    updateTodActive();
    todBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.cfg.timeOfDay = btn.dataset.tod;
        updateTodActive();
        this.applyTimeOfDay();
        saveSettings(this.cfg);
      });
    });

    wireAreaPicker();
    const a = areaFromURL() || { lat: DEFAULT_CENTER.lat, lon: DEFAULT_CENTER.lon };
    const loading = document.getElementById('area-loading');
    if (loading) loading.style.display = 'block';
    fetchArea(a.lat, a.lon, this.cfg.radius)
      .then((data) => {
        if (loading) loading.style.display = 'none';
        if (!areaFromURL() && !data.meta.name) data.meta.name = DEFAULT_CENTER.name;
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
        // Try bundled Darphane data as offline fallback, else tiny fallback.
        fetch('data/darphane.json', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : FALLBACK))
          .catch(() => FALLBACK)
          .then((data) => this.buildWorld(data));
      });

  }

  // Sky bands top -> horizon, per time of day.
  paintSky(tone = 'day') {
    const PALETTES = {
      day: [0xffe9c4, 0xffd9a8],
      golden: [0xffc98a, 0xf79b5c],
      night: [0x1e2a46, 0x2b3a5c],
    };
    const [top, bottom] = PALETTES[tone] || PALETTES.day;
    if (this.skyG) {
      this.skyG.destroy();
      this.skyG = null;
    }
    const g = this.add.graphics();
    g.setScrollFactor(0);
    g.setDepth(-1000);
    const W = this.scale.width || 800;
    const H = this.scale.height || 600;
    const N = 14;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const r = lerpInt((top >> 16) & 0xff, (bottom >> 16) & 0xff, t);
      const gg = lerpInt((top >> 8) & 0xff, (bottom >> 8) & 0xff, t);
      const b = lerpInt(top & 0xff, bottom & 0xff, t);
      g.fillStyle((r << 16) | (gg << 8) | b, 1);
      g.fillRect(0, Math.floor((i * H) / N), W, Math.ceil(H / N) + 1);
    }
    this.skyG = g;
  }

  // Rebuild sky + camera-fixed tint for the current cfg.timeOfDay.
  applyTimeOfDay() {
    const tone = (this.cfg && this.cfg.timeOfDay) || 'day';
    document.querySelectorAll('.tod-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tod === tone);
    });
    this.paintSky(tone);
    if (this.skyOverlay) {
      this.skyOverlay.destroy();
      this.skyOverlay = null;
    }
    const TINTS = {
      day: [0xffffff, 0],
      golden: [0xffd2a8, 1],
      night: [0x5566a0, 1],
    };
    const [color, alpha] = TINTS[tone] || TINTS.day;
    const W = this.scale.width || 800;
    const H = this.scale.height || 600;
    this.skyOverlay = this.add
      .rectangle(0, 0, W, H, color)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(40000)
      .setAlpha(alpha);
    if (alpha > 0 && tone !== 'day') {
      this.skyOverlay.setBlendMode(Phaser.BlendModes.MULTIPLY);
    }
    const BG = { day: '#FFD9A8', golden: '#F79B5C', night: '#1E2A46' };
    this.cameras.main.setBackgroundColor(BG[tone] || BG.day);

    const UI = {
      day: { bg: '#F5DFB8', fg: '#5A4632' },
      golden: { bg: '#F3D0A4', fg: '#5A4632' },
      night: { bg: '#101A2E', fg: '#EBD9B4' },
    };
    const ui = UI[tone] || UI.day;
    document.body.style.background = ui.bg;
    document.querySelectorAll('#select, #hud').forEach((el) => {
      el.style.color = ui.fg;
    });
  }

  buildWorld(data) {
    const g = this.add.graphics();
    const meta = data.meta || {};
    this.worldMeta = meta;
    this.worldStats = {
      buildings: (data.buildings || []).length,
      roads: (data.roads || []).length,
      greens: (data.greens || []).length,
      waters: (data.waters || []).length,
      pois: (data.pois || []).length,
    };
    const center = meta.center || { lat: 41.0615, lon: 29.0125 };


    window.__areaCenter = center || DEFAULT_CENTER;

    const kx = 111320 * Math.cos((center.lat * Math.PI) / 180);
    const toCart = ([a, b]) =>
      a > 10 && Math.abs(b) > 10
        ? [(a - center.lon) * kx, (center.lat - b) * 111320]
        : [a, b];

    let buildings = (data.buildings || []).map((b, i) => {
      const cart = b.pts.map(toCart);
      return { b, cart, bb: bboxOf(cart), i };
    });
    let roadLines = (data.roads || []).map((road) => {
      const raw = Array.isArray(road) ? road : road.pts || [];
      return raw.map(toCart);
    });
    const roadMeta = (data.roads || []).map((road) =>
      Array.isArray(road) ? { name: null, kind: null } : { name: road.name ?? null, kind: road.kind ?? null },
    );

    // Road widths in metres (used for drawing and for clearing buildings off roads).
    const ROAD_PX = 6.3;
    const ROAD_M = {
      motorway: [26, 19], trunk: [23, 16], primary: [22, 15], secondary: [16, 11],
      tertiary: [13, 9], residential: [10, 7], unclassified: [9, 6], living_street: [9, 6],
      service: [8, 5.5], busway: [9, 6], track: [7, 5], pedestrian: [4.5, 3],
      footway: [4.5, 3], path: [4, 2.5], steps: [3.5, 2.5],
    };
    const roadHalfM = roadLines.map((_, ri) => {
      const kind = roadMeta[ri]?.kind || '';
      const w = ROAD_M[kind] || ROAD_M[kind.replace(/_link$/, '')] || ROAD_M.residential;
      return w[0] / 2;
    });

    // Drop buildings sitting on roads: any footprint vertex or centroid within the
    // road corridor (half width + 0.8m margin) means overlap.
    const beforeB = buildings.length;
    buildings = buildings.filter(({ cart, b }) => {
      if (b.landmark) return true; // never drop the anchor landmark
      const cx = cart.reduce((s, p) => s + p[0], 0) / cart.length;
      const cy = cart.reduce((s, p) => s + p[1], 0) / cart.length;
      const pts = [[cx, cy], ...cart];
      for (let ri = 0; ri < roadLines.length; ri++) {
        const line = roadLines[ri];
        const thr = roadHalfM[ri] + 0.8;
        for (let i = 0; i + 1 < line.length; i++) {
          const [ax, ay] = line[i], [bx, by] = line[i + 1];
          for (const [px, py] of pts) {
            if (distPtSeg(px, py, ax, ay, bx, by) < thr) return false;
          }
        }
      }
      return true;
    });
    this.worldStats.buildings = buildings.length;


    // Smooth turns for rendering (keep raw for joints/markings measured in cart metres).
    const roadLinesRaw = roadLines;
    roadLines = roadLines.map((line) => (line.length > 2 ? chaikin(line, 3) : line));



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

    // Worn earth patches + weeds so the empty ground is not a blank sheet.
    const grand = mulberry32(31);
    for (let i = 0; i < 70; i++) {
      const px = minX + grand() * (maxX - minX);
      const py = minY + grand() * (maxY - minY);
      const p = toScreen(px, py);
      if (grand() < 0.4) {
        g.fillStyle(0xd7c19c, 0.16);
        g.fillEllipse(p.x, p.y, 22 + grand() * 40, 9 + grand() * 16);
      } else {
        g.fillStyle(0x6E9B6A, 0.45);
        g.fillRect(p.x, p.y, 2, 3);
      }
    }


    // Parks, gardens, grass and water from OSM landuse/natural.
    const GREEN_COL = {
      park: 0x7FA05A, garden: 0x86AC60, pitch: 0x8CA968, grass: 0x94B36A,
      forest: 0x5E8450, cemetery: 0x8FA383, playground: 0x9BB07A, meadow: 0x9FBA72,
      allotments: 0x8FAE64, village_green: 0x86AC60, recreation_ground: 0x8AAE62,
    };
    const greenCart = [];
    const waterCart = [];
    for (const gr of data.greens || []) {
      const cart = (gr.pts || []).map(toCart);
      if (cart.length < 3) continue;
      greenCart.push(cart);
      const scr = cart.map(([x, y]) => toScreen(x, y));
      g.fillStyle(GREEN_COL[gr.kind] ?? 0x7FA05A, 1);
      g.fillPoints(scr.map((p) => new Phaser.Geom.Point(p.x, p.y)), true);
      g.lineStyle(2, 0x4E6B3C, 0.8);
      g.strokePoints(scr.map((p) => new Phaser.Geom.Point(p.x, p.y)), true);
      // Scatter trees and bushes inside the green.
      const prand = mulberry32(hashStr(`green-${gr.kind}-${cart.length}`));
      let xs = cart.map((p) => p[0]), ys = cart.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      const tries = Math.min(40, Math.round(((x1 - x0) * (y1 - y0)) / 400));
      for (let i = 0; i < tries; i++) {
        const tx = x0 + prand() * (x1 - x0);
        const ty = y0 + prand() * (y1 - y0);
        if (!pointInPoly(tx, ty, cart)) continue;
        const p = toScreen(tx, ty);
        if (prand() < 0.6) drawTree(g, p.x, p.y, (prand() * 1e9) | 0, 0.75);
        else {
          g.fillStyle(0x4E7A52, 1);
          g.fillEllipse(p.x, p.y - 3, 9, 6);
          g.fillStyle(0x6E9B6A, 1);
          g.fillEllipse(p.x - 1, p.y - 5, 5, 3);
        }
      }
    }
    for (const wt of data.waters || []) {
      const cart = (wt.pts || []).map(toCart);
      if (cart.length < 2) continue;
      waterCart.push(cart);
      const scr = cart.map(([x, y]) => toScreen(x, y));
      g.fillStyle(0x4E7FA8, 1);
      g.fillPoints(scr.map((p) => new Phaser.Geom.Point(p.x, p.y)), true);
      g.lineStyle(2, 0xA8CBDF, 0.9);
      g.strokePoints(scr.map((p) => new Phaser.Geom.Point(p.x, p.y)), true);
      // Ripple dashes.
      g.lineStyle(1, 0x8FB6D8, 0.8);
      for (const [cx, cy] of cart) {
        const p = toScreen(cx, cy);
        g.lineBetween(p.x - 5, p.y, p.x + 1, p.y);
        g.lineBetween(p.x + 3, p.y + 3, p.x + 9, p.y + 3);
      }
    }

    // Streets: differentiated by road kind.
    // ROAD_PX/ROAD_M defined above (also used for building-road clearance).
    const drivable = new Set(['primary', 'trunk', 'motorway', 'secondary', 'tertiary', 'residential']);
    const roadStyles = roadLines.map((_, ri) => {
      const kind = roadMeta[ri]?.kind;
      const base = kind || '';
      const w = ROAD_M[base] || ROAD_M[base.replace(/_link$/, '')] || ROAD_M.residential;
      const [baseM, surfM] = w;
      if (kind === 'steps') return { baseW: baseM * ROAD_PX, surfW: surfM * ROAD_PX, surfCol: 0xbaa992, type: 'steps', halfM: baseM / 2 };
      if (kind === 'footway' || kind === 'pedestrian' || kind === 'path') return { baseW: baseM * ROAD_PX, surfW: surfM * ROAD_PX, surfCol: 0xbfae97, type: 'walkway', halfM: baseM / 2 };
      if (kind === 'primary' || kind === 'trunk' || kind === 'motorway') return { baseW: baseM * ROAD_PX, surfW: surfM * ROAD_PX, surfCol: 0x55524e, dashStep: 2.5, dashCol: 0xf0d060, dual: true, type: 'road', halfM: baseM / 2 };
      if (kind === 'secondary' || kind === 'tertiary') return { baseW: baseM * ROAD_PX, surfW: surfM * ROAD_PX, surfCol: 0x767068, dashStep: 2, dashCol: 0xf5ead0, dual: false, type: 'road', halfM: baseM / 2 };
      return { baseW: baseM * ROAD_PX, surfW: surfM * ROAD_PX, surfCol: 0x9a9184, dashStep: 2, dashCol: 0xf5ead0, dual: false, type: 'road', halfM: baseM / 2 };
    });

    const roadScr = roadLines.map((line) => line.map(([x, y]) => toScreen(x, y)));


    // 1. Sidewalk base pass
    roadLines.forEach((line, ri) => {
      g.lineStyle(roadStyles[ri].baseW, 0xd8ccb4, 1);
      const scr = roadScr[ri];
      for (let i = 0; i + 1 < line.length; i++) {
        g.lineBetween(scr[i].x, scr[i].y, scr[i + 1].x, scr[i + 1].y);
      }
    });

    // 2. Kerb strip: the metre of stone between pavement and asphalt.
    roadLines.forEach((line, ri) => {
      const s = roadStyles[ri];
      const w = Math.max(1, s.baseW - s.surfW);
      g.lineStyle(w, 0xc4ae8c, 1);
      const scr = roadScr[ri];
      for (let i = 0; i + 1 < line.length; i++) {
        g.lineBetween(scr[i].x, scr[i].y, scr[i + 1].x, scr[i + 1].y);
      }
    });

    // 3. Road surface pass
    roadLines.forEach((line, ri) => {
      const s = roadStyles[ri];
      g.lineStyle(s.surfW, s.surfCol, 1);
      const scr = roadScr[ri];
      for (let i = 0; i + 1 < line.length; i++) {
        g.lineBetween(scr[i].x, scr[i].y, scr[i + 1].x, scr[i + 1].y);
      }
    });

    // 3b. Pavement joints every ~8m so sidewalks read as slabs, not a smear.
    roadLines.forEach((line, ri) => {
      const s = roadStyles[ri];
      if (s.baseW - s.surfW < 4) return;
      const half = (s.baseW + s.surfW) / 4;
      let acc = 0;
      for (let i = 0; i + 1 < line.length; i++) {
        const segLen = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
        if (segLen < 0.5) continue;
        const dx = (line[i + 1][0] - line[i][0]) / segLen;
        const dy = (line[i + 1][1] - line[i][1]) / segLen;
        while (acc < segLen) {
          const t = acc / segLen;
          const px = line[i][0] + (line[i + 1][0] - line[i][0]) * t;
          const py = line[i][1] + (line[i + 1][1] - line[i][1]) * t;
          const a = toScreen(px - dy * half, py + dx * half);
          const b = toScreen(px + dy * half, py - dx * half);
          g.lineStyle(1, 0xbfa88a, 0.45);
          g.lineBetween(a.x, a.y, b.x, b.y);
          acc += 8;
        }
        acc -= segLen;
      }
    });


    // 3. Markings, step treads & manhole covers
    roadLines.forEach((line, ri) => {
      const s = roadStyles[ri];
      const kind = roadMeta[ri]?.kind;
      const scr = roadScr[ri];

      if (s.type === 'steps') {
        g.lineStyle(2, 0x5a4f42, 1);
        for (let i = 0; i + 1 < line.length; i++) {
          const segLen = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
          if (segLen < 0.5) continue;
          const a = scr[i];
          const b = scr[i + 1];
          const sdx = b.x - a.x;
          const sdy = b.y - a.y;
          const slen = Math.hypot(sdx, sdy);
          if (slen < 1) continue;
          const nx = -sdy / slen;
          const ny = sdx / slen;
          for (let d = 0; d < segLen; d += 1.5) {
            const t = d / segLen;
            const px = a.x + sdx * t;
            const py = a.y + sdy * t;
            g.lineBetween(px - nx * 2, py - ny * 2, px + nx * 2, py + ny * 2);
          }
        }
      } else if (s.type === 'road') {
        g.lineStyle(2, s.dashCol, 1);
        for (let i = 0; i + 1 < line.length; i++) {
          const segLen = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
          if (segLen < 0.5) continue;
          const a = scr[i];
          const b = scr[i + 1];
          const sdx = b.x - a.x;
          const sdy = b.y - a.y;
          const slen = Math.hypot(sdx, sdy);
          if (slen < 1) continue;
          const nx = -sdy / slen;
          const ny = sdx / slen;
          const dashLen = s.dual ? 1.2 : 1;
          for (let d = 0; d < segLen; d += s.dashStep) {
            const t0 = d / segLen;
            const t1 = Math.min(1, (d + dashLen) / segLen);
            const p0x = a.x + sdx * t0;
            const p0y = a.y + sdy * t0;
            const p1x = a.x + sdx * t1;
            const p1y = a.y + sdy * t1;
            if (s.dual) {
              g.lineBetween(p0x + nx * 1.5, p0y + ny * 1.5, p1x + nx * 1.5, p1y + ny * 1.5);
              g.lineBetween(p0x - nx * 1.5, p0y - ny * 1.5, p1x - nx * 1.5, p1y - ny * 1.5);
            } else {
              g.lineBetween(p0x, p0y, p1x, p1y);
            }
          }
        }
      }

      if (drivable.has(kind)) {
        let cartLen = 0;
        const cum = [0];
        for (let i = 0; i + 1 < line.length; i++) {
          cartLen += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
          cum.push(cartLen);
        }
        for (let s = 27.5; s < cartLen; s += 55) {
          let seg = 0;
          while (seg + 1 < cum.length - 1 && cum[seg + 1] < s) seg++;
          const sLen = cum[seg + 1] - cum[seg] || 1;
          const t = (s - cum[seg]) / sLen;
          const a = scr[seg];
          const b = scr[seg + 1];
          const px = a.x + (b.x - a.x) * t;
          const py = a.y + (b.y - a.y) * t;
          g.fillStyle(0x3d3a36, 1);
          g.fillCircle(px, py, 1.8);
          g.fillStyle(0x6e6862, 1);
          g.fillCircle(px, py, 0.8);
        }
      }
    });

    // Street furniture + labels (read road.name / road.kind where road is object).
    {
      const lampKinds = new Set(['primary', 'trunk', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified']);
      const crossKinds = new Set(['primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified']);
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
            const off = (roadStyles[ri].halfM ?? 5) + 0.6;
            const lx = ax + (bx - ax) * t + -dy * off * side;
            const ly = ay + (by - ay) * t + dx * off * side;
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
        if (meta.name && screenLen > 50) {
          labelCands.push({ name: meta.name, scr });
        }
      });
      this._labelCands = labelCands;
    }

    // Buildings far-first: sort by (minX + minY), seeded facade via look.js.
    const nameCands = [];
    buildings.sort((p, q) => p.bb.minX + p.bb.minY - (q.bb.minX + q.bb.minY));
    for (const { b, cart, bb } of buildings) {
      const base = cart.map(([x, y]) => toScreen(x, y));
      // Warm courtyard parcel under each building.
      g.fillStyle(0xefe3cb, 1);
      g.fillPoints(base.map((p) => new Phaser.Geom.Point(p.x, p.y + 2)), true);
      const seed = hashStr(String(b.id ?? `${bb.minX},${bb.minY}`));
      const style = b.style ?? styleFor(b);
      const pal = STYLES[style] || STYLES.apartment;
      const facade = b.color ?? pal.facades[seed % pal.facades.length];
      const floors = Math.max(1, Math.round(b.height / 3));
      drawBuilding(g, base, { heightPx: b.height * PX_M, seed, floors, facade, style });
      this.bboxes.push(bb);
      if (b.name && b.name !== b.landmark) {
        nameCands.push({
          name: b.name,
          x: base.reduce((s, p) => s + p.x, 0) / base.length,
          y: base.reduce((s, p) => s + p.y, 0) / base.length,
        });
      }
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
        const off = (roadStyles[ri].halfM ?? 5) + 1.2;
        const px = ax + (bx - ax) * t + -dy * off * side;
        const py = ay + (by - ay) * t + dx * off * side;
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

    // Points of interest: small street props from OSM.
    const poiNames = [];
    for (const poi of data.pois || []) {
      if (!poi || !Number.isFinite(poi.x) || !Number.isFinite(poi.y)) continue;
      const [cx, cy] = toCart([poi.x, poi.y]);
      // Skip props that would sit inside a building footprint.
      if (this.bboxes.some((b) => cx >= b.minX && cx <= b.maxX && cy >= b.minY && cy <= b.maxY)) continue;
      const sp = toScreen(cx, cy);
      const seed = hashStr(`${poi.kind}:${Math.round(poi.x * 1e5)},${Math.round(poi.y * 1e5)}`);
      drawPropShadow(g, sp.x, sp.y);
      drawProp(g, sp.x, sp.y, poi.kind || 'other', seed);
      if (poi.name && /cafe|restaurant|bar|pub|shop|market|pharmacy|hospital|school|mosque|hotel|bank|museum|library|post|police|townhall|fountain|park|viewpoint/.test(poi.kind)) {
        poiNames.push({ name: poi.name, x: sp.x, y: sp.y });
      }
    }

    // Screen-space road loops for cars (NPC module reads scene.roads).

    this.roads = roadLines.map((line) => line.map(([x, y]) => toScreen(x, y)));
    this.buildMinimap(buildings.map((b) => b.cart), roadLines, greenCart, waterCart);

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
    this.cameras.main.setZoom(this.cfg.zoom);
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
    if (this.cfg.labels) {
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
        const label = this.add
          .text(c.x, c.y - 10, c.name, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#4a3f30',
            backgroundColor: '#f5ead0',
            padding: { x: 4, y: 2 },
          })
          .setOrigin(0.5)
          .setRotation(ang)
          .setDepth(c.x + c.y + 15000)
          .setVisible(!!this.cfg.labels);
        this.labelObjects.push(label);
      }
      // POI and building names: horizontal, only when close.
      const extras = [
        ...(typeof poiNames !== 'undefined' ? poiNames : []),
        ...(typeof nameCands !== 'undefined' ? nameCands : []),
      ];
      for (const c of extras) {
        if (shown.length >= 42) break;
        const d = Math.hypot(px - c.x, py - c.y);
        if (d > 900) continue;
        if (shown.some((s) => Math.hypot(s.x - c.x, s.y - c.y) < 70)) continue;
        shown.push(c);
        const label = this.add
          .text(c.x, c.y - 14, c.name, {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#3a2f22',
            backgroundColor: '#FFF4D8',
            padding: { x: 3, y: 1 },
          })
          .setOrigin(0.5)
          .setDepth(c.x + c.y + 15010)
          .setVisible(!!this.cfg.labels);
        this.labelObjects.push(label);
      }
    }
    spawnCats(this, Math.round(8 * this.cfg.life));
    spawnCars(this, Math.round(5 * this.cfg.life));
    spawnPeople(this, Math.round(6 * this.cfg.life));
    spawnGulls(this, Math.round(5 * this.cfg.life));
    this.buildSettingsUI();
    this.wireHud();
  }

  // Mini map: static city plan drawn once, player dot refreshed each frame.
  buildMinimap(bldCart, roadLines, greenCart, waterCart) {
    const host = document.getElementById('minimap');
    if (!host) return;
    const size = 160;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const layer = document.createElement('canvas');
    layer.width = size * dpr;
    layer.height = size * dpr;
    const lctx = layer.getContext('2d');
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.fillStyle = '#EFE3CB';
    lctx.fillRect(0, 0, size, size);

    const pts = [];
    for (const c of bldCart) for (const p of c) pts.push(p);
    for (const line of roadLines) for (const p of line) pts.push(p);
    if (!pts.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const pad = 20;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    // Iso, same as the world: x -> (+1,+0.5), y -> (-1,+0.5).
    const sx = size / (maxX - minX + maxY - minY);
    const px = (x, y) => ((x - minX - (y - minY)) * sx + size / 2);
    const py = (x, y) => ((x - minX + (y - minY)) * sx * 0.5 + size / 2);

    const poly = (ctx, c) => {
      ctx.beginPath();
      c.forEach(([x, y], i) => (i ? ctx.lineTo(px(x, y), py(x, y)) : ctx.moveTo(px(x, y), py(x, y))));
      ctx.closePath();
      ctx.fill();
    };
    lctx.fillStyle = '#7FA05A';
    for (const c of greenCart) poly(lctx, c);
    lctx.fillStyle = '#4E7FA8';
    for (const c of waterCart) poly(lctx, c);
    lctx.fillStyle = '#CBBBA0';
    for (const c of bldCart) poly(lctx, c);
    lctx.strokeStyle = '#8A8378';
    lctx.lineWidth = 1.6;
    for (const line of roadLines) {
      lctx.beginPath();
      line.forEach(([x, y], i) => (i ? lctx.lineTo(px(x, y), py(x, y)) : lctx.moveTo(px(x, y), py(x, y))));
      lctx.stroke();
    }
    // The dropped pin.
    lctx.strokeStyle = '#B5432F';
    lctx.lineWidth = 1.4;
    lctx.beginPath();
    lctx.arc(px(0, 0), py(0, 0), 4, 0, Math.PI * 2);
    lctx.stroke();

    let cv = host.querySelector('canvas');
    if (!cv) {
      cv = document.createElement('canvas');
      host.appendChild(cv);
    }
    cv.width = size * dpr;
    cv.height = size * dpr;
    cv.style.width = size + 'px';
    cv.style.height = size + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.mini = { ctx, size, layer, px, py };
    this.updateMinimap();
  }

  updateMinimap() {
    const m = this.mini;
    if (!m) return;
    const ctx = m.ctx;
    ctx.clearRect(0, 0, m.size, m.size);
    ctx.drawImage(m.layer, 0, 0, m.size, m.size);
    const x = m.px(this.cartX, this.cartY);
    const y = m.py(this.cartX, this.cartY);
    ctx.fillStyle = '#B5432F';
    ctx.beginPath();
    ctx.arc(x, y, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  wireHud() {
    const areaEl = document.getElementById('hud-area');
    const coordEl = document.getElementById('hud-coords');
    const c = window.__areaCenter || DEFAULT_CENTER;
    if (coordEl) coordEl.textContent = `${c.lat.toFixed(4)}°N, ${c.lon.toFixed(4)}°E`;
    if (areaEl) {
      const url = areaFromURL();
      const meta = this.worldMeta || {};
      const stats = this.worldStats || {};
      const base = meta.name || (url ? 'Dropped pin area' : DEFAULT_CENTER.name);
      const bits = [];
      if (stats.buildings) bits.push(`${stats.buildings} bld`);
      if (stats.roads) bits.push(`${stats.roads} roads`);
      if (stats.pois) bits.push(`${stats.pois} poi`);
      areaEl.textContent = bits.length ? `${base} · ${bits.join(' · ')}` : base;
    }

    const help = document.getElementById('help-modal');
    const openHelp = () => { if (help) help.style.display = 'block'; };
    const closeHelp = () => { if (help) help.style.display = 'none'; };
    for (const id of ['btn-help', 'help-open']) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', openHelp);
    }
    const helpClose = document.getElementById('help-close');
    if (helpClose) helpClose.addEventListener('click', closeHelp);
    const fs = document.getElementById('btn-fullscreen');
    if (fs) {
      fs.addEventListener('click', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
      });
    }
    const reset = document.getElementById('btn-reset-view');
    if (reset) {
      reset.addEventListener('click', () => {
        if (!this.player) return;
        this.cameras.main.stopFollow();
        this.cameras.main.centerOn(this.player.x, this.player.y);
        this.cameras.main.startFollow(this.player, true, 0.2, 0.2);
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeHelp();
        const sm = document.getElementById('settings-modal');
        if (sm) sm.style.display = 'none';
        const am = document.getElementById('area-modal');
        if (am) am.style.display = 'none';
      }
    });
  }

  // Settings dialog: rows built from SETTINGS, live-applied where possible.
  buildSettingsUI() {
    const open = document.getElementById('settings-open');
    const modal = document.getElementById('settings-modal');
    const rowsEl = document.getElementById('settings-rows');
    if (!open || !modal || !rowsEl) return;
    this._ui = { open, modal, rowsEl };
    this.renderSettingsRows();
    if (open.dataset.wired) return;
    open.dataset.wired = '1';
    open.addEventListener('click', () => {
      this.renderSettingsRows();
      modal.style.display = 'block';
    });
    const closeBtn = document.getElementById('settings-close');
    if (closeBtn) closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    const applyBtn = document.getElementById('settings-apply');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        this.cfg = saveSettings(this.cfg);
        modal.style.display = 'none';
      });
    }
    const resetBtn = document.getElementById('settings-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.cfg = resetSettings();
        this.cfg = saveSettings(this.cfg);
        this.renderSettingsRows();
        this.applyLiveSetting('speed');
        this.applyLiveSetting('zoom');
        this.applyTimeOfDay();
        this.applyLiveSetting('labels');
      });
    }
    const reloadBtn = document.getElementById('settings-reload');
    if (reloadBtn) reloadBtn.addEventListener('click', () => { window.location.reload(); });
  }

  renderSettingsRows() {
    const rowsEl = this._ui && this._ui.rowsEl;
    if (!rowsEl || !this.cfg) return;
    rowsEl.textContent = '';
    for (const spec of SETTINGS) {
      const value = this.cfg[spec.key];
      const row = document.createElement('div');
      row.className = 'set-row';
      const label = document.createElement('label');
      label.textContent = spec.label;
      const val = document.createElement('span');
      val.className = 'set-val';
      const selectedLabel = spec.type === 'select'
        ? (spec.options || []).find(([id]) => id === value)
        : null;
      val.textContent = spec.type === 'select'
        ? (selectedLabel ? selectedLabel[1] : String(value))
        : `${value}${spec.unit || ''}`;
      row.appendChild(label);
      row.appendChild(val);

      let control;
      if (spec.type === 'range') {
        control = document.createElement('input');
        control.type = 'range';
        control.min = String(spec.min);
        control.max = String(spec.max);
        control.step = String(spec.step);
        control.value = String(value);
        control.addEventListener('input', () => {
          const v = Number.parseFloat(control.value);
          this.cfg[spec.key] = v;
          val.textContent = `${v}${spec.unit || ''}`;
          this.applyLiveSetting(spec.key);
          if (spec.reload) this.revealReload();
        });
      } else if (spec.type === 'select') {
        control = document.createElement('select');
        for (const [id, text] of spec.options || []) {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = text;
          control.appendChild(opt);
        }
        control.value = String(value);
        control.addEventListener('change', () => {
          this.cfg[spec.key] = control.value;
          const hit = (spec.options || []).find(([id]) => id === control.value);
          val.textContent = hit ? hit[1] : control.value;
          this.applyLiveSetting(spec.key);
          if (spec.reload) this.revealReload();
        });
      } else {
        control = document.createElement('input');
        control.type = 'checkbox';
        control.checked = !!value;
        val.textContent = value ? 'on' : 'off';
        control.addEventListener('change', () => {
          this.cfg[spec.key] = control.checked;
          val.textContent = control.checked ? 'on' : 'off';
          this.applyLiveSetting(spec.key);
          if (spec.reload) this.revealReload();
        });
      }
      control.id = `set-${spec.key}`;
      row.appendChild(control);
      rowsEl.appendChild(row);
    }
  }

  applyLiveSetting(key) {
    if (!this.cfg) return;
    if (key === 'speed') {
      this.speed = this.cfg.speed;
    } else if (key === 'zoom') {
      this.cameras.main.setZoom(this.cfg.zoom);
    } else if (key === 'timeOfDay') {
      this.applyTimeOfDay();
    } else if (key === 'labels') {
      for (const t of this.labelObjects || []) t.setVisible(!!this.cfg.labels);
    }
  }

  revealReload() {
    const note = document.getElementById('settings-reload-note');
    const btn = document.getElementById('settings-reload');
    if (note) note.style.display = 'block';
    if (btn) btn.style.display = 'inline-block';
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
    this._miniT = (this._miniT || 0) + dt;
    if (this._miniT > 0.15) {
      this._miniT = 0;
      this.updateMinimap();
    }
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
  backgroundColor: '#FFD9A8',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    parent: 'game',
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [MainScene],
};

window.__game = new Phaser.Game(config);
window.addEventListener('error', (e) => { window.__err = String((e && e.message) || e); });
