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
    expect(report).toMatchObject({ notebooks: 1, pages: 2, strokes: 1, items: 0, copies: 0 });
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

  it('favoris et plan : conservés, et rattachés aux nouvelles pages lors d’une restauration en copie', async () => {
    const { repo, db } = freshDB();
    const nb = await repo.createNotebook({ title: 'Cours', cover: 'nuit' });
    await repo.insertPage(nb.id, 1, nb.paper);
    const ids = (await repo.getNotebook(nb.id))!.pageIds;
    await repo.updateNotebook(nb.id, (n) => {
      n.bookmarks = [ids[1]];
      n.outline = [{ pageId: ids[1], title: 'Chapitre 2' }];
    });
    const file = await exportBackup(undefined, db);
    expect(file.notebooks[0].bookmarks).toEqual([ids[1]]);
    await restoreBackup(file, db);
    const copy = (await repo.listNotebooks()).find((n) => n.id !== nb.id)!;
    expect(copy.pageIds).toHaveLength(2);
    expect(copy.pageIds).not.toContain(ids[1]);
    expect(copy.bookmarks).toEqual([copy.pageIds[1]]);
    expect(copy.outline).toEqual([{ pageId: copy.pageIds[1], title: 'Chapitre 2' }]);
    // Supprimer la page retire aussi son favori et son entrée de plan.
    await repo.deletePage(copy.id, copy.pageIds[1]);
    const after = (await repo.getNotebook(copy.id))!;
    expect(after.bookmarks).toEqual([]);
    expect(after.outline).toEqual([]);
  });

  it('relit un fichier de sauvegarde version 1 (avant les objets et dossiers)', async () => {
    const v1 = {
      format: 'calame-backup', version: 1, schema: 1, app: 'Calame', exportedAt: '2026-11-11T08:00:00.000Z',
      notebooks: [{ id: 'old', title: 'Ancien', cover: 'nuit', paper: { kind: 'lined', color: 'white', spacing: 32 }, pageIds: ['pg'], favorite: false, createdAt: 1, updatedAt: 2, openedAt: 2, trashedAt: null, v: 1 }],
      pages: [{ id: 'pg', notebookId: 'old', width: 794, height: 1123, paper: { kind: 'lined', color: 'white', spacing: 32 }, createdAt: 1, updatedAt: 1, v: 1 }],
      strokes: [],
    };
    const { repo, db } = freshDB();
    const r = await restoreBackup(parseBackup(JSON.stringify(v1)), db);
    expect(r.notebooks).toBe(1);
    expect(await repo.getNotebook('old')).toMatchObject({ format: 'A4', folderId: null, kind: 'notebook', v: 2 });
  });

  it('exporte et restaure images, textes et dossiers', async () => {
    const src = freshDB();
    const f = await src.repo.createFolder('Java');
    const nb = await src.repo.createNotebook({ title: 'Images', cover: 'nuit', folderId: f.id });
    await src.repo.putBlob({ id: 'blob1', mime: 'image/png', data: new Uint8Array([9, 8, 7]).buffer, createdAt: 0 });
    await src.repo.saveChanges(nb.id, {
      strokesPut: [], strokesDel: [], itemsDel: [],
      itemsPut: [
        { kind: 'image', id: 'i1', pageId: nb.pageIds[0], x: 1, y: 2, w: 30, h: 40, blobId: 'blob1', mime: 'image/png', order: 1, createdAt: 0, v: 2 },
        { kind: 'text', id: 't1', pageId: nb.pageIds[0], x: 5, y: 5, w: 100, h: 20, text: 'class A {}', font: 'mono', size: 14, color: '#000000', bold: true, italic: false, underline: false, align: 'left', order: 2, createdAt: 0, v: 2 },
      ],
    });
    const file = parseBackup(JSON.stringify(await exportBackup(undefined, src.db)));
    const dst = freshDB();
    const r = await restoreBackup(file, dst.db);
    expect(r.items).toBe(2);
    const c = (await dst.repo.loadNotebookContent(nb.id))!;
    expect(c.notebook.folderId).toBe(f.id);
    expect(c.items.find((i) => i.kind === 'text')).toMatchObject({ text: 'class A {}', font: 'mono', bold: true });
    expect(Array.from(new Uint8Array((await dst.repo.getBlob('blob1'))!.data))).toEqual([9, 8, 7]);
  });

  it('rejette un fichier invalide ou d’une version future avec un message clair', () => {
    expect(() => parseBackup('pas du json')).toThrow(/illisible/);
    expect(() => parseBackup('{"format":"autre"}')).toThrow(/pas une sauvegarde/);
    expect(() =>
      parseBackup(JSON.stringify({ format: 'calame-backup', version: 99, notebooks: [], pages: [], strokes: [] })),
    ).toThrow(/plus récente/);
  });
});
