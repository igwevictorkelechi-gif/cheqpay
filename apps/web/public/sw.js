/* CheqPay service worker — minimal, network-first to avoid stale deploys. */

// v2: v1 could store a non-HTML response as the app shell (see below). Bumping
// the name is what evicts a poisoned entry from browsers that already have one
// — the activate handler deletes every cache whose key is not the current
// CACHE. Without the bump those users keep being served the bad shell.
// v3: adds push notifications (no change to what is cached).
const CACHE = "cheqpay-shell-v3";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add("/")));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // App navigations: try the network, fall back to the cached shell offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only ever store a genuine shell. This used to cache whatever any
          // navigation returned under the key "/", so navigating to
          // /crypto/index.txt — which is where Next sends the browser when an
          // RSC prefetch fails — put a text/plain payload in as the app shell,
          // to be served on the next offline load. Three things have to hold:
          // it is the shell's own URL, the response is not an error, and it is
          // actually HTML.
          const isShell =
            new URL(req.url).pathname === "/" &&
            res.ok &&
            (res.headers.get("content-type") || "").includes("text/html");
          if (isShell) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || Response.error()))
    );
  }
});

// ---- Push notifications ----------------------------------------------------
//
// The API encrypts each notification to this browser's subscription; the
// browser wakes this worker with it. We show it, and on tap open the page it
// points at — only ever a path on this site, whatever the payload says.

const MONEY = new Set(["deposits", "withdrawals", "trades", "bills"]);

function safePath(url, category) {
  if (typeof url === "string" && /^\/(?!\/|\\)/.test(url)) return url;
  return MONEY.has(category) ? "/transactions/" : "/";
}

self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { title: "CheqPay", body: event.data ? event.data.text() : "" };
  }
  const title = typeof msg.title === "string" && msg.title ? msg.title : "CheqPay";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof msg.body === "string" ? msg.body : "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: msg.category || "cheqpay",
      data: { url: safePath(msg.url, msg.category) },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          w.navigate(target).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
