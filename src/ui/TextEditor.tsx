import { useEffect, useRef, useState } from 'react';
import type { InkEngine, TextEditRequest } from '../ink/engine';
import { FONTS, LINE_HEIGHT, TEXT_PAD } from '../ink/items';
import type { TextStyle } from '../model/types';

/**
 * Champ de saisie superposé à la page pendant l'édition d'un bloc de texte.
 * Sa position et sa taille suivent le zoom et le défilement à chaque frame.
 * Validation : appui en dehors, Échap ou ⌘/Ctrl+Entrée. Une validation = une action d'historique.
 */
export function TextEditor({
  engine,
  req,
  style,
  onDone,
}: {
  engine: InkEngine;
  req: TextEditRequest;
  style: TextStyle;
  onDone: (text: string, width: number) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(req.mode === 'edit' ? req.item.text : '');
  const done = useRef(false);
  const geom = req.mode === 'edit' ? { pageId: req.item.pageId, x: req.item.x, y: req.item.y, w: req.item.w } : req;

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone(ref.current?.value ?? text, geom.w);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    let raf = 0;
    const place = () => {
      const p = engine.pageToScreen(geom.pageId, geom.x, geom.y);
      const s = engine.vp.scale;
      if (p) {
        el.style.left = `${p[0]}px`;
        el.style.top = `${p[1]}px`;
        el.style.width = `${geom.w * s}px`;
        el.style.fontSize = `${style.size * s}px`;
        el.style.padding = `${TEXT_PAD * s}px`;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [engine, geom.pageId, geom.x, geom.y, geom.w, style.size]);

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      aria-label="Texte du bloc"
      spellCheck
      style={{
        fontFamily: FONTS[style.font].css,
        fontWeight: style.bold ? 700 : 400,
        fontStyle: style.italic ? 'italic' : 'normal',
        textDecoration: style.underline ? 'underline' : 'none',
        textAlign: style.align,
        color: style.color,
        lineHeight: LINE_HEIGHT,
      }}
    />
  );
}
