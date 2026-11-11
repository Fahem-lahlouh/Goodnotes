import type { PaperSpec } from '../model/types';

export const PAPER_COLORS: Record<PaperSpec['color'], { bg: string; line: string; dot: string; margin: string }> = {
  white: { bg: '#ffffff', line: '#d9dee8', dot: '#b9c0cc', margin: '#efc7bd' },
  cream: { bg: '#fbf6ea', line: '#e3d9c3', dot: '#c9bc9f', margin: '#ecc3b0' },
  dark: { bg: '#23272e', line: '#3a404a', dot: '#4f5662', margin: '#5a3f3c' },
};

/** Couleur d'encre par défaut lisible sur le papier. */
export function defaultInkFor(paper: PaperSpec): string {
  return paper.color === 'dark' ? '#f2efe8' : '#1d2433';
}

/**
 * Dessine le fond et le motif du papier dans le repère de la page (0,0)-(w,h).
 * Le contexte doit déjà être transformé (zoom) : le motif reste net à tout niveau de zoom.
 * `scale` = pixels écran par unité page, utilisé pour garder des traits fins d'environ 1 px.
 */
export function drawPaper(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  paper: PaperSpec,
  scale: number,
  clip?: [number, number, number, number],
): void {
  const c = PAPER_COLORS[paper.color];
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);
  const s = paper.spacing;
  if (paper.kind === 'blank' || s <= 0) return;
  // Zone visible (repère page) pour ne dessiner que le nécessaire.
  const x0 = Math.max(0, clip ? clip[0] : 0);
  const y0 = Math.max(0, clip ? clip[1] : 0);
  const x1 = Math.min(w, clip ? clip[2] : w);
  const y1 = Math.min(h, clip ? clip[3] : h);
  const hair = Math.max(0.6, 1 / scale);
  const top = s * 3; // marge haute pour un titre

  if (paper.kind === 'lined') {
    ctx.strokeStyle = c.line;
    ctx.lineWidth = hair;
    ctx.beginPath();
    const first = Math.max(top, Math.ceil(y0 / s) * s);
    for (let y = first; y <= y1; y += s) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
    // Marge verticale
    const mx = s * 2.5;
    if (mx >= x0 && mx <= x1) {
      ctx.strokeStyle = c.margin;
      ctx.beginPath();
      ctx.moveTo(mx, y0);
      ctx.lineTo(mx, y1);
      ctx.stroke();
    }
  } else if (paper.kind === 'grid') {
    ctx.strokeStyle = c.line;
    ctx.lineWidth = hair;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
  } else if (paper.kind === 'dotted') {
    ctx.fillStyle = c.dot;
    const r = Math.max(1.1, 1.4 / scale);
    for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) {
      for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
