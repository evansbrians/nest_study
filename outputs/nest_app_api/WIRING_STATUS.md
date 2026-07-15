# API Wiring Status — staging app (`outputs/test/`)

Wires the bird-nest field PWA to the REST API (`window.NestApi.*`) as a
**parallel run**: every backend call is gated on
`NestApi.settings.hasCreds()`. With **no token** stored, the app behaves
**exactly** as before (baked Google Sheets / Drive path). With a token, writes
go to the REST API (queued offline), boot data loads async from the API (with
an IndexedDB cache fallback), and a live change feed refreshes the UI.

Verified by `node --check` and review only — **not** run in a browser.

---

## Files changed

### `field_map.qmd`
- Added `<script src>` includes for the five `src/js/nestapi_*.js` modules
  (settings, store, client, queue, sync) **after** the `field_*.js` data
  payloads and **before** the main app IIFE, so the concatenated app modules can
  call `NestApi.*` at run time.
- Added a **Settings** `.field-screen` (`data-name="settings"`) with API-URL and
  API-token inputs (URL defaults to `https://snednestudy.duckdns.org`), a
  "Save & sync" button, and a status line reflecting whether creds are set.
- Added a **Settings** tile to the main menu tile grid (`data-screen="settings"`
  — picked up automatically by the existing `[data-screen]` nav handler).
- Repointed the three `readLines()` app-source chunks (page_navigation,
  data_entry, field_map_app; accordion; page_glue) from `outputs/nest_app/...`
  to `outputs/test/src/js/...` so the **staging** copies (the ones
  edited here) are what get assembled. **This keeps the build off the live app.**
- Added a new R chunk that inlines `src/js/nestapi_wiring.js` after page_glue.

### `src/js/nestapi_wiring.js` (new, outside the app IIFE)
- Wires the Settings inputs to `NestApi.settings.getUrl/setUrl/getToken/setToken`
  and shows whether creds are set.
- **Async boot data-load** (only when `hasCreds()`): fetches `getLookups()`,
  `getNests({current:true})`, `getGpsPoints()`, and `getPredatorCameras()` in
  parallel; maps the GeoJSON `FeatureCollection` into the app's
  `window.fieldMapPoints` shape (`{name, lat, lng, icon_id, ...}`); caches
  lookups/nests/points in `NestApi.store` (IndexedDB); repopulates globals and
  re-renders. Non-blocking (shows a "loading…" status; UI stays live on baked
  data meanwhile).
- **Offline fallback:** on network failure, rebuilds globals from the IndexedDB
  cache; if nothing is cached, leaves the baked data in place.
- **Live sync:** `NestApi.sync.start(onChange)` where `onChange` re-runs the
  boot data-load (coarse "refetch + re-render", as the brief allows).
- **Queue flush** on boot and on the `online` event.
- Exposes `window.NestApiWiring` (`cacheNest`, `bootDataLoad`, `flushQueue`,
  `startSync`) for the app IIFE to call.

### `src/js/data_entry.js`
- Added `apiEnabled()` (= `hasCreds()`), `apiShouldQueue(err)`, and
  `relayPostApi(payload, ...)`.
- `relayPost()` now branches: **if `apiEnabled()` → `relayPostApi`, else the
  original Apps Script relay unchanged.** `relayPostApi` maps the existing
  actions to endpoints per the wiring map:
  - `nest_row` → `POST /nests` (`createNest`; `tempId = row.nest_id`)
  - `interval_row` → `POST /nests/:id/intervals` (`addInterval`;
    `tempId = row.nest_id`)
  - `update_row`/`nest_level` → `PATCH /nests/:id` (`updateNest`)
  - `update_row`/`interval_level` → `PATCH /intervals/:check_id` (`updateInterval`)
  - `delete_row`/`interval_level` → `DELETE /intervals/:check_id`
  - `delete_row`/`nest_level` → `DELETE /nests/:id` (raw request; queue raw-kind)
  - **Write resilience:** offline or a network throw (no `.status`) → enqueue via
    `NestApi.queue.enqueue(...)` and report success optimistically; a server
    rejection (`.status`) surfaces to `onError`. Discovery/interval ops carry the
    nest's (temp) id so the queue's temp-id remap rewrites later ops.
