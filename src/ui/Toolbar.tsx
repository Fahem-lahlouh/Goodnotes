import { HIGHLIGHTER_COLORS, HIGHLIGHTER_WIDTHS, INK_COLORS, PEN_WIDTHS, type Tool, type ToolStyles } from '../ink/settings';
import { Icon, type IconName } from './icons';

const TOOLS: { id: Tool; label: string; icon: IconName; key: string }[] = [
  { id: 'pen', label: 'Stylo', icon: 'pen', key: 'P' },
  { id: 'highlighter', label: 'Surligneur', icon: 'highlighter', key: 'H' },
  { id: 'eraser', label: 'Gomme', icon: 'eraser', key: 'E' },
  { id: 'lasso', label: 'Lasso', icon: 'lasso', key: 'L' },
];

export function Toolbar({
  tool,
  styles,
  eraserMode,
  onTool,
  onStyle,
  onEraserMode,
  position,
}: {
  tool: Tool;
  styles: ToolStyles;
  eraserMode: 'stroke' | 'partial';
  onTool: (t: Tool) => void;
  onStyle: (s: ToolStyles) => void;
  onEraserMode: (m: 'stroke' | 'partial') => void;
  position: 'top' | 'bottom' | 'left' | 'right';
}) {
  const inkTool = tool === 'highlighter' ? 'highlighter' : 'pen';
  const st = styles[inkTool];
  const colors = inkTool === 'pen' ? INK_COLORS : HIGHLIGHTER_COLORS;
  const widths = inkTool === 'pen' ? PEN_WIDTHS : HIGHLIGHTER_WIDTHS;
  const set = (patch: Partial<typeof st>) => onStyle({ ...styles, [inkTool]: { ...st, ...patch } });
  const showInk = tool === 'pen' || tool === 'highlighter';

  return (
    <div className={`toolbar toolbar-${position}`} role="toolbar" aria-label="Outils d'écriture">
      <div className="tool-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool-btn${tool === t.id ? ' is-on' : ''}`}
            aria-pressed={tool === t.id}
            title={`${t.label} (${t.key})`}
            aria-label={t.label}
            onClick={() => onTool(t.id)}
          >
            <Icon name={t.icon} />
            {(t.id === 'pen' || t.id === 'highlighter') && (
              <span className="tool-swatch" style={{ background: styles[t.id].color }} />
            )}
          </button>
        ))}
      </div>
      <span className="tool-sep" />
      {showInk && (
        <>
          <div className="tool-group" role="radiogroup" aria-label="Couleur">
            {colors.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={st.color === c}
                aria-label={`Couleur ${c}`}
                className={`color-dot${st.color === c ? ' is-on' : ''}`}
                style={{ ['--dot' as string]: c }}
                onClick={() => set({ color: c })}
              />
            ))}
            <label className="color-dot color-custom" title="Couleur personnalisée">
              <input type="color" value={st.color} onChange={(e) => set({ color: e.target.value })} aria-label="Couleur personnalisée" />
            </label>
          </div>
          <span className="tool-sep" />
          <div className="tool-group" role="radiogroup" aria-label="Épaisseur">
            {widths.map((w) => (
              <button
                key={w}
                role="radio"
                aria-checked={st.width === w}
                aria-label={`Épaisseur ${w}`}
                className={`width-btn${st.width === w ? ' is-on' : ''}`}
                onClick={() => set({ width: w })}
              >
                <span
                  style={{
                    width: Math.min(22, 3 + w * (inkTool === 'pen' ? 2.2 : 0.7)),
                    height: Math.min(22, 3 + w * (inkTool === 'pen' ? 2.2 : 0.7)),
                    background: inkTool === 'pen' ? 'currentColor' : st.color,
                  }}
                />
              </button>
            ))}
          </div>
        </>
      )}
      {tool === 'eraser' && (
        <div className="seg seg-compact" role="radiogroup" aria-label="Mode de gomme">
          <button role="radio" aria-checked={eraserMode === 'stroke'} className={eraserMode === 'stroke' ? 'is-on' : ''} onClick={() => onEraserMode('stroke')}>
            Trait entier
          </button>
          <button role="radio" aria-checked={eraserMode === 'partial'} className={eraserMode === 'partial' ? 'is-on' : ''} onClick={() => onEraserMode('partial')}>
            Partielle
          </button>
        </div>
      )}
      {tool === 'lasso' && <span className="muted small tool-hint">Entourez des traits pour les sélectionner</span>}
    </div>
  );
}
