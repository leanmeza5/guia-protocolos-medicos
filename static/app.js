// =============================================================================
// Protocolos Clínicos — interfaz
// Lee todo de la API local (/api/*), que a su vez lee solo de protocolos.db.
// =============================================================================

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const vista = $("#vista");
const inputQ = $("#q");

const estado = {
  inicio: null,          // /api/inicio
  guias: new Map(),      // id -> /api/guia/{id}
  algo: null,            // estado del algoritmo abierto
};

// --- Utilidades --------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const resaltar = (s) => esc(s).replace(/\x02/g, "<mark>").replace(/\x03/g, "</mark>");
const ico = (id, cls = "") => `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const fmt = (n) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 });
const pag = (guiaId, n, txt) => (n ? `<button class="pag" type="button" data-guia="${guiaId}" data-pag="${n}" title="Ver página ${n} de la guía original">${txt || "pág. " + n}</button>` : "");
const ICONO_TIPO = { algoritmo: "flow", tabla: "table", figura: "image", calculadora: "calc", lista: "list", clave: "list" };
const NOMBRE_TIPO = { algoritmo: "Algoritmo", tabla: "Tabla", figura: "Figura", calculadora: "Calculadora", lista: "Recomendaciones", clave: "Punto clave" };
const badge = (tipo) => `<span class="badge badge-${tipo}">${ico(ICONO_TIPO[tipo] || "file")}${NOMBRE_TIPO[tipo] || tipo}</span>`;

async function api(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `Error ${r.status}`);
  return r.json();
}
async function cargarInicio() {
  if (!estado.inicio) estado.inicio = await api("/api/inicio");
  return estado.inicio;
}
async function cargarGuia(id) {
  if (!estado.guias.has(id)) estado.guias.set(id, await api(`/api/guia/${id}`));
  return estado.guias.get(id);
}
const metaGuia = (id) => estado.inicio?.guias.find((g) => g.id === id);
const nombreGuia = (g) => g.ficha?.titulo_corto || g.titulo;

function navegar(hash, reemplazar = false) {
  if (location.hash === hash) return;
  if (reemplazar) { history.replaceState(null, "", hash); router(); }
  else location.hash = hash;
}

function error(e) {
  vista.innerHTML = `<div class="vacio"><h3>No se pudo cargar</h3><p>${esc(e.message)}</p></div>`;
}

// --- Router ------------------------------------------------------------------

let vistaAnterior = null;
async function router() {
  const partes = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const clave = partes[0] === "guia" ? "guia" + partes[1] : partes[0];
  if (clave !== vistaAnterior) { vistaAnterior = clave; window.scrollTo({ top: 0 }); }
  try {
    await cargarInicio();
    if (partes[0] === "buscar" && partes[1]) {
      if (document.activeElement !== inputQ) inputQ.value = partes[1];
      await vistaBusqueda(partes[1], partes[2] ? +partes[2] : null);
    } else if (partes[0] === "guia" && partes[1]) {
      await vistaGuia(+partes[1], partes[2], partes[3]);
    } else {
      if (document.activeElement !== inputQ) inputQ.value = "";
      vistaInicio();
    }
  } catch (e) { error(e); }
}

// --- Inicio ------------------------------------------------------------------

function vistaInicio() {
  const { guias, esquemas } = estado.inicio;
  document.title = "Protocolos Clínicos";
  const conFicha = guias.filter((g) => g.ficha);
  const nAlg = conFicha.reduce((s, g) => s + g.ficha.algoritmos.length, 0);
  const nTab = conFicha.reduce((s, g) => s + g.ficha.n_tablas, 0);
  const nPar = guias.reduce((s, g) => s + g.parrafos, 0);
  const sugerencias = ["embarazo", "dosis máxima", "derivar", ...new Set(conFicha.flatMap((g) => g.ficha.farmacos))].slice(0, 8);

  vista.innerHTML = `
    <section class="hero">
      <div>
        <span class="eyebrow">Guías de práctica clínica · Argentina</span>
        <h1>Protocolos clínicos, al instante.</h1>
        <p class="lead">Algoritmos interactivos, tablas de dosis y calculadoras construidos a partir de las guías oficiales del Ministerio de Salud. Cada dato enlaza a su página de origen.</p>
        <div class="hero-sugerencias"><span>Probá:</span>
          ${sugerencias.map((s) => `<a class="chip" href="#/buscar/${encodeURIComponent(s)}">${esc(s)}</a>`).join("")}
        </div>
      </div>
      <div class="stats">
        <div class="card stat"><strong>${nAlg}</strong><span>Algoritmos interactivos</span></div>
        <div class="card stat"><strong>${nTab}</strong><span>Tablas de dosis y criterios</span></div>
        <div class="card stat"><strong>${esquemas.length}</strong><span>Esquemas originales</span></div>
        <div class="card stat"><strong>${nPar.toLocaleString("es-AR")}</strong><span>Párrafos indexados</span></div>
      </div>
    </section>

    ${conFicha.length ? `
    <section class="seccion">
      <div class="seccion-cab"><div><h2>Protocolos rápidos</h2><p>Fichas de consulta con algoritmos, dosis y puntos clave.</p></div></div>
      <div class="grid-fichas">
        ${conFicha.map((g) => `
          <div class="card ficha-card">
            <a href="#/guia/${g.id}" style="color:inherit;text-decoration:none;display:flex;flex-direction:column;gap:10px">
              <span class="eyebrow">${esc(g.ficha.especialidad || g.tema || "")}</span>
              <div><h3>${esc(g.ficha.titulo_corto)}</h3><div class="sub">${esc(g.ficha.subtitulo || "")}</div></div>
              <p class="resumen">${esc(g.ficha.resumen || "")}</p>
              <div class="meta">
                ${g.ficha.algoritmos.length ? `<span class="badge badge-algoritmo">${ico("flow")}${g.ficha.algoritmos.length} algoritmo${g.ficha.algoritmos.length > 1 ? "s" : ""}</span>` : ""}
                ${g.ficha.n_tablas ? `<span class="badge badge-tabla">${ico("table")}${g.ficha.n_tablas} tabla${g.ficha.n_tablas > 1 ? "s" : ""}</span>` : ""}
                ${g.ficha.n_calculadoras ? `<span class="badge badge-calculadora">${ico("calc")}Calculadora de dosis</span>` : ""}
              </div>
            </a>
            <div class="ficha-algos">
              ${g.ficha.algoritmos.map((a) => `<a href="#/guia/${g.id}/algoritmos/alg-${a.id}">${ico("flow")}${esc(a.titulo)}${ico("right")}</a>`).join("")}
              ${g.ficha.n_calculadoras ? `<a href="#/guia/${g.id}/calculadora">${ico("calc")}Calcular dosis por peso${ico("right")}</a>` : ""}
            </div>
          </div>`).join("")}
      </div>
    </section>` : ""}

    ${esquemas.length ? `
    <section class="seccion">
      <div class="seccion-cab"><div><h2>Algoritmos y esquemas originales</h2><p>Páginas de las guías con flujogramas, tablas y figuras, detectadas automáticamente.</p></div></div>
      <div class="galeria">${esquemas.map(miniatura).join("")}</div>
    </section>` : ""}

    <section class="seccion">
      <div class="seccion-cab"><div><h2>Biblioteca de guías</h2><p>${guias.length} documentos oficiales indexados.</p></div></div>
      <div class="card biblioteca">
        ${guias.map((g) => `
          <div class="fila-guia">
            <div class="ico-doc">${ico("book")}</div>
            <div>
              <h4><a href="#/guia/${g.id}">${esc(g.titulo)}</a></h4>
              <small>${[g.tema, g.fecha && "Publicada " + g.fecha, g.paginas + " páginas"].filter(Boolean).map(esc).join(" · ")}</small>
            </div>
            <div class="acciones">
              <a class="btn btn-sm" href="#/guia/${g.id}">Abrir</a>
              <a class="btn btn-sm btn-ghost" href="${esc(g.url)}" target="_blank" rel="noopener">${ico("external")}PDF</a>
            </div>
          </div>`).join("")}
      </div>
    </section>`;
}

function miniatura(e) {
  const g = metaGuia(e.guia_id);
  return `
    <button class="card miniatura" type="button" data-guia="${e.guia_id}" data-pag="${e.pagina}">
      <div class="img"><img loading="lazy" src="/api/pagina/${e.guia_id}/${e.pagina}.jpg" alt=""></div>
      <div class="txt">
        ${badge(e.tipo)}
        <strong>${esc(e.titulo)}</strong>
        <small>${esc(g ? nombreGuia(g) : "")} · pág. ${e.pagina}</small>
      </div>
    </button>`;
}

// --- Búsqueda ----------------------------------------------------------------

let ultimaBusqueda = 0;
async function vistaBusqueda(q, guiaId) {
  const id = ++ultimaBusqueda;
  const t0 = performance.now();
  const r = await api(`/api/buscar?q=${encodeURIComponent(q)}${guiaId ? "&guia=" + guiaId : ""}`);
  if (id !== ultimaBusqueda) return; // llegó una búsqueda más nueva
  const ms = performance.now() - t0;
  document.title = `${q} · Protocolos Clínicos`;
  const total = r.facetas.reduce((s, f) => s + f.n, 0);
  const base = `#/buscar/${encodeURIComponent(q)}`;

  if (!r.protocolos.length && !r.parrafos.length) {
    vista.innerHTML = `
      <div class="vacio">
        <h3>Sin resultados para «${esc(q)}»</h3>
        <p>Probá con menos palabras, un sinónimo o el nombre genérico del fármaco.</p>
        <p style="margin-top:16px"><a class="btn" href="#/">Volver al inicio</a></p>
      </div>`;
    return;
  }

  vista.innerHTML = `
    <div class="res-cab">
      <h1>Resultados para «${esc(q)}»</h1>
      <small>${r.protocolos.length + total} coincidencias · ${fmt(ms)} ms</small>
    </div>
    <div class="facetas">
      <a class="chip ${guiaId ? "" : "activo"}" href="${base}">Todas las guías <span class="n">${total}</span></a>
      ${r.facetas.map((f) => {
        const g = metaGuia(f.guia_id);
        return `<a class="chip ${guiaId === f.guia_id ? "activo" : ""}" href="${base}/${f.guia_id}">${esc(g ? nombreGuia(g) : f.guia)} <span class="n">${f.n}</span></a>`;
      }).join("")}
    </div>

    ${r.protocolos.length ? `
      <h2 class="res-titulo">${ico("flow")}En los protocolos rápidos</h2>
      <div class="grid-protocolos">
        ${r.protocolos.map((p) => {
          const g = metaGuia(p.guia_id);
          return `
          <a class="card res-protocolo" href="${enlaceAncla(p.guia_id, p.ancla)}">
            <div class="top">${badge(p.tipo)}${p.pagina ? `<small>pág. ${p.pagina}</small>` : ""}</div>
            <h4>${esc(p.titulo)}</h4>
            <p>${resaltar(p.fragmento)}</p>
            <small>${esc(g ? nombreGuia(g) : p.guia)}</small>
          </a>`;
        }).join("")}
      </div>` : ""}

    ${r.parrafos.length ? `
      <h2 class="res-titulo">${ico("text")}En el texto de las guías</h2>
      <div class="card lista-res">
        ${r.parrafos.map((p) => {
          const g = metaGuia(p.guia_id);
          return `
          <div class="res-parrafo">
            <button class="mini" type="button" data-guia="${p.guia_id}" data-pag="${p.pagina}" aria-label="Ver página ${p.pagina}">
              <img loading="lazy" src="/api/pagina/${p.guia_id}/${p.pagina}.jpg" alt="">
            </button>
            <div>
              <div class="meta">
                <strong><a href="#/guia/${p.guia_id}">${esc(g ? nombreGuia(g) : p.guia)}</a></strong>
                ${p.seccion ? `<span class="sep">›</span><span>${esc(p.seccion)}</span>` : ""}
                ${pag(p.guia_id, p.pagina, "pág. " + p.pagina)}
              </div>
              <p>${resaltar(p.fragmento)}</p>
            </div>
          </div>`;
        }).join("")}
      </div>` : ""}`;
}

