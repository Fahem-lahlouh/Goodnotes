import { expect, test, type Page } from '@playwright/test';
import {
  closePanel,
  createNotebook,
  distToPolyline,
  distToSegment,
  hostBox,
  lastStrokePoints,
  line,
  nextFrame,
  openToolPanel,
  penDown,
  penMove,
  penStroke,
  penUp,
  setPrefs,
  strokeCount,
  touchGesture,
} from './helpers';

/**
 * Écriture : précision du trait, nouveaux stylos, formes nettes, fiabilité de l'historique,
 * fenêtre de zoom, conversion manuscrit → texte.
 * Stylet simulé via le protocole Chromium : ne remplace pas un essai avec l'Apple Pencil.
 */

async function start(page: Page, title: string, settings: Record<string, unknown> = {}, template?: string) {
  await page.goto('./');
  await setPrefs(page, { penDetected: true, settings: { shapeHold: false, ...settings } });
  await page.reload();
  await createNotebook(page, title, template ? { template } : {});
}

const PEN = /Stylo à bille|Feutre fin|Plume|Pinceau|Crayon|Marqueur/;

/** Coordonnées page d'un point écran (absolu) de la page principale. */
async function toPage(page: Page, x: number, y: number): Promise<[number, number]> {
  const b = await hostBox(page);
  return page.evaluate(([sx, sy]) => {
    const r = window.__calame!.engine.screenToPage(sx, sy)!;
    return [r.x, r.y] as [number, number];
  }, [x - b.x, y - b.y]);
}

const undoBtn = (page: Page) => page.getByRole('button', { name: 'Annuler', exact: true });
const redoBtn = (page: Page) => page.getByRole('button', { name: 'Rétablir', exact: true });

