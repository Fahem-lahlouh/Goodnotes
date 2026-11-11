import type { InkSettings } from '../ink/settings';
import { detectCapabilities } from '../ink/input';
import { isStandalone } from '../storage/quota';
import { fullscreenSupported } from './fullscreen';
import { Icon } from './icons';
import { Modal } from './Modal';
import type { Prefs } from './prefs';

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

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([id, l]) => (
        <button key={id} role="radio" aria-checked={value === id} className={value === id ? 'is-on' : ''} onClick={() => onChange(id)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function SettingsPanel({ prefs, onPrefs, onClose }: { prefs: Prefs; onPrefs: (p: Partial<Prefs>) => void; onClose: () => void }) {
  const s = prefs.settings;
  const set = (patch: Partial<InkSettings>) => onPrefs({ settings: { ...s, ...patch } });
  const caps = detectCapabilities();
  return (
    <Modal title="Réglages" onClose={onClose} wide>
      <section className="panel-section">
        <h3>Écriture au doigt</h3>
        <Seg
          label="Comportement du doigt"
          value={s.fingerMode}
          options={[
            ['pen-only', 'Stylet uniquement'],
            ['finger-and-pen', 'Doigt et stylet'],
          ]}
          onChange={(v) => set({ fingerMode: v })}
        />
        <p className="small muted">
          {s.fingerMode === 'pen-only'
            ? 'Le stylet écrit. Un doigt fait défiler et tourne les pages, deux doigts zooment.'
            : 'Le doigt écrit comme le stylet. Deux doigts font défiler, zoomer et tourner les pages.'}{' '}
          Raccourci : bouton « Doigt » de la barre d'outils.
        </p>
        <Seg
          label="Main d'écriture"
          value={s.handedness}
          options={[
            ['right', 'Droitier'],
            ['left', 'Gaucher'],
          ]}
          onChange={(v) => set({ handedness: v })}
        />
        <Toggle
          label="Ignorer les contacts très larges (paume)"
          checked={s.palmHeuristic}
          onChange={(v) => set({ palmHeuristic: v })}
          hint="Utile quand le doigt écrit. Pendant un tracé au stylet, tout contact du doigt est déjà ignoré. Le rejet de paume n'est pas garanti sans essai sur votre iPad."
        />
        <Toggle label="Toucher à deux doigts pour annuler, trois pour rétablir" checked={s.twoFingerTapUndo} onChange={(v) => set({ twoFingerTapUndo: v })} />
      </section>

      <section className="panel-section">
        <h3>Pages</h3>
        <Seg
          label="Navigation entre les pages"
          value={s.pageLayout}
          options={[
            ['horizontal', 'Horizontale (balayer)'],
            ['vertical', 'Verticale (défiler)'],
          ]}
          onChange={(v) => set({ pageLayout: v })}
        />
        <p className="small muted">
          Horizontale : une page à la fois, balayez vers la gauche pour la suivante (un doigt en mode stylet, deux doigts sinon). Une page agrandie se déplace
          d'abord ; le changement de page n'a lieu qu'au-delà du bord.
        </p>
        <Seg
          label="Position de la barre d'outils"
          value={prefs.toolbar}
          options={[
            ['top', 'Outils en haut'],
            ['bottom', 'Outils en bas'],
          ]}
          onChange={(v) => onPrefs({ toolbar: v })}
        />
        <Seg
          label="Thème"
          value={prefs.theme}
          options={[
            ['system', 'Thème du système'],
            ['light', 'Clair'],
            ['dark', 'Sombre'],
          ]}
          onChange={(v) => onPrefs({ theme: v })}
        />
      </section>

      <section className="panel-section">
        <h3>Trait</h3>
        <Toggle
          label="Prédiction de trajectoire"
          checked={s.prediction}
          onChange={(v) => set({ prediction: v })}
          hint={caps.predicted ? 'Réduit le retard perçu. Les points prédits ne sont jamais enregistrés.' : 'Non prise en charge par ce navigateur.'}
        />
        <Toggle label="Afficher les mesures de performance" checked={s.showPerf} onChange={(v) => set({ showPerf: v })} />
      </section>

      <section className="panel-section">
        <h3>Formes nettes</h3>
        <Toggle
          label="Maintenir en fin de tracé pour obtenir une forme nette"
          checked={s.shapeHold}
          onChange={(v) => set({ shapeHold: v })}
          hint="Tracez une ligne, un cercle ou un rectangle puis gardez le stylet (ou le doigt) immobile sans le relever : le tracé devient une forme nette. Pour une droite, l'extrémité suit encore le stylet avant de relever. « Garder le tracé libre » ou Annuler revient au tracé d'origine."
        />
        <label className="range-row">
          <span>Délai de maintien</span>
          <input
            type="range"
            min={300}
            max={1500}
            step={50}
            value={s.shapeHoldDelay}
            disabled={!s.shapeHold}
            onChange={(e) => set({ shapeHoldDelay: Number(e.target.value) })}
            aria-label="Délai de maintien avant la forme nette, en millisecondes"
          />
          <output>{(s.shapeHoldDelay / 1000).toFixed(2).replace('.', ',')} s</output>
        </label>
      </section>

      <section className="panel-section">
        <h3>Fenêtre de zoom</h3>
        <p className="small muted">
          Bouton « Fenêtre de zoom » de la barre d'outils (touche Z). Écrivez en grand dans la fenêtre : le texte s'inscrit à la bonne taille dans le cadre bleu de
          la page. Déplacez le cadre par son onglet, redimensionnez-le par sa poignée ; glissez au doigt dans la fenêtre pour le déplacer, pincez pour changer le
          grossissement.
        </p>
        <Toggle
          label="Avance automatique près du bord droit"
          checked={s.zoomAutoAdvance}
          onChange={(v) => set({ zoomAutoAdvance: v })}
          hint="Quand un mot se termine dans la zone bleutée à droite de la fenêtre, le cadre se décale vers la droite."
        />
        <label className="range-row">
          <span>Grossissement</span>
          <input
            type="range"
            min={1.25}
            max={6}
            step={0.25}
            value={s.zoomFactor}
            onChange={(e) => set({ zoomFactor: Number(e.target.value) })}
            aria-label="Grossissement de la fenêtre de zoom"
          />
          <output>×{s.zoomFactor.toFixed(2).replace('.', ',')}</output>
        </label>
      </section>

      <section className="panel-section">
        <h3>Plein écran et mode application</h3>
        <ul className="small diag">
          <li>
            <Icon name="fullscreen" size={14} /> Plein écran du navigateur : {fullscreenSupported() ? 'disponible (bouton dans la barre du carnet)' : 'non disponible dans ce navigateur'}
          </li>
          <li>
            <Icon name="device" size={14} /> Mode application (lancé depuis l'écran d'accueil) : {isStandalone() ? 'oui' : 'non — Safari › Partager › Sur l’écran d’accueil'}
          </li>
          <li>
            <Icon name="focus" size={14} /> Mode concentration : masque la barre du carnet (touche F)
          </li>
        </ul>
      </section>

      <section className="panel-section">
        <h3>Diagnostic de ce navigateur</h3>
        <ul className="small diag">
          <li>Pointer Events : {caps.pointerEvents ? 'oui' : 'non'}</li>
          <li>Événements fusionnés (getCoalescedEvents) : {caps.coalesced ? 'oui' : 'non — repli sur les événements simples'}</li>
          <li>Événements prédits : {caps.predicted ? 'oui' : 'non'}</li>
          <li>Angles altitude/azimut : {caps.altitude ? 'oui' : 'non — repli sur tiltX/tiltY'}</li>
          <li>Stylet détecté : {prefs.penDetected ? 'oui' : 'pas encore'}</li>
          <li>Densité d'écran : {window.devicePixelRatio}×</li>
          <li>
            Version de Calame : <code>{__APP_VERSION__}</code> ({__BUILD_TIME__})
          </li>
        </ul>
      </section>
    </Modal>
  );
}
