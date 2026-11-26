import { useEffect } from "react";

/* Register the worker on every route, including the login screen. */
export default function PwaSetup() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;

    let cancelled = false;
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        await navigator.serviceWorker.ready;
        if (cancelled) return;

        // The first document's assets loaded before the worker controlled it.
        // Hand those same-origin, fingerprinted build assets to the worker so
        // a device can reopen the app after its first successful online visit.
        const urls = performance
          .getEntriesByType("resource")
          .map((entry) => {
            try {
              const url = new URL(entry.name);
              return url.origin === location.origin ? url.pathname : null;
            } catch {
              return null;
            }
          })
          .filter((path) => path && (path.startsWith("/assets/") || path.startsWith("/_build/")));

        const worker = navigator.serviceWorker.controller || registration.active;
        worker?.postMessage({ type: "PRECACHE_ASSETS", urls });
      } catch {
        // PWA support is progressive; the online app remains usable if registration fails.
      }
    };

    if (document.readyState === "complete") void register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => {
        cancelled = true;
        window.removeEventListener("load", register);
      };
    }

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
