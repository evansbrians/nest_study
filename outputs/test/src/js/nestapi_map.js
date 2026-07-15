// nestapi_map.js -- nest PHOTO + navigation service (no rendering).
//
// This file used to be a second nest renderer: it drew its own marker overlay
// because the baked map couldn't show app-created nests. That is gone. Every
// marker now comes from ONE place -- GET /map_points (the v_map_point view),
// drawn by renderMapPoints() in map_weather.js. Two renderers meant two copies
// of "how a nest looks", and every disagreement between them was a bug.
//
// What remains is the part that genuinely isn't the DB's job: fetching a nest's
// photo (auth-gated bytes, cached in memory + IndexedDB) to fill a popup's
// .api-nest-photo-slot, and resolving a nest's coordinates for Navigate.
//
// Assembled INTO the main field-map IIFE (after field_map_app.js), so it can
// call startNavigation / niCoords / escapeHtml directly.

// Normalize a nest's patch to the app's test-patch KEY. Test-site nests have DB
// patch_id "snedgen_park" / "long_branch" (or NSP##/NLB## ids), but the patch
// dropdown + labels key them as "test_snedgen_park" / "test_long_branch" -- so
// filtering by raw patch_id never matched. Mirrors field_map_app.js.
function apiNestPatchKey(nest) {
  var id = String((nest && nest.nest_id) || "");
  if (/^NSP\d+$/.test(id)) return "test_snedgen_park";
  if (/^NLB\d+$/.test(id)) return "test_long_branch";
  var raw = String((nest && nest.patch_id) || "").toLowerCase();
  if (raw === "snedgen_park") return "test_snedgen_park";
  if (raw === "long_branch") return "test_long_branch";
  return (nest && nest.patch_id) || null;
}

// point_id -> {lat, lng, photo} from the API-loaded gps points.
function apiPointCoordIndex() {
  var idx = {};
  (window.fieldMapPoints || []).forEach(function (p) {
    if (p && p.point_id && p.lat != null && p.lng != null) {
      idx[p.point_id] = { lat: p.lat, lng: p.lng, photo: p.photo || null };
    }
  });
  return idx;
}

// Artificial = the nest's SPECIES is Artificial (code ARNE), or an NQ id. NOT
// artificial_candidate -- that's a "could become artificial" flag real nests
// carry, which must not drive the artificial icon.
function apiNestIsArtificial(nest) {
  return /^NQ/.test(String(nest.nest_id)) || nest.species_code === "ARNE";
}

// Prettify a patch_id ("long_branch" -> "Long Branch").
function prettyPatch(pid) {
  if (!pid) return "—";
  return String(pid).replace(/_/g, " ").replace(/\b\w/g, function (c) {
    return c.toUpperCase();
  });
}

