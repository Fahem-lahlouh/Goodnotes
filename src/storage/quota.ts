export interface StorageInfo {
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
}

export async function storageInfo(): Promise<StorageInfo> {
  const sm = navigator.storage;
  let usage: number | null = null;
  let quota: number | null = null;
  let persisted: boolean | null = null;
  try {
    if (sm?.estimate) {
      const e = await sm.estimate();
      usage = e.usage ?? null;
      quota = e.quota ?? null;
    }
    if (sm?.persisted) persisted = await sm.persisted();
  } catch {
    /* API indisponible */
  }
  return { usage, quota, persisted };
}

/**
 * Demande au navigateur de ne pas évincer les données automatiquement.
 * Safari accorde ce statut selon ses propres critères (application installée
 * sur l'écran d'accueil notamment) : ce n'est PAS une garantie de conservation.
 */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignoré */
  }
  return null;
}

export function formatBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}

export function isStandalone(): boolean {
  return (
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
