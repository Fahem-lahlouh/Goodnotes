import type { Page, PageItem, Stroke } from '../model/types';
import { bboxIntersects, type BBox } from './geometry';
import { drawItems } from './items';
import { drawPaper } from './paper';
import { itemBBox } from './selection';
import { drawStrokes } from './strokeRender';

/**
 * Rendu complet d'une page dans son repère (0,0)-(w,h), contexte déjà transformé.
 * Ordre des calques : papier → images → surligneur → texte → encre.
 * (le surligneur passe sous le texte et l'encre, l'encre peut annoter images et texte).
 */
export function renderPageContent(
  ctx: CanvasRenderingContext2D,
  page: Page,
  strokes: Stroke[],
  items: PageItem[],
  scale: number,
  clip?: BBox,
  hidden?: Set<string> | null,
): void {
  drawPaper(ctx, page.width, page.height, page.paper, scale, clip);
  const vis = (b: BBox) => !clip || bboxIntersects(b, clip);
  const st = strokes.filter((s) => vis(s.bbox) && !hidden?.has(s.id));
  const it = items.filter((i) => vis(itemBBox(i)) && !hidden?.has(i.id));
  drawItems(ctx, it, scale, 'image');
  drawStrokes(ctx, st, 'under');
  drawItems(ctx, it, scale, 'text');
  drawStrokes(ctx, st, 'over');
}

export type PageLayoutMode = 'horizontal' | 'vertical';

export interface PageRect {
  page: Page;
  index: number;
  x: number;
  y: number;
}

export const PAGE_GAP = 40;

/** Position des pages dans le « monde » : côte à côte (horizontal) ou empilées (vertical). */
export function computeLayout(pages: Page[], mode: PageLayoutMode): { rects: PageRect[]; bounds: BBox } {
  const rects: PageRect[] = [];
  if (mode === 'horizontal') {
    let x = 0;
    let maxH = 0;
    pages.forEach((page, index) => {
      rects.push({ page, index, x, y: 0 });
      x += page.width + PAGE_GAP;
      maxH = Math.max(maxH, page.height);
    });
    return { rects, bounds: [0, 0, Math.max(0, x - PAGE_GAP), maxH] };
  }
  let y = 0;
  let maxW = 0;
  pages.forEach((page, index) => {
    rects.push({ page, index, x: -page.width / 2, y });
    y += page.height + PAGE_GAP;
    maxW = Math.max(maxW, page.width);
  });
  return { rects, bounds: [-maxW / 2, 0, maxW / 2, Math.max(0, y - PAGE_GAP)] };
}
