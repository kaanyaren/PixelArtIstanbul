const AMENITY_POI = {
  bench: "bench", cafe: "cafe", restaurant: "restaurant", bar: "bar", pub: "pub", pharmacy: "pharmacy", hospital: "hospital",
  school: "school", bus_stop: "bus_stop", bus_station: "bus_stop", waste_basket: "waste_basket", waste_disposal: "waste_basket",
  toilets: "toilet", atm: "atm", fuel: "fuel", bank: "bank", hotel: "hotel", artwork: "artwork", drinking_water: "drinking_water",
  fountain: "fountain", parking: "parking", bicycle_parking: "bicycle_parking", police: "police", post_office: "post",
  townhall: "townhall", library: "library", museum: "museum", playground: "playground", clock: "clock",
};
const TOURISM_POI = { artwork: "artwork", museum: "museum", viewpoint: "viewpoint", gallery: "artwork", hotel: "hotel" };
const HISTORIC_POI = { memorial: "memorial", monument: "memorial" };
const LANDUSE_GREEN = { grass: "grass", forest: "forest", meadow: "meadow", allotments: "allotments", village_green: "village_green", recreation_ground: "recreation_ground", cemetery: "cemetery" };
const LEISURE_GREEN = { park: "park", garden: "garden", pitch: "pitch", playground: "playground", cemetery: "cemetery" };
const LANDUSE_WATER = { reservoir: "reservoir", basin: "basin" };
const MARKET_SHOPS = new Set(["supermarket", "convenience", "greengrocer", "bakery"]);

