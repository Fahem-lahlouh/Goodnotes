import { useRef, useState, type RefObject } from 'react';
import type { InkEngine, ZoomState } from '../ink/engine';
import { Icon } from './icons';
import { Popover } from './Popover';

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
  const [menu, setMenu] = useState<HTMLElement | null>(null);

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
          <button className="icon-btn sm" onClick={() => engine.zoomIndent(1)} aria-label="Augmenter la marge gauche" title="Marge gauche → (retour à la ligne plus à droite)">
            <Icon name="indent" size={20} />
          </button>
          <button className="icon-btn sm" onClick={() => engine.zoomIndent(-1)} aria-label="Réduire la marge gauche" title="Marge gauche ←">
            <Icon name="outdent" size={20} />
          </button>
        </div>
        <div className="zoom-group zoom-factor-group">
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
          <button className="icon-btn sm zoom-accent" onClick={() => engine.zoomAdvance(-1)} aria-label="Reculer le cadre" title="Reculer">
            <Icon name="chevronLeft" size={20} />
          </button>
          <button className="icon-btn sm zoom-accent" onClick={() => engine.zoomAdvance(1)} aria-label="Avancer le cadre" title="Avancer">
            <Icon name="chevronRight" size={20} />
          </button>
          <button className="icon-btn sm zoom-accent" onClick={() => engine.zoomNewline()} aria-label="Retour à la ligne" title="Retour à la ligne (Entrée)">
            <Icon name="newline" size={20} />
          </button>
          <button className="icon-btn sm zoom-accent" onClick={onClose} aria-label="Fermer la fenêtre de zoom" title="Fermer (Z)">
            <Icon name="close" size={20} />
          </button>
          <button
            className={`icon-btn sm zoom-accent${menu ? ' is-on' : ''}`}
            onClick={(e) => setMenu(menu ? null : e.currentTarget)}
            aria-label="Options de la fenêtre de zoom"
            aria-expanded={!!menu}
            title="Options"
          >
            <Icon name="more" size={20} />
          </button>
        </div>
      </div>
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} label="Options de la fenêtre de zoom" width={300} placement="above">
          <div className="panel zoom-options">
            <div className="panel-row">
              <div className="panel-label">Grossissement</div>
              <div className="row">
                <button className="icon-btn sm" onClick={() => engine.setZoomFactor(factor / 1.2)} aria-label="Réduire le grossissement">
                  <Icon name="minus" size={18} />
                </button>
                <span className="zoom-factor">×{factor.toFixed(1)}</span>
                <button className="icon-btn sm" onClick={() => engine.setZoomFactor(factor * 1.2)} aria-label="Augmenter le grossissement">
                  <Icon name="plus" size={18} />
                </button>
              </div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={autoAdvance} onChange={(e) => onAutoAdvance(e.target.checked)} />
              <span className="toggle-track" aria-hidden="true" />
              <span>
                Avance automatique
                <small className="muted block">Le cadre avance quand un mot se termine dans la zone bleutée, puis passe à la ligne suivante à la marge droite.</small>
              </span>
            </label>
            <div className="panel-row">
              <div className="panel-label">Marge droite</div>
              <div className="row">
                <button className="icon-btn sm" onClick={() => engine.zoomRightMargin(-1)} aria-label="Rapprocher la marge droite">
                  <Icon name="chevronLeft" size={18} />
                </button>
                <button className="icon-btn sm" onClick={() => engine.zoomRightMargin(1)} aria-label="Éloigner la marge droite">
                  <Icon name="chevronRight" size={18} />
                </button>
              </div>
            </div>
            <button className="btn btn-small" onClick={() => engine.resetZoomMargins()}>
              Marges par défaut
            </button>
            <p className="small muted">Astuce : touchez la page du doigt pour y placer le cadre ; faites glisser l'onglet du cadre pour le déplacer.</p>
          </div>
        </Popover>
      )}
      <div className="ink-host zoom-host" ref={hostRef} data-testid="zoom-host" />
    </div>
  );
}