test.describe('Précision et stylos @cdp', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Stylet piloté via le protocole Chromium');

  test('le trait passe par les points saisis (angles compris) et se termine exactement sous la pointe', async ({ page }) => {
    await start(page, 'Précision');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    // Zigzag d'écriture réaliste : 240 échantillons/s horodatés, le stylet ralentit dans les angles
    // (profil « minimum jerk »), 90 ms par segment de 100 px.
    const corners: [number, number][] = [
      [b.x + 120, b.y + 200],
      [b.x + 190, b.y + 270],
      [b.x + 260, b.y + 200],
      [b.x + 330, b.y + 270],
      [b.x + 400, b.y + 200],
    ];
    const t0 = Date.now() / 1000;
    const timed: [number, number, number][] = [];
    const per = Math.round(0.09 * 240);
    for (let s = 0; s < corners.length - 1; s++) {
      for (let k = s ? 1 : 0; k <= per; k++) {
        const u = k / per;
        const e = 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5;
        const [a, z] = [corners[s], corners[s + 1]];
        timed.push([a[0] + (z[0] - a[0]) * e, a[1] + (z[1] - a[1]) * e, t0 + timed.length / 240]);
      }
    }
    const base = { pointerType: 'pen' as const, button: 'left' as const, force: 0.5 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: timed[0][0], y: timed[0][1], buttons: 1, clickCount: 1, timestamp: timed[0][2], ...base });
    for (const [x, y, t] of timed.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1, timestamp: t, ...base });
    const last = timed[timed.length - 1];
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last[0], y: last[1], buttons: 0, clickCount: 1, timestamp: last[2] + 0.004, ...base });
    await nextFrame(page);
    const stored = await lastStrokePoints(page);
    const scale = await page.evaluate(() => window.__calame!.engine.vp.scale);
    const inputPage = await Promise.all(timed.map(([x, y]) => toPage(page, x, y)));
    // Chaque point saisi, angles compris, est à moins d'un demi-pixel écran du trait enregistré.
    let worst = 0;
    for (const p of inputPage) worst = Math.max(worst, distToPolyline(p, stored));
    expect(worst * scale).toBeLessThan(0.5);
    // Début et fin exacts (aucun retard résiduel en fin de trait).
    const first = inputPage[0];
    const end = inputPage[inputPage.length - 1];
    expect(Math.hypot(stored[0][0] - first[0], stored[0][1] - first[1]) * scale).toBeLessThan(0.3);
    expect(Math.hypot(stored[stored.length - 1][0] - end[0], stored[stored.length - 1][1] - end[1]) * scale).toBeLessThan(0.3);
  });

  test('geste très rapide (angles franchis à vitesse constante) : écart aux angles limité', async ({ page }) => {
    await start(page, 'Rapide');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    const corners: [number, number][] = [
      [b.x + 120, b.y + 200],
      [b.x + 220, b.y + 300],
      [b.x + 320, b.y + 200],
    ];
    const input: [number, number][] = [...line(...corners[0], ...corners[1], 20), ...line(...corners[1], ...corners[2], 20).slice(1)];
    await penStroke(page, cdp, input);
    const stored = await lastStrokePoints(page);
    const scale = await page.evaluate(() => window.__calame!.engine.vp.scale);
    let worst = 0;
    for (const [x, y] of input) worst = Math.max(worst, distToPolyline(await toPage(page, x, y), stored));
    // Cas extrême (aucun ralentissement dans l'angle) : quelques pixels au plus.
    expect(worst * scale).toBeLessThan(4);
  });

  test('le tracé affiché pendant l’écriture est identique au trait enregistré (pas de saut au lever)', async ({ page }) => {
    // Sans prédiction : elle prolonge volontairement l'encre affichée devant la pointe (jamais enregistrée).
    await start(page, 'Sans saut', { prediction: false }, 'Uni');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    const pts: [number, number][] = Array.from({ length: 60 }, (_, k) => [b.x + 150 + k * 5, b.y + 260 + 40 * Math.sin(k / 6)]);
    const region = { x: 120, y: 200, w: 360, h: 130 };
    const mask = (selector: string, mode: 'alpha' | 'dark') =>
      page.evaluate(
        ({ sel, r, m }) => {
          const c = document.querySelector(sel) as HTMLCanvasElement;
          const dpr = c.width / c.clientWidth;
          const img = c.getContext('2d')!.getImageData(Math.round(r.x * dpr), Math.round(r.y * dpr), Math.round(r.w * dpr), Math.round(r.h * dpr));
          const out: number[] = [];
          for (let i = 0; i < img.data.length; i += 4) {
            // Même seuil de couverture (≈ 59 %) : encre #1d2433 sur papier blanc → somme RVB < 384 ⇔ alpha > 150.
            const on = m === 'alpha' ? img.data[i + 3] > 150 : img.data[i] + img.data[i + 1] + img.data[i + 2] < 384;
            if (on) out.push(i / 4);
          }
          return out;
        },
        { sel: selector, r: region, m: mode },
      );
    await penDown(cdp, pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) await penMove(cdp, x, y);
    await nextFrame(page);
    const live = new Set(await mask('.ink-host:not(.zoom-host) .ink-live', 'alpha'));
    await penUp(cdp, pts[pts.length - 1][0], pts[pts.length - 1][1]);
    await nextFrame(page);
    const committed = new Set(await mask('.ink-host:not(.zoom-host) .ink-base', 'dark'));
    expect(live.size).toBeGreaterThan(200);
    let inter = 0;
    for (const i of live) if (committed.has(i)) inter++;
    const union = live.size + committed.size - inter;
    expect(inter / union, `recouvrement ${(inter / union).toFixed(3)} (live ${live.size}, enregistré ${committed.size})`).toBeGreaterThan(0.97);
  });

  test('six stylos aux rendus distincts : bille, feutre, plume, pinceau, crayon, marqueur', async ({ page }) => {
    await start(page, 'Six stylos', {}, 'Uni');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    const types = ['Bille', 'Feutre', 'Plume', 'Pinceau', 'Crayon', 'Marqueur'];
    for (let i = 0; i < types.length; i++) {
      await openToolPanel(page, PEN);
      await page.getByRole('radio', { name: types[i] }).click();
      await closePanel(page);
      const y = b.y + 160 + i * 70;
      const pts: [number, number][] = Array.from({ length: 40 }, (_, k) => [b.x + 120 + k * 8, y + (k % 2 ? 16 : -16)]);
      await penStroke(page, cdp, pts, { force: 0.35 });
    }
    const stored = await page.evaluate(() => {
      const s = window.__calame!.session;
      return s.getStrokes(s.notebook.pageIds[0]).map((x) => ({ tool: x.tool, width: x.width, streamline: x.style.streamline, smoothing: x.style.smoothing }));
    });
    expect(stored.map((s) => s.tool)).toEqual(['pen', 'fineliner', 'fountain', 'brush', 'pencil', 'marker']);
    // Nouveaux traits : lissage appliqué à la saisie (filtre), pas de « streamline » au rendu.
    for (const s of stored) {
      expect(s.streamline).toBe(0);
      expect(typeof s.smoothing).toBe('number');
    }
    // Même tracé pour chaque stylo (décalé de 70 px) : on compare les images pixel à pixel.
    // Écart relatif = Σ|différence| / encre de la ligne la plus chargée, pour chaque paire.
    const diffs = await page.evaluate(() => {
      const c = document.querySelector('.ink-host:not(.zoom-host) .ink-base') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const dpr = c.width / c.clientWidth;
      const rows = Array.from({ length: 6 }, (_, i) => {
        const img = ctx.getImageData(Math.round(100 * dpr), Math.round((160 + i * 70 - 32) * dpr), Math.round(360 * dpr), Math.round(64 * dpr));
        const ink = new Float32Array(img.data.length / 4);
        for (let k = 0; k < ink.length; k++) ink[k] = 765 - (img.data[k * 4] + img.data[k * 4 + 1] + img.data[k * 4 + 2]);
        return ink;
      });
      const total = rows.map((r) => r.reduce((a, v) => a + v, 0));
      const out: { i: number; j: number; d: number }[] = [];
      for (let i = 0; i < 6; i++)
        for (let j = i + 1; j < 6; j++) {
          let d = 0;
          for (let k = 0; k < rows[i].length; k++) d += Math.abs(rows[i][k] - rows[j][k]);
          out.push({ i, j, d: d / Math.max(total[i], total[j]) });
        }
      return out;
    });
    for (const { i, j, d } of diffs) expect(d, `${types[i]} / ${types[j]}`).toBeGreaterThan(0.2);
  });
});

