import { expect, type CDPSession, type Page } from '@playwright/test';

export async function createNotebook(page: Page, title = 'Carnet de test'): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: 'Nouveau carnet' }).first().click();
  await page.getByPlaceholder('Ex. Révisions Java — Collections').fill(title);
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByTestId('ink-host')).toBeVisible();
  await page.waitForFunction(() => !!window.__calame);
}

export async function hostBox(page: Page) {
  const b = await page.getByTestId('ink-host').boundingBox();
  if (!b) throw new Error('zone de dessin introuvable');
  return b;
}

export async function strokeCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__calame!.session.strokeCount());
}

/** Stylet simulé via le protocole Chromium (pression et inclinaison réelles dans le pipeline d'entrée). */
export async function penStroke(
  page: Page,
  cdp: CDPSession,
  pts: [number, number][],
  opts: { force?: number; tiltX?: number } = {},
): Promise<void> {
  const base = { pointerType: 'pen' as const, button: 'left' as const, force: opts.force ?? 0.6, tiltX: opts.tiltX ?? 0, tiltY: 0 };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0][0], y: pts[0][1], buttons: 1, clickCount: 1, ...base });
  for (const [x, y] of pts.slice(1)) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1, ...base });
  }
  const last = pts[pts.length - 1];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last[0], y: last[1], buttons: 0, clickCount: 1, ...base });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

export function line(x0: number, y0: number, x1: number, y1: number, n = 12): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
}

/** Geste tactile multi-doigts via le protocole Chromium. */
export async function touchGesture(cdp: CDPSession, frames: [number, number][][]): Promise<void> {
  const tp = (f: [number, number][]) => f.map(([x, y], id) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 0.5 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(frames[0]) });
  for (const f of frames.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(f) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

export async function waitSaved(page: Page): Promise<void> {
  await expect(page.locator('.save-dot.is-saved').first()).toBeVisible();
}
