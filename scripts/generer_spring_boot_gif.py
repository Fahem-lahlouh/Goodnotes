#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Génère « spring-boot-explique.gif » : Spring Boot expliqué de A à Z.

Fil rouge : une API bancaire (Spring Boot, Spring MVC, Tomcat, Spring Data JPA,
Hibernate, H2) et la requête GET /comptes/42 -> {"id":42,"solde":1500}.

Usage :
    python generer_spring_boot_gif.py [chemin_de_sortie.gif]

Dépendance : Pillow (pip install pillow).
Le script s'arrête avec une erreur si un texte ne tient pas dans sa zone
(aucun texte coupé), puis vérifie le GIF produit (nombre d'images, boucle).
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
OUT = sys.argv[1] if len(sys.argv) > 1 else "spring-boot-explique.gif"
PREVIEW_DIR = os.environ.get("GIF_PREVIEW_DIR")  # optionnel : PNG de contrôle

# --------------------------------------------------------------------------
# Polices (DejaVu sous Linux ; repli Windows)
# --------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
FONT_FILES = {
    "sans": ["DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
             r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"],
    "bold": ["DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
             r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf"],
    "mono": ["DejaVuSansMono.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
             r"C:\Windows\Fonts\consola.ttf", r"C:\Windows\Fonts\cour.ttf"],
    "monob": ["DejaVuSansMono-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
              r"C:\Windows\Fonts\consolab.ttf", r"C:\Windows\Fonts\courbd.ttf"],
}
_font_path = {}
for _k, _cands in FONT_FILES.items():
    for _c in _cands:
        _p = _c if os.path.isabs(_c) else os.path.join(HERE, _c)
        if os.path.exists(_p):
            _font_path[_k] = _p
            break
    else:
        sys.exit(f"Police introuvable pour '{_k}'. Placez DejaVu*.ttf à côté du script.")

_fcache = {}


def F(kind, size):
    key = (kind, size)
    if key not in _fcache:
        _fcache[key] = ImageFont.truetype(_font_path[kind], size)
    return _fcache[key]


# --------------------------------------------------------------------------
# Couleurs
# --------------------------------------------------------------------------
BG = (246, 248, 251)
INK = (33, 37, 41)
MUTED = (88, 98, 114)
LINE = (214, 220, 229)
WHITE = (255, 255, 255)
HEADER = (16, 32, 56)
GREEN = (47, 158, 68)
BLUE = (25, 113, 194)
ORANGE = (232, 89, 12)
VIOLET = (112, 72, 232)
RED = (201, 42, 42)
GREY_ARROW = (178, 187, 200)
PHASE = {"start": GREEN, "req": BLUE, "resp": ORANGE, "map": VIOLET}
PHASE_LABEL = {"start": "PARTIE 1 · DÉMARRAGE", "req": "PARTIE 2 · ALLER HTTP",
               "resp": "PARTIE 2 · RETOUR", "map": "VUE D’ENSEMBLE"}
Q_COLORS = [(112, 72, 232), (12, 133, 153), (194, 37, 92), (52, 58, 64)]
Q_LABELS = ["À quoi ça sert ?", "Qui l’appelle ?", "Que fait-il concrètement ?",
            "Ce que j’écris moi-même"]

CODE_BG = (30, 36, 48)
CODE_TAB = (44, 52, 68)
CODE_HL = (62, 74, 98)
C_DEF = (222, 228, 236)
C_KW = (204, 132, 230)
C_ANN = (236, 196, 118)
C_STR = (152, 200, 120)
C_COM = (128, 140, 158)
C_NUM = (232, 160, 102)
C_TYPE = (110, 186, 248)
C_TAG = (240, 128, 128)


def tint(c, a):
    """Mélange la couleur c avec du blanc (a = part de couleur)."""
    return tuple(int(255 - (255 - v) * a) for v in c)


def col(c):
    return PHASE.get(c, c) if isinstance(c, str) else c


# --------------------------------------------------------------------------
# Texte : césure, contrôle de débordement
# --------------------------------------------------------------------------
class Overflow(Exception):
    pass


NBSP = "\u00a0"


def french(text):
    for p in (" :", " ?", " !", " ;", " »"):
        text = text.replace(p, NBSP + p[1:])
    return text.replace("« ", "«" + NBSP)


def split_long(word, font, maxw):
    pieces, cur = [], ""
    for ch in word:
        cur += ch
        if ch in ".,/(":
            pieces.append(cur)
            cur = ""
    if cur:
        pieces.append(cur)
    lines, line = [], ""
    for p in pieces:
        if font.getlength(line + p) <= maxw:
            line += p
        else:
            if line:
                lines.append(line)
            line = p
            if font.getlength(line) > maxw:
                raise Overflow(f"mot trop long : {word!r}")
    lines.append(line)
    return lines


def wrap(text, font, maxw):
    out = []
    for para in french(text).split("\n"):
        line = ""
        for w in para.split(" "):
            cand = w if not line else line + " " + w
            if font.getlength(cand) <= maxw:
                line = cand
                continue
            if line:
                out.append(line)
                line = ""
            if font.getlength(w) <= maxw:
                line = w
            else:
                parts = split_long(w, font, maxw)
                out.extend(parts[:-1])
                line = parts[-1]
        out.append(line)
    return out


def rrect(d, box, r, fill=None, outline=None, width=1):
    x, y, w, h = box
    d.rounded_rectangle([x, y, x + w, y + h], radius=r, fill=fill, outline=outline, width=width)


# --------------------------------------------------------------------------
# Coloration syntaxique minimale
# --------------------------------------------------------------------------
JAVA_KW = set("package import public private protected class interface record extends "
              "implements static final void return new this throws throw if else null "
              "true false var".split())
SQL_KW = set("select from where insert into values and or as on join order by".split())

import re

TOKEN = re.compile(r'"[^"]*"|@\w+|\b\d+L?\b|\b[A-Za-z_]\w*\b|\s+|.')


def tokens(lang, line):
    s = line.strip()
    if lang in ("java", "json") and s.startswith("//"):
        return [(line, C_COM)]
    if lang in ("sql", "http", "log", "text") and s.startswith("--"):
        return [(line, C_COM)]
    if lang in ("props", "text") and s.startswith("#"):
        return [(line, C_COM)]
    if lang == "xml":
        if s.startswith("<!--"):
            return [(line, C_COM)]
        out = []
        for part in re.split(r"(<[^>]+>)", line):
            if part:
                out.append((part, C_TAG if part.startswith("<") else C_DEF))
        return out
    if lang == "props" and "=" in line:
        k, v = line.split("=", 1)
        return [(k, C_TYPE), ("=", C_DEF), (v, C_STR)]
    if lang == "log":
        return [(line, C_DEF)]
    if lang == "http":
        m = re.match(r"^([A-Za-z-]+:)(.*)$", line)
        if m and not line.startswith("HTTP") and not line.startswith("{"):
            return [(m.group(1), C_TYPE), (m.group(2), C_DEF)]
        if line.startswith(("GET", "POST", "HTTP/")):
            return [(line, C_ANN)]
    # java / sql / json / http body / text
    out = []
    comment = None
    if lang == "java" and "//" in line:
        i = line.index("//")
        if line[:i].count('"') % 2 == 0:
            line, comment = line[:i], line[i:]
    if lang == "sql" and "--" in line:
        i = line.index("--")
        line, comment = line[:i], line[i:]
    for m in TOKEN.finditer(line):
        t = m.group(0)
        c = C_DEF
        if t.startswith('"'):
            c = C_STR
        elif t.startswith("@"):
            c = C_ANN
        elif t[0].isdigit():
            c = C_NUM
        elif lang == "java" and t in JAVA_KW:
            c = C_KW
        elif lang == "sql" and t.lower() in SQL_KW:
            c = C_KW
        elif lang == "java" and t[0].isupper():
            c = C_TYPE
        out.append((t, c))
    if comment:
        out.append((comment, C_COM))
    return out


# --------------------------------------------------------------------------
# Panneaux
# --------------------------------------------------------------------------
def draw_code(d, spec, hl, where):
    x, y, w, h = spec["box"]
    lines = []
    for lang, text in spec["sections"]:
        for ln in text.split("\n"):
            lines.append((lang, ln))
    for size in (14, 13, 12):
        f = F("mono", size)
        lh = size + 5
        maxw = max(f.getlength(ln) for _, ln in lines)
        if maxw <= w - 28 and len(lines) * lh <= h - 46:
            break
    else:
        raise Overflow(f"{where} : code trop grand pour son cadre")
    rrect(d, (x, y, w, h), 12, fill=CODE_BG)
    d.rounded_rectangle([x, y, x + w, y + 28], radius=12, fill=CODE_TAB, corners=(True, True, False, False))
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([x + 12 + i * 15, y + 9, x + 22 + i * 15, y + 19], fill=c)
    d.text((x + 64, y + 7), spec.get("title", ""), font=F("bold", 12), fill=(176, 186, 202))
    cy = y + 38
    for i, (lang, ln) in enumerate(lines):
        if i in hl:
            d.rectangle([x + 4, cy - 2, x + w - 4, cy + lh - 3], fill=CODE_HL)
            d.rectangle([x + 4, cy - 2, x + 7, cy + lh - 3], fill=C_ANN)
        cx = x + 14
        for t, c in tokens(lang, ln):
            d.text((cx, cy), t, font=f, fill=c)
            cx += f.getlength(t)
        cy += lh


def draw_qa(d, spec, phase, where):
    x, y, w, h = spec["box"]
    items = spec["items"]
    rrect(d, (x, y, w, h), 12, fill=WHITE, outline=LINE, width=1)
    for size in (14, 13):
        fa = F("sans", size)
        lh = size + 5
        wrapped = [wrap(t, fa, w - 40) for t in items]
        need = sum(18 + len(wl) * lh for wl in wrapped)
        if need <= h - 28 - 3 * 8:
            break
    else:
        raise Overflow(f"{where} : réponses trop longues")
    gap = (h - 28 - need) / 3
    cy = y + 14
    for i, wl in enumerate(wrapped):
        rh = 18 + len(wl) * lh
        d.rectangle([x + 12, cy + 1, x + 16, cy + rh - 4], fill=Q_COLORS[i])
        d.text((x + 26, cy), Q_LABELS[i], font=F("bold", 13), fill=Q_COLORS[i])
        ty = cy + 19
        for ln in wl:
            d.text((x + 26, ty), ln, font=fa, fill=INK)
            ty += lh
        cy += rh + gap


def draw_bullets(d, spec, phase, where):
    x, y, w, h = spec["box"]
    rrect(d, (x, y, w, h), 12, fill=WHITE, outline=LINE, width=1)
    title = spec.get("title")
    top = y + 14
    if title:
        tl = wrap(title, F("bold", 15), w - 28)
        for ln in tl:
            d.text((x + 14, top), ln, font=F("bold", 15), fill=INK)
            top += 21
        top += 6
    for size in (14, 13):
        fa = F("sans", size)
        lh = size + 6
        wrapped = [wrap(t, fa, w - 50) for t in spec["items"]]
        need = sum(len(wl) * lh for wl in wrapped)
        if need + 6 * (len(wrapped) - 1) <= y + h - 12 - top:
            break
    else:
        raise Overflow(f"{where} : liste trop longue")
    free = y + h - 12 - top - need
    gap = min(16, free / max(1, len(wrapped) - 1)) if len(wrapped) > 1 else 0
    markers = spec.get("markers")
    for i, wl in enumerate(wrapped):
        mk = markers[i] if markers else "•"
        d.text((x + 16, top), mk, font=F("bold", size), fill=col(spec.get("color", phase)))
        for ln in wl:
            d.text((x + 38, top), ln, font=fa, fill=INK)
            top += lh
        top += gap


# --------------------------------------------------------------------------
# Diagramme : nœuds, flèches, point animé
# --------------------------------------------------------------------------
def layout_node(n, where):
    x, y, w, h = n["box"]
    bx = 30 if n.get("badge") else 0
    inner = w - 18 - bx
    for ts in (14, 13, 12):
        try:
            tl = wrap(n["t"], F("bold", ts), inner)
        except Overflow:
            continue
        if len(tl) > 2:
            continue
        for ss in (12, 11):
            try:
                sl = wrap(n["s"], F("sans", ss), inner) if n.get("s") else []
            except Overflow:
                continue
            total = len(tl) * (ts + 4) + ((4 + len(sl) * (ss + 4)) if sl else 0)
            if total <= h - 10:
                n["_lay"] = (ts, tl, ss, sl, total, bx)
                return
    raise Overflow(f"{where} : texte du bloc « {n['t']} » trop long")


def draw_node(d, n, lit, phase):
    x, y, w, h = n["box"]
    c = col(n.get("c", phase))
    kind = n.get("kind")
    if kind == "ko":
        c = RED
    if kind == "ghost":
        fill, outline, width = (241, 243, 245), (200, 205, 212), 2
    elif lit:
        fill, outline, width = tint(c, 0.12), c, 3
    else:
        fill, outline, width = WHITE, tint(c, 0.5), 2
    rrect(d, (x, y, w, h), 10, fill=fill, outline=outline, width=width)
    ts, tl, ss, sl, total, bx = n["_lay"]
    if n.get("badge"):
        cx, cy = x + 20, y + h / 2
        d.ellipse([cx - 12, cy - 12, cx + 12, cy + 12], fill=c if (lit or kind) else tint(c, 0.55))
        d.text((cx, cy), str(n["badge"]), font=F("bold", 12 if len(str(n["badge"])) < 2 else 11),
               fill=WHITE, anchor="mm")
    tx = x + 9 + bx + (w - 18 - bx) / 2
    ty = y + (h - total) / 2
    tcol = MUTED if kind == "ghost" else INK
    for ln in tl:
        d.text((tx, ty), ln, font=F("bold", ts), fill=tcol, anchor="ma")
        ty += ts + 4
    if sl:
        ty += 4
        for ln in sl:
            d.text((tx, ty), ln, font=F("sans", ss), fill=MUTED, anchor="ma")
            ty += ss + 4


def anchor(box, side, off=0):
    x, y, w, h = box
    return {"r": (x + w, y + h / 2 + off), "l": (x, y + h / 2 + off),
            "t": (x + w / 2 + off, y), "b": (x + w / 2 + off, y + h)}[side]


def prepare_arrow(a, nodes):
    if "pts" in a:
        a["_pts"] = a["pts"]
        return
    A, B = nodes[a["a"]]["box"], nodes[a["b"]]["box"]
    sa, sb = a.get("sa"), a.get("sb")
    if not sa:
        dx = (B[0] + B[2] / 2) - (A[0] + A[2] / 2)
        dy = (B[1] + B[3] / 2) - (A[1] + A[3] / 2)
        if abs(dx) >= abs(dy):
            sa, sb = ("r", "l") if dx > 0 else ("l", "r")
        else:
            sa, sb = ("b", "t") if dy > 0 else ("t", "b")
    a["_pts"] = [anchor(A, sa, a.get("oa", 0))] + a.get("via", []) + [anchor(B, sb, a.get("ob", 0))]


def poly_len(pts):
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def poly_cut(pts, t):
    """Portion de la polyligne jusqu'à la fraction t, et le point final."""
    total = poly_len(pts)
    target = total * t
    out = [pts[0]]
    acc = 0
    for i in range(len(pts) - 1):
        seg = math.dist(pts[i], pts[i + 1])
        if acc + seg >= target:
            r = (target - acc) / seg if seg else 0
            p = (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r)
            out.append(p)
            return out, p
        acc += seg
        out.append(pts[i + 1])
    return out, pts[-1]


def dashed(d, pts, color, width):
    for i in range(len(pts) - 1):
        (x1, y1), (x2, y2) = pts[i], pts[i + 1]
        L = math.dist((x1, y1), (x2, y2))
        if L == 0:
            continue
        n = int(L // 11) + 1
        for k in range(n):
            s, e = k * 11 / L, min(1, (k * 11 + 6) / L)
            d.line([(x1 + (x2 - x1) * s, y1 + (y2 - y1) * s), (x1 + (x2 - x1) * e, y1 + (y2 - y1) * e)],
                   fill=color, width=width)


def head(d, pts, color, size=11):
    (x1, y1), (x2, y2) = pts[-2], pts[-1]
    ang = math.atan2(y2 - y1, x2 - x1)
    p1 = (x2 - size * math.cos(ang - 0.42), y2 - size * math.sin(ang - 0.42))
    p2 = (x2 - size * math.cos(ang + 0.42), y2 - size * math.sin(ang + 0.42))
    d.polygon([(x2, y2), p1, p2], fill=color)


def draw_arrow(d, a, state, t=1.0):
    """state : 0 = pas encore parcourue, 1 = en cours (fraction t), 2 = parcourue."""
    pts = a["_pts"]
    c = col(a.get("c", "start"))
    if state < 2:
        dashed(d, pts, GREY_ARROW, 2)
        head(d, pts, GREY_ARROW, 9)
    if state == 1:
        part, _ = poly_cut(pts, t)
        d.line(part, fill=c, width=4, joint="curve")
    if state == 2:
        d.line(pts, fill=c, width=4, joint="curve")
        head(d, pts, c, 13)
    if a.get("label"):
        lx, ly = a.get("lpos") or poly_cut(pts, 0.5)[1]
        f = F("bold", 11)
        tw = f.getlength(a["label"])
        lc = c if state == 2 else MUTED
        rrect(d, (lx - tw / 2 - 7, ly - 10, tw + 14, 20), 9, fill=WHITE, outline=lc if state == 2 else LINE)
        d.text((lx, ly), a["label"], font=f, fill=lc, anchor="mm")


def draw_dot(d, p, c):
    x, y = p
    d.ellipse([x - 12, y - 12, x + 12, y + 12], fill=tint(c, 0.3))
    d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=c, outline=WHITE, width=2)


# --------------------------------------------------------------------------
# En-tête et mini-plan
# --------------------------------------------------------------------------
PLAN = [
    ("0", "◎", "Carte globale", "map"),
    ("H", None, "PARTIE 1 · DÉMARRAGE", "start"),
    ("1", "1", "JVM → main()", "start"),
    ("2", "2", "@SpringBootApplication", "start"),
    ("3", "3", "Auto-configuration", "start"),
    ("4", "4", "Spring MVC", "start"),
    ("5", "5", "JPA · Hibernate · H2", "start"),
    ("6", "6", "Contexte & beans", "start"),
    ("7", "7", "Tomcat :8080", "start"),
    ("H", None, "PARTIE 2 · REQUÊTE", "req"),
    ("8", "8", "Postman → Dispatcher", "req"),
    ("9", "9", "Mapping & Adapter", "req"),
    ("10", "10", "Controller → Repo", "req"),
    ("11", "11", "Hibernate → JDBC → H2", "req"),
    ("12", "12", "JSON · 200 · 400/404", "resp"),
    ("fin", "★", "Trajet complet", "map"),
]
ORDER = [p[0] for p in PLAN if p[0] != "H"]
SIDEBAR_W = 236
MX0, MX1 = 252, 1264
MW = MX1 - MX0


def draw_chrome(d, sc, idx, total):
    phase = sc["phase"]
    pc = PHASE[phase]
    # En-tête
    d.rectangle([0, 0, W, 60], fill=HEADER)
    d.text((20, 8), "SPRING BOOT EXPLIQUÉ DE A À Z", font=F("bold", 12), fill=(130, 201, 140))
    title = sc["title"]
    if F("bold", 22).getlength(title) > W - 20 - 270:
        raise Overflow(f"titre trop long : {title}")
    d.text((20, 25), title, font=F("bold", 22), fill=WHITE)
    lab = PHASE_LABEL[phase]
    f = F("bold", 13)
    tw = f.getlength(lab)
    rrect(d, (W - 24 - tw - 28, 17, tw + 28, 28), 14, fill=pc)
    d.text((W - 24 - tw / 2 - 14, 31), lab, font=f, fill=WHITE, anchor="mm")
    # Barre latérale
    d.rectangle([0, 60, SIDEBAR_W, H], fill=(234, 239, 245))
    d.line([SIDEBAR_W, 60, SIDEBAR_W, H], fill=LINE, width=1)
    rrect(d, (12, 70, SIDEBAR_W - 24, 40), 8, fill=WHITE, outline=LINE)
    d.text((22, 75), "Fil rouge", font=F("bold", 11), fill=MUTED)
    d.text((22, 90), "GET /comptes/42", font=F("monob", 13), fill=BLUE)
    cur = ORDER.index(sc["block"])
    y = 118
    for key, num, label, ph in PLAN:
        c = PHASE[ph]
        if key == "H":
            y += 4
            d.text((16, y + 4), label, font=F("bold", 11), fill=c)
            y += 24
            continue
        pos = ORDER.index(key)
        for fs in (13, 12, 11):
            f = F("bold" if pos == cur else "sans", fs)
            if f.getlength(label) <= SIDEBAR_W - 58:
                break
        else:
            raise Overflow(f"mini-plan : {label}")
        if pos == cur:
            rrect(d, (8, y, SIDEBAR_W - 16, 26), 8, fill=c)
            d.ellipse([16, y + 3, 36, y + 23], fill=WHITE)
            d.text((26, y + 13), num, font=F("bold", 10 if len(num) > 1 else 11), fill=c, anchor="mm")
            d.text((44, y + 13), label, font=f, fill=WHITE, anchor="lm")
        else:
            done = pos < cur
            d.ellipse([16, y + 3, 36, y + 23], fill=tint(c, 0.75) if done else WHITE,
                      outline=tint(c, 0.75))
            d.text((26, y + 13), num, font=F("bold", 10 if len(num) > 1 else 11),
                   fill=WHITE if done else c, anchor="mm")
            d.text((44, y + 13), label, font=f, fill=MUTED if done else INK, anchor="lm")
        y += 28
    # Légende
    y += 8
    d.text((16, y), "Couleurs des flèches", font=F("bold", 11), fill=MUTED)
    y += 20
    for c, txt in ((GREEN, "Démarrage"), (BLUE, "Aller HTTP (requête)"), (ORANGE, "Retour (réponse)")):
        d.line([18, y + 8, 46, y + 8], fill=c, width=4)
        d.ellipse([27, y + 3, 37, y + 13], fill=c, outline=WHITE, width=2)
        d.text((54, y + 8), txt, font=F("sans", 12), fill=INK, anchor="lm")
        y += 20
    # Progression
    d.text((16, H - 34), f"Scène {idx + 1} / {total}", font=F("bold", 11), fill=MUTED)
    rrect(d, (16, H - 16, SIDEBAR_W - 32, 6), 3, fill=(214, 221, 231))
    rrect(d, (16, H - 16, max(6, (SIDEBAR_W - 32) * (idx + 1) / total), 6), 3, fill=pc)


def draw_sub(d, sc):
    for size in (16, 15):
        f = F("sans", size)
        lines = wrap(sc["sub"], f, MW)
        if len(lines) <= 2:
            break
    else:
        raise Overflow(f"{sc['title']} : sous-titre trop long")
    y = 70
    for ln in lines:
        d.text((MX0, y), ln, font=f, fill=(51, 65, 92))
        y += size + 6


# --------------------------------------------------------------------------
# Aides de mise en page
# --------------------------------------------------------------------------
DIAG_Y0 = 126
BOT_Y0, BOT_Y1 = 344, 710


def hrow(specs, y, h, x0=MX0, x1=MX1, gap=36, **kw):
    n = len(specs)
    w = (x1 - x0 - gap * (n - 1)) / n
    out = []
    for i, s in enumerate(specs):
        node = {"id": s[0], "t": s[1], "s": s[2] if len(s) > 2 else None,
                "box": (x0 + i * (w + gap), y, w, h)}
        node.update(kw)
        if len(s) > 3:
            node.update(s[3])
        out.append(node)
    return out


def chain(ids, c, **kw):
    return [dict(a=ids[i], b=ids[i + 1], c=c, **kw) for i in range(len(ids) - 1)]


def std(qa_w=452):
    qa = (MX0, BOT_Y0, qa_w, BOT_Y1 - BOT_Y0)
    code = (MX0 + qa_w + 14, BOT_Y0, MW - qa_w - 14, BOT_Y1 - BOT_Y0)
    return qa, code


def ids(nodes):
    return [n["id"] for n in nodes]


# --------------------------------------------------------------------------
# Les scènes
# --------------------------------------------------------------------------
SCENES = []


def carte(final):
    nodes, arrows = [], []
    bg = [((MX0, 126, 372, 586), tint(GREEN, 0.07), tint(GREEN, 0.35)),
          ((MX0 + 386, 126, MW - 386, 586), tint(BLUE, 0.06), tint(BLUE, 0.3))]
    labels = [(MX0 + 16, 134, "AU DÉMARRAGE · une seule fois", GREEN),
              (MX0 + 402, 134, "À CHAQUE REQUÊTE HTTP · GET /comptes/42", BLUE)]
    left = [("1", "JVM → main()", "SpringApplication.run() lance tout"),
            ("2", "@SpringBootApplication", "scan de com.banque et sous-packages"),
            ("3", "Auto-configuration", "pom.xml + application.properties"),
            ("4", "Spring MVC configuré", "DispatcherServlet, Jackson"),
            ("5", "JPA · Hibernate · H2", "table COMPTE, CompteRepository"),
            ("6", "ApplicationContext", "beans créés et injectés"),
            ("7", "Tomcat démarré", "écoute sur le port 8080")]
    y0, hgt, gap = 160, 50, 29
    for i, (b, t, s) in enumerate(left):
        nodes.append({"id": "L" + b, "t": t, "s": s, "badge": b, "c": "start",
                      "box": (MX0 + 18, y0 + i * (hgt + gap), 336, hgt)})
    arrows += chain(["L" + b for b, _, _ in left], "start")
    rx0 = MX0 + 406
    rq_x, rs_x, cw = rx0, rx0 + 314, 284
    nodes.append({"id": "pm", "t": "Postman", "s": "GET http://localhost:8080/comptes/42", "c": "req",
                  "box": (rq_x, 160, rs_x + cw - rq_x, 50)})
    nodes.append({"id": "h2", "t": "H2 (base en mémoire)", "s": "ligne ID = 42, SOLDE = 1500", "c": "req",
                  "box": (rq_x, 654, rs_x + cw - rq_x, 50)})
    rows = [246, 348, 450, 552]
    req = [("8", "Tomcat → DispatcherServlet", "thread HTTP, entrée de Spring MVC"),
           ("9", "HandlerMapping → Adapter", "route trouvée, \"42\" → 42L"),
           ("10", "Controller → Service → Repository", "findById(42L)"),
           ("11", "EntityManager → Hibernate → JDBC", "SELECT … WHERE id = 42")]
    resp = [("12", "HTTP 200 OK → Postman", "Tomcat renvoie la réponse"),
            ("12", "Jackson → JSON", "{\"id\":42,\"solde\":1500}"),
            ("12", "Compte → CompteDto", "dans CompteService.trouver()"),
            ("11", "Ligne → objet Compte", "Hibernate remplit l’entité")]
    for i, (b, t, s) in enumerate(req):
        nodes.append({"id": "Q" + str(i), "t": t, "s": s, "badge": b, "c": "req",
                      "box": (rq_x, rows[i], cw, 66)})
    for i, (b, t, s) in enumerate(resp):
        nodes.append({"id": "R" + str(i), "t": t, "s": s, "badge": b, "c": "resp",
                      "box": (rs_x, rows[i], cw, 66)})
    qx = rq_x + cw / 2
    sx = rs_x + cw / 2
    seq = ["pm", "Q0", "Q1", "Q2", "Q3", "h2"]
    ys = [(210, 246), (312, 348), (414, 450), (516, 552), (618, 654)]
    for i in range(5):
        arrows.append(dict(a=seq[i], b=seq[i + 1], c="req", pts=[(qx, ys[i][0]), (qx, ys[i][1])],
                           label="aller" if i == 0 else None, lpos=(qx - 40, 228) if i == 0 else None))
    rseq = ["h2", "R3", "R2", "R1", "R0", "pm"]
    for i in range(5):
        a1, a2 = ys[4 - i]
        arrows.append(dict(a=rseq[i], b=rseq[i + 1], c="resp", pts=[(sx, a2), (sx, a1)],
                           label="retour" if i == 4 else None, lpos=(sx + 46, 228) if i == 4 else None))
    if final:
        sub = ("Démarrage (vert) une seule fois, puis pour chaque requête : aller (bleu) jusqu’à H2 "
               "et retour (orange) jusqu’à Postman, qui affiche {\"id\":42,\"solde\":1500} avec le statut 200.")
    else:
        sub = ("Notre API bancaire en un coup d’œil. À gauche : ce que Spring Boot fait UNE fois, au lancement. "
               "À droite : le trajet de GET /comptes/42 à chaque appel. Chaque bloc numéroté est détaillé ensuite.")
    return dict(block="fin" if final else "0", phase="map",
                title="★ Le trajet complet : de main() à la réponse JSON" if final
                else "La carte globale : démarrage et requête",
                sub=sub, nodes=nodes, arrows=arrows, bgpanels=bg, labels=labels,
                hold=26000 if final else 16000)


# ---- 0. Carte globale ------------------------------------------------------
SCENES.append(carte(False))

# ---- 1. JVM et main() ------------------------------------------------------
qa, code = std()
n = hrow([("cmd", "java -jar banque.jar", "terminal ou bouton Run de l’IDE"),
          ("jvm", "JVM", "charge la classe BanqueApplication"),
          ("main", "main(String[] args)", "point d’entrée de tout programme Java"),
          ("run", "SpringApplication.run()", "démarre Spring Boot"),
          ("ok", "Application prête", "contexte rempli, Tomcat sur :8080")], 158, 104)
SCENES.append(dict(
    block="1", phase="start", title="1 · La JVM lance main()",
    sub="Tout commence comme n’importe quel programme Java : la JVM appelle main(). "
        "Cette méthode ne contient qu’une ligne, SpringApplication.run(), qui déclenche tout le démarrage.",
    nodes=n, arrows=chain(ids(n), "start"),
    qa=dict(box=qa, items=[
        "Point d’entrée de l’application : c’est ici que tout démarre.",
        "La JVM, quand tu lances java -jar banque.jar ou le bouton Run de ton IDE.",
        "main() appelle SpringApplication.run(). run() crée le contexte Spring, lit la configuration, "
        "scanne les classes, crée les beans puis démarre Tomcat (détail à la scène suivante).",
        "Une classe annotée @SpringBootApplication avec une méthode main() d’une seule ligne."]),
    code=dict(box=code, title="BanqueApplication.java", hl={7, 8}, sections=[("java",
        "package com.banque;\n"
        "\n"
        "@SpringBootApplication\n"
        "public class BanqueApplication {\n"
        "\n"
        "    public static void main(String[] args) {\n"
        "        // une seule ligne = tout le démarrage\n"
        "        SpringApplication.run(\n"
        "                BanqueApplication.class, args);\n"
        "    }\n"
        "}")]),
))

# ---- 1 bis. Ce que fait SpringApplication.run() -----------------------------
steps = [("Prépare l’Environment", "lit application.properties, variables, arguments"),
         ("Crée l’ApplicationContext", "le conteneur qui va gérer les objets (beans)"),
         ("Scanne com.banque", "repère @RestController, @Service, @Entity…"),
         ("Applique l’auto-configuration", "selon les jars présents et les propriétés"),
         ("Crée Tomcat", "serveur intégré, DispatcherServlet enregistré"),
         ("Crée les beans et les injecte", "DataSource, Hibernate, repository, service…"),
         ("Ouvre le port 8080", "l’application est prête à répondre")]
n = []
for i, (t, s) in enumerate(steps):
    n.append({"id": f"s{i}", "t": t, "s": s, "badge": str(i + 1),
              "box": (MX0, 130 + i * 83, 470, 66)})
SCENES.append(dict(
    block="1", phase="start", title="1 · Ce que déclenche SpringApplication.run()",
    sub="run() enchaîne sept étapes, dans cet ordre. Suis le point vert et la ligne surlignée "
        "dans la console : chaque étape laisse une trace dans les logs.",
    nodes=n, arrows=chain(ids(n), "start"),
    code=dict(box=(MX0 + 490, 130, MW - 490, 546), title="Console au démarrage (extrait simplifié)",
              hl={0, 1}, steps={0: {0, 1}, 1: {2, 3}, 2: {2, 3}, 3: {4}, 4: {5, 6, 7}, 5: {8, 9}},
              sections=[("log",
                         "Starting BanqueApplication using Java 21\n"
                         "No active profile set: \"default\"\n"
                         "Bootstrapping Spring Data JPA repositories\n"
                         "Found 1 JPA repository interface.\n"
                         "Tomcat initialized with port 8080 (http)\n"
                         "H2 console available at '/h2-console'\n"
                         "HikariPool-1 - Start completed.\n"
                         "Initialized JPA EntityManagerFactory\n"
                         "Tomcat started on port 8080 (http)\n"
                         "Started BanqueApplication in 2.1 seconds\n"
                         "\n"),
                        ("text",
                         "-- Le port 8080 n'est ouvert qu'à la fin,\n"
                         "-- quand tous les beans sont prêts.")]),
))

# ---- 2. @SpringBootApplication -----------------------------------------------
qa, code = std()
top = {"id": "sba", "t": "@SpringBootApplication", "s": "sur BanqueApplication",
       "box": (MX0 + MW / 2 - 170, 130, 340, 58)}
kids = hrow([("cfg", "@SpringBootConfiguration", "= @Configuration : la classe peut déclarer des @Bean"),
             ("auto", "@EnableAutoConfiguration", "active l’auto-configuration (bloc 3)"),
             ("scan", "@ComponentScan", "scanne com.banque et tous ses sous-packages")], 240, 90, gap=40)
arr = []
for k in kids:
    kx = k["box"][0] + k["box"][2] / 2
    arr.append(dict(a="sba", b=k["id"], c="start", pts=[(MX0 + MW / 2, 188), (MX0 + MW / 2, 214), (kx, 214), (kx, 240)]))
SCENES.append(dict(
    block="2", phase="start", title="2 · @SpringBootApplication = 3 annotations en 1",
    sub="L’annotation posée sur la classe principale est un raccourci. "
        "Spring la « déplie » en trois annotations qui ont chacune un rôle précis.",
    nodes=[top] + kids, arrows=arr,
    qa=dict(box=qa, items=[
        "Configurer l’application avec une seule annotation au lieu de trois.",
        "SpringApplication.run() lit les annotations de la classe qu’on lui passe (BanqueApplication).",
        "Elle déclare la classe comme source de configuration, active l’auto-configuration "
        "et lance le scan des composants à partir de son package.",
        "Uniquement @SpringBootApplication. Les trois annotations détaillées ne s’écrivent presque jamais à la main."]),
    code=dict(box=code, title="Ce que Spring comprend (équivalent)", hl={4, 5, 6}, sections=[("java",
        "// Ce que j'écris :\n"
        "@SpringBootApplication\n"
        "\n"
        "// ... équivaut à :\n"
        "@SpringBootConfiguration   // = @Configuration\n"
        "@EnableAutoConfiguration   // bloc 3\n"
        "@ComponentScan             // package de la classe\n"
        "public class BanqueApplication {\n"
        "    public static void main(String[] args) {\n"
        "        SpringApplication.run(BanqueApplication.class, args);\n"
        "    }\n"
        "}")]),
))

# ---- 2 bis. Où placer la classe principale -----------------------------------
root = {"id": "root", "t": "com.banque", "s": "BanqueApplication ★ (@SpringBootApplication)",
        "box": (MX0, 130, 480, 58)}
subs = [("web", "com.banque.web", "CompteController · @RestController"),
        ("svc", "com.banque.service", "CompteService · @Service"),
        ("repo", "com.banque.repository", "CompteRepository · interface JpaRepository"),
        ("model", "com.banque.model", "Compte · @Entity   |   CompteDto · record")]
n = [root]
arr = []
for i, (iid, t, s) in enumerate(subs):
    y = 214 + i * 82
    n.append({"id": iid, "t": t, "s": s, "box": (MX0 + 70, y, 410, 60)})
    arr.append(dict(a="root", b=iid, c="start", pts=[(MX0 + 30, 188), (MX0 + 30, y + 30), (MX0 + 70, y + 30)]))
n.append({"id": "autre", "t": "com.autre.Outil", "s": "hors du package racine : jamais trouvé", "kind": "ko",
          "box": (MX0 + 70, 560, 410, 60)})
SCENES.append(dict(
    block="2", phase="start", title="2 · Où placer la classe principale ?",
    sub="@ComponentScan part du package de BanqueApplication et descend dans tous les sous-packages. "
        "Place donc la classe principale à la racine : com.banque.",
    nodes=n, arrows=arr,
    bullets=dict(box=(MX0 + 500, 130, MW - 500, 580), title="Comment Spring découvre tes classes", items=[
        "BanqueApplication est dans com.banque : c’est le point de départ du scan.",
        "Spring parcourt com.banque.web, .service, .repository, .model…",
        "Toute classe annotée @Component, @Service, @Repository, @Controller, "
        "@RestController ou @Configuration devient un bean.",
        "CompteRepository (une interface) est détectée par Spring Data JPA, "
        "à partir du même package racine.",
        "Les classes @Entity (Compte) sont aussi cherchées à partir de ce package.",
        "com.autre.Outil est en dehors : il n’est pas trouvé. Il faut le déplacer "
        "ou élargir le scan (scanBasePackages).",
        "Ce que j’écris : rien de plus. Le bon emplacement des fichiers suffit."]),
))

# ---- 3. Auto-configuration -----------------------------------------------------
qa, code = std(440)
n = hrow([("pom", "pom.xml", "starters déclarés"),
          ("cp", "Classpath", "jars présents : Tomcat, Hibernate, H2…"),
          ("cond", "Conditions", "@ConditionalOnClass, @ConditionalOnMissingBean"),
          ("beans", "Beans créés", "serveur, MVC, DataSource, JPA, Jackson")], 180, 100, gap=44)
SCENES.append(dict(
    block="3", phase="start", title="3 · L’auto-configuration : les dépendances décident",
    sub="Spring Boot regarde les bibliothèques présentes (apportées par pom.xml) et configure "
        "automatiquement les composants correspondants, avec des valeurs par défaut.",
    nodes=n, arrows=chain(ids(n), "start"),
    qa=dict(box=qa, items=[
        "Éviter d’écrire la configuration technique : serveur web, MVC, connexion à la base, JPA, JSON.",
        "@EnableAutoConfiguration, pendant SpringApplication.run().",
        "Il parcourt la liste des auto-configurations, teste leurs conditions (classe présente ? bean "
        "déjà défini ?) et crée seulement les beans dont les conditions sont vraies.",
        "Les starters dans pom.xml et quelques propriétés. Si je déclare mon propre bean, "
        "il remplace celui par défaut."]),
    code=dict(box=code, title="pom.xml (extrait)", hl={1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13}, sections=[("xml",
        "<!-- versions gérées par spring-boot-starter-parent -->\n"
        "<dependencies>\n"
        "  <dependency>\n"
        "    <groupId>org.springframework.boot</groupId>\n"
        "    <artifactId>spring-boot-starter-web</artifactId>\n"
        "  </dependency>\n"
        "  <dependency>\n"
        "    <groupId>org.springframework.boot</groupId>\n"
        "    <artifactId>spring-boot-starter-data-jpa</artifactId>\n"
        "  </dependency>\n"
        "  <dependency>\n"
        "    <groupId>com.h2database</groupId>\n"
        "    <artifactId>h2</artifactId>\n"
        "    <scope>runtime</scope>\n"
        "  </dependency>\n"
        "</dependencies>")]),
))
SCENES[-1]["code"]["hl"] = set()
SCENES[-1]["code"]["steps"] = {0: {4, 8, 12}, 1: {4, 8, 12}, 2: set(), 3: set()}

# ---- 3 bis. Dépendances + propriétés -> composants ------------------------------
dx, dw = MX0, 200
cx_, cw_ = MX0 + 268, 330
comps = [("c1", "Tomcat intégré", "serveur HTTP dans le jar"),
         ("c2", "DispatcherServlet + MVC", "HandlerMapping, HandlerAdapter"),
         ("c3", "Jackson ObjectMapper", "objets Java ↔ JSON"),
         ("c4", "DataSource HikariCP", "pool de connexions vers H2"),
         ("c5", "Hibernate · EntityManager", "implémentation de JPA"),
         ("c6", "Repositories Spring Data", "implémentation de CompteRepository"),
         ("c7", "Réglages appliqués", "port 8080, URL H2, ddl-auto, show-sql")]
n = []
for i, (iid, t, s) in enumerate(comps):
    n.append({"id": iid, "t": t, "s": s, "box": (cx_, 130 + i * 82, cw_, 64)})
n += [{"id": "web", "t": "starter-web", "s": "web + Tomcat + Jackson", "box": (dx, 212, dw, 70)},
      {"id": "h2", "t": "h2", "s": "driver + base", "box": (dx, 344, dw, 56)},
      {"id": "jpa", "t": "starter-data-jpa", "s": "Spring Data + Hibernate + HikariCP", "box": (dx, 460, dw, 76)},
      {"id": "props", "t": "application.properties", "s": "mes réglages", "box": (dx, 626, dw, 62)}]
arr = [dict(a="web", b="c1", c="start"), dict(a="web", b="c2", c="start"), dict(a="web", b="c3", c="start"),
       dict(a="h2", b="c4", c="start"), dict(a="jpa", b="c4", c="start"), dict(a="jpa", b="c5", c="start"),
       dict(a="jpa", b="c6", c="start"), dict(a="props", b="c7", c="start")]
SCENES.append(dict(
    block="3", phase="start", title="3 · Dépendances + propriétés → composants configurés",
    sub="Chaque dépendance apporte des jars ; leur présence active une auto-configuration. "
        "application.properties ne fait qu’ajuster les valeurs par défaut.",
    nodes=n, arrows=arr,
    code=dict(box=(MX0 + 614, 130, MW - 614, 380), title="src/main/resources/application.properties",
              hl=set(), steps={0: {1}, 3: {4, 5, 6}, 4: {9, 10}, 7: {1, 9, 10, 12}}, sections=[("props",
        "# Serveur\n"
        "server.port=8080\n"
        "\n"
        "# Base H2 en mémoire\n"
        "spring.datasource.url=jdbc:h2:mem:banque\n"
        "spring.datasource.username=sa\n"
        "spring.h2.console.enabled=true\n"
        "\n"
        "# JPA / Hibernate\n"
        "spring.jpa.hibernate.ddl-auto=create-drop\n"
        "spring.jpa.show-sql=true\n"
        "# exécuter data.sql après création des tables\n"
        "spring.jpa.defer-datasource-initialization=true")]),
    bullets=dict(box=(MX0 + 614, 522, MW - 614, 188), items=[
        "Sans ce fichier, Boot démarre quand même : port 8080 et base H2 en mémoire.",
        "Une propriété change un réglage, pas le composant.",
        "Un @Bean déclaré par moi remplace celui de l’auto-configuration."]),
))

# ---- 4. Spring MVC ---------------------------------------------------------------
qa, code = std(440)
mvc = hrow([("m", "M — Modèle", "les données : Compte, CompteDto", {"c": VIOLET, "static": True}),
            ("v", "V — Vue", "la représentation : ici du JSON", {"c": VIOLET, "static": True}),
            ("cc", "C — Contrôleur", "reçoit la requête : CompteController", {"c": VIOLET, "static": True})],
           128, 70, gap=40)
ch = hrow([("sw", "starter-web", "dépendance"),
           ("ds", "DispatcherServlet", "enregistré dans Tomcat"),
           ("hm", "HandlerMapping + Adapter", "routes ↔ méthodes Java"),
           ("cv", "Convertisseurs HTTP", "Jackson pour le JSON")], 230, 70, gap=40)
SCENES.append(dict(
    block="4", phase="start", title="4 · Spring MVC : Modèle – Vue – Contrôleur",
    sub="MVC sépare les rôles. Dans une API REST, la « vue » n’est pas une page HTML : "
        "c’est le JSON renvoyé. Spring Boot prépare toute la mécanique au démarrage.",
    nodes=mvc + ch, arrows=chain(ids(ch), "start"),
    qa=dict(box=qa, items=[
        "Transformer une requête HTTP en appel de méthode Java, puis le résultat Java en réponse HTTP.",
        "Tomcat transmet chaque requête au DispatcherServlet, le point d’entrée unique de Spring MVC.",
        "Au démarrage, Boot enregistre le DispatcherServlet, les HandlerMapping et HandlerAdapter, "
        "et les convertisseurs JSON (Jackson).",
        "Le contrôleur : @RestController sur la classe, @GetMapping sur la méthode, "
        "@PathVariable sur le paramètre."]),
    code=dict(box=code, title="web/CompteController.java", hl={0, 10, 11}, sections=[("java",
        "@RestController        // = @Controller + @ResponseBody\n"
        "@RequestMapping(\"/comptes\")\n"
        "public class CompteController {\n"
        "\n"
        "    private final CompteService service;\n"
        "\n"
        "    public CompteController(CompteService service) {\n"
        "        this.service = service;\n"
        "    }\n"
        "\n"
        "    @GetMapping(\"/{id}\")        // GET /comptes/{id}\n"
        "    public CompteDto lire(@PathVariable Long id) {\n"
        "        return service.trouver(id);\n"
        "    }\n"
        "}")]),
))

# ---- 5. JPA, Hibernate, Spring Data JPA, JDBC, H2 ----------------------------------
n = hrow([("repo", "CompteRepository", "Spring Data JPA : interface → implémentation générée"),
          ("em", "EntityManager", "JPA : la norme (jakarta.persistence)"),
          ("hib", "Hibernate", "implémente JPA, génère le SQL"),
          ("jdbc", "JDBC + HikariCP", "API Java standard pour envoyer le SQL"),
          ("h2", "H2", "base SQL en mémoire")], 140, 110)
SCENES.append(dict(
    block="5", phase="start", title="5 · JPA, Hibernate, Spring Data JPA, JDBC, H2 : qui fait quoi ?",
    sub="Cinq noms, cinq couches empilées. Chaque couche appelle celle du dessous : "
        "du repository que j’écris jusqu’à la base qui stocke les comptes.",
    nodes=n, arrows=chain(ids(n), "start"),
    bullets=dict(box=(MX0, 280, MW, 430), title="Le rôle de chaque couche", items=[
        "JPA (Jakarta Persistence) : une spécification. Elle définit @Entity, @Id et l’interface "
        "EntityManager, mais ne fait rien toute seule.",
        "Hibernate : l’implémentation de JPA choisie par Spring Boot. Il transforme les objets en SQL "
        "et les lignes en objets (ORM).",
        "Spring Data JPA : à partir de l’interface CompteRepository, il génère au démarrage une classe "
        "qui appelle l’EntityManager (findById, save…).",
        "JDBC : l’API Java de bas niveau (Connection, PreparedStatement, ResultSet). "
        "HikariCP garde un pool de connexions ouvertes.",
        "H2 : une base SQL écrite en Java. En mémoire, elle est créée au démarrage et effacée à l’arrêt.",
        "Ce que j’écris : seulement @Entity, @Id et l’interface CompteRepository (scène suivante)."]),
))

# ---- 5 bis. @Entity, @Id, JpaRepository ------------------------------------------------
qa, code = std(440)
bw = 190
n = [{"id": "cpt", "t": "Compte", "s": "@Entity · @Id Long id · Long solde", "box": (MX0, 150, bw, 104)},
     {"id": "tab", "t": "Table COMPTE", "s": "ID (clé primaire) · SOLDE", "box": (MX0 + 280, 150, bw, 104)},
     {"id": "itf", "t": "CompteRepository", "s": "extends JpaRepository <Compte, Long>", "box": (MX0 + 540, 150, bw, 104)},
     {"id": "prx", "t": "Proxy Spring Data", "s": "bean créé au démarrage : findById, save…",
      "box": (MX0 + 820, 150, bw + 2, 104)}]
arr = [dict(a="cpt", b="tab", c="start", label="ddl-auto", lpos=(MX0 + 235, 182)),
       dict(a="itf", b="prx", c="start", label="génère", lpos=(MX0 + 775, 182))]
SCENES.append(dict(
    block="5", phase="start", title="5 · @Entity, @Id et JpaRepository dans notre exemple",
    sub="Deux petits fichiers suffisent : la classe Compte, reliée à la table COMPTE, "
        "et l’interface CompteRepository, que Spring Data implémente pour moi.",
    nodes=n, arrows=arr,
    qa=dict(box=qa, items=[
        "Relier la classe Java Compte à la table COMPTE et lire les comptes sans écrire de SQL.",
        "CompteService appelle le repository. Au démarrage, Spring Data crée son implémentation.",
        "Hibernate lit @Entity et @Id puis crée la table (ddl-auto). Spring Data fabrique un "
        "bean proxy qui implémente CompteRepository.",
        "La classe Compte avec @Entity et @Id, et une interface qui étend JpaRepository<Compte, Long>."]),
    code=dict(box=code, title="model/Compte.java · repository/CompteRepository.java", hl={1, 3, 13, 14},
              sections=[("java",
        "// model/Compte.java\n"
        "@Entity                    // → table COMPTE\n"
        "public class Compte {\n"
        "    @Id                    // → clé primaire\n"
        "    private Long id;\n"
        "    private Long solde;    // simplifié (vrai : BigDecimal)\n"
        "\n"
        "    protected Compte() {}  // exigé par JPA\n"
        "    public Long getId()    { return id; }\n"
        "    public Long getSolde() { return solde; }\n"
        "}\n"
        "\n"
        "// repository/CompteRepository.java\n"
        "public interface CompteRepository\n"
        "        extends JpaRepository<Compte, Long> { }\n"),
        ("sql", "-- data.sql : INSERT INTO compte(id, solde) VALUES (42, 1500);")]),
))

# ---- 6. ApplicationContext, beans, injection -----------------------------------------------
qa, code = std(440)
n = hrow([("def", "Définitions", "classes trouvées par le scan + auto-configuration"),
          ("ins", "Instanciation", "Spring appelle le constructeur"),
          ("inj", "Injection", "les dépendances sont passées en paramètres"),
          ("rdy", "Bean prêt", "rangé dans le contexte (un seul exemplaire)")], 180, 100, gap=44)
SCENES.append(dict(
    block="6", phase="start", title="6 · ApplicationContext, beans et injection",
    sub="L’ApplicationContext est le conteneur de Spring. Un bean est un objet qu’il crée et gère. "
        "Il fournit à chaque bean les autres beans dont il a besoin, via son constructeur.",
    nodes=n, arrows=chain(ids(n), "start"),
    qa=dict(box=qa, items=[
        "Créer, relier et garder les objets de l’application (les beans) : plus de new à la main.",
        "SpringApplication.run() le crée et le remplit. Ensuite, Spring MVC lui demande les contrôleurs.",
        "Pour chaque bean, il lit le constructeur, crée d’abord les dépendances, puis les passe en "
        "paramètres. Par défaut, un seul exemplaire par bean (singleton).",
        "@Service ou @RestController et un constructeur avec des champs final. Pas besoin de "
        "@Autowired quand il n’y a qu’un constructeur."]),
    code=dict(box=code, title="service/CompteService.java", hl={6, 7, 8}, sections=[("java",
        "@Service                     // → bean compteService\n"
        "public class CompteService {\n"
        "\n"
        "    private final CompteRepository repo;\n"
        "\n"
        "    // Injection par constructeur :\n"
        "    // Spring passe le bean CompteRepository\n"
        "    public CompteService(CompteRepository repo) {\n"
        "        this.repo = repo;\n"
        "    }\n"
        "\n"
        "    // trouver(Long id) : voir bloc 10\n"
        "}")]),
))
SCENES[-1]["code"]["hl"] = {5, 6, 7, 8}

# ---- 6 bis. Assemblage animé ---------------------------------------------------------------------
n = hrow([("em", "EntityManager", "Hibernate (auto-configuré)"),
          ("repo", "CompteRepository", "proxy créé par Spring Data"),
          ("svc", "CompteService", "new CompteService(repo)"),
          ("ctl", "CompteController", "new CompteController(service)")], 196, 82, x0=MX0 + 22, x1=MX1 - 22, gap=74)
SCENES.append(dict(
    block="6", phase="start", title="6 · Assemblage des beans, étape par étape",
    sub="Spring résout les dépendances en remontant la chaîne : il crée d’abord ce dont les autres "
        "ont besoin, puis les injecte, du repository jusqu’au contrôleur.",
    nodes=n, arrows=[dict(a="em", b="repo", c="start", label="utilisé par", lpos=(0, 0)),
                     dict(a="repo", b="svc", c="start", label="injecté dans", lpos=(0, 0)),
                     dict(a="svc", b="ctl", c="start", label="injecté dans", lpos=(0, 0))],
    bgpanels=[((MX0, 130, MW, 200), tint(GREEN, 0.06), tint(GREEN, 0.4))],
    labels=[(MX0 + 16, 140, "ApplicationContext", GREEN)],
    bullets=dict(box=(MX0, 344, 470, 366), markers=["①", "②", "③", "④", "⑤"], items=[
        "CompteController a besoin d’un CompteService (son constructeur le demande).",
        "CompteService a besoin d’un CompteRepository.",
        "Spring crée d’abord le repository : un proxy généré par Spring Data, branché sur l’EntityManager.",
        "Puis new CompteService(repo), puis new CompteController(service).",
        "Les trois beans restent dans le contexte, prêts pour toutes les requêtes."]),
    code=dict(box=(MX0 + 484, 344, MW - 484, 366), title="Ce que le conteneur fait pour toi (pseudo-code)",
              hl=set(), steps={0: {1, 2}, 1: {3}, 2: {4, 5}}, final_hl={7, 8}, sections=[("java",
        "// Simplifié : tu n'écris pas ce code\n"
        "CompteRepository repo =\n"
        "    springData.creerProxy(CompteRepository.class, em);\n"
        "CompteService service = new CompteService(repo);\n"
        "CompteController controller =\n"
        "    new CompteController(service);\n"
        "\n"
        "contexte.enregistrer(repo, service, controller);\n"
        "// un seul exemplaire de chaque (singleton)")]),
))
# position des étiquettes : au-dessus des flèches
for a in SCENES[-1]["arrows"]:
    a["lpos"] = None
    a["label_above"] = True

# ---- 7. Tomcat et port 8080 --------------------------------------------------------------------
qa, code = std(440)
n = hrow([("tc", "Tomcat créé", "pendant le refresh du contexte"),
          ("ds", "DispatcherServlet", "enregistré dans Tomcat"),
          ("bn", "Beans prêts", "contrôleur, service, repository"),
          ("port", "Port 8080 ouvert", "Tomcat accepte les connexions"),
          ("rdy", "Application prête", "« Started BanqueApplication »")], 180, 100)
SCENES.append(dict(
    block="7", phase="start", title="7 · Tomcat démarre et écoute sur le port 8080",
    sub="Tomcat est le serveur web intégré au jar : pas d’installation séparée. Il est créé pendant "
        "le démarrage, mais il n’ouvre le port qu’une fois tous les beans prêts.",
    nodes=n, arrows=chain(ids(n), "start"),
    qa=dict(box=qa, items=[
        "Serveur HTTP : il ouvre le port, lit les requêtes et écrit les réponses.",
        "Spring Boot (le contexte web) le crée puis le démarre pendant SpringApplication.run().",
        "Il crée Tomcat pendant le refresh du contexte, y enregistre le DispatcherServlet, "
        "puis ouvre le port 8080 à la fin, quand l’application est prête.",
        "Rien d’obligatoire : starter-web suffit. Pour changer le port : server.port dans "
        "application.properties ou en argument."]),
    code=dict(box=code, title="application.properties · ligne de commande", hl={2}, sections=[
        ("props",
         "# application.properties\n"
         "# Port HTTP (8080 = valeur par défaut)\n"
         "server.port=8080\n"
         "\n"
         "# Autres choix possibles :\n"
         "#   server.port=9090  -> autre port\n"
         "#   server.port=0     -> port aléatoire (tests)\n"
         "\n"
         "# Au lancement (prioritaire sur le fichier) :"),
        ("text", "java -jar banque.jar --server.port=9090\n"),
        ("log",
         "Tomcat started on port 8080 (http)\n"
         "Started BanqueApplication in 2.1 seconds")]),
))
SCENES[-1]["code"]["steps"] = {0: {2}, 3: {11, 12}}

# ---- 8. Postman -> Tomcat -> DispatcherServlet -------------------------------------------------------
qa, code = std(440)
n = hrow([("pm", "Postman", "GET localhost:8080 /comptes/42"),
          ("net", "Réseau TCP", "connexion sur le port 8080"),
          ("tc", "Tomcat", "un thread du pool lit le texte HTTP"),
          ("flt", "Filtres", "chaîne de filtres servlet (encodage…)"),
          ("ds", "DispatcherServlet", "porte d’entrée unique de Spring MVC")], 180, 100, c="req")
SCENES.append(dict(
    block="8", phase="req", title="8 · GET /comptes/42 : de Postman au DispatcherServlet",
    sub="L’application tourne. Dans Postman, j’envoie GET http://localhost:8080/comptes/42. "
        "Le point bleu suit la requête jusqu’à l’entrée de Spring MVC.",
    nodes=n, arrows=chain(ids(n), "req"),
    qa=dict(box=qa, items=[
        "Tomcat reçoit la connexion réseau ; le DispatcherServlet est l’aiguilleur de toutes les requêtes.",
        "Postman envoie la requête. Tomcat passe par les filtres puis appelle le DispatcherServlet.",
        "Tomcat lit le texte HTTP sur un thread de son pool et crée HttpServletRequest et "
        "HttpServletResponse. Le DispatcherServlet cherche qui doit traiter la requête.",
        "Rien : tout est configuré. Je saisis seulement l’URL dans Postman et je clique sur Send."]),
    code=dict(box=code, title="La requête", hl={1}, steps={0: {1}, 1: {4, 5, 6, 7}, 2: {10, 11}},
              sections=[("http",
        "-- Dans Postman\n"
        "GET  http://localhost:8080/comptes/42   [Send]\n"
        "\n"
        "-- Ce qui part sur le réseau (texte HTTP)\n"
        "GET /comptes/42 HTTP/1.1\n"
        "Host: localhost:8080\n"
        "Accept: application/json\n"
        "User-Agent: PostmanRuntime/7.x\n"
        "\n"
        "-- Ce que Tomcat fabrique pour Spring\n"
        "HttpServletRequest  : GET, URI /comptes/42\n"
        "HttpServletResponse : vide, à remplir")]),
))

# ---- 9. HandlerMapping -----------------------------------------------------------------------
qa, code = std(440)
n = hrow([("ds", "DispatcherServlet", "getHandler(requête)"),
          ("hm", "RequestMappingHandlerMapping", "compare GET + /comptes/42 aux routes"),
          ("rt", "GET /comptes/{id}", "trouvé : CompteController.lire(Long)")], 180, 100, c="req", gap=60)
SCENES.append(dict(
    block="9", phase="req", title="9 · HandlerMapping : quelle méthode pour /comptes/42 ?",
    sub="Au démarrage, Spring a construit une table des routes à partir des annotations. "
        "Pour chaque requête, le HandlerMapping y cherche la méthode correspondante.",
    nodes=n, arrows=chain(ids(n), "req"),
    qa=dict(box=qa, items=[
        "Trouver le contrôleur et la méthode qui correspondent à la requête.",
        "Le DispatcherServlet, à chaque requête, avant tout le reste.",
        "Il compare la méthode HTTP (GET) et le chemin /comptes/42 avec les routes connues. "
        "Le modèle /comptes/{id} correspond, et il note id = \"42\".",
        "@RequestMapping(\"/comptes\") sur la classe et @GetMapping(\"/{id}\") sur la méthode."]),
    code=dict(box=code, title="Table des routes (construite au démarrage)", hl=set(),
              steps={0: {2}, 1: {5, 6, 7}}, sections=[("java",
        "// À partir de @RequestMapping + @GetMapping :\n"
        "// méthode  chemin            →  handler\n"
        "   GET      /comptes/{id}     →  CompteController.lire(Long)\n"
        "\n"
        "// Requête reçue :\n"
        "   GET      /comptes/42\n"
        "                     ↓ le modèle correspond\n"
        "   id = \"42\"     // encore une chaîne de caractères !\n"
        "\n"
        "// Aucune route ne correspond → 404 Not Found\n"
        "// Bon chemin, mauvaise méthode → 405")]),
))

# ---- 9 bis. HandlerAdapter et @PathVariable ---------------------------------------------------
qa, code = std(440)
n = hrow([("ha", "HandlerAdapter", "RequestMappingHandlerAdapter.handle()"),
          ("pv", "@PathVariable", "lit \"42\" dans l’URL"),
          ("cv", "Conversion", "String \"42\" → Long 42L"),
          ("call", "lire(42L)", "méthode Java appelée (réflexion)")], 180, 100, c="req", gap=44)
SCENES.append(dict(
    block="9", phase="req", title="9 · HandlerAdapter et @PathVariable : \"42\" → 42L",
    sub="Le HandlerAdapter sait appeler la méthode trouvée. Il prépare chaque paramètre : "
        "ici, le texte \"42\" de l’URL devient le Long 42 attendu par la signature.",
    nodes=n, arrows=chain(ids(n), "req"),
    qa=dict(box=qa, items=[
        "Appeler concrètement la méthode Java trouvée, avec des arguments du bon type.",
        "Le DispatcherServlet, juste après le HandlerMapping.",
        "Pour @PathVariable, un résolveur lit \"42\" dans l’URL, le ConversionService le transforme "
        "en Long, puis l’adapter invoque lire(42L) par réflexion.",
        "Seulement @PathVariable Long id dans la signature. La conversion est automatique."]),
    code=dict(box=code, title="Signature et appel", hl=set(), steps={0: {1, 2}, 1: {3, 6}, 2: {7}},
              sections=[("java",
        "@GetMapping(\"/{id}\")\n"
        "public CompteDto lire(@PathVariable Long id)\n"
        "//                    ▲ \"42\" lu dans l'URL\n"
        "//                    └─ converti en Long 42L\n"
        "\n"
        "// Ce que fait l'adapter (simplifié) :\n"
        "Long arg = conversion.convert(\"42\", Long.class);\n"
        "Object res = methode.invoke(controller, arg);\n"
        "\n"
        "// \"abc\" ne devient pas un Long → 400 (fin)")]),
))

# ---- 10. Controller -> Service -> Repository -------------------------------------------------------
qa, code = std(430)
n = hrow([("ds", "DispatcherServlet", "via le HandlerAdapter"),
          ("ctl", "CompteController", "lire(42L)"),
          ("svc", "CompteService", "trouver(42L) · @Transactional"),
          ("repo", "CompteRepository", "findById(42L)"),
          ("em", "Proxy Spring Data", "SimpleJpaRepository → EntityManager")], 180, 100, c="req")
SCENES.append(dict(
    block="10", phase="req", title="10 · CompteController → CompteService → CompteRepository",
    sub="Chaque couche a un rôle et délègue à la suivante. Le code surligné à droite "
        "est celui qui s’exécute au moment où le point bleu passe.",
    nodes=n, arrows=chain(ids(n), "req"),
    qa=dict(box=qa, items=[
        "Séparer les rôles : le contrôleur gère le HTTP, le service la logique métier, "
        "le repository l’accès aux données.",
        "Le HandlerAdapter appelle le contrôleur, qui appelle le service, qui appelle le repository.",
        "lire(42L) délègue à trouver(42L), qui ouvre une transaction en lecture et appelle "
        "findById(42L). Le repository renvoie un Optional<Compte>.",
        "Les trois classes. findById n’est pas écrit : il est hérité de JpaRepository."]),
    code=dict(box=code, title="Les signatures, dans l’ordre d’appel", hl=set(),
              steps={0: {1, 2}, 1: {6, 7, 8}, 2: {8, 13}, 3: {13}}, final_hl={13},
              sections=[("java",
        "// CompteController\n"
        "public CompteDto lire(@PathVariable Long id) {\n"
        "    return service.trouver(id);         // (1)\n"
        "}\n"
        "\n"
        "// CompteService\n"
        "@Transactional(readOnly = true)\n"
        "public CompteDto trouver(Long id) {\n"
        "    Compte c = repo.findById(id)        // (2)\n"
        "        .orElseThrow(() ->\n"
        "            new CompteIntrouvableException(id));\n"
        "    return CompteDto.de(c);\n"
        "}\n"
        "Optional<Compte> findById(Long id);     // (3) hérité")]),
))

# ---- 11. EntityManager -> Hibernate -> JDBC -> H2 ------------------------------------------------
qa, code = std(430)
n = hrow([("prx", "Proxy repository", "findById(42L)"),
          ("em", "EntityManager", "find(Compte.class, 42L)"),
          ("hib", "Hibernate", "cache vide → génère le SELECT"),
          ("jdbc", "JDBC", "connexion HikariCP + PreparedStatement"),
          ("h2", "H2", "exécute la requête")], 180, 100, c="req")
SCENES.append(dict(
    block="11", phase="req", title="11 · Lecture en base : EntityManager → Hibernate → JDBC → H2",
    sub="findById(42L) descend les couches de persistance jusqu’à la base. "
        "Hibernate écrit le SQL à ma place et JDBC l’envoie à H2 avec le paramètre 42.",
    nodes=n, arrows=chain(ids(n), "req"),
    qa=dict(box=qa, items=[
        "Traduire findById(42L) en SQL, l’exécuter et récupérer le résultat.",
        "Le proxy du repository appelle EntityManager.find(), implémenté par Hibernate.",
        "Hibernate regarde d’abord son cache de transaction, génère le SELECT, prend une "
        "connexion dans le pool HikariCP et l’exécute via JDBC sur H2.",
        "Rien. Avec spring.jpa.show-sql=true, je vois le SQL dans la console."]),
    code=dict(box=code, title="Du Java au SQL (illustratif)", hl=set(),
              steps={0: {1}, 1: {1}, 2: {4, 5}, 3: {8, 9, 10}}, sections=[
        ("java", "// 1. Spring Data (SimpleJpaRepository)\n"
                 "em.find(Compte.class, 42L);\n"
                 "\n"
                 "// 2. Hibernate génère le SQL (show-sql)"),
        ("sql", "select c1_0.id, c1_0.solde\n"
                "from compte c1_0 where c1_0.id = ?\n"),
        ("java", "// 3. JDBC envoie la requête à H2\n"
                 "PreparedStatement ps = cnx.prepareStatement(sql);\n"
                 "ps.setLong(1, 42L);              // ? ← 42\n"
                 "ResultSet rs = ps.executeQuery();")]),
))

# ---- 11 bis. La ligne devient un objet Compte -------------------------------------------------------
n = hrow([("h2", "H2", "1 ligne : ID = 42, SOLDE = 1500"),
          ("rs", "ResultSet (JDBC)", "rs.getLong(\"ID\"), rs.getLong(\"SOLDE\")"),
          ("hib", "Hibernate", "new Compte() puis remplit les champs"),
          ("cpt", "Objet Compte", "id = 42, solde = 1500 (entité gérée)"),
          ("svc", "CompteService", "reçoit Optional<Compte>")], 150, 100, c="resp")
SCENES.append(dict(
    block="11", phase="resp", title="11 · Le retour : la ligne SQL redevient un objet Compte",
    sub="Le chemin s’inverse (en orange) : H2 renvoie une ligne, JDBC la présente sous forme de ResultSet "
        "et Hibernate reconstruit un objet Java Compte.",
    nodes=n, arrows=chain(ids(n), "resp"),
    bullets=dict(box=(MX0, 280, 470, 430), title="Ce qui se passe", items=[
        "H2 renvoie une seule ligne : ID = 42, SOLDE = 1500.",
        "Hibernate lit le ResultSet, appelle le constructeur sans argument de Compte "
        "et remplit les champs id et solde.",
        "L’objet est gardé dans le cache de la transaction : un second find(42L) ne refait pas de SQL.",
        "Spring Data renvoie Optional.of(compte). Aucune ligne → Optional.empty().",
        "À la sortie de trouver(), la transaction se termine et la connexion retourne au pool."]),
    code=dict(box=(MX0 + 484, 280, MW - 484, 430), title="SQL exécuté et résultat (illustratif)",
              hl=set(), steps={0: {6, 7, 8}, 1: {6, 7, 8}, 2: {11, 12}, 3: {13}}, sections=[
        ("sql", "-- SQL illustratif, paramètre lié = 42\n"
                "select c1_0.id, c1_0.solde\n"
                "from compte c1_0\n"
                "where c1_0.id = 42;\n"
                "\n"
                "-- Résultat renvoyé par H2\n"
                " ID | SOLDE\n"
                "----+-------\n"
                " 42 | 1500\n"
                "\n"),
        ("java", "// Hibernate reconstruit l'objet (simplifié)\n"
                 "Compte c = new Compte();     // constructeur vide\n"
                 "c.id = 42L; c.solde = 1500L; // par réflexion\n"
                 "return Optional.of(c);       // findById")]),
))

# ---- 12. Compte -> CompteDto -> JSON ------------------------------------------------------------------
qa, code = std(440)
n = hrow([("cpt", "Compte", "entité JPA : id = 42, solde = 1500"),
          ("dto", "CompteDto.de(c)", "ne garde que id et solde"),
          ("ret", "lire() retourne", "CompteDto[id=42, solde=1500]"),
          ("jk", "Jackson", "convertisseur HTTP JSON (ObjectMapper)"),
          ("json", "{\"id\":42,\"solde\":1500}", "corps de la réponse")], 180, 100, c="resp")
SCENES.append(dict(
    block="12", phase="resp", title="12 · Compte → CompteDto → JSON avec Jackson",
    sub="Le service ne renvoie pas l’entité : il la copie dans un DTO. Comme la classe est un "
        "@RestController, le résultat est écrit tel quel en JSON par Jackson.",
    nodes=n, arrows=chain(ids(n), "resp"),
    qa=dict(box=qa, items=[
        "Ne montrer au client que les champs voulus (le DTO) et les écrire au format JSON.",
        "CompteService crée le DTO. Puis Spring MVC (grâce à @ResponseBody, inclus dans "
        "@RestController) appelle le convertisseur Jackson.",
        "Jackson lit les composants du record et écrit {\"id\":42,\"solde\":1500} dans le corps, "
        "avec Content-Type: application/json.",
        "Le record CompteDto et sa méthode de conversion. Jackson est déjà configuré par Boot."]),
    code=dict(box=code, title="model/CompteDto.java · sérialisation", hl=set(),
              steps={0: {3, 4}, 1: {0}, 2: {8, 9, 10}, 3: {11}}, sections=[
        ("java",
         "public record CompteDto(Long id, Long solde) {\n"
         "\n"
         "    public static CompteDto de(Compte c) {\n"
         "        return new CompteDto(c.getId(),\n"
         "                             c.getSolde());\n"
         "    }\n"
         "}\n"
         "\n"
         "// Jackson lit les composants du record :\n"
         "//     CompteDto[id=42, solde=1500]\n"
         "//              ↓ sérialisation"),
        ("json", "{\"id\":42,\"solde\":1500}")]),
))

# ---- 12 bis. HTTP 200 vers Postman ------------------------------------------------------------------
qa, code = std(440)
n = hrow([("jk", "Jackson", "écrit le JSON dans la réponse"),
          ("ds", "DispatcherServlet", "statut 200 : la méthode s’est bien terminée"),
          ("tc", "Tomcat", "envoie les octets, libère le thread"),
          ("net", "Réseau TCP", "la réponse repart vers le client"),
          ("pm", "Postman", "Status 200 OK · JSON affiché")], 180, 100, c="resp")
SCENES.append(dict(
    block="12", phase="resp", title="12 · La réponse HTTP 200 revient à Postman",
    sub="Dernière étape : la réponse remonte la chaîne en sens inverse. "
        "Postman affiche le statut 200 OK et le corps {\"id\":42,\"solde\":1500}.",
    nodes=n, arrows=chain(ids(n), "resp"),
    qa=dict(box=qa, items=[
        "Renvoyer le résultat au client qui a fait la demande.",
        "Le DispatcherServlet rend la main à Tomcat, qui écrit sur la connexion ouverte par Postman.",
        "Statut 200 par défaut quand la méthode se termine normalement. Les octets JSON partent "
        "sur le réseau et le thread retourne dans le pool de Tomcat.",
        "Rien de plus. Pour choisir le statut ou les en-têtes : retourner un ResponseEntity."]),
    code=dict(box=code, title="La réponse", hl=set(), steps={0: {3}, 1: {0}, 2: {0, 1, 3}, 3: {6, 7, 8, 9, 10}},
              sections=[("http",
        "HTTP/1.1 200 OK\n"
        "Content-Type: application/json\n"
        "\n"
        "{\"id\":42,\"solde\":1500}\n"
        "\n"
        "-- Dans Postman\n"
        "Status: 200 OK      Time: 15 ms\n"
        "{\n"
        "    \"id\": 42,\n"
        "    \"solde\": 1500\n"
        "}")]),
))

# ---- 12 ter. Cas 400 ------------------------------------------------------------------------------------
n = hrow([("pm", "Postman", "GET /comptes/abc"),
          ("ds", "DispatcherServlet", "route /comptes/{id} trouvée"),
          ("pv", "@PathVariable", "\"abc\" → Long : échec", {"kind": "ko"}),
          ("lire", "lire()", "jamais appelée", {"kind": "ghost"})], 140, 84, c="req", gap=60)
pmx = n[0]["box"][0] + n[0]["box"][2] / 2
pvx = n[2]["box"][0] + n[2]["box"][2] / 2
SCENES.append(dict(
    block="12", phase="resp", title="12 · Cas d’erreur 1 : identifiant invalide → 400",
    sub="GET /comptes/abc : la route existe, mais \"abc\" ne peut pas devenir un Long. "
        "Spring s’arrête avant même d’appeler le contrôleur.",
    nodes=n, arrows=[dict(a="pm", b="ds", c="req"), dict(a="ds", b="pv", c="req"),
                     dict(a="pv", b="pm", c="resp", label="400 Bad Request",
                          pts=[(pvx, 224), (pvx, 290), (pmx, 290), (pmx, 224)])],
    bullets=dict(box=(MX0, 344, 470, 366), items=[
        "Le HandlerMapping trouve bien /comptes/{id}.",
        "La conversion \"abc\" → Long échoue : MethodArgumentTypeMismatchException.",
        "lire() n’est jamais appelée : ni le service ni H2 ne sont touchés.",
        "Le gestionnaire d’erreurs par défaut de Spring Boot répond 400 Bad Request.",
        "J’écris : rien. Pour un message personnalisé : un @RestControllerAdvice."]),
    code=dict(box=(MX0 + 484, 344, MW - 484, 366), title="Requête et réponse", hl={2}, sections=[("http",
        "GET /comptes/abc HTTP/1.1\n"
        "\n"
        "HTTP/1.1 400 Bad Request\n"
        "Content-Type: application/json\n"
        "\n"
        "{\n"
        "  \"timestamp\": \"2026-11-12T10:15:30\",\n"
        "  \"status\": 400,\n"
        "  \"error\": \"Bad Request\",\n"
        "  \"path\": \"/comptes/abc\"\n"
        "}")]),
))

# ---- 12 quater. Cas 404 ----------------------------------------------------------------------------------
n = hrow([("pm", "Postman", "GET /comptes/99"),
          ("ctl", "CompteController", "lire(99L)"),
          ("svc", "CompteService", "trouver(99L)"),
          ("repo", "CompteRepository", "findById(99L)"),
          ("h2", "H2", "0 ligne trouvée", {"kind": "ko"})], 136, 84, c="req")
cxs = [nn["box"][0] + nn["box"][2] / 2 for nn in n]
SCENES.append(dict(
    block="12", phase="resp", title="12 · Cas d’erreur 2 : compte absent → 404",
    sub="GET /comptes/99 : la requête est valide et descend jusqu’à H2, mais aucun compte "
        "n’a l’id 99. Le service lève une exception transformée en 404.",
    nodes=n, arrows=chain(ids(n), "req") + [
        dict(a="h2", b="svc", c="resp", label="Optional.empty()",
             pts=[(cxs[4], 220), (cxs[4], 262), (cxs[2], 262), (cxs[2], 220)]),
        dict(a="svc", b="pm", c="resp", label="404 Not Found",
             pts=[(cxs[2] - 30, 220), (cxs[2] - 30, 306), (cxs[0], 306), (cxs[0], 220)])],
    bullets=dict(box=(MX0, 344, 450, 366), items=[
        "Le chemin est valide : lire(99L) est appelée normalement.",
        "H2 ne renvoie aucune ligne : findById donne Optional.empty().",
        "orElseThrow lève CompteIntrouvableException.",
        "@ResponseStatus(NOT_FOUND) sur l’exception : Spring répond 404 avec un JSON d’erreur.",
        "J’écris : l’exception et son annotation (ou un @RestControllerAdvice)."]),
    code=dict(box=(MX0 + 464, 344, MW - 464, 366), title="Service, exception et réponse", hl=set(),
              steps={4: {0, 1, 2}, 5: {4, 5, 6, 8}}, sections=[
        ("java",
         "Compte c = repo.findById(id)   // Optional.empty()\n"
         "    .orElseThrow(() ->\n"
         "        new CompteIntrouvableException(id));\n"
         "\n"
         "@ResponseStatus(HttpStatus.NOT_FOUND)\n"
         "public class CompteIntrouvableException\n"
         "        extends RuntimeException { … }\n"),
        ("http",
         "HTTP/1.1 404 Not Found\n"
         "{\"status\":404,\"error\":\"Not Found\",\"path\":\"/comptes/99\"}")]),
))

# ---- Fin : carte globale complète ---------------------------------------------------------------
SCENES.append(carte(True))


# --------------------------------------------------------------------------
# Rendu
# --------------------------------------------------------------------------
def scene_text_len(sc):
    n = len(sc["sub"])
    if sc.get("qa"):
        n += sum(len(t) for t in sc["qa"]["items"])
    if sc.get("bullets"):
        n += sum(len(t) for t in sc["bullets"]["items"])
    c = 0
    if sc.get("code"):
        c = sum(len(t) for _, t in sc["code"]["sections"])
    return n, c


def render_base(sc, idx, total, hl):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    where = sc["title"]
    draw_chrome(d, sc, idx, total)
    draw_sub(d, sc)
    for box, fill, outline in sc.get("bgpanels", []):
        rrect(d, box, 14, fill=fill, outline=outline, width=2)
    for x, y, txt, c in sc.get("labels", []):
        d.text((x, y), txt, font=F("bold", 13), fill=c)
    if sc.get("qa"):
        draw_qa(d, sc["qa"], sc["phase"], where)
    if sc.get("bullets"):
        draw_bullets(d, sc["bullets"], sc["phase"], where)
    if sc.get("code"):
        draw_code(d, sc["code"], hl, where)
    return im


def render_scene(sc, idx, total):
    nodes = {n["id"]: n for n in sc.get("nodes", [])}
    for n in nodes.values():
        layout_node(n, sc["title"])
        x, y, w, h = n["box"]
        if x < MX0 - 1 or x + w > MX1 + 1 or y < DIAG_Y0 - 2 or y + h > H - 6:
            raise Overflow(f"{sc['title']} : bloc « {n['t']} » hors cadre")
    arrows = sc.get("arrows", [])
    for a in arrows:
        prepare_arrow(a, nodes)
        if a.get("label_above"):
            p = poly_cut(a["_pts"], 0.5)[1]
            a["lpos"] = (p[0], p[1] - 52)
    path = sc.get("path", list(range(len(arrows))))
    code = sc.get("code")
    steps = code.get("steps", {}) if code else {}
    hl = frozenset(code.get("hl", set())) if code else frozenset()
    bases = {}

    def base(h):
        if h not in bases:
            bases[h] = render_base(sc, idx, total, h)
        return bases[h]

    frames = []

    def emit(lit_nodes, arrow_state, hl, ms, dot=None):
        im = base(hl).copy()
        d = ImageDraw.Draw(im)
        for nid, n in nodes.items():
            draw_node(d, n, nid in lit_nodes or n.get("static"), sc["phase"])
        for i, a in enumerate(arrows):
            st, t = arrow_state.get(i, (0, 0))
            draw_arrow(d, a, st, t)
        if dot:
            draw_dot(d, *dot)
        frames.append((im, ms))

    lit = set()
    state = {}
    if path:
        lit.add(arrows[path[0]]["a"])
    emit(lit, state, hl, 1400)
    for k, ai in enumerate(path):
        a = arrows[ai]
        lit.add(a["a"])
        if k in steps:
            hl = frozenset(steps[k])
        L = poly_len(a["_pts"])
        nf = max(5, min(12, int(L / 38)))
        c = col(a.get("c", "start"))
        for f in range(1, nf + 1):
            t = 0.5 - 0.5 * math.cos(math.pi * f / nf)
            state[ai] = (1, t)
            emit(lit, state, hl, 55, dot=(poly_cut(a["_pts"], t)[1], c))
        state[ai] = (2, 1)
        lit.add(a["b"])
        pause = 2600 if (k in steps and steps[k]) else 450
        emit(lit, state, hl, pause)
    if code and "final_hl" in code:
        hl = frozenset(code["final_hl"])
    nt, nc = scene_text_len(sc)
    hold = sc.get("hold") or int(1000 * min(26, max(10, 4 + nt / 20 + nc / 55)))
    emit(set(nodes), {i: (2, 1) for i in range(len(arrows))}, hl, hold)
    return frames


def main():
    total = len(SCENES)
    all_frames, durations = [], []
    total_ms = 0
    for idx, sc in enumerate(SCENES):
        frames = render_scene(sc, idx, total)
        # Palette commune à la scène : première + dernière image
        comp = Image.new("RGB", (W, H * 2))
        comp.paste(frames[0][0], (0, 0))
        comp.paste(frames[-1][0], (0, H))
        pal = comp.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        for im, ms in frames:
            all_frames.append(im.quantize(palette=pal, dither=Image.Dither.NONE))
            durations.append(ms)
        scene_ms = sum(ms for _, ms in frames)
        total_ms += scene_ms
        print(f"[{idx + 1:2d}/{total}] {sc['title'][:70]:70s} {len(frames):3d} images  {scene_ms / 1000:5.1f} s")
        if PREVIEW_DIR:
            os.makedirs(PREVIEW_DIR, exist_ok=True)
            frames[-1][0].save(os.path.join(PREVIEW_DIR, f"scene_{idx + 1:02d}.png"))
            frames[len(frames) // 2][0].save(os.path.join(PREVIEW_DIR, f"scene_{idx + 1:02d}_mid.png"))
    print(f"Durée totale : {total_ms / 1000:.0f} s ({total_ms / 60000:.1f} min)")
    all_frames[0].save(OUT, save_all=True, append_images=all_frames[1:], duration=durations,
                       loop=0, disposal=1, optimize=False)

    # Vérification du fichier produit
    with Image.open(OUT) as g:
        n = g.n_frames
        loop = g.info.get("loop")
        size = g.size
        tot = 0
        for i in range(n):
            g.seek(i)
            tot += g.info.get("duration", 0)
    assert g.format == "GIF", "le fichier n'est pas un GIF"
    assert n > 1, "le GIF ne contient qu'une image"
    assert loop == 0, "le GIF ne boucle pas"
    print(f"OK : {OUT} · {size[0]}x{size[1]} · {n} images · boucle infinie (loop=0) · "
          f"{tot / 1000:.0f} s · {os.path.getsize(OUT) / 1e6:.1f} Mo")


if __name__ == "__main__":
    main()