test.describe('Forme nette par maintien @cdp', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Stylet piloté via le protocole Chromium');

  test('droite : maintien → droite nette, l’extrémité suit encore le stylet ; « garder le tracé libre » et annulation', async ({ page }) => {
    await start(page, 'Droite', { shapeHold: true, shapeHoldDelay: 450 });
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    const pts: [number, number][] = Array.from({ length: 30 }, (_, k) => [b.x + 120 + k * 10, b.y + 250 + (k % 3) * 2 - 2]);
    await penDown(cdp, pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) await penMove(cdp, x, y);
    await expect(page.locator('.shape-hint')).toContainText('Droite');
    // Ajustement de l'extrémité après la reconnaissance, puis lever.
    const end: [number, number] = [b.x + 470, b.y + 290];
    await penMove(cdp, end[0], end[1]);
    await penUp(cdp, end[0], end[1]);
    await nextFrame(page);
    expect(await strokeCount(page)).toBe(1);
    const a = await toPage(page, pts[0][0], pts[0][1]);
    const z = await toPage(page, ...end);
    const stored = await lastStrokePoints(page);
    for (const p of stored) expect(distToSegment(p, a, z)).toBeLessThan(0.05);
    expect(Math.hypot(stored[stored.length - 1][0] - z[0], stored[stored.length - 1][1] - z[1])).toBeLessThan(0.5);
    await expect(undoBtn(page)).toHaveAttribute('title', /Forme : Droite/);
    // Revenir au tracé à main levée (une action annulable).
    await page.getByRole('button', { name: 'Garder le tracé libre' }).click();
    const free = await lastStrokePoints(page);
    let dev = 0;
    for (const p of free) dev = Math.max(dev, distToSegment(p, a, z));
    expect(dev).toBeGreaterThan(1);
    expect(await strokeCount(page)).toBe(1);
    await undoBtn(page).click(); // → forme nette
    const again = await lastStrokePoints(page);
    for (const p of again) expect(distToSegment(p, a, z)).toBeLessThan(0.05);
    await undoBtn(page).click(); // → rien
    expect(await strokeCount(page)).toBe(0);
  });

  test('cercle et rectangle tracés à main levée deviennent des formes nettes', async ({ page }) => {
    await start(page, 'Formes', { shapeHold: true, shapeHoldDelay: 450 });
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    // Cercle tremblé.
    const cx = b.x + 260;
    const cy = b.y + 300;
    const circle: [number, number][] = Array.from({ length: 49 }, (_, k) => {
      const t = (k / 48) * Math.PI * 2;
      const r = 80 + (k % 2 ? 2.5 : -2.5);
      return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
    });
    await penDown(cdp, ...circle[0]);
    for (const p of circle.slice(1)) await penMove(cdp, ...p);
    await expect(page.locator('.shape-hint')).toContainText('Cercle');
    await penUp(cdp, ...circle[circle.length - 1]);
    await nextFrame(page);
    const c = await toPage(page, cx, cy);
    const pts = await lastStrokePoints(page);
    // Cercle exact : tous les points à la même distance de son centre…
    const xs0 = pts.map((p) => p[0]);
    const ys0 = pts.map((p) => p[1]);
    const mc: [number, number] = [(Math.min(...xs0) + Math.max(...xs0)) / 2, (Math.min(...ys0) + Math.max(...ys0)) / 2];
    const radii = pts.map((p) => Math.hypot(p[0] - mc[0], p[1] - mc[1]));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.5);
    // … centre et rayon proches du tracé à main levée (rayon 80 px écran).
    const scale = await page.evaluate(() => window.__calame!.engine.vp.scale);
    expect(Math.hypot(mc[0] - c[0], mc[1] - c[1]) * scale).toBeLessThan(4);
    expect(Math.abs(radii[0] * scale - 80)).toBeLessThan(4);
    // Rectangle.
    const rect: [number, number][] = [
      ...line(b.x + 420, b.y + 200, b.x + 640, b.y + 203, 15),
      ...line(b.x + 640, b.y + 203, b.x + 638, b.y + 360, 12).slice(1),
      ...line(b.x + 638, b.y + 360, b.x + 421, b.y + 357, 15).slice(1),
      ...line(b.x + 421, b.y + 357, b.x + 422, b.y + 205, 12).slice(1),
    ];
    await penDown(cdp, ...rect[0]);
    for (const p of rect.slice(1)) await penMove(cdp, ...p);
    await expect(page.locator('.shape-hint')).toContainText('Rectangle');
    await penUp(cdp, ...rect[rect.length - 1]);
    await nextFrame(page);
    const rp = await lastStrokePoints(page);
    const xs = new Set(rp.map((p) => p[0].toFixed(1)));
    const ys = new Set(rp.map((p) => p[1].toFixed(1)));
    // Côtés alignés : chaque point est sur un des quatre côtés.
    const minX = Math.min(...rp.map((p) => p[0]));
    const maxX = Math.max(...rp.map((p) => p[0]));
    const minY = Math.min(...rp.map((p) => p[1]));
    const maxY = Math.max(...rp.map((p) => p[1]));
    for (const [x, y] of rp) expect(Math.min(Math.abs(x - minX), Math.abs(x - maxX), Math.abs(y - minY), Math.abs(y - maxY))).toBeLessThan(0.05);
    expect(xs.size).toBeGreaterThan(4);
    expect(ys.size).toBeGreaterThan(4);
  });

  test('délai réglable et désactivation : un maintien plus court que le délai ne transforme rien', async ({ page }) => {
    await start(page, 'Délai', { shapeHold: true, shapeHoldDelay: 1500 });
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    const pts: [number, number][] = Array.from({ length: 30 }, (_, k) => [b.x + 120 + k * 10, b.y + 250 + (k % 3) * 2 - 2]);
    await penDown(cdp, ...pts[0]);
    for (const p of pts.slice(1)) await penMove(cdp, ...p);
    await page.waitForTimeout(700);
    await expect(page.locator('.shape-hint')).toHaveCount(0);
    await penUp(cdp, ...pts[pts.length - 1]);
    await nextFrame(page);
    const a = await toPage(page, ...pts[0]);
    const z = await toPage(page, ...pts[pts.length - 1]);
    let dev = 0;
    for (const p of await lastStrokePoints(page)) dev = Math.max(dev, distToSegment(p, a, z));
    expect(dev).toBeGreaterThan(0.5); // tracé libre conservé
    await expect(undoBtn(page)).toHaveAttribute('title', /Annuler : Trait/);
  });
});

