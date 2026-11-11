import { useEffect, useRef } from 'react';
import type { NotebookSession } from '../model/session';
import type { Page } from '../model/types';
import { drawPaper } from '../ink/paper';
import { drawStrokes } from '../ink/strokeRender';
import { Icon } from './icons';

const THUMB_W = 112;

function Thumb({ session, page, version }: { session: NotebookSession; page: Page; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // Rendu différé pour ne pas gêner l'écriture.
    const handle = requestIdleCallbackSafe(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const k = THUMB_W / page.width;
      const h = Math.round(page.height * k);
      c.width = THUMB_W * dpr;
      c.height = h * dpr;
      c.style.width = `${THUMB_W}px`;
      c.style.height = `${h}px`;
      const ctx = c.getContext('2d')!;
      ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
      drawPaper(ctx, page.width, page.height, page.paper, k);
      drawStrokes(ctx, session.getStrokes(page.id));
    });
    return () => cancelIdleCallbackSafe(handle);
  }, [session, page, version]);
  return <canvas ref={ref} className="thumb" aria-hidden="true" />;
}

type IdleHandle = number;
function requestIdleCallbackSafe(fn: () => void): IdleHandle {
  const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  return w.requestIdleCallback ? w.requestIdleCallback(fn, { timeout: 500 }) : window.setTimeout(fn, 60);
}
function cancelIdleCallbackSafe(h: IdleHandle): void {
  const w = window as Window & { cancelIdleCallback?: (h: number) => void };
  if (w.cancelIdleCallback) w.cancelIdleCallback(h);
  else clearTimeout(h);
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
        <button className="icon-btn" onClick={onClose} aria-label="Fermer le panneau des pages">
          <Icon name="close" size={18} />
        </button>
      </header>
      <ol className="pages-list" ref={listRef}>
        {pages.map((p, i) => (
          <li key={p.id} className={i === current ? 'is-current' : ''}>
            <button className="thumb-btn" onClick={() => onGo(i)} aria-label={`Aller à la page ${i + 1}`} aria-current={i === current}>
              <Thumb session={session} page={p} version={version} />
            </button>
            <div className="thumb-bar">
              <span className="small">{i + 1}</span>
              {!readOnly && (
                <span className="thumb-actions">
                  <button className="icon-btn sm" disabled={i === 0} onClick={() => onMove(p.id, i - 1)} aria-label="Monter la page" title="Monter">
                    ↑
                  </button>
                  <button className="icon-btn sm" disabled={i === pages.length - 1} onClick={() => onMove(p.id, i + 1)} aria-label="Descendre la page" title="Descendre">
                    ↓
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
          <Icon name="plus" size={16} /> Ajouter une page
        </button>
      )}
    </aside>
  );
}
