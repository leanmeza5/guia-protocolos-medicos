"""
recolector.py — Descarga guías clínicas del Ministerio de Salud de Argentina (MSAL),
extrae su contenido y lo indexa en una base SQLite local (protocolos.db).

Por cada guía guarda:
  • párrafos con su página y sección (búsqueda de texto completo FTS5),
  • una imagen de cada página (para la vista rápida en la web),
  • las páginas con algoritmos, tablas y figuras detectadas automáticamente,
  • la ficha de protocolo curada (protocolos/*.json), si existe para esa guía.

Fuente: https://www.argentina.gob.ar/salud/recursos ("Banco de recursos de salud").
Esa página arma su tabla con JavaScript a partir de una planilla pública de Google
Sheets; el script lee la página con BeautifulSoup, detecta el id de esa planilla y
descarga el catálogo en CSV. Si eso falla, cae a buscar enlaces .pdf en el HTML.

Uso:
    python recolector.py                     # 3 guías para equipos de salud
    python recolector.py --max 10            # más guías
    python recolector.py --buscar diabetes   # filtra por palabra en el título
    python recolector.py --reset             # borra la base y la reconstruye
    python recolector.py --solo-fichas       # recarga solo protocolos/*.json
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sqlite3
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from urllib.parse import urljoin, quote

import fitz  # PyMuPDF
import requests
from bs4 import BeautifulSoup

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "protocolos.db"
PDF_DIR = BASE_DIR / "pdfs"
FICHAS_DIR = BASE_DIR / "protocolos"

MSAL_RECURSOS_URL = "https://www.argentina.gob.ar/salud/recursos"
HEADERS = {"User-Agent": "Mozilla/5.0 (GuiaProtocolos/1.0; uso academico)"}
TIMEOUT = 60
MAX_PDF_MB = 40
MIN_PARRAFO_CHARS = 40
IMG_DPI = 110


# --------------------------------------------------------------------------- #
# Base de datos
# --------------------------------------------------------------------------- #

SCHEMA = """
CREATE TABLE IF NOT EXISTS guias (
    id        INTEGER PRIMARY KEY,
    titulo    TEXT NOT NULL,
    url       TEXT NOT NULL UNIQUE,
    archivo   TEXT NOT NULL,
    tema      TEXT,
    fecha     TEXT,
    paginas   INTEGER
);

