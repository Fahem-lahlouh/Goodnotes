import { useCallback, useEffect, useRef, useState } from 'react';
import { InkEngine, type PerfStats, type SelectionInfo, type TextEditRequest, type ViewInfo, type ZoomState } from '../ink/engine';
import { prepareImage, primeImage, setBlobLoader, onImageReady } from '../ink/items';
import { PALETTE } from '../ink/settings';
import { newId } from '../model/ids';
import { coverColor, type TextItem } from '../model/types';
import { broadcast, openNotebook, saveQueue, type LockState, type OpenedNotebook } from '../storage/openNotebook';
import { repo } from '../storage/repo';
import type { SaveState } from '../storage/saveQueue';
import { BACKUP_STALE_DAYS, backupAgeDays, backupLabel, exportFullBackup, useLastBackup } from './backupStatus';
import { useFullscreen } from './fullscreen';
import { Icon } from './icons';
import { Confirm } from './Modal';
import { PagesPanel } from './PagesPanel';
import { Popover } from './Popover';
import { SettingsPanel } from './SettingsPanel';
import { TextEditor } from './TextEditor';
import { Toolbar } from './Toolbar';
import { toast } from './Toast';
import { ZoomPanel } from './ZoomPanel';
import { ConvertDialog } from './ConvertDialog';
import { getPrefs, loadView, saveView, setPrefs as setPrefsGlobal, usePrefs } from './prefs';

declare global {
  interface Window {
    /** Point d'accès de diagnostic utilisé par les tests de bout en bout (aucune donnée envoyée). */
    __calame?: { engine: InkEngine; session: OpenedNotebook['session'] };
  }
}

setBlobLoader((id) => repo.getBlob(id));

