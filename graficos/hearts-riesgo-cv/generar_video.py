"""Video con todos los resultados posibles de la calculadora de riesgo
cardiovascular HEARTS (OPS) para Argentina.

La lógica y las tablas se tomaron del código de la propia calculadora
(https://www.paho.org/cardioapp/web/#/cvrisk, archivo main.59353289.js):
  - Argentina pertenece a la región "South" (junto con Chile y Uruguay).
  - Flujo: ¿ECV previa? -> Sí: "Paciente de muy alto riesgo".
           ¿ERC?        -> Sí: "Paciente de alto riesgo".
           ¿Diabetes?   -> Sí: "Paciente de alto riesgo".
           ¿Conoce el colesterol total? -> Sí: tabla con laboratorio
                                           No: tabla sin laboratorio (IMC).
  - La tabla con laboratorio del código también trae valores con diabetes,
    pero la app nunca los usa: siempre calcula con diabetes = No (los
    diabéticos ya salieron como "Paciente de alto riesgo"). No se muestran.
  - Categorías: <5 Bajo, 5-9 Moderado, 10-19 Alto, 20-29 Muy alto, >=30 Crítico.
Las tablas están copiadas en tablas_ops_region_sur.json.

Uso:  python generar_video.py   (requiere Pillow y ffmpeg)
"""

import json
import math
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

AQUI = os.path.dirname(os.path.abspath(__file__))
TABLAS = json.load(open(os.path.join(AQUI, "tablas_ops_region_sur.json"), encoding="utf-8"))

W, H = 1920, 1080
FPS = 24

BG = (10, 14, 28)
BG2 = (18, 14, 36)
BLANCO = (245, 247, 252)
GRIS = (150, 160, 184)
GRIS_OSC = (48, 56, 80)
ROJO_OPS = (234, 52, 53)

# Colores y nombres tal como los usa la app (variables --risk-color-0..4)
CATS = [
    ("Bajo", "< 5%", (0x23, 0xB1, 0x4B), (10, 30, 15)),
    ("Moderado", "5 a < 10%", (0xFD, 0xEE, 0x19), (40, 34, 0)),
    ("Alto", "10 a < 20%", (0xF6, 0x7D, 0x22), (30, 12, 0)),
    ("Muy alto", "20 a < 30%", (0xC4, 0x17, 0x1D), (255, 235, 235)),
    ("Crítico", "≥ 30%", (0x51, 0x00, 0x04), (255, 210, 210)),
]

EDADES = ["40–44", "45–49", "50–54", "55–59", "60–64", "65–69", "70–74"]
PAS = ["≥180", "160–179", "140–159", "120–139", "<120"]          # de arriba a abajo
IMC = ["<20", "20–24", "25–29", "30–34", "≥35"]
COL = ["<155", "155–192", "193–231", "232–269", "≥270"]


def categoria(v):
    return 0 if v < 5 else 1 if v < 10 else 2 if v < 20 else 3 if v < 30 else 4


def riesgo(lab, diabetes, hombre, fuma, edad_i, pas_i, x_i):
    """Reproduce la función Or() de la app: clave numérica -> % de riesgo."""
    u = ("1" if hombre else "0") + ("1" if fuma else "0") + str(edad_i + 1) + str(pas_i + 1)
    if lab:
        u = ("1" if diabetes else "0") + u
    u += str(x_i + 1)
    tabla = TABLAS["con_laboratorio" if lab else "sin_laboratorio"]
    return tabla.get(str(int(u)), 0)


# --------------------------------------------------------------------------
def fuente(peso, tam):
    nombres = {
        "black": ["InterDisplay-Black.otf", "Inter-Black.otf", "DejaVuSans-Bold.ttf"],
        "bold": ["Inter-Bold.otf", "DejaVuSans-Bold.ttf"],
        "semi": ["Inter-SemiBold.otf", "Inter-Bold.otf", "DejaVuSans-Bold.ttf"],
        "medium": ["Inter-Medium.otf", "DejaVuSans.ttf"],
        "regular": ["Inter-Regular.otf", "DejaVuSans.ttf"],
    }[peso]
    for n in nombres:
        for d in ("/usr/share/fonts/opentype/inter/", "/usr/share/fonts/truetype/dejavu/"):
            if os.path.exists(d + n):
                return ImageFont.truetype(d + n, tam)
    return ImageFont.load_default()


