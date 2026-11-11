import { getStroke } from 'perfect-freehand';
import { POINT_STRIDE, type PointBuffer, type Stroke, type StrokeStyle, type InkTool } from '../model/types';

/** Opacité du surligneur. */
export const HIGHLIGHTER_ALPHA = 0.32;

interface OutlineInput {
  tool: InkTool;
  width: number;
  style: StrokeStyle;
  points: PointBuffer;
}

/** Pression effective : pression matérielle éventuellement renforcée par l'inclinaison. */
function effectivePressure(p: number, tilt: number, style: StrokeStyle): number {
  const v = p + style.tilt * tilt * 0.6;
  return v < 0.05 ? 0.05 : v > 1 ? 1 : v;
}

/**
 * Calcule le contour (polygone) d'un trait.
 * `complete` = false pendant le tracé : l'extrémité n'est pas « fermée »,
 * ce qui évite un effet de goutte à la pointe du stylet.
 */
export function strokeOutline(s: OutlineInput, complete: boolean): number[][] {
  const pts: number[][] = [];
  const p = s.points;
  for (let i = 0; i < p.length; i += POINT_STRIDE) {
    pts.push([p[i], p[i + 1], effectivePressure(p[i + 2], p[i + 4], s.style)]);
  }
  const hl = s.tool === 'highlighter';
  return getStroke(pts, {
    size: s.width,
    thinning: hl ? 0 : s.style.thinning,
    smoothing: 0.5,
    streamline: s.style.streamline,
    simulatePressure: !hl && !s.style.realPressure,
    last: complete,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
  });
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

/** Format SVG équivalent (utilisé pour l'export et les tests). */
export function outlineToSvgPath(outline: number[][]): string {
  const n = outline.length;
  if (n < 3) return '';
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = `M${f(outline[0][0])} ${f(outline[0][1])}`;
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    d += `Q${f(a[0])} ${f(a[1])} ${f((a[0] + b[0]) / 2)} ${f((a[1] + b[1]) / 2)}`;
  }
  return d + 'Z';
}

/** Cache des chemins : un trait est immuable (toute modification crée un nouvel objet). */
const pathCache = new WeakMap<Stroke, Path2D>();

export function strokePath(s: Stroke): Path2D {
  let p = pathCache.get(s);
  if (!p) {
    p = outlineToPath(strokeOutline(s, true));
    pathCache.set(s, p);
  }
  return p;
}

export function fillStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  ctx.fillStyle = s.color;
  if (s.tool === 'highlighter') {
    ctx.globalAlpha = HIGHLIGHTER_ALPHA;
    ctx.fill(strokePath(s));
    ctx.globalAlpha = 1;
  } else {
    ctx.fill(strokePath(s));
  }
}

/** Dessine une liste de traits : surligneurs d'abord (sous l'encre), puis stylo. */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Iterable<Stroke>): void {
  const pens: Stroke[] = [];
  for (const s of strokes) {
    if (s.tool === 'highlighter') fillStroke(ctx, s);
    else pens.push(s);
  }
  for (const s of pens) fillStroke(ctx, s);
}
