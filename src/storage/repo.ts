import { getDB, type DB } from './db';
import { migrateFolder, migrateItem, migrateNotebook, migratePage, migrateStroke } from './migrations';
import { newId } from '../model/ids';
import {
  DEFAULT_PAPER,
  SCHEMA_VERSION,
  pageSize,
  type BlobRecord,
  type CoverPattern,
  type Folder,
  type Notebook,
  type NotebookKind,
  type Orientation,
  type Page,
  type PageFormat,
  type PageItem,
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
  items: PageItem[];
}

export interface NotebookMeta {
  notebook: Notebook;
  pages: Page[];
}

export interface PageContent {
  strokes: Stroke[];
  items: PageItem[];
}

export interface ChangeDelta {
  strokesPut: Stroke[];
  strokesDel: string[];
  itemsPut: PageItem[];
  itemsDel: string[];
}

export function makePage(
  notebookId: string,
  paper: PaperSpec,
  size: { width: number; height: number } = pageSize('A4', 'portrait'),
  now = Date.now(),
): Page {
  return {
    id: newId(),
    notebookId,
    width: size.width,
    height: size.height,
    paper: { ...paper },
    createdAt: now,
    updatedAt: now,
    v: SCHEMA_VERSION,
  };
}

export interface NewNotebookOptions {
  title: string;
  cover: string;
  coverPattern?: CoverPattern;
  paper?: PaperSpec;
  format?: PageFormat;
  orientation?: Orientation;
  kind?: NotebookKind;
  folderId?: string | null;
}

export class Repo {
  constructor(private readonly db: () => Promise<DB> = getDB) {}

  // ---------- Carnets ----------

  async listNotebooks(): Promise<Notebook[]> {
    const db = await this.db();
    return (await db.getAll('notebooks')).map((n) => migrateNotebook(n as never));
  }

  async getNotebook(id: string): Promise<Notebook | undefined> {
    const db = await this.db();
    const n = await db.get('notebooks', id);
    return n ? migrateNotebook(n as never) : undefined;
  }

  async createNotebook(opts: NewNotebookOptions, firstPageContent?: { items?: PageItem[] }): Promise<Notebook> {
    const now = Date.now();
    const id = newId();
    const paper = opts.paper ?? DEFAULT_PAPER;
    const format = opts.format ?? 'A4';
    const orientation = opts.orientation ?? 'portrait';
    const page = makePage(id, paper, pageSize(format, orientation), now);
    const nb: Notebook = {
      id,
      title: opts.title.trim() || 'Sans titre',
      cover: opts.cover,
      coverPattern: opts.coverPattern ?? 'plain',
      paper: { ...paper },
      format,
      orientation,
      kind: opts.kind ?? 'notebook',
      folderId: opts.folderId ?? null,
      pageIds: [page.id],
      favorite: false,
      createdAt: now,
      updatedAt: now,
      openedAt: now,
      trashedAt: null,
      v: SCHEMA_VERSION,
    };
    const db = await this.db();
    const tx = db.transaction(['notebooks', 'pages', 'items'], 'readwrite');
    const ops: Promise<unknown>[] = [tx.objectStore('notebooks').add(nb), tx.objectStore('pages').add(page)];
    for (const it of firstPageContent?.items ?? []) ops.push(tx.objectStore('items').add({ ...it, pageId: page.id }));
    await Promise.all([...ops, tx.done]);
    return nb;
  }

  /** Lecture-modification-écriture atomique d'un carnet. */
  async updateNotebook(id: string, fn: (n: Notebook) => Notebook | void): Promise<Notebook> {
    const db = await this.db();
    const tx = db.transaction('notebooks', 'readwrite');
    const raw = await tx.store.get(id);
    if (!raw) throw new Error('Carnet introuvable');
    const n = { ...migrateNotebook(raw as never) };
    const next = fn(n) ?? n;
    await tx.store.put(next);
    await tx.done;
    return next;
  }

  /** Métadonnées du carnet et de ses pages, sans leur contenu (chargé page par page). */
  async loadNotebookMeta(id: string): Promise<NotebookMeta | undefined> {
    const db = await this.db();
    const tx = db.transaction(['notebooks', 'pages'], 'readonly');
    const raw = await tx.objectStore('notebooks').get(id);
    if (!raw) return undefined;
    const notebook = migrateNotebook(raw as never);
    const pages = (await tx.objectStore('pages').index('notebookId').getAll(id)).map((p) => migratePage(p as never));
    await tx.done;
    // Réparation défensive : pages présentes en base mais absentes de l'ordre.
    const known = new Set(notebook.pageIds);
    const orphans = pages.filter((p) => !known.has(p.id)).sort((a, b) => a.createdAt - b.createdAt);
    const existing = new Set(pages.map((p) => p.id));
    const fixed = { ...notebook };
    fixed.pageIds = notebook.pageIds.filter((pid) => existing.has(pid)).concat(orphans.map((p) => p.id));
    return { notebook: fixed, pages };
  }

