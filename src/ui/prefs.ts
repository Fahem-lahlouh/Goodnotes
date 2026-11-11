import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, DEFAULT_TOOL_STYLES, type InkSettings, type Tool, type ToolStyles } from '../ink/settings';

/**
 * Préférences propres à cet appareil (localStorage).
 * Ce ne sont PAS des données de notes : leur perte n'a pas de conséquence grave.
 */
export interface Prefs {
  settings: InkSettings;
  styles: ToolStyles;
  tool: Tool;
  penDetected: boolean;
  theme: 'system' | 'light' | 'dark';
  toolbar: 'top' | 'bottom' | 'left' | 'right';
  favoriteColors: string[];
}

const KEY = 'calame:prefs:v1';

export const DEFAULT_PREFS: Prefs = {
  settings: DEFAULT_SETTINGS,
  styles: DEFAULT_TOOL_STYLES,
  tool: 'pen',
  penDetected: false,
  theme: 'system',
  toolbar: 'top',
  favoriteColors: ['#1d2433', '#2f5aa8', '#c0392b'],
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      ...DEFAULT_PREFS,
      ...p,
      settings: { ...DEFAULT_SETTINGS, ...p.settings },
      styles: {
        pen: { ...DEFAULT_TOOL_STYLES.pen, ...p.styles?.pen },
        highlighter: { ...DEFAULT_TOOL_STYLES.highlighter, ...p.styles?.highlighter },
      },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* stockage indisponible : préférences non conservées */
  }
}

const listeners = new Set<(p: Prefs) => void>();
let current = loadPrefs();

export function getPrefs(): Prefs {
  return current;
}

export function setPrefs(patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)): void {
  const delta = typeof patch === 'function' ? patch(current) : patch;
  current = { ...current, ...delta };
  savePrefs(current);
  for (const l of listeners) l(current);
}

export function usePrefs(): [Prefs, typeof setPrefs] {
  const [p, setP] = useState(current);
  useEffect(() => {
    listeners.add(setP);
    setP(current);
    return () => {
      listeners.delete(setP);
    };
  }, []);
  return [p, useCallback(setPrefs, [])];
}

/** Vue (zoom + position) mémorisée par carnet, pour reprendre où l'on s'était arrêté. */
export function loadView(notebookId: string): { scale: number; cx: number; cy: number } | null {
  try {
    const raw = localStorage.getItem(`calame:view:${notebookId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveView(notebookId: string, v: { scale: number; cx: number; cy: number }): void {
  try {
    localStorage.setItem(`calame:view:${notebookId}`, JSON.stringify(v));
  } catch {
    /* ignoré */
  }
}

export function applyTheme(theme: Prefs['theme']): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
