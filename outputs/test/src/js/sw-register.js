// sw-register.js -- registers the stale-while-revalidate service worker (src/sw.js,
// deployed alongside index.html as ./sw.js). Embedded into index.html via
// field_map.qmd.
//
// Client half of bug #6 ("app loads an old version on reopen"). The worker serves
// the shell from cache and revalidates in the background; this script installs it
// and, on every open / foreground, asks the browser to check for a newer build so
// the revalidation happens promptly. It does NOT force a reload -- a new build
// applies on the next launch, so it can never interrupt a tech mid-entry.
//
// Defensive: no-ops on browsers without service workers and on file:// previews,
// and never touches IndexedDB, so offline API data is unaffected. Registration
// failure (e.g. no ./sw.js on the host yet) is swallowed -- the app still works.

(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;
  if (window.location.protocol === "file:") return;

  window.addEventListener("load", function () {
    // Relative path: resolves to <app folder>/sw.js on GitHub Pages
    // (.../outputs/nest_app_api/sw.js), so the scope is this app only.
    navigator.serviceWorker.register("sw.js").then(function (reg) {

      // Check for a newer deployed build on open and whenever the app returns to
      // the foreground (an Add-to-Home-Screen reopen fires visibilitychange /
      // pageshow rather than a fresh page load). The worker's SWR strategy then
      // refreshes the cached shell, which the next launch will serve.
      function checkForUpdate() {
        reg.update().catch(function () { /* offline/transient: try next open */ });
      }
      checkForUpdate();
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") checkForUpdate();
      });
      window.addEventListener("pageshow", function (e) {
        if (e.persisted) checkForUpdate();
      });
    }).catch(function () { /* no ./sw.js yet: app still works */ });
  });
})();
