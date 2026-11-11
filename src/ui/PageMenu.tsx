import { useMemo, useState } from 'react';
import type { ElementKind, InkEngine } from '../ink/engine';
import { PAPER_COLOR_LABELS, PAPER_KINDS } from '../ink/paper';
import type { NotebookSession } from '../model/session';
import type { PaperSpec } from '../model/types';
import { PaperThumb } from './Cover';
import { Sheet, SheetChoice, SheetGroup, SheetItem, SheetSwitch } from './Sheet';
import { ToolbarCustomizer } from './ToolsSheet';
import type { Prefs } from './prefs';

const KIND_LABELS: { id: ElementKind; label: string }[] = [
  { id: 'ink', label: 'Stylos' },
  { id: 'pencil', label: 'Crayon' },
  { id: 'highlighter', label: 'Surligneur' },
  { id: 'text', label: 'Texte' },
  { id: 'note', label: 'Notes repositionnables' },
  { id: 'image', label: 'Images' },
];

type View = 'main' | 'template' | 'remove' | 'clear' | 'goto' | 'outline' | 'doc';

/**
 * Menu « Plus » de la page (équivalent du menu Plus de Goodnotes) : actions sur la page courante,
 * sur le carnet, et réglages d'édition. Seules des actions réellement disponibles y figurent.
 */
