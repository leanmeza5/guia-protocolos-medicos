"""Genera un GIF animado (y un MP4) con la estadística de hipertensión arterial
en Tierra del Fuego.

Fuentes:
  - 4° Encuesta Nacional de Factores de Riesgo (ENFR 2018), INDEC / Secretaría
    de Gobierno de Salud. Resultados definitivos (2019), cuadros 8.1, 8.3, 8.5,
    8.8 y texto del capítulo 8. Es la última ENFR publicada: la 5° edición
    (prevista para 2024) no se realizó.
  - Boletín Anual de Estadísticas Vitales 2023, Ministerio de Salud de Tierra
    del Fuego (publicado en 2025), tabla de causas de defunción.

Uso:  python generar_gif.py   (requiere Pillow y ffmpeg en el PATH)
"""

import math
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

# --------------------------------------------------------------------------
# Datos (copiados de las fuentes; % de población de 18 años y más)
# --------------------------------------------------------------------------
ANIOS = [2005, 2009, 2013, 2018]
HTA_AUTORREPORTE_TDF = [35.9, 31.7, 28.2, 33.9]   # Cuadro 8.3
HTA_AUTORREPORTE_PAIS = [34.5, 34.6, 34.1, 34.7]  # Cuadro 8.3
IC_TDF_2018 = (28.0, 39.8)

PATAGONIA_2018 = [  # Cuadro 8.3, 2018
    ("Neuquén", 39.2),
    ("Tierra del Fuego", 33.9),
    ("Santa Cruz", 33.5),
    ("Río Negro", 31.2),
    ("Chubut", 30.4),
]
PAIS_2018 = 34.7

COMBINADA_PAIS = 46.6       # Autorreporte + medicación o PA elevada medida (solo total país)
MEDICION_PAIS = 40.5        # PA >= 140/90 en la medición domiciliaria (total país)

CASCADA = [  # (indicador, TDF, país) - 2018
    ("Se midió la presión\nen los últimos 2 años", 82.5, 84.3),          # Cuadro 8.1
    ("Hipertensos que hacen\nalgún tratamiento", 47.9, 53.4),            # Cuadro 8.5
    ("Hipertensos con controles\nmédicos habituales", 38.4, 42.1),       # Cuadro 8.8
]

MUERTES_CIRCULATORIAS_2023 = 122   # 19,9% del total de defunciones
PCT_CIRCULATORIAS_2023 = 19.9
MUERTES_HIPERTENSIVAS_2023 = 17    # I10-I15

# --------------------------------------------------------------------------
# Estética
# --------------------------------------------------------------------------
W = H = 720
SS = 2                     # supermuestreo para bordes suaves
FPS = 15
BG_TOP = (9, 14, 30)
BG_BOT = (20, 12, 38)
ROJO = (255, 59, 92)
ROJO_OSC = (120, 30, 55)
CIAN = (56, 189, 248)
BLANCO = (245, 247, 252)
GRIS = (148, 158, 182)
GRIS_OSC = (52, 60, 84)
AMARILLO = (255, 200, 87)


def _fuente(nombres, tam):
    rutas = [
        "/usr/share/fonts/opentype/inter/",
        "/usr/share/fonts/truetype/dejavu/",
    ]
    for nombre in nombres:
        for r in rutas:
            p = os.path.join(r, nombre)
            if os.path.exists(p):
                return ImageFont.truetype(p, tam * SS)
    return ImageFont.load_default()


def F(peso, tam):
    tabla = {
        "black": ["InterDisplay-Black.otf", "Inter-Black.otf", "DejaVuSans-Bold.ttf"],
        "bold": ["Inter-Bold.otf", "DejaVuSans-Bold.ttf"],
        "medium": ["Inter-Medium.otf", "DejaVuSans.ttf"],
        "regular": ["Inter-Regular.otf", "DejaVuSans.ttf"],
    }
    return _fuente(tabla[peso], tam)


# --------------------------------------------------------------------------
# Utilidades de animación
# --------------------------------------------------------------------------
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease_out(t):
    t = clamp(t)
    return 1 - (1 - t) ** 3


def ease_in_out(t):
    t = clamp(t)
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def ease_back(t):
    t = clamp(t)
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def prog(t, ini, dur):
    return clamp((t - ini) / dur)


def mezclar(c1, c2, a):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * a) for i in range(3))


def fmt(v, dec=1):
    return f"{v:.{dec}f}".replace(".", ",")


