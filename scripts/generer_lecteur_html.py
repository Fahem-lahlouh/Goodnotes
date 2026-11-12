#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Génère le lecteur interactif « spring-boot-explique-lecteur.html ».

Un GIF ne peut pas être piloté : ce lecteur embarque le GIF (en base64),
le décode dans le navigateur et ajoute les commandes :
  ← / →  étape précédente / suivante     Espace  pause / lecture
  ↑ / ↓  plus vite / moins vite           , / .   image précédente / suivante
  L      boucler sur l'étape              E       s'arrêter à la fin de chaque étape
  R      recommencer l'étape              F       plein écran

Usage :
    python generer_lecteur_html.py [gif] [sortie.html] [--fragment]
--fragment : écrit seulement le contenu de la page (pour une publication
             qui fournit déjà <html>/<head>/<body>).
"""
import base64
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
FRAGMENT = "--fragment" in sys.argv
GIF = args[0] if args else "spring-boot-explique.gif"
OUT = args[1] if len(args) > 1 else "spring-boot-explique-lecteur.html"

# Titres des scènes : repris du générateur du GIF
sys.path.insert(0, HERE)
import generer_spring_boot_gif as gen  # noqa: E402


def parse_gif(b):
    assert b[:6] in (b"GIF89a", b"GIF87a"), "pas un GIF"
    fl = b[10]
    p = 13
    gct = None
    if fl & 0x80:
        n = 3 * (2 << (fl & 7))
        gct = b[p:p + n]
        p += n
    frames, delay = [], 10
    while p < len(b):
        t = b[p]
        if t == 0x21:
            lab = b[p + 1]
            p += 2
            if lab == 0xF9:
                delay = struct.unpack("<H", b[p + 2:p + 4])[0]
            while b[p]:
                p += b[p] + 1
            p += 1
        elif t == 0x2C:
            f = b[p + 9]
            p += 10
            pal = gct
            if f & 0x80:
                n = 3 * (2 << (f & 7))
                pal = b[p:p + n]
                p += n
            p += 1
            while b[p]:
                p += b[p] + 1
            p += 1
            frames.append((pal, delay * 10 if delay else 100))
        elif t == 0x3B:
            break
        else:
            raise ValueError(f"bloc GIF inattendu {t:#x}")
    return frames


data = open(GIF, "rb").read()
frames = parse_gif(data)
starts = [0] + [i for i in range(1, len(frames)) if frames[i][0] != frames[i - 1][0]]
if len(starts) != len(gen.SCENES):
    sys.exit(f"{len(starts)} débuts de scène détectés, {len(gen.SCENES)} attendus")
times = [0]
for _, ms in frames:
    times.append(times[-1] + ms)
meta = []
for k, sc in enumerate(gen.SCENES):
    s = starts[k]
    e = starts[k + 1] if k + 1 < len(starts) else len(frames)
    meta.append({"title": sc["title"], "block": sc["block"], "phase": sc["phase"],
                 "start": s, "end": e, "t0": times[s], "t1": times[e]})

PAGE = r"""<title>Spring Boot expliqué de A à Z</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* Mise en page : un écran de projection au centre, la régie (barre, boutons, étapes) dessous. */
:root {
  --bg: #eef2f6;
  --surface: #ffffff;
  --ink: #18212e;
  --muted: #5a6577;
  --line: #d5dce6;
  --accent: #2f9e44;
  --accent-ink: #ffffff;
  --start: #2f9e44;
  --req: #1971c2;
  --resp: #e8590c;
  --map: #7048e8;
  --stage: #0f2038;
  --chip: #e4eaf2;
  --font-ui: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  --font-mono: "Cascadia Mono", Consolas, "DejaVu Sans Mono", ui-monospace, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0d141f; --surface: #162131; --ink: #e6ecf4; --muted: #9aa7b9; --line: #2a3a50;
    --accent: #51cf66; --accent-ink: #0d141f; --chip: #1f2d40; --stage: #070d17; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0d141f; --surface: #162131; --ink: #e6ecf4; --muted: #9aa7b9; --line: #2a3a50;
  --accent: #51cf66; --accent-ink: #0d141f; --chip: #1f2d40; --stage: #070d17; color-scheme: dark;
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); font-family: var(--font-ui); font-size: 15px; }
.app {
  max-width: 1320px; margin: 0 auto; outline: none;
  padding-block: 18px 32px;
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
  display: flex; flex-direction: column; gap: 14px;
}
header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 20px; }
h1 { margin: 0; font-size: 1.45rem; text-wrap: balance; letter-spacing: -0.01em; }
.lede { margin: 0; color: var(--muted); font-family: var(--font-mono); font-size: 0.86rem; }
.stage {
  position: relative; background: var(--stage); border-radius: 12px; overflow: hidden;
  aspect-ratio: 16 / 9; max-width: 100%; cursor: pointer;
}
canvas { display: block; width: 100%; height: 100%; }
.overlay {
  position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none;
}
#flash {
  background: rgba(10, 20, 35, 0.78); color: #fff; font-weight: 700; font-size: 1.5rem;
  padding: 10px 22px; border-radius: 999px; opacity: 0; transition: opacity .25s;
}
#flash.show { opacity: 1; transition: none; }
#loading { color: #cfd8e6; font-size: 1.05rem; }
.timeline { display: flex; flex-direction: column; gap: 8px; }
.bar {
  position: relative; height: 22px; display: flex; gap: 2px; cursor: pointer; touch-action: none;
  user-select: none;
}
.seg { position: relative; height: 100%; border-radius: 4px; background: var(--chip); overflow: hidden; min-width: 3px; }
.seg i { position: absolute; inset: 0 auto 0 0; width: 0; opacity: .9; }
.seg.cur { outline: 2px solid var(--ink); outline-offset: 1px; }
.status {
  display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px; align-items: center;
}
#sceneLabel { font-weight: 600; min-width: 0; }
.meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; color: var(--muted); font-variant-numeric: tabular-nums; }
.pill { padding: 2px 10px; border-radius: 999px; background: var(--chip); color: var(--ink); font-size: 0.82rem; font-weight: 600; }
.pill.on { background: var(--accent); color: var(--accent-ink); }
.controls { display: flex; flex-wrap: wrap; gap: 8px; }
.controls .grp { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
button {
  font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line);
  border-radius: 8px; padding: 7px 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
}
button:hover { border-color: var(--muted); }
button:focus-visible { outline: 3px solid var(--req); outline-offset: 2px; }
button.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; font-weight: 700; min-width: 128px; justify-content: center; }
button[aria-pressed="true"] { background: var(--ink); color: var(--bg); border-color: transparent; }
kbd {
  font-family: var(--font-mono); font-size: 0.75rem; padding: 1px 6px; border-radius: 4px;
  border: 1px solid var(--line); background: var(--chip); color: var(--ink);
}
button kbd { opacity: .85; }
.lower { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 14px; align-items: start; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; min-width: 0; }
.panel h2 { margin: 0 0 10px; font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 4px 18px; }
.group h3 { margin: 6px 0 6px; font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; }
.scene-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.scene-list button {
  width: 100%; text-align: left; border: 0; background: transparent; padding: 5px 8px; border-radius: 6px;
  font-size: 0.88rem; gap: 10px;
}
.scene-list button:hover { background: var(--chip); }
.scene-list button.cur { background: var(--chip); font-weight: 700; }
.num {
  flex: none; width: 26px; height: 22px; border-radius: 11px; display: inline-grid; place-items: center;
  color: #fff; font-size: 0.72rem; font-weight: 700; font-variant-numeric: tabular-nums;
}
.scene-list .t { min-width: 0; overflow-wrap: anywhere; }
.keys { display: grid; grid-template-columns: auto 1fr; gap: 7px 12px; margin: 0; font-size: 0.9rem; }
.keys dt { white-space: nowrap; }
.keys dd { margin: 0; color: var(--muted); }
.note { margin: 12px 0 0; font-size: 0.84rem; color: var(--muted); }
@media (max-width: 760px) {
  .lower { grid-template-columns: minmax(0, 1fr); }
  button kbd { display: none; }
}
@media (prefers-reduced-motion: reduce) { #flash { transition: none; } }
</style>

<div class="app" id="app" tabindex="-1">
  <header>
    <h1>Spring Boot expliqué de A à Z</h1>
    <p class="lede">API bancaire · GET /comptes/42 → {"id":42,"solde":1500}</p>
  </header>

  <div class="stage" id="stage" title="Cliquer : pause / lecture">
    <canvas id="cv" width="1280" height="720" aria-label="Animation Spring Boot"></canvas>
    <div class="overlay"><div id="loading">Chargement de l’animation…</div></div>
    <div class="overlay"><div id="flash"></div></div>
  </div>

  <div class="timeline">
    <div class="bar" id="bar" role="slider" aria-label="Position dans l’animation" tabindex="0"></div>
    <div class="status">
      <span id="sceneLabel">…</span>
      <span class="meta">
        <span id="time">0:00 / 0:00</span>
        <span class="pill" id="speedPill">1×</span>
        <span class="pill" id="statePill">Lecture</span>
      </span>
    </div>
  </div>

  <div class="controls">
    <div class="grp">
      <button id="bPrev" title="Étape précédente">⏮ Étape <kbd>←</kbd></button>
      <button id="bFrameBack" title="Image précédente">◀︎ Image <kbd>,</kbd></button>
      <button id="bPlay" class="primary" title="Pause / lecture">⏸ Pause</button>
      <button id="bFrameNext" title="Image suivante">Image ▶︎ <kbd>.</kbd></button>
      <button id="bNext" title="Étape suivante">Étape ⏭ <kbd>→</kbd></button>
    </div>
    <div class="grp">
      <button id="bSlower" title="Moins vite">− Vitesse <kbd>↓</kbd></button>
      <button id="bFaster" title="Plus vite">+ Vitesse <kbd>↑</kbd></button>
    </div>
    <div class="grp">
      <button id="bRestart" title="Recommencer l’étape">↺ Revoir l’étape <kbd>R</kbd></button>
      <button id="bLoop" aria-pressed="false" title="Rejouer l’étape en boucle">🔁 Boucler l’étape <kbd>L</kbd></button>
      <button id="bStop" aria-pressed="false" title="S’arrêter à la fin de chaque étape">⏹ Arrêt à chaque étape <kbd>E</kbd></button>
      <button id="bFull" title="Plein écran">⛶ <kbd>F</kbd></button>
    </div>
  </div>

  <div class="lower">
    <section class="panel">
      <h2>Aller à une étape</h2>
      <div class="groups" id="groups"></div>
    </section>
    <section class="panel">
      <h2>Raccourcis clavier</h2>
      <dl class="keys">
        <dt><kbd>Espace</kbd></dt><dd>Pause / lecture (ou clic sur l’image)</dd>
        <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Étape précédente / suivante</dd>
        <dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Plus vite / moins vite (0,25× à 4×)</dd>
        <dt><kbd>,</kbd> <kbd>.</kbd></dt><dd>Image par image (en pause)</dd>
        <dt><kbd>R</kbd></dt><dd>Revoir l’étape depuis son début</dd>
        <dt><kbd>L</kbd></dt><dd>Rejouer l’étape en boucle</dd>
        <dt><kbd>E</kbd></dt><dd>S’arrêter à la fin de chaque étape</dd>
        <dt><kbd>Début</kbd> <kbd>Fin</kbd></dt><dd>Première / dernière étape</dd>
        <dt><kbd>F</kbd></dt><dd>Plein écran</dd>
      </dl>
      <p class="note">Si les touches ne répondent pas, cliquez une fois sur la page.</p>
    </section>
  </div>
</div>

<script id="gifdata" type="application/octet-stream">__GIF__</script>
<script>
const SCENES = __SCENES__;
const PHASE = { start: "var(--start)", req: "var(--req)", resp: "var(--resp)", map: "var(--map)" };
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/* ---------- Décodeur GIF (LZW, palettes locales, disposition 0/1) ---------- */
function parseGif(b) {
  const W = b[6] | (b[7] << 8), H = b[8] | (b[9] << 8);
  let p = 13, gct = null;
  const fl = b[10];
  if (fl & 0x80) { const n = 3 * (2 << (fl & 7)); gct = b.subarray(p, p + n); p += n; }
  const frames = [];
  let delay = 10, disposal = 0, transp = -1;
  while (p < b.length) {
    const t = b[p];
    if (t === 0x21) {
      const lab = b[p + 1]; p += 2;
      if (lab === 0xF9) {
        const f = b[p + 1];
        disposal = (f >> 2) & 7;
        delay = b[p + 2] | (b[p + 3] << 8);
        transp = (f & 1) ? b[p + 4] : -1;
      }
      while (b[p]) p += b[p] + 1;
      p++;
    } else if (t === 0x2C) {
      const x = b[p + 1] | (b[p + 2] << 8), y = b[p + 3] | (b[p + 4] << 8);
      const w = b[p + 5] | (b[p + 6] << 8), h = b[p + 7] | (b[p + 8] << 8);
      const f = b[p + 9]; p += 10;
      let pal = gct;
      if (f & 0x80) { const n = 3 * (2 << (f & 7)); pal = b.subarray(p, p + n); p += n; }
      const minCode = b[p++];
      let len = 0, q = p;
      while (b[q]) { len += b[q]; q += b[q] + 1; }
      const lzw = new Uint8Array(len);
      let o = 0;
      while (b[p]) { lzw.set(b.subarray(p + 1, p + 1 + b[p]), o); o += b[p]; p += b[p] + 1; }
      p++;
      frames.push({ x, y, w, h, pal, minCode, lzw, interlaced: !!(f & 0x40),
                    delay: delay ? delay * 10 : 100, disposal, transp });
      delay = 10; disposal = 0; transp = -1;
    } else if (t === 0x3B) break;
    else throw new Error("GIF illisible");
  }
  return { W, H, frames };
}

function lzwDecode(minCode, data, count) {
  const out = new Uint8Array(count);
  const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  const clear = 1 << minCode, eoi = clear + 1;
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let size = minCode + 1, mask = (1 << size) - 1, avail = clear + 2, old = -1, first = 0;
  let datum = 0, bits = 0, bi = 0, top = 0, pi = 0;
  while (pi < count) {
    if (top === 0) {
      if (bits < size) {
        if (bi >= data.length) break;
        datum |= data[bi++] << bits; bits += 8; continue;
      }
      let code = datum & mask; datum >>>= size; bits -= size;
      if (code > avail || code === eoi) break;
      if (code === clear) { size = minCode + 1; mask = (1 << size) - 1; avail = clear + 2; old = -1; continue; }
      if (old === -1) { stack[top++] = suffix[code]; old = code; first = code; continue; }
      const inCode = code;
      if (code === avail) { stack[top++] = first; code = old; }
      while (code > clear) { stack[top++] = suffix[code]; code = prefix[code]; }
      first = suffix[code];
      stack[top++] = first;
      if (avail < 4096) {
        prefix[avail] = old; suffix[avail] = first; avail++;
        if ((avail & mask) === 0 && avail < 4096) { size++; mask += avail; }
      }
      old = inCode;
    }
    out[pi++] = stack[--top];
  }
  return out;
}

function deinterlace(px, w, h) {
  const out = new Uint8Array(px.length);
  let row = 0;
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]])
    for (let y = start; y < h; y += step, row++) out.set(px.subarray(row * w, row * w + w), y * w);
  return out;
}

