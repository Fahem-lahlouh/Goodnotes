import type { Notebook, Page, PageItem, Stroke } from './types';

/**
 * État en mémoire d'un carnet ouvert + historique annuler/rétablir.
 *
 * Portée de l'historique : LE DOCUMENT (le carnet), 500 étapes, non conservé après
 * fermeture. Chaque étape mémorise la page qu'elle concerne : l'interface affiche
 * cette page avant d'annuler ou de rétablir, pour ne jamais modifier une page invisible.
 * Les opérations sur les pages (ajout, déplacement, suppression) ne font pas partie de
 * l'historique ; supprimer une page retire de l'historique les étapes qui la concernent.
 *
 * Toute modification passe par `apply()` sous forme de « changements »
 * {before, after} : before absent = création, after absent = suppression.
 * Les éléments sont immuables : une modification remplace l'objet.
 */
export type ElementKind = 'stroke' | 'item';

export type Change =
  | { kind: 'stroke'; id: string; pageId: string; before?: Stroke; after?: Stroke }
  | { kind: 'item'; id: string; pageId: string; before?: PageItem; after?: PageItem };

export interface ChangeSet {
  label: string;
  pageId: string;
  changes: Change[];
}

export interface PersistDelta {
  strokesPut: Stroke[];
  strokesDel: string[];
  itemsPut: PageItem[];
  itemsDel: string[];
  pageIds: string[];
}

export interface SessionPersistence {
  save(notebookId: string, delta: PersistDelta): void;
}

export type PageLoader = (pageId: string) => Promise<{ strokes: Stroke[]; items: PageItem[] }>;

export interface SessionEvent {
  pages: Set<string>;
  /** Vrai si seuls des éléments ont été ajoutés au-dessus des autres (rendu incrémental possible). */
  additiveOnly: boolean;
  added: Stroke[];
  /** Vrai si l'événement provient d'un chargement de page (pas d'une modification). */
  loaded?: boolean;
}

export const MAX_HISTORY = 500;

export class NotebookSession {
  notebook: Notebook;
  pages = new Map<string, Page>();
  private strokes = new Map<string, Map<string, Stroke>>();
  private items = new Map<string, Map<string, PageItem>>();
  private sortedStrokes = new Map<string, Stroke[]>();
  private sortedItems = new Map<string, PageItem[]>();
  private loading = new Map<string, Promise<void>>();
  private undoStack: ChangeSet[] = [];
  private redoStack: ChangeSet[] = [];
  private batch: { label: string; pageId: string; map: Map<string, Change> } | null = null;
  private listeners = new Set<(e: SessionEvent) => void>();
  private historyListeners = new Set<() => void>();
  private _readOnly = false;

  constructor(
    notebook: Notebook,
    pages: Page[],
    private readonly persistence: SessionPersistence,
    private readonly loader: PageLoader = async () => ({ strokes: [], items: [] }),
    preloaded?: { strokes: Stroke[]; items?: PageItem[] },
  ) {
    this.notebook = notebook;
    for (const p of pages) this.pages.set(p.id, p);
    if (preloaded) {
      for (const p of pages) this.setPageContent(p.id, [], []);
      for (const s of preloaded.strokes) this.strokes.get(s.pageId)?.set(s.id, s);
      for (const i of preloaded.items ?? []) this.items.get(i.pageId)?.set(i.id, i);
    }
  }

  // ---------- Chargement paresseux ----------

  isLoaded(pageId: string): boolean {
    return this.strokes.has(pageId);
  }

  /** Charge le contenu d'une page si nécessaire (une seule fois). */
  ensurePage(pageId: string): Promise<void> {
    if (this.strokes.has(pageId) || !this.pages.has(pageId)) return Promise.resolve();
    let p = this.loading.get(pageId);
    if (!p) {
      p = this.loader(pageId).then(
        (c) => {
          this.loading.delete(pageId);
          if (this.strokes.has(pageId) || !this.pages.has(pageId)) return;
          this.setPageContent(pageId, c.strokes, c.items);
          for (const l of this.listeners) l({ pages: new Set([pageId]), additiveOnly: false, added: [], loaded: true });
        },
        (e) => {
          this.loading.delete(pageId);
          throw e;
        },
      );
      this.loading.set(pageId, p);
    }
    return p;
  }