class Lienzo:
    """Envoltorio que trabaja en coordenadas de 720 px y dibuja en 2x."""

    def __init__(self):
        self.img = Image.new("RGB", (W * SS, H * SS))
        self.d = ImageDraw.Draw(self.img)
        self._fondo()

    _cache = None

    def _fondo(self):
        if Lienzo._cache is None:
            for y in range(H * SS):
                a = y / (H * SS)
                self.d.line([(0, y), (W * SS, y)], fill=mezclar(BG_TOP, BG_BOT, a))
            Lienzo._cache = self.img.copy()
        else:
            self.img.paste(Lienzo._cache)

    def s(self, *v):
        return [x * SS for x in v]

    def texto(self, xy, txt, fuente, color=BLANCO, alpha=1.0, anchor="la", spacing=6):
        if alpha <= 0:
            return
        col = mezclar(BG_TOP, color, clamp(alpha))
        self.d.multiline_text(self.s(*xy), txt, font=fuente, fill=col,
                              anchor=anchor, spacing=spacing * SS,
                              align="center" if anchor[0] == "m" else "left")

    def rect(self, x0, y0, x1, y1, color, r=0):
        if x1 <= x0 or y1 <= y0:
            return
        r = min(r, (x1 - x0) / 2, (y1 - y0) / 2)
        self.d.rounded_rectangle(self.s(x0, y0, x1, y1), radius=r * SS, fill=color)

    def circulo(self, cx, cy, r, color, borde=None, ancho=0):
        self.d.ellipse(self.s(cx - r, cy - r, cx + r, cy + r), fill=color,
                       outline=borde, width=int(ancho * SS))

    def linea(self, pts, color, ancho=3):
        if len(pts) < 2:
            return
        self.d.line([(x * SS, y * SS) for x, y in pts], fill=color,
                    width=int(ancho * SS), joint="curve")

    def resultado(self, fade=1.0):
        im = self.img.resize((W, H), Image.LANCZOS)
        if fade < 1.0:
            negro = Image.new("RGB", (W, H), BG_TOP)
            im = Image.blend(negro, im, clamp(fade))
        return im


def ecg(x, base, amp):
    """Forma de un latido (onda P-QRS-T) en un período de 0..1."""
    p = x % 1.0
    if 0.10 < p < 0.18:
        return base - amp * 0.12 * math.sin((p - 0.10) / 0.08 * math.pi)
    if 0.24 < p < 0.27:
        return base + amp * 0.15 * ((p - 0.24) / 0.03)
    if 0.27 <= p < 0.31:
        return base + amp * 0.15 - amp * 1.15 * ((p - 0.27) / 0.04)
    if 0.31 <= p < 0.35:
        return base - amp + amp * 1.35 * ((p - 0.31) / 0.04)
    if 0.35 <= p < 0.38:
        return base + amp * 0.35 - amp * 0.35 * ((p - 0.35) / 0.03)
    if 0.50 < p < 0.64:
        return base - amp * 0.22 * math.sin((p - 0.50) / 0.14 * math.pi)
    return base


def cabecera(c, etiqueta, t):
    a = ease_out(prog(t, 0, 0.5))
    c.rect(40, 40, 40 + 6, 74, ROJO)
    c.texto((58, 41), etiqueta.upper(), F("bold", 15), GRIS, a)
    c.texto((58, 60), "Tierra del Fuego · Hipertensión arterial", F("regular", 12), GRIS_OSC, a)


def pie(c, txt, t):
    c.texto((W / 2, H - 34), txt, F("regular", 12), GRIS, ease_out(prog(t, 0.6, 0.6)), anchor="ms")


