import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createNotebook, hostBox, setPrefs } from './helpers';

/**
 * Netteté du rendu : canvas alignés sur les pixels de l'écran (plusieurs densités), traits lisses
 * malgré des coordonnées arrondies au pixel (comportement de Safari), à plusieurs zooms, dans la
 * fenêtre de zoom, après rechargement et à l'export PNG ; grain réservé au crayon.
 */

async function start(page: Page, title: string) {
  await page.goto('./');
  await setPrefs(page, { penDetected: true, settings: { shapeHold: false, prediction: false } });
  await page.reload();
  await createNotebook(page, title, { template: 'Uni' });
}

test.describe('Canvas alignés sur la grille de pixels', () => {
  for (const dpr of [2, 3, 1.25]) {
    test.describe(`densité ${dpr}`, () => {
      test.use({ deviceScaleFactor: dpr });
      test('page et fenêtre de zoom : 1 pixel de canvas = 1 pixel d’écran', async ({ page }) => {
        await start(page, `Alignement ${dpr}`);
        await page.getByRole('button', { name: 'Outils', exact: true }).click();
        await page.getByRole('dialog', { name: 'Outils' }).getByRole('button', { name: /^Fenêtre de zoom/ }).click();
        await expect(page.getByTestId('zoom-host')).toBeVisible();
        const rows = await page.evaluate(() =>
          [...document.querySelectorAll('canvas.ink-base, canvas.ink-live')].map((c) => {
            const el = c as HTMLCanvasElement;
            const r = el.getBoundingClientRect();
            const d = devicePixelRatio;
            return { left: r.left * d, top: r.top * d, w: r.width * d, h: r.height * d, cw: el.width, ch: el.height };
          }),
        );
        expect(rows).toHaveLength(4);
        for (const r of rows) {
          // Tolérance : précision interne de la mise en page (1/64 px CSS), soit < 0,05 px physique.
          expect(Math.abs(r.left - Math.round(r.left))).toBeLessThan(0.05);
          expect(Math.abs(r.top - Math.round(r.top))).toBeLessThan(0.05);
          // Tolérance : précision interne de la mise en page (1/64 px CSS), soit < 0,05 px physique.
          expect(Math.abs(r.w - r.cw)).toBeLessThan(0.05);
          expect(Math.abs(r.h - r.ch)).toBeLessThan(0.05);
        }
      });
    });
  }
});

/**
 * Mesure d'un trait presque horizontal sur une image : pour chaque colonne, centre de l'encre
 * (barycentre de l'obscurité) et quantité d'encre. Renvoie l'écart quadratique moyen du centre
 * autour d'une droite ajustée (ondulation du trait) et la variation relative de l'épaisseur.
 */
