import { describe, expect, it } from 'vitest';
import { NotebookSession, type Change, type PersistDelta } from '../../src/model/session';
import { DEFAULT_TEXT_STYLE } from '../../src/ink/settings';
import { DEFAULT_PAPER, type Notebook, type Page, type Stroke, type TextItem } from '../../src/model/types';
import { makeStroke } from './helpers';

function testNotebook(pageIds: string[]): Notebook {
  return {
    id: 'nb', title: 't', cover: 'nuit', coverPattern: 'plain', paper: DEFAULT_PAPER, format: 'A4', orientation: 'portrait',
    kind: 'notebook', folderId: null, pageIds, favorite: false, createdAt: 0, updatedAt: 0, openedAt: 0, trashedAt: null, v: 2,
  };
}

/**
 * Historique : séquences aléatoires reproductibles (traits, gomme groupée, déplacements, texte,
 * suppressions, annulations, rétablissements). Vérifie à chaque étape que :
 *  - annuler revient EXACTEMENT à l'état précédent, rétablir à l'état suivant ;
 *  - ce qui est persisté (base simulée) est toujours identique à ce qui est affiché.
 */

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function setup() {
  const page = (id: string): Page => ({ id, notebookId: 'nb', width: 794, height: 1123, paper: DEFAULT_PAPER, createdAt: 0, updatedAt: 0, v: 2 });
  const db = { strokes: new Map<string, Stroke>(), items: new Map<string, TextItem>() };
  const session = new NotebookSession(
    testNotebook(['p1', 'p2']),
    [page('p1'), page('p2')],
    {
      save: (_n, d: PersistDelta) => {
        for (const s of d.strokesPut) db.strokes.set(s.id, s);
        for (const id of d.strokesDel) db.strokes.delete(id);
        for (const it of d.itemsPut) db.items.set(it.id, it as TextItem);
        for (const id of d.itemsDel) db.items.delete(id);
      },
    },
    undefined,
    { strokes: [] },
  );
  return { session, db };
}

function state(session: NotebookSession): string {
  const out: string[] = [];
  for (const p of ['p1', 'p2']) {
    for (const s of session.getStrokes(p)) out.push(`${p}|s|${s.id}|${s.color}|${Array.from(s.points.slice(0, 4)).join(',')}|${s.points.length}`);
    for (const it of session.getItems(p)) out.push(`${p}|i|${it.id}|${it.x},${it.y}|${(it as TextItem).text ?? ''}`);
  }
  return out.sort().join('\n');
}

function dbState(db: ReturnType<typeof setup>['db']): string {
  const out: string[] = [];
  for (const s of db.strokes.values()) out.push(`${s.pageId}|s|${s.id}|${s.color}|${Array.from(s.points.slice(0, 4)).join(',')}|${s.points.length}`);
  for (const it of db.items.values()) out.push(`${it.pageId}|i|${it.id}|${it.x},${it.y}|${it.text ?? ''}`);
  return out.sort().join('\n');
}

