import { POINT_STRIDE } from '../model/types';

/**
 * Reconnaissance de formes nettes après un maintien immobile en fin de tracé.
 * Formes reconnues : droite, cercle / ellipse, rectangle (éventuellement incliné).
 * Les seuils sont relatifs à la taille du tracé : le résultat ne dépend pas du zoom.
 */
export type Shape =
  | { kind: 'line'; ax: number; ay: number; bx: number; by: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; circle: boolean }
  | { kind: 'rect'; corners: [number, number][] };

export const SHAPE_LABELS: Record<Shape['kind'], string> = { line: 'Droite', ellipse: 'Ellipse', rect: 'Rectangle' };

export function shapeLabel(s: Shape): string {
  return s.kind === 'ellipse' && s.circle ? 'Cercle' : SHAPE_LABELS[s.kind];
}

type P = [number, number];

function toPoints(data: ArrayLike<number>): P[] {
  const out: P[] = [];
  for (let i = 0; i + 1 < data.length; i += POINT_STRIDE) out.push([data[i], data[i + 1]]);
  return out;
}

function pathLength(p: P[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return l;
}

function distToSegment(p: P, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

/** Simplification Ramer–Douglas–Peucker. */
function rdp(p: P[], eps: number): P[] {
  if (p.length < 3) return p.slice();
  let max = 0;
  let idx = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = distToSegment(p[i], p[0], p[p.length - 1]);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [p[0], p[p.length - 1]];
  return [...rdp(p.slice(0, idx + 1), eps).slice(0, -1), ...rdp(p.slice(idx), eps)];
}

function angleBetween(a: P, b: P, c: P): number {
  const v1x = a[0] - b[0];
  const v1y = a[1] - b[1];
  const v2x = c[0] - b[0];
  const v2y = c[1] - b[1];
  const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Renvoie la forme reconnue, ou null si le tracé ne ressemble à aucune forme nette. */
export function recognizeShape(data: ArrayLike<number>): Shape | null {
  const p = toPoints(data);
  if (p.length < 3) return null;
  const first = p[0];
  const last = p[p.length - 1];
  const len = pathLength(p);
  const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of p) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const diag = Math.hypot(w, h);
  if (diag < 12) return null;

  // Droite : longueur du chemin proche de la corde, faible écart au segment.
  if (chord > 16 && len / chord < 1.12) {
    const dev = Math.max(...p.map((q) => distToSegment(q, first, last)));
    if (dev <= Math.max(3, chord * 0.07)) return { kind: 'line', ax: first[0], ay: first[1], bx: last[0], by: last[1] };
  }

  // Formes fermées : extrémités proches au regard de la taille.
  const closed = chord < Math.max(w, h) * 0.3 && len > diag * 1.6;
  if (!closed) return null;

  // Rectangle : 4 sommets après simplification, angles proches de 90°.
  const simple = rdp(p, diag * 0.07);
  let verts = simple.slice();
  if (verts.length > 2 && Math.hypot(verts[0][0] - verts[verts.length - 1][0], verts[0][1] - verts[verts.length - 1][1]) < diag * 0.15) verts.pop();
  // Fusionne les sommets trop proches.
  verts = verts.filter((v, i) => i === 0 || Math.hypot(v[0] - verts[i - 1][0], v[1] - verts[i - 1][1]) > diag * 0.1);
  if (verts.length === 4) {
    const angles = verts.map((v, i) => angleBetween(verts[(i + 3) % 4], v, verts[(i + 1) % 4]));
    if (angles.every((a) => Math.abs(a - 90) < 25)) {
      // Rectangle orienté selon le côté le plus long.
      let best = 0;
      let bestLen = 0;
      for (let i = 0; i < 4; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % 4];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l > bestLen) {
          bestLen = l;
          best = i;
        }
      }
      const a = verts[best];
      const b = verts[(best + 1) % 4];
      let theta = Math.atan2(b[1] - a[1], b[0] - a[0]);
      // Presque horizontal / vertical → aligné sur les axes.
      const snap = Math.round(theta / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(theta - snap) < (8 * Math.PI) / 180) theta = snap;
      const c = Math.cos(theta);
      const sn = Math.sin(theta);
      let u0 = Infinity;
      let u1 = -Infinity;
      let v0 = Infinity;
      let v1 = -Infinity;
      for (const [x, y] of p) {
        const u = x * c + y * sn;
        const v = -x * sn + y * c;
        u0 = Math.min(u0, u);
        u1 = Math.max(u1, u);
        v0 = Math.min(v0, v);
        v1 = Math.max(v1, v);
      }
      const back = (u: number, v: number): P => [u * c - v * sn, u * sn + v * c];
      return { kind: 'rect', corners: [back(u0, v0), back(u1, v0), back(u1, v1), back(u0, v1)] };
    }
  }

  // Ellipse (alignée sur les axes) : rayon normalisé proche de 1 sur tout le tracé.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = w / 2;
  const ry = h / 2;
  if (rx < 4 || ry < 4) return null;
  let err = 0;
  for (const [x, y] of p) err += Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1);
  err /= p.length;
  if (err < 0.14) {
    const circle = Math.abs(rx - ry) / Math.max(rx, ry) < 0.15;
    const r = (rx + ry) / 2;
    return circle ? { kind: 'ellipse', cx, cy, rx: r, ry: r, circle } : { kind: 'ellipse', cx, cy, rx, ry, circle };
  }
  return null;
}

/** Points (5 valeurs par point) décrivant la forme, avec une pression constante. */
export function shapePoints(s: Shape, pressure: number, step = 3): number[] {
  const out: number[] = [];
  let t = 0;
  const push = (x: number, y: number) => {
    out.push(x, y, pressure, t, 0);
    t += 4;
  };
  const segment = (a: P, b: P, includeEnd: boolean) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let i = 0; i < n; i++) push(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n);
    if (includeEnd) push(b[0], b[1]);
  };
  if (s.kind === 'line') segment([s.ax, s.ay], [s.bx, s.by], true);
  else if (s.kind === 'rect') {
    for (let i = 0; i < 4; i++) segment(s.corners[i], s.corners[(i + 1) % 4], i === 3);
  } else {
    const n = Math.max(24, Math.ceil((Math.PI * (s.rx + s.ry)) / step));
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      push(s.cx + Math.cos(a) * s.rx, s.cy + Math.sin(a) * s.ry);
    }
  }
  return out;
}

/** Pression moyenne d'un tracé. */
export function meanPressure(data: ArrayLike<number>): number {
  let sum = 0;
  let n = 0;
  for (let i = 2; i < data.length; i += POINT_STRIDE) {
    sum += data[i];
    n++;
  }
  return n ? sum / n : 0.5;
}