# --------------------------------------------------------------------------
# Escenas: cada una recibe (lienzo, t en segundos dentro de la escena)
# --------------------------------------------------------------------------
def escena_intro(c, t):
    # trazo de ECG que recorre la pantalla
    avance = ease_in_out(prog(t, 0, 2.2))
    xmax = 40 + (W - 80) * avance
    pts = []
    x = 40.0
    while x <= xmax:
        pts.append((x, ecg((x - 40) / 210, 470, 70)))
        x += 1.5
    c.linea(pts, ROJO, 4)
    if pts:
        cx, cy = pts[-1]
        c.circulo(cx, cy, 9, BLANCO)
        c.circulo(cx, cy, 16, None, ROJO, 2)

    a1 = ease_out(prog(t, 0.4, 0.8))
    c.texto((W / 2, 180 + 20 * (1 - a1)), "HIPERTENSIÓN", F("black", 66), BLANCO, a1, anchor="mm")
    c.texto((W / 2, 245 + 20 * (1 - a1)), "ARTERIAL", F("black", 66), ROJO, a1, anchor="mm")
    a2 = ease_out(prog(t, 1.1, 0.8))
    c.texto((W / 2, 320), "en Tierra del Fuego", F("medium", 30), BLANCO, a2, anchor="mm")
    a3 = ease_out(prog(t, 1.8, 0.8))
    c.texto((W / 2, 600), "Lo que dicen los datos oficiales más recientes", F("regular", 18), GRIS, a3, anchor="mm")
    c.texto((W / 2, 630), "ENFR 2018 (INDEC – Salud) · Estadísticas Vitales TDF 2023", F("regular", 14), GRIS, a3, anchor="mm")


def escena_numero(c, t):
    cabecera(c, "Diagnóstico conocido", t)
    v = HTA_AUTORREPORTE_TDF[-1] * ease_out(prog(t, 0.3, 1.8))
    pulso = 1 + 0.04 * math.sin(t * 7) * prog(t, 2.1, 0.3)
    tam = int(110 * pulso)
    c.texto((215, 300), fmt(v) + "%", F("black", tam), ROJO, 1, anchor="mm")
    a = ease_out(prog(t, 0.8, 0.7))
    c.texto((215, 390), "de los adultos fueguinos\nsabe que tiene la\npresión alta",
            F("medium", 22), BLANCO, a, anchor="ma")
    c.texto((215, 500), "1 de cada 3", F("black", 34), AMARILLO, ease_out(prog(t, 2.2, 0.6)), anchor="ma")

    # cuadrícula de 100 personas (10x10)
    n_on = int(round(HTA_AUTORREPORTE_TDF[-1] * ease_out(prog(t, 0.3, 1.8))))
    ox, oy, paso = 420, 170, 27
    for i in range(100):
        fila, col = divmod(i, 10)
        aparece = ease_back(prog(t, 0.02 * (fila + col) * 0.6, 0.4))
        if aparece <= 0:
            continue
        cx, cy = ox + col * paso + 10, oy + fila * paso + 10
        on = i < n_on
        color = ROJO if on else GRIS_OSC
        r = 4.2 * aparece
        c.circulo(cx, cy - 5, r, color)                       # cabeza
        c.rect(cx - 5.5 * aparece, cy, cx + 5.5 * aparece, cy + 10 * aparece, color, 4)  # cuerpo
    pie(c, "Prevalencia de HTA por autorreporte, 18 años y más. ENFR 2018, Cuadro 8.3", t)


