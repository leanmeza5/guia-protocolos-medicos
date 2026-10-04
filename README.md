# Guía Universal de Protocolos Médicos

Web de consulta rápida sobre las guías de práctica clínica del Ministerio de Salud de la Nación (Argentina): algoritmos interactivos, tablas de dosis, calculadoras por peso y búsqueda instantánea en el texto de las guías. Cada dato enlaza a la página del PDF original.

> **Herramienta de consulta.** No reemplaza el juicio clínico. Las fichas de `protocolos/` son resúmenes transcriptos de las guías oficiales; verificá siempre en el documento fuente.

## Cómo funciona

1. **`recolector.py`** lee el [Banco de recursos de salud](https://www.argentina.gob.ar/salud/recursos), descarga guías en PDF y guarda todo en `protocolos.db` (SQLite):
   - párrafos con su página y sección, indexados con búsqueda de texto completo (FTS5, sin distinguir tildes ni mayúsculas);
   - una imagen de cada página para el visor;
   - las páginas con algoritmos, tablas y figuras, detectadas automáticamente;
   - las fichas de protocolo curadas de `protocolos/*.json`.
2. **`app.py`** es un servidor FastAPI que lee **solo** de `protocolos.db` y sirve la interfaz web de `static/`.

## Instalación

Requiere Python 3.9 o superior.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Uso

```bash
.venv/bin/python recolector.py      # descarga e indexa 3 guías
.venv/bin/python app.py             # abre http://localhost:8501
```

Opciones del recolector:

| Opción | Efecto |
| --- | --- |
| `--max 10` | descarga más guías |
| `--buscar diabetes` | solo guías con esa palabra en el título |
| `--reset` | borra la base y la reconstruye |
| `--solo-fichas` | recarga solo `protocolos/*.json` (después de editar una ficha) |

## Fichas de protocolo

Cada archivo de `protocolos/` describe una guía (se vincula por el nombre del PDF en `archivo`) con:

- `claves`: puntos clave;
- `algoritmos`: nodos `inicio`, `decision`, `accion`, `resultado` o `alerta`, unidos por `siguiente` u `opciones`;
- `tablas`: columnas, filas y notas;
- `listas`: recomendaciones agrupadas (`estilo`: `alerta`, `exito`, `info`, `precaucion`, `neutro`);
- `calculadoras`: dosis en mg/kg/día por grupo de edad o de peso, con máximo diario y número de tomas.

Todo elemento lleva `pagina`, que la interfaz muestra como enlace a la página original.

Fichas incluidas: Hipertensión arterial (2026), Coqueluche (2025) y Chagas.

## Estructura

```
recolector.py      descarga, extracción e indexación
app.py             API y servidor web
static/            interfaz (HTML, CSS, JS)
protocolos/        fichas de protocolo curadas (JSON)
requirements.txt
```

Los PDFs y la base de datos no se incluyen en el repositorio: se generan al ejecutar `recolector.py`.