CREATE TABLE IF NOT EXISTS parrafos (
    id       INTEGER PRIMARY KEY,
    guia_id  INTEGER NOT NULL REFERENCES guias(id) ON DELETE CASCADE,
    pagina   INTEGER NOT NULL,
    orden    INTEGER NOT NULL,
    seccion  TEXT,
    texto    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parrafos_guia ON parrafos(guia_id, pagina);

CREATE TABLE IF NOT EXISTS secciones (
    guia_id  INTEGER NOT NULL REFERENCES guias(id) ON DELETE CASCADE,
    pagina   INTEGER NOT NULL,
    nivel    INTEGER NOT NULL,
    titulo   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paginas (
    guia_id  INTEGER NOT NULL REFERENCES guias(id) ON DELETE CASCADE,
    pagina   INTEGER NOT NULL,
    imagen   BLOB NOT NULL,
    PRIMARY KEY (guia_id, pagina)
);

-- Páginas con algoritmos, tablas o figuras (detección automática).
CREATE TABLE IF NOT EXISTS esquemas (
    guia_id  INTEGER NOT NULL REFERENCES guias(id) ON DELETE CASCADE,
    pagina   INTEGER NOT NULL,
    tipo     TEXT NOT NULL,
    titulo   TEXT NOT NULL
);

-- Ficha de protocolo curada (JSON) y sus piezas indexadas para búsqueda.
CREATE TABLE IF NOT EXISTS fichas (
    guia_id  INTEGER PRIMARY KEY REFERENCES guias(id) ON DELETE CASCADE,
    datos    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ficha_items (
    id       INTEGER PRIMARY KEY,
    guia_id  INTEGER NOT NULL REFERENCES guias(id) ON DELETE CASCADE,
    tipo     TEXT NOT NULL,
    ancla    TEXT NOT NULL,
    titulo   TEXT NOT NULL,
    pagina   INTEGER,
    texto    TEXT NOT NULL
);

-- Índices de texto completo; ignoran mayúsculas y tildes ("hipertension" = "Hipertensión").
CREATE VIRTUAL TABLE IF NOT EXISTS parrafos_fts USING fts5(
    texto, content='parrafos', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE IF NOT EXISTS ficha_items_fts USING fts5(
    titulo, texto, content='ficha_items', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS parrafos_ai AFTER INSERT ON parrafos BEGIN
    INSERT INTO parrafos_fts(rowid, texto) VALUES (new.id, new.texto);
END;
CREATE TRIGGER IF NOT EXISTS parrafos_ad AFTER DELETE ON parrafos BEGIN
    INSERT INTO parrafos_fts(parrafos_fts, rowid, texto) VALUES ('delete', old.id, old.texto);
END;
CREATE TRIGGER IF NOT EXISTS ficha_items_ai AFTER INSERT ON ficha_items BEGIN
    INSERT INTO ficha_items_fts(rowid, titulo, texto) VALUES (new.id, new.titulo, new.texto);
END;
CREATE TRIGGER IF NOT EXISTS ficha_items_ad AFTER DELETE ON ficha_items BEGIN
    INSERT INTO ficha_items_fts(ficha_items_fts, rowid, titulo, texto)
    VALUES ('delete', old.id, old.titulo, old.texto);
END;
"""


def abrir_db(reset: bool = False) -> sqlite3.Connection:
    if reset:
        for sufijo in ("", "-wal", "-shm"):
            Path(str(DB_PATH) + sufijo).unlink(missing_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    col_parrafos = {r[1] for r in conn.execute("PRAGMA table_info(parrafos)")}
    col_secciones = {r[1] for r in conn.execute("PRAGMA table_info(secciones)")}
    if (col_parrafos and "seccion" not in col_parrafos) or (col_secciones and "nivel" not in col_secciones):
        conn.close()
        sys.exit("La base protocolos.db es de una versión anterior. Ejecutá: python recolector.py --reset")
    conn.executescript(SCHEMA)
    return conn


# --------------------------------------------------------------------------- #
# Descubrimiento de guías en el sitio del MSAL
# --------------------------------------------------------------------------- #

def _normalizar(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def descubrir_desde_catalogo(session: requests.Session) -> list[dict]:
    """Lee la página del banco de recursos y descarga su catálogo (Google Sheets)."""
    resp = session.get(MSAL_RECURSOS_URL, timeout=TIMEOUT)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    id_spread = hoja = None
    for script in soup.find_all("script"):
        code = script.string or ""
        m_id = re.search(r'"idSpread"\s*:\s*"([\w-]+)"', code)
        if m_id:
            id_spread = m_id.group(1)
            m_hoja = re.search(r'"hojaNombre"\s*:\s*"([^"]+)"', code)
            hoja = m_hoja.group(1) if m_hoja else None
            break
    if not id_spread:
        raise RuntimeError("No se encontró la planilla del catálogo en la página.")

    csv_url = f"https://docs.google.com/spreadsheets/d/{id_spread}/gviz/tq?tqx=out:csv"
    if hoja:
        csv_url += f"&sheet={quote(hoja)}"
    print(f"  Catálogo detectado: planilla {id_spread} / hoja '{hoja}'")

    r = session.get(csv_url, timeout=TIMEOUT)
    r.raise_for_status()
    r.encoding = "utf-8"
    filas = list(csv.reader(io.StringIO(r.text)))
    if not filas:
        return []

    # Los encabezados vienen como "titulo Título", "filtro-tema Tema", etc.
    encabezado = [_normalizar(h) for h in filas[0]]

    def col(*claves: str) -> int | None:
        for i, h in enumerate(encabezado):
            if any(h.startswith(c) for c in claves):
                return i
        return None

    i_tit, i_tema = col("titulo"), col("filtro-tema")
    i_tipo, i_dest = col("filtro-tipo"), col("filtro-destinatario")
    i_fecha, i_url = col("fecha"), col("btn-descargar")
    if i_tit is None or i_url is None:
        raise RuntimeError("El catálogo cambió de formato (faltan columnas título/recurso).")

    def celda(fila, i):
        return fila[i].strip() if i is not None and i < len(fila) else ""

    recursos = []
    for fila in filas[1:]:
        url = celda(fila, i_url)
        if not url.lower().split("?")[0].endswith(".pdf"):
            continue
        recursos.append({
            "titulo": celda(fila, i_tit),
            "url": url,
            "tema": celda(fila, i_tema),
            "tipo": celda(fila, i_tipo),
            "destinatario": celda(fila, i_dest),
            "fecha": celda(fila, i_fecha),
        })
    return recursos


def descubrir_desde_html(session: requests.Session) -> list[dict]:
    """Respaldo: busca enlaces a PDF directamente en el HTML de la página."""
    resp = session.get(MSAL_RECURSOS_URL, timeout=TIMEOUT)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    recursos = []
    for a in soup.find_all("a", href=True):
        url = urljoin(MSAL_RECURSOS_URL, a["href"])
        if url.lower().split("?")[0].endswith(".pdf"):
            titulo = a.get_text(" ", strip=True) or Path(url).stem
            recursos.append({"titulo": titulo, "url": url, "tema": "", "tipo": "",
                             "destinatario": "", "fecha": ""})
    return recursos


def seleccionar_guias(recursos: list[dict], buscar: str | None, maximo: int) -> list[dict]:
    """Prioriza guías clínicas dirigidas a equipos de salud."""
    vistos, candidatos = set(), []
    for r in recursos:
        if r["url"] in vistos:
            continue
        vistos.add(r["url"])
        titulo = _normalizar(r["titulo"])
        if buscar and _normalizar(buscar) not in titulo:
            continue
        puntaje = 0
        if "equipos de salud" in _normalizar(r["destinatario"]):
            puntaje += 2
        if re.search(r"\bguia|protocolo|recomendaciones|manejo|tratamiento|diagnostico", titulo):
            puntaje += 2
        if "guia" in _normalizar(r["tipo"]):
            puntaje += 1
        if puntaje >= 3 or (buscar and puntaje >= 1):
            candidatos.append((puntaje, r))
    # sort es estable: a igual puntaje se mantiene el orden del catálogo (más recientes primero)
    candidatos.sort(key=lambda x: -x[0])
    return [r for _, r in candidatos[:maximo]]


# --------------------------------------------------------------------------- #
# Descarga
# --------------------------------------------------------------------------- #

def nombre_archivo(url: str) -> str:
    nombre = Path(url.split("?")[0]).name
    return re.sub(r"[^\w.\-]", "_", nombre) or "guia.pdf"


def descargar_pdf(session: requests.Session, url: str) -> Path | None:
    PDF_DIR.mkdir(exist_ok=True)
    destino = PDF_DIR / nombre_archivo(url)
    if destino.exists() and destino.stat().st_size > 0:
        print(f"  Ya descargado: {destino.name}")
        return destino

    limite = MAX_PDF_MB * 1024 * 1024
    with session.get(url, timeout=TIMEOUT, stream=True) as r:
        r.raise_for_status()
        if int(r.headers.get("Content-Length") or 0) > limite:
            print(f"  Omitido (>{MAX_PDF_MB} MB): {url}")
            return None
        tmp = destino.with_suffix(".part")
        total = 0
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 16):
                total += len(chunk)
                if total > limite:
                    break
                f.write(chunk)
    if total > limite:
        tmp.unlink(missing_ok=True)
        print(f"  Omitido (>{MAX_PDF_MB} MB): {url}")
        return None
    with open(tmp, "rb") as f:
        if f.read(5) != b"%PDF-":
            tmp.unlink(missing_ok=True)
            print(f"  Omitido (no es un PDF válido): {url}")
            return None
    tmp.rename(destino)
    print(f"  Descargado: {destino.name} ({total / 1e6:.1f} MB)")
    return destino


# --------------------------------------------------------------------------- #
# Extracción
# --------------------------------------------------------------------------- #

RE_CAPTION = re.compile(
    r"^\s*((?:figura|tabla|cuadro|algoritmo|flujograma|v[ií]a cl[ií]nica|esquema de|anexo \d+\.)[^\n]{0,90})",
    re.I | re.M,
)


def limpiar_texto(texto: str) -> str:
    texto = re.sub(r"(\w)-\n(\w)", r"\1\2", texto)  # une palabras cortadas con guion
    texto = re.sub(r"\s*\n\s*", " ", texto)
    texto = texto.replace("ﬁ", "fi").replace("ﬂ", "fl").replace("­", "")
    return re.sub(r"[ \t ]+", " ", texto).strip()


def _clave_repeticion(texto: str) -> str:
    """Normaliza un bloque para detectar encabezados/pies repetidos (ignora números)."""
    return re.sub(r"\s+", " ", re.sub(r"\d+", "", _normalizar(texto))).strip()


def _bloques(page: fitz.Page) -> list[dict]:
    """Bloques de texto con su tamaño de letra y si están en negrita."""
    salida = []
    for b in page.get_text("dict", sort=True)["blocks"]:
        if b.get("type") != 0:
            continue
        lineas, tamanos, negritas, chars = [], Counter(), 0, 0
        for ln in b["lines"]:
            partes = []
            for sp in ln["spans"]:
                t = sp["text"]
                if t.strip():
                    n = len(t.strip())
                    chars += n
                    tamanos[round(sp["size"], 1)] += n
                    if sp["flags"] & 16 or "bold" in sp["font"].lower():
                        negritas += n
                partes.append(t)
            lineas.append("".join(partes))
        texto = limpiar_texto("\n".join(lineas))
        if texto and chars:
            salida.append({
                "texto": texto,
                "tamano": tamanos.most_common(1)[0][0],
                "negrita": negritas / chars,
            })
    return salida


def extraer(pdf_path: Path) -> dict:
    """Extrae párrafos, secciones, imágenes de página y esquemas de un PDF."""
    with fitz.open(pdf_path) as doc:
        n = doc.page_count
        por_pagina = [_bloques(p) for p in doc]

        # Encabezados/pies: bloques que se repiten en muchas páginas.
        apariciones = Counter()
        for bloques in por_pagina:
            for k in {_clave_repeticion(b["texto"]) for b in bloques}:
                apariciones[k] += 1
        umbral = max(3, int(n * 0.4))
        repetidos = {k for k, c in apariciones.items() if c >= umbral and len(k) < 200}

        # Tamaño de letra del cuerpo: el más usado en todo el documento.
        tam = Counter()
        for bloques in por_pagina:
            for b in bloques:
                tam[b["tamano"]] += len(b["texto"])
        cuerpo = tam.most_common(1)[0][0] if tam else 10

        parrafos, secciones, esquemas, imagenes = [], [], [], []
        seccion_actual = None
        for num, (page, bloques) in enumerate(zip(doc, por_pagina), start=1):
            orden = 0
            primer_titulo = None
            texto_pag = page.get_text()
            # Página de índice/contenido: muchas líneas que terminan en número de página.
            es_indice = len(re.findall(r"\S.*\D\s*\d{1,3}\s*$", texto_pag, re.M)) >= 8 and \
                re.search(r"(?im)^\s*(contenido|índice|indice|sumario)\s*$", texto_pag)
            for b in bloques:
                texto = b["texto"]
                if _clave_repeticion(texto) in repetidos:
                    continue
                es_titulo = (
                    len(texto) <= 110
                    and re.search(r"[A-Za-zÁÉÍÓÚáéíóúÑñ]{3}", texto)
                    and not texto.endswith((".", ",", ";"))
                    and (b["tamano"] >= cuerpo * 1.2 or (b["negrita"] > 0.8 and b["tamano"] >= cuerpo))
                )
                if es_titulo:
                    if es_indice:
                        continue
                    seccion_actual = texto.rstrip(":")
                    nivel = 1 if b["tamano"] >= cuerpo * 1.35 else 2
                    secciones.append((num, nivel, seccion_actual))
                    primer_titulo = primer_titulo or seccion_actual
                    continue
                if len(texto) < MIN_PARRAFO_CHARS or not re.search(r"[A-Za-zÁÉÍÓÚáéíóúÑñ]{3}", texto):
                    continue  # descarta números de página, rótulos sueltos, ruido
                orden += 1
                parrafos.append((num, orden, seccion_actual, texto))

            # Detección de páginas con algoritmos, tablas o figuras.
            if 1 < num < n and not es_indice:
                capturas = list(RE_CAPTION.finditer(texto_pag))
                # Preferir "Figura/Tabla/Cuadro/Algoritmo" antes que "Anexo N."
                capturas.sort(key=lambda m: m.group(1).lower().startswith("anexo"))
                caption = capturas[0] if capturas else None
                n_dibujos = len(page.get_drawings())
                n_imgs = len(page.get_images())
                if caption or (n_imgs and len(texto_pag) < 1600) or n_dibujos >= 40:
                    titulo = limpiar_texto(caption.group(1)) if caption else (primer_titulo or seccion_actual or f"Página {num}")
                    base = _normalizar(titulo + " " + texto_pag[:400])
                    if re.search(r"algoritmo|flujograma|via clinica", base):
                        tipo = "algoritmo"
                    elif re.search(r"\btabla|\bcuadro|dosis", base) or n_dibujos >= 40:
                        tipo = "tabla"
                    else:
                        tipo = "figura"
                    esquemas.append((num, tipo, titulo[:120]))

            pix = page.get_pixmap(dpi=IMG_DPI)
            imagenes.append((num, pix.tobytes("jpeg", jpg_quality=80)))

    return {"paginas": n, "parrafos": parrafos, "secciones": secciones,
            "esquemas": esquemas, "imagenes": imagenes}


def indexar(conn: sqlite3.Connection, recurso: dict, pdf_path: Path) -> int:
    datos = extraer(pdf_path)
    if not datos["parrafos"]:
        print("  Sin texto extraíble (¿PDF escaneado?). Omitido.")
        return 0
    with conn:
        conn.execute("DELETE FROM guias WHERE url = ?", (recurso["url"],))
        cur = conn.execute(
            "INSERT INTO guias (titulo, url, archivo, tema, fecha, paginas) VALUES (?,?,?,?,?,?)",
            (recurso["titulo"], recurso["url"], pdf_path.name, recurso["tema"],
             recurso["fecha"], datos["paginas"]),
        )
        gid = cur.lastrowid
        conn.executemany("INSERT INTO parrafos (guia_id, pagina, orden, seccion, texto) VALUES (?,?,?,?,?)",
                         [(gid, *p) for p in datos["parrafos"]])
        conn.executemany("INSERT INTO secciones (guia_id, pagina, nivel, titulo) VALUES (?,?,?,?)",
                         [(gid, *s) for s in datos["secciones"]])
        conn.executemany("INSERT INTO esquemas (guia_id, pagina, tipo, titulo) VALUES (?,?,?,?)",
                         [(gid, *e) for e in datos["esquemas"]])
        conn.executemany("INSERT INTO paginas (guia_id, pagina, imagen) VALUES (?,?,?)",
                         [(gid, *i) for i in datos["imagenes"]])
    print(f"  {len(datos['parrafos'])} párrafos · {len(datos['secciones'])} secciones · "
          f"{len(datos['esquemas'])} esquemas detectados")
    return len(datos["parrafos"])


# --------------------------------------------------------------------------- #
# Fichas de protocolo curadas
# --------------------------------------------------------------------------- #

def _items_de_ficha(f: dict) -> list[tuple[str, str, str, int | None, str]]:
    """Descompone una ficha en piezas buscables: (tipo, ancla, titulo, pagina, texto)."""
    items = []
    for a in f.get("algoritmos", []):
        partes = [a.get("descripcion", "")]
        for nodo in a["nodos"]:
            partes.append(nodo["texto"])
            partes += nodo.get("detalle", [])
            partes += [o["etiqueta"] for o in nodo.get("opciones", [])]
        items.append(("algoritmo", f"alg-{a['id']}", a["titulo"], a.get("pagina"), " · ".join(p for p in partes if p)))
    for t in f.get("tablas", []):
        partes = [" | ".join(fila) for fila in t["filas"]] + t.get("notas", []) + [" ".join(t["columnas"])]
        items.append(("tabla", f"tab-{t['id']}", t["titulo"], t.get("pagina"), " · ".join(partes)))
    for li in f.get("listas", []):
        items.append(("lista", f"lis-{li['id']}", li["titulo"], li.get("pagina"), " · ".join(li["items"])))
    for c in f.get("calculadoras", []):
        nombres = " · ".join(fx["nombre"] for fx in c["farmacos"])
        items.append(("calculadora", f"calc-{c['id']}", c["titulo"], c.get("pagina"),
                      f"Calculadora de dosis por peso: {nombres}. {c.get('descripcion', '')}"))
    for k in f.get("claves", []):
        items.append(("clave", "resumen", "Puntos clave", k.get("pagina"), k["texto"]))
    return items


def cargar_fichas(conn: sqlite3.Connection) -> int:
    if not FICHAS_DIR.exists():
        return 0
    guias = {archivo: gid for gid, archivo in conn.execute("SELECT id, archivo FROM guias")}
    cargadas = 0
    with conn:
        conn.execute("DELETE FROM ficha_items")
        conn.execute("DELETE FROM fichas")
        for path in sorted(FICHAS_DIR.glob("*.json")):
            try:
                ficha = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                print(f"  Ficha inválida {path.name}: {e}")
                continue
            gid = guias.get(ficha.get("archivo"))
            if gid is None:
                continue  # la guía de esa ficha no está descargada
            conn.execute("INSERT INTO fichas (guia_id, datos) VALUES (?, ?)",
                         (gid, json.dumps(ficha, ensure_ascii=False)))
            conn.executemany(
                "INSERT INTO ficha_items (guia_id, tipo, ancla, titulo, pagina, texto) VALUES (?,?,?,?,?,?)",
                [(gid, *it) for it in _items_de_ficha(ficha)],
            )
            cargadas += 1
            print(f"  Ficha cargada: {ficha.get('titulo_corto', path.stem)}")
    return cargadas


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main() -> int:
    ap = argparse.ArgumentParser(description="Recolector de guías clínicas del MSAL")
    ap.add_argument("--max", type=int, default=3, help="cantidad de guías a descargar (default 3)")
    ap.add_argument("--buscar", help="palabra que debe aparecer en el título (ej. 'diabetes')")
    ap.add_argument("--reset", action="store_true", help="borra la base de datos antes de empezar")
    ap.add_argument("--solo-fichas", action="store_true", help="solo recarga las fichas de protocolos/*.json")
    args = ap.parse_args()

    if args.solo_fichas:
        conn = abrir_db()
        n = cargar_fichas(conn)
        conn.close()
        print(f"Listo: {n} ficha(s) cargada(s).")
        return 0

    session = requests.Session()
    session.headers.update(HEADERS)

    print(f"1) Buscando guías en {MSAL_RECURSOS_URL}")
    try:
        recursos = descubrir_desde_catalogo(session)
    except Exception as e:
        print(f"  Catálogo no disponible ({e}); buscando enlaces PDF en el HTML…")
        recursos = descubrir_desde_html(session)
    print(f"  {len(recursos)} PDFs encontrados en el sitio.")

    guias = seleccionar_guias(recursos, args.buscar, args.max)
    if not guias:
        print("No se encontraron guías que coincidan.")
        return 1

    conn = abrir_db(reset=args.reset)
    ya_indexadas = {u for (u,) in conn.execute("SELECT url FROM guias")}

    print(f"2) Procesando {len(guias)} guía(s)")
    total = 0
    for i, g in enumerate(guias, 1):
        print(f"\n[{i}/{len(guias)}] {g['titulo']}")
        if g["url"] in ya_indexadas:
            print("  Ya indexada, se omite.")
            continue
        try:
            pdf = descargar_pdf(session, g["url"])
            if pdf:
                total += indexar(conn, g, pdf)
        except Exception as e:
            print(f"  Error: {e}")

    print("\n3) Cargando fichas de protocolo")
    cargar_fichas(conn)

    with conn:
        conn.execute("INSERT INTO parrafos_fts(parrafos_fts) VALUES ('optimize')")
        conn.execute("INSERT INTO ficha_items_fts(ficha_items_fts) VALUES ('optimize')")
    n_guias, n_par = conn.execute(
        "SELECT (SELECT COUNT(*) FROM guias), (SELECT COUNT(*) FROM parrafos)").fetchone()
    conn.close()
    print(f"\nListo. Nuevos párrafos: {total}. Base: {n_guias} guías, {n_par} párrafos → {DB_PATH.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
