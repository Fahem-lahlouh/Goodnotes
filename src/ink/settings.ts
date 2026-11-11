import type { InkTool, PenType, StrokeStyle, TextStyle } from '../model/types';

/** Outils de l'éditeur. « pen » regroupe bille, plume, pinceau et crayon (voir ToolStyles.penType). */
export type Tool = 'pen' | 'highlighter' | 'eraser' | 'select' | 'text';

/**
 * Comportement du doigt :
 *  - 'pen-only'       : écriture au stylet uniquement, le doigt fait défiler/zoomer/tourner les pages ;
 *  - 'finger-and-pen' : le doigt écrit aussi ; deux doigts pour naviguer.
 */
export type FingerMode = 'pen-only' | 'finger-and-pen';

export type SelectMode = 'lasso' | 'rect' | 'square';
/**
 * Règle d'inclusion d'un objet dans une zone de sélection :
 *  - 'inside'  : l'objet est entièrement dans la zone (tous les points du tracé) ;
 *  - 'contact' : une partie de l'objet touche la zone (point intérieur ou segment qui croise le contour).
 * La géométrie réelle est utilisée, jamais la seule boîte englobante.
 */
export type SelectRule = 'inside' | 'contact';

export type PageLayout = 'horizontal' | 'vertical';

export interface InkSettings {
  fingerMode: FingerMode;
  handedness: 'right' | 'left';
  /** Sensibilité à la pression 0..1 (multiplie l'effet propre à chaque outil). */
  pressure: number;
  /** Influence de l'inclinaison 0..1. */
  tilt: number;
  eraserMode: 'stroke' | 'partial';
  /** Diamètre de la gomme en px écran (constant à l'écran quel que soit le zoom). */
  eraserSize: number;
  eraseHighlighterOnly: boolean;
  selectMode: SelectMode;
  selectRule: SelectRule;
  selectStrokes: boolean;
  selectText: boolean;
  selectImages: boolean;
  twoFingerTapUndo: boolean;
  /** Ignore les contacts très larges (paume) quand le doigt écrit. */
  palmHeuristic: boolean;
  /** Affiche les points prédits par le navigateur pendant le tracé. */
  prediction: boolean;
  pageLayout: PageLayout;
  /** Maintenir immobile en fin de tracé pour obtenir une forme nette. */
  shapeHold: boolean;
  /** Délai de maintien (ms). */
  shapeHoldDelay: number;
  /** Fenêtre de zoom : grossissement par rapport à la page ajustée à la largeur. */
  zoomFactor: number;
  /** Fenêtre de zoom : part de la hauteur de l'éditeur (0,2 à 0,6). */
  zoomPanelHeight: number;
  /** Fenêtre de zoom : avance automatique près du bord droit. */
  zoomAutoAdvance: boolean;
  showPerf: boolean;
}

export const DEFAULT_SETTINGS: InkSettings = {
  fingerMode: 'finger-and-pen',
  handedness: 'right',
  pressure: 0.6,
  tilt: 0,
  eraserMode: 'stroke',
  eraserSize: 24,
  eraseHighlighterOnly: false,
  selectMode: 'lasso',
  selectRule: 'inside',
  selectStrokes: true,
  selectText: true,
  selectImages: true,
  twoFingerTapUndo: true,
  palmHeuristic: false,
  prediction: true,
  pageLayout: 'horizontal',
  shapeHold: true,
  shapeHoldDelay: 550,
  zoomFactor: 2.5,
  zoomPanelHeight: 0.36,
  zoomAutoAdvance: true,
  showPerf: false,
};

export interface InkStyle {
  color: string;
  width: number;
  /** Lissage 0..1. */
  smoothing: number;
}

export interface ToolStyles {
  penType: PenType;
  pens: Record<PenType, InkStyle>;
  highlighter: InkStyle;
}