_FC = {}


def F(peso, tam):
    k = (peso, tam)
    if k not in _FC:
        _FC[k] = fuente(peso, tam)
    return _FC[k]


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease(t):
    t = clamp(t)
    return 1 - (1 - t) ** 3


def ease_back(t):
    t = clamp(t)
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def prog(t, ini, dur):
    return clamp((t - ini) / dur)


def mezcla(a, b, k):
    return tuple(int(a[i] + (b[i] - a[i]) * clamp(k)) for i in range(3))


_FONDO = None


def lienzo():
    global _FONDO
    if _FONDO is None:
        _FONDO = Image.new("RGB", (W, H))
        d = ImageDraw.Draw(_FONDO)
        for y in range(H):
            d.line([(0, y), (W, y)], fill=mezcla(BG, BG2, y / H))
    im = _FONDO.copy()
    return im, ImageDraw.Draw(im)


def texto(d, xy, s, f, color=BLANCO, a=1.0, anchor="la", spacing=8, align="left"):
    if a <= 0:
        return
    d.multiline_text(xy, s, font=f, fill=mezcla(BG, color, a), anchor=anchor,
                     spacing=spacing, align=align)


def cabecera(d, titulo, sub, t):
    a = ease(prog(t, 0, 0.5))
    d.rectangle([60, 48, 68, 104], fill=mezcla(BG, ROJO_OPS, a))
    texto(d, (88, 46), titulo, F("black", 38), BLANCO, a)
    texto(d, (90, 94), sub, F("medium", 19), GRIS, a)


# --------------------------------------------------------------------------
# Escenas
# --------------------------------------------------------------------------
def escena_titulo(t):
    im, d = lienzo()
    # pulso de fondo
    pts = []
    for x in range(0, W, 3):
        p = ((x + t * 300) / 380) % 1
        y = 760
        if 0.30 < p < 0.33:
            y -= 140 * (p - 0.30) / 0.03
        elif 0.33 <= p < 0.37:
            y = 620 + 230 * (p - 0.33) / 0.04
        elif 0.37 <= p < 0.40:
            y = 850 - 90 * (p - 0.37) / 0.03
        pts.append((x, y))
    d.line(pts, fill=mezcla(BG, ROJO_OPS, 0.35), width=4)
    a1 = ease(prog(t, 0.2, 0.8))
    texto(d, (W / 2, 250 + 30 * (1 - a1)), "CALCULADORA HEARTS", F("black", 96), BLANCO, a1, "mm")
    texto(d, (W / 2, 355 + 30 * (1 - a1)), "Riesgo cardiovascular a 10 años", F("bold", 52), ROJO_OPS, a1, "mm")
    a2 = ease(prog(t, 1.0, 0.8))
    texto(d, (W / 2, 470), "Todos los resultados posibles", F("medium", 40), BLANCO, a2, "mm")
    a3 = ease(prog(t, 1.6, 0.8))
    texto(d, (W / 2, 950), "OPS · HEARTS en las Américas  ·  Argentina (región Sur: Argentina, Chile y Uruguay)",
          F("regular", 24), GRIS, a3, "mm")
    return im


def caja(d, x, y, w, h, txt, borde, relleno, a, f=None, col=BLANCO):
    if a <= 0:
        return
    d.rounded_rectangle([x, y, x + w, y + h], radius=16, fill=mezcla(BG, relleno, a),
                        outline=mezcla(BG, borde, a), width=3)
    texto(d, (x + w / 2, y + h / 2), txt, f or F("bold", 24), col, a, "mm", align="center")


