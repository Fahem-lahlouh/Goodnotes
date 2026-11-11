import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TOOL_STYLES,
  type Favorite,
  type InkSettings,
  type Tool,
  type ToolStyles,
} from '../ink/settings';
import type { TextStyle } from '../model/types';

/**
 * Préférences propres à cet appareil (localStorage).
 * Ce ne sont PAS des données de notes : leur perte n'a pas de conséquence grave.
 * Chaque outil mémorise sa couleur, son épaisseur et son lissage.
 */
export interface Prefs {
  settings: InkSettings;
  styles: ToolStyles;
  textStyle: TextStyle;
  tool: Tool;
  penDetected: boolean;
  theme: 'system' | 'light' | 'dark';
  toolbar: 'top' | 'bottom';
  favorites: Favorite[];
  customColors: string[];
  librarySort: 'updated' | 'created' | 'title' | 'opened';
}

const KEY = 'calame:prefs:v2';
const OLD_KEY = 'calame:prefs:v1';

export const DEFAULT_PREFS: Prefs = {
  settings: DEFAULT_SETTINGS,
  styles: DEFAULT_TOOL_STYLES,
  textStyle: DEFAULT_TEXT_STYLE,
  tool: 'pen',
  penDetected: false,
  theme: 'system',
  toolbar: 'top',
  favorites: [
    { id: 'f1', tool: 'pen', color: '#1d2433', width: 2.2, smoothing: 0.4 },
    { id: 'f2', tool: 'pen', color: '#c0392b', width: 2.2, smoothing: 0.4 },
    { id: 'f3', tool: 'highlighter', color: '#f2c94c', width: 18, smoothing: 0.5 },
  ],
  customColors: [],
  librarySort: 'updated',
};

type Raw = Partial<Prefs> & {
  settings?: Partial<InkSettings> & { touchMode?: string; eraserSize?: number };
  styles?: Partial<ToolStyles> & { pen?: { color?: string; width?: number } };
  toolbar?: string;
};

/** Reprend les préférences de la version précédente (outil « lasso », mode doigt « auto »…). */
export function normalizePrefs(p: Raw): Prefs {
  const s = { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) } as InkSettings & { touchMode?: string };
  if (p.settings?.touchMode && !('fingerMode' in (p.settings ?? {}))) {
    const tm = p.settings.touchMode;
    s.fingerMode = tm === 'draw' ? 'finger-and-pen' : tm === 'navigate' ? 'pen-only' : p.penDetected ? 'pen-only' : 'finger-and-pen';
  }
  delete s.touchMode;
  const oldPen = p.styles?.pen;
  const styles: ToolStyles = {
    penType: p.styles?.penType ?? 'pen',
    pens: { ...DEFAULT_TOOL_STYLES.pens, ...(p.styles?.pens ?? {}) },
    highlighter: { ...DEFAULT_TOOL_STYLES.highlighter, ...(p.styles?.highlighter ?? {}) },
  };
  if (oldPen && !p.styles?.pens) styles.pens.pen = { ...styles.pens.pen, ...oldPen };
  const tool = (p.tool as string) === 'lasso' ? 'select' : (p.tool ?? 'pen');
  return {
    ...DEFAULT_PREFS,
    ...p,
    settings: s,
    styles,
    textStyle: { ...DEFAULT_TEXT_STYLE, ...(p.textStyle ?? {}) },
    tool: tool as Tool,
    toolbar: p.toolbar === 'bottom' ? 'bottom' : 'top',
    favorites: Array.isArray(p.favorites) ? p.favorites : DEFAULT_PREFS.favorites,
    customColors: Array.isArray(p.customColors) ? p.customColors.slice(0, 10) : [],
  };
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    if (!raw) return DEFAULT_PREFS;
    return normalizePrefs(JSON.parse(raw) as Raw);
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

/** Vue (zoom + position + page) mémorisée par carnet, pour reprendre où l'on s'était arrêté. */
export function loadView(notebookId: string): { scale: number; cx: number; cy: number; page?: number } | null {
  try {
    const raw = localStorage.getItem(`calame:view:${notebookId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveView(notebookId: string, v: { scale: number; cx: number; cy: number; page: number }): void {
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
