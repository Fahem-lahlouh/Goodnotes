import { useEffect, useRef } from 'react';
import { COVERS, COVER_PATTERNS, coverColor, type CoverPattern, type NotebookKind, type PaperSpec } from '../model/types';
import { drawPaper } from '../ink/paper';
import { Icon } from './icons';

/** Couverture de carnet (couleur + motif), rendue en CSS. */
export function Cover({
  color,
  pattern,
  title,
  kind = 'notebook',
  favorite,
  small,
}: {
  color: string;
  pattern: CoverPattern;
  title?: string;
  kind?: NotebookKind;
  favorite?: boolean;
  small?: boolean;
}) {
  return (
    <span className={`cover-art pat-${pattern}${small ? ' is-small' : ''}${kind === 'whiteboard' ? ' is-board' : ''}`} style={{ ['--cover' as string]: coverColor(color) }}>
      <span className="cover-spine" />
      {title && (
        <span className="cover-label">
          <span className="cover-title">{title}</span>
        </span>
      )}
      {kind === 'whiteboard' && <Icon name="board" size={small ? 14 : 20} className="cover-kind" />}
      {kind === 'quicknote' && <Icon name="quick" size={small ? 14 : 18} className="cover-kind" />}
      {favorite && <Icon name="star" size={small ? 12 : 16} filled className="cover-star" />}
    </span>
  );
}

export function CoverPicker({
  color,
  pattern,
  onChange,
}: {
  color: string;
  pattern: CoverPattern;
  onChange: (c: { color: string; pattern: CoverPattern }) => void;
}) {
  return (
    <div className="cover-picker">
      <div className="cover-row" role="radiogroup" aria-label="Couleur de couverture">
        {COVERS.map((c) => (
          <button
            key={c.id}
            role="radio"
            aria-checked={color === c.id}
            aria-label={c.label}
            title={c.label}
            className={`cover-chip${color === c.id ? ' is-on' : ''}`}
            style={{ background: c.color }}
            onClick={() => onChange({ color: c.id, pattern })}
          />
        ))}
      </div>
      <div className="cover-row" role="radiogroup" aria-label="Motif de couverture">
        {COVER_PATTERNS.map((p) => (
          <button key={p.id} role="radio" aria-checked={pattern === p.id} className={`pattern-chip${pattern === p.id ? ' is-on' : ''}`} onClick={() => onChange({ color, pattern: p.id })} title={p.label}>
            <Cover color={color} pattern={p.id} small />
            <span>{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Aperçu d'un papier : rendu par le même code que les pages réelles. */
export function PaperThumb({ paper, width, height, size = 76 }: { paper: PaperSpec; width: number; height: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const k = size / Math.max(width, height);
  const w = Math.round(width * k);
  const h = Math.round(height * k);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    drawPaper(ctx, width, height, paper, k);
  }, [paper, width, height, w, h, k]);
  return <canvas ref={ref} className="paper-thumb" style={{ width: w, height: h }} aria-hidden="true" />;
}
