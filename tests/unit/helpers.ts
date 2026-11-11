import { openCalameDB } from '../../src/storage/db';
import { Repo } from '../../src/storage/repo';
import { computeBBox, strokeMaxRadius } from '../../src/ink/geometry';
import { newId } from '../../src/model/ids';
import type { Stroke } from '../../src/model/types';

let n = 0;
/** Base isolée par test. */
export function freshDB() {
  const p = openCalameDB(`test-${Date.now()}-${n++}`);
  return { db: () => p, repo: new Repo(() => p) };
}

export function makeStroke(pageId: string, pts: [number, number][], extra: Partial<Stroke> = {}): Stroke {
  const flat: number[] = [];
  pts.forEach(([x, y], i) => flat.push(x, y, 0.5, i * 8, 0));
  const points = Float32Array.from(flat);
  const base = {
    tool: 'pen' as const,
    width: 2,
    style: { thinning: 0.5, streamline: 0.3, tilt: 0, realPressure: true },
  };
  const stroke: Stroke = {
    id: newId(),
    pageId,
    color: '#000000',
    ...base,
    points,
    bbox: computeBBox(points, strokeMaxRadius(base)),
    order: Date.now() + n++,
    createdAt: Date.now(),
    v: 1,
    ...extra,
  };
  if (!extra.bbox) stroke.bbox = computeBBox(stroke.points, strokeMaxRadius(stroke));
  return stroke;
}
