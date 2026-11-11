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