def flecha(d, x0, y0, x1, y1, a, color=GRIS, etiqueta=None):
    if a <= 0:
        return
    xe = x0 + (x1 - x0) * a
    ye = y0 + (y1 - y0) * a
    c = mezcla(BG, color, 1)
    d.line([(x0, y0), (xe, ye)], fill=c, width=4)
    if a > 0.95:
        ang = math.atan2(y1 - y0, x1 - x0)
        p1 = (x1 - 16 * math.cos(ang - 0.45), y1 - 16 * math.sin(ang - 0.45))
        p2 = (x1 - 16 * math.cos(ang + 0.45), y1 - 16 * math.sin(ang + 0.45))
        d.polygon([(x1, y1), p1, p2], fill=c)
    if etiqueta and a > 0.5:
        texto(d, ((x0 + x1) / 2 + (0 if y0 != y1 else 0), (y0 + y1) / 2 - 22 if y0 == y1 else (y0 + y1) / 2),
              etiqueta, F("bold", 20), color, ease((a - 0.5) * 2), "mm" if y0 == y1 else "lm")


def escena_flujo(t):
    im, d = lienzo()
    cabecera(d, "Cómo decide la calculadora", "Antes de usar las tablas, hace cuatro preguntas", t)
    preguntas = ["¿Antecedente de enfermedad\ncardiovascular?", "¿Enfermedad renal\ncrónica?",
                 "¿Diabetes mellitus?", "¿Conoce su colesterol\ntotal?"]
    salidas = [("PACIENTE DE\nMUY ALTO RIESGO", CATS[3][2]), ("PACIENTE DE\nALTO RIESGO", CATS[2][2]),
               ("PACIENTE DE\nALTO RIESGO", CATS[2][2]), ("TABLA CON\nLABORATORIO", (70, 130, 220))]
    x, w, h = 300, 470, 120
    ys = [170, 380, 590, 800]
    for i, (q, y) in enumerate(zip(preguntas, ys)):
        t0 = 0.4 + i * 0.9
        a = ease(prog(t, t0, 0.5))
        caja(d, x, y, w, h, q, GRIS, (26, 32, 56), a, F("bold", 26))
        fa = ease(prog(t, t0 + 0.4, 0.5))
        flecha(d, x + w, y + h / 2, 1000, y + h / 2, fa, (110, 220, 140), "Sí")
        sal, col = salidas[i]
        caja(d, 1010, y + 5, 420, h - 10, sal, col, mezcla((20, 20, 30), col, 0.25),
             ease(prog(t, t0 + 0.8, 0.4)), F("black", 26))
        if i < 3:
            flecha(d, x + w / 2, y + h, x + w / 2, ys[i + 1], ease(prog(t, t0 + 0.6, 0.4)), (240, 120, 120))
            if prog(t, t0 + 0.8, 0.3) > 0:
                texto(d, (x + w / 2 + 14, (y + h + ys[i + 1]) / 2), "No", F("bold", 20), (240, 120, 120),
                      ease(prog(t, t0 + 0.8, 0.3)), "lm")
    # rama "No" final -> tabla sin laboratorio
    t4 = 0.4 + 3 * 0.9 + 0.6
    y = ys[3]
    a = ease(prog(t, t4, 0.5))
    if a > 0:
        d.line([(x, y + h / 2), (x - (x - 170) * a, y + h / 2)], fill=(240, 120, 120), width=4)
    if a > 0.6:
        texto(d, (210, y + h / 2 - 22), "No", F("bold", 20), (240, 120, 120), a, "mm")
        caja(d, 60, y - 150, 220, 120, "TABLA SIN\nLABORATORIO\n(usa IMC)", (70, 130, 220),
             (22, 38, 70), ease(prog(t, t4 + 0.3, 0.4)), F("black", 22))
        flecha(d, 170, y + h / 2 - 2, 170, y - 28, ease(prog(t, t4 + 0.2, 0.3)), (240, 120, 120))
    # categorías
    ac = prog(t, 4.6, 0.4)
    texto(d, (1560, 180), "Resultado de\nlas tablas", F("bold", 26), BLANCO, ease(ac))
    for i, (nom, rango, col, _) in enumerate(CATS):
        a = ease(prog(t, 4.8 + i * 0.15, 0.4))
        yy = 290 + i * 110
        if a > 0:
            d.rounded_rectangle([1560, yy, 1560 + 70 * a, yy + 70], radius=12, fill=col)
            texto(d, (1650, yy + 8), nom, F("bold", 28), BLANCO, a)
            texto(d, (1650, yy + 42), rango, F("regular", 22), GRIS, a)
    return im