/* ---------- Lecteur ---------- */
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
let GIF, screen, frameIdx = [], snapshots = {}, sceneOf = [];
let cur = 0, playing = true, speedI = 3, acc = 0, last = 0;
let loopScene = false, stopEach = false, heldAtEnd = false;

function applyFrame(i, draw) {
  const f = GIF.frames[i], px = frameIdx[i], pal = f.pal, W = GIF.W;
  if (draw) var patch = ctx.createImageData(f.w, f.h);
  for (let yy = 0; yy < f.h; yy++) {
    let s = (f.y + yy) * W + f.x;
    for (let xx = 0; xx < f.w; xx++, s++) {
      const k = px[yy * f.w + xx];
      if (k === f.transp) {
        if (draw) { const d = (yy * f.w + xx) * 4; patch.data.set(screen.subarray(s * 4, s * 4 + 4), d); }
        continue;
      }
      const o = s * 4, c = k * 3;
      screen[o] = pal[c]; screen[o + 1] = pal[c + 1]; screen[o + 2] = pal[c + 2]; screen[o + 3] = 255;
      if (draw) { const d = (yy * f.w + xx) * 4; patch.data[d] = pal[c]; patch.data[d + 1] = pal[c + 1]; patch.data[d + 2] = pal[c + 2]; patch.data[d + 3] = 255; }
    }
  }
  if (draw) ctx.putImageData(patch, f.x, f.y);
}