test.describe('Annuler / rétablir fiables @cdp', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Stylet piloté via le protocole Chromium');

  test('gomme dont la fin n’a jamais été reçue : Annuler reste utilisable et annule', async ({ page }) => {
    await start(page, 'Geste perdu');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 150, b.y + 200, b.x + 400, b.y + 200));
    await page.keyboard.press('e');
    // pointerdown sans pointerup (geste système, capture refusée…).
    await page.evaluate(() => {
      const el = document.querySelector('.ink-host:not(.zoom-host) .ink-live')!;
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 77, pointerType: 'pen', clientX: r.left + 600, clientY: r.top + 600, buttons: 1, bubbles: true }));
    });
    expect(await page.evaluate(() => window.__calame!.engine.debugState().interaction)).toBe('erase');
    await expect(undoBtn(page)).toBeEnabled();
    await page.waitForTimeout(800);
    await undoBtn(page).click();
    expect(await strokeCount(page)).toBe(0);
    expect(await page.evaluate(() => window.__calame!.engine.debugState().interaction)).toBeNull();
    await redoBtn(page).click();
    expect(await strokeCount(page)).toBe(1);
  });

  test('trait resté « en cours » : le stylet suivant le termine, rien n’est perdu ni bloqué', async ({ page }) => {
    await start(page, 'Trait perdu');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await page.evaluate(() => {
      const el = document.querySelector('.ink-host:not(.zoom-host) .ink-live')!;
      const r = el.getBoundingClientRect();
      const ev = (type: string, x: number) =>
        el.dispatchEvent(new PointerEvent(type, { pointerId: 78, pointerType: 'pen', clientX: r.left + x, clientY: r.top + 150, buttons: 1, pressure: 0.5, bubbles: true }));
      ev('pointerdown', 150);
      ev('pointermove', 200);
      ev('pointermove', 260);
    });
    await penStroke(page, cdp, line(b.x + 150, b.y + 300, b.x + 400, b.y + 300));
    expect(await strokeCount(page)).toBe(2);
    expect((await page.evaluate(() => window.__calame!.session.historySize)).undo).toBe(2);
    await undoBtn(page).click();
    await undoBtn(page).click();
    expect(await strokeCount(page)).toBe(0);
  });

  test('fin de geste reçue hors du canvas : le trait est terminé normalement', async ({ page }) => {
    await start(page, 'Fin hors canvas');
    await page.evaluate(() => {
      const el = document.querySelector('.ink-host:not(.zoom-host) .ink-live')!;
      const r = el.getBoundingClientRect();
      const ev = (target: Element, type: string, x: number) =>
        target.dispatchEvent(new PointerEvent(type, { pointerId: 79, pointerType: 'pen', clientX: r.left + x, clientY: r.top + 180, buttons: 1, pressure: 0.5, bubbles: true }));
      ev(el, 'pointerdown', 150);
      ev(el, 'pointermove', 220);
      ev(el, 'pointermove', 300);
      ev(document.body, 'pointerup', 300);
    });
    expect(await page.evaluate(() => window.__calame!.engine.debugState().interaction)).toBeNull();
    expect(await strokeCount(page)).toBe(1);
    await expect(undoBtn(page)).toBeEnabled();
  });

  test('séquence mixte : traits, gomme, sélection, page suivante, retour → tout annuler puis tout rétablir', async ({ page }) => {
    await start(page, 'Séquence', { eraserMode: 'stroke' });
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    const snap = () => page.evaluate(() => {
      const s = window.__calame!.session;
      return s.notebook.pageIds.flatMap((p) => s.getStrokes(p).map((x) => `${p}|${x.id}|${Array.from(x.points.slice(0, 2)).map((v) => v.toFixed(1))}`)).sort();
    });
    const states = [await snap()];
    await penStroke(page, cdp, line(b.x + 150, b.y + 200, b.x + 400, b.y + 200));
    states.push(await snap());
    await penStroke(page, cdp, line(b.x + 150, b.y + 280, b.x + 400, b.y + 280));
    states.push(await snap());
    await page.keyboard.press('e');
    await penStroke(page, cdp, line(b.x + 250, b.y + 180, b.x + 250, b.y + 220, 8));
    states.push(await snap());
    await page.keyboard.press('s');
    await penStroke(page, cdp, [[b.x + 120, b.y + 250], [b.x + 450, b.y + 250], [b.x + 450, b.y + 320], [b.x + 120, b.y + 320], [b.x + 120, b.y + 251]]);
    await expect(page.getByRole('toolbar', { name: 'Sélection' })).toBeVisible();
    await penStroke(page, cdp, line(b.x + 250, b.y + 280, b.x + 300, b.y + 340, 12));
    states.push(await snap());
    await page.getByRole('button', { name: 'Ajouter une page après celle-ci' }).click();
    await page.keyboard.press('p');
    await penStroke(page, cdp, line(b.x + 150, b.y + 400, b.x + 400, b.y + 400));
    states.push(await snap());
    await page.keyboard.press('ArrowLeft');
    for (let i = states.length - 2; i >= 0; i--) {
      await undoBtn(page).click();
      expect(await snap()).toEqual(states[i]);
    }
    await expect(undoBtn(page)).toBeDisabled();
    for (let i = 1; i < states.length; i++) {
      await redoBtn(page).click();
      expect(await snap()).toEqual(states[i]);
    }
    await expect(redoBtn(page)).toBeDisabled();
  });
});

