import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createNotebook, hostBox, setPrefs, strokeCount, waitSaved } from './helpers';

async function fresh(page: Page) {
  await page.goto('./');
  await setPrefs(page, { penDetected: true });
  await page.reload();
}

async function drawWithMouse(page: Page) {
  const b = await hostBox(page);
  const y = b.y + b.height / 2 - 40;
  await page.mouse.move(b.x + 200, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 200 + i * 20, y + i * 3);
  await page.mouse.up();
}

const back = (page: Page) => page.getByRole('button', { name: 'Retour à la bibliothèque' }).click();

test('création avec format, orientation et modèle ; réouverture ; pages', async ({ page }) => {
  await fresh(page);
  await createNotebook(page, 'Réunion hebdo', { template: 'Compte rendu de réunion', format: 'A5', landscape: true });
  const dims = await page.evaluate(() => {
    const p = window.__calame!.session.pageOrder[0];
    return [p.width, p.height, p.paper.kind];
  });
  expect(dims).toEqual([794, 559, 'meeting']);
  await drawWithMouse(page);
  await page.getByRole('button', { name: 'Ajouter une page après celle-ci' }).click();
  await expect(page.locator('.topbar .page-count')).toContainText('2');
  await waitSaved(page);
  await back(page);
  await expect(page.getByText('2 pages')).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir Réunion hebdo' }).click();
  await page.waitForFunction(() => window.__calame?.session.strokeCount() === 1);
  await page.getByRole('button', { name: 'Miniatures des pages' }).click();
  await page.getByRole('button', { name: 'Dupliquer la page' }).first().click();
  await expect(page.locator('.topbar .page-count')).toContainText('/ 3');
  await page.getByRole('button', { name: 'Supprimer la page' }).nth(1).click();
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(page.locator('.topbar .page-count')).toContainText('/ 2');
});

test('note rapide et tableau blanc', async ({ page }) => {
  await fresh(page);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Note rapide' }).click();
  await page.waitForFunction(() => window.__calame?.session.notebook.kind === 'quicknote');
  await back(page);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Tableau blanc (grande page)' }).click();
  await page.waitForFunction(() => window.__calame?.session.notebook.kind === 'whiteboard');
  const size = await page.evaluate(() => {
    const p = window.__calame!.session.pageOrder[0];
    return [p.width, p.height];
  });
  expect(size).toEqual([2400, 1600]);
});

test('dossiers : créer, déplacer un carnet, supprimer le dossier sans perdre le carnet', async ({ page }) => {
  await fresh(page);
  await createNotebook(page, 'Streams');
  await back(page);
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Dossier' }).click();
  await page.getByLabel('Nom').fill('Java');
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Java' })).toBeVisible();
  await page.getByRole('button', { name: 'Documents' }).first().click();
  await page.getByRole('button', { name: 'Actions pour Streams' }).click();
  await page.getByRole('menuitem', { name: 'Déplacer vers…' }).click();
  await page.getByRole('menuitem', { name: 'Java' }).click();
  await expect(page.getByRole('button', { name: 'Ouvrir Streams' })).toHaveCount(0); // plus à la racine
  await page.locator('.folder-card', { hasText: 'Java' }).click();
  await expect(page.getByRole('button', { name: 'Ouvrir Streams' })).toBeVisible();
  await page.getByRole('button', { name: 'Supprimer le dossier' }).click();
  await page.getByRole('button', { name: 'Supprimer le dossier' }).last().click();
  await expect(page.getByRole('button', { name: 'Ouvrir Streams' })).toBeVisible();
});