function runFuzz(seed: number, steps: number) {
  const r = rng(seed);
  const { session, db } = setup();
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  // states[i] = état après i étapes de l'historique courant.
  const states = [state(session)];
  let depth = 0;
  const committed = () => {
    states.length = depth + 1;
    states.push(state(session));
    depth++;
  };
  for (let step = 0; step < steps; step++) {
    const page = r() < 0.7 ? 'p1' : 'p2';
    const strokes = session.getStrokes(page);
    const items = session.getItems(page) as TextItem[];
    const op = r();
    if (op < 0.25) {
      const x = r() * 600;
      const y = r() * 900;
      const s = makeStroke(page, [[x, y], [x + 20, y + 5], [x + 40, y + 2]]);
      session.apply([{ kind: 'stroke', id: s.id, pageId: page, after: s }], 'Trait');
      committed();
    } else if (op < 0.4 && strokes.length) {
      // Gomme : plusieurs passages groupés ; certains morceaux créés pendant le geste sont regommés.
      session.beginBatch('Gomme', page);
      let changed = false;
      for (let k = 0; k < 3; k++) {
        const cur = session.getStrokes(page);
        if (!cur.length) break;
        const target = pick(cur);
        const piece = makeStroke(page, [[target.points[0] + 1, target.points[1]], [target.points[0] + 5, target.points[1] + 1]]);
        const ch: Change[] = [{ kind: 'stroke', id: target.id, pageId: page, before: target }];
        if (r() < 0.6) ch.push({ kind: 'stroke', id: piece.id, pageId: page, after: piece });
        session.apply(ch, 'Gomme');
        changed = true;
      }
      session.endBatch();
      if (changed && session.historySize.undo > 0 && state(session) !== states[depth]) committed();
    } else if (op < 0.52 && strokes.length) {
      // Déplacement d'une sélection (plusieurs traits + éventuellement un texte) = une étape.
      const sel = strokes.filter(() => r() < 0.5).slice(0, 4);
      if (!sel.length) continue;
      const dx = Math.round(r() * 40 - 20);
      const ch: Change[] = sel.map((s) => {
        const pts = s.points.slice();
        for (let i = 0; i < pts.length; i += 5) pts[i] += dx;
        return { kind: 'stroke', id: s.id, pageId: page, before: s, after: { ...s, points: pts } };
      });
      if (items.length) {
        const it = items[0];
        ch.push({ kind: 'item', id: it.id, pageId: page, before: it, after: { ...it, x: it.x + dx } });
      }
      session.apply(ch, 'Déplacer');
      committed();
    } else if (op < 0.6) {
      const it: TextItem = {
        kind: 'text', id: `t${step}`, pageId: page, x: r() * 500, y: r() * 800, w: 200, h: 30, text: `note ${step}`, ...DEFAULT_TEXT_STYLE, order: step, createdAt: 0, v: 2,
      };
      session.apply([{ kind: 'item', id: it.id, pageId: page, after: it }], 'Ajouter du texte');
      committed();
    } else if (op < 0.66 && (strokes.length || items.length)) {
      const ch: Change[] = [
        ...strokes.filter(() => r() < 0.3).map((s): Change => ({ kind: 'stroke', id: s.id, pageId: page, before: s })),
        ...items.filter(() => r() < 0.3).map((it): Change => ({ kind: 'item', id: it.id, pageId: page, before: it })),
      ];
      if (!ch.length) continue;
      session.apply(ch, 'Supprimer la sélection');
      committed();
    } else if (op < 0.85) {
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n && session.canUndo; k++) {
        session.undo();
        depth--;
        expect(state(session)).toBe(states[depth]);
      }
    } else {
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n && session.canRedo; k++) {
        session.redo();
        depth++;
        expect(state(session)).toBe(states[depth]);
      }
    }
    expect(dbState(db)).toBe(state(session));
    expect(session.canUndo).toBe(depth > 0);
    expect(session.canRedo).toBe(depth < states.length - 1);
  }
  // Tout annuler → état initial ; tout rétablir → état final.
  const finalDepth = depth;
  while (session.canUndo) {
    session.undo();
    depth--;
  }
  expect(depth).toBe(0);
  expect(state(session)).toBe(states[0]);
  expect(dbState(db)).toBe(states[0]);
  while (session.canRedo) {
    session.redo();
    depth++;
  }
  expect(state(session)).toBe(states[states.length - 1]);
  expect(depth).toBeGreaterThanOrEqual(finalDepth);
  expect(dbState(db)).toBe(state(session));
}

describe('Historique — séquences aléatoires', () => {
  for (const seed of [1, 2, 3, 42, 1234, 9001]) {
    it(`graine ${seed} : 300 actions, annuler/rétablir exacts, persistance cohérente`, () => runFuzz(seed, 300));
  }
});
