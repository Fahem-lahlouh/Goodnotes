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

  it('écriture réaliste à 240 Hz (ralentissement dans les angles) : angles conservés à 0,3 unité près', () => {
    // Zigzag de « lettres » de 20 unités (≈ 5 mm), 90 ms par segment, profil minimum jerk.
    const corners: [number, number][] = Array.from({ length: 7 }, (_, i) => [i * 14, i % 2 ? 14 : 0]);
    const f = new OneEuro2D(filterParams(0.35, 'pen'));
    const out: [number, number][] = [];
    let t = 0;
    for (let s = 0; s < corners.length - 1; s++) {
      const per = Math.round(0.09 * 240);
      for (let k = s ? 1 : 0; k <= per; k++) {
        const u = k / per;
        const e = 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5;
        out.push(f.filter(corners[s][0] + (corners[s + 1][0] - corners[s][0]) * e, corners[s][1] + (corners[s + 1][1] - corners[s][1]) * e, t));
        t += 1000 / 240;
      }
    }
    const seg = (p: [number, number], a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(a[0] + u * dx - p[0], a[1] + u * dy - p[1]);
    };
    for (const c of corners.slice(0, -1)) {
      let d = Infinity;
      for (let i = 1; i < out.length; i++) d = Math.min(d, seg(c, out[i - 1], out[i]));
      expect(d).toBeLessThan(0.3);
    }
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