test('corbeille, favoris, recherche et tri par nom', async ({ page }) => {
  await fresh(page);
  await createNotebook(page, 'Zébu');
  await back(page);
  await createNotebook(page, 'Algorithmes');
  await back(page);
  await page.getByLabel('Trier par').selectOption('title');
  const titles = await page.locator('.grid .nb-title').allTextContents();
  expect(titles).toEqual(['Algorithmes', 'Zébu']);
  await page.getByRole('button', { name: 'Ajouter Zébu aux favoris' }).click();
  await page.getByRole('button', { name: 'Favoris' }).first().click();
  await expect(page.getByRole('button', { name: 'Ouvrir Zébu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ouvrir Algorithmes' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Documents' }).first().click();
  await page.getByLabel('Rechercher dans les titres').fill('algo');
  await expect(page.getByRole('button', { name: 'Ouvrir Zébu' })).toHaveCount(0);
  await page.getByLabel('Rechercher dans les titres').fill('');
  await page.getByRole('button', { name: 'Actions pour Zébu' }).click();
  await page.getByRole('menuitem', { name: 'Mettre à la corbeille' }).click();
  await expect(page.getByRole('button', { name: 'Ouvrir Zébu' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Corbeille' }).first().click();
  await page.getByRole('button', { name: 'Actions pour Zébu' }).click();
  await page.getByRole('menuitem', { name: 'Restaurer' }).click();
  await page.getByRole('button', { name: 'Documents' }).first().click();
  await expect(page.getByRole('button', { name: 'Ouvrir Zébu' })).toBeVisible();
});

test('mise à niveau d’une base v1 existante : notes conservées et copie de sécurité disponible', async ({ page }) => {
  // Page de la même origine sans l'application : on y crée une base au format v1.
  await page.goto('./version.json');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('calame', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('notebooks', { keyPath: 'id' });
          db.createObjectStore('pages', { keyPath: 'id' }).createIndex('notebookId', 'notebookId');
          db.createObjectStore('strokes', { keyPath: 'id' }).createIndex('pageId', 'pageId');
          db.createObjectStore('meta', { keyPath: 'key' });
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['notebooks', 'pages', 'strokes'], 'readwrite');
          const paper = { kind: 'lined', color: 'white', spacing: 32 };
          tx.objectStore('notebooks').put({ id: 'v1nb', title: 'Ancien carnet', cover: 'sauge', paper, pageIds: ['v1pg'], favorite: false, createdAt: 1, updatedAt: 1, openedAt: 1, trashedAt: null, v: 1 });
          tx.objectStore('pages').put({ id: 'v1pg', notebookId: 'v1nb', width: 794, height: 1123, paper, createdAt: 1, updatedAt: 1, v: 1 });
          const pts = new Float32Array(50);
          for (let i = 0; i < 10; i++) pts.set([100 + i * 10, 200, 0.5, i * 8, 0], i * 5);
          tx.objectStore('strokes').put({ id: 'v1s', pageId: 'v1pg', tool: 'pen', color: '#1d2433', width: 2.4, style: { thinning: 0.48, streamline: 0.3, tilt: 0, realPressure: true }, points: pts, bbox: [98, 198, 192, 202], order: 1, createdAt: 1, v: 1 });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
  await page.goto('./');
  await page.getByRole('button', { name: 'Ouvrir Ancien carnet' }).click();
  await page.waitForFunction(() => window.__calame?.session.strokeCount() === 1);
  await back(page);
  await page.getByRole('button', { name: 'Stockage et sauvegardes' }).first().click();
  await expect(page.getByText(/format 1 → 2, 1 carnet/)).toBeVisible();
});

test('export complet (texte compris) puis restauration dans un navigateur vierge', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'téléchargement testé sur bureau');
  await fresh(page);
  await createNotebook(page, 'Sauvegarde');
  await drawWithMouse(page);
  await page.getByRole('button', { name: 'Texte' }).click();
  const b = await hostBox(page);
  await page.mouse.click(b.x + 200, b.y + b.height / 2 + 120);
  await page.getByLabel('Texte du bloc').fill('Décision : livrer vendredi');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__calame?.session.itemCount() === 1);
  await waitSaved(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Exporter une sauvegarde/ }).click()]);
  const path = await download.path();
  const json = JSON.parse(readFileSync(path!, 'utf8'));
  expect(json).toMatchObject({ format: 'calame-backup', version: 2 });
  expect(json.strokes).toHaveLength(1);
  expect(json.items[0].text).toBe('Décision : livrer vendredi');
  await expect(page.getByRole('button', { name: /Sauvegardé à l’instant/ })).toBeVisible();

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(info.project.use.baseURL!);
  await p2.getByRole('button', { name: 'Nouveau', exact: true }).click();
  await p2.getByRole('menuitem', { name: 'Restaurer une sauvegarde (.calame)' }).click();
  await p2.locator('input[type=file][accept*="calame"]').setInputFiles(path!);
  await expect(p2.getByText(/Restauration : 1 carnet/)).toBeVisible();
  await p2.getByRole('button', { name: 'Ouvrir Sauvegarde' }).click();
  await p2.waitForFunction(() => window.__calame?.session.strokeCount() === 1 && window.__calame.session.itemCount() === 1);
  await ctx2.close();
});

test('deux onglets sur le même carnet : le second est en lecture seule', async ({ page, context }) => {
  await fresh(page);
  await createNotebook(page, 'Deux onglets');
  const url = page.url();
  const p2 = await context.newPage();
  await p2.goto(url);
  await expect(p2.getByText(/Ici : lecture seule/)).toBeVisible();
  await expect(p2.getByRole('button', { name: 'Annuler', exact: true })).toBeDisabled();
  await drawWithMouse(page);
  await p2.waitForFunction(() => window.__calame?.session.strokeCount() === 1);
  await p2.getByRole('button', { name: 'Écrire ici' }).click();
  await expect(page.getByText(/Ici : lecture seule/)).toBeVisible();
  await expect(p2.getByText(/Ici : lecture seule/)).toHaveCount(0);
  expect(await strokeCount(p2)).toBe(1);
});

test('fonctionne hors ligne après une première visite ; version servie lisible', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'chromium-desktop');
  await page.goto('./');
  const served = await page.evaluate(async () => (await (await fetch('./version.json', { cache: 'no-store' })).json()).version);
  expect(typeof served).toBe('string');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Note rapide' }).click();
  await page.waitForFunction(() => !!window.__calame && window.__calame.session.isLoaded(window.__calame.session.notebook.pageIds[0]));
  await drawWithMouse(page);
  expect(await strokeCount(page)).toBe(1);
  await context.setOffline(false);
});
