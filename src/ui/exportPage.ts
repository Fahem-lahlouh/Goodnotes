import { ensureImages } from '../ink/items';
import { renderPageContent } from '../ink/pageRender';
import type { NotebookSession } from '../model/session';

/** Résolution de l'export : pixels par unité de page (≈ 3 × l'écran d'un iPad, ~290 ppp pour un A4). */
export const EXPORT_SCALE = 3;

/**
 * Rend une page en image PNG avec le même moteur que l'écran (mêmes contours, même lissage),
 * directement à la résolution d'export : aucun agrandissement d'une image d'écran.
 */
export async function renderPagePng(session: NotebookSession, pageId: string, scale = EXPORT_SCALE): Promise<{ blob: Blob; width: number; height: number }> {
  await session.ensurePage(pageId);
  const page = session.pages.get(pageId);
  if (!page) throw new Error('Page introuvable');
  const items = session.getItems(pageId);
  await ensureImages(items.filter((i) => i.kind === 'image').map((i) => (i as { blobId: string }).blobId));
  // Limite mémoire des canvas sur iOS (~16 Mpx) : on réduit l'échelle si besoin.
  const k = Math.min(scale, Math.sqrt(16_000_000 / (page.width * page.height)));
  const width = Math.round(page.width * k);
  const height = Math.round(page.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  renderPageContent(ctx, page, session.getStrokes(pageId), items, k);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export impossible'))), 'image/png'));
  return { blob, width, height };
}

/** Nom de fichier sûr partout : sans accents ni caractères interdits (certains navigateurs ignorent sinon le nom). */
export function fileSafe(title: string): string {
  const s = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]+/g, '-')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim()
    .slice(0, 60);
  return s || 'Calame';
}

/** Propose le fichier PNG (téléchargement ; sur iPad, aperçu avec « Partager » → Enregistrer dans Fichiers). */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