  async loadPageContent(pageId: string): Promise<PageContent> {
    const db = await this.db();
    const tx = db.transaction(['strokes', 'items'], 'readonly');
    const strokes = (await tx.objectStore('strokes').index('pageId').getAll(pageId)).map((s) => migrateStroke(s as never));
    const items = (await tx.objectStore('items').index('pageId').getAll(pageId)).map((i) => migrateItem(i as never));
    await tx.done;
    return { strokes, items };
  }

  /** Contenu complet (tests, outils) : préférer loadNotebookMeta + loadPageContent. */
  async loadNotebookContent(id: string): Promise<NotebookContent | undefined> {
    const meta = await this.loadNotebookMeta(id);
    if (!meta) return undefined;
    const strokes: Stroke[] = [];
    const items: PageItem[] = [];
    for (const p of meta.pages) {
      const c = await this.loadPageContent(p.id);
      strokes.push(...c.strokes);
      items.push(...c.items);
    }
    return { ...meta, strokes, items };
  }

  async loadPageStrokes(pageId: string): Promise<Stroke[]> {
    return (await this.loadPageContent(pageId)).strokes;
  }

  /** Écrit un lot de modifications (traits et objets) et date le carnet, en une transaction. */
  async saveChanges(notebookId: string, d: ChangeDelta): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['strokes', 'items', 'notebooks'], 'readwrite');
    const ops: Promise<unknown>[] = [];
    for (const s of d.strokesPut) ops.push(tx.objectStore('strokes').put(s));
    for (const id of d.strokesDel) ops.push(tx.objectStore('strokes').delete(id));
    for (const it of d.itemsPut) ops.push(tx.objectStore('items').put(it));
    for (const id of d.itemsDel) ops.push(tx.objectStore('items').delete(id));
    const nbStore = tx.objectStore('notebooks');
    const nb = await nbStore.get(notebookId);
    if (nb) ops.push(nbStore.put({ ...nb, updatedAt: Date.now() }));
    await Promise.all([...ops, tx.done]);
  }

  /** Compatibilité : écriture de traits seuls. */
  async saveStrokes(notebookId: string, put: Stroke[], del: string[]): Promise<void> {
    return this.saveChanges(notebookId, { strokesPut: put, strokesDel: del, itemsPut: [], itemsDel: [] });
  }

  // ---------- Pages ----------

  async insertPage(
    notebookId: string,
    index: number,
    paper: PaperSpec,
    size?: { width: number; height: number },
  ): Promise<Page> {
    const db = await this.db();
    const tx = db.transaction(['notebooks', 'pages'], 'readwrite');
    const nbStore = tx.objectStore('notebooks');
    const raw = await nbStore.get(notebookId);
    if (!raw) throw new Error('Carnet introuvable');
    const nb = migrateNotebook(raw as never);
    const page = makePage(notebookId, paper, size ?? pageSize(nb.format, nb.orientation));
    const ids = nb.pageIds.slice();
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, page.id);
    await Promise.all([
      tx.objectStore('pages').add(page),
      nbStore.put({ ...nb, pageIds: ids, updatedAt: Date.now() }),
      tx.done,
    ]);
    return page;
  }

  /** Duplique une page, ses traits et ses objets (nouveaux identifiants) juste après l'originale. */
  async duplicatePage(notebookId: string, pageId: string): Promise<{ page: Page; strokes: Stroke[]; items: PageItem[] }> {
    const db = await this.db();
    const tx = db.transaction(['notebooks', 'pages', 'strokes', 'items'], 'readwrite');
    const src = await tx.objectStore('pages').get(pageId);
    const nbRaw = await tx.objectStore('notebooks').get(notebookId);
    if (!src || !nbRaw) throw new Error('Page introuvable');
    const nb = migrateNotebook(nbRaw as never);
    const now = Date.now();
    const page: Page = { ...migratePage(src as never), id: newId(), createdAt: now, updatedAt: now };
    const srcStrokes = await tx.objectStore('strokes').index('pageId').getAll(pageId);
    const srcItems = await tx.objectStore('items').index('pageId').getAll(pageId);
    const strokes = srcStrokes.map((s) => ({ ...migrateStroke(s as never), id: newId(), pageId: page.id }));
    const items = srcItems.map((i) => ({ ...migrateItem(i as never), id: newId(), pageId: page.id }));
    const ids = nb.pageIds.slice();
    ids.splice(ids.indexOf(pageId) + 1, 0, page.id);
    await Promise.all([
      tx.objectStore('pages').add(page),
      ...strokes.map((c) => tx.objectStore('strokes').add(c)),
      ...items.map((c) => tx.objectStore('items').add(c)),
      tx.objectStore('notebooks').put({ ...nb, pageIds: ids, updatedAt: now }),
      tx.done,
    ]);
    return { page, strokes, items };
  }

  async deletePage(notebookId: string, pageId: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['notebooks', 'pages', 'strokes', 'items'], 'readwrite');
    const nbRaw = await tx.objectStore('notebooks').get(notebookId);
    if (!nbRaw) throw new Error('Carnet introuvable');
    const nb = migrateNotebook(nbRaw as never);
    if (nb.pageIds.length <= 1) throw new Error('Un carnet contient au moins une page.');
    const keys = await tx.objectStore('strokes').index('pageId').getAllKeys(pageId);
    const itemKeys = await tx.objectStore('items').index('pageId').getAllKeys(pageId);
    await Promise.all([
      ...keys.map((k) => tx.objectStore('strokes').delete(k)),
      ...itemKeys.map((k) => tx.objectStore('items').delete(k)),
      tx.objectStore('pages').delete(pageId),
      tx.objectStore('notebooks').put({ ...nb, pageIds: nb.pageIds.filter((p) => p !== pageId), updatedAt: Date.now() }),
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

  /** Suppression définitive d'un carnet et de tout son contenu (images comprises). */
  async deleteNotebookForever(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['notebooks', 'pages', 'strokes', 'items', 'blobs'], 'readwrite');
    const pageKeys = await tx.objectStore('pages').index('notebookId').getAllKeys(id);
    const ops: Promise<unknown>[] = [];
    for (const pk of pageKeys) {
      for (const k of await tx.objectStore('strokes').index('pageId').getAllKeys(pk)) ops.push(tx.objectStore('strokes').delete(k));
      for (const it of await tx.objectStore('items').index('pageId').getAll(pk)) {
        ops.push(tx.objectStore('items').delete(it.id));
        if (it.kind === 'image') ops.push(tx.objectStore('blobs').delete(it.blobId));
      }
      ops.push(tx.objectStore('pages').delete(pk));
    }
    ops.push(tx.objectStore('notebooks').delete(id));
    await Promise.all([...ops, tx.done]);
  }

  // ---------- Dossiers (un seul niveau) ----------

  async listFolders(): Promise<Folder[]> {
    const db = await this.db();
    return (await db.getAll('folders')).map((f) => migrateFolder(f as never));
  }

  async createFolder(name: string, color = '#8a8f98'): Promise<Folder> {
    const now = Date.now();
    const f: Folder = { id: newId(), name: name.trim() || 'Nouveau dossier', color, createdAt: now, updatedAt: now, v: SCHEMA_VERSION };
    const db = await this.db();
    await db.add('folders', f);
    return f;
  }

  async renameFolder(id: string, name: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('folders', 'readwrite');
    const f = await tx.store.get(id);
    if (f) await tx.store.put({ ...f, name: name.trim() || f.name, updatedAt: Date.now() });
    await tx.done;
  }

  /** Supprime le dossier ; ses carnets reviennent à la racine (rien n'est effacé). */
  async deleteFolder(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['folders', 'notebooks'], 'readwrite');
    const nbs = await tx.objectStore('notebooks').getAll();
    const ops: Promise<unknown>[] = [];
    for (const n of nbs) {
      if ((n as Notebook).folderId === id) ops.push(tx.objectStore('notebooks').put({ ...n, folderId: null }));
    }
    ops.push(tx.objectStore('folders').delete(id));
    await Promise.all([...ops, tx.done]);
  }

  // ---------- Binaires (images) ----------

  async putBlob(rec: BlobRecord): Promise<void> {
    const db = await this.db();
    await db.put('blobs', rec);
  }

  async getBlob(id: string): Promise<BlobRecord | undefined> {
    const db = await this.db();
    return db.get('blobs', id);
  }

  // ---------- Méta ----------

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
