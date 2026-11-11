import { describe, expect, it } from 'vitest';
import { SaveQueue } from '../../src/storage/saveQueue';

describe('SaveQueue — écriture interrompue', () => {
  it('exécute dans l’ordre et signale l’état', async () => {
    const q = new SaveQueue([1], () => Promise.resolve());
    const order: number[] = [];
    q.enqueue(async () => void order.push(1));
    q.enqueue(async () => void order.push(2));
    await q.flush();
    expect(order).toEqual([1, 2]);
    expect(q.state.status).toBe('idle');
    expect(q.state.lastSavedAt).not.toBeNull();
  });

  it('un échec (quota) est signalé puis retenté sans perdre ni réordonner les écritures', async () => {
    const q = new SaveQueue([1], () => Promise.resolve());
    const states: string[] = [];
    q.subscribe((s) => states.push(s.status + (s.error ? ':err' : '')));
    let failures = 2;
    const done: string[] = [];
    q.enqueue(async () => {
      if (failures-- > 0) {
        const e = new Error('plein');
        e.name = 'QuotaExceededError';
        throw e;
      }
      done.push('a');
    });
    q.enqueue(async () => void done.push('b'));
    await q.flush();
    expect(done).toEqual(['a', 'b']);
    expect(states).toContain('error:err');
    expect(q.state.status).toBe('idle');
    expect(q.state.error).toBeNull();
  });
});
