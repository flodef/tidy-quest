// v3 : purge l'ancien manifest/icônes servis en cache-first (jamais mis à jour).
const SHELL_CACHE = "mq-shell-v3";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => clients.claim()),
  ),
);

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Tidy Quest", {
      body: data.body ?? "",
      icon: data.icon ?? "/icon-192.png",
      badge: "/icon-192.png",
      // Tag par compte/source : les notifications ne s'écrasent que si elles
      // viennent de la même boîte.
      tag: data.tag ?? "tidy-quest",
      renotify: true,
      data: { url: "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Met au premier plan l'app déjà ouverte plutôt que d'empiler les fenêtres.
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const target = event.notification.data?.url ?? "/";
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) return w.focus();
      }
      return clients.openWindow(target);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Les mutations sont gérées par l'outbox localStorage de la page.
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Navigation : réseau d'abord, shell en cache si hors-ligne.
  // Seule la racine "/" est mise en cache — sinon une visite de /login
  // écraserait le shell offline avec la page de connexion.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok && url.pathname === "/") {
            const clone = r.clone();
            caches.open(SHELL_CACHE).then((c) => c.put("/", clone));
          }
          return r;
        })
        .catch(() => caches.match("/").then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Manifest + icônes : URLs NON versionnées → réseau d'abord (cache en
  // secours hors-ligne). En cache-first, une mise à jour du manifest
  // (ex. launch_handler) n'aurait jamais été vue par le navigateur.
  if (url.pathname === "/manifest.webmanifest" || url.pathname.startsWith("/icon")) {
    event.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok) {
            const clone = r.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, clone));
          }
          return r;
        })
        .catch(() => caches.match(req).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Assets immutables (chunks hashés Next.js) : cache d'abord.
  if (url.pathname.startsWith("/_next/static")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((r) => {
            if (r.ok) {
              const clone = r.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(req, clone));
            }
            return r;
          }),
      ),
    );
  }
});
