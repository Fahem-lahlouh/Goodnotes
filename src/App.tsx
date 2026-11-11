import { useEffect, useState } from 'react';
import { Library } from './ui/Library';
import { Editor } from './ui/Editor';
import { ToastHost, toast } from './ui/Toast';
import { applyTheme, usePrefs } from './ui/prefs';
import { onUpdateAvailable, applyUpdate } from './pwa/register';
import { saveQueue } from './storage/openNotebook';
import { requestPersistence } from './storage/quota';

type Route = { view: 'library' } | { view: 'notebook'; id: string; page?: number };

function parseHash(): Route {
  const m = location.hash.match(/^#\/n\/([\w-]+)(?:\/p\/(\d+))?/);
  if (m) return { view: 'notebook', id: m[1], page: m[2] ? Number(m[2]) : undefined };
  return { view: 'library' };
}

export function navigate(r: Route): void {
  const h = r.view === 'notebook' ? `#/n/${r.id}` : '#/';
  if (location.hash !== h) location.hash = h;
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [prefs] = usePrefs();
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    const h = () => setRoute(parseHash());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  useEffect(() => applyTheme(prefs.theme), [prefs.theme]);

  useEffect(() => onUpdateAvailable(() => setUpdateReady(true)), []);

  useEffect(() => {
    // Demande la persistance du stockage dès le premier lancement.
    void requestPersistence();
    // Avertit avant de quitter si des écritures sont encore en attente.
    const h = (e: BeforeUnloadEvent) => {
      if (saveQueue.state.pending > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  return (
    <>
      {route.view === 'library' ? (
        <Library onOpen={(id) => navigate({ view: 'notebook', id })} />
      ) : (
        <Editor key={route.id} notebookId={route.id} onClose={() => navigate({ view: 'library' })} />
      )}
      {updateReady && (
        <div className="update-banner" role="status">
          <span>Une nouvelle version de Calame est prête.</span>
          <button
            className="btn btn-primary btn-small"
            onClick={async () => {
              await saveQueue.flush();
              if (!applyUpdate()) toast('Mise à jour impossible pour le moment.');
            }}
          >
            Mettre à jour
          </button>
          <button className="btn btn-ghost btn-small" onClick={() => setUpdateReady(false)}>
            Plus tard
          </button>
        </div>
      )}
      <ToastHost />
    </>
  );
}
