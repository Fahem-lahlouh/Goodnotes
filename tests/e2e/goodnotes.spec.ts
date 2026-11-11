import { expect, test, type Page } from '@playwright/test';
import { createNotebook, hostBox, line, nextFrame, penStroke, setPrefs, strokeCount, swipe, touchGesture } from './helpers';

/**
 * Fonctions inspirées de Goodnotes : menus Outils et Plus, fenêtre de zoom (marges, cadre),
 * Formes, pointeur laser, règle, alignement des objets, notes repositionnables, minuteur,
 * favoris et plan, modèle de page, suppression par type, tirer pour ajouter une page,
 * affichage sur téléphone.
 */

async function start(page: Page, title: string, settings: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  await page.goto('./');
  await setPrefs(page, { penDetected: true, settings: { shapeHold: false, ...settings }, ...extra });
  await page.reload();
  await createNotebook(page, title);
}

const tools = (page: Page) => page.getByRole('dialog', { name: 'Outils' });
async function openTools(page: Page) {
  await page.getByRole('button', { name: 'Outils', exact: true }).click();
  await expect(tools(page)).toBeVisible();
}
const more = (page: Page) => page.getByRole('dialog', { name: 'Plus' });
async function openMore(page: Page) {
  await page.getByRole('button', { name: 'Plus', exact: true }).click();
  await expect(more(page)).toBeVisible();
}
const undoBtn = (page: Page) => page.getByRole('button', { name: 'Annuler', exact: true });
const zoomState = (page: Page) => page.evaluate(() => window.__calame!.engine.zoomState());

test.describe('Téléphone (390 × 844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('barres lisibles, menu Outils toujours visible, fenêtre de zoom accessible et utilisable', async ({ page }) => {
    await start(page, 'Téléphone');
    const vw = 390;
    const outils = page.getByRole('button', { name: 'Outils', exact: true });
    const plus = page.getByRole('button', { name: 'Plus', exact: true });
    for (const b of [outils, plus, undoBtn(page)]) {
      const box = (await b.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vw);
    }
    // La navigation de pages ne chevauche plus les boutons de droite.
    const nav = (await page.locator('.topbar .page-nav').boundingBox())!;
    const plusBox = (await plus.boundingBox())!;
    expect(nav.x + nav.width).toBeLessThanOrEqual(plusBox.x);
    await openTools(page);
    await tools(page).getByRole('button', { name: /^Fenêtre de zoom/ }).click();
    await expect(page.getByTestId('zoom-host')).toBeVisible();
    const zb = (await page.getByTestId('zoom-host').boundingBox())!;
    expect(zb.height).toBeGreaterThan(100);
    // Écriture dans la fenêtre (événements synthétiques : fonctionne aussi sous WebKit).
    await page.evaluate(() => {
      const el = document.querySelector('.zoom-host .ink-live')!;
      const r = el.getBoundingClientRect();
      const ev = (type: string, x: number) =>
        el.dispatchEvent(new PointerEvent(type, { pointerId: 601, pointerType: 'pen', clientX: r.left + x, clientY: r.top + r.height / 2, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5, bubbles: true }));
      ev('pointerdown', 30);
      for (let x = 40; x <= 140; x += 10) ev('pointermove', x);
      ev('pointerup', 140);
    });
    expect(await strokeCount(page)).toBe(1);
    // Menu Plus accessible.
    await page.getByRole('button', { name: 'Fermer la fenêtre de zoom' }).click();
    await openMore(page);
    await expect(more(page).getByRole('button', { name: 'Ajouter aux favoris' })).toBeVisible();
  });
});

