import { expect, test, type Page } from '@playwright/test';
import {
  closePanel,
  createNotebook,
  hostBox,
  line,
  nextFrame,
  openToolPanel,
  pageIndex,
  penStroke,
  setPrefs,
  snapshot,
  strokeCount,
  swipe,
  touchGesture,
  waitSaved,
} from './helpers';

async function start(page: Page, title: string, prefs: Record<string, unknown> = {}) {
  await page.goto('./');
  await setPrefs(page, { penDetected: true, ...prefs });
  await page.reload();
  await createNotebook(page, title);
}

const history = (page: Page) => page.evaluate(() => window.__calame!.session.historySize);

test.describe('Écriture et outils @cdp', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Stylet piloté via le protocole Chromium');

  test('écrire au stylet, recharger, retrouver le trait et ses propriétés', async ({ page }) => {
    await start(page, 'Persistance');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 150, b.y + 200, b.x + 400, b.y + 260), { force: 0.8, tiltX: 30 });
    expect(await strokeCount(page)).toBe(1);
    const read = () =>
      page.evaluate(() => {
        const s = window.__calame!.session;
        const st = s.getStrokes(s.notebook.pageIds[0])[0];
        return { tool: st.tool, color: st.color, width: st.width, real: st.style.realPressure, n: st.points.length, p: st.points[2], tilt: st.points[4] };
      });
    const before = await read();
    expect(before.real).toBe(true);
    expect(before.p).toBeCloseTo(0.8, 1);
    expect(before.tilt).toBeGreaterThan(0.2);
    await waitSaved(page);
    await page.reload();
    await page.waitForFunction(() => window.__calame?.session.strokeCount() === 1);
    expect(await read()).toEqual(before);
  });

  test('bille, plume, pinceau et crayon : rendus réellement différents', async ({ page }) => {
    await start(page, 'Outils', { settings: { pageLayout: 'horizontal' } });
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    const types = ['Bille', 'Plume', 'Pinceau', 'Crayon'];
    for (let i = 0; i < types.length; i++) {
      await openToolPanel(page, /Stylo à bille|Plume|Pinceau|Crayon/);
      await page.getByRole('radio', { name: types[i] }).click();
      await closePanel(page);
      const y = b.y + 200 + i * 90;
      // Zigzag : directions variées (sensible à la plume) et pression variable.
      const pts: [number, number][] = Array.from({ length: 40 }, (_, k) => [b.x + 120 + k * 9, y + (k % 2 ? 22 : -22)]);
      await penStroke(page, cdp, pts, { force: 0.3 + 0.1 * i });
    }
    const tools = await page.evaluate(() => {
      const s = window.__calame!.session;
      return s.getStrokes(s.notebook.pageIds[0]).map((x) => x.tool);
    });
    expect(tools).toEqual(['pen', 'fountain', 'brush', 'pencil']);
    // Couverture d'encre mesurée sur le canvas : chaque outil laisse une empreinte différente.
    const ink = await page.evaluate(
      ({ top, step }) => {
        const c = document.querySelector('.ink-base') as HTMLCanvasElement;
        const ctx = c.getContext('2d')!;
        const dpr = c.width / c.clientWidth;
        const out: number[] = [];
        for (let i = 0; i < 4; i++) {
          const img = ctx.getImageData(Math.round(100 * dpr), Math.round((top + i * step - 40) * dpr), Math.round(420 * dpr), Math.round(80 * dpr));
          let n = 0;
          for (let k = 0; k < img.data.length; k += 4) if (img.data[k] + img.data[k + 1] + img.data[k + 2] < 300) n++;
          out.push(n);
        }
        return out;
      },
      { top: 200, step: 90 },
    );
    const sorted = [...ink].sort((a, z) => a - z);
    for (let i = 1; i < 4; i++) expect(sorted[i] / sorted[i - 1]).toBeGreaterThan(1.1);
  });

  test('aperçu du trait et favoris : un favori restaure outil, couleur et épaisseur', async ({ page }) => {
    await start(page, 'Favoris');
    await openToolPanel(page, /Stylo à bille|Plume|Pinceau|Crayon/);
    await expect(page.getByRole('img', { name: /Aperçu : Stylo à bille/ })).toBeVisible();
    await page.getByRole('radio', { name: 'Pinceau' }).click();
    await page.getByRole('radio', { name: 'Couleur #c0392b' }).click();
    await page.getByRole('button', { name: 'Épaisseur 14' }).click();
    await expect(page.getByRole('img', { name: /Aperçu : Pinceau, épaisseur 14/ })).toBeVisible();
    await page.getByRole('button', { name: 'Ajouter les réglages actuels' }).click();
    // Changer d'outil puis réappliquer le favori.
    await page.getByRole('radio', { name: 'Bille' }).click();
    await closePanel(page);
    await page.getByRole('button', { name: 'Favori Pinceau #c0392b' }).click();
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem('calame:prefs:v2')!).styles);
    expect(st.penType).toBe('brush');
    expect(st.pens.brush).toMatchObject({ color: '#c0392b', width: 14 });
    // Réglages mémorisés par outil.
    expect(st.pens.pen.color).not.toBe('#c0392b');
  });

  test('coordonnées exactes après zoom et déplacement', async ({ page }) => {
    await start(page, 'Zoom');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await page.mouse.move(b.x + 300, b.y + 300);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await page.mouse.wheel(0, 150);
    await nextFrame(page);
    expect(await page.evaluate(() => window.__calame!.engine.vp.scale)).toBeGreaterThan(1.2);
    const target = { x: 260, y: 240 };
    const expected = await page.evaluate(([x, y]) => window.__calame!.engine.screenToPage(x, y), [target.x, target.y]);
    await penStroke(page, cdp, line(b.x + target.x, b.y + target.y, b.x + target.x + 80, b.y + target.y + 10, 6));
    const first = await page.evaluate(() => {
      const s = window.__calame!.session;
      return Array.from(s.getStrokes(s.notebook.pageIds[0])[0].points.slice(0, 2));
    });
    expect(first[0]).toBeCloseTo(expected!.x, 0);
    expect(first[1]).toBeCloseTo(expected!.y, 0);
  });

  test('plein écran / mode concentration + écriture : pas de décalage après le changement de mode', async ({ page }) => {
    await start(page, 'Plein écran');
    const cdp = await page.context().newCDPSession(page);
    const box0 = await hostBox(page);
    await page.getByRole('button', { name: 'Plein écran', exact: true }).click();
    // Plein écran accordé (API du navigateur) OU explication affichée s'il est refusé.
    await page.waitForFunction(() => !!document.fullscreenElement || !!document.querySelector('[role=dialog][aria-label="Plein écran"]'));
    const fs = await page.evaluate(() => !!document.fullscreenElement);
    if (fs) await expect(page.getByRole('button', { name: 'Quitter le plein écran' }).first()).toHaveAttribute('aria-pressed', 'true');
    else await page.keyboard.press('Escape');
    await page.keyboard.press('f'); // mode concentration : la barre du carnet disparaît
    await expect(page.locator('.topbar')).toHaveCount(0);
    await nextFrame(page);
    const b = await hostBox(page);
    expect(b.height).toBeGreaterThan(box0.height);
    const target = { x: 220, y: 260 };
    const expected = await page.evaluate(([x, y]) => window.__calame!.engine.screenToPage(x, y), [target.x, target.y]);
    await penStroke(page, cdp, line(b.x + target.x, b.y + target.y, b.x + target.x + 60, b.y + target.y, 6));
    const first = await page.evaluate(() => {
      const s = window.__calame!.session;
      return Array.from(s.getStrokes(s.notebook.pageIds[0])[0].points.slice(0, 2));
    });
    expect(first[0]).toBeCloseTo(expected!.x, 0);
    expect(first[1]).toBeCloseTo(expected!.y, 0);
    if (fs) {
      await page.evaluate(() => document.exitFullscreen());
      await expect(page.getByRole('button', { name: 'Plein écran', exact: true }).first()).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('historique : 3 traits → gomme partielle → déplacement → tout annuler → tout rétablir = identique', async ({ page }) => {
    await start(page, 'Historique');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    for (let i = 0; i < 3; i++) await penStroke(page, cdp, line(b.x + 150, b.y + 220 + i * 60, b.x + 450, b.y + 220 + i * 60, 24));
    expect((await history(page)).undo).toBe(3); // un trait = une action
    await openToolPanel(page, 'Gomme');
    await page.getByRole('radio', { name: 'Partielle' }).click();
    await closePanel(page);
    // Un seul geste de gomme qui coupe les trois traits.
    await penStroke(page, cdp, line(b.x + 300, b.y + 190, b.x + 300, b.y + 370, 18));
    expect(await strokeCount(page)).toBe(6);
    expect((await history(page)).undo).toBe(4); // un geste de gomme = une action
    await page.getByRole('button', { name: 'Sélection' }).click();
    await penStroke(page, cdp, [[b.x + 120, b.y + 190], [b.x + 480, b.y + 190], [b.x + 480, b.y + 370], [b.x + 120, b.y + 370], [b.x + 120, b.y + 191]]);
    await expect(page.getByRole('toolbar', { name: 'Sélection' })).toBeVisible();
    // Déplacement continu (40 positions) = une seule action.
    await penStroke(page, cdp, line(b.x + 200, b.y + 230, b.x + 260, b.y + 300, 40));
    expect((await history(page)).undo).toBe(5);
    const final = await snapshot(page);
    const undo = page.getByRole('button', { name: 'Annuler', exact: true });
    for (let i = 0; i < 5; i++) await undo.click();
    await expect(undo).toBeDisabled();
    expect(await snapshot(page)).toEqual([]);
    const redo = page.getByRole('button', { name: 'Rétablir', exact: true });
    for (let i = 0; i < 5; i++) await redo.click();
    await expect(redo).toBeDisabled();
    expect(await snapshot(page)).toEqual(final);
    // Après rechargement, l'état final est bien celui enregistré.
    await waitSaved(page);
    await page.reload();
    await page.waitForFunction(() => window.__calame?.session.strokeCount() === 6);
    expect(await snapshot(page)).toEqual(final);
  });

  test('annuler / rétablir au clavier, et branche de rétablissement supprimée après une nouvelle action', async ({ page }) => {
    await start(page, 'Clavier');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 100, b.y + 150, b.x + 300, b.y + 150));
    await penStroke(page, cdp, line(b.x + 100, b.y + 250, b.x + 300, b.y + 250));
    await page.keyboard.press('ControlOrMeta+z');
    expect(await strokeCount(page)).toBe(1);
    await page.keyboard.press('ControlOrMeta+y');
    expect(await strokeCount(page)).toBe(2);
    await page.keyboard.press('ControlOrMeta+z');
    await penStroke(page, cdp, line(b.x + 100, b.y + 350, b.x + 300, b.y + 350));
    await expect(page.getByRole('button', { name: 'Rétablir', exact: true })).toBeDisabled();
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await strokeCount(page)).toBe(2);
  });

  test('changement de page + annulation : la page concernée est affichée avant d’annuler', async ({ page }) => {
    await start(page, 'Pages et historique');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 150, b.y + 200, b.x + 400, b.y + 200));
    await page.getByRole('button', { name: 'Ajouter une page après celle-ci' }).click();
    await expect(page.locator('.page-count').first()).toContainText('2');
    expect(await pageIndex(page)).toBe(1);
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    expect(await pageIndex(page)).toBe(0); // retour sur la page du trait
    expect(await snapshot(page, 0)).toEqual([]);
    expect(await snapshot(page, 1)).toEqual([]);
  });

  test('gomme : taille réglable, aperçu exact au zoom, trait entier', async ({ page }) => {
    await start(page, 'Gomme');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 150, b.y + 250, b.x + 450, b.y + 250, 20));
    await openToolPanel(page, 'Gomme');
    await page.getByRole('button', { name: 'Diamètre 24 pixels' }).click();
    await closePanel(page);
    // À 28 px du trait (écran) : hors d'une gomme de 24 px de diamètre.
    await penStroke(page, cdp, line(b.x + 300, b.y + 278, b.x + 330, b.y + 278, 4));
    expect(await strokeCount(page)).toBe(1);
    await openToolPanel(page, 'Gomme');
    await page.getByRole('button', { name: 'Diamètre 64 pixels' }).click();
    await closePanel(page);
    await penStroke(page, cdp, line(b.x + 300, b.y + 278, b.x + 330, b.y + 278, 4));
    expect(await strokeCount(page)).toBe(0);
    await page.keyboard.press('ControlOrMeta+z');
    // Zoom ×2 centré sur le trait : la gomme garde son diamètre à l'écran (64 px).
    await page.mouse.move(b.x + 300, b.y + 250);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -208);
    await page.keyboard.up('Control');
    await nextFrame(page);
    const [sx, sy] = (await page.evaluate(() => {
      const s = window.__calame!.session;
      const st = s.getStrokes(s.notebook.pageIds[0])[0];
      const mid = Math.floor(st.points.length / 5 / 2) * 5;
      return window.__calame!.engine.pageToScreen(st.pageId, st.points[mid], st.points[mid + 1]);
    }))!;
    expect(sx).toBeGreaterThan(20);
    expect(sx).toBeLessThan(b.width - 40);
    const [rw, sc] = await page.evaluate(() => [window.__calame!.engine.eraserRadiusWorld(), window.__calame!.engine.vp.scale]);
    expect(rw * sc).toBeCloseTo(32, 5); // rayon affiché (px écran) = rayon effacé
    await penStroke(page, cdp, line(b.x + sx, b.y + sy + 40, b.x + sx + 20, b.y + sy + 40, 4));
    expect(await strokeCount(page)).toBe(1); // 40 px > 32 px de rayon
    await penStroke(page, cdp, line(b.x + sx, b.y + sy + 26, b.x + sx + 20, b.y + sy + 26, 4));
    expect(await strokeCount(page)).toBe(0); // 26 px < 32 px + demi-épaisseur
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('calame:prefs:v2')!).settings.eraserSize);
    expect(saved).toBe(64); // dernière taille mémorisée
  });

  test('sélection : règle « entièrement inclus » vs « touchés » sur un long trait', async ({ page }) => {
    await start(page, 'Règles');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    // Début lent (beaucoup de points) dans la zone, longue queue rapide hors de la zone.
    await penStroke(page, cdp, [...line(b.x + 150, b.y + 220, b.x + 200, b.y + 220, 30), ...line(b.x + 205, b.y + 220, b.x + 600, b.y + 220, 3)]);
    // Trait voisin entièrement hors zone, mais dont la boîte englobante croise la zone.
    await penStroke(page, cdp, line(b.x + 100, b.y + 300, b.x + 700, b.y + 170, 20));
    await page.getByRole('button', { name: 'Sélection' }).click();
    const lasso: [number, number][] = [[b.x + 140, b.y + 205], [b.x + 230, b.y + 205], [b.x + 230, b.y + 235], [b.x + 140, b.y + 235], [b.x + 140, b.y + 206]];
    await penStroke(page, cdp, lasso);
    await expect(page.getByRole('toolbar', { name: 'Sélection' })).toHaveCount(0); // inclusion : rien
    await openToolPanel(page, 'Sélection');
    await page.getByRole('radio', { name: 'Touchés' }).click();
    await closePanel(page);
    await penStroke(page, cdp, lasso);
    await expect(page.getByRole('toolbar', { name: 'Sélection' })).toContainText('1 élément');
    const ids = await page.evaluate(() => window.__calame!.engine.selectionIds());
    const firstId = await page.evaluate(() => {
      const s = window.__calame!.session;
      return s.getStrokes(s.notebook.pageIds[0])[0].id;
    });
    expect(ids).toEqual([firstId]); // le trait voisin (boîte seulement) n'est pas pris
  });

  test('sélection rectangulaire et carrée, déplacement, redimensionnement, épaisseur, couleur', async ({ page }) => {
    await start(page, 'Rectangle');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 150, b.y + 200, b.x + 250, b.y + 200, 8));
    await penStroke(page, cdp, line(b.x + 150, b.y + 300, b.x + 250, b.y + 300, 8));
    await openToolPanel(page, 'Sélection');
    await page.getByRole('radio', { name: 'Rectangle' }).click();
    await closePanel(page);
    // Rectangle plat : seul le premier trait.
    await penStroke(page, cdp, line(b.x + 130, b.y + 180, b.x + 280, b.y + 230, 6));
    await expect(page.getByRole('toolbar', { name: 'Sélection' })).toContainText('1 élément');
    // Mode carré : le même geste couvre un carré de 150 px de côté → les deux traits.
    await openToolPanel(page, 'Sélection');
    await page.getByRole('radio', { name: 'Carré' }).click();
    await closePanel(page);
    await penStroke(page, cdp, [[b.x + 600, b.y + 600], [b.x + 610, b.y + 610]]); // vide la sélection
    await penStroke(page, cdp, line(b.x + 130, b.y + 180, b.x + 280, b.y + 230, 6));
    await expect(page.getByRole('toolbar', { name: 'Sélection' })).toContainText('2 éléments');
    const before = await snapshot(page);
    await page.getByRole('button', { name: 'Traits plus épais' }).click();
    await page.getByRole('button', { name: 'Couleur de la sélection' }).click();
    await page.getByRole('button', { name: 'Recolorer en #c0392b' }).click();
    const colors = await page.evaluate(() => {
      const s = window.__calame!.session;
      return s.getStrokes(s.notebook.pageIds[0]).map((x) => x.color);
    });
    expect(colors).toEqual(['#c0392b', '#c0392b']);
    // Poignée bas-droite : agrandissement.
    const rect = (await page.locator('.sel-bar').boundingBox())!;
    expect(rect).toBeTruthy();
    const h = await page.evaluate(() => {
      const e = window.__calame!.engine as unknown as { selectionScreenRect(): { x: number; y: number; w: number; h: number } };
      return e.selectionScreenRect();
    });
    await penStroke(page, cdp, line(b.x + h.x + h.w + 8, b.y + h.y + h.h + 8, b.x + h.x + h.w + 60, b.y + h.y + h.h + 60, 10));
    const after = await page.evaluate(() => {
      const s = window.__calame!.session;
      return s.getStrokes(s.notebook.pageIds[0]).map((x) => x.width);
    });
    const widthsBefore = before.map((x) => Number(x.split('|')[2]));
    expect(after[0]).toBeGreaterThan(widthsBefore[0] * 1.33);
    // Annulations : redimensionnement, couleur, épaisseur → retour à l'état initial.
    for (let i = 0; i < 3; i++) await page.keyboard.press('ControlOrMeta+z');
    expect(await snapshot(page)).toEqual(before);
  });

  test('sélection + navigation : changer de page vide la sélection sans rien déplacer', async ({ page }) => {
    await start(page, 'Sélection et pages');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 150, b.y + 200, b.x + 250, b.y + 200, 8));
    await page.getByRole('button', { name: 'Ajouter une page après celle-ci' }).click();
    await page.getByRole('button', { name: 'Page précédente' }).first().click();
    await page.waitForFunction(() => window.__calame!.engine.currentPageIndex() === 0);
    const before = await snapshot(page);
    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.getByRole('toolbar', { name: 'Sélection' })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('toolbar', { name: 'Sélection' })).toHaveCount(0);
    await page.keyboard.press('ArrowLeft');
    expect(await snapshot(page)).toEqual(before);
  });

  test('texte : création, mise en forme, persistance, annulation', async ({ page }) => {
    await start(page, 'Texte');
    const b = await hostBox(page);
    await openToolPanel(page, 'Texte');
    await page.getByRole('radio', { name: 'Code' }).click();
    await page.getByLabel('Taille du texte').selectOption('22');
    await page.getByRole('button', { name: 'Gras' }).click();
    await closePanel(page);
    await page.mouse.click(b.x + 200, b.y + 260);
    const ta = page.getByLabel('Texte du bloc');
    await expect(ta).toBeVisible();
    await ta.fill('List<String> noms = new ArrayList<>();');
    await page.mouse.click(b.x + 500, b.y + 700); // valide (et ouvre un autre bloc vide)
    await page.keyboard.press('Escape');
    const items = await page.evaluate(() => {
      const s = window.__calame!.session;
      return s.getItems(s.notebook.pageIds[0]).map((i) => ({ ...i }));
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'text', font: 'mono', size: 22, bold: true, text: 'List<String> noms = new ArrayList<>();' });
    await waitSaved(page);
    await page.reload();
    await page.waitForFunction(() => window.__calame?.session.itemCount() === 1);
    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => window.__calame!.session.itemCount())).toBe(1); // historique non conservé après rechargement
  });

  test('écriture à la souris (bureau)', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium-desktop');
    await start(page, 'Souris');
    const b = await hostBox(page);
    await page.mouse.move(b.x + 200, b.y + 200);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 200 + i * 15, b.y + 200 + i * 4);
    await page.mouse.up();
    expect(await strokeCount(page)).toBe(1);
    expect(await page.evaluate(() => {
      const s = window.__calame!.session;
      return s.getStrokes(s.notebook.pageIds[0])[0].style.realPressure;
    })).toBe(false);
  });
});

