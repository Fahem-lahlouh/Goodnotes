import type { PaperColor, PaperKind, PaperSpec } from '../model/types';

export const PAPER_COLORS: Record<PaperColor, { bg: string; line: string; strong: string; dot: string; margin: string; label: string }> = {
  white: { bg: '#ffffff', line: '#d9dee8', strong: '#b8c0cf', dot: '#b9c0cc', margin: '#efc7bd', label: '#8a93a3' },
  cream: { bg: '#fbf6ea', line: '#e3d9c3', strong: '#cbbd9e', dot: '#c9bc9f', margin: '#ecc3b0', label: '#9a8d72' },
  yellow: { bg: '#fdf5cf', line: '#e7d99a', strong: '#d2bf6e', dot: '#cdbb72', margin: '#eab49c', label: '#978746' },
  dark: { bg: '#23272e', line: '#3a404a', strong: '#4d5563', dot: '#4f5662', margin: '#5a3f3c', label: '#7c8594' },
};

export const PAPER_COLOR_LABELS: { id: PaperColor; label: string }[] = [
  { id: 'white', label: 'Blanc' },
  { id: 'yellow', label: 'Jaune' },
  { id: 'cream', label: 'Crème' },
  { id: 'dark', label: 'Sombre' },
];

export const PAPER_KINDS: { id: PaperKind; label: string; group: string }[] = [
  { id: 'blank', label: 'Uni', group: 'Essentiels' },
  { id: 'lined', label: 'Ligné', group: 'Essentiels' },
  { id: 'grid', label: 'Quadrillé', group: 'Essentiels' },
  { id: 'dotted', label: 'Pointillé', group: 'Essentiels' },
  { id: 'cornell', label: 'Cornell', group: 'Prise de notes' },
  { id: 'columns2', label: 'Deux colonnes', group: 'Prise de notes' },
  { id: 'columns3', label: 'Trois colonnes', group: 'Prise de notes' },
  { id: 'todo', label: 'Liste de tâches', group: 'Organisation' },
  { id: 'weekly', label: 'Semainier', group: 'Organisation' },
  { id: 'monthly', label: 'Planning mensuel', group: 'Organisation' },
  { id: 'meeting', label: 'Compte rendu de réunion', group: 'Travail' },
  { id: 'brainstorm', label: 'Brainstorming', group: 'Travail' },
  { id: 'java', label: 'Révision Java', group: 'Révisions' },
  { id: 'qa', label: 'Fiches question / réponse', group: 'Révisions' },
];

/** Couleur d'encre par défaut lisible sur le papier. */
export function defaultInkFor(paper: PaperSpec): string {
  return paper.color === 'dark' ? '#f2efe8' : '#1d2433';
}

type C = (typeof PAPER_COLORS)[PaperColor];

/**
 * Dessine le fond et le modèle du papier dans le repère de la page (0,0)-(w,h).
 * Le contexte est déjà transformé (zoom) : le motif reste net à tout niveau de zoom.
 * `scale` = pixels écran par unité page (traits fins ≈ 1 px).
 */