def escena_evolucion(c, t):
    cabecera(c, "Evolución 2005 – 2018", t)
    x0, x1, y0, y1 = 90, 660, 520, 160
    vmin, vmax = 20, 45

    def py(v):
        return y0 - (v - vmin) / (vmax - vmin) * (y0 - y1)

    def px(i):
        return x0 + i * (x1 - x0) / 3

    ag = ease_out(prog(t, 0, 0.6))
    for v in (20, 25, 30, 35, 40, 45):
        c.linea([(x0, py(v)), (x1, py(v))], mezclar(BG_TOP, GRIS_OSC, ag * 0.8), 1)
        c.texto((x0 - 14, py(v)), f"{v}%", F("regular", 13), GRIS, ag, anchor="rm")
    for i, an in enumerate(ANIOS):
        c.texto((px(i), y0 + 22), str(an), F("bold", 16), GRIS, ag, anchor="mt")

    # banda del intervalo de confianza 2018
    a_ic = ease_out(prog(t, 3.0, 0.6))
    if a_ic > 0:
        xi = px(3)
        c.rect(xi - 8, py(IC_TDF_2018[1]), xi + 8, py(IC_TDF_2018[0]), mezclar(BG_TOP, ROJO_OSC, a_ic), 6)

    avance = ease_in_out(prog(t, 0.5, 2.4)) * 3

    def serie(vals, color, ancho):
        pts = []
        for i in range(4):
            if i <= avance:
                pts.append((px(i), py(vals[i])))
            elif i - 1 < avance:
                f = avance - (i - 1)
                pa, pb = (px(i - 1), py(vals[i - 1])), (px(i), py(vals[i]))
                pts.append((pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f))
        c.linea(pts, color, ancho)
        for i in range(4):
            if i <= avance:
                k = ease_back(prog(avance, i - 0.3, 0.3))
                c.circulo(px(i), py(vals[i]), 8 * k, color)
                c.circulo(px(i), py(vals[i]), 3.5 * k, BG_TOP)
        return pts

    serie(HTA_AUTORREPORTE_PAIS, CIAN, 4)
    serie(HTA_AUTORREPORTE_TDF, ROJO, 5)

    for i in range(4):
        a = ease_out(prog(avance, i - 0.15, 0.3))
        tdf, pais = HTA_AUTORREPORTE_TDF[i], HTA_AUTORREPORTE_PAIS[i]
        arriba_tdf = tdf > pais
        c.texto((px(i), py(tdf) + (-18 if arriba_tdf else 20)), fmt(tdf), F("bold", 16), ROJO, a, anchor="mm")
        c.texto((px(i), py(pais) + (20 if arriba_tdf else -18)), fmt(pais), F("bold", 14), CIAN, a, anchor="mm")

    al = ease_out(prog(t, 0.2, 0.5))
    c.circulo(108, 120, 7, ROJO)
    c.texto((122, 120), "Tierra del Fuego", F("bold", 16), BLANCO, al, anchor="lm")
    c.circulo(300, 120, 7, CIAN)
    c.texto((314, 120), "Total país", F("bold", 16), BLANCO, al, anchor="lm")

    a_n = ease_out(prog(t, 3.2, 0.6))
    c.texto((W / 2, 600), "Bajó hasta 2013 y volvió a subir en 2018.\nLa banda marca el margen de error de la muestra.",
            F("medium", 17), BLANCO, a_n, anchor="ma")
    pie(c, "HTA por autorreporte (%). ENFR 2005-2018, Cuadro 8.3", t)


def escena_patagonia(c, t):
    cabecera(c, "Comparación patagónica 2018", t)
    x0, xmax_px, vmax = 250, 640, 45
    # línea del promedio nacional
    a = ease_out(prog(t, 0.1, 0.8))
    xp = x0 + (xmax_px - x0) * (PAIS_2018 / vmax)
    alto = 170 + 66 * len(PATAGONIA_2018) - 14
    yy = 156
    while yy < alto * a + 156 * (1 - a):
        c.linea([(xp, yy), (xp, min(yy + 8, alto))], CIAN, 3)
        yy += 14
    c.texto((xp, 148), f"País {fmt(PAIS_2018)}%", F("bold", 15), CIAN, a, anchor="ms")
    filas = PATAGONIA_2018
    y = 170
    for idx, (prov, val) in enumerate(filas):
        k = ease_out(prog(t, 0.2 + idx * 0.18, 1.2))
        es_tdf = prov == "Tierra del Fuego"
        color = ROJO if es_tdf else mezclar(GRIS_OSC, GRIS, 0.35)
        c.texto((x0 - 16, y + 22), prov, F("bold" if es_tdf else "medium", 19),
                BLANCO if es_tdf else GRIS, k, anchor="rm")
        largo = (xmax_px - x0) * (val / vmax) * k
        c.rect(x0, y, x0 + largo, y + 44, color, 10)
        if k > 0.05:
            c.texto((x0 + largo - 12, y + 22), fmt(val * k) + "%", F("black", 20),
                    BLANCO, k, anchor="rm")
        y += 66
    a2 = ease_out(prog(t, 2.2, 0.6))
    c.texto((W / 2, 545), "Tierra del Fuego está en línea\ncon el promedio nacional",
            F("medium", 19), BLANCO, a2, anchor="ma")
    pie(c, "HTA por autorreporte (%). ENFR 2018, Cuadro 8.3", t)


