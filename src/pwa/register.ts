/**
 * Enregistrement du service worker et mises à jour contrôlées.
 *
 * Une nouvelle version n'est JAMAIS activée automatiquement : elle attend
 * (« waiting ») jusqu'à ce que l'utilisateur touche « Mettre à jour ». Avant
 * d'activer, l'interface vide la file d'écriture ; une écriture en cours
 * n'est donc jamais interrompue par un rechargement.
 */
let waiting: ServiceWorker | null = null;
/** Version annoncée par le serveur (null si inconnue / hors ligne). */
export let servedVersion: string | null = null;
const listeners = new Set<() => void>();

export function onUpdateAvailable(fn: () => void): () => void {
  listeners.add(fn);
  if (waiting) fn();
  return () => listeners.delete(fn);
}

function notify(sw: ServiceWorker) {
  waiting = sw;
  for (const l of listeners) l();
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      if (reg.waiting && navigator.serviceWorker.controller) notify(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) notify(sw);
        });
      });
      // Vérifie les mises à jour au démarrage et quand l'app revient au premier plan :
      // version.json (jamais mis en cache) indique la version réellement servie.
      const check = async () => {
        try {
          const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
          if (!r.ok) return;
          const v = (await r.json()) as { version?: string };
          servedVersion = v.version ?? null;
          if (servedVersion && servedVersion !== __APP_VERSION__) await reg.update();
        } catch {
          /* hors ligne : rien à vérifier */
        }
      };
      void check();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void check();
      });
    } catch (e) {
      console.warn('[calame] service worker non enregistré', e);
    }
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !waiting) return;
    reloading = true;
    location.reload();
  });
}

/** Active la version en attente (après confirmation de l'utilisateur). */
export function applyUpdate(): boolean {
  if (!waiting) return false;
  waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}