function drawScreen() { ctx.putImageData(new ImageData(screen, GIF.W, GIF.H), 0, 0); }

function seek(i) {
  i = Math.max(0, Math.min(GIF.frames.length - 1, i));
  const s = SCENES[sceneOf[i]].start;
  screen.set(snapshots[s]);
  for (let k = s + 1; k <= i; k++) applyFrame(k, false);
  drawScreen();
  cur = i; acc = 0; heldAtEnd = false;
  updateUI();
}

function step() {
  const n = GIF.frames.length;
  const sc = SCENES[sceneOf[cur]];
  if (cur + 1 >= sc.end) {                 // fin de l'étape
    if (loopScene) { seek(sc.start); return; }
    if (stopEach && !heldAtEnd) { heldAtEnd = true; setPlaying(false, "Fin de l’étape"); return; }
    if (cur + 1 >= n) { seek(0); return; }
    seek(cur + 1); return;                  // début d'étape : repart de l'instantané
  }
  applyFrame(cur + 1, true);
  cur++;
  updateUI();
}

function tick(ts) {
  const dt = Math.min(250, ts - (last || ts));
  last = ts;
  if (playing && GIF) {
    acc += dt * SPEEDS[speedI];
    let guard = 0;
    while (playing && acc >= GIF.frames[cur].delay && guard++ < 50) {
      acc -= GIF.frames[cur].delay;
      step();
    }
    updateTime();
  }
  requestAnimationFrame(tick);
}

