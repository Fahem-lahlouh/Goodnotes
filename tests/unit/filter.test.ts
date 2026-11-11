import { getStroke } from 'perfect-freehand';
import { describe, expect, it } from 'vitest';
import { OneEuro2D, PressureSmoother, filterParams } from '../../src/ink/filter';

/** Mouvement rectiligne à vitesse constante (unités page/s), échantillonné à `hz`. */
function motion(speed: number, hz: number, durMs: number): { x: number; y: number; t: number }[] {
  const out = [];
  for (let t = 0; t <= durMs; t += 1000 / hz) out.push({ x: 100 + (speed * t) / 1000, y: 200, t });
  return out;
}

/** Pseudo-aléatoire reproductible. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('Filtre One Euro du tracé', () => {
  it('un point immobile reste exactement en place', () => {
    const f = new OneEuro2D(filterParams(0.4, 'pen'));
    let r: [number, number] = [0, 0];
    for (let i = 0; i < 50; i++) r = f.filter(50, 60, i * 4);
    expect(r[0]).toBeCloseTo(50, 6);
    expect(r[1]).toBeCloseTo(60, 6);
  });

  it('geste rapide : retard très faible, et indépendant de la fréquence des événements', () => {
    const lag = (hz: number) => {
      const f = new OneEuro2D(filterParams(0.35, 'pen'));
      const pts = motion(1500, hz, 300);
      let out: [number, number] = [0, 0];
      for (const p of pts) out = f.filter(p.x, p.y, p.t);
      return pts[pts.length - 1].x - out[0];
    };
    const at60 = lag(60);
    const at240 = lag(240);
    expect(at60).toBeLessThan(3);
    expect(at240).toBeLessThan(3);
    expect(Math.abs(at60 - at240)).toBeLessThan(1.5);
  });

  it('ancien lissage (streamline) : retard bien plus grand, et dépendant de la fréquence', () => {
    // Référence mesurée : perfect-freehand avec streamline 0,5 (ancien réglage par défaut).
    const lag = (hz: number) => {
      const pts = motion(1500, hz, 300).map((p) => [p.x, p.y, 0.5]);
      const sp = getStroke(pts, { size: 2, streamline: 0.5, last: false });
      let maxX = -Infinity;
      for (const [x] of sp) maxX = Math.max(maxX, x);
      return pts[pts.length - 1][0] - maxX;
    };
    const f = new OneEuro2D(filterParams(0.35, 'pen'));
    let out: [number, number] = [0, 0];
    const pts = motion(1500, 60, 300);
    for (const p of pts) out = f.filter(p.x, p.y, p.t);
    const oneEuro = pts[pts.length - 1].x - out[0];
    expect(lag(60)).toBeGreaterThan(oneEuro * 3);
  });

  it('geste lent avec tremblement : le bruit est nettement réduit', () => {
    const rand = rng(7);
    const f = new OneEuro2D(filterParams(0.35, 'pen'));
    let rawErr = 0;
    let filtErr = 0;
    let n = 0;
    for (let t = 0; t <= 2000; t += 1000 / 120) {
      const trueY = 200;
      const noisyY = trueY + (rand() - 0.5) * 2; // ±1 unité de tremblement
      const [, fy] = f.filter(100 + t * 0.03, noisyY, t);
      if (t > 100) {
        rawErr += Math.abs(noisyY - trueY);
        filtErr += Math.abs(fy - trueY);
        n++;
      }
    }
    expect(filtErr / n).toBeLessThan((rawErr / n) * 0.6);
  });

  it('lissage plus fort au doigt qu’au stylet, pour un même réglage', () => {
    const pen = filterParams(0.3, 'pen');
    const touch = filterParams(0.3, 'touch');
    expect(touch.minCutoff).toBeLessThan(pen.minCutoff);
    expect(filterParams(0, 'pen').minCutoff).toBeGreaterThan(filterParams(1, 'pen').minCutoff);
  });

  it('événements de même horodatage (fusionnés) : pas de division par zéro', () => {
    const f = new OneEuro2D(filterParams(0.35, 'pen'));
    f.filter(0, 0, 10);
    const [x, y] = f.filter(5, 5, 10);
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
  });

  it('pression lissée sans retard initial', () => {
    const p = new PressureSmoother();
    expect(p.next(0.8)).toBeCloseTo(0.8);
    const v = p.next(0.2);
    expect(v).toBeGreaterThan(0.2);
    expect(v).toBeLessThan(0.8);
  });
});
