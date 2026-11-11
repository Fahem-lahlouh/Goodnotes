import { newId, nextOrder } from '../model/ids';
import type { Change, NotebookSession, SessionEvent } from '../model/session';
import { POINT_STRIDE, type ImageItem, type InkTool, type Page, type PageItem, type Stroke, type TextItem, type TextStyle } from '../model/types';
import { OneEuro2D, PressureSmoother, filterParams } from './filter';
import { bboxIntersects, bboxUnion, computeBBox, eraseFromPoints, strokeHitsCircle, strokeMaxRadius, transformPoints, type BBox } from './geometry';
import { coalesced, predicted, sampleFrom, type Sample } from './input';
import { drawItems, textHeight } from './items';
import { computeLayout, renderPageContent, type PageRect } from './pageRender';
import { areaFromPolygon, areaFromRect, itemBBox, itemSelected, squareFrom, strokeSelected, transformItem, type Area } from './selection';
import { DEFAULT_SETTINGS, DEFAULT_TEXT_STYLE, DEFAULT_TOOL_STYLES, strokeStyleFrom, type InkSettings, type InkStyle, type Tool, type ToolStyles } from './settings';
import { meanPressure, recognizeShape, shapeLabel, shapePoints, type Shape } from './shapes';
import { drawStrokes, fillOutline, haloStroke, outlineToPath, strokeOutline, strokePath } from './strokeRender';
import { Viewport } from './viewport';

/**
 * Moteur d'écriture.
 *
 * Indépendant de React : l'interface lui transmet l'outil et les réglages, il lui renvoie quelques
 * événements (page courante, zoom, sélection, édition de texte, forme reconnue…). Aucun rendu React
 * n'a lieu pendant le tracé.
 *
 * SURFACES : la page principale et, si elle est ouverte, la fenêtre de zoom d'écriture. Chacune a
 * ses deux canvas (contenu enregistré / tracé en cours) et sa propre vue (zoom, position). Un trait
 * appartient au carnet, pas à une surface : écrit dans la fenêtre de zoom, il est créé UNE fois et
 * s'affiche aussitôt aux deux endroits.
 *
 * ARBITRAGE : toutes les entrées passent par onDown/onMove/onUp, avec AU PLUS UNE interaction active
 * (tracé, gomme, sélection, transformation, navigation, cadre de zoom, appui texte).
 *  - stylet et souris écrivent ; un doigt posé pendant ce temps est ignoré (paume) ;
 *  - « stylet uniquement » : un doigt navigue ; « doigt et stylet » : un doigt écrit, deux naviguent ;
 *  - un stylet qui se pose pendant une navigation au doigt l'interrompt et écrit ;
 *  - un geste dont la fin n'est jamais reçue (geste système, pointeur perdu) est terminé
 *    proprement au prochain stylet ou à la prochaine annulation : rien ne reste bloqué.
 */

const TAP_MAX_MS = 220;
const TAP_MAX_MOVE = 10;
const YOUNG_MS = 180;
const MARGIN = 16;
const HANDLE_HIT = 22;
const FIT_MAX = 1.6;
/** Au-delà de ce délai sans événement, un geste encore « actif » est considéré comme perdu. */
const STALE_MS = 700;
/**
 * Pour un doigt (souvent la paume) posé pendant un tracé au stylet, on attend bien plus
 * longtemps : le stylet peut rester immobile (maintien pour forme nette) sans émettre d'événement.
 */
const STALE_TOUCH_MS = 4000;
/** Fenêtre de zoom : part droite du cadre qui déclenche l'avance automatique. */
export const ZOOM_ADVANCE_ZONE = 0.22;
const ZOOM_MIN = 1.25;
const ZOOM_MAX = 8;

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

/** Une zone d'affichage et de saisie (page principale ou fenêtre de zoom). */
class Surface {
  readonly vp = new Viewport();
  readonly base: HTMLCanvasElement;
  readonly live: HTMLCanvasElement;
  readonly bctx: CanvasRenderingContext2D;
  readonly lctx: CanvasRenderingContext2D;
  dpr = 1;
  origin: [number, number] = [0, 0];
  renderedView = { scale: 1, tx: 0, ty: 0 };
  cssTransformed = false;
  hover: { x: number; y: number } | null = null;
  needFull = true;
  needLive = true;
  readonly disposers: (() => void)[] = [];

  constructor(
    readonly kind: 'main' | 'zoom',
    readonly host: HTMLElement,
  ) {
    this.base = document.createElement('canvas');
    this.live = document.createElement('canvas');
    this.base.className = 'ink-base';
    this.live.className = 'ink-live';
    this.base.setAttribute('aria-hidden', 'true');
    this.live.setAttribute('role', 'img');
    this.live.setAttribute('aria-label', kind === 'main' ? 'Page du carnet — zone d’écriture' : 'Fenêtre de zoom — zone d’écriture agrandie');
    if (kind === 'zoom') this.live.dataset.surface = 'zoom';
    host.append(this.base, this.live);
    this.bctx = this.base.getContext('2d', { alpha: false })!;
    this.lctx = this.live.getContext('2d', { desynchronized: true } as CanvasRenderingContext2DSettings)!;
  }

  updateOrigin(): void {
    const r = this.host.getBoundingClientRect();
    this.origin = [r.left, r.top];
  }

  /** Ajuste les canvas à la taille de l'hôte ; renvoie vrai si la taille a changé. */
  resize(): boolean {
    const r = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    this.updateOrigin();
    // Plafonne la surface pour rester sous les limites mémoire canvas d'iOS.
    const maxArea = this.kind === 'main' ? 16_000_000 : 8_000_000;
    let dpr = window.devicePixelRatio || 1;
    if (w * h * dpr * dpr > maxArea) dpr = Math.sqrt(maxArea / (w * h));
    if (w === this.vp.width && h === this.vp.height && dpr === this.dpr) return false;
    this.dpr = dpr;
    for (const c of [this.base, this.live]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    this.vp.width = w;
    this.vp.height = h;
    this.needFull = true;
    this.needLive = true;
    return true;
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.base.remove();
    this.live.remove();
  }
}

interface Base {
  pointerId: number;
  pointerType: string;
  surf: Surface;
  startedAt: number;
  lastEvent: number;
}
interface DrawI extends Base {
  kind: 'draw';
  tool: InkTool;
  ink: InkStyle;
  page: PageRect;
  /** Points filtrés (unités page). */
  data: number[];
  /** Dernier échantillon brut : l'encre affichée va jusqu'à la pointe du stylet. */
  raw: number[] | null;
  t0: number;
  predicted: number[];
  filter: OneEuro2D;
  ps: PressureSmoother;
  p0Missing: boolean;
  holdTimer: number;
  holdAnchor: [number, number];
  shape: Shape | null;
  orig: number[] | null;
  shapePressure: number;
}
interface EraseI extends Base {
  kind: 'erase';
  last: [number, number] | null;
}
interface SelectI extends Base {
  kind: 'select';
  page: PageRect;
  mode: 'lasso' | 'rect' | 'square';
  poly: number[];
  start: [number, number];
  end: [number, number];
}
interface TransformI extends Base {
  kind: 'transform';
  handle: Handle;
  page: PageRect;
  start: [number, number];
  dx: number;
  dy: number;
  k: number;
  anchor: [number, number];
  corner: [number, number];
}
interface FrameI extends Base {
  kind: 'frame';
  mode: 'move' | 'resize';
  start: [number, number];
  startFrame: { x: number; y: number };
}
interface TextTapI extends Base {
  kind: 'textTap';
  sx: number;
  sy: number;
  moved: boolean;
}
interface NavI {
  kind: 'nav';
  source: 'touch' | 'mouse' | 'wheel';
  surf: Surface;
  pointerId?: number;
  startTime: number;
  maxTouches: number;
  moved: number;
  lastCx: number;
  lastCy: number;
  lastDist: number;
  rawTx: number;
  zoomLog: number;
  scaled: boolean;
  samples: { t: number; x: number }[];
  tap: [number, number];
}
type ToolInteraction = DrawI | EraseI | SelectI | TransformI | FrameI | TextTapI;
type Interaction = ToolInteraction | NavI;

export interface Selection {
  pageId: string;
  ids: Set<string>;
}

export interface SelectionInfo {
  rect: { x: number; y: number; w: number; h: number };
  count: number;
  strokes: number;
  texts: number;
  images: number;
}

export interface ViewInfo {
  scale: number;
  pageIndex: number;
  pageCount: number;
  fitScale: number;
  layout: 'horizontal' | 'vertical';
}

export interface ZoomState {
  open: boolean;
  factor: number;
  pageId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PerfStats {
  fullRenderMs: number;
  liveFrameMs: number;
  eventToFrameMs: number;
  eventsPerSecond: number;
  pointsPerStroke: number;
}

export type TextEditRequest = { mode: 'edit'; item: TextItem } | { mode: 'create'; pageId: string; x: number; y: number; w: number };

export interface ShapeCommit {
  strokeId: string;
  pageId: string;
  label: string;
  original: Float32Array;
}

export interface EngineCallbacks {
  onView?: (v: ViewInfo) => void;
  onSelection?: (info: SelectionInfo | null) => void;
  onPenDetected?: () => void;
  onPerf?: (p: PerfStats) => void;
  onTextEdit?: (req: TextEditRequest) => void;
  /** Le moteur demande un changement d'outil (ex. après insertion d'une image). */
  onToolRequest?: (t: Tool) => void;
  /** Une action a été refusée (lecture seule, page en chargement…). */
  onNotice?: (msg: string) => void;
  /** Forme reconnue pendant le maintien (avant de relever le stylet). */
  onShapeHint?: (label: string | null) => void;
  /** Forme nette enregistrée : l'interface propose de revenir au tracé libre. */
  onShapeCommitted?: (c: ShapeCommit) => void;
  onZoom?: (z: ZoomState) => void;
}

interface Clipboard {
  strokes: Stroke[];
  items: PageItem[];
  sourcePageId: string;
}
let clipboard: Clipboard | null = null;

export class InkEngine {
  readonly main: Surface;
  private zoom: Surface | null = null;
  private zoomFrame: { pageId: string; x: number; y: number } | null = null;
  private layout: PageRect[] = [];
  private bounds: BBox = [0, 0, 0, 0];
  private cur = 0;

  tool: Tool = 'pen';
  styles: ToolStyles = structuredClone(DEFAULT_TOOL_STYLES);
  settings: InkSettings = { ...DEFAULT_SETTINGS };
  textStyle: TextStyle = { ...DEFAULT_TEXT_STYLE };
  penDetected = false;
  deskColor = '#e9e6df';

  private interaction: Interaction | null = null;
  private touches = new Map<number, { x: number; y: number; sx: number; sy: number; surf: Surface }>();
  private ignored = new Set<number>();
  private selection: Selection | null = null;
  private hidden: Set<string> | null = null;
  private editingId: string | null = null;
  private spaceDown = false;
  private wasFit = true;
  private anim: { from: { scale: number; tx: number; ty: number }; to: { scale: number; tx: number; ty: number }; start: number; dur: number } | null = null;
  private wheelTimer = 0;

  private raf = 0;
  private settleTimer = 0;
  private lastFullMs = 0;
  private pendingEventTime = 0;
  private perf: PerfStats = { fullRenderMs: 0, liveFrameMs: 0, eventToFrameMs: 0, eventsPerSecond: 0, pointsPerStroke: 0 };
  private eventCount = 0;
  private eventWindowStart = performance.now();
  private lastViewKey = '';
  private lastSelKey = '';
  private lastZoomKey = '';
  private disposers: (() => void)[] = [];
  private unsubSession: () => void = () => {};

  constructor(
    container: HTMLElement,
    private session: NotebookSession,
    private readonly cb: EngineCallbacks = {},
    initial?: { layout?: 'horizontal' | 'vertical'; pageIndex?: number },
  ) {
    this.main = new Surface('main', container);
    if (initial?.layout) this.settings = { ...this.settings, pageLayout: initial.layout };
    this.cur = Math.max(0, initial?.pageIndex ?? 0);
    this.relayout();
    this.resize();
    this.goToPage(this.cur, false);
    this.bind();
    this.bindSurface(this.main);
    this.unsubSession = this.session.onChange((e) => this.onSessionChange(e));
  }

  /** Vue de la page principale (compatibilité). */
  get vp(): Viewport {
    return this.main.vp;
  }

  private surfaces(): Surface[] {
    return this.zoom ? [this.main, this.zoom] : [this.main];
  }

  // ======================= Cycle de vie =======================

  destroy(): void {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.settleTimer);
    clearTimeout(this.wheelTimer);
    if (this.interaction?.kind === 'draw') clearTimeout(this.interaction.holdTimer);
    for (const d of this.disposers) d();
    this.unsubSession();
    this.zoom?.destroy();
    this.main.destroy();
  }

  private listen(el: EventTarget, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions, list = this.disposers): void {
    el.addEventListener(type, fn as EventListener, opts);
    list.push(() => el.removeEventListener(type, fn as EventListener, opts));
  }

