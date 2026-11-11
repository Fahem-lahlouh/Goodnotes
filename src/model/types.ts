/**
 * Modèle documentaire de Calame.
 *
 * Toutes les coordonnées sont exprimées en « unités page »
 * (1 unité = 1 px CSS à 96 dpi ; une page A4 portrait mesure 794 × 1123).
 * Elles sont indépendantes du zoom, de l'orientation et de la densité d'écran.
 *
 * Schéma 2 (additif par rapport au schéma 1) :
 *  - nouveaux outils d'encre (plume, pinceau, crayon) ;
 *  - objets de page : blocs de texte et images ;
 *  - dossiers, formats de page, modèles de papier, motifs de couverture.
 */

/** Version du schéma des enregistrements. Incrémentée à chaque migration. */
export const SCHEMA_VERSION = 2;

/**
 * Outil ayant produit un trait.
 * 'pen' = stylo à bille (valeur historique du schéma 1, conservée telle quelle).
 */
export type InkTool = 'pen' | 'fineliner' | 'fountain' | 'brush' | 'pencil' | 'marker' | 'highlighter';
export type PenType = Exclude<InkTool, 'highlighter'>;
export const PEN_TYPES: PenType[] = ['pen', 'fineliner', 'fountain', 'brush', 'pencil', 'marker'];

/** Nombre de valeurs par point dans `Stroke.points`. */
export const POINT_STRIDE = 5;
/**
 * Disposition d'un point (5 × float32) :
 *  0: x (unités page)   1: y (unités page)
 *  2: pression 0..1 (0.5 si le périphérique ne la fournit pas)
 *  3: t, millisecondes depuis le début du trait
 *  4: inclinaison 0..1 (0 = stylet perpendiculaire à l'écran, 1 = couché)
 */
export type PointBuffer = Float32Array;

