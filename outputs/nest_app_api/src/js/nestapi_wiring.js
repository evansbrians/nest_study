// nestapi_wiring.js -- Settings screen + async boot data-load + live sync.
//
// The glue between the field app (baked Sheets/Drive globals) and the REST API
// client (window.NestApi.*). Runs at end of body, after page_glue.js, so the
// app's globals and DOM already exist. EVERY effect is gated on
// NestApi.settings.hasCreds(): with no token stored, this file wires only the
// Settings inputs and otherwise no-ops, leaving the baked data path untouched
// (safe parallel run). Exposes a small window.NestApiWiring surface the app
// IIFE calls into (e.g. cacheNest after a create).
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
      // The token is mandatory (no Sheets/Drive fallback remains); promptForToken
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

  // ---- Shape mapping: API -> app globals --------------------------------

  // GeoJSON FeatureCollection (GET /gps_points) -> the window.fieldMapPoints
  // array shape the app expects: { name, lat, lng, icon_id, ... }. Only nest
  // points get a nest icon; the app uses name/lat/lng for its lookups.
  function gpsFcToMapPoints(fc) {
    var feats = (fc && fc.features) || [];
    return feats.map(function (f) {
      var props = (f && f.properties) || {};
      var coords = (f && f.geometry && f.geometry.coordinates) || [];
      var cls = props["class"] || props.point_class || "";
      return {
        point_id: props.point_id || null,
        name: props.name || props.point_name,
        lat: coords[1],
        lng: coords[0],
        icon_id: (String(cls).toLowerCase() === "nest") ? "nest_inactive" : null,
        point_class: cls,
        note: props.note || null,
        photo: props.nav_photo || props.photo || null,   // usually null now (lazy)
        hasPhoto: !!(props.has_nav_photo || props.nav_photo || props.photo)
      };
    }).filter(function (p) {
      // Keep EVERY point that has real coordinates. Points are in the DB because
      // someone recorded them, so by default they must be available to render on
      // every device -- dropping any here (previously: nameless non-nest points)
      // silently hid DB points from other techs (bug: points missing on Tara's
      // phone). Nest points resolve by point_id and a NULL point_name is common
      // for migrated points; other classes render/lookup fine without a name too.
      return p.lat != null && p.lng != null;
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

  // ---- Live "today" filter (rebuild fieldToday from the schedule) --------

  // The map's today-filter reads window.fieldToday.patches. make_field_map.R
  // bakes that at RENDER time (a { patches:[...], fade:{"lat,lng":0.5} } entry
  // selected from window.fieldSchedule for the phone's date), so if the schedule
  // changes after render the map's "today" goes stale. Here we rebuild
  // fieldToday.patches from the LIVE schedule rows (window.fieldScheduleRows,
  // GET /schedule) for today's local date, then re-broadcast the current filter
  // state so both filters (map_weather.js baked groups + nestapi_map.js API
  // overlay) re-run against the fresh value.

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

  // Render the last-cached schedule from IndexedDB. Used when the live fetch
  // fails so the schedule screen shows the most recent known week instead of a
  // blank page. No-op if nothing was ever cached. Tagged {cache:true} so it can
  // never overwrite a live render.
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

  // ---- Marker styling, straight from the DB (GET /map_points) --------------
  //
  // The v_map_point view decides how every marker renders: its opacity already
  // folds in BOTH fades (non-current AND not-scheduled-today), and its size
  // carries the 15%-larger rule for current nests. We translate those rows into
  // the two "lat,lng"-keyed maps map_weather.js already reads, so the rendering
  // code is untouched but the NUMBERS are the database's, not re-derived here.
  // This replaces the old client-side fade computation, which had to re-join the
  // schedule against point names and silently produced nothing when any of that
  // drifted (every coverboard/trailcam stuck at full opacity).

  var _mapPointFade = Object.create(null);  // "lat,lng" -> opacity (<1 only)
  var _mapPointBig = Object.create(null);   // "lat,lng" -> true (render larger)

  function applyMapPointStyles(rows) {
    if (!Array.isArray(rows) || !rows.length) return false;
    var todayFade = Object.create(null);   // -> window.fieldToday.fade
    var nestFade = Object.create(null);    // -> window.fieldNestFade
    var big = Object.create(null);         // -> window.fieldNestBig
    rows.forEach(function (r) {
      if (!r || r.lat === null || r.lat === undefined ||
          r.lng === null || r.lng === undefined) return;
      var key = Number(r.lat).toFixed(6) + "," + Number(r.lng).toFixed(6);
      // Keep the two fades SEPARATE, exactly as applyFilter applies them: the
      // non-current fade always, the today fade only while the today-subset is
      // on. (The view also gives a combined `opacity`, but using that alone
      // would make the toggle unable to tell them apart.)
      if (Number(r.is_current) === 0) nestFade[key] = 0.5;
      if (Number(r.scheduled_today) === 0) todayFade[key] = 0.5;
      if (Number(r.size) > 1) big[key] = true;
    });
    _mapPointFade = todayFade;
    _mapPointBig = big;
    window.fieldNestFade = nestFade;
    window.fieldNestBig = big;
    if (window.fieldToday) window.fieldToday.fade = todayFade;
    rebroadcastFilterState();
    return true;
  }

  // Fetch the marker styling and apply it. Cache-backed so an offline boot still
  // styles the map from the last known state.
  function loadMapPointStyles() {
    return api.getMapPoints().then(function (rows) {
      if (!applyMapPointStyles(rows)) return false;
      if (store) store.setMeta("mapPoints", rows).catch(function () {});
      return true;
    }).catch(function () {
      if (!store) return false;
      return store.getMeta("mapPoints").then(function (cached) {
        return applyMapPointStyles(cached);
      }).catch(function () { return false; });
    });
  }

  // Rebuild window.fieldToday from window.fieldScheduleRows for today's local
  // date. "Today's patches" is every patch VISITED today, so we take the UNION
  // of the day's point-count patches (patch_count) AND its nest-search patches
  // (search_patch_1/2): a patch searched today but not point-counted (e.g.
  // witch_hazel) is still "today", and its nests must not be hidden by the map
  // filter. Values are used RAW (not prettified) so they match window.fieldPatches
  // keys and the dropdown option values the filters compare against. Mirrors the
  // R selector's fallback: if today is not a field day (e.g. Sunday) advance to
  // the next scheduled field day so the map never blanks. Returns true if it
  // updated fieldToday, false if it left the baked value untouched (empty/absent
  // rows).
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

    // patches drive the today-subset (hide/show); the per-marker fade comes from
    // the DB via applyMapPointStyles(), so carry the latest one through rather
    // than recomputing (or, as this once did, nulling) it here.
    window.fieldToday = {
      date: pick,
      patches: patches,
      fade: _mapPointFade
    };
    return true;
  }

  // Re-broadcast the current filter state (switch + dropdown) so both listeners
  // (map_weather.js setToday/setPatch and nestapi_map.js) re-read the fresh
  // window.fieldToday and re-filter. Defaults mirror the app: switch on,
  // dropdown "__all__".
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

  // Fetch lookups / nests / gps_points / predator cameras, map them into the
  // shapes the app expects, cache them, populate the globals, and re-render.
  // Non-blocking: shows a loading state, resolves regardless. On a network
  // failure it falls back to the IndexedDB cache, then to the baked data.
  // Load the schedule INDEPENDENTLY of the heavier nests/gps batch: the schedule
  // render used to wait on Promise.all, so a slow GET /gps_points (base64 photos
  // for every point) delayed the schedule screen by many seconds. Cache-first --
  // show the last-known week instantly, then overwrite when the live fetch lands.
  function loadSchedule() {
    // Seed the giraffe lookup (fieldApiNests) from the nests cache FIRST, so the
    // schedule's selfie-stick 🦒 marks show immediately with the cache-first
    // render -- otherwise they wait on the (slow) fresh getNests in the boot
    // batch. The fresh nests re-render (see bootDataLoad) refreshes them later.
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
        window.fieldMapPoints = gpsFcToMapPoints(gps);
        // Cache raw features so an offline boot can rebuild fieldMapPoints.
        if (store) store.setMeta("gpsPointsFC", gps).catch(function () {});
        // Restore non-Temp waypoints into the local store so they survive a
        // cache clear (they're already in the DB; Temp is never uploaded).
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
      loadMapPointStyles();

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
      if (fc && fc.features) window.fieldMapPoints = gpsFcToMapPoints(fc);
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
          applyMapPointStyles(cached);
        }).catch(function () {});
      }
      reRender();
      reflectCreds();
    }).catch(function () { reflectCreds(); });
  }

  // Push lookup vocabularies into the globals the app reads. The app's picker
  // lists (NEST_SPECIES/NEST_SUBSTRATES) live inside the IIFE closure and can't
  // be reassigned from here, so we expose the lookups for the app to consult
  // and overwrite the flat window-level vocab globals that ARE reachable.
  function applyLookups(l) {
    window.fieldApiLookups = l;
    if (l.patches && !window.fieldApiPatches) window.fieldApiPatches = l.patches;
    if (l.observers) window.fieldApiObservers = l.observers;
  }

  // Coarse re-render: repopulate the waypoint layer/manager (the parts that
  // read window.fieldMapPoints at call time). A full rebuild of the R-rendered
  // primary map layer is out of scope here; see WIRING_STATUS.md.
  function reRender() {
    try {
      if (typeof window.renderWaypoints === "function") window.renderWaypoints();
    } catch (e) {}
    // Draw/refresh the live API nest overlay (current nests, incl. app-created
    // ones not in the baked map), from the freshly loaded globals.
    try {
      if (typeof window.fieldRenderApiNests === "function") window.fieldRenderApiNests();
    } catch (e) {}
    // Warm the nest-photo cache SILENTLY, in the background, only once the map +
    // UI have settled -- deferred to browser idle time (fallback: a short timer)
    // so photo fetching never competes with the initial render. IndexedDB-backed
    // and idempotent, so only new nests are ever fetched.
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

  // Debounced, SELECTIVE refresh in reaction to the live change feed. The old
  // behaviour re-ran the full 6-endpoint bootDataLoad + full re-render on every
  // batch -- heavy and janky when other devices are actively editing. Instead
  // we look at which entity types actually changed and refetch only those,
  // coalescing a burst of batches into one refresh ~400ms later.
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
        // An "interval_check" event's entity_id is the CHECK's surrogate id
        // (e.g. 471), NOT the nest -- and a routine check emits no accompanying
        // nest event -- so targeting entity_id invalidated a non-existent key
        // and left the nest's cached interval list stale until a full reload.
        // The event doesn't carry the parent nest id, so drop the whole detail
        // cache on any interval change; it's cheap and refilled on demand.
        if (ent === "interval_check" &&
            window.NestApiData && typeof window.NestApiData.invalidateAllNests === "function") {
          try { window.NestApiData.invalidateAllNests(); } catch (x) {}
        }
        // A photo or gps_point change on another device (e.g. Brian adds a nest
        // point + discovery photo) means a nest that was PHOTOLESS here may now
        // have one. The map popup lazy-fetches per nest and caches the result --
        // including a "no photo" miss taken before the photo synced -- so drop
        // that cache to force a re-fetch. (The cache lives in nestapi_map.js and
        // registers this hook; no-op until it does.)
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
      if (Array.isArray(nests)) { window.fieldApiNests = nests; cachePut("nests", nests); }
      if (gps && gps.features) {
        window.fieldMapPoints = gpsFcToMapPoints(gps);
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
      // A nest / point / schedule change can all move a marker's opacity or
      // size, so re-pull the DB's styling verdict instead of inferring it here.
      if (wantNests || wantGps || wantSched) loadMapPointStyles();
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

  // Load with the stored token. Probes auth first: a 401 means a wrong/expired
  // token, so we clear it and re-prompt via promptForToken (the primary token
  // UI; a redundant Settings screen also exists and is slated for removal). Any
  // other failure (offline, server down) keeps the token and falls back to the
  // IndexedDB cache.
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

  // First-run token prompt -- the primary token UI. The URL is baked
  // (settings.DEFAULT_URL), so the tech only needs the token ("password"). Shown
  // on first open with no token (and on a rejected token); on save it stores the
  // token and loads. A redundant Settings screen (wireSettings) also exists and
  // is slated for removal so this is the single token entry point.
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