  private bindSurface(s: Surface): void {
    const el = s.live;
    const L = (type: string, fn: (e: never) => void, opts?: AddEventListenerOptions) => this.listen(el, type, fn, opts, s.disposers);
    L('pointerdown', (e: PointerEvent) => this.onDown(e, s));
    L('pointermove', (e: PointerEvent) => this.onMove(e, s));
    L('pointerup', (e: PointerEvent) => this.onUp(e, s, false));
    L('pointercancel', (e: PointerEvent) => this.onUp(e, s, true));
    L('pointerleave', (e: PointerEvent) => {
      if (e.pointerType !== 'touch' && !this.interaction) {
        s.hover = null;
        this.invalidateLive();
      }
    });
    L('lostpointercapture', (e: PointerEvent) => {
      const a = this.interaction;
      if (a && a.kind !== 'nav' && a.pointerId === e.pointerId) this.onUp(e, a.surf, false, true);
    });
    // iOS : empêche loupe, sélection de texte, menu contextuel et zoom de page pendant l'écriture.
    const prevent = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    L('touchstart', prevent, { passive: false });
    L('touchmove', prevent, { passive: false });
    L('contextmenu', prevent);
    L('selectstart', prevent);
    L('dblclick', prevent);
    L('wheel', (e: WheelEvent) => this.onWheel(e, s), { passive: false });
    let gScale = 1;
    L('gesturestart', (e: Event & { scale: number }) => {
      prevent(e);
      gScale = e.scale ?? 1;
    });
    L('gesturechange', (e: Event & { scale: number; clientX: number; clientY: number }) => {
      prevent(e);
      if (this.touches.size > 0) return; // sur iPad, les pointeurs tactiles gèrent déjà le pincement
      const f = e.scale / gScale;
      gScale = e.scale;
      if (s.kind === 'zoom') this.setZoomFactor(this.settings.zoomFactor * f);
      else this.zoomAtScreen(e.clientX - s.origin[0], e.clientY - s.origin[1], f);
    });
    L('gestureend', prevent);
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(s.host);
    s.disposers.push(() => ro.disconnect());
  }

