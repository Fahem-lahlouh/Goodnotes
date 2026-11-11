import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Notebook, Page, Stroke } from '../model/types';

/**
 * Base IndexedDB locale.
 *
 * Versions de la base (structure des magasins) :
 *  1 — notebooks, pages, strokes (index pageId), meta.
 * Les migrations de structure sont appliquées dans `upgrade` ; les migrations
 * d'enregistrements (champ `v`) sont dans migrations.ts.
 */
export const DB_NAME = 'calame';
export const DB_VERSION = 1;

export interface CalameDB extends DBSchema {
  notebooks: { key: string; value: Notebook };
  pages: { key: string; value: Page; indexes: { notebookId: string } };
  strokes: { key: string; value: Stroke; indexes: { pageId: string } };
  meta: { key: string; value: { key: string; value: unknown } };
}

export type DB = IDBPDatabase<CalameDB>;

let dbPromise: Promise<DB> | null = null;

export function openCalameDB(name = DB_NAME): Promise<DB> {
  return openDB<CalameDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('notebooks', { keyPath: 'id' });
        const pages = db.createObjectStore('pages', { keyPath: 'id' });
        pages.createIndex('notebookId', 'notebookId');
        const strokes = db.createObjectStore('strokes', { keyPath: 'id' });
        strokes.createIndex('pageId', 'pageId');
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      // Futures versions : `if (oldVersion < 2) { ... }`
    },
    blocked() {
      console.warn('[calame] mise à jour de la base bloquée par un autre onglet');
    },
    blocking() {
      // Une nouvelle version de l'app (autre onglet) veut migrer : on libère la base.
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
