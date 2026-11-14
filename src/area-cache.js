const DB_NAME = "pixelart-area-cache";
const STORE = "areas";
const DB_VER = 1;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const mem = new Map();

function cacheKey(lat, lon, r, version = "v1") {
  const la = Math.round(Number(lat) * 1e4) / 1e4;
  const lo = Math.round(Number(lon) * 1e4) / 1e4;
  const rr = Math.round(Number(r) || 0);
  return `${version}:${la}:${lo}:${rr}`;
}

function openDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet(key, val) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function getCachedArea(lat, lon, r, version = "v1") {
  const key = cacheKey(lat, lon, r, version);
  const now = Date.now();
  const m = mem.get(key);
  if (m && now - m.t < TTL_MS) return m.data;
  if (m) mem.delete(key);
  const rec = await idbGet(key);
  if (!rec || !(now - rec.t < TTL_MS)) return null;
  mem.set(key, rec);
  return rec.data;
}

export async function setCachedArea(lat, lon, r, data, version = "v1") {
  const key = cacheKey(lat, lon, r, version);
  const rec = { t: Date.now(), data };
  mem.set(key, rec);
  await idbSet(key, rec);
}