test.describe('Outils et accessoires @cdp', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Stylet piloté via le protocole Chromium');

  test('fenêtre de zoom : marges réglables, retour à la ligne automatique à la marge droite, marges par défaut', async ({ page }) => {
    await start(page, 'Marges', { zoomFactor: 2.5, zoomAutoAdvance: true });
    const cdp = await page.context().newCDPSession(page);
    await page.keyboard.press('z');
    await expect(page.getByTestId('zoom-host')).toBeVisible();
    const z0 = await zoomState(page);
    await page.getByRole('button', { name: 'Augmenter la marge gauche' }).click();
    const z1 = await zoomState(page);
    expect(z1.marginLeft).toBeGreaterThan(z0.marginLeft);
    expect(z1.x).toBeCloseTo(z1.marginLeft, 3);
    await page.getByRole('button', { name: 'Réduire la marge gauche' }).click();
    expect((await zoomState(page)).marginLeft).toBeCloseTo(z0.marginLeft, 3);
    // Cadre amené contre la marge droite, puis un mot écrit dans la zone d'avance : passage à la ligne.
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Avancer le cadre' }).click();
    const zr = await zoomState(page);
    expect(zr.x + zr.w).toBeCloseTo(zr.marginRight, 0);
    const zb = (await page.getByTestId('zoom-host').boundingBox())!;
    await penStroke(page, cdp, line(zb.x + zb.width * 0.65, zb.y + zb.height * 0.5, zb.x + zb.width * 0.9, zb.y + zb.height * 0.5, 10));
    const zn = await zoomState(page);
    expect(zn.x).toBeCloseTo(zn.marginLeft, 3);
    expect(zn.y).toBeGreaterThan(zr.y);
    // Marge droite réglable, puis retour aux marges par défaut (menu « … »).
    await page.getByRole('button', { name: 'Options de la fenêtre de zoom' }).click();
    await page.getByRole('button', { name: 'Rapprocher la marge droite' }).click();
    expect((await zoomState(page)).marginRight).toBeLessThan(zn.marginRight);
    await page.getByRole('button', { name: 'Marges par défaut' }).click();
    expect((await zoomState(page)).marginRight).toBeCloseTo(zn.marginRight, 3);
  });

  test('fenêtre de zoom au doigt : toucher la page place le cadre à cet endroit', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium-ipad', 'Gestes tactiles : profil iPad');
    await start(page, 'Cadre au doigt', { fingerMode: 'pen-only' });
    const cdp = await page.context().newCDPSession(page);
    await page.getByRole('button', { name: 'Fenêtre de zoom' }).click();
    const b = await hostBox(page);
    const target = await page.evaluate(() => {
      const e = window.__calame!.engine;
      const id = window.__calame!.session.notebook.pageIds[0];
      return e.pageToScreen(id, 300, 700)!;
    });
    await touchGesture(cdp, [[[b.x + target[0], b.y + target[1]]], [[b.x + target[0], b.y + target[1]]]]);
    const z = await zoomState(page);
    expect(300 - z.x).toBeGreaterThan(0);
    expect(300 - z.x).toBeLessThan(z.w);
    expect(700 - z.y).toBeGreaterThan(0);
    expect(700 - z.y).toBeLessThan(z.h);
    expect(await strokeCount(page)).toBe(0);
  });

  test('outil Formes : chaque tracé devient une forme nette, sans maintien ; un tracé quelconque reste libre', async ({ page }) => {
    await start(page, 'Formes');
    const cdp = await page.context().newCDPSession(page);
    await openTools(page);
    await tools(page).getByRole('button', { name: /^Formes/ }).click();
    await expect(page.getByRole('button', { name: 'Formes', exact: true })).toHaveCount(0); // pas dans la barre par défaut
    const b = await hostBox(page);
    const cx = b.x + 300;
    const cy = b.y + 320;
    const circle: [number, number][] = Array.from({ length: 49 }, (_, k) => {
      const t = (k / 48) * Math.PI * 2;
      const r = 70 + (k % 2 ? 2.5 : -2.5);
      return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
    });
    await penStroke(page, cdp, circle);
    const pts = await page.evaluate(() => {
      const s = window.__calame!.session;
      const st = s.getStrokes(s.notebook.pageIds[0])[0];
      const out: [number, number][] = [];
      for (let i = 0; i < st.points.length; i += 5) out.push([st.points[i], st.points[i + 1]]);
      return out;
    });
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    const radii = pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.5);
    await expect(undoBtn(page)).toHaveAttribute('title', /Forme : Cercle/);
    // Gribouillis : gardé tel quel.
    await penStroke(page, cdp, Array.from({ length: 30 }, (_, k) => [b.x + 150 + k * 8, b.y + 520 + (k % 2 ? 15 : -15)] as [number, number]));
    expect(await strokeCount(page)).toBe(2);
    await expect(undoBtn(page)).toHaveAttribute('title', /Annuler : Trait/);
  });

  test('pointeur laser : trait lumineux affiché puis effacé, jamais enregistré', async ({ page }) => {
    await start(page, 'Laser');
    const cdp = await page.context().newCDPSession(page);
    await openTools(page);
    await tools(page).getByRole('button', { name: /^Pointeur laser/ }).click();
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 150, b.y + 250, b.x + 450, b.y + 260, 20));
    const red = () =>
      page.evaluate(() => {
        const c = document.querySelector('.ink-host:not(.zoom-host) .ink-live') as HTMLCanvasElement;
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100 && d[i] > 200 && d[i + 1] < 120 && d[i + 2] < 120) n++;
        return n;
      });
    expect(await red()).toBeGreaterThan(50);
    expect(await strokeCount(page)).toBe(0);
    expect((await page.evaluate(() => window.__calame!.session.historySize)).undo).toBe(0);
    await page.waitForTimeout(1600);
    await nextFrame(page);
    expect(await red()).toBe(0);
  });

  test('règle : tracé collé au bord (droite exacte), rotation, déplacement sans tracer', async ({ page }) => {
    await start(page, 'Règle');
    const cdp = await page.context().newCDPSession(page);
    await page.keyboard.press('r');
    await expect(page.getByRole('group', { name: 'Règle' })).toBeVisible();
    const b = await hostBox(page);
    const ruler = async () => {
      const r = await page.evaluate(() => {
        const e = window.__calame!.engine;
        const st = e.rulerState()!;
        const [sx, sy] = e.vp.toScreen(st.x, st.y);
        return { ...st, sx, sy };
      });
      return r;
    };
    let r = await ruler();
    expect(r.angle).toBe(0);
    // Tracé tremblé juste sous le bord inférieur : il devient une droite horizontale.
    const y = b.y + r.sy + 38 + 12;
    await penStroke(page, cdp, Array.from({ length: 25 }, (_, k) => [b.x + r.sx - 150 + k * 12, y + (k % 2 ? 4 : -4)] as [number, number]));
    expect(await strokeCount(page)).toBe(1);
    const ys = await page.evaluate(() => {
      const s = window.__calame!.session;
      const st = s.getStrokes(s.notebook.pageIds[0])[0];
      const out: number[] = [];
      for (let i = 1; i < st.points.length; i += 5) out.push(st.points[i]);
      return out;
    });
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01);
    // Rotation par les boutons, puis tracé le long du bord incliné.
    await page.getByRole('button', { name: 'Tourner la règle de +15°' }).click();
    r = await ruler();
    expect((r.angle * 180) / Math.PI).toBeCloseTo(15, 3);
    const nx = -Math.sin(r.angle);
    const ny = Math.cos(r.angle);
    const ex = b.x + r.sx + nx * 50;
    const ey = b.y + r.sy + ny * 50;
    await penStroke(page, cdp, Array.from({ length: 20 }, (_, k) => [ex - 100 * Math.cos(r.angle) + k * 10 * Math.cos(r.angle) + (k % 2 ? 3 : -3), ey - 100 * Math.sin(r.angle) + k * 10 * Math.sin(r.angle)] as [number, number]));
    const dirOk = await page.evaluate((angle) => {
      const s = window.__calame!.session;
      const st = s.getStrokes(s.notebook.pageIds[0])[1];
      const p = st.points;
      const n = p.length / 5;
      const dx = p[(n - 1) * 5] - p[0];
      const dy = p[(n - 1) * 5 + 1] - p[1];
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const vx = p[i * 5] - p[0];
        const vy = p[i * 5 + 1] - p[1];
        worst = Math.max(worst, Math.abs(vx * Math.sin(angle) - vy * Math.cos(angle)));
      }
      return { ang: Math.atan2(dy, dx), worst };
    }, r.angle);
    expect(dirOk.ang).toBeCloseTo(r.angle, 3);
    expect(dirOk.worst).toBeLessThan(0.01);
    // Déplacer la règle par son corps : aucun trait.
    await penStroke(page, cdp, line(b.x + r.sx, b.y + r.sy, b.x + r.sx, b.y + r.sy + 120, 8));
    const r2 = await ruler();
    expect(r2.sy - r.sy).toBeCloseTo(120, 0);
    expect(await strokeCount(page)).toBe(2);
    await page.getByRole('button', { name: 'Masquer la règle' }).click();
    expect(await page.evaluate(() => window.__calame!.engine.rulerState())).toBeNull();
  });

  test('règle à deux doigts : rotation', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium-ipad', 'Gestes tactiles : profil iPad');
    await start(page, 'Règle doigts', { fingerMode: 'pen-only' });
    const cdp = await page.context().newCDPSession(page);
    await page.keyboard.press('r');
    const b = await hostBox(page);
    const r = await page.evaluate(() => {
      const e = window.__calame!.engine;
      const st = e.rulerState()!;
      return e.vp.toScreen(st.x, st.y);
    });
    const cx = b.x + r[0];
    const cy = b.y + r[1];
    const frames: [number, number][][] = Array.from({ length: 10 }, (_, i) => {
      const a = (i / 9) * (Math.PI / 6); // 30°
      return [
        [cx - 100 * Math.cos(a), cy - 100 * Math.sin(a)],
        [cx + 100 * Math.cos(a), cy + 100 * Math.sin(a)],
      ];
    });
    await touchGesture(cdp, frames);
    const angle = await page.evaluate(() => window.__calame!.engine.rulerState()!.angle);
    expect((angle * 180) / Math.PI).toBeGreaterThan(25);
    expect((angle * 180) / Math.PI).toBeLessThan(35);
    expect(await strokeCount(page)).toBe(0);
  });

  test('aligner les objets : une sélection déplacée s’aimante sur le bord d’un autre élément', async ({ page }) => {
    await start(page, 'Alignement', { selectMode: 'lasso' });
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 150, b.y + 200, b.x + 350, b.y + 200, 20));
    await penStroke(page, cdp, line(b.x + 190, b.y + 400, b.x + 390, b.y + 400, 20));
    await page.keyboard.press('s');
    await penStroke(page, cdp, [[b.x + 170, b.y + 370], [b.x + 410, b.y + 370], [b.x + 410, b.y + 430], [b.x + 170, b.y + 430], [b.x + 170, b.y + 371]]);
    await expect(page.getByRole('toolbar', { name: 'Sélection' })).toBeVisible();
    // Déplacement de −37 px : le bord gauche arrive à 3 px de celui du premier trait.
    await penStroke(page, cdp, line(b.x + 290, b.y + 400, b.x + 253, b.y + 400, 12));
    const bb = await page.evaluate(() => {
      const s = window.__calame!.session;
      return s.getStrokes(s.notebook.pageIds[0]).map((x) => x.bbox);
    });
    // Aimanté : bord gauche, centre ou bord droit exactement alignés sur ceux du premier trait.
    const cands = [
      Math.abs(bb[0][0] - bb[1][0]),
      Math.abs((bb[0][0] + bb[0][2]) / 2 - (bb[1][0] + bb[1][2]) / 2),
      Math.abs(bb[0][2] - bb[1][2]),
    ];
    expect(Math.min(...cands)).toBeLessThan(0.01);
    // Sans aimantation (réglage désactivé), le même geste laisse un écart.
    await page.evaluate(() => {
      const e = window.__calame!.engine;
      e.setSettings({ ...e.settings, alignObjects: false });
    });
    await undoBtn(page).click();
    await penStroke(page, cdp, [[b.x + 170, b.y + 370], [b.x + 410, b.y + 370], [b.x + 410, b.y + 430], [b.x + 170, b.y + 430], [b.x + 170, b.y + 371]]);
    await expect(page.getByRole('toolbar', { name: 'Sélection' })).toBeVisible();
    const before = await page.evaluate(() => window.__calame!.session.getStrokes(window.__calame!.session.notebook.pageIds[0])[1].bbox[0]);
    await penStroke(page, cdp, line(b.x + 290, b.y + 400, b.x + 253, b.y + 400, 12));
    const scale = await page.evaluate(() => window.__calame!.engine.vp.scale);
    const bb2 = await page.evaluate(() => {
      const s = window.__calame!.session;
      return s.getStrokes(s.notebook.pageIds[0]).map((x) => x.bbox);
    });
    // Déplacé exactement du geste (−37 px), sans correction.
    expect((bb2[1][0] - before) * scale).toBeCloseTo(-37, 0);
    expect(Math.abs(bb2[0][0] - bb2[1][0])).toBeGreaterThan(0.5);
  });

  test('notes repositionnables : création, couleur, texte, annulation', async ({ page }) => {
    await start(page, 'Notes');
    await openTools(page);
    await tools(page).getByRole('button', { name: 'Note #bfdbfe' }).click();
    const ed = page.locator('textarea.text-editor');
    await expect(ed).toBeVisible();
    await ed.fill('Acheter du pain');
    await page.keyboard.press('Escape');
    await expect(ed).toHaveCount(0);
    const it = await page.evaluate(() => {
      const s = window.__calame!.session;
      return s.getItems(s.notebook.pageIds[0])[0] as { text: string; note?: string; w: number; h: number };
    });
    expect(it.text).toBe('Acheter du pain');
    expect(it.note).toBe('#bfdbfe');
    expect(it.h).toBeGreaterThanOrEqual(it.w * 0.8 - 0.01);
    await expect(undoBtn(page)).toHaveAttribute('title', /Ajouter une note/);
    await undoBtn(page).click();
    expect(await page.evaluate(() => window.__calame!.session.itemCount())).toBe(0);
  });

  test('minuteur : chronomètre, pause, remise à zéro', async ({ page }) => {
    await start(page, 'Minuteur');
    await openTools(page);
    await tools(page).getByRole('button', { name: /^Minuteur/ }).click();
    const tk = page.getByRole('group', { name: 'Minuteur' });
    await expect(tk).toBeVisible();
    await tk.getByRole('button', { name: 'Démarrer' }).click();
    await page.waitForTimeout(1300);
    await tk.getByRole('button', { name: 'Pause' }).click();
    await expect(tk.getByLabel('Temps')).toHaveText('00:01');
    await tk.getByRole('button', { name: 'Remettre à zéro' }).click();
    await expect(tk.getByLabel('Temps')).toHaveText('00:00');
    await tk.getByRole('radio', { name: 'Minuteur' }).click();
    await expect(tk.getByLabel('Temps')).toHaveText('05:00');
  });

  test('personnalisation de la barre d’outils et position d’annuler', async ({ page }) => {
    await start(page, 'Barre');
    const bar = page.getByRole('toolbar', { name: "Outils d'écriture" });
    await expect(bar.getByRole('button', { name: 'Règle', exact: true })).toHaveCount(0);
    await openTools(page);
    await tools(page).getByRole('button', { name: /Personnalisation de la barre/ }).click();
    const dlg = page.getByRole('dialog', { name: /Personnalisation/ });
    await dlg.getByRole('switch', { name: 'Règle' }).check();
    await dlg.getByRole('switch', { name: 'Surligneur' }).uncheck();
    await dlg.getByRole('radiogroup', { name: "Position d'annulation et de rétablissement" }).getByRole('radio', { name: 'Droite' }).click();
    await dlg.getByRole('button', { name: 'Fermer' }).click();
    await expect(bar.getByRole('button', { name: 'Règle', exact: true })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Surligneur', exact: true })).toHaveCount(0);
    const u = (await undoBtn(page).boundingBox())!;
    const o = (await page.getByRole('button', { name: 'Outils', exact: true }).boundingBox())!;
    expect(u.x).toBeGreaterThan(o.x);
    await bar.getByRole('button', { name: 'Règle', exact: true }).click();
    expect(await page.evaluate(() => !!window.__calame!.engine.rulerState())).toBe(true);
  });
});

