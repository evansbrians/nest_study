// nestapi_map.js -- live API nest overlay.
//
// Renders ALL nests (GET /nests, loaded by nestapi_wiring into
// window.fieldApiNests) as markers on the leaflet map -- including app-created
// nests absent from the baked map data. One marker per shared GPS point (the
// current nest wins, so a quail NQ shows instead of the concluded nest it
// replaced). Current nests are full opacity; concluded (non-current) nests are
// faded to 50%. Icon mirrors make_field_map.R (brood status / failed stage).
//
// Assembled INTO the main field-map IIFE (after field_map_app.js), so it can
// call startNavigation / niCoords / escapeHtml directly. Exposes
// window.fieldRenderApiNests, which nestapi_wiring.js calls after each load/sync.
// Gated on hasCreds(): a no-token build renders nothing here (baked map only).
// The baked "Nests" group is cleared so this layer is the sole nest source.

var _apiNestLayer = null;

// ---- "Subset to today's data" filter ------------------------------------
//
// The baked R "Nests" group is cleared by this overlay (fieldRenderApiNests),
// so map_weather.js's applyFilter() -- which only sweeps the layerManager
// PATCH_GROUPS -- never touches API nests. Result: the "Subset to today's
// data" switch + patch dropdown were IGNORED for the live overlay (bug #3).
//
// map_weather.js keeps its filter state (filterToday / filterPatch) closure-
// private and exposes nothing, but it DOES react to the SAME window
// postMessage events the host page broadcasts (field_map_app.js posts
// {type:"setToday", on} and {type:"setPatch", name}). We mirror that state
// here and re-run the overlay so the two stay in lock-step.
//
// "on" is the default (todayToggle is `checked` in field_map.qmd).
var _apiFilterToday = true;
var _apiFilterPatch = "__all__";

// Test patches are filtered by patch_id (they have no polygon); their nests
// carry NSP/NLB prefixes and are hidden from the "All patches" view -- mirrors
// map_weather.js.
var API_TEST_PATCHES = { test_snedgen_park: true, test_long_branch: true };
function apiIsTestPatch(name) { return !!API_TEST_PATCHES[name]; }
function apiIsTestNest(nest) {
  return /^(NSP|NLB)\d+$/.test(String((nest && nest.nest_id) || ""));
}

// Which patches are active given switch + dropdown. null = no spatial subset
// (show everything). Mirrors map_weather.js activePatchNames(): if the schedule
// has no patches for today, the switch is treated as inactive so the map never
// goes blank.
function apiActivePatchNames() {
  var tp = (_apiFilterToday && window.fieldToday && window.fieldToday.patches) || null;
  if (tp && tp.length) {
    if (_apiFilterPatch && _apiFilterPatch !== "__all__") {
      return tp.indexOf(_apiFilterPatch) >= 0 ? [_apiFilterPatch] : tp;
    }
    return tp;
  }
  if (_apiFilterPatch && _apiFilterPatch !== "__all__") return [_apiFilterPatch];
  return null;
}

// Distance (m) from a lat/lng to a patch (array of [lat,lng] rings); 0 if
// inside. Self-contained copy of map_weather.js pointToPatch (its version is
// closure-private), using the same local equirectangular projection.
function apiPointToPatch(lat, lng, rings) {
  var mLat = 110540, mLng = 111320 * Math.cos(lat * Math.PI / 180);
  var minD = Infinity, inside = false;
  for (var r = 0; r < rings.length; r++) {
    var ring = rings[r], pts = [];
    for (var k = 0; k < ring.length; k++) {
      pts.push([(ring[k][1] - lng) * mLng, (ring[k][0] - lat) * mLat]);
    }
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > 0) !== (yj > 0)) &&
          (0 < (xj - xi) * (0 - yi) / (yj - yi) + xi)) inside = !inside;
      var dx = xj - xi, dy = yj - yi, len2 = dx * dx + dy * dy;
      var t = len2 ? ((0 - xi) * dx + (0 - yi) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      var cx = xi + t * dx, cy = yi + t * dy;
      var d = Math.sqrt(cx * cx + cy * cy);
      if (d < minD) minD = d;
    }
  }
  return inside ? 0 : minD;
}

