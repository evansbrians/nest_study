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
    var big = window.fieldNestBig || {};
    eachPatchFeature(function (layer) {
      var img = layer._icon;
      if (!img || img.tagName !== "IMG") return;
      // Keyed by DB point_id, same as fadeFor() -- not by coordinates.
      var mult = (layer._pointId && big[layer._pointId]) ? 1.15 : 1;
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

  // JS marker rendering (step B4) -----------------------------------------

  // Build Leaflet markers from window.fieldMapPoints (the data the R
  // addMarkers() calls used to consume) and add each into the SAME
  // layerManager FeatureGroup the layers-control and patch/today filter
  // already drive -- that group is created by addLayersControl in
  // make_field_map.R. Because the markers now live in those real groups
  // (Nests / Coverboards / Trail Cameras / Point Counts, all in PATCH_GROUPS),
  // applyFilter owns their opacity (fieldNestFade + today-fade) and
  // scaleIconsForZoom owns their size (fieldNestBig + zoom + aspect ratio):
  // one styler, no parallel "(JS)" groups.

  // Photo baked from a nest's GeoJSON into window.fieldNavPoints (data URI).
  function nestPhotoFor(name) {
    var nav = window.fieldNavPoints || [];
    for (var i = 0; i < nav.length; i++) {
      if (nav[i].name === name && nav[i].photo &&
          String(nav[i].photo).indexOf("data:") === 0) return nav[i].photo;
    }
    return null;
  }

  function renderMapPoints() {
    if (!window.fieldMapPoints || !window.fieldIcons || !window.L ||
        !map.layerManager) return;
    var idx = 0;
    window.fieldMapPoints.forEach(function (p) {
      if (p.lat == null || p.lng == null || isNaN(p.lat) || isNaN(p.lng)) return;
      if (!p.group) return;
      // A point whose icon_id has no png of its own -- landmarks, and anything
      // else without a custom icon -- gets Leaflet's built-in marker-icon.png
      // instead of being dropped. Previously these were skipped outright, so
      // they never appeared on the map at all.
      var ic = window.fieldIcons[p.icon_id];
      var marker = ic
        ? window.L.marker([p.lat, p.lng], {
            icon: window.L.icon({
              iconUrl: ic.iconUrl,
              iconSize: [ic.iconWidth, ic.iconHeight],
              iconAnchor: [ic.iconAnchorX, ic.iconAnchorY]
            })
          })
        : window.L.marker([p.lat, p.lng]);   // stock Leaflet pin
      var popupHtml = p.popup;
      if (p.group === "Nests") {
        var photo = nestPhotoFor(p.name);
        if (photo) {
          popupHtml += '<img src="' + photo +
            '" style="display:block;max-width:200px;margin-top:6px;border-radius:4px">';
        }
      }
      marker.bindPopup(popupHtml);
      // Stable DB key on EVERY marker: gps_point.point_id, straight from
      // GET /gps_points. fadeFor()/scaleIconsForZoom() join the v_map_point
      // styling to markers on this, instead of on a formatted "lat,lng" string
      // -- coordinate joins broke on float rounding and would break again on any
      // re-recorded point, and they fail by silently matching nothing.
      marker._pointId = p.point_id;
      if (p.group === "Nests") {
        marker.setZIndexOffset(1000);
        marker._nestId = p.name;
        marker._patch = p.patch;
      }
      map.layerManager.addLayer(marker, "marker", p.group + "-" + (idx++), p.group);
    });
  }
  renderMapPoints();

  // patches + paths (step B5) ---------------------------------------------

  // Draw patch boundaries (window.fieldPatches) and Garmin paths
  // (window.fieldPaths) in JS, into the same "Patches" / "Paths" layerManager
  // groups the layers control and patch/today filter already drive -- so the R
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

  // Layer visibililty:
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

  // Patch boundaries are intentionally NOT here: their visibility is governed
  // solely by the "Include patch boundaries" toggle (setPatches), so the
  // today-subset never hides them. applyFilter still subsets/fades the points
  // and zooms to today's patches via patchBounds().

  var PATCH_GROUPS =
    ["Nests", "Coverboards", "Trail Cameras", "Point Counts", "Paths"];

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

  // Look up a marker's scheduled-today opacity (window.fieldToday.fade keyed by
  // "lat,lng" to 6 dp); markers not in the map are fully opaque.

  // Opacity for a marker, looked up by its DB point_id (see renderMapPoints).
  // The maps come from v_map_point via applyMapPointStyles().
  function fadeFor(layer, fade) {
    if (!fade || !layer._pointId) return 1;
    var v = fade[layer._pointId];
    return (v != null) ? v : 1;
  }

  // Combined filter state: the "Subset to today's data" switch and the patch
  // dropdown both feed applyFilter().

  var filterToday = true;        // switch default on
  var filterPatch = "__all__";   // dropdown default

  // Which patches are active given the current state. null = no spatial
  // subset (show everything, e.g. switch off + "All patches"). If the schedule
  // data is missing or empty (no field day), the switch is treated as inactive
  // so the map never goes blank.

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

  function applyFilter() {
    var names = activePatchNames();
    var fade = (filterToday && window.fieldToday && window.fieldToday.fade) || null;

    if (names === null) {

      // Show every patch, except test-site nests (prefixed). Opacity still
      // applies: the non-current fade AND -- when "Subset to today's data" is on
      // -- the not-scheduled-today fade. This branch used to ignore `fade`
      // entirely, which meant coverboards and trailcams (which never appear in
      // fieldNestFade) sat at full opacity in the All-patches view no matter
      // what the schedule said. Same rule as the per-patch branch below.

      eachPatchFeature(function (layer, gname) {
        if (gname === "Nests" && isTestNestLayer(layer)) {
          if (map.hasLayer(layer)) map.removeLayer(layer);
          return;
        }
        if (!map.hasLayer(layer)) map.addLayer(layer);
        setLayerOpacity(layer, Math.min(fadeFor(layer, window.fieldNestFade),
                                        fadeFor(layer, fade)));
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
        if (gname === "Patches") {

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
        if (show) {
          if (!map.hasLayer(layer)) map.addLayer(layer);
          setLayerOpacity(layer, Math.min(fadeFor(layer, window.fieldNestFade), fadeFor(layer, fade)));
        } else if (map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      });
    }

    var tv = activeTestView(names || []);
    if (tv) {
      map.setView([tv.lat, tv.lng], tv.zoom);
    } else {
      var b = patchBounds(names);
      if (b) map.fitBounds(b, { padding: [25, 25], maxZoom: 19 });
    }

    // Re-apply icon sizes after the move.

    setTimeout(scaleIconsForZoom, 200);
  }

  function setPatch(name) { filterPatch = name; applyFilter(); }
  function setToday(on) { filterToday = !!on; applyFilter(); }

  // Apply the defaults (these match the host page's checkbox defaults).

  setWeather(false);
  setPatches(true);
  setSampling(true);
  setBasemap(false);

  // "Subset to today's data" is on by default.

  applyFilter();

  map.whenReady(function () {
    setTimeout(function () {
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
  });
}
