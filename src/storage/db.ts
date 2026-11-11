import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BlobRecord, Folder, Notebook, Page, PageItem, Stroke } from '../model/types';
import { buildBackup } from './backupCore';

/**
 * Base IndexedDB locale.
 *
 * Versions de la base (structure des magasins) :
 *  1 — notebooks, pages, strokes (index pageId), meta.
 *  2 — + items (index pageId), folders, blobs.
 *
 * Avant toute mise à niveau d'une base existante, son contenu complet est copié
 * dans une base séparée (`calame-safety`) : en cas de problème, cette copie peut
 * être exportée depuis « Stockage et sauvegardes ».
 */
export const DB_NAME = 'calame';
export const DB_VERSION = 2;
export const SAFETY_DB = 'calame-safety';
const MAX_SNAPSHOTS = 3;

export interface CalameDB extends DBSchema {
  notebooks: { key: string; value: Notebook };
  pages: { key: string; value: Page; indexes: { notebookId: string } };
  strokes: { key: string; value: Stroke; indexes: { pageId: string } };
  meta: { key: string; value: { key: string; value: unknown } };
  items: { key: string; value: PageItem; indexes: { pageId: string } };
  folders: { key: string; value: Folder };
  blobs: { key: string; value: BlobRecord };
}

export type DB = IDBPDatabase<CalameDB>;

export interface SafetySnapshot {
  id: string;
  createdAt: number;
  fromVersion: number;
  toVersion: number;
  notebooks: number;
  /** Sauvegarde complète au format .calame (JSON). */
  data: string;
}

interface SafetyDB extends DBSchema {
  snapshots: { key: string; value: SafetySnapshot };
}

function openSafetyDB(name = SAFETY_DB) {
  return openDB<SafetyDB>(name, 1, {
    upgrade(db) {
      db.createObjectStore('snapshots', { keyPath: 'id' });
    },
  });
}

export async function listSnapshots(name = SAFETY_DB): Promise<SafetySnapshot[]> {
  const db = await openSafetyDB(name);
  try {
    return (await db.getAll('snapshots')).sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db.close();
  }
}

/**
 * Si la base existe dans une version antérieure, enregistre une copie complète
 * avant la mise à niveau. Renvoie la copie créée (ou null si rien à faire).
 */
export async function snapshotBeforeUpgrade(name = DB_NAME, safetyName = SAFETY_DB): Promise<SafetySnapshot | null> {
  // Ouverture sans version : donne la version actuelle sans rien modifier
  // (crée une base vide en v1 si elle n'existait pas ; l'upgrade la complétera).
  const current = await openDB(name);
  try {
    const v = current.version;
    if (v >= DB_VERSION || !current.objectStoreNames.contains('notebooks')) return null;
    const count = await current.count('notebooks' as never);
    if (count === 0) return null;
    const backup = await buildBackup(current as IDBPDatabase<unknown>);
    const snap: SafetySnapshot = {
      id: `${Date.now()}-v${v}`,
      createdAt: Date.now(),
      fromVersion: v,
      toVersion: DB_VERSION,
      notebooks: backup.notebooks.length,
      data: JSON.stringify(backup),
    };
    const sdb = await openSafetyDB(safetyName);
    try {
      await sdb.put('snapshots', snap);
      const all = (await sdb.getAll('snapshots')).sort((a, b) => b.createdAt - a.createdAt);
      for (const old of all.slice(MAX_SNAPSHOTS)) await sdb.delete('snapshots', old.id);
    } finally {
      sdb.close();
    }
    return snap;
  } finally {
    current.close();
  }
}

/** Dernier incident survenu lors de la copie de sécurité (affiché dans l'interface). */
export let snapshotError: string | null = null;

let dbPromise: Promise<DB> | null = null;

export async function openCalameDB(name = DB_NAME, safetyName = SAFETY_DB): Promise<DB> {
  try {
    await snapshotBeforeUpgrade(name, safetyName);
  } catch (e) {
    // La mise à niveau ne fait qu'ajouter des magasins : on continue, mais on le signale.
    snapshotError = `Copie de sécurité avant mise à niveau impossible : ${(e as Error).message}`;
    console.error('[calame]', snapshotError, e);
  }
  return openDB<CalameDB>(name, DB_VERSION, {
    upgrade(db) {
      // Chaque magasin est créé s'il manque : robuste quelle que soit la version de départ.
      const has = (n: string) => db.objectStoreNames.contains(n as never);
      if (!has('notebooks')) db.createObjectStore('notebooks', { keyPath: 'id' });
      if (!has('pages')) db.createObjectStore('pages', { keyPath: 'id' }).createIndex('notebookId', 'notebookId');
      if (!has('strokes')) db.createObjectStore('strokes', { keyPath: 'id' }).createIndex('pageId', 'pageId');
      if (!has('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!has('items')) db.createObjectStore('items', { keyPath: 'id' }).createIndex('pageId', 'pageId');
      if (!has('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      if (!has('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
    },
    blocked() {
      console.warn('[calame] mise à niveau de la base bloquée par un autre onglet');
    },
    blocking() {
      // Une version plus récente de l'app (autre onglet) veut migrer : on libère la base.
      dbPromise?.then((db) => db.close());
      dbPromise = null;
    },
  });
}

export function getDB(): Promise<DB> {
  if (!dbPromise) dbPromise = openCalameDB();
  return dbPromise;
}

/** Réservé aux tests : remplace la base courante. */
export function setDBForTests(p: Promise<DB> | null): void {
  dbPromise = p;
}
