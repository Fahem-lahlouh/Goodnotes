import { useEffect, useRef, useState } from 'react';
import type { NotebookSession } from '../model/session';
import type { Page } from '../model/types';
import { renderPageContent } from '../ink/pageRender';
import { repo } from '../storage/repo';
import { Icon } from './icons';

const THUMB_W = 112;

/**
 * Miniature rendue seulement quand elle devient visible dans le panneau.
 * Pour une page non chargée dans l'éditeur, son contenu est lu le temps du rendu
 * puis libéré (les pages ne sont pas toutes gardées en mémoire).
 */
function Thumb({ session, page, version }: { session: NotebookSession; page: Page; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const k = THUMB_W / page.width;
  const h = Math.round(page.height * k);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: '200px' });
    io.observe(c);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c || !visible) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const content = session.isLoaded(page.id)
        ? { strokes: session.getStrokes(page.id), items: session.getItems(page.id) }
        : await repo.loadPageContent(page.id).catch(() => ({ strokes: [], items: [] }));
      if (cancelled) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = THUMB_W * dpr;
      c.height = h * dpr;
      const ctx = c.getContext('2d')!;
      ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
      renderPageContent(ctx, page, content.strokes, content.items, k);
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [session, page, version, visible, h, k]);

  return <canvas ref={ref} className="thumb" style={{ width: THUMB_W, height: h }} aria-hidden="true" />;
}

export function PagesPanel({
  session,
  version,
  current,
  readOnly,
  onGo,
  onAdd,
  onDuplicate,
  onDelete,
  onMove,
  onClose,
}: {
  session: NotebookSession;
  version: number;
  current: number;
  readOnly: boolean;
  onGo: (i: number) => void;
  onAdd: (afterIndex: number) => void;
  onDuplicate: (pageId: string) => void;
  onDelete: (pageId: string) => void;
  onMove: (pageId: string, to: number) => void;
  onClose: () => void;
}) {
  const pages = session.pageOrder;
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.children[current]?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <aside className="pages-panel" aria-label="Pages">
      <header className="pages-head">
        <strong>Pages</strong>
        <span className="muted small">{pages.length}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer le panneau des pages">
          <Icon name="close" size={18} />
        </button>
      </header>
      <ol className="pages-list" ref={listRef}>
        {pages.map((p, i) => (
          <li key={p.id} className={i === current ? 'is-current' : ''}>
            <button className="thumb-btn" onClick={() => onGo(i)} aria-label={`Aller à la page ${i + 1}`} aria-current={i === current ? 'page' : undefined}>
              <Thumb session={session} page={p} version={version} />
            </button>
            <div className="thumb-bar">
              <span className="small thumb-num">{i + 1}</span>
              {!readOnly && (
                <span className="thumb-actions">
                  <button className="icon-btn sm" disabled={i === 0} onClick={() => onMove(p.id, i - 1)} aria-label="Avancer la page" title="Avancer">
                    <Icon name="chevronLeft" size={15} />
                  </button>
                  <button className="icon-btn sm" disabled={i === pages.length - 1} onClick={() => onMove(p.id, i + 1)} aria-label="Reculer la page" title="Reculer">
                    <Icon name="chevronRight" size={15} />
                  </button>
                  <button className="icon-btn sm" onClick={() => onDuplicate(p.id)} aria-label="Dupliquer la page" title="Dupliquer">
                    <Icon name="duplicate" size={15} />
                  </button>
                  <button className="icon-btn sm" disabled={pages.length <= 1} onClick={() => onDelete(p.id)} aria-label="Supprimer la page" title="Supprimer">
                    <Icon name="trash" size={15} />
                  </button>
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!readOnly && (
        <button className="btn btn-small pages-add" onClick={() => onAdd(pages.length)}>
          <Icon name="plus" size={16} /> Ajouter une page à la fin
        </button>
      )}
    </aside>
  );
}
