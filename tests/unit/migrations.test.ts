import { describe, expect, it } from 'vitest';
import { migrateNotebook, migrateStroke, NewerSchemaError } from '../../src/storage/migrations';
import { SCHEMA_VERSION } from '../../src/model/types';

describe('Migrations de données', () => {
  it('migre un trait v0 (tableau, 4 valeurs par point, sans style)', () => {
    const s = migrateStroke({
      id: 's', pageId: 'p', tool: 'pen', color: '#000', width: 2, createdAt: 5,
      stride: 4, points: [1, 2, 0.4, 0, 3, 4, 0.6, 10],
    });
    expect(s.v).toBe(SCHEMA_VERSION);
    expect(s.points).toBeInstanceOf(Float32Array);
    expect(Array.from(s.points)).toEqual([1, 2, Math.fround(0.4), 0, 0, 3, 4, Math.fround(0.6), 10, 0]);
    expect(s.style.thinning).toBeGreaterThan(0);
    expect(s.order).toBe(5);
    expect(s.bbox[0]).toBeLessThan(1);
    expect('stride' in s).toBe(false);
  });

  it('complète un carnet v0', () => {
    const n = migrateNotebook({ id: 'n', title: 'x', pageIds: [], createdAt: 1, updatedAt: 2 });
    expect(n).toMatchObject({ favorite: false, trashedAt: null, openedAt: 2, cover: 'nuit', v: SCHEMA_VERSION });
  });

  it('laisse intact un enregistrement à jour', () => {
    const raw = { id: 'n', title: 'x', pageIds: ['a'], v: SCHEMA_VERSION, favorite: true };
    expect(migrateNotebook(raw)).toBe(raw);
  });

  it('refuse les données d’un schéma futur', () => {
    expect(() => migrateNotebook({ id: 'n', v: SCHEMA_VERSION + 1 })).toThrow(NewerSchemaError);
  });
});