async function measure(page: Page, source: 'main' | 'zoom' | 'png', seg: { a: [number, number]; b: [number, number] }, png?: string) {
  return page.evaluate(
    async ({ source, seg, png }) => {
      let img: ImageData;
      let toPx: (x: number, y: number) => [number, number];
      const e = window.__calame!.engine;
      const id = window.__calame!.session.notebook.pageIds[0];
      if (source === 'png') {
        const bin = Uint8Array.from(atob(png!), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        img = ctx.getImageData(0, 0, bmp.width, bmp.height);
        const k = bmp.width / window.__calame!.session.pages.get(id)!.width;
        toPx = (x, y) => [x * k, y * k];
      } else {
        const c = document.querySelector(source === 'zoom' ? '.zoom-host .ink-base' : '.ink-host:not(.zoom-host) .ink-base') as HTMLCanvasElement;
        img = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
        const host = (source === 'zoom' ? document.querySelector('.zoom-host') : document.querySelector('[data-testid="ink-host"]'))!.getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        const d = c.width / cr.width;
        toPx = (x, y) => {
          const s = source === 'zoom' ? (() => {
            // Coordonnées écran de la fenêtre de zoom : inverse de surfaceToPage.
            const st = e.zoomState();
            const k = e.fitScaleFor(0) * st.factor;
            return [(x - st.x) * k, (y - st.y) * k] as [number, number];
          })() : e.pageToScreen(id, x, y)!;
          return [(s[0] + host.left - cr.left) * d, (s[1] + host.top - cr.top) * d];
        };
      }
      const [ax, ay] = toPx(...seg.a);
      const [bx, by] = toPx(...seg.b);
      const W = img.width;
      const cols: { x: number; c: number; m: number }[] = [];
      for (let x = Math.round(ax + (bx - ax) * 0.2); x <= ax + (bx - ax) * 0.8; x++) {
        if (x < 0 || x >= W) continue;
        const yc = ay + ((by - ay) * (x - ax)) / (bx - ax);
        let m = 0;
        let my = 0;
        for (let y = Math.max(0, Math.floor(yc - 25)); y <= Math.min(img.height - 1, Math.ceil(yc + 25)); y++) {
          const o = (y * W + x) * 4;
          const dark = Math.max(0, 255 * 3 - (img.data[o] + img.data[o + 1] + img.data[o + 2])) / (255 * 3);
          m += dark;
          my += dark * y;
        }
        if (m > 0.5) cols.push({ x, c: my / m, m });
      }
      const n = cols.length;
      const mx = cols.reduce((s, p) => s + p.x, 0) / n;
      const mc = cols.reduce((s, p) => s + p.c, 0) / n;
      let sxx = 0;
      let sxy = 0;
      for (const p of cols) {
        sxx += (p.x - mx) ** 2;
        sxy += (p.x - mx) * (p.c - mc);
      }
      const slope = sxy / sxx;
      const resid = Math.sqrt(cols.reduce((s, p) => s + (p.c - (mc + slope * (p.x - mx))) ** 2, 0) / n);
      const mm = cols.reduce((s, p) => s + p.m, 0) / n;
      const thick = Math.sqrt(cols.reduce((s, p) => s + (p.m - mm) ** 2, 0) / n) / mm;
      return { cols: n, wobble: resid, thickness: thick, mean: mm };
    },
    { source, seg, png },
  );
}

/** Applique un style de rendu au premier trait (sans passer par l'historique de l'utilisateur). */
async function setRes(page: Page, res: number | undefined) {
  await page.evaluate((res) => {
    const s = window.__calame!.session;
    const st = s.getStrokes(s.notebook.pageIds[0])[0];
    s.apply([{ kind: 'stroke', id: st.id, pageId: st.pageId, before: st, after: { ...st, style: { ...st.style, res } } }], 'mesure');
  }, res);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test.describe('Traits lisses avec des coordonnées arrondies au pixel @cdp', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Stylet piloté via le protocole Chromium');
  test.use({ deviceScaleFactor: 2 });

  test('droite lente : régulière à l’écran (zoom 1 et ×3), dans la fenêtre de zoom, après rechargement et à l’export', async ({ page }) => {
    test.setTimeout(90_000);
    await start(page, 'Netteté');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    // Comme Safari : coordonnées entières (px CSS), 240 événements/s, écriture lente (≈ 60 px/s), pente ≈ 6°.
    const x0 = b.x + 140;
    const y0 = b.y + 300;
    const t0 = Date.now() / 1000;
    const N = 720;
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= N; i++) pts.push([Math.round(x0 + i * 0.25), Math.round(y0 + i * 0.025), t0 + i / 240]);
    const base = { pointerType: 'pen' as const, button: 'left' as const, force: 0.5 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0][0], y: pts[0][1], buttons: 1, clickCount: 1, timestamp: pts[0][2], ...base });
    for (const [x, y, t] of pts.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1, timestamp: t, ...base });
    const l = pts[pts.length - 1];
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: l[0], y: l[1], buttons: 0, clickCount: 1, timestamp: l[2] + 0.004, ...base });
    await page.mouse.move(2, 2);
    const info = await page.evaluate(() => {
      const s = window.__calame!.session;
      const st = s.getStrokes(s.notebook.pageIds[0])[0];
      const p = st.points;
      return { res: st.style.res, a: [p[0], p[1]] as [number, number], b: [p[p.length - 5], p[p.length - 4]] as [number, number] };
    });
    // Saisie arrondie détectée : résolution = 1 px CSS en unités page.
    const scale = await page.evaluate(() => window.__calame!.engine.vp.scale);
    expect(info.res).toBeCloseTo(1 / scale, 2);
    const seg = { a: info.a, b: info.b };
    const report: Record<string, { lisse: number; brut: number }> = {};
    const compare = async (label: string, source: 'main' | 'zoom') => {
      const smooth = await measure(page, source, seg);
      await setRes(page, 0); // même trait sans lissage (référence « avant »)
      const raw = await measure(page, source, seg);
      await page.keyboard.press('ControlOrMeta+z');
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      report[label] = { lisse: smooth.wobble, brut: raw.wobble };
      expect(smooth.cols).toBeGreaterThan(40);
      expect(smooth.wobble).toBeLessThan(raw.wobble * 0.6);
      expect(smooth.thickness).toBeLessThan(raw.thickness);
      return smooth;
    };
    const fit = await compare('zoom 1', 'main');
    expect(fit.wobble).toBeLessThan(0.2);
    await page.evaluate(([x, y]) => {
      const e = window.__calame!.engine;
      const id = window.__calame!.session.notebook.pageIds[0];
      const [sx, sy] = e.pageToScreen(id, x, y)!;
      e.vp.zoomAt(sx, sy, 3);
      e.zoomBy(1);
    }, [(seg.a[0] + seg.b[0]) / 2, (seg.a[1] + seg.b[1]) / 2]);
    await page.waitForTimeout(300);
    const z3 = await compare('zoom ×3', 'main');
    expect(z3.wobble).toBeLessThan(0.45);
    await page.evaluate(() => window.__calame!.engine.fitWidth());
    await page.waitForTimeout(400);
    // Fenêtre de zoom placée sur le trait.
    await page.keyboard.press('z');
    await expect(page.getByTestId('zoom-host')).toBeVisible();
    await page.evaluate(([x, y]) => {
      const e = window.__calame!.engine;
      e.moveZoomFrameTo(window.__calame!.session.notebook.pageIds[0], x, y);
    }, [seg.a[0] + 10, seg.a[1] + 2]);
    await page.waitForTimeout(200);
    const zw = await compare('fenêtre de zoom', 'zoom');
    expect(zw.wobble).toBeLessThan(0.5);
    await page.keyboard.press('z');
    // Après rechargement : même rendu (données inchangées, lissage au rendu).
    await page.waitForTimeout(600);
    await page.reload();
    await page.waitForFunction(() => window.__calame?.session.strokeCount() === 1);
    await page.waitForTimeout(300);
    const again = await measure(page, 'main', seg);
    expect(Math.abs(again.wobble - fit.wobble)).toBeLessThan(0.05);
    // Export PNG (menu Plus) : même moteur de rendu, à 3 px par unité.
    await page.getByRole('button', { name: 'Plus', exact: true }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('dialog', { name: 'Plus' }).getByRole('button', { name: /^Exporter la page en image/ }).click();
    const file = await dl;
    expect(file.suggestedFilename()).toBe('Nettete - page 1.png');
    const png = readFileSync((await file.path())!).toString('base64');
    const exp = await measure(page, 'png', seg, png);
    const dims = await page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
      return [bmp.width, bmp.height];
    }, png);
    const pw = await page.evaluate(() => window.__calame!.session.pageOrder[0].width);
    expect(dims[0]).toBe(Math.round(pw * 3));
    expect(exp.wobble).toBeLessThan(0.45);
    console.log('Ondulation du trait (px physiques, écart quadratique) :', JSON.stringify(report), 'export', exp.wobble.toFixed(3), 'rechargement', again.wobble.toFixed(3));
  });

  test('texture réservée au crayon, grain fine même agrandie ; les autres stylos sont unis', async ({ page }) => {
    await start(page, 'Grain');
    const cdp = await page.context().newCDPSession(page);
    const b = await hostBox(page);
    const draw = async (type: string, y: number) => {
      const btn = page.getByRole('button', { name: /Stylo à bille|Feutre fin|Plume|Pinceau|Crayon|Marqueur/ }).first();
      if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
      await btn.click();
      await page.getByRole('radio', { name: type }).click();
      // Épaisseur maximale pour mesurer l'intérieur du trait.
      const slider = page.getByRole('slider', { name: /Épaisseur/ });
      if (await slider.count()) await slider.fill(String(await slider.getAttribute('max')));
      await page.keyboard.press('Escape');
      const base = { pointerType: 'pen' as const, button: 'left' as const, force: 0.8 };
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x + 150, y: b.y + y, buttons: 1, clickCount: 1, ...base });
      for (let i = 1; i <= 40; i++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x + 150 + i * 6, y: b.y + y, buttons: 1, ...base });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x + 390, y: b.y + y, buttons: 0, clickCount: 1, ...base });
    };
    await draw('Bille', 220);
    await draw('Crayon', 300);
    await page.evaluate(() => {
      const e = window.__calame!.engine;
      e.vp.zoomAt(270, 260, 4);
      e.zoomBy(1);
    });
    await page.waitForTimeout(300);
    const stats = await page.evaluate(() => {
      const e = window.__calame!.engine;
      const s = window.__calame!.session;
      const c = document.querySelector('.ink-host:not(.zoom-host) .ink-base') as HTMLCanvasElement;
      const d = c.width / c.getBoundingClientRect().width;
      const ctx = c.getContext('2d')!;
      return s.getStrokes(s.notebook.pageIds[0]).map((st) => {
        const p = st.points;
        const mid = Math.floor(p.length / 10) * 5;
        const [sx, sy] = e.pageToScreen(st.pageId, p[mid], p[mid + 1])!;
        const half = Math.floor(st.width * e.vp.scale * d * 0.25);
        const img = ctx.getImageData(Math.round(sx * d) - 40, Math.round(sy * d) - half, 80, half * 2);
        const lum: number[] = [];
        for (let i = 0; i < img.data.length; i += 4) lum.push((img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3);
        const m = lum.reduce((a, v) => a + v, 0) / lum.length;
        const sd = Math.sqrt(lum.reduce((a, v) => a + (v - m) ** 2, 0) / lum.length);
        // Corrélation à 3 px (horizontale) : élevée si le grain forme de gros pavés.
        let num = 0;
        let den = 0;
        for (let y = 0; y < img.height; y++)
          for (let x = 0; x + 3 < 80; x++) {
            const a = lum[y * 80 + x] - m;
            const b2 = lum[y * 80 + x + 3] - m;
            num += a * b2;
            den += a * a;
          }
        return { tool: st.tool, sd, corr3: den ? num / den : 0 };
      });
    });
    const pen = stats.find((x) => x.tool === 'pen')!;
    const pencil = stats.find((x) => x.tool === 'pencil')!;
    expect(pen.sd).toBeLessThan(2);
    expect(pencil.sd).toBeGreaterThan(8);
    expect(pencil.corr3).toBeLessThan(0.35);
  });
});
