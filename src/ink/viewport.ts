/**
 * Transformation monde → écran : écran = monde × scale + (tx, ty).
 * Le « monde » contient les pages empilées verticalement (voir layout.ts).
 * Les coordonnées écran sont relatives au coin haut-gauche de la zone de dessin, en px CSS.
 */
export class Viewport {
  scale = 1;
  tx = 0;
  ty = 0;
  width = 0;
  height = 0;
  minScale = 0.2;
  maxScale = 8;

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.tx) / this.scale, (sy - this.ty) / this.scale];
  }

  toScreen(wx: number, wy: number): [number, number] {
    return [wx * this.scale + this.tx, wy * this.scale + this.ty];
  }

  /** Zoom de facteur `factor` autour du point écran (sx, sy), qui reste fixe. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const next = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    const k = next / this.scale;
    this.tx = sx - (sx - this.tx) * k;
    this.ty = sy - (sy - this.ty) * k;
    this.scale = next;
  }

  pan(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
  }

  /** Rectangle monde visible [x0, y0, x1, y1]. */
  visibleWorld(): [number, number, number, number] {
    const [x0, y0] = this.toWorld(0, 0);
    const [x1, y1] = this.toWorld(this.width, this.height);
    return [x0, y0, x1, y1];
  }

  /**
   * Contraint le déplacement pour que le contenu (rectangle monde) reste atteignable :
   * centré horizontalement s'il est plus étroit que l'écran, sinon bornes aux bords.
   */
  clamp(content: [number, number, number, number], margin = 24): void {
    const [cx0, cy0, cx1, cy1] = content;
    const cw = (cx1 - cx0) * this.scale;
    if (cw + margin * 2 <= this.width) {
      this.tx = (this.width - cw) / 2 - cx0 * this.scale;
    } else {
      const maxTx = margin - cx0 * this.scale;
      const minTx = this.width - margin - cx1 * this.scale;
      this.tx = Math.min(maxTx, Math.max(minTx, this.tx));
    }
    // Vertical : le haut du contenu ne descend pas sous la marge et le bas ne remonte pas
    // au-dessus de la marge basse (si le contenu est plus petit que l'écran, il reste entièrement visible).
    const a = margin - cy0 * this.scale;
    const b = this.height - margin - cy1 * this.scale;
    this.ty = Math.min(Math.max(a, b), Math.max(Math.min(a, b), this.ty));
  }

  snapshot(): { scale: number; tx: number; ty: number } {
    return { scale: this.scale, tx: this.tx, ty: this.ty };
  }
}
