import { getStroke } from 'perfect-freehand';
import { POINT_STRIDE, type InkTool, type PointBuffer, type Stroke, type StrokeStyle } from '../model/types';

/**
 * Rendu des traits manuscrits. Chaque outil a un rendu réellement distinct :
 *  - pen (stylo à bille) : largeur presque constante, faible réponse à la pression ;
 *  - fountain (plume)    : épaisseur selon la direction du tracé (bec biseauté à 45°) et la pression ;
 *  - brush (pinceau)     : forte réponse à la pression/vitesse, extrémités effilées ;
 *  - pencil (crayon)     : texture granuleuse de graphite, légèrement transparent ;
 *  - highlighter         : large, plat, translucide, dessiné sous l'encre.
 */

export const HIGHLIGHTER_ALPHA = 0.32;
export const PENCIL_ALPHA = 0.88;

export interface OutlineInput {
  tool: InkTool;
  width: number;
  style: StrokeStyle;
  points: PointBuffer;
}

function clamp01(v: number): number {
  return v < 0.05 ? 0.05 : v > 1 ? 1 : v;
}

/** Facteur de taille propre à l'outil (la plume dépasse la largeur nominale sur les pleins). */
export function sizeFactor(tool: InkTool): number {
  return tool === 'fountain' ? 0.8 : 1;
}

/**
 * Plume : pression synthétique selon l'angle entre la direction du tracé et le bec.
 * Les pleins (perpendiculaires au bec) sont épais, les déliés fins. La direction est
 * lissée pour éviter les à-coups.
 */
function fountainPressures(p: PointBuffer, style: StrokeStyle): number[] {
  const n = p.length / POINT_STRIDE;
  const nib = style.nibAngle ?? Math.PI / 4;
  const out: number[] = new Array(n);
  let f = 0.6;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2) * POINT_STRIDE;
    const b = Math.min(n - 1, i + 2) * POINT_STRIDE;
    const dx = p[b] - p[a];
    const dy = p[b + 1] - p[a + 1];
    if (dx * dx + dy * dy > 0.01) {
      const target = Math.abs(Math.sin(Math.atan2(dy, dx) - nib));
      f = f * 0.55 + target * 0.45;
    }
    const pressure = style.realPressure ? p[i * POINT_STRIDE + 2] : 0.6;
    out[i] = clamp01(0.12 + 0.88 * f * (0.55 + 0.45 * pressure));
  }
  return out;
}

/**
 * Calcule le contour (polygone) d'un trait.
 * `complete` = false pendant le tracé : l'extrémité n'est pas « fermée »,
 * ce qui évite un effet de goutte à la pointe du stylet.
 */
export function strokeOutline(s: OutlineInput, complete: boolean): number[][] {
  const p = s.points;
  const n = p.length / POINT_STRIDE;
  const pts: number[][] = new Array(n);
  const fp = s.tool === 'fountain' ? fountainPressures(p, s.style) : null;
  for (let i = 0; i < n; i++) {
    const o = i * POINT_STRIDE;
    const pressure = fp ? fp[i] : clamp01(p[o + 2] + s.style.tilt * p[o + 4] * 0.6);
    pts[i] = [p[o], p[o + 1], pressure];
  }
  const size = s.width * sizeFactor(s.tool);
  const base = { size, smoothing: 0.5, streamline: s.style.streamline, last: complete };
  switch (s.tool) {
    case 'highlighter':
      return getStroke(pts, { ...base, thinning: 0, simulatePressure: false, start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 } });
    case 'fountain':
      return getStroke(pts, { ...base, thinning: s.style.thinning, simulatePressure: false, start: { cap: true }, end: { cap: true } });
    case 'brush':
      return getStroke(pts, {
        ...base,
        thinning: s.style.thinning,
        simulatePressure: !s.style.realPressure,
        easing: (t) => Math.sin((t * Math.PI) / 2),
        start: { cap: true, taper: Math.min(80, size * 3) },
        end: { cap: true, taper: complete ? Math.min(100, size * 4) : 0 },
      });
    case 'pencil':
      return getStroke(pts, {
        ...base,
        thinning: s.style.thinning,
        simulatePressure: !s.style.realPressure,
        start: { cap: true, taper: Math.min(12, size * 2) },
        end: { cap: true, taper: complete ? Math.min(12, size * 2) : 0 },
      });
    default:
      return getStroke(pts, {
        ...base,
        thinning: s.style.thinning,
        simulatePressure: !s.style.realPressure,
        start: { cap: true, taper: 0 },
        end: { cap: true, taper: 0 },
      });
  }
}

