export function areaFromURL() {
  if (typeof location === "undefined") return null;
  let p;
  try {
    p = new URLSearchParams(location.search);
  } catch {
    return null;
  }
  const lat = parseFloat(p.get("lat"));
  const lon = parseFloat(p.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
}

export function gotoArea(lat, lon) {
  if (typeof location === "undefined") return;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return;
  location.search = `?lat=${la.toFixed(4)}&lon=${lo.toFixed(4)}`;
}

function parseNum(v) {
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function footprintAreaM2(pts) {
  if (pts.length < 3) return 0;
  let meanLat = 0;
  for (const p of pts) meanLat += p[1];
  meanLat /= pts.length;
  const kx = 111320 * Math.cos((meanLat * Math.PI) / 180);
  const ky = 111320;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * kx * y2 * ky - x2 * kx * y1 * ky;
  }
  return Math.abs(a / 2);
}

// --- OSM tag -> kind maps (v2 data contract) -----------------------------
// Shared with scripts/fetch-darphane.mjs so both producers agree.
const AMENITY_POI = {
  bench: "bench",
  cafe: "cafe",
  restaurant: "restaurant",
  bar: "bar",
  pub: "pub",
  pharmacy: "pharmacy",
  hospital: "hospital",
  school: "school",
  bus_stop: "bus_stop",
  bus_station: "bus_stop",
  waste_basket: "waste_basket",
  waste_disposal: "waste_basket",
  toilets: "toilet",
  atm: "atm",
  fuel: "fuel",
  bank: "bank",
  hotel: "hotel",
  artwork: "artwork",
  drinking_water: "drinking_water",
  fountain: "fountain",
  parking: "parking",
  bicycle_parking: "bicycle_parking",
  police: "police",
  post_office: "post",
  townhall: "townhall",
  library: "library",
  museum: "museum",
  playground: "playground",
  clock: "clock",
};
const TOURISM_POI = { artwork: "artwork", museum: "museum", viewpoint: "viewpoint", gallery: "artwork", hotel: "hotel" };
const HISTORIC_POI = { memorial: "memorial", monument: "memorial" };
const LANDUSE_GREEN = {
  grass: "grass",
  forest: "forest",
  meadow: "meadow",
  allotments: "allotments",
  village_green: "village_green",
  recreation_ground: "recreation_ground",
  cemetery: "cemetery",
};
const LEISURE_GREEN = { park: "park", garden: "garden", pitch: "pitch", playground: "playground", cemetery: "cemetery" };
const LANDUSE_WATER = { reservoir: "reservoir", basin: "basin" };
const MARKET_SHOPS = new Set(["supermarket", "convenience", "greengrocer", "bakery"]);

export function greenKind(tags) {
  if (tags.landuse != null && LANDUSE_GREEN[tags.landuse]) return LANDUSE_GREEN[tags.landuse];
  if (tags.leisure != null && LEISURE_GREEN[tags.leisure]) return LEISURE_GREEN[tags.leisure];
  return null;
}

export function waterKind(tags) {
  if (tags.natural === "water") return "water";
  if (tags.landuse != null && LANDUSE_WATER[tags.landuse]) return LANDUSE_WATER[tags.landuse];
  if (tags.waterway === "river" || tags.waterway === "riverbank") return "river";
  if (tags.waterway === "canal") return "canal";
  return null;
}

export function poiKind(tags) {
  if (tags.amenity != null) {
    if (tags.amenity === "place_of_worship") {
      return tags.religion === "muslim" || tags.religion === "islam" ? "mosque" : "other";
    }
    return AMENITY_POI[tags.amenity] ?? "other";
  }
  if (tags.tourism != null) return TOURISM_POI[tags.tourism] ?? "other";
  if (tags.historic != null) return HISTORIC_POI[tags.historic] ?? "other";
  if (tags.natural != null) return tags.natural === "tree" ? "tree" : null;
  if (tags.waterway != null) {
    return tags.waterway === "drinking_water" ? "drinking_water" : tags.waterway === "fountain" ? "fountain" : null;
  }
  if (tags.shop != null) return MARKET_SHOPS.has(tags.shop) ? "market" : "shop";
  if (tags.man_made === "water_tower" || tags.man_made === "lighthouse") return "other";
  if (tags.railway === "station") return "other";
  if (tags.highway === "bus_stop") return "bus_stop";
  if (tags.highway === "street_lamp") return "street_lamp";
  return null;
}

function readTags(el) {
  const tags = {};
  const tagEls = el.getElementsByTagName("tag");
  for (let j = 0; j < tagEls.length; j++) {
    const k = tagEls[j].getAttribute("k");
    if (k != null) tags[k] = tagEls[j].getAttribute("v");
  }
  return tags;
}

function poiEntry(x, y, tags) {
  const kind = poiKind(tags);
  if (!kind) return null;
  const name = tags.name ?? tags["name:tr"] ?? null;
  return name ? { x, y, kind, name } : { x, y, kind };
}

function parseOsmXml(text) {
  if (typeof DOMParser === "undefined") throw new Error("XML unavailable");
  const doc = new DOMParser().parseFromString(text, "text/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("XML parse failed");
  const nodeMap = new Map();
  const pois = [];
  const nodeEls = doc.getElementsByTagName("node");
  for (let i = 0; i < nodeEls.length; i++) {
    const el = nodeEls[i];
    const id = el.getAttribute("id");
    const lat = parseFloat(el.getAttribute("lat"));
    const lon = parseFloat(el.getAttribute("lon"));
    if (id == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    nodeMap.set(String(id), [lon, lat]);
    const p = poiEntry(lon, lat, readTags(el));
    if (p) pois.push(p);
  }
  const bRaw = [];
  const roads = [];
  const greens = [];
  const waters = [];
  const wayMap = new Map();
  const wayEls = doc.getElementsByTagName("way");
  for (let i = 0; i < wayEls.length; i++) {
    const way = wayEls[i];
    const id = way.getAttribute("id");
    if (id == null) continue;
    const pts = [];
    const refs = [];
    const ndEls = way.getElementsByTagName("nd");
    for (let j = 0; j < ndEls.length; j++) {
      const nd = ndEls[j];
      const ref = nd.getAttribute("ref");
      if (ref != null) refs.push(String(ref));
      const nLat = parseFloat(nd.getAttribute("lat"));
      const nLon = parseFloat(nd.getAttribute("lon"));
      if (Number.isFinite(nLat) && Number.isFinite(nLon)) {
        pts.push([nLon, nLat]);
      } else if (ref != null) {
        const hit = nodeMap.get(String(ref));
        if (hit) pts.push(hit);
      }
    }
    const tags = readTags(way);
    if (pts.length >= 2) wayMap.set(String(id), pts);
    const closed = refs.length > 2 && refs[0] === refs[refs.length - 1];
    if (tags.building != null) {
      if (pts.length >= 3) bRaw.push({ id: "w" + id, pts, tags, area: footprintAreaM2(pts) });
    } else if (tags.highway != null) {
      const hw = tags.highway.split(";")[0].trim();
      if (/^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|track|busway|footway|path|steps|cycleway|bridleway)(_link)?$/.test(hw)) {
        if (pts.length >= 2) {
          const name = tags.name ?? tags["name:tr"] ?? tags.alt_name ?? tags["name:en"] ?? null;
          roads.push({ id: "w" + id, pts, name, kind: hw, refs });
        }
      }
    }
    // Green space / water: closed ways only (area polygons).
    if (!tags.building && closed && pts.length >= 3) {
      const g = greenKind(tags);
      if (g) greens.push({ pts, kind: g });
      else {
        const w = waterKind(tags);
        if (w) waters.push({ pts, kind: w });
      }
    }
  }
  // associatedStreet / street relations carry the name for split member ways.
  const relEls = doc.getElementsByTagName("relation");
  const relNames = new Map();
  for (let i = 0; i < relEls.length; i++) {
    const rel = relEls[i];
    const tags = readTags(rel);
    const type = tags.type;
    const name = tags.name ?? tags["name:tr"] ?? tags.alt_name ?? null;
    if ((type === "associatedStreet" || type === "street") && name) {
      const memEls = rel.getElementsByTagName("member");
      for (let j = 0; j < memEls.length; j++) {
        if (memEls[j].getAttribute("type") === "way") {
          const ref = memEls[j].getAttribute("ref");
          if (ref != null && !relNames.has(String(ref))) relNames.set(String(ref), name);
        }
      }
    }
    // Multipart green/water/building relations: collect member way geometry.
    const gk = greenKind(tags);
    const wk = waterKind(tags);
    const isBuilding = tags.building != null;
    if (!gk && !wk && !isBuilding) continue;
    const memEls = rel.getElementsByTagName("member");
    if (isBuilding) {
      // Multipolygon/outline building: collect outer way member rings.
      const rings = [];
      const segs = [];
      const relNodeMap = new Map();
      const relNdEls = rel.getElementsByTagName("nd");
      for (let j = 0; j < relNdEls.length; j++) {
        const id = relNdEls[j].getAttribute("ref");
        const nLat = parseFloat(relNdEls[j].getAttribute("lat"));
        const nLon = parseFloat(relNdEls[j].getAttribute("lon"));
        if (id != null && Number.isFinite(nLat) && Number.isFinite(nLon)) relNodeMap.set(String(id), [nLon, nLat]);
      }
      const ptKey = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
      for (let j = 0; j < memEls.length; j++) {
        const mem = memEls[j];
        if (mem.getAttribute("type") !== "way") continue;
        const role = mem.getAttribute("role") || "";
        if (role && role !== "outer" && role !== "outline") continue;
        let mpts = null;
        let refs = null;
        const ndEls = mem.getElementsByTagName("nd");
        if (ndEls.length) {
          mpts = [];
          refs = [];
          for (let k = 0; k < ndEls.length; k++) {
            const nd = ndEls[k];
            const ref = nd.getAttribute("ref");
            if (ref != null) refs.push(String(ref));
            const nLat = parseFloat(nd.getAttribute("lat"));
            const nLon = parseFloat(nd.getAttribute("lon"));
            if (Number.isFinite(nLat) && Number.isFinite(nLon)) mpts.push([nLon, nLat]);
            else if (ref != null) {
              const hit = nodeMap.get(String(ref)) ?? relNodeMap.get(String(ref));
              if (hit) mpts.push(hit);
            }
          }
        } else {
          const ref = String(mem.getAttribute("ref"));
          const wpts = wayMap.get(ref);
          if (wpts) {
            mpts = wpts.slice();
            refs = [];
          }
        }
        if (!mpts || mpts.length < 3) continue;
        const closed = (refs && refs.length > 1 && refs[0] === refs[refs.length - 1]) || ptKey(mpts[0]) === ptKey(mpts[mpts.length - 1]);
        if (closed) rings.push(mpts);
        else segs.push(mpts);
      }
      if (segs.length) {
        const chains = segs.map((s) => s.slice());
        let changed = true;
        while (changed && chains.length > 1) {
          changed = false;
          outer: for (let a = 0; a < chains.length; a++) {
            for (let b = a + 1; b < chains.length; b++) {
              const A = chains[a];
              const B = chains[b];
              const a0 = ptKey(A[0]);
              const a1 = ptKey(A[A.length - 1]);
              const b0 = ptKey(B[0]);
              const b1 = ptKey(B[B.length - 1]);
              let merged = null;
              if (a1 === b0) merged = A.concat(B.slice(1));
              else if (a1 === b1) merged = A.concat(B.slice(0, -1).reverse());
              else if (a0 === b1) merged = B.concat(A.slice(1));
              else if (a0 === b0) merged = B.slice().reverse().concat(A.slice(1));
              if (merged) {
                chains[a] = merged;
                chains.splice(b, 1);
                changed = true;
                break outer;
              }
            }
          }
        }
        for (const c of chains) {
          if (c.length >= 3) {
            if (ptKey(c[0]) === ptKey(c[c.length - 1]) || c.length >= 4) rings.push(c);
          }
        }
      }
      if (rings.length) {
        rings.sort((a, b) => footprintAreaM2(b) - footprintAreaM2(a));
        const outer = rings[0];
        bRaw.push({ id: "r" + rel.getAttribute("id"), pts: outer, tags, area: footprintAreaM2(outer) });
      }
      continue;
    }
    const pts = [];
    for (let j = 0; j < memEls.length; j++) {
      const mem = memEls[j];
      if (mem.getAttribute("type") !== "way") continue;
      const ndEls = mem.getElementsByTagName("nd");
      if (ndEls.length) {
        for (let k = 0; k < ndEls.length; k++) {
          const nLat = parseFloat(ndEls[k].getAttribute("lat"));
          const nLon = parseFloat(ndEls[k].getAttribute("lon"));
          if (Number.isFinite(nLat) && Number.isFinite(nLon)) pts.push([nLon, nLat]);
        }
      } else {
        const wpts = wayMap.get(String(mem.getAttribute("ref")));
        if (wpts) for (const p of wpts) pts.push(p);
      }
    }
    if (pts.length >= 3) (gk ? greens : waters).push({ pts, kind: gk ?? wk });
  }
  for (const r of roads) {
    if (!r.name && relNames.has(r.id.slice(1))) r.name = relNames.get(r.id.slice(1));
  }
  const nodeNames = new Map();
  for (const r of roads) {
    if (!r.name) continue;
    for (const n of r.refs) {
      if (!nodeNames.has(n)) nodeNames.set(n, new Map());
      const m = nodeNames.get(n);
      m.set(r.name, (m.get(r.name) ?? 0) + 1);
    }
  }
  for (const r of roads) {
    if (r.name || /^(footway|steps|path|cycleway)$/.test(r.kind)) continue;
    const votes = new Map();
    for (const n of r.refs) {
      const m = nodeNames.get(n);
      if (m) for (const [nm, c] of m) votes.set(nm, (votes.get(nm) ?? 0) + c);
    }
    const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length && sorted[0][1] >= 2 && (sorted.length < 2 || sorted[0][1] >= 2 * sorted[1][1])) {
      r.name = sorted[0][0];
      r.inferred = true;
    }
  }
  for (const r of roads) delete r.refs;
  bRaw.sort((a, b) => b.area - a.area);
  const buildings = bRaw.slice(0, 3000).map((b) => {
    let levels = parseNum(b.tags["building:levels"]);
    let height = parseNum(b.tags.height ?? b.tags["building:height"]);
    if (height == null) height = levels != null ? levels * 3 : 9;
    if (levels == null) levels = Math.max(1, Math.round(height / 3));
    return {
      id: b.id,
      pts: b.pts,
      levels,
      height,
      color: null,
      type: b.tags.building,
      name: b.tags.name ?? b.tags["name:tr"] ?? null,
    };
  });
  return { buildings, roads, greens, waters, pois };
}

function centroid(pts) {
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p[0];
    sy += p[1];
  }
  return [sx / pts.length, sy / pts.length];
}

