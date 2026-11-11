import { newId } from '../model/ids';
import { SCHEMA_VERSION, type Notebook, type Page, type Stroke } from '../model/types';
import { migrateNotebook, migratePage, migrateStroke } from './migrations';
import { repo as defaultRepo, type Repo } from './repo';
import { getDB, type DB } from './db';

/**
 * Format de sauvegarde natif « .calame » (JSON, documenté dans docs/FORMAT.md).
 * Les points des traits sont encodés en base64 (float32 little-endian) :
 * compact et sans perte par rapport au stockage local.
 */
export const BACKUP_FORMAT = 'calame-backup';
export const BACKUP_VERSION = 1;

type SerializedStroke = Omit<Stroke, 'points'> & { points: string };

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  schema: number;
  app: string;
  exportedAt: string;
  notebooks: Notebook[];
  pages: Page[];
  strokes: SerializedStroke[];
}

export function float32ToBase64(a: Float32Array): string {
  const bytes = new Uint8Array(a.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < a.length; i++) view.setFloat32(i * 4, a[i], true);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

export function base64ToFloat32(s: string): Float32Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

/** Exporte tous les carnets (y compris la corbeille) ou une sélection. */
export async function exportBackup(notebookIds?: string[], db: () => Promise<DB> = getDB): Promise<BackupFile> {
  const d = await db();
  const tx = d.transaction(['notebooks', 'pages', 'strokes'], 'readonly');
  let notebooks = (await tx.objectStore('notebooks').getAll()).map((n) => migrateNotebook(n as never));
  if (notebookIds) notebooks = notebooks.filter((n) => notebookIds.includes(n.id));
  const pages: Page[] = [];
  const strokes: SerializedStroke[] = [];
  for (const nb of notebooks) {
    const ps = await tx.objectStore('pages').index('notebookId').getAll(nb.id);
    for (const p of ps) {
      pages.push(migratePage(p as never));
      for (const s of await tx.objectStore('strokes').index('pageId').getAll(p.id)) {
        const m = migrateStroke(s as never);
        strokes.push({ ...m, points: float32ToBase64(m.points) });
      }
    }
  }
  await tx.done;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schema: SCHEMA_VERSION,
    app: 'Calame',
    exportedAt: new Date().toISOString(),
    notebooks,
    pages,
    strokes,
  };
}

export function serializeBackup(b: BackupFile): Blob {
  return new Blob([JSON.stringify(b)], { type: 'application/json' });
}

export class BackupFormatError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'BackupFormatError';
  }
}

/** Analyse et valide un fichier ; lève une erreur explicite si invalide. */
export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupFormatError("Ce fichier n'est pas une sauvegarde Calame (JSON illisible).");
  }
  const b = data as Partial<BackupFile>;
  if (!b || b.format !== BACKUP_FORMAT) throw new BackupFormatError("Ce fichier n'est pas une sauvegarde Calame.");
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new BackupFormatError('Sauvegarde créée par une version plus récente de Calame.');
  }
  if (!Array.isArray(b.notebooks) || !Array.isArray(b.pages) || !Array.isArray(b.strokes)) {
    throw new BackupFormatError('Sauvegarde incomplète ou endommagée.');
  }
  return b as BackupFile;
}

export interface RestoreReport {
  notebooks: number;
  pages: number;
  strokes: number;
  copies: number;
}

/**
 * Restaure une sauvegarde SANS JAMAIS écraser les données existantes :
 * un carnet dont l'identifiant existe déjà est importé comme copie
 * (nouveaux identifiants, titre suffixé « (restauré) »).
 * Toute l'opération se fait en une transaction : en cas d'erreur, rien n'est écrit.
 */
export async function restoreBackup(b: BackupFile, db: () => Promise<DB> = getDB): Promise<RestoreReport> {
  const d = await db();
  const existing = new Set(await d.getAllKeys('notebooks'));
  const notebooks = b.notebooks.map((n) => migrateNotebook(n as never));
  const pages = b.pages.map((p) => migratePage(p as never));
  const strokes = b.strokes.map((s) =>
    migrateStroke({ ...(s as unknown as Record<string, unknown>), points: base64ToFloat32(s.points) } as never),
  );

  const outNb: Notebook[] = [];
  const outPages: Page[] = [];
  const outStrokes: Stroke[] = [];
  let copies = 0;
  for (const nb of notebooks) {
    const nbPages = pages.filter((p) => p.notebookId === nb.id);
    if (!existing.has(nb.id)) {
      outNb.push(nb);
      outPages.push(...nbPages);
      const ids = new Set(nbPages.map((p) => p.id));
      outStrokes.push(...strokes.filter((s) => ids.has(s.pageId)));
      continue;
    }
    copies++;
    const nid = newId();
    const pageMap = new Map(nbPages.map((p) => [p.id, newId()]));
    outNb.push({
      ...nb,
      id: nid,
      title: `${nb.title} (restauré)`,
      pageIds: nb.pageIds.map((pid) => pageMap.get(pid)).filter((x): x is string => !!x),
    });
    for (const p of nbPages) outPages.push({ ...p, id: pageMap.get(p.id)!, notebookId: nid });
    for (const s of strokes) {
      const np = pageMap.get(s.pageId);
      if (np) outStrokes.push({ ...s, id: newId(), pageId: np });
    }
  }

  const tx = d.transaction(['notebooks', 'pages', 'strokes'], 'readwrite');
  const ops: Promise<unknown>[] = [];
  for (const n of outNb) ops.push(tx.objectStore('notebooks').add(n));
  for (const p of outPages) ops.push(tx.objectStore('pages').put(p));
  for (const s of outStrokes) ops.push(tx.objectStore('strokes').put(s));
  await Promise.all([...ops, tx.done]);
  return { notebooks: outNb.length, pages: outPages.length, strokes: outStrokes.length, copies };
}

export function backupFileName(prefix = 'calame-sauvegarde'): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.calame`;
}

/**
 * Remet un fichier à l'utilisateur. Sur iPad, la feuille de partage permet
 * « Enregistrer dans Fichiers » ; sinon, téléchargement classique.
 */
export async function deliverFile(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (coarse && nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      // repli sur le téléchargement
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}

export async function recordBackupDate(r: Repo = defaultRepo): Promise<void> {
  await r.setMeta('lastBackupAt', Date.now());
}
