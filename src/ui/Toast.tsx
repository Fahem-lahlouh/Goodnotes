import { useEffect, useState } from 'react';

interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'error';
  action?: ToastAction;
  duration: number;
}

let nextId = 1;
const listeners = new Set<(t: ToastItem) => void>();
const dismissers = new Set<(id: number) => void>();

/** Message bref ; avec `action`, un bouton (ex. « Garder le tracé libre ») reste affiché plus longtemps. */
export function toast(text: string, kind: ToastItem['kind'] = 'info', opts?: { action?: ToastAction; duration?: number }): number {
  const t: ToastItem = { id: nextId++, text, kind, action: opts?.action, duration: opts?.duration ?? (opts?.action ? 6000 : kind === 'error' ? 7000 : 3200) };
  for (const l of listeners) l(t);
  return t.id;
}

export function dismissToast(id: number): void {
  for (const d of dismissers) d(id);
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const remove = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id));
    const l = (t: ToastItem) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => remove(t.id), t.duration);
    };
    listeners.add(l);
    dismissers.add(remove);
    return () => {
      listeners.delete(l);
      dismissers.delete(remove);
    };
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}${t.action ? ' has-action' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span>{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                setItems((xs) => xs.filter((x) => x.id !== t.id));
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
