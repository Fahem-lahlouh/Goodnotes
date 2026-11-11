import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { listSnapshots, openCalameDB } from '../../src/storage/db';
import { parseBackup } from '../../src/storage/backup';

let n = 0;
describe('Mise à niveau de la base : copie de sécurité préalable', () => {
  it('copie une base v1 existante avant de la passer en v2, sans perdre de données', async () => {
    const name = `snap-${n++}`;
    const safety = `safety-${n++}`;
    // Base v1 telle que créée par la première version de Calame.
    const v1 = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('notebooks', { keyPath: 'id' });
        db.createObjectStore('pages', { keyPath: 'id' }).createIndex('notebookId', 'notebookId');
        db.createObjectStore('strokes', { keyPath: 'id' }).createIndex('pageId', 'pageId');
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
    await v1.put('notebooks', { id: 'nb', title: 'Mes notes', cover: 'nuit', paper: { kind: 'lined', color: 'white', spacing: 32 }, pageIds: ['pg'], favorite: false, createdAt: 1, updatedAt: 1, openedAt: 1, trashedAt: null, v: 1 });
    await v1.put('pages', { id: 'pg', notebookId: 'nb', width: 794, height: 1123, paper: { kind: 'lined', color: 'white', spacing: 32 }, createdAt: 1, updatedAt: 1, v: 1 });
    await v1.put('strokes', { id: 's1', pageId: 'pg', tool: 'pen', color: '#000000', width: 2, style: { thinning: 0.5, streamline: 0.3, tilt: 0, realPressure: true }, points: Float32Array.from([1, 2, 0.5, 0, 0]), bbox: [0, 0, 3, 3], order: 1, createdAt: 1, v: 1 });
    v1.close();

    const db = await openCalameDB(name, safety);
    expect(db.version).toBe(2);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(['blobs', 'folders', 'items', 'meta', 'notebooks', 'pages', 'strokes']);
    expect(await db.count('strokes')).toBe(1);
    const snaps = await listSnapshots(safety);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ fromVersion: 1, toVersion: 2, notebooks: 1 });
    const backup = parseBackup(snaps[0].data);
    expect(backup.strokes).toHaveLength(1);
    db.close();

    // Deuxième ouverture : déjà à jour, aucune nouvelle copie.
    (await openCalameDB(name, safety)).close();
    expect(await listSnapshots(safety)).toHaveLength(1);
  });

  it('nouvelle installation : base créée directement en v2, sans copie', async () => {
    const db = await openCalameDB(`fresh-${n++}`, `safety-fresh-${n}`);
    expect(db.version).toBe(2);
    expect(db.objectStoreNames.contains('items')).toBe(true);
    expect(await listSnapshots(`safety-fresh-${n}`)).toHaveLength(0);
    db.close();
  });
});