def mini_grilla(d, x, y, cw, ch, valores, revelado, t_local, font):
    """valores[fila_pas][col] con fila 0 = PAS >=180."""
    for r in range(5):
        for c in range(5):
            k = revelado(r, c)
            if k <= 0:
                continue
            v = valores[r][c]
            nom, _, col, tcol = CATS[categoria(v)]
            s = ease_back(k)
            cx, cy = x + c * cw + cw / 2, y + r * ch + ch / 2
            hw, hh = (cw - 2) / 2 * s, (ch - 2) / 2 * s
            d.rectangle([cx - hw, cy - hh, cx + hw, cy + hh], fill=col)
            if k > 0.6:
                d.text((cx, cy + 1), str(v), font=font, fill=tcol, anchor="mm")


def escena_tabla(lab, diabetes, titulo, sub, dur_llenado=6.0):
    paneles = [("MUJER", False, False), ("MUJER", False, True), ("HOMBRE", True, False), ("HOMBRE", True, True)]
    datos = []
    for _, hombre, fuma in paneles:
        bloque = []
        for e in range(7):
            bloque.append([[riesgo(lab, diabetes, hombre, fuma, e, 4 - r, c) for c in range(5)] for r in range(5)])
        datos.append(bloque)
    todos = [v for b in datos for g in b for fila in g for v in fila]
    conteo = [sum(1 for v in todos if categoria(v) == i) for i in range(5)]

    cw, ch = 46, 19
    gx0, gy0 = 250, 205
    gap_x, gap_y = 52, 15
    gw, gh = cw * 5, ch * 5
    f_cell = F("semi", 14)

    def render(t):
        im, d = lienzo()
        cabecera(d, titulo, sub, t)
        a = ease(prog(t, 0.2, 0.5))
        # encabezados de paneles
        for p, (sexo, hombre, fuma) in enumerate(paneles):
            x = gx0 + p * (gw + gap_x)
            texto(d, (x + gw / 2, 148), sexo, F("black", 22), BLANCO, a, "mm")
            texto(d, (x + gw / 2, 176), "Fuma" if fuma else "No fuma", F("medium", 19),
                  (255, 150, 150) if fuma else (150, 220, 170), a, "mm")
        # etiquetas de edad
        for e in range(7):
            y = gy0 + e * (gh + gap_y)
            texto(d, (gx0 - 120, y + gh / 2), EDADES[e], F("bold", 22), BLANCO, a, "rm")
            texto(d, (gx0 - 120, y + gh / 2 + 22), "años", F("regular", 14), GRIS, a, "rm")
            # etiquetas de PAS en el costado
            for r in range(5):
                texto(d, (gx0 - 8, y + r * ch + ch / 2), PAS[r], F("regular", 12), GRIS, a * 0.9, "rm")
        # ejes inferiores
        yb = gy0 + 7 * (gh + gap_y) - gap_y + 8
        etq = COL if lab else IMC
        for p in range(4):
            x = gx0 + p * (gw + gap_x)
            for c in range(5):
                texto(d, (x + c * cw + cw / 2, yb), etq[c], F("regular", 12), GRIS, a, "mt")
        texto(d, (gx0 + 2 * (gw + gap_x) - gap_x / 2, yb + 24),
              ("Colesterol total (mg/dL)" if lab else "Índice de masa corporal (kg/m²)") +
              "   ·   Filas: presión arterial sistólica (mmHg)", F("medium", 17), GRIS, a, "mt")

        # llenado: por edad, luego por panel
        def revelado_factory(p, e):
            base = 0.6 + (e * 4 + p) / 28 * dur_llenado

            def f(r, c):
                return prog(t, base + (r + c) * 0.025, 0.3)
            return f

        for p in range(4):
            x = gx0 + p * (gw + gap_x)
            for e in range(7):
                y = gy0 + e * (gh + gap_y)
                mini_grilla(d, x, y, cw, ch, datos[p][e], revelado_factory(p, e), t, f_cell)

        # panel derecho: conteo por categoría
        px = 1440
        ap = ease(prog(t, 0.4, 0.5))
        texto(d, (px, 150), "Combinaciones", F("bold", 26), BLANCO, ap)
        n_vis = 0
        for p in range(4):
            for e in range(7):
                base = 0.6 + (e * 4 + p) / 28 * dur_llenado
                if t > base + 0.3:
                    n_vis += 25
        texto(d, (px, 185), f"{n_vis} de {len(todos)}", F("black", 48), ROJO_OPS, ap)
        frac = clamp((t - 0.6) / (dur_llenado + 0.3))
        maxc = max(conteo)
        for i, (nom, rango, col, _) in enumerate(CATS):
            yy = 290 + i * 118
            texto(d, (px, yy), nom, F("bold", 24), BLANCO, ap)
            texto(d, (px + 400, yy), rango, F("regular", 18), GRIS, ap, "ra")
            n = int(round(conteo[i] * ease(frac)))
            largo = 300 * (conteo[i] / maxc) * ease(frac)
            if largo > 1:
                d.rounded_rectangle([px, yy + 36, px + largo, yy + 74], radius=8, fill=col)
            texto(d, (px + largo + 12, yy + 55), f"{n}", F("black", 26), BLANCO, ap, "lm")
            if frac >= 1:
                pct = conteo[i] / len(todos) * 100
                texto(d, (px + largo + 12 + 60, yy + 55), f"({pct:.0f}%)".replace(".", ","),
                      F("regular", 18), GRIS, ease(prog(t, 0.9 + dur_llenado, 0.5)), "lm")
        # rango de valores
        ar = ease(prog(t, dur_llenado + 1.0, 0.6))
        texto(d, (px, 900), f"Mínimo {min(todos)}%  ·  Máximo {max(todos)}%", F("bold", 22), BLANCO, ar)
        return im

    return render


