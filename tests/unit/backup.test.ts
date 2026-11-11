import { describe, expect, it } from 'vitest';
import { freshDB, makeStroke } from './helpers';
import {
  base64ToFloat32,
  exportBackup,
  float32ToBase64,
  parseBackup,
  restoreBackup,
} from '../../src/storage/backup';

describe('Sauvegarde et restauration', () => {
  it('encode les points en base64 sans perte', () => {
    const a = Float32Array.from([0, 1.5, -3.25, 1e6, 0.1]);
    expect(Array.from(base64ToFloat32(float32ToBase64(a)))).toEqual(Array.from(a));
  });

  it('exporte puis restaure dans une base vide à l’identique', async () => {
    const src = freshDB();
    const nb = await src.repo.createNotebook({ title: 'Réunion', cover: 'terre' });
    await src.repo.insertPage(nb.id, 1, nb.paper);
    const s = makeStroke(nb.pageIds[0], [[1, 2], [3, 4], [5, 6]], { color: '#2e7d4f' });
    await src.repo.saveStrokes(nb.id, [s], []);
    const file = parseBackup(JSON.stringify(await exportBackup(undefined, src.db)));

    const dst = freshDB();
    const report = await restoreBackup(file, dst.db);
    expect(report).toMatchObject({ notebooks: 1, pages: 2, strokes: 1, copies: 0 });
    const c = (await dst.repo.loadNotebookContent(nb.id))!;
    expect(c.notebook.title).toBe('Réunion');
    expect(c.notebook.pageIds).toHaveLength(2);
    expect(Array.from(c.strokes[0].points)).toEqual(Array.from(s.points));
    expect(c.strokes[0].color).toBe('#2e7d4f');
  });

  it('ne remplace jamais un carnet existant : importe une copie', async () => {
    const { repo, db } = freshDB();
    const nb = await repo.createNotebook({ title: 'Java', cover: 'nuit' });
    await repo.saveStrokes(nb.id, [makeStroke(nb.pageIds[0], [[1, 1]])], []);
    const file = await exportBackup(undefined, db);
    // modification locale postérieure à la sauvegarde
    await repo.saveStrokes(nb.id, [makeStroke(nb.pageIds[0], [[2, 2]])], []);
    const report = await restoreBackup(file, db);
    expect(report.copies).toBe(1);
    const all = await repo.listNotebooks();
    expect(all.map((n) => n.title).sort()).toEqual(['Java', 'Java (restauré)']);
    const original = (await repo.loadNotebookContent(nb.id))!;
    expect(original.strokes).toHaveLength(2); // intact
    const copy = all.find((n) => n.id !== nb.id)!;
    const cc = (await repo.loadNotebookContent(copy.id))!;
    expect(cc.strokes).toHaveLength(1);
    expect(cc.pages[0].notebookId).toBe(copy.id);
  });

  it('rejette un fichier invalide ou d’une version future avec un message clair', () => {
    expect(() => parseBackup('pas du json')).toThrow(/illisible/);
    expect(() => parseBackup('{"format":"autre"}')).toThrow(/pas une sauvegarde/);
    expect(() =>
      parseBackup(JSON.stringify({ format: 'calame-backup', version: 99, notebooks: [], pages: [], strokes: [] })),
    ).toThrow(/plus récente/);
  });
});
