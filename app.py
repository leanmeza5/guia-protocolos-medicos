"""
app.py — Guía Universal de Protocolos Médicos (servidor web).

Lee exclusivamente de protocolos.db (generada por recolector.py); nunca abre los PDFs.
Sirve una API JSON y la interfaz web de la carpeta static/.

Uso:
    python app.py            # abre en http://localhost:8501

En un servidor (Render, etc.) se configuran HOST=0.0.0.0 y PORT por variables de entorno.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "protocolos.db"
STATIC_DIR = BASE_DIR / "static"
HOST = os.environ.get("HOST", "127.0.0.1")
PUERTO = int(os.environ.get("PORT", "8501"))
MAX_RESULTADOS = 40

app = FastAPI(title="Guía Universal de Protocolos Médicos", docs_url=None, redoc_url=None)
_local = threading.local()


def db() -> sqlite3.Connection:
    """Una conexión de solo lectura por hilo."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        if not DB_PATH.exists():
            raise HTTPException(503, "No existe protocolos.db. Ejecutá primero: python recolector.py")
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        _local.conn = conn
    return conn


def filas(sql: str, params: tuple | list = ()) -> list[dict]:
    return [dict(r) for r in db().execute(sql, params).fetchall()]


def a_consulta_fts(texto: str) -> str | None:
    """Convierte lo que escribe el usuario en una consulta FTS5 segura.
    Cada palabra se busca como prefijo ("hipert" encuentra "hipertensión") y todas
    deben aparecer (AND). Frases entre comillas se buscan exactas."""
    partes = []
    for frase, palabra in re.findall(r'"([^"]+)"|(\S+)', texto):
        if frase:
            limpia = " ".join(re.findall(r"\w+", frase))
            if limpia:
                partes.append(f'"{limpia}"')
        else:
            partes += [f'"{w}"*' for w in re.findall(r"\w+", palabra)]
    return " AND ".join(partes) or None


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #

@app.get("/api/inicio")
def inicio():
    guias = filas(
        "SELECT g.id, g.titulo, g.tema, g.fecha, g.paginas, g.url, "
        "  (SELECT COUNT(*) FROM parrafos p WHERE p.guia_id = g.id) AS parrafos, "
        "  (SELECT COUNT(*) FROM esquemas e WHERE e.guia_id = g.id) AS esquemas "
        "FROM guias g ORDER BY g.titulo"
    )
    fichas = {r["guia_id"]: json.loads(r["datos"]) for r in filas("SELECT guia_id, datos FROM fichas")}
    for g in guias:
        f = fichas.get(g["id"])
        g["ficha"] = None if f is None else {
            k: f.get(k) for k in ("titulo_corto", "subtitulo", "especialidad", "resumen")
        } | {
            "algoritmos": [{"id": a["id"], "titulo": a["titulo"]} for a in f.get("algoritmos", [])],
            "n_tablas": len(f.get("tablas", [])),
            "n_calculadoras": len(f.get("calculadoras", [])),
            "farmacos": [fx["nombre"].split(" (")[0] for c in f.get("calculadoras", []) for fx in c["farmacos"]],
        }
    esquemas = filas(
        "SELECT e.guia_id, e.pagina, e.tipo, e.titulo FROM esquemas e "
        "ORDER BY CASE e.tipo WHEN 'algoritmo' THEN 0 WHEN 'tabla' THEN 1 ELSE 2 END, e.guia_id, e.pagina"
    )
    return {"guias": guias, "esquemas": esquemas}


@app.get("/api/guia/{guia_id}")
def guia(guia_id: int):
    g = filas("SELECT id, titulo, tema, fecha, paginas, url, archivo FROM guias WHERE id = ?", (guia_id,))
    if not g:
        raise HTTPException(404, "Guía no encontrada")
    ficha = db().execute("SELECT datos FROM fichas WHERE guia_id = ?", (guia_id,)).fetchone()
    return {
        **g[0],
        "ficha": json.loads(ficha["datos"]) if ficha else None,
        "esquemas": filas("SELECT pagina, tipo, titulo FROM esquemas WHERE guia_id = ? ORDER BY pagina", (guia_id,)),
    }


@app.get("/api/guia/{guia_id}/texto")
def texto_guia(guia_id: int, pagina: Optional[int] = None):
    sql = "SELECT pagina, seccion, texto FROM parrafos WHERE guia_id = ?"
    params: list = [guia_id]
    if pagina is not None:
        sql += " AND pagina = ?"
        params.append(pagina)
    return filas(sql + " ORDER BY pagina, orden", params)


@app.get("/api/pagina/{guia_id}/{pagina}.jpg")
def imagen_pagina(guia_id: int, pagina: int):
    r = db().execute("SELECT imagen FROM paginas WHERE guia_id = ? AND pagina = ?", (guia_id, pagina)).fetchone()
    if not r:
        raise HTTPException(404, "Página no encontrada")
    return Response(r["imagen"], media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/buscar")
def buscar(q: str = Query("", max_length=200), guia: Optional[int] = None):
    consulta = a_consulta_fts(q.strip())
    if not consulta:
        return {"protocolos": [], "parrafos": [], "facetas": []}
    filtro, extra = ("AND g.id = ?", [guia]) if guia else ("", [])

    protocolos = filas(
        "SELECT g.id AS guia_id, g.titulo AS guia, i.tipo, i.ancla, i.titulo, i.pagina, "
        "  snippet(ficha_items_fts, 1, '\x02', '\x03', ' … ', 24) AS fragmento "
        "FROM ficha_items_fts JOIN ficha_items i ON i.id = ficha_items_fts.rowid "
        "JOIN guias g ON g.id = i.guia_id "
        f"WHERE ficha_items_fts MATCH ? {filtro} "
        "ORDER BY bm25(ficha_items_fts, 4.0, 1.0) LIMIT 8",
        [consulta, *extra],
    )
    parrafos = filas(
        "SELECT g.id AS guia_id, g.titulo AS guia, p.pagina, p.seccion, "
        "  snippet(parrafos_fts, 0, '\x02', '\x03', ' … ', 48) AS fragmento "
        "FROM parrafos_fts JOIN parrafos p ON p.id = parrafos_fts.rowid "
        "JOIN guias g ON g.id = p.guia_id "
        f"WHERE parrafos_fts MATCH ? {filtro} "
        "ORDER BY bm25(parrafos_fts) LIMIT ?",
        [consulta, *extra, MAX_RESULTADOS],
    )
    facetas = filas(
        "SELECT g.id AS guia_id, g.titulo AS guia, COUNT(*) AS n "
        "FROM parrafos_fts JOIN parrafos p ON p.id = parrafos_fts.rowid "
        "JOIN guias g ON g.id = p.guia_id WHERE parrafos_fts MATCH ? "
        "GROUP BY g.id ORDER BY n DESC",
        [consulta],
    )
    return {"protocolos": protocolos, "parrafos": parrafos, "facetas": facetas}


# --------------------------------------------------------------------------- #
# Interfaz
# --------------------------------------------------------------------------- #

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})


if __name__ == "__main__":
    print(f"Guía de Protocolos → http://localhost:{PUERTO}")
    uvicorn.run(app, host=HOST, port=PUERTO, log_level="warning")
