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
    // Multipart green/water relations: concatenate member way geometry.
    // ponytail: member order assumed as listed; fine for simple rings.
    const g = greenKind(tags);
    const w = waterKind(tags);
    if (!g && !w) continue;
    const pts = [];
    const memEls = rel.getElementsByTagName("member");
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
    if (pts.length >= 3) (g ? greens : waters).push({ pts, kind: g ?? w });
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
  const buildings = bRaw.slice(0, 500).map((b) => {
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
  const radii = [Number(r) || 500, Math.max(250, (Number(r) || 500) * 0.6)];

  if (typeof fetch === "undefined") throw new Error("Could not load map data (network busy). Try again.");

  for (const rad of radii) {
    // Fetch with 150m margin so edge buildings keep full geometry; clip to rad after.
    const frad = rad + 150;
    const dLat = frad / 111320;
    const dLon = frad / (111320 * Math.cos((la * Math.PI) / 180));
    const w = lo - dLon;
    const s = la - dLat;
    const e = lo + dLon;
    const n = la + dLat;

    const attempts = [
      async () => {
        const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${w},${s},${e},${n}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("osm api failed: " + res.status);
        return parseOsmXml(await res.text());
      },
      async () => {
        const ql = `[out:xml][timeout:30];(way["building"](${s},${w},${n},${e});way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|track|busway|footway|path|steps|cycleway|bridleway)(_link)?$"](${s},${w},${n},${e});way["landuse"~"^(grass|forest|meadow|allotments|village_green|recreation_ground|cemetery|reservoir|basin)$"](${s},${w},${n},${e});way["leisure"~"^(park|garden|pitch|playground|cemetery)$"](${s},${w},${n},${e});way["natural"="water"](${s},${w},${n},${e});way["waterway"~"^(riverbank|river|canal)$"](${s},${w},${n},${e});rel["landuse"~"^(grass|forest|meadow|allotments|village_green|recreation_ground|cemetery|reservoir|basin)$"](${s},${w},${n},${e});rel["leisure"~"^(park|garden|pitch|playground|cemetery)$"](${s},${w},${n},${e});rel["natural"="water"](${s},${w},${n},${e});node["amenity"](${s},${w},${n},${e});node["tourism"](${s},${w},${n},${e});node["historic"](${s},${w},${n},${e});node["natural"="tree"](${s},${w},${n},${e});node["shop"](${s},${w},${n},${e});node["highway"~"^(bus_stop|street_lamp)$"](${s},${w},${n},${e});node["waterway"~"^(drinking_water|fountain)$"](${s},${w},${n},${e});node["man_made"~"^(water_tower|lighthouse)$"](${s},${w},${n},${e});node["railway"="station"](${s},${w},${n},${e}););out geom;`;
        const res = await fetch("https://overpass-api.de/api/interpreter", {
          method: "POST",
          body: ql,
        });
        if (!res.ok) throw new Error("overpass failed: " + res.status);
        return parseOsmXml(await res.text());
      },
    ];

    for (const attempt of attempts) {
      try {
        const { buildings, roads, greens, waters, pois } = await attempt();
        const kx = 111320 * Math.cos((la * Math.PI) / 180);
        const inR = (lon, lat) => Math.abs((lon - lo) * kx) <= rad && Math.abs((lat - la) * 111320) <= rad;
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
          ms = await fetchMsCells(w, s, e, n, keptB);
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
      } catch {
        // try next source, then smaller radius
      }
    }
  }
  throw new Error("Could not load map data (network busy). Try again.");
}