// Should this nest, displayed at coord c, be shown under the active filter?
// Mirrors map_weather.js applyFilter for the "Nests" group:
//   names === null  -> show all real nests, hide test-site nests;
//   names non-empty -> show a nest within 50 m of an active patch, OR a test
//                      nest whose patch_id is an active test patch.
function apiNestPassesFilter(nest, c) {
  var names = apiActivePatchNames();
  if (names === null) {
    return !apiIsTestNest(nest);   // hide test nests from the all-patches view
  }
  var nameSet = {};
  var rings = [];
  names.forEach(function (n) {
    nameSet[n] = true;
    if (window.fieldPatches && window.fieldPatches[n]) rings.push(window.fieldPatches[n]);
  });
  if (c && c.lat != null && c.lng != null) {
    for (var i = 0; i < rings.length; i++) {
      if (apiPointToPatch(Number(c.lat), Number(c.lng), rings[i]) <= 50) return true;
    }
  }
  // Test patches have no polygon: match by patch_id.
  if (nest && nest.patch_id && nameSet[nest.patch_id] && apiIsTestPatch(nest.patch_id)) {
    return true;
  }
  return false;
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

function apiNestIsCurrent(nest) {
  return nest.is_current === 1 || nest.is_current === true;
}

// Brood status, mirroring make_field_map.R (host eggs/young only, per the baked
// logic). max_* is the peak over all checks; last_* is the latest check.
function apiNestBroodStatus(nest) {
  var fate = nest.nest_fate;
  var maxYoung = Number(nest.max_young) || 0;
  var maxEggs = Number(nest.max_eggs) || 0;
  var lastYoung = Number(nest.last_young) || 0;
  var lastEggs = Number(nest.last_eggs) || 0;
  if (fate === "Success") return "Fledged";
  if (fate === "Failure" && maxYoung > 0) return "Failed: Nestling stage";
  if (fate === "Failure" && maxEggs > 0) return "Failed: Egg stage";
  if (apiNestIsArtificial(nest)) return "Artificial";
  if (lastYoung > 0) return "Nestlings";
  if (lastEggs > 0) return "Eggs";
  return "Inactive";
}

// icon_id, mirroring make_field_map.R's case_when. Artificial nests are keyed on
// apiNestIsArtificial (NQ id OR species_code "ARNE") -- NOT the NQ id alone -- so
// an ARNE nest identified only by species still resolves to the artificial icons.
// A failed artificial nest maps to nest_failed_artificial (both icons exist in
// window.fieldNestIcons), and the final return guarantees a valid icon id.
function apiNestIconId(nest) {
  var isArtificial = apiNestIsArtificial(nest);
  var bs = apiNestBroodStatus(nest);
  if (isArtificial && nest.nest_fate === "Failure") return "nest_failed_artificial";
  if (isArtificial) return "nest_artificial";
  if (bs === "Fledged" || bs === "Nestlings") return "nest_active_nestlings";
  if (bs === "Eggs") return "nest_active_eggs";
  if (bs === "Failed: Nestling stage") return "nest_failed_nestlings";
  if (bs === "Failed: Egg stage") return "nest_failed_eggs";
  if (bs === "Artificial") return "nest_artificial";
  return "nest_inactive";
}

// Display sizes: match the ORIGINAL R map (make_field_map.R / make_flexsize_icon,
// .icon_width = 20.25, .modify_height = TRUE), so width is pinned to 20.25px and
// height = 20.25 * (pngHeight / pngWidth) per icon's real aspect ratio.
var NEST_ICON_WIDTH = 20.25;
var NEST_ICON_SIZE = {
  nest_active_eggs: [20.25, 14.28],       // 397x280
  nest_active_nestlings: [20.25, 17.46],  // 638x550
  nest_artificial: [20.25, 14.28],        // 397x280
  nest_inactive: [20.25, 12.4],           // 397x243
  nest_failed_eggs: [20.25, 14.28],       // 638x450
  nest_failed_nestlings: [20.25, 17.46],  // 638x550
  nest_failed_artificial: [20.25, 14.28]  // 397x280
};

// Zoom-driven icon scale, mirroring map_weather.js scaleIconsForZoom:
//   s = clamp(1 - (19 - z) * 0.1, 0.1, 1). The baked "Nests" icons grow/shrink
//   with zoom; this overlay clears that group, so we must reproduce the factor
//   ourselves (see the zoomend handler registered in fieldRenderApiNests) so
//   the live nests scale in lock-step with everything else on the map.
function apiZoomScale() {
  var map = window.fieldMap;
  var z = (map && typeof map.getZoom === "function") ? map.getZoom() : 19;
  return Math.min(1, Math.max(0.1, 1 - (19 - z) * 0.1));
}

// Current/active nests render 1.15x larger, mirroring make_field_map.R's
// fieldNestBig (applied by map_weather.js's scaleIconsForZoom) so live nests
// stand out from the faded, concluded ones.
var NEST_CURRENT_SCALE = 1.15;

// Build a nest marker's icon, combining the zoom factor (s, from apiZoomScale)
// with the 1.15 current-nest bump so both apply cleanly to the same base size.
// zoomScale defaults to the map's current zoom factor; the zoomend handler
// passes the fresh factor so it doesn't recompute it per marker.
function apiNestLeafletIcon(iconId, isCurrent, zoomScale) {
  var icons = window.fieldNestIcons || {};
  // Resolve to an EXISTING inlined icon: use the requested id if present, else
  // fall back to nest_inactive so a valid status/id that somehow lacks an inlined
  // PNG (or an unexpected id) still draws a marker rather than silently failing.
  var resolvedId = icons[iconId] ? iconId : "nest_inactive";
  var url = icons[resolvedId];
  if (!url) return null;   // icons not inlined at all -> caller falls back to a dot
  var base = NEST_ICON_SIZE[resolvedId] || [NEST_ICON_WIDTH, 14];
  var s = (zoomScale == null ? apiZoomScale() : zoomScale) *
          (isCurrent ? NEST_CURRENT_SCALE : 1);
  var sz = [base[0] * s, base[1] * s];
  return L.icon({
    iconUrl: url,
    iconSize: sz,
    iconAnchor: [sz[0] / 2, sz[1] / 2],
    popupAnchor: [0, -sz[1] / 2],
    tooltipAnchor: [0, -sz[1] / 2]
  });
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
var _apiNestPhotoCache = {};

function apiCredsOnline() {
  return !!(window.NestApi && NestApi.settings && NestApi.settings.hasCreds() &&
    NestApi.api && NestApi.api.isOnline());
}

// GET /photos/<id> with the bearer token -> object URL (bytes are binary, so
// NestApi.api.request -- which parses text/JSON -- can't be used here).
function apiFetchPhotoObjectUrl(photoId) {
  var base = NestApi.settings.getUrl();
  var token = NestApi.settings.getToken();
  var headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  return fetch(base + "/photos/" + encodeURIComponent(photoId), { headers: headers })
    .then(function (r) { return r.ok ? r.blob() : null; })
    .then(function (b) { return b ? URL.createObjectURL(b) : null; });
}

function apiSetSlotPhoto(slot, uri) {
  if (!slot || !uri || slot.getAttribute("data-loaded")) return;
  slot.setAttribute("data-loaded", "1");
  var im = document.createElement("img");
  im.src = uri;
  im.style.maxWidth = "180px";
  im.style.maxHeight = "180px";
  im.style.borderRadius = "4px";
  slot.appendChild(im);
}

function apiLazyLoadNestPhoto(nestId, slot) {
  if (!nestId || !slot || !apiCredsOnline()) return;
  var cached = _apiNestPhotoCache[nestId];
  if (cached === false) return;                       // known: no photo anywhere
  if (typeof cached === "string") { apiSetSlotPhoto(slot, cached); return; }
  if (cached === "pending") return;
  _apiNestPhotoCache[nestId] = "pending";
  NestApi.api.getNest(nestId).then(function (detail) {
    // 1. the point's nav_photo (base64) the map didn't already carry.
    var uri = asDataUri(detail && detail.gps_point && detail.gps_point.nav_photo);
    if (uri) { _apiNestPhotoCache[nestId] = uri; apiSetSlotPhoto(slot, uri); return null; }
    // 2. a disk photo from the `photo` table (discovery preferred).
    var photos = (detail && detail.photos) || [];
    var pick = photos.filter(function (p) { return p && p.kind === "discovery"; })[0] || photos[0];
    if (!pick || pick.photo_id == null) { _apiNestPhotoCache[nestId] = false; return null; }
    return apiFetchPhotoObjectUrl(pick.photo_id).then(function (url) {
      _apiNestPhotoCache[nestId] = url || false;
      if (url) apiSetSlotPhoto(slot, url);
      return null;
    });
  }).catch(function () { _apiNestPhotoCache[nestId] = undefined; });   // allow a retry
}

// Rich popup mirroring make_nest_popup (the nest_app popup): discovery + latest-
// check summary, optional nav photo, and the standard nest actions.
function apiNestPopupHtml(nest, photo) {
  var id = String(nest.nest_id);
  var idJs = id.replace(/'/g, "\\'");
  var esc = escapeHtml;
  var dash = function (v) {
    return (v == null || v === "") ? "—" : esc(String(v));
  };
  var species = nest.species_other || nest.species_common || nest.species_code;

  // Discovery photo, best available source:
  //  1. a photo field carried on the nest row itself (if the API ever inlines one),
  //  2. niFindPhoto(nest_id) -- the app-cached / baked discovery photo for this nest,
  //  3. the gps point's nav_photo (passed in as `photo`), taken at discovery here.
  var rawPhoto =
    nest.discovery_photo || nest.photo || nest.nav_photo ||
    (typeof niFindPhoto === "function" ? niFindPhoto(id) : null) ||
    photo;
  var img = asDataUri(rawPhoto);

  // Order: photo first, then the nest details, then the action buttons.
  var html = '<div style="font-family:Times;min-width:190px;">';
  if (img) {
    html += '<div style="margin:0 0 6px;"><img src="' + img +
      '" style="max-width:180px;max-height:180px;border-radius:4px;"></div>';
  } else {
    // No photo in what the map already holds (typical for old/migrated nests):
    // leave a slot the popupopen handler fills via a lazy GET /nests/<id>.
    html += '<div class="api-nest-photo-slot" data-nest="' + esc(id) +
      '" style="margin:0 0 6px;"></div>';
  }
  html +=
    "<h3 style=\"margin:0 0 4px;\"><strong>" + esc(id) +
    "</strong>. Species: " + (species ? esc(String(species)) : "—") + "</h3>" +
    "<ul style=\"margin:0 0 6px;padding-left:16px;\">" +
    "<li><strong>Patch</strong>: " + esc(prettyPatch(nest.patch_id)) + "</li>" +
    "<li><strong>Plant species</strong>: " + dash(nest.substrates) + "</li>" +
    "<li><strong>Height</strong>: " + dash(nest.height_m) + "</li>" +
    "<li><strong>Location description</strong>: " + dash(nest.location_description) + "</li>" +
    "<li><strong>Discovered on</strong>: " + dash(nest.discovery_date) + "</li>" +
    "<li><strong>Last checked on</strong>: " + dash(nest.last_check) + "</li>" +
    "<li><strong>Current status</strong>: " + esc(apiNestBroodStatus(nest)) + "</li>" +
    "<li><strong>N eggs (last check)</strong>: " + dash(nest.last_eggs) + "</li>" +
    "<li><strong>N young (last check)</strong>: " + dash(nest.last_young) + "</li>" +
    "</ul>" +
    '<div style="margin-top:4px;">' +
    '<button type="button" class="field-popup-btn" onclick="window.fieldNavigateNest(\'' + idJs + '\')">Navigate</button> ' +
    '<button type="button" class="field-popup-btn" onclick="window.fieldOpenNestModify(\'' + idJs + '\')">Modify</button>' +
    // "Add interval" is only wired when field_map_app.js has exposed the global,
    // so the popup degrades gracefully in a build without it.
    (typeof window.fieldAddInterval === "function"
      ? ' <button type="button" class="field-popup-btn" onclick="window.fieldAddInterval(\'' + idJs + '\')">Add interval</button>'
      : '') +
    '</div></div>';
  return html;
}

// All nests in `list` share one point. Mirror make_field_map.R, which at a
// shared point DROPS the host "N###" whenever its artificial "NQ###" twin
// exists (filter(!name %in% str_replace(NQ..., "^NQ", "N"))) -- so the
// ARTIFICIAL nest always wins its shared point, even once it has FAILED
// (concluded, is_current = 0). Without this, a failed ARNE that shares its
// host's GPS point loses to the still-current host and never shows the
// failed-artificial icon (bug #1). Ordering:
//   1. artificial nests (NQ / ARNE) win the point outright;
//   2. within the winning pool, a current nest beats a concluded one (so a
//      live nest still beats an old one when neither is artificial, and a
//      still-active ARNE beats a concluded ARNE);
//   3. ties break to the newest discovery_date.
function pickDisplayForPoint(list) {
  var artificial = list.filter(apiNestIsArtificial);
  var pool = artificial.length ? artificial : list;
  var current = pool.filter(apiNestIsCurrent);
  pool = current.length ? current : pool;
  pool.sort(function (a, b) {
    return String(b.discovery_date || "").localeCompare(String(a.discovery_date || ""));
  });
  return pool[0];
}

// Navigate to a nest by id (popup action). Prefers the API point coords, falls
// back to whatever niCoords knows.
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

// (Re)draw the overlay from the current globals. Safe to call repeatedly.
window.fieldRenderApiNests = function () {
  if (!window.NestApi || !NestApi.settings || !NestApi.settings.hasCreds()) return;
  var map = window.fieldMap;
  if (!map || typeof L === "undefined") return;

  // Rescale the overlay's icons on zoom, mirroring map_weather.js's zoomend
  // handler on the baked "Nests" group. Registered ONCE per map (guard flag),
  // since fieldRenderApiNests re-runs on every load/filter change. Each marker
  // is rebuilt from its remembered base icon id + current flag with the fresh
  // zoom factor, so the zoom and 1.15 current-nest factors stay combined.
  if (!map._apiNestZoomBound) {
    map._apiNestZoomBound = true;
    map.on("zoomend", function () {
      if (!_apiNestLayer) return;
      var s = apiZoomScale();
      _apiNestLayer.eachLayer(function (m) {
        if (!m || m._apiIconId == null || typeof m.setIcon !== "function") return;
        var ic = apiNestLeafletIcon(m._apiIconId, m._apiIsCurrent, s);
        if (ic) m.setIcon(ic);
      });
    });
  }

  // Retire the baked nest markers (an R-leaflet group, hidden by default) so
  // this live layer is the SOLE nest source -- prevents duplicates if the user
  // toggles the baked "Nests" group on. Safe no-op if the API isn't present.
  try {
    if (map.layerManager && typeof map.layerManager.clearGroup === "function") {
      map.layerManager.clearGroup("Nests");
    }
  } catch (e) {}

  var nests = window.fieldApiNests || [];
  var coordIdx = apiPointCoordIndex();

  // Resolve a nest's map coordinate. Prefer the API gps-point index (keyed by
  // gps_point_id); if that misses -- e.g. a change-feed refetch rebuilt
  // fieldMapPoints without this nest's point, or the point lacks a name and was
  // filtered out -- fall back to niCoords(nest_id) (fieldMapPoints-by-name plus
  // the local waypoint store). This stops a nest from silently VANISHING on a
  // later render just because its point dropped out of the freshly-built index.
  function coordForNest(n) {
    if (n && n.gps_point_id && coordIdx[n.gps_point_id]) return coordIdx[n.gps_point_id];
    if (n && n.nest_id && typeof niCoords === "function") {
      var c = niCoords(String(n.nest_id));
      if (c && c.lat != null && c.lng != null) return { lat: c.lat, lng: c.lng, photo: null };
    }
    return null;
  }

  // Group nests that share a display location by their rounded lat,lng, so EVERY
  // nest at one physical point -- resolved via gps_point_id OR the niCoords
  // fallback -- collapses to a SINGLE marker (pickDisplayForPoint lets the
  // current nest win). Keying on gps_point_id split a concluded nest and a
  // co-located current nest (different point ids, same spot) into TWO stacked
  // markers; the faded one sat UNDER the full-opacity current marker, which
  // intercepted every tap, so the concluded nest's popup could never open
  // (bug #6). Position keying leaves a standalone concluded nest its own marker
  // -- popup and all -- while never burying it beneath a current one.
  var byPoint = {};
  var coordByKey = {};
  nests.forEach(function (n) {
    if (!n) return;
    var c = coordForNest(n);
    if (!c) return;   // no resolvable coordinate anywhere -> genuinely unmappable
    var key = "ll:" + Number(c.lat).toFixed(6) + "," + Number(c.lng).toFixed(6);
    coordByKey[key] = c;
    (byPoint[key] = byPoint[key] || []).push(n);
  });

  if (_apiNestLayer) { map.removeLayer(_apiNestLayer); _apiNestLayer = null; }
  _apiNestLayer = L.layerGroup();

  Object.keys(byPoint).forEach(function (pid) {
    var nest = pickDisplayForPoint(byPoint[pid]);
    var c = coordByKey[pid];
    if (!c) return;
    // "Subset to today's data" / patch dropdown: skip nests that aren't in the
    // active patch set, matching the baked map's behaviour (bug #3).
    if (!apiNestPassesFilter(nest, c)) return;
    var faded = !apiNestIsCurrent(nest);   // concluded nests render at 50%
    var iconId = apiNestIconId(nest);
    var licon = apiNestLeafletIcon(iconId, !faded);
    var m;
    if (licon) {
      m = L.marker([c.lat, c.lng], { icon: licon, opacity: faded ? 0.5 : 1 });
      // Remember what to rebuild on zoom (see the zoomend handler): the icon id
      // and whether the 1.15 current-nest bump applies.
      m._apiIconId = iconId;
      m._apiIsCurrent = !faded;
    } else {
      // Fallback if the inlined icons aren't present: a colored dot.
      m = L.circleMarker([c.lat, c.lng], {
        radius: 7,
        weight: 2,
        color: "#ffffff",
        fillColor: apiNestIsArtificial(nest) ? "#2b6cb0" : "#2f855a",
        fillOpacity: faded ? 0.45 : 0.95
      });
    }
    m.bindPopup(apiNestPopupHtml(nest, c.photo));
    // Old/migrated nests carry no photo in fieldMapPoints; fill the popup's
    // photo slot on open via a lazy GET /nests/<id> (see apiLazyLoadNestPhoto).
    m.on("popupopen", function (ev) {
      var el = ev.popup && ev.popup.getElement && ev.popup.getElement();
      var slot = el && el.querySelector(".api-nest-photo-slot");
      if (slot) apiLazyLoadNestPhoto(slot.getAttribute("data-nest"), slot);
    });
    // Id label, hidden by default (shows on hover -- like the baked map).
    m.bindTooltip(String(nest.nest_id), {
      permanent: false,
      direction: "top",
      offset: [0, -6],
      className: "api-nest-label"
    });
    _apiNestLayer.addLayer(m);
  });

  _apiNestLayer.addTo(map);
};

// Keep the overlay's filter state in lock-step with map_weather.js by listening
// to the SAME host-page broadcasts (field_map_app.js posts these on the
// "Subset to today's data" switch + patch dropdown). map_weather.js's own
// listener repositions/opacity-filters the baked groups; ours re-renders the
// live API overlay with the new patch subset. Toggling the switch also resets
// the dropdown to "__all__" in the host page (it posts setPatch too), so we
// honour both messages. Re-render only when creds are present (no-op otherwise).
window.addEventListener("message", function (e) {
  var d = e && e.data;
  if (!d || !d.type) return;
  var changed = false;
  if (d.type === "setToday") { _apiFilterToday = !!d.on; changed = true; }
  else if (d.type === "setPatch") { _apiFilterPatch = d.name || "__all__"; changed = true; }
  if (changed && typeof window.fieldRenderApiNests === "function") {
    window.fieldRenderApiNests();
  }
});