test.describe('Fenêtre de zoom @cdp', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Stylet piloté via le protocole Chromium');

  const zoomState = (page: Page) => page.evaluate(() => window.__calame!.engine.zoomState());
  const zoomToPage = async (page: Page, x: number, y: number): Promise<[number, number]> => {
    const zb = (await page.getByTestId('zoom-host').boundingBox())!;
    return page.evaluate(([sx, sy]) => {
      const r = window.__calame!.engine.surfaceToPage('zoom', sx, sy)!;
      return [r.x, r.y] as [number, number];
    }, [x - zb.x, y - zb.y]);
  };

  test('écrire dans la fenêtre : un seul trait, au bon endroit et à la bonne taille sur la page ; annuler, gomme', async ({ page }) => {
    await start(page, 'Zoom', { eraserMode: 'stroke', zoomFactor: 2.5 });
    const cdp = await page.context().newCDPSession(page);
    const before = await hostBox(page);
    await page.getByRole('button', { name: 'Fenêtre de zoom' }).click();
    await expect(page.getByTestId('zoom-host')).toBeVisible();
    const main = await hostBox(page);
    expect(main.height).toBeLessThan(before.height * 0.8);
    // La page entière est visible au-dessus de la fenêtre.
    const fits = await page.evaluate(() => {
      const e = window.__calame!.engine;
      const s = window.__calame!.session;
      const p = s.pageOrder[0];
      const a = e.pageToScreen(p.id, 0, 0)!;
      const z = e.pageToScreen(p.id, p.width, p.height)!;
      return { a, z, w: e.vp.width, h: e.vp.height };
    });
    expect(fits.a[1]).toBeGreaterThanOrEqual(0);
    expect(fits.z[1]).toBeLessThanOrEqual(fits.h);
    const zs = await zoomState(page);
    expect(zs.open).toBe(true);
    const zb = (await page.getByTestId('zoom-host').boundingBox())!;
    const y = zb.y + zb.height * 0.5;
    const x0 = zb.x + 40;
    const x1 = zb.x + zb.width * 0.5;
    const expA = await zoomToPage(page, x0, y);
    const expZ = await zoomToPage(page, x1, y);
    await penStroke(page, cdp, line(x0, y, x1, y, 20));
    expect(await strokeCount(page)).toBe(1); // aucun doublon
    const pts = await lastStrokePoints(page);
    expect(Math.hypot(pts[0][0] - expA[0], pts[0][1] - expA[1])).toBeLessThan(0.5);
    expect(Math.hypot(pts[pts.length - 1][0] - expZ[0], pts[pts.length - 1][1] - expZ[1])).toBeLessThan(0.5);
    // Taille correcte : longueur sur la page = longueur écrite / grossissement réel.
    const zoomScale = await page.evaluate(() => window.__calame!.engine.fitScaleFor(0) * window.__calame!.engine.zoomState().factor);
    expect(Math.abs(pts[pts.length - 1][0] - pts[0][0]) - (x1 - x0) / zoomScale).toBeLessThan(0.5);
    // Épaisseur en unités page = épaisseur du stylo (pas multipliée par le zoom).
    const w = await page.evaluate(() => {
      const s = window.__calame!.session;
      return s.getStrokes(s.notebook.pageIds[0])[0].width;
    });
    expect(w).toBeCloseTo(2.2, 5);
    // Le trait apparaît aussi sur la page principale, à l'emplacement correspondant.
    const dark = await page.evaluate(([px, py]) => {
      const e = window.__calame!.engine;
      const s = window.__calame!.session;
      const [sx, sy] = e.pageToScreen(s.notebook.pageIds[0], px, py)!;
      const c = document.querySelector('.ink-host:not(.zoom-host) .ink-base') as HTMLCanvasElement;
      const dpr = c.width / c.clientWidth;
      const img = c.getContext('2d')!.getImageData(Math.round(sx * dpr) - 4, Math.round(sy * dpr) - 4, 9, 9);
      let min = 765;
      for (let i = 0; i < img.data.length; i += 4) min = Math.min(min, img.data[i] + img.data[i + 1] + img.data[i + 2]);
      return min;
    }, [(expA[0] + expZ[0]) / 2, expA[1]]);
    expect(dark).toBeLessThan(600);
    // Annuler / rétablir depuis la barre.
    await undoBtn(page).click();
    expect(await strokeCount(page)).toBe(0);
    await redoBtn(page).click();
    expect(await strokeCount(page)).toBe(1);
    // Gomme dans la fenêtre de zoom.
    await page.keyboard.press('e');
    const mx = (x0 + x1) / 2;
    await penStroke(page, cdp, line(mx, y - 30, mx, y + 30, 8));
    expect(await strokeCount(page)).toBe(0);
    await undoBtn(page).click();
    expect(await strokeCount(page)).toBe(1);
    // Fermeture : la page reprend toute la hauteur.
    await page.getByRole('button', { name: 'Fermer la fenêtre de zoom' }).click();
    await expect(page.getByTestId('zoom-host')).toHaveCount(0);
    expect((await hostBox(page)).height).toBeCloseTo(before.height, 0);
    expect((await zoomState(page)).open).toBe(false);
  });

  test('avance automatique près du bord droit, retour à la ligne, déplacement du cadre sur la page', async ({ page }) => {
    await start(page, 'Zoom avance', { zoomFactor: 2.5, zoomAutoAdvance: true });
    const cdp = await page.context().newCDPSession(page);
    await page.keyboard.press('z');
    await expect(page.getByTestId('zoom-host')).toBeVisible();
    const z0 = await zoomState(page);
    const zb = (await page.getByTestId('zoom-host').boundingBox())!;
    const y = zb.y + zb.height * 0.5;
    // Mot écrit au milieu : pas d'avance.
    await penStroke(page, cdp, line(zb.x + zb.width * 0.3, y, zb.x + zb.width * 0.5, y, 10));
    expect((await zoomState(page)).x).toBeCloseTo(z0.x, 3);
    // Mot qui se termine dans la zone de droite : le cadre avance.
    await penStroke(page, cdp, line(zb.x + zb.width * 0.62, y, zb.x + zb.width * 0.9, y, 10));
    const z1 = await zoomState(page);
    expect(z1.x - z0.x).toBeCloseTo(z0.w * 0.6, 0);
    expect(await strokeCount(page)).toBe(2);
    // Retour à la ligne : marge gauche, une ligne (ou plus) plus bas, aligné sur le réglage du papier.
    await page.getByRole('button', { name: 'Retour à la ligne' }).click();
    const z2 = await zoomState(page);
    expect(z2.x).toBeCloseTo(z0.x, 3);
    expect(z2.y).toBeGreaterThan(z1.y);
    expect((z2.y - z1.y) % 32).toBeCloseTo(0, 3);
    // Le cadre se déplace par son onglet sur la page principale (aucun trait créé).
    const b = await hostBox(page);
    const tab = await page.evaluate(() => {
      const e = window.__calame!.engine;
      const st = e.zoomState();
      return e.pageToScreen(st.pageId!, st.x, st.y)!;
    });
    const scale = await page.evaluate(() => window.__calame!.engine.vp.scale);
    await penStroke(page, cdp, line(b.x + tab[0] + 30, b.y + tab[1] - 13, b.x + tab[0] + 90, b.y + tab[1] + 27, 10));
    const z3 = await zoomState(page);
    expect(z3.x - z2.x).toBeCloseTo(60 / scale, 0);
    expect(z3.y - z2.y).toBeCloseTo(40 / scale, 0);
    expect(await strokeCount(page)).toBe(2);
    // Grossissement réglable.
    await page.getByRole('button', { name: 'Plus de grossissement' }).click();
    expect((await zoomState(page)).factor).toBeCloseTo(3, 3);
    await page.getByRole('button', { name: 'Moins de grossissement' }).click();
    expect((await zoomState(page)).factor).toBeCloseTo(2.5, 3);
    // Fermeture au clavier.
    await page.keyboard.press('z');
    await expect(page.getByTestId('zoom-host')).toHaveCount(0);
  });

  test('au doigt : pincer dans la fenêtre change le grossissement', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium-ipad', 'Gestes tactiles : profil iPad');
    await start(page, 'Zoom doigt', { zoomFactor: 2.5, fingerMode: 'pen-only' });
    const cdp = await page.context().newCDPSession(page);
    await page.getByRole('button', { name: 'Fenêtre de zoom' }).click();
    const zb = (await page.getByTestId('zoom-host').boundingBox())!;
    const cx = zb.x + zb.width / 2;
    const cy = zb.y + zb.height / 2;
    const frames: [number, number][][] = Array.from({ length: 11 }, (_, i) => [
      [cx - 40 - i * 8, cy],
      [cx + 40 + i * 8, cy],
    ]);
    await touchGesture(cdp, frames);
    expect((await zoomState(page)).factor).toBeGreaterThan(4);
    // Un doigt glissé vers la gauche déplace le cadre vers la droite.
    const before = await zoomState(page);
    await touchGesture(cdp, Array.from({ length: 8 }, (_, i) => [[cx, cy - i * 0]].map(() => [cx - i * 15, cy] as [number, number])));
    expect((await zoomState(page)).x).toBeGreaterThan(before.x);
    expect(await strokeCount(page)).toBe(0);
  });
});

