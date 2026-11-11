import type { IDBPDatabase } from 'idb';
import { SCHEMA_VERSION, type Folder, type Notebook, type Page, type PageItem, type Stroke } from '../model/types';
import { migrateFolder, migrateItem, migrateNotebook, migratePage, migrateStroke } from './migrations';

/**
 * Sérialisation commune aux sauvegardes exportées et aux copies de sécurité
 * automatiques. Ne dépend d'aucun autre module de stockage (évite les cycles).
 */
export const BACKUP_FORMAT = 'calame-backup';
/** 1 : carnets, pages, traits. 2 : + objets (texte, images), dossiers, binaires. */
export const BACKUP_VERSION = 2;

export type SerializedStroke = Omit<Stroke, 'points'> & { points: string };
export interface SerializedBlob {
  id: string;
  mime: string;
  data: string;
  createdAt: number;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  schema: number;
  app: string;
  exportedAt: string;
  notebooks: Notebook[];
  pages: Page[];
  strokes: SerializedStroke[];
  items: PageItem[];
  folders: Folder[];
  blobs: SerializedBlob[];
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function float32ToBase64(a: Float32Array): string {
  const bytes = new Uint8Array(a.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < a.length; i++) view.setFloat32(i * 4, a[i], true);
  return bytesToBase64(bytes);
}

export function base64ToFloat32(s: string): Float32Array {
  const bytes = base64ToBytes(s);
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

type AnyDB = IDBPDatabase<unknown>;

async function all(db: AnyDB, store: string): Promise<Record<string, unknown>[]> {
  if (!db.objectStoreNames.contains(store)) return [];
  return (await db.getAll(store as never)) as Record<string, unknown>[];
}

/**
 * Lit une base (quelle que soit sa version) et produit une sauvegarde complète.
 * `notebookIds` restreint l'export à certains carnets.
 */
export async function buildBackup(db: AnyDB, notebookIds?: string[]): Promise<BackupFile> {
  let notebooks = (await all(db, 'notebooks')).map((n) => migrateNotebook(n));
  if (notebookIds) notebooks = notebooks.filter((n) => notebookIds.includes(n.id));
  const nbIds = new Set(notebooks.map((n) => n.id));
  const pages = (await all(db, 'pages')).map((p) => migratePage(p)).filter((p) => nbIds.has(p.notebookId));
  const pageIds = new Set(pages.map((p) => p.id));
  const strokes = (await all(db, 'strokes'))
    .filter((s) => pageIds.has(s.pageId as string))
    .map((s) => {
      const m = migrateStroke(s);
      return { ...m, points: float32ToBase64(m.points) };
    });
  const items = (await all(db, 'items')).filter((i) => pageIds.has(i.pageId as string)).map((i) => migrateItem(i));
  const blobIds = new Set(items.flatMap((i) => (i.kind === 'image' ? [i.blobId] : [])));
  const blobs = (await all(db, 'blobs'))
    .filter((b) => blobIds.has(b.id as string))
    .map((b) => ({
      id: b.id as string,
      mime: b.mime as string,
      createdAt: (b.createdAt as number) ?? 0,
      data: bytesToBase64(new Uint8Array(b.data as ArrayBuffer)),
    }));
  const usedFolders = new Set(notebooks.map((n) => n.folderId).filter(Boolean));
  const folders = (await all(db, 'folders'))
    .map((f) => migrateFolder(f))
    .filter((f) => !notebookIds || usedFolders.has(f.id));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schema: SCHEMA_VERSION,
    app: 'Calame',
    exportedAt: new Date().toISOString(),
    notebooks,
    pages,
    strokes,
    items,
    folders,
    blobs,
  };
}
