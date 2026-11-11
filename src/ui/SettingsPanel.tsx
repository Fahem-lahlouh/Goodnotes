import type { InkSettings } from '../ink/settings';
import { detectCapabilities } from '../ink/input';
import { isStandalone } from '../storage/quota';
import { Modal } from './Modal';
import type { Prefs } from './prefs';

function Slider({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>
        {label} <span className="muted small">{Math.round(value * 100)} %</span>
      </span>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      <span>
        {label}
        {hint && <small className="muted block">{hint}</small>}
      </span>
    </label>
  );
}

export function SettingsPanel({
  prefs,
  onPrefs,
  onClose,
}: {
  prefs: Prefs;
  onPrefs: (p: Partial<Prefs>) => void;
  onClose: () => void;
}) {
  const s = prefs.settings;
  const set = (patch: Partial<InkSettings>) => onPrefs({ settings: { ...s, ...patch } });
  const caps = detectCapabilities();
  return (
    <Modal title="Réglages d'écriture" onClose={onClose} wide>
      <section className="panel-section">
        <h3>Doigt et Apple Pencil</h3>
        <div className="seg" role="radiogroup" aria-label="Comportement du doigt">
          {(
            [
              ['auto', 'Automatique'],
              ['navigate', 'Le doigt navigue'],
              ['draw', 'Le doigt écrit'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="radio" aria-checked={s.touchMode === id} className={s.touchMode === id ? 'is-on' : ''} onClick={() => set({ touchMode: id })}>
              {label}
            </button>
          ))}
        </div>
        <p className="small muted">
          Automatique : dès qu'un Apple Pencil est détecté{prefs.penDetected ? ' (c’est le cas sur cet appareil)' : ''}, le stylet écrit et
          les doigts font défiler et zoomer. Deux doigts naviguent toujours.
        </p>
        <div className="seg" role="radiogroup" aria-label="Main d'écriture">
          {(
            [
              ['right', 'Droitier'],
              ['left', 'Gaucher'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="radio"
              aria-checked={s.handedness === id}
              className={s.handedness === id ? 'is-on' : ''}
              onClick={() => {
                set({ handedness: id });
                // Place la barre d'outils du côté opposé à la main qui écrit si elle est latérale.
                if (prefs.toolbar === 'left' || prefs.toolbar === 'right') onPrefs({ settings: { ...s, handedness: id }, toolbar: id === 'right' ? 'left' : 'right' });
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <Toggle
          label="Ignorer les contacts larges (paume)"
          checked={s.palmHeuristic}
          onChange={(v) => set({ palmHeuristic: v })}
          hint="Utile quand le doigt écrit. Quand le stylet écrit, tout contact du doigt pendant le tracé est ignoré."
        />
        <Toggle label="Toucher à deux doigts pour annuler, trois pour rétablir" checked={s.twoFingerTapUndo} onChange={(v) => set({ twoFingerTapUndo: v })} />
      </section>

      <section className="panel-section">
        <h3>Trait</h3>
        <Slider label="Sensibilité à la pression" value={s.pressure} onChange={(v) => set({ pressure: v })} />
        <Slider
          label="Lissage"
          value={s.smoothing}
          onChange={(v) => set({ smoothing: v })}
          hint="Plus le lissage est fort, plus le trait suit la pointe avec un léger retard."
        />
        <Slider label="Effet de l'inclinaison" value={s.tilt} onChange={(v) => set({ tilt: v })} hint="Élargit le trait quand le stylet est incliné." />
        <Toggle
          label="Prédiction de trajectoire"
          checked={s.prediction}
          onChange={(v) => set({ prediction: v })}
          hint={caps.predicted ? 'Réduit le retard perçu. Les points prédits ne sont jamais enregistrés.' : 'Non prise en charge par ce navigateur.'}
        />
      </section>

      <section className="panel-section">
        <h3>Gomme</h3>
        <label className="field">
          <span>
            Taille <span className="muted small">{s.eraserSize} px</span>
          </span>
          <input type="range" min={6} max={48} step={1} value={s.eraserSize} onChange={(e) => set({ eraserSize: Number(e.target.value) })} />
        </label>
        <Toggle label="N'effacer que le surligneur" checked={s.eraseHighlighterOnly} onChange={(v) => set({ eraseHighlighterOnly: v })} />
      </section>

      <section className="panel-section">
        <h3>Interface</h3>
        <div className="seg" role="radiogroup" aria-label="Position de la barre d'outils">
          {(
            [
              ['top', 'En haut'],
              ['bottom', 'En bas'],
              ['left', 'À gauche'],
              ['right', 'À droite'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="radio" aria-checked={prefs.toolbar === id} className={prefs.toolbar === id ? 'is-on' : ''} onClick={() => onPrefs({ toolbar: id })}>
              {label}
            </button>
          ))}
        </div>
        <Toggle label="Afficher les mesures de performance" checked={s.showPerf} onChange={(v) => set({ showPerf: v })} />
      </section>

      <section className="panel-section">
        <h3>Diagnostic de ce navigateur</h3>
        <ul className="small diag">
          <li>Pointer Events : {caps.pointerEvents ? 'oui' : 'non'}</li>
          <li>Événements fusionnés (getCoalescedEvents) : {caps.coalesced ? 'oui' : 'non — repli sur les événements simples'}</li>
          <li>Événements prédits : {caps.predicted ? 'oui' : 'non'}</li>
          <li>Angles altitude/azimut : {caps.altitude ? 'oui' : 'non — repli sur tiltX/tiltY'}</li>
          <li>Apple Pencil détecté : {prefs.penDetected ? 'oui' : 'pas encore'}</li>
          <li>Mode application (écran d'accueil) : {isStandalone() ? 'oui' : 'non'}</li>
          <li>Densité d'écran : {window.devicePixelRatio}×</li>
        </ul>
      </section>
    </Modal>
  );
}
