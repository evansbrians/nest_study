// nestapi_wiring.js -- Settings screen + async boot data-load + live sync.
//
// The glue between the field app's globals and the REST API client
// (window.NestApi.*). Runs at end of body, after page_glue.js, so the app's
// globals and DOM already exist.
//
// Every effect is gated on NestApi.settings.hasCreds(): with no token stored
// this file wires only the Settings inputs and otherwise no-ops. Exposes a
// window.NestApiWiring surface the app IIFE calls into (e.g. cacheNest).
(function () {
  "use strict";

  if (!window.NestApi || !NestApi.settings) return; // client layer not loaded

  var api = NestApi.api;
  var settings = NestApi.settings;
  var store = NestApi.store;
  var queue = NestApi.queue;
  var sync = NestApi.sync;

  // ---- Settings screen --------------------------------------------------

  function $(id) { return document.getElementById(id); }

  function setStatus(msg) {
    var el = $("settingsStatus");
    if (el) el.textContent = msg || "";
  }

  // Reflect whether creds are configured, in the status line. Once the first
  // data load has completed, say "connected" (the long-poll then runs quietly
  // in the background) rather than a perpetual "syncing…" that reads as stuck.
  function reflectCreds() {
    if (settings.hasCreds()) {
      if (loadedOnce) {
        setStatus("Connected to " + settings.getUrl() + " · live updates on.");
      } else {
        setStatus("API token set — connecting to " + settings.getUrl() + "…");
      }
    } else {
      // The token is mandatory (no legacy fallback remains); promptForToken
      // is shown until one is entered.
      setStatus("No API token set — enter your token to connect.");
    }
  }

  function wireSettings() {
    var urlEl = $("apiUrl");
    var tokEl = $("apiToken");
    var saveBtn = $("settingsSaveBtn");
    if (urlEl) urlEl.value = settings.getUrl();
    if (tokEl) tokEl.value = settings.getToken();
    reflectCreds();
    if (!saveBtn) return;
    saveBtn.addEventListener("click", function () {
      if (urlEl && urlEl.value.trim()) settings.setUrl(urlEl.value.trim());
      if (tokEl) settings.setToken(tokEl.value.trim());
      reflectCreds();
      if (settings.hasCreds()) {
        setStatus("Saved. Loading data from the API…");
        // Flush anything queued while offline/unconfigured, then (re)boot.
        flushQueue().then(bootDataLoad).then(startSync).catch(function (e) {
          setStatus("Saved, but the initial sync failed: " +
            ((e && e.message) || "unknown error") + ". Using cached/built-in data.");
        });
      }
    });
  }

  // ---- IndexedDB cache helpers ------------------------------------------

  function cacheNest(nest) {
    if (!store || !nest || !nest.nest_id) return;
    store.put("nests", nest).catch(function () {});
  }

  function cachePut(storeName, rows, keyFn) {
    if (!store || !rows || !rows.length) return Promise.resolve();
    return Promise.all(rows.map(function (r) {
      return store.put(storeName, r).catch(function () {});
    }));
  }

  // Reconcile the persistent nests cache against the authoritative server set:
  // delete any cached nest the server no longer returns, so a nest deleted on
  // the server (or from another device) stops resurfacing here on the next boot
  // or offline load. cachePut alone was upsert-only, so deletions never
  // propagated and a removed nest lingered in IndexedDB until a reinstall.
  // Nests still referenced by a pending offline op (an unsynced create/edit,
  // keyed by the queue op's tempId) are preserved, so reconciling never drops
  // local work that has not reached the server yet.
  function reconcileNests(serverNests) {
    if (!store || !Array.isArray(serverNests)) return Promise.resolve();
    var keep = Object.create(null);
    serverNests.forEach(function (n) {
      if (n && n.nest_id) keep[n.nest_id] = true;
    });
    return store.getAll("queue").catch(function () { return []; })
      .then(function (ops) {
        (ops || []).forEach(function (op) {
          if (op && op.tempId) keep[op.tempId] = true;
        });
        return store.getAll("nests");
      })
      .then(function (cached) {
        return Promise.all((cached || []).map(function (n) {
          return (n && n.nest_id && !keep[n.nest_id])
            ? store.del("nests", n.nest_id).catch(function () {})
            : null;
        }));
      })
      .catch(function () {});
  }

  // ---- Live "today" filter (rebuild fieldToday from the schedule) --------

  // The map's today-filter reads window.fieldToday.patches, rebuilt from the
  // live schedule rows. That is all it carries: per-marker opacity rides on
  // each marker's v_map_point row, so no fade map here can go stale.

  function _todayIso() {
    var n = new Date();
    return n.getFullYear() + "-" +
      ("0" + (n.getMonth() + 1)).slice(-2) + "-" +
      ("0" + n.getDate()).slice(-2);
  }

  // Fetch the week that contains TODAY (not MAX(week)): pushing next week's
  // schedule early must not blank today on every device. Falls back to the
  // newest week only if today has no row (e.g. before the season starts).
  function fetchSchedule() {
    return api.getSchedule({ date: _todayIso() }).catch(function () {
      return api.getSchedule().catch(function () { return null; });
    });
  }

  // Monotonic sequence so a later LIVE schedule render always beats an earlier
  // one and any cache render (see renderSchedule precedence in nestapi_schedule).
  var _scheduleSeq = 0;

  // Render the last-cached schedule from IndexedDB when the live fetch fails,
  // so the screen shows the most recent known week instead of a blank page.
  // Tagged {cache:true} so it can never overwrite a live render.
  function renderScheduleFromCache() {
    if (!store) return;
    store.getMeta("scheduleRows").then(function (cached) {
      if (!Array.isArray(cached) || !cached.length) return;
      window.fieldScheduleRows = cached;
      if (typeof window.fieldRenderSchedule === "function") {
        try { window.fieldRenderSchedule(cached, { cache: true }); } catch (e) {}
      }
      refreshTodayFromSchedule();
    }).catch(function () {});
  }

  // Field day flag, matching nestapi_schedule.js isFieldDay().
  function _isFieldRow(r) {
    return !!r && (r.field === true || String(r.field) === "TRUE");
  }

  // ---- The map's markers, straight from the DB (GET /map_points) ----------

  // The map's markers ARE these rows (GET /map_points -> the v_map_point view).
  // renderMapPoints() draws them; nothing here re-derives any of it. Errors are
  // logged, not swallowed -- a silent catch here cost a long debugging session.
  function applyMapPoints(rows) {
    if (!Array.isArray(rows) || !rows.length) return false;
    window.fieldMapMarkers = rows;
    if (typeof window.fieldRenderMapPoints === "function") {
      try { window.fieldRenderMapPoints(); } catch (e) {
        if (window.console) console.error("renderMapPoints failed:", e);
      }
    }
    return true;
  }

  // Fetch the markers and draw them. Cache-backed: a later launch redraws from
  // IndexedDB offline (the first offline launch is bare -- accepted trade).
  // Exposed so a local write can redraw at once, not on the next poll.
  function loadMapPoints() {
    return api.getMapPoints().then(function (rows) {
      if (!applyMapPoints(rows)) return false;
      if (store) store.setMeta("mapPoints", rows).catch(function () {});
      return true;
    }).catch(function (err) {
      if (window.console) {
        console.warn("GET /map_points failed (" +
          ((err && err.status) || "network") + "): " +
          ((err && err.message) || err) + " -- falling back to cache.");
      }
      if (!store) return false;
      return store.getMeta("mapPoints").then(function (cached) {
        return applyMapPoints(cached);
      }).catch(function () { return false; });
    });
  }

  // Rebuild window.fieldToday from fieldScheduleRows for today's local date.
  // "Today's patches" is the UNION of the day's point-count patches and its
  // nest-search patches: a patch searched but not counted is still today.
  //
  // Values stay RAW (not prettified) so they match fieldPatches keys and the
  // dropdown values. If today is not a field day, advance to the next one so
  // the map never blanks. Returns true if it updated fieldToday.
  function rebuildFieldToday() {
    var rows = window.fieldScheduleRows;
    if (!Array.isArray(rows) || !rows.length) return false; // keep baked value

    var iso = _todayIso();
    var byDate = Object.create(null);
    var dates = [];
    rows.forEach(function (r) {
      if (!_isFieldRow(r)) return;
      var d = r && r.date;
      if (!d) return;
      d = String(d);
      if (!byDate[d]) { byDate[d] = []; dates.push(d); }
      byDate[d].push(r);
    });
    if (!dates.length) return false;

    var pick = byDate[iso] ? iso : null;
    if (pick === null) {
      dates.sort();
      for (var i = 0; i < dates.length; i++) {
        if (dates[i] >= iso) { pick = dates[i]; break; }
      }
      if (pick === null) return false; // whole schedule is in the past
    }

    var patches = [];
    var seen = Object.create(null);
    function addPatch(p) {
      if (p === null || p === undefined) return;
      var s = String(p).trim();
      if (s === "" || s === "-" || seen[s]) return;
      seen[s] = true;
      patches.push(s);
    }
    byDate[pick].forEach(function (r) {
      if (!r) return;
      addPatch(r.patch_count);
      addPatch(r.search_patch_1);
      addPatch(r.search_patch_2);
    });

    // patches drive the today-subset (hide/show). Per-marker opacity is NOT
    // here any more: it rides on each marker's v_map_point row (opacityFor).
    window.fieldToday = { date: pick, patches: patches };
    // The patch dropdown + Nests-page "today" flags are built from this, and it
    // is no longer baked -- so tell them it now exists / just changed.
    try {
      window.dispatchEvent(new Event("fieldtoday:changed"));
    } catch (e) {}
    return true;
  }

  // Re-broadcast the current filter state (switch + dropdown) so the listeners
  // re-read the fresh window.fieldToday and re-filter. Defaults mirror the app:
  // switch on, dropdown "__all__".
  function rebroadcastFilterState() {
    var toggle = document.getElementById("todayToggle");
    var on = toggle ? !!toggle.checked : true;
    var sel = document.getElementById("patchSelect");
    var name = (sel && sel.value) || "__all__";
    try { window.postMessage({ type: "setToday", on: on }, "*"); } catch (e) {}
    try { window.postMessage({ type: "setPatch", name: name }, "*"); } catch (e) {}
  }

  // Rebuild + re-broadcast in one call, guarded. No-op (baked value kept) when
  // the schedule is empty/absent.
  function refreshTodayFromSchedule() {
    try {
      if (rebuildFieldToday()) rebroadcastFilterState();
    } catch (e) {}
  }

  // ---- Boot data load ---------------------------------------------------

  var loadedOnce = false;
  var _probedLookups;   // one-shot: auth-probe lookups handed to the next bootDataLoad

  // Fetch lookups / nests / gps_points / predator cameras, cache them, populate
  // the globals, re-render. Non-blocking; on a network failure it falls back to
  // the IndexedDB cache.
  //
  // The schedule loads INDEPENDENTLY of the heavier nests/gps batch, which used
  // to delay it by seconds via Promise.all. Cache-first: show the last-known
  // week instantly, then overwrite when the live fetch lands.
  function loadSchedule() {
    // Seed the giraffe lookup (fieldApiNests) from the nests cache first, so the
    // schedule's selfie-stick marks show with the cache-first render instead of
    // waiting on the slow getNests in the boot batch. bootDataLoad refreshes.
    var seed = (store && !(Array.isArray(window.fieldApiNests) && window.fieldApiNests.length))
      ? store.getAll("nests").then(function (cached) {
          if (Array.isArray(cached) && cached.length &&
              !(Array.isArray(window.fieldApiNests) && window.fieldApiNests.length)) {
            window.fieldApiNests = cached;
          }
        }).catch(function () {})
      : Promise.resolve();

    return seed.then(function () {
      renderScheduleFromCache();
      return fetchSchedule();
    }).then(function (sched) {
      if (!Array.isArray(sched) || !sched.length) return;
      window.fieldScheduleRows = sched;
      if (store) store.setMeta("scheduleRows", sched).catch(function () {});
      if (typeof window.fieldRenderSchedule === "function") {
        try { window.fieldRenderSchedule(sched, { seq: ++_scheduleSeq }); } catch (e) {}
      }
      refreshTodayFromSchedule();
    }).catch(function () {});
  }

  function bootDataLoad() {
    if (!settings.hasCreds()) return Promise.resolve();
    setStatus("Loading data from the API…");

    // Schedule loads on its own timeline (see loadSchedule); do not gate it on
    // the batch below.
    loadSchedule();

    // Reuse the auth-probe's lookups (loadWithToken) once, so boot doesn't fetch
    // /lookups twice. Consumed here, then cleared.
    var lookupsJob;
    if (_probedLookups !== undefined) {
      lookupsJob = Promise.resolve(_probedLookups);
      _probedLookups = undefined;
    } else {
      lookupsJob = api.getLookups().catch(function () { return null; });
    }

    var jobs = [
      lookupsJob,
      api.getNests({}).catch(function () { return null; }),  // all nests (map fades non-current)
      api.getGpsPoints().catch(function () { return null; }),
      api.getPredatorCameras().catch(function () { return null; }),
      api.getTracks().catch(function () { return null; })
    ];

    return Promise.all(jobs).then(function (res) {
      var lookups = res[0], nests = res[1], gps = res[2], cams = res[3],
        tracks = res[4];
      var gotAnything = false;

      // Merge shared tracks into the local track store so previously-recorded
      // tracks (from any device) show in the Track manager.
      if (Array.isArray(tracks) && typeof window.fieldMergeApiTracks === "function") {
        try { window.fieldMergeApiTracks(tracks); } catch (e) {}
      }

      // Lookups -> in-page vocab globals (best-effort; the app also has baked
      // fallbacks). Cache each vocabulary under its name.
      if (lookups) {
        gotAnything = true;
        applyLookups(lookups);
        if (store) {
          Object.keys(lookups).forEach(function (k) {
            store.put("lookups", { name: k, value: lookups[k] }).catch(function () {});
          });
        }
      }

      if (Array.isArray(nests)) {
        gotAnything = true;
        window.fieldApiNests = nests;
        cachePut("nests", nests);
        reconcileNests(nests);
        // The schedule renders independently (cache-first) and may have painted
        // BEFORE nests arrived, so its selfie-stick giraffes -- which come from
        // fieldApiNests -- were missing. Re-render now that nests are here.
        if (Array.isArray(window.fieldScheduleRows) && window.fieldScheduleRows.length &&
            typeof window.fieldRenderSchedule === "function") {
          try { window.fieldRenderSchedule(window.fieldScheduleRows); } catch (e) {}
        }
      }

      if (gps && gps.features) {
        gotAnything = true;

        // GET /gps_points exists ONLY to restore waypoints now: markers come
        // from GET /map_points. The waypoint store needs raw props (colour,
        // datetime, nav_photo_name) the v_map_point view does not carry.

        if (store) store.setMeta("gpsPointsFC", gps).catch(function () {});

        if (typeof window.fieldMergeApiWaypoints === "function") {
          try { window.fieldMergeApiWaypoints(gps); } catch (e) {}
        }
      }

      if (Array.isArray(cams)) {
        gotAnything = true;
        window.fieldPredatorCameras = cams;
        if (store) store.setMeta("predatorCameras", cams).catch(function () {});
      }


      if (!gotAnything) return loadFromCache();

      // Marker styling (opacity / size) comes from the DB view. Fire-and-forget:
      // it re-broadcasts the filter state itself, so a slow response simply
      // restyles a moment later rather than holding up the boot.
      loadMapPoints();

      reRender();
      loadedOnce = true;
      reflectCreds();
    }).catch(function () {
      return loadFromCache();
    });
  }

  // Offline / total-failure fallback: rebuild the globals from IndexedDB. If
  // nothing is cached, leave the baked globals in place (best available).
  function loadFromCache() {
    if (!store) { reflectCreds(); return Promise.resolve(); }
    setStatus("Offline — loading the last cached data…");
    return Promise.all([
      store.getMeta("gpsPointsFC").catch(function () { return null; }),
      store.getAll("nests").catch(function () { return null; }),
      store.getMeta("predatorCameras").catch(function () { return null; }),
      store.getMeta("scheduleRows").catch(function () { return null; })
    ]).then(function (res) {
      var fc = res[0], nests = res[1], cams = res[2], sched = res[3];

      // Waypoints only: the cached mapPoints rows (restored below) are what
      // the markers are drawn from.

      if (fc && fc.features && typeof window.fieldMergeApiWaypoints === "function") {
        try { window.fieldMergeApiWaypoints(fc); } catch (e) {}
      }

      if (Array.isArray(nests) && nests.length) window.fieldApiNests = nests;
      if (Array.isArray(cams)) window.fieldPredatorCameras = cams;
      if (Array.isArray(sched) && sched.length) {
        window.fieldScheduleRows = sched;
        if (typeof window.fieldRenderSchedule === "function") {
          try { window.fieldRenderSchedule(sched, { cache: true }); } catch (e) {}
        }
        // Rebuild the map's "today" from the cached schedule + re-filter.
        refreshTodayFromSchedule();
      }
      // Offline: style the markers from the last cached /map_points rows.
      if (store) {
        store.getMeta("mapPoints").then(function (cached) {
          applyMapPoints(cached);
        }).catch(function () {});
      }
      reRender();
      reflectCreds();
    }).catch(function () { reflectCreds(); });
  }

  // Push lookup vocabularies into the globals the app reads. The picker lists
  // live inside the IIFE closure and can't be reassigned from here, so expose
  // the lookups and overwrite the window-level vocab globals that ARE reachable.
  function applyLookups(l) {
    window.fieldApiLookups = l;
    if (l.patches && !window.fieldApiPatches) window.fieldApiPatches = l.patches;
    if (l.observers) window.fieldApiObservers = l.observers;
  }

  // Repopulate the waypoint layer/manager. The markers themselves are not
  // touched here: loadMapPoints() -> renderMapPoints() owns those.

  function reRender() {
    try {
      if (typeof window.renderWaypoints === "function") window.renderWaypoints();
    } catch (e) {}
    // Warm the nest-photo cache silently once the map and UI have settled,
    // deferred to browser idle time so it never competes with the initial
    // render. IndexedDB-backed and idempotent: only new nests are fetched.
    var warmPhotos = function () {
      try {
        if (window.NestApiData && typeof window.NestApiData.prefetchNestPhotos === "function") {
          window.NestApiData.prefetchNestPhotos();
        }
      } catch (e) {}
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(warmPhotos, { timeout: 4000 });
    } else {
      setTimeout(warmPhotos, 1500);
    }
    // Nudge any open nest-detail maps / lists to refresh from new globals.
    try {
      if (typeof window.fieldRefresh === "function") window.fieldRefresh();
    } catch (e) {}
  }

  // ---- Offline write queue ----------------------------------------------

  function flushQueue() {
    if (!queue || !api.isOnline()) return Promise.resolve();
    return queue.flush().then(function (r) {
      // Remap the local nest cache for any temp->real ids the flush resolved.
      if (r && r.remaps && store) {
        Object.keys(r.remaps).forEach(function (tempId) {
          store.del("nests", tempId).catch(function () {});
        });
      }
      return r;
    }).catch(function () { return null; });
  }

  // ---- Live change feed --------------------------------------------------

  var syncStarted = false;

  // Debounced, selective refresh driven by the live change feed. Refetches only
  // the entity types that actually changed, coalescing a burst into one refresh
  // ~400ms later, rather than re-running the whole 6-endpoint boot load.
  var _refreshTimer = null;
  var _pendingEntities = Object.create(null);

  function scheduleRefresh(events) {
    if (Array.isArray(events)) {
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        var ent = e && (e.entity || e.entity_type);
        if (ent) _pendingEntities[String(ent)] = true;
        // Drop cached full-detail so the next Modify open re-fetches fresh.
        // A "nest" event's entity_id IS the nest id, so we target that nest.
        if (ent === "nest" && e && e.entity_id &&
            window.NestApiData && typeof window.NestApiData.invalidateNest === "function") {
          try { window.NestApiData.invalidateNest(String(e.entity_id)); } catch (x) {}
        }
        // An interval_check event's entity_id is the CHECK's id, not the nest,
        // so targeting it invalidated nothing and left the nest's interval list
        // stale. Drop the whole detail cache instead: cheap, refills on demand.
        if (ent === "interval_check" &&
            window.NestApiData && typeof window.NestApiData.invalidateAllNests === "function") {
          try { window.NestApiData.invalidateAllNests(); } catch (x) {}
        }
        // A photo/gps_point change elsewhere means a nest that was photoless
        // here may now have one, so drop the popup's per-nest cache (which may
        // hold a "no photo" miss) to force a re-fetch. No-op until registered.
        if ((ent === "photo" || ent === "gps_point") &&
            window.NestApiData && typeof window.NestApiData.clearNestPhotoCache === "function") {
          try { window.NestApiData.clearNestPhotoCache(); } catch (x) {}
        }
      }
    }
    if (_refreshTimer) return; // a refresh is already pending; entities merged in
    _refreshTimer = setTimeout(function () {
      _refreshTimer = null;
      var ents = _pendingEntities;
      _pendingEntities = Object.create(null);
      runSelectiveRefresh(ents);
    }, 400);
  }

  // Refetch only the endpoints whose entities changed, then re-render once.
  // Falls back to a full bootDataLoad only if we can't tell what changed.
  function runSelectiveRefresh(ents) {
    if (!settings.hasCreds() || !api.isOnline()) return;
    var keys = Object.keys(ents);
    if (!keys.length) return;

    var wantNests = ents.nest || ents.interval_check || ents.nest_substrate ||
      ents.photo || ents.artificial_nest;
    var wantGps = ents.gps_point || ents.nest; // a new nest can add a point
    var wantTracks = ents.track;
    var wantCams = ents.predator_camera || ents.camera_maintenance;
    var wantSched = ents.schedule_day || ents.schedule;

    var jobs = [];
    jobs.push(wantNests ? api.getNests({}).catch(function () { return null; }) : Promise.resolve(undefined));
    jobs.push(wantGps ? api.getGpsPoints().catch(function () { return null; }) : Promise.resolve(undefined));
    jobs.push(wantTracks ? api.getTracks().catch(function () { return null; }) : Promise.resolve(undefined));
    jobs.push(wantCams ? api.getPredatorCameras().catch(function () { return null; }) : Promise.resolve(undefined));
    jobs.push(wantSched ? fetchSchedule() : Promise.resolve(undefined));

    Promise.all(jobs).then(function (res) {
      var nests = res[0], gps = res[1], tracks = res[2], cams = res[3], sched = res[4];
      if (Array.isArray(nests)) { window.fieldApiNests = nests; cachePut("nests", nests); reconcileNests(nests); }
      if (gps && gps.features) {
        if (store) store.setMeta("gpsPointsFC", gps).catch(function () {});
        if (typeof window.fieldMergeApiWaypoints === "function") {
          try { window.fieldMergeApiWaypoints(gps); } catch (e) {}
        }
      }
      if (Array.isArray(tracks) && typeof window.fieldMergeApiTracks === "function") {
        try { window.fieldMergeApiTracks(tracks); } catch (e) {}
      }
      if (Array.isArray(cams)) {
        window.fieldPredatorCameras = cams;
        if (store) store.setMeta("predatorCameras", cams).catch(function () {});
      }
      if (Array.isArray(sched) && sched.length) {
        window.fieldScheduleRows = sched;
        if (store) store.setMeta("scheduleRows", sched).catch(function () {});
        if (typeof window.fieldRenderSchedule === "function") {
          try { window.fieldRenderSchedule(sched, { seq: ++_scheduleSeq }); } catch (e) {}
        }
        // A live schedule edit landed -- rebuild the map's "today" + re-filter.
        refreshTodayFromSchedule();
      }
      // Any nest / point / schedule change can move a marker, its icon, its
      // opacity or its size, so re-pull the DB's rows and redraw rather than
      // inferring it here. This is what syncs a new nest across devices.
      if (wantNests || wantGps || wantSched) loadMapPoints();
      reRender();
    }).catch(function () {});
  }

  function startSync() {
    if (!sync || syncStarted || !settings.hasCreds()) return;
    syncStarted = true;
    var onBatch = function (events) { scheduleRefresh(events); };
    // onChange: a non-empty batch arrived. Debounced + selective (see above) so
    // background sync from other devices doesn't jank the field UI.
    sync.start(onBatch);
    // Stop polling while the app is hidden/backgrounded so idle field phones
    // don't keep hitting the server; resume on return (the loop re-reads the
    // persisted cursor, so nothing entered while away is missed).
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) {
          sync.stop();
        } else if (!sync.isRunning()) {
          sync.start(onBatch);
        }
      });
    }
  }

  // ---- Boot --------------------------------------------------------------

  // Load with the stored token, probing auth first: a 401 means a wrong or
  // expired token, so clear it and re-prompt. Any other failure (offline,
  // server down) keeps the token and falls back to the IndexedDB cache.
  function loadWithToken() {
    api.getLookups().then(function (lookups) {
      _probedLookups = lookups;   // hand the probe result to bootDataLoad (no refetch)
      flushQueue().then(bootDataLoad).then(startSync).catch(function () {
        loadFromCache();
      });
    }).catch(function (e) {
      if (e && e.status === 401) {
        settings.setToken("");
        promptForToken("That password didn't work — please check it and try again.");
      } else {
        loadFromCache();
      }
    });
  }

  // First-run token prompt -- the primary token UI. The URL is baked, so the
  // tech only needs the token. Shown on first open and on a rejected token.
  // The Settings screen (wireSettings) is a second, redundant entry point.
  function promptForToken(message) {
    var existing = document.getElementById("apiTokenPrompt");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var overlay = document.createElement("div");
    overlay.id = "apiTokenPrompt";
    overlay.className = "field-patch-overlay";
    var inner = document.createElement("div");
    inner.className = "field-patch-overlay-inner";
    var msg = document.createElement("div");
    msg.className = "field-patch-overlay-title";
    msg.textContent = "Please enter the password that Tara or Brian sent you:";
    var input = document.createElement("input");
    input.type = "text";
    input.className = "field-input";
    input.autocapitalize = "off";
    input.autocomplete = "off";
    input.spellcheck = false;
    var save = document.createElement("button");
    save.type = "button";
    save.className = "field-button";
    save.textContent = "Save";
    var note = document.createElement("div");
    note.className = "field-field-label";
    if (message) note.textContent = message;
    function submit() {
      var t = input.value.trim();
      if (!t) { note.textContent = "Enter your password to continue."; return; }
      settings.setToken(t);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      loadWithToken();
    }
    save.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submit();
    });
    inner.appendChild(msg);
    inner.appendChild(input);
    inner.appendChild(save);
    inner.appendChild(note);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);
    input.focus();
  }

  function boot() {
    wireSettings();
    if (!settings.hasCreds()) {
      // First use: ask for the token, then load. (Parallel-run safety: until a
      // token is entered nothing else here runs, so the baked data path is used.)
      promptForToken();
      return;
    }
    loadWithToken();
  }

  window.NestApiWiring = {
    refreshMapPoints: loadMapPoints,
    cacheNest: cacheNest,
    bootDataLoad: bootDataLoad,
    flushQueue: flushQueue,
    startSync: startSync
  };

  // Re-flush the queue whenever connectivity returns.
  window.addEventListener("online", function () {
    if (settings.hasCreds()) flushQueue().then(bootDataLoad);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
