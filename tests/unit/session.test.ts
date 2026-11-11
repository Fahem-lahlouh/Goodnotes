import { describe, expect, it, vi } from 'vitest';
import { NotebookSession, type PersistDelta } from '../../src/model/session';
import type { Notebook, Page, TextItem } from '../../src/model/types';
import { DEFAULT_PAPER } from '../../src/model/types';
import { makeStroke } from './helpers';

export function testNotebook(pageIds: string[]): Notebook {
  return {
    id: 'nb', title: 't', cover: 'nuit', coverPattern: 'plain', paper: DEFAULT_PAPER, format: 'A4', orientation: 'portrait',
    kind: 'notebook', folderId: null, pageIds, favorite: false, createdAt: 0, updatedAt: 0, openedAt: 0, trashedAt: null, v: 2,
  };
}

function setup() {
  const page = (id: string): Page => ({ id, notebookId: 'nb', width: 794, height: 1123, paper: DEFAULT_PAPER, createdAt: 0, updatedAt: 0, v: 2 });
  const saves: { put: string[]; del: string[] }[] = [];
  const deltas: PersistDelta[] = [];
  const session = new NotebookSession(
    testNotebook(['p1', 'p2']),
    [page('p1'), page('p2')],
    {
      save: (_n, d) => {
        deltas.push(d);
        saves.push({ put: [...d.strokesPut.map((s) => s.id), ...d.itemsPut.map((s) => s.id)], del: [...d.strokesDel, ...d.itemsDel] });
      },
    },
    undefined,
    { strokes: [] },
  );
  return { session, saves, deltas };
}

const add = (s: ReturnType<typeof makeStroke>) => ({ kind: 'stroke' as const, id: s.id, pageId: s.pageId, after: s });

describe('NotebookSession — annuler / rétablir', () => {
  it('ajoute, annule et rétablit un trait en persistant chaque étape', () => {
    const { session, saves } = setup();
    const s = makeStroke('p1', [[0, 0], [10, 10]]);
    session.apply([add(s)], 'Trait');
    expect(session.getStrokes('p1')).toEqual([s]);
    session.undo();
    expect(session.getStrokes('p1')).toEqual([]);
    session.redo();
    expect(session.getStrokes('p1')).toEqual([s]);
    expect(saves).toEqual([
      { put: [s.id], del: [] },
      { put: [], del: [s.id] },
      { put: [s.id], del: [] },
    ]);
  });

  it('mémorise la page de chaque étape (pour l’afficher avant d’annuler)', () => {
    const { session } = setup();
    session.apply([add(makeStroke('p2', [[0, 0]]))], 'Trait');
    expect(session.peekUndo()?.pageId).toBe('p2');
    session.undo();
    expect(session.peekRedo()?.pageId).toBe('p2');
  });

  it('un geste de gomme groupé = une seule étape, et persistance nette', () => {
    const { session, saves } = setup();
    const a = makeStroke('p1', [[0, 0], [10, 0]]);
    session.apply([add(a)], 'Trait');
    saves.length = 0;
    session.beginBatch('Gomme', 'p1');
    expect(session.canUndo).toBe(false); // pas d'annulation pendant un geste
    const piece = makeStroke('p1', [[0, 0], [3, 0]]);
    session.apply([{ kind: 'stroke', id: a.id, pageId: 'p1', before: a }, add(piece)], 'Gomme');
    session.apply([{ kind: 'stroke', id: piece.id, pageId: 'p1', before: piece }], 'Gomme');
    session.endBatch();
    expect(saves).toEqual([{ put: [], del: [a.id] }]);
    expect(session.getStrokes('p1')).toEqual([]);
    session.undo();
    expect(session.getStrokes('p1').map((s) => s.id)).toEqual([a.id]);
  });

  it('une nouvelle action supprime la branche de rétablissement', () => {
    const { session } = setup();
    const a = makeStroke('p1', [[0, 0]]);
    const b = makeStroke('p1', [[5, 5]]);
    session.apply([add(a)], 'Trait');
    session.undo();
    expect(session.canRedo).toBe(true);
    session.apply([add(b)], 'Trait');
    expect(session.canRedo).toBe(false);
  });

  it('gère texte et traits dans la même étape (déplacement d’une sélection mixte)', () => {
    const { session, deltas } = setup();
    const s = makeStroke('p1', [[0, 0], [10, 10]]);
    const t: TextItem = {
      kind: 'text', id: 't1', pageId: 'p1', x: 10, y: 10, w: 100, h: 20, text: 'Bonjour', font: 'sans', size: 16,
      color: '#000000', bold: false, italic: false, underline: false, align: 'left', order: 1, createdAt: 0, v: 2,
    };
    session.apply([add(s), { kind: 'item', id: 't1', pageId: 'p1', after: t }], 'Ajout');
    const moved = { ...t, x: 50 };
    session.apply([{ kind: 'item', id: 't1', pageId: 'p1', before: t, after: moved }], 'Déplacer');
    expect(session.getItem('p1', 't1')?.x).toBe(50);
    session.undo();
    expect(session.getItem('p1', 't1')?.x).toBe(10);
    session.undo();
    expect(session.getItems('p1')).toEqual([]);
    expect(session.getStrokes('p1')).toEqual([]);
    expect(deltas.at(-1)).toMatchObject({ strokesDel: [s.id], itemsDel: ['t1'] });
  });

  it('trie par ordre d’empilement', () => {
    const { session } = setup();
    const top = makeStroke('p1', [[0, 0]], { order: 20 });
    const bottom = makeStroke('p1', [[0, 0]], { order: 10 });
    session.apply([add(top), add(bottom)], 'x');
    expect(session.getStrokes('p1').map((s) => s.order)).toEqual([10, 20]);
  });

  it('lecture seule : aucune modification ni persistance, boutons désactivés', () => {
    const { session, saves } = setup();
    const a = makeStroke('p1', [[0, 0]]);
    session.apply([add(a)], 'Trait');
    const listener = vi.fn();
    session.onHistory(listener);
    session.readOnly = true;
    expect(listener).toHaveBeenCalled();
    expect(session.canUndo).toBe(false);
    session.apply([add(makeStroke('p1', [[1, 1]]))], 'Trait');
    expect(session.strokeCount()).toBe(1);
    expect(saves).toHaveLength(1);
  });

  it('supprimer une page purge l’historique qui la concerne', () => {
    const { session } = setup();
    session.apply([add(makeStroke('p1', [[0, 0]]))], 'Trait');
    session.apply([add(makeStroke('p2', [[0, 0]]))], 'Trait');
    session.removePage('p2');
    expect(session.historySize.undo).toBe(1);
    expect(session.peekUndo()?.pageId).toBe('p1');
  });

  it('charge les pages à la demande, une seule fois', async () => {
    const loader = vi.fn(async (pid: string) => ({ strokes: [makeStroke(pid, [[1, 1]])], items: [] }));
    const page = (id: string): Page => ({ id, notebookId: 'nb', width: 794, height: 1123, paper: DEFAULT_PAPER, createdAt: 0, updatedAt: 0, v: 2 });
    const session = new NotebookSession(testNotebook(['a', 'b']), [page('a'), page('b')], { save: () => {} }, loader);
    expect(session.isLoaded('a')).toBe(false);
    await Promise.all([session.ensurePage('a'), session.ensurePage('a')]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(session.getStrokes('a')).toHaveLength(1);
    expect(session.isLoaded('b')).toBe(false);
  });
});
