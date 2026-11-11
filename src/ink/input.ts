/** Extraction des échantillons d'un PointerEvent (avec repli si les API manquent). */

export interface Sample {
  /** Coordonnées écran relatives à la zone de dessin (px CSS). */
  x: number;
  y: number;
  /** 0..1 ; NaN = inconnue (stylet). */
  pressure: number;
  /** 0 = perpendiculaire, 1 = couché. */
  tilt: number;
  time: number;
}

type PE = PointerEvent & {
  altitudeAngle?: number;
  getCoalescedEvents?: () => PointerEvent[];
  getPredictedEvents?: () => PointerEvent[];
};

export function sampleFrom(e: PointerEvent, ox: number, oy: number): Sample {
  const pe = e as PE;
  let tilt = 0;
  if (typeof pe.altitudeAngle === 'number' && e.pointerType === 'pen') {
    // altitudeAngle : π/2 = perpendiculaire (Safari ≥ 18.2, Chrome).
    tilt = 1 - Math.min(1, Math.max(0, pe.altitudeAngle / (Math.PI / 2)));
  } else if (e.tiltX || e.tiltY) {
    tilt = Math.min(1, Math.hypot(e.tiltX, e.tiltY) / 90);
  }
  // Stylet : une pression nulle signifie « inconnue » (souvent le tout premier événement de
  // l'Apple Pencil) → NaN, corrigé par le moteur dès la première vraie valeur (sinon « goutte » au départ).
  let pressure: number;
  if (e.pointerType === 'pen') pressure = e.pressure > 0 ? e.pressure : NaN;
  else pressure = 0.5;
  return { x: e.clientX - ox, y: e.clientY - oy, pressure, tilt, time: e.timeStamp };
}

/** Événements fusionnés par le navigateur entre deux frames (plus de points = trait plus fidèle). */
export function coalesced(e: PointerEvent): PointerEvent[] {
  const pe = e as PE;
  if (typeof pe.getCoalescedEvents === 'function') {
    try {
      const list = pe.getCoalescedEvents();
      if (list && list.length > 0) return list;
    } catch {
      /* repli */
    }
  }
  return [e];
}

/** Points prédits (réduction de la latence perçue) — affichés seulement, jamais enregistrés. */
export function predicted(e: PointerEvent): PointerEvent[] {
  const pe = e as PE;
  if (typeof pe.getPredictedEvents === 'function') {
    try {
      return pe.getPredictedEvents() ?? [];
    } catch {
      return [];
    }
  }
  return [];
}

export interface InputCapabilities {
  pointerEvents: boolean;
  coalesced: boolean;
  predicted: boolean;
  altitude: boolean;
}

export function detectCapabilities(): InputCapabilities {
  const proto = typeof PointerEvent !== 'undefined' ? PointerEvent.prototype : undefined;
  return {
    pointerEvents: !!proto,
    coalesced: !!proto && 'getCoalescedEvents' in proto,
    predicted: !!proto && 'getPredictedEvents' in proto,
    altitude: !!proto && 'altitudeAngle' in proto,
  };
}