test.describe('Conversion manuscrit → texte @cdp', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Stylet piloté via le protocole Chromium');

  async function writeAndSelect(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 150, b.y + 200, b.x + 220, b.y + 230, 10));
    await penStroke(page, cdp, line(b.x + 230, b.y + 200, b.x + 300, b.y + 230, 10));
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.getByRole('toolbar', { name: 'Sélection' })).toBeVisible();
  }

  test('saisie manuelle : vérifier, corriger, remplacer ; annuler restaure l’écriture ; aucune requête externe', async ({ page }) => {
    let external = 0;
    await page.route('https://vision.googleapis.com/**', (r) => {
      external++;
      return r.abort();
    });
    await start(page, 'Conversion');
    await writeAndSelect(page);
    await page.getByRole('button', { name: 'Convertir en texte' }).click();
    const dlg = page.getByRole('dialog', { name: 'Convertir en texte' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('img', { name: /Écriture sélectionnée \(2 traits\)/ })).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Remplacer les traits' })).toBeDisabled();
    await dlg.getByLabel(/Texte — vérifiez/).fill('Bonjour à tous');
    await dlg.getByRole('button', { name: 'Remplacer les traits' }).click();
    await expect(dlg).toHaveCount(0);
    const after = await page.evaluate(() => {
      const s = window.__calame!.session;
      const p = s.notebook.pageIds[0];
      return { strokes: s.getStrokes(p).length, items: s.getItems(p).map((i) => (i as { text?: string }).text) };
    });
    expect(after).toEqual({ strokes: 0, items: ['Bonjour à tous'] });
    await expect(undoBtn(page)).toHaveAttribute('title', /Convertir en texte/);
    await undoBtn(page).click();
    expect(await strokeCount(page)).toBe(2);
    expect(await page.evaluate(() => window.__calame!.session.itemCount())).toBe(0);
    expect(external).toBe(0);
  });

  test('Google Cloud Vision (activé par l’utilisateur, réponse simulée) : image seule envoyée, français demandé, résultat corrigeable', async ({ page }) => {
    const bodies: { url: string; body: string; referer: string }[] = [];
    await page.route('https://vision.googleapis.com/**', async (r) => {
      bodies.push({ url: r.request().url(), body: r.request().postData() ?? '', referer: (await r.request().allHeaders())['referer'] ?? '' });
      await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ responses: [{ fullTextAnnotation: { text: 'Réunion lundl\n' } }] }) });
    });
    await start(page, 'Conversion Google');
    await page.evaluate(() => localStorage.setItem('calame:ocr:v1', JSON.stringify({ provider: 'google', googleKey: 'cle-de-test' })));
    await writeAndSelect(page);
    await page.getByRole('button', { name: 'Convertir en texte' }).click();
    const dlg = page.getByRole('dialog', { name: 'Convertir en texte' });
    const field = dlg.getByLabel(/Texte — vérifiez/);
    await expect(field).toHaveValue('Réunion lundl');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].url).toContain('key=cle-de-test');
    // Seule l'origine du site est transmise (restriction de clé possible), jamais le chemin ni l'identifiant du carnet.
    expect(bodies[0].referer).toBe(new URL(page.url()).origin + '/');
    const req = JSON.parse(bodies[0].body);
    expect(req.requests[0].imageContext.languageHints).toEqual(['fr']);
    expect(req.requests[0].features[0].type).toBe('DOCUMENT_TEXT_DETECTION');
    expect(Object.keys(req.requests[0])).toEqual(['image', 'features', 'imageContext']);
    expect(req.requests[0].image.content.length).toBeGreaterThan(100);
    // Correction avant remplacement.
    await field.fill('Réunion lundi');
    await dlg.getByRole('button', { name: 'Remplacer les traits' }).click();
    const items = await page.evaluate(() => {
      const s = window.__calame!.session;
      return s.getItems(s.notebook.pageIds[0]).map((i) => (i as { text?: string }).text);
    });
    expect(items).toEqual(['Réunion lundi']);
    expect(await strokeCount(page)).toBe(0);
  });

  test('erreur du service : message clair, saisie manuelle toujours possible', async ({ page }) => {
    await page.route('https://vision.googleapis.com/**', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'API key not valid.' } }) }));
    await start(page, 'Conversion erreur');
    await page.evaluate(() => localStorage.setItem('calame:ocr:v1', JSON.stringify({ provider: 'google', googleKey: 'mauvaise' })));
    await writeAndSelect(page);
    await page.getByRole('button', { name: 'Convertir en texte' }).click();
    const dlg = page.getByRole('dialog', { name: 'Convertir en texte' });
    await expect(dlg.getByRole('alert')).toContainText('Clé API refusée');
    await dlg.getByLabel(/Texte — vérifiez/).fill('Texte tapé');
    await dlg.getByRole('button', { name: 'Remplacer les traits' }).click();
    expect(await strokeCount(page)).toBe(0);
  });
});

