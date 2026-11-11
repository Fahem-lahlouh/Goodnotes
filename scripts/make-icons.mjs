// Génère les icônes PNG à partir de public/icons/icon.svg (Chromium via Playwright).
// Usage : npm run icons
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
// Icône d'écran d'accueil : fond plein (iOS ajoute ses propres coins arrondis).
const full = svg.replace('rx="15"', 'rx="0"');
const targets = [
  ['icon-192.png', 192, full],
  ['icon-512.png', 512, full],
  ['apple-touch-icon.png', 180, full],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, src] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), await page.screenshot({ omitBackground: false }));
}
await browser.close();
console.log('icônes générées');
