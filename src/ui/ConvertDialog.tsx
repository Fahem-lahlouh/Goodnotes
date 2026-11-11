import { useEffect, useMemo, useRef, useState } from 'react';
import type { InkEngine } from '../ink/engine';
import { bboxUnion } from '../ink/geometry';
import type { NotebookSession } from '../model/session';
import {
  RecognitionError,
  loadOcrConfig,
  localAvailable,
  recognize,
  renderInkImage,
  saveOcrConfig,
  suggestedFontSize,
  type OcrConfig,
  type ProviderId,
} from '../recognition/handwriting';
import { Modal } from './Modal';
import { toast } from './Toast';
import type { Prefs } from './prefs';

const PROVIDER_INFO: Record<ProviderId, { label: string; detail: string }> = {
  manual: {
    label: 'Saisie manuelle',
    detail: 'Aucun service. Tapez le texte, ou sur iPad écrivez au Pencil dans le champ : Scribble le convertit localement (français pris en charge).',
  },
  local: {
    label: 'Reconnaissance du navigateur (locale)',
    detail: 'Rien ne quitte l’appareil. Disponible seulement dans certains navigateurs Chromium qui proposent le français ; pas sur Safari / iPad.',
  },
  google: {
    label: 'Google Cloud Vision (votre clé)',
    detail:
      'Envoie une image des traits sélectionnés à Google, rien d’autre. 1 000 images gratuites par mois, puis environ 1,50 $ les 1 000 (tarif Google, à vérifier) ; Google exige un compte de facturation actif. Nécessite une connexion.',
  },
};

/**
 * Conversion de l'écriture sélectionnée en texte : reconnaissance (si un service est choisi),
 * puis vérification et correction AVANT de remplacer les traits. Le remplacement est une
 * seule action, annulable (l'annulation restaure l'écriture).
 */