def escena_iceberg(c, t):
    cabecera(c, "Lo que no se ve · Total país", t)
    # agua
    nivel = 330
    a = ease_out(prog(t, 0, 0.6))
    c.rect(0, nivel, W, H, mezclar(BG_BOT, (14, 40, 78), a * 0.85))
    c.linea([(0, nivel), (W, nivel)], mezclar(BG_TOP, CIAN, a), 2)

    # punta (lo que se sabe) y masa sumergida (lo real)
    k1 = ease_back(prog(t, 0.3, 0.8))
    k2 = ease_out(prog(t, 1.3, 1.2))
    cx = 250
    if k1 > 0:
        alto = 150 * k1
        c.d.polygon([(x * SS, y * SS) for x, y in [(cx - 120, nivel), (cx - 30, nivel - alto),
                                                    (cx + 20, nivel - alto * 0.85), (cx + 120, nivel)]],
                    fill=BLANCO)
    if k2 > 0:
        prof = 260 * k2
        c.d.polygon([(x * SS, y * SS) for x, y in [(cx - 120, nivel), (cx + 120, nivel),
                                                    (cx + 170, nivel + prof * 0.55), (cx + 60, nivel + prof),
                                                    (cx - 90, nivel + prof * 0.9), (cx - 175, nivel + prof * 0.45)]],
                    fill=mezclar((14, 40, 78), (120, 190, 235), 0.55))

    a1 = ease_out(prog(t, 0.8, 0.6))
    c.texto((430, 200), fmt(PAIS_2018) + "%", F("black", 58), BLANCO, a1, anchor="lm")
    c.texto((432, 250), "sabe que es hipertenso\n(autorreporte)", F("medium", 17), GRIS, a1)
    a2 = ease_out(prog(t, 1.9, 0.6))
    c.texto((430, 430), fmt(COMBINADA_PAIS) + "%", F("black", 66), ROJO, a2, anchor="lm")
    c.texto((432, 485), "es hipertenso al sumar\nla medición de presión", F("medium", 17), BLANCO, a2)
    a3 = ease_out(prog(t, 2.8, 0.6))
    c.texto((W / 2, 610), "Casi 1 de cada 2 adultos. Muchos no lo saben.", F("bold", 20), AMARILLO, a3, anchor="mm")
    pie(c, "Total país (la ENFR no publica la prevalencia combinada por provincia). ENFR 2018", t)


def escena_cascada(c, t):
    cabecera(c, "Control y tratamiento 2018", t)
    y = 140
    for idx, (nombre, tdf, pais) in enumerate(CASCADA):
        k = ease_out(prog(t, 0.2 + idx * 0.45, 1.1))
        a = ease_out(prog(t, idx * 0.45, 0.5))
        c.texto((60, y), nombre, F("bold", 18), BLANCO, a)
        bx0, bx1 = 60, 560
        yb = y + 56
        c.rect(bx0, yb, bx1, yb + 30, mezclar(BG_TOP, GRIS_OSC, 0.6 * a), 8)
        c.rect(bx0, yb, bx0 + (bx1 - bx0) * tdf / 100 * k, yb + 30, ROJO, 8)
        c.texto((bx1 + 14, yb + 15), fmt(tdf * k) + "%", F("black", 24), ROJO, a, anchor="lm")
        yb2 = yb + 40
        c.rect(bx0, yb2, bx0 + (bx1 - bx0) * pais / 100 * k, yb2 + 12, CIAN, 5)
        c.texto((bx1 + 14, yb2 + 6), f"País {fmt(pais)}%", F("medium", 14), CIAN, a, anchor="lm")
        y += 140
    a = ease_out(prog(t, 2.6, 0.6))
    c.texto((W / 2, 585), "Menos de la mitad de los hipertensos\nfueguinos está en tratamiento",
            F("bold", 21), AMARILLO, a, anchor="ma")
    pie(c, "ENFR 2018, Cuadros 8.1, 8.5 y 8.8. Población de 18 años y más", t)


def escena_mortalidad(c, t):
    cabecera(c, "Mortalidad 2023", t)
    # anillo: 19,9% de las muertes
    cx, cy, r = 230, 330, 140
    k = ease_in_out(prog(t, 0.3, 1.6))
    bbox = c.s(cx - r, cy - r, cx + r, cy + r)
    c.d.arc(bbox, 0, 360, fill=GRIS_OSC, width=30 * SS)
    if k > 0:
        c.d.arc(bbox, -90, -90 + 360 * PCT_CIRCULATORIAS_2023 / 100 * k, fill=ROJO, width=30 * SS)
    c.texto((cx, cy - 8), fmt(PCT_CIRCULATORIAS_2023 * k) + "%", F("black", 50), BLANCO, 1, anchor="mm")
    c.texto((cx, cy + 34), "de las muertes", F("medium", 16), GRIS, ease_out(prog(t, 0.6, 0.5)), anchor="mm")

    a1 = ease_out(prog(t, 1.0, 0.6))
    c.texto((420, 215), "1 de cada 5", F("black", 36), AMARILLO, a1)
    c.texto((420, 262), "muertes en la provincia\nfue por enfermedades\ncirculatorias", F("medium", 18), BLANCO, a1)
    n1 = int(MUERTES_CIRCULATORIAS_2023 * ease_out(prog(t, 1.4, 1.2)))
    a2 = ease_out(prog(t, 1.4, 0.5))
    c.texto((420, 370), f"{n1}", F("black", 44), ROJO, a2)
    c.texto((420, 420), "muertes circulatorias", F("medium", 16), GRIS, a2)
    n2 = int(MUERTES_HIPERTENSIVAS_2023 * ease_out(prog(t, 2.0, 1.0)))
    a3 = ease_out(prog(t, 2.0, 0.5))
    c.texto((420, 455), f"{n2}", F("black", 44), ROJO, a3)
    c.texto((420, 505), "certificadas como\nenfermedad hipertensiva", F("medium", 16), GRIS, a3)
    a4 = ease_out(prog(t, 2.8, 0.6))
    c.texto((W / 2, 590), "La HTA es el principal factor de riesgo de infarto y ACV",
            F("bold", 18), BLANCO, a4, anchor="mm")
    pie(c, "Boletín de Estadísticas Vitales 2023, Ministerio de Salud de Tierra del Fuego", t)