function enlaceAncla(guiaId, ancla) {
  const tab = ancla.startsWith("alg-") ? "algoritmos" : ancla.startsWith("tab-") ? "tablas" : ancla.startsWith("calc-") ? "calculadora" : "resumen";
  return `#/guia/${guiaId}/${tab}/${ancla}`;
}

// --- Vista de guía -------------------------------------------------------------

async function vistaGuia(id, tab, ancla) {
  const g = await cargarGuia(id);
  const f = g.ficha;
  const tabs = [
    f && ["resumen", "Resumen", "list"],
    f?.algoritmos?.length && ["algoritmos", "Algoritmos", "flow", f.algoritmos.length],
    f?.tablas?.length && ["tablas", "Dosis y tablas", "table", f.tablas.length],
    f?.calculadoras?.length && ["calculadora", "Calculadora", "calc"],
    g.esquemas.length && ["esquemas", "Esquemas originales", "image", g.esquemas.length],
    ["texto", "Texto completo", "text"],
  ].filter(Boolean);
  if (!tabs.some((t) => t[0] === tab)) tab = tabs[0][0];
  document.title = `${nombreGuia(g)} · Protocolos Clínicos`;

  vista.innerHTML = `
    <nav class="migas" aria-label="Ruta"><a href="#/">Inicio</a>${ico("right")}<span>${esc(f?.titulo_corto || "Guía")}</span></nav>
    <header class="guia-cab">
      <div>
        <span class="eyebrow">${esc(f?.especialidad || g.tema || "Guía clínica")}</span>
        <h1>${esc(f?.titulo_corto || g.titulo)}</h1>
        ${f?.subtitulo ? `<div class="sub">${esc(f.subtitulo)}</div>` : ""}
        <p class="fuente">Fuente: ${esc(g.titulo)}${g.fecha ? " · Publicada " + esc(g.fecha) : ""} · ${g.paginas} páginas</p>
      </div>
      <div class="acciones">
        <button class="btn" type="button" data-guia="${g.id}" data-pag="1">${ico("file")}Ver guía completa</button>
        <a class="btn btn-primary" href="${esc(g.url)}" target="_blank" rel="noopener">${ico("external")}PDF oficial</a>
      </div>
    </header>
    <nav class="tabs" role="tablist">
      ${tabs.map(([k, label, i, n]) => `<a class="tab ${k === tab ? "activo" : ""}" role="tab" aria-selected="${k === tab}" href="#/guia/${g.id}/${k}" data-reemplazar>${ico(i)}${label}${n ? `<span class="n">${n}</span>` : ""}</a>`).join("")}
    </nav>
    <section class="panel" id="panel"></section>`;

  const panel = $("#panel");
  if (tab === "resumen") panelResumen(panel, g);
  else if (tab === "algoritmos") panelAlgoritmos(panel, g, ancla);
  else if (tab === "tablas") panelTablas(panel, g);
  else if (tab === "calculadora") panelCalculadora(panel, g);
  else if (tab === "esquemas") panel.innerHTML = `<div class="galeria">${g.esquemas.map((e) => miniatura({ ...e, guia_id: g.id })).join("")}</div>`;
  else await panelTexto(panel, g);

  if (ancla && ancla !== "resumen" && !ancla.startsWith("alg-")) {
    const el = document.getElementById(ancla);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("destello"); }
  }
}

