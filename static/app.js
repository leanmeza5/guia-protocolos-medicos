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
  peso: "",              // peso del paciente, compartido por las calculadoras (solo en memoria)
  escalas: new Map(),    // id de escala -> respuestas elegidas
  categoria: null,       // filtro de categoría en el inicio
};

const CATEGORIAS = [
  { id: "guardia", corto: "Guardia", titulo: "Guardia y urgencias", desc: "Algoritmos para decidir rápido cuando no hay tiempo.", icono: "siren" },
  { id: "cronicos", corto: "Crónicos", titulo: "Consultorio: enfermedades crónicas", desc: "Diagnóstico, metas y tratamiento escalonado.", icono: "heart" },
  { id: "infecciones", corto: "Infecciones", titulo: "Infecciones", desc: "Antibióticos, notificación y manejo de contactos.", icono: "bug" },
  { id: "embarazo", corto: "Embarazo y RN", titulo: "Embarazo y recién nacido", desc: "Control prenatal y emergencia obstétrica.", icono: "baby" },
];

// --- Utilidades --------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const resaltar = (s) => esc(s).replace(/\x02/g, "<mark>").replace(/\x03/g, "</mark>");
const ico = (id, cls = "") => `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const fmt = (n) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 });
const fmtKg = (n) => n.toLocaleString("es-AR", { maximumFractionDigits: 3 }); // dosis por kilo: no redondear
const pag = (guiaId, n, txt) => (n && guiaId ? `<button class="pag" type="button" data-guia="${guiaId}" data-pag="${n}" title="Ver página ${n} de la guía original">${txt || "pág. " + n}</button>` : "");
const ICONO_TIPO = { algoritmo: "flow", tabla: "table", figura: "image", calculadora: "calc", lista: "list", clave: "list", escala: "gauge" };
const NOMBRE_TIPO = { algoritmo: "Algoritmo", tabla: "Tabla", figura: "Figura", calculadora: "Calculadora", lista: "Recomendaciones", clave: "Punto clave", escala: "Escala" };
const badge = (tipo) => `<span class="badge badge-${tipo}">${ico(ICONO_TIPO[tipo] || "file")}${NOMBRE_TIPO[tipo] || tipo}</span>`;
const ANIO_VIGENCIA = 2018; // ediciones anteriores se marcan para verificar actualización

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

function leerRecientes() {
  try { return JSON.parse(localStorage.getItem("recientes") || "[]"); } catch (e) { return []; }
}
function guardarReciente(id) {
  try { localStorage.setItem("recientes", JSON.stringify([id, ...leerRecientes().filter((x) => x !== id)].slice(0, 6))); } catch (e) {}
}

function navegar(hash, reemplazar = false) {
  if (location.hash === hash) return;
  if (reemplazar) { history.replaceState(null, "", hash); router(); }
  else location.hash = hash;
}

function error(e) {
  vista.innerHTML = `<div class="vacio"><h3>No se pudo cargar</h3><p>${esc(e.message)}</p>
    ${navigator.onLine ? "" : "<p>Estás sin conexión: solo se muestran las páginas que ya se abrieron antes.</p>"}</div>`;
}

function edicion(anio) {
  if (!anio) return "";
  const vieja = anio < ANIO_VIGENCIA;
  return `<span class="badge ${vieja ? "badge-vieja" : "badge-edicion"}" title="${vieja ? "Edición antigua: verificá si hay una versión más nueva" : "Año de edición"}">${ico(vieja ? "alert" : "clock")}Edición ${anio}</span>`;
}

// --- Router ------------------------------------------------------------------

let vistaAnterior = null;
async function router() {
  vista.className = "contenedor";
  const partes = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const clave = partes[0] === "guia" ? "guia" + partes[1] : partes[0] + (partes[1] || "");
  if (clave !== vistaAnterior) { vistaAnterior = clave; window.scrollTo({ top: 0 }); }
  cerrarMenu();
  try {
    await cargarInicio();
    construirMenu();
    if (partes[0] === "buscar" && partes[1]) {
      if (document.activeElement !== inputQ) inputQ.value = partes[1];
      await vistaBusqueda(partes[1], partes[2] ? +partes[2] : null);
    } else if (partes[0] === "buscar") {
      vistaBuscarVacia();
    } else if (partes[0] === "guia" && partes[1]) {
      await vistaGuia(+partes[1], partes[2], partes[3]);
    } else if (partes[0] === "categoria" && partes[1]) {
      vistaCategoria(partes[1]);
    } else if (partes[0] === "herramientas") {
      vistaHerramientas();
    } else if (partes[0] === "biblioteca") {
      vistaBiblioteca();
    } else if (partes[0] === "region") {
      vistaRegion();
    } else if (partes[0] === "esquemas") {
      vistaEsquemas();
    } else {
      if (document.activeElement !== inputQ) inputQ.value = "";
      vistaInicio();
    }
    marcarActivo(partes);
  } catch (e) { error(e); }
}

// --- Menú lateral y barra inferior -------------------------------------------

const catDe = (g) => g?.ficha?.categorias?.find((c) => CATEGORIAS.some((x) => x.id === c)) || "";
let menuConstruido = false;
function construirMenu() {
  if (menuConstruido) return;
  menuConstruido = true;
  const { guias, region } = estado.inicio;
  const conFicha = guias.filter((g) => g.ficha);
  const item = (href, icono, txt, ruta, n) =>
    `<a class="nav-item" href="${href}" data-ruta="${ruta}" title="${esc(txt)}"><span class="nav-ico">${ico(icono)}</span><span class="nav-txt">${esc(txt)}</span>${n ? `<span class="n">${n}</span>` : ""}</a>`;
  $("#sidebar-nav").innerHTML = `
    <div class="nav-grupo">
      ${item("#/", "home", "Inicio", "inicio")}
      ${item("#/buscar", "search", "Buscar", "buscar")}
      ${item("#/herramientas", "calc", "Calculadoras y escalas", "herramientas")}
      ${item("#/esquemas", "image", "Algoritmos originales", "esquemas")}
      ${item("#/biblioteca", "book", "Biblioteca de guías", "biblioteca", guias.length)}
      ${region ? item("#/region", "pin", region.nombre, "region") : ""}
    </div>
    <div class="nav-grupo">
      <span class="nav-titulo">Protocolos</span>
      ${CATEGORIAS.map((c) => {
        const lista = conFicha.filter((g) => g.ficha.categorias.includes(c.id));
        if (!lista.length) return "";
        return `
        <details class="nav-cat cat-${c.id}" data-cat="${c.id}">
          <summary class="nav-item" title="${esc(c.titulo)}"><span class="nav-ico">${ico(c.icono)}</span><span class="nav-txt">${esc(c.corto)}</span><span class="n">${lista.length}</span>${ico("right", "chev")}</summary>
          <div class="nav-sub-lista">
            <a class="nav-sub" href="#/categoria/${c.id}" data-ruta="cat-${c.id}">Ver todo</a>
            ${lista.map((g) => `<a class="nav-sub" href="#/guia/${g.id}" data-guia-id="${g.id}">${esc(g.ficha.titulo_corto)}</a>`).join("")}
          </div>
        </details>`;
      }).join("")}
    </div>`;
  // En el panel contraído, un toque en la categoría lleva a su página.
  $$(".nav-cat > summary").forEach((s) => s.addEventListener("click", (ev) => {
    if (document.documentElement.classList.contains("menu-contraido") && innerWidth > 960) {
      ev.preventDefault();
      navegar(`#/categoria/${s.parentElement.dataset.cat}`);
    }
  }));
}

