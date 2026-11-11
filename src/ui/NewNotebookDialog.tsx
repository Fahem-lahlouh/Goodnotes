import { useState } from 'react';
import { PAGE_FORMATS, pageSize, type CoverPattern, type Orientation, type PageFormat, type PaperColor, type PaperKind, type PaperSpec } from '../model/types';
import { PAPER_COLOR_LABELS, PAPER_KINDS } from '../ink/paper';
import { Cover, CoverPicker, PaperThumb } from './Cover';
import { Icon } from './icons';

export interface NewNotebookChoice {
  title: string;
  cover: string;
  coverPattern: CoverPattern;
  paper: PaperSpec;
  format: PageFormat;
  orientation: Orientation;
}

const FORMATS: PageFormat[] = ['A4', 'A5', 'A6', 'A7', 'A3', 'letter', 'tabloid'];
const GROUPS = Array.from(new Set(PAPER_KINDS.map((k) => k.group)));

/** Création d'un carnet : titre, couverture, format, orientation, couleur et modèle de papier. */
export function NewNotebookDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (c: NewNotebookChoice) => void }) {
  const [title, setTitle] = useState('');
  const [cover, setCover] = useState({ color: 'nuit', pattern: 'band' as CoverPattern });
  const [kind, setKind] = useState<PaperKind>('lined');
  const [color, setColor] = useState<PaperColor>('white');
  const [spacing, setSpacing] = useState(32);
  const [format, setFormat] = useState<PageFormat>('A4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [pickCover, setPickCover] = useState(false);
  const size = pageSize(format, orientation);
  const paper: PaperSpec = { kind, color, spacing };
  const submit = () => onCreate({ title: title || 'Sans titre', cover: cover.color, coverPattern: cover.pattern, paper, format, orientation });

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-create" role="dialog" aria-modal="true" aria-label="Nouveau carnet">
        <div className="create-side">
          <label className="field">
            <span>Titre</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Carnet sans titre"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              maxLength={120}
              aria-label="Titre du carnet"
            />
          </label>
          <div className="field">
            <span>Couverture</span>
            <button className="cover-preview-btn" onClick={() => setPickCover((v) => !v)} aria-expanded={pickCover} aria-label="Changer la couverture">
              <Cover color={cover.color} pattern={cover.pattern} title={title || 'Carnet sans titre'} />
            </button>
          </div>
          <div className="field">
            <span>Papier</span>
            <div className="paper-preview">
              <PaperThumb paper={paper} width={size.width} height={size.height} size={150} />
            </div>
          </div>
        </div>
        <div className="create-main">
          <div className="create-filters">
            <label className="select-pill">
              <Icon name="notebook" size={16} />
              <select value={format} onChange={(e) => setFormat(e.target.value as PageFormat)} aria-label="Format de page">
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {PAGE_FORMATS[f].label}
                  </option>
                ))}
              </select>
            </label>
            <div className="seg seg-compact" role="radiogroup" aria-label="Couleur du papier">
              {PAPER_COLOR_LABELS.map((c) => (
                <button key={c.id} role="radio" aria-checked={color === c.id} className={color === c.id ? 'is-on' : ''} onClick={() => setColor(c.id)}>
                  <span className={`paper-dot paper-${c.id}`} /> {c.label}
                </button>
              ))}
            </div>
            <div className="seg seg-compact" role="radiogroup" aria-label="Orientation">
              <button role="radio" aria-checked={orientation === 'portrait'} className={orientation === 'portrait' ? 'is-on' : ''} onClick={() => setOrientation('portrait')} aria-label="Portrait" title="Portrait">
                <span className="orient orient-p" />
              </button>
              <button role="radio" aria-checked={orientation === 'landscape'} className={orientation === 'landscape' ? 'is-on' : ''} onClick={() => setOrientation('landscape')} aria-label="Paysage" title="Paysage">
                <span className="orient orient-l" />
              </button>
            </div>
          </div>
          {pickCover ? (
            <div className="create-gallery">
              <h3>Couverture</h3>
              <CoverPicker color={cover.color} pattern={cover.pattern} onChange={(c) => setCover(c)} />
              <button className="btn btn-small" onClick={() => setPickCover(false)}>
                <Icon name="check" size={16} /> Terminé
              </button>
            </div>
          ) : (
            <div className="create-gallery" role="radiogroup" aria-label="Modèle de papier">
              {GROUPS.map((g) => (
                <section key={g}>
                  <h3>{g}</h3>
                  <div className="template-row">
                    {PAPER_KINDS.filter((k) => k.group === g).map((k) => (
                      <button key={k.id} role="radio" aria-checked={kind === k.id} className={`template${kind === k.id ? ' is-on' : ''}`} onClick={() => setKind(k.id)}>
                        <PaperThumb paper={{ kind: k.id, color, spacing }} width={size.width} height={size.height} size={96} />
                        <span>{k.label}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              <label className="field-inline">
                Espacement des lignes
                <input type="range" min={20} max={48} step={2} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} aria-label="Espacement des lignes" />
                <span className="muted">{spacing}</span>
              </label>
            </div>
          )}
          <footer className="modal-foot">
            <button className="btn btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button className="btn btn-primary" onClick={submit}>
              Créer le carnet
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