function panelResumen(panel, g) {
  const f = g.ficha;
  panel.innerHTML = `
    <div class="resumen-grid">
      <div>
        <div class="card intro">
          <p>${esc(f.resumen)}</p>
          <dl>
            ${f.poblacion ? `<dt>Población</dt><dd>${esc(f.poblacion)}</dd>` : ""}
            <dt>Documento</dt><dd>${esc(g.titulo)}</dd>
          </dl>
        </div>
        ${f.claves?.length ? `
          <div class="seccion-cab" style="margin-top:28px;margin-bottom:0"><h2>Puntos clave</h2></div>
          <ol class="claves">${f.claves.map((k) => `<li><div>${esc(k.texto)} ${pag(g.id, k.pagina)}</div></li>`).join("")}</ol>` : ""}
      </div>
      <aside class="card atajos">
        <h3>Ir directo a</h3>
        ${(f.algoritmos || []).map((a) => `<a href="#/guia/${g.id}/algoritmos/alg-${a.id}">${ico("flow")}${esc(a.titulo)}</a>`).join("")}
        ${(f.calculadoras || []).map((c) => `<a href="#/guia/${g.id}/calculadora">${ico("calc")}${esc(c.titulo)}</a>`).join("")}
        ${(f.tablas || []).slice(0, 6).map((t) => `<a href="#/guia/${g.id}/tablas/tab-${t.id}">${ico("table")}${esc(t.titulo)}</a>`).join("")}
      </aside>
    </div>
    ${f.listas?.length ? `<div class="callouts">${f.listas.map((l) => callout(g.id, l)).join("")}</div>` : ""}`;
}