function marcarActivo(partes) {
  const ruta = partes[0] || "inicio";
  const guiaId = partes[0] === "guia" ? partes[1] : null;
  const g = guiaId ? metaGuia(+guiaId) : null;
  const cat = partes[0] === "categoria" ? partes[1] : catDe(g);
  $$(".sidebar .nav-item[data-ruta]").forEach((a) => a.classList.toggle("activo", a.dataset.ruta === ruta));
  $$(".sidebar .nav-sub").forEach((a) => a.classList.toggle("activo",
    (guiaId && a.dataset.guiaId === guiaId) || (partes[0] === "categoria" && a.dataset.ruta === "cat-" + partes[1])));
  if (cat) { const d = $(`.nav-cat[data-cat="${cat}"]`); if (d) d.open = true; }
  const tab = ruta === "categoria" && partes[1] === "guardia" ? "guardia" : ruta === "inicio" ? "inicio" : ruta;
  $$("#tabbar [data-ruta]").forEach((a) => a.classList.toggle("activo", a.dataset.ruta === tab));
}

function abrirMenu() { document.documentElement.classList.add("menu-abierto"); $("#btn-menu").setAttribute("aria-expanded", "true"); }
function cerrarMenu() { document.documentElement.classList.remove("menu-abierto"); $("#btn-menu")?.setAttribute("aria-expanded", "false"); }

// --- Inicio ------------------------------------------------------------------

function saludo() {
  const h = new Date().getHours();
  if (h < 6) return "Buenas noches";
  if (h < 13) return "Buen día";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

function puedeInstalar() {
  const instalada = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  return !instalada && (instalacion.evento || esIOS());
}

function vistaInicio() {
  const { guias, region } = estado.inicio;
  document.title = region ? `Protocolos Clínicos · ${region.nombre}` : "Protocolos Clínicos";
  const conFicha = guias.filter((g) => g.ficha);
  const mes = new Date().getMonth() + 1;
  const temporada = region?.temporadas?.find((t) => t.meses.includes(mes));
  const recientes = leerRecientes().map(metaGuia).filter(Boolean);
  const sugerencias = ["HTA", "Tuberculosis", "Embarazo", "Tos convulsa", "Monóxido", "Derivar"];
  const urgentes = conFicha.filter((g) => g.ficha.categorias.includes("guardia")).flatMap((g) => g.ficha.algoritmos.map((a) => ({ g, a })));
  const herramientas = listaHerramientas();

  vista.innerHTML = `
    <section class="portada">
      <p class="portada-saludo">${saludo()}${region ? ` · ${esc(region.nombre)}` : ""}</p>
      <h1>¿Qué estás atendiendo?</h1>
      <p class="lead">Las guías del Ministerio de Salud, ordenadas para la guardia y el consultorio. Cada dato, con su página original.</p>
      <form class="search search-hero" id="form-hero" role="search" autocomplete="off">
        ${ico("search")}
        <input id="q-hero" type="search" placeholder="Diagnóstico, fármaco, sigla o síntoma" aria-label="Buscar en las guías" spellcheck="false">
      </form>
      <div class="sugerencias">${sugerencias.map((s) => `<a href="#/buscar/${encodeURIComponent(s)}">${esc(s)}</a>`).join("")}</div>
    </section>

    ${puedeInstalar() ? `
    <section class="card instalar-banner">
      <img src="/static/icono-192.png" alt="" width="52" height="52">
      <div><strong>Llevala en el celular</strong><small>Se abre a pantalla completa y funciona sin señal.</small></div>
      <button class="btn btn-primary btn-sm" type="button" data-instalar>Instalar</button>
    </section>` : ""}

    ${temporada ? `
    <section class="temporada card" aria-label="Alerta de temporada">
      <div class="temporada-ico">${ico(mes >= 5 && mes <= 9 ? "snow" : "sun")}</div>
      <div class="temporada-txt"><span class="eyebrow">Esta temporada</span><strong>${esc(temporada.titulo)}</strong><p>${esc(temporada.texto)}</p></div>
      <div class="temporada-links">
        ${temporada.enlaces.filter((l) => l.guia_id).map((l) => `<a class="btn btn-tinte btn-sm" href="#/guia/${l.guia_id}/algoritmos/${esc(l.ancla)}">${esc(l.texto)}</a>`).join("")}
      </div>
    </section>` : ""}

    <section class="seccion">
      <div class="seccion-cab"><h2>Áreas</h2><p>${conFicha.length} protocolos con algoritmos, dosis y puntos clave</p></div>
      <div class="grid-cats">
        ${CATEGORIAS.map((c) => {
          const n = conFicha.filter((g) => g.ficha.categorias.includes(c.id)).length;
          return n ? `
          <a class="cat-tile cat-${c.id}" href="#/categoria/${c.id}">
            <span class="cat-ico">${ico(c.icono)}</span>
            <strong>${esc(c.corto)}</strong>
            <small>${esc(c.desc)}</small>
            <span class="cat-n">${n} ${n === 1 ? "protocolo" : "protocolos"}</span>
          </a>` : "";
        }).join("")}
      </div>
    </section>

    ${urgentes.length ? `
    <section class="seccion">
      <div class="seccion-cab"><h2>Guardia</h2><a class="mas" href="#/categoria/guardia">Ver todo${ico("right")}</a></div>
      <div class="lista">${urgentes.map(({ g, a }) => tarjetaUrgencia(g, a, "guardia")).join("")}</div>
    </section>` : ""}

    ${recientes.length ? `
    <section class="seccion">
      <div class="seccion-cab"><h2>Recientes</h2></div>
      <div class="chips-fila">${recientes.map((g) => `<a class="chip chip-grande" href="#/guia/${g.id}">${esc(nombreGuia(g))}</a>`).join("")}</div>
    </section>` : ""}

    ${herramientas.length ? `
    <section class="seccion">
      <div class="seccion-cab"><h2>Calculadoras y escalas</h2><a class="mas" href="#/herramientas">Ver todas${ico("right")}</a></div>
      <div class="lista">${herramientas.slice(0, 6).map(tarjetaHerramienta).join("")}</div>
    </section>` : ""}

    ${region ? `
    <section class="seccion">
      <div class="seccion-cab"><h2>${esc(region.nombre)}</h2><a class="mas" href="#/region">Teléfonos útiles${ico("right")}</a></div>
      <div class="contexto">${region.contexto.map(tarjetaContexto).join("")}</div>
    </section>` : ""}`;

  $("#form-hero").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const q = $("#q-hero").value.trim();
    if (q) navegar(`#/buscar/${encodeURIComponent(q)}`);
  });
}

