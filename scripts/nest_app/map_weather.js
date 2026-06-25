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
    var size = 20.25 * s, anchor = 10.125 * s;
    var imgs = document.querySelectorAll(".leaflet-marker-pane img.leaflet-marker-icon");
    for (var i = 0; i < imgs.length; i++) {
      imgs[i].style.width = size + "px";
      imgs[i].style.height = size + "px";
      imgs[i].style.marginLeft = (-anchor) + "px";
      imgs[i].style.marginTop = (-anchor) + "px";
    }
  }
  map.on("zoomend", scaleIconsForZoom);
  setTimeout(scaleIconsForZoom, 700);

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

  function fadeFor(layer, fade) {
    if (!fade || typeof layer.getLatLng !== "function") return 1;
    var ll = layer.getLatLng();
    var key = ll.lat.toFixed(6) + "," + ll.lng.toFixed(6);
    return (fade[key] != null) ? fade[key] : 1;
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

  function applyFilter() {
    var names = activePatchNames();
    var fade = (filterToday && window.fieldToday && window.fieldToday.fade) || null;

    if (names === null) {

      // Show everything at full opacity.

      eachPatchFeature(function (layer) {
        if (!map.hasLayer(layer)) map.addLayer(layer);
        setLayerOpacity(layer, 1);
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
        }
        if (show) {
          if (!map.hasLayer(layer)) map.addLayer(layer);
          setLayerOpacity(layer, fadeFor(layer, fade));
        } else if (map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      });
    }

    var b = patchBounds(names);
    if (b) map.fitBounds(b, { padding: [25, 25], maxZoom: 19 });

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
