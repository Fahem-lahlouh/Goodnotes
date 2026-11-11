/**
 * Modèle documentaire de Calame.
 *
 * Toutes les coordonnées d'un trait sont exprimées en « unités page »
 * (1 unité = 1 px CSS à 96 dpi ; une page A4 portrait mesure 794 × 1123).
 * Elles sont indépendantes du zoom, de l'orientation et de la densité d'écran.
 */

/** Version du schéma des enregistrements. Incrémentée à chaque migration. */
export const SCHEMA_VERSION = 1;

export type InkTool = 'pen' | 'highlighter';

/** Nombre de valeurs par point dans `Stroke.points`. */
export const POINT_STRIDE = 5;
/**
 * Disposition d'un point (5 × float32) :
 *  0: x (unités page)
 *  1: y (unités page)
 *  2: pression 0..1 (0.5 si le périphérique ne la fournit pas)
 *  3: t, millisecondes depuis le début du trait
 *  4: inclinaison 0..1 (0 = stylet perpendiculaire à l'écran, 1 = couché)
 */
export type PointBuffer = Float32Array;

/** Paramètres de rendu figés au moment de la création du trait. */
export interface StrokeStyle {
  /** Influence de la pression sur l'épaisseur (0 = aucune, 0.8 = forte). */
  thinning: number;
  /** Lissage de la trajectoire (0 = brut, 0.8 = très lissé). */
  streamline: number;
  /** Élargissement lié à l'inclinaison (0 = ignoré). */
  tilt: number;
  /** Vrai si la pression provient du matériel (Apple Pencil) et non d'une simulation. */
  realPressure: boolean;
}

export interface Stroke {
  id: string;
  pageId: string;
  tool: InkTool;
  /** Couleur au format #rrggbb. */
  color: string;
  /** Épaisseur de base en unités page. */
  width: number;
  style: StrokeStyle;
  points: PointBuffer;
  /** Boîte englobante [minX, minY, maxX, maxY], épaisseur comprise. */
  bbox: [number, number, number, number];
  /** Ordre d'empilement sur la page (croissant = au-dessus). */
  order: number;
  createdAt: number;
  v: number;
}

export type PaperKind = 'blank' | 'lined' | 'grid' | 'dotted';
export type PaperColor = 'white' | 'cream' | 'dark';

export interface PaperSpec {
  kind: PaperKind;
  color: PaperColor;
  /** Espacement des lignes/carreaux en unités page. */
  spacing: number;
}

export interface Page {
  id: string;
  notebookId: string;
  width: number;
  height: number;
  paper: PaperSpec;
  createdAt: number;
  updatedAt: number;
  v: number;
}

export interface Notebook {
  id: string;
  title: string;
  /** Identifiant de couleur de couverture (voir COVERS). */
  cover: string;
  /** Papier utilisé par défaut pour les nouvelles pages. */
  paper: PaperSpec;
  /** Ordre des pages. Source de vérité pour la pagination. */
  pageIds: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  /** Date de mise à la corbeille, ou null. */
  trashedAt: number | null;
  v: number;
}

export const PAGE_A4 = { width: 794, height: 1123 } as const;

export const DEFAULT_PAPER: PaperSpec = { kind: 'lined', color: 'white', spacing: 32 };

export const COVERS: { id: string; label: string; color: string }[] = [
  { id: 'nuit', label: 'Bleu nuit', color: '#24365c' },
  { id: 'sauge', label: 'Sauge', color: '#5f7f6a' },
  { id: 'terre', label: 'Terre cuite', color: '#b4593a' },
  { id: 'prune', label: 'Prune', color: '#6b3f63' },
  { id: 'sable', label: 'Sable', color: '#c9a66b' },
  { id: 'ardoise', label: 'Ardoise', color: '#45494f' },
];

export function coverColor(id: string): string {
  return COVERS.find((c) => c.id === id)?.color ?? COVERS[0].color;
}
