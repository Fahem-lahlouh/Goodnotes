import { newId, nextOrder } from '../model/ids';
import type { NotebookSession, StrokeChange } from '../model/session';
import { POINT_STRIDE, type Page, type Stroke } from '../model/types';
import {
  bboxIntersects,
  bboxUnion,
  computeBBox,
  eraseFromPoints,
  strokeHitsCircle,
  strokeInLasso,
  strokeMaxRadius,
  transformPoints,
  type BBox,
} from './geometry';
import { coalesced, predicted, sampleFrom, type Sample } from './input';
import { drawPaper } from './paper';
import {
  DEFAULT_SETTINGS,
  DEFAULT_TOOL_STYLES,
  strokeStyleFrom,
  type InkSettings,
  type Tool,
  type ToolStyles,
} from './settings';
import { drawStrokes, fillStroke, outlineToPath, strokeOutline, HIGHLIGHTER_ALPHA } from './strokeRender';
import { Viewport } from './viewport';

/**
 * Moteur d'écriture.
 *
 * Indépendant de React : l'interface lui transmet l'outil et les réglages,
 * il lui renvoie quelques événements (page courante, zoom, sélection, mesures).
 * Aucun rendu React n'a lieu pendant le tracé.
 *
 * Deux canvas superposés :
 *  - « base » : pages, papier et traits enregistrés (redessiné au besoin) ;
 *  - « live » : trait en cours, lasso, sélection, curseur de gomme (effacé à chaque frame).
 */

const PAGE_GAP = 28;
const TAP_MAX_MS = 260;
const TAP_MAX_MOVE = 12;

interface PageRect {
  page: Page;
  index: number;
  x: number;
  y: number;
}

interface DrawState {
  kind: 'draw';
  pointerId: number;
  pointerType: string;
  tool: 'pen' | 'highlighter';
  page: PageRect;
  data: number[];
  t0: number;
  predicted: number[];
  startedAt: number;
}

interface EraseState {
  kind: 'erase';
  pointerId: number;
  page: PageRect | null;
  last: [number, number] | null;
}

interface LassoState {
  kind: 'lasso';
  pointerId: number;
  page: PageRect;
  poly: number[];
}

interface MoveSelState {
  kind: 'move';
  pointerId: number;
  start: [number, number];
  dx: number;
  dy: number;
  k: number;
  resize: boolean;
  anchor: [number, number];
  startDist: number;
}

interface GestureState {
  kind: 'gesture';
  startTime: number;
  maxTouches: number;
  moved: number;
  lastCx: number;
  lastCy: number;
  lastDist: number;
  /** Déplacement à la souris (bouton du milieu / espace). */
  mousePointer?: number;
}

type Action = DrawState | EraseState | LassoState | MoveSelState | GestureState;

export interface Selection {
  pageId: string;
  ids: Set<string>;
}

export interface ViewInfo {
  scale: number;
  pageIndex: number;
  pageCount: number;
}

export interface PerfStats {
  fullRenderMs: number;
  liveFrameMs: number;
  eventToFrameMs: number;
  eventsPerSecond: number;
  pointsPerStroke: number;
}

export interface EngineCallbacks {
  onView?: (v: ViewInfo) => void;
  onSelection?: (rect: { x: number; y: number; w: number; h: number } | null, count: number) => void;
  onPenDetected?: () => void;
  onPerf?: (p: PerfStats) => void;
  onUndoGesture?: () => void;
  onRedoGesture?: () => void;
}

export class InkEngine {
  readonly vp = new Viewport();
  private base: HTMLCanvasElement;
  private live: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private lctx: CanvasRenderingContext2D;
  private dpr = 1;
  private origin: [number, number] = [0, 0];
  private layout: PageRect[] = [];
  private contentBounds: BBox = [0, 0, 0, 0];

  tool: Tool = 'pen';
  styles: ToolStyles = structuredClone(DEFAULT_TOOL_STYLES);
  settings: InkSettings = { ...DEFAULT_SETTINGS };
  penDetected = false;
  deskColor = '#e9e6df';

  private action: Action | null = null;
  private touches = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  private ignoredPointers = new Set<number>();
  private selection: Selection | null = null;
  private hidden: Set<string> | null = null;
  private hover: { x: number; y: number } | null = null;
  private spaceDown = false;

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
  private wasFitWidth = true;
  private disposers: (() => void)[] = [];
  private unsubSession: () => void = () => {};

