import { useRef, type RefObject } from 'react';
import type { InkEngine, ZoomState } from '../ink/engine';
import { Icon } from './icons';

/**
 * Fenêtre de zoom d'écriture (sous la page).
 * La zone agrandie est un cadre sur la page principale : ce qui est écrit ici s'inscrit
 * directement dans ce cadre, à la bonne taille. Le moteur gère la saisie ; ce panneau
 * fournit les commandes (avancer, retour à la ligne, grossissement, hauteur, fermeture).
 */
export function ZoomPanel({
  engine,
  state,
  hostRef,
  height,
  autoAdvance,
  onHeight,
  onAutoAdvance,
  onClose,
}: {
  engine: InkEngine;
  state: ZoomState | null;
  hostRef: RefObject<HTMLDivElement | null>;
  height: number;
  autoAdvance: boolean;
  onHeight: (h: number) => void;
  onAutoAdvance: (v: boolean) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; startY: number; startH: number; total: number } | null>(null);
  const factor = state?.factor ?? engine.settings.zoomFactor;

  const onGripDown = (e: React.PointerEvent) => {
    const wrap = panelRef.current?.parentElement;
    if (!wrap) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, startY: e.clientY, startH: height, total: wrap.getBoundingClientRect().height };
  };
  const onGripMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const h = d.startH + (d.startY - e.clientY) / d.total;
    onHeight(Math.round(Math.max(0.2, Math.min(0.6, h)) * 100) / 100);
  };
  const onGripUp = (e: React.PointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  return (
    <div className="zoom-panel" ref={panelRef} role="region" aria-label="Fenêtre de zoom">
      <div
        className="zoom-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Hauteur de la fenêtre de zoom"
        aria-valuemin={20}
        aria-valuemax={60}
        aria-valuenow={Math.round(height * 100)}
        tabIndex={0}
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={onGripUp}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') onHeight(Math.min(0.6, Math.round((height + 0.04) * 100) / 100));
          if (e.key === 'ArrowDown') onHeight(Math.max(0.2, Math.round((height - 0.04) * 100) / 100));
        }}
      >
        <span />
      </div>
      <div className="zoom-bar" role="toolbar" aria-label="Commandes de la fenêtre de zoom">
        <div className="zoom-group">
          <button className="icon-btn sm" onClick={() => engine.zoomAdvance(-1)} aria-label="Reculer le cadre" title="Reculer">
            <Icon name="chevronLeft" size={18} />
          </button>
          <button className="icon-btn sm" onClick={() => engine.zoomAdvance(1)} aria-label="Avancer le cadre" title="Avancer">
            <Icon name="chevronRight" size={18} />
          </button>
          <button className="btn btn-small zoom-newline" onClick={() => engine.zoomNewline()} aria-label="Retour à la ligne" title="Retour à la ligne (Entrée)">
            <Icon name="newline" size={18} />
            <span>Ligne</span>
          </button>
        </div>
        <div className="zoom-group">
          <button className="icon-btn sm" onClick={() => engine.setZoomFactor(factor / 1.2)} aria-label="Moins de grossissement" title="Grossissement −">
            <Icon name="minus" size={18} />
          </button>
          <span className="zoom-factor" aria-live="polite" aria-label={`Grossissement ${factor.toFixed(1)} fois`}>
            ×{factor.toFixed(1)}
          </span>
          <button className="icon-btn sm" onClick={() => engine.setZoomFactor(factor * 1.2)} aria-label="Plus de grossissement" title="Grossissement +">
            <Icon name="plus" size={18} />
          </button>
        </div>
        <div className="zoom-group">
          <button
            className={`chip${autoAdvance ? ' is-on' : ''}`}
            onClick={() => onAutoAdvance(!autoAdvance)}
            aria-pressed={autoAdvance}
            title="Avance automatique : le cadre se décale quand vous écrivez dans la zone bleutée à droite"
          >
            Avance auto
          </button>
          <button className="icon-btn sm" onClick={onClose} aria-label="Fermer la fenêtre de zoom" title="Fermer (Z)">
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>
      <div className="ink-host zoom-host" ref={hostRef} data-testid="zoom-host" />
    </div>
  );
}
