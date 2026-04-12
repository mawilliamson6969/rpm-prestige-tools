/**
 * RPM Prestige — minimal service worker: precaches app shell routes and caches
 * Next.js static chunks on use (stale-while-revalidate) for offline dashboard shell.
 */
const CACHE_VERSION = "rpm-prestige-shell-v1";
const SHELL_PATHS = ["/", "/login", "/dashboard"];

function shellUrl(path) {
  return new URL(path, self.registration.scope).href;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await Promise.all(
        SHELL_PATHS.map(async (path) => {
          try {
            const req = new Request(shellUrl(path), { credentials: "same-origin" });
            const res = await fetch(req, { cache: "reload" });
            if (res.ok) await cache.put(req, res);
          } catch {
            /* offline during install — skip */
          }
        })
      );
    })()
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") return;

  /* Next.js static assets: stale-while-revalidate */
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => undefined);
        return (await networkPromise) || cached || Promise.reject(new Error("offline"));
      })()
    );
    return;
  }

  /* HTML navigations: network-first, fall back to cached shell */
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res.ok) {
            const cache = await caches.open(CACHE_VERSION);
            await cache.put(request, res.clone());
          }
          return res;
        } catch {
          const cache = await caches.open(CACHE_VERSION);
          const path = new URL(request.url).pathname;
          const exact = new Request(shellUrl(path), { credentials: "same-origin" });
          const home = new Request(shellUrl("/"), { credentials: "same-origin" });
          return (await cache.match(exact)) || (await cache.match(home)) || Response.error();
        }
      })()
    );
  }
});