def escena_cierre(c, t):
    # latido de fondo
    pts = [(x, ecg((x + t * 260) / 240, 400, 35)) for x in range(0, W, 2)]
    c.linea(pts, mezclar(BG_TOP, ROJO_OSC, 0.9), 3)
    a1 = ease_out(prog(t, 0.1, 0.7))
    c.texto((W / 2, 170), "Medite la presión", F("black", 52), BLANCO, a1, anchor="mm")
    pul = 1 + 0.05 * abs(math.sin(t * 3.2))
    a2 = ease_back(prog(t, 0.5, 0.7))
    c.texto((W / 2, 280), "140/90", F("black", int(96 * pul)), ROJO, clamp(a2), anchor="mm")
    c.texto((W / 2, 340), "mmHg o más = presión elevada", F("medium", 18), GRIS, a1, anchor="mm")
    a3 = ease_out(prog(t, 1.2, 0.7))
    c.texto((W / 2, 455), "Pedí que te la tomen en tu CAPS o centro de salud",
            F("medium", 18), BLANCO, a3, anchor="mm")
    a4 = ease_out(prog(t, 1.8, 0.7))
    c.texto((W / 2, 560),
            "Fuentes: 4.° Encuesta Nacional de Factores de Riesgo 2018 (INDEC – Secretaría\n"
            "de Gobierno de Salud, resultados definitivos 2019) · Boletín de Estadísticas\n"
            "Vitales 2023, Ministerio de Salud de Tierra del Fuego (2025).\n"
            "La 5.° ENFR no se realizó: la de 2018 es la última con datos provinciales.",
            F("regular", 13), GRIS, a4, anchor="ma", spacing=5)


ESCENAS = [
    (escena_intro, 3.6),
    (escena_numero, 4.6),
    (escena_evolucion, 5.6),
    (escena_patagonia, 4.4),
    (escena_iceberg, 4.8),
    (escena_cascada, 4.8),
    (escena_mortalidad, 4.6),
    (escena_cierre, 5.0),
]
FUNDIDO = 0.35  # segundos de fundido de entrada/salida por escena


def main():
    aqui = os.path.dirname(os.path.abspath(__file__))
    tmp = tempfile.mkdtemp(prefix="hta_tdf_")
    n = 0
    for fn, dur in ESCENAS:
        cuadros = int(dur * FPS)
        for i in range(cuadros):
            t = i / FPS
            c = Lienzo()
            fn(c, t)
            fade = min(1.0, t / FUNDIDO, (dur - t) / FUNDIDO)
            c.resultado(fade).save(os.path.join(tmp, f"f{n:05d}.png"))
            n += 1
    print(f"{n} cuadros renderizados")

    gif = os.path.join(aqui, "hta_tierra_del_fuego.gif")
    mp4 = os.path.join(aqui, "hta_tierra_del_fuego.mp4")
    entrada = ["-framerate", str(FPS), "-i", os.path.join(tmp, "f%05d.png")]
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *entrada,
                    "-vf", "split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];"
                           "[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
                    "-loop", "0", gif], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *entrada,
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
                    "-movflags", "+faststart", mp4], check=True)
    shutil.rmtree(tmp)
    for p in (gif, mp4):
        print(p, f"{os.path.getsize(p) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