export const DEFAULT_TOOL_STYLES: ToolStyles = {
  penType: 'pen',
  pens: {
    pen: { color: '#1d2433', width: 2.2, smoothing: 0.35 },
    fineliner: { color: '#1d2433', width: 1.6, smoothing: 0.35 },
    fountain: { color: '#1f3a6e', width: 3.2, smoothing: 0.4 },
    brush: { color: '#1d2433', width: 8, smoothing: 0.45 },
    pencil: { color: '#3b3f47', width: 2, smoothing: 0.3 },
    marker: { color: '#2f5aa8', width: 7, smoothing: 0.4 },
  },
  highlighter: { color: '#f2c94c', width: 18, smoothing: 0.5 },
};

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: 'sans',
  size: 18,
  color: '#1d2433',
  bold: false,
  italic: false,
  underline: false,
  align: 'left',
};

export const TOOL_INFO: Record<InkTool, { label: string; min: number; max: number; presets: number[] }> = {
  pen: { label: 'Stylo à bille', min: 0.6, max: 8, presets: [1.2, 2.2, 3.4, 5] },
  fineliner: { label: 'Feutre fin', min: 0.5, max: 6, presets: [0.8, 1.6, 2.4, 3.6] },
  marker: { label: 'Marqueur', min: 3, max: 30, presets: [5, 7, 12, 18] },
  fountain: { label: 'Plume', min: 1, max: 12, presets: [2, 3.2, 5, 8] },
  brush: { label: 'Pinceau', min: 2, max: 32, presets: [4, 8, 14, 22] },
  pencil: { label: 'Crayon', min: 0.6, max: 8, presets: [1.2, 2, 3.2, 5] },
  highlighter: { label: 'Surligneur', min: 6, max: 40, presets: [10, 16, 24, 32] },
};

export const ERASER_PRESETS = [12, 24, 40, 64];
export const ERASER_MIN = 6;
export const ERASER_MAX = 96;

/** Palette principale (originale) : encres sombres, couleurs vives, pastels. */
export const PALETTE = [
  '#1d2433', '#4a5160', '#8a8f98', '#f2efe8',
  '#1f3a6e', '#2f5aa8', '#2b8bd0', '#2a9d8f',
  '#2e7d4f', '#7aa63a', '#e9b44c', '#e08a1e',
  '#c0392b', '#d1495b', '#a23e8c', '#7b4bb3',
];

export const HIGHLIGHTER_PALETTE = ['#f2c94c', '#ffe066', '#7fd18b', '#7cc4f2', '#b5a6f2', '#f29bd0', '#f5a25d', '#c7c9cc'];

export interface Favorite {
  id: string;
  tool: InkTool;
  color: string;
  width: number;
  smoothing: number;
}

/**
 * Paramètres de rendu figés dans chaque trait au moment de sa création.
 * Chaque outil a sa propre réponse à la pression ; le réglage global la module.
 */
export function strokeStyleFrom(tool: InkTool, s: InkSettings, smoothing: number, realPressure: boolean): StrokeStyle {
  const base: Record<InkTool, number> = { pen: 0.28, fineliner: 0, fountain: 0.9, brush: 0.8, pencil: 0.4, marker: 0, highlighter: 0 };
  const fixed = tool === 'fountain' || tool === 'highlighter' || tool === 'fineliner' || tool === 'marker';
  const thinning = fixed ? base[tool] : base[tool] * (0.4 + s.pressure);
  return {
    thinning: Math.round(Math.min(0.95, thinning) * 100) / 100,
    // Le lissage est appliqué une fois, à la saisie (filtre One Euro) : aucun lissage au rendu.
    streamline: 0,
    smoothing: Math.round(smoothing * 100) / 100,
    tilt: tool === 'highlighter' || tool === 'fineliner' || tool === 'marker' ? 0 : Math.round(s.tilt * 100) / 100,
    realPressure,
    ...(tool === 'fountain' ? { nibAngle: Math.PI / 4 } : {}),
  };
}