// The API's nav_photo is RAW base64 (no data-URL prefix); make it usable in an
// <img> so it isn't a broken-image box.
function asDataUri(photo) {
  if (!photo) return null;
  var s = String(photo).trim();
  if (!s) return null;
  if (/^data:image\//i.test(s)) return s;               // already a data URL
  var clean = s.replace(/\s+/g, "");
  // Only wrap values that really look like base64 image data (long + base64
  // charset). A filename / id / URL returns null so the popup shows NO image
  // rather than a broken-image "blue square with a question mark".
  if (clean.length > 100 && /^[A-Za-z0-9+/=]+$/.test(clean)) {
    return "data:image/jpeg;base64," + clean;
  }
  return null;
}

// ---- Lazy popup photo for old / migrated nests --------------------------
//
// New nests store their discovery photo on the GPS point's nav_photo, which
// GET /gps_points returns as base64 -> fieldMapPoints[].photo -> the popup
// `photo` param below. Migrated nests often have NO nav_photo (the source
// geojson carried no nav thumbnail) and the migration never wrote the `photo`
// table, so nothing the map already holds can show their photo. When a nest is
// photoless here, fetch GET /nests/<id> on popup open: use its gps_point's
// nav_photo if present, else a disk photo from its photos[] via GET /photos/<id>.
// /photos/<id> is auth-gated, so a plain <img src> would 401 -- we fetch the
// bytes WITH the bearer token and hand the popup an object URL. Results (incl.
// "no photo") are cached so a re-opened popup doesn't refetch.
// In-memory photo cache: nest_id -> dataURI (a hit), false (known no photo), or
// an in-flight Promise (de-dupes concurrent callers).
var _apiNestPhotoCache = {};

// The change feed (nestapi_wiring.js) calls this when a photo/gps_point change
// arrives from another device, so a "no photo" miss cached before the photo
// synced is dropped and the next popup open re-fetches. Memory only -- the
// persistent IndexedDB cache is keyed per nest and additive, so it is kept
// (a genuinely new nest is simply absent from it and gets fetched fresh).
window.NestApiData = window.NestApiData || {};
window.NestApiData.clearNestPhotoCache = function () { _apiNestPhotoCache = {}; };

function apiCredsOnline() {
  return !!(window.NestApi && NestApi.settings && NestApi.settings.hasCreds() &&
    NestApi.api && NestApi.api.isOnline());
}

// ---- Persistent photo cache (IndexedDB via NestApi.store `meta`) ----------
//
// A nest's photo is fetched ONCE and reused across sessions, so popups open
// instantly from cache with no broken-image "?" flash and only NEW nests are
// fetched on later opens. Held as one meta blob { nest_id: dataURI }, mirrored
// in memory (_apiNestPhotoIdb) after a one-time load so reads are cheap.
var IDB_PHOTO_KEY = "apiNestPhotos";
var _apiNestPhotoIdb = null;      // nest_id -> dataURI (null until loaded)
var _apiNestPhotoIdbLoad = null;  // in-flight load promise

function apiStoreOk() {
  return !!(window.NestApi && NestApi.store &&
    typeof NestApi.store.getMeta === "function");
}

function apiLoadPhotoIdb() {
  if (_apiNestPhotoIdb) return Promise.resolve(_apiNestPhotoIdb);
  if (_apiNestPhotoIdbLoad) return _apiNestPhotoIdbLoad;
  if (!apiStoreOk()) { _apiNestPhotoIdb = {}; return Promise.resolve(_apiNestPhotoIdb); }
  _apiNestPhotoIdbLoad = NestApi.store.getMeta(IDB_PHOTO_KEY).then(function (v) {
    _apiNestPhotoIdb = (v && typeof v === "object") ? v : {};
    return _apiNestPhotoIdb;
  }).catch(function () { _apiNestPhotoIdb = {}; return _apiNestPhotoIdb; });
  return _apiNestPhotoIdbLoad;
}

// Persist one nest's photo (data URI) to the mirror + IndexedDB. The store write
// is debounced so a prefetch burst coalesces into one write.
var _apiPhotoWriteTimer = null;
var _apiPhotoWriteDirty = false;
function apiPersistPhoto(nestId, uri) {
  if (!nestId || !uri || !apiStoreOk()) return;
  if (!_apiNestPhotoIdb) _apiNestPhotoIdb = {};
  if (_apiNestPhotoIdb[nestId] === uri) return;
  _apiNestPhotoIdb[nestId] = uri;
  _apiPhotoWriteDirty = true;
  if (_apiPhotoWriteTimer) return;
  _apiPhotoWriteTimer = setTimeout(function () {
    _apiPhotoWriteTimer = null;
    if (!_apiPhotoWriteDirty) return;
    _apiPhotoWriteDirty = false;
    NestApi.store.setMeta(IDB_PHOTO_KEY, _apiNestPhotoIdb).catch(function () {});
  }, 800);
}

// Blob -> data URL (persistable + directly usable in an <img>). GET /photos/<id>
// is auth-gated binary, so it is fetched WITH the bearer token, not as a bare src.
function apiBlobToDataUrl(blob) {
  return new Promise(function (resolve) {
    try {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result || null); };
      fr.onerror = function () { resolve(null); };
      fr.readAsDataURL(blob);
    } catch (e) { resolve(null); }
  });
}
function apiFetchPhotoDataUrl(photoId) {
  var base = NestApi.settings.getUrl();
  var token = NestApi.settings.getToken();
  var headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  return fetch(base + "/photos/" + encodeURIComponent(photoId), { headers: headers })
    .then(function (r) { return r.ok ? r.blob() : null; })
    .then(function (b) { return b ? apiBlobToDataUrl(b) : null; });
}

// Insert the photo into a popup slot ONLY once its bytes have decoded, via
// img.onload -- so a still-loading src is never shown as a broken-image "?" box.
function apiSetSlotPhoto(slot, uri) {
  if (!slot || !uri || slot.getAttribute("data-loaded")) return;
  slot.setAttribute("data-loaded", "1");
  var im = new Image();
  im.onload = function () {
    im.style.maxWidth = "180px";
    im.style.maxHeight = "180px";
    im.style.borderRadius = "4px";
    // Tap the popup photo to open it full-screen (like the nest page).
    im.style.cursor = "zoom-in";
    im.addEventListener("click", function () {
      if (typeof fieldOpenPhotoViewer === "function") fieldOpenPhotoViewer(uri);
    });
    slot.appendChild(im);        // add to the DOM only after it has decoded
  };
  im.onerror = function () { slot.removeAttribute("data-loaded"); };
  im.src = uri;
}

