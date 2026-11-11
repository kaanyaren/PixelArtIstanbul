// 2:1 isometric projection. Cart units = meters. TILE = meters per tile.
export const TILE = 2;
export const TILE_W = 32;
export const TILE_H = 16;

export function cartToIso(x, y) {
  const tx = x / TILE;
  const ty = y / TILE;
  return {
    x: (tx - ty) * (TILE_W / 2),
    y: (tx + ty) * (TILE_H / 2),
  };
}

export function isoToCart(sx, sy) {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  const tx = (b + a) / 2;
  const ty = (b - a) / 2;
  return {
    x: tx * TILE,
    y: ty * TILE,
  };
}
