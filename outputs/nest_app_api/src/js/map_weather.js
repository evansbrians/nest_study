// Weather-layer toggle support for the field map.

function(el, x) {

  var map = this;

  // Expose the map (and signal readiness) so field_map_app.js can draw on it:

  window.fieldMap = map;
  window.dispatchEvent(new Event("fieldmap:ready"));

  // Keep the map filled to its container:

  function fitMap() { map.invalidateSize(false); }
  setTimeout(fitMap, 200);
  setTimeout(fitMap, 600);
  window.addEventListener("resize", fitMap);

  // offline satellite tiles -----------------------------------------------

  // make_field_map.R embeds pre-fetched ESRI tiles (window.fieldOfflineTiles,
  // keyed "z/x/y" -> data URI). Serve those when present so the satellite
  // background still renders at the patches with no signal (coyote):

  function patchOfflineTiles() {
    if (!map._layers) return;
    Object.keys(map._layers).forEach(function (id) {
      var layer = map._layers[id];
      if (layer && layer._url && typeof layer.getTileUrl === "function" &&
          /World_Imagery/i.test(layer._url) && !layer._offlinePatched) {
        layer._offlinePatched = true;
        var orig = layer.getTileUrl;
        layer.getTileUrl = function (coords) {
          var t = window.fieldOfflineTiles;
          if (t) {
            var key = coords.z + "/" + coords.x + "/" + coords.y;
            if (t[key]) return t[key];
          }
          return orig.call(this, coords);
        };

        // Re-request visible tiles through the patched function (matters when
        // the page is (re)loaded with no signal:.

        if (typeof layer.redraw === "function") layer.redraw();
      }
    });
  }
  patchOfflineTiles();

  // Scale marker icons with zoom:

  function scaleIconsForZoom() {
    var z = map.getZoom();
    var s = Math.min(1, Math.max(0.1, 1 - (19 - z) * 0.1));
    var size = 20.25 * s;
    eachPatchFeature(function (layer) {
      var img = layer._icon;
      if (!img || img.tagName !== "IMG") return;
      // The size multiplier is the DB's, carried on the marker's row.
      var mult = (layer._row && Number(layer._row.size) > 1)
        ? Number(layer._row.size) : 1;
      // Fixed width; height follows each png's aspect ratio (no square stretch).
      var w = size * mult;
      var ratio = (img.naturalWidth > 0) ? (img.naturalHeight / img.naturalWidth) : 1;
      var h = w * ratio;
      img.style.width = w + "px";
      img.style.height = h + "px";
      img.style.marginLeft = (-w / 2) + "px";
      img.style.marginTop = (-h / 2) + "px";
    });
  }
  map.on("zoomend", scaleIconsForZoom);
  setTimeout(scaleIconsForZoom, 700);

  // ---- Markers, drawn straight from the database -------------------------

  // window.fieldMapMarkers is GET /map_points (the v_map_point view): one row
  // per marker, carrying position, icon_id, opacity, size, and the popup's
  // facts. This renderer just draws what the DB says.

  // Classes this renderer owns. Landmarks are absent by design: the waypoint
  // layer already draws them as coloured circle pins, and rendering them here
  // too put two markers on one spot. One class, one owner.

  var MARKER_GROUP_FOR = {
    nest: "Nests",
    coverboard: "Coverboards",
    trailcam: "Trail Cameras",
    point_count: "Point Counts"
  };

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function dash(v) {
    return (v === null || v === undefined || v === "") ? "&mdash;" : esc(v);
  }

  // The DB's two fades, applied separately: non-current always, not-scheduled-
  // today only while the "today" toggle is on. v_map_point also ships a
  // combined `opacity`, but that alone can't tell the two apart.

  function opacityFor(layer) {
    var r = layer && layer._row;
    if (!r) return 1;
    var cur = (Number(r.is_current) === 0) ? 0.5 : 1;
    var today = (filterToday && Number(r.scheduled_today) === 0) ? 0.5 : 1;
    return Math.min(cur, today);
  }

  // Popup markup, composed from the row's facts. Nests get the full detail +
  // actions; infrastructure points just name themselves.
  function markerPopupHtml(r) {
    var id = esc(r.name);
    if (String(r.class) !== "nest") {
      return '<div style="font-family:Times;"><h3 style="margin:0;"><strong>' +
        id + "</strong></h3><div>" + esc(r.status || "") + "</div></div>";
    }
    var idJs = String(r.ref_id || r.name).replace(/'/g, "\\'");
    return '<div style="font-family:Times;min-width:190px;">' +
      '<div class="api-nest-photo-slot" data-nest="' + esc(r.ref_id) +
      '" style="margin:0;"></div>' +
      '<div class="api-nest-inside-photo-slot" data-nest="' + esc(r.ref_id) +
      '" style="margin:0 0 6px;"></div>' +
      "<h3 style=\"margin:0 0 4px;\"><strong>" + esc(r.ref_id) +
      "</strong>. Species: " + dash(r.species) + "</h3>" +
      "<ul style=\"margin:0 0 6px;padding-left:16px;\">" +
      "<li><strong>Patch</strong>: " + dash(r.patch) + "</li>" +
      "<li><strong>Plant species</strong>: " + dash(r.substrates) + "</li>" +
      "<li><strong>Height</strong>: " + dash(r.height_m) + "</li>" +
      "<li><strong>Location description</strong>: " + dash(r.location_description) + "</li>" +
      "<li><strong>Discovered on</strong>: " + dash(r.discovery_date) + "</li>" +
      "<li><strong>Last checked on</strong>: " + dash(r.last_check) + "</li>" +
      "<li><strong>Current status</strong>: " + dash(r.status) + "</li>" +
      "<li><strong>N eggs (last check)</strong>: " + dash(r.last_eggs) + "</li>" +
      "<li><strong>N young (last check)</strong>: " + dash(r.last_young) + "</li>" +
      "</ul>" +
      '<div style="margin-top:4px;">' +
      '<button type="button" class="field-popup-btn" onclick="window.fieldNavigateNest(\'' + idJs + '\')">Navigate</button> ' +
      '<button type="button" class="field-popup-btn" onclick="window.fieldAddInterval(\'' + idJs + '\')">Add interval</button> ' +
      '<button type="button" class="field-popup-btn" onclick="window.fieldOpenNestInfo(\'' + idJs + '\')">Nest page</button>' +
      "</div></div>";
  }

  // Idempotent: clears the marker groups first, so a re-render after a live
  // change replaces the markers instead of stacking duplicates on top.
  function renderMapPoints() {
    var rows = window.fieldMapMarkers;
    if (!Array.isArray(rows) || !window.fieldIcons || !window.L ||
        !map.layerManager) return;

    var seen = {};
    Object.keys(MARKER_GROUP_FOR).forEach(function (c) {
      var g = MARKER_GROUP_FOR[c];
      if (seen[g]) return;
      seen[g] = true;
      try { map.layerManager.clearGroup(g); } catch (e) {}
    });

    var idx = 0;
    rows.forEach(function (r) {
      if (!r || r.lat === null || r.lat === undefined ||
          r.lng === null || r.lng === undefined) return;
      var gname = MARKER_GROUP_FOR[String(r["class"] || "").toLowerCase()];
      if (!gname) return;

      // No custom png (landmarks) -> Leaflet's built-in marker-icon.png.
      var ic = r.icon && window.fieldIcons[r.icon];
      var marker = ic
        ? window.L.marker([r.lat, r.lng], {
            icon: window.L.icon({
              iconUrl: ic.iconUrl,
              iconSize: [ic.iconWidth, ic.iconHeight],
              iconAnchor: [ic.iconAnchorX, ic.iconAnchorY]
            })
          })
        : window.L.marker([r.lat, r.lng]);

      // The DB's verdict rides WITH the marker -- no lookup table to fall out of
      // sync, and nothing to join on later.
      marker._row = r;
      marker._pointId = r.idx;
      marker._patch = r.patch;
      if (String(r["class"]) === "nest") {
        marker._nestId = r.ref_id;
        marker.setZIndexOffset(1000);
      }
      marker.bindPopup(markerPopupHtml(r));
      marker.setOpacity(opacityFor(marker));

      // A nest's photo is the one thing the view can't carry (auth-gated bytes),
      // so fill the slot lazily on open -- nestapi_map.js owns that fetch/cache.
      if (String(r["class"]) === "nest" && r.ref_id) {
        marker.on("popupopen", function (ev) {
          var el = ev.popup && ev.popup.getElement && ev.popup.getElement();
          if (!el || !window.NestApiData ||
              typeof window.NestApiData.lazyLoadNestPhoto !== "function") return;
          var slot = el.querySelector(".api-nest-photo-slot");
          if (slot) window.NestApiData.lazyLoadNestPhoto(r.ref_id, slot, "location");
          var inside = el.querySelector(".api-nest-inside-photo-slot");
          if (inside) window.NestApiData.lazyLoadNestPhoto(r.ref_id, inside, "inside");
        });
      }

      map.layerManager.addLayer(marker, "marker", gname + "-" + (idx++), gname);
    });

    // applyFilter() ran long before these markers arrived, so re-run it or the
    // initial view shows everything instead of today's patches. noFit: a live
    // refresh must not yank the map away from where the user put it.
    applyFilter({ noFit: true });
  }

  // Re-render whenever fresh rows land (boot, or a live change-feed refresh).
  window.fieldRenderMapPoints = renderMapPoints;
  renderMapPoints();

  // patches + paths (step B5) ---------------------------------------------

  // Draw patch boundaries and Garmin paths into the same "Patches" / "Paths"
  // layerManager groups the layers control and filter already drive, so the R
  // addPolygons/addPolylines are no longer needed.

  function prettyPatch(n) {
    n = String(n).replace(/_/g, " ");
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  function renderShapes() {
    if (!window.L || !map.layerManager) return;
    if (window.fieldPatches) {
      Object.keys(window.fieldPatches).forEach(function (name) {
        var rings = window.fieldPatches[name];
        if (!rings || !rings.length) return;
        var poly = window.L.polygon(rings, {
          fillColor: "#ffffff",
          fillOpacity: 0.2,
          color: "#0000ff",
          weight: 1.5,
          opacity: 0.5
        });
        poly.bindPopup(prettyPatch(name));
        poly.bindTooltip(prettyPatch(name));
        map.layerManager.addLayer(poly, "shape", "patch-" + name, "Patches");
      });
    }
    if (window.fieldPaths) {
      window.fieldPaths.forEach(function (path, i) {
        if (!path || !path.length) return;
        var line = window.L.polyline(path, {
          weight: 3,
          opacity: 0.7,
          dashArray: "2, 5",
          color: "#ffff00"
        });
        map.layerManager.addLayer(line, "shape", "path-" + i, "Paths");
      });
    }
  }
  renderShapes();

  // bottom-bar readouts ---------------------------------------------------

  // Mirror GPS accuracy and compass bearing into the bottom bar:

  map.on("locationfound", function(e) {
    var el = document.getElementById("barAccuracy");
    if (el) el.textContent = "Accuracy: " + Math.round(e.accuracy) + " m";
    window.fieldLatLng = e.latlng;       // read by the Add Waypoint readout
    window.fieldAccuracy = e.accuracy;   // live single-fix accuracy (m)
  });

  setInterval(function() {
    var el = document.getElementById("barBearing");
    var g = document.querySelector(".heading-group");
    if (!el || !g) return;
    var t = g.getAttribute("transform");
    var m = t && t.match(/rotate\(\s*(-?[\d.]+)/);
    if (m) {
      var deg = (Math.round(parseFloat(m[1])) % 360 + 360) % 360;
      el.textContent = "Bearing: " + deg + "°";
      window.fieldBearing = deg;   // read by the Add Waypoint form
    }
  }, 250);

  // map layer options -----------------------------------------------------

  // Layer visibility:
  // - setWeather  -- Precipitation + NEXRAD              (default off)
  // - setPatches  -- patch boundaries                    (default on)
  // - setSampling -- coverboards/cams/point counts/nests (default on)
  // - setBasemap  -- offer the Street Map base layer     (default off)

  function group(name) {
    return map.layerManager ? map.layerManager.getLayerGroup(name, false) : null;
  }

  // Is this layer already listed in the layers control? Guards against
  // adding duplicate rows.

  function inControl(layer) {
    var c = map.currentLayersControl;
    return !!(c && c._layers &&
      c._layers.some(function(o) { return o.layer === layer; }));
  }

  function showLayer(g) { if (g && !map.hasLayer(g)) map.addLayer(g); }
  function hideLayer(g) { if (g && map.hasLayer(g)) map.removeLayer(g); }

  function listOverlay(name, g) {
    var c = map.currentLayersControl;
    if (c && g && typeof c.addOverlay === "function" && !inControl(g)) {
      c.addOverlay(g, name);
    }
  }
  function listBase(name, g) {
    var c = map.currentLayersControl;
    if (c && g && typeof c.addBaseLayer === "function" && !inControl(g)) {
      c.addBaseLayer(g, name);
    }
  }
  function delist(g) {
    var c = map.currentLayersControl;
    if (c && g && typeof c.removeLayer === "function") c.removeLayer(g);
  }

  // Auto-refresh the weather tiles while they are on (storms can move fast). A
  // changing `_ts` param busts the browser/CDN cache so we actually pull the
  // latest NOAA frame rather than redrawing the cached one.

  var WEATHER_REFRESH_MS = 60000;   // once a minute
  var weatherTimer = null;

  function refreshWeather() {
    ["Precipitation", "NEXRAD"].forEach(function(name) {
      var g = group(name);
      if (!g || typeof g.eachLayer !== "function") return;
      g.eachLayer(function(layer) {
        if (layer && typeof layer.setParams === "function") {
          layer.setParams({ _ts: Date.now() });
        } else if (layer && typeof layer.redraw === "function") {
          layer.redraw();
        }
      });
    });
  }

  // Precipitation and NEXRAD: 
  // - on = shown + listed
  // - off = hidden + delisted.

  function setWeather(on) {
    ["Precipitation", "NEXRAD"].forEach(function(name) {
      var g = group(name);
      if (!g) return;
      if (on) { showLayer(g); listOverlay(name, g); }
      else { delist(g); hideLayer(g); }
    });
    if (weatherTimer) { clearInterval(weatherTimer); weatherTimer = null; }
    if (on) weatherTimer = setInterval(refreshWeather, WEATHER_REFRESH_MS);
  }

  // Patch boundaries: 
  // - on (default) = shown + dropped from the table of contents
  // - off = added to the TOC as a normal (hidden) overlay you can toggle.

  function setPatches(on) {
    var g = group("Patches");
    if (!g) return;
    if (on) { showLayer(g); delist(g); }
    else { listOverlay("Patches", g); hideLayer(g); }
  }

  // Sampling points stay in the table of contents either way; this just
  // shows or hides them (their TOC checkboxes follow).

  function setSampling(on) {
    ["Coverboards", "Trail Cameras", "Point Counts", "Nests"].forEach(function(name) {
      var g = group(name);
      if (!g) return;
      if (on) showLayer(g); else hideLayer(g);
    });
  }

  // OpenStreetMap base: 
  // - on = Satellite + Street Map both offered as base layers in the TOC
  // - off (default) = no base switcher in the TOC, only Satellite shown.

  function setBasemap(on) {
    var sat = group("Satellite");
    var street = group("Street Map");
    if (on) {
      listBase("Satellite", sat);
      listBase("Street Map", street);

      // Keep Satellite as the active base.

      showLayer(sat);
    } else {
      delist(street);
      delist(sat);
      hideLayer(street);
      showLayer(sat);
    }
  }

  // patch filter ----------------------------------------------------------

  // Show only features within 50 m of the chosen patch. Patch outlines come
  // from window.fieldPatches (embedded by make_field_map.R) as rings of
  // [lat, lng]. Distances use a local equirectangular projection.

  // Patch boundaries are deliberately absent: only the "Include patch
  // boundaries" toggle governs them, so the today-subset never hides them.
  // applyFilter still subsets the points and zooms via patchBounds().

  // Groups applyFilter() sweeps for the patch/today subset. "Waypoints" is here
  // so tech-recorded points (landmarks included) hide with the patches they sit
  // in, rather than always showing.
  var PATCH_GROUPS =
    ["Nests", "Coverboards", "Trail Cameras", "Point Counts", "Paths", "Waypoints"];

  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + t * dx, cy = ay + t * dy;
    return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
  }

  // Distance (m) from a lat/lng point to a patch (array of rings); 0 if inside.

  function pointToPatch(lat, lng, rings) {
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
        var d = segDist(0, 0, xi, yi, xj, yj);
        if (d < minD) minD = d;
      }
    }
    return inside ? 0 : minD;
  }

  function featureWithin(layer, rings, maxD) {
    if (typeof layer.getLatLng === "function") {
      var ll = layer.getLatLng();
      return pointToPatch(ll.lat, ll.lng, rings) <= maxD;
    }
    if (typeof layer.getLatLngs === "function") {
      var hit = false;
      (function walk(a) {
        if (!a || hit) return;
        if (a.lat != null) {
          if (pointToPatch(a.lat, a.lng, rings) <= maxD) hit = true;
          return;
        }
        if (a.length) for (var i = 0; i < a.length; i++) walk(a[i]);
      })(layer.getLatLngs());
      return hit;
    }
    return true;
  }

  function eachPatchFeature(cb) {
    PATCH_GROUPS.forEach(function (gname) {
      var g = group(gname);
      if (g && typeof g.eachLayer === "function") {
        g.eachLayer(function (layer) { cb(layer, gname); });
      }
    });
  }

  function ringsBounds(ringSets) {
    var minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity, has = false;
    ringSets.forEach(function (ring) {
      ring.forEach(function (p) {
        has = true;
        if (p[0] < minLat) minLat = p[0];
        if (p[0] > maxLat) maxLat = p[0];
        if (p[1] < minLng) minLng = p[1];
        if (p[1] > maxLng) maxLng = p[1];
      });
    });
    return has ? [[minLat, minLng], [maxLat, maxLng]] : null;
  }

  // Bounds for a set of patch names (null/empty -> all patches).

  function patchBounds(names) {
    if (!window.fieldPatches) return null;
    var src = (names && names.length)
      ? names
      : Object.keys(window.fieldPatches);
    var all = [];
    src.forEach(function (n) {
      if (window.fieldPatches[n]) {
        window.fieldPatches[n].forEach(function (r) { all.push(r); });
      }
    });
    return all.length ? ringsBounds(all) : null;
  }

  // Match a patch polygon layer back to its name by comparing its first vertex
  // to the embedded patch rings (so we can show ONLY today's patch outlines).

  function patchLayerName(layer) {
    if (!window.fieldPatches || typeof layer.getLatLngs !== "function") return null;
    var first = null;
    (function dig(a) {
      if (first || !a) return;
      if (a.lat != null) { first = a; return; }
      if (a.length) for (var i = 0; i < a.length; i++) dig(a[i]);
    })(layer.getLatLngs());
    if (!first) return null;
    var keys = Object.keys(window.fieldPatches);
    for (var k = 0; k < keys.length; k++) {
      var rings = window.fieldPatches[keys[k]];
      var v = rings[0] && rings[0][0];   // first vertex [lat, lng]
      if (v && Math.abs(v[0] - first.lat) < 1e-6 &&
              Math.abs(v[1] - first.lng) < 1e-6) {
        return keys[k];
      }
    }
    return null;
  }

  // Opacity is only meaningful for point markers (setOpacity). Patches/lines
  // keep their own style.

  function setLayerOpacity(layer, op) {
    if (typeof layer.setOpacity === "function") layer.setOpacity(op);
  }

  // (fadeFor and the fieldNestFade / fieldToday.fade lookup maps are gone --
  // opacityFor() reads the DB row carried on each marker instead.)

  // Combined filter state: the "Subset to today's data" switch and the patch
  // dropdown both feed applyFilter().

  var filterToday = true;        // switch default on
  var filterPatch = "__all__";   // dropdown default
  var filterArtCand = false;     // "only artificial nest candidates" switch

  // "Artificial candidates" view (matches snedgen-gui/map.js): a nest shows ONLY
  // if it is an AVAILABLE candidate -- flagged artificial_candidate, its fate
  // concluded, not itself an NQ nest, not wearing an artificial icon, and not
  // already converted (its number does not already exist as an NQ or as an
  // artificial-icon nest). Non-nest classes are never affected.

  var CONCLUDED_FATE = { "Success": true, "Failure": true, "Unknown": true };
  var candConverted = {};   // nest number -> already converted to an NQ nest
  var candConcluded = {};   // nest_id -> fate is concluded

  function refreshCandidateContext() {
    candConverted = {};
    candConcluded = {};

    (window.fieldMapMarkers || []).forEach(function (r) {
      if (!r || String(r["class"]) !== "nest") return;
      var nm = String(r.name || "");
      var mq = /^NQ(\d+)/.exec(nm);
      if (mq) candConverted[mq[1]] = true;
      if (/artificial/.test(String(r.icon || ""))) {
        var ma = /^N[A-Z]*?(\d+)/.exec(nm);
        if (ma) candConverted[ma[1]] = true;
      }
    });

    (window.fieldApiNests || []).forEach(function (n) {
      if (n && n.nest_id != null) {
        candConcluded[String(n.nest_id)] = !!CONCLUDED_FATE[String(n.nest_fate)];
      }
    });
  }

  function candidateHidden(layer, gname) {
    if (!filterArtCand || gname !== "Nests") return false;
    var r = layer._row;
    if (!r) return true;
    var nm = String(r.name || "");
    var flag = r.artificial_candidate;
    if (!(flag === 1 || flag === true || flag === "1")) return true;
    if (!candConcluded[nm]) return true;
    if (/^NQ/.test(nm)) return true;
    if (/artificial/.test(String(r.icon || ""))) return true;
    var m = /^N[A-Z]*?(\d+)/.exec(nm);
    if (m && candConverted[m[1]]) return true;
    return false;
  }

  // Which patches are active right now. null = no spatial subset. A missing or
  // empty schedule (no field day) counts as inactive, so the map never goes
  // blank.

  function activePatchNames() {
    var tp = (filterToday && window.fieldToday && window.fieldToday.patches) || null;
    if (tp && tp.length) {
      if (filterPatch && filterPatch !== "__all__") {
        return tp.indexOf(filterPatch) >= 0 ? [filterPatch] : tp;
      }
      return tp;
    }
    if (filterPatch && filterPatch !== "__all__") return [filterPatch];
    return null;
  }

  // Test patches (home testing): filtered by patch_id, not geometry. Their nests
  // carry a test-site prefix (NSP / NLB) and are hidden
  // from the "All patches" view.

  var TEST_PATCHES = { test_snedgen_park: true, test_long_branch: true };
  function isTestPatch(name) { return !!TEST_PATCHES[name]; }
  function isTestNestLayer(layer) {
    return /^(NSP|NLB)\d+$/.test(String(layer._nestId || ""));
  }

  // Fixed home view for each test patch (they have no polygon to fit to).

  var TEST_PATCH_VIEW = {
    test_snedgen_park: { lat: 38.799230, lng: -77.632596, zoom: 18 },
    test_long_branch:  { lat: 38.995412, lng: -76.999844, zoom: 18 }
  };
  function activeTestView(names) {
    for (var i = 0; i < names.length; i++) {
      if (TEST_PATCH_VIEW[names[i]]) return TEST_PATCH_VIEW[names[i]];
    }
    return null;
  }

  function applyFilter(opts) {
    var noFit = !!(opts && opts.noFit);
    if (filterArtCand) refreshCandidateContext();
    var names = activePatchNames();

    if (names === null) {

      // Show every patch except test-site nests (prefixed). Opacity still
      // applies here, same rule as the per-patch branch below -- this branch
      // used to skip it, leaving everything opaque in the All-patches view.

      eachPatchFeature(function (layer, gname) {
        if (gname === "Nests" && isTestNestLayer(layer)) {
          if (map.hasLayer(layer)) map.removeLayer(layer);
          return;
        }
        if (candidateHidden(layer, gname)) {
          if (map.hasLayer(layer)) map.removeLayer(layer);
          return;
        }
        if (!map.hasLayer(layer)) map.addLayer(layer);
        setLayerOpacity(layer, opacityFor(layer));
      });
    } else {
      var ringsList = [];
      var nameSet = {};
      names.forEach(function (n) {
        nameSet[n] = true;
        if (window.fieldPatches && window.fieldPatches[n]) {
          ringsList.push(window.fieldPatches[n]);
        }
      });
      eachPatchFeature(function (layer, gname) {
        var show;

        // Temp waypoints opt out: a scratch point the tech just dropped is
        // always relevant, wherever it sits. field_map_app.js sets the flag.

        if (layer._alwaysShow) {
          show = true;
        } else if (gname === "Patches") {

          // Outlines: show only the active patches themselves.

          var pn = patchLayerName(layer);
          show = pn ? !!nameSet[pn] : false;
        } else {

          // Other features: within 50 m of any active patch.

          show = ringsList.some(function (rings) {
            return featureWithin(layer, rings, 50);
          });

          // Test patches have no polygon: match their nests by patch_id.

          if (!show && gname === "Nests" &&
              layer._patch && nameSet[layer._patch] && isTestPatch(layer._patch)) {
            show = true;
          }
        }
        if (show && candidateHidden(layer, gname)) show = false;
        if (show) {
          if (!map.hasLayer(layer)) map.addLayer(layer);
          setLayerOpacity(layer, opacityFor(layer));
        } else if (map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      });
    }

    // Re-fit only when the USER changed the filter. A re-render (new nest, live
    // refresh) must not move the map out from under them.
    // Follow mode owns the view while it is on: an automatic re-fit here is
    // what yanked the map back to the patches mid-track.

    if (!noFit && !(window.fieldFollow && window.fieldFollow.isActive())) {
      var tv = activeTestView(names || []);
      if (tv) {
        map.setView([tv.lat, tv.lng], tv.zoom);
      } else {
        var b = patchBounds(names);
        if (b) map.fitBounds(b, { padding: [25, 25], maxZoom: 19 });
      }
    }

    // Re-apply icon sizes after the move.

    setTimeout(scaleIconsForZoom, 200);
  }

  function setPatch(name) { filterPatch = name; applyFilter(); }
  function setToday(on) { filterToday = !!on; applyFilter(); }
  function setArtCand(on) { filterArtCand = !!on; applyFilter({ noFit: true }); }

  // Apply the defaults (these match the host page's checkbox defaults).

  setWeather(false);
  setPatches(true);
  setSampling(true);
  setBasemap(false);

  // "Subset to today's data" is on by default.

  applyFilter();

  map.whenReady(function () {
    setTimeout(function () {
      if (window.fieldFollow && window.fieldFollow.isActive()) return;

      var initialBounds = patchBounds(activePatchNames());
      if (initialBounds) {
        map.fitBounds(initialBounds, { padding: [25, 25], maxZoom: 19 });
      }
    }, 400);
  });

  // Respond to the host page's option changes.

  window.addEventListener("message", function(e) {
    var d = e.data;
    if (!d || !d.type) return;
    if (d.type === "setWeather") setWeather(!!d.on);
    else if (d.type === "setPatches") setPatches(!!d.on);
    else if (d.type === "setSampling") setSampling(!!d.on);
    else if (d.type === "setBasemap") setBasemap(!!d.on);
    else if (d.type === "setPatch") setPatch(d.name);
    else if (d.type === "setToday") setToday(!!d.on);
    else if (d.type === "setArtCand") setArtCand(!!d.on);
  });
}