function callout(guiaId, l) {
  const icono = { alerta: "alert", exito: "check", info: "info", precaucion: "alert", neutro: "list" }[l.estilo] || "list";
  return `
    <div class="callout callout-${l.estilo || "neutro"}" id="lis-${l.id}">
      <h3>${ico(icono)}${esc(l.titulo)}${pag(guiaId, l.pagina)}</h3>
      <ul>${l.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
    </div>`;
}

// --- Algoritmos ------------------------------------------------------------------

function panelAlgoritmos(panel, g, ancla) {
  const algos = g.ficha.algoritmos;
  const elegido = algos.find((a) => "alg-" + a.id === ancla) || algos[0];
  if (estado.algo?.id !== elegido.id || estado.algo?.guia !== g.id) {
    estado.algo = { guia: g.id, id: elegido.id, modo: innerWidth < 760 ? "pasos" : "diagrama", camino: [{ id: elegido.inicio }] };
  }
  panel.innerHTML = `
    ${algos.length > 1 ? `<div class="algo-selector">${algos.map((a) => `<a class="chip ${a.id === elegido.id ? "activo" : ""}" href="#/guia/${g.id}/algoritmos/alg-${a.id}" data-reemplazar>${esc(a.titulo)}</a>`).join("")}</div>` : ""}
    <article class="card algo">
      <div class="algo-cab">
        <div><h2>${esc(elegido.titulo)}</h2><p>${esc(elegido.descripcion || "")}</p></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <div class="segmento" role="tablist">
            <button type="button" data-modo="diagrama">${ico("flow")}Diagrama</button>
            <button type="button" data-modo="pasos">${ico("play")}Paso a paso</button>
          </div>
          ${pag(g.id, elegido.pagina, "Ver original · pág. " + elegido.pagina)}
        </div>
      </div>
      <div id="algo-cuerpo"></div>
    </article>`;
  $$(".segmento button", panel).forEach((b) => b.addEventListener("click", () => { estado.algo.modo = b.dataset.modo; dibujarAlgo(g, elegido); }));
  dibujarAlgo(g, elegido);
}

function dibujarAlgo(g, a) {
  $$(".segmento button").forEach((b) => b.classList.toggle("activo", b.dataset.modo === estado.algo.modo));
  const cuerpo = $("#algo-cuerpo");
  if (estado.algo.modo === "diagrama") dibujarDiagrama(cuerpo, g, a);
  else dibujarPasos(cuerpo, g, a);
}

