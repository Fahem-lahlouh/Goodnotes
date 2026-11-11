import { useRef, useState } from 'react';
import type { InkSettings, Favorite, Tool } from '../ink/settings';
import { TOOL_INFO } from '../ink/settings';
import { newId } from '../model/ids';
import type { TextStyle } from '../model/types';
import { Icon, type IconName } from './icons';
import { Popover } from './Popover';
import { EraserPanel, InkPanel, PEN_ICONS, SelectPanel, TextStylePanel } from './ToolPanels';
import type { Prefs, ToolbarItem } from './prefs';

type PanelId = 'pen' | 'highlighter' | 'eraser' | 'select' | 'text' | 'shape';

const SELECT_ICON: Record<InkSettings['selectMode'], IconName> = { lasso: 'lasso', rect: 'selectRect', square: 'selectSquare' };

/**
 * Barre d'outils. Les éléments affichés sont personnalisables (menu Outils → Personnaliser) ;
 * le bouton « Outils » reste toujours visible à droite, même sur un écran étroit, et donne accès
 * à tout ce qui n'est pas dans la barre. La partie centrale défile horizontalement si besoin.
 */
export function Toolbar({
  prefs,
  setPrefs,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  zoomOpen,
  onToggleZoom,
  rulerOn,
  onToggleRuler,
  onOpenTools,
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
  rulerOn?: boolean;
  onToggleRuler?: () => void;
  onOpenTools?: (anchor: HTMLElement) => void;
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
      key={id}
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

  const render = (it: ToolbarItem) => {
    switch (it) {
      case 'pen':
        return tb('pen', PEN_ICONS[styles.penType], TOOL_INFO[styles.penType].label, pen.color);
      case 'highlighter':
        return tb('highlighter', 'highlighter', 'Surligneur', styles.highlighter.color);
      case 'eraser':
        return tb('eraser', 'eraser', 'Gomme');
      case 'select':
        return tb('select', SELECT_ICON[settings.selectMode], 'Sélection');
      case 'text':
        return tb('text', 'text', 'Texte');
      case 'shape':
        return tb('shape', 'shape', 'Formes', pen.color);
      case 'laser':
        return (
          <button key="laser" className={`tool-btn${tool === 'laser' ? ' is-on' : ''}`} aria-pressed={tool === 'laser'} aria-label="Pointeur laser" title="Pointeur laser : trait éphémère, jamais enregistré" onClick={() => setPrefs({ tool: 'laser' })}>
            <Icon name="laser" />
          </button>
        );
      case 'image':
        return (
          <button key="image" className="tool-btn" onClick={onInsertImage} disabled={readOnly} aria-label="Insérer une image" title="Insérer une image">
            <Icon name="image" />
          </button>
        );
      case 'zoom':
        return onToggleZoom ? (
          <button
            key="zoom"
            className={`tool-btn${zoomOpen ? ' is-on' : ''}`}
            onClick={onToggleZoom}
            aria-pressed={!!zoomOpen}
            aria-label="Fenêtre de zoom"
            title={zoomOpen ? 'Fermer la fenêtre de zoom (Z)' : 'Fenêtre de zoom : écrire en grand, le texte s’inscrit à la bonne taille sur la page (Z)'}
          >
            <Icon name="zoomWindow" />
          </button>
        ) : null;
      case 'ruler':
        return onToggleRuler ? (
          <button key="ruler" className={`tool-btn${rulerOn ? ' is-on' : ''}`} onClick={onToggleRuler} aria-pressed={!!rulerOn} aria-label="Règle" title="Règle : tracez le long de son bord pour une droite parfaite">
            <Icon name="ruler" />
          </button>
        ) : null;
      case 'favorites':
        return prefs.favorites.length > 0 ? (
          <div key="favorites" className="tool-group favs" aria-label="Favoris">
            {prefs.favorites.slice(0, 6).map((f) => {
              const active =
                f.tool === 'highlighter' ? tool === 'highlighter' && styles.highlighter.color === f.color && styles.highlighter.width === f.width : tool === 'pen' && styles.penType === f.tool && pen.color === f.color && pen.width === f.width;
              return (
                <button key={f.id} className={`fav-btn${active ? ' is-on' : ''}`} onClick={() => applyFavorite(f)} aria-label={`Favori ${TOOL_INFO[f.tool].label} ${f.color}`} title={`${TOOL_INFO[f.tool].label} · ${f.width}`}>
                  <span
                    className="fav-dot"
                    style={{
                      background: f.color,
                      opacity: f.tool === 'highlighter' ? 0.6 : 1,
                      width: 8 + Math.min(14, f.width * (f.tool === 'highlighter' ? 0.4 : 1.6)),
                      height: 8 + Math.min(14, f.width * (f.tool === 'highlighter' ? 0.4 : 1.6)),
                    }}
                  />
                </button>
              );
            })}
          </div>
        ) : null;
      case 'finger':
        return (
          <button
            key="finger"
            className={`finger-toggle${fingerDraws ? ' is-on' : ''}`}
            onClick={() => setSettings({ fingerMode: fingerDraws ? 'pen-only' : 'finger-and-pen' })}
            aria-pressed={fingerDraws}
            title={fingerDraws ? 'Le doigt écrit (deux doigts pour naviguer). Toucher pour : stylet uniquement.' : 'Stylet uniquement : le doigt navigue. Toucher pour écrire aussi au doigt.'}
          >
            <Icon name={fingerDraws ? 'finger' : 'hand'} size={20} />
            <span>{fingerDraws ? 'Doigt : écrit' : 'Doigt : navigue'}</span>
          </button>
        );
    }
  };

  const undoGroup = (
    <div className="tool-group undo-group">
      <button className="icon-btn" onClick={onUndo} disabled={!canUndo} aria-label="Annuler" title={undoLabel ? `Annuler : ${undoLabel} (⌘Z)` : 'Annuler (⌘Z)'}>
        <Icon name="undo" />
      </button>
      <button className="icon-btn" onClick={onRedo} disabled={!canRedo} aria-label="Rétablir" title={redoLabel ? `Rétablir : ${redoLabel} (⇧⌘Z)` : 'Rétablir (⇧⌘Z)'}>
        <Icon name="redo" />
      </button>
    </div>
  );

  const placement = prefs.toolbar === 'bottom' ? 'above' : 'below';
  const inkPanel = panel === 'pen' || panel === 'highlighter' || panel === 'shape';

  return (
    <div className={`toolbar toolbar-${prefs.toolbar} undo-${prefs.undoPosition}`} role="toolbar" aria-label="Outils d'écriture">
      {prefs.undoPosition === 'left' && (
        <>
          {undoGroup}
          <span className="tool-sep" />
        </>
      )}
      <div className="toolbar-scroll">{prefs.toolbarItems.map(render)}</div>
      <button
        className="tool-btn tools-menu-btn"
        onClick={(e) => onOpenTools?.(e.currentTarget)}
        aria-haspopup="dialog"
        aria-label="Outils"
        title="Outils : texte, notes, images, formes, laser, fenêtre de zoom, règle, minuteur, personnalisation"
      >
        <Icon name="tools" />
      </button>
      {prefs.undoPosition === 'right' && (
        <>
          <span className="tool-sep" />
          {undoGroup}
        </>
      )}

      {inkPanel && (
        <Popover anchor={anchors.current[panel] ?? null} onClose={() => setPanel(null)} label={panel === 'highlighter' ? 'Réglages du surligneur' : 'Réglages du stylo'} width={340} placement={placement}>
          <InkPanel
            tool={panel === 'highlighter' ? 'highlighter' : 'pen'}
            penType={styles.penType}
            ink={panel === 'highlighter' ? styles.highlighter : pen}
            settings={settings}
            favorites={prefs.favorites}
            customColors={prefs.customColors}
            onPenType={(t) => setPrefs((p) => ({ styles: { ...p.styles, penType: t } }))}
            onInk={(ink) =>
              setPrefs((p) =>
                panel === 'highlighter' ? { styles: { ...p.styles, highlighter: ink } } : { styles: { ...p.styles, pens: { ...p.styles.pens, [p.styles.penType]: ink } } },
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
        <Popover anchor={anchors.current.eraser ?? null} onClose={() => setPanel(null)} label="Réglages de la gomme" placement={placement}>
          <EraserPanel settings={settings} onSettings={setSettings} />
        </Popover>
      )}
      {panel === 'select' && (
        <Popover anchor={anchors.current.select ?? null} onClose={() => setPanel(null)} label="Réglages de la sélection" width={340} placement={placement}>
          <SelectPanel settings={settings} onSettings={setSettings} canPaste={canPaste} onPaste={onPaste} onSelectAll={onSelectAll} />
        </Popover>
      )}
      {panel === 'text' && (
        <Popover anchor={anchors.current.text ?? null} onClose={() => setPanel(null)} label="Mise en forme du texte" width={360} placement={placement}>
          <TextStylePanel value={prefs.textStyle} onChange={onTextStyle} customColors={prefs.customColors} onCustomColor={addCustomColor} />
        </Popover>
      )}
    </div>
  );
}