const fila = ({ href, icono, cat, titulo, sub }) => `
  <a class="fila ${cat ? "cat-" + cat : ""}" href="${href}">
    <span class="fila-ico">${ico(icono)}</span>
    <span class="fila-txt"><strong>${esc(titulo)}</strong>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
    ${ico("right", "chev")}
  </a>`;

const tarjetaUrgencia = (g, a, cat = catDe(g)) => fila({ href: `#/guia/${g.id}/algoritmos/alg-${a.id}`, icono: "flow", cat, titulo: a.titulo, sub: g.ficha.titulo_corto });

function listaHerramientas() {
  return estado.inicio.guias.filter((g) => g.ficha).flatMap((g) => [
    ...g.ficha.escalas.map((e) => ({ g, tipo: "escala", titulo: e.titulo, href: `#/guia/${g.id}/calcular/esc-${e.id}` })),
    ...(g.ficha.n_calculadoras ? [{ g, tipo: "calculadora", titulo: `Dosis por peso · ${g.ficha.titulo_corto}`, href: `#/guia/${g.id}/calcular` }] : []),
  ]);
}
const tarjetaHerramienta = (h) => fila({ href: h.href, icono: h.tipo === "escala" ? "gauge" : "calc", cat: catDe(h.g), titulo: h.titulo, sub: h.g.ficha.titulo_corto });
const tarjetaContexto = (x) => `
  <div class="card contexto-item"><strong>${esc(x.titulo)}</strong><p>${esc(x.texto)} ${pag(x.guia_id, x.pagina)}</p></div>`;

function cabeceraPagina(icono, titulo, sub, cat = "") {
  return `<header class="pagina-cab ${cat ? "cat-" + cat : ""}"><span class="cat-ico">${ico(icono)}</span><div><h1>${esc(titulo)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div></header>`;
}

function vistaCategoria(id) {
  const c = CATEGORIAS.find((x) => x.id === id);
  if (!c) return vistaInicio();
  const lista = estado.inicio.guias.filter((g) => g.ficha?.categorias.includes(id));
  document.title = `${c.corto} · Protocolos Clínicos`;
  const algos = lista.flatMap((g) => g.ficha.algoritmos.map((a) => ({ g, a })));
  vista.innerHTML = `
    ${cabeceraPagina(c.icono, c.titulo, c.desc, id)}
    <div class="chips-fila" style="margin-top:16px">
      ${CATEGORIAS.map((x) => `<a class="chip ${x.id === id ? "activo" : ""}" href="#/categoria/${x.id}" data-reemplazar>${ico(x.icono)}${esc(x.corto)}</a>`).join("")}
    </div>
    ${id === "guardia" && algos.length ? `
    <section class="seccion">
      <div class="seccion-cab"><h2>Algoritmos</h2></div>
      <div class="lista">${algos.map(({ g, a }) => tarjetaUrgencia(g, a, id)).join("")}</div>
    </section>` : ""}
    <section class="seccion">
      <div class="seccion-cab"><h2>Protocolos</h2><p>${lista.length} ${lista.length === 1 ? "ficha" : "fichas"}</p></div>
      <div class="grid-fichas">${lista.map(tarjetaFicha).join("")}</div>
    </section>`;
}

function vistaHerramientas() {
  document.title = "Calculadoras y escalas · Protocolos Clínicos";
  const h = listaHerramientas();
  const escalas = h.filter((x) => x.tipo === "escala"), calcs = h.filter((x) => x.tipo === "calculadora");
  vista.innerHTML = `
    ${cabeceraPagina("calc", "Calculadoras y escalas", "Cargá el peso una vez y obtené la dosis de cada fármaco según la guía.")}
    <section class="seccion"><div class="seccion-cab"><h2>Dosis por peso</h2></div>
      <div class="lista">${calcs.map(tarjetaHerramienta).join("")}</div></section>
    <section class="seccion"><div class="seccion-cab"><h2>Escalas y puntajes</h2></div>
      <div class="lista">${escalas.map(tarjetaHerramienta).join("")}</div></section>`;
}

