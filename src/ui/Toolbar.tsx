import { useRef, useState } from 'react';
import type { InkSettings, Favorite, Tool } from '../ink/settings';
import { TOOL_INFO } from '../ink/settings';
import { newId } from '../model/ids';
import type { TextStyle } from '../model/types';
import { Icon, type IconName } from './icons';
import { Popover } from './Popover';
import { EraserPanel, InkPanel, PEN_ICONS, SelectPanel, TextStylePanel } from './ToolPanels';
import type { Prefs } from './prefs';

type PanelId = 'pen' | 'highlighter' | 'eraser' | 'select' | 'text';

const SELECT_ICON: Record<InkSettings['selectMode'], IconName> = { lasso: 'lasso', rect: 'selectRect', square: 'selectSquare' };

export function Toolbar({
  prefs,
  setPrefs,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  zoomOpen,
  onToggleZoom,
  onUndo,
  onRedo,
  onInsertImage,
  onPaste,
  canPaste,
  onSelectAll,
  onTextStyle,
  readOnly,
}: {
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  zoomOpen?: boolean;
  onToggleZoom?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onInsertImage: () => void;
  onPaste: () => void;
  canPaste: boolean;
  onSelectAll: () => void;
  onTextStyle: (t: TextStyle) => void;
  readOnly: boolean;
}) {
  const [panel, setPanel] = useState<PanelId | null>(null);
  const anchors = useRef<Partial<Record<PanelId, HTMLButtonElement | null>>>({});
  const { tool, styles, settings } = prefs;
  const setSettings = (s: Partial<InkSettings>) => setPrefs((p) => ({ settings: { ...p.settings, ...s } }));
  const addCustomColor = (c: string) => setPrefs((p) => ({ customColors: [c, ...p.customColors.filter((x) => x !== c)].slice(0, 8) }));

  const choose = (t: PanelId) => {
    if (tool === t) setPanel(panel === t ? null : t);
    else {
      setPrefs({ tool: t as Tool });
      setPanel(null);
    }
  };

  const applyFavorite = (f: Favorite) => {
    setPrefs((p) => {
      if (f.tool === 'highlighter') {
        return { tool: 'highlighter', styles: { ...p.styles, highlighter: { color: f.color, width: f.width, smoothing: f.smoothing } } };
      }
      return { tool: 'pen', styles: { ...p.styles, penType: f.tool, pens: { ...p.styles.pens, [f.tool]: { color: f.color, width: f.width, smoothing: f.smoothing } } } };
    });
  };

  const addFavorite = () => {
    const inkTool: Favorite['tool'] = tool === 'highlighter' ? 'highlighter' : styles.penType;
    const ink = tool === 'highlighter' ? styles.highlighter : styles.pens[styles.penType];
    setPrefs((p) => ({ favorites: [...p.favorites, { id: newId(), tool: inkTool, ...ink }].slice(0, 8) }));
  };

  const pen = styles.pens[styles.penType];
  const tb = (id: PanelId, icon: IconName, label: string, swatch?: string) => (
    <button
      ref={(el) => {
        anchors.current[id] = el;
      }}
      className={`tool-btn${tool === id ? ' is-on' : ''}${panel === id ? ' is-open' : ''}`}
      aria-pressed={tool === id}
      aria-expanded={panel === id}
      aria-haspopup="dialog"
      title={`${label}${tool === id ? ' — toucher à nouveau pour les réglages' : ''}`}
      aria-label={label}
      onClick={() => choose(id)}
    >
      <Icon name={icon} />
      {swatch && <span className="tool-swatch" style={{ background: swatch }} />}
      {tool === id && <span className="tool-caret" aria-hidden="true" />}
    </button>
  );

  const fingerDraws = settings.fingerMode === 'finger-and-pen';

  return (
    <div className={`toolbar toolbar-${prefs.toolbar}`} role="toolbar" aria-label="Outils d'écriture">
      <div className="tool-group">
        <button className="icon-btn" onClick={onUndo} disabled={!canUndo} aria-label="Annuler" title={undoLabel ? `Annuler : ${undoLabel} (⌘Z)` : 'Annuler (⌘Z)'}>
          <Icon name="undo" />
        </button>
        <button className="icon-btn" onClick={onRedo} disabled={!canRedo} aria-label="Rétablir" title={redoLabel ? `Rétablir : ${redoLabel} (⇧⌘Z)` : 'Rétablir (⇧⌘Z)'}>
          <Icon name="redo" />
        </button>
      </div>
      <span className="tool-sep" />
      <div className="tool-group">
        {tb('pen', PEN_ICONS[styles.penType], TOOL_INFO[styles.penType].label, pen.color)}
        {tb('highlighter', 'highlighter', 'Surligneur', styles.highlighter.color)}
        {tb('eraser', 'eraser', 'Gomme')}
        {tb('select', SELECT_ICON[settings.selectMode], 'Sélection')}
        {tb('text', 'text', 'Texte')}
        <button className="tool-btn" onClick={onInsertImage} disabled={readOnly} aria-label="Insérer une image" title="Insérer une image">
          <Icon name="image" />
        </button>
        {onToggleZoom && (
          <button
            className={`tool-btn${zoomOpen ? ' is-on' : ''}`}
            onClick={onToggleZoom}
            aria-pressed={!!zoomOpen}
            aria-label="Fenêtre de zoom"
            title={zoomOpen ? 'Fermer la fenêtre de zoom (Z)' : 'Fenêtre de zoom : écrire en grand, le texte s’inscrit à la bonne taille sur la page (Z)'}
          >
            <Icon name="zoomWindow" />
          </button>
        )}
      </div>
      {prefs.favorites.length > 0 && (
        <>
          <span className="tool-sep" />
          <div className="tool-group favs" aria-label="Favoris">
            {prefs.favorites.slice(0, 6).map((f) => {
              const active =
                (f.tool === 'highlighter' ? tool === 'highlighter' && styles.highlighter.color === f.color && styles.highlighter.width === f.width : tool === 'pen' && styles.penType === f.tool && pen.color === f.color && pen.width === f.width);
              return (
                <button key={f.id} className={`fav-btn${active ? ' is-on' : ''}`} onClick={() => applyFavorite(f)} aria-label={`Favori ${TOOL_INFO[f.tool].label} ${f.color}`} title={`${TOOL_INFO[f.tool].label} · ${f.width}`}>
                  <span className="fav-dot" style={{ background: f.color, opacity: f.tool === 'highlighter' ? 0.6 : 1, width: 8 + Math.min(14, f.width * (f.tool === 'highlighter' ? 0.4 : 1.6)), height: 8 + Math.min(14, f.width * (f.tool === 'highlighter' ? 0.4 : 1.6)) }} />
                </button>
              );
            })}
          </div>
        </>
      )}
      <span className="tool-spacer" />
      <button
        className={`finger-toggle${fingerDraws ? ' is-on' : ''}`}
        onClick={() => setSettings({ fingerMode: fingerDraws ? 'pen-only' : 'finger-and-pen' })}
        aria-pressed={fingerDraws}
        title={fingerDraws ? 'Le doigt écrit (deux doigts pour naviguer). Toucher pour : stylet uniquement.' : 'Stylet uniquement : le doigt navigue. Toucher pour écrire aussi au doigt.'}
      >
        <Icon name={fingerDraws ? 'finger' : 'hand'} size={20} />
        <span>{fingerDraws ? 'Doigt : écrit' : 'Doigt : navigue'}</span>
      </button>

      {(panel === 'pen' || panel === 'highlighter') && (
        <Popover anchor={anchors.current[panel] ?? null} onClose={() => setPanel(null)} label={panel === 'pen' ? 'Réglages du stylo' : 'Réglages du surligneur'} width={340} placement={prefs.toolbar === 'bottom' ? 'above' : 'below'}>
          <InkPanel
            tool={panel}
            penType={styles.penType}
            ink={panel === 'pen' ? pen : styles.highlighter}
            settings={settings}
            favorites={prefs.favorites}
            customColors={prefs.customColors}
            onPenType={(t) => setPrefs((p) => ({ styles: { ...p.styles, penType: t } }))}
            onInk={(ink) =>
              setPrefs((p) =>
                panel === 'pen'
                  ? { styles: { ...p.styles, pens: { ...p.styles.pens, [p.styles.penType]: ink } } }
                  : { styles: { ...p.styles, highlighter: ink } },
              )
            }
            onSettings={setSettings}
            onAddFavorite={addFavorite}
            onRemoveFavorite={(id) => setPrefs((p) => ({ favorites: p.favorites.filter((f) => f.id !== id) }))}
            onApplyFavorite={applyFavorite}
            onCustomColor={addCustomColor}
          />
        </Popover>
      )}
      {panel === 'eraser' && (
        <Popover anchor={anchors.current.eraser ?? null} onClose={() => setPanel(null)} label="Réglages de la gomme" placement={prefs.toolbar === 'bottom' ? 'above' : 'below'}>
          <EraserPanel settings={settings} onSettings={setSettings} />
        </Popover>
      )}
      {panel === 'select' && (
        <Popover anchor={anchors.current.select ?? null} onClose={() => setPanel(null)} label="Réglages de la sélection" width={340} placement={prefs.toolbar === 'bottom' ? 'above' : 'below'}>
          <SelectPanel settings={settings} onSettings={setSettings} canPaste={canPaste} onPaste={onPaste} onSelectAll={onSelectAll} />
        </Popover>
      )}
      {panel === 'text' && (
        <Popover anchor={anchors.current.text ?? null} onClose={() => setPanel(null)} label="Mise en forme du texte" width={360} placement={prefs.toolbar === 'bottom' ? 'above' : 'below'}>
          <TextStylePanel value={prefs.textStyle} onChange={onTextStyle} customColors={prefs.customColors} onCustomColor={addCustomColor} />
        </Popover>
      )}
    </div>
  );
}
