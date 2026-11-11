import {
  DEFAULT_PAPER,
  POINT_STRIDE,
  SCHEMA_VERSION,
  type Notebook,
  type Page,
  type Stroke,
} from '../model/types';
import { computeBBox, strokeMaxRadius } from '../ink/geometry';

/**
 * Migrations versionnées des enregistrements.
 *
 * Chaque enregistrement porte `v` (version de schéma). Pour lire un enregistrement
 * plus ancien (base locale ou fichier de sauvegarde), on applique successivement
 * les étapes `v → v+1` jusqu'à SCHEMA_VERSION. Une donnée plus récente que
 * l'application est refusée (on ne la tronque jamais).
 *
 * v0 : format provisoire (points en tableau de nombres, 4 valeurs par point
 *      x, y, pression, t ; pas de style) — accepté à l'import.
 * v1 : format actuel (voir model/types.ts).
 */
type Raw = Record<string, unknown> & { v?: number };

export class NewerSchemaError extends Error {
  constructor(v: number) {
    super(
      `Ces données ont été créées par une version plus récente de Calame (schéma ${v}). Mettez l'application à jour.`,
    );
    this.name = 'NewerSchemaError';
  }
}

function checkVersion(raw: Raw): number {
  const v = typeof raw.v === 'number' ? raw.v : 0;
  if (v > SCHEMA_VERSION) throw new NewerSchemaError(v);
  return v;
}

const strokeSteps: ((r: Raw) => Raw)[] = [
  // 0 → 1
  (r) => {
    let pts = r.points as ArrayLike<number>;
    const stride = typeof r.stride === 'number' ? (r.stride as number) : POINT_STRIDE;
    const arr = Array.from(pts);
    if (stride === 4) {
      const out: number[] = [];
      for (let i = 0; i + 3 < arr.length; i += 4) out.push(arr[i], arr[i + 1], arr[i + 2], arr[i + 3], 0);
      pts = out;
    } else {
      pts = arr;
    }
    const style = (r.style as Stroke['style']) ?? {
      thinning: 0.6,
      streamline: 0.35,
      tilt: 0,
      realPressure: true,
    };
    const { stride: _ignored, ...rest } = r;
    void _ignored;
    return {
      ...rest,
      tool: r.tool === 'highlighter' ? 'highlighter' : 'pen',
      style,
      points: Float32Array.from(pts),
      order: typeof r.order === 'number' ? r.order : (r.createdAt as number) ?? 0,
      v: 1,
    };
  },
];

const pageSteps: ((r: Raw) => Raw)[] = [(r) => ({ ...r, paper: r.paper ?? DEFAULT_PAPER, v: 1 })];

const notebookSteps: ((r: Raw) => Raw)[] = [
  (r) => ({
    ...r,
    favorite: Boolean(r.favorite),
    trashedAt: (r.trashedAt as number | null) ?? null,
    openedAt: (r.openedAt as number) ?? (r.updatedAt as number) ?? 0,
    cover: r.cover ?? 'nuit',
    paper: r.paper ?? DEFAULT_PAPER,
    v: 1,
  }),
];

function run(raw: Raw, steps: ((r: Raw) => Raw)[]): Raw {
  let r = raw;
  for (let v = checkVersion(raw); v < SCHEMA_VERSION; v++) r = steps[v](r);
  return r;
}

export function migrateStroke(raw: Raw): Stroke {
  const s = run(raw, strokeSteps) as unknown as Stroke;
  if (!(s.points instanceof Float32Array)) s.points = Float32Array.from(s.points as ArrayLike<number>);
  if (!Array.isArray(s.bbox) || s.bbox.length !== 4) s.bbox = computeBBox(s.points, strokeMaxRadius(s));
  return s;
}

export function migratePage(raw: Raw): Page {
  return run(raw, pageSteps) as unknown as Page;
}

export function migrateNotebook(raw: Raw): Notebook {
  return run(raw, notebookSteps) as unknown as Notebook;
}