/** Paramètres de rendu figés au moment de la création du trait. */
export interface StrokeStyle {
  /** Influence de la pression sur l'épaisseur (0 = aucune). */
  thinning: number;
  /**
   * Ancien lissage appliqué au rendu (traits créés avant le 12/11/2026). Les nouveaux traits
   * sont filtrés à la saisie (points déjà lissés) : streamline = 0.
   */
  streamline: number;
  /** Lissage 0..1 appliqué à la saisie (filtre One Euro), pour information. */
  smoothing?: number;
  /** Élargissement lié à l'inclinaison (0 = ignoré). */
  tilt: number;
  /** Vrai si la pression provient du matériel (Apple Pencil) et non d'une simulation. */
  realPressure: boolean;
  /** Plume : angle du bec en radians (π/4 par défaut). */
  nibAngle?: number;
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

// ---------- Objets de page (schéma 2) ----------

export type FontId = 'sans' | 'serif' | 'mono' | 'rounded' | 'hand';

export interface TextStyle {
  font: FontId;
  /** Taille en unités page. */
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
}

interface ItemBase {
  id: string;
  pageId: string;
  /** Rectangle en unités page. */
  x: number;
  y: number;
  w: number;
  h: number;
  order: number;
  createdAt: number;
  v: number;
}

export interface TextItem extends ItemBase, TextStyle {
  kind: 'text';
  text: string;
  /** Note repositionnable : couleur du papier de la note (absent pour un bloc de texte simple). */
  note?: string;
}

export interface ImageItem extends ItemBase {
  kind: 'image';
  /** Référence vers l'enregistrement binaire (magasin `blobs`). */
  blobId: string;
  mime: string;
}

export type PageItem = TextItem | ImageItem;

export interface BlobRecord {
  id: string;
  mime: string;
  data: ArrayBuffer;
  createdAt: number;
}

// ---------- Papier, pages, carnets ----------

export type PaperKind =
  | 'blank'
  | 'lined'
  | 'grid'
  | 'dotted'
  | 'cornell'
  | 'columns2'
  | 'columns3'
  | 'todo'
  | 'weekly'
  | 'monthly'
  | 'meeting'
  | 'brainstorm'
  | 'java'
  | 'qa';

/** 'cream' : valeur du schéma 1 conservée (affichée « Crème »). */
export type PaperColor = 'white' | 'cream' | 'yellow' | 'dark';

export interface PaperSpec {
  kind: PaperKind;
  color: PaperColor;
  /** Espacement des lignes/carreaux en unités page. */
  spacing: number;
}

export type PageFormat = 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'letter' | 'tabloid' | 'board';
export type Orientation = 'portrait' | 'landscape';

/** Dimensions portrait en unités page (96 dpi). */
export const PAGE_FORMATS: Record<PageFormat, { label: string; width: number; height: number }> = {
  A3: { label: 'A3', width: 1123, height: 1587 },
  A4: { label: 'A4', width: 794, height: 1123 },
  A5: { label: 'A5', width: 559, height: 794 },
  A6: { label: 'A6', width: 397, height: 559 },
  A7: { label: 'A7', width: 280, height: 397 },
  letter: { label: 'Lettre US', width: 816, height: 1056 },
  tabloid: { label: 'Tabloïd', width: 1056, height: 1632 },
  board: { label: 'Tableau blanc', width: 1600, height: 2400 },
};

export function pageSize(format: PageFormat, orientation: Orientation): { width: number; height: number } {
  const f = PAGE_FORMATS[format] ?? PAGE_FORMATS.A4;
  return orientation === 'landscape' ? { width: f.height, height: f.width } : { width: f.width, height: f.height };
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

export type NotebookKind = 'notebook' | 'whiteboard' | 'quicknote';
export type CoverPattern = 'plain' | 'linen' | 'stripes' | 'dots' | 'grid' | 'band';

export interface Notebook {
  id: string;
  title: string;
  /** Identifiant de couleur de couverture (voir COVERS). */
  cover: string;
  coverPattern: CoverPattern;
  /** Papier utilisé par défaut pour les nouvelles pages. */
  paper: PaperSpec;
  format: PageFormat;
  orientation: Orientation;
  kind: NotebookKind;
  /** Dossier parent (un seul niveau), ou null. */
  folderId: string | null;
  /** Ordre des pages. Source de vérité pour la pagination. */
  pageIds: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  /** Date de mise à la corbeille, ou null. */
  trashedAt: number | null;
  /** Pages en favori (signets), dans l'ordre d'ajout. Facultatif. */
  bookmarks?: string[];
  /** Plan du carnet : pages nommées. Facultatif. */
  outline?: { pageId: string; title: string }[];
  v: number;
}

export interface Folder {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  v: number;
}

export const PAGE_A4 = { width: 794, height: 1123 } as const;

export const DEFAULT_PAPER: PaperSpec = { kind: 'lined', color: 'white', spacing: 32 };

export const COVERS: { id: string; label: string; color: string }[] = [
  { id: 'nuit', label: 'Bleu nuit', color: '#24365c' },
  { id: 'ocean', label: 'Océan', color: '#2f6f8f' },
  { id: 'sauge', label: 'Sauge', color: '#5f7f6a' },
  { id: 'olive', label: 'Olive', color: '#7a7a45' },
  { id: 'sable', label: 'Sable', color: '#c9a66b' },
  { id: 'terre', label: 'Terre cuite', color: '#b4593a' },
  { id: 'brique', label: 'Brique', color: '#8f3b35' },
  { id: 'prune', label: 'Prune', color: '#6b3f63' },
  { id: 'lavande', label: 'Lavande', color: '#7d7bb0' },
  { id: 'ardoise', label: 'Ardoise', color: '#45494f' },
  { id: 'lin', label: 'Lin', color: '#b9ab94' },
  { id: 'encre', label: 'Encre', color: '#1c1f26' },
];

export const COVER_PATTERNS: { id: CoverPattern; label: string }[] = [
  { id: 'plain', label: 'Uni' },
  { id: 'linen', label: 'Toile' },
  { id: 'band', label: 'Bandeau' },
  { id: 'stripes', label: 'Rayures' },
  { id: 'dots', label: 'Pois' },
  { id: 'grid', label: 'Carreaux' },
];

export function coverColor(id: string): string {
  return COVERS.find((c) => c.id === id)?.color ?? COVERS[0].color;
}