function inPoly(cx, cy, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Microsoft supplemental cells (pre-baked static files, 404-tolerant).
async function fetchMsCells(w, s, e, n, existing) {
  const ix0 = Math.floor(w * 100);
  const ix1 = Math.floor(e * 100);
  const iy0 = Math.floor(s * 100);
  const iy1 = Math.floor(n * 100);
  const grid = new Map();
  const gk = (x, y) => `${Math.round(x * 500)},${Math.round(y * 500)}`;
  for (const b of existing) {
    const [cx, cy] = centroid(b.pts);
    const k = gk(cx, cy);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(b);
  }
  const covered = (cx, cy) => {
    const gx = Math.round(cx * 500);
    const gy = Math.round(cy * 500);
    for (let ax = -1; ax <= 1; ax++)
      for (let ay = -1; ay <= 1; ay++) {
        const cell = grid.get(`${gx + ax},${gy + ay}`);
        if (!cell) continue;
        for (const b of cell) if (inPoly(cx, cy, b.pts)) return true;
      }
    return false;
  };
  const out = [];
  for (let ix = ix0; ix <= ix1; ix++)
    for (let iy = iy0; iy <= iy1; iy++) {
      let data;
      try {
        const res = await fetch(`data/ms/ms-${ix}_${iy}.json`, { cache: "no-store" });
        if (!res.ok) continue;
        data = await res.json();
      } catch {
        continue;
      }
      for (const b of data.buildings ?? []) {
        if (!b.pts || b.pts.length < 3) continue;
        const [cx, cy] = centroid(b.pts);
        if (cx < w || cx > e || cy < s || cy > n) continue;
        if (covered(cx, cy)) continue;
        const nb = { id: `ms-${ix}-${iy}-${out.length}`, pts: b.pts, levels: 3, height: 9, color: null, source: "ms" };
        out.push(nb);
        const k = gk(cx, cy);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(nb);
        if (out.length >= 2000) return out;
      }
    }
  return out;
}

export async function fetchArea(lat, lon, r = 500) {
  const la = Number(lat);
  const lo = Number(lon);
  const base = Number(r) || 500;

  if (typeof fetch === "undefined") throw new Error("Could not load map data (network busy). Try again.");

  const overpassUrls = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  ];

  async function fetchOverpass(url, ql, timeoutMs = 30000) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, { method: "POST", body: ql, ...(ctrl ? { signal: ctrl.signal } : {}) });
      if (!res.ok) throw new Error("overpass failed: " + res.status);
      return parseOsmXml(await res.text());
    } finally {
      if (t) clearTimeout(t);
    }
  }

  async function fetchOsmMap(box) {
    const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${box}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("osm api failed: " + res.status);
    return parseOsmXml(await res.text());
  }

  async function tryFetch(rad) {
    // Fetch with 150m margin so edge buildings keep full geometry; clip to rad after.
    const frad = rad + 150;
    const dLat = frad / 111320;
    const dLon = frad / (111320 * Math.cos((la * Math.PI) / 180));
    const w = lo - dLon;
    const s = la - dLat;
    const e = lo + dLon;
    const n = la + dLat;
    const box = `${s},${w},${n},${e}`;
    const ql = `[out:xml][timeout:30];(way["building"](${box});relation["building"]["type"="multipolygon"](${box});relation["building"](${box});way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|track|busway|footway|path|steps|cycleway|bridleway)(_link)?$"](${box});way["landuse"~"^(grass|forest|meadow|allotments|village_green|recreation_ground|cemetery|reservoir|basin)$"](${box});way["leisure"~"^(park|garden|pitch|playground|cemetery)$"](${box});way["natural"="water"](${box});way["waterway"~"^(riverbank|river|canal)$"](${box});relation["landuse"~"^(grass|forest|meadow|allotments|village_green|recreation_ground|cemetery|reservoir|basin)$"](${box});relation["leisure"~"^(park|garden|pitch|playground|cemetery)$"](${box});relation["natural"="water"](${box});node["amenity"](${box});node["tourism"](${box});node["historic"](${box});node["natural"="tree"](${box});node["shop"](${box});node["highway"~"^(bus_stop|street_lamp)$"](${box});node["waterway"~"^(drinking_water|fountain)$"](${box});node["man_made"~"^(water_tower|lighthouse)$"](${box});node["railway"="station"](${box}););out body;>;out skel qt;`;
    for (const url of overpassUrls) {
      try {
        return { ...(await fetchOverpass(url, ql)), bbox: { w, s, e, n }, rad };
      } catch {
        // try next mirror
      }
    }
    try {
      return { ...(await fetchOsmMap(`${w},${s},${e},${n}`)), bbox: { w, s, e, n }, rad };
    } catch {
      return null;
    }
  }

  let result = await tryFetch(base);
  if (result) {
    const roads0 = result.roads.filter((r) => r.pts.some(([x, y]) => {
      const kx = 111320 * Math.cos((la * Math.PI) / 180);
      return Math.abs((x - lo) * kx) <= base && Math.abs((y - la) * 111320) <= base;
    }));
    const b0 = result.buildings.filter((b) => {
      const kx = 111320 * Math.cos((la * Math.PI) / 180);
      let sx = 0;
      let sy = 0;
      for (const [x, y] of b.pts) { sx += x; sy += y; }
      return Math.abs((sx / b.pts.length - lo) * kx) <= base && Math.abs((sy / b.pts.length - la) * 111320) <= base;
    });
    if (b0.length === 0 && roads0.length > 0) {
      const retry = await tryFetch(base + 200);
      if (retry) result = retry;
    }
  }

  if (!result) {
    // fallback to smaller radius attempts if primary fetch path failed entirely
    const retrySmall = await tryFetch(Math.max(250, base * 0.6));
    if (!retrySmall) throw new Error("Could not load map data (network busy). Try again.");
    result = retrySmall;
  }

  const { buildings, roads, greens, waters, pois, bbox, rad } = result;
  const kx = 111320 * Math.cos((la * Math.PI) / 180);
  const inR = (lonv, latv) => Math.abs((lonv - lo) * kx) <= rad && Math.abs((latv - la) * 111320) <= rad;
  const keptB = buildings.filter((b) => {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of b.pts) {
      sx += x;
      sy += y;
    }
    return inR(sx / b.pts.length, sy / b.pts.length);
  });
  const keptR = roads.filter((r) => r.pts.some(([x, y]) => inR(x, y)));
  const keptG = greens.filter((g) => g.pts.some(([x, y]) => inR(x, y)));
  const keptW = waters.filter((w) => w.pts.some(([x, y]) => inR(x, y)));
  const keptP = pois.filter((p) => inR(p.x, p.y));
  let ms = [];
  try {
    ms = await fetchMsCells(bbox.w, bbox.s, bbox.e, bbox.n, keptB);
  } catch {
    ms = [];
  }
  return {
    meta: { center: { lat: la, lon: lo }, source: "OpenStreetMap ODbL" },
    buildings: [...keptB, ...ms],
    roads: keptR,
    greens: keptG,
    waters: keptW,
    pois: keptP,
  };
}
