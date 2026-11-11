import { describe, expect, it } from 'vitest';
import { Viewport } from '../../src/ink/viewport';

describe('Viewport', () => {
  it('convertit écran ↔ monde de façon réversible après zoom et déplacement', () => {
    const v = new Viewport();
    v.width = 800;
    v.height = 600;
    v.zoomAt(200, 150, 2.5);
    v.pan(-37, 12);
    v.zoomAt(500, 400, 0.6);
    for (const [sx, sy] of [[0, 0], [123.4, 567.8], [800, 600]]) {
      const [wx, wy] = v.toWorld(sx, sy);
      const [bx, by] = v.toScreen(wx, wy);
      expect(bx).toBeCloseTo(sx, 6);
      expect(by).toBeCloseTo(sy, 6);
    }
  });

  it('garde fixe le point sous les doigts pendant le zoom', () => {
    const v = new Viewport();
    v.width = 800;
    v.height = 600;
    v.tx = 50;
    v.ty = -30;
    const before = v.toWorld(321, 222);
    v.zoomAt(321, 222, 3);
    const after = v.toWorld(321, 222);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it('respecte les bornes de zoom', () => {
    const v = new Viewport();
    v.zoomAt(0, 0, 1000);
    expect(v.scale).toBe(v.maxScale);
    v.zoomAt(0, 0, 0.00001);
    expect(v.scale).toBe(v.minScale);
  });

  it('borne le déplacement pour garder le contenu atteignable', () => {
    const v = new Viewport();
    v.width = 800;
    v.height = 600;
    v.scale = 1;
    v.ty = 99999;
    v.clamp([-400, 0, 400, 3000], 24);
    expect(v.ty).toBe(24); // haut du contenu à la marge
    v.ty = -99999;
    v.clamp([-400, 0, 400, 3000], 24);
    expect(v.ty).toBe(600 - 24 - 3000);
  });
});