export function Editor({ notebookId, onClose }: { notebookId: string; onClose: () => void }) {
  const [opened, setOpened] = useState<OpenedNotebook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lock, setLock] = useState<LockState>('unsupported');
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<InkEngine | null>(null);
  const [engine, setEngine] = useState<InkEngine | null>(null);
  const [prefs, setPrefs] = usePrefs();
  const [view, setView] = useState<ViewInfo>({ scale: 1, pageIndex: 0, pageCount: 1, fitScale: 1, layout: 'horizontal' });
  const [sel, setSel] = useState<SelectionInfo | null>(null);
  const [hist, setHist] = useState({ canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' });
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoom, setZoom] = useState<ZoomState | null>(null);
  const [shapeHint, setShapeHint] = useState<string | null>(null);
  const [convert, setConvert] = useState(false);
  const zoomHostRef = useRef<HTMLDivElement>(null);
  /** Dernier grossissement connu des préférences : distingue un réglage (curseur) d'un écho du moteur. */
  const zoomSynced = useRef<number | null>(null);
  const [save, setSave] = useState<SaveState>(saveQueue.state);
  const [showPages, setShowPages] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [focus, setFocus] = useState(false);
  const [perf, setPerf] = useState<PerfStats | null>(null);
  const [version, setVersion] = useState(0);
  const [deletePage, setDeletePage] = useState<string | null>(null);
  const [textEdit, setTextEdit] = useState<TextEditRequest | null>(null);
  const [penPrompt, setPenPrompt] = useState(false);
  const [fsHelp, setFsHelp] = useState<HTMLElement | null>(null);
  const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fs = useFullscreen();

  // ---------- Ouverture du carnet ----------
  useEffect(() => {
    let alive = true;
    let current: OpenedNotebook | null = null;
    openNotebook(notebookId)
      .then((o) => {
        if (!alive) {
          void o?.close();
          return;
        }
        if (!o) {
          setError('Ce carnet est introuvable sur cet appareil.');
          return;
        }
        current = o;
        setLock(o.lock);
        setOpened(o);
      })
      .catch((e) => setError(`Ouverture impossible : ${(e as Error).message}`));
    return () => {
      alive = false;
      void current?.close();
    };
  }, [notebookId]);

  useEffect(() => {
    if (!opened) return;
    const s = opened.session;
    // Le bouton reste actif pendant un geste en cours (gomme…) : l'annulation termine d'abord
    // proprement un geste dont la fin aurait été perdue, au lieu de rester grisée.
    const syncHist = () => {
      const h = s.historySize;
      setHist({
        canUndo: !s.readOnly && (h.undo > 0 || s.inBatch),
        canRedo: !s.readOnly && h.redo > 0,
        undoLabel: s.peekUndo()?.label ?? '',
        redoLabel: s.peekRedo()?.label ?? '',
      });
    };
    syncHist();
    const offs = [
      opened.onLockChange((l) => {
        setLock(l);
        if (l === 'readonly') toast('Ce carnet a été repris dans un autre onglet : lecture seule ici.');
      }),
      opened.onStructureChange(() => {
        engineRef.current?.relayout();
        setVersion((v) => v + 1);
      }),
      s.onHistory(syncHist),
    ];
    let t = 0;
    offs.push(
      s.onChange(() => {
        clearTimeout(t);
        t = window.setTimeout(() => setVersion((v) => v + 1), 500);
      }),
    );
    return () => offs.forEach((f) => f());
  }, [opened]);

  useEffect(() => saveQueue.subscribe(setSave), []);

  // ---------- Moteur d'encre ----------
  useEffect(() => {
    const host = hostRef.current;
    if (!opened || !host) return;
    const p = getPrefs();
    const saved = loadView(notebookId);
    const eng = new InkEngine(
      host,
      opened.session,
      {
        onView: setView,
        onSelection: setSel,
        onPenDetected: () => {
          setPrefsGlobal({ penDetected: true });
          if (getPrefs().settings.fingerMode === 'finger-and-pen') setPenPrompt(true);
        },
        onPerf: setPerf,
        onTextEdit: (req) => setTextEdit(req),
        onToolRequest: (tool) => setPrefsGlobal({ tool }),
        onNotice: (m) => toast(m),
        onShapeHint: setShapeHint,
        onShapeCommitted: (c) => {
          setShapeHint(null);
          toast(`${c.label} : forme nette`, 'info', {
            action: {
              label: 'Garder le tracé libre',
              run: () => {
                if (!engineRef.current?.revertShape(c)) toast('Ce tracé a déjà été modifié.');
              },
            },
          });
        },
        onZoom: setZoom,
      },
      { layout: p.settings.pageLayout, pageIndex: saved?.page ?? 0 },
    );
    eng.penDetected = p.penDetected;
    eng.setSettings(p.settings);
    eng.setStyles(p.styles);
    eng.setTool(p.tool);
    eng.setTextStyle(p.textStyle);
    if (saved) eng.restoreView(saved);
    engineRef.current = eng;
    setEngine(eng);
    window.__calame = { engine: eng, session: opened.session };
    const offImg = onImageReady(() => eng.relayout());
    const persistView = () => saveView(notebookId, eng.savedView());
    const iv = window.setInterval(persistView, 2000);
    const hide = () => {
      if (document.visibilityState === 'hidden') persistView();
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      persistView();
      offImg();
      clearInterval(iv);
      document.removeEventListener('visibilitychange', hide);
      eng.destroy();
      engineRef.current = null;
      setEngine(null);
      if (window.__calame?.engine === eng) delete window.__calame;
    };
  }, [opened, notebookId]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    // Le grossissement de la fenêtre de zoom est piloté par le moteur (pincement, boutons) :
    // on garde sa valeur courante pour ne pas revenir en arrière pendant un geste.
    const ext = prefs.settings.zoomFactor;
    const fromPrefs = zoomSynced.current === null || Math.abs(ext - zoomSynced.current) > 1e-3;
    zoomSynced.current = ext;
    e.setSettings({ ...prefs.settings, zoomFactor: fromPrefs ? ext : e.settings.zoomFactor });
    e.setStyles(prefs.styles);
    e.setTool(prefs.tool);
    e.setTextStyle(prefs.textStyle);
    e.penDetected = prefs.penDetected;
  }, [prefs.settings, prefs.styles, prefs.tool, prefs.textStyle, prefs.penDetected, engine]);

  // Couleur du « bureau » derrière les pages, selon le thème.
  useEffect(() => {
    const apply = () => {
      const c = getComputedStyle(document.documentElement).getPropertyValue('--desk').trim();
      if (c) engineRef.current?.setDeskColor(c);
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    const id = requestAnimationFrame(apply);
    return () => {
      mq.removeEventListener('change', apply);
      cancelAnimationFrame(id);
    };
  }, [prefs.theme, engine]);

  useEffect(() => {
    engineRef.current?.setEditing(textEdit?.mode === 'edit' ? textEdit.item.id : null);
  }, [textEdit]);

  // ---------- Fenêtre de zoom ----------
  useEffect(() => {
    const eng = engine;
    const host = zoomHostRef.current;
    if (!eng || !zoomOpen || !host) return;
    eng.openZoom(host);
    return () => eng.closeZoom();
  }, [engine, zoomOpen]);

  // Grossissement mémorisé (après stabilisation, pour ne pas écrire les préférences à chaque frame).
  useEffect(() => {
    if (!zoom?.open) return;
    const f = zoom.factor;
    const t = window.setTimeout(() => {
      if (Math.abs(getPrefs().settings.zoomFactor - f) > 1e-3) {
        zoomSynced.current = f;
        setPrefsGlobal((p) => ({ settings: { ...p.settings, zoomFactor: f } }));
      }
    }, 500);
    return () => clearTimeout(t);
  }, [zoom?.open, zoom?.factor]);

  useEffect(() => {
    if (!shapeHint) return;
    const t = window.setTimeout(() => setShapeHint(null), 4000);
    return () => clearTimeout(t);
  }, [shapeHint]);

  // ---------- Actions ----------
  const undo = useCallback(() => {
    if (textEdit) (document.activeElement as HTMLElement | null)?.blur?.();
    engineRef.current?.undo();
  }, [textEdit]);
  const redo = useCallback(() => engineRef.current?.redo(), []);

  const structureChanged = useCallback(() => {
    engineRef.current?.relayout();
    setVersion((v) => v + 1);
    broadcast({ type: 'structure', notebookId });
  }, [notebookId]);

  const pageOp = useCallback(
    async (fn: () => Promise<void>) => {
      if (!opened || opened.session.readOnly) return;
      try {
        await saveQueue.flush();
        await fn();
        structureChanged();
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    },
    [opened, structureChanged],
  );

  const addPage = useCallback(
    (index: number) =>
      pageOp(async () => {
        const s = opened!.session;
        const ref = s.pageOrder[Math.max(0, index - 1)];
        const page = await repo.insertPage(notebookId, index, ref?.paper ?? s.notebook.paper, ref ? { width: ref.width, height: ref.height } : undefined);
        s.addPage(page);
        const ids = s.notebook.pageIds.slice();
        ids.splice(index, 0, page.id);
        s.setNotebook({ ...s.notebook, pageIds: ids });
        engineRef.current?.relayout();
        engineRef.current?.goToPage(index);
      }),
    [opened, notebookId, pageOp],
  );

  const duplicatePage = useCallback(
    (pageId: string) =>
      pageOp(async () => {
        const s = opened!.session;
        const { page, strokes, items } = await repo.duplicatePage(notebookId, pageId);
        s.addPage(page, { strokes, items });
        const ids = s.notebook.pageIds.slice();
        ids.splice(ids.indexOf(pageId) + 1, 0, page.id);
        s.setNotebook({ ...s.notebook, pageIds: ids });
      }),
    [opened, notebookId, pageOp],
  );

  const removePage = useCallback(
    (pageId: string) =>
      pageOp(async () => {
        const s = opened!.session;
        await repo.deletePage(notebookId, pageId);
        s.removePage(pageId);
        s.setNotebook({ ...s.notebook, pageIds: s.notebook.pageIds.filter((p) => p !== pageId) });
      }),
    [opened, notebookId, pageOp],
  );

  const movePage = useCallback(
    (pageId: string, to: number) =>
      pageOp(async () => {
        const n = await repo.movePage(notebookId, pageId, to);
        opened!.session.setNotebook({ ...opened!.session.notebook, pageIds: n.pageIds });
      }),
    [opened, notebookId, pageOp],
  );

  const insertImage = useCallback(async (file: File) => {
    try {
      const img = await prepareImage(file);
      const id = newId();
      await repo.putBlob({ id, mime: img.mime, data: img.data, createdAt: Date.now() });
      primeImage(id, img.decoded);
      if (!engineRef.current?.insertImage(id, img.mime, img.width, img.height)) toast("Impossible d'insérer l'image ici.", 'error');
    } catch (e) {
      toast(`Image illisible : ${(e as Error).message}`, 'error');
    }
  }, []);

  const toggleFullscreen = useCallback(
    async (anchor: HTMLElement | null) => {
      if (!fs.supported) {
        setFsHelp(anchor);
        return;
      }
      if (!(await fs.toggle())) setFsHelp(anchor);
    },
    [fs],
  );

  // ---------- Raccourcis clavier ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const eng = engineRef.current;
      if (!eng) return;
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && k === 'd' && eng.hasSelection()) {
        e.preventDefault();
        eng.duplicateSelection();
      } else if (mod && k === 'c' && eng.hasSelection()) {
        e.preventDefault();
        eng.copySelection();
        toast('Sélection copiée');
      } else if (mod && k === 'x' && eng.hasSelection()) {
        e.preventDefault();
        eng.cutSelection();
      } else if (mod && k === 'v') {
        e.preventDefault();
        eng.paste();
      } else if (mod && k === 'a') {
        e.preventDefault();
        eng.selectAll();
      } else if (mod && (k === '=' || k === '+')) {
        e.preventDefault();
        eng.zoomBy(1.25);
      } else if (mod && k === '-') {
        e.preventDefault();
        eng.zoomBy(0.8);
      } else if (mod && k === '0') {
        e.preventDefault();
        eng.fitWidth();
      } else if (mod) {
        return;
      } else if ((k === 'delete' || k === 'backspace') && eng.hasSelection()) {
        e.preventDefault();
        eng.deleteSelection();
      } else if (k === 'escape') {
        if (eng.hasSelection()) eng.clearSelection();
        else if (zoomOpen) setZoomOpen(false);
        else if (focus) setFocus(false);
      } else if (k === 'arrowright' || k === 'pagedown') {
        e.preventDefault();
        eng.nextPage();
      } else if (k === 'arrowleft' || k === 'pageup') {
        e.preventDefault();
        eng.prevPage();
      } else if (k === 'p') setPrefs({ tool: 'pen' });
      else if (k === 'h') setPrefs({ tool: 'highlighter' });
      else if (k === 'e') setPrefs({ tool: 'eraser' });
      else if (k === 'l' || k === 's') setPrefs({ tool: 'select' });
      else if (k === 't') setPrefs({ tool: 'text' });
      else if (k === 'f') setFocus((f) => !f);
      else if (k === 'z') setZoomOpen((z) => !z);
      else if (k === 'enter' && zoomOpen) {
        e.preventDefault();
        eng.zoomNewline();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, setPrefs, focus, zoomOpen]);

  // ---------- Rendu ----------
  if (error) {
    return (
      <div className="editor-error">
        <Icon name="alert" size={28} />
        <p>{error}</p>
        <button className="btn btn-primary" onClick={onClose}>
          Retour à la bibliothèque
        </button>
      </div>
    );
  }

  const nb = opened?.session.notebook;
  const readOnly = lock === 'readonly';
  const pageNav = (
    <div className="page-nav" role="group" aria-label="Navigation entre les pages">
      <button className="icon-btn" onClick={() => engineRef.current?.prevPage()} disabled={view.pageIndex <= 0} aria-label="Page précédente" title="Page précédente (←)">
        <Icon name="chevronLeft" />
      </button>
      <button className="page-count" onClick={() => setShowPages((s) => !s)} aria-label={`Page ${view.pageIndex + 1} sur ${view.pageCount}. Afficher les miniatures`}>
        {view.pageIndex + 1} <span className="muted">/ {view.pageCount}</span>
      </button>
      <button className="icon-btn" onClick={() => engineRef.current?.nextPage()} disabled={view.pageIndex >= view.pageCount - 1} aria-label="Page suivante" title="Page suivante (→)">
        <Icon name="chevronRight" />
      </button>
    </div>
  );

  return (
    <div className={`editor${focus ? ' is-focus' : ''} toolbar-at-${prefs.toolbar}`}>
      {!focus && (
        <header className="topbar safe-top">
          <div className="topbar-left">
            <button className="icon-btn" onClick={onClose} aria-label="Retour à la bibliothèque" title="Bibliothèque">
              <Icon name="back" />
            </button>
            <span className="nb-dot" style={{ background: coverColor(nb?.cover ?? 'nuit') }} />
            <h1 className="nb-name" title={nb?.title}>
              {nb?.title ?? 'Chargement…'}
            </h1>
          </div>
          <div className="topbar-center">{pageNav}</div>
          <div className="topbar-right">
            <SaveIndicator state={save} />
            <BackupChip />
            <button className="icon-btn" onClick={() => addPage(view.pageIndex + 1)} disabled={readOnly} aria-label="Ajouter une page après celle-ci" title="Nouvelle page">
              <Icon name="plus" />
            </button>
            <button className={`icon-btn${showPages ? ' is-on' : ''}`} onClick={() => setShowPages((s) => !s)} aria-pressed={showPages} aria-label="Miniatures des pages" title="Miniatures">
              <Icon name="pages" />
            </button>
            <button className="icon-btn" onClick={() => setFocus(true)} aria-label="Mode concentration" title="Mode concentration (F) : masque cette barre">
              <Icon name="focus" />
            </button>
            <button
              className={`icon-btn${fs.active ? ' is-on' : ''}`}
              onClick={(e) => void toggleFullscreen(e.currentTarget)}
              aria-pressed={fs.active}
              aria-label={fs.active ? 'Quitter le plein écran' : 'Plein écran'}
              title={fs.active ? 'Quitter le plein écran (Échap)' : 'Plein écran : masque l’interface du navigateur'}
            >
              <Icon name={fs.active ? 'exitFullscreen' : 'fullscreen'} />
            </button>
            <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Réglages" title="Réglages">
              <Icon name="settings" />
            </button>
          </div>
        </header>
      )}

      {readOnly && (
        <div className="readonly-banner" role="status">
          <span>Ce carnet est ouvert pour écriture dans un autre onglet. Ici : lecture seule.</span>
          <button className="btn btn-small btn-primary" onClick={() => void opened?.takeOver()}>
            Écrire ici
          </button>
        </div>
      )}

      <div className="editor-body">
        <Toolbar
          prefs={prefs}
          setPrefs={setPrefs}
          canUndo={hist.canUndo}
          canRedo={hist.canRedo}
          undoLabel={hist.undoLabel}
          redoLabel={hist.redoLabel}
          zoomOpen={zoomOpen}
          onToggleZoom={() => setZoomOpen((z) => !z)}
          onUndo={undo}
          onRedo={redo}
          onInsertImage={() => fileRef.current?.click()}
          onPaste={() => engineRef.current?.paste()}
          canPaste={!!engineRef.current?.hasClipboard()}
          onSelectAll={() => engineRef.current?.selectAll()}
          onTextStyle={(t) => {
            setPrefs({ textStyle: t });
            if (engineRef.current?.hasSelection()) engineRef.current.styleSelectedText(t);
          }}
          readOnly={readOnly}
        />
        <div className="workspace">
          <div className={`canvas-wrap${zoomOpen ? ' has-zoom' : ''}`} style={zoomOpen ? { ['--zoom-h' as string]: `${Math.round(prefs.settings.zoomPanelHeight * 100)}%` } : undefined}>
            <div className="ink-host" ref={hostRef} data-testid="ink-host" />
            {zoomOpen && engine && (
              <ZoomPanel
                engine={engine}
                state={zoom}
                hostRef={zoomHostRef}
                height={prefs.settings.zoomPanelHeight}
                autoAdvance={prefs.settings.zoomAutoAdvance}
                onHeight={(h) => setPrefs((p) => ({ settings: { ...p.settings, zoomPanelHeight: h } }))}
                onAutoAdvance={(v) => setPrefs((p) => ({ settings: { ...p.settings, zoomAutoAdvance: v } }))}
                onClose={() => setZoomOpen(false)}
              />
            )}
            {shapeHint && (
              <div className="shape-hint" role="status">
                <Icon name="shape" size={16} /> {shapeHint} — relevez pour valider
              </div>
            )}
            {!opened && <div className="loading overlay">Ouverture du carnet…</div>}
            {engine && textEdit && (
              <TextEditor
                key={textEdit.mode === 'edit' ? textEdit.item.id : `${textEdit.pageId}-${textEdit.x}-${textEdit.y}`}
                engine={engine}
                req={textEdit}
                style={textEdit.mode === 'edit' ? textStyleOf(textEdit.item) : prefs.textStyle}
                onDone={(text, width) => {
                  const style = textEdit.mode === 'edit' ? textStyleOf(textEdit.item) : prefs.textStyle;
                  engine.commitText(textEdit, text, style, width);
                  setTextEdit(null);
                }}
              />
            )}
            {sel && !textEdit && (
              <div
                className="sel-bar"
                style={{
                  left: Math.min(Math.max(170, sel.rect.x + sel.rect.w / 2), (hostRef.current?.clientWidth ?? 800) - 170),
                  top: sel.rect.y > 80 ? sel.rect.y - 18 : sel.rect.y + sel.rect.h + 70,
                }}
                role="toolbar"
                aria-label="Sélection"
              >
                <span className="small sel-count">
                  {sel.count} élément{sel.count > 1 ? 's' : ''}
                </span>
                <button className="icon-btn sm" onClick={() => engineRef.current?.copySelection() && toast('Sélection copiée')} aria-label="Copier" title="Copier (⌘C)">
                  <Icon name="copy" size={18} />
                </button>
                <button className="icon-btn sm" onClick={() => engineRef.current?.duplicateSelection()} aria-label="Dupliquer" title="Dupliquer (⌘D)">
                  <Icon name="duplicate" size={18} />
                </button>
                {(sel.strokes > 0 || sel.texts > 0) && (
                  <button className="icon-btn sm" onClick={(e) => setColorAnchor(e.currentTarget)} aria-label="Couleur de la sélection" title="Couleur">
                    <Icon name="palette" size={18} />
                  </button>
                )}
                {sel.strokes > 0 && !readOnly && (
                  <button className="icon-btn sm" onClick={() => setConvert(true)} aria-label="Convertir en texte" title="Convertir l’écriture en texte">
                    <Icon name="convert" size={18} />
                  </button>
                )}
                {sel.strokes > 0 && (
                  <>
                    <button className="icon-btn sm" onClick={() => engineRef.current?.scaleSelectionWidth(0.75)} aria-label="Traits plus fins" title="Plus fin">
                      <Icon name="minus" size={18} />
                    </button>
                    <button className="icon-btn sm" onClick={() => engineRef.current?.scaleSelectionWidth(1.33)} aria-label="Traits plus épais" title="Plus épais">
                      <Icon name="plus" size={18} />
                    </button>
                  </>
                )}
                <button className="icon-btn sm danger" onClick={() => engineRef.current?.deleteSelection()} aria-label="Supprimer la sélection" title="Supprimer (⌫)">
                  <Icon name="trash" size={18} />
                </button>
              </div>
            )}
            {colorAnchor && sel && (
              <Popover anchor={colorAnchor} onClose={() => setColorAnchor(null)} label="Couleur de la sélection" width={260}>
                <div className="color-grid">
                  {PALETTE.map((c) => (
                    <button
                      key={c}
                      className="swatch"
                      style={{ ['--dot' as string]: c }}
                      aria-label={`Recolorer en ${c}`}
                      onClick={() => {
                        engineRef.current?.recolorSelection(c);
                        setColorAnchor(null);
                      }}
                    />
                  ))}
                </div>
              </Popover>
            )}
            {focus && (
              <div className="focus-float focus-left">
                <button className="icon-btn" onClick={() => setFocus(false)} aria-label="Quitter le mode concentration" title="Quitter le mode concentration">
                  <Icon name="unfocus" size={20} />
                </button>
                {pageNav}
                <button
                  className={`icon-btn${fs.active ? ' is-on' : ''}`}
                  onClick={(e) => void toggleFullscreen(e.currentTarget)}
                  aria-pressed={fs.active}
                  aria-label={fs.active ? 'Quitter le plein écran' : 'Plein écran'}
                >
                  <Icon name={fs.active ? 'exitFullscreen' : 'fullscreen'} size={20} />
                </button>
                <SaveIndicator state={save} compact />
              </div>
            )}
            {penPrompt && (
              <div className="pen-prompt" role="dialog" aria-label="Apple Pencil détecté">
                <span>Stylet détecté. Utiliser le doigt seulement pour naviguer ?</span>
                <button
                  className="btn btn-small btn-primary"
                  onClick={() => {
                    setPrefs((p) => ({ settings: { ...p.settings, fingerMode: 'pen-only' } }));
                    setPenPrompt(false);
                  }}
                >
                  Oui, stylet uniquement
                </button>
                <button className="btn btn-small btn-ghost" onClick={() => setPenPrompt(false)}>
                  Garder le doigt pour écrire
                </button>
              </div>
            )}
            {prefs.settings.showPerf && perf && (
              <div className="perf-hud" aria-live="off">
                <div>Rendu complet : {perf.fullRenderMs.toFixed(1)} ms</div>
                <div>Trait en cours : {perf.liveFrameMs.toFixed(1)} ms/frame</div>
                <div>Événement → frame : {perf.eventToFrameMs.toFixed(1)} ms</div>
                <div>Échantillons stylet : {perf.eventsPerSecond}/s</div>
                <div>Points (dernier trait) : {perf.pointsPerStroke}</div>
              </div>
            )}
          </div>
          {showPages && opened && (
            <PagesPanel
              session={opened.session}
              version={version}
              current={view.pageIndex}
              readOnly={readOnly}
              onGo={(i) => engineRef.current?.goToPage(i)}
              onAdd={addPage}
              onDuplicate={duplicatePage}
              onDelete={(id) => setDeletePage(id)}
              onMove={movePage}
              onClose={() => setShowPages(false)}
            />
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void insertImage(f);
        }}
      />

      {fsHelp && (
        <Popover anchor={fsHelp} onClose={() => setFsHelp(null)} label="Plein écran" width={320}>
          <div className="panel">
            <p>
              <strong>Ce navigateur ne permet pas de masquer son interface.</strong>
            </p>
            <p className="small">
              Sur iPad : dans Safari, touchez <em>Partager</em> puis <em>Sur l’écran d’accueil</em>, et lancez Calame depuis son icône. L’application s’ouvre
              alors sans barre de navigateur.
            </p>
            <p className="small muted">En attendant, le mode concentration masque la barre du carnet pour agrandir la page.</p>
            <button
              className="btn btn-small btn-primary"
              onClick={() => {
                setFocus(true);
                setFsHelp(null);
              }}
            >
              Activer le mode concentration
            </button>
          </div>
        </Popover>
      )}

      {convert && engine && opened && <ConvertDialog engine={engine} session={opened.session} prefs={prefs} onPrefs={setPrefs} onClose={() => setConvert(false)} />}
      {showSettings && <SettingsPanel prefs={prefs} onPrefs={(p) => setPrefs(p)} onClose={() => setShowSettings(false)} />}
      {deletePage && (
        <Confirm
          title="Supprimer cette page ?"
          message="La page et son contenu seront supprimés de ce carnet. Les étapes d'annulation qui la concernent sont retirées."
          confirmLabel="Supprimer"
          danger
          onCancel={() => setDeletePage(null)}
          onConfirm={() => {
            const id = deletePage;
            setDeletePage(null);
            void removePage(id);
          }}
        />
      )}
    </div>
  );
}