// Resolve a nest's best photo as a data URI (Promise -> dataURI | false). Order:
// in-memory cache, then the persistent IndexedDB cache, then the network (the
// gps point's nav_photo, else a disk photo from the `photo` table, discovery
// preferred). Persists any hit so later sessions skip the fetch. false == the
// nest truly has no photo anywhere.
function apiResolveNestPhoto(nestId) {
  if (!nestId) return Promise.resolve(false);
  nestId = String(nestId);
  var mem = _apiNestPhotoCache[nestId];
  if (typeof mem === "string") return Promise.resolve(mem);
  if (mem === false) return Promise.resolve(false);
  if (mem && typeof mem.then === "function") return mem;   // in-flight
  var job = apiLoadPhotoIdb().then(function (idb) {
    var cached = idb && idb[nestId];
    if (typeof cached === "string" && cached) {
      _apiNestPhotoCache[nestId] = cached;
      return cached;
    }
    if (!apiCredsOnline()) { _apiNestPhotoCache[nestId] = undefined; return false; }
    return NestApi.api.getNest(nestId).then(function (detail) {
      var navUri = asDataUri(detail && detail.gps_point && detail.gps_point.nav_photo);
      if (navUri) return navUri;
      var photos = (detail && detail.photos) || [];
      var pick = photos.filter(function (p) { return p && p.kind === "discovery"; })[0] ||
        photos[0];
      if (!pick || pick.photo_id == null) return null;
      return apiFetchPhotoDataUrl(pick.photo_id);
    }).then(function (uri) {
      if (uri) {
        _apiNestPhotoCache[nestId] = uri;
        apiPersistPhoto(nestId, uri);
        return uri;
      }
      _apiNestPhotoCache[nestId] = false;   // known: no photo anywhere
      return false;
    });
  }).catch(function () {
    _apiNestPhotoCache[nestId] = undefined;   // allow a retry
    return false;
  });
  _apiNestPhotoCache[nestId] = job;
  return job;
}

// Fill a popup's photo slot from the cache (instant when prefetched), else a
// lazy fetch -- either way the image is only shown once decoded (apiSetSlotPhoto).
function apiLazyLoadNestPhoto(nestId, slot) {
  if (!nestId || !slot) return;
  apiResolveNestPhoto(nestId).then(function (uri) {
    if (uri) apiSetSlotPhoto(slot, uri);
  });
}

// Background prefetch: after boot, resolve every nest's photo into the cache so
// popups open instantly with no "?" flash. IndexedDB-backed, so only nests not
// already cached are fetched on later sessions. Throttled (a few in flight) so it
// never competes with the field UI. No-op offline / without creds. Safe to call
// repeatedly (skips anything already cached).
var _apiPrefetchRunning = false;
function apiPrefetchNestPhotos() {
  if (_apiPrefetchRunning || !apiCredsOnline()) return;
  _apiPrefetchRunning = true;
  apiLoadPhotoIdb().then(function () {
    var todo = [];
    (window.fieldApiNests || []).forEach(function (n) {
      if (!n || !n.nest_id) return;
      var id = String(n.nest_id);
      var m = _apiNestPhotoCache[id];
      if (typeof m === "string" || m === false || (m && typeof m.then === "function")) return;
      if (_apiNestPhotoIdb && typeof _apiNestPhotoIdb[id] === "string") {
        _apiNestPhotoCache[id] = _apiNestPhotoIdb[id];   // warm memory from disk
        return;
      }
      todo.push(id);
    });
    if (!todo.length) { _apiPrefetchRunning = false; return; }
    var next = 0, active = 0, MAX = 3;
    function step() {
      while (active < MAX && next < todo.length) {
        active++;
        apiResolveNestPhoto(todo[next++]).then(function () {
          active--;
          if (next < todo.length) step();
          else if (active === 0) _apiPrefetchRunning = false;
        });
      }
      if (next >= todo.length && active === 0) _apiPrefetchRunning = false;
    }
    step();
  }).catch(function () { _apiPrefetchRunning = false; });
}
window.NestApiData.prefetchNestPhotos = apiPrefetchNestPhotos;

// Fill a popup's .api-nest-photo-slot. map_weather.js's renderMapPoints()
// calls this on popupopen -- the only hook the renderer needs from here.
window.NestApiData.lazyLoadNestPhoto = apiLazyLoadNestPhoto;

// THE resolver: nest_id -> dataURI | false. Checks memory, then IndexedDB, then
// the network -- the gps point's nav_photo, ELSE a disk photo from the `photo`
// table. Exposed so the nest-info page uses this same path instead of its own
// weaker one (it only looked at nav_photo, so a nest whose photo lives in the
// photo table -- e.g. NQ060 -- showed in the popup but not on its page).
window.NestApiData.resolveNestPhoto = apiResolveNestPhoto;

window.fieldNavigateNest = function (nestId) {
  var idx = apiPointCoordIndex();
  var nest = (window.fieldApiNests || []).filter(function (n) {
    return n && n.nest_id === nestId;
  })[0];
  var c = null;
  if (nest && nest.gps_point_id && idx[nest.gps_point_id]) c = idx[nest.gps_point_id];
  if (!c && typeof niCoords === "function") c = niCoords(nestId);
  if (c && typeof startNavigation === "function") {
    startNavigation({ latitude: c.lat, longitude: c.lng, point_name: nestId });
  }
};
