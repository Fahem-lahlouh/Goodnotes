import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './icons';

/**
 * Feuille de menu : panneau du bas sur téléphone, panneau centré sur iPad et ordinateur.
 * `onBack` affiche un bouton retour (sous-menu).
 */
export function Sheet({ title, onClose, onBack, children }: { title: string; onClose: () => void; onBack?: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, input, select')?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (onBack) onBack();
        else onClose();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose, onBack]);
  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <span className="sheet-grip" aria-hidden="true" />
        <header className="sheet-head">
          {onBack ? (
            <button className="icon-btn" onClick={onBack} aria-label="Retour">
              <Icon name="chevronLeft" />
            </button>
          ) : (
            <span className="sheet-head-spacer" />
          )}
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="close" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function SheetGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="sheet-group">
      {title && <h3 className="sheet-group-title">{title}</h3>}
      <div className="sheet-list">{children}</div>
    </section>
  );
}

export function SheetItem({
  icon,
  label,
  detail,
  onClick,
  danger,
  chevron,
  right,
  disabled,
  pressed,
}: {
  icon?: Parameters<typeof Icon>[0]['name'];
  label: string;
  detail?: string;
  onClick?: () => void;
  danger?: boolean;
  chevron?: boolean;
  right?: ReactNode;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button className={`sheet-item${danger ? ' is-danger' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={pressed}>
      {icon && <Icon name={icon} size={22} />}
      <span className="sheet-item-text">
        <span>{label}</span>
        {detail && <small className="muted">{detail}</small>}
      </span>
      {right}
      {chevron && <Icon name="chevronRight" size={18} className="sheet-chevron" />}
    </button>
  );
}

/** Interrupteur accessible (rôle « switch »). */
export function SheetSwitch({ icon, label, detail, checked, onChange, disabled }: { icon?: Parameters<typeof Icon>[0]['name']; label: string; detail?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`sheet-item sheet-switch${disabled ? ' is-disabled' : ''}`}>
      {icon && <Icon name={icon} size={22} />}
      <span className="sheet-item-text">
        <span>{label}</span>
        {detail && <small className="muted">{detail}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}

export function SheetChoice<T extends string>({ label, icon, value, options, onChange }: { label: string; icon?: Parameters<typeof Icon>[0]['name']; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="sheet-item sheet-choice">
      {icon && <Icon name={icon} size={22} />}
      <span className="sheet-item-text">
        <span>{label}</span>
      </span>
      <div className="seg seg-compact" role="radiogroup" aria-label={label}>
        {options.map(([id, l]) => (
          <button key={id} role="radio" aria-checked={value === id} className={value === id ? 'is-on' : ''} onClick={() => onChange(id)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
