import { newId } from '../model/ids';
import type { BlobRecord, Folder, Notebook, Page, PageItem, Stroke } from '../model/types';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  base64ToBytes,
  base64ToFloat32,
  buildBackup,
  type BackupFile,
} from './backupCore';
import { migrateFolder, migrateItem, migrateNotebook, migratePage, migrateStroke } from './migrations';
import { repo as defaultRepo, type Repo } from './repo';
import { getDB, type DB } from './db';
import type { IDBPDatabase } from 'idb';

/**
 * Format de sauvegarde natif « .calame » (JSON, documenté dans docs/FORMAT.md).
 * Version 2 : ajoute objets de page, dossiers et images. Les fichiers version 1
 * restent lisibles.
 */
export { BACKUP_FORMAT, BACKUP_VERSION, base64ToFloat32, float32ToBase64, type BackupFile } from './backupCore';

/** Exporte tous les carnets (y compris la corbeille) ou une sélection. */
export async function exportBackup(notebookIds?: string[], db: () => Promise<DB> = getDB): Promise<BackupFile> {
  return buildBackup((await db()) as unknown as IDBPDatabase<unknown>, notebookIds);
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
  // Version 1 : pas d'objets, de dossiers ni d'images.
  return { items: [], folders: [], blobs: [], ...b } as BackupFile;
}

export interface RestoreReport {
  notebooks: number;
  pages: number;
  strokes: number;
  items: number;
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
  const existingFolders = new Set(await d.getAllKeys('folders'));
  const notebooks = b.notebooks.map((n) => migrateNotebook(n as never));
  const pages = b.pages.map((p) => migratePage(p as never));
  const strokes = b.strokes.map((s) =>
    migrateStroke({ ...(s as unknown as Record<string, unknown>), points: base64ToFloat32(s.points) } as never),
  );
  const items = (b.items ?? []).map((i) => migrateItem(i as never));
  const folders = (b.folders ?? []).map((f) => migrateFolder(f as never));
  const blobs: BlobRecord[] = (b.blobs ?? []).map((x) => ({
    id: x.id,
    mime: x.mime,
    createdAt: x.createdAt,
    data: base64ToBytes(x.data).buffer as ArrayBuffer,
  }));
  const folderIds = new Set([...existingFolders, ...folders.map((f) => f.id)]);

  const outNb: Notebook[] = [];
  const outPages: Page[] = [];
  const outStrokes: Stroke[] = [];
  const outItems: PageItem[] = [];
  const outFolders: Folder[] = folders.filter((f) => !existingFolders.has(f.id));
  let copies = 0;
  for (const nb0 of notebooks) {
    const nb = { ...nb0, folderId: nb0.folderId && folderIds.has(nb0.folderId) ? nb0.folderId : null };
    const nbPages = pages.filter((p) => p.notebookId === nb.id);
    if (!existing.has(nb.id)) {
      outNb.push(nb);
      outPages.push(...nbPages);
      const ids = new Set(nbPages.map((p) => p.id));
      outStrokes.push(...strokes.filter((s) => ids.has(s.pageId)));
      outItems.push(...items.filter((s) => ids.has(s.pageId)));
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
    for (const it of items) {
      const np = pageMap.get(it.pageId);
      if (np) outItems.push({ ...it, id: newId(), pageId: np });
    }
  }

  const tx = d.transaction(['notebooks', 'pages', 'strokes', 'items', 'folders', 'blobs'], 'readwrite');
  const ops: Promise<unknown>[] = [];
  for (const f of outFolders) ops.push(tx.objectStore('folders').put(f));
  for (const bl of blobs) ops.push(tx.objectStore('blobs').put(bl));
  for (const n of outNb) ops.push(tx.objectStore('notebooks').add(n));
  for (const p of outPages) ops.push(tx.objectStore('pages').put(p));
  for (const s of outStrokes) ops.push(tx.objectStore('strokes').put(s));
  for (const it of outItems) ops.push(tx.objectStore('items').put(it));
  await Promise.all([...ops, tx.done]);
  return { notebooks: outNb.length, pages: outPages.length, strokes: outStrokes.length, items: outItems.length, copies };
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