test.describe('Navigation horizontale et doigt @cdp', () => {
  test.skip(({ browserName, hasTouch }) => browserName !== 'chromium' || !hasTouch, 'tactile Chromium requis');

  async function threePages(page: Page) {
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Ajouter une page après celle-ci' }).click();
    await page.getByRole('button', { name: 'Miniatures des pages' }).click();
    await page.getByRole('button', { name: 'Aller à la page 1' }).click();
    await page.getByRole('button', { name: 'Miniatures des pages' }).click();
    await page.waitForFunction(() => window.__calame!.engine.currentPageIndex() === 0);
    await page.waitForTimeout(300);
  }

  test('stylet uniquement : balayer à gauche/droite change de page avec arrêt net ; petit geste = pas de changement', async ({ page }) => {
    await start(page, 'Balayage', { settings: { fingerMode: 'pen-only' } });
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await threePages(page);
    await touchGesture(cdp, swipe(b.x + 600, b.y + 500, -400));
    await page.waitForTimeout(400);
    expect(await pageIndex(page)).toBe(1);
    // Arrêt net : la page est centrée (tx sur la position de repos).
    const tx = await page.evaluate(() => window.__calame!.engine.vp.tx);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__calame!.engine.vp.tx)).toBeCloseTo(tx, 3);
    await touchGesture(cdp, swipe(b.x + 200, b.y + 500, 400));
    await page.waitForTimeout(400);
    expect(await pageIndex(page)).toBe(0);
    await touchGesture(cdp, swipe(b.x + 600, b.y + 500, -40));
    await page.waitForTimeout(400);
    expect(await pageIndex(page)).toBe(0);
    expect(await strokeCount(page)).toBe(0); // le doigt n'a jamais écrit
  });

  test('page agrandie : le doigt déplace d’abord dans la page, sans changer de page', async ({ page }) => {
    await start(page, 'Zoom et pages', { settings: { fingerMode: 'pen-only' } });
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await threePages(page);
    await page.evaluate(() => window.__calame!.engine.zoomBy(2.5));
    await page.waitForTimeout(200);
    const tx0 = await page.evaluate(() => window.__calame!.engine.vp.tx);
    await touchGesture(cdp, swipe(b.x + 600, b.y + 500, -150));
    await page.waitForTimeout(400);
    expect(await pageIndex(page)).toBe(0);
    expect(await page.evaluate(() => window.__calame!.engine.vp.tx)).toBeLessThan(tx0 - 100);
  });

  test('doigt et stylet : un doigt écrit, deux doigts tournent la page, le stylet n’en tourne jamais', async ({ page }) => {
    await start(page, 'Doigt', { settings: { fingerMode: 'finger-and-pen' } });
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await threePages(page);
    await touchGesture(cdp, swipe(b.x + 600, b.y + 400, -300, 1));
    expect(await strokeCount(page)).toBe(1); // un doigt : trait
    expect(await pageIndex(page)).toBe(0);
    await touchGesture(cdp, swipe(b.x + 600, b.y + 500, -400, 2));
    await page.waitForTimeout(400);
    expect(await pageIndex(page)).toBe(1); // deux doigts : page suivante
    expect(await strokeCount(page)).toBe(1);
    await penStroke(page, cdp, line(b.x + 700, b.y + 400, b.x + 100, b.y + 400, 30)); // long trait horizontal au stylet
    await page.waitForTimeout(300);
    expect(await pageIndex(page)).toBe(1);
  });

  test('pincement = zoom sans changement de page ; paume pendant l’écriture au stylet ignorée', async ({ page }) => {
    await start(page, 'Pincement', { settings: { fingerMode: 'pen-only' } });
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await threePages(page);
    const s0 = await page.evaluate(() => window.__calame!.engine.vp.scale);
    await touchGesture(
      cdp,
      Array.from({ length: 10 }, (_, i) => [
        [b.x + 350 - i * 20, b.y + 500],
        [b.x + 450 + i * 20, b.y + 500],
      ]),
    );
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__calame!.engine.vp.scale)).toBeGreaterThan(s0 * 1.5);
    expect(await pageIndex(page)).toBe(0);
    // Paume posée et déplacée pendant un tracé au stylet : ignorée (ni défilement ni trait parasite).
    const ty0 = await page.evaluate(() => window.__calame!.engine.vp.ty);
    const pen = { pointerType: 'pen' as const, button: 'left' as const, force: 0.5 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x + 200, y: b.y + 300, buttons: 1, clickCount: 1, ...pen });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + 500, y: b.y + 700, id: 9, radiusX: 30, radiusY: 30 }] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x + 200 + i * 20, y: b.y + 300, buttons: 1, ...pen });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + 500, y: b.y + 700 - i * 40, id: 9, radiusX: 30, radiusY: 30 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x + 320, y: b.y + 300, buttons: 0, clickCount: 1, ...pen });
    await nextFrame(page);
    expect(await strokeCount(page)).toBe(1);
    expect(await page.evaluate(() => window.__calame!.engine.vp.ty)).toBeCloseTo(ty0, 3);
  });
});