function parseNum(v) { if (v == null) return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
function footprintAreaM2(pts) {
  if (!pts || pts.length < 3) return 0;
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
function greenKind(tags) {
  if (tags.landuse != null && LANDUSE_GREEN[tags.landuse]) return LANDUSE_GREEN[tags.landuse];
  if (tags.leisure != null && LEISURE_GREEN[tags.leisure]) return LEISURE_GREEN[tags.leisure];
  return null;
}
function waterKind(tags) {
  if (tags.natural === "water") return "water";
  if (tags.landuse != null && LANDUSE_WATER[tags.landuse]) return LANDUSE_WATER[tags.landuse];
  if (tags.waterway === "river" || tags.waterway === "riverbank") return "river";
  if (tags.waterway === "canal") return "canal";
  return null;
}
function poiKind(tags) {
  if (tags.amenity != null) {
    if (tags.amenity === "place_of_worship") return tags.religion === "muslim" || tags.religion === "islam" ? "mosque" : "other";
    return AMENITY_POI[tags.amenity] ?? "other";
  }
  if (tags.tourism != null) return TOURISM_POI[tags.tourism] ?? "other";
  if (tags.historic != null) return HISTORIC_POI[tags.historic] ?? "other";
  if (tags.natural != null) return tags.natural === "tree" ? "tree" : null;
  if (tags.waterway != null) return tags.waterway === "drinking_water" ? "drinking_water" : tags.waterway === "fountain" ? "fountain" : null;
  if (tags.shop != null) return MARKET_SHOPS.has(tags.shop) ? "market" : "shop";
  if (tags.man_made === "water_tower" || tags.man_made === "lighthouse") return "other";
  if (tags.railway === "station") return "other";
  if (tags.highway === "bus_stop") return "bus_stop";
  if (tags.highway === "street_lamp") return "street_lamp";
  return null;
}
function poiEntry(x, y, tags) {
  const kind = poiKind(tags);
  if (!kind) return null;
  const name = tags.name ?? tags["name:tr"] ?? null;
  return name ? { x, y, kind, name } : { x, y, kind };
}

function unescapeXml(s) {
  return String(s).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function attrMap(attrStr) {
  const out = {};
  const re = /([:\w-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(attrStr))) out[m[1]] = unescapeXml(m[2]);
  return out;
}
function tagsFromInner(inner) {
  const tags = {};
  const re = /<tag\b([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(inner))) {
    const a = attrMap(m[1]);
    if (a.k != null) tags[a.k] = a.v ?? null;
  }
  return tags;
}
function ndsFromInner(inner) {
  const refs = [];
  const ptsInline = [];
  const re = /<nd\b([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(inner))) {
    const a = attrMap(m[1]);
    if (a.ref != null) refs.push(String(a.ref));
    const lat = parseFloat(a.lat);
    const lon = parseFloat(a.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) ptsInline.push([lon, lat, String(a.ref ?? "")]);
  }
  return { refs, ptsInline };
}
function membersFromInner(inner) {
  const members = [];
  const re = /<member\b([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(inner))) members.push(attrMap(m[1]));
  return members;
}

function parseOsmXmlLite(text) {
  if (!text || /<parsererror/i.test(text)) throw new Error("XML parse failed");
  const nodeMap = new Map();
  const pois = [];
  const nodeRe = /<node\b([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g;
  let m;
  while ((m = nodeRe.exec(text))) {
    const a = attrMap(m[1]);
    const id = a.id;
    const lat = parseFloat(a.lat);
    const lon = parseFloat(a.lon);
    if (id == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    nodeMap.set(String(id), [lon, lat]);
    const tags = m[2] ? tagsFromInner(m[2]) : {};
    const p = poiEntry(lon, lat, tags);
    if (p) pois.push(p);
  }

  const bRaw = [];
  const roads = [];
  const greens = [];
  const waters = [];
  const wayMap = new Map();
  const wayRefMap = new Map();
  const wayRe = /<way\b([^>]*?)(?:\/>|>([\s\S]*?)<\/way>)/g;
  while ((m = wayRe.exec(text))) {
    const a = attrMap(m[1]);
    const id = a.id;
    if (id == null) continue;
    const inner = m[2] || "";
    const tags = tagsFromInner(inner);
    const { refs, ptsInline } = ndsFromInner(inner);
    const pts = [];
    for (const pi of ptsInline) {
      if (pi[2]) pts.push([pi[0], pi[1]]);
      else pts.push([pi[0], pi[1]]);
    }
    if (pts.length !== refs.length) {
      // fill by refs
      const rebuilt = [];
      let inlineIdx = 0;
      for (let j = 0; j < refs.length; j++) {
        const ref = refs[j];
        const inl = ptsInline[inlineIdx];
        if (inl && String(inl[2] || ref) === String(ref)) { rebuilt.push([inl[0], inl[1]]); inlineIdx++; }
        else {
          const hit = nodeMap.get(String(ref));
          if (hit) rebuilt.push(hit);
        }
      }
      if (rebuilt.length) { pts.length = 0; for (const p of rebuilt) pts.push(p); }
    } else if (pts.length === 0 && refs.length) {
      for (const ref of refs) { const hit = nodeMap.get(String(ref)); if (hit) pts.push(hit); }
    }
    if (pts.length >= 2) wayMap.set(String(id), pts);
    if (refs.length) wayRefMap.set(String(id), refs);
    const closed = refs.length > 2 && refs[0] === refs[refs.length - 1];
    if (tags.building != null) {
      if (pts.length >= 3) bRaw.push({ id: "w" + id, pts, tags, area: footprintAreaM2(pts) });
    } else if (tags.highway != null) {
      const hw = String(tags.highway).split(";")[0].trim();
      if (/^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|track|busway|footway|path|steps|cycleway|bridleway)(_link)?$/.test(hw)) {
        if (pts.length >= 2) {
          const name = tags.name ?? tags["name:tr"] ?? tags.alt_name ?? tags["name:en"] ?? null;
          roads.push({ id: "w" + id, pts, name, kind: hw, refs: refs.slice() });
        }
      }
    }
    if (!tags.building && closed && pts.length >= 3) {
      const g = greenKind(tags);
      if (g) greens.push({ pts, kind: g });
      else { const w = waterKind(tags); if (w) waters.push({ pts, kind: w }); }
    }
  }

  const relNames = new Map();
  const relRe = /<relation\b([^>]*?)(?:\/>|>([\s\S]*?)<\/relation>)/g;
  while ((m = relRe.exec(text))) {
    const ra = attrMap(m[1]);
    const inner = m[2] || "";
    const tags = tagsFromInner(inner);
    const type = tags.type;
    const name = tags.name ?? tags["name:tr"] ?? tags.alt_name ?? null;
    const members = membersFromInner(inner);
    if ((type === "associatedStreet" || type === "street") && name) {
      for (const mem of members) if (mem.type === "way" && mem.ref != null && !relNames.has(String(mem.ref))) relNames.set(String(mem.ref), name);
    }
    const gk = greenKind(tags);
    const wk = waterKind(tags);
    const isBuilding = tags.building != null;
    if (!gk && !wk && !isBuilding) continue;

    if (isBuilding) {
      const relNodeMap = new Map();
      const ndRe = /<nd\b([^>]*?)\/>/g;
      let nm;
      while ((nm = ndRe.exec(inner))) {
        const na = attrMap(nm[1]);
        const lat = parseFloat(na.lat), lon = parseFloat(na.lon);
        if (na.ref != null && Number.isFinite(lat) && Number.isFinite(lon)) relNodeMap.set(String(na.ref), [lon, lat]);
      }
      const rings = [];
      const segs = [];
      const ptKey = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
      for (const mem of members) {
        if (mem.type !== "way") continue;
        const role = mem.role || "";
        if (role && role !== "outer" && role !== "outline") continue;
        let mpts = null, refs = null;
        const ref = String(mem.ref);
        // Prefer resolved way geometry from earlier <way> pass (same as DOM path)
        const wpts = wayMap.get(ref);
        if (wpts) { mpts = wpts.slice(); refs = (wayRefMap.get(ref) || []).slice(); }
        if (!mpts || mpts.length < 3) continue;
        const closed = (refs && refs.length > 1 && refs[0] === refs[refs.length - 1]) || ptKey(mpts[0]) === ptKey(mpts[mpts.length - 1]);
        if (closed) rings.push(mpts); else segs.push(mpts);
      }
      if (segs.length) {
        const chains = segs.map((s) => s.slice());
        let changed = true;
        while (changed && chains.length > 1) {
          changed = false;
          outer: for (let a = 0; a < chains.length; a++) {
            for (let b = a + 1; b < chains.length; b++) {
              const A = chains[a], B = chains[b];
              const a0 = ptKey(A[0]), a1 = ptKey(A[A.length - 1]), b0 = ptKey(B[0]), b1 = ptKey(B[B.length - 1]);
              let merged = null;
              if (a1 === b0) merged = A.concat(B.slice(1));
              else if (a1 === b1) merged = A.concat(B.slice(0, -1).reverse());
              else if (a0 === b1) merged = B.concat(A.slice(1));
              else if (a0 === b0) merged = B.slice().reverse().concat(A.slice(1));
              if (merged) { chains[a] = merged; chains.splice(b, 1); changed = true; break outer; }
            }
          }
        }
        for (const c of chains) if (c.length >= 3 && (ptKey(c[0]) === ptKey(c[c.length - 1]) || c.length >= 4)) rings.push(c);
      }
      if (rings.length) {
        rings.sort((a, b2) => footprintAreaM2(b2) - footprintAreaM2(a));
        const outer = rings[0];
        bRaw.push({ id: "r" + ra.id, pts: outer, tags, area: footprintAreaM2(outer) });
      }
      continue;
    }

    const pts = [];
    for (const mem of members) {
      if (mem.type !== "way") continue;
      const wpts = wayMap.get(String(mem.ref));
      if (wpts) for (const p of wpts) pts.push(p);
    }
    if (pts.length >= 3) (gk ? greens : waters).push({ pts, kind: gk ?? wk });
  }

  for (const r of roads) if (!r.name && relNames.has(r.id.slice(1))) r.name = relNames.get(r.id.slice(1));
  const nodeNames = new Map();
  for (const r of roads) {
    if (!r.name) continue;
    for (const n of r.refs || []) {
      if (!nodeNames.has(n)) nodeNames.set(n, new Map());
      const mm = nodeNames.get(n);
      mm.set(r.name, (mm.get(r.name) ?? 0) + 1);
    }
  }
  for (const r of roads) {
    if (r.name || /^(footway|steps|path|cycleway)$/.test(r.kind)) continue;
    const votes = new Map();
    for (const n of r.refs || []) {
      const mm = nodeNames.get(n);
      if (mm) for (const [nm, c] of mm) votes.set(nm, (votes.get(nm) ?? 0) + c);
    }
    const sorted = [...votes.entries()].sort((a, b2) => b2[1] - a[1]);
    if (sorted.length && sorted[0][1] >= 2 && (sorted.length < 2 || sorted[0][1] >= 2 * sorted[1][1])) { r.name = sorted[0][0]; r.inferred = true; }
  }
  for (const r of roads) delete r.refs;

  bRaw.sort((a, b2) => b2.area - a.area);
  const buildings = bRaw.slice(0, 3000).map((b) => {
    let levels = parseNum(b.tags["building:levels"]);
    let height = parseNum(b.tags.height ?? b.tags["building:height"]);
    if (height == null) height = levels != null ? levels * 3 : 9;
    if (levels == null) levels = Math.max(1, Math.round(height / 3));
    return { id: b.id, pts: b.pts, levels, height, color: null, type: b.tags.building, name: b.tags.name ?? b.tags["name:tr"] ?? null };
  });
  return { buildings, roads, greens, waters, pois };
}

async function fetchOverpass(url, ql, timeoutMs = 30000) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { method: "POST", body: ql, ...(ctrl ? { signal: ctrl.signal } : {}) });
    if (!res.ok) throw new Error("overpass failed: " + res.status);
    return parseOsmXmlLite(await res.text());
  } finally {
    if (t) clearTimeout(t);
  }
}

async function fetchOsmMap(box) {
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${box}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("osm api failed: " + res.status);
  return parseOsmXmlLite(await res.text());
}

async function tryFetch(lat, lon, rad, overpassUrls) {
  const frad = rad + 150;
  const dLat = frad / 111320;
  const dLon = frad / (111320 * Math.cos((lat * Math.PI) / 180));
  const w = lon - dLon, s = lat - dLat, e = lon + dLon, n = lat + dLat;
  const box = `${s},${w},${n},${e}`;
  const ql = `[out:xml][timeout:30];(way["building"](${box});relation["building"]["type"="multipolygon"](${box});relation["building"](${box});way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|track|busway|footway|path|steps|cycleway|bridleway)(_link)?$"](${box});way["landuse"~"^(grass|forest|meadow|allotments|village_green|recreation_ground|cemetery|reservoir|basin)$"](${box});way["leisure"~"^(park|garden|pitch|playground|cemetery)$"](${box});way["natural"="water"](${box});way["waterway"~"^(riverbank|river|canal)$"](${box});relation["landuse"~"^(grass|forest|meadow|allotments|village_green|recreation_ground|cemetery|reservoir|basin)$"](${box});relation["leisure"~"^(park|garden|pitch|playground|cemetery)$"](${box});relation["natural"="water"](${box});node["amenity"](${box});node["tourism"](${box});node["historic"](${box});node["natural"="tree"](${box});node["shop"](${box});node["highway"~"^(bus_stop|street_lamp)$"](${box});node["waterway"~"^(drinking_water|fountain)$"](${box});node["man_made"~"^(water_tower|lighthouse)$"](${box});node["railway"="station"](${box}););out body;>;out skel qt;`;
  for (const url of overpassUrls) {
    try { return { ...(await fetchOverpass(url, ql)), bbox: { w, s, e, n }, rad, frad }; } catch {}
  }
  try { return { ...(await fetchOsmMap(`${w},${s},${e},${n}`)), bbox: { w, s, e, n }, rad, frad }; } catch { return null; }
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  const id = msg.id;
  try {
    if (msg.type !== "fetchArea") throw new Error("unknown message");
    const lat = Number(msg.lat), lon = Number(msg.lon), base = Number(msg.r) || 500;
    const overpassUrls = Array.isArray(msg.overpassUrls) ? msg.overpassUrls : [];
    let result = await tryFetch(lat, lon, base, overpassUrls);
    if (result) {
      const roads0 = result.roads.filter((r) => r.pts.some(([x, y]) => {
        const kx = 111320 * Math.cos((lat * Math.PI) / 180);
        return Math.abs((x - lon) * kx) <= base && Math.abs((y - lat) * 111320) <= base;
      }));
      const b0 = result.buildings.filter((b) => {
        const kx = 111320 * Math.cos((lat * Math.PI) / 180);
        let sx = 0, sy = 0; for (const [x, y] of b.pts) { sx += x; sy += y; }
        return Math.abs((sx / b.pts.length - lon) * kx) <= base && Math.abs((sy / b.pts.length - lat) * 111320) <= base;
      });
      if (b0.length === 0 && roads0.length > 0) {
        const retry = await tryFetch(lat, lon, base + 200, overpassUrls);
        if (retry) result = retry;
      }
    }
    if (!result) {
      const retrySmall = await tryFetch(lat, lon, Math.max(250, base * 0.6), overpassUrls);
      if (!retrySmall) throw new Error("Could not load map data (network busy). Try again.");
      result = retrySmall;
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