test.describe('Menu Plus @cdp', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Stylet piloté via le protocole Chromium');

  test('favoris et plan : ajout, panneau des pages, navigation', async ({ page }) => {
    await start(page, 'Favoris');
    await page.getByRole('button', { name: 'Ajouter une page après celle-ci' }).click();
    await expect(page.locator('.page-count').first()).toContainText('2');
    await openMore(page);
    await more(page).getByRole('button', { name: 'Ajouter aux favoris' }).click();
    await openMore(page);
    await more(page).getByRole('button', { name: /^Ajouter la page au plan/ }).click();
    await page.getByLabel('Titre dans le plan').fill('Chapitre 2');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect.poll(() => page.evaluate(() => window.__calame!.session.notebook.outline?.length ?? 0)).toBe(1);
    const nb = await page.evaluate(() => {
      const s = window.__calame!.session;
      return { pages: s.notebook.pageIds, bookmarks: s.notebook.bookmarks, outline: s.notebook.outline };
    });
    expect(nb.bookmarks).toEqual([nb.pages[1]]);
    expect(nb.outline).toEqual([{ pageId: nb.pages[1], title: 'Chapitre 2' }]);
    // Conservé après rechargement.
    await page.reload();
    await page.waitForFunction(() => !!window.__calame);
    expect(await page.evaluate(() => window.__calame!.session.notebook.outline?.[0]?.title)).toBe('Chapitre 2');
    await page.getByRole('button', { name: 'Miniatures des pages' }).click();
    await page.getByRole('tab', { name: 'Favoris (1)' }).click();
    await expect(page.locator('.pages-list li')).toHaveCount(1);
    await page.getByRole('tab', { name: 'Plan (1)' }).click();
    await page.keyboard.press('ArrowLeft');
    await page.getByRole('button', { name: /Chapitre 2/ }).click();
    await expect.poll(() => page.evaluate(() => window.__calame!.engine.currentPageIndex())).toBe(1);
  });

  test('changer de modèle (cette page), accéder à la page, copier la page', async ({ page }) => {
    await start(page, 'Modèle');
    await page.getByRole('button', { name: 'Ajouter une page après celle-ci' }).click();
    await page.getByRole('button', { name: 'Ajouter une page après celle-ci' }).click();
    await openMore(page);
    await more(page).getByRole('button', { name: /^Accéder à la page/ }).click();
    await page.getByLabel(/Numéro de page/).fill('1');
    await page.getByRole('button', { name: 'Aller' }).click();
    await expect.poll(() => page.evaluate(() => window.__calame!.engine.currentPageIndex())).toBe(0);
    await openMore(page);
    await more(page).getByRole('button', { name: 'Changer de modèle' }).click();
    await page.getByRole('radio', { name: 'Quadrillé' }).click();
    await page.getByRole('button', { name: 'Cette page' }).click();
    await expect.poll(() => page.evaluate(() => window.__calame!.session.pageOrder.map((p) => p.paper.kind))).toEqual(['grid', 'lined', 'lined']);
    await page.reload();
    await page.waitForFunction(() => !!window.__calame);
    expect(await page.evaluate(() => window.__calame!.session.pageOrder.map((p) => p.paper.kind))).toEqual(['grid', 'lined', 'lined']);
    await openMore(page);
    await more(page).getByRole('button', { name: /^Copier la page/ }).click();
    await expect.poll(() => page.evaluate(() => window.__calame!.session.pageOrder.length)).toBe(4);
  });

  test('supprimer certains éléments puis effacer la page : une action chacune, annulable', async ({ page }) => {
    await start(page, 'Supprimer');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await penStroke(page, cdp, line(b.x + 150, b.y + 200, b.x + 400, b.y + 200));
    await page.keyboard.press('h');
    await penStroke(page, cdp, line(b.x + 150, b.y + 260, b.x + 400, b.y + 260));
    await page.keyboard.press('p');
    await penStroke(page, cdp, line(b.x + 150, b.y + 320, b.x + 400, b.y + 320));
    const tools3 = () => page.evaluate(() => window.__calame!.session.getStrokes(window.__calame!.session.notebook.pageIds[0]).map((s) => s.tool).sort());
    expect(await tools3()).toEqual(['highlighter', 'pen', 'pen']);
    await openMore(page);
    await more(page).getByRole('button', { name: 'Supprimer certains éléments' }).click();
    const dlg = page.getByRole('dialog', { name: 'Supprimer certains éléments' });
    await dlg.getByRole('switch', { name: 'Surligneur' }).check();
    await dlg.getByRole('button', { name: /Supprimer les éléments de la page \(1\)/ }).click();
    expect(await tools3()).toEqual(['pen', 'pen']);
    await openMore(page);
    await more(page).getByRole('button', { name: 'Effacer la page' }).click();
    await page.getByRole('dialog', { name: 'Effacer la page' }).getByRole('button', { name: 'Effacer la page' }).click();
    expect(await strokeCount(page)).toBe(0);
    await undoBtn(page).click();
    expect(await tools3()).toEqual(['pen', 'pen']);
    await undoBtn(page).click();
    expect(await tools3()).toEqual(['highlighter', 'pen', 'pen']);
  });

  test('réglages du document : numéro de page, barre latérale à gauche, aperçu au survol', async ({ page }) => {
    await start(page, 'Réglages doc');
    await expect(page.locator('.page-badge')).toHaveText('1 / 1');
    await openMore(page);
    await more(page).getByRole('radiogroup', { name: 'Barre latérale' }).getByRole('radio', { name: 'Gauche' }).click();
    await more(page).getByRole('button', { name: 'Modification des documents' }).click();
    const doc = page.getByRole('dialog', { name: 'Modification des documents' });
    await doc.getByRole('switch', { name: 'Afficher le numéro de page' }).uncheck();
    await doc.getByRole('switch', { name: "Afficher l'aperçu du trait au survol" }).uncheck();
    await doc.getByRole('button', { name: 'Fermer' }).click();
    await expect(page.locator('.page-badge')).toHaveCount(0);
    expect(await page.evaluate(() => window.__calame!.engine.settings.hoverPreview)).toBe(false);
    await page.getByRole('button', { name: 'Miniatures des pages' }).click();
    const panel = (await page.locator('.pages-panel').boundingBox())!;
    const host = (await hostBox(page))!;
    expect(panel.x).toBeLessThan(host.x);
  });

  test('tirer au-delà de la dernière page en ajoute une', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium-ipad', 'Gestes tactiles : profil iPad');
    await start(page, 'Tirer', { fingerMode: 'pen-only', pageLayout: 'horizontal' });
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    await touchGesture(cdp, swipe(b.x + b.width * 0.85, b.y + 500, -520, 1, 14));
    await expect.poll(() => page.evaluate(() => window.__calame!.session.pageOrder.length)).toBe(2);
    await expect.poll(() => page.evaluate(() => window.__calame!.engine.currentPageIndex())).toBe(1);
  });
});
