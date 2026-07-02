// Field map host page: open/close the bottom menu and drive the "Show weather"
// toggle. Loaded by field_map.qmd after the body. The Leaflet map is rendered
// inline in this same page, so map_weather.js runs in this same window.

(function () {
function init() {

  var overlay = document.getElementById("fieldMenuOverlay");
  var menuBtn = document.getElementById("fieldMenuBtn");          // map view: open menu
  var mainMenuBtn = document.getElementById("fieldMainMenuBtn");  // sub-screen: go to main
  var mapBtn = document.getElementById("fieldMapBtn");            // menu open: back to map
  var accEl = document.getElementById("barAccuracy");
  var brgEl = document.getElementById("barBearing");
  if (!menuBtn || !overlay) return;

  // Portrait only. Best-effort lock where the browser supports it (Android
  // Chrome / installed PWAs); iOS Safari ignores this, so the CSS rotate-notice
  // overlay is the real guard.

  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock("portrait").catch(function () {});
    }
  } catch (e) {}

  function activeScreen() {
    var a = overlay.querySelector(".field-screen.is-active");
    return a ? a.dataset.name : null;
  }

  function hideEl(el, h) { if (el) el.classList.toggle("field-hide", !!h); }

  // The bar's contents depend on context:
  //   map view (menu closed) -> Menu + Accuracy + Bearing
  //   main menu screen       -> Map only
  //   sub-screen             -> Main Menu + Map

  function updateBar() {
    var open = overlay.classList.contains("is-open");
    var onMap = !open;
    var onSub = open && activeScreen() !== "main";

    hideEl(menuBtn, !onMap);
    hideEl(accEl, !onMap);
    hideEl(brgEl, !onMap);
    hideEl(mapBtn, !open);          // "Map" shows whenever the menu is open
    hideEl(mainMenuBtn, !onSub);    // "Main Menu" only on sub-screens
  }

  // Screen navigation: the overlay holds several .field-screen panels; only
  // the one matching `name` is shown.

  function showScreen(name) {
    var screens = overlay.querySelectorAll(".field-screen");
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle("is-active", screens[i].dataset.name === name);
    }
    updateBar();

    // Auto-start/stop averaging based on whether Add Waypoint is showing.

    if (typeof syncAveraging === "function") syncAveraging();
  }

  function openMenu() {
    overlay.classList.add("is-open");
    menuBtn.setAttribute("aria-expanded", "true");
    showScreen("main");
  }
  function closeMenu() {
    overlay.classList.remove("is-open");
    menuBtn.setAttribute("aria-expanded", "false");
    updateBar();
    if (typeof syncAveraging === "function") syncAveraging();
  }

  menuBtn.addEventListener("click", openMenu);
  if (mapBtn) mapBtn.addEventListener("click", closeMenu);
  if (mainMenuBtn) mainMenuBtn.addEventListener("click", function () { showScreen("main"); });

  // Forward-navigation buttons (Map options / Waypoints / Tracks).

  var navButtons = overlay.querySelectorAll("[data-screen]");
  for (var i = 0; i < navButtons.length; i++) {
    (function (b) {
      b.addEventListener("click", function () {

        // Opening "Add waypoint" from the menu is always a fresh new point
        // (clears any re-measure edit mode left over from the manager).

        if (b.dataset.screen === "addwaypoint" && typeof resetAddForm === "function") {
          resetAddForm();
        }
        showScreen(b.dataset.screen);
      });
    })(navButtons[i]);
  }

  // Open the menu (main screen) on launch

  openMenu();

  // map layer options -----------------------------------------------------

  // Each checkbox posts to map_weather.js, which reconfigures the Leaflet
  // layers control. Defaults live in the checkbox `checked` attributes and
  // are mirrored by map_weather.js on load, so we only send on change.

  function wireOption(id, type) {
    var cb = document.getElementById(id);
    if (cb) cb.addEventListener("change", function () {
      window.postMessage({ type: type, on: cb.checked }, "*");
    });
  }
  wireOption("weatherToggle", "setWeather");
  wireOption("patchesToggle", "setPatches");
  wireOption("samplingToggle", "setSampling");
  wireOption("osmToggle", "setBasemap");

  // "Subset to today's data" switch (Map options) + patch dropdown (main menu).
  // - The switch (default on) narrows the dropdown to today's patches and tells
  //    the map to subset + fade unscheduled features; 
  // - The dropdown posts the chosen patch. 
  // - Patch names come from window.fieldPatches (see make_field_map.R)
  // - today's schedule come from window.fieldToday (see make_field_map.R).

  var patchSelect = document.getElementById("patchSelect");
  var todayToggle = document.getElementById("todayToggle");
  var patchPickerBtn = document.getElementById("patchPickerBtn");

  function prettyPatch(n) {
    n = String(n).replace(/_/g, " ");
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  function rebuildPatchDropdown() {
    if (!patchSelect) return;
    var today = !!(todayToggle && todayToggle.checked);
    patchSelect.innerHTML = "";
    var all = document.createElement("option");
    all.value = "__all__";
    all.textContent = today ? "All today's patches" : "All patches";
    patchSelect.appendChild(all);
    var names = [];
    if (today && window.fieldToday && window.fieldToday.patches) {
      names = window.fieldToday.patches.slice();
    } else if (window.fieldPatches) {
      names = Object.keys(window.fieldPatches);
    }
    names.sort().forEach(function (n) {
      var o = document.createElement("option");
      o.value = n;
      o.textContent = prettyPatch(n);
      patchSelect.appendChild(o);
    });
    patchButtonLabel();
  }

  // The embedded data may load a beat after this script; wait for it.

  var dataReady = function () {
    if (!window.fieldPatches) return false;
    if (todayToggle && todayToggle.checked && typeof window.fieldToday === "undefined") {
      return false;
    }
    return true;
  };
  if (dataReady()) {
    rebuildPatchDropdown();
  } else {
    var pt = 0;
    var piv = setInterval(function () {
      if (dataReady() || ++pt > 50) { clearInterval(piv); rebuildPatchDropdown(); }
    }, 100);
  }

  if (patchSelect) {
    patchSelect.addEventListener("change", function () {
      window.postMessage({ type: "setPatch", name: patchSelect.value }, "*");
    });
  }
  if (todayToggle) {
    todayToggle.addEventListener("change", function () {
      window.postMessage({ type: "setToday", on: todayToggle.checked }, "*");
      rebuildPatchDropdown();
      if (patchSelect) {
        patchSelect.value = "__all__";
        window.postMessage({ type: "setPatch", name: "__all__" }, "*");
      }
    });
  }

  // Large, near-full-screen patch picker. The native <select> dropdown is tiny
  // and OS-controlled; this overlay is readable for low-vision use. The hidden
  // <select> stays the source of truth and drives setPatch via its change event.

  function patchButtonLabel() {
    if (!patchSelect || !patchPickerBtn) return;
    var opt = patchSelect.options[patchSelect.selectedIndex];
    patchPickerBtn.textContent = opt ? opt.textContent : "All patches";
  }

  function openPatchPicker() {
    if (!patchSelect) return;
    var overlay = document.createElement("div");
    overlay.className = "field-patch-overlay";
    var inner = document.createElement("div");
    inner.className = "field-patch-overlay-inner";
    var title = document.createElement("div");
    title.className = "field-patch-overlay-title";
    title.textContent = "Choose a patch";
    inner.appendChild(title);
    Array.prototype.forEach.call(patchSelect.options, function (opt) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "field-patch-overlay-row";
      if (opt.value === patchSelect.value) row.className += " is-selected";
      row.textContent = opt.textContent;
      row.addEventListener("click", function () {
        patchSelect.value = opt.value;
        patchSelect.dispatchEvent(new Event("change"));
        patchButtonLabel();
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        closeMenu();
      });
      inner.appendChild(row);
    });
    overlay.appendChild(inner);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    });
    document.body.appendChild(overlay);
  }

  if (patchPickerBtn) {
    patchPickerBtn.addEventListener("click", openPatchPicker);
    patchButtonLabel();
  }

  // waypoints -------------------------------------------------------------

  // "Add Waypoint": a form (name, class, note, photo) saved as a GeoJSON
  // Point to the device. "Waypoint manager": list / download all / clear.
  // Records live in localStorage so the manager can re-export them.

  var WP_KEY = "fieldWaypoints";

  // ISO 8601 without milliseconds (still used by the Track section).

  function isoClean(d) {
    return d.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  function loadWaypoints() {
    try { return JSON.parse(localStorage.getItem(WP_KEY)) || []; }
    catch (e) { return []; }
  }
  function storeWaypoints(arr) {
    try { localStorage.setItem(WP_KEY, JSON.stringify(arr)); return true; }
    catch (e) { return false; }
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  // yyyy-mm-dd hh:mm:ss (local)

  function fmtTime(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "wp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  // GeoJSON export --------------------------------------------------------

  function waypointFeature(w) {
    var coords = (w.elevation != null && !isNaN(w.elevation))
      ? [w.longitude, w.latitude, w.elevation]
      : [w.longitude, w.latitude];
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: coords },
      properties: {
        point_id: w.point_id,
        point_name: w.point_name,
        point_class: w.point_class,
        time: w.time,
        elevation: w.elevation,
        horizontal_accuracy: w.horizontal_accuracy,
        bearing: (w.bearing != null ? w.bearing : null),
        note: w.note,
        photo_name: w.photo_name || null,
        photo: w.photo || null
      }
    };
  }
  
  var WP_SYNC = {
    relayUrl: "https://script.google.com/macros/s/AKfycbwet0ZyQbxDG4zF-I1o8SNwAKXkFNdFFmH269Ap7VMAgsi0E6ndTL5pDNiweHvKjGA_Ug/exec",
    study: "scbi",
    secret: "23_boy_howdy_58"
  };

  function waypointsFC(ws) {
    return { type: "FeatureCollection", features: ws.map(waypointFeature) };
  }
  function syncTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }
  function uploadToDrive(target, filename, fc, onStatus, onSuccess) {
    function say(m) { if (typeof onStatus === "function") onStatus(m); }
    if (!WP_SYNC.relayUrl || WP_SYNC.relayUrl.indexOf("PASTE") === 0) {
      say("Drive sync not set up yet.");
      return;
    }
    if (!navigator.onLine) {
      say("No signal -- saved to the cache.");
      return;
    }
    say("Sending to Drive...");
    fetch(WP_SYNC.relayUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        secret: WP_SYNC.secret,
        study: WP_SYNC.study,
        target: target,
        filename: filename,
        geojson: JSON.stringify(fc)
      })
    }).then(function () {
      say("Sent to Drive.");
      if (typeof onSuccess === "function") onSuccess();
    })
      .catch(function () { say("Drive upload failed -- data saved locally."); });
  }

  // Once a waypoint's GeoJSON has reached Drive, flag it uploaded: it drops out
  // of the manager list (renderWaypoints filters these) but keeps its map marker
  // and stays in storage as a local backup.

  function markUploaded(ids) {
    var idset = {};
    ids.forEach(function (id) { idset[id] = true; });
    var arr = loadWaypoints();
    arr.forEach(function (x) { if (idset[x.point_id]) x.uploaded = true; });
    storeWaypoints(arr);
    renderWaypoints();
  }

  // Full-screen "uploaded to Drive" confirmation; blocks until tapped.

  function showUploadModal(msg) {
    var overlay = document.getElementById("fieldUploadModal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "fieldUploadModal";
      overlay.className = "field-upload-modal-overlay";
      var box = document.createElement("div");
      box.className = "field-upload-modal";
      var check = document.createElement("div");
      check.className = "field-upload-modal-check";
      check.innerHTML = "&#x2714;";
      var text = document.createElement("div");
      text.className = "field-upload-modal-text";
      var hint = document.createElement("div");
      hint.className = "field-upload-modal-hint";
      hint.textContent = "Tap anywhere to dismiss";
      box.appendChild(check);
      box.appendChild(text);
      box.appendChild(hint);
      overlay.appendChild(box);
      overlay.addEventListener("click", function () {
        overlay.classList.remove("is-visible");
      });
      document.body.appendChild(overlay);
      overlay._textEl = text;
    }
    overlay._textEl.textContent = msg;
    overlay.classList.add("is-visible");
  }

  function downloadGeojson(filename, ws) {
    var fc = { type: "FeatureCollection", features: ws.map(waypointFeature) };
    var blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // Photo capture: downscale and compress to a JPEG data URI so the image
  // can be put inside the GeoJSON file.

  function compressImage(file, maxDim, quality, cb) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      var cw = Math.max(1, Math.round(img.width * scale));
      var ch = Math.max(1, Math.round(img.height * scale));
      var cv = document.createElement("canvas");
      cv.width = cw;
      cv.height = ch;
      cv.getContext("2d").drawImage(img, 0, 0, cw, ch);
      URL.revokeObjectURL(url);
      var out = null;
      try { out = cv.toDataURL("image/jpeg", quality); } catch (e) {}
      cb(out);
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }

  // waypoint map markers --------------------------------------------------

  // Saved waypoints drop a Leaflet marker on the map:

  var wpMarkers = {};   // point_id -> L.marker

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ROYGBIV palette for waypoint icons (blue is the default).

  var WP_COLORS = [
    { name: "Red", hex: "#e11a1a" },
    { name: "Orange", hex: "#f08000" },
    { name: "Yellow", hex: "#f0c400" },
    { name: "Green", hex: "#1aa11a" },
    { name: "Blue", hex: "#136aec" },
    { name: "Indigo", hex: "#4b0082" },
    { name: "Violet", hex: "#8f00ff" }
  ];
  var WP_DEFAULT_COLOR = "#136aec";
  function wpColorHex(w) { return (w && w.color) || WP_DEFAULT_COLOR; }

  function wpIconSvg(hex) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<circle cx="12" cy="12" r="9" fill="' + hex + '" stroke="#fff" stroke-width="2.5"/>' +
      '<circle cx="12" cy="12" r="3" fill="#fff"/></svg>';
  }
  function wpIcon(hex) {
    return L.icon({
      iconUrl: "data:image/svg+xml;base64," + btoa(wpIconSvg(hex || WP_DEFAULT_COLOR)),
      iconSize: [20.25, 20.25],
      iconAnchor: [10.125, 10.125],   // centered, matching the scaled markers
      popupAnchor: [0, -10]
    });
  }

  function wpPopupHtml(w) {
    var rows = ["<b>" + escapeHtml(w.point_name) + "</b>", escapeHtml(w.point_class),
      w.latitude.toFixed(6) + ", " + w.longitude.toFixed(6)];
    if (w.elevation != null) rows.push("Elevation: " + w.elevation + " m");
    if (w.horizontal_accuracy != null) rows.push("Accuracy: &plusmn;" + w.horizontal_accuracy + " m");
    if (w.bearing != null) rows.push("Bearing: " + w.bearing + "&deg;");
    rows.push(w.time);
    if (w.note) rows.push(escapeHtml(w.note));
    var html = rows.join("<br>");
    if (w.photo) {
      html += '<br><img src="' + w.photo +
        '" style="max-width:170px;margin-top:6px;border-radius:4px">';
    }
    return html;
  }

  function addWaypointMarker(w) {
    var map = window.fieldMap;
    if (!map || typeof L === "undefined" || wpMarkers[w.point_id]) return;
    // Hidden via the manager

    if (w.visible === false) return;
    var m = L.marker([w.latitude, w.longitude], { icon: wpIcon(wpColorHex(w)) }).addTo(map);
    m.bindPopup(wpPopupHtml(w));
    wpMarkers[w.point_id] = m;
    // Let the zoom scaler size the new icon to match

    map.fire("zoomend");
  }

  function removeWaypointMarker(id) {
    var m = wpMarkers[id];
    if (m && window.fieldMap) window.fieldMap.removeLayer(m);
    delete wpMarkers[id];
  }

  // Update an on-map marker in place (position, color, popup) after an edit.

  function refreshWaypointMarker(w) {
    var m = wpMarkers[w.point_id];
    if (!m) { addWaypointMarker(w); return; }
    m.setLatLng([w.latitude, w.longitude]);
    m.setIcon(wpIcon(wpColorHex(w)));
    m.setPopupContent(wpPopupHtml(w));
    if (window.fieldMap) window.fieldMap.fire("zoomend");
  }

  // Re-draw any previously saved waypoints once the map is ready.

  var savedDrawn = false;
  function drawSavedWaypoints() {
    if (savedDrawn) return;
    savedDrawn = true;
    loadWaypoints().forEach(addWaypointMarker);
  }
  if (window.fieldMap) drawSavedWaypoints();
  else window.addEventListener("fieldmap:ready", drawSavedWaypoints);

  // add waypoint form -----------------------------------------------------

  var wpName = document.getElementById("wpName");
  var wpClass = document.getElementById("wpClass");
  var wpNote = document.getElementById("wpNote");
  var wpPhoto = document.getElementById("wpPhoto");
  var wpNamePrefix = document.getElementById("wpNamePrefix");
  var WP_PREFIX = {
    "Nest": "N",
    "Landmark": "landmark-",
    "Path crossing": "path_crossing-",
    "Boundary": "boundary-",
    "Other": ""
  };
  function currentPrefix() {
    return (wpClass && WP_PREFIX.hasOwnProperty(wpClass.value)) ? WP_PREFIX[wpClass.value] : "";
  }
  function syncNamePrefix() {
    var p = currentPrefix();
    if (wpNamePrefix) {
      wpNamePrefix.textContent = p;
      wpNamePrefix.style.display = p ? "" : "none";
    }
    if (wpName) {
      wpName.placeholder = (wpClass && wpClass.value === "Nest")
        ? "Nest number (e.g. 042)" : "Waypoint name";
    }
  }
  function toSnakeCase(s) {
    return String(s == null ? "" : s).trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }
  function currentName(fallback) {
    var suffix = (wpName && wpName.value.trim()) || "";
    return suffix ? (currentPrefix() + toSnakeCase(suffix)) : fallback;
  }
  if (wpClass) wpClass.addEventListener("change", syncNamePrefix);
  syncNamePrefix();
  var wpPhotoPreview = document.getElementById("wpPhotoPreview");
  var wpColorRow = document.getElementById("wpColorRow");
  var addSaveBtn = document.getElementById("addWaypointSaveBtn");
  var addStatusEl = document.getElementById("addWaypointStatus");
  var currentPhoto = null;
  var currentColor = WP_DEFAULT_COLOR;
  var newNestId = null;

  // When set, the Add-waypoint screen is re-measuring an existing waypoint:
  // { id, mode } where mode is "replace" or "average".

  var editWp = null;

  function addStatus(msg) { if (addStatusEl) addStatusEl.textContent = msg || ""; }

  // Build a row of color swatches into `host`; clicking one calls onPick(hex).

  function buildSwatches(host, selectedHex, onPick) {
    if (!host) return;
    host.innerHTML = "";
    WP_COLORS.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "field-swatch" + (c.hex === selectedHex ? " is-selected" : "");
      b.style.background = c.hex;
      b.title = c.name;
      b.setAttribute("aria-label", c.name);
      b.addEventListener("click", function () {
        onPick(c.hex);
        host.querySelectorAll(".field-swatch").forEach(function (s) {
          s.classList.remove("is-selected");
        });
        b.classList.add("is-selected");
      });
      host.appendChild(b);
    });
  }

  function refreshAddColorRow() {
    buildSwatches(wpColorRow, currentColor, function (hex) { currentColor = hex; });
  }
  refreshAddColorRow();

  // live readout + sample averaging ---------------------------------------

  // Add Waypoint records its location by averaging GPS samples (like a Garmin
  // point average). Averaging starts automatically when you open this screen.
  // The confidence bar grows to the right (and shifts toward dark green) as the
  // estimate tightens; tap "Save waypoint" once it has settled.

  var wpLon = document.getElementById("wpLon");
  var wpLat = document.getElementById("wpLat");
  var wpBrg = document.getElementById("wpBrg");
  var wpAccBar = document.getElementById("wpAccBar");
  var wpAccLabel = document.getElementById("wpAccLabel");
  var wpTimer = document.getElementById("wpTimer");
  var wpSamples = document.getElementById("wpSamples");

  var averaging = false;
  var samples = [];        // {lat, lng, elevation, accuracy}
  var avgWatchId = null;
  var avg = null;          // current average {lat, lng, elevation, accuracy, n}
  var avgStart = 0;        // ms timestamp when averaging began
  var DECORR_TAU = 20;     // GPS decorrelation time (s): n_eff = 1 + elapsed/TAU

  function computeAverage() {
    var n = samples.length;
    if (!n) { avg = null; return; }
    var sLat = 0, sLng = 0, eSum = 0, eN = 0, aSum = 0;
    samples.forEach(function (s) {
      sLat += s.lat; sLng += s.lng; aSum += s.accuracy;
      if (s.elevation != null) { eSum += s.elevation; eN++; }
    });
    var mLat = sLat / n, mLng = sLng / n;

    // Per-sample spread: the larger of the GPS-reported accuracy and the
    // empirical scatter of the samples about their mean (meters).

    var mPerDegLat = 110540;
    var mPerDegLng = 111320 * Math.cos(mLat * Math.PI / 180);
    var sumSq = 0;
    samples.forEach(function (s) {
      var dy = (s.lat - mLat) * mPerDegLat;
      var dx = (s.lng - mLng) * mPerDegLng;
      sumSq += dx * dx + dy * dy;
    });
    var scatter = Math.sqrt(sumSq / n); // RMS distance from Mean         
    var perSample = Math.max(aSum / n, scatter);

    // Decorrelated averaging: GPS fixes a second apart are correlated, so the
    // number of *independent* samples grows with elapsed time (n_eff)

    var elapsed = (Date.now() - avgStart) / 1000;  // seconds
    var nEff = 1 + Math.max(0, elapsed) / DECORR_TAU;
    var accuracy = perSample / Math.sqrt(nEff);

    avg = {
      lat: mLat,
      lng: mLng,
      elevation: eN ? (eSum / eN) : null,
      accuracy: accuracy,
      n: n
    };
  }

  // Color band by spatial accuracy (meters). Bands are contiguous, so the
  // 4-4.5 m gap in the spec is folded into yellow.
  //   > 8        red
  //   6  - 8     orange
  //   4  - 6     yellow
  //   3  - 4     green
  //   <= 3       dark green

  function accColor(acc) {
    if (acc > 8) return "#d11a1a";   // red
    if (acc > 6) return "#e8821a";   // orange
    if (acc > 4) return "#e2c00d";   // yellow
    if (acc > 3) return "#2faa2f";   // green
    return "#0b6b0b";                // dark green
  }

  // Fill fraction GROWS as accuracy improves: a red sliver past 10 m, then
  // ramping from ~5% at 10 m up to 100% at 3 m (and pinned full below that).

  function accFraction(acc) {
    if (acc > 10) return 0.03;
    return Math.max(0.05, Math.min(1, (10 - acc) / (10 - 3)));
  }

  // The bar grows to the right and recolors as the averaged estimate tightens;
  // the footer shows the spatial accuracy in meters.

  function setAccuracyBar(acc) {
    if (acc == null || isNaN(acc)) {
      if (wpAccBar) { wpAccBar.style.width = "3%"; wpAccBar.style.background = "#d11a1a"; }
      if (wpAccLabel) wpAccLabel.textContent = "--";
      return;
    }
    if (wpAccBar) {
      wpAccBar.style.width = (accFraction(acc) * 100).toFixed(1) + "%";
      wpAccBar.style.background = accColor(acc);
    }
    if (wpAccLabel) wpAccLabel.textContent = (Math.round(acc * 10) / 10);
  }

  // mm:ss elapsed for the confidence timer.

  function fmtElapsed(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return pad2(Math.floor(s / 60)) + ":" + pad2(s % 60);
  }

  function renderLive() {
    if (averaging && avg) {
      if (wpLon) wpLon.textContent = avg.lng.toFixed(6);
      if (wpLat) wpLat.textContent = avg.lat.toFixed(6);
      setAccuracyBar(avg.accuracy);
    } else {
      var ll = window.fieldLatLng;
      if (wpLon) wpLon.textContent = ll ? ll.lng.toFixed(6) : "--";
      if (wpLat) wpLat.textContent = ll ? ll.lat.toFixed(6) : "--";
      setAccuracyBar((typeof window.fieldAccuracy === "number") ? window.fieldAccuracy : null);
    }
    if (wpBrg) wpBrg.textContent =
      (typeof window.fieldBearing === "number") ? window.fieldBearing + "°" : "--";
    if (wpTimer) wpTimer.textContent = averaging ? fmtElapsed(Date.now() - avgStart) : "00:00";
    if (wpSamples) wpSamples.textContent = (averaging ? samples.length : 0) + " samples";
  }

  setInterval(renderLive, 500);

  if (wpPhoto) {
    wpPhoto.addEventListener("change", function () {
      var file = wpPhoto.files && wpPhoto.files[0];
      if (wpPhotoPreview) wpPhotoPreview.innerHTML = "";
      if (!file) { currentPhoto = null; return; }
      addStatus("Processing photo...");
      compressImage(file, 1024, 0.55, function (dataUrl) {
        currentPhoto = dataUrl;
        if (dataUrl && wpPhotoPreview) {
          var im = document.createElement("img");
          im.src = dataUrl;
          im.className = "field-photo-thumb";
          wpPhotoPreview.appendChild(im);
        }
        addStatus(dataUrl ? "Photo attached." : "Couldn't read that photo.");
      });
    });
  }

  function resetAddForm() {
    newNestId = null;
    if (wpName) { wpName.value = ""; wpName.readOnly = false; }
    if (wpNote) wpNote.value = "";
    if (wpClass) wpClass.selectedIndex = 0;
    var clab = (wpClass && wpClass.closest) ? wpClass.closest(".field-field-label") : null;
    if (clab) clab.style.display = "";
    syncNamePrefix();
    if (wpPhoto) wpPhoto.value = "";
    if (wpPhotoPreview) wpPhotoPreview.innerHTML = "";
    currentPhoto = null;
    currentColor = WP_DEFAULT_COLOR;
    editWp = null;
    if (modifyControls) modifyControls.hidden = true;
    refreshAddColorRow();
  }

  function startNewNestPoint(nestId) {
    resetAddForm();
    newNestId = nestId;
    if (wpName) { wpName.value = nestId; wpName.readOnly = true; }
    if (wpNamePrefix) wpNamePrefix.style.display = "none";
    var clab = (wpClass && wpClass.closest) ? wpClass.closest(".field-field-label") : null;
    if (clab) clab.style.display = "none";
    showScreen("addwaypoint");
    addStatus("No saved location for " + nestId + " \u2014 hold still; Save when the bar settles.");
  }

  // Open the Add-waypoint screen to re-measure an existing waypoint. mode is
  // "replace" (new average overwrites the location) or "average" (new average
  // is combined with the stored one). The form is pre-filled from the waypoint.

  // ---- unified Modify flow (own waypoints + official map points) ---------

  // editWp, when set, means the Add screen is editing an existing point:
  //   { id, source: "waypoint"|"nav", point: <record>, mode: "keep"|"replace"|"average" }
  // mode "keep" leaves the location untouched (edit note/name/photo only).

  var modifyControls = null;

  function ensureModifyControls() {
    if (modifyControls) return modifyControls;
    if (!addSaveBtn || !addSaveBtn.parentNode) return null;
    var box = document.createElement("div");
    box.className = "field-modify-controls";
    box.hidden = true;
    var lab = document.createElement("div");
    lab.className = "field-field-label";
    lab.textContent = "Location";
    box.appendChild(lab);
    var modeRow = document.createElement("div");
    modeRow.className = "field-mgr-actions";
    [["keep", "Keep"], ["replace", "Re-record"], ["average", "Average with current"]]
      .forEach(function (m) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "field-button field-mode-btn";
        b.setAttribute("data-mode", m[0]);
        b.textContent = m[1];
        b.addEventListener("click", function () { setMode(m[0]); });
        modeRow.appendChild(b);
      });
    box.appendChild(modeRow);
    var actRow = document.createElement("div");
    actRow.className = "field-mgr-actions";
    var del = document.createElement("button");
    del.type = "button";
    del.className = "field-button field-button--danger field-modify-delete";
    del.textContent = "Delete";
    del.addEventListener("click", function () {
      if (!editWp || editWp.source !== "waypoint") return;
      var cur = loadWaypoints().filter(function (x) { return x.point_id !== editWp.id; });
      storeWaypoints(cur);
      removeWaypointMarker(editWp.id);
      resetAddForm();
      renderWaypoints();
      showScreen("main");
    });
    actRow.appendChild(del);
    box.appendChild(actRow);
    addSaveBtn.parentNode.insertBefore(box, addSaveBtn);
    modifyControls = box;
    return box;
  }

  function setMode(mode) {
    if (editWp) editWp.mode = mode;
    if (modifyControls) {
      var bs = modifyControls.querySelectorAll(".field-mode-btn");
      for (var i = 0; i < bs.length; i++) {
        bs[i].classList.toggle("is-selected", bs[i].getAttribute("data-mode") === mode);
      }
    }
    addStatus(mode === "keep"
      ? "Location kept — edit the fields and Save."
      : mode === "replace"
        ? "Re-recording — hold still; Save replaces the location."
        : "Averaging — hold still; Save blends with the existing location.");
  }

  function startModify(point, source) {
    editWp = { id: point.point_id, source: source, point: point, mode: "keep" };
    if (wpName) wpName.value = point.point_name || "";
    if (wpNamePrefix) wpNamePrefix.style.display = "none";
    var clab = (wpClass && wpClass.closest) ? wpClass.closest(".field-field-label") : null;
    if (clab) clab.style.display = "none";
    if (wpNote) wpNote.value = point.note || "";
    currentColor = point.color || WP_DEFAULT_COLOR;
    currentPhoto = point.photo || null;
    if (wpPhoto) wpPhoto.value = "";
    if (wpPhotoPreview) {
      wpPhotoPreview.innerHTML = "";
      if (currentPhoto) {
        var im = document.createElement("img");
        im.src = currentPhoto;
        im.className = "field-photo-thumb";
        wpPhotoPreview.appendChild(im);
      }
    }
    refreshAddColorRow();
    var mc = ensureModifyControls();
    if (mc) {
      mc.hidden = false;
      var d = mc.querySelector(".field-modify-delete");
      if (d) d.style.display = (source === "waypoint") ? "" : "none";
    }
    setMode("keep");
    showScreen("addwaypoint");
  }

  function editLocation(a) {
    var p = editWp.point;
    if (editWp.mode === "keep" || !a) {
      return { lat: p.latitude, lng: p.longitude,
               accuracy: p.horizontal_accuracy, elevation: p.elevation };
    }
    if (editWp.mode === "average") {
      var c = combineLocation(p, a);
      return { lat: c.lat, lng: c.lng, accuracy: c.accuracy,
               elevation: (a.elevation != null) ? a.elevation : p.elevation };
    }
    return { lat: a.lat, lng: a.lng, accuracy: a.accuracy,
             elevation: (a.elevation != null) ? a.elevation : p.elevation };
  }

  function saveModify() {
    if (editWp.mode !== "keep" && (!avg || !samples.length)) {
      addStatus("No location samples yet -- give it a moment, or choose Keep.");
      return;
    }
    var a = avg;
    stopAveraging();
    var now = new Date();
    var p = editWp.point;
    var src = editWp.source;
    var loc = editLocation(a);
    var nm = (wpName && wpName.value.trim()) || p.point_name;
    var w = {
      point_id: p.point_id,
      point_name: nm,
      point_class: p.point_class,
      time: fmtTime(now),
      latitude: loc.lat,
      longitude: loc.lng,
      horizontal_accuracy: (loc.accuracy != null) ? Math.round(loc.accuracy * 10) / 10 : null,
      elevation: (loc.elevation != null) ? Math.round(loc.elevation * 10) / 10 : null,
      bearing: (p.bearing != null) ? p.bearing : null,
      note: (wpNote && wpNote.value.trim()) || "",
      color: currentColor,
      photo: currentPhoto || null,
      visible: true
    };
    w.photo_name = w.photo
      ? String(nm).replace(/[^\w-]+/g, "_") + "_" + isoClean(now).replace(/:/g, "-") + ".jpg"
      : null;
    if (src === "waypoint") {
      var arr = loadWaypoints();
      var idx = -1;
      for (var k = 0; k < arr.length; k++) {
        if (arr[k].point_id === w.point_id) { idx = k; break; }
      }
      if (idx >= 0) arr[idx] = w; else arr.push(w);
      storeWaypoints(arr);
      refreshWaypointMarker(w);
    }
    uploadToDrive("individual_points", w.point_name + "_" + syncTimestamp() + ".geojson", waypointsFC([w]), null, function () {
      if (src === "waypoint") markUploaded([w.point_id]);
      showUploadModal(w.point_name + " uploaded to Drive.");
    });
    renderWaypoints();
    resetAddForm();
    addStatus("");
    closeMenu();
  }

  function startAveraging() {
    if (!navigator.geolocation) { addStatus("Geolocation isn't available."); return; }
    samples = [];
    avg = null;
    avgStart = Date.now();
    averaging = true;
    renderLive();
    addStatus("Averaging... hold still; Save when the bar has settled.");
    avgWatchId = navigator.geolocation.watchPosition(
      function (pos) {
        var c = pos.coords;
        samples.push({
          lat: c.latitude,
          lng: c.longitude,
          elevation: (c.altitude != null) ? c.altitude : null,
          accuracy: (c.accuracy != null) ? c.accuracy : 0
        });
        computeAverage();
        renderLive();
      },
      function (err) { addStatus("Location error: " + err.message); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  }

  function stopAveraging() {
    if (avgWatchId != null) {
      navigator.geolocation.clearWatch(avgWatchId);
      avgWatchId = null;
    }
    averaging = false;
  }

  // Average only while the Add Waypoint screen is actually showing. Called on
  // every navigation so it auto-starts on entry and stops on exit.

  function syncAveraging() {
    var shouldRun = overlay.classList.contains("is-open") &&
      activeScreen() === "addwaypoint";
    if (shouldRun && !averaging) {
      startAveraging();
    } else if (!shouldRun && averaging) {
      stopAveraging();
      samples = [];
      avg = null;
      newNestId = null;
      renderLive();
    }
  }

  // Inverse-variance combine of a stored waypoint location with a fresh average
  // (weights ~ 1/accuracy^2): the better-known fix dominates.

  function combineLocation(oldW, a) {
    var ao = Math.max(oldW.horizontal_accuracy || 5, 0.5);
    var an = Math.max(a.accuracy || 5, 0.5);
    var wo = 1 / (ao * ao), wn = 1 / (an * an);
    return {
      lat: (oldW.latitude * wo + a.lat * wn) / (wo + wn),
      lng: (oldW.longitude * wo + a.lng * wn) / (wo + wn),
      accuracy: 1 / Math.sqrt(wo + wn)
    };
  }

  function saveAveraged() {
    if (editWp) { saveModify(); return; }
    if (!avg || !samples.length) {
      addStatus("No location samples yet -- give it a moment.");
      return;
    }
    var a = avg;               // snapshot the average before restarting
    stopAveraging();
    var forNest = newNestId;
    newNestId = null;

    var now = new Date();
    var t = fmtTime(now);
    var arr = loadWaypoints();

    var wp = {
      point_id: newId(),
      point_name: forNest ? forNest : currentName(t),
      point_class: forNest ? "Nest" : ((wpClass && wpClass.value) || "Other"),
      time: t,
      elevation: (a.elevation != null) ? Math.round(a.elevation * 10) / 10 : null,
      horizontal_accuracy: Math.round(a.accuracy * 10) / 10,
      bearing: (typeof window.fieldBearing === "number") ? window.fieldBearing : null,
      n_samples: a.n,
      note: (wpNote && wpNote.value.trim()) || "",
      longitude: a.lng,
      latitude: a.lat,
      color: currentColor,
      visible: true,
      photo: currentPhoto || null
    };

    // Name the photo: <waypoint name>_<ISO 8601 datetime>.jpg.

    if (wp.photo) {
      var safeNm = wp.point_name.replace(/[^\w-]+/g, "_");
      var isoSafe = isoClean(now).replace(/:/g, "-");
      wp.photo_name = safeNm + "_" + isoSafe + ".jpg";
    } else {
      wp.photo_name = null;
    }

    arr.push(wp);
    storeWaypoints(arr);
    if (wp.point_class === "Temp") {
      showUploadModal(wp.point_name + " added (temporary -- not saved).");
    } else {
      uploadToDrive("individual_points", wp.point_name + "_" + syncTimestamp() + ".geojson", waypointsFC([wp]), null, function () {
        markUploaded([wp.point_id]);
        showUploadModal(forNest ? ("Location saved for " + forNest + ".") : (wp.point_name + " uploaded to Drive."));
      });
    }
    addWaypointMarker(wp);
    renderWaypoints();
    resetAddForm();
    addStatus("");

    // Back to the map view (closeMenu also stops the GPS averaging watch).

    closeMenu();
  }

  if (addSaveBtn) addSaveBtn.addEventListener("click", saveAveraged);

  // Cancel: discard the in-progress form and return to the main menu.

  var addCancelBtn = document.getElementById("addWaypointCancelBtn");
  if (addCancelBtn) addCancelBtn.addEventListener("click", function () {
    resetAddForm();
    addStatus("");
    // Leaving the screen stops averaging via syncAveraging

    showScreen("main");
  });

  // waypoint manager ------------------------------------------------------

  var listEl = document.getElementById("waypointList");
  var clearBtn = document.getElementById("clearWaypointsBtn");

  // Persist one change to the waypoint with the given id; returns the updated
  // record (or null).

  function updateWaypoint(id, fn) {
    var arr = loadWaypoints(), found = null;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].point_id === id) { fn(arr[i]); found = arr[i]; break; }
    }
    if (found) storeWaypoints(arr);
    return found;
  }

  // One manager row: name (+ optional show toggle / color dot) with two
  // actions, Navigate and Modify. Used for both own waypoints and map points.

  function makePointLi(nameText, color, showState, onNav, onModify) {
    var li = document.createElement("li");
    li.className = "field-mgr-item";
    var row = document.createElement("div");
    row.className = "field-mgr-summary";
    if (showState) {
      var show = document.createElement("input");
      show.type = "checkbox";
      show.className = "field-mgr-check";
      show.checked = showState.checked;
      show.title = "Show on map";
      show.addEventListener("change", function () { showState.onToggle(show.checked); });
      row.appendChild(show);
    }
    if (color) {
      var dot = document.createElement("span");
      dot.className = "field-swatch-dot";
      dot.style.background = color;
      row.appendChild(dot);
    }
    var nm = document.createElement("span");
    nm.className = "field-mgr-name";
    nm.textContent = nameText;
    row.appendChild(nm);
    var acts = document.createElement("div");
    acts.className = "field-mgr-actions";
    var nav = document.createElement("button");
    nav.type = "button"; nav.className = "field-button";
    nav.textContent = "Navigate";
    nav.addEventListener("click", onNav);
    var mod = document.createElement("button");
    mod.type = "button"; mod.className = "field-button";
    mod.textContent = "Modify";
    mod.addEventListener("click", onModify);
    acts.appendChild(nav);
    acts.appendChild(mod);
    row.appendChild(acts);
    li.appendChild(row);
    return li;
  }

  function renderWaypoints() {
    if (!listEl) return;
    var arr = loadWaypoints().filter(function (w) { return !w.uploaded && !w.cleared; });
    listEl.innerHTML = "";

    if (!arr.length) {
      var empty = document.createElement("li");
      empty.className = "field-waypoint-empty";
      empty.textContent = "No saved waypoints yet.";
      listEl.appendChild(empty);
    }

    arr.forEach(function (w) {
      listEl.appendChild(makePointLi(
        w.point_name + " (" + w.point_class + ")",
        wpColorHex(w),
        {
          checked: w.visible !== false,
          onToggle: function (on) {
            updateWaypoint(w.point_id, function (x) { x.visible = on; });
            if (on) { w.visible = true; addWaypointMarker(w); }
            else removeWaypointMarker(w.point_id);
          }
        },
        function () { startNavigation(w); },
        function () { startModify(w, "waypoint"); }
      ));
    });

    renderNavPoints();
  }

  // Append the map's data points (window.fieldNavPoints, embedded by
  // make_field_map.R) to the manager, grouped by type in collapsible sections.
  // Each point has a Navigate button -- these are navigate-only (not editable).

  function navPointToPoint(p) {
    return {
      point_id: p.point_id,
      point_name: p.name,
      point_class: p.point_class,
      latitude: p.lat,
      longitude: p.lng,
      note: p.note,
      photo: p.photo,
      color: WP_DEFAULT_COLOR,
      elevation: p.elevation,
      horizontal_accuracy: p.horizontal_accuracy,
      bearing: p.bearing
    };
  }

  function renderNavPoints() {
    if (!listEl) return;
    var pts = window.fieldNavPoints;
    if (!pts || !pts.length) return;

    var groups = {};
    pts.forEach(function (p) { (groups[p.type] = groups[p.type] || []).push(p); });

    var head = document.createElement("li");
    head.className = "field-navpts-head";
    head.textContent = "Map points";
    listEl.appendChild(head);

    Object.keys(groups).forEach(function (type) {
      var list = groups[type];
      var li = document.createElement("li");
      li.className = "field-mgr-item";

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "field-accordion";
      btn.innerHTML = '<span class="field-accordion-caret">&#x25B8;</span> ' +
        escapeHtml(type) + " (" + list.length + ")";

      var body = document.createElement("ul");
      body.className = "field-navpts-body";
      body.hidden = true;
      btn.addEventListener("click", function () {
        body.hidden = !body.hidden;
        btn.classList.toggle("is-open", !body.hidden);
      });

      list.forEach(function (p) {
        var navAsPoint = navPointToPoint(p);
        body.appendChild(makePointLi(
          p.name,
          null,
          null,
          function () { startNavigation({ latitude: p.lat, longitude: p.lng, point_name: p.name }); },
          function () { startModify(navAsPoint, "nav"); }
        ));
      });

      li.appendChild(btn);
      li.appendChild(body);
      listEl.appendChild(li);
    });
  }

  window.fieldModifyNavPoint = function (key) {
    var pts = window.fieldNavPoints || [];
    var p = null;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].point_id === key || pts[i].name === key) { p = pts[i]; break; }
    }
    if (window.fieldMap) window.fieldMap.closePopup();
    if (p) startModify(navPointToPoint(p), "nav");
    else startNewNestPoint(key);
  };

  window.fieldNavigateNavPoint = function (key) {
    var pts = window.fieldNavPoints || [];
    var p = null;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].point_id === key || pts[i].name === key) { p = pts[i]; break; }
    }
    if (window.fieldMap) window.fieldMap.closePopup();
    if (p) startNavigation({ latitude: p.lat, longitude: p.lng, point_name: p.name });
    else window.alert("No saved location for " + key + " yet -- use Modify to add one.");
  };

  // Non-Temp waypoints that haven't reached Drive yet (saved offline, or a send
  // that failed). Kept in the cache -- even through a Clear -- until uploaded.

  function isPending(w) {
    return w.point_class !== "Temp" && !w.uploaded;
  }

  // Re-send anything still pending once the device is back online. Debounced so
  // a burst of "online" events triggers just one pass; markUploaded then drops
  // each one from the pending set as it succeeds.

  var lastRetry = 0;
  function retryPendingUploads() {
    if (!navigator.onLine) return;
    var now = Date.now();
    if (now - lastRetry < 3000) return;
    lastRetry = now;
    loadWaypoints().filter(isPending).forEach(function (w) {
      uploadToDrive(
        "individual_points",
        w.point_name + "_" + syncTimestamp() + ".geojson",
        waypointsFC([w]),
        null,
        function () { markUploaded([w.point_id]); }
      );
    });
  }
  window.addEventListener("online", retryPendingUploads);

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      var arr = loadWaypoints();
      if (!arr.length) return;
      if (window.confirm("Clear cached waypoints? (Points still waiting to reach Drive are kept and sent when you reconnect.)")) {
        arr.forEach(function (w) { removeWaypointMarker(w.point_id); });
        // Keep still-pending points (drop them from the view only); clear the rest.
        var keep = arr.filter(isPending);
        keep.forEach(function (w) { w.cleared = true; });
        storeWaypoints(keep);
        renderWaypoints();
      }
    });
  }

  renderWaypoints();
  retryPendingUploads();

  // waypoint navigation ---------------------------------------------------

  // "Navigate to waypoint" (from the manager) draws a dashed line to the target
  // and shows live distance + bearing in a top banner. On arrival (within the
  // GPS accuracy, min 8 m) a centered "You have arrived!" popup appears with a
  // Cancel option. Uses the shared position (window.fieldLatLng) and the geo
  // helpers from the Track section.

  var NAV_ARRIVE = 8;       // m: minimum arrival radius
  var navTarget = null;     // { lat, lng, name }
  var navLine = null;       // dashed Leaflet polyline to the target
  var navArrived = false;

  var navBanner = document.getElementById("navBanner");
  var navTargetEl = document.getElementById("navTarget");
  var navDistEl = document.getElementById("navDist");
  var navBrgEl = document.getElementById("navBrg");
  var navCancelBtn = document.getElementById("navCancelBtn");
  var navArrivedEl = document.getElementById("navArrived");
  var navArrivedNameEl = document.getElementById("navArrivedName");
  var navArrivedCancel = document.getElementById("navArrivedCancel");

  function startNavigation(w) {
    navTarget = { lat: w.latitude, lng: w.longitude, name: w.point_name };
    navArrived = false;
    if (navBanner) navBanner.hidden = false;
    if (navTargetEl) navTargetEl.textContent = "▸ " + w.point_name;
    if (navArrivedEl) navArrivedEl.hidden = true;
    if (window.fieldMap && window.L) {
      if (navLine) window.fieldMap.removeLayer(navLine);
      navLine = window.L.polyline([], {
        color: "#136aec", weight: 3, dashArray: "6, 6", opacity: 0.9
      }).addTo(window.fieldMap);
    }
    // Back to the map so the banner + line are visible

    closeMenu();
    updateNavigation();
  }

  function stopNavigation() {
    navTarget = null;
    navArrived = false;
    if (navBanner) navBanner.hidden = true;
    if (navArrivedEl) navArrivedEl.hidden = true;
    if (navLine && window.fieldMap) { window.fieldMap.removeLayer(navLine); navLine = null; }
  }

  function updateNavigation() {
    if (!navTarget) return;
    var ll = window.fieldLatLng;
    if (!ll) { if (navDistEl) navDistEl.textContent = "-- m"; return; }
    var d = metersBetween(ll.lat, ll.lng, navTarget.lat, navTarget.lng);
    var b = Math.round(bearingDeg(ll.lat, ll.lng, navTarget.lat, navTarget.lng)) % 360;
    if (navDistEl) navDistEl.textContent = fmtDist(d);
    if (navBrgEl) navBrgEl.textContent = b + "°";
    if (navLine) navLine.setLatLngs([[ll.lat, ll.lng], [navTarget.lat, navTarget.lng]]);

    var arriveR = Math.max(NAV_ARRIVE,
      (typeof window.fieldAccuracy === "number") ? window.fieldAccuracy : 0);
    if (d <= arriveR && !navArrived) {
      navArrived = true;
      if (navArrivedNameEl) navArrivedNameEl.textContent = navTarget.name;
      if (navArrivedEl) navArrivedEl.hidden = false;
    }
  }

  if (navCancelBtn) navCancelBtn.addEventListener("click", stopNavigation);
  if (navArrivedCancel) navArrivedCancel.addEventListener("click", stopNavigation);

  setInterval(updateNavigation, 800);

  // track -----------------------------------------------------------------

  // Records a denoised track

  var TRACK_STYLE = { color: "#ffff00", weight: 3, opacity: 0.95 };
  var SAVED_STYLE = { color: "#ff8c00", weight: 3, opacity: 0.9 };
  var TRACK_ACC_MAX = 15;
  var ERR_STYLE = {
    color: "#136aec", weight: 1, fillColor: "#136aec",
    fillOpacity: 0.15, interactive: false
  };

  // Track recorder knobs. Strategy: 
  // - (a) an ADAPTIVE accuracy gate --reject fixes worse than the gate, which 
  //    starts at ACC_START and tightens toward ACC_FLOOR as the GPS proves it
  //    can do better
  // - (b) average the last WIN_MS of accepted fixes into the current position, 
  //    so standing still / slow walking averages (better accuracy, narrower 
  //    error corridor) and turning in place doesn't nudge the track
  // - (c) commit a vertex every SEG_MIN of net movement. Lower WIN_MS = more 
  //    faithful to the raw path; higher = more averaging/smoothing.

  var ACC_START = 10;  // m: initial accuracy gate (reject fixes < this)
  var ACC_FLOOR = 5;   // m: tightest the gate gets as the GPS settles
  var GATE_MULT = 1.8; // gate ~ best-seen accuracy * this (down to ACC_FLOOR)
  var WIN_MS = 3000;   // ms: averaging window (longer = more averaging but lag)
  var SEG_MIN = 1.5;   // m: net movement before a new vertex commits
  var STILL_RMS = 0.3;
  var STILL_ENTER_MS = 3000;
  var STILL_EXIT_MS = 1200;
  var ACC_WIN_MS = 1200;
  var STILL_DOT = { radius: 6, color: "#136aec", weight: 2, fillColor: "#8ec5ff", fillOpacity: 0.9 };

  var TRACKS_KEY = "fieldTracks";

  var trackToggleBtn = document.getElementById("trackToggleBtn");
  var saveTrackBtn = document.getElementById("saveTrackBtn");
  var clearTrackBtn = document.getElementById("clearTrackBtn");
  var trackStatusEl = document.getElementById("trackStatus");
  var trackNameEl = document.getElementById("trackName");
  var trackNoteEl = document.getElementById("trackNote");
  var trkSpeedEl = document.getElementById("trkSpeed");
  var trkLenEl = document.getElementById("trkLen");
  var trkStartEl = document.getElementById("trkStart");
  var trkClockEl = document.getElementById("trkClock");
  var trkRmsEl = document.getElementById("trkRms");
  var rmsShownAt = 0;
  var trackMgrToggle = document.getElementById("trackMgrToggle");
  var trackMgrBody = document.getElementById("trackMgrBody");
  var trackListEl = document.getElementById("trackList");
  var walkAgainTarget = null;   // track id being re-walked
  var replaceTarget = null;
  var tracking = false;
  var committed = [];     // finalized vertices [{lat,lng,t,acc,n}]
  var live = null;        // {lat,lng,acc} = windowed-mean current position
  var fwin = [];          // sliding window of accepted fixes {lat,lng,acc,ts}
  var bestAcc = Infinity; // best reported accuracy seen (tightens the gate)
  var activeLine = null;  // Leaflet polyline through committed + working
  var errPoly = null;     // live error polygon
  var recentFixes = [];   // [{lat,lng,ts}] sliding window for speed
  var startMs = 0;
  var clockIv = null;
  var onTrackLoc = null;
  var motionOn = false;
  var motionHandler = null;
  var accBuf = [];
  var accRms = 0;
  var stationary = false;
  var stillSince = 0;
  var moveSince = 0;
  var still = null;
  var stillDot = null;

  function trackStatus(msg) {
    if (trackStatusEl) trackStatusEl.textContent = msg || "";
  }

  var trackActivityEl = document.getElementById("trackActivity");
  var trackPatchId = "patch-none";
  var trackAutoName = "";

  function trkPatchDist(lat, lng, rings) {
    var kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540;
    var inside = false, minD = Infinity;
    rings.forEach(function (ring) {
      var n = ring.length;
      for (var i = 0, j = n - 1; i < n; j = i++) {
        var ax = (ring[i][1] - lng) * kx, ay = (ring[i][0] - lat) * ky;
        var bx = (ring[j][1] - lng) * kx, by = (ring[j][0] - lat) * ky;
        if (((ay > 0) !== (by > 0)) && (0 < (bx - ax) * (0 - ay) / (by - ay) + ax)) inside = !inside;
        var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        var u = L2 ? ((0 - ax) * dx + (0 - ay) * dy) / L2 : 0;
        u = Math.max(0, Math.min(1, u));
        var cx = ax + u * dx, cy = ay + u * dy;
        var d = Math.sqrt(cx * cx + cy * cy);
        if (d < minD) minD = d;
      }
    });
    return inside ? 0 : minD;
  }

  function closestPatch(lat, lng, maxM) {
    if (!window.fieldPatches) return "patch-none";
    var best = null, bestD = Infinity;
    Object.keys(window.fieldPatches).forEach(function (name) {
      var d = trkPatchDist(lat, lng, window.fieldPatches[name]);
      if (d < bestD) { bestD = d; best = name; }
    });
    return (best != null && bestD <= maxM) ? best : "patch-none";
  }

  function trackStamp(d) {
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function trackActivity() { return (trackActivityEl && trackActivityEl.value) || "other"; }

  function syncTrackNameLock() {
    if (!trackNameEl) return;
    var other = trackActivity() === "other";
    trackNameEl.disabled = !other;
    trackNameEl.placeholder = other ? "Track name" : "Auto-named on Start";
    if (!other) trackNameEl.value = trackAutoName || "";
  }
  if (trackActivityEl) {
    trackActivityEl.addEventListener("change", function () {
      if (trackActivity() === "other" && trackNameEl) trackNameEl.value = "";
      syncTrackNameLock();
    });
  }
  syncTrackNameLock();

  // The map is created by an htmlwidget onRender, which may run after this
  // script. Wait for it (map_weather.js sets window.fieldMap + fires the
  // "fieldmap:ready" event).

  function whenMapReady(cb) {
    if (window.fieldMap && window.L) { cb(window.fieldMap); return; }
    var done = false;
    function go() {
      if (done || !window.fieldMap || !window.L) return;
      done = true;
      cb(window.fieldMap);
    }
    window.addEventListener("fieldmap:ready", go);
    var n = 0;
    var iv = setInterval(function () {
      if (window.fieldMap && window.L) { clearInterval(iv); go(); }
      else if (++n > 150) { clearInterval(iv); }
    }, 100);
  }

  // Geo helpers (local equirectangular, meters).

  function mPerDeg(lat) {
    return { lat: 110540, lng: 111320 * Math.cos(lat * Math.PI / 180) };
  }
  function metersBetween(aLat, aLng, bLat, bLng) {
    var md = mPerDeg((aLat + bLat) / 2);
    var dy = (bLat - aLat) * md.lat, dx = (bLng - aLng) * md.lng;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function bearingDeg(aLat, aLng, bLat, bLng) {
    var md = mPerDeg((aLat + bLat) / 2);
    var dy = (bLat - aLat) * md.lat, dx = (bLng - aLng) * md.lng;
    return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  }

  // Ellipse (as a polygon) centered on lat/lng: 
  // - rAlong along the travel bearing
  // - rPerp perpendicular to it
  // - if rPerp >= rAlong makes it bulge across the path.

  function ellipsePolygon(lat, lng, rPerp, rAlong, bearing, steps) {
    var md = mPerDeg(lat);
    var br = bearing * Math.PI / 180;
    var aE = Math.sin(br), aN = Math.cos(br);                 // along motion
    var pE = Math.sin(br + Math.PI / 2), pN = Math.cos(br + Math.PI / 2); // perp
    var pts = [];
    for (var i = 0; i < steps; i++) {
      var th = 2 * Math.PI * i / steps;
      var al = rAlong * Math.cos(th), pp = rPerp * Math.sin(th);
      var east = al * aE + pp * pE, north = al * aN + pp * pN;
      pts.push([lat + north / md.lat, lng + east / md.lng]);
    }
    return pts;
  }

  function trackDistance(pts) {
    var d = 0;
    for (var i = 1; i < pts.length; i++) {
      d += metersBetween(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
    }
    return d;
  }
  function fmtDist(m) {
    return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m";
  }

  // error corridor + GeoJSON + track averaging helpers --------------------

  function offsetPoint(lat, lng, dist, bearing) {
    var md = mPerDeg(lat), br = bearing * Math.PI / 180;
    return [lat + (dist * Math.cos(br)) / md.lat, lng + (dist * Math.sin(br)) / md.lng];
  }

  // Mean travel direction at vertex i (average of adjacent segment bearings).

  function vertexBearing(pts, i) {
    var inB = i > 0 ? bearingDeg(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng) : null;
    var outB = i < pts.length - 1 ? bearingDeg(pts[i].lat, pts[i].lng, pts[i + 1].lat, pts[i + 1].lng) : null;
    if (inB == null) return outB || 0;
    if (outB == null) return inB;
    var x = Math.sin(inB * Math.PI / 180) + Math.sin(outB * Math.PI / 180);
    var y = Math.cos(inB * Math.PI / 180) + Math.cos(outB * Math.PI / 180);
    return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
  }

  // Error envelope: a ribbon offset +/- per-vertex accuracy, perpendicular to
  // the travel direction. Returns a closed ring of [lat,lng].

  function errorCorridor(pts) {
    if (!pts || pts.length < 2) return null;
    var left = [], right = [];
    for (var i = 0; i < pts.length; i++) {
      var b = vertexBearing(pts, i);
      var a = (pts[i].acc != null ? pts[i].acc : 5);
      left.push(offsetPoint(pts[i].lat, pts[i].lng, a, b + 90));
      right.push(offsetPoint(pts[i].lat, pts[i].lng, a, b - 90));
    }
    return left.concat(right.reverse());
  }

  // Export the track as a GeoJSON FeatureCollection of ordered Point features,
  // each carrying its accuracy (m) so low-accuracy points can be filtered out
  // after.

  function trackPointsFC(t) {
    return {
      type: "FeatureCollection",
      features: t.points.map(function (p, i) {
        return {
          type: "Feature",
          properties: {
            track: t.name,
            activity: t.activity || null,
            patch_id: t.patch_id || null,
            i: i,
            time: p.t || null,
            accuracy_m: (p.acc != null ? Math.round(p.acc * 10) / 10 : null),
            averaged: !!p.avg,
            samples: p.n || 1
          },
          geometry: { type: "Point", coordinates: [p.lng, p.lat] }
        };
      })
    };
  }
  function downloadTrack(t) {
    downloadText(safeName(t.name) + ".geojson",
      JSON.stringify(trackPointsFC(t), null, 2), "application/geo+json");
  }
  function safeName(s) { return String(s || "track").replace(/[^\w-]+/g, "_"); }

  // Nearest point on a polyline (array of {lat,lng}) to a given point.

  function projectPointSeg(lat, lng, a, b) {
    var md = mPerDeg(lat);
    var bx = (b.lng - a.lng) * md.lng, by = (b.lat - a.lat) * md.lat;
    var px = (lng - a.lng) * md.lng, py = (lat - a.lat) * md.lat;
    var len2 = bx * bx + by * by;
    var t = len2 ? (px * bx + py * by) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return { lat: a.lat + (by * t) / md.lat, lng: a.lng + (bx * t) / md.lng };
  }
  function nearestOnPolyline(lat, lng, line) {
    if (!line.length) return { lat: lat, lng: lng };
    if (line.length === 1) return { lat: line[0].lat, lng: line[0].lng };
    var best = null, bd = Infinity;
    for (var i = 1; i < line.length; i++) {
      var q = projectPointSeg(lat, lng, line[i - 1], line[i]);
      var d = metersBetween(lat, lng, q.lat, q.lng);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  // Average each original vertex with the nearest point on the new walk.

  function averageTracksNearest(orig, neu) {
    return orig.map(function (v) {
      var q = nearestOnPolyline(v.lat, v.lng, neu);
      return { lat: (v.lat + q.lat) / 2, lng: (v.lng + q.lng) / 2, t: v.t, acc: v.acc };
    });
  }

  // Average the recent (WIN_MS) accepted fixes -> the current position. More
  // fixes / tighter scatter (standing still, slow walking) -> better accuracy.

  function winMean() {
    var n = fwin.length;
    if (!n) return null;
    var sLat = 0, sLng = 0, sAcc = 0;
    for (var i = 0; i < n; i++) { sLat += fwin[i].lat; sLng += fwin[i].lng; sAcc += fwin[i].acc; }
    return { lat: sLat / n, lng: sLng / n, accMean: sAcc / n, n: n };
  }
  function winAccuracy(m) {
    var md = mPerDeg(m.lat), sq = 0;
    for (var i = 0; i < fwin.length; i++) {
      var dy = (fwin[i].lat - m.lat) * md.lat, dx = (fwin[i].lng - m.lng) * md.lng;
      sq += dx * dx + dy * dy;
    }
    var scatter = Math.sqrt(sq / m.n);
    var perSample = Math.max(m.accMean, scatter);
    var span = (fwin[fwin.length - 1].ts - fwin[0].ts) / 1000;
    var nEff = 1 + Math.max(0, span) / 2;   // ~1 independent sample per 2 s
    return perSample / Math.sqrt(nEff);
  }

  // Vertices currently on the line: committed plus the live working mean.

  function liveVertices() {
    var v = committed.slice();
    if (live) v.push({ lat: live.lat, lng: live.lng });
    return v;
  }

  function finalizeLive() {
    if (!live) return;
    var last = committed[committed.length - 1];
    if (!last || metersBetween(last.lat, last.lng, live.lat, live.lng) > 0.5) {
      committed.push({
        lat: live.lat, lng: live.lng, t: new Date().toISOString(),
        acc: live.acc, n: 1
      });
    }
  }

  function redrawLive() {
    if (!activeLine) return;
    var v = liveVertices();
    activeLine.setLatLngs(v.map(function (p) { return [p.lat, p.lng]; }));

    if (live && window.fieldMap) {

      // Error corridor along the whole path: each vertex offset by its accuracy,
      // perpendicular to travel (same geometry as the saved error polygon).

      var pts = committed.map(function (c) {
        return { lat: c.lat, lng: c.lng, acc: c.acc };
      });
      pts.push({ lat: live.lat, lng: live.lng, acc: live.acc });
      var ring = (pts.length >= 2)
        ? errorCorridor(pts)
        : ellipsePolygon(live.lat, live.lng, live.acc, live.acc, 0, 28);
      if (ring) {
        if (!errPoly) errPoly = window.L.polygon(ring, ERR_STYLE).addTo(window.fieldMap);
        else errPoly.setLatLngs(ring);
      }
    }
    if (stationary && live && window.fieldMap) {
      if (!stillDot) stillDot = window.L.circleMarker([live.lat, live.lng], STILL_DOT).addTo(window.fieldMap);
      else stillDot.setLatLng([live.lat, live.lng]);
    } else if (stillDot && window.fieldMap) {
      window.fieldMap.removeLayer(stillDot);
      stillDot = null;
    }
  }

  // Meters / minute over the sliding window

  function currentSpeed() {
    if (recentFixes.length < 2) return 0;
    var d = 0;
    for (var i = 1; i < recentFixes.length; i++) {
      d += metersBetween(recentFixes[i - 1].lat, recentFixes[i - 1].lng,
                         recentFixes[i].lat, recentFixes[i].lng);
    }
    var dt = (recentFixes[recentFixes.length - 1].ts - recentFixes[0].ts) / 1000;
    return dt > 0 ? d / dt * 60 : 0;
  }

  function updateReadout() {
    if (trkSpeedEl) trkSpeedEl.textContent = tracking ? Math.round(currentSpeed()) : "--";
    if (trkLenEl) trkLenEl.textContent = (tracking || committed.length)
      ? fmtDist(trackDistance(liveVertices())) : "--";
    if (trkStartEl) trkStartEl.textContent = startMs ? fmtTime(new Date(startMs)) : "--";
    if (trkClockEl) trkClockEl.textContent = startMs && tracking
      ? fmtElapsed(Date.now() - startMs)
      : (trkClockEl.textContent || "00:00");
  }

  function onMotion(ev) {
    var g = ev.accelerationIncludingGravity || ev.acceleration;
    if (!g || g.x == null) return;
    var mag = Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z);
    var now = Date.now();
    accBuf.push({ m: mag, ts: now });
    while (accBuf.length > 1 && now - accBuf[0].ts > ACC_WIN_MS) accBuf.shift();
    var n = accBuf.length, s = 0, i;
    for (i = 0; i < n; i++) s += accBuf[i].m;
    var mean = s / n, sq = 0;
    for (i = 0; i < n; i++) { var d = accBuf[i].m - mean; sq += d * d; }
    accRms = Math.sqrt(sq / n);
    updateMotionState(now);
    if (trkRmsEl && now - rmsShownAt > 250) {
      rmsShownAt = now;
      trkRmsEl.textContent = accRms.toFixed(2) + " " + (stationary ? "still" : "moving");
    }
  }

  function updateMotionState(now) {
    if (!tracking) return;
    if (accRms < STILL_RMS) {
      moveSince = 0;
      if (!stillSince) stillSince = now;
      if (!stationary && now - stillSince >= STILL_ENTER_MS) enterStationary();
    } else {
      stillSince = 0;
      if (!moveSince) moveSince = now;
      if (stationary && now - moveSince >= STILL_EXIT_MS) exitStationary();
    }
  }

  function enterStationary() {
    stationary = true;
    still = { sw: 0, sLat: 0, sLng: 0, accMin: Infinity, n: 0, t0: Date.now() };
    trackStatus("Holding still \u2014 averaging this point\u2026");
  }

  function finalizeStill() {
    if (!still || !still.n) { still = null; return; }
    var lat = still.sLat / still.sw, lng = still.sLng / still.sw;
    var acc = Math.max(still.accMin, 1 / Math.sqrt(still.sw));
    var last = committed[committed.length - 1];
    var v = { lat: lat, lng: lng, t: new Date(still.t0).toISOString(), acc: acc, n: still.n, avg: true };
    if (last && metersBetween(last.lat, last.lng, lat, lng) <= 0.5) committed[committed.length - 1] = v;
    else committed.push(v);
  }

  function exitStationary() {
    finalizeStill();
    stationary = false;
    still = null;
    fwin = [];
    recentFixes = [];
    live = null;
    trackStatus("Moving \u2014 recording.");
  }

  function startMotion() {
    accBuf = []; accRms = 0; stationary = false; stillSince = 0; moveSince = 0; still = null;
    if (trkRmsEl) trkRmsEl.textContent = "sensing\u2026";
    if (typeof DeviceMotionEvent === "undefined") { motionOn = false; if (trkRmsEl) trkRmsEl.textContent = "n/a"; return; }
    function attach() {
      motionHandler = onMotion;
      window.addEventListener("devicemotion", motionHandler);
      motionOn = true;
    }
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      DeviceMotionEvent.requestPermission()
        .then(function (r) { if (r === "granted") attach(); else { motionOn = false; if (trkRmsEl) trkRmsEl.textContent = "denied"; } })
        .catch(function () { motionOn = false; if (trkRmsEl) trkRmsEl.textContent = "n/a"; });
    } else {
      attach();
    }
  }

  function stopMotion() {
    if (motionHandler) window.removeEventListener("devicemotion", motionHandler);
    motionHandler = null;
    motionOn = false;
    if (trkRmsEl) trkRmsEl.textContent = "--";
    if (stillDot && window.fieldMap) { window.fieldMap.removeLayer(stillDot); stillDot = null; }
  }

  function onFix(e) {
    if (!tracking) return;
    var acc0 = (e.accuracy != null ? e.accuracy : 15);
    if (acc0 < bestAcc) bestAcc = acc0;

    // Adaptive accuracy gate: start at ACC_START, tighten toward ACC_FLOOR as
    // the GPS proves it can do better; reject fixes worse than the gate.

    var gate = Math.max(ACC_FLOOR, Math.min(ACC_START, bestAcc * GATE_MULT));
    if (acc0 > gate) return;

    var now = Date.now();

    if (stationary && still) {
      var w = 1 / (acc0 * acc0);
      still.sw += w;
      still.sLat += w * e.latlng.lat;
      still.sLng += w * e.latlng.lng;
      if (acc0 < still.accMin) still.accMin = acc0;
      still.n++;
      live = {
        lat: still.sLat / still.sw,
        lng: still.sLng / still.sw,
        acc: Math.max(still.accMin, 1 / Math.sqrt(still.sw))
      };
      recentFixes.push({ lat: e.latlng.lat, lng: e.latlng.lng, ts: now });
      while (recentFixes.length > 1 && now - recentFixes[0].ts > 15000) recentFixes.shift();
      redrawLive();
      updateReadout();
      return;
    }

    fwin.push({ lat: e.latlng.lat, lng: e.latlng.lng, acc: acc0, ts: now });
    while (fwin.length > 1 && now - fwin[0].ts > WIN_MS) fwin.shift();
    recentFixes.push({ lat: e.latlng.lat, lng: e.latlng.lng, ts: now });
    while (recentFixes.length > 1 && now - recentFixes[0].ts > 15000) recentFixes.shift();

    var m = winMean();
    if (!m) return;
    live = { lat: m.lat, lng: m.lng, acc: winAccuracy(m) };

    if (!committed.length) {
      committed.push({
        lat: live.lat, lng: live.lng, t: new Date().toISOString(), acc: live.acc, n: m.n
      });
    } else {
      var last = committed[committed.length - 1];
      if (metersBetween(last.lat, last.lng, live.lat, live.lng) >= SEG_MIN) {
        committed.push({
          lat: live.lat, lng: live.lng, t: new Date().toISOString(), acc: live.acc, n: m.n
        });
      }
    }
    redrawLive();
    updateReadout();
  }

  // Backgrounding (screen off / reading a text) suspends GPS and the first fixes
  // on return are garbage. This deals with that.

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && tracking) { fwin = []; recentFixes = []; }
  });

  function updateTrackUI() {
    if (trackToggleBtn) trackToggleBtn.textContent = tracking ? "Stop track" : "Start track";
    var haveStopped = !tracking && committed.length > 0;
    if (saveTrackBtn) saveTrackBtn.disabled = !(haveStopped && committed.length > 1);
    if (clearTrackBtn) clearTrackBtn.disabled = !(activeLine || committed.length);
  }

  function startTrack() {
    startMotion();
    whenMapReady(function (map) {
      committed = [];
      live = null;
      fwin = [];
      bestAcc = Infinity;
      recentFixes = [];
      startMs = Date.now();
      var trkStart = window.fieldLatLng;
      trackPatchId = trkStart ? closestPatch(trkStart.lat, trkStart.lng, 75) : "patch-none";
      if (trackActivity() !== "other") {
        trackAutoName = trackActivity() + "_" + trackPatchId + "_" + trackStamp(new Date(startMs));
        if (trackNameEl) trackNameEl.value = trackAutoName;
      }
      activeLine = window.L.polyline([], TRACK_STYLE).addTo(map);
      tracking = true;

      onTrackLoc = onFix;
      map.on("locationfound", onTrackLoc);

      if (clockIv) clearInterval(clockIv);
      clockIv = setInterval(updateReadout, 1000);   // tick clock/speed/length

      trackStatus("Recording — pause at corners to pin them.");
      updateReadout();
      updateTrackUI();
    });
  }

  function stopTrack() {
    if (window.fieldMap && onTrackLoc) window.fieldMap.off("locationfound", onTrackLoc);
    onTrackLoc = null;
    stopMotion();
    if (stationary) { finalizeStill(); stationary = false; still = null; live = null; }
    // Finalize the working vertex

    finalizeLive();
    live = null;
    tracking = false;
    if (clockIv) { clearInterval(clockIv); clockIv = null; }
    if (errPoly && window.fieldMap) { window.fieldMap.removeLayer(errPoly); errPoly = null; }
    redrawLive();
    updateReadout();
    trackStatus("Stopped — " + committed.length + " vertices, " +
      fmtDist(trackDistance(committed)) + ".");
    updateTrackUI();
  }

  function xmlEsc(s) {
    return String(s).replace(/[<>&'"]/g, function (c) {
      return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c];
    });
  }
  function trackGPX(name, pts) {
    var seg = pts.map(function (p) {
      return '<trkpt lat="' + p.lat + '" lon="' + p.lng + '">' +
             (p.t ? "<time>" + p.t + "</time>" : "") + "</trkpt>";
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="Nest Study Field Map" ' +
      'xmlns="http://www.topografix.com/GPX/1/1">' +
      "<trk><name>" + xmlEsc(name) + "</name><trkseg>" + seg + "</trkseg></trk></gpx>";
  }
  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  if (trackToggleBtn) {
    trackToggleBtn.addEventListener("click", function () {
      if (tracking) stopTrack();
      else startTrack();
    });
  }

  // track manager (saved tracks) ------------------------------------------

  var savedLayers = {};   // track id -> Leaflet polyline (when visible)

  function loadTracks() {
    try { return JSON.parse(localStorage.getItem(TRACKS_KEY)) || []; }
    catch (e) { return []; }
  }
  function storeTracks(arr) {
    try { localStorage.setItem(TRACKS_KEY, JSON.stringify(arr)); return true; }
    catch (e) { return false; }
  }

  function trackPopupHtml(t) {
    var html = "<b>" + escapeHtml(t.name) + "</b><br>" +
      t.points.length + " vertices, " + fmtDist(t.length || 0);
    if (t.note) html += "<br>" + escapeHtml(t.note);
    return html;
  }
  function trackLatLngs(t) {
    var pts = (t.points || []).filter(function (p) {
      return p.acc == null || p.acc <= TRACK_ACC_MAX;
    });
    if (pts.length < 30) pts = t.points || [];
    return pts.map(function (p) { return [p.lat, p.lng]; });
  }
  function drawSavedTrack(t) {
    if (savedLayers[t.id] || !window.fieldMap || !window.L) return;
    savedLayers[t.id] = window.L.polyline(
      trackLatLngs(t), SAVED_STYLE
    ).addTo(window.fieldMap).bindPopup(trackPopupHtml(t));
  }
  // Update an on-map track's popup after edits

  function refreshSavedTrack(t) {
    if (savedLayers[t.id]) savedLayers[t.id].setPopupContent(trackPopupHtml(t));
  }
  function hideSavedTrack(id) {
    if (savedLayers[id] && window.fieldMap) window.fieldMap.removeLayer(savedLayers[id]);
    delete savedLayers[id];
  }

  // Persist one change to the track with the given id; returns the record.

  function updateTrack(id, fn) {
    var arr = loadTracks(), found = null;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) { fn(arr[i]); found = arr[i]; break; }
    }
    if (found) storeTracks(arr);
    return found;
  }

  // Start re-walking a saved track; on Save the new walk is averaged with it.

  function startWalkAgain(t) {
    walkAgainTarget = t.id;
    if (trackNameEl) trackNameEl.value = t.name + "_average";
    startTrack();
    trackStatus("Walking \"" + t.name + "\" again — averages on Save.");
  }

  function startRecordNew(t) {
    replaceTarget = t.id;
    walkAgainTarget = null;
    if (trackNameEl) trackNameEl.value = t.name;
    startTrack();
    trackStatus("Recording new \"" + t.name + "\" — replaces the old on Save.");
  }

  function renderTrackList() {
    if (!trackListEl) return;
    var arr = loadTracks();
    trackListEl.innerHTML = "";
    if (!arr.length) {
      var empty = document.createElement("li");
      empty.className = "field-waypoint-empty";
      empty.textContent = "No saved tracks yet.";
      trackListEl.appendChild(empty);
      return;
    }
    var groups = {}, order = [];
    arr.forEach(function (t) {
      var k = t.activity || "other";
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(t);
    });

    function buildTrackLi(t) {
      var li = document.createElement("li");
      li.className = "field-mgr-item";

      var row = document.createElement("div");
      row.className = "field-mgr-summary";

      var show = document.createElement("input");
      show.type = "checkbox";
      show.className = "field-mgr-check";
      show.checked = !!t.visible;
      show.title = "Show on map";
      show.addEventListener("click", function (e) { e.stopPropagation(); });
      show.addEventListener("change", function () {
        updateTrack(t.id, function (x) { x.visible = show.checked; });
        t.visible = show.checked;
        if (show.checked) drawSavedTrack(t); else hideSavedTrack(t.id);
      });

      var nameSpan = document.createElement("span");
      nameSpan.className = "field-mgr-name field-mgr-name-link";
      nameSpan.setAttribute("role", "button");
      nameSpan.textContent = t.name;

      var trackMenu = document.createElement("div");
      trackMenu.className = "field-track-menu";
      trackMenu.hidden = true;
      var recNewBtn = document.createElement("button");
      recNewBtn.type = "button"; recNewBtn.className = "field-button";
      recNewBtn.textContent = "Record new track";
      recNewBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!window.confirm("Are you sure? This will delete the previous track!")) return;
        trackMenu.hidden = true;
        startRecordNew(t);
      });
      var avgNewBtn = document.createElement("button");
      avgNewBtn.type = "button"; avgNewBtn.className = "field-button";
      avgNewBtn.textContent = "Average with new track";
      avgNewBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        trackMenu.hidden = true;
        startWalkAgain(t);
      });
      trackMenu.appendChild(recNewBtn);
      trackMenu.appendChild(avgNewBtn);
      nameSpan.addEventListener("click", function (e) {
        e.stopPropagation();
        trackMenu.hidden = !trackMenu.hidden;
      });

      var caret = document.createElement("span");
      caret.className = "field-accordion-caret";
      caret.innerHTML = "&#x25B8;";

      row.appendChild(show);
      row.appendChild(nameSpan);
      row.appendChild(caret);

      var edit = document.createElement("div");
      edit.className = "field-mgr-edit";
      edit.hidden = true;
      row.addEventListener("click", function () {
        edit.hidden = !edit.hidden;
        caret.classList.toggle("is-open", !edit.hidden);
      });

      var metaP = document.createElement("div");
      metaP.className = "field-waypoint-meta";
      metaP.textContent = t.points.length + " pts · " + fmtDist(t.length || 0);

      // Rename

      var nameLbl = document.createElement("label");
      nameLbl.className = "field-field-label";
      nameLbl.textContent = "Name";
      var nameInput = document.createElement("input");
      nameInput.type = "text"; nameInput.className = "field-input"; nameInput.value = t.name;
      nameInput.addEventListener("change", function () {
        var nm = nameInput.value.trim() || t.name;
        var u = updateTrack(t.id, function (x) { x.name = nm; });
        t.name = nm; nameSpan.textContent = nm;
        if (u) refreshSavedTrack(u);
      });
      nameLbl.appendChild(nameInput);

      // Notes

      var noteLbl = document.createElement("label");
      noteLbl.className = "field-field-label";
      noteLbl.textContent = "Notes";
      var noteInput = document.createElement("textarea");
      noteInput.className = "field-input"; noteInput.rows = 2; noteInput.value = t.note || "";
      noteInput.addEventListener("change", function () {
        var nt = noteInput.value.trim();
        var u = updateTrack(t.id, function (x) { x.note = nt; });
        t.note = nt;
        if (u) refreshSavedTrack(u);
      });
      noteLbl.appendChild(noteInput);

      // Actions: downloads / delete

      var act2 = document.createElement("div");
      act2.className = "field-mgr-actions";
      var dlGeo = document.createElement("button");
      dlGeo.type = "button"; dlGeo.className = "field-button";
      dlGeo.textContent = "Download (GeoJSON)";
      dlGeo.addEventListener("click", function (e) {
        e.stopPropagation();
        downloadTrack(t);
      });
      act2.appendChild(dlGeo);

      var act3 = document.createElement("div");
      act3.className = "field-mgr-actions";
      var del = document.createElement("button");
      del.type = "button"; del.className = "field-button field-button--danger";
      del.textContent = "Delete";
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        hideSavedTrack(t.id);
        var cur = loadTracks().filter(function (x) { return x.id !== t.id; });
        storeTracks(cur);
        renderTrackList();
      });
      act3.appendChild(del);

      edit.appendChild(metaP);
      edit.appendChild(nameLbl);
      edit.appendChild(noteLbl);
      edit.appendChild(act2);
      edit.appendChild(act3);

      li.appendChild(row);
      li.appendChild(trackMenu);
      li.appendChild(edit);
      return li;
    }

    var ACT_LABEL = { nest_searching: "Nest searching", new_path: "New path", distributary: "Distributary", other: "Other" };
    order.forEach(function (k) {
      var gli = document.createElement("li");
      gli.className = "field-mgr-item";
      var gbtn = document.createElement("button");
      gbtn.type = "button"; gbtn.className = "field-accordion";
      gbtn.innerHTML = '<span class="field-accordion-caret">&#x25B8;</span> ' +
        (ACT_LABEL[k] || k) + " (" + groups[k].length + ")";
      var gbody = document.createElement("ul");
      gbody.className = "field-navpts-body";
      gbody.hidden = true;
      gbtn.addEventListener("click", function () {
        gbody.hidden = !gbody.hidden;
        gbtn.classList.toggle("is-open", !gbody.hidden);
      });
      groups[k].forEach(function (t) { gbody.appendChild(buildTrackLi(t)); });
      gli.appendChild(gbtn); gli.appendChild(gbody);
      trackListEl.appendChild(gli);
    });
  }

  // Persist a track, draw it, and auto-download its line + error polygon as
  // GeoJSON (the chosen export behavior).

  function commitSavedTrack(t) {
    var arr = loadTracks();
    arr.push(t);
    storeTracks(arr);
    drawSavedTrack(t);
    renderTrackList();
    // GeoJSON points, each with per-point accuracy

    downloadTrack(t);
  }

  if (saveTrackBtn) {
    saveTrackBtn.addEventListener("click", function () {
      if (tracking) { trackStatus("Stop the track first."); return; }
      if (committed.length < 2) { trackStatus("Track needs at least two vertices."); return; }

      var pts = committed.map(function (p) {
        return { lat: p.lat, lng: p.lng, t: p.t, acc: p.acc };
      });
      var note = (trackNoteEl && trackNoteEl.value.trim()) || "";

      if (walkAgainTarget) {

        // Average the just-walked path with the original by nearest point.

        var orig = loadTracks().filter(function (x) { return x.id === walkAgainTarget; })[0];
        walkAgainTarget = null;
        if (orig) {
          var avgPts = averageTracksNearest(orig.points, pts);
          var at = {
            id: newId(),
            name: orig.name + "_average",
            time: isoClean(new Date()),
            note: note || orig.note || "",
            points: avgPts,
            length: trackDistance(avgPts),
            visible: true
          };
          if (activeLine && window.fieldMap) window.fieldMap.removeLayer(activeLine);
          activeLine = null; committed = [];
          commitSavedTrack(at);
          if (trackNameEl) trackNameEl.value = "";
          if (trackNoteEl) trackNoteEl.value = "";
          trackStatus("Saved averaged track \"" + at.name + "\".");
          updateReadout(); updateTrackUI();
          return;
        }
      }

      var name = (trackActivity() !== "other" && trackAutoName)
        ? trackAutoName
        : ((trackNameEl && trackNameEl.value.trim()) ? toSnakeCase(trackNameEl.value.trim()) : isoClean(new Date()));
      var t = {
        id: newId(),
        name: name,
        time: isoClean(new Date()),
        note: note,
        points: pts,
        length: trackDistance(pts),
        visible: true,
        activity: trackActivity(),
        patch_id: trackPatchId
      };
      if (activeLine && window.fieldMap) window.fieldMap.removeLayer(activeLine);
      activeLine = null;
      committed = [];
      commitSavedTrack(t);
      uploadToDrive("tracks", safeName(t.name) + ".geojson", trackPointsFC(t), trackStatus, function () {
        showUploadModal("Track " + t.name + " uploaded.");
      });
      if (replaceTarget) {
        hideSavedTrack(replaceTarget);
        var keepTracks = loadTracks().filter(function (x) { return x.id !== replaceTarget; });
        storeTracks(keepTracks);
        replaceTarget = null;
        renderTrackList();
      }
      if (trackNameEl) trackNameEl.value = "";
      if (trackNoteEl) trackNoteEl.value = "";
      trackStatus("Track saved (line + error polygon downloaded).");
      updateReadout();
      updateTrackUI();
    });
  }

  if (clearTrackBtn) {
    clearTrackBtn.addEventListener("click", function () {
      if (tracking) stopTrack();
      if (activeLine && window.fieldMap) window.fieldMap.removeLayer(activeLine);
      if (errPoly && window.fieldMap) { window.fieldMap.removeLayer(errPoly); errPoly = null; }
      activeLine = null;
      committed = [];
      live = null;
      walkAgainTarget = null;   // cancel any pending "walk again" average
      replaceTarget = null;
      trackStatus("Track cleared.");
      updateReadout();
      updateTrackUI();
    });
  }

  if (trackMgrToggle && trackMgrBody) {
    trackMgrToggle.addEventListener("click", function () {
      var open = trackMgrBody.hasAttribute("hidden");
      if (open) trackMgrBody.removeAttribute("hidden");
      else trackMgrBody.setAttribute("hidden", "");
      trackMgrToggle.setAttribute("aria-expanded", open ? "true" : "false");
      trackMgrToggle.classList.toggle("is-open", open);
    });
  }

  // Draw any saved tracks marked visible once the map is ready.

  whenMapReady(function () {
    loadTracks().forEach(function (t) { if (t.visible) drawSavedTrack(t); });
  });
  renderTrackList();
  updateReadout();
  updateTrackUI();

  // ---- Concealment photos ------------------------------------------------

  // Nest-concealment photos at ~1 m, free-form cardinal directions. The bearing
  // is grabbed from the app compass the instant Capture is tapped (iOS+Android),
  // then the native camera opens; the returned photo opens in a canvas editor to
  // circle the nest in yellow. Two files go to Drive: the untouched original
  // (full quality) and a JSON whose photo is the circled image as a reduced WebP
  // (JPEG fallback where the canvas can't encode WebP, e.g. iOS).

  (function () {
    var nestBtn = document.getElementById("concealNestBtn");
    var bearingEl = document.getElementById("concealBearing");
    var captureBtn = document.getElementById("concealCaptureBtn");
    var camera = document.getElementById("concealCamera");
    var statusEl = document.getElementById("concealStatus");
    var editor = document.getElementById("concealEditor");
    var canvas = document.getElementById("concealCanvas");
    var undoBtn = document.getElementById("concealUndoBtn");
    var clearBtn = document.getElementById("concealClearBtn");
    var saveBtn = document.getElementById("concealSaveBtn");
    var discardBtn = document.getElementById("concealDiscardBtn");
    var listEl = document.getElementById("concealList");
    if (!captureBtn || !camera || !canvas) return;

    var selectedNest = null;
    var capturedBearing = null;
    var originalFile = null;
    var img = null;
    var strokes = [];
    var drawing = false;
    var ctx = canvas.getContext("2d");

    function status(m) { if (statusEl) statusEl.textContent = m || ""; }

    function distM(a, b, c, d) {
      var m = (a + c) / 2 * Math.PI / 180;
      var dy = (c - a) * 110540, dx = (d - b) * 111320 * Math.cos(m);
      return Math.sqrt(dx * dx + dy * dy);
    }

    function nestsWithin(meters) {
      var here = window.fieldLatLng;
      var pts = window.fieldNavPoints || [];
      if (!here) return null;
      return pts.filter(function (p) { return p.type === "Nest"; })
        .map(function (p) { return { p: p, d: distM(here.lat, here.lng, p.lat, p.lng) }; })
        .filter(function (x) { return x.d <= meters; })
        .sort(function (x, y) { return x.d - y.d; });
    }

    function openNestPicker() {
      var within = nestsWithin(25);
      var overlay = document.createElement("div");
      overlay.className = "field-patch-overlay";
      var inner = document.createElement("div");
      inner.className = "field-patch-overlay-inner";
      var title = document.createElement("div");
      title.className = "field-patch-overlay-title";
      title.textContent = (within === null) ? "Waiting for GPS…"
        : (!within.length) ? "No nests within 25 m" : "Nests within 25 m";
      inner.appendChild(title);
      (within || []).forEach(function (x) {
        var row = document.createElement("button");
        row.type = "button";
        row.className = "field-patch-overlay-row";
        row.textContent = x.p.name + "  (" + Math.round(x.d) + " m)";
        row.addEventListener("click", function () {
          selectedNest = x.p;
          if (nestBtn) nestBtn.textContent = x.p.name;
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          status("");
        });
        inner.appendChild(row);
      });
      overlay.appendChild(inner);
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      });
      document.body.appendChild(overlay);
    }
    if (nestBtn) nestBtn.addEventListener("click", openNestPicker);

    setInterval(function () {
      if (!bearingEl) return;
      bearingEl.textContent = (typeof window.fieldBearing === "number")
        ? "Bearing: " + window.fieldBearing + "°" : "Bearing: --";
    }, 250);

    captureBtn.addEventListener("click", function () {
      if (!selectedNest) { status("Choose a nest first."); return; }
      capturedBearing = (typeof window.fieldBearing === "number") ? window.fieldBearing : null;
      camera.value = "";
      camera.click();
    });

    function redraw() {
      if (!img) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#ffeb00";
      ctx.lineWidth = Math.max(3, canvas.width / 180);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      strokes.forEach(function (s) {
        if (s.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(s[0].x, s[0].y);
        for (var i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
        ctx.stroke();
      });
    }

    camera.addEventListener("change", function () {
      var f = camera.files && camera.files[0];
      if (!f) return;
      originalFile = f;
      var url = URL.createObjectURL(f);
      img = new Image();
      img.onload = function () {
        var scale = Math.min(1, 1024 / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        strokes = [];
        redraw();
        URL.revokeObjectURL(url);
        if (editor) editor.hidden = false;
        status("Circle the nest, then Save.");
      };
      img.onerror = function () { URL.revokeObjectURL(url); status("Couldn't read that photo."); };
      img.src = url;
    });

    function canvasXY(e) {
      var r = canvas.getBoundingClientRect();
      var t = (e.touches && e.touches[0]) || e;
      return { x: (t.clientX - r.left) * (canvas.width / r.width),
               y: (t.clientY - r.top) * (canvas.height / r.height) };
    }
    function startStroke(e) { drawing = true; strokes.push([canvasXY(e)]); e.preventDefault(); }
    function moveStroke(e) { if (!drawing) return; strokes[strokes.length - 1].push(canvasXY(e)); redraw(); e.preventDefault(); }
    function endStroke() { drawing = false; }
    canvas.addEventListener("mousedown", startStroke);
    canvas.addEventListener("mousemove", moveStroke);
    window.addEventListener("mouseup", endStroke);
    canvas.addEventListener("touchstart", startStroke, { passive: false });
    canvas.addEventListener("touchmove", moveStroke, { passive: false });
    canvas.addEventListener("touchend", endStroke);

    if (undoBtn) undoBtn.addEventListener("click", function () { strokes.pop(); redraw(); });
    if (clearBtn) clearBtn.addEventListener("click", function () { strokes = []; redraw(); });
    if (discardBtn) discardBtn.addEventListener("click", function () {
      if (editor) editor.hidden = true; originalFile = null; img = null; strokes = []; status("");
    });

    function ts() { return new Date().toISOString().replace(/[:.]/g, "-"); }
    function ext(f) {
      var n = (f && f.name) || "";
      var m = n.match(/\.([A-Za-z0-9]+)$/);
      if (m) return m[1].toLowerCase();
      var t = (f && f.type) || "";
      if (t.indexOf("heic") >= 0) return "heic";
      if (t.indexOf("png") >= 0) return "png";
      return "jpg";
    }

    function uploadRaw(target, filename, kind, data, onDone) {
      if (!WP_SYNC.relayUrl || WP_SYNC.relayUrl.indexOf("PASTE") === 0) { status("Drive sync not set up."); return; }
      if (!navigator.onLine) { status("No signal -- try again when online."); return; }
      fetch(WP_SYNC.relayUrl, {
        method: "POST", mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ secret: WP_SYNC.secret, study: WP_SYNC.study,
          target: target, filename: filename, kind: kind, data: data })
      }).then(function () { if (onDone) onDone(); }).catch(function () { status("Upload failed."); });
    }

    if (saveBtn) saveBtn.addEventListener("click", function () {
      if (!selectedNest || !originalFile) { status("Nothing to save."); return; }
      var brg = (capturedBearing != null) ? Math.round(capturedBearing) : "NA";
      var base = selectedNest.name + "_" + ts() + "_" + brg;
      status("Saving…");

      var fr = new FileReader();
      fr.onload = function () {
        var b64 = String(fr.result).split(",")[1] || "";
        uploadRaw("concealment_photos", base + "." + ext(originalFile), "image", b64);
      };
      fr.readAsDataURL(originalFile);

      var ref = canvas.toDataURL("image/webp", 0.9);
      if (ref.indexOf("image/webp") < 0) ref = canvas.toDataURL("image/jpeg", 0.85);
      var meta = JSON.stringify({
        nest_id: selectedNest.name,
        datetime: new Date().toISOString(),
        bearing: (capturedBearing != null) ? Math.round(capturedBearing) : null,
        photo: ref
      });
      uploadRaw("concealment_meta", base + ".json", "json", meta, function () {
        showUploadModal(selectedNest.name + " photo uploaded.");
      });

      if (listEl) {
        var li = document.createElement("li");
        li.className = "field-mgr-item conceal-list-item";
        var im = document.createElement("img");
        im.src = ref; im.className = "field-photo-thumb";
        var sp = document.createElement("span");
        sp.className = "field-mgr-name";
        sp.textContent = selectedNest.name + " · " + brg + "°";
        li.appendChild(im); li.appendChild(sp);
        listEl.insertBefore(li, listEl.firstChild);
      }

      if (editor) editor.hidden = true;
      originalFile = null; img = null; strokes = [];
      status("");
    });
  })();

}

// Run after the DOM exists. embed-resources can relocate this inline script,
// so don't assume it runs at end-of-body -- wait for DOMContentLoaded if the
// document is still parsing.

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
})();