/* ---------- Interface ---------- */
const $ = (id) => document.getElementById(id);
let flashTimer;
function flash(txt) {
  const el = $("flash");
  el.textContent = txt; el.classList.add("show");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove("show"), 700);
}
function fmt(ms) { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function speedTxt() { return String(SPEEDS[speedI]).replace(".", ",") + "×"; }

function setPlaying(p, msg) {
  if (p && heldAtEnd) {                     // reprise après un arrêt de fin d'étape
    heldAtEnd = false;
    const sc = SCENES[sceneOf[cur]];
    seek(sc.end >= GIF.frames.length ? 0 : sc.end);
  }
  playing = p; acc = 0;
  $("bPlay").innerHTML = p ? "⏸ Pause" : "▶ Lecture";
  flash(msg || (p ? "▶ Lecture" : "⏸ Pause"));
  updateUI();
}

function goScene(k, msg) {
  k = Math.max(0, Math.min(SCENES.length - 1, k));
  seek(SCENES[k].start);
  flash(msg || ("Étape " + (k + 1) + " / " + SCENES.length));
}

function setSpeed(d) {
  speedI = Math.max(0, Math.min(SPEEDS.length - 1, speedI + d));
  flash("Vitesse " + speedTxt());
  updateUI();
}

function toggle(which) {
  if (which === "loop") { loopScene = !loopScene; flash(loopScene ? "Boucle sur l’étape" : "Boucle désactivée"); }
  else { stopEach = !stopEach; heldAtEnd = false; flash(stopEach ? "Arrêt à chaque étape" : "Lecture continue"); }
  updateUI();
}

function frameStep(d) {
  if (playing) setPlaying(false);
  if (d > 0) { if (cur + 1 < GIF.frames.length) seek(cur + 1); }
  else seek(cur - 1);
  flash("Image " + (cur + 1) + " / " + GIF.frames.length);
}

function timeAt(i) { return GIF.t[i] + (i === cur ? Math.min(acc, GIF.frames[cur].delay) : 0); }

function updateTime() {
  const total = GIF.t[GIF.frames.length];
  const now = timeAt(cur);
  $("time").textContent = fmt(now) + " / " + fmt(total);
  const k = sceneOf[cur], sc = SCENES[k];
  segs.forEach((el, j) => {
    const fill = el.firstChild;
    fill.style.width = j < k ? "100%" : j > k ? "0%" : (100 * (now - sc.t0) / (sc.t1 - sc.t0)).toFixed(2) + "%";
  });
}

let segs = [], listBtns = [], lastScene = -1;
function updateUI() {
  if (!GIF) return;
  const k = sceneOf[cur], sc = SCENES[k];
  $("sceneLabel").textContent = "Étape " + (k + 1) + " / " + SCENES.length + " · " + sc.title;
  $("speedPill").textContent = speedTxt();
  const st = $("statePill");
  st.textContent = playing ? "Lecture" : (heldAtEnd ? "Arrêt fin d’étape" : "Pause");
  st.classList.toggle("on", playing);
  $("bLoop").setAttribute("aria-pressed", loopScene);
  $("bStop").setAttribute("aria-pressed", stopEach);
  if (k !== lastScene) {
    segs.forEach((el, j) => el.classList.toggle("cur", j === k));
    listBtns.forEach((el, j) => { el.classList.toggle("cur", j === k); el.setAttribute("aria-current", j === k ? "step" : "false"); });
    lastScene = k;
  }
  $("bar").setAttribute("aria-valuenow", k + 1);
  updateTime();
}

function buildUI() {
  const bar = $("bar");
  const total = GIF.t[GIF.frames.length];
  bar.setAttribute("aria-valuemin", 1); bar.setAttribute("aria-valuemax", SCENES.length);
  SCENES.forEach((sc, k) => {
    const el = document.createElement("div");
    el.className = "seg";
    el.style.flex = String((sc.t1 - sc.t0) / total);
    el.title = "Étape " + (k + 1) + " · " + sc.title;
    const i = document.createElement("i");
    i.style.background = PHASE[sc.phase];
    el.appendChild(i);
    bar.appendChild(el);
    segs.push(el);
  });
  const seekAt = (ev) => {
    const r = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width - 1, ev.clientX - r.left));
    for (let k = 0; k < segs.length; k++) {
      const sr = segs[k].getBoundingClientRect();
      if (ev.clientX <= sr.right + 1 || k === segs.length - 1) {
        const frac = Math.max(0, Math.min(1, (ev.clientX - sr.left) / sr.width));
        const target = SCENES[k].t0 + frac * (SCENES[k].t1 - SCENES[k].t0);
        let i = SCENES[k].start;
        while (i + 1 < SCENES[k].end && GIF.t[i + 1] <= target) i++;
        seek(i);
        return;
      }
    }
  };
  let dragging = false;
  bar.addEventListener("pointerdown", (e) => { dragging = true; bar.setPointerCapture(e.pointerId); seekAt(e); });
  bar.addEventListener("pointermove", (e) => { if (dragging) seekAt(e); });
  bar.addEventListener("pointerup", () => { dragging = false; });

  const groups = [["Vue d’ensemble et partie 1 · démarrage", (s) => ["start", "map"].includes(s.phase) && s.block !== "fin"],
                  ["Partie 2 · requête et réponse", (s) => ["req", "resp"].includes(s.phase) || s.block === "fin"]];
  const box = $("groups");
  groups.forEach(([name, test]) => {
    const g = document.createElement("div"); g.className = "group";
    const h = document.createElement("h3"); h.textContent = name; g.appendChild(h);
    const ul = document.createElement("ul"); ul.className = "scene-list";
    SCENES.forEach((sc, k) => {
      if (!test(sc)) return;
      const li = document.createElement("li");
      const b = document.createElement("button");
      const num = document.createElement("span");
      num.className = "num"; num.style.background = PHASE[sc.phase];
      num.textContent = sc.block === "0" ? "◎" : sc.block === "fin" ? "★" : sc.block;
      const t = document.createElement("span"); t.className = "t";
      t.textContent = sc.title.replace(/^(\d+|★)\s·\s/, "").replace(/^★\s/, "");
      b.append(num, t);
      b.addEventListener("click", () => { goScene(k); $("app").focus({ preventScroll: true }); });
      li.appendChild(b); ul.appendChild(li); listBtns[k] = b;
    });
    g.appendChild(ul); box.appendChild(g);
  });

  $("bPlay").onclick = () => setPlaying(!playing);
  $("bPrev").onclick = () => goScene(sceneOf[cur] - 1);
  $("bNext").onclick = () => goScene(sceneOf[cur] + 1);
  $("bFrameBack").onclick = () => frameStep(-1);
  $("bFrameNext").onclick = () => frameStep(1);
  $("bSlower").onclick = () => setSpeed(-1);
  $("bFaster").onclick = () => setSpeed(1);
  $("bRestart").onclick = () => goScene(sceneOf[cur], "Revoir l’étape");
  $("bLoop").onclick = () => toggle("loop");
  $("bStop").onclick = () => toggle("stop");
  $("bFull").onclick = () => {
    const st = $("stage");
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else st.requestFullscreen().catch(() => flash("Plein écran indisponible"));
    } catch (e) { flash("Plein écran indisponible"); }
  };
  $("stage").addEventListener("click", () => setPlaying(!playing));
  // Après un clic sur un bouton, rendre le clavier au lecteur
  document.querySelectorAll(".controls button").forEach((el) =>
    el.addEventListener("click", () => $("app").focus({ preventScroll: true })));

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    const k = e.key;
    if (tag === "button" && (k === " " || k === "Enter")) return;   // le bouton agit lui-même
    const map = {
      " ": () => setPlaying(!playing),
      "ArrowLeft": () => goScene(sceneOf[cur] - 1),
      "ArrowRight": () => goScene(sceneOf[cur] + 1),
      "ArrowUp": () => setSpeed(1),
      "ArrowDown": () => setSpeed(-1),
      ",": () => frameStep(-1), "<": () => frameStep(-1),
      ".": () => frameStep(1), ";": () => frameStep(1), ">": () => frameStep(1),
      "Home": () => goScene(0),
      "End": () => goScene(SCENES.length - 1),
      "r": () => goScene(sceneOf[cur], "Revoir l’étape"),
      "l": () => toggle("loop"),
      "e": () => toggle("stop"),
      "f": () => $("bFull").onclick(),
    };
    const fn = map[k.length === 1 ? k.toLowerCase() : k];
    if (fn) { e.preventDefault(); fn(); }
  });
}