export function drawPaper(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  paper: PaperSpec,
  scale: number,
  clip?: [number, number, number, number],
): void {
  const c = PAPER_COLORS[paper.color] ?? PAPER_COLORS.white;
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);
  const s = Math.max(12, paper.spacing || 32);
  const x0 = Math.max(0, clip ? clip[0] : 0);
  const y0 = Math.max(0, clip ? clip[1] : 0);
  const x1 = Math.min(w, clip ? clip[2] : w);
  const y1 = Math.min(h, clip ? clip[3] : h);
  const hair = Math.max(0.6, 1 / scale);
  ctx.lineWidth = hair;
  const m = Math.round(Math.max(24, w * 0.06));

  const hlines = (yStart: number, yEnd: number, xa: number, xb: number, step = s, color = c.line) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let y = Math.max(yStart, Math.ceil((y0 - yStart) / step) * step + yStart); y <= Math.min(yEnd, y1); y += step) {
      ctx.moveTo(Math.max(xa, x0), y);
      ctx.lineTo(Math.min(xb, x1), y);
    }
    ctx.stroke();
  };
  const line = (ax: number, ay: number, bx: number, by: number, color = c.strong, width = hair) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.lineWidth = hair;
  };
  const label = (text: string, x: number, y: number, size = Math.max(9, s * 0.38), align: CanvasTextAlign = 'left', bold = true) => {
    ctx.fillStyle = c.label;
    ctx.font = `${bold ? 600 : 400} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x, y);
    ctx.textAlign = 'left';
  };
  const box = (x: number, y: number, bw: number, bh: number, r = 8) => {
    ctx.strokeStyle = c.strong;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, r);
    else ctx.rect(x, y, bw, bh);
    ctx.stroke();
  };
  const dots = (xa: number, ya: number, xb: number, yb: number) => {
    ctx.fillStyle = c.dot;
    const r = Math.max(1.1, 1.4 / scale);
    for (let y = Math.max(ya, Math.ceil(y0 / s) * s); y <= Math.min(yb, y1); y += s) {
      for (let x = Math.max(xa, Math.ceil(x0 / s) * s); x <= Math.min(xb, x1); x += s) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  switch (paper.kind) {
    case 'blank':
      return;
    case 'lined': {
      hlines(s * 3, h, 0, w);
      const mx = s * 2.5;
      if (mx >= x0 && mx <= x1) line(mx, y0, mx, y1, c.margin);
      return;
    }
    case 'grid': {
      ctx.strokeStyle = c.line;
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
      return;
    }
    case 'dotted':
      dots(0, 0, w, h);
      return;
    case 'cornell': {
      const hh = Math.round(h * 0.085);
      const sumH = Math.round(h * 0.2);
      const cw = Math.round(w * 0.3);
      label('Sujet', m * 0.6, hh * 0.45);
      label('Date', w - m * 0.6, hh * 0.45, undefined, 'right');
      line(0, hh, w, hh);
      hlines(hh + s, h - sumH - 2, 0, w);
      line(cw, hh, cw, h - sumH);
      line(0, h - sumH, w, h - sumH);
      label('Mots-clés / questions', 10, hh + s * 0.7);
      label('Notes', cw + 10, hh + s * 0.7);
      label('Synthèse', 10, h - sumH + s * 0.8);
      hlines(h - sumH + s * 1.5, h - s * 0.5, m * 0.4, w - m * 0.4);
      return;
    }
    case 'columns2':
    case 'columns3': {
      const n = paper.kind === 'columns2' ? 2 : 3;
      const top = s * 3;
      const gut = 18;
      const colW = (w - m * 2 - gut * (n - 1)) / n;
      for (let i = 0; i < n; i++) {
        const xa = m + i * (colW + gut);
        hlines(top, h - s, xa, xa + colW);
        if (i > 0) line(xa - gut / 2, top - s * 0.5, xa - gut / 2, h - s, c.line);
      }
      return;
    }
    case 'todo': {
      label('Liste de tâches', m, s * 1.6, s * 0.6);
      line(m, s * 2.2, w - m, s * 2.2);
      const step = s * 1.25;
      const sq = Math.round(s * 0.5);
      for (let y = s * 3.6; y < h - s; y += step) {
        if (y + step < y0 || y - step > y1) continue;
        ctx.strokeStyle = c.strong;
        ctx.strokeRect(m, y - sq, sq, sq);
        line(m + sq + 12, y, w - m, y, c.line);
      }
      return;
    }
    case 'weekly': {
      label('Semaine du', m, s * 1.6, s * 0.55);
      line(m + s * 4, s * 1.7, w * 0.6, s * 1.7, c.line);
      const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche', 'Notes'];
      const top = s * 2.6;
      const gap = 12;
      const bw = (w - m * 2 - gap) / 2;
      const bh = (h - top - m - gap * 3) / 4;
      days.forEach((d, i) => {
        const x = m + (i % 2) * (bw + gap);
        const y = top + Math.floor(i / 2) * (bh + gap);
        box(x, y, bw, bh);
        label(d, x + 10, y + s * 0.7);
        hlines(y + s * 1.4, y + bh - 6, x + 10, x + bw - 10, s, c.line);
      });
      return;
    }
    case 'monthly': {
      label('Mois', m, s * 1.6, s * 0.55);
      line(m + s * 2, s * 1.7, w * 0.55, s * 1.7, c.line);
      const top = s * 3;
      const names = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
      const cw = (w - m * 2) / 7;
      names.forEach((d, i) => label(d, m + cw * i + cw / 2, top - 6, Math.max(9, s * 0.36), 'center'));
      const ch = (h - top - m) / 6;
      ctx.strokeStyle = c.strong;
      ctx.beginPath();
      for (let i = 0; i <= 7; i++) {
        ctx.moveTo(m + cw * i, top);
        ctx.lineTo(m + cw * i, top + ch * 6);
      }
      for (let j = 0; j <= 6; j++) {
        ctx.moveTo(m, top + ch * j);
        ctx.lineTo(w - m, top + ch * j);
      }
      ctx.stroke();
      return;
    }
    case 'meeting': {
      const fields = ['Réunion', 'Date', 'Participants'];
      fields.forEach((f, i) => {
        const y = s * (1.6 + i * 1.1);
        label(f, m, y);
        line(m + s * 3.6, y + 2, w - m, y + 2, c.line);
      });
      const sections: [string, number][] = [
        ['Ordre du jour', 0.12],
        ['Notes', 0.28],
        ['Décisions', 0.14],
        ['Actions — qui · quoi · pour quand', 0.18],
        ['Questions ouvertes', 0.12],
      ];
      let y = s * 5;
      const avail = h - y - m;
      for (const [name, frac] of sections) {
        const sh = avail * (frac / 0.84);
        label(name, m, y + s * 0.6, Math.max(10, s * 0.42));
        line(m, y + s * 0.85, w - m, y + s * 0.85);
        if (name.startsWith('Actions')) {
          const xa = m + (w - m * 2) * 0.22;
          const xb = m + (w - m * 2) * 0.78;
          line(xa, y + s * 0.85, xa, y + sh - 8, c.line);
          line(xb, y + s * 0.85, xb, y + sh - 8, c.line);
        }
        hlines(y + s * 1.85, y + sh - 8, m, w - m);
        y += sh;
      }
      return;
    }
    case 'brainstorm': {
      dots(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(w, h) * 0.13;
      ctx.lineWidth = Math.max(1.2, 1.5 / scale);
      ctx.strokeStyle = c.strong;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      label('Idée centrale', cx, cy + 4, Math.max(11, s * 0.45), 'center');
      ctx.setLineDash([4 / scale + 2, 6]);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const R = Math.min(w, h) * 0.34;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, r * 0.62, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineWidth = hair;
      return;
    }
    case 'java': {
      label('Révision Java', m, s * 1.5, s * 0.6);
      label('Notion :', m, s * 2.6);
      line(m + s * 2.6, s * 2.7, w - m, s * 2.7, c.line);
      const sections: [string, number, 'lines' | 'code'][] = [
        ['Définition', 0.15, 'lines'],
        ['Syntaxe / code', 0.3, 'code'],
        ['Exemple', 0.2, 'lines'],
        ['Pièges et bonnes pratiques', 0.17, 'lines'],
        ['Exercice', 0.18, 'lines'],
      ];
      let y = s * 3.6;
      const avail = h - y - m;
      for (const [name, frac, kind] of sections) {
        const sh = avail * frac;
        label(name, m, y + s * 0.6, Math.max(10, s * 0.42));
        line(m, y + s * 0.85, w - m, y + s * 0.85);
        if (kind === 'code') {
          const step = s * 0.75;
          const gutter = m + s * 1.2;
          line(gutter, y + s, gutter, y + sh - 6, c.margin);
          let n = 1;
          for (let ly = y + s * 1.6; ly < y + sh - 6; ly += step) {
            label(String(n++), gutter - 6, ly, Math.max(8, s * 0.3), 'right', false);
          }
          ctx.fillStyle = c.dot;
          const r = Math.max(0.8, 1 / scale);
          for (let ly = y + s * 1.6 - step * 0.3; ly < y + sh - 6; ly += step) {
            for (let lx = gutter + step; lx < w - m; lx += step) {
              ctx.beginPath();
              ctx.arc(lx, ly, r, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else {
          hlines(y + s * 1.85, y + sh - 6, m, w - m);
        }
        y += sh;
      }
      return;
    }
    case 'qa': {
      const n = 4;
      const gap = 14;
      const ch = (h - m * 2 - gap * (n - 1)) / n;
      for (let i = 0; i < n; i++) {
        const y = m + i * (ch + gap);
        box(m, y, w - m * 2, ch, 10);
        label('Q', m + 12, y + s * 0.8, Math.max(11, s * 0.5));
        ctx.setLineDash([6, 5]);
        line(m + 10, y + ch / 2, w - m - 10, y + ch / 2, c.strong);
        ctx.setLineDash([]);
        label('R', m + 12, y + ch / 2 + s * 0.8, Math.max(11, s * 0.5));
      }
      return;
    }
  }
}

/** Les modèles structurés gardent leur propre mise en page : l'espacement n'y règle que les lignes. */
export function paperUsesSpacing(kind: PaperKind): boolean {
  return kind !== 'blank';
}

export type { C as PaperPalette };
