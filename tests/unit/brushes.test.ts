import { describe, expect, it } from 'vitest';
import { strokeOutline } from '../../src/ink/strokeRender';
import { strokeStyleFrom, DEFAULT_SETTINGS } from '../../src/ink/settings';
import type { InkTool } from '../../src/model/types';

type Dir = 'h' | 'v' | 'down' | 'up';
/** Repère écran : y vers le bas. 'down' = vers le bas à droite (parallèle au bec à 45°), 'up' = vers le haut à droite. */
function pts(dir: Dir): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < 30; i++) {
    const x = dir === 'v' ? 100 : 100 + i * 4;
    const y = dir === 'h' ? 100 : 100 + i * 4 * (dir === 'up' ? -1 : 1);
    out.push(x, y, 0.5, i * 8, 0);
  }
  return Float32Array.from(out);
}

/** Largeur moyenne approximative : aire du polygone / longueur du tracé. */
function width(tool: InkTool, dir: Dir): number {
  const o = strokeOutline({ tool, width: 6, style: strokeStyleFrom(tool, DEFAULT_SETTINGS, 0.3, true), points: pts(dir) }, true);
  let a = 0;
  for (let i = 0; i < o.length; i++) {
    const [x1, y1] = o[i];
    const [x2, y2] = o[(i + 1) % o.length];
    a += x1 * y2 - x2 * y1;
  }
  const len = dir === 'down' || dir === 'up' ? Math.hypot(116, 116) : 116;
  return Math.abs(a) / 2 / len;
}

describe('outils d’écriture', () => {
  it('plume : épaisseur selon la direction (plein / délié), bille : constante', () => {
    const thin = width('fountain', 'down'); // parallèle au bec → délié
    const thick = width('fountain', 'up'); // perpendiculaire au bec → plein
    expect(thick / thin).toBeGreaterThan(1.8);
    expect(width('fountain', 'h')).toBeGreaterThan(thin);
    const bh = width('pen', 'h');
    const bd = width('pen', 'down');
    expect(Math.abs(bh - bd) / bh).toBeLessThan(0.15);
  });

  it('chaque outil fige ses propres paramètres de rendu', () => {
    const s = DEFAULT_SETTINGS;
    expect(strokeStyleFrom('pen', s, 0.4, true).thinning).toBeLessThan(strokeStyleFrom('brush', s, 0.4, true).thinning);
    expect(strokeStyleFrom('highlighter', s, 0.4, true).thinning).toBe(0);
    expect(strokeStyleFrom('fountain', s, 0.4, true).nibAngle).toBeCloseTo(Math.PI / 4);
  });
});

describe('Fin de trait avec petit crochet', () => {
  it('le contour couvre toute la fin du trait (pas d’étranglement ni de « point » détaché)', () => {
    // Fin réelle d'un mot : descente, rebroussement, puis remontée de ~2 unités.
    const tail = [[160, 95], [163.3, 99.5], [166.61, 104.17], [167.71, 105.48], [168.9, 107.28], [170.14, 109.49], [171.44, 111.09], [172.68, 110.19], [173.38, 109.69], [173.46, 109.63]];
    const pts = Float32Array.from(tail.flatMap(([x, y], i) => [x, y, 0.5, i * 4, 0]));
    const o = strokeOutline({ tool: 'pen', width: 2.2, style: strokeStyleFrom('pen', DEFAULT_SETTINGS, 0.35, true), points: pts }, true);
    // Règle de remplissage « non nulle », comme ctx.fill() dans l'application.
    const inside = (x: number, y: number) => {
      let w = 0;
      for (let i = 0; i < o.length; i++) {
        const [ax, ay] = o[i];
        const [bx, by] = o[(i + 1) % o.length];
        const cross = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
        if (ay <= y && by > y && cross > 0) w++;
        else if (ay > y && by <= y && cross < 0) w--;
      }
      return w !== 0;
    };
    // Chaque point de la ligne centrale est couvert par l'encre, avec un disque de 0,4 unité autour
    // (épaisseur 2,2) : pas d'étranglement ni de « point » détaché en fin de trait.
    for (const [x, y] of tail) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        expect(inside(x + 0.4 * Math.cos(a), y + 0.4 * Math.sin(a)), `${x},${y} @${k}`).toBe(true);
      }
    }
  });
});

describe('Notes repositionnables', () => {
  it('hauteur au moins égale à 80 % de la largeur, marge intérieure plus grande', async () => {
    const { textHeight, textPad, TEXT_PAD, NOTE_PAD } = await import('../../src/ink/items');
    const base = { text: 'Court', font: 'sans' as const, size: 16, bold: false, italic: false, w: 200 };
    expect(textHeight({ ...base, note: '#fde68a' })).toBeGreaterThanOrEqual(160);
    expect(textHeight(base)).toBeLessThan(60);
    expect(textPad({ note: '#fde68a' })).toBe(NOTE_PAD);
    expect(textPad({})).toBe(TEXT_PAD);
  });
});
