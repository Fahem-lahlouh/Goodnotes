import { expect, test } from '@playwright/test';
import { createNotebook, hostBox, line, penStroke, strokeCount, touchGesture, waitSaved } from './helpers';

test.describe('Écriture @cdp', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Pilotage du stylet via le protocole Chromium');

  test('écrire au stylet, recharger, retrouver le trait et ses propriétés', async ({ page }) => {
    await createNotebook(page, 'Persistance');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 150, b.y + 200, b.x + 400, b.y + 260), { force: 0.8, tiltX: 30 });
    expect(await strokeCount(page)).toBe(1);
    const before = await page.evaluate(() => {
      const s = window.__calame!.session;
      const st = s.getStrokes(s.notebook.pageIds[0])[0];
      return { color: st.color, width: st.width, real: st.style.realPressure, n: st.points.length, p: st.points[2], tilt: st.points[4] };
    });
    expect(before.real).toBe(true);
    expect(before.p).toBeCloseTo(0.8, 1);
    expect(before.tilt).toBeGreaterThan(0.2);
    await waitSaved(page);
    await page.reload();
    await page.waitForFunction(() => window.__calame?.session.strokeCount() === 1);
    const after = await page.evaluate(() => {
      const s = window.__calame!.session;
      const st = s.getStrokes(s.notebook.pageIds[0])[0];
      return { color: st.color, width: st.width, real: st.style.realPressure, n: st.points.length, p: st.points[2], tilt: st.points[4] };
    });
    expect(after).toEqual(before);
  });

  test('coordonnées exactes après zoom et déplacement', async ({ page }) => {
    await createNotebook(page, 'Zoom');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    // Zoom au trackpad (ctrl + molette) puis déplacement.
    await page.mouse.move(b.x + 300, b.y + 300);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await page.mouse.wheel(40, 120);
    const scale = await page.evaluate(() => window.__calame!.engine.vp.scale);
    expect(scale).toBeGreaterThan(1.2);
    const target = { x: 260, y: 240 };
    const expected = await page.evaluate(([x, y]) => window.__calame!.engine.screenToPage(x, y), [target.x, target.y]);
    expect(expected).not.toBeNull();
    await penStroke(page, cdp, line(b.x + target.x, b.y + target.y, b.x + target.x + 80, b.y + target.y + 10, 6));
    const first = await page.evaluate(() => {
      const s = window.__calame!.session;
      const st = s.getStrokes(s.notebook.pageIds[0])[0];
      return [st.points[0], st.points[1]];
    });
    expect(first[0]).toBeCloseTo(expected!.x, 0);
    expect(first[1]).toBeCloseTo(expected!.y, 0);
  });

  test('annuler / rétablir (boutons et clavier)', async ({ page }) => {
    await createNotebook(page, 'Historique');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 100, b.y + 150, b.x + 300, b.y + 150));
    await penStroke(page, cdp, line(b.x + 100, b.y + 250, b.x + 300, b.y + 250));
    expect(await strokeCount(page)).toBe(2);
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    expect(await strokeCount(page)).toBe(1);
    await page.keyboard.press('ControlOrMeta+z');
    expect(await strokeCount(page)).toBe(0);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await strokeCount(page)).toBe(1);
    await page.getByRole('button', { name: 'Rétablir', exact: true }).click();
    expect(await strokeCount(page)).toBe(2);
    await waitSaved(page);
    await page.reload();
    await page.waitForFunction(() => window.__calame?.session.strokeCount() === 2);
  });

  test('gomme par trait et gomme partielle', async ({ page }) => {
    await createNotebook(page, 'Gomme');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 100, b.y + 200, b.x + 400, b.y + 200, 20));
    await penStroke(page, cdp, line(b.x + 100, b.y + 300, b.x + 400, b.y + 300, 20));
    // Gomme partielle au milieu du premier trait : 2 morceaux.
    await page.keyboard.press('e');
    await page.getByRole('radio', { name: 'Partielle' }).click();
    await penStroke(page, cdp, line(b.x + 250, b.y + 180, b.x + 250, b.y + 220, 4));
    expect(await strokeCount(page)).toBe(3);
    // Gomme par trait sur le second : supprimé entièrement.
    await page.getByRole('radio', { name: 'Trait entier' }).click();
    await penStroke(page, cdp, line(b.x + 380, b.y + 285, b.x + 380, b.y + 315, 4));
    expect(await strokeCount(page)).toBe(2);
    // Le geste de gomme s'annule en une seule étape.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await strokeCount(page)).toBe(3);
  });

  test('lasso : sélectionner, déplacer, dupliquer, supprimer', async ({ page }) => {
    await createNotebook(page, 'Lasso');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 150, b.y + 200, b.x + 250, b.y + 200, 8));
    const x0 = await page.evaluate(() => {
      const s = window.__calame!.session;
      return s.getStrokes(s.notebook.pageIds[0])[0].points[0];
    });
    await page.keyboard.press('l');
    // Lasso autour du trait.
    const loop: [number, number][] = [
      [b.x + 120, b.y + 170], [b.x + 280, b.y + 170], [b.x + 280, b.y + 230], [b.x + 120, b.y + 230], [b.x + 120, b.y + 172],
    ];
    await penStroke(page, cdp, loop);
    await expect(page.getByRole('toolbar', { name: 'Sélection' })).toBeVisible();
    // Glisser la sélection de 100 px vers la droite.
    await penStroke(page, cdp, line(b.x + 200, b.y + 200, b.x + 300, b.y + 200, 8));
    const scale = await page.evaluate(() => window.__calame!.engine.vp.scale);
    const x1 = await page.evaluate(() => {
      const s = window.__calame!.session;
      return s.getStrokes(s.notebook.pageIds[0])[0].points[0];
    });
    expect(x1 - x0).toBeCloseTo(100 / scale, 0);
    await page.getByRole('button', { name: 'Dupliquer' }).click();
    expect(await strokeCount(page)).toBe(2);
    await page.getByRole('button', { name: 'Supprimer' }).click();
    expect(await strokeCount(page)).toBe(1);
  });

  test('stylet détecté : le doigt fait défiler au lieu d’écrire; pincement = zoom', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium-ipad', 'tactile requis');
    await createNotebook(page, 'Gestes');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 100, b.y + 200, b.x + 200, b.y + 200, 4));
    expect(await page.evaluate(() => window.__calame!.engine.penDetected)).toBe(true);
    // Ajoute des pages pour pouvoir défiler.
    await page.getByRole('button', { name: 'Ajouter une page après celle-ci' }).click();
    await page.getByRole('button', { name: 'Ajouter une page après celle-ci' }).click();
    const ty0 = await page.evaluate(() => window.__calame!.engine.vp.ty);
    await touchGesture(cdp, Array.from({ length: 8 }, (_, i) => [[b.x + 300, b.y + 700 - i * 40]]));
    const ty1 = await page.evaluate(() => window.__calame!.engine.vp.ty);
    expect(ty1).toBeLessThan(ty0 - 100);
    expect(await strokeCount(page)).toBe(1);
    const s0 = await page.evaluate(() => window.__calame!.engine.vp.scale);
    await touchGesture(
      cdp,
      Array.from({ length: 8 }, (_, i) => [
        [b.x + 300 - i * 20, b.y + 500],
        [b.x + 400 + i * 20, b.y + 500],
      ]),
    );
    const s1 = await page.evaluate(() => window.__calame!.engine.vp.scale);
    expect(s1).toBeGreaterThan(s0 * 1.5);
    expect(await strokeCount(page)).toBe(1);
  });
});

test('écriture à la souris (bureau)', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium-desktop');
  await createNotebook(page, 'Souris');
  const b = await hostBox(page);
  await page.mouse.move(b.x + 200, b.y + 200);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 200 + i * 15, b.y + 200 + i * 4);
  await page.mouse.up();
  expect(await strokeCount(page)).toBe(1);
  const real = await page.evaluate(() => {
    const s = window.__calame!.session;
    return s.getStrokes(s.notebook.pageIds[0])[0].style.realPressure;
  });
  expect(real).toBe(false);
});
