import { newId, nextOrder } from '../model/ids';
import type { Change, NotebookSession, SessionEvent } from '../model/session';
import {
  POINT_STRIDE,
  type ImageItem,
  type InkTool,
  type PageItem,
  type Stroke,
  type TextItem,
  type TextStyle,
} from '../model/types';
import { bboxIntersects, bboxUnion, computeBBox, eraseFromPoints, strokeHitsCircle, strokeMaxRadius, transformPoints, type BBox } from './geometry';
import { coalesced, predicted, sampleFrom, type Sample } from './input';
import { drawItems, textHeight } from './items';
import { computeLayout, renderPageContent, type PageRect } from './pageRender';
import { areaFromPolygon, areaFromRect, itemBBox, itemSelected, squareFrom, strokeSelected, transformItem, type Area } from './selection';
import {
  DEFAULT_SETTINGS,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TOOL_STYLES,
  strokeStyleFrom,
  type InkSettings,
  type InkStyle,
  type Tool,
  type ToolStyles,
} from './settings';
import { drawStrokes, fillOutline, haloStroke, outlineToPath, strokeOutline } from './strokeRender';
import { Viewport } from './viewport';

/**
 * Moteur d'écriture.
 *
 * Indépendant de React : l'interface lui transmet l'outil et les réglages, il lui
 * renvoie quelques événements (page courante, zoom, sélection, édition de texte).
 * Aucun rendu React n'a lieu pendant le tracé.
 *
 * Toutes les entrées passent par un arbitre unique (onDown/onMove/onUp) :
 * à tout instant il y a AU PLUS UNE interaction active (tracé, gomme, sélection,
 * transformation, navigation, appui texte). Un même geste ne peut donc pas écrire,
 * sélectionner et naviguer à la fois.
 *
 * Règles d'arbitrage :
 *  - stylet et souris écrivent avec l'outil courant ; un doigt posé pendant ce temps est ignoré (paume) ;
 *  - mode « stylet uniquement » : un doigt fait défiler / tourne les pages, deux doigts zooment ;
 *  - mode « doigt et stylet »  : un doigt écrit, deux doigts naviguent ; si un second doigt arrive
 *    juste après le premier (< 180 ms), le début de trait est annulé et le geste devient une navigation ;
 *  - un stylet qui se pose pendant une navigation au doigt l'interrompt et écrit.
 *
 * Deux canvas superposés : « base » (pages, papier, contenu enregistré) et « live »
 * (trait en cours, zone de sélection, poignées, curseur de gomme).
 */

const TAP_MAX_MS = 220;
const TAP_MAX_MOVE = 10;
const YOUNG_MS = 180;
const MARGIN = 16;
const HANDLE_HIT = 22;
const FIT_MAX = 1.6;

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

interface DrawI {
  kind: 'draw';
  pointerId: number;
  pointerType: string;
  tool: InkTool;
  ink: InkStyle;
  page: PageRect;
  data: number[];
  t0: number;
  predicted: number[];
  startedAt: number;
}
interface EraseI {
  kind: 'erase';
  pointerId: number;
  pointerType: string;
  last: [number, number] | null;
  startedAt: number;
}
interface SelectI {
  kind: 'select';
  pointerId: number;
  pointerType: string;
  page: PageRect;
  mode: 'lasso' | 'rect' | 'square';
  poly: number[];
  start: [number, number];
  end: [number, number];
  startedAt: number;
}
interface TransformI {
  kind: 'transform';
  pointerId: number;
  pointerType: string;
  handle: Handle;
  page: PageRect;
  start: [number, number];
  dx: number;
  dy: number;
  k: number;
  anchor: [number, number];
  corner: [number, number];
  startedAt: number;
}
interface NavI {
  kind: 'nav';
  source: 'touch' | 'mouse' | 'wheel';
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
interface TextTapI {
  kind: 'textTap';
  pointerId: number;
  pointerType: string;
  sx: number;
  sy: number;
  moved: boolean;
  startedAt: number;
}
type Interaction = DrawI | EraseI | SelectI | TransformI | NavI | TextTapI;
type ToolInteraction = Exclude<Interaction, NavI>;

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

export interface PerfStats {
  fullRenderMs: number;
  liveFrameMs: number;
  eventToFrameMs: number;
  eventsPerSecond: number;
  pointsPerStroke: number;
}

export type TextEditRequest =
  | { mode: 'edit'; item: TextItem }
  | { mode: 'create'; pageId: string; x: number; y: number; w: number };

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
}

interface Clipboard {
  strokes: Stroke[];
  items: PageItem[];
  sourcePageId: string;
}
let clipboard: Clipboard | null = null;

export class InkEngine {
  readonly vp = new Viewport();
  private base: HTMLCanvasElement;
  private live: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private lctx: CanvasRenderingContext2D;
  private dpr = 1;
  private origin: [number, number] = [0, 0];
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
  private touches = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  private ignored = new Set<number>();
  private selection: Selection | null = null;
  private hidden: Set<string> | null = null;
  private editingId: string | null = null;
  private hover: { x: number; y: number } | null = null;
  private spaceDown = false;
  private wasFit = true;
  private anim: { from: { scale: number; tx: number; ty: number }; to: { scale: number; tx: number; ty: number }; start: number; dur: number } | null = null;
  private wheelTimer = 0;

  private needFull = true;
  private needLive = true;
  private raf = 0;
  private renderedView = { scale: 1, tx: 0, ty: 0 };
  private cssTransformed = false;
  private settleTimer = 0;
  private lastFullMs = 0;
  private pendingEventTime = 0;
  private perf: PerfStats = { fullRenderMs: 0, liveFrameMs: 0, eventToFrameMs: 0, eventsPerSecond: 0, pointsPerStroke: 0 };
  private eventCount = 0;
  private eventWindowStart = performance.now();
  private lastViewKey = '';
  private lastSelKey = '';
  private disposers: (() => void)[] = [];
  private unsubSession: () => void = () => {};