- `fetchNestDetail()` now branches: **API path** calls `getNest(id)` and adapts
  `{nest, substrates, intervals, ...}` into the app's JSONP callback shape
  `{discovery:{data,row}, intervals:[{data,row}]}`, where each interval's `row`
  slot carries the surrogate **`check_id`** (not a sheet row) — so the existing
  `updateSheetRow`/`deleteSheetRow` call sites reference it unchanged. Server
  substrate array is joined to the comma-string the form expects.
- `saveNestData()` success now adopts any server-allocated `nest_id`
  (`rec.nest_id`) into `nestDataCtx.nestId` so the follow-on interval + photo
  target the same nest.
- `uploadNestRow`, `uploadIntervalRow`, `updateSheetRow`, `deleteSheetRow`
  signatures and call sites **unchanged** (they all route through `relayPost`).

### `src/js/field_map_app.js`
- Added `featureToGpsPoint(f)` (waypoint GeoJSON Feature → `/gps_points` body per
  the map's waypoint field table: `point_id`, `name`, `class`, `time`, `lat`,
  `lng`, `elevation`, `accuracy`, `bearing`, `note`, `photo_name`, `nav_photo`).
- Added `uploadFcToApi(...)` — POSTs each feature via `createGpsPoint`; offline
  or network-throw → enqueue (`kind:"createGpsPoint"`, `tempId = point_id`).
- `uploadToDrive()` now branches at the top: **if `hasCreds()` → `uploadFcToApi`,
  else the original Drive relay unchanged.** Signature + all call sites
  (waypoint save/modify, note attach, retry-pending, track save) unchanged.
- Added `window.fieldRefresh` (calls `renderWaypoints`) so the out-of-IIFE
  wiring layer can trigger a coarse re-render after a data-load / change batch.

---

## `node --check` results (Node v22)

Standalone modules — checked directly:
```
OK  src/js/nestapi_settings.js
OK  src/js/nestapi_store.js
OK  src/js/nestapi_client.js
OK  src/js/nestapi_queue.js
OK  src/js/nestapi_sync.js
OK  src/js/nestapi_wiring.js   (new)
OK  src/js/page_glue.js
OK  src/js/accordion.js
```
App IIFE fragments (`page_navigation.js` + `data_entry.js` + `field_map_app.js`)
are not standalone-parseable on their own (they contain top-level `return` and
begin mid-scope). Checked **as assembled by the qmd** — wrapped in the
`(function(){ function init(){ …three files… } … })();` shell:
```
OK  assembled IIFE (page_navigation + data_entry + field_map_app)
```

---

## NEEDS BROWSER / FIELD TESTING checklist

1. **Configure token in Settings** — open Menu → Settings; confirm the URL
   defaults to `https://snednestudy.duckdns.org`; paste a token; Save & sync;
   confirm the status line switches to "API token set — syncing with …".
2. **Load nests from API** — with a token set, reload; confirm boot fetches
   lookups/nests/gps_points/cameras, that map lookups/points populate, and that
   the app stays interactive during load ("Loading…" state).
3. **Primary map markers** — the main Leaflet layer is **R-rendered at build**
   into the HTML; the wiring updates `window.fieldMapPoints` (used by lookups,
   nest-detail maps, name-collision checks) and re-renders the **waypoint**
   layer, but does **not** re-draw the baked primary nest markers. Verify what
   the user expects to see refresh on the main map after an API load.
4. **Add a nest online** — save a Nest waypoint → discovery form → Save; confirm
   `POST /nests`, that the returned `nest_id` is adopted, and that the follow-on
   interval + waypoint photo attach to the same nest.
5. **Add a nest offline, then reconnect** — go offline; add a nest + its first
   interval + photo; confirm optimistic success and queued ops; reconnect (or
   fire the `online` event) and confirm the queue flushes, the temp nest_id
   remaps to the server id across the interval/photo ops, and the cache updates.
