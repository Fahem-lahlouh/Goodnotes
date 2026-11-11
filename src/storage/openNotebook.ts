import { NotebookSession } from '../model/session';
import type { Notebook } from '../model/types';
import { repo as defaultRepo, type Repo } from './repo';
import { SaveQueue } from './saveQueue';

/**
 * Ouverture d'un carnet : chargement, file d'écriture, coordination entre onglets.
 *
 * Plusieurs onglets :
 *  - Un verrou Web Locks exclusif `calame:nb:<id>` désigne l'onglet qui écrit.
 *    Les autres ouvrent le carnet en lecture seule et peuvent « prendre la main »
 *    (l'onglet précédent passe alors en lecture seule, après avoir vidé sa file).
 *  - Chaque écriture est diffusée (BroadcastChannel) : les onglets en lecture seule
 *    rechargent les pages concernées depuis IndexedDB.
 *  - Sans Web Locks (navigateur ancien), les deux onglets écrivent ; chaque trait
 *    étant un enregistrement indépendant, aucune écriture n'en écrase une autre,
 *    et la diffusion maintient l'affichage à jour.
 */

export const saveQueue = new SaveQueue();

const TAB_ID = Math.random().toString(36).slice(2);
const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('calame') : null;

type Msg =
  | { type: 'strokes'; tab: string; notebookId: string; pageIds: string[] }
  | { type: 'structure'; tab: string; notebookId: string }
  | { type: 'library'; tab: string };

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export function broadcast(msg: DistributiveOmit<Msg, 'tab'>): void {
  channel?.postMessage({ ...msg, tab: TAB_ID } as Msg);
}

export function onBroadcast(fn: (m: Msg) => void): () => void {
  if (!channel) return () => {};
  const h = (e: MessageEvent<Msg>) => {
    if (e.data?.tab !== TAB_ID) fn(e.data);
  };
  channel.addEventListener('message', h);
  return () => channel.removeEventListener('message', h);
}

export type LockState = 'owner' | 'readonly' | 'unsupported';

export interface OpenedNotebook {
  session: NotebookSession;
  lock: LockState;
  /** Demande l'accès en écriture en le retirant à l'autre onglet. */
  takeOver(): Promise<void>;
  close(): Promise<void>;
  onLockChange(fn: (s: LockState) => void): () => void;
  onStructureChange(fn: () => void): () => void;
}

export async function openNotebook(id: string, r: Repo = defaultRepo): Promise<OpenedNotebook | null> {
  const meta = await r.loadNotebookMeta(id);
  if (!meta) return null;
  const session = new NotebookSession(
    meta.notebook,
    meta.pages,
    {
      save(notebookId, d) {
        saveQueue.enqueue(async () => {
          await r.saveChanges(notebookId, d);
          broadcast({ type: 'strokes', notebookId, pageIds: d.pageIds });
        });
      },
    },
    (pageId) => r.loadPageContent(pageId),
  );

  // Marque le carnet comme récemment ouvert (sans bloquer l'ouverture).
  saveQueue.enqueue(async () => {
    const n = await r.updateNotebook(id, (nb) => {
      nb.openedAt = Date.now();
    });
    session.setNotebook({ ...session.notebook, openedAt: n.openedAt });
  });

  const lockListeners = new Set<(s: LockState) => void>();
  const structureListeners = new Set<() => void>();
  let lock: LockState = 'unsupported';
  let release: (() => void) | null = null;
  let closed = false;
  // eslint-disable-next-line prefer-const
  let opened: OpenedNotebook | undefined;

  const setLock = (s: LockState) => {
    lock = s;
    if (opened) opened.lock = s;
    session.readOnly = s === 'readonly';
    for (const l of lockListeners) l(s);
  };

  /** Relit l'ordre et la liste des pages (modifiés par un autre onglet). */
  const refreshStructure = async () => {
    const fresh = await r.loadNotebookMeta(id);
    if (!fresh) return;
    const ids = new Set(fresh.pages.map((p) => p.id));
    for (const pid of Array.from(session.pages.keys())) if (!ids.has(pid)) session.removePage(pid);
    for (const p of fresh.pages) if (!session.pages.has(p.id)) session.pages.set(p.id, p);
    session.setNotebook(fresh.notebook);
    for (const l of structureListeners) l();
  };

  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  const lockName = `calame:nb:${id}`;

  const acquire = (steal: boolean): Promise<boolean> =>
    new Promise((resolve) => {
      if (!locks) return resolve(false);
      const opts: LockOptions = steal ? { mode: 'exclusive', steal: true } : { mode: 'exclusive', ifAvailable: true };
      locks
        .request(lockName, opts, (l) => {
          if (!l) {
            resolve(false);
            return undefined;
          }
          resolve(true);
          return new Promise<void>((rel) => {
            release = rel;
          });
        })
        .catch(async () => {
          // Verrou retiré par un autre onglet (« prendre la main »).
          release = null;
          await saveQueue.flush();
          if (!closed) setLock('readonly');
        });
    });

  if (locks) {
    setLock((await acquire(false)) ? 'owner' : 'readonly');
  }

  const unsub = onBroadcast(async (m) => {
    if (closed) return;
    if (m.type === 'strokes' && m.notebookId === id) {
      for (const pid of m.pageIds) {
        if (session.isLoaded(pid)) session.reloadPage(pid, await r.loadPageContent(pid));
      }
    } else if (m.type === 'structure' && m.notebookId === id) {
      await refreshStructure();
    }
  });

  opened = {
    session,
    lock,
    async takeOver() {
      if (!locks) return;
      const ok = await acquire(true);
      if (ok) {
        // Recharge l'état le plus récent avant d'écrire.
        await refreshStructure();
        for (const pid of Array.from(session.pages.keys())) {
          if (session.isLoaded(pid)) session.reloadPage(pid, await r.loadPageContent(pid));
        }
        setLock('owner');
        for (const l of structureListeners) l();
      }
    },
    async close() {
      closed = true;
      unsub();
      await saveQueue.flush();
      release?.();
    },
    onLockChange(fn) {
      lockListeners.add(fn);
      return () => lockListeners.delete(fn);
    },
    onStructureChange(fn) {
      structureListeners.add(fn);
      return () => structureListeners.delete(fn);
    },
  };
  return opened;
}

export type { Notebook };
