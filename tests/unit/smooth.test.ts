import { describe, expect, it } from 'vitest';
import { OneEuro2D, filterParams } from '../../src/ink/filter';
import { strokeOutline } from '../../src/ink/strokeRender';
import { DEFAULT_SETTINGS, strokeStyleFrom } from '../../src/ink/settings';
import { smoothForRender } from '../../src/ink/smooth';

/**
 * Rendu lisse : les coordonnées arrondies au pixel (Safari) ne doivent plus produire de bord
 * granuleux, sans déformer l'écriture (boucles, angles, pression) ni toucher aux extrémités.
 */

type Shape = { kind: 'line' | 'circle'; L: number; f: (s: number) => [number, number]; ang?: number; R?: number };
const line = (deg: number): Shape => {
  const a = (deg * Math.PI) / 180;
  return { kind: 'line', ang: a, L: 200, f: (s) => [100 + s * Math.cos(a), 200 + s * Math.sin(a)] };
};
const circle = (R: number): Shape => ({ kind: 'circle', R, L: 2 * Math.PI * R, f: (s) => [200 + R * Math.cos(s / R), 200 + R * Math.sin(s / R)] });

/** Saisie à 240 Hz (comme l'Apple Pencil), arrondie au pixel si `rounded`, puis filtre de saisie du moteur. */
function captured(sh: Shape, speed: number, rounded: boolean): number[] {
  const f = new OneEuro2D(filterParams(0.35, 'pen'));
  const out: number[] = [];
  const T = (sh.L / speed) * 1000;
  for (let t = 0; t <= T + 1e-9; t += 1000 / 240) {
    let [x, y] = sh.f(Math.min(sh.L, (t / T) * sh.L));
    if (rounded) {
      x = Math.round(x);
      y = Math.round(y);
    }
    const [fx, fy] = f.filter(x, y, t);
    const n = out.length;
    if (n && Math.abs(out[n - 5] - fx) < 1e-3 && Math.abs(out[n - 4] - fy) < 1e-3) continue;
    out.push(fx, fy, 0.5, t, 0);
  }
  return out;
}

/** Irrégularité du bord : écart du contour (courbes du rendu) à la forme idéale, sur le corps du trait. */
function edgeRoughness(sh: Shape, data: number[], res: number): { rms: number; max: number } {
  const style = strokeStyleFrom('pen', DEFAULT_SETTINGS, 0.35, true);
  style.res = res;
  const o = strokeOutline({ tool: 'pen', width: 2.2, style, points: data }, true);
  const devs: number[] = [];
  const n = o.length;
  for (let i = 0; i < n; i++) {
    const a = o[i];
    const b = o[(i + 1) % n];
    const p = o[(i - 1 + n) % n];
    const s0 = [(p[0] + a[0]) / 2, (p[1] + a[1]) / 2];
    const e = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const x = (1 - t) ** 2 * s0[0] + 2 * (1 - t) * t * a[0] + t * t * e[0];
      const y = (1 - t) ** 2 * s0[1] + 2 * (1 - t) * t * a[1] + t * t * e[1];
      if (sh.kind === 'line') {
        const s = (x - 100) * Math.cos(sh.ang!) + (y - 200) * Math.sin(sh.ang!);
        if (s < 20 || s > 180) continue;
        devs.push(Math.abs(-(x - 100) * Math.sin(sh.ang!) + (y - 200) * Math.cos(sh.ang!)) - 1.1);
      } else {
        if (Math.abs(Math.atan2(y - 200, x - 200)) < 0.6) continue; // extrémités
        const r = Math.hypot(x - 200, y - 200);
        devs.push(Math.min(Math.abs(r - (sh.R! + 1.1)), Math.abs(r - (sh.R! - 1.1))));
      }
    }
  }
  const m = devs.reduce((s, v) => s + v, 0) / devs.length;
  return { rms: Math.sqrt(devs.reduce((s, v) => s + (v - m) ** 2, 0) / devs.length), max: Math.max(...devs.map((v) => Math.abs(v - m))) };
}

