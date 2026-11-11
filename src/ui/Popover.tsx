import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Panneau flottant ancré à un bouton.
 * - se ferme par Échap, par le bouton d'origine ou par un appui ailleurs ;
 * - un appui sur la page ferme le panneau SANS bloquer le tracé (l'écriture n'est jamais perdue) ;
 * - reste dans l'écran (zones de sécurité comprises) et défile si nécessaire.
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
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const w = Math.min(width, vw - 16);
      const left = Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w / 2));
      if (placement === 'below') setPos({ left, top: r.bottom + 8, maxH: vh - r.bottom - 24 });
      else setPos({ left, bottom: window.innerHeight - r.top + 8, maxH: r.top - 24 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
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

  if (!pos) return null;
  return createPortal(
    <div
      ref={ref}
      className={`popover popover-${placement}`}
      role="dialog"
      aria-label={label}
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: Math.min(width, window.innerWidth - 16), maxHeight: Math.max(160, pos.maxH) }}
    >
      {children}
    </div>,
    document.body,
  );
}
