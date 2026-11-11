/**
 * File d'écriture sérialisée vers le stockage local.
 *
 * - Les écritures s'exécutent dans l'ordre d'arrivée (un ajout puis une suppression
 *   du même trait ne peuvent pas s'inverser).
 * - En cas d'échec, la tâche est retentée avec un délai croissant ; les tâches
 *   suivantes attendent. Rien n'est abandonné silencieusement : l'état « error »
 *   est exposé à l'interface tant que l'écriture n'a pas réussi.
 */
export type SaveStatus = 'idle' | 'saving' | 'error';

export interface SaveState {
  status: SaveStatus;
  pending: number;
  lastSavedAt: number | null;
  error: string | null;
}

type Task = () => Promise<void>;

export function describeStorageError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'QuotaExceededError') {
    return "Espace de stockage plein : exportez une sauvegarde et libérez de l'espace.";
  }
  if (name === 'InvalidStateError' || name === 'UnknownError') {
    return "Le stockage du navigateur est indisponible (navigation privée ou stockage bloqué ?).";
  }
  return `Échec d'enregistrement : ${(e as Error)?.message ?? String(e)}`;
}

export class SaveQueue {
  private tasks: Task[] = [];
  private running = false;
  private listeners = new Set<(s: SaveState) => void>();
  private waiters: (() => void)[] = [];
  state: SaveState = { status: 'idle', pending: 0, lastSavedAt: null, error: null };

  constructor(
    private readonly retryDelays: number[] = [200, 800, 2000, 5000],
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  subscribe(fn: (s: SaveState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SaveState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  enqueue(task: Task): void {
    this.tasks.push(task);
    this.set({ pending: this.tasks.length, status: this.state.status === 'error' ? 'error' : 'saving' });
    void this.run();
  }

  /** Résout quand toutes les écritures en attente ont réussi. */
  flush(): Promise<void> {
    if (!this.running && this.tasks.length === 0) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.tasks.length > 0) {
      const task = this.tasks[0];
      let attempt = 0;
      for (;;) {
        try {
          await task();
          break;
        } catch (e) {
          const delay = this.retryDelays[Math.min(attempt, this.retryDelays.length - 1)];
          attempt++;
          this.set({ status: 'error', error: describeStorageError(e) });
          console.error('[calame] écriture échouée, nouvel essai dans', delay, 'ms', e);
          await this.sleep(delay);
        }
      }
      this.tasks.shift();
      this.set({
        pending: this.tasks.length,
        status: this.tasks.length ? 'saving' : 'idle',
        error: null,
        lastSavedAt: Date.now(),
      });
    }
    this.running = false;
    const w = this.waiters;
    this.waiters = [];
    for (const r of w) r();
  }
}
