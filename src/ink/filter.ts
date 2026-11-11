/**
 * Filtrage du tracé à faible latence.
 *
 * Problème de l'ancien lissage (« streamline » de perfect-freehand) : chaque point était tiré
 * d'une fraction FIXE vers le précédent, par échantillon. Le retard et les coins coupés
 * dépendaient donc de la fréquence des événements : à 60 Hz et au réglage par défaut, l'encre
 * traînait de ~12 unités derrière la pointe (mesuré).
 *
 * Filtre « One Euro » (Casiez, Roussel & Vogel, CHI 2012) : passe-bas dont la fréquence de
 * coupure augmente avec la vitesse. Geste lent → fort lissage (supprime le tremblement) ;
 * geste rapide → presque pas de lissage (pas de retard, angles nets). Il dépend du temps réel
 * entre échantillons, pas de leur nombre : même comportement à 60, 120 ou 240 Hz.
 */

export interface FilterParams {
  /** Fréquence de coupure au repos (Hz) : plus basse = plus lisse au ralenti. */
  minCutoff: number;
  /** Augmentation de la coupure avec la vitesse (par unité page/s). */
  beta: number;
  /** Coupure du filtre de dérivée (Hz). */
  dCutoff: number;
}

/** Réglage « lissage » 0..1 → paramètres. Le doigt (moins précis) est lissé un peu plus. */
export function filterParams(smoothing: number, pointerType: string): FilterParams {
  const s = Math.min(1, Math.max(0, smoothing + (pointerType === 'touch' ? 0.25 : 0)));
  return {
    minCutoff: 14 - 12.5 * s, // 14 Hz (brut) → 1,5 Hz (très lissé)
    beta: 0.25 - 0.21 * s, // 0,25 → 0,04
    // Estimation de vitesse réactive (8 Hz) : le lissage se relâche dès que le geste accélère,
    // ce qui préserve les angles (1 Hz, valeur d'origine du filtre, coupait les angles rapides).
    dCutoff: 8,
  };
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/** Filtre 2D (x, y) avec une coupure commune calculée sur la vitesse 2D. */
export class OneEuro2D {
  private x = 0;
  private y = 0;
  private dx = 0;
  private dy = 0;
  private t = -1;

  constructor(private readonly p: FilterParams) {}

  reset(): void {
    this.t = -1;
  }

  /** `tMs` : horodatage en millisecondes. Renvoie la position filtrée. */
  filter(x: number, y: number, tMs: number): [number, number] {
    if (this.t < 0 || this.p.minCutoff >= 1e6) {
      this.x = x;
      this.y = y;
      this.dx = 0;
      this.dy = 0;
      this.t = tMs;
      return [x, y];
    }
    // Échantillons de même horodatage (fréquents avec les événements fusionnés) : 1/240 s par défaut.
    const dt = Math.max(1 / 1000, (tMs - this.t) / 1000 || 1 / 240);
    this.t = tMs;
    const ad = alpha(this.p.dCutoff, dt);
    const rdx = (x - this.x) / dt;
    const rdy = (y - this.y) / dt;
    this.dx = this.dx + ad * (rdx - this.dx);
    this.dy = this.dy + ad * (rdy - this.dy);
    const speed = Math.hypot(this.dx, this.dy);
    const a = alpha(this.p.minCutoff + this.p.beta * speed, dt);
    this.x = this.x + a * (x - this.x);
    this.y = this.y + a * (y - this.y);
    return [this.x, this.y];
  }
}

/** Lissage léger de la pression (évite le scintillement de l'épaisseur). */
export class PressureSmoother {
  private v = -1;
  constructor(private readonly k = 0.45) {}
  next(p: number): number {
    this.v = this.v < 0 ? p : this.v + this.k * (p - this.v);
    return this.v;
  }
}