export function PageMenu({
  engine,
  session,
  prefs,
  setPrefs,
  pageIndex,
  pageCount,
  readOnly,
  fullscreenActive,
  wakeLockSupported,
  onToggleBookmark,
  onSetOutline,
  onDuplicate,
  onTemplate,
  onGoTo,
  onDeletePage,
  onAddPage,
  onShowPages,
  onExport,
  onFullscreen,
  onFocus,
  onSettings,
  onClose,
}: {
  engine: InkEngine;
  session: NotebookSession;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) => void;
  pageIndex: number;
  pageCount: number;
  readOnly: boolean;
  fullscreenActive: boolean;
  wakeLockSupported: boolean;
  onToggleBookmark: (pageId: string) => void;
  onSetOutline: (pageId: string, title: string | null) => void;
  onDuplicate: (pageId: string) => void;
  onTemplate: (pageIds: string[], paper: PaperSpec) => void;
  onGoTo: (index: number) => void;
  onDeletePage: (pageId: string) => void;
  onAddPage: () => void;
  onShowPages: () => void;
  onExport: () => void;
  onFullscreen: () => void;
  onFocus: () => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>('main');
  const page = session.pageOrder[pageIndex];
  const nb = session.notebook;
  const bookmarked = !!page && (nb.bookmarks ?? []).includes(page.id);
  const outlineEntry = page ? (nb.outline ?? []).find((o) => o.pageId === page.id) : undefined;
  const settings = prefs.settings;
  const setSettings = (p: Partial<typeof settings>) => setPrefs((x) => ({ settings: { ...x.settings, ...p } }));
  const back = () => setView('main');
  const done = (fn: () => void) => () => {
    fn();
    onClose();
  };

  // ---------- Sous-vues ----------
  const [paper, setPaper] = useState<PaperSpec>(() => ({ ...(page?.paper ?? nb.paper) }));
  const [kinds, setKinds] = useState<Set<ElementKind>>(new Set());
  const counts = useMemo(() => (page && session.isLoaded(page.id) ? engine.countKinds(page.id) : null), [engine, session, page, view]);
  const [goto, setGoto] = useState(String(pageIndex + 1));
  const [title, setTitle] = useState(outlineEntry?.title ?? `Page ${pageIndex + 1}`);

  if (!page) return null;

  if (view === 'template') {
    return (
      <Sheet title="Changer de modèle" onClose={onClose} onBack={back}>
        <div className="template-grid" role="radiogroup" aria-label="Modèle de papier">
          {PAPER_KINDS.map((k) => (
            <button key={k.id} role="radio" aria-checked={paper.kind === k.id} className={`template${paper.kind === k.id ? ' is-on' : ''}`} onClick={() => setPaper({ ...paper, kind: k.id })}>
              <PaperThumb paper={{ ...paper, kind: k.id }} width={page.width} height={page.height} size={72} />
              <span>{k.label}</span>
            </button>
          ))}
        </div>
        <SheetGroup>
          <SheetChoice label="Couleur du papier" value={paper.color} options={PAPER_COLOR_LABELS.map((c) => [c.id, c.label] as [typeof c.id, string])} onChange={(color) => setPaper({ ...paper, color })} />
          <label className="sheet-item">
            <span className="sheet-item-text">
              <span>Espacement des lignes</span>
            </span>
            <input type="range" min={20} max={48} step={2} value={paper.spacing} onChange={(e) => setPaper({ ...paper, spacing: Number(e.target.value) })} aria-label="Espacement des lignes" />
          </label>
        </SheetGroup>
        <div className="sheet-actions">
          <button className="btn" disabled={readOnly} onClick={done(() => onTemplate(session.notebook.pageIds, paper))}>
            Toutes les pages
          </button>
          <button className="btn btn-primary" disabled={readOnly} onClick={done(() => onTemplate([page.id], paper))}>
            Cette page
          </button>
        </div>
        <p className="small muted sheet-note">L'écriture n'est pas modifiée : seul le papier change.</p>
      </Sheet>
    );
  }

  if (view === 'remove') {
    const total = KIND_LABELS.reduce((n, k) => n + (kinds.has(k.id) ? (counts?.[k.id] ?? 0) : 0), 0);
    return (
      <Sheet title="Supprimer certains éléments" onClose={onClose} onBack={back}>
        <SheetGroup title="Types d'éléments de la page">
          {KIND_LABELS.map((k) => (
            <SheetSwitch
              key={k.id}
              label={k.label}
              detail={counts ? `${counts[k.id]} sur cette page` : undefined}
              checked={kinds.has(k.id)}
              onChange={(v) =>
                setKinds((s) => {
                  const n = new Set(s);
                  if (v) n.add(k.id);
                  else n.delete(k.id);
                  return n;
                })
              }
            />
          ))}
        </SheetGroup>
        <div className="sheet-actions">
          <button className="btn" onClick={() => setKinds(new Set(KIND_LABELS.map((k) => k.id)))}>
            Tout sélectionner
          </button>
          <button
            className="btn btn-danger"
            disabled={readOnly || total === 0}
            onClick={done(() => {
              engine.removeKinds(page.id, Array.from(kinds));
            })}
          >
            Supprimer les éléments de la page{total ? ` (${total})` : ''}
          </button>
        </div>
        <p className="small muted sheet-note">Une seule action : « Annuler » les restaure.</p>
      </Sheet>
    );
  }

  if (view === 'clear') {
    return (
      <Sheet title="Effacer la page" onClose={onClose} onBack={back}>
        <p className="sheet-note">Tout le contenu de la page {pageIndex + 1} sera effacé (écriture, texte, notes, images). La page reste dans le carnet. « Annuler » restaure tout.</p>
        <div className="sheet-actions">
          <button className="btn" onClick={back}>
            Garder
          </button>
          <button className="btn btn-danger" disabled={readOnly} onClick={done(() => engine.clearPage(page.id))}>
            Effacer la page
          </button>
        </div>
      </Sheet>
    );
  }

  if (view === 'goto') {
    const n = Number(goto);
    const ok = Number.isInteger(n) && n >= 1 && n <= pageCount;
    return (
      <Sheet title="Accéder à la page" onClose={onClose} onBack={back}>
        <form
          className="sheet-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) done(() => onGoTo(n - 1))();
          }}
        >
          <label className="small" htmlFor="goto-page">
            Numéro de page (1 – {pageCount})
          </label>
          <div className="row">
            <input id="goto-page" type="number" inputMode="numeric" min={1} max={pageCount} value={goto} onChange={(e) => setGoto(e.target.value)} autoFocus />
            <button className="btn btn-primary" type="submit" disabled={!ok}>
              Aller
            </button>
          </div>
        </form>
      </Sheet>
    );
  }

  if (view === 'outline') {
    return (
      <Sheet title={outlineEntry ? 'Plan : renommer' : 'Ajouter la page au plan'} onClose={onClose} onBack={back}>
        <form
          className="sheet-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) done(() => onSetOutline(page.id, title.trim()))();
          }}
        >
          <label className="small" htmlFor="outline-title">
            Titre dans le plan
          </label>
          <div className="row">
            <input id="outline-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} autoFocus />
            <button className="btn btn-primary" type="submit" disabled={!title.trim() || readOnly}>
              Enregistrer
            </button>
          </div>
        </form>
        {outlineEntry && (
          <div className="sheet-actions">
            <button className="btn btn-danger" disabled={readOnly} onClick={done(() => onSetOutline(page.id, null))}>
              Retirer du plan
            </button>
          </div>
        )}
        <p className="small muted sheet-note">Le plan est visible dans le panneau des pages (onglet « Plan »).</p>
      </Sheet>
    );
  }

  if (view === 'doc') {
    return (
      <Sheet title="Modification des documents" onClose={onClose} onBack={back}>
        <SheetGroup title="Modification des documents">
          <SheetSwitch
            label="Garder l'écran allumé"
            detail={wakeLockSupported ? "Empêche la mise en veille automatique pendant qu'un carnet est ouvert" : 'Non pris en charge par ce navigateur'}
            checked={prefs.keepAwake}
            disabled={!wakeLockSupported}
            onChange={(v) => setPrefs({ keepAwake: v })}
          />
          <SheetSwitch label="Tirer pour ajouter une page" detail="Balayer au-delà de la dernière page en ajoute une (navigation horizontale)" checked={settings.pullToAddPage} onChange={(v) => setSettings({ pullToAddPage: v })} />
          <SheetSwitch label="Afficher le numéro de page" checked={prefs.showPageNumber} onChange={(v) => setPrefs({ showPageNumber: v })} />
          <SheetChoice
            label="Sens de défilement"
            value={settings.pageLayout}
            options={[
              ['horizontal', 'Horizontal'],
              ['vertical', 'Vertical'],
            ]}
            onChange={(v) => setSettings({ pageLayout: v })}
          />
          <SheetSwitch label="Afficher l'aperçu du trait au survol" detail="Stylet qui survole l'écran (selon le modèle) ou souris" checked={settings.hoverPreview} onChange={(v) => setSettings({ hoverPreview: v })} />
        </SheetGroup>
        <SheetGroup title="Fenêtre de zoom">
          <SheetSwitch label="Avance automatique" checked={settings.zoomAutoAdvance} onChange={(v) => setSettings({ zoomAutoAdvance: v })} />
        </SheetGroup>
        <ToolbarCustomizer prefs={prefs} setPrefs={setPrefs} />
      </Sheet>
    );
  }

  // ---------- Menu principal ----------
  return (
    <Sheet title="Plus" onClose={onClose}>
      <SheetGroup title={`Page ${pageIndex + 1} sur ${pageCount}`}>
        <SheetItem icon="bookmark" label={bookmarked ? 'Retirer des favoris' : 'Ajouter aux favoris'} disabled={readOnly} onClick={done(() => onToggleBookmark(page.id))} />
        <SheetItem icon="duplicate" label="Copier la page" detail="Ajoute une copie juste après" disabled={readOnly} onClick={done(() => onDuplicate(page.id))} />
        <SheetItem icon="outline" label={outlineEntry ? `Plan : « ${outlineEntry.title} »` : 'Ajouter la page au plan'} chevron disabled={readOnly} onClick={() => setView('outline')} />
        <SheetItem icon="palette" label="Changer de modèle" chevron disabled={readOnly} onClick={() => setView('template')} />
        <SheetItem icon="goPage" label="Accéder à la page" right={<span className="muted small">(1 – {pageCount})</span>} chevron onClick={() => setView('goto')} />
      </SheetGroup>
      <SheetGroup title="Vider ou supprimer la page">
        <SheetItem icon="someItems" label="Supprimer certains éléments" chevron disabled={readOnly} onClick={() => setView('remove')} />
        <SheetItem icon="clearPage" label="Effacer la page" danger disabled={readOnly} onClick={() => setView('clear')} />
        <SheetItem icon="trash" label="Supprimer la page" danger disabled={readOnly || pageCount <= 1} onClick={done(() => onDeletePage(page.id))} />
      </SheetGroup>
      <SheetGroup title="Carnet">
        <SheetItem icon="plus" label="Ajouter une page après celle-ci" disabled={readOnly} onClick={done(onAddPage)} />
        <SheetItem icon="pages" label="Pages, favoris et plan" onClick={done(onShowPages)} />
        <SheetItem icon="download" label="Exporter une sauvegarde" detail="Fichier .calame, à garder dans Fichiers ou iCloud Drive" onClick={done(onExport)} />
      </SheetGroup>
      <SheetGroup title="Affichage">
        <SheetItem icon={fullscreenActive ? 'exitFullscreen' : 'fullscreen'} label={fullscreenActive ? 'Quitter le plein écran' : 'Plein écran'} onClick={done(onFullscreen)} />
        <SheetItem icon="focus" label="Mode concentration" detail="Masque la barre du carnet (touche F)" onClick={done(onFocus)} />
      </SheetGroup>
      <SheetGroup title="Alignement des objets">
        <SheetSwitch icon="grid" label="Aligner les objets" detail="Aimante une sélection déplacée sur le centre de la page et les autres éléments" checked={settings.alignObjects} onChange={(v) => setSettings({ alignObjects: v })} />
      </SheetGroup>
      <SheetGroup title="Réglages">
        <SheetChoice
          icon="layoutH"
          label="Sens de défilement"
          value={settings.pageLayout}
          options={[
            ['horizontal', 'Horizontal'],
            ['vertical', 'Vertical'],
          ]}
          onChange={(v) => setSettings({ pageLayout: v })}
        />
        <SheetChoice
          icon="sidebar"
          label="Barre latérale"
          value={prefs.sidebarSide}
          options={[
            ['left', 'Gauche'],
            ['right', 'Droite'],
          ]}
          onChange={(v) => setPrefs({ sidebarSide: v })}
        />
        <SheetItem icon="settings" label="Modification des documents" chevron onClick={() => setView('doc')} />
        <SheetItem icon="more" label="Tous les réglages" onClick={done(onSettings)} />
      </SheetGroup>
      <p className="small muted sheet-note">
        Pas de partage ni de collaboration en ligne : Calame n'a volontairement aucun serveur, vos notes restent sur cet appareil. Pour transmettre un carnet, exportez une
        sauvegarde.
      </p>
    </Sheet>
  );
}
