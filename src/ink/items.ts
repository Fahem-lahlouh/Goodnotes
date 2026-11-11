import type { FontId, ImageItem, PageItem, TextItem, TextStyle } from '../model/types';

/**
 * Objets de page : blocs de texte saisis au clavier et images.
 * Les polices sont celles du système (aucun téléchargement, fonctionne hors ligne).
 * Elles sont distinctes des styles de traits manuscrits.
 */
export const FONTS: Record<FontId, { label: string; css: string }> = {
  sans: { label: 'Sans', css: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  serif: { label: 'Serif', css: 'ui-serif, "New York", "Iowan Old Style", Georgia, "Times New Roman", serif' },
  mono: { label: 'Code', css: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace' },
  rounded: { label: 'Arrondie', css: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif' },
  hand: { label: 'Manuscrite', css: 'Noteworthy, "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive' },
};

export const TEXT_SIZES = [12, 14, 16, 18, 22, 28, 36, 48];
export const LINE_HEIGHT = 1.35;
export const TEXT_PAD = 4;
/** Marge intérieure d'une note repositionnable. */
export const NOTE_PAD = 14;

type TextLike = Pick<TextItem, 'text' | 'font' | 'size' | 'bold' | 'italic' | 'w'> & { note?: string };

export function textPad(t: { note?: string }): number {
  return t.note ? NOTE_PAD : TEXT_PAD;
}

/** Couleurs proposées pour les notes repositionnables. */
export const NOTE_COLORS = ['#fde68a', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#fed7aa', '#e9d5ff'];

export function cssFont(st: Pick<TextStyle, 'font' | 'size' | 'bold' | 'italic'>, scale = 1): string {
  return `${st.italic ? 'italic ' : ''}${st.bold ? '700 ' : '400 '}${st.size * scale}px ${FONTS[st.font]?.css ?? FONTS.sans.css}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  if (typeof document === 'undefined') return null;
  measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

/** Découpe le texte en lignes tenant dans la largeur `w` (retour à la ligne par mots). */
export function layoutText(t: TextLike): string[] {
  const ctx = measurer();
  const maxW = Math.max(10, t.w - textPad(t) * 2);
  const lines: string[] = [];
  const measure = (s: string) => (ctx ? ctx.measureText(s).width : s.length * t.size * 0.55);
  if (ctx) ctx.font = cssFont(t);
  for (const para of t.text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const candidate = line + w;
      if (line && measure(candidate.trimEnd()) > maxW) {
        lines.push(line.trimEnd());
        line = w.trimStart();
        // Mot plus long que la ligne : coupure par caractères.
        while (measure(line) > maxW && line.length > 1) {
          let k = line.length - 1;
          while (k > 1 && measure(line.slice(0, k)) > maxW) k--;
          lines.push(line.slice(0, k));
          line = line.slice(k);
        }
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function textHeight(t: TextLike): number {
  const h = layoutText(t).length * t.size * LINE_HEIGHT + textPad(t) * 2;
  // Une note garde une forme de carré (au moins 80 % de sa largeur).
  return t.note ? Math.max(h, t.w * 0.8) : h;
}

export function drawText(ctx: CanvasRenderingContext2D, t: TextItem): void {
  const lines = layoutText(t);
  const pad = textPad(t);
  ctx.save();
  if (t.note) {
    // Note repositionnable : papier coloré avec une ombre légère.
    ctx.save();
    ctx.shadowColor = 'rgba(20, 24, 32, 0.18)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = t.note;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(t.x, t.y, t.w, t.h, 4);
    else ctx.rect(t.x, t.y, t.w, t.h);
    ctx.fill();
    ctx.restore();
  }
  ctx.font = cssFont(t);
  ctx.fillStyle = t.color;
  ctx.textBaseline = 'alphabetic';
  const lh = t.size * LINE_HEIGHT;
  const asc = t.size * 0.98;
  lines.forEach((line, i) => {
    const w = ctx.measureText(line).width;
    let x = t.x + pad;
    if (t.align === 'center') x = t.x + (t.w - w) / 2;
    else if (t.align === 'right') x = t.x + t.w - pad - w;
    const y = t.y + pad + i * lh + (lh - t.size) / 2 + asc * 0.82;
    ctx.fillText(line, x, y);
    if (t.underline && line) ctx.fillRect(x, y + t.size * 0.12, w, Math.max(0.8, t.size / 16));
  });
  ctx.restore();
}

// ---------- Images ----------

type Decoded = ImageBitmap | HTMLImageElement;
const images = new Map<string, Decoded | 'loading' | 'error'>();
let blobLoader: ((id: string) => Promise<{ data: ArrayBuffer; mime: string } | undefined>) | null = null;
const imageListeners = new Set<() => void>();

export function setBlobLoader(fn: typeof blobLoader): void {
  blobLoader = fn;
}

export function onImageReady(fn: () => void): () => void {
  imageListeners.add(fn);
  return () => imageListeners.delete(fn);
}

async function decode(data: ArrayBuffer, mime: string): Promise<Decoded> {
  const blob = new Blob([data], { type: mime });
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* repli */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Image décodée si disponible ; sinon lance le chargement et renvoie null. */
export function getImage(blobId: string): Decoded | null {
  const v = images.get(blobId);
  if (v && v !== 'loading' && v !== 'error') return v;
  if (!v && blobLoader) {
    images.set(blobId, 'loading');
    blobLoader(blobId)
      .then(async (rec) => {
        if (!rec) throw new Error('image absente');
        images.set(blobId, await decode(rec.data, rec.mime));
        for (const l of imageListeners) l();
      })
      .catch(() => images.set(blobId, 'error'));
  }
  return null;
}

export function primeImage(blobId: string, img: Decoded): void {
  images.set(blobId, img);
}

export function drawImageItem(ctx: CanvasRenderingContext2D, it: ImageItem, scale: number): void {
  const img = getImage(it.blobId);
  if (img) {
    ctx.drawImage(img, it.x, it.y, it.w, it.h);
  } else {
    ctx.save();
    ctx.fillStyle = 'rgba(128,128,128,0.12)';
    ctx.fillRect(it.x, it.y, it.w, it.h);
    ctx.strokeStyle = 'rgba(128,128,128,0.5)';
    ctx.lineWidth = 1 / scale;
    ctx.strokeRect(it.x, it.y, it.w, it.h);
    ctx.restore();
  }
}

export function drawItems(ctx: CanvasRenderingContext2D, items: PageItem[], scale: number, kind: 'image' | 'text'): void {
  for (const it of items) {
    if (it.kind !== kind) continue;
    if (it.kind === 'image') drawImageItem(ctx, it, scale);
    else drawText(ctx, it);
  }
}

/**
 * Réduit une image importée (plus grand côté ≤ maxSide px) pour limiter le stockage.
 * Renvoie les octets, le type et les dimensions.
 */
export async function prepareImage(file: Blob, maxSide = 2048): Promise<{ data: ArrayBuffer; mime: string; width: number; height: number; decoded: Decoded }> {
  const src = await decode(await file.arrayBuffer(), file.type || 'image/png');
  const w0 = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const h0 = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  if (k === 1 && (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp')) {
    return { data: await file.arrayBuffer(), mime: file.type, width: w0, height: h0, decoded: src };
  }
  const w = Math.round(w0 * k);
  const h = Math.round(h0 * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(src, 0, 0, w, h);
  const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('conversion impossible'))), mime, 0.9));
  return { data: await blob.arrayBuffer(), mime, width: w, height: h, decoded: await decode(await blob.arrayBuffer(), mime) };
}
