export type Tool = 'pen' | 'highlighter' | 'eraser' | 'lasso';

export type TouchMode = 'auto' | 'navigate' | 'draw';

export interface InkSettings {
  /**
   * Comportement du doigt :
   * - auto : le doigt dessine tant qu'aucun stylet n'a été détecté, puis navigue ;
   * - navigate : « stylet pour écrire, doigts pour naviguer » ;
   * - draw : le doigt dessine aussi (deux doigts pour naviguer).
   */
  touchMode: TouchMode;
  handedness: 'right' | 'left';
  /** Sensibilité à la pression 0..1. */
  pressure: number;
  /** Lissage 0..1. */
  smoothing: number;
  /** Influence de l'inclinaison 0..1. */
  tilt: number;
  eraserMode: 'stroke' | 'partial';
  /** Rayon de la gomme en px écran (indépendant du zoom). */
  eraserSize: number;
  /** Gomme : effacer aussi les surligneurs uniquement (false = tout). */
  eraseHighlighterOnly: boolean;
  twoFingerTapUndo: boolean;
  /** Ignore les contacts très larges (paume) quand le doigt dessine. */
  palmHeuristic: boolean;
  /** Affiche les points prédits par le navigateur pendant le tracé. */
  prediction: boolean;
  showPerf: boolean;
}

export const DEFAULT_SETTINGS: InkSettings = {
  touchMode: 'auto',
  handedness: 'right',
  pressure: 0.6,
  smoothing: 0.4,
  tilt: 0,
  eraserMode: 'stroke',
  eraserSize: 14,
  eraseHighlighterOnly: false,
  twoFingerTapUndo: true,
  palmHeuristic: true,
  prediction: true,
  showPerf: false,
};

export interface PenStyle {
  color: string;
  width: number;
}

export interface ToolStyles {
  pen: PenStyle;
  highlighter: PenStyle;
}

export const DEFAULT_TOOL_STYLES: ToolStyles = {
  pen: { color: '#1d2433', width: 2.4 },
  highlighter: { color: '#f2c94c', width: 18 },
};

export const PEN_WIDTHS = [1.4, 2.4, 3.6, 5.5];
export const HIGHLIGHTER_WIDTHS = [12, 18, 26];

export const INK_COLORS = [
  '#1d2433', // encre
  '#2f5aa8', // bleu
  '#c0392b', // rouge
  '#2e7d4f', // vert
  '#7b4bb3', // violet
  '#e08a1e', // orange
  '#f2efe8', // blanc cassé (papier sombre)
];

export const HIGHLIGHTER_COLORS = ['#f2c94c', '#7fd18b', '#7cc4f2', '#f29bd0', '#f5a25d'];

/** Conversion réglages → paramètres figés dans le style du trait. */
export function strokeStyleFrom(s: InkSettings, realPressure: boolean) {
  return {
    thinning: Math.round(s.pressure * 0.8 * 100) / 100,
    streamline: Math.round(s.smoothing * 0.75 * 100) / 100,
    tilt: Math.round(s.tilt * 100) / 100,
    realPressure,
  };
}
