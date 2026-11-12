// Player-facing settings: specs, defaults, persistence.
const STORAGE_KEY = 'pixelart.settings';

export const SETTINGS = [
  { key: 'speed', label: 'Walking speed', type: 'range', min: 4, max: 30, step: 1, unit: ' m/s', def: 14 },
  { key: 'zoom', label: 'Default zoom', type: 'range', min: 0.8, max: 2, step: 0.1, unit: '×', def: 1.2 },
  {
    key: 'timeOfDay', label: 'Time of day', type: 'select', def: 'day',
    options: [['day', 'Day'], ['golden', 'Golden hour'], ['night', 'Night']],
  },
  { key: 'labels', label: 'Street name labels', type: 'check', def: true },
  { key: 'life', label: 'Street life (cats, cars, people)', type: 'range', min: 0, max: 2, step: 0.25, unit: '×', def: 1, reload: true },
  { key: 'radius', label: 'Area radius', type: 'range', min: 250, max: 700, step: 50, unit: ' m', def: 500, reload: true },
];

export const DEFAULTS = Object.fromEntries(SETTINGS.map((s) => [s.key, s.def]));

// localStorage can be missing (node) or throw (private mode); never touch it at import time.
function getStore() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function coerce(spec, value) {
  if (spec.type === 'range') {
    const n = typeof value === 'number' ? value : Number.parseFloat(value);
    return Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, n)) : spec.def;
  }
  if (spec.type === 'check') return typeof value === 'boolean' ? value : spec.def;
  if (spec.type === 'select') return spec.options.some(([id]) => id === value) ? value : spec.def;
  return spec.def;
}

function merge(values) {
  const out = { ...DEFAULTS };
  if (!values || typeof values !== 'object') return out;
  for (const spec of SETTINGS) {
    if (Object.prototype.hasOwnProperty.call(values, spec.key)) out[spec.key] = coerce(spec, values[spec.key]);
  }
  return out;
}

export function loadSettings() {
  const store = getStore();
  if (!store) return { ...DEFAULTS };
  try {
    const raw = store.getItem(STORAGE_KEY);
    return raw ? merge(JSON.parse(raw)) : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(values) {
  const merged = merge(values);
  try {
    const store = getStore();
    if (store) store.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // private mode / quota: keep the in-memory values anyway
  }
  return merged;
}

export function resetSettings() {
  try {
    const store = getStore();
    if (store) store.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return { ...DEFAULTS };
}