function vistaBuscarVacia() {
  document.title = "Buscar · Protocolos Clínicos";
  const ej = ["HTA", "presión alta embarazo", "dosis amoxicilina", "CURB-65", "tos convulsa", "benznidazol", "CO", "derivar EPOC"];
  vista.innerHTML = `
    ${cabeceraPagina("search", "Buscar en las guías", "Funciona sin tildes y entiende siglas: HTA, NAC, ACV, DBT, CO…")}
    <section class="seccion seccion-chica"><div class="chips-fila">${ej.map((s) => `<a class="chip chip-grande" href="#/buscar/${encodeURIComponent(s)}">${esc(s)}</a>`).join("")}</div></section>`;
  setTimeout(() => inputQ.focus(), 50);
}

function vistaBiblioteca() {
  const { guias } = estado.inicio;
  document.title = "Biblioteca · Protocolos Clínicos";
  vista.innerHTML = `
    ${cabeceraPagina("book", "Biblioteca de guías", `${guias.length} documentos oficiales del Ministerio de Salud, indexados para la búsqueda.`)}
    <div class="card biblioteca" style="margin-top:22px">
      ${guias.map((g) => `
        <div class="fila-guia">
          <div class="ico-doc">${ico("book")}</div>
          <div>
            <h4><a href="#/guia/${g.id}">${esc(g.titulo)}</a></h4>
            <small>${[g.tema, g.paginas + (g.paginas === 1 ? " página" : " páginas")].filter(Boolean).map(esc).join(" · ")}</small>
            <div class="fila-badges">${g.ficha ? `<span class="badge badge-algoritmo">${ico("flow")}Ficha rápida</span>${edicion(g.ficha.anio)}` : `<span class="badge">${ico("text")}Solo texto y páginas</span>`}</div>
          </div>
          <div class="acciones">
            <a class="btn btn-sm" href="#/guia/${g.id}">Abrir</a>
            <a class="btn btn-sm btn-ghost" href="${esc(g.url)}" target="_blank" rel="noopener">${ico("external")}PDF</a>
          </div>
        </div>`).join("")}
    </div>`;
}

function vistaRegion() {
  const { region } = estado.inicio;
  if (!region) return vistaInicio();
  document.title = `${region.nombre} · Protocolos Clínicos`;
  vista.innerHTML = `
    ${cabeceraPagina("pin", region.nombre, region.bajada)}
    <div class="aviso aviso-info" style="margin-top:18px">${ico("info")}<span>Cada dato sale de una guía nacional; tocá “fuente” para ver la página. ${esc(region.aviso || "")}</span></div>
    <section class="seccion">
      <div class="region-grid">
        <div class="contexto">${region.contexto.map(tarjetaContexto).join("")}</div>
        <div class="card contactos">
          <h3>${ico("phone")}Teléfonos y referencias</h3>
          <ul>
            ${region.contactos.map((x) => `
              <li>
                <div><strong>${esc(x.nombre)}</strong>${x.detalle ? `<small>${esc(x.detalle)}</small>` : ""}${x.nota ? `<small class="nota">${ico("alert")}${esc(x.nota)}</small>` : ""}</div>
                <div class="contacto-acc">
                  ${x.telefono ? `<a class="btn btn-sm" href="tel:${esc(x.telefono.replace(/[^\d+]/g, ""))}">${ico("phone")}${esc(x.telefono)}</a>` : ""}
                  ${pag(x.guia_id, x.pagina, "fuente")}
                </div>
              </li>`).join("")}
          </ul>
        </div>
      </div>
    </section>`;
}

