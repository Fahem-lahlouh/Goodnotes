import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COVERS, DEFAULT_PAPER, coverColor, type Notebook, type PaperSpec } from '../model/types';
import { repo } from '../storage/repo';
import { broadcast, onBroadcast } from '../storage/openNotebook';
import {
  backupFileName,
  deliverFile,
  exportBackup,
  parseBackup,
  restoreBackup,
  serializeBackup,
} from '../storage/backup';
import { formatBytes, isStandalone, requestPersistence, storageInfo, type StorageInfo } from '../storage/quota';
import { Icon, Logo } from './icons';
import { Confirm, Modal } from './Modal';
import { PaperPicker } from './PaperPicker';
import { toast } from './Toast';
import { usePrefs } from './prefs';
import { BACKUP_STALE_DAYS, backupAgeDays, exportFullBackup, useLastBackup } from './backupStatus';

type Filter = 'all' | 'favorites' | 'trash';

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

export function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const [notebooks, setNotebooks] = useState<Notebook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Notebook | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Notebook | null>(null);
  const [showStorage, setShowStorage] = useState(false);

  const load = useCallback(async () => {
    try {
      setNotebooks(await repo.listNotebooks());
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

  const visible = useMemo(() => {
    if (!notebooks) return [];
    const q = query.trim().toLocaleLowerCase('fr');
    return notebooks
      .filter((n) => (filter === 'trash' ? n.trashedAt !== null : n.trashedAt === null))
      .filter((n) => filter !== 'favorites' || n.favorite)
      .filter((n) => !q || n.title.toLocaleLowerCase('fr').includes(q))
      .sort((a, b) => (filter === 'trash' ? (b.trashedAt ?? 0) - (a.trashedAt ?? 0) : b.updatedAt - a.updatedAt));
  }, [notebooks, filter, query]);

  const recents = useMemo(
    () =>
      (notebooks ?? [])
        .filter((n) => n.trashedAt === null)
        .sort((a, b) => b.openedAt - a.openedAt)
        .slice(0, 4),
    [notebooks],
  );

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await changed();
      if (ok) toast(ok);
    } catch (e) {
      toast(`Échec : ${(e as Error).message}`, 'error');
    }
  };

  const exportOne = async (n: Notebook) => {
    const b = await exportBackup([n.id]);
    await deliverFile(serializeBackup(b), backupFileName(slug(n.title)));
  };

  const activeCount = (notebooks ?? []).filter((n) => n.trashedAt === null).length;

  return (
    <div className="library">
      <header className="lib-head safe-top">
        <div className="brand">
          <Logo size={34} />
          <div>
            <h1>Calame</h1>
            <p className="muted small">Vos carnets, sur cet appareil</p>
          </div>
        </div>
        <div className="lib-actions">
          <label className="search">
            <Icon name="search" size={18} />
            <input
              type="search"
              placeholder="Rechercher un carnet"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Rechercher dans les titres"
            />
          </label>
          <button className="btn btn-ghost" onClick={() => setShowStorage(true)} title="Stockage et sauvegardes" aria-label="Stockage et sauvegardes">
            <Icon name="device" size={18} />
            <span className="hide-narrow">Stockage</span>
          </button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={18} />
            Nouveau carnet
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="Filtres">
        {(
          [
            ['all', `Tous (${activeCount})`],
            ['favorites', 'Favoris'],
            ['trash', 'Corbeille'],
          ] as [Filter, string][]
        ).map(([id, label]) => (
          <button key={id} className={filter === id ? 'is-on' : ''} onClick={() => setFilter(id)} aria-pressed={filter === id}>
            {label}
          </button>
        ))}
      </nav>

      <BackupReminder onOpen={() => setShowStorage(true)} hasNotebooks={activeCount > 0} />

      {error && (
        <div className="callout callout-error" role="alert">
          <Icon name="alert" size={18} /> {error}
        </div>
      )}

      {notebooks === null && !error && <div className="loading">Chargement…</div>}

      {filter === 'all' && !query && recents.length > 1 && (
        <section aria-label="Récents">
          <h2 className="section-title">Récents</h2>
          <div className="recent-row">
            {recents.map((n) => (
              <button key={n.id} className="recent" onClick={() => onOpen(n.id)}>
                <span className="recent-dot" style={{ background: coverColor(n.cover) }} />
                <span className="recent-title">{n.title}</span>
                <span className="muted small">{relative(n.openedAt)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {notebooks !== null && visible.length === 0 && (
        <div className="empty">
          {filter === 'trash' ? (
            <p>La corbeille est vide.</p>
          ) : query ? (
            <p>Aucun carnet ne correspond à « {query} ».</p>
          ) : filter === 'favorites' ? (
            <p>Aucun favori. Touchez ⋯ sur un carnet puis « Ajouter aux favoris ».</p>
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

      <section className="grid" aria-label="Carnets">
        {visible.map((n) => (
          <article key={n.id} className="nb-card">
            <button
              className="cover"
              style={{ ['--cover' as string]: coverColor(n.cover) }}
              onClick={() => (n.trashedAt ? undefined : onOpen(n.id))}
              disabled={n.trashedAt !== null}
              aria-label={`Ouvrir ${n.title}`}
            >
              <span className="cover-band" />
              <span className="cover-title">{n.title}</span>
              {n.favorite && <Icon name="star" size={16} className="cover-star" fill="currentColor" />}
            </button>
            <div className="nb-meta">
              <div>
                <div className="nb-title" title={n.title}>
                  {n.title}
                </div>
                <div className="muted small">
                  {n.pageIds.length} page{n.pageIds.length > 1 ? 's' : ''} · {relative(n.updatedAt)}
                </div>
              </div>
              <div className="menu-anchor">
                <button className="icon-btn" aria-label={`Actions pour ${n.title}`} aria-haspopup="menu" onClick={() => setMenuFor(menuFor === n.id ? null : n.id)}>
                  <Icon name="more" size={20} />
                </button>
                {menuFor === n.id && (
                  <Menu onClose={() => setMenuFor(null)}>
                    {n.trashedAt === null ? (
                      <>
                        <MenuItem icon="pen" onClick={() => setRenaming(n)}>
                          Renommer
                        </MenuItem>
                        <MenuItem
                          icon="star"
                          onClick={() => act(() => repo.updateNotebook(n.id, (x) => void (x.favorite = !x.favorite)))}
                        >
                          {n.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                        </MenuItem>
                        <MenuItem icon="download" onClick={() => void exportOne(n).catch((e) => toast(e.message, 'error'))}>
                          Exporter ce carnet
                        </MenuItem>
                        <MenuItem
                          icon="trash"
                          danger
                          onClick={() =>
                            act(() => repo.updateNotebook(n.id, (x) => void (x.trashedAt = Date.now())), 'Carnet placé dans la corbeille')
                          }
                        >
                          Mettre à la corbeille
                        </MenuItem>
                      </>
                    ) : (
                      <>
                        <MenuItem icon="restore" onClick={() => act(() => repo.updateNotebook(n.id, (x) => void (x.trashedAt = null)), 'Carnet restauré')}>
                          Restaurer
                        </MenuItem>
                        <MenuItem icon="trash" danger onClick={() => setConfirmDelete(n)}>
                          Supprimer définitivement
                        </MenuItem>
                      </>
                    )}
                  </Menu>
                )}
              </div>
            </div>
          </article>
        ))}
      </section>

      {creating && (
        <NewNotebookDialog
          onClose={() => setCreating(false)}
          onCreate={async (title, cover, paper) => {
            try {
              const nb = await repo.createNotebook({ title, cover, paper });
              broadcast({ type: 'library' });
              setCreating(false);
              onOpen(nb.id);
            } catch (e) {
              toast(`Création impossible : ${(e as Error).message}`, 'error');
            }
          }}
        />
      )}

      {renaming && (
        <RenameDialog
          initial={renaming.title}
          onClose={() => setRenaming(null)}
          onSave={(t) => {
            const id = renaming.id;
            setRenaming(null);
            void act(() => repo.updateNotebook(id, (x) => void (x.title = t.trim() || 'Sans titre')));
          }}
        />
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

      {showStorage && <StorageDialog onClose={() => setShowStorage(false)} onRestored={changed} />}
    </div>
  );
}

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

function Menu({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    setTimeout(() => window.addEventListener('pointerdown', h), 0);
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('pointerdown', h);
      window.removeEventListener('keydown', k);
    };
  }, [onClose]);
  return (
    <div className="menu" role="menu" ref={ref} onClick={onClose}>
      {children}
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button role="menuitem" className={`menu-item${danger ? ' danger' : ''}`} onClick={onClick}>
      <Icon name={icon} size={18} />
      {children}
    </button>
  );
}

function NewNotebookDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (title: string, cover: string, paper: PaperSpec) => void;
}) {
  const [title, setTitle] = useState('');
  const [cover, setCover] = useState(COVERS[0].id);
  const [paper, setPaper] = useState<PaperSpec>(DEFAULT_PAPER);
  const submit = () => onCreate(title || 'Sans titre', cover, paper);
  return (
    <Modal
      title="Nouveau carnet"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={submit}>
            Créer
          </button>
        </>
      }
    >
      <label className="field">
        <span>Titre</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex. Révisions Java — Collections"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          maxLength={120}
        />
      </label>
      <div className="field">
        <span>Couverture</span>
        <div className="cover-row" role="radiogroup" aria-label="Couverture">
          {COVERS.map((c) => (
            <button
              key={c.id}
              role="radio"
              aria-checked={cover === c.id}
              aria-label={c.label}
              title={c.label}
              className={`cover-chip${cover === c.id ? ' is-on' : ''}`}
              style={{ background: c.color }}
              onClick={() => setCover(c.id)}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <span>Papier</span>
        <PaperPicker value={paper} onChange={setPaper} />
      </div>
    </Modal>
  );
}

function RenameDialog({ initial, onClose, onSave }: { initial: string; onClose: () => void; onSave: (t: string) => void }) {
  const [t, setT] = useState(initial);
  return (
    <Modal
      title="Renommer"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={() => onSave(t)}>
            Enregistrer
          </button>
        </>
      }
    >
      <label className="field">
        <span>Titre</span>
        <input value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSave(t)} maxLength={120} />
      </label>
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
        {last ? `Dernière sauvegarde exportée il y a ${Math.floor(days)} jours.` : "Aucune sauvegarde exportée pour l'instant."} Le
        stockage du navigateur n'est pas une sauvegarde garantie.
      </span>
      <button className="btn btn-small" onClick={onOpen}>
        Sauvegarder
      </button>
    </div>
  );
}

function StorageDialog({ onClose, onRestored }: { onClose: () => void; onRestored: () => Promise<void> }) {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<number | null>(null);
  const [prefs, setPrefs] = usePrefs();
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setInfo(await storageInfo());
    setLast((await repo.getMeta<number>('lastBackupAt')) ?? null);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doExport = async () => {
    setBusy(true);
    try {
      await exportFullBackup();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file: File) => {
    setBusy(true);
    try {
      const b = parseBackup(await file.text());
      const r = await restoreBackup(b);
      await onRestored();
      toast(
        `Restauration : ${r.notebooks} carnet(s), ${r.pages} page(s), ${r.strokes} trait(s)` +
          (r.copies ? ` — ${r.copies} importé(s) comme copie pour ne rien écraser.` : '.'),
      );
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const pct = info?.usage != null && info.quota ? Math.min(100, (info.usage / info.quota) * 100) : null;

  return (
    <Modal title="Stockage et sauvegardes" onClose={onClose} wide>
      <section className="panel-section">
        <h3>Sur cet appareil</h3>
        <p>
          Utilisé : <strong>{formatBytes(info?.usage ?? null)}</strong> sur {formatBytes(info?.quota ?? null)} disponibles
          (estimation du navigateur).
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
        <p className="small muted">
          Le stockage du navigateur peut être effacé (réglages Safari, manque d'espace, suppression de l'app). Exportez
          régulièrement une sauvegarde dans Fichiers ou iCloud Drive.
        </p>
      </section>
      <section className="panel-section">
        <h3>Sauvegarde complète</h3>
        <p className="small">
          Dernière exportation : <strong>{last ? new Date(last).toLocaleString('fr-FR') : 'jamais'}</strong>
        </p>
        <div className="row">
          <button className="btn btn-primary" onClick={doExport} disabled={busy}>
            <Icon name="download" size={18} /> Exporter une sauvegarde
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Icon name="upload" size={18} /> Restaurer…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".calame,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void doImport(f);
            }}
          />
        </div>
        <p className="small muted">
          La restauration n'écrase jamais un carnet existant : un carnet déjà présent est importé comme copie « (restauré) ».
        </p>
      </section>
      <section className="panel-section">
        <h3>Apparence</h3>
        <div className="seg" role="radiogroup" aria-label="Thème">
          {(
            [
              ['system', 'Système'],
              ['light', 'Clair'],
              ['dark', 'Sombre'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="radio" aria-checked={prefs.theme === id} className={prefs.theme === id ? 'is-on' : ''} onClick={() => setPrefs({ theme: id })}>
              {label}
            </button>
          ))}
        </div>
      </section>
      <section className="panel-section">
        <h3>Confidentialité et autres appareils</h3>
        <p className="small">
          Calame n'utilise aucun serveur ni base de données : vos notes ne quittent jamais cet appareil et personne d'autre
          n'y a accès en ouvrant l'adresse du site. Pour les retrouver sur un autre appareil, exportez une sauvegarde
          dans iCloud Drive puis restaurez-la là-bas.
        </p>
      </section>
    </Modal>
  );
}
