/* BuffetQR service worker.
 * Cache the anonymous SSR documents and versioned static assets only.
 * Never intercept API calls, Supabase traffic, or non-GET requests.
 */
const VERSION = "v3";
const SHELL_CACHE = `buffetqr-shell-${VERSION}`;
const PAGE_CACHE = `buffetqr-pages-${VERSION}`;
const ASSET_CACHE = `buffetqr-assets-${VERSION}`;
const OWNED_CACHES = [SHELL_CACHE, PAGE_CACHE, ASSET_CACHE];
const PRECACHE = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];
const MAX_PAGES = 25;
const MAX_ASSETS = 120;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith("buffetqr-") && !OWNED_CACHES.includes(key))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "PURGE_CACHED_PAGES") {
    event.waitUntil(caches.delete(PAGE_CACHE));
  }
});

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
  }
}

async function fetchWithTimeout(request, timeoutMs = 4000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // SSR documents are rendered anonymously. Cache only successful HTML that
  // is not explicitly private/no-store; never cache API or server-function data.
  if (request.mode === "navigate") {
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_serverFn/")) return;
    event.respondWith((async () => {
      try {
        const response = await fetchWithTimeout(request);
        const contentType = response.headers.get("content-type") || "";
        const cacheControl = response.headers.get("cache-control") || "";
        if (
          response.ok &&
          contentType.includes("text/html") &&
          !/private|no-store/i.test(cacheControl)
        ) {
          const cache = await caches.open(PAGE_CACHE);
          await cache.put(request, response.clone());
          await trimCache(PAGE_CACHE, MAX_PAGES);
        }
        return response;
      } catch {
        const cachedPage = await caches.match(request, { cacheName: PAGE_CACHE, ignoreSearch: true });
        if (cachedPage) return cachedPage;
        const shell = await caches.match("/", { cacheName: SHELL_CACHE });
        if (shell) return shell;
        return new Response(
          "<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>BuffetQR offline</title><body style='font:16px system-ui;padding:2rem;background:#fbf9f4;color:#0f3a31'><h1>BuffetQR</h1><p>This device is offline and the app shell is not yet cached. Connect once and reopen BuffetQR.</p></body></html>",
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }
    })());
    return;
  }

  // Cache same-origin build assets and app icons only. Do not cache API,
  // auth, Supabase, or arbitrary dynamic responses.
  const isBuildAsset = url.pathname.startsWith("/assets/") || url.pathname.startsWith("/_build/");
  const isIcon = /^\/icon(-192|-512)?\.png$/.test(url.pathname) || url.pathname === "/icon.svg";
  if (isBuildAsset || isIcon) {
    event.respondWith((async () => {
      const cache = await caches.open(isIcon ? SHELL_CACHE : ASSET_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && (isIcon || ["script", "style", "font", "image", "worker"].includes(request.destination))) {
        await cache.put(request, response.clone());
        if (!isIcon) await trimCache(ASSET_CACHE, MAX_ASSETS);
      }
      return response;
    })());
  }
});
