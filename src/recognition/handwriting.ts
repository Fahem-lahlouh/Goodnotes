import { POINT_STRIDE, type Stroke } from '../model/types';
import { bboxUnion, type BBox } from '../ink/geometry';
import { drawStrokes } from '../ink/strokeRender';

/**
 * Conversion manuscrit → texte.
 *
 * Fournisseurs (aucun n'est utilisé sans action explicite de l'utilisateur) :
 *  - « local »  : API de reconnaissance d'écriture du navigateur (Chromium, si elle prend en charge
 *                 le français sur l'appareil). Rien ne sort de l'appareil. Indisponible sur Safari/iPad.
 *  - « google » : Google Cloud Vision (DOCUMENT_TEXT_DETECTION), avec la clé API de l'utilisateur,
 *                 conservée sur cet appareil uniquement. Envoie UNE image des traits sélectionnés
 *                 (aucun autre contenu du carnet). Désactivé par défaut.
 *  - « manuel » : l'utilisateur saisit le texte (sur iPad, Scribble convertit l'écriture au Pencil
 *                 dans le champ, localement, en français).
 */

export type ProviderId = 'local' | 'google' | 'manual';

export interface OcrConfig {
  provider: ProviderId;
  /** Clé API Google Cloud (stockée localement, jamais exportée ni envoyée ailleurs qu'à Google). */
  googleKey: string;
}

const KEY = 'calame:ocr:v1';

export function loadOcrConfig(): OcrConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<OcrConfig>;
    const provider: ProviderId = raw.provider === 'google' || raw.provider === 'local' ? raw.provider : 'manual';
    return { provider, googleKey: typeof raw.googleKey === 'string' ? raw.googleKey : '' };
  } catch {
    return { provider: 'manual', googleKey: '' };
  }
}

export function saveOcrConfig(c: OcrConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* stockage plein ou interdit : la configuration ne sera pas mémorisée */
  }
}

export interface RecognitionResult {
  text: string;
  /** Alternatives proposées par le service (si disponibles). */
  alternatives: string[];
}

export class RecognitionError extends Error {}

// ---------- Image des traits ----------

export interface InkImage {
  canvas: HTMLCanvasElement;
  bbox: BBox;
  scale: number;
}