6. **Edit an interval** — Modify → pick a check → change values → Update;
   confirm `PATCH /intervals/:check_id` (that the check_id, not a row number,
   is used).
7. **Delete an interval** — open a check in edit mode → Delete check; confirm
   `DELETE /intervals/:check_id`.
8. **Edit / delete a nest discovery** — Modify discovery → Update →
   `PATCH /nests/:id`; Delete nest data → `DELETE /nests/:id` (raw request path).
9. **Save a waypoint** — save a non-nest waypoint; confirm `POST /gps_points`
   with the correct field mapping (name/class/lat/lng/accuracy/bearing/nav_photo),
   and that a photo rides along as base64 `nav_photo`.
10. **Modify a waypoint** — re-record/average/rename; confirm it re-POSTs the
    updated point (see deviations — uses POST, not PATCH).
11. **Track save** — record + Save a track; confirm each track point POSTs to
    `/gps_points`.
12. **Multi-device change feed** — with two devices/tabs on the same token, make
    a change on one; confirm the other's long-poll delivers the batch and the
    UI refetches + re-renders.
13. **Offline cache load** — load once online (populates IndexedDB), then reload
    offline; confirm the app rebuilds `fieldMapPoints`/nests from the cache.
14. **Parallel-run safety (no token)** — with the token cleared, confirm every
    path (nest add, interval, waypoint, modify) still uses the old Sheets/Drive
    relay and the app is byte-for-byte behaviorally identical to before.
15. **Quarto render** — the qmd now `readLines()` from
    `outputs/test/src/js/…`; confirm it renders (paths resolve via
    `here::here()` to the project root) and produces `index.html`.

---

## Deviations from the map / judgement calls

- **qmd source paths.** The map's assembly section describes the existing
  `outputs/nest_app/...` `readLines`. To satisfy "STAGING ONLY / never touch
  `outputs/`" while still assembling the **edited** files, I repointed the qmd's
  three app-source chunks (plus accordion/page_glue) to the staging
  `outputs/test/src/js/...` copies. Flag for confirmation that the
  staging build is meant to consume staging sources (it must, or my edits would
  never load).
- **`<script src>` vs inline.** The five `nestapi_*.js` modules are added as
  `<script src="src/js/…">` tags (as the brief specified). The build must ship
  those files alongside `index.html` (they are not inlined like the app IIFE).
  Flag if the deploy expects everything embedded — if so, switch these to the
  same `readLines()`-inline pattern.
- **Waypoint "Modify" uses POST, not PATCH.** The app's modify flow calls
  `uploadToDrive(...)` (same as create), so with a token it re-POSTs via
  `createGpsPoint`. The API has `updateGpsPoint` (`PATCH /gps_points/:id`), but
  routing modify separately would require changing call sites (the brief says
  keep them unchanged). Idempotency keys keep the re-POST safe; the server
  should upsert on the client `point_id`. Flag if a true PATCH is required.
- **Primary map re-render is coarse.** Only the waypoint layer is re-rendered on
  API load; the baked R-rendered nest markers are not redrawn (see checklist #3).
  The brief explicitly allows a coarse re-render "for now".
- **Lookups → picker lists.** `NEST_SPECIES` / `NEST_SUBSTRATES` live inside the
  app IIFE closure and can't be reassigned from the out-of-IIFE wiring layer, so
  API lookups are exposed on `window.fieldApiLookups` (and cached) but do **not**
  overwrite the in-closure picker arrays. The app keeps its baked species/
  substrate lists. Flag if the picker lists must come from the API.
- **`camera_deployment_date`, `host_dead_young`, etc.** passed straight through
  from `collectNestRecord`/`collectIntervalRecord` as-is; the API is assumed to
  accept the same field names the map documents.
- **Schedule endpoint** (`GET /schedule`) is not wired — the client layer
  (`NESTAPI.md`) exposes no schedule method, so the schedule screen keeps its
  baked `window.fieldToday`/`fieldScheduleHTML`.
