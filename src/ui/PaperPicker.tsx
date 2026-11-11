import type { ReactElement } from 'react';
import type { PaperSpec } from '../model/types';
import { PAPER_COLORS } from '../ink/paper';

const KINDS: { id: PaperSpec['kind']; label: string }[] = [
  { id: 'blank', label: 'Blanc' },
  { id: 'lined', label: 'Ligné' },
  { id: 'grid', label: 'Quadrillé' },
  { id: 'dotted', label: 'Pointillé' },
];

const COLORS: { id: PaperSpec['color']; label: string }[] = [
  { id: 'white', label: 'Blanc' },
  { id: 'cream', label: 'Crème' },
  { id: 'dark', label: 'Sombre' },
];

/** Aperçu SVG miniature d'un papier. */
export function PaperSwatch({ paper, size = 54 }: { paper: PaperSpec; size?: number }) {
  const c = PAPER_COLORS[paper.color];
  const h = Math.round(size * 1.414);
  const s = 9;
  const lines: ReactElement[] = [];
  if (paper.kind === 'lined') for (let y = s * 2; y < h; y += s) lines.push(<line key={y} x1={0} x2={size} y1={y} y2={y} stroke={c.line} />);
  if (paper.kind === 'grid') {
    for (let y = s; y < h; y += s) lines.push(<line key={`h${y}`} x1={0} x2={size} y1={y} y2={y} stroke={c.line} />);
    for (let x = s; x < size; x += s) lines.push(<line key={`v${x}`} y1={0} y2={h} x1={x} x2={x} stroke={c.line} />);
  }
  if (paper.kind === 'dotted')
    for (let y = s; y < h; y += s) for (let x = s; x < size; x += s) lines.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={0.9} fill={c.dot} />);
  return (
    <svg width={size} height={h} viewBox={`0 0 ${size} ${h}`} className="paper-swatch" aria-hidden="true">
      <rect width={size} height={h} fill={c.bg} />
      {lines}
    </svg>
  );
}

export function PaperPicker({ value, onChange }: { value: PaperSpec; onChange: (p: PaperSpec) => void }) {
  return (
    <div className="paper-picker">
      <div className="choice-row" role="radiogroup" aria-label="Modèle de papier">
        {KINDS.map((k) => (
          <button
            key={k.id}
            role="radio"
            aria-checked={value.kind === k.id}
            className={`paper-choice${value.kind === k.id ? ' is-on' : ''}`}
            onClick={() => onChange({ ...value, kind: k.id })}
          >
            <PaperSwatch paper={{ ...value, kind: k.id }} />
            <span>{k.label}</span>
          </button>
        ))}
      </div>
      <div className="seg" role="radiogroup" aria-label="Couleur du papier">
        {COLORS.map((c) => (
          <button key={c.id} role="radio" aria-checked={value.color === c.id} className={value.color === c.id ? 'is-on' : ''} onClick={() => onChange({ ...value, color: c.id })}>
            {c.label}
          </button>
        ))}
      </div>
      <label className="field-inline">
        Espacement
        <input
          type="range"
          min={20}
          max={48}
          step={2}
          value={value.spacing}
          onChange={(e) => onChange({ ...value, spacing: Number(e.target.value) })}
        />
        <span className="muted">{value.spacing}</span>
      </label>
    </div>
  );
}
