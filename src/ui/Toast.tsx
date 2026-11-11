import { useEffect, useState } from 'react';

interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

let nextId = 1;
const listeners = new Set<(t: ToastItem) => void>();

export function toast(text: string, kind: ToastItem['kind'] = 'info'): void {
  const t = { id: nextId++, text, kind };
  for (const l of listeners) l(t);
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const l = (t: ToastItem) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.kind === 'error' ? 7000 : 3200);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