function textStyleOf(t: TextItem) {
  return { font: t.font, size: t.size, color: t.color, bold: t.bold, italic: t.italic, underline: t.underline, align: t.align };
}

function SaveIndicator({ state, compact }: { state: SaveState; compact?: boolean }) {
  let label: string;
  let short: string;
  let cls: string;
  if (state.status === 'error') {
    label = short = 'Erreur d’enregistrement';
    cls = 'is-error';
  } else if (state.status === 'saving') {
    label = short = 'Enregistrement…';
    cls = 'is-saving';
  } else {
    label = 'Enregistré sur cet appareil';
    short = 'Enregistré';
    cls = 'is-saved';
  }
  return (
    <span className="save-ind" title={state.error ?? label} role="status" aria-live="polite">
      <span className={`save-dot ${cls}`} aria-hidden="true" />
      {!compact && (
        <span className="save-label">
          <span className="save-label-long">{label}</span>
          <span className="save-label-short">{short}</span>
        </span>
      )}
      {state.status === 'error' && !compact && <span className="sr-only">{state.error}</span>}
    </span>
  );
}

/** Âge de la dernière copie exportée hors du navigateur ; un toucher exporte une sauvegarde complète. */
function BackupChip() {
  const last = useLastBackup();
  const [busy, setBusy] = useState(false);
  const stale = last !== undefined && backupAgeDays(last) >= BACKUP_STALE_DAYS;
  const label = backupLabel(last);
  return (
    <button
      className={`backup-chip${stale ? ' is-stale' : ''}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await exportFullBackup();
        setBusy(false);
      }}
      title={`${label}. Toucher pour exporter une sauvegarde complète (copie hors du navigateur).`}
      aria-label={`${label}. Exporter une sauvegarde`}
    >
      <Icon name={stale ? 'alert' : 'download'} size={14} />
      <span className="backup-text">{busy ? 'Export…' : label}</span>
    </button>
  );
}
