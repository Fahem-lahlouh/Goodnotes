import { POINT_STRIDE, type PointBuffer, type Stroke } from '../model/types';

export type BBox = [number, number, number, number];

export function pointCount(points: PointBuffer): number {
  return Math.floor(points.length / POINT_STRIDE);
}

/** Boîte englobante des points, élargie de `pad` (demi-épaisseur max du trait). */
export function computeBBox(points: PointBuffer, pad: number): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += POINT_STRIDE) {
    const x = points[i];
    const y = points[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return [0, 0, 0, 0];
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}

/** Demi-épaisseur maximale atteignable par un trait (sert au padding de bbox et au hit-test). */
export function strokeMaxRadius(s: Pick<Stroke, 'width' | 'tool' | 'style'>): number {
  const factor = s.tool === 'fountain' ? 0.8 : 1;
  const thinning = s.tool === 'highlighter' ? 0 : (s.style.thinning ?? 0.5);
  return s.width * factor * (0.5 + 0.5 * thinning) * (1 + (s.style.tilt ?? 0) * 0.6) + 1;
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function bboxUnion(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  const r: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    r[0] = Math.min(r[0], b[0]);
    r[1] = Math.min(r[1], b[1]);
    r[2] = Math.max(r[2], b[2]);
    r[3] = Math.max(r[3], b[3]);
  }
  return r;
}

/** Carré de la distance entre (px,py) et le segment [a,b]. */
export function distSqToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** Vrai si le cercle (cx, cy, r) touche le trait (épaisseur prise en compte). */
export function strokeHitsCircle(s: Stroke, cx: number, cy: number, r: number): boolean {
  const reach = r + s.width / 2;
  const b = s.bbox;
  if (cx + r < b[0] || cx - r > b[2] || cy + r < b[1] || cy - r > b[3]) return false;
  const p = s.points;
  const n = pointCount(p);
  const reach2 = reach * reach;
  if (n === 1) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    return dx * dx + dy * dy <= reach2;
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * POINT_STRIDE;
    const c = a + POINT_STRIDE;
    if (distSqToSegment(cx, cy, p[a], p[a + 1], p[c], p[c + 1]) <= reach2) return true;
  }
  return false;
}

/**
 * Densifie une trajectoire pour que deux points consécutifs soient espacés
 * d'au plus `maxGap`. Les attributs (pression, temps, inclinaison) sont interpolés.
 */
export function densify(points: PointBuffer, maxGap: number): PointBuffer {
  const n = pointCount(points);
  if (n < 2) return points.slice();
  const out: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * POINT_STRIDE;
    const b = a + POINT_STRIDE;
    const dist = Math.hypot(points[b] - points[a], points[b + 1] - points[a + 1]);
    const steps = Math.max(1, Math.ceil(dist / maxGap));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      for (let j = 0; j < POINT_STRIDE; j++) out.push(points[a + j] + (points[b + j] - points[a + j]) * t);
    }
  }
  const last = (n - 1) * POINT_STRIDE;
  for (let j = 0; j < POINT_STRIDE; j++) out.push(points[last + j]);
  return Float32Array.from(out);
}

/**
 * Gomme partielle : retire les portions du trait couvertes par le cercle
 * (cx, cy, r) et renvoie les morceaux restants (≥ 1 point chacun).
 * Renvoie `null` si le trait n'est pas touché.
 */
export function eraseFromPoints(
  points: PointBuffer,
  width: number,
  cx: number,
  cy: number,
  r: number,
): PointBuffer[] | null {
  const reach = r + width / 2;
  const reach2 = reach * reach;
  const dense = densify(points, Math.max(0.5, reach / 3));
  const n = pointCount(dense);
  const pieces: PointBuffer[] = [];
  let start = -1;
  let touched = false;
  for (let i = 0; i < n; i++) {
    const o = i * POINT_STRIDE;
    const dx = dense[o] - cx;
    const dy = dense[o + 1] - cy;
    const inside = dx * dx + dy * dy <= reach2;
    if (inside) {
      touched = true;
      if (start >= 0) {
        pieces.push(dense.slice(start * POINT_STRIDE, i * POINT_STRIDE));
        start = -1;
      }
    } else if (start < 0) {
      start = i;
    }
  }
  if (!touched) return null;
  if (start >= 0) pieces.push(dense.slice(start * POINT_STRIDE));
  // Les morceaux minuscules (un seul point isolé au bord de la gomme) deviennent invisibles : on les retire.
  return pieces.filter((p) => pointCount(p) >= 2 || pieces.length === 1);
}

/** Point dans polygone (règle pair-impair). `poly` = [x0, y0, x1, y1, ...]. */
export function pointInPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2];
    const yi = poly[i * 2 + 1];
    const xj = poly[j * 2];
    const yj = poly[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Un trait est sélectionné par le lasso si au moins `ratio` de ses points sont à l'intérieur. */
export function strokeInLasso(s: Stroke, poly: number[], ratio = 0.5): boolean {
  const n = pointCount(s.points);
  if (n === 0 || poly.length < 6) return false;
  let inside = 0;
  for (let i = 0; i < n; i++) {
    const o = i * POINT_STRIDE;
    if (pointInPolygon(s.points[o], s.points[o + 1], poly)) inside++;
  }
  return inside / n >= ratio;
}

/** Applique une transformation x' = x*k + dx, y' = y*k + dy (mise à l'échelle uniforme + translation). */
export function transformPoints(
  points: PointBuffer,
  k: number,
  dx: number,
  dy: number,
): PointBuffer {
  const out = points.slice();
  for (let i = 0; i < out.length; i += POINT_STRIDE) {
    out[i] = points[i] * k + dx;
    out[i + 1] = points[i + 1] * k + dy;
  }
  return out;
}
