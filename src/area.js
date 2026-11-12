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

function parseOsmXml(text) {
  if (typeof DOMParser === "undefined") throw new Error("XML unavailable");
  const doc = new DOMParser().parseFromString(text, "text/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("XML parse failed");
  const nodeMap = new Map();
  const nodeEls = doc.getElementsByTagName("node");
  for (let i = 0; i < nodeEls.length; i++) {
    const el = nodeEls[i];
    const id = el.getAttribute("id");
    const lat = parseFloat(el.getAttribute("lat"));
    const lon = parseFloat(el.getAttribute("lon"));
    if (id != null && Number.isFinite(lat) && Number.isFinite(lon)) nodeMap.set(String(id), [lon, lat]);
  }
  const bRaw = [];
  const roads = [];
  const wayEls = doc.getElementsByTagName("way");
  for (let i = 0; i < wayEls.length; i++) {
    const way = wayEls[i];
    const id = way.getAttribute("id");
    if (id == null) continue;
    const pts = [];
    const ndEls = way.getElementsByTagName("nd");
    for (let j = 0; j < ndEls.length; j++) {
      const nd = ndEls[j];
      const nLat = parseFloat(nd.getAttribute("lat"));
      const nLon = parseFloat(nd.getAttribute("lon"));
      if (Number.isFinite(nLat) && Number.isFinite(nLon)) {
        pts.push([nLon, nLat]);
      } else {
        const ref = nd.getAttribute("ref");
        const hit = ref != null ? nodeMap.get(String(ref)) : undefined;
        if (hit) pts.push(hit);
      }
    }
    const tags = {};
    const tagEls = way.getElementsByTagName("tag");
    for (let j = 0; j < tagEls.length; j++) {
      const k = tagEls[j].getAttribute("k");
      if (k != null) tags[k] = tagEls[j].getAttribute("v");
    }
    if (tags.building != null) {
      if (pts.length >= 3) bRaw.push({ id: "w" + id, pts, tags, area: footprintAreaM2(pts) });
    } else if (tags.highway != null) {
      if (/^(residential|service|footway|steps|pedestrian|path|living_street|unclassified|tertiary|secondary)$/.test(tags.highway))
        roads.push({ id: "w" + id, pts, name: tags.name ?? null, kind: tags.highway });
    }
  }
  // associatedStreet relations carry the name for split member ways.
  const relEls = doc.getElementsByTagName("relation");
  const relNames = new Map();
  for (let i = 0; i < relEls.length; i++) {
    const rel = relEls[i];
    let type = null;
    let name = null;
    const tagEls = rel.getElementsByTagName("tag");
    for (let j = 0; j < tagEls.length; j++) {
      const k = tagEls[j].getAttribute("k");
      if (k === "type") type = tagEls[j].getAttribute("v");
      if (k === "name") name = tagEls[j].getAttribute("v");
    }
    if (type === "associatedStreet" && name) {
      const memEls = rel.getElementsByTagName("member");
      for (let j = 0; j < memEls.length; j++) {
        if (memEls[j].getAttribute("type") === "way") {
          const ref = memEls[j].getAttribute("ref");
          if (ref != null && !relNames.has(String(ref))) relNames.set(String(ref), name);
        }
      }
    }
  }
  for (const r of roads) {
    if (!r.name && relNames.has(r.id.slice(1))) r.name = relNames.get(r.id.slice(1));
  }
  bRaw.sort((a, b) => b.area - a.area);
  const buildings = bRaw.slice(0, 500).map((b) => {
    let levels = parseNum(b.tags["building:levels"]);
    let height = parseNum(b.tags.height ?? b.tags["building:height"]);
    if (height == null) height = levels != null ? levels * 3 : 9;
    if (levels == null) levels = Math.max(1, Math.round(height / 3));
    return { id: b.id, pts: b.pts, levels, height, color: null };
  });
  return { buildings, roads };
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
        const res = await fetch(url);
        if (!res.ok) throw new Error("osm api failed: " + res.status);
        return parseOsmXml(await res.text());
      },
      async () => {
        const ql = `[out:xml][timeout:30];(way["building"](${s},${w},${n},${e});way["highway"~"^(residential|service|footway|steps|pedestrian|path|living_street|unclassified|tertiary|secondary)$"](${s},${w},${n},${e}););out geom;`;
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
        const { buildings, roads } = await attempt();
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
        return {
          meta: { center: { lat: la, lon: lo }, source: "OpenStreetMap ODbL" },
          buildings: keptB,
          roads: keptR,
        };
      } catch {
        // try next source, then smaller radius
      }
    }
  }
  throw new Error("Could not load map data (network busy). Try again.");
}
