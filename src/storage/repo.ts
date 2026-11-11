import { getDB, type DB } from './db';
import { migrateNotebook, migratePage, migrateStroke } from './migrations';
import { newId } from '../model/ids';
import {
  DEFAULT_PAPER,
  PAGE_A4,
  SCHEMA_VERSION,
  type Notebook,
  type Page,
  type PaperSpec,
  type Stroke,
} from '../model/types';

/**
 * Accès aux données locales. Chaque opération qui touche plusieurs
 * enregistrements s'exécute dans UNE transaction IndexedDB : elle réussit ou
 * échoue en bloc (pas de carnet sans page, pas de page orpheline).
 * Les lectures-modifications-écritures du carnet se font dans la même transaction,
 * ce qui les sérialise aussi entre onglets.
 */

export interface NotebookContent {
  notebook: Notebook;
  pages: Page[];
  strokes: Stroke[];
}

export function makePage(notebookId: string, paper: PaperSpec, now = Date.now()): Page {
  return {
    id: newId(),
    notebookId,
    width: PAGE_A4.width,
    height: PAGE_A4.height,
    paper: { ...paper },
    createdAt: now,
    updatedAt: now,
    v: SCHEMA_VERSION,
  };
}

export class Repo {
  constructor(private readonly db: () => Promise<DB> = getDB) {}

  async listNotebooks(): Promise<Notebook[]> {
    const db = await this.db();
    return (await db.getAll('notebooks')).map((n) => migrateNotebook(n as never));
  }

  async getNotebook(id: string): Promise<Notebook | undefined> {
    const db = await this.db();
    const n = await db.get('notebooks', id);
    return n ? migrateNotebook(n as never) : undefined;
  }

  async createNotebook(opts: { title: string; cover: string; paper?: PaperSpec }): Promise<Notebook> {
    const now = Date.now();
    const id = newId();
    const paper = opts.paper ?? DEFAULT_PAPER;
    const page = makePage(id, paper, now);
    const nb: Notebook = {
      id,
      title: opts.title.trim() || 'Sans titre',
      cover: opts.cover,
      paper: { ...paper },
      pageIds: [page.id],
      favorite: false,
      createdAt: now,
      updatedAt: now,
      openedAt: now,
      trashedAt: null,
      v: SCHEMA_VERSION,
    };
    const db = await this.db();
    const tx = db.transaction(['notebooks', 'pages'], 'readwrite');
    await Promise.all([tx.objectStore('notebooks').add(nb), tx.objectStore('pages').add(page), tx.done]);
    return nb;
  }

  /** Lecture-modification-écriture atomique d'un carnet. */
  async updateNotebook(id: string, fn: (n: Notebook) => Notebook | void): Promise<Notebook> {
    const db = await this.db();
    const tx = db.transaction('notebooks', 'readwrite');
    const raw = await tx.store.get(id);
    if (!raw) throw new Error('Carnet introuvable');
    const n = migrateNotebook(raw as never);
    const next = fn(n) ?? n;
    await tx.store.put(next);
    await tx.done;
    return next;
  }

  async loadNotebookContent(id: string): Promise<NotebookContent | undefined> {
    const db = await this.db();
    const tx = db.transaction(['notebooks', 'pages', 'strokes'], 'readonly');
    const raw = await tx.objectStore('notebooks').get(id);
    if (!raw) return undefined;
    const notebook = migrateNotebook(raw as never);
    const pages = (await tx.objectStore('pages').index('notebookId').getAll(id)).map((p) =>
      migratePage(p as never),
    );
    const strokes: Stroke[] = [];
    const idx = tx.objectStore('strokes').index('pageId');
    for (const p of pages) {
      for (const s of await idx.getAll(p.id)) strokes.push(migrateStroke(s as never));
    }
    await tx.done;
    // Réparation défensive : pages présentes en base mais absentes de l'ordre.
    const known = new Set(notebook.pageIds);
    const orphans = pages.filter((p) => !known.has(p.id)).sort((a, b) => a.createdAt - b.createdAt);
    const existing = new Set(pages.map((p) => p.id));
    notebook.pageIds = notebook.pageIds.filter((pid) => existing.has(pid)).concat(orphans.map((p) => p.id));
    return { notebook, pages, strokes };
  }

  async loadPageStrokes(pageId: string): Promise<Stroke[]> {
    const db = await this.db();
    return (await db.getAllFromIndex('strokes', 'pageId', pageId)).map((s) => migrateStroke(s as never));
  }

