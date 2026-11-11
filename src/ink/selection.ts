import { POINT_STRIDE, type PageItem, type Stroke } from '../model/types';
import { bboxIntersects, pointInPolygon, type BBox } from './geometry';
import type { SelectRule } from './settings';

/**
 * Zone de sélection dans le repère d'une page : polygone fermé (lasso) ou rectangle.
 * La boîte englobante ne sert qu'à écarter rapidement les objets lointains ;
 * la décision finale utilise toujours la géométrie réelle.
 */
export interface Area {
  poly: number[];
  bbox: BBox;
}

export function areaFromPolygon(poly: number[]): Area {
  const bbox: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < poly.length; i += 2) {
    bbox[0] = Math.min(bbox[0], poly[i]);
    bbox[1] = Math.min(bbox[1], poly[i + 1]);
    bbox[2] = Math.max(bbox[2], poly[i]);
    bbox[3] = Math.max(bbox[3], poly[i + 1]);
  }
  return { poly, bbox };
}

export function areaFromRect(x0: number, y0: number, x1: number, y1: number): Area {
  const a = Math.min(x0, x1);
  const b = Math.min(y0, y1);
  const c = Math.max(x0, x1);
  const d = Math.max(y0, y1);
  return { poly: [a, b, c, b, c, d, a, d], bbox: [a, b, c, d] };
}

/** Rectangle contraint en carré : le côté suit la plus grande des deux distances. */
export function squareFrom(x0: number, y0: number, x1: number, y1: number): [number, number] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return [x0 + Math.sign(dx || 1) * side, y0 + Math.sign(dy || 1) * side];
}

function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentCrossesPolygon(ax: number, ay: number, bx: number, by: number, poly: number[]): boolean {
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if (segmentsIntersect(ax, ay, bx, by, poly[j * 2], poly[j * 2 + 1], poly[i * 2], poly[i * 2 + 1])) return true;
  }
  return false;
}

/**
 * Un trait est sélectionné :
 *  - règle 'inside'  : si TOUS les points de son tracé sont dans la zone ;
 *  - règle 'contact' : si un point est dans la zone OU si un segment croise son contour.
 */
export function strokeSelected(s: Stroke, area: Area, rule: SelectRule): boolean {
  if (area.poly.length < 6 || !bboxIntersects(s.bbox, area.bbox)) return false;
  const p = s.points;
  const n = p.length / POINT_STRIDE;
  if (n === 0) return false;
  if (rule === 'inside') {
    for (let i = 0; i < n; i++) {
      if (!pointInPolygon(p[i * POINT_STRIDE], p[i * POINT_STRIDE + 1], area.poly)) return false;
    }
    return true;
  }
  for (let i = 0; i < n; i++) {
    const o = i * POINT_STRIDE;
    if (pointInPolygon(p[o], p[o + 1], area.poly)) return true;
    if (i > 0 && segmentCrossesPolygon(p[o - POINT_STRIDE], p[o - POINT_STRIDE + 1], p[o], p[o + 1], area.poly)) return true;
  }
  return false;
}

/** Mêmes règles pour un bloc de texte ou une image (rectangle). */
export function itemSelected(it: PageItem, area: Area, rule: SelectRule): boolean {
  const r: BBox = [it.x, it.y, it.x + it.w, it.y + it.h];
  if (!bboxIntersects(r, area.bbox)) return false;
  const corners = [r[0], r[1], r[2], r[1], r[2], r[3], r[0], r[3]];
  if (rule === 'inside') {
    for (let i = 0; i < 8; i += 2) if (!pointInPolygon(corners[i], corners[i + 1], area.poly)) return false;
    return true;
  }
  for (let i = 0; i < 8; i += 2) if (pointInPolygon(corners[i], corners[i + 1], area.poly)) return true;
  for (let i = 0; i < area.poly.length; i += 2) {
    const x = area.poly[i];
    const y = area.poly[i + 1];
    if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) return true;
  }
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    if (segmentCrossesPolygon(corners[i * 2], corners[i * 2 + 1], corners[j * 2], corners[j * 2 + 1], area.poly)) return true;
  }
  return false;
}

export function itemBBox(it: PageItem): BBox {
  return [it.x, it.y, it.x + it.w, it.y + it.h];
}

/** Transforme un objet (mise à l'échelle uniforme k puis translation). Le texte suit l'échelle. */
export function transformItem<T extends PageItem>(it: T, k: number, dx: number, dy: number): T {
  const out = { ...it, x: it.x * k + dx, y: it.y * k + dy, w: it.w * k, h: it.h * k };
  if (out.kind === 'text') (out as { size: number }).size = Math.max(4, (it as { size: number }).size * k);
  return out;
}