test.describe('Tous navigateurs (événements synthétiques, WebKit compris)', () => {
  /** Trait au « stylet » par événements PointerEvent synthétiques, coordonnées relatives à la surface. */
  async function synthStroke(page: Page, surface: 'main' | 'zoom', pts: [number, number][], id: number) {
    await page.evaluate(
      ({ surface, pts, id }) => {
        const el = document.querySelector(surface === 'zoom' ? '.zoom-host .ink-live' : '.ink-host:not(.zoom-host) .ink-live')!;
        const r = el.getBoundingClientRect();
        const ev = (type: string, [x, y]: [number, number]) =>
          el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'pen', clientX: r.left + x, clientY: r.top + y, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5, bubbles: true }));
        ev('pointerdown', pts[0]);
        for (const p of pts.slice(1)) ev('pointermove', p);
        ev('pointerup', pts[pts.length - 1]);
      },
      { surface, pts, id },
    );
  }

  test('fenêtre de zoom, conversion en texte et annulation', async ({ page }) => {
    await start(page, 'Synthétique');
    await page.getByRole('button', { name: 'Fenêtre de zoom' }).click();
    await expect(page.getByTestId('zoom-host')).toBeVisible();
    const zb = (await page.getByTestId('zoom-host').boundingBox())!;
    const y = zb.height / 2;
    const pts = Array.from({ length: 15 }, (_, i) => [40 + i * 10, y + (i % 2) * 6] as [number, number]);
    const exp = await page.evaluate(([x, yy]) => window.__calame!.engine.surfaceToPage('zoom', x, yy), pts[0]);
    await synthStroke(page, 'zoom', pts, 501);
    expect(await strokeCount(page)).toBe(1);
    const first = (await lastStrokePoints(page))[0];
    expect(Math.hypot(first[0] - exp!.x, first[1] - exp!.y)).toBeLessThan(0.5);
    await synthStroke(page, 'zoom', pts.map(([x, yy]) => [x + 200, yy] as [number, number]), 502);
    expect(await strokeCount(page)).toBe(2);
    await page.getByRole('button', { name: 'Fermer la fenêtre de zoom' }).click();
    await expect(page.getByTestId('zoom-host')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByRole('button', { name: 'Convertir en texte' }).click();
    const dlg = page.getByRole('dialog', { name: 'Convertir en texte' });
    await dlg.getByLabel(/Texte — vérifiez/).fill('écrit en grand');
    await dlg.getByRole('button', { name: 'Remplacer les traits' }).click();
    expect(await strokeCount(page)).toBe(0);
    await undoBtn(page).click();
    expect(await strokeCount(page)).toBe(2);
    await undoBtn(page).click();
    await undoBtn(page).click();
    expect(await strokeCount(page)).toBe(0);
    await expect(undoBtn(page)).toBeDisabled();
  });
});
