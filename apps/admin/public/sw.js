// CheqPay Admin service worker.
//
// Two jobs: show the alerts the backend pushes (a gift card waiting for
// review, say) and open the right page when one is tapped; and, in the
// installed app, show a friendly page instead of the browser's error when
// there's no connection. Nothing else is cached: admin data is always live.

const CACHE = "cheqpay-admin-v1";
const OFFLINE = "/pwa/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll([OFFLINE, "/pwa/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// Page loads go to the network as always; only when that fails is the offline
// page shown. API calls and assets are never touched.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "CheqPay Admin", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "CheqPay Admin", {
      body: data.body || "",
      icon: "/pwa/icon-192.png",
      badge: "/pwa/badge-96.png",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/dashboard", self.location.origin);
  // Only ever our own pages.
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      // Reuse an open dashboard window when there is one; a window this worker
      // doesn't control can't be navigated, so then open a new one instead.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin !== url.origin || !("navigate" in w)) continue;
        const moved = await w.navigate(url.href).catch(() => null);
        if (moved) {
          await moved.focus().catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