/** Rend les traits en noir sur blanc (image envoyée au service, et aperçu dans le dialogue). */
export function renderInkImage(strokes: Stroke[], opts: { maxSide?: number; pad?: number } = {}): InkImage {
  const bbox = bboxUnion(strokes.map((s) => s.bbox)) ?? [0, 0, 1, 1];
  const pad = opts.pad ?? 16;
  const w = bbox[2] - bbox[0];
  const h = bbox[3] - bbox[1];
  const maxSide = opts.maxSide ?? 1600;
  // Écriture suffisamment grande pour la reconnaissance, sans dépasser la taille maximale.
  const scale = Math.max(0.25, Math.min(3, maxSide / Math.max(w, h, 1)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((w + pad * 2) * scale));
  canvas.height = Math.max(1, Math.round((h + pad * 2) * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, (pad - bbox[0]) * scale, (pad - bbox[1]) * scale);
  // Encre noire et opaque : meilleur contraste pour la reconnaissance, quelle que soit la couleur.
  const ink = strokes.filter((s) => s.tool !== 'highlighter').map((s) => ({ ...s, color: '#000000', tool: s.tool === 'pencil' ? ('pen' as const) : s.tool }));
  drawStrokes(ctx, ink, 'all');
  return { canvas, bbox, scale };
}

// ---------- Fournisseur local (API du navigateur) ----------

interface HWPoint {
  x: number;
  y: number;
  t?: number;
}
interface HWStroke {
  addPoint(p: HWPoint): void;
}
interface HWDrawing {
  addStroke(s: HWStroke): void;
  getPrediction(): Promise<{ text: string }[]>;
}
interface HWRecognizer {
  startDrawing(hints?: { recognitionType?: string; inputType?: string; alternatives?: number }): HWDrawing;
  finish(): void;
}
interface HWNavigator {
  createHandwritingRecognizer?: (c: { languages: string[] }) => Promise<HWRecognizer>;
  queryHandwritingRecognizer?: (c: { languages: string[] }) => Promise<unknown>;
}
declare const HandwritingStroke: { new (): HWStroke } | undefined;

/** Vrai si le navigateur propose une reconnaissance d'écriture locale en français. */
export async function localAvailable(): Promise<boolean> {
  const nav = navigator as unknown as HWNavigator;
  if (typeof nav.createHandwritingRecognizer !== 'function' || typeof HandwritingStroke === 'undefined') return false;
  try {
    if (typeof nav.queryHandwritingRecognizer === 'function') return !!(await nav.queryHandwritingRecognizer({ languages: ['fr'] }));
    const r = await nav.createHandwritingRecognizer({ languages: ['fr'] });
    r.finish();
    return true;
  } catch {
    return false;
  }
}

async function recognizeLocal(strokes: Stroke[]): Promise<RecognitionResult> {
  const nav = navigator as unknown as HWNavigator;
  if (!nav.createHandwritingRecognizer || typeof HandwritingStroke === 'undefined') throw new RecognitionError('Reconnaissance locale indisponible dans ce navigateur.');
  let rec: HWRecognizer;
  try {
    rec = await nav.createHandwritingRecognizer({ languages: ['fr'] });
  } catch {
    throw new RecognitionError('Ce navigateur ne reconnaît pas l’écriture en français sur cet appareil.');
  }
  try {
    const drawing = rec.startDrawing({ recognitionType: 'text', inputType: 'stylus', alternatives: 3 });
    const sorted = strokes.slice().sort((a, b) => a.order - b.order);
    for (const s of sorted) {
      const hs = new HandwritingStroke!();
      for (let i = 0; i < s.points.length; i += POINT_STRIDE) hs.addPoint({ x: s.points[i], y: s.points[i + 1], t: s.points[i + 3] });
      drawing.addStroke(hs);
    }
    const preds = await drawing.getPrediction();
    if (!preds.length) throw new RecognitionError('Aucun texte reconnu.');
    return { text: preds[0].text, alternatives: preds.slice(1, 4).map((p) => p.text) };
  } finally {
    rec.finish();
  }
}

// ---------- Google Cloud Vision (optionnel, clé de l'utilisateur) ----------

export const GOOGLE_VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';

async function recognizeGoogle(strokes: Stroke[], key: string, signal?: AbortSignal): Promise<RecognitionResult> {
  if (!key.trim()) throw new RecognitionError('Ajoutez votre clé API Google Cloud pour utiliser ce service.');
  if (!navigator.onLine) throw new RecognitionError('Hors ligne : la reconnaissance Google nécessite une connexion. Saisissez le texte manuellement.');
  const img = renderInkImage(strokes);
  const b64 = img.canvas.toDataURL('image/png').split(',')[1];
  let res: Response;
  try {
    res = await fetch(`${GOOGLE_VISION_ENDPOINT}?key=${encodeURIComponent(key.trim())}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ image: { content: b64 }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: ['fr'] } }],
      }),
      signal,
      // Seule l'origine publique du site est transmise (jamais le chemin) : elle permet de restreindre
      // la clé Google à ce site, ce qui la rend inutilisable ailleurs si elle fuyait.
      referrerPolicy: 'strict-origin',
      credentials: 'omit',
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new RecognitionError('Service injoignable (réseau ou blocage). Saisissez le texte manuellement.');
  }
  let body: { responses?: { fullTextAnnotation?: { text?: string }; error?: { message?: string } }[]; error?: { message?: string; status?: string } };
  try {
    body = await res.json();
  } catch {
    throw new RecognitionError(`Réponse illisible du service (HTTP ${res.status}).`);
  }
  if (!res.ok || body.error) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 400 && /API key/i.test(msg)) throw new RecognitionError('Clé API refusée par Google. Vérifiez-la dans les réglages de conversion.');
    if (res.status === 403) throw new RecognitionError(`Accès refusé par Google (API Vision non activée, facturation ou quota) : ${msg}`);
    if (res.status === 429) throw new RecognitionError('Quota Google dépassé. Réessayez plus tard ou saisissez le texte.');
    throw new RecognitionError(`Erreur du service : ${msg}`);
  }
  const r = body.responses?.[0];
  if (r?.error?.message) throw new RecognitionError(`Erreur du service : ${r.error.message}`);
  const text = r?.fullTextAnnotation?.text ?? '';
  if (!text.trim()) throw new RecognitionError('Aucun texte reconnu dans la sélection.');
  return { text: text.replace(/\n+$/u, ''), alternatives: [] };
}

/** Lance la reconnaissance avec le fournisseur choisi. */
export async function recognize(strokes: Stroke[], cfg: OcrConfig, signal?: AbortSignal): Promise<RecognitionResult> {
  if (!strokes.length) throw new RecognitionError('Aucun trait sélectionné.');
  if (cfg.provider === 'local') return recognizeLocal(strokes);
  if (cfg.provider === 'google') return recognizeGoogle(strokes, cfg.googleKey, signal);
  throw new RecognitionError('Saisie manuelle : écrivez ou tapez le texte.');
}

/**
 * Taille de police proposée pour le texte converti : proche de la hauteur de l'écriture
 * (hauteur de la sélection / nombre de lignes), bornée.
 */
export function suggestedFontSize(bbox: BBox, text: string): number {
  const lines = Math.max(1, text.split('\n').length);
  const lineH = (bbox[3] - bbox[1]) / lines;
  return Math.round(Math.max(12, Math.min(40, lineH * 0.55)));
}
