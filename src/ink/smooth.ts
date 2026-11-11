import { POINT_STRIDE } from '../model/types';

/**
 * Lissage spatial du tracé, appliqué au RENDU : les points enregistrés ne changent pas.
 *
 * Problème corrigé : Safari fournit les coordonnées du stylet arrondies au pixel CSS. À 240 Hz,
 * le tracé devient un escalier de 1 px ; le contour, calculé perpendiculairement à la direction
 * locale, ondule alors (bord granuleux et irrégulier : écarts mesurés jusqu'à ~0,5 unité, près
 * de la moitié de la demi-épaisseur d'un trait fin).
 *
 * Méthode (mesures : tests/unit/smooth.test.ts) :
 *  1. rééchantillonnage à pas régulier h = res / 2 le long du tracé ;
 *  2. régression locale quadratique (Savitzky–Golay) en abscisse curviligne, avec deux fenêtres :
 *     large (±8 res) là où le tracé est droit — l'escalier disparaît, même sur une droite presque
 *     horizontale — et étroite (±2 res) dans les courbes, pour garder intactes les boucles des
 *     lettres. Une régression quadratique, contrairement à une moyenne, ne « rétrécit » pas les
 *     courbes. Calcul en O(1) par point grâce à des sommes cumulées ;
 *  3. pression légèrement lissée (ses variations sont conservées).
 *
 * Les extrémités restent exactes (fenêtre tronquée symétriquement) : la fin du trait reste sous
 * la pointe, sans retard. `res` : taille d'un pixel de saisie en unités page (voir StrokeStyle.res).
 */

/** Résolution supposée pour les traits sans `style.res` (créés avant ce lissage). */
export const DEFAULT_RES = 0.8;
/** Nombre maximal de points après rééchantillonnage (coût de rendu borné). */
const MAX_POINTS = 4000;
/** Demi-fenêtres (en échantillons de pas res/2) et seuils de passage étroite → large (en res). */
const SMALL = 4;
const LARGE = 16;
const BLEND_LO = 0.3;
const BLEND_HI = 0.5;

/** Rééchantillonne à pas h (toutes les composantes interpolées) ; dernier point exact. */
function resample(p: ArrayLike<number>, n: number, h: number, L: number): Float64Array {
  const cap = (Math.ceil(L / h) + 3) * POINT_STRIDE;
  const out = new Float64Array(cap);
  let w = 0;
  for (let j = 0; j < POINT_STRIDE; j++) out[w++] = p[j];
  let acc = 0;
  for (let i = 1; i < n; i++) {
    const a = (i - 1) * POINT_STRIDE;
    const b = i * POINT_STRIDE;
    const seg = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1]);
    if (seg === 0) continue;
    let d = h - acc;
    while (d <= seg && w + POINT_STRIDE <= cap - POINT_STRIDE) {
      const t = d / seg;
      for (let j = 0; j < POINT_STRIDE; j++) out[w++] = p[a + j] + (p[b + j] - p[a + j]) * t;
      d += h;
    }
    acc = seg - (d - h);
  }
  const last = (n - 1) * POINT_STRIDE;
  const tail = w - POINT_STRIDE;
  if (Math.hypot(p[last] - out[tail], p[last + 1] - out[tail + 1]) > h * 0.25) for (let j = 0; j < POINT_STRIDE; j++) out[w++] = p[last + j];
  else for (let j = 0; j < POINT_STRIDE; j++) out[tail + j] = p[last + j];
  return out.subarray(0, w);
}

/** Sommes cumulées de v[t], t·v[t], t²·v[t] (composante c d'un tableau à POINT_STRIDE valeurs). */
function prefix(q: Float64Array, m: number, c: number): [Float64Array, Float64Array, Float64Array] {
  const a = new Float64Array(m + 1);
  const b = new Float64Array(m + 1);
  const d = new Float64Array(m + 1);
  for (let t = 0; t < m; t++) {
    const v = q[t * POINT_STRIDE + c];
    a[t + 1] = a[t] + v;
    b[t + 1] = b[t] + t * v;
    d[t + 1] = d[t] + t * t * v;
  }
  return [a, b, d];
}