let mermaidMod = null;
async function cargarMermaid() {
  if (!mermaidMod) mermaidMod = (await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")).default;
  return mermaidMod;
}

function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

function partir(texto, ancho = 30) {
  const palabras = texto.replace(/\*+/g, "").split(/\s+/);
  const lineas = [];
  let actual = "";
  for (const p of palabras) {
    if ((actual + " " + p).trim().length > ancho && actual) { lineas.push(actual); actual = p; }
    else actual = (actual + " " + p).trim();
  }
  if (actual) lineas.push(actual);
  return lineas.map((l) => l.replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;")).join("<br/>");
}

function codigoMermaid(a) {
  const forma = { inicio: ['(["', '"])'], decision: ['{{"', '"}}'], accion: ['["', '"]'], resultado: ['("', '")'], alerta: ['["', '"]'] };
  const L = ["flowchart TD"];
  for (const n of a.nodos) {
    const [i, f] = forma[n.tipo] || forma.accion;
    L.push(`  ${n.id}${i}${partir(n.texto, n.tipo === "decision" ? 26 : 32)}${f}:::${n.tipo}`);
  }
  for (const n of a.nodos) {
    if (n.siguiente) L.push(`  ${n.id} --> ${n.siguiente}`);
    for (const o of n.opciones || []) L.push(`  ${n.id} -->|"${partir(o.etiqueta, 22)}"| ${o.ir}`);
    L.push(`  click ${n.id} __nodoAlgoritmo`);
  }
  const c = (fill, stroke) => `fill:${css(fill)},stroke:${css(stroke)},color:${css("--text")},stroke-width:1.5px`;
  L.push(`  classDef inicio ${c("--info-soft", "--info")}`);
  L.push(`  classDef decision ${c("--primary-soft", "--primary")}`);
  L.push(`  classDef accion ${c("--surface", "--border-strong")}`);
  L.push(`  classDef resultado ${c("--ok-soft", "--ok")}`);
  L.push(`  classDef alerta ${c("--danger-soft", "--danger")}`);
  return L.join("\n");
}

let contadorDiagramas = 0;
async function dibujarDiagrama(cuerpo, g, a) {
  cuerpo.innerHTML = `<div class="diagrama"><div class="cargando"><span class="spinner"></span> Dibujando algoritmo…</div></div>
    <div class="diagrama-nota"><span>Tocá cualquier recuadro para recorrer el algoritmo desde ese punto.</span>
    <span>${ico("info")} Resumen elaborado de la guía; verificá en el original.</span></div>`;
  try {
    const mermaid = await cargarMermaid();
    mermaid.initialize({
      startOnLoad: false, securityLevel: "loose", theme: "base",
      fontFamily: getComputedStyle(document.body).fontFamily,
      themeVariables: { fontSize: "14px", lineColor: css("--muted"), textColor: css("--text"), edgeLabelBackground: css("--surface-2"), primaryTextColor: css("--text") },
      flowchart: { curve: "basis", nodeSpacing: 28, rankSpacing: 44, padding: 14, htmlLabels: true, useMaxWidth: true, wrappingWidth: 420 },
    });
    window.__nodoAlgoritmo = (nodoId) => {
      estado.algo.modo = "pasos";
      estado.algo.camino = caminoHasta(a, nodoId);
      dibujarAlgo(g, a);
    };
    const { svg, bindFunctions } = await mermaid.render(`mmd-${++contadorDiagramas}`, codigoMermaid(a));
    const cont = $(".diagrama", cuerpo);
    if (!cont) return;
    cont.innerHTML = svg;
    bindFunctions?.(cont);
  } catch (e) {
    console.error(e);
    estado.algo.modo = "pasos";
    dibujarAlgo(g, a);
    $("#algo-cuerpo").insertAdjacentHTML("afterbegin", `<div class="aviso aviso-warn" style="margin:16px 22px 0">${ico("alert")}No se pudo dibujar el diagrama (¿sin conexión a internet?). Se muestra el modo paso a paso.</div>`);
  }
}

// Camino más corto desde el inicio hasta un nodo, con las elecciones tomadas.
function caminoHasta(a, destino) {
  const nodos = Object.fromEntries(a.nodos.map((n) => [n.id, n]));
  const previo = { [a.inicio]: null };
  const cola = [a.inicio];
  while (cola.length) {
    const id = cola.shift();
    if (id === destino) break;
    const n = nodos[id];
    const salidas = [...(n.siguiente ? [[n.siguiente, null]] : []), ...(n.opciones || []).map((o) => [o.ir, o.etiqueta])];
    for (const [sig, etiqueta] of salidas) {
      if (!(sig in previo)) { previo[sig] = [id, etiqueta]; cola.push(sig); }
    }
  }
  if (!(destino in previo)) return [{ id: a.inicio }];
  const camino = [{ id: destino }];
  let cur = destino;
  while (previo[cur]) {
    const [p, etiqueta] = previo[cur];
    camino.unshift({ id: p, eleccion: etiqueta });
    cur = p;
  }
  return camino;
}

function dibujarPasos(cuerpo, g, a) {
  const nodos = Object.fromEntries(a.nodos.map((n) => [n.id, n]));
  const camino = estado.algo.camino;
  const actual = nodos[camino[camino.length - 1].id];
  const etiquetaTipo = { inicio: "Punto de partida", decision: "Decisión", accion: "Conducta", resultado: "Resultado", alerta: "Atención" };
  const iconoTipo = { inicio: "play", decision: "flow", accion: "check", resultado: "check", alerta: "alert" };
  const terminal = !actual.siguiente && !(actual.opciones || []).length;

  cuerpo.innerHTML = `
    <div class="paso-a-paso">
      <aside class="recorrido">
        <h4>Recorrido</h4>
        <ol>${camino.map((c, i) => `
          <li class="${i === camino.length - 1 ? "actual" : ""}"><button type="button" data-volver="${i}">
            <span>${esc(nodos[c.id].texto)}${c.eleccion ? `<span class="eleccion">→ ${esc(c.eleccion)}</span>` : ""}</span>
          </button></li>`).join("")}
        </ol>
      </aside>
      <div class="paso" data-tipo="${actual.tipo}">
        <span class="paso-tipo">${ico(iconoTipo[actual.tipo])}${etiquetaTipo[actual.tipo] || ""}</span>
        <h3>${esc(actual.texto)}</h3>
        ${actual.detalle?.length ? `<ul>${actual.detalle.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
        ${actual.opciones?.length ? `<div class="paso-opciones">${actual.opciones.map((o, i) => `<button class="opcion" type="button" data-opcion="${i}">${esc(o.etiqueta)}${ico("right")}</button>`).join("")}</div>` : ""}
        ${actual.siguiente ? `<div><button class="btn btn-primary" type="button" data-seguir>Continuar${ico("right")}</button></div>` : ""}
        ${terminal ? `<div class="fin">${ico(actual.tipo === "alerta" ? "alert" : "check")}Fin del algoritmo</div>` : ""}
        <div class="paso-pie">
          ${pag(g.id, actual.pagina, "Fuente · pág. " + actual.pagina)}
          ${camino.length > 1 ? `<button class="btn btn-sm btn-ghost" type="button" data-reiniciar>${ico("reset")}Reiniciar</button>` : ""}
        </div>
      </div>
    </div>`;

  const ir = (id, eleccion) => {
    camino[camino.length - 1].eleccion = eleccion;
    camino.push({ id });
    dibujarPasos(cuerpo, g, a);
    if (innerWidth < 820) $(".paso", cuerpo).scrollIntoView({ behavior: "smooth", block: "start" });
  };
  $$("[data-opcion]", cuerpo).forEach((b) => b.addEventListener("click", () => { const o = actual.opciones[+b.dataset.opcion]; ir(o.ir, o.etiqueta); }));
  $("[data-seguir]", cuerpo)?.addEventListener("click", () => ir(actual.siguiente, null));
  $("[data-reiniciar]", cuerpo)?.addEventListener("click", () => { estado.algo.camino = [{ id: a.inicio }]; dibujarPasos(cuerpo, g, a); });
  $$("[data-volver]", cuerpo).forEach((b) => b.addEventListener("click", () => {
    estado.algo.camino = camino.slice(0, +b.dataset.volver + 1);
    delete estado.algo.camino[estado.algo.camino.length - 1].eleccion;
    dibujarPasos(cuerpo, g, a);
  }));
}

// --- Tablas ----------------------------------------------------------------------

function panelTablas(panel, g) {
  const grupos = new Map();
  for (const t of g.ficha.tablas) {
    const k = t.grupo || "";
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(t);
  }
  panel.innerHTML = `
    <div class="filtro-tablas">
      <div class="search">${ico("search")}<input type="search" id="filtro" placeholder="Filtrar por fármaco, edad o criterio…" aria-label="Filtrar tablas"></div>
      <small id="filtro-info"></small>
    </div>
    ${[...grupos].map(([nombre, tablas]) => `
      <div class="grupo-tablas">
        ${nombre ? `<h3>${esc(nombre)}</h3>` : ""}
        <div class="tablas">${tablas.map((t) => `
          <article class="card tabla-card ${t.columnas.length > 4 ? "ancha" : ""}" id="tab-${t.id}">
            <div class="cab"><h4>${esc(t.titulo)}</h4>${pag(g.id, t.pagina)}</div>
            <div class="tabla-scroll"><table class="dato">
              <thead><tr>${t.columnas.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
              <tbody>${t.filas.map((f) => `<tr>${f.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
            </table></div>
            ${t.notas?.length ? `<div class="notas">${t.notas.map((n) => `<span>${esc(n)}</span>`).join("")}</div>` : ""}
          </article>`).join("")}
        </div>
      </div>`).join("")}`;

  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  $("#filtro", panel).addEventListener("input", (ev) => {
    const q = norm(ev.target.value.trim());
    let visibles = 0;
    $$(".tabla-card", panel).forEach((card) => {
      const titulo = norm(card.querySelector("h4").textContent);
      let filasVisibles = 0;
      card.querySelectorAll("tbody tr").forEach((tr) => {
        const ok = !q || titulo.includes(q) || norm(tr.textContent).includes(q);
        tr.classList.toggle("oculto", !ok);
        filasVisibles += ok;
      });
      card.hidden = filasVisibles === 0;
      visibles += filasVisibles > 0;
    });
    $$(".grupo-tablas", panel).forEach((gr) => { gr.hidden = !$$(".tabla-card", gr).some((c) => !c.hidden); });
    $("#filtro-info", panel).textContent = q ? `${visibles} tabla${visibles === 1 ? "" : "s"}` : "";
  });
}

// --- Calculadora -------------------------------------------------------------------

function panelCalculadora(panel, g) {
  panel.innerHTML = g.ficha.calculadoras.map((c) => `<article class="card calc" id="calc-${c.id}" style="margin-bottom:20px"></article>`).join("");
  g.ficha.calculadoras.forEach((c) => {
    const st = { farmaco: 0, grupo: 0, peso: "" };
    const el = $(`#calc-${c.id}`, panel);
    const render = () => dibujarCalculadora(el, g, c, st, render);
    render();
  });
}

function grupoPorPeso(fx, peso) {
  let elegido = 0;
  fx.grupos.forEach((gr, i) => { if (gr.peso && peso >= gr.peso[0]) elegido = i; });
  return elegido;
}

function dibujarCalculadora(el, g, c, st, render) {
  const fx = c.farmacos[st.farmaco];
  const peso = parseFloat(String(st.peso).replace(",", "."));
  const pesoOk = peso > 0.3 && peso <= 250;
  if (fx.por_peso && pesoOk) st.grupo = grupoPorPeso(fx, peso);
  const gr = fx.grupos[Math.min(st.grupo, fx.grupos.length - 1)];

  el.innerHTML = `
    <div class="calc-form">
      <div><h3>${esc(c.titulo)}</h3><p>${esc(c.descripcion || "")} ${pag(g.id, c.pagina)}</p></div>
      <div class="campo"><span class="lbl">Fármaco</span>
        <div class="opciones-btn">${c.farmacos.map((f, i) => `<button type="button" class="${i === st.farmaco ? "activo" : ""}" data-farmaco="${i}">${esc(f.nombre)}</button>`).join("")}</div>
      </div>
      ${!fx.por_peso && fx.grupos.length > 1 ? `
      <div class="campo"><span class="lbl">Grupo de edad</span>
        <div class="opciones-btn">${fx.grupos.map((x, i) => `<button type="button" class="${i === st.grupo ? "activo" : ""}" data-grupo="${i}">${esc(x.etiqueta)}</button>`).join("")}</div>
      </div>` : ""}
      <div class="campo"><label for="peso-${c.id}">Peso del paciente</label>
        <div class="input-peso"><input id="peso-${c.id}" inputmode="decimal" placeholder="0" value="${esc(st.peso)}" autocomplete="off"><span>kg</span></div>
      </div>
    </div>
    <div class="calc-res" aria-live="polite">${resultadoCalculo(fx, gr, peso, pesoOk)}</div>`;

  $$("[data-farmaco]", el).forEach((b) => b.addEventListener("click", () => { st.farmaco = +b.dataset.farmaco; st.grupo = Math.min(st.grupo, c.farmacos[st.farmaco].grupos.length - 1); render(); }));
  $$("[data-grupo]", el).forEach((b) => b.addEventListener("click", () => { st.grupo = +b.dataset.grupo; render(); }));
  const input = $(`#peso-${c.id}`, el);
  input.addEventListener("input", () => {
    st.peso = input.value;
    const pos = input.selectionStart;
    render();
    const nuevo = $(`#peso-${c.id}`, el);
    nuevo.focus();
    nuevo.setSelectionRange(pos, pos);
  });
}

function resultadoCalculo(fx, gr, peso, pesoOk) {
  if (gr.no_recomendado) {
    return `<div class="aviso aviso-danger">${ico("alert")}<div><strong>${esc(fx.nombre)} · ${esc(gr.etiqueta)}</strong><br>${esc(gr.no_recomendado)}</div></div>`;
  }
  const necesitaPeso = gr.fases.some((f) => f.mgkg);
  if (necesitaPeso && !pesoOk) {
    return `<p class="ayuda">${ico("info")}Ingresá el peso para calcular la dosis de ${esc(fx.nombre.toLowerCase())}${fx.por_peso ? "" : ` en ${esc(gr.etiqueta.toLowerCase())}`}.</p>
      ${gr.fases.map((f) => `<div class="fase"><div class="fase-cab"><span>${esc(f.etiqueta)}</span><span>${esc(reglaTexto(f))}</span></div></div>`).join("")}`;
  }
  const avisos = [];
  const fases = gr.fases.map((f) => {
    let lo, hi, tope = false;
    if (f.fija) { lo = hi = f.fija; }
    else {
      lo = f.mgkg[0] * peso; hi = f.mgkg[1] * peso;
      if (f.max && hi > f.max) { tope = true; hi = f.max; lo = Math.min(lo, f.max); }
    }
    if (tope) avisos.push(`${f.etiqueta}: se alcanzó la dosis máxima (${fmt(f.max)} mg/día).`);
    const rango = (a, b) => (Math.abs(a - b) < 0.05 ? fmt(a) : `${fmt(a)}–${fmt(b)}`);
    const intervalo = f.tomas > 1 ? `cada ${24 / f.tomas} h` : "dosis única diaria";
    return `
      <div class="fase">
        <div class="fase-cab"><span>${esc(f.etiqueta)}</span><span>${esc(reglaTexto(f))}</span></div>
        <div class="fase-cuerpo">
          <div class="fase-dato"><small>Dosis diaria</small><strong>${rango(lo, hi)}<em>mg/día</em></strong></div>
          <div class="fase-dato"><small>Por toma</small><strong>${rango(lo / f.tomas, hi / f.tomas)}<em>mg</em></strong><div class="det">${f.tomas} toma${f.tomas > 1 ? "s" : ""} · ${intervalo}</div></div>
        </div>
      </div>`;
  });
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <strong style="font-size:16px">${esc(fx.nombre)}</strong>
      <span class="badge">${esc(gr.etiqueta)}${pesoOk && necesitaPeso ? ` · ${fmt(peso)} kg` : ""}</span>
    </div>
    ${fases.join("")}
    ${avisos.map((a) => `<div class="aviso aviso-warn">${ico("alert")}<span>${esc(a)}</span></div>`).join("")}
    ${gr.nota ? `<div class="aviso aviso-info">${ico("info")}<span>${esc(gr.nota)}</span></div>` : ""}
    <p class="ayuda" style="font-size:12.5px">${ico("info")}Cálculo orientativo según la guía. Ajustar con criterio clínico y presentaciones disponibles.</p>`;
}

function reglaTexto(f) {
  if (f.fija) return `${fmt(f.fija)} mg/día`;
  const [a, b] = f.mgkg;
  return `${a === b ? fmt(a) : fmt(a) + "–" + fmt(b)} mg/kg/día${f.max ? ` · máx. ${fmt(f.max)} mg` : ""}`;
}

// --- Texto completo ------------------------------------------------------------------

async function panelTexto(panel, g) {
  panel.innerHTML = `<div class="cargando"><span class="spinner"></span> Cargando texto…</div>`;
  const parrafos = await api(`/api/guia/${g.id}/texto`);
  let html = "", seccion = undefined;
  for (const p of parrafos) {
    if (p.seccion !== seccion) {
      seccion = p.seccion;
      html += `<h3>${esc(seccion || "Introducción")} ${pag(g.id, p.pagina)}</h3>`;
    }
    html += `<p>${esc(p.texto)}</p>`;
  }
  panel.innerHTML = `
    <form class="filtro-tablas" id="buscar-en-guia">
      <div class="search">${ico("search")}<input type="search" name="q" placeholder="Buscar en esta guía…" aria-label="Buscar en esta guía"></div>
    </form>
    <div class="card texto-completo">${html || '<p class="vacio">Sin texto extraído.</p>'}</div>`;
  $("#buscar-en-guia", panel).addEventListener("submit", (ev) => {
    ev.preventDefault();
    const q = ev.target.q.value.trim();
    if (q) navegar(`#/buscar/${encodeURIComponent(q)}/${g.id}`);
  });
}

// --- Visor de páginas ------------------------------------------------------------------

const visor = {
  el: $("#visor"), img: $("#visor-img"), lienzo: $("#visor-lienzo"), lateral: $("#visor-lateral"),
  guia: null, pagina: 1, total: 1, conTexto: false, foco: null,
  abrir(guiaId, pagina) {
    const g = metaGuia(guiaId);
    if (!g) return;
    this.foco = document.activeElement;
    Object.assign(this, { guia: g, pagina, total: g.paginas });
    $("#visor-titulo").textContent = g.titulo;
    this.el.hidden = false;
    document.body.style.overflow = "hidden";
    this.mostrar();
    $("[data-cerrar].icon-btn", this.el).focus();
  },
  cerrar() {
    this.el.hidden = true;
    document.body.style.overflow = "";
    this.lienzo.classList.remove("zoom");
    this.foco?.focus?.();
  },
  async mostrar() {
    const { guia, pagina, total } = this;
    this.img.src = `/api/pagina/${guia.id}/${pagina}.jpg`;
    this.img.alt = `Página ${pagina} de ${guia.titulo}`;
    $("#visor-pag").textContent = `Página ${pagina} de ${total}`;
    $("#visor-prev").disabled = pagina <= 1;
    $("#visor-next").disabled = pagina >= total;
    $("#visor-pdf").href = `${guia.url}#page=${pagina}`;
    this.lienzo.scrollTop = 0;
    if (pagina < total) new Image().src = `/api/pagina/${guia.id}/${pagina + 1}.jpg`;
    if (this.conTexto) {
      this.lateral.hidden = false;
      this.lateral.innerHTML = `<h4>Texto de la página ${pagina}</h4><div class="cargando"><span class="spinner"></span></div>`;
      const ps = await api(`/api/guia/${guia.id}/texto?pagina=${pagina}`);
      if (this.pagina !== pagina) return;
      this.lateral.innerHTML = `<h4>Texto de la página ${pagina}</h4>` + (ps.map((p) => `<p>${esc(p.texto)}</p>`).join("") || "<p>Sin texto en esta página.</p>");
    } else this.lateral.hidden = true;
  },
  mover(d) {
    const n = this.pagina + d;
    if (n >= 1 && n <= this.total) { this.pagina = n; this.mostrar(); }
  },
};
$("#visor-prev").addEventListener("click", () => visor.mover(-1));
$("#visor-next").addEventListener("click", () => visor.mover(1));
$("#visor-texto").addEventListener("click", () => { visor.conTexto = !visor.conTexto; visor.mostrar(); });
visor.img.addEventListener("click", () => visor.lienzo.classList.toggle("zoom"));
$$("[data-cerrar]", visor.el).forEach((b) => b.addEventListener("click", () => visor.cerrar()));

// --- Eventos globales ---------------------------------------------------------------------

document.addEventListener("click", (ev) => {
  const p = ev.target.closest("[data-pag]");
  if (p && !visor.el.contains(p)) { ev.preventDefault(); visor.abrir(+p.dataset.guia, +p.dataset.pag); return; }
  const r = ev.target.closest("a[data-reemplazar]");
  if (r) { ev.preventDefault(); navegar(r.getAttribute("href"), true); }
});

document.addEventListener("keydown", (ev) => {
  if (!visor.el.hidden) {
    if (ev.key === "Escape") visor.cerrar();
    else if (ev.key === "ArrowLeft") visor.mover(-1);
    else if (ev.key === "ArrowRight") visor.mover(1);
    return;
  }
  const escribiendo = /input|textarea|select/i.test(document.activeElement?.tagName);
  if (ev.key === "/" && !escribiendo) { ev.preventDefault(); inputQ.focus(); inputQ.select(); }
  else if (ev.key === "Escape" && document.activeElement === inputQ) { inputQ.value = ""; inputQ.blur(); navegar("#/"); }
});

let temporizador;
inputQ.addEventListener("input", () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    const q = inputQ.value.trim();
    const enBusqueda = location.hash.startsWith("#/buscar/");
    if (q) navegar(`#/buscar/${encodeURIComponent(q)}`, enBusqueda);
    else if (enBusqueda) navegar("#/", true);
  }, 140);
});
$("#form-busqueda").addEventListener("submit", (ev) => { ev.preventDefault(); clearTimeout(temporizador); const q = inputQ.value.trim(); if (q) navegar(`#/buscar/${encodeURIComponent(q)}`); });

$("#btn-tema").addEventListener("click", () => {
  const oscuro = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const nuevo = oscuro ? "light" : "dark";
  document.documentElement.dataset.theme = nuevo;
  try { localStorage.setItem("tema", nuevo); } catch (e) {}
  if (location.hash.includes("/algoritmos")) router(); // redibuja el diagrama con los colores nuevos
});

window.addEventListener("hashchange", router);
router();