function load() {
  const b64 = document.getElementById("gifdata").textContent.trim();
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  GIF = parseGif(bytes);
  GIF.t = [0];
  GIF.frames.forEach((f) => GIF.t.push(GIF.t[GIF.t.length - 1] + f.delay));
  screen = new Uint8ClampedArray(GIF.W * GIF.H * 4);
  SCENES.forEach((sc, k) => { for (let i = sc.start; i < sc.end; i++) sceneOf[i] = k; });
  GIF.frames.forEach((f, i) => {
    let px = lzwDecode(f.minCode, f.lzw, f.w * f.h);
    if (f.interlaced) px = deinterlace(px, f.w, f.h);
    frameIdx[i] = px;
    f.lzw = null;
    applyFrame(i, false);
    if (SCENES[sceneOf[i]].start === i) snapshots[i] = screen.slice();
  });
  buildUI();
  seek(0);
  $("loading").remove();
  window.__player = {
    get cur() { return cur; }, get scene() { return sceneOf[cur]; }, get speed() { return SPEEDS[speedI]; },
    get playing() { return playing; }, seek, frames: GIF.frames.length,
    crc() {                                   // contrôle : CRC32 des pixels RVB du canevas
      const d = ctx.getImageData(0, 0, GIF.W, GIF.H).data;
      let c, crc = 0xFFFFFFFF;
      const T = window.__crcT || (window.__crcT = Array.from({ length: 256 }, (_, n) => {
        c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }));
      for (let i = 0; i < d.length; i++) { if ((i & 3) === 3) continue; crc = T[(crc ^ d[i]) & 0xFF] ^ (crc >>> 8); }
      return (crc ^ 0xFFFFFFFF) >>> 0;
    },
  };
  $("app").focus({ preventScroll: true });
  requestAnimationFrame(tick);
}

setTimeout(() => {
  try { load(); }
  catch (err) { $("loading").textContent = "Impossible de lire l’animation : " + err.message; }
}, 30);
</script>
"""

page = (PAGE.replace("__SCENES__", json.dumps(meta, ensure_ascii=False))
            .replace("__GIF__", base64.b64encode(data).decode("ascii")))
if not FRAGMENT:
    page = ('<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<style>body{margin:0}[hidden]{display:none!important}</style>\n</head>\n<body>\n'
            + page + "\n</body>\n</html>\n")
with open(OUT, "w", encoding="utf-8") as fh:
    fh.write(page)
print(f"OK : {OUT} · {len(meta)} étapes · {len(frames)} images · {os.path.getsize(OUT) / 1e6:.1f} Mo")