  private setPageContent(pageId: string, strokes: Stroke[], items: PageItem[]): void {
    const sm = new Map<string, Stroke>();
    for (const s of strokes) sm.set(s.id, s);
    const im = new Map<string, PageItem>();
    for (const i of items) im.set(i.id, i);
    this.strokes.set(pageId, sm);
    this.items.set(pageId, im);
    this.sortedStrokes.delete(pageId);
    this.sortedItems.delete(pageId);
  }

  // ---------- Lecture ----------

  get pageOrder(): Page[] {
    return this.notebook.pageIds.map((id) => this.pages.get(id)).filter((p): p is Page => !!p);
  }

  pageIndex(pageId: string): number {
    return this.notebook.pageIds.indexOf(pageId);
  }

  /** Traits d'une page triés par ordre d'empilement (tableau mis en cache). */
  getStrokes(pageId: string): Stroke[] {
    let arr = this.sortedStrokes.get(pageId);
    if (!arr) {
      arr = Array.from(this.strokes.get(pageId)?.values() ?? []).sort(
        (a, b) => a.order - b.order || (a.id < b.id ? -1 : 1),
      );
      this.sortedStrokes.set(pageId, arr);
    }
    return arr;
  }

  getItems(pageId: string): PageItem[] {
    let arr = this.sortedItems.get(pageId);
    if (!arr) {
      arr = Array.from(this.items.get(pageId)?.values() ?? []).sort(
        (a, b) => a.order - b.order || (a.id < b.id ? -1 : 1),
      );
      this.sortedItems.set(pageId, arr);
    }
    return arr;
  }

  getStroke(pageId: string, id: string): Stroke | undefined {
    return this.strokes.get(pageId)?.get(id);
  }

  getItem(pageId: string, id: string): PageItem | undefined {
    return this.items.get(pageId)?.get(id);
  }

  strokeCount(): number {
    let n = 0;
    for (const m of this.strokes.values()) n += m.size;
    return n;
  }

  itemCount(): number {
    let n = 0;
    for (const m of this.items.values()) n += m.size;
    return n;
  }

  get readOnly(): boolean {
    return this._readOnly;
  }

  set readOnly(v: boolean) {
    if (v === this._readOnly) return;
    this._readOnly = v;
    this.emitHistory();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0 && !this._readOnly && !this.batch;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0 && !this._readOnly && !this.batch;
  }

