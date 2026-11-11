import { useEffect, useRef } from 'react';
import type { InkTool, PenType, TextStyle } from '../model/types';
import { PEN_TYPES } from '../model/types';
import {
  ERASER_MAX,
  ERASER_MIN,
  ERASER_PRESETS,
  HIGHLIGHTER_PALETTE,
  PALETTE,
  TOOL_INFO,
  strokeStyleFrom,
  type Favorite,
  type InkSettings,
  type InkStyle,
} from '../ink/settings';
import { fillOutline, outlineToPath, previewPoints, strokeOutline } from '../ink/strokeRender';
import { FONTS, TEXT_SIZES } from '../ink/items';
import { Icon, type IconName } from './icons';

export const PEN_ICONS: Record<InkTool, IconName> = {
  pen: 'pen',
  fineliner: 'fineliner',
  marker: 'marker',
  fountain: 'fountain',
  brush: 'brush',
  pencil: 'pencil',
  highlighter: 'highlighter',
};

/** Aperçu exact : même moteur de rendu que sur la page. */
export function StrokePreview({ tool, ink, settings, paperDark }: { tool: InkTool; ink: InkStyle; settings: InkSettings; paperDark?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = c.clientWidth || 280;
    const h = 64;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = paperDark ? '#23272e' : '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const style = strokeStyleFrom(tool, settings, ink.smoothing, true);
    const outline = strokeOutline({ tool, width: ink.width, style, points: previewPoints(w, h) }, true);
    fillOutline(ctx, tool, ink.color, outlineToPath(outline));
  }, [tool, ink, settings, paperDark]);
  return <canvas ref={ref} className="stroke-preview" style={{ height: 64 }} aria-label={`Aperçu : ${TOOL_INFO[tool].label}, épaisseur ${ink.width}`} role="img" />;
}

function ColorGrid({
  colors,
  value,
  onChange,
  custom,
  onCustom,
}: {
  colors: string[];
  value: string;
  onChange: (c: string) => void;
  custom: string[];
  onCustom: (c: string) => void;
}) {
  return (
    <div className="color-grid" role="radiogroup" aria-label="Couleur">
      {colors.map((c) => (
        <button key={c} role="radio" aria-checked={value === c} aria-label={`Couleur ${c}`} className={`swatch${value === c ? ' is-on' : ''}`} style={{ ['--dot' as string]: c }} onClick={() => onChange(c)} />
      ))}
      {custom
        .filter((c) => !colors.includes(c))
        .map((c) => (
          <button key={`c-${c}`} role="radio" aria-checked={value === c} aria-label={`Couleur personnalisée ${c}`} className={`swatch${value === c ? ' is-on' : ''}`} style={{ ['--dot' as string]: c }} onClick={() => onChange(c)} />
        ))}
      <label className="swatch swatch-custom" title="Couleur personnalisée">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCustom(e.target.value)}
          aria-label="Choisir une couleur personnalisée"
        />
      </label>
    </div>
  );
}

function WidthControl({ tool, value, onChange }: { tool: InkTool; value: number; onChange: (w: number) => void }) {
  const info = TOOL_INFO[tool];
  return (
    <div className="panel-row">
      <div className="panel-label">
        Épaisseur <span className="muted">{value.toFixed(1)}</span>
      </div>
      <div className="preset-row">
        {info.presets.map((w) => (
          <button key={w} className={`preset${Math.abs(value - w) < 0.01 ? ' is-on' : ''}`} onClick={() => onChange(w)} aria-label={`Épaisseur ${w}`}>
            <span style={{ width: Math.min(24, 3 + (w / info.max) * 21), height: Math.min(24, 3 + (w / info.max) * 21) }} />
          </button>
        ))}
      </div>
      <input type="range" min={info.min} max={info.max} step={0.1} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Épaisseur" />
    </div>
  );
}

