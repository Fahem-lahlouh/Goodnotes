import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createNotebook, hostBox, strokeCount, waitSaved } from './helpers';

async function drawWithMouse(page: import('@playwright/test').Page) {
  const b = await hostBox(page);
  await page.mouse.move(b.x + 200, b.y + 220);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 200 + i * 20, b.y + 220 + i * 3);
  await page.mouse.up();
}

test('création, réouverture depuis la bibliothèque et pages', async ({ page }) => {
  await createNotebook(page, 'Réunion hebdo');
  await drawWithMouse(page);
  await page.getByRole('button', { name: 'Ajouter une page après celle-ci' }).click();
  await expect(page.locator('.badge')).toHaveText('2/2');
  await waitSaved(page);
  await page.getByRole('button', { name: 'Retour à la bibliothèque' }).click();
  await expect(page.getByText('2 pages')).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir Réunion hebdo' }).click();
  await page.waitForFunction(() => window.__calame?.session.strokeCount() === 1);
  // Panneau des pages : dupliquer puis supprimer.
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByRole('button', { name: 'Dupliquer la page' }).first().click();
  await expect(page.locator('.badge')).toHaveText(/\/3$/);
  expect(await strokeCount(page)).toBe(2);
  await page.getByRole('button', { name: 'Supprimer la page' }).nth(1).click();
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(page.locator('.badge')).toHaveText(/\/2$/);
});

test('corbeille : mettre à la corbeille puis restaurer', async ({ page }) => {
  await createNotebook(page, 'À jeter');
  await page.getByRole('button', { name: 'Retour à la bibliothèque' }).click();
  await page.getByRole('button', { name: 'Actions pour À jeter' }).click();
  await page.getByRole('menuitem', { name: 'Mettre à la corbeille' }).click();
  await expect(page.getByRole('button', { name: 'Ouvrir À jeter' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Corbeille' }).click();
  await page.getByRole('button', { name: 'Actions pour À jeter' }).click();
  await page.getByRole('menuitem', { name: 'Restaurer' }).click();
  await page.getByRole('button', { name: /^Tous/ }).click();
  await expect(page.getByRole('button', { name: 'Ouvrir À jeter' })).toBeVisible();
});

test('recherche dans les titres', async ({ page }) => {
  await createNotebook(page, 'Java — Streams');
  await page.getByRole('button', { name: 'Retour à la bibliothèque' }).click();
  await page.getByRole('button', { name: 'Nouveau carnet' }).first().click();
  await page.getByPlaceholder('Ex. Révisions Java — Collections').fill('Courses');
  await page.getByRole('button', { name: 'Créer' }).click();
  await page.getByRole('button', { name: 'Retour à la bibliothèque' }).click();
  await page.getByLabel('Rechercher dans les titres').fill('java');
  await expect(page.getByRole('button', { name: 'Ouvrir Java — Streams' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ouvrir Courses' })).toHaveCount(0);
});

test('export complet puis restauration dans un navigateur vierge', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'téléchargement testé sur bureau');
  await createNotebook(page, 'Sauvegarde');
  await drawWithMouse(page);
  await waitSaved(page);
  await page.getByRole('button', { name: 'Retour à la bibliothèque' }).click();
  await page.getByRole('button', { name: 'Stockage et sauvegardes' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exporter une sauvegarde' }).click(),
  ]);
  const path = await download.path();
  const json = JSON.parse(readFileSync(path!, 'utf8'));
  expect(json.format).toBe('calame-backup');
  expect(json.strokes).toHaveLength(1);

  const fresh = await browser.newContext();
  const p2 = await fresh.newPage();
  await p2.goto(info.project.use.baseURL!);
  await p2.getByRole('button', { name: 'Stockage et sauvegardes' }).click();
  await p2.locator('input[type=file]').setInputFiles(path!);
  await expect(p2.getByText(/Restauration : 1 carnet/)).toBeVisible();
  await p2.keyboard.press('Escape');
  await p2.getByRole('button', { name: 'Ouvrir Sauvegarde' }).click();
  await p2.waitForFunction(() => window.__calame?.session.strokeCount() === 1);
  await fresh.close();
});

test('deux onglets sur le même carnet : le second est en lecture seule', async ({ page, context }) => {
  await createNotebook(page, 'Deux onglets');
  const url = page.url();
  const p2 = await context.newPage();
  await p2.goto(url);
  await expect(p2.getByText(/Ici : lecture seule/)).toBeVisible();
  // Le premier onglet écrit ; le second se met à jour.
  await drawWithMouse(page);
  await p2.waitForFunction(() => window.__calame?.session.strokeCount() === 1);
  // Prise de main par le second onglet : le premier passe en lecture seule.
  await p2.getByRole('button', { name: 'Écrire ici' }).click();
  await expect(page.getByText(/Ici : lecture seule/)).toBeVisible();
  await expect(p2.getByText(/Ici : lecture seule/)).toHaveCount(0);
  expect(await strokeCount(p2)).toBe(1);
});

test('fonctionne hors ligne après une première visite', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'chromium-desktop');
  await page.goto('./');
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.state;
  });
  await page.reload(); // la page est désormais contrôlée par le service worker
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Calame' })).toBeVisible();
  await page.getByRole('button', { name: 'Nouveau carnet' }).first().click();
  await page.getByRole('button', { name: 'Créer' }).click();
  await page.waitForFunction(() => !!window.__calame);
  await drawWithMouse(page);
  expect(await strokeCount(page)).toBe(1);
  await context.setOffline(false);
});

test('sauvegarde en un toucher depuis l’éditeur, avec le dernier trait', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'téléchargement testé sur bureau');
  await createNotebook(page, 'Export rapide');
  await expect(page.getByRole('button', { name: /Jamais sauvegardé/ })).toBeVisible();
  await drawWithMouse(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Exporter une sauvegarde/ }).click(),
  ]);
  const json = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(json.strokes).toHaveLength(1);
  await expect(page.getByRole('button', { name: /Sauvegardé à l’instant/ })).toBeVisible();
});
