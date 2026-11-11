import { expect, type CDPSession, type Page } from '@playwright/test';

export async function setPrefs(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((p) => {
    const raw = localStorage.getItem('calame:prefs:v2');
    const cur = raw ? JSON.parse(raw) : {};
    const next = { ...cur, ...p, settings: { ...(cur.settings ?? {}), ...((p as { settings?: object }).settings ?? {}) } };
    localStorage.setItem('calame:prefs:v2', JSON.stringify(next));
  }, patch);
}

/** Crée un carnet via le menu « Nouveau » et attend l'éditeur. */
export async function createNotebook(page: Page, title = 'Carnet de test', opts: { template?: string; format?: string; landscape?: boolean } = {}): Promise<void> {
  if (!page.url().startsWith('http')) await page.goto('./');
  else if (!(await page.getByRole('button', { name: 'Nouveau', exact: true }).isVisible().catch(() => false))) await page.goto('./');
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Carnet…' }).click();
  await page.getByLabel('Titre du carnet').fill(title);
  if (opts.template) await page.getByRole('radio', { name: opts.template, exact: true }).click();
  if (opts.format) await page.getByLabel('Format de page').selectOption(opts.format);
  if (opts.landscape) await page.getByRole('radio', { name: 'Paysage' }).click();
  await page.getByRole('button', { name: 'Créer le carnet' }).click();
  await expect(page.getByTestId('ink-host')).toBeVisible();
  await page.waitForFunction(() => {
    const c = window.__calame;
    return !!c && c.session.isLoaded(c.session.notebook.pageIds[0]);
  });
}

export async function hostBox(page: Page) {
  const b = await page.getByTestId('ink-host').boundingBox();
  if (!b) throw new Error('zone de dessin introuvable');
  return b;
}

export async function strokeCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__calame!.session.strokeCount());
}

export async function pageIndex(page: Page): Promise<number> {
  return page.evaluate(() => window.__calame!.engine.currentPageIndex());
}

/** Traits de la page n (identifiant + premier point + nombre de valeurs), triés : sert à comparer des états. */
export async function snapshot(page: Page, n = 0): Promise<string[]> {
  return page.evaluate((i) => {
    const s = window.__calame!.session;
    return s
      .getStrokes(s.notebook.pageIds[i])
      .map((st) => `${st.id}|${st.color}|${st.width.toFixed(2)}|${Array.from(st.points.slice(0, 2)).map((v) => v.toFixed(2))}|${st.points.length}`)
      .sort();
  }, n);
}

/** Stylet simulé via le protocole Chromium (pression et inclinaison réelles dans le pipeline d'entrée). */
export async function penStroke(page: Page, cdp: CDPSession, pts: [number, number][], opts: { force?: number; tiltX?: number } = {}): Promise<void> {
  const base = { pointerType: 'pen' as const, button: 'left' as const, force: opts.force ?? 0.6, tiltX: opts.tiltX ?? 0, tiltY: 0 };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0][0], y: pts[0][1], buttons: 1, clickCount: 1, ...base });
  for (const [x, y] of pts.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1, ...base });
  const last = pts[pts.length - 1];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last[0], y: last[1], buttons: 0, clickCount: 1, ...base });
  await nextFrame(page);
}

export function nextFrame(page: Page): Promise<unknown> {
  return page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
}

export function line(x0: number, y0: number, x1: number, y1: number, n = 12): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
}

/** Geste tactile multi-doigts via le protocole Chromium (images successives des positions des doigts). */
export async function touchGesture(cdp: CDPSession, frames: [number, number][][]): Promise<void> {
  const tp = (f: [number, number][]) => f.map(([x, y], id) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 0.5 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(frames[0]) });
  for (const f of frames.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(f) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Balayage horizontal d'un ou deux doigts (dx négatif = vers la gauche). */
export function swipe(x: number, y: number, dx: number, fingers = 1, steps = 10): [number, number][][] {
  return Array.from({ length: steps + 1 }, (_, i) => Array.from({ length: fingers }, (_, f) => [x + (dx * i) / steps, y + f * 60] as [number, number]));
}

export async function waitSaved(page: Page): Promise<void> {
  await expect(page.locator('.topbar .save-dot.is-saved')).toBeVisible();
  await page.evaluate(async () => {
    // laisse la file d'écriture se vider
    await new Promise((r) => setTimeout(r, 50));
  });
}

/** Ouvre le panneau de réglages d'un outil (premier appui = choisir, second = réglages). */
export async function openToolPanel(page: Page, tool: RegExp | string): Promise<void> {
  const btn = page.getByRole('button', { name: tool }).first();
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
}

export async function closePanel(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
}
