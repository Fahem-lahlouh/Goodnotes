import { describe, expect, it } from 'vitest';
import {
  computeBBox,
  densify,
  eraseFromPoints,
  pointCount,
  pointInPolygon,
  strokeHitsCircle,
  strokeInLasso,
  transformPoints,
} from '../../src/ink/geometry';
import { makeStroke } from './helpers';

describe('géométrie', () => {
  it('bbox avec marge', () => {
    const s = makeStroke('p', [[10, 20], [30, 5]]);
    expect(computeBBox(s.points, 1)).toEqual([9, 4, 31, 21]);
  });

  it('densifie en interpolant tous les attributs', () => {
    const s = makeStroke('p', [[0, 0], [10, 0]]);
    const d = densify(s.points, 2);
    expect(pointCount(d)).toBe(6);
    expect(d[5]).toBeCloseTo(2); // x du 2e point
    expect(d[5 + 3]).toBeCloseTo(1.6); // t interpolé (0 → 8)
  });

  it('détecte le contact gomme / trait en tenant compte de l’épaisseur', () => {
    const s = makeStroke('p', [[0, 0], [100, 0]], { width: 10 });
    expect(strokeHitsCircle(s, 50, 7, 3)).toBe(true); // 7 ≤ 3 + 5
    expect(strokeHitsCircle(s, 50, 9, 3)).toBe(false);
  });

  it('gomme partielle : coupe un trait en deux morceaux', () => {
    const s = makeStroke('p', [[0, 0], [100, 0]], { width: 2 });
    const pieces = eraseFromPoints(s.points, s.width, 50, 0, 5)!;
    expect(pieces).toHaveLength(2);
    const lastXFirst = pieces[0][(pointCount(pieces[0]) - 1) * 5];
    const firstXSecond = pieces[1][0];
    expect(lastXFirst).toBeLessThan(44);
    expect(firstXSecond).toBeGreaterThan(56);
    expect(pieces[0][0]).toBe(0);
    expect(pieces[1][(pointCount(pieces[1]) - 1) * 5]).toBe(100);
  });

  it('gomme partielle : renvoie null si non touché, [] si entièrement effacé', () => {
    const s = makeStroke('p', [[0, 0], [4, 0]]);
    expect(eraseFromPoints(s.points, 2, 50, 50, 5)).toBeNull();
    expect(eraseFromPoints(s.points, 2, 2, 0, 10)).toEqual([]);
  });

  it('lasso : point dans polygone et sélection majoritaire', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
    const inside = makeStroke('p', [[2, 2], [8, 8]]);
    const half = makeStroke('p', [[5, 5], [20, 20], [30, 30]]);
    expect(strokeInLasso(inside, square)).toBe(true);
    expect(strokeInLasso(half, square)).toBe(false);
  });

  it('transforme les points (échelle + translation) sans toucher pression/temps', () => {
    const s = makeStroke('p', [[10, 10], [20, 30]]);
    const t = transformPoints(s.points, 2, 5, -5);
    expect(Array.from(t.slice(0, 5))).toEqual([25, 15, 0.5, 0, 0]);
    expect(t[5]).toBe(45);
    expect(t[6]).toBe(55);
    expect(t[8]).toBe(8);
  });
});