  /** Étape qui serait annulée (pour afficher sa page d'abord). */
  peekUndo(): ChangeSet | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }

  peekRedo(): ChangeSet | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }

  get historySize(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }

  // ---------- Abonnements ----------

  onChange(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onHistory(fn: () => void): () => void {
    this.historyListeners.add(fn);
    return () => this.historyListeners.delete(fn);
  }

  private emit(changes: Change[]): void {
    const pages = new Set<string>();
    let additiveOnly = true;
    const added: Stroke[] = [];
    for (const c of changes) {
      pages.add(c.pageId);
      if (c.kind !== 'stroke' || c.before || !c.after) additiveOnly = false;
      else added.push(c.after);
    }
    for (const l of this.listeners) l({ pages, additiveOnly, added });
  }

  private emitHistory(): void {
    for (const l of this.historyListeners) l();
  }

  // ---------- Écriture ----------

  private applyRaw(changes: Change[], direction: 'after' | 'before'): void {
    for (const c of changes) {
      if (c.kind === 'stroke') {
        const m = this.strokes.get(c.pageId);
        if (!m) continue;
        const t = c[direction];
        if (t) m.set(c.id, t);
        else m.delete(c.id);
        this.sortedStrokes.delete(c.pageId);
      } else {
        const m = this.items.get(c.pageId);
        if (!m) continue;
        const t = c[direction];
        if (t) m.set(c.id, t);
        else m.delete(c.id);
        this.sortedItems.delete(c.pageId);
      }
    }
  }

  private persist(changes: Change[], direction: 'after' | 'before'): void {
    const d: PersistDelta = { strokesPut: [], strokesDel: [], itemsPut: [], itemsDel: [], pageIds: [] };
    const pages = new Set<string>();
    for (const c of changes) {
      pages.add(c.pageId);
      if (c.kind === 'stroke') {
        const t = c[direction];
        if (t) d.strokesPut.push(t);
        else d.strokesDel.push(c.id);
      } else {
        const t = c[direction];
        if (t) d.itemsPut.push(t);
        else d.itemsDel.push(c.id);
      }
    }
    d.pageIds = Array.from(pages);
    if (d.strokesPut.length || d.strokesDel.length || d.itemsPut.length || d.itemsDel.length) {
      this.persistence.save(this.notebook.id, d);
    }
  }

  /** Applique des changements (enregistrés dans l'historique et persistés). */
  apply(changes: Change[], label: string): boolean {
    if (this._readOnly || changes.length === 0) return false;
    this.applyRaw(changes, 'after');
    if (this.batch) {
      for (const c of changes) {
        const key = `${c.kind}:${c.id}`;
        const prev = this.batch.map.get(key);
        if (prev) (prev as { after?: unknown }).after = c.after;
        else this.batch.map.set(key, { ...c } as Change);
      }
    } else {
      this.persist(changes, 'after');
      this.pushUndo({ label, pageId: changes[0].pageId, changes });
    }
    this.emit(changes);
    return true;
  }

  /** Regroupe plusieurs `apply` (ex. un geste de gomme) en une seule étape d'annulation. */
  beginBatch(label: string, pageId: string): void {
    if (!this.batch) {
      this.batch = { label, pageId, map: new Map() };
      this.emitHistory();
    }
  }

  get inBatch(): boolean {
    return !!this.batch;
  }

  endBatch(): void {
    const b = this.batch;
    this.batch = null;
    if (!b) return;
    const net = Array.from(b.map.values()).filter((c) => c.before || c.after);
    if (net.length === 0) {
      this.emitHistory();
      return;
    }
    this.persist(net, 'after');
    this.pushUndo({ label: b.label, pageId: net[0].pageId, changes: net });
  }

  private pushUndo(cs: ChangeSet): void {
    this.undoStack.push(cs);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    // Une nouvelle modification invalide la branche de rétablissement.
    this.redoStack = [];
    this.emitHistory();
  }

  undo(): ChangeSet | undefined {
    if (!this.canUndo) return;
    const cs = this.undoStack.pop()!;
    const rev = cs.changes.slice().reverse();
    this.applyRaw(rev, 'before');
    this.persist(rev, 'before');
    this.redoStack.push(cs);
    this.emit(rev);
    this.emitHistory();
    return cs;
  }

  redo(): ChangeSet | undefined {
    if (!this.canRedo) return;
    const cs = this.redoStack.pop()!;
    this.applyRaw(cs.changes, 'after');
    this.persist(cs.changes, 'after');
    this.undoStack.push(cs);
    this.emit(cs.changes);
    this.emitHistory();
    return cs;
  }

  // ---------- Pages ----------

  addPage(page: Page, content?: { strokes?: Stroke[]; items?: PageItem[] }): void {
    this.pages.set(page.id, page);
    this.setPageContent(page.id, content?.strokes ?? [], content?.items ?? []);
  }

  removePage(pageId: string): void {
    this.pages.delete(pageId);
    this.strokes.delete(pageId);
    this.items.delete(pageId);
    this.sortedStrokes.delete(pageId);
    this.sortedItems.delete(pageId);
    // L'historique ne doit pas pouvoir recréer des éléments sur une page supprimée.
    const keep = (cs: ChangeSet) => cs.changes.every((c) => c.pageId !== pageId);
    this.undoStack = this.undoStack.filter(keep);
    this.redoStack = this.redoStack.filter(keep);
    this.emitHistory();
  }

  setNotebook(n: Notebook): void {
    this.notebook = n;
  }

  /** Met à jour les métadonnées d'une page (ex. modèle de papier) et redessine. */
  updatePage(page: Page): void {
    if (!this.pages.has(page.id)) return;
    this.pages.set(page.id, page);
    for (const l of this.listeners) l({ pages: new Set([page.id]), additiveOnly: false, added: [] });
  }

  /**
   * Remplace le contenu d'une page par l'état stocké (modification venue d'un autre onglet).
   * L'historique local est vidé : il pourrait sinon écraser le travail de l'autre onglet.
   */
  reloadPage(pageId: string, content: { strokes: Stroke[]; items: PageItem[] }): void {
    if (!this.pages.has(pageId)) return;
    this.setPageContent(pageId, content.strokes, content.items);
    this.undoStack = [];
    this.redoStack = [];
    this.emitHistory();
    for (const l of this.listeners) l({ pages: new Set([pageId]), additiveOnly: false, added: [] });
  }
}