def escena_resumen(t):
    im, d = lienzo()
    cabecera(d, "1.400 resultados numéricos posibles", "Distribución por categoría en cada tabla (más los 2 resultados directos del flujo)", t)
    bloques = [
        ("Sin laboratorio (IMC)", False, False),
        ("Con laboratorio (colesterol)", True, False),
    ]
    x0, x1 = 520, 1780
    for b, (nom, lab, dm) in enumerate(bloques):
        vals = [riesgo(lab, dm, h, f, e, s, c) for h in (0, 1) for f in (0, 1)
                for e in range(7) for s in range(5) for c in range(5)]
        cont = [sum(1 for v in vals if categoria(v) == i) for i in range(5)]
        y = 270 + b * 250
        a = ease(prog(t, 0.3 + b * 0.5, 0.5))
        texto(d, (x0 - 30, y + 45), nom, F("bold", 28), BLANCO, a, "rm")
        texto(d, (x0 - 30, y + 82), "700 combinaciones", F("regular", 18), GRIS, a, "rm")
        k = ease(prog(t, 0.5 + b * 0.5, 1.3))
        x = x0
        for i, n in enumerate(cont):
            w = (x1 - x0) * n / 700 * k
            if w > 0:
                d.rectangle([x, y + 20, x + w, y + 110], fill=CATS[i][2])
                if w > 70 and k > 0.9:
                    texto(d, (x + w / 2, y + 65), f"{n / 7:.0f}%".replace(".", ","), F("black", 26),
                          CATS[i][3], ease(prog(t, 1.6 + b * 0.5, 0.4)), "mm")
            x += w
    al = ease(prog(t, 2.6, 0.5))
    for i, (nom, rango, col, _) in enumerate(CATS):
        xx = 330 + i * 300
        d.rectangle([xx, 905, xx + 30, 935], fill=mezcla(BG, col, al))
        texto(d, (xx + 42, 920), f"{nom}  {rango}", F("medium", 20), BLANCO, al, "lm")
    ad = ease(prog(t, 3.0, 0.5))
    caja(d, 520, 720, 560, 110, "Antecedente de ECV\n→ PACIENTE DE MUY ALTO RIESGO", CATS[3][2],
         mezcla((20, 20, 30), CATS[3][2], 0.25), ad, F("bold", 24))
    caja(d, 1220, 720, 560, 110, "ERC o diabetes\n→ PACIENTE DE ALTO RIESGO", CATS[2][2],
         mezcla((20, 20, 30), CATS[2][2], 0.25), ad, F("bold", 24))
    return im