/** Construit un Path2D lissé (courbes quadratiques entre milieux) à partir du contour. */
export function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  const n = outline.length;
  if (n === 0) return path;
  if (n < 3) {
    const [x, y] = outline[0];
    path.arc(x, y, 0.5, 0, Math.PI * 2);
    return path;
  }
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    path.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  path.closePath();
  return path;
}

/**
 * Cache des chemins (LRU borné) : la mémoire ne croît pas avec le nombre de pages
 * consultées. Un trait est immuable (toute modification crée un nouvel objet).
 */
const PATH_CACHE_MAX = 30000;
const pathCache = new Map<Stroke, Path2D>();

export function strokePath(s: Stroke): Path2D {
  let p = pathCache.get(s);
  if (p) {
    pathCache.delete(s);
    pathCache.set(s, p);
    return p;
  }
  p = outlineToPath(strokeOutline(s, true));
  pathCache.set(s, p);
  if (pathCache.size > PATH_CACHE_MAX) {
    const first = pathCache.keys().next().value;
    if (first) pathCache.delete(first);
  }
  return p;
}

// ---------- Texture du crayon ----------

const grainCanvases = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
const patternCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

/** Bruit pseudo-aléatoire déterministe (même texture à chaque rendu). */
function grain(color: string): HTMLCanvasElement | OffscreenCanvas {
  let c = grainCanvases.get(color);
  if (c) return c;
  const size = 96;
  const cv: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const img = g.createImageData(size, size);
  const r = parseInt(color.slice(1, 3), 16);
  const gg = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  let seed = 1234567;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < size * size; i++) {
    const v = rand();
    const a = v < 0.18 ? 0 : v < 0.45 ? 0.45 + rand() * 0.3 : 0.8 + rand() * 0.2;
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = gg;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  grainCanvases.set(color, cv);
  c = cv;
  return c;
}

function pencilPattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | string {
  let m = patternCache.get(ctx);
  if (!m) {
    m = new Map();
    patternCache.set(ctx, m);
  }
  let pat = m.get(color);
  if (!pat) {
    const p = ctx.createPattern(grain(color) as CanvasImageSource, 'repeat');
    if (!p) return color;
    // Grain fin : un « pixel » de bruit = 0,5 unité page.
    if (typeof DOMMatrix !== 'undefined' && p.setTransform) p.setTransform(new DOMMatrix().scale(0.5));
    pat = p;
    m.set(color, pat);
  }
  return pat;
}

// ---------- Remplissage ----------

export function fillOutline(ctx: CanvasRenderingContext2D, tool: InkTool, color: string, path: Path2D): void {
  if (tool === 'highlighter') {
    ctx.globalAlpha = HIGHLIGHTER_ALPHA;
    ctx.fillStyle = color;
    ctx.fill(path);
    ctx.globalAlpha = 1;
  } else if (tool === 'pencil') {
    ctx.globalAlpha = PENCIL_ALPHA;
    ctx.fillStyle = pencilPattern(ctx, color);
    ctx.fill(path);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = color;
    ctx.fill(path);
  }
}

export function fillStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  fillOutline(ctx, s.tool, s.color, strokePath(s));
}

/** Dessine une liste de traits : surligneurs d'abord (sous l'encre), puis les autres. */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Iterable<Stroke>, layer: 'all' | 'under' | 'over' = 'all'): void {
  if (layer !== 'over') for (const s of strokes) if (s.tool === 'highlighter') fillStroke(ctx, s);
  if (layer !== 'under') for (const s of strokes) if (s.tool !== 'highlighter') fillStroke(ctx, s);
}

/** Halo de sélection autour d'un trait (dessiné sous le trait). */
export function haloStroke(ctx: CanvasRenderingContext2D, s: Stroke, scale: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(47, 110, 220, 0.45)';
  ctx.lineWidth = 6 / scale;
  ctx.lineJoin = 'round';
  ctx.stroke(strokePath(s));
  ctx.restore();
}

/** Aperçu d'un outil : courbe en S avec pression variable (même moteur de rendu que la page). */
export function previewPoints(w: number, h: number, withPressure = true): Float32Array {
  const pts: number[] = [];
  const n = 60;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = 12 + t * (w - 24);
    const y = h / 2 + Math.sin(t * Math.PI * 2) * (h * 0.28);
    const p = withPressure ? 0.25 + 0.7 * Math.sin(t * Math.PI) : 0.5;
    pts.push(x, y, p, i * 8, 0);
  }
  return Float32Array.from(pts);
}
