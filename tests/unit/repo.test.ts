import { describe, expect, it } from 'vitest';
import { freshDB, makeStroke } from './helpers';
import { openNotebook } from '../../src/storage/openNotebook';

describe('Repo — persistance locale', () => {
  it('crée un carnet avec une première page, puis le relit', async () => {
    const { repo } = freshDB();
    const nb = await repo.createNotebook({ title: '  Cours Java ', cover: 'sauge' });
    expect(nb.title).toBe('Cours Java');
    const c = (await repo.loadNotebookContent(nb.id))!;
    expect(c.pages).toHaveLength(1);
    expect(c.notebook.pageIds).toEqual([c.pages[0].id]);
  });

  it('persiste les traits (Float32Array) et toutes leurs propriétés', async () => {
    const { repo } = freshDB();
    const nb = await repo.createNotebook({ title: 'x', cover: 'nuit' });
    const pid = nb.pageIds[0];
    const s = makeStroke(pid, [[1.25, 2.5], [3.75, 4]], { color: '#2f5aa8', width: 3.6, tool: 'highlighter' });
    await repo.saveStrokes(nb.id, [s], []);
    const [back] = await repo.loadPageStrokes(pid);
    expect(back.points).toBeInstanceOf(Float32Array);
    expect(Array.from(back.points)).toEqual(Array.from(s.points));
    expect(back).toMatchObject({ color: '#2f5aa8', width: 3.6, tool: 'highlighter', style: s.style, order: s.order });
    await repo.saveStrokes(nb.id, [], [s.id]);
    expect(await repo.loadPageStrokes(pid)).toHaveLength(0);
  });

  it('insère, duplique, déplace et supprime des pages de façon atomique', async () => {
    const { repo } = freshDB();
    const nb = await repo.createNotebook({ title: 'x', cover: 'nuit' });
    const p0 = nb.pageIds[0];
    await repo.saveStrokes(nb.id, [makeStroke(p0, [[1, 1], [2, 2]])], []);
    const p1 = await repo.insertPage(nb.id, 1, nb.paper);
    const dup = await repo.duplicatePage(nb.id, p0);
    let c = (await repo.loadNotebookContent(nb.id))!;
    expect(c.notebook.pageIds).toEqual([p0, dup.page.id, p1.id]);
    expect(c.strokes.filter((s) => s.pageId === dup.page.id)).toHaveLength(1);
    await repo.movePage(nb.id, p1.id, 0);
    await repo.deletePage(nb.id, dup.page.id);
    c = (await repo.loadNotebookContent(nb.id))!;
    expect(c.notebook.pageIds).toEqual([p1.id, p0]);
    expect(c.strokes.filter((s) => s.pageId === dup.page.id)).toHaveLength(0);
  });

  it('formats de page, orientation, dossiers et objets', async () => {
    const { repo } = freshDB();
    const folder = await repo.createFolder('Cours');
    const nb = await repo.createNotebook({ title: 'Paysage', cover: 'sauge', format: 'A5', orientation: 'landscape', folderId: folder.id });
    const c = (await repo.loadNotebookContent(nb.id))!;
    expect(c.pages[0]).toMatchObject({ width: 794, height: 559 });
    expect(c.notebook).toMatchObject({ format: 'A5', orientation: 'landscape', folderId: folder.id, coverPattern: 'plain' });
    const p2 = await repo.insertPage(nb.id, 1, nb.paper);
    expect(p2).toMatchObject({ width: 794, height: 559 });
    await repo.saveChanges(nb.id, {
      strokesPut: [], strokesDel: [], itemsDel: [],
      itemsPut: [{ kind: 'image', id: 'img', pageId: nb.pageIds[0], x: 0, y: 0, w: 10, h: 10, blobId: 'b1', mime: 'image/png', order: 1, createdAt: 0, v: 2 }],
    });
    await repo.putBlob({ id: 'b1', mime: 'image/png', data: new Uint8Array([1, 2, 3]).buffer, createdAt: 0 });
    const dup = await repo.duplicatePage(nb.id, nb.pageIds[0]);
    expect(dup.items).toHaveLength(1);
    await repo.deleteFolder(folder.id);
    expect((await repo.getNotebook(nb.id))!.folderId).toBeNull();
    await repo.deleteNotebookForever(nb.id);
    expect(await repo.getBlob('b1')).toBeUndefined();
  });

  it('refuse de supprimer la dernière page', async () => {
    const { repo } = freshDB();
    const nb = await repo.createNotebook({ title: 'x', cover: 'nuit' });
    await expect(repo.deletePage(nb.id, nb.pageIds[0])).rejects.toThrow();
  });

  it('suppression définitive : plus aucun enregistrement orphelin', async () => {
    const { repo, db } = freshDB();
    const nb = await repo.createNotebook({ title: 'x', cover: 'nuit' });
    await repo.saveStrokes(nb.id, [makeStroke(nb.pageIds[0], [[1, 1]])], []);
    await repo.deleteNotebookForever(nb.id);
    const d = await db();
    expect(await d.count('pages')).toBe(0);
    expect(await d.count('strokes')).toBe(0);
  });

  it('réouverture : les traits écrits via la session sont relus après « rechargement »', async () => {
    const { repo } = freshDB();
    const nb = await repo.createNotebook({ title: 'x', cover: 'nuit' });
    const opened = (await openNotebook(nb.id, repo))!;
    await opened.session.ensurePage(nb.pageIds[0]);
    const s = makeStroke(nb.pageIds[0], [[10, 10], [20, 20]]);
    opened.session.apply([{ kind: 'stroke', id: s.id, pageId: s.pageId, after: s }], 'Trait');
    await opened.close(); // vide la file d'écriture
    const again = (await openNotebook(nb.id, repo))!;
    expect(again.session.isLoaded(nb.pageIds[0])).toBe(false); // chargement paresseux
    await again.session.ensurePage(nb.pageIds[0]);
    expect(again.session.getStrokes(nb.pageIds[0]).map((x) => x.id)).toEqual([s.id]);
    await again.close();
  });
});
