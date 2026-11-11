import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { toast } from './Toast';

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Bip court (Web Audio) à la fin du compte à rebours ; silencieux si le navigateur le refuse. */
function beep(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.65);
    o.onended = () => void ctx.close();
  } catch {
    /* audio indisponible */
  }
}

/**
 * Minuteur flottant (équivalent de « Time Keeper ») : chronomètre ou compte à rebours.
 * Le temps est calculé à partir de l'horloge (pas d'accumulation d'intervalles) : il reste juste
 * même si l'onglet a été mis en pause par le système.
 */
export function TimeKeeper({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'chrono' | 'countdown'>('chrono');
  const [running, setRunning] = useState(false);
  const [base, setBase] = useState(0); // temps écoulé (chrono) ou restant (minuteur) au dernier arrêt
  const [duration, setDuration] = useState(5 * 60 * 1000);
  const startedAt = useRef(0);
  const [, tick] = useState(0);
  const fired = useRef(false);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [running]);

  const elapsed = running ? Date.now() - startedAt.current : 0;
  const value = mode === 'chrono' ? base + elapsed : Math.max(0, (base || duration) - elapsed);

  useEffect(() => {
    if (mode === 'countdown' && running && value <= 0 && !fired.current) {
      fired.current = true;
      setRunning(false);
      setBase(0);
      toast('Minuteur terminé');
      beep();
    }
  }, [mode, running, value]);

  const start = () => {
    fired.current = false;
    startedAt.current = Date.now();
    if (mode === 'countdown' && !base) setBase(duration);
    setRunning(true);
  };
  const pause = () => {
    setBase(value);
    setRunning(false);
  };
  const reset = () => {
    setRunning(false);
    setBase(0);
    fired.current = false;
  };
  const switchMode = (m: 'chrono' | 'countdown') => {
    reset();
    setMode(m);
  };

  return (
    <div className="timekeeper" role="group" aria-label="Minuteur">
      <div className="timekeeper-head">
        <div className="seg seg-compact" role="radiogroup" aria-label="Mode du minuteur">
          <button role="radio" aria-checked={mode === 'chrono'} className={mode === 'chrono' ? 'is-on' : ''} onClick={() => switchMode('chrono')}>
            Chrono
          </button>
          <button role="radio" aria-checked={mode === 'countdown'} className={mode === 'countdown' ? 'is-on' : ''} onClick={() => switchMode('countdown')}>
            Minuteur
          </button>
        </div>
        <button className="icon-btn sm" onClick={onClose} aria-label="Fermer le minuteur">
          <Icon name="close" size={16} />
        </button>
      </div>
      <output className="timekeeper-time" aria-live="off" aria-label="Temps">
        {fmt(value)}
      </output>
      <div className="timekeeper-actions">
        {mode === 'countdown' && !running && !base && (
          <>
            <button className="btn btn-small" onClick={() => setDuration((d) => Math.max(60_000, d - 60_000))} aria-label="Une minute de moins">
              −1 min
            </button>
            <button className="btn btn-small" onClick={() => setDuration((d) => d + 60_000)} aria-label="Une minute de plus">
              +1 min
            </button>
          </>
        )}
        {running ? (
          <button className="icon-btn sm" onClick={pause} aria-label="Pause">
            <Icon name="pause" size={18} />
          </button>
        ) : (
          <button className="icon-btn sm" onClick={start} aria-label="Démarrer">
            <Icon name="play" size={18} />
          </button>
        )}
        <button className="icon-btn sm" onClick={reset} aria-label="Remettre à zéro">
          <Icon name="rotate" size={18} />
        </button>
      </div>
    </div>
  );
}
