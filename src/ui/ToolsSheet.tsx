import { useState } from 'react';
import { NOTE_COLORS } from '../ink/items';
import { Sheet, SheetChoice, SheetGroup, SheetItem, SheetSwitch } from './Sheet';
import { DEFAULT_TOOLBAR, TOOLBAR_ITEMS, type Prefs, type ToolbarItem } from './prefs';

/** Personnalisation de la barre d'outils (aussi utilisée depuis le menu « Plus »). */
export function ToolbarCustomizer({ prefs, setPrefs }: { prefs: Prefs; setPrefs: (p: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) => void }) {
  const toggle = (id: ToolbarItem, on: boolean) =>
    setPrefs((p) => {
      const set = new Set(p.toolbarItems);
      if (on) set.add(id);
      else set.delete(id);
      // Ordre stable : celui de la liste de référence.
      return { toolbarItems: TOOLBAR_ITEMS.map((t) => t.id).filter((t) => set.has(t)) };
    });
  return (
    <>
      <SheetGroup title="Éléments de la barre d'outils">
        {TOOLBAR_ITEMS.map((t) => (
          <SheetSwitch key={t.id} label={t.label} checked={prefs.toolbarItems.includes(t.id)} onChange={(v) => toggle(t.id, v)} />
        ))}
      </SheetGroup>
      <SheetGroup>
        <SheetChoice
          label="Position d'annulation et de rétablissement"
          value={prefs.undoPosition}
          options={[
            ['left', 'Gauche'],
            ['right', 'Droite'],
          ]}
          onChange={(v) => setPrefs({ undoPosition: v })}
        />
        <SheetItem label="Rétablir la barre par défaut" onClick={() => setPrefs({ toolbarItems: DEFAULT_TOOLBAR, undoPosition: 'left' })} />
      </SheetGroup>
      <p className="small muted sheet-note">Les éléments retirés de la barre restent disponibles dans ce menu « Outils ».</p>
    </>
  );
}

/**
 * Menu « Outils » (équivalent du menu Outils de Goodnotes) : toujours accessible, même quand
 * la barre d'outils ne peut pas tout afficher (téléphone, iPad en Split View).
 */
export function ToolsSheet({
  prefs,
  setPrefs,
  zoomOpen,
  rulerOn,
  timerOn,
  readOnly,
  onToggleZoom,
  onToggleRuler,
  onToggleTimer,
  onInsertImage,
  onNote,
  onClose,
}: {
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) => void;
  zoomOpen: boolean;
  rulerOn: boolean;
  timerOn: boolean;
  readOnly: boolean;
  onToggleZoom: () => void;
  onToggleRuler: () => void;
  onToggleTimer: () => void;
  onInsertImage: () => void;
  onNote: (color: string) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<'main' | 'customize'>('main');
  const pick = (fn: () => void) => () => {
    fn();
    onClose();
  };
  if (view === 'customize') {
    return (
      <Sheet title="Personnalisation de la barre d'outils" onClose={onClose} onBack={() => setView('main')}>
        <ToolbarCustomizer prefs={prefs} setPrefs={setPrefs} />
      </Sheet>
    );
  }
  const fingerDraws = prefs.settings.fingerMode === 'finger-and-pen';
  return (
    <Sheet title="Outils" onClose={onClose}>
      <SheetGroup>
        <SheetItem icon="text" label="Texte" detail="Toucher la page pour écrire au clavier" pressed={prefs.tool === 'text'} onClick={pick(() => setPrefs({ tool: 'text' }))} />
        <div className="sheet-item sheet-notes">
          <span className="sheet-item-text">
            <span>Notes repositionnables</span>
            <small className="muted">Choisir une couleur : la note apparaît au centre de la page</small>
          </span>
          <div className="note-colors">
            {NOTE_COLORS.map((c) => (
              <button key={c} className="note-swatch" style={{ background: c }} disabled={readOnly} aria-label={`Note ${c}`} onClick={pick(() => onNote(c))} />
            ))}
          </div>
        </div>
        <SheetItem icon="image" label="Images" detail="Photo ou image de l'appareil" disabled={readOnly} onClick={pick(onInsertImage)} />
        <SheetItem icon="shape" label="Formes" detail="Chaque tracé devient une droite, un cercle, une ellipse ou un rectangle nets" pressed={prefs.tool === 'shape'} onClick={pick(() => setPrefs({ tool: 'shape' }))} />
        <SheetItem icon="laser" label="Pointeur laser" detail="Trait lumineux éphémère, jamais enregistré" pressed={prefs.tool === 'laser'} onClick={pick(() => setPrefs({ tool: 'laser' }))} />
      </SheetGroup>
      <SheetGroup title="Accessoires">
        <SheetItem icon="zoomWindow" label="Fenêtre de zoom" detail={zoomOpen ? 'Ouverte — toucher pour fermer' : 'Écrire en grand ; le texte s’inscrit à la bonne taille'} pressed={zoomOpen} onClick={pick(onToggleZoom)} />
        <SheetItem icon="ruler" label="Règle" detail={rulerOn ? 'Affichée — toucher pour masquer' : 'Tracez le long de son bord ; deux doigts pour la faire pivoter'} pressed={rulerOn} onClick={pick(onToggleRuler)} />
        <SheetItem icon="timer" label="Minuteur" detail={timerOn ? 'Affiché — toucher pour masquer' : 'Chronomètre et compte à rebours'} pressed={timerOn} onClick={pick(onToggleTimer)} />
        <SheetItem
          icon={fingerDraws ? 'finger' : 'hand'}
          label={fingerDraws ? 'Doigt : écrit' : 'Doigt : navigue'}
          detail={fingerDraws ? 'Toucher pour : stylet uniquement (le doigt navigue)' : 'Toucher pour écrire aussi au doigt'}
          onClick={() => setPrefs((p) => ({ settings: { ...p.settings, fingerMode: fingerDraws ? 'pen-only' : 'finger-and-pen' } }))}
        />
      </SheetGroup>
      <SheetGroup>
        <SheetItem icon="settings" label="Personnalisation de la barre d'outils" chevron onClick={() => setView('customize')} />
      </SheetGroup>
    </Sheet>
  );
}