export function InkPanel({
  tool,
  penType,
  ink,
  settings,
  favorites,
  customColors,
  onPenType,
  onInk,
  onSettings,
  onAddFavorite,
  onRemoveFavorite,
  onApplyFavorite,
  onCustomColor,
}: {
  tool: 'pen' | 'highlighter';
  penType: PenType;
  ink: InkStyle;
  settings: InkSettings;
  favorites: Favorite[];
  customColors: string[];
  onPenType: (p: PenType) => void;
  onInk: (s: InkStyle) => void;
  onSettings: (s: Partial<InkSettings>) => void;
  onAddFavorite: () => void;
  onRemoveFavorite: (id: string) => void;
  onApplyFavorite: (f: Favorite) => void;
  onCustomColor: (c: string) => void;
}) {
  const inkTool: InkTool = tool === 'pen' ? penType : 'highlighter';
  return (
    <div className="panel">
      {tool === 'pen' && (
        <div className="seg seg-icons" role="radiogroup" aria-label="Type de stylo">
          {PEN_TYPES.map((p) => (
            <button key={p} role="radio" aria-checked={penType === p} className={penType === p ? 'is-on' : ''} onClick={() => onPenType(p)}>
              <Icon name={PEN_ICONS[p]} size={20} />
              <span>{TOOL_INFO[p].label.replace('Stylo à bille', 'Bille').replace('Feutre fin', 'Feutre')}</span>
            </button>
          ))}
        </div>
      )}
      <StrokePreview tool={inkTool} ink={ink} settings={settings} />
      <WidthControl tool={inkTool} value={ink.width} onChange={(width) => onInk({ ...ink, width })} />
      <div className="panel-row">
        <div className="panel-label">Couleur</div>
        <ColorGrid colors={tool === 'pen' ? PALETTE : HIGHLIGHTER_PALETTE} value={ink.color} onChange={(color) => onInk({ ...ink, color })} custom={customColors} onCustom={onCustomColor} />
      </div>
      <div className="panel-row">
        <div className="panel-label">
          Lissage <span className="muted">{Math.round(ink.smoothing * 100)} %</span>
        </div>
        <input type="range" min={0} max={1} step={0.05} value={ink.smoothing} onChange={(e) => onInk({ ...ink, smoothing: Number(e.target.value) })} aria-label="Lissage" />
      </div>
      {tool === 'pen' && (
        <details className="panel-more">
          <summary>Pression et inclinaison</summary>
          <div className="panel-row">
            <div className="panel-label">
              Sensibilité à la pression <span className="muted">{Math.round(settings.pressure * 100)} %</span>
            </div>
            <input type="range" min={0} max={1} step={0.05} value={settings.pressure} onChange={(e) => onSettings({ pressure: Number(e.target.value) })} aria-label="Sensibilité à la pression" />
          </div>
          <div className="panel-row">
            <div className="panel-label">
              Effet de l'inclinaison <span className="muted">{Math.round(settings.tilt * 100)} %</span>
            </div>
            <input type="range" min={0} max={1} step={0.05} value={settings.tilt} onChange={(e) => onSettings({ tilt: Number(e.target.value) })} aria-label="Effet de l'inclinaison" />
          </div>
          <p className="small muted">Utilisées seulement si le matériel et le navigateur les fournissent (Apple Pencil dans Safari).</p>
        </details>
      )}
      <div className="panel-row">
        <div className="panel-label">Favoris</div>
        <div className="fav-row">
          {favorites.map((f) => (
            <span key={f.id} className="fav-chip">
              <button onClick={() => onApplyFavorite(f)} aria-label={`Favori : ${TOOL_INFO[f.tool].label} ${f.color} ${f.width}`} title={TOOL_INFO[f.tool].label}>
                <Icon name={PEN_ICONS[f.tool]} size={16} />
                <span className="fav-dot" style={{ background: f.color, opacity: f.tool === 'highlighter' ? 0.6 : 1 }} />
              </button>
              <button className="fav-x" onClick={() => onRemoveFavorite(f.id)} aria-label="Retirer ce favori">
                ×
              </button>
            </span>
          ))}
          <button className="btn btn-small" onClick={onAddFavorite} disabled={favorites.length >= 8}>
            <Icon name="star" size={15} /> Ajouter les réglages actuels
          </button>
        </div>
      </div>
    </div>
  );
}

