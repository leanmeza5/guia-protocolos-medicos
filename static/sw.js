// Service worker: permite seguir consultando sin conexión (por ejemplo en zonas
// rurales con mala señal). Guarda la interfaz al instalarse y, después, cada
// ficha, página e imagen que se abre.

const VERSION = "protocolos-v3";
const BASE = ["/", "/static/styles.css", "/static/app.js", "/static/icono-192.png", "/static/icono-512.png", "/static/apple-touch-icon.png", "/manifest.webmanifest", "/api/inicio"];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(VERSION).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function primeroRed(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(req)) || (req.mode === "navigate" ? cache.match("/") : Response.error());
  }
}

async function primeroCache(req) {
  const cache = await caches.open(VERSION);
  const guardado = await cache.match(req);
  if (guardado) return guardado;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Imágenes de páginas y librerías externas (diagramas, tipografía): no cambian.
  if (url.pathname.startsWith("/api/pagina/") || url.hostname.endsWith("jsdelivr.net") || url.hostname.includes("fonts.g")) {
    ev.respondWith(primeroCache(req));
  } else if (url.origin === location.origin) {
    // Interfaz y datos: siempre la versión más nueva si hay red.
    ev.respondWith(primeroRed(req));
  }
});
