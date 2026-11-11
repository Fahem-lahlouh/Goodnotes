import { useEffect, useState } from 'react';
import { backupFileName, deliverFile, exportBackup, recordBackupDate, serializeBackup } from '../storage/backup';
import { broadcast, onBroadcast, saveQueue } from '../storage/openNotebook';
import { repo } from '../storage/repo';
import { toast } from './Toast';

/**
 * État de la dernière sauvegarde exportée (copie hors du navigateur).
 * Sans base distante, c'est la seule protection contre l'effacement du stockage de l'appareil :
 * elle est donc affichée en permanence dans l'éditeur.
 */
let cache: number | null | undefined;
const listeners = new Set<(t: number | null) => void>();

function set(t: number | null): void {
  cache = t;
  for (const l of listeners) l(t);
}

async function refresh(): Promise<void> {
  try {
    set((await repo.getMeta<number>('lastBackupAt')) ?? null);
  } catch {
    set(null);
  }
}

onBroadcast((m) => {
  if (m.type === 'library') void refresh();
});

export function useLastBackup(): number | null | undefined {
  const [t, setT] = useState(cache);
  useEffect(() => {
    listeners.add(setT);
    if (cache === undefined) void refresh();
    return () => {
      listeners.delete(setT);
    };
  }, []);
  return t;
}

export const BACKUP_STALE_DAYS = 7;

export function backupAgeDays(t: number | null | undefined): number {
  return t ? (Date.now() - t) / 86_400_000 : Infinity;
}

export function backupLabel(t: number | null | undefined): string {
  if (t === undefined) return 'Sauvegarde…';
  if (t === null) return 'Jamais sauvegardé';
  const d = Math.floor(backupAgeDays(t));
  if (d < 1) {
    const h = Math.floor((Date.now() - t) / 3_600_000);
    return h < 1 ? 'Sauvegardé à l’instant' : `Sauvegardé il y a ${h} h`;
  }
  return `Sauvegardé il y a ${d} j`;
}

/**
 * Exporte une sauvegarde complète. Vide d'abord la file d'écriture pour que
 * les derniers traits soient inclus.
 */
export async function exportFullBackup(): Promise<boolean> {
  try {
    await saveQueue.flush();
    const b = await exportBackup();
    const r = await deliverFile(serializeBackup(b), backupFileName());
    if (r === 'cancelled') return false;
    await recordBackupDate();
    set(Date.now());
    broadcast({ type: 'library' });
    toast(`Sauvegarde créée : ${b.notebooks.length} carnet(s), ${b.strokes.length} trait(s). Rangez-la dans Fichiers ou iCloud Drive.`);
    return true;
  } catch (e) {
    toast(`Export impossible : ${(e as Error).message}`, 'error');
    return false;
  }
}
