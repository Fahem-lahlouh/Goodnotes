import { describe, expect, it } from 'vitest';
import { areaFromPolygon, areaFromRect, itemSelected, squareFrom, strokeSelected } from '../../src/ink/selection';
import type { TextItem } from '../../src/model/types';
import { makeStroke } from './helpers';

const square = areaFromRect(0, 0, 100, 100);

describe('règles de sélection', () => {
  it('« entièrement inclus » : tous les points du tracé dans la zone', () => {
    expect(strokeSelected(makeStroke('p', [[10, 10], [90, 90]]), square, 'inside')).toBe(true);
    expect(strokeSelected(makeStroke('p', [[10, 10], [150, 90]]), square, 'inside')).toBe(false);
  });

  it('« touchés » : un segment qui traverse la zone sans point intérieur est sélectionné', () => {
    const crossing = makeStroke('p', [[-50, 50], [150, 50]]);
    expect(strokeSelected(crossing, square, 'contact')).toBe(true);
    expect(strokeSelected(crossing, square, 'inside')).toBe(false);
  });

  it('la boîte englobante seule ne suffit jamais (long trait diagonal voisin)', () => {
    // Boîte englobante qui recouvre la zone, tracé qui passe à côté.
    const diag = makeStroke('p', [[-200, 300], [300, -200]].map(([x, y]) => [x + 150, y + 150]) as [number, number][]);
    const small = areaFromRect(0, 0, 40, 40);
    expect(strokeSelected(diag, small, 'contact')).toBe(false);
  });

  it('la vitesse de tracé n’influence plus la décision (indépendant du nombre de points)', () => {
    const slowInside: [number, number][] = Array.from({ length: 40 }, (_, i) => [10 + i, 50]);
    const fastOutside: [number, number][] = [[200, 50], [400, 50]];
    const s = makeStroke('p', [...slowInside, ...fastOutside]);
    expect(strokeSelected(s, square, 'inside')).toBe(false);
    expect(strokeSelected(s, square, 'contact')).toBe(true);
  });

  it('lasso libre concave', () => {
    // Forme en U : un trait dans le creux du U n'est pas dans la zone.
    const u = areaFromPolygon([0, 0, 30, 0, 30, 70, 70, 70, 70, 0, 100, 0, 100, 100, 0, 100]);
    expect(strokeSelected(makeStroke('p', [[45, 10], [55, 30]]), u, 'contact')).toBe(false);
    expect(strokeSelected(makeStroke('p', [[10, 80], [90, 90]]), u, 'inside')).toBe(true);
  });

  it('blocs de texte et images : mêmes règles sur leur rectangle', () => {
    const t = { kind: 'text', x: 80, y: 80, w: 50, h: 20 } as TextItem;
    expect(itemSelected(t, square, 'contact')).toBe(true);
    expect(itemSelected(t, square, 'inside')).toBe(false);
    expect(itemSelected({ ...t, x: 10, y: 10 }, square, 'inside')).toBe(true);
  });

  it('carré : le côté suit la plus grande distance, dans la direction du geste', () => {
    expect(squareFrom(0, 0, 150, 50)).toEqual([150, 150]);
    expect(squareFrom(100, 100, 40, 90)).toEqual([40, 40]);
  });
});