  private bind(): void {
    this.listen(window, 'keydown', (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) this.spaceDown = true;
    });
    this.listen(window, 'keyup', (e: KeyboardEvent) => {
      if (e.code === 'Space') this.spaceDown = false;
    });
    // Fin de geste reçue hors du canvas (capture de pointeur refusée, geste système…) : on la traite quand même.
    this.listen(window, 'pointerup', (e: PointerEvent) => this.onStrayUp(e, false));
    this.listen(window, 'pointercancel', (e: PointerEvent) => this.onStrayUp(e, true));
    // Interruption (app en arrière-plan, appel…) : on termine proprement le geste en cours.
    this.listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.finishInteraction(true);
    });
    this.listen(window, 'scroll', () => this.surfaces().forEach((s) => s.updateOrigin()), { passive: true });
    this.listen(window, 'resize', () => this.resize());
    this.listen(document, 'fullscreenchange', () => this.resize());
    this.listen(document, 'webkitfullscreenchange', () => this.resize());
  }

  private onStrayUp(e: PointerEvent, cancelled: boolean): void {
    if (this.surfaces().some((s) => s.live === e.target)) return; // déjà traité par le canvas
    const t = this.touches.get(e.pointerId);
    if (t) {
      this.onUp(e, t.surf, cancelled);
      return;
    }
    const a = this.interaction;
    if (a && a.pointerId === e.pointerId) this.onUp(e, a.surf, cancelled);
  }

  // ======================= Mise en page & vue =======================

  relayout(): void {
    const { rects, bounds } = computeLayout(this.session.pageOrder, this.settings.pageLayout);
    this.layout = rects;
    this.bounds = bounds;
    this.cur = Math.min(this.cur, Math.max(0, rects.length - 1));
    if (this.zoomFrame && !this.rectOf(this.zoomFrame.pageId)) {
      const r = this.layout[this.currentPageIndex()];
      if (r) this.zoomFrame.pageId = r.page.id;
      else this.zoomFrame = null;
    }
    for (const s of this.surfaces()) s.needFull = true;
    if (this.zoom) this.updateZoomView();
    this.schedule();
  }

  setLayoutMode(mode: 'horizontal' | 'vertical'): void {
    if (mode === this.settings.pageLayout) return;
    const idx = this.currentPageIndex();
    this.settings = { ...this.settings, pageLayout: mode };
    this.relayout();
    this.cur = idx;
    this.goToPage(idx, false);
  }

  /** Recalcule tailles et repères (rotation, plein écran, mode concentration, clavier virtuel, panneau de zoom). */
  resize(): void {
    const m = this.main;
    const prevW = m.vp.width;
    const prevH = m.vp.height;
    const anchor = prevW ? m.vp.toWorld(prevW / 2, prevH / 3) : null;
    const changed = m.resize();
    if (changed && anchor) {
      const { width: w, height: h } = m.vp;
      if (this.wasFit) {
        const v = this.viewForPage(this.currentPageIndex(), 1, true);
        m.vp.scale = v.scale;
        if (this.settings.pageLayout === 'horizontal') {
          m.vp.tx = v.tx;
          m.vp.ty = h / 3 - anchor[1] * v.scale;
        } else {
          m.vp.tx = w / 2 - anchor[0] * v.scale;
          m.vp.ty = h / 3 - anchor[1] * v.scale;
        }
      } else {
        m.vp.tx = w / 2 - anchor[0] * m.vp.scale;
        m.vp.ty = h / 3 - anchor[1] * m.vp.scale;
      }
      this.clampView(false);
    }
    if (this.zoom && this.zoom.resize()) this.updateZoomView();
    this.renderNow();
  }

  fitScaleFor(index: number): number {
    const r = this.layout[index];
    const pw = r ? r.page.width : 794;
    return Math.min(FIT_MAX, Math.max(0.2, (this.main.vp.width - MARGIN * 2) / pw));
  }

  /** Vue cible pour afficher une page : largeur ajustée (ou zoom conservé), haut de page visible. */
  private viewForPage(index: number, dir: number, forceFit = false): { scale: number; tx: number; ty: number } {
    const vp = this.main.vp;
    const r = this.layout[index];
    if (!r) return vp.snapshot();
    const keepZoom = !forceFit && !this.wasFit;
    const scale = keepZoom ? vp.scale : this.fitScaleFor(index);
    const pw = r.page.width * scale;
    const ph = r.page.height * scale;
    let tx: number;
    if (pw + MARGIN * 2 <= vp.width) tx = (vp.width - pw) / 2 - r.x * scale;
    else tx = dir >= 0 ? MARGIN - r.x * scale : vp.width - MARGIN - (r.x + r.page.width) * scale;
    const ty = ph + MARGIN * 2 <= vp.height ? (vp.height - ph) / 2 - r.y * scale : MARGIN - r.y * scale;
    if (this.settings.pageLayout === 'vertical') {
      const cx = (this.bounds[0] + this.bounds[2]) / 2;
      return { scale, tx: vp.width / 2 - cx * scale, ty: MARGIN - r.y * scale };
    }
    return { scale, tx, ty };
  }

  private pageBounds(index: number): BBox {
    const r = this.layout[index];
    return r ? [r.x, r.y, r.x + r.page.width, r.y + r.page.height] : this.bounds;
  }

  /** Bornes de tx pour la page courante (égales si la page tient en largeur : centrée). */
  private txRange(b: BBox): [number, number] {
    const vp = this.main.vp;
    const s = vp.scale;
    const pw = (b[2] - b[0]) * s;
    if (pw + MARGIN * 2 <= vp.width) {
      const c = (vp.width - pw) / 2 - b[0] * s;
      return [c, c];
    }
    return [vp.width - MARGIN - b[2] * s, MARGIN - b[0] * s];
  }

  private clampY(b: BBox): void {
    const vp = this.main.vp;
    const s = vp.scale;
    const ph = (b[3] - b[1]) * s;
    if (ph + MARGIN * 2 <= vp.height) {
      vp.ty = (vp.height - ph) / 2 - b[1] * s;
    } else {
      const max = MARGIN - b[1] * s;
      const min = vp.height - MARGIN - b[3] * s;
      vp.ty = Math.min(max, Math.max(min, vp.ty));
    }
  }

  /**
   * Contraint la vue principale. En mode horizontal, la vue reste dans la page courante ;
   * `overscroll` autorise temporairement à dépasser le bord (geste de changement de page).
   */
  private clampView(overscroll: boolean, rawTx?: number, resist = false): void {
    const vp = this.main.vp;
    if (this.settings.pageLayout === 'vertical') {
      vp.clamp(this.bounds, MARGIN);
      return;
    }
    const b = this.pageBounds(this.cur);
    this.clampY(b);
    const [min, max] = this.txRange(b);
    const raw = rawTx ?? vp.tx;
    const clamped = Math.min(max, Math.max(min, raw));
    if (!overscroll) {
      vp.tx = clamped;
      return;
    }
    let over = raw - clamped;
    const atStart = over > 0 && this.cur === 0;
    const atEnd = over < 0 && this.cur === this.layout.length - 1;
    if (resist || atStart || atEnd) over *= 0.3;
    over = Math.max(-vp.width, Math.min(vp.width, over));
    vp.tx = clamped + over;
  }

  private animateTo(to: { scale: number; tx: number; ty: number }, dur = 260): void {
    this.anim = { from: this.main.vp.snapshot(), to, start: performance.now(), dur };
    this.schedule();
  }

  private finishAnimation(): void {
    if (!this.anim) return;
    const { to } = this.anim;
    this.anim = null;
    const vp = this.main.vp;
    vp.scale = to.scale;
    vp.tx = to.tx;
    vp.ty = to.ty;
    this.main.needFull = true;
  }

  /** Affiche la page `index` (avec animation par défaut). */
  goToPage(index: number, animate = true): void {
    if (this.layout.length === 0) return;
    const i = Math.max(0, Math.min(index, this.layout.length - 1));
    const prev = this.currentPageIndex();
    const dir = i >= prev ? 1 : -1;
    if (i !== prev) this.clearSelection();
    this.cur = i;
    const target = this.viewForPage(i, dir);
    if (target.scale === this.fitScaleFor(i)) this.wasFit = true;
    if (animate) this.animateTo(target);
    else {
      this.anim = null;
      const vp = this.main.vp;
      vp.scale = target.scale;
      vp.tx = target.tx;
      vp.ty = target.ty;
      this.viewChanged();
    }
    // La fenêtre de zoom suit la page affichée.
    if (this.zoomFrame && this.settings.pageLayout === 'horizontal' && this.layout[i].page.id !== this.zoomFrame.pageId) {
      this.zoomFrame.pageId = this.layout[i].page.id;
      this.clampFrame();
      this.updateZoomView();
    }
    this.preload();
  }

  nextPage(): void {
    this.goToPage(this.currentPageIndex() + 1);
  }

  prevPage(): void {
    this.goToPage(this.currentPageIndex() - 1);
  }

  fitWidth(): void {
    this.wasFit = true;
    this.goToPage(this.currentPageIndex(), true);
  }

  /** Page entière visible. */
  fitPage(): void {
    const i = this.currentPageIndex();
    const r = this.layout[i];
    if (!r) return;
    const vp = this.main.vp;
    const s = Math.min((vp.width - MARGIN * 2) / r.page.width, (vp.height - MARGIN * 2) / r.page.height);
    this.wasFit = false;
    this.cur = i;
    vp.scale = Math.max(vp.minScale, Math.min(vp.maxScale, s));
    const t = this.viewForPage(i, 1);
    this.animateTo({ scale: vp.scale, tx: t.tx, ty: t.ty });
  }

  zoomBy(f: number): void {
    const vp = this.main.vp;
    this.zoomAtScreen(vp.width / 2, vp.height / 2, f);
    this.settle();
  }

  private zoomAtScreen(sx: number, sy: number, f: number): void {
    this.finishAnimation();
    this.main.vp.zoomAt(sx, sy, f);
    this.wasFit = false;
    this.clampView(false);
    this.viewChanged();
  }

  restoreView(v: { scale: number; cx: number; cy: number; page?: number }): void {
    const vp = this.main.vp;
    if (typeof v.page === 'number') this.cur = Math.max(0, Math.min(v.page, this.layout.length - 1));
    vp.scale = Math.min(vp.maxScale, Math.max(vp.minScale, v.scale));
    vp.tx = vp.width / 2 - v.cx * vp.scale;
    vp.ty = vp.height / 2 - v.cy * vp.scale;
    this.wasFit = Math.abs(vp.scale - this.fitScaleFor(this.cur)) < 0.01;
    this.clampView(false);
    this.viewChanged();
    this.preload();
  }

  savedView(): { scale: number; cx: number; cy: number; page: number } {
    const vp = this.main.vp;
    const [cx, cy] = vp.toWorld(vp.width / 2, vp.height / 2);
    return { scale: vp.scale, cx, cy, page: this.currentPageIndex() };
  }

  currentPageIndex(): number {
    if (this.settings.pageLayout === 'horizontal') return this.cur;
    const vp = this.main.vp;
    const [, cy] = vp.toWorld(vp.width / 2, vp.height / 2);
    let best = 0;
    for (const r of this.layout) if (cy >= r.y - 20) best = r.index;
    return best;
  }

  private pageAt(wx: number, wy: number, slack = 0): PageRect | null {
    for (const r of this.layout) {
      if (wx >= r.x - slack && wx <= r.x + r.page.width + slack && wy >= r.y - slack && wy <= r.y + r.page.height + slack) return r;
    }
    return null;
  }

  private rectOf(pageId: string): PageRect | undefined {
    return this.layout.find((r) => r.page.id === pageId);
  }

  /** Coordonnées écran (relatives à la page principale) d'un point de page. */
  pageToScreen(pageId: string, x: number, y: number): [number, number] | null {
    const r = this.rectOf(pageId);
    return r ? this.main.vp.toScreen(r.x + x, r.y + y) : null;
  }

  /** Convertit un point écran de la page principale en coordonnées page. */
  screenToPage(sx: number, sy: number): { pageId: string; x: number; y: number } | null {
    return this.surfaceToPage('main', sx, sy);
  }

  /** Idem pour une surface donnée (« zoom » = fenêtre de zoom). */
  surfaceToPage(kind: 'main' | 'zoom', sx: number, sy: number): { pageId: string; x: number; y: number } | null {
    const s = kind === 'zoom' ? this.zoom : this.main;
    if (!s) return null;
    const [wx, wy] = s.vp.toWorld(sx, sy);
    const r = this.pageAt(wx, wy);
    return r ? { pageId: r.page.id, x: wx - r.x, y: wy - r.y } : null;
  }

  /** Charge le contenu des pages visibles et voisines. */
  private preload(): void {
    const i = this.currentPageIndex();
    const vis = this.main.vp.visibleWorld();
    for (const r of this.layout) {
      const near = Math.abs(r.index - i) <= 1;
      const visible = bboxIntersects([r.x, r.y, r.x + r.page.width, r.y + r.page.height], vis);
      const zoomed = this.zoomFrame?.pageId === r.page.id;
      if ((near || visible || zoomed) && !this.session.isLoaded(r.page.id)) {
        this.session.ensurePage(r.page.id).catch((e) => this.cb.onNotice?.(`Page illisible : ${(e as Error).message}`));
      }
    }
  }

  // ======================= Outils & réglages =======================

  setTool(t: Tool): void {
    if (this.tool === t) return;
    this.finishInteraction(false);
    if (t !== 'select') this.clearSelection();
    this.tool = t;
    this.invalidateLive();
  }

  setStyles(s: ToolStyles): void {
    this.styles = s;
    this.invalidateLive();
  }

  setSettings(s: InkSettings): void {
    if (s.pageLayout !== this.settings.pageLayout) this.setLayoutMode(s.pageLayout);
    const zoomChanged = s.zoomFactor !== this.settings.zoomFactor;
    this.settings = s;
    if (zoomChanged && this.zoom) {
      this.clampFrame();
      this.updateZoomView();
    }
    this.invalidateLive();
  }

  setTextStyle(t: TextStyle): void {
    this.textStyle = t;
  }

  setDeskColor(c: string): void {
    this.deskColor = c;
    for (const s of this.surfaces()) s.needFull = true;
    this.schedule();
  }

  /** Masque un bloc de texte pendant son édition dans le champ superposé. */
  setEditing(id: string | null): void {
    this.editingId = id;
    for (const s of this.surfaces()) s.needFull = true;
    this.schedule();
  }

  // ======================= Fenêtre de zoom =======================

  /**
   * Ouvre la fenêtre de zoom dans `host` (panneau sous la page). Un cadre sur la page principale
   * indique la zone agrandie ; tout ce qui est écrit dans la fenêtre s'écrit dans cette zone.
   */
  openZoom(host: HTMLElement): void {
    if (this.zoom) return;
    this.finishInteraction(false);
    this.finishAnimation();
    // Point de départ du cadre : marge gauche, en haut de la zone que l'on regardait.
    const idx = this.currentPageIndex();
    const r = this.layout[idx];
    const [, wy] = this.main.vp.toWorld(0, MARGIN * 3);
    const z = new Surface('zoom', host);
    this.zoom = z;
    this.bindSurface(z);
    if (r) this.zoomFrame = { pageId: r.page.id, x: this.leftMargin(r.page), y: Math.max(0, Math.min(r.page.height, wy - r.y)) };
    // La page principale a rétréci (panneau ouvert) : on l'affiche en entier, cadre visible.
    this.main.resize();
    z.resize();
    this.fitPageNow(idx);
    this.clampFrame();
    this.updateZoomView();
    this.ensureFrameVisible();
    this.renderNow();
  }

  closeZoom(): void {
    if (!this.zoom) return;
    if (this.interaction && this.interaction.surf === this.zoom) this.finishInteraction(false);
    this.zoom.destroy();
    this.zoom = null;
    this.zoomFrame = null;
    this.emitZoom(true);
    // Retour à l'affichage habituel (largeur de page) une fois le panneau retiré.
    this.main.resize();
    this.wasFit = true;
    this.goToPage(this.currentPageIndex(), false);
    this.renderNow();
  }

  /** Page entière visible, sans animation. */
  private fitPageNow(i: number): void {
    const r = this.layout[i];
    if (!r) return;
    const vp = this.main.vp;
    const s = Math.min((vp.width - MARGIN * 2) / r.page.width, (vp.height - MARGIN * 2) / r.page.height);
    this.wasFit = false;
    this.cur = i;
    vp.scale = Math.max(vp.minScale, Math.min(vp.maxScale, s));
    const t = this.viewForPage(i, 1);
    vp.tx = t.tx;
    vp.ty = t.ty;
    this.clampView(false);
    this.viewChanged();
  }

  isZoomOpen(): boolean {
    return !!this.zoom;
  }

  private zoomScale(): number {
    const r = this.zoomFrame && this.rectOf(this.zoomFrame.pageId);
    return this.fitScaleFor(r ? r.index : this.cur) * this.settings.zoomFactor;
  }

  private frameSize(): { w: number; h: number } {
    if (!this.zoom) return { w: 0, h: 0 };
    const zs = this.zoomScale();
    return { w: this.zoom.vp.width / zs, h: this.zoom.vp.height / zs };
  }

  private clampFrame(): void {
    const f = this.zoomFrame;
    const r = f && this.rectOf(f.pageId);
    if (!f || !r) return;
    const { w, h } = this.frameSize();
    f.x = Math.max(0, Math.min(f.x, Math.max(0, r.page.width - w)));
    f.y = Math.max(0, Math.min(f.y, Math.max(0, r.page.height - h)));
  }

  private updateZoomView(): void {
    const z = this.zoom;
    const f = this.zoomFrame;
    const r = f && this.rectOf(f.pageId);
    if (!z || !f || !r) return;
    const zs = this.zoomScale();
    z.vp.scale = zs;
    z.vp.tx = -(r.x + f.x) * zs;
    z.vp.ty = -(r.y + f.y) * zs;
    z.needFull = true;
    this.main.needLive = true;
    this.preload();
    this.emitZoom();
    this.schedule();
  }

  private emitZoom(force = false): void {
    const st = this.zoomState();
    const key = `${st.open}|${st.factor.toFixed(2)}|${st.pageId}|${st.x.toFixed(1)}|${st.y.toFixed(1)}|${st.w.toFixed(1)}`;
    if (force || key !== this.lastZoomKey) {
      this.lastZoomKey = key;
      this.cb.onZoom?.(st);
    }
  }

  zoomState(): ZoomState {
    const f = this.zoomFrame;
    const { w, h } = this.frameSize();
    return { open: !!this.zoom, factor: this.settings.zoomFactor, pageId: f?.pageId ?? null, x: f?.x ?? 0, y: f?.y ?? 0, w, h };
  }

  /** Grossissement de la fenêtre (borné). */
  setZoomFactor(f: number): void {
    const v = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, f));
    if (Math.abs(v - this.settings.zoomFactor) < 1e-6) return;
    this.settings = { ...this.settings, zoomFactor: v };
    this.clampFrame();
    this.updateZoomView();
  }

  private leftMargin(p: Page): number {
    const s = p.paper.spacing || 32;
    if (p.paper.kind === 'lined') return Math.min(p.width * 0.3, s * 2.5 + 6);
    if (p.paper.kind === 'cornell') return p.width * 0.3 + 6;
    return Math.min(24, p.width * 0.05);
  }

  /** Déplace le cadre (unités page), en restant dans la page. */
  moveZoomFrame(dx: number, dy: number): void {
    if (!this.zoomFrame) return;
    this.zoomFrame.x += dx;
    this.zoomFrame.y += dy;
    this.clampFrame();
    this.updateZoomView();
    this.ensureFrameVisible();
  }

  /** Avance le cadre vers la droite (ou la gauche) d'environ 60 % de sa largeur. */
  zoomAdvance(dir = 1): void {
    const { w } = this.frameSize();
    this.moveZoomFrame(dir * w * 0.6, 0);
  }

  /** Retour à la ligne : cadre à la marge gauche, une ou plusieurs lignes plus bas (aligné sur le papier). */
  zoomNewline(): void {
    const f = this.zoomFrame;
    const r = f && this.rectOf(f.pageId);
    if (!f || !r) return;
    const { h } = this.frameSize();
    const p = r.page.paper;
    const s = p.spacing || 32;
    const lined = p.kind !== 'blank';
    const step = lined ? s * Math.max(1, Math.round((h * 0.65) / s)) : h * 0.65;
    f.x = this.leftMargin(r.page);
    f.y += step;
    this.clampFrame();
    this.updateZoomView();
    this.ensureFrameVisible();
  }

  /** Garde le cadre visible sur la page principale (change de page ou fait défiler si besoin). */
  private ensureFrameVisible(): void {
    const f = this.zoomFrame;
    const r = f && this.rectOf(f.pageId);
    if (!f || !r) return;
    if (this.settings.pageLayout === 'horizontal' && r.index !== this.cur) {
      this.cur = r.index;
      const t = this.viewForPage(r.index, 1);
      const vp = this.main.vp;
      vp.scale = t.scale;
      vp.tx = t.tx;
      vp.ty = t.ty;
    }
    const vp = this.main.vp;
    const { w, h } = this.frameSize();
    const [sx0, sy0] = vp.toScreen(r.x + f.x, r.y + f.y);
    const [sx1, sy1] = vp.toScreen(r.x + f.x + w, r.y + f.y + h);
    let dx = 0;
    let dy = 0;
    if (sy0 < MARGIN * 2) dy = MARGIN * 2 - sy0;
    else if (sy1 > vp.height - MARGIN) dy = vp.height - MARGIN - sy1;
    if (sx0 < MARGIN) dx = MARGIN - sx0;
    else if (sx1 > vp.width - MARGIN) dx = vp.width - MARGIN - sx1;
    if (dx || dy) {
      this.finishAnimation();
      vp.pan(dx, dy);
      this.clampView(false);
      this.viewChanged();
    }
  }

  private frameScreenRect(): { x: number; y: number; w: number; h: number } | null {
    const f = this.zoomFrame;
    const r = f && this.rectOf(f.pageId);
    if (!f || !r || !this.zoom) return null;
    const { w, h } = this.frameSize();
    const [x0, y0] = this.main.vp.toScreen(r.x + f.x, r.y + f.y);
    const [x1, y1] = this.main.vp.toScreen(r.x + f.x + w, r.y + f.y + h);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** Poignée du cadre (onglet au-dessus pour déplacer, bouton en bas à droite pour redimensionner). */
  private hitFrame(sx: number, sy: number): 'move' | 'resize' | null {
    const fr = this.frameScreenRect();
    if (!fr) return null;
    if (Math.hypot(sx - (fr.x + fr.w), sy - (fr.y + fr.h)) <= 18) return 'resize';
    if (sx >= fr.x - 4 && sx <= fr.x + 64 && sy >= fr.y - 30 && sy <= fr.y + 2) return 'move';
    return null;
  }

  // ======================= Arbitrage des entrées =======================

  private local(e: PointerEvent, surf: Surface): Sample {
    return sampleFrom(e, surf.origin[0], surf.origin[1]);
  }

  private countEvent(n: number, timeStamp: number): void {
    this.eventCount += n;
    if (!this.pendingEventTime) this.pendingEventTime = timeStamp;
  }

  private isYoung(a: ToolInteraction): boolean {
    if (performance.now() - a.startedAt > YOUNG_MS) return false;
    return a.kind !== 'draw' || a.data.length < 10 * POINT_STRIDE;
  }

  /** Geste « actif » sans aucun événement depuis un moment : sa fin a été perdue. */
  private isStale(a: Interaction, ms = STALE_MS): boolean {
    if (a.kind === 'nav') return a.source !== 'wheel' && performance.now() - a.startTime > 30_000 && this.touches.size === 0;
    return performance.now() - a.lastEvent > ms;
  }

  private onDown(e: PointerEvent, surf: Surface): void {
    surf.updateOrigin();
    const s = this.local(e, surf);
    if (e.pointerType === 'pen' && !this.penDetected) {
      this.penDetected = true;
      this.cb.onPenDetected?.();
    }
    let a = this.interaction;

    if (e.pointerType === 'touch') {
      if (a && a.kind !== 'nav') {
        if (a.pointerType !== 'touch') {
          if (this.isStale(a, STALE_TOUCH_MS)) {
            this.finishInteraction(false);
            a = null;
          } else {
            // Paume ou doigt pendant que le stylet / la souris travaille : ignoré.
            this.ignored.add(e.pointerId);
            return;
          }
        } else if (this.isYoung(a)) {
          // Deuxième doigt juste après le premier : c'est une navigation, pas un trait.
          this.cancelInteraction();
          this.touches.set(e.pointerId, { x: s.x, y: s.y, sx: s.x, sy: s.y, surf });
          this.startNav('touch', surf);
          return;
        } else if (this.isStale(a, STALE_TOUCH_MS)) {
          this.finishInteraction(false);
          a = null;
        } else {
          this.ignored.add(e.pointerId);
          return;
        }
      }
      // Doigts restés enregistrés alors qu'aucun geste n'est en cours : fin perdue, on repart à zéro.
      if (!a && this.touches.size > 0) this.touches.clear();
      this.touches.set(e.pointerId, { x: s.x, y: s.y, sx: s.x, sy: s.y, surf });
      if (a?.kind === 'nav') {
        if (a.source === 'touch' && a.surf === surf) {
          a.maxTouches = Math.max(a.maxTouches, this.countTouches(surf));
          this.rebaseNav();
        } else this.touches.delete(e.pointerId);
        return;
      }
      if (surf.kind === 'main' && this.touches.size === 1 && this.hitFrame(s.x, s.y)) {
        this.startFrame(e, s, surf);
        return;
      }
      if (this.touches.size >= 2 || this.settings.fingerMode === 'pen-only' || this.tool === 'text') {
        this.startNav('touch', surf);
        return;
      }
      if (this.settings.palmHeuristic && e.width > 80 && e.height > 80) {
        this.touches.delete(e.pointerId);
        this.ignored.add(e.pointerId);
        return;
      }
      this.startTool(e, s, surf);
      return;
    }

    // Stylet ou souris
    if (a) {
      if (a.kind === 'nav' && a.source === 'touch') {
        // Le stylet prend la main : la navigation au doigt s'arrête, les doigts posés sont ignorés.
        for (const id of this.touches.keys()) this.ignored.add(id);
        this.touches.clear();
        this.interaction = null;
        this.settleNav(a, false);
      } else if (a.kind !== 'nav' && a.pointerType === 'touch') {
        this.cancelInteraction();
        for (const id of this.touches.keys()) this.ignored.add(id);
        this.touches.clear();
      } else if (a.kind === 'nav' ? a.pointerId !== e.pointerId || this.isStale(a) : true) {
        // Un stylet ne peut être posé deux fois : l'interaction précédente a perdu sa fin.
        this.finishInteraction(false);
      } else {
        return;
      }
    }
    this.finishAnimation();
    if (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && this.spaceDown))) {
      try {
        surf.live.setPointerCapture(e.pointerId);
      } catch {
        /* ignoré */
      }
      this.startNav('mouse', surf, e.pointerId, s);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (surf.kind === 'main' && this.hitFrame(s.x, s.y)) {
      this.startFrame(e, s, surf);
      return;
    }
    this.startTool(e, s, surf);
  }

  private countTouches(surf: Surface): number {
    let n = 0;
    for (const t of this.touches.values()) if (t.surf === surf) n++;
    return n;
  }

  private capture(e: PointerEvent, surf: Surface): void {
    try {
      surf.live.setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché : la fin sera captée au niveau de la fenêtre */
    }
  }

  private startFrame(e: PointerEvent, s: Sample, surf: Surface): void {
    const mode = this.hitFrame(s.x, s.y)!;
    this.capture(e, surf);
    const now = performance.now();
    const [wx, wy] = surf.vp.toWorld(s.x, s.y);
    this.interaction = {
      kind: 'frame',
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      surf,
      startedAt: now,
      lastEvent: now,
      mode,
      start: [wx, wy],
      startFrame: { x: this.zoomFrame!.x, y: this.zoomFrame!.y },
    };
  }

  private startTool(e: PointerEvent, s: Sample, surf: Surface): void {
    this.finishAnimation();
    this.capture(e, surf);
    const [wx, wy] = surf.vp.toWorld(s.x, s.y);
    const tool: Tool = e.buttons & 32 ? 'eraser' : this.tool;
    const now = performance.now();
    const base = { pointerId: e.pointerId, pointerType: e.pointerType, surf, startedAt: now, lastEvent: now };
    surf.hover = null;

    if (tool === 'text') {
      this.interaction = { kind: 'textTap', ...base, sx: s.x, sy: s.y, moved: false };
      return;
    }
    if (this.session.readOnly && tool !== 'select') {
      this.cb.onNotice?.('Lecture seule : ce carnet est ouvert pour écriture dans un autre onglet.');
      return;
    }

    if (tool === 'pen' || tool === 'highlighter') {
      const page = this.pageAt(wx, wy);
      if (!page) return;
      if (!this.session.isLoaded(page.page.id)) {
        this.cb.onNotice?.('Page en cours de chargement…');
        return;
      }
      const inkTool: InkTool = tool === 'pen' ? this.styles.penType : 'highlighter';
      const ink = tool === 'pen' ? this.styles.pens[this.styles.penType] : this.styles.highlighter;
      const d: DrawI = {
        kind: 'draw',
        ...base,
        tool: inkTool,
        ink: { ...ink },
        page,
        data: [],
        raw: null,
        t0: s.time,
        predicted: [],
        filter: new OneEuro2D(filterParams(ink.smoothing, e.pointerType)),
        ps: new PressureSmoother(),
        p0Missing: false,
        holdTimer: 0,
        holdAnchor: [s.x, s.y],
        shape: null,
        orig: null,
        shapePressure: 0.5,
      };
      this.interaction = d;
      this.pushSample(d, s);
      this.armHold(d);
      this.countEvent(1, e.timeStamp);
      this.invalidateLive();
      return;
    }

    if (tool === 'eraser') {
      const page = this.pageAt(wx, wy);
      this.session.beginBatch('Gomme', page?.page.id ?? this.layout[this.cur]?.page.id ?? '');
      const er: EraseI = { kind: 'erase', ...base, last: null };
      this.interaction = er;
      this.eraseTo(er, wx, wy);
      surf.hover = { x: s.x, y: s.y };
      this.invalidateLive();
      return;
    }

    // Sélection
    const handle = this.hitSelection(s.x, s.y, surf);
    if (handle && this.selection && !this.session.readOnly) {
      const page = this.rectOf(this.selection.pageId)!;
      const b = this.selectionBBox()!;
      const corners: Record<Exclude<Handle, 'move'>, [[number, number], [number, number]]> = {
        nw: [[b[0], b[1]], [b[2], b[3]]],
        ne: [[b[2], b[1]], [b[0], b[3]]],
        sw: [[b[0], b[3]], [b[2], b[1]]],
        se: [[b[2], b[3]], [b[0], b[1]]],
      };
      const [corner, anchor] = handle === 'move' ? [[0, 0] as [number, number], [0, 0] as [number, number]] : corners[handle];
      this.interaction = { kind: 'transform', ...base, handle, page, start: [wx, wy], dx: 0, dy: 0, k: 1, anchor, corner };
      this.hidden = new Set(this.selection.ids);
      for (const sf of this.surfaces()) sf.needFull = true;
      this.schedule();
      return;
    }
    this.clearSelection();
    const page = this.pageAt(wx, wy);
    if (!page) return;
    const px = wx - page.x;
    const py = wy - page.y;
    this.interaction = {
      kind: 'select',
      ...base,
      page,
      mode: this.settings.selectMode === 'rect' && e.shiftKey ? 'square' : this.settings.selectMode,
      poly: [px, py],
      start: [px, py],
      end: [px, py],
    };
  }

  /**
   * Ajoute un échantillon : conversion en coordonnées page, filtre One Euro (position), lissage
   * léger de la pression. L'échantillon brut est gardé pour que l'encre affichée atteigne la pointe.
   */
  private pushSample(a: DrawI, s: Sample): void {
    const [wx, wy] = a.surf.vp.toWorld(s.x, s.y);
    const x = wx - a.page.x;
    const y = wy - a.page.y;
    const t = Math.max(0, s.time - a.t0);
    let p = s.pressure;
    if (Number.isNaN(p)) {
      // Apple Pencil : la pression du tout premier événement vaut souvent 0.
      if (a.data.length === 0) a.p0Missing = true;
      p = a.data.length ? a.data[a.data.length - POINT_STRIDE + 2] : 0.5;
    } else if (a.p0Missing) {
      // Première pression réelle : on corrige les premiers points (sinon « goutte » au départ).
      for (let i = 2; i < a.data.length; i += POINT_STRIDE) a.data[i] = p;
      a.ps = new PressureSmoother();
      a.p0Missing = false;
    }
    const sp = a.ps.next(p);
    a.raw = [x, y, sp, t, s.tilt];
    const [fx, fy] = a.filter.filter(x, y, s.time);
    const d = a.data;
    const n = d.length;
    if (n >= POINT_STRIDE && Math.abs(d[n - POINT_STRIDE] - fx) < 1e-3 && Math.abs(d[n - POINT_STRIDE + 1] - fy) < 1e-3) return;
    d.push(fx, fy, sp, t, s.tilt);
  }

  /** Points du tracé tels qu'affichés : filtrés + pointe brute (+ prédiction), ou forme reconnue. */
  private liveData(a: DrawI, withPrediction: boolean): number[] {
    if (a.shape) return shapePoints(a.shape, a.shapePressure);
    const out = a.data.slice();
    const r = a.raw;
    const n = out.length;
    if (r && n >= POINT_STRIDE && Math.hypot(out[n - POINT_STRIDE] - r[0], out[n - POINT_STRIDE + 1] - r[1]) > 0.05) out.push(...r);
    if (withPrediction && a.predicted.length) out.push(...a.predicted);
    return out;
  }

  // ---------- Maintien pour forme nette ----------

  private armHold(a: DrawI): void {
    clearTimeout(a.holdTimer);
    if (!this.settings.shapeHold || a.shape) return;
    a.holdTimer = window.setTimeout(() => this.tryShape(a), Math.max(200, this.settings.shapeHoldDelay));
  }

  private tryShape(a: DrawI): void {
    if (this.interaction !== a || a.shape) return;
    const pts = this.liveData(a, false);
    const shape = recognizeShape(pts);
    if (!shape) return;
    a.orig = pts;
    a.shape = shape;
    a.shapePressure = meanPressure(pts);
    this.cb.onShapeHint?.(shapeLabel(shape));
    this.invalidateLive();
  }

  /** Revient au tracé libre d'une forme nette (une action, annulable). */
  revertShape(c: ShapeCommit): boolean {
    const s = this.session.getStroke(c.pageId, c.strokeId);
    if (!s) return false;
    const after: Stroke = { ...s, points: c.original, bbox: computeBBox(c.original, strokeMaxRadius(s)) };
    return this.session.apply([{ kind: 'stroke', id: s.id, pageId: s.pageId, before: s, after }], 'Tracé à main levée');
  }

  private onMove(e: PointerEvent, surf: Surface): void {
    if (this.ignored.has(e.pointerId)) return;
    const a = this.interaction;

    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      const t = this.touches.get(e.pointerId)!;
      const s = this.local(e, t.surf);
      t.x = s.x;
      t.y = s.y;
      if (a?.kind === 'nav' && a.source === 'touch') {
        this.updateNav(a);
        return;
      }
    }

    if (!a) {
      if (e.pointerType !== 'touch') {
        const s = this.local(e, surf);
        surf.hover = { x: s.x, y: s.y };
        this.invalidateLive();
      }
      return;
    }

    if (a.kind === 'nav') {
      if (a.source === 'mouse' && a.pointerId === e.pointerId) {
        const s = this.local(e, a.surf);
        this.panSurface(a.surf, s.x - a.lastCx, s.y - a.lastCy);
        a.lastCx = s.x;
        a.lastCy = s.y;
      }
      return;
    }
    if (a.pointerId !== e.pointerId) return;
    a.lastEvent = performance.now();
    const S = a.surf;

    switch (a.kind) {
      case 'draw': {
        const events = coalesced(e);
        if (a.shape) {
          // Forme reconnue : la droite suit encore la pointe (réglage de l'extrémité).
          if (a.shape.kind === 'line') {
            const s = this.local(e, S);
            const [wx, wy] = S.vp.toWorld(s.x, s.y);
            a.shape = { ...a.shape, bx: wx - a.page.x, by: wy - a.page.y };
          }
        } else {
          for (const ce of events) this.pushSample(a, this.local(ce, S));
          a.predicted = [];
          if (this.settings.prediction) {
            for (const pe of predicted(e)) {
              const s = this.local(pe, S);
              const [wx, wy] = S.vp.toWorld(s.x, s.y);
              a.predicted.push(wx - a.page.x, wy - a.page.y, a.raw ? a.raw[2] : 0.5, a.raw ? a.raw[3] : 0, s.tilt);
            }
          }
          const s = this.local(e, S);
          const tol = e.pointerType === 'touch' ? 6 : 3;
          if (Math.hypot(s.x - a.holdAnchor[0], s.y - a.holdAnchor[1]) > tol) {
            a.holdAnchor = [s.x, s.y];
            this.armHold(a);
          }
        }
        this.countEvent(events.length, e.timeStamp);
        this.invalidateLive();
        return;
      }
      case 'erase': {
        for (const ce of coalesced(e)) {
          const s = this.local(ce, S);
          const [wx, wy] = S.vp.toWorld(s.x, s.y);
          this.eraseTo(a, wx, wy);
        }
        const s = this.local(e, S);
        S.hover = { x: s.x, y: s.y };
        this.invalidateLive();
        return;
      }
      case 'select': {
        const s = this.local(e, S);
        const [wx, wy] = S.vp.toWorld(s.x, s.y);
        const px = wx - a.page.x;
        const py = wy - a.page.y;
        if (a.mode === 'lasso') {
          const n = a.poly.length;
          if (Math.hypot(px - a.poly[n - 2], py - a.poly[n - 1]) * S.vp.scale >= 1.5) a.poly.push(px, py);
        }
        a.end = a.mode === 'square' || (a.mode === 'rect' && e.shiftKey) ? squareFrom(a.start[0], a.start[1], px, py) : [px, py];
        this.invalidateLive();
        return;
      }
      case 'transform': {
        const s = this.local(e, S);
        const [wx, wy] = S.vp.toWorld(s.x, s.y);
        if (a.handle === 'move') {
          a.dx = wx - a.start[0];
          a.dy = wy - a.start[1];
        } else {
          // Échelle uniforme : projection du pointeur sur la diagonale ancre → coin.
          const ax = a.page.x + a.anchor[0];
          const ay = a.page.y + a.anchor[1];
          const vx = a.page.x + a.corner[0] - ax;
          const vy = a.page.y + a.corner[1] - ay;
          const len2 = vx * vx + vy * vy || 1;
          a.k = Math.max(0.05, Math.min(20, ((wx - ax) * vx + (wy - ay) * vy) / len2));
        }
        this.invalidateLive();
        return;
      }
      case 'frame': {
        const s = this.local(e, S);
        const [wx, wy] = S.vp.toWorld(s.x, s.y);
        const f = this.zoomFrame;
        const r = f && this.rectOf(f.pageId);
        if (!f || !r || !this.zoom) return;
        if (a.mode === 'move') {
          f.x = a.startFrame.x + (wx - a.start[0]);
          f.y = a.startFrame.y + (wy - a.start[1]);
          this.clampFrame();
          this.updateZoomView();
        } else {
          // Largeur voulue du cadre → grossissement correspondant.
          const wantW = Math.max(20, wx - (r.x + f.x));
          this.setZoomFactor(this.zoom.vp.width / (wantW * this.fitScaleFor(r.index)));
        }
        return;
      }
      case 'textTap': {
        const s = this.local(e, S);
        if (Math.hypot(s.x - a.sx, s.y - a.sy) > TAP_MAX_MOVE) a.moved = true;
        return;
      }
    }
  }

  /** `lost` : capture perdue sans pointerup (coordonnées non fiables : pas de dernier point). */
  private onUp(e: PointerEvent, surf: Surface, cancelled: boolean, lost = false): void {
    if (this.ignored.delete(e.pointerId)) return;
    const a = this.interaction;

    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.delete(e.pointerId);
      if (a?.kind === 'nav' && a.source === 'touch') {
        if (this.countTouches(a.surf) === 0) this.endNav(a, !cancelled);
        else this.rebaseNav();
        return;
      }
    }
    if (!a) return;
    if (a.kind === 'nav') {
      if (a.source === 'mouse' && a.pointerId === e.pointerId) {
        this.interaction = null;
        this.settle();
      }
      return;
    }
    if (a.pointerId !== e.pointerId) return;
    this.interaction = null;

    switch (a.kind) {
      case 'draw':
        clearTimeout(a.holdTimer);
        if (!cancelled && !lost && !a.shape) {
          const s = this.local(e, a.surf);
          this.pushSample(a, { ...s, pressure: a.raw ? a.raw[2] : s.pressure });
        }
        // Même interrompu (geste système), un trait déjà tracé est conservé.
        if (!cancelled || a.data.length >= POINT_STRIDE * 2 || a.shape) this.commitStroke(a);
        this.invalidateLive();
        return;
      case 'erase':
        this.session.endBatch();
        this.invalidateLive();
        return;
      case 'select':
        if (!cancelled) this.finishSelect(a);
        else this.invalidateLive();
        return;
      case 'transform':
        this.finishTransform(a, cancelled);
        return;
      case 'frame':
        this.ensureFrameVisible();
        return;
      case 'textTap':
        if (!cancelled && !lost && !a.moved) this.textTap(a.sx, a.sy, a.surf);
        return;
    }
    void surf;
  }

  /** Termine l'interaction en cours (changement d'outil, mise en arrière-plan, fin perdue). */
  finishInteraction(fromVisibility: boolean): void {
    const a = this.interaction;
    if (!a) return;
    if (a.kind === 'nav') {
      this.interaction = null;
      this.touches.clear();
      this.settleNav(a, false);
      return;
    }
    this.interaction = null;
    if (a.kind === 'draw') {
      clearTimeout(a.holdTimer);
      if (a.data.length >= POINT_STRIDE || a.shape) this.commitStroke(a);
    } else if (a.kind === 'erase') this.session.endBatch();
    else if (a.kind === 'transform') this.finishTransform(a, fromVisibility);
    else if (a.kind === 'select' && !fromVisibility) this.finishSelect(a);
    this.invalidateLive();
  }

  private cancelInteraction(): void {
    const a = this.interaction;
    this.interaction = null;
    if (!a) return;
    if (a.kind === 'draw') clearTimeout(a.holdTimer);
    if (a.kind === 'erase') this.session.endBatch();
    if (a.kind === 'transform') {
      this.hidden = null;
      for (const s of this.surfaces()) s.needFull = true;
    }
    this.invalidateLive();
  }

  // ---------- Navigation (doigts, souris, molette) ----------

  private centroid(surf: Surface): { cx: number; cy: number; dist: number } {
    const pts = Array.from(this.touches.values())
      .filter((t) => t.surf === surf)
      .slice(0, 2);
    if (pts.length === 0) return { cx: 0, cy: 0, dist: 0 };
    if (pts.length === 1) return { cx: pts[0].x, cy: pts[0].y, dist: 0 };
    const [a, b] = pts;
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  private startNav(source: NavI['source'], surf: Surface, pointerId?: number, s?: Sample): void {
    this.finishAnimation();
    const c = source === 'touch' ? this.centroid(surf) : { cx: s?.x ?? 0, cy: s?.y ?? 0, dist: 0 };
    const now = performance.now();
    this.interaction = {
      kind: 'nav',
      source,
      surf,
      pointerId,
      startTime: now,
      maxTouches: this.countTouches(surf),
      moved: 0,
      lastCx: c.cx,
      lastCy: c.cy,
      lastDist: c.dist,
      rawTx: this.main.vp.tx,
      zoomLog: 0,
      scaled: false,
      samples: [{ t: now, x: this.main.vp.tx }],
      tap: [c.cx, c.cy],
    };
  }

  private rebaseNav(): void {
    const a = this.interaction;
    if (a?.kind !== 'nav') return;
    const c = this.centroid(a.surf);
    a.lastCx = c.cx;
    a.lastCy = c.cy;
    a.lastDist = c.dist;
  }

  /** Déplacement simple (souris, molette) d'une surface : la vue principale, ou le cadre de zoom. */
  private panSurface(surf: Surface, dx: number, dy: number): void {
    if (surf.kind === 'zoom') {
      const zs = this.zoomScale();
      this.moveZoomFrame(-dx / zs, -dy / zs);
      return;
    }
    this.main.vp.pan(dx, dy);
    this.clampView(false);
    this.viewChanged();
  }

  private updateNav(a: NavI): void {
    a.maxTouches = Math.max(a.maxTouches, this.countTouches(a.surf));
    const c = this.centroid(a.surf);
    for (const t of this.touches.values()) if (t.surf === a.surf) a.moved = Math.max(a.moved, Math.hypot(t.x - t.sx, t.y - t.sy));
    if (a.surf.kind === 'zoom') {
      // Dans la fenêtre de zoom : faire glisser déplace le cadre, pincer change le grossissement.
      const zs = this.zoomScale();
      if (this.zoomFrame) {
        this.zoomFrame.x -= (c.cx - a.lastCx) / zs;
        this.zoomFrame.y -= (c.cy - a.lastCy) / zs;
      }
      if (c.dist > 0 && a.lastDist > 0) {
        a.zoomLog += Math.log(c.dist / a.lastDist);
        a.scaled = Math.abs(a.zoomLog) > 0.08;
        if (a.scaled) this.settings = { ...this.settings, zoomFactor: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.settings.zoomFactor * (c.dist / a.lastDist))) };
      }
      a.lastCx = c.cx;
      a.lastCy = c.cy;
      a.lastDist = c.dist;
      this.clampFrame();
      this.updateZoomView();
      return;
    }
    const vp = this.main.vp;
    vp.tx = a.rawTx;
    vp.pan(c.cx - a.lastCx, c.cy - a.lastCy);
    if (c.dist > 0 && a.lastDist > 0) {
      const f = c.dist / a.lastDist;
      // Les doigts bougent l'un après l'autre : l'écart varie entre deux événements.
      // On ne retient que le zoom NET du geste (somme des log = log(écart actuel / écart initial)).
      a.zoomLog += Math.log(f);
      a.scaled = Math.abs(a.zoomLog) > 0.08;
      vp.zoomAt(c.cx, c.cy, f);
    }
    a.rawTx = vp.tx;
    a.lastCx = c.cx;
    a.lastCy = c.cy;
    a.lastDist = c.dist;
    const now = performance.now();
    a.samples.push({ t: now, x: a.rawTx });
    while (a.samples.length > 2 && now - a.samples[0].t > 120) a.samples.shift();
    this.clampView(this.settings.pageLayout === 'horizontal', a.rawTx, a.scaled);
    this.viewChanged();
  }

  private endNav(a: NavI, allowTap: boolean): void {
    this.interaction = null;
    const dt = performance.now() - a.startTime;
    if (allowTap && dt <= TAP_MAX_MS && a.moved <= TAP_MAX_MOVE && !a.scaled) {
      if (a.maxTouches === 2 && this.settings.twoFingerTapUndo) {
        this.settleNav(a, false);
        this.undo();
        return;
      }
      if (a.maxTouches === 3 && this.settings.twoFingerTapUndo) {
        this.settleNav(a, false);
        this.redo();
        return;
      }
      if (a.maxTouches === 1) {
        this.settleNav(a, false);
        this.tapAction(a.tap[0], a.tap[1], a.surf);
        return;
      }
    }
    this.settleNav(a, true);
  }

  /**
   * Fin d'un geste de navigation : en mode horizontal, change de page si le dépassement
   * ou la vitesse le justifient (et si le geste n'était pas un zoom), sinon revient en place.
   */
  private settleNav(a: NavI, allowTurn: boolean): void {
    if (a.surf.kind === 'zoom') {
      this.ensureFrameVisible();
      this.emitZoom(true);
      return;
    }
    const vp = this.main.vp;
    if (Math.abs(a.zoomLog) > 0.02) this.wasFit = false;
    else if (this.wasFit && a.zoomLog !== 0) {
      // Variation de zoom résiduelle d'un balayage à deux doigts : on revient exactement à l'ajustement.
      vp.zoomAt(vp.width / 2, vp.height / 2, this.fitScaleFor(this.cur) / vp.scale);
    }
    if (this.settings.pageLayout !== 'horizontal') {
      this.clampView(false);
      this.settle();
      return;
    }
    const b = this.pageBounds(this.cur);
    const [min, max] = this.txRange(b);
    const clamped = Math.min(max, Math.max(min, vp.tx));
    const over = vp.tx - clamped;
    const first = a.samples[0];
    const last = a.samples[a.samples.length - 1];
    const v = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    const th = Math.max(70, vp.width * 0.2);
    if (allowTurn && !a.scaled) {
      if ((over < -th || (over < -24 && v < -0.45)) && this.cur < this.layout.length - 1) {
        this.goToPage(this.cur + 1);
        return;
      }
      if ((over > th || (over > 24 && v > 0.45)) && this.cur > 0) {
        this.goToPage(this.cur - 1);
        return;
      }
    }
    const to = { scale: vp.scale, tx: clamped, ty: vp.ty };
    if (Math.abs(over) > 0.5) this.animateTo(to, 200);
    else this.settle();
  }

  private onWheel(e: WheelEvent, surf: Surface): void {
    e.preventDefault();
    surf.updateOrigin();
    if (this.interaction && this.interaction.kind !== 'nav') return;
    this.finishAnimation();
    const sx = e.clientX - surf.origin[0];
    const sy = e.clientY - surf.origin[1];
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? surf.vp.height : 1;
    if (surf.kind === 'zoom') {
      if (e.ctrlKey || e.metaKey) this.setZoomFactor(this.settings.zoomFactor * Math.exp((-e.deltaY * unit) / 300));
      else this.panSurface(surf, -e.deltaX * unit, -e.deltaY * unit);
      this.emitZoom(true);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      this.zoomAtScreen(sx, sy, Math.exp((-e.deltaY * unit) / 300));
      this.settle(140);
      return;
    }
    let dx = -e.deltaX * unit;
    let dy = -e.deltaY * unit;
    if (e.shiftKey && dx === 0) {
      dx = dy;
      dy = 0;
    }
    const vp = this.main.vp;
    if (this.settings.pageLayout === 'horizontal' && Math.abs(dx) > Math.abs(dy)) {
      // Balayage horizontal au trackpad : comme un geste de doigt, avec changement de page.
      let a = this.interaction?.kind === 'nav' && this.interaction.source === 'wheel' ? this.interaction : null;
      if (!a) {
        this.startNav('wheel', surf, undefined, { x: sx, y: sy, pressure: 0, tilt: 0, time: 0 });
        a = this.interaction as NavI;
      }
      a.rawTx += dx;
      const now = performance.now();
      a.samples.push({ t: now, x: a.rawTx });
      while (a.samples.length > 2 && now - a.samples[0].t > 120) a.samples.shift();
      vp.tx = a.rawTx;
      this.clampView(true, a.rawTx);
      this.viewChanged();
      clearTimeout(this.wheelTimer);
      this.wheelTimer = window.setTimeout(() => {
        if (this.interaction === a) {
          this.interaction = null;
          this.settleNav(a!, true);
        }
      }, 140);
      return;
    }
    vp.pan(dx, dy);
    this.clampView(false);
    this.viewChanged();
    this.settle(140);
  }

  /** Appui simple (doigt en mode stylet, ou outil texte). */
  private tapAction(sx: number, sy: number, surf: Surface): void {
    if (this.tool === 'text') this.textTap(sx, sy, surf);
    else if (this.tool === 'select' && this.selection && !this.hitSelection(sx, sy, surf)) this.clearSelection();
  }

  // ---------- Historique ----------

  /**
   * Prépare une annulation : un geste en cours bloquerait l'historique. S'il est réellement en
   * cours (événements récents), on refuse ; s'il a perdu sa fin, on le termine proprement.
   */
  private readyForHistory(): boolean {
    const a = this.interaction;
    if (!a || a.kind === 'nav') return true;
    if (!this.isStale(a)) return false;
    this.finishInteraction(false);
    return true;
  }

  /** Affiche la page concernée puis annule (jamais de modification sur une page invisible). */
  undo(): boolean {
    if (!this.readyForHistory()) return false;
    const cs = this.session.peekUndo();
    if (!cs || !this.session.canUndo) return false;
    this.revealPage(cs.pageId);
    this.clearSelection();
    return !!this.session.undo();
  }

  redo(): boolean {
    if (!this.readyForHistory()) return false;
    const cs = this.session.peekRedo();
    if (!cs || !this.session.canRedo) return false;
    this.revealPage(cs.pageId);
    this.clearSelection();
    return !!this.session.redo();
  }

  private revealPage(pageId: string): void {
    const idx = this.session.pageIndex(pageId);
    if (idx < 0) return;
    if (this.settings.pageLayout === 'horizontal') {
      if (idx !== this.cur) this.goToPage(idx, false);
      return;
    }
    const r = this.layout[idx];
    const vis = this.main.vp.visibleWorld();
    if (r && !bboxIntersects([r.x, r.y, r.x + r.page.width, r.y + r.page.height], vis)) this.goToPage(idx, false);
  }

  // ---------- Trait ----------

  private commitStroke(a: DrawI): void {
    const data = this.liveData(a, false);
    if (data.length < POINT_STRIDE) return;
    const points = Float32Array.from(data);
    const realPressure = a.pointerType === 'pen';
    const base = { tool: a.tool, width: a.ink.width, style: strokeStyleFrom(a.tool, this.settings, a.ink.smoothing, realPressure) };
    const stroke: Stroke = {
      id: newId(),
      pageId: a.page.page.id,
      ...base,
      color: a.ink.color,
      points,
      bbox: computeBBox(points, strokeMaxRadius(base)),
      order: nextOrder(),
      createdAt: Date.now(),
      v: 2,
    };
    this.perf.pointsPerStroke = points.length / POINT_STRIDE;
    const ok = this.session.apply([{ kind: 'stroke', id: stroke.id, pageId: stroke.pageId, after: stroke }], a.shape ? `Forme : ${shapeLabel(a.shape)}` : 'Trait');
    if (!ok) return;
    if (a.shape && a.orig) {
      this.cb.onShapeHint?.(null);
      this.cb.onShapeCommitted?.({ strokeId: stroke.id, pageId: stroke.pageId, label: shapeLabel(a.shape), original: Float32Array.from(a.orig) });
    }
    // Fenêtre de zoom : avance automatique quand on écrit près du bord droit du cadre.
    if (a.surf.kind === 'zoom' && this.settings.zoomAutoAdvance && this.zoomFrame && this.zoomFrame.pageId === stroke.pageId && a.tool !== 'highlighter') {
      const { w } = this.frameSize();
      const zoneStart = this.zoomFrame.x + w * (1 - ZOOM_ADVANCE_ZONE);
      if (stroke.bbox[2] > zoneStart) this.zoomAdvance(1);
    }
  }

  // ---------- Gomme ----------

  /**
   * Gomme : diamètre fixe en pixels écran (eraserSize), donc rayon = eraserSize/2/zoom en unités page.
   * Le cercle affiché a exactement ce rayon. Dans la fenêtre de zoom, c'est le zoom de la fenêtre
   * qui compte (gomme précise à fort grossissement).
   */
  eraserRadiusWorld(kind: 'main' | 'zoom' = 'main'): number {
    const s = kind === 'zoom' && this.zoom ? this.zoom : this.main;
    return this.settings.eraserSize / 2 / s.vp.scale;
  }

  private eraseTo(a: EraseI, wx: number, wy: number): void {
    const r = this.eraserRadiusWorld(a.surf.kind);
    const steps: [number, number][] = [];
    if (a.last) {
      const d = Math.hypot(wx - a.last[0], wy - a.last[1]);
      const n = Math.max(1, Math.ceil(d / (r * 0.5)));
      for (let i = 1; i <= n; i++) steps.push([a.last[0] + ((wx - a.last[0]) * i) / n, a.last[1] + ((wy - a.last[1]) * i) / n]);
    } else steps.push([wx, wy]);
    a.last = [wx, wy];
    for (const [x, y] of steps) {
      const page = this.pageAt(x, y, r);
      if (!page || !this.session.isLoaded(page.page.id)) continue;
      this.eraseAtPage(page, x - page.x, y - page.y, r);
    }
  }

  private eraseAtPage(page: PageRect, px: number, py: number, r: number): void {
    const changes: Change[] = [];
    const box: BBox = [px - r, py - r, px + r, py + r];
    for (const s of this.session.getStrokes(page.page.id)) {
      if (!bboxIntersects(s.bbox, box)) continue;
      if (this.settings.eraseHighlighterOnly && s.tool !== 'highlighter') continue;
      const inkW = s.tool === 'fountain' ? s.width * 0.8 : s.width;
      if (this.settings.eraserMode === 'stroke') {
        if (strokeHitsCircle({ ...s, width: inkW }, px, py, r)) changes.push({ kind: 'stroke', id: s.id, pageId: s.pageId, before: s });
      } else {
        const pieces = eraseFromPoints(s.points, inkW, px, py, r);
        if (!pieces) continue;
        changes.push({ kind: 'stroke', id: s.id, pageId: s.pageId, before: s });
        pieces.forEach((pts, i) => {
          const piece: Stroke = { ...s, id: newId(), points: pts, bbox: computeBBox(pts, strokeMaxRadius(s)), order: s.order + (i + 1) * 1e-3 };
          changes.push({ kind: 'stroke', id: piece.id, pageId: s.pageId, after: piece });
        });
      }
    }
    if (changes.length) this.session.apply(changes, 'Gomme');
  }

  // ---------- Sélection ----------

  private areaOf(a: SelectI): Area | null {
    if (a.mode === 'lasso') return a.poly.length >= 6 ? areaFromPolygon(a.poly) : null;
    if (Math.abs(a.end[0] - a.start[0]) < 1 && Math.abs(a.end[1] - a.start[1]) < 1) return null;
    return areaFromRect(a.start[0], a.start[1], a.end[0], a.end[1]);
  }

  /** Éléments de la page retenus par la zone, selon la règle et les filtres choisis. */
  selectInArea(pageId: string, area: Area): Set<string> {
    const st = this.settings;
    const ids = new Set<string>();
    if (st.selectStrokes) for (const s of this.session.getStrokes(pageId)) if (strokeSelected(s, area, st.selectRule)) ids.add(s.id);
    for (const it of this.session.getItems(pageId)) {
      if (it.kind === 'text' && !st.selectText) continue;
      if (it.kind === 'image' && !st.selectImages) continue;
      if (itemSelected(it, area, st.selectRule)) ids.add(it.id);
    }
    return ids;
  }

  private finishSelect(a: SelectI): void {
    const area = this.areaOf(a);
    const ids = area ? this.selectInArea(a.page.page.id, area) : new Set<string>();
    this.selection = ids.size ? { pageId: a.page.page.id, ids } : null;
    this.emitSelection(true);
    this.invalidateLive();
  }

  selectAll(): void {
    const r = this.layout[this.currentPageIndex()];
    if (!r) return;
    const ids = this.selectInArea(r.page.id, areaFromRect(-1e6, -1e6, 1e6, 1e6));
    this.selection = ids.size ? { pageId: r.page.id, ids } : null;
    if (this.tool !== 'select') this.cb.onToolRequest?.('select');
    this.emitSelection(true);
    this.invalidateLive();
  }

  /** Sélectionne des éléments précis (ex. traits convertis en texte). */
  selectIds(pageId: string, ids: string[]): void {
    this.selection = ids.length ? { pageId, ids: new Set(ids) } : null;
    this.emitSelection(true);
    this.invalidateLive();
  }

  private selectedElements(): { strokes: Stroke[]; items: PageItem[] } {
    const sel = this.selection;
    const out = { strokes: [] as Stroke[], items: [] as PageItem[] };
    if (!sel) return out;
    for (const id of sel.ids) {
      const s = this.session.getStroke(sel.pageId, id);
      if (s) out.strokes.push(s);
      else {
        const it = this.session.getItem(sel.pageId, id);
        if (it) out.items.push(it);
      }
    }
    return out;
  }

  /** Traits sélectionnés (pour la conversion en texte). */
  selectedStrokes(): Stroke[] {
    return this.selectedElements().strokes;
  }

  private selectionBBox(): BBox | null {
    const { strokes, items } = this.selectedElements();
    return bboxUnion([...strokes.map((s) => s.bbox), ...items.map(itemBBox)]);
  }

  private transformOf(a: TransformI): { k: number; dx: number; dy: number } {
    if (a.handle === 'move') return { k: 1, dx: a.dx, dy: a.dy };
    return { k: a.k, dx: a.anchor[0] - a.anchor[0] * a.k, dy: a.anchor[1] - a.anchor[1] * a.k };
  }

  private selectionScreenRect(surf: Surface = this.main): { x: number; y: number; w: number; h: number } | null {
    const b = this.selectionBBox();
    if (!b || !this.selection) return null;
    const r = this.rectOf(this.selection.pageId);
    if (!r) return null;
    let [x0, y0, x1, y1] = b;
    const a = this.interaction?.kind === 'transform' ? this.interaction : null;
    if (a) {
      const t = this.transformOf(a);
      [x0, y0, x1, y1] = [x0 * t.k + t.dx, y0 * t.k + t.dy, x1 * t.k + t.dx, y1 * t.k + t.dy];
    }
    const [sx0, sy0] = surf.vp.toScreen(r.x + Math.min(x0, x1), r.y + Math.min(y0, y1));
    const [sx1, sy1] = surf.vp.toScreen(r.x + Math.max(x0, x1), r.y + Math.max(y0, y1));
    return { x: sx0, y: sy0, w: sx1 - sx0, h: sy1 - sy0 };
  }

  /** Poignée ou intérieur de la sélection sous le point écran. */
  private hitSelection(sx: number, sy: number, surf: Surface = this.main): Handle | null {
    const rect = this.selectionScreenRect(surf);
    if (!rect) return null;
    const pad = 8;
    const corners: [Handle, number, number][] = [
      ['nw', rect.x - pad, rect.y - pad],
      ['ne', rect.x + rect.w + pad, rect.y - pad],
      ['sw', rect.x - pad, rect.y + rect.h + pad],
      ['se', rect.x + rect.w + pad, rect.y + rect.h + pad],
    ];
    for (const [h, x, y] of corners) if (Math.hypot(sx - x, sy - y) <= HANDLE_HIT) return h;
    if (sx >= rect.x - pad && sx <= rect.x + rect.w + pad && sy >= rect.y - pad && sy <= rect.y + rect.h + pad) return 'move';
    return null;
  }

  private transformStroke(s: Stroke, t: { k: number; dx: number; dy: number }): Stroke {
    const points = transformPoints(s.points, t.k, t.dx, t.dy);
    const width = s.width * t.k;
    return { ...s, points, width, bbox: computeBBox(points, strokeMaxRadius({ ...s, width })) };
  }

  private finishTransform(a: TransformI, cancelled: boolean): void {
    this.hidden = null;
    const t = this.transformOf(a);
    const changed = a.handle === 'move' ? Math.hypot(t.dx, t.dy) > 0.01 : Math.abs(t.k - 1) > 0.001;
    if (!cancelled && changed && this.selection) {
      const { strokes, items } = this.selectedElements();
      const changes: Change[] = [
        ...strokes.map((s): Change => ({ kind: 'stroke', id: s.id, pageId: s.pageId, before: s, after: this.transformStroke(s, t) })),
        ...items.map((it): Change => ({ kind: 'item', id: it.id, pageId: it.pageId, before: it, after: transformItem(it, t.k, t.dx, t.dy) })),
      ];
      // Un déplacement continu = UNE action d'historique.
      this.session.apply(changes, a.handle === 'move' ? 'Déplacer' : 'Redimensionner');
    } else {
      for (const s of this.surfaces()) s.needFull = true;
      this.schedule();
    }
    this.emitSelection(true);
    this.invalidateLive();
  }

  clearSelection(): void {
    if (!this.selection) return;
    this.selection = null;
    this.emitSelection(true);
    this.invalidateLive();
  }

  hasSelection(): boolean {
    return !!this.selection && this.selection.ids.size > 0;
  }

  deleteSelection(): void {
    const { strokes, items } = this.selectedElements();
    if (!strokes.length && !items.length) return;
    this.session.apply(
      [
        ...strokes.map((s): Change => ({ kind: 'stroke', id: s.id, pageId: s.pageId, before: s })),
        ...items.map((it): Change => ({ kind: 'item', id: it.id, pageId: it.pageId, before: it })),
      ],
      'Supprimer la sélection',
    );
    this.clearSelection();
  }

  private pasteElements(strokes: Stroke[], items: PageItem[], pageId: string, dx: number, dy: number, label: string): void {
    const order = nextOrder();
    const ns = strokes.map((s, i) => ({ ...this.transformStroke(s, { k: 1, dx, dy }), id: newId(), pageId, order: order + i * 1e-3 }));
    const ni = items.map((it, i) => ({ ...transformItem(it, 1, dx, dy), id: newId(), pageId, order: order + i * 1e-3 }));
    const ok = this.session.apply(
      [...ns.map((s): Change => ({ kind: 'stroke', id: s.id, pageId, after: s })), ...ni.map((it): Change => ({ kind: 'item', id: it.id, pageId, after: it }))],
      label,
    );
    if (!ok) return;
    this.selection = { pageId, ids: new Set([...ns.map((s) => s.id), ...ni.map((i) => i.id)]) };
    if (this.tool !== 'select') this.cb.onToolRequest?.('select');
    this.emitSelection(true);
    this.invalidateLive();
  }

  duplicateSelection(): void {
    const { strokes, items } = this.selectedElements();
    if (!this.selection || (!strokes.length && !items.length)) return;
    this.pasteElements(strokes, items, this.selection.pageId, 24, 24, 'Dupliquer');
  }

  copySelection(): boolean {
    const { strokes, items } = this.selectedElements();
    if (!this.selection || (!strokes.length && !items.length)) return false;
    clipboard = { strokes, items, sourcePageId: this.selection.pageId };
    return true;
  }

  cutSelection(): boolean {
    if (!this.copySelection()) return false;
    this.deleteSelection();
    return true;
  }

  hasClipboard(): boolean {
    return !!clipboard;
  }

  /** Colle sur la page courante (décalé si c'est la page d'origine). */
  paste(): void {
    if (!clipboard) return;
    const r = this.layout[this.currentPageIndex()];
    if (!r || !this.session.isLoaded(r.page.id)) return;
    const off = r.page.id === clipboard.sourcePageId ? 24 : 0;
    this.pasteElements(clipboard.strokes, clipboard.items, r.page.id, off, off, 'Coller');
  }

  recolorSelection(color: string): void {
    const { strokes, items } = this.selectedElements();
    const changes: Change[] = [
      ...strokes.map((s): Change => ({ kind: 'stroke', id: s.id, pageId: s.pageId, before: s, after: { ...s, color } })),
      ...items.filter((it): it is TextItem => it.kind === 'text').map((it): Change => ({ kind: 'item', id: it.id, pageId: it.pageId, before: it, after: { ...it, color } })),
    ];
    if (changes.length) this.session.apply(changes, 'Couleur');
  }

  /** Épaisseur des traits sélectionnés multipliée par `factor` (une action). */
  scaleSelectionWidth(factor: number): void {
    const { strokes } = this.selectedElements();
    const changes = strokes.map((s): Change => {
      const width = Math.max(0.4, Math.min(60, s.width * factor));
      return { kind: 'stroke', id: s.id, pageId: s.pageId, before: s, after: { ...s, width, bbox: computeBBox(s.points, strokeMaxRadius({ ...s, width })) } };
    });
    if (changes.length) this.session.apply(changes, 'Épaisseur');
  }

  /** Applique un style de texte aux blocs de texte sélectionnés. */
  styleSelectedText(patch: Partial<TextStyle>): void {
    const { items } = this.selectedElements();
    const changes = items
      .filter((it): it is TextItem => it.kind === 'text')
      .map((it): Change => {
        const next = { ...it, ...patch };
        return { kind: 'item', id: it.id, pageId: it.pageId, before: it, after: { ...next, h: textHeight(next) } };
      });
    if (changes.length) this.session.apply(changes, 'Style du texte');
  }

  /**
   * Remplace des traits par un bloc de texte (conversion manuscrit → texte) : UNE action,
   * annulable (l'annulation restaure les traits).
   */
  replaceStrokesWithText(pageId: string, strokeIds: string[], text: string, style: TextStyle, box: { x: number; y: number; w: number }): string | null {
    const strokes = strokeIds.map((id) => this.session.getStroke(pageId, id)).filter((s): s is Stroke => !!s);
    if (!strokes.length || !text.trim()) return null;
    const it: TextItem = { kind: 'text', id: newId(), pageId, x: box.x, y: box.y, w: box.w, h: 0, text: text.replace(/\s+$/u, ''), ...style, order: nextOrder(), createdAt: Date.now(), v: 2 };
    it.h = textHeight(it);
    const ok = this.session.apply(
      [...strokes.map((s): Change => ({ kind: 'stroke', id: s.id, pageId, before: s })), { kind: 'item', id: it.id, pageId, after: it }],
      'Convertir en texte',
    );
    if (!ok) return null;
    this.selection = { pageId, ids: new Set([it.id]) };
    this.emitSelection(true);
    this.invalidateLive();
    return it.id;
  }

  private emitSelection(force = false): void {
    const sel = this.selection;
    if (!sel || sel.ids.size === 0) {
      if (force || this.lastSelKey !== '') {
        this.lastSelKey = '';
        this.cb.onSelection?.(null);
      }
      return;
    }
    const rect = this.selectionScreenRect();
    if (!rect) return;
    const { strokes, items } = this.selectedElements();
    const info: SelectionInfo = {
      rect,
      count: strokes.length + items.length,
      strokes: strokes.length,
      texts: items.filter((i) => i.kind === 'text').length,
      images: items.filter((i) => i.kind === 'image').length,
    };
    const key = `${Math.round(rect.x)}|${Math.round(rect.y)}|${Math.round(rect.w)}|${Math.round(rect.h)}|${info.count}|${info.texts}`;
    if (force || key !== this.lastSelKey) {
      this.lastSelKey = key;
      this.cb.onSelection?.(info);
    }
  }

  // ---------- Texte & images ----------

  private textTap(sx: number, sy: number, surf: Surface = this.main): void {
    const [wx, wy] = surf.vp.toWorld(sx, sy);
    const r = this.pageAt(wx, wy);
    if (!r) return;
    const px = wx - r.x;
    const py = wy - r.y;
    const hit = this.session
      .getItems(r.page.id)
      .slice()
      .reverse()
      .find((it): it is TextItem => it.kind === 'text' && px >= it.x && px <= it.x + it.w && py >= it.y && py <= it.y + it.h);
    if (hit) {
      this.cb.onTextEdit?.({ mode: 'edit', item: hit });
      return;
    }
    if (this.session.readOnly) {
      this.cb.onNotice?.('Lecture seule : ce carnet est ouvert pour écriture dans un autre onglet.');
      return;
    }
    const w = Math.max(120, Math.min(420, r.page.width - px - 24));
    this.cb.onTextEdit?.({ mode: 'create', pageId: r.page.id, x: px, y: py - this.textStyle.size * 0.9, w });
  }

  /** Valide l'édition d'un bloc de texte (création, modification ou suppression si vide). Une validation = une action. */
  commitText(req: TextEditRequest, text: string, style: TextStyle, width?: number): void {
    const clean = text.replace(/\s+$/u, '');
    if (req.mode === 'edit') {
      const before = this.session.getItem(req.item.pageId, req.item.id) as TextItem | undefined;
      if (!before) return;
      if (!clean) {
        this.session.apply([{ kind: 'item', id: before.id, pageId: before.pageId, before }], 'Supprimer le texte');
        return;
      }
      const next: TextItem = { ...before, ...style, text: clean, w: width ?? before.w };
      next.h = textHeight(next);
      const same = (Object.keys(next) as (keyof TextItem)[]).every((k) => next[k] === before[k]);
      if (!same) this.session.apply([{ kind: 'item', id: before.id, pageId: before.pageId, before, after: next }], 'Modifier le texte');
      return;
    }
    if (!clean || !this.session.isLoaded(req.pageId)) return;
    const it: TextItem = { kind: 'text', id: newId(), pageId: req.pageId, x: req.x, y: req.y, w: width ?? req.w, h: 0, text: clean, ...style, order: nextOrder(), createdAt: Date.now(), v: 2 };
    it.h = textHeight(it);
    this.session.apply([{ kind: 'item', id: it.id, pageId: it.pageId, after: it }], 'Ajouter du texte');
  }

  /** Insère une image (déjà enregistrée dans le magasin binaire) sur la page courante. */
  insertImage(blobId: string, mime: string, width: number, height: number): boolean {
    const r = this.layout[this.currentPageIndex()];
    if (!r || !this.session.isLoaded(r.page.id) || this.session.readOnly) return false;
    const vp = this.main.vp;
    const k = Math.min(1, (r.page.width * 0.7) / width, (r.page.height * 0.6) / height);
    const w = width * k;
    const h = height * k;
    const [cx, cy] = vp.toWorld(vp.width / 2, vp.height / 2);
    const x = Math.max(0, Math.min(r.page.width - w, cx - r.x - w / 2));
    const y = Math.max(0, Math.min(r.page.height - h, cy - r.y - h / 2));
    const it: ImageItem = { kind: 'image', id: newId(), pageId: r.page.id, x, y, w, h, blobId, mime, order: nextOrder(), createdAt: Date.now(), v: 2 };
    this.session.apply([{ kind: 'item', id: it.id, pageId: it.pageId, after: it }], 'Ajouter une image');
    this.selection = { pageId: r.page.id, ids: new Set([it.id]) };
    this.cb.onToolRequest?.('select');
    this.emitSelection(true);
    this.invalidateLive();
    return true;
  }

  // ======================= Rendu =======================

  private onSessionChange(e: SessionEvent): void {
    if (this.selection) {
      for (const id of Array.from(this.selection.ids)) {
        if (!this.session.getStroke(this.selection.pageId, id) && !this.session.getItem(this.selection.pageId, id)) this.selection.ids.delete(id);
      }
      if (this.selection.ids.size === 0) this.selection = null;
      this.emitSelection(true);
    }
    // Rendu incrémental seulement si les ajouts sont au sommet de la pile (sinon l'ordre serait faux).
    const incremental = e.additiveOnly && e.added.every((s) => s.tool !== 'highlighter' && this.isTopmost(s));
    for (const sf of this.surfaces()) {
      if (incremental && !sf.needFull && !sf.cssTransformed) for (const s of e.added) this.drawIncremental(sf, s);
      else sf.needFull = true;
      sf.needLive = true;
    }
    this.schedule();
  }

  private isTopmost(s: Stroke): boolean {
    const list = this.session.getStrokes(s.pageId);
    return list[list.length - 1]?.id === s.id || list.slice(-8).every((o) => o.order <= s.order);
  }

  private viewChanged(): void {
    const m = this.main;
    if (this.lastFullMs > 12 && this.interaction?.kind === 'nav' && this.interaction.surf === m) {
      // Rendu complet trop coûteux pendant le geste : transformation CSS du dernier rendu,
      // puis rendu net dès que le geste se stabilise.
      this.applyCssTransform();
      this.settle(120);
    } else {
      m.needFull = true;
    }
    m.needLive = true;
    this.schedule();
  }

  private settle(delay = 0): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.main.needFull = true;
      this.preload();
      this.schedule();
    }, delay);
  }

  private applyCssTransform(): void {
    const m = this.main;
    const r = m.renderedView;
    const k = m.vp.scale / r.scale;
    const tx = m.vp.tx - r.tx * k;
    const ty = m.vp.ty - r.ty * k;
    m.base.style.transformOrigin = '0 0';
    m.base.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
    m.cssTransformed = true;
  }

  private invalidateLive(): void {
    for (const s of this.surfaces()) s.needLive = true;
    this.schedule();
  }

  private schedule(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  private renderNow(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.frame();
  }

  private frame(): void {
    this.raf = 0;
    const now = performance.now();
    if (this.anim) {
      const t = Math.min(1, (now - this.anim.start) / this.anim.dur);
      const e = 1 - Math.pow(1 - t, 3);
      const { from, to } = this.anim;
      const vp = this.main.vp;
      vp.scale = from.scale + (to.scale - from.scale) * e;
      vp.tx = from.tx + (to.tx - from.tx) * e;
      vp.ty = from.ty + (to.ty - from.ty) * e;
      this.main.needFull = true;
      this.main.needLive = true;
      if (t >= 1) {
        this.anim = null;
        this.preload();
      } else this.schedule();
    }
    if (this.pendingEventTime) {
      this.perf.eventToFrameMs = ema(this.perf.eventToFrameMs, now - this.pendingEventTime);
      this.pendingEventTime = 0;
    }
    for (const s of this.surfaces()) {
      if (s.needFull) {
        s.needFull = false;
        const t = performance.now();
        this.renderFull(s);
        if (s.kind === 'main') {
          this.lastFullMs = performance.now() - t;
          this.perf.fullRenderMs = ema(this.perf.fullRenderMs, this.lastFullMs);
        }
        s.needLive = true;
      }
    }
    for (const s of this.surfaces()) {
      if (s.needLive) {
        s.needLive = false;
        const t = performance.now();
        this.renderLive(s);
        if (s.kind === 'main') this.perf.liveFrameMs = ema(this.perf.liveFrameMs, performance.now() - t);
      }
    }
    if (now - this.eventWindowStart > 1000) {
      this.perf.eventsPerSecond = Math.round((this.eventCount * 1000) / (now - this.eventWindowStart));
      this.eventCount = 0;
      this.eventWindowStart = now;
      if (this.settings.showPerf) this.cb.onPerf?.({ ...this.perf });
    }
    this.emitView();
  }

  private emitView(): void {
    const idx = this.currentPageIndex();
    const v: ViewInfo = { scale: this.main.vp.scale, pageIndex: idx, pageCount: this.layout.length, fitScale: this.fitScaleFor(idx), layout: this.settings.pageLayout };
    const key = `${v.scale.toFixed(3)}|${v.pageIndex}|${v.pageCount}|${v.layout}`;
    if (key !== this.lastViewKey) {
      this.lastViewKey = key;
      this.cb.onView?.(v);
      if (this.settings.pageLayout === 'vertical') this.preload();
    }
    if (this.selection) this.emitSelection();
  }

  private pageTransform(ctx: CanvasRenderingContext2D, r: PageRect, s: Surface): void {
    const k = s.vp.scale * s.dpr;
    ctx.setTransform(k, 0, 0, k, (s.vp.tx + r.x * s.vp.scale) * s.dpr, (s.vp.ty + r.y * s.vp.scale) * s.dpr);
  }

  private renderFull(s: Surface): void {
    const ctx = s.bctx;
    if (s.cssTransformed) {
      s.base.style.transform = '';
      s.cssTransformed = false;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.deskColor;
    ctx.fillRect(0, 0, s.base.width, s.base.height);
    const vis = s.vp.visibleWorld();
    let hidden = this.hidden;
    if (this.editingId) hidden = new Set([...(hidden ?? []), this.editingId]);
    for (const r of this.layout) {
      const pageBox: BBox = [r.x, r.y, r.x + r.page.width, r.y + r.page.height];
      if (!bboxIntersects(pageBox, vis)) continue;
      this.pageTransform(ctx, r, s);
      if (s.kind === 'main') {
        ctx.fillStyle = 'rgba(20, 24, 32, 0.08)';
        ctx.fillRect(-1, 1, r.page.width + 2, r.page.height + 3);
        ctx.fillStyle = 'rgba(20, 24, 32, 0.06)';
        ctx.fillRect(1, 3, r.page.width, r.page.height + 2);
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, r.page.width, r.page.height);
      ctx.clip();
      const local: BBox = [vis[0] - r.x, vis[1] - r.y, vis[2] - r.x, vis[3] - r.y];
      renderPageContent(ctx, r.page, this.session.getStrokes(r.page.id), this.session.getItems(r.page.id), s.vp.scale, local, hidden);
      ctx.restore();
    }
    s.renderedView = s.vp.snapshot();
  }

  private drawIncremental(sf: Surface, s: Stroke): void {
    const r = this.rectOf(s.pageId);
    if (!r) return;
    const ctx = sf.bctx;
    this.pageTransform(ctx, r, sf);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, r.page.width, r.page.height);
    ctx.clip();
    fillOutline(ctx, s.tool, s.color, strokePath(s));
    ctx.restore();
  }

  private renderLive(sf: Surface): void {
    const ctx = sf.lctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, sf.live.width, sf.live.height);
    const a = this.interaction;
    const scale = sf.vp.scale;
    const d = sf.dpr;

    if (a?.kind === 'draw') {
      // Même calcul que le trait enregistré : aucun « saut » au lever du stylet.
      const data = this.liveData(a, true);
      const outline = strokeOutline({ tool: a.tool, width: a.ink.width, style: strokeStyleFrom(a.tool, this.settings, a.ink.smoothing, a.pointerType === 'pen'), points: data }, !!a.shape);
      this.pageTransform(ctx, a.page, sf);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, a.page.page.width, a.page.page.height);
      ctx.clip();
      fillOutline(ctx, a.tool, a.ink.color, outlineToPath(outline));
      ctx.restore();
    }

    if (a?.kind === 'select') {
      this.pageTransform(ctx, a.page, sf);
      ctx.beginPath();
      if (a.mode === 'lasso') {
        if (a.poly.length >= 4) {
          ctx.moveTo(a.poly[0], a.poly[1]);
          for (let i = 2; i < a.poly.length; i += 2) ctx.lineTo(a.poly[i], a.poly[i + 1]);
          ctx.closePath();
        }
      } else {
        ctx.rect(Math.min(a.start[0], a.end[0]), Math.min(a.start[1], a.end[1]), Math.abs(a.end[0] - a.start[0]), Math.abs(a.end[1] - a.start[1]));
      }
      ctx.fillStyle = 'rgba(47, 110, 220, 0.08)';
      ctx.fill();
      ctx.setLineDash([6 / scale, 5 / scale]);
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = '#2f6edc';
      ctx.stroke();
      ctx.setLineDash([]);
      const area = this.areaOf(a);
      if (area) {
        const ids = this.selectInArea(a.page.page.id, area);
        for (const s of this.session.getStrokes(a.page.page.id)) if (ids.has(s.id)) haloStroke(ctx, s, scale);
        for (const it of this.session.getItems(a.page.page.id)) if (ids.has(it.id)) this.outlineItem(ctx, it, scale);
      }
    }

    if (this.selection) {
      const r = this.rectOf(this.selection.pageId);
      const { strokes, items } = this.selectedElements();
      if (r) {
        this.pageTransform(ctx, r, sf);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, r.page.width, r.page.height);
        ctx.clip();
        if (a?.kind === 'transform') {
          const t = this.transformOf(a);
          const ts = strokes.map((s) => this.transformStroke(s, t));
          const ti = items.map((it) => transformItem(it, t.k, t.dx, t.dy));
          for (const s of ts) haloStroke(ctx, s, scale);
          for (const it of ti) this.outlineItem(ctx, it, scale);
          drawItems(ctx, ti, scale, 'image');
          drawStrokes(ctx, ts, 'under');
          drawItems(ctx, ti, scale, 'text');
          drawStrokes(ctx, ts, 'over');
        } else {
          for (const s of strokes) haloStroke(ctx, s, scale);
          for (const it of items) this.outlineItem(ctx, it, scale);
        }
        ctx.restore();
      }
      const rect = this.selectionScreenRect(sf);
      if (rect) {
        ctx.setTransform(d, 0, 0, d, 0, 0);
        const pad = 8;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#2f6edc';
        ctx.strokeRect(rect.x - pad, rect.y - pad, rect.w + pad * 2, rect.h + pad * 2);
        ctx.setLineDash([]);
        for (const [x, y] of [
          [rect.x - pad, rect.y - pad],
          [rect.x + rect.w + pad, rect.y - pad],
          [rect.x - pad, rect.y + rect.h + pad],
          [rect.x + rect.w + pad, rect.y + rect.h + pad],
        ]) {
          ctx.beginPath();
          ctx.arc(x, y, 7, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#2f6edc';
          ctx.stroke();
        }
      }
    }

    // Fenêtre de zoom : cadre sur la page principale, zone d'avance automatique dans la fenêtre.
    if (this.zoom && this.zoomFrame) {
      ctx.setTransform(d, 0, 0, d, 0, 0);
      if (sf.kind === 'main') {
        const fr = this.frameScreenRect();
        if (fr) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#2f6edc';
          ctx.strokeRect(fr.x, fr.y, fr.w, fr.h);
          ctx.fillStyle = 'rgba(47, 110, 220, 0.07)';
          ctx.fillRect(fr.x + fr.w * (1 - ZOOM_ADVANCE_ZONE), fr.y, fr.w * ZOOM_ADVANCE_ZONE, fr.h);
          // Onglet de déplacement.
          ctx.fillStyle = '#2f6edc';
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(fr.x - 1, fr.y - 26, 60, 26, [8, 8, 0, 0]);
          else ctx.rect(fr.x - 1, fr.y - 26, 60, 26);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
            ctx.beginPath();
            ctx.arc(fr.x + 22 + i * 8, fr.y - 17 + j * 8, 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
          // Poignée de redimensionnement.
          ctx.beginPath();
          ctx.arc(fr.x + fr.w, fr.y + fr.h, 9, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = '#2f6edc';
          ctx.stroke();
        }
      } else {
        const w = sf.vp.width;
        ctx.fillStyle = 'rgba(47, 110, 220, 0.06)';
        ctx.fillRect(w * (1 - ZOOM_ADVANCE_ZONE), 0, w * ZOOM_ADVANCE_ZONE, sf.vp.height);
        ctx.strokeStyle = 'rgba(47, 110, 220, 0.35)';
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(w * (1 - ZOOM_ADVANCE_ZONE), 0);
        ctx.lineTo(w * (1 - ZOOM_ADVANCE_ZONE), sf.vp.height);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Curseur : gomme (cercle de diamètre exact) ou aperçu de la pointe au survol.
    const hover = sf.hover;
    if (hover && (a?.kind === 'erase' ? a.surf === sf : !a)) {
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.beginPath();
      if (this.tool === 'eraser' || a?.kind === 'erase') {
        ctx.arc(hover.x, hover.y, this.settings.eraserSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(30,36,51,0.65)';
        ctx.stroke();
      } else if (this.tool === 'pen' || this.tool === 'highlighter') {
        const st = this.tool === 'pen' ? this.styles.pens[this.styles.penType] : this.styles.highlighter;
        ctx.arc(hover.x, hover.y, Math.max(1.5, (st.width * scale) / 2), 0, Math.PI * 2);
        ctx.fillStyle = st.color;
        ctx.globalAlpha = this.tool === 'highlighter' ? 0.3 : 0.5;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  private outlineItem(ctx: CanvasRenderingContext2D, it: PageItem, scale: number): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(47, 110, 220, 0.8)';
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(it.x, it.y, it.w, it.h);
    ctx.restore();
  }

  // ======================= Accès tests / diagnostic =======================

  debugState(): { scale: number; tx: number; ty: number; strokes: number; items: number; tool: Tool; page: number; layout: string; interaction: string | null } {
    return {
      ...this.main.vp.snapshot(),
      strokes: this.session.strokeCount(),
      items: this.session.itemCount(),
      tool: this.tool,
      page: this.currentPageIndex(),
      layout: this.settings.pageLayout,
      interaction: this.interaction?.kind ?? null,
    };
  }

  selectionIds(): string[] {
    return this.selection ? Array.from(this.selection.ids) : [];
  }
}

function ema(prev: number, v: number): number {
  return prev ? prev * 0.85 + v * 0.15 : v;
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