export function EraserPanel({ settings, onSettings }: { settings: InkSettings; onSettings: (s: Partial<InkSettings>) => void }) {
  const d = settings.eraserSize;
  return (
    <div className="panel">
      <div className="seg" role="radiogroup" aria-label="Mode de gomme">
        <button role="radio" aria-checked={settings.eraserMode === 'stroke'} className={settings.eraserMode === 'stroke' ? 'is-on' : ''} onClick={() => onSettings({ eraserMode: 'stroke' })}>
          Trait entier
        </button>
        <button role="radio" aria-checked={settings.eraserMode === 'partial'} className={settings.eraserMode === 'partial' ? 'is-on' : ''} onClick={() => onSettings({ eraserMode: 'partial' })}>
          Partielle
        </button>
      </div>
      <div className="eraser-preview" aria-hidden="true">
        <span style={{ width: d, height: d }} />
      </div>
      <div className="panel-row">
        <div className="panel-label">
          Diamètre <span className="muted">{d} px à l'écran</span>
        </div>
        <div className="preset-row">
          {ERASER_PRESETS.map((p) => (
            <button key={p} className={`preset${d === p ? ' is-on' : ''}`} onClick={() => onSettings({ eraserSize: p })} aria-label={`Diamètre ${p} pixels`}>
              <span className="ring" style={{ width: 6 + (p / ERASER_MAX) * 22, height: 6 + (p / ERASER_MAX) * 22 }} />
            </button>
          ))}
        </div>
        <input type="range" min={ERASER_MIN} max={ERASER_MAX} step={1} value={d} onChange={(e) => onSettings({ eraserSize: Number(e.target.value) })} aria-label="Diamètre de la gomme" />
      </div>
      <label className="check">
        <input type="checkbox" checked={settings.eraseHighlighterOnly} onChange={(e) => onSettings({ eraseHighlighterOnly: e.target.checked })} />
        N'effacer que le surligneur
      </label>
      <p className="small muted">
        Le diamètre est constant à l'écran : en zoomant, la gomme efface une zone plus petite de la page. Le cercle affiché correspond exactement à la zone
        effacée. Un geste de gomme s'annule en une fois.
      </p>
    </div>
  );
}

export function SelectPanel({
  settings,
  onSettings,
  canPaste,
  onPaste,
  onSelectAll,
}: {
  settings: InkSettings;
  onSettings: (s: Partial<InkSettings>) => void;
  canPaste: boolean;
  onPaste: () => void;
  onSelectAll: () => void;
}) {
  return (
    <div className="panel">
      <div className="seg seg-icons" role="radiogroup" aria-label="Forme de la sélection">
        {(
          [
            ['lasso', 'Lasso', 'lasso'],
            ['rect', 'Rectangle', 'selectRect'],
            ['square', 'Carré', 'selectSquare'],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} role="radio" aria-checked={settings.selectMode === id} className={settings.selectMode === id ? 'is-on' : ''} onClick={() => onSettings({ selectMode: id })}>
            <Icon name={icon} size={20} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="panel-row">
        <div className="panel-label">Objets partiellement dans la zone</div>
        <div className="seg" role="radiogroup" aria-label="Règle de sélection">
          <button role="radio" aria-checked={settings.selectRule === 'inside'} className={settings.selectRule === 'inside' ? 'is-on' : ''} onClick={() => onSettings({ selectRule: 'inside' })}>
            Entièrement inclus
          </button>
          <button role="radio" aria-checked={settings.selectRule === 'contact'} className={settings.selectRule === 'contact' ? 'is-on' : ''} onClick={() => onSettings({ selectRule: 'contact' })}>
            Touchés
          </button>
        </div>
        <p className="small muted">
          {settings.selectRule === 'inside'
            ? 'Seuls les objets entièrement dans la zone sont sélectionnés.'
            : 'Tout objet dont le tracé touche la zone est sélectionné (le tracé réel, pas sa boîte).'}
        </p>
      </div>
      <div className="panel-row">
        <div className="panel-label">Sélectionner</div>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={settings.selectStrokes} onChange={(e) => onSettings({ selectStrokes: e.target.checked })} /> Traits
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.selectText} onChange={(e) => onSettings({ selectText: e.target.checked })} /> Textes
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.selectImages} onChange={(e) => onSettings({ selectImages: e.target.checked })} /> Images
          </label>
        </div>
      </div>
      <div className="row">
        <button className="btn btn-small" onClick={onSelectAll}>
          Tout sélectionner sur la page
        </button>
        <button className="btn btn-small" onClick={onPaste} disabled={!canPaste}>
          <Icon name="paste" size={15} /> Coller
        </button>
      </div>
      <p className="small muted">Astuce : sur ordinateur, maintenez Maj en mode rectangle pour obtenir un carré.</p>
    </div>
  );
}

