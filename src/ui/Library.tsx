import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { newId } from '../model/ids';
import { pageSize, type CoverPattern, type Folder, type ImageItem, type Notebook } from '../model/types';
import { repo } from '../storage/repo';
import { broadcast, onBroadcast } from '../storage/openNotebook';
import { backupFileName, deliverFile, exportBackup, parseBackup, restoreBackup, serializeBackup } from '../storage/backup';
import { listSnapshots, snapshotError, type SafetySnapshot } from '../storage/db';
import { formatBytes, isStandalone, requestPersistence, storageInfo, type StorageInfo } from '../storage/quota';
import { prepareImage } from '../ink/items';
import { Cover, CoverPicker } from './Cover';
import { Icon, Logo, type IconName } from './icons';
import { Confirm, Modal } from './Modal';
import { NewNotebookDialog } from './NewNotebookDialog';
import { Popover } from './Popover';
import { toast } from './Toast';
import { usePrefs, type Prefs } from './prefs';
import { BACKUP_STALE_DAYS, backupAgeDays, exportFullBackup, useLastBackup } from './backupStatus';

type View = { kind: 'all' } | { kind: 'favorites' } | { kind: 'trash' } | { kind: 'folder'; id: string };

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const relFmt = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

function relative(ts: number): string {
  const diff = (ts - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "à l'instant";
  if (abs < 3600) return relFmt.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return relFmt.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return relFmt.format(Math.round(diff / 86400), 'day');
  return dateFmt.format(ts);
}

const SORTS: { id: Prefs['librarySort']; label: string }[] = [
  { id: 'updated', label: 'Date de modification' },
  { id: 'opened', label: 'Dernière ouverture' },
  { id: 'created', label: 'Date de création' },
  { id: 'title', label: 'Nom' },
];

function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'carnet'
  );
}