/** Valeur au centre i de la parabole des moindres carrés sur [i-r, i+r] (poids uniformes). */
function fit(P: [Float64Array, Float64Array, Float64Array], i: number, r: number): number {
  const lo = i - r;
  const hi = i + r + 1;
  const s0 = P[0][hi] - P[0][lo];
  if (r < 2) return s0 / (2 * r + 1);
  const s1 = P[1][hi] - P[1][lo];
  const s2 = P[2][hi] - P[2][lo];
  // Σ (t-i)² v_t = Σ t² v - 2i Σ t v + i² Σ v
  const x2 = s2 - 2 * i * s1 + i * i * s0;
  const n0 = 2 * r + 1;
  const n2 = (r * (r + 1) * (2 * r + 1)) / 3;
  const n4 = (r * (r + 1) * (2 * r + 1) * (3 * r * r + 3 * r - 1)) / 15;
  return (s0 * n4 - x2 * n2) / (n0 * n4 - n2 * n2);
}

export function smoothForRender(p: ArrayLike<number>, res: number): number[] {
  return smoothWith(p, res, SMALL, LARGE, BLEND_LO, BLEND_HI);
}

/** Même lissage, paramètres explicites (réglage et tests). */
export function smoothWith(p: ArrayLike<number>, res: number, SMALL_: number, LARGE_: number, LO_: number, HI_: number): number[] {
  const n = Math.floor(p.length / POINT_STRIDE);
  if (n < 3 || !(res > 0)) return Array.from(p);
  let L = 0;
  for (let i = 1; i < n; i++) L += Math.hypot(p[i * POINT_STRIDE] - p[(i - 1) * POINT_STRIDE], p[i * POINT_STRIDE + 1] - p[(i - 1) * POINT_STRIDE + 1]);
  if (L < res * 2) return Array.from(p);
  // Pas d'échantillonnage : res/2 (borné pour les très longs traits).
  const h = Math.max(res * 0.5, 0.1, L / MAX_POINTS);
  const q = resample(p, n, h, L);
  const m = q.length / POINT_STRIDE;
  // Demi-fenêtres en échantillons (si le pas a été agrandi, elles raccourcissent d'autant).
  const k = (res * 0.5) / h;
  const small = Math.max(1, Math.round(SMALL_ * k));
  const large = Math.max(small, Math.round(LARGE_ * k));
  const lo = LO_ * res;
  const hi = HI_ * res;
  const PX = prefix(q, m, 0);
  const PY = prefix(q, m, 1);
  const PP = prefix(q, m, 2);
  const out = Array.from(q);
  for (let i = 1; i < m - 1; i++) {
    const o = i * POINT_STRIDE;
    const edge = Math.min(i, m - 1 - i);
    const rs = Math.min(small, edge);
    const rl = Math.min(large, edge);
    const ax = fit(PX, i, rs);
    const ay = fit(PY, i, rs);
    const bx = fit(PX, i, rl);
    const by = fit(PY, i, rl);
    // Écart entre les deux ajustements : faible sur une partie droite (grande fenêtre),
    // fort dans une courbe serrée (petite fenêtre).
    const d = Math.hypot(ax - bx, ay - by);
    const t = Math.min(1, Math.max(0, (d - lo) / (hi - lo)));
    const u = t * t * (3 - 2 * t);
    out[o] = bx + (ax - bx) * u;
    out[o + 1] = by + (ay - by) * u;
    // Pression : moyenne courte (±2 échantillons).
    const rp = Math.min(2, edge);
    out[o + 2] = (PP[0][i + rp + 1] - PP[0][i - rp]) / (2 * rp + 1);
  }
  return out;
}
