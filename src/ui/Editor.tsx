import { useCallback, useEffect, useRef, useState } from 'react';
import { InkEngine, type PerfStats, type ViewInfo } from '../ink/engine';
import type { Tool } from '../ink/settings';
import { openNotebook, saveQueue, broadcast, type LockState, type OpenedNotebook } from '../storage/openNotebook';
import { repo } from '../storage/repo';
import type { SaveState } from '../storage/saveQueue';
import { coverColor } from '../model/types';
import { Icon } from './icons';
import { Confirm } from './Modal';
import { PagesPanel } from './PagesPanel';
import { SettingsPanel } from './SettingsPanel';
import { Toolbar } from './Toolbar';
import { toast } from './Toast';
import { loadView, saveView, setPrefs as setPrefsGlobal, usePrefs } from './prefs';
import { BACKUP_STALE_DAYS, backupAgeDays, backupLabel, exportFullBackup, useLastBackup } from './backupStatus';

declare global {
  interface Window {
    /** Point d'accès de diagnostic utilisé par les tests de bout en bout (aucune donnée envoyée). */
    __calame?: { engine: InkEngine; session: OpenedNotebook['session'] };
  }
}

export function Editor({ notebookId, onClose }: { notebookId: string; onClose: () => void }) {
  const [opened, setOpened] = useState<OpenedNotebook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lock, setLock] = useState<LockState>('unsupported');
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<InkEngine | null>(null);
  const [prefs, setPrefs] = usePrefs();
  const [view, setView] = useState<ViewInfo>({ scale: 1, pageIndex: 0, pageCount: 1 });
  const [sel, setSel] = useState<{ rect: { x: number; y: number; w: number; h: number }; count: number } | null>(null);
  const [hist, setHist] = useState({ canUndo: false, canRedo: false });
  const [save, setSave] = useState<SaveState>(saveQueue.state);
  const [showPages, setShowPages] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [focus, setFocus] = useState(false);
  const [perf, setPerf] = useState<PerfStats | null>(null);
  const [version, setVersion] = useState(0);
  const [deletePage, setDeletePage] = useState<string | null>(null);

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
    const offs = [
      opened.onLockChange((s) => {
        setLock(s);
        if (s === 'readonly') toast('Ce carnet a été repris dans un autre onglet : lecture seule ici.');
      }),
      opened.onStructureChange(() => {
        engineRef.current?.relayout();
        setVersion((v) => v + 1);
      }),
      opened.session.onHistory(() =>
        setHist({ canUndo: opened.session.canUndo, canRedo: opened.session.canRedo }),
      ),
    ];
    let t = 0;
    offs.push(
      opened.session.onChange(() => {
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
    const p = prefs;
    const engine = new InkEngine(host, opened.session, {
      onView: setView,
      onSelection: (rect, count) => setSel(rect && count ? { rect, count } : null),
      onPenDetected: () => setPrefsGlobal({ penDetected: true }),
      onPerf: setPerf,
      onUndoGesture: () => opened.session.undo(),
      onRedoGesture: () => opened.session.redo(),
    });
    engine.penDetected = p.penDetected;
    engine.setSettings(p.settings);
    engine.setStyles(p.styles);
    engine.setTool(p.tool);
    const v = loadView(notebookId);
    if (v) engine.restoreView(v);
    engineRef.current = engine;
    window.__calame = { engine, session: opened.session };
    let t = 0;
    const persistView = () => saveView(notebookId, engine.savedView());
    const onViewSave = () => {
      clearTimeout(t);
      t = window.setTimeout(persistView, 400);
    };
    const iv = window.setInterval(onViewSave, 2000);
    const hide = () => {
      persistView();
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      persistView();
      clearInterval(iv);
      clearTimeout(t);
      document.removeEventListener('visibilitychange', hide);
      engine.destroy();
      engineRef.current = null;
      if (window.__calame?.engine === engine) delete window.__calame;
    };
    // Le moteur est créé une seule fois par carnet ouvert ; les préférences suivent via l'effet ci-dessous.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, notebookId]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setSettings(prefs.settings);
    e.setStyles(prefs.styles);
    e.setTool(prefs.tool);
    e.penDetected = prefs.penDetected;
  }, [prefs.settings, prefs.styles, prefs.tool, prefs.penDetected, opened]);

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
  }, [prefs.theme, opened]);

  // ---------- Actions ----------
  const setTool = useCallback((t: Tool) => setPrefs({ tool: t }), [setPrefs]);
  const undo = useCallback(() => opened?.session.undo(), [opened]);
  const redo = useCallback(() => opened?.session.redo(), [opened]);

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
        const page = await repo.insertPage(notebookId, index, ref?.paper ?? s.notebook.paper);
        s.addPage(page);
        const ids = s.notebook.pageIds.slice();
        ids.splice(index, 0, page.id);
        s.setNotebook({ ...s.notebook, pageIds: ids });
        engineRef.current?.relayout();
        engineRef.current?.scrollToPage(index);
      }),
    [opened, notebookId, pageOp],
  );

  const duplicatePage = useCallback(
    (pageId: string) =>
      pageOp(async () => {
        const s = opened!.session;
        const { page, strokes } = await repo.duplicatePage(notebookId, pageId);
        s.addPage(page, strokes);
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

  // ---------- Raccourcis clavier ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const eng = engineRef.current;
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && k === 'd' && eng?.hasSelection()) {
        e.preventDefault();
        eng.duplicateSelection();
      } else if (!mod && (k === 'delete' || k === 'backspace') && eng?.hasSelection()) {
        e.preventDefault();
        eng.deleteSelection();
      } else if (mod || e.altKey) {
        if (mod && (k === '=' || k === '+')) {
          e.preventDefault();
          eng?.zoomBy(1.25);
        } else if (mod && k === '-') {
          e.preventDefault();
          eng?.zoomBy(0.8);
        } else if (mod && k === '0') {
          e.preventDefault();
          eng?.fitWidth();
        }
      } else if (k === 'p') setTool('pen');
      else if (k === 'h') setTool('highlighter');
      else if (k === 'e') setTool('eraser');
      else if (k === 'l') setTool('lasso');
      else if (k === 'f') setFocus((f) => !f);
      else if (k === 'escape') {
        if (eng?.hasSelection()) eng.clearSelection();
        else setFocus(false);
      } else if (k === 'pagedown') eng?.scrollToPage(view.pageIndex + 1);
      else if (k === 'pageup') eng?.scrollToPage(view.pageIndex - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, setTool, view.pageIndex]);

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
          <div className="topbar-center">
            <button className="icon-btn" onClick={undo} disabled={!hist.canUndo} aria-label="Annuler" title="Annuler (⌘Z)">
              <Icon name="undo" />
            </button>
            <button className="icon-btn" onClick={redo} disabled={!hist.canRedo} aria-label="Rétablir" title="Rétablir (⇧⌘Z)">
              <Icon name="redo" />
            </button>
          </div>
          <div className="topbar-right">
            <SaveIndicator state={save} />
            <BackupChip />
            <button className="zoom-chip" onClick={() => engineRef.current?.fitWidth()} title="Ajuster à la largeur (⌘0)">
              {Math.round(view.scale * 100)} %
            </button>
            <button
              className={`icon-btn${showPages ? ' is-on' : ''}`}
              onClick={() => setShowPages((s) => !s)}
              aria-pressed={showPages}
              aria-label="Pages"
              title="Pages"
            >
              <Icon name="pages" />
              <span className="badge">
                {view.pageIndex + 1}/{view.pageCount}
              </span>
            </button>
            <button className="icon-btn" onClick={() => addPage(view.pageIndex + 1)} disabled={readOnly} aria-label="Ajouter une page après celle-ci" title="Nouvelle page">
              <Icon name="plus" />
            </button>
            <button className="icon-btn" onClick={() => setFocus(true)} aria-label="Mode concentration" title="Mode concentration (F)">
              <Icon name="focus" />
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
            tool={prefs.tool}
            styles={prefs.styles}
            eraserMode={prefs.settings.eraserMode}
            onTool={setTool}
            onStyle={(styles) => setPrefs({ styles })}
            onEraserMode={(m) => setPrefs({ settings: { ...prefs.settings, eraserMode: m } })}
            position={prefs.toolbar}
          />
        <div className="canvas-wrap">
          <div className="ink-host" ref={hostRef} data-testid="ink-host" />
          {!opened && <div className="loading overlay">Ouverture du carnet…</div>}
          {sel && (
            <div
              className="sel-bar"
              style={{
                left: Math.max(8, sel.rect.x + sel.rect.w / 2),
                top: sel.rect.y > 64 ? sel.rect.y - 12 : sel.rect.y + sel.rect.h + 56,
              }}
              role="toolbar"
              aria-label="Sélection"
            >
              <span className="small">{sel.count} trait{sel.count > 1 ? 's' : ''}</span>
              <button className="btn btn-small" onClick={() => engineRef.current?.duplicateSelection()}>
                <Icon name="duplicate" size={16} /> Dupliquer
              </button>
              {(['#1d2433', '#2f5aa8', '#c0392b', '#2e7d4f'] as const).map((c) => (
                <button key={c} className="color-dot sm" style={{ ['--dot' as string]: c }} aria-label={`Recolorer en ${c}`} onClick={() => engineRef.current?.recolorSelection(c)} />
              ))}
              <button className="btn btn-small btn-danger-ghost" onClick={() => engineRef.current?.deleteSelection()}>
                <Icon name="trash" size={16} /> Supprimer
              </button>
            </div>
          )}
          {focus && (
            <button className="focus-exit" onClick={() => setFocus(false)} aria-label="Quitter le mode concentration">
              <Icon name="unfocus" size={20} />
            </button>
          )}
          {focus && (
            <div className="focus-mini">
              <button className="icon-btn" onClick={undo} disabled={!hist.canUndo} aria-label="Annuler">
                <Icon name="undo" size={20} />
              </button>
              <button className="icon-btn" onClick={redo} disabled={!hist.canRedo} aria-label="Rétablir">
                <Icon name="redo" size={20} />
              </button>
              <SaveIndicator state={save} compact />
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
            onGo={(i) => engineRef.current?.scrollToPage(i)}
            onAdd={addPage}
            onDuplicate={duplicatePage}
            onDelete={(id) => setDeletePage(id)}
            onMove={movePage}
            onClose={() => setShowPages(false)}
          />
        )}
      </div>

      {showSettings && <SettingsPanel prefs={prefs} onPrefs={(p) => setPrefs(p)} onClose={() => setShowSettings(false)} />}
      {deletePage && (
        <Confirm
          title="Supprimer cette page ?"
          message="La page et son contenu seront supprimés de ce carnet."
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

/**
 * Deuxième indicateur, distinct de l'enregistrement local : la dernière copie
 * exportée hors du navigateur. Un toucher exporte une sauvegarde complète.
 */
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