export function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const [notebooks, setNotebooks] = useState<Notebook[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [prefs, setPrefs] = usePrefs();
  const [creating, setCreating] = useState(false);
  const [newMenu, setNewMenu] = useState<HTMLElement | null>(null);
  const [menuFor, setMenuFor] = useState<{ nb: Notebook; anchor: HTMLElement } | null>(null);
  const [renaming, setRenaming] = useState<{ kind: 'notebook' | 'folder'; id: string; name: string } | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [coverFor, setCoverFor] = useState<Notebook | null>(null);
  const [moveFor, setMoveFor] = useState<Notebook | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Notebook | null>(null);
  const [confirmFolder, setConfirmFolder] = useState<Folder | null>(null);
  const [showStorage, setShowStorage] = useState(false);
  const imageRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [n, f] = await Promise.all([repo.listNotebooks(), repo.listFolders()]);
      setNotebooks(n);
      setFolders(f.sort((a, b) => a.name.localeCompare(b.name, 'fr')));
      setError(null);
    } catch (e) {
      setError(`Impossible de lire le stockage local : ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void load();
    return onBroadcast((m) => {
      if (m.type === 'library' || m.type === 'structure') void load();
    });
  }, [load]);

  const changed = useCallback(async () => {
    await load();
    broadcast({ type: 'library' });
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await changed();
      if (ok) toast(ok);
    } catch (e) {
      toast(`Échec : ${(e as Error).message}`, 'error');
    }
  };

  const folderId = view.kind === 'folder' ? view.id : null;
  const visible = useMemo(() => {
    if (!notebooks) return [];
    const q = query.trim().toLocaleLowerCase('fr');
    const sorter: Record<Prefs['librarySort'], (a: Notebook, b: Notebook) => number> = {
      updated: (a, b) => b.updatedAt - a.updatedAt,
      opened: (a, b) => b.openedAt - a.openedAt,
      created: (a, b) => b.createdAt - a.createdAt,
      title: (a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }),
    };
    return notebooks
      .filter((n) => (view.kind === 'trash' ? n.trashedAt !== null : n.trashedAt === null))
      .filter((n) => view.kind !== 'favorites' || n.favorite)
      .filter((n) => (view.kind === 'folder' ? n.folderId === view.id : view.kind === 'all' && !q ? n.folderId === null : true))
      .filter((n) => !q || n.title.toLocaleLowerCase('fr').includes(q))
      .sort(view.kind === 'trash' ? (a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0) : sorter[prefs.librarySort]);
  }, [notebooks, view, query, prefs.librarySort]);

  const active = (notebooks ?? []).filter((n) => n.trashedAt === null);
  const recents = useMemo(() => active.slice().sort((a, b) => b.openedAt - a.openedAt).slice(0, 6), [active]);
  const countIn = (fid: string) => active.filter((n) => n.folderId === fid).length;

  const createAndOpen = async (fn: () => Promise<Notebook>) => {
    try {
      const nb = await fn();
      broadcast({ type: 'library' });
      onOpen(nb.id);
    } catch (e) {
      toast(`Création impossible : ${(e as Error).message}`, 'error');
    }
  };

  const quickNote = () =>
    createAndOpen(() => {
      const d = new Date();
      const title = `Note rapide · ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
      return repo.createNotebook({ title, cover: 'sable', coverPattern: 'plain', kind: 'quicknote', paper: { kind: 'lined', color: 'yellow', spacing: 30 }, folderId });
    });

  const whiteboard = () =>
    createAndOpen(() =>
      repo.createNotebook({
        title: 'Tableau blanc',
        cover: 'ardoise',
        coverPattern: 'grid',
        kind: 'whiteboard',
        format: 'board',
        orientation: 'landscape',
        paper: { kind: 'dotted', color: 'white', spacing: 32 },
        folderId,
      }),
    );

  const importImage = async (file: File) => {
    try {
      const img = await prepareImage(file);
      const blobId = newId();
      await repo.putBlob({ id: blobId, mime: img.mime, data: img.data, createdAt: Date.now() });
      const orientation = img.width > img.height ? 'landscape' : 'portrait';
      const size = pageSize('A4', orientation);
      const k = Math.min((size.width - 48) / img.width, (size.height - 48) / img.height, 1);
      const w = img.width * k;
      const h = img.height * k;
      const item: ImageItem = {
        kind: 'image', id: newId(), pageId: '', x: (size.width - w) / 2, y: (size.height - h) / 2, w, h, blobId, mime: img.mime, order: Date.now(), createdAt: Date.now(), v: 2,
      };
      await createAndOpen(() =>
        repo.createNotebook(
          { title: file.name.replace(/\.[^.]+$/, '') || 'Image', cover: 'ocean', coverPattern: 'plain', orientation, paper: { kind: 'blank', color: 'white', spacing: 32 }, folderId },
          { items: [item] },
        ),
      );
    } catch (e) {
      toast(`Import impossible : ${(e as Error).message}`, 'error');
    }
  };

  const restoreFile = async (file: File) => {
    try {
      const r = await restoreBackup(parseBackup(await file.text()));
      await changed();
      toast(
        `Restauration : ${r.notebooks} carnet(s), ${r.pages} page(s), ${r.strokes} trait(s), ${r.items} objet(s)` +
          (r.copies ? ` — ${r.copies} importé(s) comme copie pour ne rien écraser.` : '.'),
      );
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const title =
    view.kind === 'all' ? 'Documents' : view.kind === 'favorites' ? 'Favoris' : view.kind === 'trash' ? 'Corbeille' : (folders.find((f) => f.id === view.id)?.name ?? 'Dossier');

  const nav = (v: View, icon: IconName, label: string, extra?: ReactNode) => {
    const on = v.kind === view.kind && (v.kind !== 'folder' || (view.kind === 'folder' && view.id === v.id));
    return (
      <button key={v.kind === 'folder' ? v.id : v.kind} className={`side-item${on ? ' is-on' : ''}`} onClick={() => setView(v)} aria-current={on ? 'page' : undefined}>
        <Icon name={icon} size={19} />
        <span className="side-label">{label}</span>
        {extra}
      </button>
    );
  };

  return (
    <div className="library">
      <aside className="lib-side safe-top" aria-label="Navigation de la bibliothèque">
        <div className="brand">
          <Logo size={30} />
          <span className="brand-name">Calame</span>
        </div>
        <nav className="side-nav">
          {nav({ kind: 'all' }, 'library', 'Documents', <span className="side-count">{active.length}</span>)}
          {nav({ kind: 'favorites' }, 'star', 'Favoris')}
          {nav({ kind: 'trash' }, 'trash', 'Corbeille')}
        </nav>
        <div className="side-section">
          <div className="side-heading">
            Dossiers
            <button className="icon-btn sm" onClick={() => setNewFolder(true)} aria-label="Nouveau dossier" title="Nouveau dossier">
              <Icon name="plus" size={16} />
            </button>
          </div>
          {folders.length === 0 && <p className="small muted side-empty">Aucun dossier</p>}
          {folders.map((f) => nav({ kind: 'folder', id: f.id }, 'folder', f.name, <span className="side-count">{countIn(f.id)}</span>))}
        </div>
        <div className="side-bottom">
          <button className="side-item" onClick={() => setShowStorage(true)} aria-label="Stockage et sauvegardes">
            <Icon name="device" size={19} />
            <span className="side-label">Stockage et sauvegardes</span>
          </button>
        </div>
      </aside>

      <main className="lib-main">
        <header className="lib-head safe-top">
          <div className="lib-title">
            {view.kind === 'folder' && (
              <button className="crumb" onClick={() => setView({ kind: 'all' })}>
                Documents <Icon name="chevronRight" size={14} />
              </button>
            )}
            <h1>{title}</h1>
          </div>
          <div className="lib-actions">
            <label className="search">
              <Icon name="search" size={18} />
              <input type="search" placeholder="Rechercher" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher dans les titres" />
            </label>
            {view.kind !== 'trash' && (
              <label className="select-pill" title="Trier">
                <Icon name="sort" size={16} />
                <select value={prefs.librarySort} onChange={(e) => setPrefs({ librarySort: e.target.value as Prefs['librarySort'] })} aria-label="Trier par">
                  {SORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {view.kind === 'folder' && (
              <>
                <button className="btn btn-ghost btn-small" onClick={() => setRenaming({ kind: 'folder', id: view.id, name: title })}>
                  Renommer
                </button>
                <button className="btn btn-ghost btn-small" onClick={() => setConfirmFolder(folders.find((f) => f.id === view.id) ?? null)}>
                  Supprimer le dossier
                </button>
              </>
            )}
            <button className="btn btn-primary" onClick={(e) => setNewMenu(e.currentTarget)} aria-haspopup="menu" aria-expanded={!!newMenu}>
              <Icon name="plus" size={18} /> Nouveau <Icon name="chevronDown" size={16} />
            </button>
          </div>
        </header>

        <nav className="lib-tabs" aria-label="Sections">
          {(
            [
              [{ kind: 'all' }, 'Documents'],
              [{ kind: 'favorites' }, 'Favoris'],
              [{ kind: 'trash' }, 'Corbeille'],
            ] as [View, string][]
          ).map(([v, l]) => (
            <button key={v.kind} className={view.kind === v.kind ? 'is-on' : ''} onClick={() => setView(v)}>
              {l}
            </button>
          ))}
          <button onClick={() => setShowStorage(true)}>Stockage</button>
        </nav>

        <BackupReminder onOpen={() => setShowStorage(true)} hasNotebooks={active.length > 0} />
        {snapshotError && (
          <div className="callout callout-error" role="alert">
            <Icon name="alert" size={18} />
            <span>{snapshotError} Exportez une sauvegarde par précaution.</span>
          </div>
        )}
        {error && (
          <div className="callout callout-error" role="alert">
            <Icon name="alert" size={18} /> <span>{error}</span>
          </div>
        )}
        {notebooks === null && !error && <div className="loading">Chargement…</div>}

        {view.kind === 'all' && !query && recents.length > 1 && (
          <section aria-label="Récents" className="lib-section">
            <h2 className="section-title">
              <Icon name="clock" size={15} /> Récents
            </h2>
            <div className="recent-row">
              {recents.map((n) => (
                <button key={n.id} className="recent" onClick={() => onOpen(n.id)}>
                  <Cover color={n.cover} pattern={n.coverPattern} kind={n.kind} small />
                  <span className="recent-text">
                    <span className="recent-title">{n.title}</span>
                    <span className="muted small">{relative(n.openedAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {view.kind === 'all' && !query && folders.length > 0 && (
          <section aria-label="Dossiers" className="lib-section">
            <h2 className="section-title">
              <Icon name="folder" size={15} /> Dossiers
            </h2>
            <div className="folder-row">
              {folders.map((f) => (
                <button key={f.id} className="folder-card" onClick={() => setView({ kind: 'folder', id: f.id })}>
                  <Icon name="folder" size={30} />
                  <span className="folder-name">{f.name}</span>
                  <span className="muted small">
                    {countIn(f.id)} carnet{countIn(f.id) > 1 ? 's' : ''}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {notebooks !== null && visible.length === 0 && (
          <div className="empty">
            {view.kind === 'trash' ? (
              <p>La corbeille est vide.</p>
            ) : query ? (
              <p>Aucun carnet ne correspond à « {query} ».</p>
            ) : view.kind === 'favorites' ? (
              <p>Aucun favori. Touchez l'étoile d'un carnet pour l'ajouter ici.</p>
            ) : view.kind === 'folder' ? (
              <p>Ce dossier est vide. Utilisez « Déplacer vers… » dans le menu d'un carnet, ou créez-en un ici.</p>
            ) : (
              <>
                <Logo size={56} />
                <h2>Commencez votre premier carnet</h2>
                <p className="muted">Vos notes restent sur cet appareil. Pensez à exporter une sauvegarde régulièrement.</p>
                <button className="btn btn-primary" onClick={() => setCreating(true)}>
                  <Icon name="plus" size={18} /> Nouveau carnet
                </button>
              </>
            )}
          </div>
        )}

        {visible.length > 0 && (
          <section className="lib-section" aria-label="Carnets">
            {view.kind === 'all' && !query && <h2 className="section-title">Carnets</h2>}
            <div className="grid">
              {visible.map((n) => (
                <article key={n.id} className="nb-card">
                  <button className="cover-btn" onClick={() => (n.trashedAt ? undefined : onOpen(n.id))} disabled={n.trashedAt !== null} aria-label={`Ouvrir ${n.title}`}>
                    <Cover color={n.cover} pattern={n.coverPattern} title={n.title} kind={n.kind} />
                  </button>
                  <div className="nb-meta">
                    <div className="nb-title" title={n.title}>
                      {n.title}
                    </div>
                    <div className="nb-actions">
                      {n.trashedAt === null && (
                        <button
                          className={`icon-btn sm star-btn${n.favorite ? ' is-on' : ''}`}
                          onClick={() => act(() => repo.updateNotebook(n.id, (x) => void (x.favorite = !x.favorite)))}
                          aria-pressed={n.favorite}
                          aria-label={n.favorite ? `Retirer ${n.title} des favoris` : `Ajouter ${n.title} aux favoris`}
                        >
                          <Icon name="star" size={17} filled={n.favorite} />
                        </button>
                      )}
                      <button className="icon-btn sm" aria-label={`Actions pour ${n.title}`} aria-haspopup="menu" onClick={(e) => setMenuFor({ nb: n, anchor: e.currentTarget })}>
                        <Icon name="more" size={20} />
                      </button>
                    </div>
                    <div className="nb-sub muted small">
                      {relative(n.updatedAt)} · {n.pageIds.length} page{n.pageIds.length > 1 ? 's' : ''}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      {newMenu && (
        <Popover anchor={newMenu} onClose={() => setNewMenu(null)} label="Créer" width={260}>
          <div className="menu-list" role="menu" onClick={() => setNewMenu(null)}>
            <MenuItem icon="notebook" onClick={() => setCreating(true)}>
              Carnet…
            </MenuItem>
            <MenuItem icon="quick" onClick={quickNote}>
              Note rapide
            </MenuItem>
            <MenuItem icon="board" onClick={whiteboard}>
              Tableau blanc (grande page)
            </MenuItem>
            <MenuItem icon="folderPlus" onClick={() => setNewFolder(true)}>
              Dossier
            </MenuItem>
            <div className="menu-sep" />
            <MenuItem icon="image" onClick={() => imageRef.current?.click()}>
              Importer une image
            </MenuItem>
            <MenuItem icon="upload" onClick={() => restoreRef.current?.click()}>
              Restaurer une sauvegarde (.calame)
            </MenuItem>
          </div>
        </Popover>
      )}

      {menuFor && (
        <Popover anchor={menuFor.anchor} onClose={() => setMenuFor(null)} label={`Actions pour ${menuFor.nb.title}`} width={250}>
          <div className="menu-list" role="menu" onClick={() => setMenuFor(null)}>
            {menuFor.nb.trashedAt === null ? (
              <>
                <MenuItem icon="notebook" onClick={() => onOpen(menuFor.nb.id)}>
                  Ouvrir
                </MenuItem>
                <MenuItem icon="pen" onClick={() => setRenaming({ kind: 'notebook', id: menuFor.nb.id, name: menuFor.nb.title })}>
                  Renommer
                </MenuItem>
                <MenuItem icon="palette" onClick={() => setCoverFor(menuFor.nb)}>
                  Changer la couverture
                </MenuItem>
                <MenuItem icon="folder" onClick={() => setMoveFor(menuFor.nb)}>
                  Déplacer vers…
                </MenuItem>
                <MenuItem
                  icon="download"
                  onClick={async () => {
                    try {
                      const b = await exportBackup([menuFor.nb.id]);
                      await deliverFile(serializeBackup(b), backupFileName(slug(menuFor.nb.title)));
                    } catch (e) {
                      toast((e as Error).message, 'error');
                    }
                  }}
                >
                  Exporter ce carnet
                </MenuItem>
                <div className="menu-sep" />
                <MenuItem icon="trash" danger onClick={() => act(() => repo.updateNotebook(menuFor.nb.id, (x) => void (x.trashedAt = Date.now())), 'Carnet placé dans la corbeille')}>
                  Mettre à la corbeille
                </MenuItem>
              </>
            ) : (
              <>
                <MenuItem icon="restore" onClick={() => act(() => repo.updateNotebook(menuFor.nb.id, (x) => void (x.trashedAt = null)), 'Carnet restauré')}>
                  Restaurer
                </MenuItem>
                <MenuItem icon="trash" danger onClick={() => setConfirmDelete(menuFor.nb)}>
                  Supprimer définitivement
                </MenuItem>
              </>
            )}
          </div>
        </Popover>
      )}

      {creating && (
        <NewNotebookDialog
          onClose={() => setCreating(false)}
          onCreate={(c) => {
            setCreating(false);
            void createAndOpen(() => repo.createNotebook({ ...c, folderId }));
          }}
        />
      )}

      {(renaming || newFolder) && (
        <NameDialog
          title={newFolder ? 'Nouveau dossier' : 'Renommer'}
          initial={renaming?.name ?? ''}
          confirm={newFolder ? 'Créer' : 'Enregistrer'}
          onClose={() => {
            setRenaming(null);
            setNewFolder(false);
          }}
          onSave={(name) => {
            const r = renaming;
            setRenaming(null);
            if (newFolder) {
              setNewFolder(false);
              void act(async () => setView({ kind: 'folder', id: (await repo.createFolder(name)).id }));
            } else if (r?.kind === 'folder') void act(() => repo.renameFolder(r.id, name));
            else if (r) void act(() => repo.updateNotebook(r.id, (x) => void (x.title = name.trim() || 'Sans titre')));
          }}
        />
      )}

      {coverFor && (
        <CoverDialog
          nb={coverFor}
          onClose={() => setCoverFor(null)}
          onSave={(c) => {
            const id = coverFor.id;
            setCoverFor(null);
            void act(() => repo.updateNotebook(id, (x) => void Object.assign(x, { cover: c.color, coverPattern: c.pattern })));
          }}
        />
      )}

      {moveFor && (
        <Modal title={`Déplacer « ${moveFor.title} »`} onClose={() => setMoveFor(null)}>
          <div className="menu-list">
            <MenuItem
              icon="library"
              onClick={() => {
                const id = moveFor.id;
                setMoveFor(null);
                void act(() => repo.updateNotebook(id, (x) => void (x.folderId = null)), 'Carnet déplacé');
              }}
            >
              Documents (racine){moveFor.folderId === null ? ' — actuel' : ''}
            </MenuItem>
            {folders.map((f) => (
              <MenuItem
                key={f.id}
                icon="folder"
                onClick={() => {
                  const id = moveFor.id;
                  setMoveFor(null);
                  void act(() => repo.updateNotebook(id, (x) => void (x.folderId = f.id)), `Carnet déplacé dans « ${f.name} »`);
                }}
              >
                {f.name}
                {moveFor.folderId === f.id ? ' — actuel' : ''}
              </MenuItem>
            ))}
            <MenuItem icon="folderPlus" onClick={() => setNewFolder(true)}>
              Nouveau dossier…
            </MenuItem>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Confirm
          title="Supprimer définitivement ?"
          message={`« ${confirmDelete.title} » et toutes ses pages seront effacés de cet appareil. Cette action est irréversible.`}
          confirmLabel="Supprimer"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const id = confirmDelete.id;
            setConfirmDelete(null);
            void act(() => repo.deleteNotebookForever(id), 'Carnet supprimé');
          }}
        />
      )}

      {confirmFolder && (
        <Confirm
          title="Supprimer ce dossier ?"
          message={`Le dossier « ${confirmFolder.name} » sera supprimé. Ses carnets ne sont pas effacés : ils reviennent dans Documents.`}
          confirmLabel="Supprimer le dossier"
          onCancel={() => setConfirmFolder(null)}
          onConfirm={() => {
            const id = confirmFolder.id;
            setConfirmFolder(null);
            setView({ kind: 'all' });
            void act(() => repo.deleteFolder(id), 'Dossier supprimé');
          }}
        />
      )}

      {showStorage && <StorageDialog onClose={() => setShowStorage(false)} onRestore={() => restoreRef.current?.click()} />}

      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importImage(f);
        }}
      />
      <input
        ref={restoreRef}
        type="file"
        accept=".calame,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void restoreFile(f);
        }}
      />
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: IconName; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" className={`menu-item${danger ? ' danger' : ''}`} onClick={onClick}>
      <Icon name={icon} size={18} />
      <span>{children}</span>
    </button>
  );
}

function NameDialog({ title, initial, confirm, onClose, onSave }: { title: string; initial: string; confirm: string; onClose: () => void; onSave: (t: string) => void }) {
  const [t, setT] = useState(initial);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={() => onSave(t)}>
            {confirm}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Nom</span>
        <input value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSave(t)} maxLength={120} aria-label="Nom" />
      </label>
    </Modal>
  );
}

function CoverDialog({ nb, onClose, onSave }: { nb: Notebook; onClose: () => void; onSave: (c: { color: string; pattern: CoverPattern }) => void }) {
  const [c, setC] = useState({ color: nb.cover, pattern: nb.coverPattern });
  return (
    <Modal
      title="Couverture"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={() => onSave(c)}>
            Enregistrer
          </button>
        </>
      }
    >
      <div className="cover-dialog">
        <Cover color={c.color} pattern={c.pattern} title={nb.title} kind={nb.kind} />
        <CoverPicker color={c.color} pattern={c.pattern} onChange={setC} />
      </div>
    </Modal>
  );
}

function BackupReminder({ onOpen, hasNotebooks }: { onOpen: () => void; hasNotebooks: boolean }) {
  const last = useLastBackup();
  if (!hasNotebooks || last === undefined) return null;
  const days = backupAgeDays(last);
  if (days < BACKUP_STALE_DAYS) return null;
  return (
    <div className="callout">
      <Icon name="alert" size={18} />
      <span>
        {last ? `Dernière sauvegarde exportée il y a ${Math.floor(days)} jours.` : "Aucune sauvegarde exportée pour l'instant."} Le stockage du
        navigateur n'est pas une sauvegarde garantie.
      </span>
      <button className="btn btn-small" onClick={onOpen}>
        Sauvegarder
      </button>
    </div>
  );
}

function StorageDialog({ onClose, onRestore }: { onClose: () => void; onRestore: () => void }) {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [snaps, setSnaps] = useState<SafetySnapshot[]>([]);
  const last = useLastBackup();

  const refresh = useCallback(async () => {
    setInfo(await storageInfo());
    setSnaps(await listSnapshots().catch(() => []));
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pct = info?.usage != null && info.quota ? Math.min(100, (info.usage / info.quota) * 100) : null;

  return (
    <Modal title="Stockage et sauvegardes" onClose={onClose} wide>
      <section className="panel-section">
        <h3>Sur cet appareil</h3>
        <p>
          Utilisé : <strong>{formatBytes(info?.usage ?? null)}</strong> sur {formatBytes(info?.quota ?? null)} disponibles (estimation du navigateur).
        </p>
        {pct !== null && (
          <div className="meter" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${Math.max(1, pct)}%` }} />
          </div>
        )}
        <p className="small">
          Protection contre l'effacement automatique :{' '}
          {info?.persisted ? (
            <strong>accordée par le navigateur</strong>
          ) : (
            <>
              <strong>non accordée</strong>
              {!isStandalone() && ' — installez Calame sur l’écran d’accueil pour augmenter vos chances de l’obtenir.'}{' '}
              <button
                className="btn btn-small btn-ghost"
                onClick={async () => {
                  await requestPersistence();
                  await refresh();
                }}
              >
                Redemander
              </button>
            </>
          )}
        </p>
      </section>
      <section className="panel-section">
        <h3>Sauvegarde complète</h3>
        <p className="small">
          Dernière exportation : <strong>{last ? new Date(last).toLocaleString('fr-FR') : 'jamais'}</strong>
        </p>
        <div className="row">
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await exportFullBackup();
              setBusy(false);
            }}
          >
            <Icon name="download" size={18} /> Exporter une sauvegarde
          </button>
          <button className="btn" onClick={onRestore}>
            <Icon name="upload" size={18} /> Restaurer…
          </button>
        </div>
        <p className="small muted">La restauration n'écrase jamais un carnet existant : un carnet déjà présent est importé comme copie « (restauré) ».</p>
      </section>
      <section className="panel-section">
        <h3>Copies de sécurité automatiques</h3>
        <p className="small muted">Avant chaque mise à niveau du format de stockage, Calame copie toutes vos notes sur l'appareil (3 dernières copies conservées).</p>
        {snaps.length === 0 ? (
          <p className="small">Aucune copie pour l'instant (aucune mise à niveau n'a été nécessaire).</p>
        ) : (
          <ul className="snap-list">
            {snaps.map((s) => (
              <li key={s.id}>
                <span className="small">
                  {new Date(s.createdAt).toLocaleString('fr-FR')} — format {s.fromVersion} → {s.toVersion}, {s.notebooks} carnet(s)
                </span>
                <button
                  className="btn btn-small"
                  onClick={() => void deliverFile(new Blob([s.data], { type: 'application/json' }), `calame-copie-securite-${s.id}.calame`)}
                >
                  Exporter
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel-section">
        <h3>Confidentialité et autres appareils</h3>
        <p className="small">
          Calame n'utilise aucun serveur ni base de données : vos notes ne quittent jamais cet appareil et personne d'autre n'y a accès en ouvrant
          l'adresse du site. Pour les retrouver sur un autre appareil, exportez une sauvegarde dans iCloud Drive puis restaurez-la là-bas.
        </p>
      </section>
    </Modal>
  );
}
