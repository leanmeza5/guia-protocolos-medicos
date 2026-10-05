# Protocolos Clínicos · Tierra del Fuego

Web de consulta rápida sobre las guías de práctica clínica del Ministerio de Salud de la Nación (Argentina), organizada para los equipos de salud de Tierra del Fuego: algoritmos interactivos, tablas de dosis, calculadoras por peso, escalas clínicas y búsqueda instantánea en el texto de las guías. Cada dato enlaza a la página del PDF original.

> **Herramienta de consulta.** No reemplaza el juicio clínico. Las fichas de `protocolos/` son resúmenes transcriptos de las guías oficiales; verificá siempre en el documento fuente. Sitio independiente: no es un sitio oficial del Ministerio de Salud de la Nación ni del de Tierra del Fuego.

## Qué incluye

- **12 fichas rápidas**: HTA, diabetes tipo 2, EPOC estable, infecciones respiratorias bajas (NAC, EPOC reagudizada, bronquitis), coqueluche, Chagas, control prenatal (VIH, sífilis, hepatitis B, Chagas), hidatidosis, intoxicación por monóxido de carbono, ACV isquémico, hantavirus y hemorragia posparto.
- **Algoritmos** en diagrama y en modo paso a paso, con la página de origen en cada punto.
- **Escalas**: CURB-65, Findrisc, AUDIT-C, Cincinnati.
- **Calculadoras por peso**: benznidazol, nifurtimox, macrólidos y TMP-SMZ para coqueluche, albendazol, insulina NPH inicial, penicilina en el RN, rt-PA.
- **Contexto fueguino**: alerta según la temporada, datos provinciales de las guías y teléfonos de referencia, todos con su fuente.
- **Búsqueda** sin tildes ni mayúsculas, con siglas y palabras cotidianas (HTA, NAC, ACV, “presión alta”, “tos convulsa”).
- **Uso sin conexión**: lo que se consulta una vez queda disponible sin señal; se puede instalar en el celular como app.
- Otras 3 guías (asma, tabaco, riesgo de suicidio) indexadas para la búsqueda y con sus páginas, todavía sin ficha.

## Cómo funciona

1. **`recolector.py`** descarga las guías de `guias.json` desde el [Banco de recursos de salud](https://www.argentina.gob.ar/salud/recursos) y guarda todo en `protocolos.db` (SQLite): párrafos con página y sección (FTS5), una imagen de cada página, los esquemas detectados, las fichas de `protocolos/*.json` y la configuración de `protocolos/_*.json`.
2. **`app.py`** es un servidor FastAPI que lee **solo** de `protocolos.db` y sirve la interfaz de `static/`.

## Instalación y uso

Requiere Python 3.9 o superior.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python recolector.py      # descarga e indexa las guías de guias.json
.venv/bin/python app.py             # abre http://localhost:8501
```

| Opción del recolector | Efecto |
| --- | --- |
| `--max 5` | suma 5 guías elegidas del catálogo |
| `--buscar asma` | suma guías con esa palabra en el título |
| `--reset` | borra la base y la reconstruye |
| `--solo-fichas` | recarga solo `protocolos/*.json` (después de editar una ficha) |

Para sumar una guía de forma permanente, agregá su URL a `guias.json`.

## Publicar en internet (Render)

El repositorio incluye `render.yaml`. En [Render](https://render.com): **New → Blueprint**, elegí este repositorio y confirmá. Al construir, Render ejecuta `recolector.py` y después levanta `app.py`. En el plan gratuito el servicio se suspende tras 15 minutos sin visitas; la primera carga posterior tarda alrededor de un minuto.

## Fichas de protocolo (`protocolos/*.json`)

Cada ficha se vincula a una guía por el nombre del PDF (`archivo`) y puede tener:

- `categorias`: `guardia`, `cronicos`, `infecciones`, `embarazo` (filtros del inicio), y `anio` de edición (las anteriores a 2018 muestran un aviso).
- `claves`: puntos clave.
- `algoritmos`: nodos `inicio`, `decision`, `accion`, `resultado` o `alerta`, unidos por `siguiente` u `opciones`.
- `tablas`: columnas, filas y notas.
- `listas`: recomendaciones agrupadas (`estilo`: `alerta`, `exito`, `info`, `precaucion`, `neutro`). Las de estilo `alerta` se muestran primero.
- `escalas`: preguntas con opciones y puntos, e interpretación por rango.
- `calculadoras`: dosis por kilo por grupo de edad o de peso, con `max`, `tomas`, `por` (`dia` o `dosis`) y `unidad` (`mg` o `UI`).

Todo elemento lleva `pagina`, que la interfaz muestra como enlace a la página original.

Archivos de configuración:

- `protocolos/_region.json`: textos regionales, alertas por temporada, contexto y contactos (cada dato con `archivo` y `pagina` de origen).
- `protocolos/_sinonimos.json`: grupos de siglas y sinónimos para la búsqueda.

## Estructura

```
recolector.py      descarga, extracción e indexación
app.py             API y servidor web
guias.json         guías que se descargan siempre
static/            interfaz (HTML, CSS, JS, service worker)
protocolos/        fichas curadas y configuración regional (JSON)
requirements.txt
render.yaml
```

Los PDFs y la base de datos no se incluyen en el repositorio: se generan al ejecutar `recolector.py`.
