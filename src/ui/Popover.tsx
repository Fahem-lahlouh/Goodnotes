import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Panneau flottant ancré à un bouton.
 * - se ferme par Échap, par le bouton d'origine ou par un appui ailleurs ;
 * - un appui sur la page ferme le panneau SANS bloquer le tracé (l'écriture n'est jamais perdue) ;
 * - reste ENTIÈREMENT dans la zone visible : il s'ouvre du côté préféré s'il y tient, sinon du côté
 *   qui a le plus de place (au-dessus d'un bouton placé en bas de l'écran, par exemple), et défile
 *   s'il est plus haut que la place disponible. La zone visible est celle de l'écran réel (barres de
 *   Safari et clavier exclus, via visualViewport), pas celle de la page.
 */
export function Popover({
  anchor,
  onClose,
  children,
  label,
  width = 320,
  placement = 'below',
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  label: string;
  width?: number;
  placement?: 'below' | 'above';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; w: number; maxH: number; side: 'below' | 'above' } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!anchor || !el) return;
      const r = anchor.getBoundingClientRect();
      const vv = window.visualViewport;
      const vTop = vv ? vv.offsetTop : 0;
      const vLeft = vv ? vv.offsetLeft : 0;
      const vh = vv ? vv.height : window.innerHeight;
      const vw = vv ? vv.width : window.innerWidth;
      const margin = 8;
      const gap = 8;
      const w = Math.min(width, vw - margin * 2);
      const left = Math.max(vLeft + margin, Math.min(vLeft + vw - w - margin, r.left + r.width / 2 - w / 2));
      // Hauteur naturelle du contenu (sans limite).
      const prevMax = el.style.maxHeight;
      el.style.maxHeight = 'none';
      const natural = el.scrollHeight;
      el.style.maxHeight = prevMax;
      const below = vTop + vh - r.bottom - gap - margin;
      const above = r.top - vTop - gap - margin;
      let side = placement;
      if (side === 'below' && natural > below && above > below) side = 'above';
      else if (side === 'above' && natural > above && below > above) side = 'below';
      const space = side === 'below' ? below : above;
      let maxH = Math.max(0, space);
      let top: number;
      if (maxH >= Math.min(natural, 140)) {
        const h = Math.min(natural, maxH);
        top = side === 'below' ? r.bottom + gap : r.top - gap - h;
      } else {
        // Ni au-dessus ni au-dessous il n'y a assez de place : on reste dans l'écran, quitte à couvrir le bouton.
        maxH = vh - margin * 2;
        const h = Math.min(natural, maxH);
        top = vTop + vh - margin - h;
      }
      setPos({ left, top, w, maxH, side });
    };
    place();
    // Le contenu peut changer de taille (sous-menu, réglages qui s'ouvrent) : on replace le panneau.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place()) : null;
    if (ro && ref.current) for (const c of Array.from(ref.current.children)) ro.observe(c);
    const vv = window.visualViewport;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
    };
  }, [anchor, width, placement]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className={`popover popover-${pos?.side ?? placement}`}
      role="dialog"
      aria-label={label}
      style={
        pos
          ? { left: pos.left, top: pos.top, width: pos.w, maxHeight: pos.maxH }
          : // Premier rendu : mesure hors écran, invisible (aucun clignotement : placement avant l'affichage).
            { left: -10000, top: 0, width: Math.min(width, window.innerWidth - 16), visibility: 'hidden' }
      }
    >
      {children}
    </div>,
    document.body,
  );
}