function tarjetaFicha(g) {
  const f = g.ficha;
  return `
    <div class="card ficha-card ${catDe(g) ? "cat-" + catDe(g) : ""}">
      <a class="ficha-link" href="#/guia/${g.id}">
        <div class="ficha-top"><span class="eyebrow">${esc(f.especialidad || g.tema || "")}</span>${edicion(f.anio)}</div>
        <div><h3>${esc(f.titulo_corto)}</h3><div class="sub">${esc(f.subtitulo || "")}</div></div>
        <p class="resumen">${esc(f.resumen || "")}</p>
      </a>
      <div class="ficha-algos">
        ${f.algoritmos.map((a) => `<a href="#/guia/${g.id}/algoritmos/alg-${a.id}">${ico("flow")}${esc(a.titulo)}${ico("right")}</a>`).join("")}
        ${f.escalas.map((e) => `<a href="#/guia/${g.id}/calcular/esc-${e.id}">${ico("gauge")}${esc(e.titulo)}${ico("right")}</a>`).join("")}
        ${f.n_calculadoras ? `<a href="#/guia/${g.id}/calcular">${ico("calc")}Calcular dosis por peso${ico("right")}</a>` : ""}
        ${f.n_tablas ? `<a href="#/guia/${g.id}/tablas">${ico("table")}Dosis y tablas (${f.n_tablas})${ico("right")}</a>` : ""}
      </div>
    </div>`;
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

function vistaEsquemas() {
  const { esquemas } = estado.inicio;
  document.title = "Esquemas · Protocolos Clínicos";
  const tipos = ["algoritmo", "tabla", "figura"];
  vista.innerHTML = `
    <nav class="migas" aria-label="Ruta"><a href="#/">Inicio</a>${ico("right")}<span>Esquemas</span></nav>
    <header class="guia-cab"><div><h1>Esquemas de las guías</h1><p class="sub">Algoritmos, tablas y figuras detectados en las páginas originales.</p></div></header>
    ${tipos.map((t) => {
      const lista = esquemas.filter((e) => e.tipo === t);
      return lista.length ? `<section class="seccion"><div class="seccion-cab"><h2>${badge(t)} ${lista.length}</h2></div><div class="galeria">${lista.map(miniatura).join("")}</div></section>` : "";
    }).join("")}`;
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
        <p>Probá con menos palabras, una sigla (HTA, NAC, ACV) o el nombre genérico del fármaco.</p>
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
      <h2 class="res-titulo">${ico("flow")}En las fichas rápidas</h2>
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
  const tab = ancla.startsWith("alg-") ? "algoritmos"
    : ancla.startsWith("tab-") ? "tablas"
    : ancla.startsWith("calc-") || ancla.startsWith("esc-") ? "calcular"
    : "esencial";
  return `#/guia/${guiaId}/${tab}/${ancla}`;
}

// --- Vista de guía -------------------------------------------------------------

async function vistaGuia(id, tab, ancla) {
  const g = await cargarGuia(id);
  const f = g.ficha;
  guardarReciente(id);
  const nCalc = (f?.calculadoras?.length || 0) + (f?.escalas?.length || 0);
  const tabs = [
    f && ["esencial", "Lo esencial", "list"],
    f?.algoritmos?.length && ["algoritmos", "Algoritmos", "flow", f.algoritmos.length],
    f?.tablas?.length && ["tablas", "Dosis y tablas", "table", f.tablas.length],
    nCalc && ["calcular", "Calcular", "calc", nCalc],
    g.esquemas.length && ["paginas", "Páginas de la guía", "image", g.esquemas.length],
    ["texto", "Leer la guía", "text"],
  ].filter(Boolean);
  if (tab === "resumen") tab = "esencial";
  if (tab === "calculadora") tab = "calcular";
  if (tab === "esquemas") tab = "paginas";
  if (!tabs.some((t) => t[0] === tab)) tab = tabs[0][0];
  document.title = `${nombreGuia(g)} · Protocolos Clínicos`;
  const vieja = f?.anio && f.anio < ANIO_VIGENCIA;
  vista.className = "contenedor" + (catDe(g) ? " cat-" + catDe(g) : "");

  vista.innerHTML = `
    <nav class="migas" aria-label="Ruta"><a href="#/">Inicio</a>${ico("right")}<span>${esc(f?.titulo_corto || "Guía")}</span></nav>
    <header class="guia-cab">
      <div>
        <div class="ficha-top"><span class="eyebrow">${esc(f?.especialidad || g.tema || "Guía clínica")}</span>${edicion(f?.anio)}</div>
        <h1>${esc(f?.titulo_corto || g.titulo)}</h1>
        ${f?.subtitulo ? `<div class="sub">${esc(f.subtitulo)}</div>` : ""}
        <p class="fuente">Fuente: ${esc(g.titulo)} · ${g.paginas} ${g.paginas === 1 ? "página" : "páginas"}</p>
      </div>
      <div class="acciones">
        <button class="btn" type="button" data-guia="${g.id}" data-pag="1">${ico("file")}Ver guía completa</button>
        <button class="btn" type="button" id="btn-imprimir">${ico("print")}Imprimir</button>
        <a class="btn btn-primary" href="${esc(g.url)}" target="_blank" rel="noopener">${ico("external")}PDF oficial</a>
      </div>
    </header>
    ${vieja ? `<div class="aviso aviso-warn aviso-edicion">${ico("alert")}<span>Esta guía es de ${f.anio}. Puede haber recomendaciones más nuevas: verificá en <a href="https://www.argentina.gob.ar/salud/recursos" target="_blank" rel="noopener">argentina.gob.ar/salud</a> antes de aplicarla.</span></div>` : ""}
    ${!f ? `<div class="aviso aviso-info aviso-edicion">${ico("info")}<span>Esta guía todavía no tiene ficha rápida: podés buscar en su texto y ver sus páginas originales.</span></div>` : ""}
    <nav class="tabs" role="tablist">
      ${tabs.map(([k, label, i, n]) => `<a class="tab ${k === tab ? "activo" : ""}" role="tab" aria-selected="${k === tab}" href="#/guia/${g.id}/${k}" data-reemplazar>${ico(i)}${label}${n ? `<span class="n">${n}</span>` : ""}</a>`).join("")}
    </nav>
    <section class="panel" id="panel"></section>`;

  $("#btn-imprimir").addEventListener("click", () => window.print());
  const panel = $("#panel");
  if (tab === "esencial") panelEsencial(panel, g);
  else if (tab === "algoritmos") panelAlgoritmos(panel, g, ancla);
  else if (tab === "tablas") panelTablas(panel, g);
  else if (tab === "calcular") panelCalcular(panel, g);
  else if (tab === "paginas") panel.innerHTML = `<div class="galeria">${g.esquemas.map((e) => miniatura({ ...e, guia_id: g.id })).join("")}</div>`;
  else await panelTexto(panel, g);

  if (ancla && ancla !== "resumen" && !ancla.startsWith("alg-")) {
    const el = document.getElementById(ancla);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("destello"); }
  }
}

