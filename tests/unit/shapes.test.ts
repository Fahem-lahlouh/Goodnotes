import { describe, expect, it } from 'vitest';
import { meanPressure, recognizeShape, shapeLabel, shapePoints } from '../../src/ink/shapes';

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Tracé « à la main » (léger tremblement) à partir d'une fonction paramétrique. */
function hand(f: (t: number) => [number, number], n = 80, jitter = 1.5, seed = 1): number[] {
  const r = rng(seed);
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const [x, y] = f(i / n);
    out.push(x + (r() - 0.5) * jitter * 2, y + (r() - 0.5) * jitter * 2, 0.5, i * 8, 0);
  }
  return out;
}

function polyline(pts: [number, number][], per = 20): (t: number) => [number, number] {
  return (t) => {
    const seg = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
    const u = t * (pts.length - 1) - seg;
    const [a, b] = [pts[seg], pts[seg + 1]];
    void per;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  };
}

describe('Reconnaissance de formes nettes', () => {
  it('droite tremblée → droite entre le premier et le dernier point', () => {
    const s = recognizeShape(hand((t) => [100 + t * 300, 200 + t * 40]));
    expect(s?.kind).toBe('line');
    if (s?.kind !== 'line') return;
    expect(s.ax).toBeCloseTo(100, -1);
    expect(s.bx).toBeCloseTo(400, -1);
    expect(shapeLabel(s)).toBe('Droite');
  });

  it('cercle tremblé → cercle', () => {
    const s = recognizeShape(hand((t) => [300 + 80 * Math.cos(t * Math.PI * 2), 300 + 80 * Math.sin(t * Math.PI * 2)], 120, 2));
    expect(s?.kind).toBe('ellipse');
    if (s?.kind !== 'ellipse') return;
    expect(s.circle).toBe(true);
    expect(s.rx).toBeGreaterThan(70);
    expect(s.rx).toBeLessThan(90);
    expect(shapeLabel(s)).toBe('Cercle');
  });

  it('ellipse aplatie → ellipse (pas cercle)', () => {
    const s = recognizeShape(hand((t) => [300 + 140 * Math.cos(t * Math.PI * 2), 300 + 60 * Math.sin(t * Math.PI * 2)], 140, 2));
    expect(s?.kind).toBe('ellipse');
    expect(s && shapeLabel(s)).toBe('Ellipse');
  });

  it('rectangle → rectangle aligné, coins aux bons endroits', () => {
    const s = recognizeShape(hand(polyline([[100, 100], [400, 102], [398, 300], [101, 298], [102, 104]]), 160, 1.5));
    expect(s?.kind).toBe('rect');
    if (s?.kind !== 'rect') return;
    const xs = s.corners.map((c) => c[0]);
    const ys = s.corners.map((c) => c[1]);
    expect(Math.min(...xs)).toBeCloseTo(100, -1);
    expect(Math.max(...xs)).toBeCloseTo(400, -1);
    expect(Math.min(...ys)).toBeCloseTo(100, -1);
    expect(Math.max(...ys)).toBeCloseTo(300, -1);
    // Aligné sur les axes : deux valeurs de x seulement.
    expect(new Set(xs.map((x) => Math.round(x))).size).toBe(2);
  });

  it('rectangle incliné → rectangle incliné (angles droits)', () => {
    const a = (30 * Math.PI) / 180;
    const rot = (x: number, y: number): [number, number] => [300 + x * Math.cos(a) - y * Math.sin(a), 300 + x * Math.sin(a) + y * Math.cos(a)];
    const s = recognizeShape(hand(polyline([rot(-150, -80), rot(150, -80), rot(150, 80), rot(-150, 80), rot(-148, -78)]), 160, 1));
    expect(s?.kind).toBe('rect');
    if (s?.kind !== 'rect') return;
    const [p0, p1, p2] = s.corners;
    const dot = (p1[0] - p0[0]) * (p2[0] - p1[0]) + (p1[1] - p0[1]) * (p2[1] - p1[1]);
    expect(Math.abs(dot)).toBeLessThan(1);
  });

  it('écriture, zigzag, arc ouvert et point → aucune forme', () => {
    const word = hand((t) => [100 + t * 200, 200 + 20 * Math.sin(t * 40)], 200, 0.5);
    expect(recognizeShape(word)).toBeNull();
    const zig = hand(polyline([[0, 0], [40, 60], [80, 0], [120, 60], [160, 0]]), 80, 0.5);
    expect(recognizeShape(zig)).toBeNull();
    const arc = hand((t) => [300 + 80 * Math.cos(t * Math.PI * 1.4), 300 + 80 * Math.sin(t * Math.PI * 1.4)], 80, 0.5);
    expect(recognizeShape(arc)).toBeNull();
    expect(recognizeShape([10, 10, 0.5, 0, 0, 11, 10, 0.5, 8, 0])).toBeNull();
  });

  it('points de la forme : 5 valeurs par point, pression constante, droite exacte', () => {
    const pts = shapePoints({ kind: 'line', ax: 0, ay: 0, bx: 30, by: 0 }, 0.7);
    expect(pts.length % 5).toBe(0);
    expect(pts[0]).toBe(0);
    expect(pts[pts.length - 5]).toBe(30);
    for (let i = 1; i < pts.length; i += 5) expect(pts[i]).toBe(0);
    expect(meanPressure(pts)).toBeCloseTo(0.7);
    const circle = shapePoints({ kind: 'ellipse', cx: 0, cy: 0, rx: 50, ry: 50, circle: true }, 0.5);
    for (let i = 0; i < circle.length; i += 5) expect(Math.hypot(circle[i], circle[i + 1])).toBeCloseTo(50, 5);
  });
});
