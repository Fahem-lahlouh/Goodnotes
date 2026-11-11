import { useCallback, useEffect, useState } from 'react';
import { isStandalone } from '../storage/quota';

/**
 * Trois notions distinctes :
 *  - plein écran du navigateur (API Fullscreen) : masque l'interface du navigateur, quitte par Échap ;
 *  - mode application (PWA lancée depuis l'écran d'accueil) : pas d'interface de navigateur du tout ;
 *  - mode concentration (propre à Calame) : masque la barre du carnet, garde les outils.
 * Safari sur iPhone ne permet pas le plein écran d'une page ; sur iPad, la prise en charge dépend de la
 * version d'iPadOS : elle est détectée, jamais supposée.
 */
type FsDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

export function fullscreenSupported(): boolean {
  const d = document as FsDoc;
  return Boolean(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
}

export async function enterFullscreen(el: HTMLElement = document.documentElement): Promise<boolean> {
  const e = el as FsEl;
  try {
    if (e.requestFullscreen) await e.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
    else if (e.webkitRequestFullscreen) e.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  const d = document as FsDoc;
  try {
    if (d.exitFullscreen && d.fullscreenElement) await d.exitFullscreen();
    else if (d.webkitExitFullscreen && d.webkitFullscreenElement) d.webkitExitFullscreen();
  } catch {
    /* déjà sorti */
  }
}

export function useFullscreen(): { supported: boolean; active: boolean; standalone: boolean; toggle: () => Promise<boolean> } {
  const [active, setActive] = useState(isFullscreen());
  useEffect(() => {
    const h = () => setActive(isFullscreen());
    document.addEventListener('fullscreenchange', h);
    document.addEventListener('webkitfullscreenchange', h);
    return () => {
      document.removeEventListener('fullscreenchange', h);
      document.removeEventListener('webkitfullscreenchange', h);
    };
  }, []);
  const toggle = useCallback(async () => {
    if (isFullscreen()) {
      await exitFullscreen();
      return true;
    }
    return enterFullscreen();
  }, []);
  return { supported: fullscreenSupported(), active, standalone: isStandalone(), toggle };
}
