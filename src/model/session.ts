import type { Notebook, Page, Stroke } from './types';

/**
 * État en mémoire d'un carnet ouvert + historique annuler/rétablir.
 *
 * Toute modification de traits passe par `apply()` sous forme de « changements »
 * {before, after} : before absent = création, after absent = suppression.
 * L'annulation réapplique les `before`, le rétablissement les `after`.
 * Les traits sont immuables : une modification remplace l'objet.
 */
export interface StrokeChange {
  id: string;
  pageId: string;
  before?: Stroke;
  after?: Stroke;
}

export interface ChangeSet {
  label: string;
  changes: StrokeChange[];
}

export interface SessionPersistence {
  saveStrokes(notebookId: string, put: Stroke[], del: string[]): void;
}

export interface SessionEvent {
  pages: Set<string>;
  /** Vrai si seuls des traits ont été ajoutés (permet un rendu incrémental). */
  additiveOnly: boolean;
  added: Stroke[];
}

const MAX_HISTORY = 200;

export class NotebookSession {
  notebook: Notebook;
  pages = new Map<string, Page>();
  private strokes = new Map<string, Map<string, Stroke>>();
  private sorted = new Map<string, Stroke[]>();
  private undoStack: ChangeSet[] = [];
  private redoStack: ChangeSet[] = [];
  private batch: { label: string; map: Map<string, StrokeChange> } | null = null;
  private listeners = new Set<(e: SessionEvent) => void>();
  private historyListeners = new Set<() => void>();
  readOnly = false;

  constructor(
    notebook: Notebook,
    pages: Page[],
    strokes: Stroke[],
    private readonly persistence: SessionPersistence,
  ) {
    this.notebook = notebook;
    for (const p of pages) {
      this.pages.set(p.id, p);
      this.strokes.set(p.id, new Map());
    }
    for (const s of strokes) this.strokes.get(s.pageId)?.set(s.id, s);
  }

  // ---------- Lecture ----------

  get pageOrder(): Page[] {
    return this.notebook.pageIds.map((id) => this.pages.get(id)).filter((p): p is Page => !!p);
  }

  /** Traits d'une page triés par ordre d'empilement (tableau mis en cache). */
  getStrokes(pageId: string): Stroke[] {
    let arr = this.sorted.get(pageId);
    if (!arr) {
      arr = Array.from(this.strokes.get(pageId)?.values() ?? []).sort(
        (a, b) => a.order - b.order || (a.id < b.id ? -1 : 1),
      );
      this.sorted.set(pageId, arr);
    }
    return arr;
  }

  getStroke(pageId: string, id: string): Stroke | undefined {
    return this.strokes.get(pageId)?.get(id);
  }

  strokeCount(): number {
    let n = 0;
    for (const m of this.strokes.values()) n += m.size;
    return n;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0 && !this.readOnly;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0 && !this.readOnly;
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

  private emit(changes: StrokeChange[]): void {
    const pages = new Set<string>();
    let additiveOnly = true;
    const added: Stroke[] = [];
    for (const c of changes) {
      pages.add(c.pageId);
      if (c.before || !c.after) additiveOnly = false;
      else added.push(c.after);
    }
    for (const l of this.listeners) l({ pages, additiveOnly, added });
  }

  private emitHistory(): void {
    for (const l of this.historyListeners) l();
  }

  // ---------- Écriture ----------

  private applyRaw(changes: StrokeChange[], direction: 'after' | 'before'): void {
    for (const c of changes) {
      const m = this.strokes.get(c.pageId);
      if (!m) continue;
      const target = c[direction];
      if (target) m.set(c.id, target);
      else m.delete(c.id);
      this.sorted.delete(c.pageId);
    }
  }

  private persist(changes: StrokeChange[], direction: 'after' | 'before'): void {
    const put: Stroke[] = [];
    const del: string[] = [];
    for (const c of changes) {
      const t = c[direction];
      if (t) put.push(t);
      else del.push(c.id);
    }
    if (put.length || del.length) this.persistence.saveStrokes(this.notebook.id, put, del);
  }

  /** Applique des changements (enregistrés dans l'historique et persistés). */
  apply(changes: StrokeChange[], label: string): void {
    if (this.readOnly || changes.length === 0) return;
    this.applyRaw(changes, 'after');
    if (this.batch) {
      for (const c of changes) {
        const prev = this.batch.map.get(c.id);
        if (prev) prev.after = c.after;
        else this.batch.map.set(c.id, { ...c });
      }
    } else {
      this.persist(changes, 'after');
      this.pushUndo({ label, changes });
    }
    this.emit(changes);
  }

  /** Regroupe plusieurs `apply` (ex. un geste de gomme) en une seule étape d'annulation. */
  beginBatch(label: string): void {
    if (!this.batch) this.batch = { label, map: new Map() };
  }

  endBatch(): void {
    const b = this.batch;
    this.batch = null;
    if (!b) return;
    const net = Array.from(b.map.values()).filter((c) => c.before || c.after);
    if (net.length === 0) return;
    this.persist(net, 'after');
    this.pushUndo({ label: b.label, changes: net });
  }

  private pushUndo(cs: ChangeSet): void {
    this.undoStack.push(cs);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.emitHistory();
  }

  undo(): ChangeSet | undefined {
    if (!this.canUndo || this.batch) return;
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
    if (!this.canRedo || this.batch) return;
    const cs = this.redoStack.pop()!;
    this.applyRaw(cs.changes, 'after');
    this.persist(cs.changes, 'after');
    this.undoStack.push(cs);
    this.emit(cs.changes);
    this.emitHistory();
    return cs;
  }

  // ---------- Pages ----------

  addPage(page: Page, extraStrokes: Stroke[] = []): void {
    this.pages.set(page.id, page);
    const m = new Map<string, Stroke>();
    for (const s of extraStrokes) m.set(s.id, s);
    this.strokes.set(page.id, m);
    this.sorted.delete(page.id);
  }

  removePage(pageId: string): void {
    this.pages.delete(pageId);
    this.strokes.delete(pageId);
    this.sorted.delete(pageId);
    // L'historique ne doit pas pouvoir recréer des traits sur une page supprimée.
    const keep = (cs: ChangeSet) => cs.changes.every((c) => c.pageId !== pageId);
    this.undoStack = this.undoStack.filter(keep);
    this.redoStack = this.redoStack.filter(keep);
    this.emitHistory();
  }

  setNotebook(n: Notebook): void {
    this.notebook = n;
  }

  /**
   * Remplace les traits d'une page par l'état stocké (modification venue d'un autre onglet).
   * L'historique local est vidé : il pourrait sinon écraser le travail de l'autre onglet.
   */
  reloadPage(pageId: string, strokes: Stroke[]): void {
    const m = new Map<string, Stroke>();
    for (const s of strokes) m.set(s.id, s);
    this.strokes.set(pageId, m);
    this.sorted.delete(pageId);
    this.undoStack = [];
    this.redoStack = [];
    this.emitHistory();
    for (const l of this.listeners) l({ pages: new Set([pageId]), additiveOnly: false, added: [] });
  }
}
