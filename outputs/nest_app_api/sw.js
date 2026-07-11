/* sw.js -- stale-while-revalidate service worker for the nest_app_api field PWA.
 *
 * Bug #6: the app is a single self-contained index.html on GitHub Pages, added to
 * the home screen. With no service worker the mobile browser could serve an
 * unpredictably stale build on reopen (old JS in the field). This worker serves
 * the app shell INSTANTLY from cache (fast launch + real offline) while
 * revalidating in the background, so the newest deploy is picked up on the NEXT
 * launch. It bounds staleness to at most one relaunch and never blocks on the
 * network.
 *
 * Deployed NEXT TO index.html (.../outputs/nest_app_api/sw.js), so its scope is
 * this app folder only -- it does not affect the sibling non-API app.
 *
 * The REST API is a DIFFERENT origin (snednestudy.duckdns.org), so it is never
 * intercepted here -- API calls always hit the network, and their offline copy
 * lives in IndexedDB (nestapi_store.js). External map tiles (also cross-origin)
 * likewise pass straight through.
 *
 * No forced reload: a background update never interrupts a tech mid-entry; the
 * new build simply loads next time. To force everyone onto a new build sooner
 * (e.g. to drop a bad cache), bump SW_VERSION -- any change installs a fresh
 * worker and a fresh, empty cache.
 */
"use strict";

var SW_VERSION = "v2";
var CACHE = "nestapp-shell-" + SW_VERSION;

// Install: best-effort precache of the shell, then activate immediately.
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.add(
        new Request(self.registration.scope, { cache: "reload" })
      ).catch(function () { /* offline at install: filled on first online nav */ });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// Activate: drop caches from older SW_VERSIONs, take control.
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Fetch: same-origin GETs -> stale-while-revalidate. Everything else (writes,
// the cross-origin API, external tiles) is left untouched (goes to network).
self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  event.respondWith(staleWhileRevalidate(req));
});

function staleWhileRevalidate(req) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(req).then(function (cached) {
      var networked = fetch(req).then(function (resp) {
        // Only cache complete, same-origin 200s.
        if (resp && resp.status === 200 &&
            (resp.type === "basic" || resp.type === "default")) {
          cache.put(req, resp.clone()).catch(function () {});
        }
        return resp;
      }).catch(function () {
        return cached;   // offline: fall back to whatever we cached
      });
      // Serve cache instantly when present; revalidate in the background.
      return cached || networked;
    });
  });
}