describe('Rendu lisse (coordonnées arrondies au pixel)', () => {
  it('droite lente arrondie au pixel : bord granuleux sans lissage, régulier avec', () => {
    const d = captured(line(10), 60, true);
    const before = edgeRoughness(line(10), d, 0);
    const after = edgeRoughness(line(10), d, 1);
    expect(before.max).toBeGreaterThan(0.4); // défaut reproduit
    expect(after.rms).toBeLessThan(before.rms / 2.5);
    expect(after.max).toBeLessThan(0.2);
  });

  it('cercle arrondi au pixel, plusieurs vitesses : bord nettement plus régulier', () => {
    for (const v of [60, 150]) {
      const d = captured(circle(15), v, true);
      const before = edgeRoughness(circle(15), d, 0);
      const after = edgeRoughness(circle(15), d, 1);
      expect(after.rms).toBeLessThan(before.rms * 0.6);
      expect(after.max).toBeLessThan(0.15);
    }
  });

  it('coordonnées précises (décimales) : tracé pratiquement inchangé', () => {
    const d = captured(circle(15), 150, false);
    const o = smoothForRender(d, 0.35);
    let worst = 0;
    for (let i = 0; i < o.length; i += 5) worst = Math.max(worst, Math.abs(Math.hypot(o[i] - 200, o[i + 1] - 200) - 15));
    expect(worst).toBeLessThan(0.15);
    expect(edgeRoughness(circle(15), d, 0.35).max).toBeLessThan(0.05);
  });

  it('forme préservée : petite boucle de lettre (rayon 4) et angle vif', () => {
    const d = captured(circle(4), 60, true);
    const o = smoothForRender(d, 1);
    let sum = 0;
    let n = 0;
    for (let i = Math.floor(o.length / 5 * 0.1) * 5; i < o.length * 0.9; i += 5) {
      sum += Math.abs(Math.hypot(o[i] - 200, o[i + 1] - 200) - 4);
      n++;
    }
    expect(sum / n).toBeLessThan(0.1);
    // Angle de 60° : le sommet ne s'arrondit pas de plus d'un demi-pixel de saisie.
    const pts: number[] = [];
    const a = Math.PI / 3;
    for (let s = 0; s <= 30; s += 0.5) pts.push(100 + s, 200, 0.5, s, 0);
    for (let s = 0.5; s <= 30; s += 0.5) pts.push(130 - s * Math.cos(a), 200 + s * Math.sin(a), 0.5, 30 + s, 0);
    for (const res of [1, 0.4]) {
      const c = smoothForRender(pts, res);
      let best = Infinity;
      for (let i = 0; i < c.length; i += 5) best = Math.min(best, Math.hypot(c[i] - 130, c[i + 1] - 200));
      expect(best).toBeLessThan(0.5 * res);
    }
  });

  it('extrémités exactes (pas de retard sous la pointe) et pression conservée', () => {
    const pts: number[] = [];
    for (let s = 0; s <= 100; s += 0.4) pts.push(100 + s, 200 + Math.round(Math.sin(s / 9) * 6), 0.5 + 0.3 * Math.sin(s / 6), s, 0);
    const o = smoothForRender(pts, 1);
    expect(o.slice(0, 2)).toEqual(pts.slice(0, 2));
    expect(o.slice(-5, -3)).toEqual(pts.slice(-5, -3));
    let mx = 0;
    let mn = 1;
    for (let i = 2; i < o.length; i += 5) {
      mx = Math.max(mx, o[i]);
      mn = Math.min(mn, o[i]);
    }
    expect(mx - mn).toBeGreaterThan(0.55); // amplitude d'entrée 0,6
  });

  it('formes nettes (res 0) non modifiées ; coût borné', () => {
    const pts = [0, 0, 0.5, 0, 0, 10, 0, 0.5, 4, 0, 10, 10, 0.5, 8, 0];
    expect(smoothForRender(pts, 0)).toEqual(pts);
    const big: number[] = [];
    for (let i = 0; i < 6000; i++) big.push(100 + i * 0.2, 200 + Math.round(Math.sin(i / 50) * 20), 0.5, i * 4, 0);
    const t0 = performance.now();
    const o = smoothForRender(big, 1);
    expect(performance.now() - t0).toBeLessThan(60);
    expect(o.length / 5).toBeLessThanOrEqual(4002);
  });
});