  constructor(
    private readonly container: HTMLElement,
    private session: NotebookSession,
    private readonly cb: EngineCallbacks = {},
    initial?: { layout?: 'horizontal' | 'vertical'; pageIndex?: number },
  ) {
    this.base = document.createElement('canvas');
    this.live = document.createElement('canvas');
    this.base.className = 'ink-base';
    this.live.className = 'ink-live';
    this.base.setAttribute('aria-hidden', 'true');
    this.live.setAttribute('role', 'img');
    this.live.setAttribute('aria-label', 'Page du carnet — zone d’écriture');
    container.append(this.base, this.live);
    this.bctx = this.base.getContext('2d', { alpha: false })!;
    this.lctx = this.live.getContext('2d', { desynchronized: true } as CanvasRenderingContext2DSettings)!;
    if (initial?.layout) this.settings = { ...this.settings, pageLayout: initial.layout };
    this.cur = Math.max(0, initial?.pageIndex ?? 0);
    this.relayout();
    this.resize();
    this.goToPage(this.cur, false);
    this.bind();
    this.unsubSession = this.session.onChange((e) => this.onSessionChange(e));
  }

  // ======================= Cycle de vie =======================

  destroy(): void {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.settleTimer);
    clearTimeout(this.wheelTimer);
    for (const d of this.disposers) d();
    this.unsubSession();
    this.base.remove();
    this.live.remove();
  }

  private listen(el: EventTarget, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions): void {
    el.addEventListener(type, fn as EventListener, opts);
    this.disposers.push(() => el.removeEventListener(type, fn as EventListener, opts));
  }

  private bind(): void {
    const el = this.live;
    this.listen(el, 'pointerdown', (e: PointerEvent) => this.onDown(e));
    this.listen(el, 'pointermove', (e: PointerEvent) => this.onMove(e));
    this.listen(el, 'pointerup', (e: PointerEvent) => this.onUp(e, false));
    this.listen(el, 'pointercancel', (e: PointerEvent) => this.onUp(e, true));
    this.listen(el, 'pointerleave', (e: PointerEvent) => {
      if (e.pointerType !== 'touch' && !this.interaction) {
        this.hover = null;
        this.invalidateLive();
      }
    });
    this.listen(el, 'lostpointercapture', (e: PointerEvent) => {
      const a = this.interaction;
      if (a && a.kind !== 'nav' && a.pointerId === e.pointerId) this.onUp(e, false);
    });
    // iOS : empêche loupe, sélection de texte, menu contextuel et zoom de page pendant l'écriture.
    const prevent = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    this.listen(el, 'touchstart', prevent, { passive: false });
    this.listen(el, 'touchmove', prevent, { passive: false });
    this.listen(el, 'contextmenu', prevent);
    this.listen(el, 'selectstart', prevent);
    this.listen(el, 'dblclick', prevent);
    this.listen(el, 'wheel', (e: WheelEvent) => this.onWheel(e), { passive: false });
    // Safari macOS : pincement sur trackpad (événements propriétaires « gesture* »).
    let gScale = 1;
    this.listen(el, 'gesturestart', (e: Event & { scale: number }) => {
      prevent(e);
      gScale = e.scale ?? 1;
    });
    this.listen(el, 'gesturechange', (e: Event & { scale: number; clientX: number; clientY: number }) => {
      prevent(e);
      if (this.touches.size > 0) return; // sur iPad, les pointeurs tactiles gèrent déjà le pincement
      const f = e.scale / gScale;
      gScale = e.scale;
      this.zoomAtScreen(e.clientX - this.origin[0], e.clientY - this.origin[1], f);
    });
    this.listen(el, 'gestureend', prevent);
    this.listen(window, 'keydown', (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) this.spaceDown = true;
    });
    this.listen(window, 'keyup', (e: KeyboardEvent) => {
      if (e.code === 'Space') this.spaceDown = false;
    });
    // Interruption (app en arrière-plan, appel…) : on termine proprement le geste en cours.
    this.listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.finishInteraction(true);
    });
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.container);
    this.disposers.push(() => ro.disconnect());
    this.listen(window, 'scroll', () => this.updateOrigin(), { passive: true });
    this.listen(window, 'resize', () => this.resize());
    this.listen(document, 'fullscreenchange', () => this.resize());
    this.listen(document, 'webkitfullscreenchange', () => this.resize());
  }

  // ======================= Mise en page & vue =======================

  relayout(): void {
    const { rects, bounds } = computeLayout(this.session.pageOrder, this.settings.pageLayout);
    this.layout = rects;
    this.bounds = bounds;
    this.cur = Math.min(this.cur, Math.max(0, rects.length - 1));
    this.needFull = true;
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

  private updateOrigin(): void {
    const r = this.container.getBoundingClientRect();
    this.origin = [r.left, r.top];
  }

  /** Recalcule tailles et repères (rotation, plein écran, mode concentration, clavier virtuel). */
  resize(): void {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    this.updateOrigin();
    // Plafonne la surface pour rester sous les limites mémoire canvas d'iOS.
    const maxArea = 16_000_000;
    let dpr = window.devicePixelRatio || 1;
    if (w * h * dpr * dpr > maxArea) dpr = Math.sqrt(maxArea / (w * h));
    const prevW = this.vp.width;
    const prevH = this.vp.height;
    if (w === prevW && h === prevH && dpr === this.dpr) return;
    const anchor = prevW ? this.vp.toWorld(prevW / 2, prevH / 3) : null;
    this.dpr = dpr;
    for (const c of [this.base, this.live]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    this.vp.width = w;
    this.vp.height = h;
    if (anchor) {
      if (this.wasFit) {
        const v = this.viewForPage(this.currentPageIndex(), 1, true);
        this.vp.scale = v.scale;
        if (this.settings.pageLayout === 'horizontal') {
          this.vp.tx = v.tx;
          this.vp.ty = h / 3 - anchor[1] * v.scale;
        } else {
          this.vp.tx = w / 2 - anchor[0] * v.scale;
          this.vp.ty = h / 3 - anchor[1] * v.scale;
        }
      } else {
        this.vp.tx = w / 2 - anchor[0] * this.vp.scale;
        this.vp.ty = h / 3 - anchor[1] * this.vp.scale;
      }
      this.clampView(false);
    }
    this.needFull = true;
    this.needLive = true;
    this.renderNow();
  }

  fitScaleFor(index: number): number {
    const r = this.layout[index];
    const pw = r ? r.page.width : 794;
    return Math.min(FIT_MAX, Math.max(0.2, (this.vp.width - MARGIN * 2) / pw));
  }

  /** Vue cible pour afficher une page : largeur ajustée (ou zoom conservé), haut de page visible. */
  private viewForPage(index: number, dir: number, forceFit = false): { scale: number; tx: number; ty: number } {
    const r = this.layout[index];
    if (!r) return this.vp.snapshot();
    const keepZoom = !forceFit && !this.wasFit;
    const scale = keepZoom ? this.vp.scale : this.fitScaleFor(index);
    const pw = r.page.width * scale;
    const ph = r.page.height * scale;
    let tx: number;
    if (pw + MARGIN * 2 <= this.vp.width) tx = (this.vp.width - pw) / 2 - r.x * scale;
    else tx = dir >= 0 ? MARGIN - r.x * scale : this.vp.width - MARGIN - (r.x + r.page.width) * scale;
    const ty = ph + MARGIN * 2 <= this.vp.height ? (this.vp.height - ph) / 2 - r.y * scale : MARGIN - r.y * scale;
    if (this.settings.pageLayout === 'vertical') {
      const cx = (this.bounds[0] + this.bounds[2]) / 2;
      return { scale, tx: this.vp.width / 2 - cx * scale, ty: MARGIN - r.y * scale };
    }
    return { scale, tx, ty };
  }

  private pageBounds(index: number): BBox {
    const r = this.layout[index];
    return r ? [r.x, r.y, r.x + r.page.width, r.y + r.page.height] : this.bounds;
  }

  /** Bornes de tx pour la page courante (égales si la page tient en largeur : centrée). */
  private txRange(b: BBox): [number, number] {
    const s = this.vp.scale;
    const pw = (b[2] - b[0]) * s;
    if (pw + MARGIN * 2 <= this.vp.width) {
      const c = (this.vp.width - pw) / 2 - b[0] * s;
      return [c, c];
    }
    return [this.vp.width - MARGIN - b[2] * s, MARGIN - b[0] * s];
  }

  private clampY(b: BBox): void {
    const s = this.vp.scale;
    const ph = (b[3] - b[1]) * s;
    if (ph + MARGIN * 2 <= this.vp.height) {
      this.vp.ty = (this.vp.height - ph) / 2 - b[1] * s;
    } else {
      const max = MARGIN - b[1] * s;
      const min = this.vp.height - MARGIN - b[3] * s;
      this.vp.ty = Math.min(max, Math.max(min, this.vp.ty));
    }
  }

  /**
   * Contraint la vue. En mode horizontal, la vue reste dans la page courante ;
   * `overscroll` autorise temporairement à dépasser le bord (geste de changement de page).
   */
  private clampView(overscroll: boolean, rawTx?: number, resist = false): void {
    if (this.settings.pageLayout === 'vertical') {
      this.vp.clamp(this.bounds, MARGIN);
      return;
    }
    const b = this.pageBounds(this.cur);
    this.clampY(b);
    const [min, max] = this.txRange(b);
    const raw = rawTx ?? this.vp.tx;
    const clamped = Math.min(max, Math.max(min, raw));
    if (!overscroll) {
      this.vp.tx = clamped;
      return;
    }
    let over = raw - clamped;
    const atStart = over > 0 && this.cur === 0;
    const atEnd = over < 0 && this.cur === this.layout.length - 1;
    if (resist || atStart || atEnd) over *= 0.3;
    over = Math.max(-this.vp.width, Math.min(this.vp.width, over));
    this.vp.tx = clamped + over;
  }

  private animateTo(to: { scale: number; tx: number; ty: number }, dur = 260): void {
    this.anim = { from: this.vp.snapshot(), to, start: performance.now(), dur };
    this.schedule();
  }

  private finishAnimation(): void {
    if (!this.anim) return;
    const { to } = this.anim;
    this.anim = null;
    this.vp.scale = to.scale;
    this.vp.tx = to.tx;
    this.vp.ty = to.ty;
    this.needFull = true;
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
      this.vp.scale = target.scale;
      this.vp.tx = target.tx;
      this.vp.ty = target.ty;
      this.viewChanged();
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
    const s = Math.min((this.vp.width - MARGIN * 2) / r.page.width, (this.vp.height - MARGIN * 2) / r.page.height);
    this.wasFit = false;
    this.cur = i;
    this.vp.scale = Math.max(this.vp.minScale, Math.min(this.vp.maxScale, s));
    const t = this.viewForPage(i, 1);
    this.animateTo({ scale: this.vp.scale, tx: t.tx, ty: t.ty });
  }

  zoomBy(f: number): void {
    this.zoomAtScreen(this.vp.width / 2, this.vp.height / 2, f);
    this.settle();
  }

  private zoomAtScreen(sx: number, sy: number, f: number): void {
    this.finishAnimation();
    this.vp.zoomAt(sx, sy, f);
    this.wasFit = false;
    this.clampView(false);
    this.viewChanged();
  }

  restoreView(v: { scale: number; cx: number; cy: number; page?: number }): void {
    if (typeof v.page === 'number') this.cur = Math.max(0, Math.min(v.page, this.layout.length - 1));
    this.vp.scale = Math.min(this.vp.maxScale, Math.max(this.vp.minScale, v.scale));
    this.vp.tx = this.vp.width / 2 - v.cx * this.vp.scale;
    this.vp.ty = this.vp.height / 2 - v.cy * this.vp.scale;
    this.wasFit = Math.abs(this.vp.scale - this.fitScaleFor(this.cur)) < 0.01;
    this.clampView(false);
    this.viewChanged();
    this.preload();
  }

  savedView(): { scale: number; cx: number; cy: number; page: number } {
    const [cx, cy] = this.vp.toWorld(this.vp.width / 2, this.vp.height / 2);
    return { scale: this.vp.scale, cx, cy, page: this.currentPageIndex() };
  }

  currentPageIndex(): number {
    if (this.settings.pageLayout === 'horizontal') return this.cur;
    const [, cy] = this.vp.toWorld(this.vp.width / 2, this.vp.height / 2);
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

  /** Coordonnées écran (relatives à la zone de dessin) d'un point de page. */
  pageToScreen(pageId: string, x: number, y: number): [number, number] | null {
    const r = this.rectOf(pageId);
    return r ? this.vp.toScreen(r.x + x, r.y + y) : null;
  }

  /** Convertit un point écran (relatif au canvas) en coordonnées page. */
  screenToPage(sx: number, sy: number): { pageId: string; x: number; y: number } | null {
    const [wx, wy] = this.vp.toWorld(sx, sy);
    const r = this.pageAt(wx, wy);
    return r ? { pageId: r.page.id, x: wx - r.x, y: wy - r.y } : null;
  }

  /** Charge le contenu des pages visibles et voisines. */
  private preload(): void {
    const i = this.currentPageIndex();
    const vis = this.vp.visibleWorld();
    for (const r of this.layout) {
      const near = Math.abs(r.index - i) <= 1;
      const visible = bboxIntersects([r.x, r.y, r.x + r.page.width, r.y + r.page.height], vis);
      if ((near || visible) && !this.session.isLoaded(r.page.id)) {
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
    const layoutChanged = s.pageLayout !== this.settings.pageLayout;
    if (layoutChanged) {
      this.setLayoutMode(s.pageLayout);
    }
    this.settings = s;
    this.invalidateLive();
  }

  setTextStyle(t: TextStyle): void {
    this.textStyle = t;
  }

  setDeskColor(c: string): void {
    this.deskColor = c;
    this.needFull = true;
    this.schedule();
  }

  /** Masque un bloc de texte pendant son édition dans le champ superposé. */
  setEditing(id: string | null): void {
    this.editingId = id;
    this.needFull = true;
    this.schedule();
  }

  // ======================= Arbitrage des entrées =======================

  private local(e: PointerEvent): Sample {
    return sampleFrom(e, this.origin[0], this.origin[1]);
  }

  private countEvent(n: number, timeStamp: number): void {
    this.eventCount += n;
    if (!this.pendingEventTime) this.pendingEventTime = timeStamp;
  }

  private isYoung(a: ToolInteraction): boolean {
    if (performance.now() - a.startedAt > YOUNG_MS) return false;
    return a.kind !== 'draw' || a.data.length < 10 * POINT_STRIDE;
  }

  private onDown(e: PointerEvent): void {
    this.updateOrigin();
    const s = this.local(e);
    if (e.pointerType === 'pen' && !this.penDetected) {
      this.penDetected = true;
      this.cb.onPenDetected?.();
    }
    const a = this.interaction;

    if (e.pointerType === 'touch') {
      if (a && a.kind !== 'nav') {
        if (a.pointerType !== 'touch') {
          // Paume ou doigt pendant que le stylet / la souris travaille : ignoré.
          this.ignored.add(e.pointerId);
          return;
        }
        if (this.isYoung(a)) {
          // Deuxième doigt juste après le premier : c'est une navigation, pas un trait.
          this.cancelInteraction();
          this.touches.set(e.pointerId, { x: s.x, y: s.y, sx: s.x, sy: s.y });
          this.startNav('touch');
          return;
        }
        this.ignored.add(e.pointerId);
        return;
      }
      this.touches.set(e.pointerId, { x: s.x, y: s.y, sx: s.x, sy: s.y });
      if (a?.kind === 'nav') {
        if (a.source === 'touch') {
          a.maxTouches = Math.max(a.maxTouches, this.touches.size);
          this.rebaseNav();
        }
        return;
      }
      if (this.touches.size >= 2 || this.settings.fingerMode === 'pen-only' || this.tool === 'text') {
        this.startNav('touch');
        return;
      }
      if (this.settings.palmHeuristic && e.width > 80 && e.height > 80) {
        this.touches.delete(e.pointerId);
        this.ignored.add(e.pointerId);
        return;
      }
      this.startTool(e, s);
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
      } else {
        return;
      }
    }
    this.finishAnimation();
    if (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && this.spaceDown))) {
      try {
        this.live.setPointerCapture(e.pointerId);
      } catch {
        /* ignoré */
      }
      this.startNav('mouse', e.pointerId, s);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.startTool(e, s);
  }

  private startTool(e: PointerEvent, s: Sample): void {
    this.finishAnimation();
    try {
      this.live.setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
    const [wx, wy] = this.vp.toWorld(s.x, s.y);
    const tool: Tool = e.buttons & 32 ? 'eraser' : this.tool;
    const now = performance.now();
    const base = { pointerId: e.pointerId, pointerType: e.pointerType, startedAt: now };
    this.hover = null;

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
      const d: DrawI = { kind: 'draw', ...base, tool: inkTool, ink: { ...ink }, page, data: [], t0: s.time, predicted: [] };
      this.interaction = d;
      this.pushSample(d, s);
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
      this.hover = { x: s.x, y: s.y };
      this.invalidateLive();
      return;
    }

    // Sélection
    const handle = this.hitSelection(s.x, s.y);
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
      this.needFull = true;
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

  private pushSample(a: DrawI, s: Sample): void {
    const [wx, wy] = this.vp.toWorld(s.x, s.y);
    const x = wx - a.page.x;
    const y = wy - a.page.y;
    const d = a.data;
    const n = d.length;
    if (n >= POINT_STRIDE && d[n - POINT_STRIDE] === x && d[n - POINT_STRIDE + 1] === y) return;
    d.push(x, y, s.pressure, Math.max(0, s.time - a.t0), s.tilt);
  }

  private onMove(e: PointerEvent): void {
    if (this.ignored.has(e.pointerId)) return;
    const a = this.interaction;

    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      const s = this.local(e);
      const t = this.touches.get(e.pointerId)!;
      t.x = s.x;
      t.y = s.y;
      if (a?.kind === 'nav' && a.source === 'touch') {
        this.updateNav(a);
        return;
      }
    }

    if (!a) {
      if (e.pointerType !== 'touch') {
        const s = this.local(e);
        this.hover = { x: s.x, y: s.y };
        this.invalidateLive();
      }
      return;
    }

    if (a.kind === 'nav') {
      if (a.source === 'mouse' && a.pointerId === e.pointerId) {
        const s = this.local(e);
        this.vp.pan(s.x - a.lastCx, s.y - a.lastCy);
        a.lastCx = s.x;
        a.lastCy = s.y;
        this.clampView(false);
        this.viewChanged();
      }
      return;
    }
    if (a.pointerId !== e.pointerId) return;

    switch (a.kind) {
      case 'draw': {
        const events = coalesced(e);
        for (const ce of events) this.pushSample(a, this.local(ce));
        a.predicted = [];
        if (this.settings.prediction) {
          for (const pe of predicted(e)) {
            const s = this.local(pe);
            const [wx, wy] = this.vp.toWorld(s.x, s.y);
            a.predicted.push(wx - a.page.x, wy - a.page.y, s.pressure, 0, s.tilt);
          }
        }
        this.countEvent(events.length, e.timeStamp);
        this.invalidateLive();
        return;
      }
      case 'erase': {
        for (const ce of coalesced(e)) {
          const s = this.local(ce);
          const [wx, wy] = this.vp.toWorld(s.x, s.y);
          this.eraseTo(a, wx, wy);
        }
        const s = this.local(e);
        this.hover = { x: s.x, y: s.y };
        this.invalidateLive();
        return;
      }
      case 'select': {
        const s = this.local(e);
        const [wx, wy] = this.vp.toWorld(s.x, s.y);
        const px = wx - a.page.x;
        const py = wy - a.page.y;
        if (a.mode === 'lasso') {
          const n = a.poly.length;
          if (Math.hypot(px - a.poly[n - 2], py - a.poly[n - 1]) * this.vp.scale >= 1.5) a.poly.push(px, py);
        }
        a.end = a.mode === 'square' || (a.mode === 'rect' && e.shiftKey) ? squareFrom(a.start[0], a.start[1], px, py) : [px, py];
        this.invalidateLive();
        return;
      }
      case 'transform': {
        const s = this.local(e);
        const [wx, wy] = this.vp.toWorld(s.x, s.y);
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
      case 'textTap': {
        const s = this.local(e);
        if (Math.hypot(s.x - a.sx, s.y - a.sy) > TAP_MAX_MOVE) a.moved = true;
        return;
      }
    }
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    if (this.ignored.delete(e.pointerId)) return;
    const a = this.interaction;

    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.delete(e.pointerId);
      if (a?.kind === 'nav' && a.source === 'touch') {
        if (this.touches.size === 0) this.endNav(a, !cancelled);
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
        if (!cancelled) this.pushSample(a, { ...this.local(e), pressure: lastPressure(a.data) });
        // Même interrompu (geste système), un trait déjà tracé est conservé.
        if (!cancelled || a.data.length >= POINT_STRIDE * 2) this.commitStroke(a);
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
      case 'textTap':
        if (!cancelled && !a.moved) this.textTap(a.sx, a.sy);
        return;
    }
  }

  /** Termine l'interaction en cours (changement d'outil, mise en arrière-plan). */
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
    if (a.kind === 'draw' && a.data.length >= POINT_STRIDE) this.commitStroke(a);
    else if (a.kind === 'erase') this.session.endBatch();
    else if (a.kind === 'transform') this.finishTransform(a, fromVisibility);
    this.invalidateLive();
  }

  private cancelInteraction(): void {
    const a = this.interaction;
    this.interaction = null;
    if (!a) return;
    if (a.kind === 'erase') this.session.endBatch();
    if (a.kind === 'transform') {
      this.hidden = null;
      this.needFull = true;
    }
    this.invalidateLive();
  }

  // ---------- Navigation (doigts, souris, molette) ----------

  private centroid(): { cx: number; cy: number; dist: number } {
    const pts = Array.from(this.touches.values()).slice(0, 2);
    if (pts.length === 0) return { cx: 0, cy: 0, dist: 0 };
    if (pts.length === 1) return { cx: pts[0].x, cy: pts[0].y, dist: 0 };
    const [a, b] = pts;
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  private startNav(source: NavI['source'], pointerId?: number, s?: Sample): void {
    this.finishAnimation();
    const c = source === 'touch' ? this.centroid() : { cx: s?.x ?? 0, cy: s?.y ?? 0, dist: 0 };
    const now = performance.now();
    this.interaction = {
      kind: 'nav',
      source,
      pointerId,
      startTime: now,
      maxTouches: this.touches.size,
      moved: 0,
      lastCx: c.cx,
      lastCy: c.cy,
      lastDist: c.dist,
      rawTx: this.vp.tx,
      zoomLog: 0,
      scaled: false,
      samples: [{ t: now, x: this.vp.tx }],
      tap: [c.cx, c.cy],
    };
  }

  private rebaseNav(): void {
    const a = this.interaction;
    if (a?.kind !== 'nav') return;
    const c = this.centroid();
    a.lastCx = c.cx;
    a.lastCy = c.cy;
    a.lastDist = c.dist;
  }

  private updateNav(a: NavI): void {
    a.maxTouches = Math.max(a.maxTouches, this.touches.size);
    const c = this.centroid();
    for (const t of this.touches.values()) a.moved = Math.max(a.moved, Math.hypot(t.x - t.sx, t.y - t.sy));
    this.vp.tx = a.rawTx;
    this.vp.pan(c.cx - a.lastCx, c.cy - a.lastCy);
    if (c.dist > 0 && a.lastDist > 0) {
      const f = c.dist / a.lastDist;
      // Les doigts bougent l'un après l'autre : l'écart varie entre deux événements.
      // On ne retient que le zoom NET du geste (somme des log = log(écart actuel / écart initial)).
      a.zoomLog += Math.log(f);
      a.scaled = Math.abs(a.zoomLog) > 0.08;
      this.vp.zoomAt(c.cx, c.cy, f);
    }
    a.rawTx = this.vp.tx;
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
        this.tapAction(a.tap[0], a.tap[1]);
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
    if (Math.abs(a.zoomLog) > 0.02) this.wasFit = false;
    else if (this.wasFit && a.zoomLog !== 0) {
      // Variation de zoom résiduelle d'un balayage à deux doigts : on revient exactement à l'ajustement.
      this.vp.zoomAt(this.vp.width / 2, this.vp.height / 2, this.fitScaleFor(this.cur) / this.vp.scale);
    }
    if (this.settings.pageLayout !== 'horizontal') {
      this.clampView(false);
      this.settle();
      return;
    }
    const b = this.pageBounds(this.cur);
    const [min, max] = this.txRange(b);
    const clamped = Math.min(max, Math.max(min, this.vp.tx));
    const over = this.vp.tx - clamped;
    const first = a.samples[0];
    const last = a.samples[a.samples.length - 1];
    const v = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    const th = Math.max(70, this.vp.width * 0.2);
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
    const to = { scale: this.vp.scale, tx: clamped, ty: this.vp.ty };
    if (Math.abs(over) > 0.5) this.animateTo(to, 200);
    else this.settle();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.updateOrigin();
    if (this.interaction && this.interaction.kind !== 'nav') return;
    this.finishAnimation();
    const sx = e.clientX - this.origin[0];
    const sy = e.clientY - this.origin[1];
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.vp.height : 1;
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
    if (this.settings.pageLayout === 'horizontal' && Math.abs(dx) > Math.abs(dy)) {
      // Balayage horizontal au trackpad : comme un geste de doigt, avec changement de page.
      let a = this.interaction?.kind === 'nav' && this.interaction.source === 'wheel' ? this.interaction : null;
      if (!a) {
        this.startNav('wheel', undefined, { x: sx, y: sy, pressure: 0, tilt: 0, time: 0 });
        a = this.interaction as NavI;
      }
      a.rawTx += dx;
      const now = performance.now();
      a.samples.push({ t: now, x: a.rawTx });
      while (a.samples.length > 2 && now - a.samples[0].t > 120) a.samples.shift();
      this.vp.tx = a.rawTx;
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
    this.vp.pan(dx, dy);
    this.clampView(false);
    this.viewChanged();
    this.settle(140);
  }

  /** Appui simple (doigt en mode stylet, ou outil texte). */
  private tapAction(sx: number, sy: number): void {
    if (this.tool === 'text') this.textTap(sx, sy);
    else if (this.tool === 'select' && this.selection && !this.hitSelection(sx, sy)) this.clearSelection();
  }

  // ---------- Historique ----------

  /** Affiche la page concernée puis annule (jamais de modification sur une page invisible). */
  undo(): boolean {
    if (this.interaction && this.interaction.kind !== 'nav') return false;
    const cs = this.session.peekUndo();
    if (!cs || !this.session.canUndo) return false;
    this.revealPage(cs.pageId);
    this.clearSelection();
    return !!this.session.undo();
  }

  redo(): boolean {
    if (this.interaction && this.interaction.kind !== 'nav') return false;
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
    const vis = this.vp.visibleWorld();
    if (r && !bboxIntersects([r.x, r.y, r.x + r.page.width, r.y + r.page.height], vis)) this.goToPage(idx, false);
  }

  // ---------- Trait ----------

  private commitStroke(a: DrawI): void {
    if (a.data.length < POINT_STRIDE) return;
    const points = Float32Array.from(a.data);
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
    this.session.apply([{ kind: 'stroke', id: stroke.id, pageId: stroke.pageId, after: stroke }], 'Trait');
  }

  // ---------- Gomme ----------

  /**
   * Gomme : diamètre fixe en pixels écran (eraserSize), donc rayon = eraserSize/2/zoom en unités page.
   * Le cercle affiché a exactement ce rayon à l'écran.
   *  - « trait entier » : un trait dont l'encre touche le cercle est supprimé ;
   *  - « partielle »    : la portion du tracé dont l'encre entre dans le cercle est retirée,
   *                       les extrémités restantes s'arrêtent au bord du cercle.
   * Les positions intermédiaires sont interpolées : un geste rapide ne « saute » aucun trait.
   */
  eraserRadiusWorld(): number {
    return this.settings.eraserSize / 2 / this.vp.scale;
  }

  private eraseTo(a: EraseI, wx: number, wy: number): void {
    const r = this.eraserRadiusWorld();
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
      // Rayon d'encre réel : la moitié de la largeur effective (avec le facteur d'outil).
      const inkW = s.tool === 'fountain' ? s.width * 0.8 : s.width;
      if (this.settings.eraserMode === 'stroke') {
        if (strokeHitsCircle({ ...s, width: inkW }, px, py, r)) changes.push({ kind: 'stroke', id: s.id, pageId: s.pageId, before: s });
      } else {
        const pieces = eraseFromPoints(s.points, inkW, px, py, r);
        if (!pieces) continue;
        changes.push({ kind: 'stroke', id: s.id, pageId: s.pageId, before: s });
        pieces.forEach((pts, i) => {
          const piece: Stroke = {
            ...s,
            id: newId(),
            points: pts,
            bbox: computeBBox(pts, strokeMaxRadius(s)),
            // Les morceaux gardent la place du trait d'origine dans l'empilement.
            order: s.order + (i + 1) * 1e-3,
          };
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

  private selectionBBox(): BBox | null {
    const { strokes, items } = this.selectedElements();
    return bboxUnion([...strokes.map((s) => s.bbox), ...items.map(itemBBox)]);
  }

  private transformOf(a: TransformI): { k: number; dx: number; dy: number } {
    if (a.handle === 'move') return { k: 1, dx: a.dx, dy: a.dy };
    return { k: a.k, dx: a.anchor[0] - a.anchor[0] * a.k, dy: a.anchor[1] - a.anchor[1] * a.k };
  }

  private selectionScreenRect(): { x: number; y: number; w: number; h: number } | null {
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
    const [sx0, sy0] = this.vp.toScreen(r.x + Math.min(x0, x1), r.y + Math.min(y0, y1));
    const [sx1, sy1] = this.vp.toScreen(r.x + Math.max(x0, x1), r.y + Math.max(y0, y1));
    return { x: sx0, y: sy0, w: sx1 - sx0, h: sy1 - sy0 };
  }

  /** Poignée ou intérieur de la sélection sous le point écran. */
  private hitSelection(sx: number, sy: number): Handle | null {
    const rect = this.selectionScreenRect();
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
      this.needFull = true;
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
      [
        ...ns.map((s): Change => ({ kind: 'stroke', id: s.id, pageId, after: s })),
        ...ni.map((it): Change => ({ kind: 'item', id: it.id, pageId, after: it })),
      ],
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
      ...items
        .filter((it): it is TextItem => it.kind === 'text')
        .map((it): Change => ({ kind: 'item', id: it.id, pageId: it.pageId, before: it, after: { ...it, color } })),
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

  private textTap(sx: number, sy: number): void {
    const [wx, wy] = this.vp.toWorld(sx, sy);
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

  /**
   * Valide l'édition d'un bloc de texte (création, modification ou suppression si vide).
   * Une validation = une action d'historique.
   */
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
    const it: TextItem = {
      kind: 'text',
      id: newId(),
      pageId: req.pageId,
      x: req.x,
      y: req.y,
      w: width ?? req.w,
      h: 0,
      text: clean,
      ...style,
      order: nextOrder(),
      createdAt: Date.now(),
      v: 2,
    };
    it.h = textHeight(it);
    this.session.apply([{ kind: 'item', id: it.id, pageId: it.pageId, after: it }], 'Ajouter du texte');
  }

  /** Insère une image (déjà enregistrée dans le magasin binaire) sur la page courante. */
  insertImage(blobId: string, mime: string, width: number, height: number): boolean {
    const r = this.layout[this.currentPageIndex()];
    if (!r || !this.session.isLoaded(r.page.id) || this.session.readOnly) return false;
    const maxW = r.page.width * 0.7;
    const maxH = r.page.height * 0.6;
    const k = Math.min(1, maxW / width, maxH / height);
    const w = width * k;
    const h = height * k;
    const [cx, cy] = this.vp.toWorld(this.vp.width / 2, this.vp.height / 2);
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
    const incremental =
      e.additiveOnly &&
      !this.needFull &&
      !this.cssTransformed &&
      e.added.every((s) => s.tool !== 'highlighter' && this.isTopmost(s));
    if (incremental) for (const s of e.added) this.drawIncremental(s);
    else this.needFull = true;
    this.needLive = true;
    this.schedule();
  }

  private isTopmost(s: Stroke): boolean {
    const list = this.session.getStrokes(s.pageId);
    return list[list.length - 1]?.id === s.id || list.slice(-8).every((o) => o.order <= s.order);
  }

  private viewChanged(): void {
    if (this.lastFullMs > 12 && this.interaction?.kind === 'nav') {
      // Rendu complet trop coûteux pendant le geste : transformation CSS du dernier rendu,
      // puis rendu net dès que le geste se stabilise.
      this.applyCssTransform();
      this.settle(120);
    } else {
      this.needFull = true;
    }
    this.needLive = true;
    this.schedule();
  }

  private settle(delay = 0): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.needFull = true;
      this.preload();
      this.schedule();
    }, delay);
  }

  private applyCssTransform(): void {
    const r = this.renderedView;
    const k = this.vp.scale / r.scale;
    const tx = this.vp.tx - r.tx * k;
    const ty = this.vp.ty - r.ty * k;
    this.base.style.transformOrigin = '0 0';
    this.base.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
    this.cssTransformed = true;
  }

  private invalidateLive(): void {
    this.needLive = true;
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
      this.vp.scale = from.scale + (to.scale - from.scale) * e;
      this.vp.tx = from.tx + (to.tx - from.tx) * e;
      this.vp.ty = from.ty + (to.ty - from.ty) * e;
      this.needFull = true;
      this.needLive = true;
      if (t >= 1) {
        this.anim = null;
        this.preload();
      } else this.schedule();
    }
    if (this.pendingEventTime) {
      this.perf.eventToFrameMs = ema(this.perf.eventToFrameMs, now - this.pendingEventTime);
      this.pendingEventTime = 0;
    }
    if (this.needFull) {
      this.needFull = false;
      const t = performance.now();
      this.renderFull();
      this.lastFullMs = performance.now() - t;
      this.perf.fullRenderMs = ema(this.perf.fullRenderMs, this.lastFullMs);
      this.needLive = true;
    }
    if (this.needLive) {
      this.needLive = false;
      const t = performance.now();
      this.renderLive();
      this.perf.liveFrameMs = ema(this.perf.liveFrameMs, performance.now() - t);
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
    const v: ViewInfo = {
      scale: this.vp.scale,
      pageIndex: idx,
      pageCount: this.layout.length,
      fitScale: this.fitScaleFor(idx),
      layout: this.settings.pageLayout,
    };
    const key = `${v.scale.toFixed(3)}|${v.pageIndex}|${v.pageCount}|${v.layout}`;
    if (key !== this.lastViewKey) {
      this.lastViewKey = key;
      this.cb.onView?.(v);
      if (this.settings.pageLayout === 'vertical') this.preload();
    }
    if (this.selection) this.emitSelection();
  }

  private pageTransform(ctx: CanvasRenderingContext2D, r: PageRect): void {
    const s = this.vp.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, (this.vp.tx + r.x * this.vp.scale) * this.dpr, (this.vp.ty + r.y * this.vp.scale) * this.dpr);
  }

  private renderFull(): void {
    const ctx = this.bctx;
    if (this.cssTransformed) {
      this.base.style.transform = '';
      this.cssTransformed = false;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.deskColor;
    ctx.fillRect(0, 0, this.base.width, this.base.height);
    const vis = this.vp.visibleWorld();
    let hidden = this.hidden;
    if (this.editingId) hidden = new Set([...(hidden ?? []), this.editingId]);
    for (const r of this.layout) {
      const pageBox: BBox = [r.x, r.y, r.x + r.page.width, r.y + r.page.height];
      if (!bboxIntersects(pageBox, vis)) continue;
      this.pageTransform(ctx, r);
      ctx.fillStyle = 'rgba(20, 24, 32, 0.08)';
      ctx.fillRect(-1, 1, r.page.width + 2, r.page.height + 3);
      ctx.fillStyle = 'rgba(20, 24, 32, 0.06)';
      ctx.fillRect(1, 3, r.page.width, r.page.height + 2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, r.page.width, r.page.height);
      ctx.clip();
      const local: BBox = [vis[0] - r.x, vis[1] - r.y, vis[2] - r.x, vis[3] - r.y];
      renderPageContent(ctx, r.page, this.session.getStrokes(r.page.id), this.session.getItems(r.page.id), this.vp.scale, local, hidden);
      ctx.restore();
    }
    this.renderedView = this.vp.snapshot();
  }

  private drawIncremental(s: Stroke): void {
    const r = this.rectOf(s.pageId);
    if (!r) return;
    const ctx = this.bctx;
    this.pageTransform(ctx, r);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, r.page.width, r.page.height);
    ctx.clip();
    fillOutline(ctx, s.tool, s.color, outlineToPath(strokeOutline(s, true)));
    ctx.restore();
  }

  private renderLive(): void {
    const ctx = this.lctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.live.width, this.live.height);
    const a = this.interaction;
    const scale = this.vp.scale;

    if (a?.kind === 'draw') {
      const data = a.predicted.length ? a.data.concat(a.predicted) : a.data;
      const outline = strokeOutline(
        { tool: a.tool, width: a.ink.width, style: strokeStyleFrom(a.tool, this.settings, a.ink.smoothing, a.pointerType === 'pen'), points: Float32Array.from(data) },
        false,
      );
      this.pageTransform(ctx, a.page);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, a.page.page.width, a.page.page.height);
      ctx.clip();
      fillOutline(ctx, a.tool, a.ink.color, outlineToPath(outline));
      ctx.restore();
    }

    if (a?.kind === 'select') {
      this.pageTransform(ctx, a.page);
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
      // Aperçu en direct des éléments qui seront sélectionnés.
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
        this.pageTransform(ctx, r);
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
      const rect = this.selectionScreenRect();
      if (rect) {
        const d = this.dpr;
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

    // Curseur : gomme (cercle de diamètre exact) ou aperçu de la pointe au survol.
    if (this.hover && (a?.kind === 'erase' || !a)) {
      const d = this.dpr;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.beginPath();
      if (this.tool === 'eraser' || a?.kind === 'erase') {
        ctx.arc(this.hover.x, this.hover.y, this.settings.eraserSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(30,36,51,0.65)';
        ctx.stroke();
      } else if (this.tool === 'pen' || this.tool === 'highlighter') {
        const st = this.tool === 'pen' ? this.styles.pens[this.styles.penType] : this.styles.highlighter;
        ctx.arc(this.hover.x, this.hover.y, Math.max(1.5, (st.width * scale) / 2), 0, Math.PI * 2);
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

  debugState(): { scale: number; tx: number; ty: number; strokes: number; items: number; tool: Tool; page: number; layout: string } {
    return {
      ...this.vp.snapshot(),
      strokes: this.session.strokeCount(),
      items: this.session.itemCount(),
      tool: this.tool,
      page: this.currentPageIndex(),
      layout: this.settings.pageLayout,
    };
  }

  selectionIds(): string[] {
    return this.selection ? Array.from(this.selection.ids) : [];
  }
}

function ema(prev: number, v: number): number {
  return prev ? prev * 0.85 + v * 0.15 : v;
}

function lastPressure(d: number[]): number {
  return d.length >= POINT_STRIDE ? d[d.length - POINT_STRIDE + 2] : 0.5;
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