function panelEsencial(panel, g) {
  const f = g.ficha;
  const alertas = (f.listas || []).filter((l) => l.estilo === "alerta");
  const otras = (f.listas || []).filter((l) => l.estilo !== "alerta");
  panel.innerHTML = `
    <div class="esencial-grid">
      <div>
        <div class="card intro">
          <p>${esc(f.resumen)}</p>
          ${f.poblacion ? `<dl><dt>Población</dt><dd>${esc(f.poblacion)}</dd></dl>` : ""}
        </div>
        ${f.claves?.length ? `
          <h2 class="subtitulo">Puntos clave</h2>
          <ol class="claves">${f.claves.map((k) => `<li><div>${esc(k.texto)} ${pag(g.id, k.pagina)}</div></li>`).join("")}</ol>` : ""}
      </div>
      <aside class="esencial-lado">
        ${alertas.map((l) => callout(g.id, l)).join("")}
        <div class="card atajos">
          <h3>Ir directo a</h3>
          ${(f.algoritmos || []).map((a) => `<a href="#/guia/${g.id}/algoritmos/alg-${a.id}">${ico("flow")}${esc(a.titulo)}</a>`).join("")}
          ${(f.escalas || []).map((e) => `<a href="#/guia/${g.id}/calcular/esc-${e.id}">${ico("gauge")}${esc(e.titulo)}</a>`).join("")}
          ${(f.calculadoras || []).map((c) => `<a href="#/guia/${g.id}/calcular/calc-${c.id}">${ico("calc")}${esc(c.titulo)}</a>`).join("")}
          ${(f.tablas || []).slice(0, 5).map((t) => `<a href="#/guia/${g.id}/tablas/tab-${t.id}">${ico("table")}${esc(t.titulo)}</a>`).join("")}
        </div>
      </aside>
    </div>
    ${otras.length ? `<div class="callouts">${otras.map((l) => callout(g.id, l)).join("")}</div>` : ""}`;
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
            <button type="button" data-modo="pasos">${ico("play")}Paso a paso</button>
            <button type="button" data-modo="diagrama">${ico("flow")}Diagrama</button>
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

// Mermaid no acepta rgba(): se compone el color sobre la superficie y se pasa como hex.
const lienzoColor = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
function solido(v) {
  const ctx = lienzoColor;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = css("--surface"); ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = css(v); ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

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
  const c = (fill, stroke) => `fill:${solido(fill)},stroke:${solido(stroke)},color:${solido("--text")},stroke-width:1.2px`;
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
      themeVariables: { fontSize: "14px", lineColor: solido("--muted"), textColor: solido("--text"), edgeLabelBackground: solido("--surface-2"), primaryTextColor: solido("--text") },
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
        ${actual.siguiente ? `<div><button class="btn btn-primary btn-grande" type="button" data-seguir>Continuar${ico("right")}</button></div>` : ""}
        ${terminal ? `<div class="fin">${ico(actual.tipo === "alerta" ? "alert" : "check")}Fin del algoritmo</div>` : ""}
        <div class="paso-pie">
          ${pag(g.id, actual.pagina, "Fuente · pág. " + actual.pagina)}
          ${camino.length > 1 ? `<button class="btn btn-sm btn-ghost" type="button" data-atras>${ico("left")}Paso anterior</button><button class="btn btn-sm btn-ghost" type="button" data-reiniciar>${ico("reset")}Reiniciar</button>` : ""}
        </div>
      </div>
    </div>`;

  const ir = (id, eleccion) => {
    camino[camino.length - 1].eleccion = eleccion;
    camino.push({ id });
    dibujarPasos(cuerpo, g, a);
    if (innerWidth < 820) $(".paso", cuerpo).scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const volverA = (i) => {
    estado.algo.camino = camino.slice(0, i + 1);
    delete estado.algo.camino[estado.algo.camino.length - 1].eleccion;
    dibujarPasos(cuerpo, g, a);
  };
  $$("[data-opcion]", cuerpo).forEach((b) => b.addEventListener("click", () => { const o = actual.opciones[+b.dataset.opcion]; ir(o.ir, o.etiqueta); }));
  $("[data-seguir]", cuerpo)?.addEventListener("click", () => ir(actual.siguiente, null));
  $("[data-atras]", cuerpo)?.addEventListener("click", () => volverA(camino.length - 2));
  $("[data-reiniciar]", cuerpo)?.addEventListener("click", () => { estado.algo.camino = [{ id: a.inicio }]; dibujarPasos(cuerpo, g, a); });
  $$("[data-volver]", cuerpo).forEach((b) => b.addEventListener("click", () => volverA(+b.dataset.volver)));
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

// --- Calcular: escalas y dosis por peso ------------------------------------------

function panelCalcular(panel, g) {
  const f = g.ficha;
  const calcs = f.calculadoras || [];
  panel.innerHTML = `
    ${calcs.length ? `
    <div class="card peso-barra">
      <label for="peso-global">${ico("calc")}Peso del paciente</label>
      <div class="input-peso"><input id="peso-global" inputmode="decimal" placeholder="0" value="${esc(estado.peso)}" autocomplete="off"><span>kg</span></div>
      <small>Se usa en todas las calculadoras de esta pantalla. No se guarda al cerrar la página.</small>
      ${estado.peso ? `<button class="btn btn-sm btn-ghost" type="button" id="peso-borrar">${ico("close")}Borrar</button>` : ""}
    </div>` : ""}
    ${(f.escalas || []).map((e) => `<article class="card escala" id="esc-${e.id}"></article>`).join("")}
    ${calcs.map((c) => `<article class="card calc" id="calc-${c.id}"></article>`).join("")}`;

  (f.escalas || []).forEach((e) => dibujarEscala($(`#esc-${e.id}`, panel), g, e));

  const estados = calcs.map(() => ({ farmaco: 0, grupo: 0 }));
  const renderTodas = () => calcs.forEach((c, i) => dibujarCalculadora($(`#calc-${c.id}`, panel), g, c, estados[i], renderTodas));
  renderTodas();
  const input = $("#peso-global", panel);
  input?.addEventListener("input", () => {
    estado.peso = input.value;
    renderTodas();
    const b = $("#peso-borrar", panel);
    if (!estado.peso && b) b.remove();
  });
  $("#peso-borrar", panel)?.addEventListener("click", () => { estado.peso = ""; panelCalcular(panel, g); });
}

function dibujarEscala(el, g, e) {
  const resp = estado.escalas.get(e.id) || e.items.map(() => null);
  estado.escalas.set(e.id, resp);
  const total = resp.reduce((s, r, i) => s + (r === null ? 0 : e.items[i].opciones[r].puntos), 0);
  const faltan = resp.filter((r) => r === null).length;
  const interp = (e.interpretacion || []).find((x) => total >= x.min && total <= x.max);
  el.innerHTML = `
    <div class="escala-cab">
      <div><h3>${esc(e.titulo)}</h3></div>
      <div class="escala-acc">${pag(g.id, e.pagina)}<button class="btn btn-sm btn-ghost" type="button" data-limpiar>${ico("reset")}Limpiar</button></div>
    </div>
    <div class="escala-cuerpo">
      <ol class="escala-items">
        ${e.items.map((it, i) => `
          <li>
            <span class="escala-preg">${esc(it.texto)}</span>
            <div class="opciones-btn" role="radiogroup" aria-label="${esc(it.texto)}">
              ${it.opciones.map((o, j) => `<button type="button" role="radio" aria-checked="${resp[i] === j}" class="${resp[i] === j ? "activo" : ""}" data-item="${i}" data-op="${j}">${esc(o.texto)}<span class="pts">${o.puntos}</span></button>`).join("")}
            </div>
          </li>`).join("")}
      </ol>
      <div class="escala-res">
        <div class="escala-total"><small>Puntaje</small><strong>${total}</strong>${faltan ? `<span>Faltan ${faltan} respuesta${faltan > 1 ? "s" : ""}</span>` : ""}</div>
        ${!faltan && interp ? `<div class="aviso aviso-${interp.estilo === "danger" ? "danger" : interp.estilo === "warn" ? "warn" : "ok"}">${ico(interp.estilo === "ok" ? "check" : "alert")}<span>${esc(interp.texto)}</span></div>` : ""}
        ${e.nota ? `<p class="ayuda">${ico("info")}${esc(e.nota)}</p>` : ""}
      </div>
    </div>`;
  $$("[data-op]", el).forEach((b) => b.addEventListener("click", () => {
    resp[+b.dataset.item] = +b.dataset.op;
    dibujarEscala(el, g, e);
  }));
  $("[data-limpiar]", el).addEventListener("click", () => { estado.escalas.set(e.id, e.items.map(() => null)); dibujarEscala(el, g, e); });
}

function grupoPorPeso(fx, peso) {
  let elegido = 0;
  fx.grupos.forEach((gr, i) => { if (gr.peso && peso >= gr.peso[0]) elegido = i; });
  return elegido;
}

function dibujarCalculadora(el, g, c, st, render) {
  const fx = c.farmacos[st.farmaco];
  const peso = parseFloat(String(estado.peso).replace(",", "."));
  const pesoOk = peso > 0.3 && peso <= 250;
  if (fx.por_peso && pesoOk) st.grupo = grupoPorPeso(fx, peso);
  const gr = fx.grupos[Math.min(st.grupo, fx.grupos.length - 1)];

  el.innerHTML = `
    <div class="calc-form">
      <div><h3>${esc(c.titulo)}</h3><p>${esc(c.descripcion || "")} ${pag(g.id, c.pagina)}</p></div>
      ${c.farmacos.length > 1 ? `
      <div class="campo"><span class="lbl">Fármaco</span>
        <div class="opciones-btn">${c.farmacos.map((f, i) => `<button type="button" class="${i === st.farmaco ? "activo" : ""}" data-farmaco="${i}">${esc(f.nombre)}</button>`).join("")}</div>
      </div>` : ""}
      ${!fx.por_peso && fx.grupos.length > 1 ? `
      <div class="campo"><span class="lbl">Grupo</span>
        <div class="opciones-btn">${fx.grupos.map((x, i) => `<button type="button" class="${i === st.grupo ? "activo" : ""}" data-grupo="${i}">${esc(x.etiqueta)}</button>`).join("")}</div>
      </div>` : ""}
    </div>
    <div class="calc-res" aria-live="polite">${resultadoCalculo(fx, gr, peso, pesoOk)}</div>`;

  $$("[data-farmaco]", el).forEach((b) => b.addEventListener("click", () => { st.farmaco = +b.dataset.farmaco; st.grupo = Math.min(st.grupo, c.farmacos[st.farmaco].grupos.length - 1); render(); }));
  $$("[data-grupo]", el).forEach((b) => b.addEventListener("click", () => { st.grupo = +b.dataset.grupo; render(); }));
}

function resultadoCalculo(fx, gr, peso, pesoOk) {
  if (fx.por_peso && !pesoOk) {
    return `<p class="ayuda">${ico("info")}Ingresá el peso arriba para calcular ${esc(fx.nombre)}.</p>`;
  }
  if (gr.no_recomendado) {
    return `<div class="aviso aviso-danger">${ico("alert")}<div><strong>${esc(fx.nombre)} · ${esc(gr.etiqueta)}</strong><br>${esc(gr.no_recomendado)}</div></div>`;
  }
  const necesitaPeso = gr.fases.some((f) => f.mgkg);
  if (necesitaPeso && !pesoOk) {
    return `<p class="ayuda">${ico("info")}Ingresá el peso arriba para calcular ${esc(fx.nombre)}${fx.por_peso ? "" : ` (${esc(gr.etiqueta.toLowerCase())})`}.</p>
      ${gr.fases.map((f) => `<div class="fase"><div class="fase-cab"><span>${esc(f.etiqueta)}</span><span>${esc(reglaTexto(f))}</span></div></div>`).join("")}`;
  }
  const avisos = [];
  const rango = (a, b) => (Math.abs(a - b) < 0.05 ? fmt(a) : `${fmt(a)}–${fmt(b)}`);
  const fases = gr.fases.map((f) => {
    const u = f.unidad || "mg";
    let lo, hi, tope = false;
    if (f.fija) { lo = hi = f.fija; }
    else {
      lo = f.mgkg[0] * peso; hi = f.mgkg[1] * peso;
      if (f.max && hi > f.max) { tope = true; hi = f.max; lo = Math.min(lo, f.max); }
    }
    if (tope) avisos.push(`${f.etiqueta} (${fmt(f.max)} ${u})`);
    const intervalo = f.tomas > 1 ? `cada ${24 / f.tomas} h` : f.por === "dosis" ? "" : "dosis única diaria";
    const datos = f.fija && f.tomas === 1
      ? `<div class="fase-dato"><small>Por día</small><strong>${fmt(lo)}<em>${u}</em></strong><div class="det">una toma diaria</div></div>`
      : f.por === "dosis"
      ? `<div class="fase-dato"><small>Dosis</small><strong>${rango(lo, hi)}<em>${u}</em></strong>${f.tomas > 1 ? `<div class="det">${intervalo}</div>` : ""}</div>
         ${f.tomas > 1 ? `<div class="fase-dato"><small>Total diario</small><strong>${rango(lo * f.tomas, hi * f.tomas)}<em>${u}/día</em></strong><div class="det">${f.tomas} dosis</div></div>` : ""}`
      : `<div class="fase-dato"><small>Dosis diaria</small><strong>${rango(lo, hi)}<em>${u}/día</em></strong></div>
         <div class="fase-dato"><small>Por toma</small><strong>${rango(lo / f.tomas, hi / f.tomas)}<em>${u}</em></strong><div class="det">${f.tomas} toma${f.tomas > 1 ? "s" : ""} · ${intervalo}</div></div>`;
    return `
      <div class="fase">
        <div class="fase-cab"><span>${esc(f.etiqueta)}</span><span>${esc(reglaTexto(f))}</span></div>
        <div class="fase-cuerpo">${datos}</div>
      </div>`;
  });
  return `
    <div class="calc-res-cab">
      <strong>${esc(fx.nombre)}</strong>
      <span class="badge">${esc(gr.etiqueta)}${pesoOk && necesitaPeso ? ` · ${fmt(peso)} kg` : ""}</span>
    </div>
    ${fases.join("")}
    ${avisos.length ? `<div class="aviso aviso-warn">${ico("alert")}<span>Se aplicó la dosis máxima de la guía: ${esc(avisos.join(" · "))}.</span></div>` : ""}
    ${gr.nota ? `<div class="aviso aviso-info">${ico("info")}<span>${esc(gr.nota)}</span></div>` : ""}
    <p class="ayuda" style="font-size:12.5px">${ico("info")}Cálculo orientativo según la guía. Ajustar con criterio clínico y presentaciones disponibles.</p>`;
}

function reglaTexto(f) {
  const u = f.unidad || "mg";
  if (f.fija) return `${fmt(f.fija)} ${u}/día`;
  const [a, b] = f.mgkg;
  const por = f.por === "dosis" ? `${u}/kg/dosis` : `${u}/kg/día`;
  return `${a === b ? fmtKg(a) : fmtKg(a) + "–" + fmtKg(b)} ${por}${f.max ? ` · máx. ${fmt(f.max)} ${u}` : ""}`;
}

// --- Texto completo ------------------------------------------------------------------

async function panelTexto(panel, g) {
  panel.innerHTML = `<div class="cargando"><span class="spinner"></span> Cargando texto…</div>`;
  const parrafos = await api(`/api/guia/${g.id}/texto`);
  let html = "", seccion;
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
    <div class="card texto-completo">${html || '<p class="vacio">Este documento es un afiche sin texto: miralo en "Páginas de la guía".</p>'}</div>`;
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

// Menú lateral
$("#btn-menu").addEventListener("click", abrirMenu);
$("#tab-menu").addEventListener("click", () => (document.documentElement.classList.contains("menu-abierto") ? cerrarMenu() : abrirMenu()));
$$("[data-cerrar-menu]").forEach((b) => b.addEventListener("click", cerrarMenu));
$("#btn-contraer").addEventListener("click", () => {
  const c = document.documentElement.classList.toggle("menu-contraido");
  try { localStorage.setItem("menu-contraido", c ? "1" : "0"); } catch (e) {}
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { cerrarMenu(); $("#modal-instalar").hidden = true; } });

// Instalación como app (Android/Chrome: aviso nativo; iPhone: instrucciones)
const instalacion = { evento: null };
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone;
function mostrarBotonInstalar() {
  $("#btn-instalar").hidden = !puedeInstalar();
}
window.addEventListener("beforeinstallprompt", (ev) => {
  ev.preventDefault();
  instalacion.evento = ev;
  mostrarBotonInstalar();
  if (!location.hash || location.hash === "#/") vistaInicio();
});
window.addEventListener("appinstalled", () => { instalacion.evento = null; mostrarBotonInstalar(); });
async function instalar() {
  if (instalacion.evento) {
    instalacion.evento.prompt();
    await instalacion.evento.userChoice.catch(() => {});
    instalacion.evento = null;
    mostrarBotonInstalar();
    return;
  }
  const ios = esIOS();
  $("#pasos-instalar").innerHTML = ios
    ? `<li><span>Abrí esta página en <strong>Safari</strong>.</span></li>
       <li><span>Tocá <strong>Compartir</strong> ${ico("share")} en la barra de abajo.</span></li>
       <li><span>Elegí <strong>Agregar a inicio</strong> y confirmá con <strong>Agregar</strong>.</span></li>`
    : `<li><span>Abrí el menú del navegador ${ico("dots")} (arriba a la derecha).</span></li>
       <li><span>Elegí <strong>Instalar app</strong> o <strong>Agregar a la pantalla principal</strong>.</span></li>
       <li><span>Confirmá: el ícono aparece junto a tus otras apps.</span></li>`;
  $("#modal-instalar").hidden = false;
}
document.addEventListener("click", (ev) => {
  if (ev.target.closest("#btn-instalar, [data-instalar]")) { ev.preventDefault(); cerrarMenu(); instalar(); }
  if (ev.target.closest("[data-cerrar-modal]")) $("#modal-instalar").hidden = true;
});
mostrarBotonInstalar();

// Uso sin conexión: guarda la app y lo que se va consultando.
const avisoOffline = $("#aviso-offline");
const actualizarConexion = () => { avisoOffline.hidden = navigator.onLine; };
window.addEventListener("online", actualizarConexion);
window.addEventListener("offline", actualizarConexion);
actualizarConexion();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

window.addEventListener("hashchange", router);
router();