  constructor(
    private readonly container: HTMLElement,
    private session: NotebookSession,
    private readonly cb: EngineCallbacks = {},
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

    this.relayout();
    this.resize();
    this.fitWidth();
    this.bind();
    this.unsubSession = this.session.onChange((e) => this.onSessionChange(e));
  }

  // ======================= Cycle de vie =======================

  destroy(): void {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.settleTimer);
    for (const d of this.disposers) d();
    this.unsubSession();
    this.base.remove();
    this.live.remove();
  }

  private listen<K extends keyof HTMLElementEventMap>(
    el: HTMLElement | Window,
    type: K | string,
    fn: (e: never) => void,
    opts?: AddEventListenerOptions,
  ): void {
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
      if (e.pointerType !== 'touch' && !this.action) {
        this.hover = null;
        this.invalidateLive();
      }
    });
    this.listen(el, 'lostpointercapture', (e: PointerEvent) => {
      if (this.action && 'pointerId' in this.action && this.action.pointerId === e.pointerId) this.onUp(e, false);
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
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.container);
    this.disposers.push(() => ro.disconnect());
    this.listen(window, 'scroll', () => this.updateOrigin(), { passive: true });
  }

  // ======================= Mise en page =======================

  relayout(): void {
    const pages = this.session.pageOrder;
    let y = 0;
    let maxW = 0;
    this.layout = pages.map((page, index) => {
      const r = { page, index, x: -page.width / 2, y };
      y += page.height + PAGE_GAP;
      maxW = Math.max(maxW, page.width);
      return r;
    });
    this.contentBounds = [-maxW / 2, 0, maxW / 2, Math.max(0, y - PAGE_GAP)];
    this.needFull = true;
    this.schedule();
  }

  setSession(session: NotebookSession): void {
    this.unsubSession();
    this.session = session;
    this.unsubSession = this.session.onChange((e) => this.onSessionChange(e));
    this.clearSelection();
    this.relayout();
  }

  private updateOrigin(): void {
    const r = this.container.getBoundingClientRect();
    this.origin = [r.left, r.top];
  }

  private resize(): void {
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
    // Conserve le point monde au centre-haut de l'écran (rotation de l'iPad).
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
      if (this.wasFitWidth) this.vp.scale = this.fitScale();
      this.vp.tx = w / 2 - anchor[0] * this.vp.scale;
      this.vp.ty = h / 3 - anchor[1] * this.vp.scale;
      this.vp.clamp(this.contentBounds);
    }
    this.needFull = true;
    this.needLive = true;
    this.renderNow();
  }

  private fitScale(): number {
    const pw = this.contentBounds[2] - this.contentBounds[0] || 794;
    return Math.min(2, Math.max(0.3, (this.vp.width - 32) / pw));
  }

  fitWidth(): void {
    const s = this.fitScale();
    this.vp.scale = s;
    this.vp.tx = this.vp.width / 2;
    this.vp.ty = 16;
    this.wasFitWidth = true;
    this.vp.clamp(this.contentBounds);
    this.viewChanged();
  }

  restoreView(v: { scale: number; cx: number; cy: number }): void {
    this.vp.scale = Math.min(this.vp.maxScale, Math.max(this.vp.minScale, v.scale));
    this.vp.tx = this.vp.width / 2 - v.cx * this.vp.scale;
    this.vp.ty = this.vp.height / 2 - v.cy * this.vp.scale;
    this.wasFitWidth = Math.abs(this.vp.scale - this.fitScale()) < 0.01;
    this.vp.clamp(this.contentBounds);
    this.viewChanged();
  }

  /** Vue sérialisable (centre monde + zoom) pour reprendre là où on s'était arrêté. */
  savedView(): { scale: number; cx: number; cy: number } {
    const [cx, cy] = this.vp.toWorld(this.vp.width / 2, this.vp.height / 2);
    return { scale: this.vp.scale, cx, cy };
  }

  scrollToPage(index: number): void {
    const r = this.layout[Math.max(0, Math.min(index, this.layout.length - 1))];
    if (!r) return;
    this.vp.ty = 16 - r.y * this.vp.scale;
    this.vp.clamp(this.contentBounds);
    this.viewChanged();
  }

  zoomBy(f: number): void {
    this.zoomAtScreen(this.vp.width / 2, this.vp.height / 2, f);
    this.settle();
  }

  private zoomAtScreen(sx: number, sy: number, f: number): void {
    this.vp.zoomAt(sx, sy, f);
    this.wasFitWidth = false;
    this.vp.clamp(this.contentBounds);
    this.viewChanged();
  }

  private pageAt(wx: number, wy: number, slack = 0): PageRect | null {
    for (const r of this.layout) {
      if (
        wx >= r.x - slack &&
        wx <= r.x + r.page.width + slack &&
        wy >= r.y - slack &&
        wy <= r.y + r.page.height + slack
      )
        return r;
    }
    return null;
  }

  private rectOf(pageId: string): PageRect | undefined {
    return this.layout.find((r) => r.page.id === pageId);
  }

  currentPageIndex(): number {
    const [, cy] = this.vp.toWorld(this.vp.width / 2, this.vp.height / 2);
    let best = 0;
    for (const r of this.layout) if (cy >= r.y - PAGE_GAP / 2) best = r.index;
    return best;
  }

  // ======================= Outils & réglages =======================

  setTool(t: Tool): void {
    if (this.tool === t) return;
    if (t !== 'lasso') this.clearSelection();
    this.tool = t;
    this.invalidateLive();
  }

  setStyles(s: ToolStyles): void {
    this.styles = s;
  }

  setSettings(s: InkSettings): void {
    this.settings = s;
    this.invalidateLive();
  }

  setDeskColor(c: string): void {
    this.deskColor = c;
    this.needFull = true;
    this.schedule();
  }

  private touchNavigates(): boolean {
    const m = this.settings.touchMode;
    return m === 'navigate' || (m === 'auto' && this.penDetected);
  }

  // ======================= Entrées =======================

  private local(e: PointerEvent): Sample {
    return sampleFrom(e, this.origin[0], this.origin[1]);
  }

  private countEvent(n: number, timeStamp: number): void {
    this.eventCount += n;
    if (!this.pendingEventTime) this.pendingEventTime = timeStamp;
  }

  private onDown(e: PointerEvent): void {
    this.updateOrigin();
    const s = this.local(e);

    if (e.pointerType === 'pen' && !this.penDetected) {
      this.penDetected = true;
      this.cb.onPenDetected?.();
    }

    if (e.pointerType === 'touch') {
      // Paume ou doigt pendant que le stylet écrit : ignoré.
      if (this.action && (this.action.kind !== 'gesture' && this.actionPointerType() === 'pen')) {
        this.ignoredPointers.add(e.pointerId);
        return;
      }
      this.touches.set(e.pointerId, { x: s.x, y: s.y, sx: s.x, sy: s.y });
      if (this.touches.size >= 2) {
        // Un deuxième doigt arrive : annule un trait commencé au doigt et passe en geste.
        if (this.action && this.action.kind !== 'gesture') this.cancelAction();
        this.startGesture();
        return;
      }
      if (this.touchNavigates()) {
        this.startGesture();
        return;
      }
      if (this.settings.palmHeuristic && e.width > 44 && e.height > 44) {
        this.touches.delete(e.pointerId);
        this.ignoredPointers.add(e.pointerId);
        return;
      }
      this.startToolAction(e, s);
      return;
    }

    // Stylet ou souris
    if (this.action) {
      if (this.action.kind === 'gesture' && e.pointerType === 'pen') {
        this.endGesture(false);
      } else {
        return;
      }
    }
    if (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && this.spaceDown))) {
      this.live.setPointerCapture(e.pointerId);
      this.action = {
        kind: 'gesture',
        startTime: e.timeStamp,
        maxTouches: 0,
        moved: 0,
        lastCx: s.x,
        lastCy: s.y,
        lastDist: 0,
        mousePointer: e.pointerId,
      };
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.startToolAction(e, s);
  }

  private actionPointerType(): string {
    return this.action?.kind === 'draw' ? this.action.pointerType : this.lastActionPointerType;
  }
  private lastActionPointerType = 'mouse';

  private startToolAction(e: PointerEvent, s: Sample): void {
    this.lastActionPointerType = e.pointerType;
    try {
      this.live.setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
    const [wx, wy] = this.vp.toWorld(s.x, s.y);
    // Bouton gomme d'un stylet (Wacom/Surface) : bouton 5.
    const tool: Tool = e.buttons & 32 ? 'eraser' : this.tool;
    this.hover = null;

    if (tool === 'pen' || tool === 'highlighter') {
      const page = this.pageAt(wx, wy);
      if (!page || this.session.readOnly) return;
      this.action = {
        kind: 'draw',
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        tool,
        page,
        data: [],
        t0: s.time,
        predicted: [],
        startedAt: performance.now(),
      };
      this.pushSample(this.action, s);
      this.countEvent(1, e.timeStamp);
      this.invalidateLive();
      return;
    }

    if (tool === 'eraser') {
      if (this.session.readOnly) return;
      this.session.beginBatch('Gomme');
      this.action = { kind: 'erase', pointerId: e.pointerId, page: null, last: null };
      this.eraseTo(this.action, wx, wy);
      this.hover = { x: s.x, y: s.y };
      this.invalidateLive();
      return;
    }

    // Lasso
    const selRect = this.selectionScreenRect();
    if (selRect && !this.session.readOnly) {
      const handle = this.handleRadius();
      const hx = selRect.x + selRect.w;
      const hy = selRect.y + selRect.h;
      const onHandle = Math.hypot(s.x - hx, s.y - hy) <= handle * 1.6;
      const inside = s.x >= selRect.x && s.x <= hx && s.y >= selRect.y && s.y <= hy;
      if (onHandle || inside) {
        const b = this.selectionBBox()!;
        const r = this.rectOf(this.selection!.pageId)!;
        const anchorW: [number, number] = [r.x + b[0], r.y + b[1]];
        this.action = {
          kind: 'move',
          pointerId: e.pointerId,
          start: [wx, wy],
          dx: 0,
          dy: 0,
          k: 1,
          resize: onHandle,
          anchor: anchorW,
          startDist: Math.max(1, Math.hypot(wx - anchorW[0], wy - anchorW[1])),
        };
        this.hidden = new Set(this.selection!.ids);
        this.needFull = true;
        this.schedule();
        return;
      }
    }
    this.clearSelection();
    const page = this.pageAt(wx, wy);
    if (!page) return;
    this.action = { kind: 'lasso', pointerId: e.pointerId, page, poly: [wx - page.x, wy - page.y] };
  }

  private pushSample(a: DrawState, s: Sample): void {
    const [wx, wy] = this.vp.toWorld(s.x, s.y);
    const x = wx - a.page.x;
    const y = wy - a.page.y;
    const d = a.data;
    const n = d.length;
    // Ignore les doublons exacts (fréquents avec les événements fusionnés).
    if (n >= POINT_STRIDE && d[n - POINT_STRIDE] === x && d[n - POINT_STRIDE + 1] === y) return;
    d.push(x, y, s.pressure, Math.max(0, s.time - a.t0), s.tilt);
  }

  private onMove(e: PointerEvent): void {
    if (this.ignoredPointers.has(e.pointerId)) return;

    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      const s = this.local(e);
      const t = this.touches.get(e.pointerId)!;
      t.x = s.x;
      t.y = s.y;
      if (this.action?.kind === 'gesture') {
        this.updateGesture();
        return;
      }
    }

    const a = this.action;
    if (!a) {
      // Survol (Apple Pencil avec survol, souris) : aperçu de l'outil.
      if (e.pointerType !== 'touch') {
        const s = this.local(e);
        this.hover = { x: s.x, y: s.y };
        this.invalidateLive();
      }
      return;
    }

    if (a.kind === 'gesture' && a.mousePointer === e.pointerId) {
      const s = this.local(e);
      this.vp.pan(s.x - a.lastCx, s.y - a.lastCy);
      a.lastCx = s.x;
      a.lastCy = s.y;
      this.vp.clamp(this.contentBounds);
      this.viewChanged();
      return;
    }

    if (!('pointerId' in a) || a.pointerId !== e.pointerId) return;

    if (a.kind === 'draw') {
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

    if (a.kind === 'erase') {
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

    if (a.kind === 'lasso') {
      const s = this.local(e);
      const [wx, wy] = this.vp.toWorld(s.x, s.y);
      a.poly.push(wx - a.page.x, wy - a.page.y);
      this.invalidateLive();
      return;
    }

    if (a.kind === 'move') {
      const s = this.local(e);
      const [wx, wy] = this.vp.toWorld(s.x, s.y);
      if (a.resize) {
        a.k = Math.max(0.1, Math.min(10, Math.hypot(wx - a.anchor[0], wy - a.anchor[1]) / a.startDist));
      } else {
        a.dx = wx - a.start[0];
        a.dy = wy - a.start[1];
      }
      this.invalidateLive();
    }
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    if (this.ignoredPointers.delete(e.pointerId)) return;

    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.delete(e.pointerId);
      if (this.action?.kind === 'gesture' && this.action.mousePointer === undefined) {
        if (this.touches.size === 0) this.endGesture(!cancelled);
        else this.rebaseGesture();
        return;
      }
    }

    const a = this.action;
    if (!a) return;
    if (a.kind === 'gesture') {
      if (a.mousePointer === e.pointerId) {
        this.action = null;
        this.settle();
      }
      return;
    }
    if (a.pointerId !== e.pointerId) return;
    this.action = null;

    if (a.kind === 'draw') {
      if (!cancelled) {
        // Dernier point (pointerup peut porter une position plus récente).
        this.pushSample(a, { ...this.local(e), pressure: lastPressure(a.data) });
        this.commitStroke(a);
      }
      this.invalidateLive();
    } else if (a.kind === 'erase') {
      this.session.endBatch();
      this.invalidateLive();
    } else if (a.kind === 'lasso') {
      this.finishLasso(a);
    } else if (a.kind === 'move') {
      this.finishMove(a);
    }
  }

  private cancelAction(): void {
    const a = this.action;
    this.action = null;
    if (!a) return;
    if (a.kind === 'erase') this.session.endBatch();
    if (a.kind === 'move') {
      this.hidden = null;
      this.needFull = true;
    }
    this.invalidateLive();
  }

  // ---------- Gestes (pincement / déplacement) ----------

  private centroid(): { cx: number; cy: number; dist: number } {
    const pts = Array.from(this.touches.values()).slice(0, 2);
    if (pts.length === 1) return { cx: pts[0].x, cy: pts[0].y, dist: 0 };
    const [a, b] = pts;
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  private startGesture(): void {
    const c = this.centroid();
    const prev = this.action?.kind === 'gesture' ? this.action : null;
    this.action = {
      kind: 'gesture',
      startTime: prev?.startTime ?? performance.now(),
      maxTouches: Math.max(prev?.maxTouches ?? 0, this.touches.size),
      moved: prev?.moved ?? 0,
      lastCx: c.cx,
      lastCy: c.cy,
      lastDist: c.dist,
    };
  }

  private rebaseGesture(): void {
    if (this.action?.kind !== 'gesture') return;
    const c = this.centroid();
    this.action.lastCx = c.cx;
    this.action.lastCy = c.cy;
    this.action.lastDist = c.dist;
  }

  private updateGesture(): void {
    const g = this.action as GestureState;
    g.maxTouches = Math.max(g.maxTouches, this.touches.size);
    const c = this.centroid();
    for (const t of this.touches.values()) g.moved = Math.max(g.moved, Math.hypot(t.x - t.sx, t.y - t.sy));
    this.vp.pan(c.cx - g.lastCx, c.cy - g.lastCy);
    if (c.dist > 0 && g.lastDist > 0) {
      this.vp.zoomAt(c.cx, c.cy, c.dist / g.lastDist);
      this.wasFitWidth = false;
    }
    g.lastCx = c.cx;
    g.lastCy = c.cy;
    g.lastDist = c.dist;
    this.vp.clamp(this.contentBounds);
    this.viewChanged();
  }

  private endGesture(allowTap: boolean): void {
    const g = this.action?.kind === 'gesture' ? this.action : null;
    this.action = null;
    this.touches.clear();
    if (g && allowTap && this.settings.twoFingerTapUndo) {
      const dt = performance.now() - g.startTime;
      if (dt <= TAP_MAX_MS && g.moved <= TAP_MAX_MOVE) {
        if (g.maxTouches === 2) this.cb.onUndoGesture?.();
        else if (g.maxTouches === 3) this.cb.onRedoGesture?.();
      }
    }
    this.settle();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.updateOrigin();
    const sx = e.clientX - this.origin[0];
    const sy = e.clientY - this.origin[1];
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.vp.height : 1;
    if (e.ctrlKey || e.metaKey) {
      this.zoomAtScreen(sx, sy, Math.exp((-e.deltaY * unit) / 300));
    } else {
      this.vp.pan(-e.deltaX * unit, -e.deltaY * unit);
      this.vp.clamp(this.contentBounds);
      this.viewChanged();
    }
    this.settle(140);
  }

  // ---------- Trait ----------

  private commitStroke(a: DrawState): void {
    if (a.data.length < POINT_STRIDE) return;
    const points = Float32Array.from(a.data);
    const realPressure = a.pointerType === 'pen';
    const style = a.tool === 'pen' ? this.styles.pen : this.styles.highlighter;
    const base = {
      tool: a.tool,
      width: style.width,
      style: strokeStyleFrom(this.settings, realPressure),
    };
    const stroke: Stroke = {
      id: newId(),
      pageId: a.page.page.id,
      ...base,
      color: style.color,
      points,
      bbox: computeBBox(points, strokeMaxRadius(base)),
      order: nextOrder(),
      createdAt: Date.now(),
      v: 1,
    };
    const n = points.length / POINT_STRIDE;
    this.perf.pointsPerStroke = n;
    this.session.apply([{ id: stroke.id, pageId: stroke.pageId, after: stroke }], 'Trait');
  }

  // ---------- Gomme ----------

  private eraseTo(a: EraseState, wx: number, wy: number): void {
    const r = this.settings.eraserSize / this.vp.scale;
    const steps: [number, number][] = [];
    if (a.last) {
      const d = Math.hypot(wx - a.last[0], wy - a.last[1]);
      const n = Math.max(1, Math.ceil(d / (r * 0.5)));
      for (let i = 1; i <= n; i++) {
        steps.push([a.last[0] + ((wx - a.last[0]) * i) / n, a.last[1] + ((wy - a.last[1]) * i) / n]);
      }
    } else steps.push([wx, wy]);
    a.last = [wx, wy];
    for (const [x, y] of steps) {
      const page = this.pageAt(x, y, r);
      if (!page) continue;
      this.eraseAtPage(page, x - page.x, y - page.y, r);
    }
  }

  private eraseAtPage(page: PageRect, px: number, py: number, r: number): void {
    const changes: StrokeChange[] = [];
    const box: BBox = [px - r, py - r, px + r, py + r];
    for (const s of this.session.getStrokes(page.page.id)) {
      if (!bboxIntersects(s.bbox, box)) continue;
      if (this.settings.eraseHighlighterOnly && s.tool !== 'highlighter') continue;
      if (this.settings.eraserMode === 'stroke') {
        if (strokeHitsCircle(s, px, py, r)) changes.push({ id: s.id, pageId: s.pageId, before: s });
      } else {
        const pieces = eraseFromPoints(s.points, s.width, px, py, r);
        if (!pieces) continue;
        changes.push({ id: s.id, pageId: s.pageId, before: s });
        pieces.forEach((pts, i) => {
          const piece: Stroke = {
            ...s,
            id: newId(),
            points: pts,
            bbox: computeBBox(pts, strokeMaxRadius(s)),
            order: s.order + (i + 1) * 1e-6,
          };
          changes.push({ id: piece.id, pageId: s.pageId, after: piece });
        });
      }
    }
    if (changes.length) this.session.apply(changes, 'Gomme');
  }

  // ---------- Lasso & sélection ----------

  private finishLasso(a: LassoState): void {
    const ids = new Set<string>();
    if (a.poly.length >= 6) {
      for (const s of this.session.getStrokes(a.page.page.id)) {
        if (strokeInLasso(s, a.poly)) ids.add(s.id);
      }
    }
    this.selection = ids.size ? { pageId: a.page.page.id, ids } : null;
    this.emitSelection();
    this.invalidateLive();
  }

  private selectedStrokes(): Stroke[] {
    const sel = this.selection;
    if (!sel) return [];
    const out: Stroke[] = [];
    for (const id of sel.ids) {
      const s = this.session.getStroke(sel.pageId, id);
      if (s) out.push(s);
    }
    return out;
  }

  private selectionBBox(): BBox | null {
    return bboxUnion(this.selectedStrokes().map((s) => s.bbox));
  }

  private selectionScreenRect(): { x: number; y: number; w: number; h: number } | null {
    const b = this.selectionBBox();
    if (!b || !this.selection) return null;
    const r = this.rectOf(this.selection.pageId);
    if (!r) return null;
    let [x0, y0, x1, y1] = b;
    const a = this.action?.kind === 'move' ? this.action : null;
    if (a) {
      if (a.resize) {
        const ax = a.anchor[0] - r.x;
        const ay = a.anchor[1] - r.y;
        x1 = ax + (x1 - ax) * a.k;
        y1 = ay + (y1 - ay) * a.k;
      } else {
        x0 += a.dx;
        x1 += a.dx;
        y0 += a.dy;
        y1 += a.dy;
      }
    }
    const [sx0, sy0] = this.vp.toScreen(r.x + x0, r.y + y0);
    const [sx1, sy1] = this.vp.toScreen(r.x + x1, r.y + y1);
    return { x: sx0, y: sy0, w: sx1 - sx0, h: sy1 - sy0 };
  }

  private handleRadius(): number {
    return 11;
  }

  private transformFor(a: MoveSelState, pageRect: PageRect): { k: number; dx: number; dy: number } {
    if (a.resize) {
      const ax = a.anchor[0] - pageRect.x;
      const ay = a.anchor[1] - pageRect.y;
      return { k: a.k, dx: ax - ax * a.k, dy: ay - ay * a.k };
    }
    return { k: 1, dx: a.dx, dy: a.dy };
  }

  private transformed(s: Stroke, t: { k: number; dx: number; dy: number }): Stroke {
    const points = transformPoints(s.points, t.k, t.dx, t.dy);
    const width = s.width * t.k;
    return { ...s, points, width, bbox: computeBBox(points, strokeMaxRadius({ ...s, width })) };
  }

  private finishMove(a: MoveSelState): void {
    this.hidden = null;
    const sel = this.selection;
    const r = sel && this.rectOf(sel.pageId);
    const moved = a.resize ? Math.abs(a.k - 1) > 0.001 : Math.hypot(a.dx, a.dy) > 0.01;
    if (sel && r && moved) {
      const t = this.transformFor(a, r);
      const changes = this.selectedStrokes().map((s) => ({
        id: s.id,
        pageId: s.pageId,
        before: s,
        after: this.transformed(s, t),
      }));
      this.session.apply(changes, a.resize ? 'Redimensionner' : 'Déplacer');
    } else {
      this.needFull = true;
      this.schedule();
    }
    this.emitSelection();
    this.invalidateLive();
  }

  clearSelection(): void {
    if (!this.selection) return;
    this.selection = null;
    this.emitSelection();
    this.invalidateLive();
  }

  hasSelection(): boolean {
    return !!this.selection;
  }

  deleteSelection(): void {
    const ss = this.selectedStrokes();
    if (!ss.length) return;
    this.session.apply(
      ss.map((s) => ({ id: s.id, pageId: s.pageId, before: s })),
      'Supprimer la sélection',
    );
    this.clearSelection();
  }

  duplicateSelection(): void {
    const ss = this.selectedStrokes();
    if (!ss.length || !this.selection) return;
    const copies = ss.map((s) => {
      const c = this.transformed({ ...s, id: newId(), order: nextOrder() }, { k: 1, dx: 24, dy: 24 });
      return c;
    });
    this.session.apply(
      copies.map((c) => ({ id: c.id, pageId: c.pageId, after: c })),
      'Dupliquer',
    );
    this.selection = { pageId: this.selection.pageId, ids: new Set(copies.map((c) => c.id)) };
    this.emitSelection();
    this.invalidateLive();
  }

  recolorSelection(color: string): void {
    const ss = this.selectedStrokes();
    if (!ss.length) return;
    this.session.apply(
      ss.map((s) => ({ id: s.id, pageId: s.pageId, before: s, after: { ...s, color } })),
      'Couleur',
    );
  }

  private emitSelection(): void {
    const n = this.selection?.ids.size ?? 0;
    this.cb.onSelection?.(n ? this.selectionScreenRect() : null, n);
  }

  // ======================= Rendu =======================

  private onSessionChange(e: { pages: Set<string>; additiveOnly: boolean; added: Stroke[] }): void {
    if (this.selection) {
      // Retire de la sélection les traits disparus (annulation, autre onglet…).
      for (const id of Array.from(this.selection.ids)) {
        if (!this.session.getStroke(this.selection.pageId, id)) this.selection.ids.delete(id);
      }
      if (this.selection.ids.size === 0) this.selection = null;
      this.emitSelection();
    }
    const incremental =
      e.additiveOnly && !this.needFull && !this.cssTransformed && e.added.every((s) => s.tool === 'pen');
    if (incremental) {
      for (const s of e.added) this.drawIncremental(s);
    } else {
      this.needFull = true;
    }
    this.needLive = true;
    this.schedule();
  }

  private viewChanged(): void {
    if (this.lastFullMs > 12 && this.action?.kind === 'gesture') {
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
    if (this.pendingEventTime) {
      // Délai entre l'horodatage de l'événement et le début du rendu (approximation de la latence logicielle).
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
    const v: ViewInfo = {
      scale: this.vp.scale,
      pageIndex: this.currentPageIndex(),
      pageCount: this.layout.length,
    };
    const key = `${v.scale.toFixed(3)}|${v.pageIndex}|${v.pageCount}`;
    if (key !== this.lastViewKey) {
      this.lastViewKey = key;
      this.cb.onView?.(v);
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
    for (const r of this.layout) {
      const pageBox: BBox = [r.x, r.y, r.x + r.page.width, r.y + r.page.height];
      if (!bboxIntersects(pageBox, vis)) continue;
      this.pageTransform(ctx, r);
      // Ombre portée légère (rectangle décalé, bien moins coûteux que shadowBlur).
      ctx.fillStyle = 'rgba(20, 24, 32, 0.10)';
      ctx.fillRect(1.5, 2.5, r.page.width, r.page.height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, r.page.width, r.page.height);
      ctx.clip();
      const local: BBox = [vis[0] - r.x, vis[1] - r.y, vis[2] - r.x, vis[3] - r.y];
      drawPaper(ctx, r.page.width, r.page.height, r.page.paper, this.vp.scale, local);
      const strokes = this.session.getStrokes(r.page.id).filter(
        (s) => bboxIntersects(s.bbox, local) && !(this.hidden && this.hidden.has(s.id)),
      );
      drawStrokes(ctx, strokes);
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
    fillStroke(ctx, s);
    ctx.restore();
  }

  private renderLive(): void {
    const ctx = this.lctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.live.width, this.live.height);
    const a = this.action;

    if (a?.kind === 'draw') {
      const style = a.tool === 'pen' ? this.styles.pen : this.styles.highlighter;
      const data = a.predicted.length ? a.data.concat(a.predicted) : a.data;
      const outline = strokeOutline(
        {
          tool: a.tool,
          width: style.width,
          style: strokeStyleFrom(this.settings, a.pointerType === 'pen'),
          points: Float32Array.from(data),
        },
        false,
      );
      this.pageTransform(ctx, a.page);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, a.page.page.width, a.page.page.height);
      ctx.clip();
      ctx.fillStyle = style.color;
      if (a.tool === 'highlighter') ctx.globalAlpha = HIGHLIGHTER_ALPHA;
      ctx.fill(outlineToPath(outline));
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    if (a?.kind === 'lasso' && a.poly.length >= 4) {
      this.pageTransform(ctx, a.page);
      ctx.beginPath();
      ctx.moveTo(a.poly[0], a.poly[1]);
      for (let i = 2; i < a.poly.length; i += 2) ctx.lineTo(a.poly[i], a.poly[i + 1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(47, 90, 168, 0.08)';
      ctx.fill();
      ctx.setLineDash([6 / this.vp.scale, 5 / this.vp.scale]);
      ctx.lineWidth = 1.5 / this.vp.scale;
      ctx.strokeStyle = '#2f5aa8';
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.selection) {
      const r = this.rectOf(this.selection.pageId);
      if (a?.kind === 'move' && r) {
        const t = this.transformFor(a, r);
        this.pageTransform(ctx, r);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, r.page.width, r.page.height);
        ctx.clip();
        drawStrokes(ctx, this.selectedStrokes().map((s) => this.transformed(s, t)));
        ctx.restore();
      }
      const rect = this.selectionScreenRect();
      if (rect) {
        const d = this.dpr;
        ctx.setTransform(d, 0, 0, d, 0, 0);
        const pad = 6;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#2f5aa8';
        ctx.strokeRect(rect.x - pad, rect.y - pad, rect.w + pad * 2, rect.h + pad * 2);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(rect.x + rect.w, rect.y + rect.h, this.handleRadius() * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.stroke();
      }
    }

    // Curseur : gomme (cercle) ou aperçu de la pointe au survol.
    if (this.hover && (a?.kind === 'erase' || !a)) {
      const d = this.dpr;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.beginPath();
      if (this.tool === 'eraser' || a?.kind === 'erase') {
        ctx.arc(this.hover.x, this.hover.y, this.settings.eraserSize, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(30,36,51,0.6)';
        ctx.stroke();
      } else if (this.tool === 'pen' || this.tool === 'highlighter') {
        const st = this.tool === 'pen' ? this.styles.pen : this.styles.highlighter;
        ctx.arc(this.hover.x, this.hover.y, Math.max(1.5, (st.width * this.vp.scale) / 2), 0, Math.PI * 2);
        ctx.fillStyle = st.color;
        ctx.globalAlpha = this.tool === 'highlighter' ? HIGHLIGHTER_ALPHA : 0.5;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  // ======================= Accès tests / diagnostic =======================

  debugState(): { scale: number; tx: number; ty: number; strokes: number; tool: Tool } {
    return { ...this.vp.snapshot(), strokes: this.session.strokeCount(), tool: this.tool };
  }

  /** Convertit un point écran (relatif au canvas) en coordonnées page. */
  screenToPage(sx: number, sy: number): { pageId: string; x: number; y: number } | null {
    const [wx, wy] = this.vp.toWorld(sx, sy);
    const r = this.pageAt(wx, wy);
    return r ? { pageId: r.page.id, x: wx - r.x, y: wy - r.y } : null;
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