  /** Écrit un lot de modifications de traits et met à jour la date du carnet, en une transaction. */
  async saveStrokes(notebookId: string, put: Stroke[], del: string[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['strokes', 'notebooks'], 'readwrite');
    const strokes = tx.objectStore('strokes');
    const ops: Promise<unknown>[] = [];
    for (const s of put) ops.push(strokes.put(s));
    for (const id of del) ops.push(strokes.delete(id));
    const nbStore = tx.objectStore('notebooks');
    const nb = await nbStore.get(notebookId);
    if (nb) ops.push(nbStore.put({ ...nb, updatedAt: Date.now() }));
    await Promise.all([...ops, tx.done]);
  }

  async insertPage(notebookId: string, index: number, paper: PaperSpec): Promise<Page> {
    const page = makePage(notebookId, paper);
    const db = await this.db();
    const tx = db.transaction(['notebooks', 'pages'], 'readwrite');
    const nbStore = tx.objectStore('notebooks');
    const raw = await nbStore.get(notebookId);
    if (!raw) throw new Error('Carnet introuvable');
    const nb = migrateNotebook(raw as never);
    const ids = nb.pageIds.slice();
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, page.id);
    await Promise.all([
      tx.objectStore('pages').add(page),
      nbStore.put({ ...nb, pageIds: ids, updatedAt: Date.now() }),
      tx.done,
    ]);
    return page;
  }

  /** Duplique une page et ses traits (nouveaux identifiants) juste après l'originale. */
  async duplicatePage(notebookId: string, pageId: string): Promise<{ page: Page; strokes: Stroke[] }> {
    const db = await this.db();
    const tx = db.transaction(['notebooks', 'pages', 'strokes'], 'readwrite');
    const src = await tx.objectStore('pages').get(pageId);
    const nbRaw = await tx.objectStore('notebooks').get(notebookId);
    if (!src || !nbRaw) throw new Error('Page introuvable');
    const nb = migrateNotebook(nbRaw as never);
    const now = Date.now();
    const page: Page = { ...migratePage(src as never), id: newId(), createdAt: now, updatedAt: now };
    const srcStrokes = await tx.objectStore('strokes').index('pageId').getAll(pageId);
    const copies = srcStrokes.map((s) => ({ ...migrateStroke(s as never), id: newId(), pageId: page.id }));
    const ids = nb.pageIds.slice();
    ids.splice(ids.indexOf(pageId) + 1, 0, page.id);
    await Promise.all([
      tx.objectStore('pages').add(page),
      ...copies.map((c) => tx.objectStore('strokes').add(c)),
      tx.objectStore('notebooks').put({ ...nb, pageIds: ids, updatedAt: now }),
      tx.done,
    ]);
    return { page, strokes: copies };
  }

  async deletePage(notebookId: string, pageId: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['notebooks', 'pages', 'strokes'], 'readwrite');
    const nbRaw = await tx.objectStore('notebooks').get(notebookId);
    if (!nbRaw) throw new Error('Carnet introuvable');
    const nb = migrateNotebook(nbRaw as never);
    if (nb.pageIds.length <= 1) throw new Error('Un carnet contient au moins une page.');
    const keys = await tx.objectStore('strokes').index('pageId').getAllKeys(pageId);
    await Promise.all([
      ...keys.map((k) => tx.objectStore('strokes').delete(k)),
      tx.objectStore('pages').delete(pageId),
      tx.objectStore('notebooks').put({
        ...nb,
        pageIds: nb.pageIds.filter((p) => p !== pageId),
        updatedAt: Date.now(),
      }),
      tx.done,
    ]);
  }

  async movePage(notebookId: string, pageId: string, toIndex: number): Promise<Notebook> {
    return this.updateNotebook(notebookId, (n) => {
      const ids = n.pageIds.filter((p) => p !== pageId);
      ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, pageId);
      n.pageIds = ids;
      n.updatedAt = Date.now();
    });
  }

  async updatePagePaper(pageId: string, paper: PaperSpec): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('pages', 'readwrite');
    const p = await tx.store.get(pageId);
    if (p) await tx.store.put({ ...p, paper: { ...paper }, updatedAt: Date.now() });
    await tx.done;
  }

  /** Suppression définitive d'un carnet et de tout son contenu. */
  async deleteNotebookForever(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['notebooks', 'pages', 'strokes'], 'readwrite');
    const pageKeys = await tx.objectStore('pages').index('notebookId').getAllKeys(id);
    const ops: Promise<unknown>[] = [];
    for (const pk of pageKeys) {
      const sk = await tx.objectStore('strokes').index('pageId').getAllKeys(pk);
      for (const k of sk) ops.push(tx.objectStore('strokes').delete(k));
      ops.push(tx.objectStore('pages').delete(pk));
    }
    ops.push(tx.objectStore('notebooks').delete(id));
    await Promise.all([...ops, tx.done]);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const db = await this.db();
    return (await db.get('meta', key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const db = await this.db();
    await db.put('meta', { key, value });
  }
}

export const repo = new Repo();