export function ConvertDialog({
  engine,
  session,
  prefs,
  onClose,
}: {
  engine: InkEngine;
  session: NotebookSession;
  prefs: Prefs;
  onPrefs: (p: Partial<Prefs>) => void;
  onClose: () => void;
}) {
  const strokes = useMemo(() => engine.selectedStrokes().filter((s) => s.tool !== 'highlighter'), [engine]);
  const bbox = useMemo(() => bboxUnion(strokes.map((s) => s.bbox)), [strokes]);
  const preview = useMemo(() => (strokes.length ? renderInkImage(strokes, { maxSide: 900 }).canvas.toDataURL('image/png') : ''), [strokes]);
  const [cfg, setCfg] = useState<OcrConfig>(loadOcrConfig);
  const [local, setLocal] = useState<boolean | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [size, setSize] = useState<number | null>(null);
  const [showService, setShowService] = useState(false);
  const [keyDraft, setKeyDraft] = useState(cfg.googleKey);
  const abort = useRef<AbortController | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void localAvailable().then(setLocal);
  }, []);

  const run = async (c: OcrConfig) => {
    if (c.provider === 'manual' || !strokes.length) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    setError(null);
    try {
      const r = await recognize(strokes, c, ac.signal);
      if (ac.signal.aborted) return;
      setText(r.text);
      setAlternatives(r.alternatives);
      textRef.current?.focus();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(e instanceof RecognitionError ? e.message : `Échec de la reconnaissance : ${(e as Error).message}`);
    } finally {
      if (abort.current === ac) setBusy(false);
    }
  };

  // Reconnaissance lancée à l'ouverture si un service a été choisi (l'utilisateur vient de demander la conversion).
  useEffect(() => {
    void run(cfg);
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (p: ProviderId) => {
    const next = { ...cfg, provider: p, googleKey: keyDraft.trim() };
    setCfg(next);
    saveOcrConfig(next);
    setError(null);
  };

  const fontSize = size ?? (bbox ? suggestedFontSize(bbox, text || 'x') : prefs.textStyle.size);

  const replace = () => {
    const clean = text.trim();
    if (!clean || !bbox || !strokes.length) return;
    const page = session.pages.get(strokes[0].pageId);
    const x = Math.max(0, bbox[0]);
    const maxW = page ? page.width - x - 8 : 600;
    const w = Math.max(120, Math.min(maxW, (bbox[2] - bbox[0]) * 1.15));
    const id = engine.replaceStrokesWithText(
      strokes[0].pageId,
      strokes.map((s) => s.id),
      text,
      { ...prefs.textStyle, size: fontSize },
      { x, y: Math.max(0, bbox[1]), w },
    );
    if (!id) {
      toast('Conversion impossible (carnet en lecture seule ?).', 'error');
      return;
    }
    toast('Écriture convertie en texte. « Annuler » restaure les traits.');
    onClose();
  };

  if (!strokes.length) {
    return (
      <Modal title="Convertir en texte" onClose={onClose}>
        <p>Sélectionnez de l’écriture (lasso ou rectangle) puis touchez « Convertir en texte ».</p>
      </Modal>
    );
  }

  const info = PROVIDER_INFO[cfg.provider];
  return (
    <Modal
      title="Convertir en texte"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={replace} disabled={!text.trim() || busy}>
            Remplacer les traits
          </button>
        </>
      }
    >
      <div className="convert">
        <figure className="convert-ink">
          <img src={preview} alt={`Écriture sélectionnée (${strokes.length} trait${strokes.length > 1 ? 's' : ''})`} />
        </figure>
        <div className="convert-service small">
          <span>
            Service : <strong>{info.label}</strong>
          </span>
          <button className="btn btn-small btn-ghost" onClick={() => setShowService((v) => !v)} aria-expanded={showService}>
            {showService ? 'Masquer' : 'Changer'}
          </button>
          {cfg.provider !== 'manual' && (
            <button className="btn btn-small" onClick={() => void run({ ...cfg, googleKey: keyDraft.trim() })} disabled={busy}>
              {busy ? 'Reconnaissance…' : 'Relancer'}
            </button>
          )}
        </div>
        {showService && (
          <fieldset className="convert-providers">
            <legend className="sr-only">Service de reconnaissance</legend>
            {(Object.keys(PROVIDER_INFO) as ProviderId[]).map((p) => (
              <label key={p} className={`radio-card${cfg.provider === p ? ' is-on' : ''}`}>
                <input type="radio" name="ocr-provider" checked={cfg.provider === p} disabled={p === 'local' && local === false} onChange={() => choose(p)} />
                <span>
                  <strong>{PROVIDER_INFO[p].label}</strong>
                  {p === 'local' && local === false && <em className="muted"> — indisponible dans ce navigateur</em>}
                  <span className="small muted">{PROVIDER_INFO[p].detail}</span>
                </span>
              </label>
            ))}
            {cfg.provider === 'google' && (
              <div className="convert-key">
                <label className="small" htmlFor="ocr-key">
                  Clé API Google Cloud (restreinte à l’API Vision, conservée uniquement sur cet appareil)
                </label>
                <div className="row">
                  <input
                    id="ocr-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder="Clé API"
                  />
                  <button
                    className="btn btn-small btn-primary"
                    onClick={() => {
                      const next = { ...cfg, googleKey: keyDraft.trim() };
                      setCfg(next);
                      saveOcrConfig(next);
                      void run(next);
                    }}
                    disabled={!keyDraft.trim() || busy}
                  >
                    Enregistrer et reconnaître
                  </button>
                </div>
              </div>
            )}
          </fieldset>
        )}
        {busy && cfg.provider === 'google' && <p className="small muted">Envoi d’une image des traits sélectionnés à Google Cloud Vision…</p>}
        {error && (
          <p className="convert-error small" role="alert">
            {error}
          </p>
        )}
        <label className="convert-label" htmlFor="convert-text">
          Texte — vérifiez et corrigez avant de remplacer
        </label>
        <textarea
          id="convert-text"
          ref={textRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={Math.min(8, Math.max(3, text.split('\n').length + 1))}
          lang="fr"
          spellCheck
          placeholder={cfg.provider === 'manual' ? 'Tapez le texte (ou écrivez-le ici au Pencil avec Scribble)' : busy ? 'Reconnaissance en cours…' : 'Texte reconnu'}
        />
        {alternatives.length > 0 && (
          <div className="convert-alts small">
            Autres propositions :
            {alternatives.map((a) => (
              <button key={a} className="btn btn-small btn-ghost" onClick={() => setText(a)}>
                {a}
              </button>
            ))}
          </div>
        )}
        <div className="convert-size small">
          <span>Taille du texte</span>
          <button className="icon-btn sm" onClick={() => setSize(Math.max(8, fontSize - 2))} aria-label="Texte plus petit">
            −
          </button>
          <span aria-live="polite">{fontSize}</span>
          <button className="icon-btn sm" onClick={() => setSize(Math.min(72, fontSize + 2))} aria-label="Texte plus grand">
            +
          </button>
          {size !== null && (
            <button className="btn btn-small btn-ghost" onClick={() => setSize(null)}>
              Auto
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