export function TextStylePanel({
  value,
  onChange,
  customColors,
  onCustomColor,
}: {
  value: TextStyle;
  onChange: (t: TextStyle) => void;
  customColors: string[];
  onCustomColor: (c: string) => void;
}) {
  const set = (p: Partial<TextStyle>) => onChange({ ...value, ...p });
  return (
    <div className="panel">
      <div className="panel-row">
        <div className="panel-label">Police (texte saisi au clavier)</div>
        <div className="font-grid" role="radiogroup" aria-label="Police">
          {(Object.keys(FONTS) as (keyof typeof FONTS)[]).map((f) => (
            <button key={f} role="radio" aria-checked={value.font === f} className={`font-btn${value.font === f ? ' is-on' : ''}`} style={{ fontFamily: FONTS[f].css }} onClick={() => set({ font: f })}>
              {FONTS[f].label}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-row">
        <div className="panel-label">Taille</div>
        <div className="row">
          <select value={value.size} onChange={(e) => set({ size: Number(e.target.value) })} aria-label="Taille du texte">
            {TEXT_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="seg seg-compact" aria-label="Mise en forme">
            <button aria-pressed={value.bold} className={value.bold ? 'is-on' : ''} onClick={() => set({ bold: !value.bold })} aria-label="Gras">
              <b>G</b>
            </button>
            <button aria-pressed={value.italic} className={value.italic ? 'is-on' : ''} onClick={() => set({ italic: !value.italic })} aria-label="Italique">
              <i>I</i>
            </button>
            <button aria-pressed={value.underline} className={value.underline ? 'is-on' : ''} onClick={() => set({ underline: !value.underline })} aria-label="Souligné">
              <u>S</u>
            </button>
          </div>
          <div className="seg seg-compact" role="radiogroup" aria-label="Alignement">
            {(
              [
                ['left', 'alignLeft', 'À gauche'],
                ['center', 'alignCenter', 'Centré'],
                ['right', 'alignRight', 'À droite'],
              ] as const
            ).map(([id, icon, label]) => (
              <button key={id} role="radio" aria-checked={value.align === id} className={value.align === id ? 'is-on' : ''} onClick={() => set({ align: id })} aria-label={label}>
                <Icon name={icon} size={16} />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="panel-row">
        <div className="panel-label">Couleur</div>
        <ColorGrid colors={PALETTE} value={value.color} onChange={(color) => set({ color })} custom={customColors} onCustom={onCustomColor} />
      </div>
      <p className="small muted">Touchez la page pour créer un bloc de texte, ou un bloc existant pour le modifier.</p>
    </div>
  );
}