def escena_cierre(t):
    im, d = lienzo()
    a1 = ease(prog(t, 0.2, 0.6))
    texto(d, (W / 2, 330), "Estimá el riesgo de cada paciente", F("black", 64), BLANCO, a1, "mm")
    a2 = ease(prog(t, 0.8, 0.6))
    texto(d, (W / 2, 430), "y seguí la vía clínica HEARTS según la categoría", F("medium", 30), GRIS, a2, "mm")
    a3 = ease(prog(t, 1.4, 0.6))
    texto(d, (W / 2, 720),
          "Fuente: Calculadora de riesgo cardiovascular HEARTS, OPS (paho.org/cardioapp), configurada para Argentina.\n"
          "Tablas: WHO CVD Risk Chart Working Group. Lancet Glob Health 2019;7(10):e1332-e1345.\n"
          "Valores enteros tal como los devuelve la app. Edad 40–74 años (la app acepta hasta 75).",
          F("regular", 22), GRIS, a3, "mm", align="center", spacing=12)
    return im


ESCENAS = [
    (escena_titulo, 3.5),
    (escena_flujo, 7.5),
    (escena_tabla(False, False, "Tabla sin laboratorio",
                  "Cuando no se conoce el colesterol: sexo, edad, tabaco, presión sistólica e IMC"), 10.0),
    (escena_tabla(True, False, "Tabla con laboratorio · sin diabetes",
                  "Con colesterol total conocido: sexo, edad, tabaco, presión sistólica y colesterol"), 10.0),
    (escena_resumen, 6.5),
    (escena_cierre, 5.0),
]
FUNDIDO = 0.4


def main():
    tmp = tempfile.mkdtemp(prefix="hearts_")
    n = 0
    for fn, dur in ESCENAS:
        for i in range(int(dur * FPS)):
            t = i / FPS
            im = fn(t)
            fade = min(1.0, t / FUNDIDO, (dur - t) / FUNDIDO)
            if fade < 1:
                im = Image.blend(Image.new("RGB", (W, H), BG), im, clamp(fade))
            im.save(os.path.join(tmp, f"f{n:05d}.png"))
            n += 1
    print(n, "cuadros")
    mp4 = os.path.join(AQUI, "hearts_todos_los_resultados.mp4")
    gif = os.path.join(AQUI, "hearts_todos_los_resultados.gif")
    entrada = ["-framerate", str(FPS), "-i", os.path.join(tmp, "f%05d.png")]
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *entrada, "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", mp4], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *entrada,
                    "-vf", "fps=12,scale=1280:-1:flags=lanczos,split[a][b];"
                           "[a]palettegen=max_colors=96:stats_mode=diff[p];"
                           "[b][p]paletteuse=dither=none:diff_mode=rectangle",
                    "-loop", "0", gif], check=True)
    shutil.rmtree(tmp)
    for p in (mp4, gif):
        print(p, f"{os.path.getsize(p) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
