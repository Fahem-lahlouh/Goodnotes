import { describe, expect, it, vi } from 'vitest';
import { NotebookSession } from '../../src/model/session';
import type { Notebook, Page } from '../../src/model/types';
import { DEFAULT_PAPER } from '../../src/model/types';
import { makeStroke } from './helpers';

function setup() {
  const nb: Notebook = {
    id: 'nb', title: 't', cover: 'nuit', paper: DEFAULT_PAPER, pageIds: ['p1', 'p2'], favorite: false,
    createdAt: 0, updatedAt: 0, openedAt: 0, trashedAt: null, v: 1,
  };
  const page = (id: string): Page => ({ id, notebookId: 'nb', width: 794, height: 1123, paper: DEFAULT_PAPER, createdAt: 0, updatedAt: 0, v: 1 });
  const saves: { put: string[]; del: string[] }[] = [];
  const session = new NotebookSession(nb, [page('p1'), page('p2')], [], {
    saveStrokes: (_n, put, del) => saves.push({ put: put.map((s) => s.id), del }),
  });
  return { session, saves };
}

describe('NotebookSession — annuler / rétablir', () => {
  it('ajoute, annule et rétablit un trait en persistant chaque étape', () => {
    const { session, saves } = setup();
    const s = makeStroke('p1', [[0, 0], [10, 10]]);
    session.apply([{ id: s.id, pageId: 'p1', after: s }], 'Trait');
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

  it('conserve les propriétés du trait (couleur, épaisseur, style, points)', () => {
    const { session } = setup();
    const s = makeStroke('p1', [[1, 2], [3, 4]], { color: '#c0392b', width: 5.5 });
    session.apply([{ id: s.id, pageId: 'p1', after: s }], 'Trait');
    const back = session.getStroke('p1', s.id)!;
    expect(back.color).toBe('#c0392b');
    expect(back.width).toBe(5.5);
    expect(Array.from(back.points)).toEqual(Array.from(s.points));
  });

  it('un geste de gomme groupé = une seule étape, et persistance nette', () => {
    const { session, saves } = setup();
    const a = makeStroke('p1', [[0, 0], [10, 0]]);
    session.apply([{ id: a.id, pageId: 'p1', after: a }], 'Trait');
    saves.length = 0;
    session.beginBatch('Gomme');
    const piece = makeStroke('p1', [[0, 0], [3, 0]]);
    session.apply([{ id: a.id, pageId: 'p1', before: a }, { id: piece.id, pageId: 'p1', after: piece }], 'Gomme');
    // le morceau est lui-même effacé dans le même geste
    session.apply([{ id: piece.id, pageId: 'p1', before: piece }], 'Gomme');
    session.endBatch();
    expect(saves).toEqual([{ put: [], del: [a.id] }]);
    expect(session.getStrokes('p1')).toEqual([]);
    session.undo();
    expect(session.getStrokes('p1').map((s) => s.id)).toEqual([a.id]);
  });

  it('une nouvelle action vide la pile de rétablissement', () => {
    const { session } = setup();
    const a = makeStroke('p1', [[0, 0]]);
    const b = makeStroke('p1', [[5, 5]]);
    session.apply([{ id: a.id, pageId: 'p1', after: a }], 'Trait');
    session.undo();
    session.apply([{ id: b.id, pageId: 'p1', after: b }], 'Trait');
    expect(session.canRedo).toBe(false);
  });

  it('trie les traits par ordre d’empilement', () => {
    const { session } = setup();
    const top = makeStroke('p1', [[0, 0]], { order: 20 });
    const bottom = makeStroke('p1', [[0, 0]], { order: 10 });
    session.apply([{ id: top.id, pageId: 'p1', after: top }, { id: bottom.id, pageId: 'p1', after: bottom }], 'x');
    expect(session.getStrokes('p1').map((s) => s.order)).toEqual([10, 20]);
  });

  it('lecture seule : aucune modification ni persistance', () => {
    const { session, saves } = setup();
    session.readOnly = true;
    const a = makeStroke('p1', [[0, 0]]);
    session.apply([{ id: a.id, pageId: 'p1', after: a }], 'Trait');
    expect(session.strokeCount()).toBe(0);
    expect(saves).toHaveLength(0);
  });

  it('supprimer une page purge l’historique qui la concerne', () => {
    const { session } = setup();
    const a = makeStroke('p2', [[0, 0]]);
    session.apply([{ id: a.id, pageId: 'p2', after: a }], 'Trait');
    const listener = vi.fn();
    session.onHistory(listener);
    session.removePage('p2');
    expect(session.canUndo).toBe(false);
    expect(listener).toHaveBeenCalled();
  });
});
