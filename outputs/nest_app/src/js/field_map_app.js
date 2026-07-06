
  var overlay = document.getElementById("fieldMenuOverlay");
  var menuBtn = document.getElementById("fieldMenuBtn");          // map view: open menu
  var mainMenuBtn = document.getElementById("fieldMainMenuBtn");  // sub-screen: go to main
  var mapBtn = document.getElementById("fieldMapBtn");            // menu open: back to map
  var niBarBack = document.getElementById("niBarBack");           // nest info: to Nests
  var niBarMain = document.getElementById("niBarMain");           // nest info: to main
  var niBarMap = document.getElementById("niBarMap");             // nest info: zoom map
  var accEl = document.getElementById("barAccuracy");
  var brgEl = document.getElementById("barBearing");
  if (!menuBtn || !overlay) return;

  // Nest id stashed by window.fieldOpenNestModify for the Modify sub-menu.

  var modifyNestId = null;

  // Desktop sidebar: a persistent "back to the menu" control at the top of the
  // sidebar. The bottom-bar buttons are hidden when the menu is a permanent
  // sidebar, so this is the way back to the main menu (table of contents). It
  // is shown only on wide screens and only on a sub-screen (updateBar clears
  // field-hide); base CSS keeps it hidden on phones.

  var sidebarBackBtn = document.createElement("button");
  sidebarBackBtn.type = "button";
  sidebarBackBtn.className = "field-sidebar-back field-hide";
  sidebarBackBtn.textContent = "‹ Menu";
  overlay.insertBefore(sidebarBackBtn, overlay.firstChild);
  sidebarBackBtn.addEventListener("click", function () { showScreen("main"); });

  // Portrait only. Best-effort lock where the browser supports it (Android
  // Chrome / installed PWAs); iOS Safari ignores this, so the CSS rotate-notice
  // overlay is the real guard.

  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock("portrait").catch(function () {});
    }
  } catch (e) {}


  function hideEl(el, h) { if (el) el.classList.toggle("field-hide", !!h); }

  // The bar's contents depend on context:
  //   map view (menu closed) -> Menu + Accuracy + Bearing
  //   main menu screen       -> Map only
  //   sub-screen             -> Main Menu + Map


  // Screen navigation: the overlay holds several .field-screen panels; only
  // the one matching `name` is shown.


  var isWide = window.matchMedia("(min-width: 900px)").matches;


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
          suggestNestId();
        }
        if (b.dataset.screen === "nests" && typeof injectLocalNests === "function") {
          injectLocalNests();
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

    // Test patches (home testing) sit after the real patches, and only when the
    // "Subset to today's data" switch is off.

    if (!today) {
      [
        { value: "test_snedgen_park", label: "Test: Snedgen Park" },
        { value: "test_long_branch", label: "Test: Long branch" }
      ].forEach(function (t) {
        var o = document.createElement("option");
        o.value = t.value;
        o.textContent = t.label;
        patchSelect.appendChild(o);
      });
    }
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
  // Nest naming is location-aware: within 10 km of a test site the nest takes
  // that site's prefix and its own 001-999 series; elsewhere it's a plain "N"
  // field nest. Keeps numbering behaviour identical at home and in the field.

  var NEST_SITES = [
    { prefix: "NSP", lat: 38.799230, lng: -77.632596 },
    { prefix: "NLB", lat: 38.995412, lng: -76.999844 }
  ];
  var NEST_SITE_RADIUS = 10000;

  function currentNestPrefix() {
    var ll = window.fieldLatLng;
    if (ll) {
      for (var i = 0; i < NEST_SITES.length; i++) {
        if (metersBetween(ll.lat, ll.lng, NEST_SITES[i].lat, NEST_SITES[i].lng) <= NEST_SITE_RADIUS) {
          return NEST_SITES[i].prefix;
        }
      }
    }
    return "N";
  }
  function currentPrefix() {
    if (wpClass && wpClass.value === "Nest") return currentNestPrefix();
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

  // Note + Photo now live on the nest-discovery form for nests, so hide them on
  // the Add-waypoint screen when the class is Nest (the default). Clear their
  // values when hidden so nothing leaks into the saved waypoint.

  function syncNotedPhotoFields() {
    var isNest = !!(wpClass && wpClass.value === "Nest");
    var noteField = document.getElementById("wpNoteField");
    var photoField = document.getElementById("wpPhotoField");
    if (noteField) noteField.style.display = isNest ? "none" : "";
    if (photoField) photoField.style.display = isNest ? "none" : "";
    if (isNest) {
      if (wpNote) wpNote.value = "";
      if (wpPhoto) wpPhoto.value = "";
      if (wpPhotoPreview) wpPhotoPreview.innerHTML = "";
      currentPhoto = null;
    }
  }
  if (wpClass) wpClass.addEventListener("change", syncNotedPhotoFields);

  // Auto-suggest the next nest ID when Nest is chosen; clear a stale suggestion
  // if the class changes away from Nest, and drop the autofill flag once the
  // user edits the field so a late live response can't overwrite their entry.

  if (wpClass) {
    wpClass.addEventListener("change", function () {
      if (wpClass.value === "Nest") {
        suggestNestId();
      } else if (wpName && wpName.dataset.autofill === "1") {
        wpName.value = "";
        wpName.dataset.autofill = "";
      }
    });
  }
  if (wpName) {
    wpName.addEventListener("input", function () { wpName.dataset.autofill = ""; });
  }
  var wpPhotoPreview = document.getElementById("wpPhotoPreview");
  var wpColorRow = document.getElementById("wpColorRow");
  var addSaveBtn = document.getElementById("addWaypointSaveBtn");
  var addStatusEl = document.getElementById("addWaypointStatus");
  var currentPhoto = null;
  var currentColor = WP_DEFAULT_COLOR;
  var newNestId = null;
  // true when the Add-waypoint screen is attaching a GPS point to a nest that
  // already exists (already discovered) rather than creating a brand-new nest.
  var newNestExisting = false;

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

    // Keep the location-derived nest prefix + suggested number in step with the
    // live position while the Add-nest form is open and untouched.

    if (!newNestId && !editWp && wpName && wpName.dataset.autofill === "1" &&
        wpClass && wpClass.value === "Nest") {
      var pfx = currentNestPrefix();
      if (wpNamePrefix && wpNamePrefix.textContent !== pfx) {
        wpNamePrefix.textContent = pfx;
        wpName.value = padNest(nextNestNumber(pfx, null));
      }
    }
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


  // --- next-nest-ID suggestion (collision failsafe) ----------------------

  function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // Numbers already used within one prefix's namespace ("N" for field nests,
  // "NSP" / "NLB" for the test sites) -- from the baked-in
  // map data, this device's saved nests, and any live IDs from the relay.

  function usedNestNumbers(prefix, liveIds) {
    var rx = new RegExp("^" + escapeRegex(prefix) + "(\\d+)$");
    var set = {};
    function add(name) {
      var m = rx.exec(String(name == null ? "" : name));
      if (m) { var n = parseInt(m[1], 10); if (n > 0 && n <= 999) set[n] = true; }
    }
    (window.fieldNavPoints || []).forEach(function (p) { if (p.type === "Nest") add(p.name); });
    (window.fieldNestIds || []).forEach(add);   // all baked nests, incl. no-GPS
    loadWaypoints().forEach(function (w) { if (w.point_class === "Nest") add(w.point_name); });
    (liveIds || []).forEach(add);
    return set;
  }

  // Lowest unused number in the namespace: first gap in 1..max, else max+1.

  function nextNestNumber(prefix, liveIds) {
    var set = usedNestNumbers(prefix, liveIds);
    var max = 0;
    Object.keys(set).forEach(function (k) { var n = +k; if (n > max) max = n; });
    var n = 1;
    while (n <= max && set[n]) n++;
    return n;
  }

  function padNest(n) { return String(n).padStart(3, "0"); }

  // True when `name` already belongs to a GPS point somewhere the app knows
  // about: a baked map point with coordinates, a cached waypoint with a
  // location, or a live nest whose coordinates came back from the relay. Used to
  // block naming a brand-new nest the same as an existing GPS point.
  function nestNameHasGpsPoint(name) {
    name = String(name || "");
    if (!name) return false;
    var pts = window.fieldNavPoints || [];
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].name === name && pts[i].lat != null && pts[i].lng != null &&
          !isNaN(pts[i].lat) && !isNaN(pts[i].lng)) return true;
    }
    var mpts = window.fieldMapPoints || [];
    for (var m = 0; m < mpts.length; m++) {
      if (mpts[m].name === name && mpts[m].lat != null && mpts[m].lng != null &&
          !isNaN(mpts[m].lat) && !isNaN(mpts[m].lng)) return true;
    }
    var arr = loadWaypoints();
    for (var j = 0; j < arr.length; j++) {
      if (arr[j].point_name === name && arr[j].latitude != null &&
          arr[j].longitude != null) return true;
    }
    var c = liveNestCoords[name];
    if (c && c.lat != null && c.lng != null) return true;
    return false;
  }

  // Read the live nest-ID list from the relay via JSONP -- a plain fetch can't
  // read the no-cors relay. cb(ids) with an array, or cb(null) when offline,
  // unconfigured, or timed out.

  function fetchLiveNestIds(cb) {
    if (!navigator.onLine || !WP_SYNC.relayUrl || WP_SYNC.relayUrl.indexOf("PASTE") === 0) {
      cb(null, null);
      return;
    }
    var name = "__nestIds_" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    var s = document.createElement("script");
    var settled = false;
    function settle(ids, nests) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (s.parentNode) s.parentNode.removeChild(s);
      cb(ids, nests);
    }
    // The relay reads each file, so it can be slow. Don't delete the callback on
    // timeout -- a late JSONP response must still find it or it throws a
    // ReferenceError. The callback removes itself once it actually fires.
    var timer = setTimeout(function () { settle(null, null); }, 10000);
    window[name] = function (data) {
      settle((data && data.nest_ids) || [], (data && data.nests) || []);
      try { delete window[name]; } catch (e) { window[name] = function () {}; }
    };
    s.onerror = function () { settle(null, null); };
    s.src = WP_SYNC.relayUrl + "?action=nest_ids&secret=" +
      encodeURIComponent(WP_SYNC.secret) + "&callback=" + name;
    (document.body || document.documentElement).appendChild(s);
  }

  // Pre-fill the name field with the suggested next nest number, but only for a
  // fresh new-nest entry (not the measure-existing or Modify flows). Fills the
  // offline best guess immediately, then upgrades from the live list unless the
  // user has started editing.

  function suggestNestId() {
    if (newNestId || editWp || !wpName || !wpClass || wpClass.value !== "Nest") return;
    syncNamePrefix();
    var prefix = currentPrefix();
    wpName.value = padNest(nextNestNumber(prefix, null));
    wpName.dataset.autofill = "1";
    fetchLiveNestIds(function (liveIds) {
      if (wpName.dataset.autofill !== "1") return;
      var pfx = currentPrefix();
      syncNamePrefix();
      if (liveIds == null) {
        addStatus("Suggested " + pfx + wpName.value + " (offline -- couldn't check the live list).");
        return;
      }
      wpName.value = padNest(nextNestNumber(pfx, liveIds));
      addStatus("Suggested " + pfx + wpName.value + " from the live nest list.");
    });
  }


  // Open the Add-waypoint screen to re-measure an existing waypoint. mode is
  // "replace" (new average overwrites the location) or "average" (new average
  // is combined with the stored one). The form is pre-filled from the waypoint.

  // ---- unified Modify flow (own waypoints + official map points) ---------

  // editWp, when set, means the Add screen is editing an existing point:
  //   { id, source: "waypoint"|"nav", point: <record>, mode: "keep"|"replace"|"average" }
  // mode "keep" leaves the location untouched (edit note/name/photo only).

  var modifyControls = null;






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
      newNestExisting = false;
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


  if (addSaveBtn) addSaveBtn.addEventListener("click", saveAveraged);

  // Cancel: discard the in-progress form and return to the main menu.

  var addCancelBtn = document.getElementById("addWaypointCancelBtn");
  if (addCancelBtn) addCancelBtn.addEventListener("click", function () {
    resetAddForm();
    addStatus("");
    // Leaving the screen stops averaging via syncAveraging

    showScreen("main");
  });

  // nest discovery data ---------------------------------------------------
  // UI-only capture of a "nest_level" record. No backend yet: Save assembles
  // the record, logs it, and confirms. Opened from the post-save prompt.

  // Bird species: [common name, 4-letter code]. The picker displays the common
  // name only (Tara's request) but the 4-letter code is what's written to the
  // sheet. Ordered alphabetically by common name; Unknown / Artificial nest /
  // Other are added around this list by buildNestChoices.

  var NEST_SPECIES = [
    ["American goldfinch", "AGOL"], ["Common yellowthroat", "COYE"],
    ["Field sparrow", "FISP"], ["Gray catbird", "GRCA"],
    ["Indigo bunting", "INBU"], ["Northern cardinal", "NOCA"],
    ["Prairie warbler", "PRAW"], ["Song sparrow", "SOSP"],
    ["White-eyed vireo", "WEVI"], ["Yellow-breasted chat", "YBCH"]
  ];

  // Plant/substrate species, alphabetical. Unknown first and Other last are
  // added by buildNestChoices.

  var NEST_SUBSTRATES = [
    "Amur honeysuckle", "Asian bittersweet", "Autumn Olive", "Bamboo",
    "Black raspberry", "Blackberry", "Catbriar", "Coral berry", "Grape",
    "Japanese honeysuckle", "Multiflora rose", "Wineberry"
  ];

  var nestDataCtx = null;
  var nestPhoto = null;
  var nestPhotoName = null;



  // Large, near-full-screen option picker (reuses the patch-overlay styling).
  // Single-select applies + closes on tap; multi-select toggles rows and
  // applies on Done. The hidden <select> stays the source of truth.










  // Send one nest_level row to the Apps Script relay, which appends it to the
  // nest_level sheet. Fire-and-forget over no-cors, mirroring uploadToDrive.



  var ndCameraSel = ndEl("ndCameraOrControl");
  if (ndCameraSel) {
    ndCameraSel.addEventListener("change", function () {
      var wrap = ndEl("ndCameraDateWrap");
      if (wrap) wrap.style.display = (ndCameraSel.value === "Camera") ? "" : "none";
    });
  }

  var ndPhoto = ndEl("ndPhoto");
  if (ndPhoto) {
    ndPhoto.addEventListener("change", function () {
      var file = ndPhoto.files && ndPhoto.files[0];
      var preview = ndEl("ndPhotoPreview");
      if (preview) preview.innerHTML = "";
      var status = ndEl("nestDataStatus");
      if (!file) { nestPhoto = null; nestPhotoName = null; return; }
      if (status) status.textContent = "Processing photo...";
      compressImage(file, 1024, 0.55, function (dataUrl) {
        nestPhoto = dataUrl;
        if (dataUrl && preview) {
          var im = document.createElement("img");
          im.src = dataUrl;
          im.className = "field-photo-thumb";
          preview.appendChild(im);
        }
        if (status) status.textContent = dataUrl ? "Photo attached." : "Couldn't read that photo.";
      });
    });
  }

  buildNestChoices();
  wireNestPicker("ndPatchBtn", "ndPatchId", "Choose a patch", "Patch", false, null);
  wireNestPicker("ndSpeciesBtn", "ndSpecies", "Choose species", "Choose species", false, syncNestOther);
  wireNestPicker("ndDiscoveryStageBtn", "ndDiscoveryStage", "Discovery stage", "— select —", false, null);
  wireNestPicker("ndCameraOrControlBtn", "ndCameraOrControl", "Camera or control", "Control", false, null);
  wireNestPicker("ndSubstrateBtn", "ndSubstrate", "Substrate", "Choose substrate", true, syncNestOther);

  var ndSaveBtn = ndEl("nestDataSaveBtn");
  if (ndSaveBtn) ndSaveBtn.addEventListener("click", saveNestData);

  var ndCancelBtn = ndEl("nestDataCancelBtn");
  if (ndCancelBtn) ndCancelBtn.addEventListener("click", function () { closeMenu(); });

  var intervalCtx = null;









  var ivStateRadios = overlay.querySelectorAll('input[name="ivCurrentState"]');
  for (var iv = 0; iv < ivStateRadios.length; iv++) {
    ivStateRadios[iv].addEventListener("change", applyIntervalState);
  }

  var ivAdultSel = ivEl("ivAdultPresent");
  if (ivAdultSel) ivAdultSel.addEventListener("change", applyIntervalAdult);

  var ivSaveBtn = ivEl("intervalSaveBtn");
  if (ivSaveBtn) ivSaveBtn.addEventListener("click", saveIntervalData);

  var ivCancelBtn = ivEl("intervalCancelBtn");
  if (ivCancelBtn) ivCancelBtn.addEventListener("click", function () { closeMenu(); });

  // Post-save "Add nest discovery data?" prompt (Yes/No), built on first use.


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
  // actions, Navigate and View. Used for both own waypoints and map points.

  function makePointLi(nameText, color, showState, onNav, onView, actionLabel) {
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
    var view = document.createElement("button");
    view.type = "button"; view.className = "field-button";
    view.textContent = actionLabel || "View";
    view.addEventListener("click", onView);
    acts.appendChild(nav);
    acts.appendChild(view);
    row.appendChild(acts);
    li.appendChild(row);
    return li;
  }

  function renderWaypoints() {
    if (!listEl) return;
    var arr = loadWaypoints().filter(function (w) {
      if (w.uploaded) return false;   // already on Drive
      if (isPending(w)) return true;  // not on Drive yet -- always show so it can be uploaded
      return !w.cleared;              // Temp points drop out once cleared
    });
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
        function () { startModify(w, "waypoint"); },
        "Modify"
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

  // Manager nest ordering: N### then NQ### then NSP### then NLB###; within each
  // group by number. Non-nest names fall last, alphabetically.
  function nestSortKey(name) {
    name = String(name || "");
    var rules = [[/^NSP(\d+)/, 2], [/^NLB(\d+)/, 3], [/^NQ(\d+)/, 1], [/^N(\d+)/, 0]];
    for (var i = 0; i < rules.length; i++) {
      var m = rules[i][0].exec(name);
      if (m) return { g: rules[i][1], n: parseInt(m[1], 10), s: "" };
    }
    return { g: 4, n: 0, s: name.toLowerCase() };
  }
  function nestCompare(a, b) {
    var ka = nestSortKey(a), kb = nestSortKey(b);
    if (ka.g !== kb.g) return ka.g - kb.g;          // groups stay N, NQ, NSP, NLB
    if (ka.g < 4) return kb.n - ka.n;               // within a group: high -> low
    return ka.s < kb.s ? 1 : (ka.s > kb.s ? -1 : 0);
  }

  // Zoom the map tight (level 19) onto a point and drop back to the map view.
  function zoomToPoint(lat, lng) {
    if (lat == null || lng == null) return;
    if (window.fieldMap) window.fieldMap.setView([lat, lng], 19);
    closeMenu();
  }

  // ---- Nest info page ---------------------------------------------------

  var niCurrentNest = null;

  function niCoords(nestId) {
    var pts = window.fieldMapPoints || [];
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].name === nestId && pts[i].lat != null && pts[i].lng != null &&
          !isNaN(pts[i].lat) && !isNaN(pts[i].lng)) {
        return { lat: pts[i].lat, lng: pts[i].lng };
      }
    }
    var arr = loadWaypoints();
    for (var j = 0; j < arr.length; j++) {
      if (arr[j].point_name === nestId && arr[j].latitude != null) {
        return { lat: arr[j].latitude, lng: arr[j].longitude };
      }
    }
    return null;
  }

  function niMapPoint(nestId) {
    var pts = window.fieldMapPoints || [];
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].name === nestId) return pts[i];
    }
    return null;
  }

  // Photo for a nest: prefer a fresh cached (app-created) one, else the photo
  // baked from its GeoJSON into window.fieldNavPoints.
  function niFindPhoto(nestId) {
    var arr = loadWaypoints();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].point_name === nestId && arr[i].photo) return arr[i].photo;
    }
    var nav = window.fieldNavPoints || [];
    for (var j = 0; j < nav.length; j++) {
      if (nav[j].name === nestId && nav[j].photo &&
          String(nav[j].photo).indexOf("data:") === 0) return nav[j].photo;
    }
    return null;
  }

  // Format one interval check per the field convention.
  function niIntervalParts(iv) {
    var he = Number(iv.host_eggs) || 0, hy = Number(iv.host_young) || 0;
    var be = Number(iv.bhco_eggs) || 0, by = Number(iv.bhco_young) || 0;
    var host;
    if (he > 0 && hy > 0) host = he + " Eggs & " + hy + " nestlings";
    else if (he > 0) host = he + " Eggs";
    else if (hy > 0) host = hy + " Nestlings";
    else host = "Empty";
    var sub = null;
    if (be > 0 && by > 0) sub = be + " BHCO eggs & " + by + " BHCO nestlings";
    else if (be > 0) sub = be + " BHCO eggs";
    else if (by > 0) sub = by + " BHCO nestlings";
    return { line: (iv.date || "?") + ": " + host, sub: sub };
  }

  function niBuildMap(nestId) {
    var host = document.getElementById("niMap");
    if (!host) return;
    if (host._nimap) { try { host._nimap.remove(); } catch (e) {} host._nimap = null; }
    host.innerHTML = "";
    var c = niCoords(nestId);
    if (!window.L || !c) { host.style.display = "none"; return; }
    host.style.display = "";
    var map = window.L.map(host, {
      attributionControl: false, zoomControl: false, dragging: false,
      scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false
    });
    // Same basemap as the primary map (Esri World Imagery) with the offline
    // tile cache patched in so it works in the field.
    var layer = window.L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 21, maxNativeZoom: 19 }
    );
    var orig = layer.getTileUrl;
    layer.getTileUrl = function (coords) {
      var t = window.fieldOfflineTiles;
      if (t) { var k = coords.z + "/" + coords.x + "/" + coords.y; if (t[k]) return t[k]; }
      return orig.call(this, coords);
    };
    layer.addTo(map);
    map.setView([c.lat, c.lng], 18);

    // Same marker as the main map: the nest's icon from window.fieldIcons.
    var p = niMapPoint(nestId);
    var ic = (p && window.fieldIcons) ? window.fieldIcons[p.icon_id] : null;
    if (ic) {
      window.L.marker([c.lat, c.lng], {
        icon: window.L.icon({
          iconUrl: ic.iconUrl,
          iconSize: [ic.iconWidth, ic.iconHeight],
          iconAnchor: [ic.iconAnchorX, ic.iconAnchorY]
        })
      }).addTo(map);
    } else {
      window.L.circleMarker([c.lat, c.lng], {
        radius: 7, color: "#136aec", weight: 2, fillColor: "#8ec5ff", fillOpacity: 0.9
      }).addTo(map);
    }

    host._nimap = map;
    setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 250);
  }

  window.fieldOpenNestInfo = function (nestId) {
    ensureMenuOpen();
    niCurrentNest = nestId;
    var info = (window.fieldNestInfo && window.fieldNestInfo[nestId]) || {};

    var t = document.getElementById("niTitle");
    if (t) t.textContent = nestId +
      (info.species && info.species !== "Unknown" ? " — " + info.species : "");

    var ph = document.getElementById("niPhoto");
    if (ph) {
      ph.innerHTML = "";
      var photo = niFindPhoto(nestId);
      if (photo) {
        var im = document.createElement("img");
        im.src = photo; im.className = "nest-info-photo-img";
        ph.appendChild(im); ph.style.display = "";
      } else ph.style.display = "none";
    }

    var s = document.getElementById("niSummary");
    if (s) {
      s.innerHTML = "";
      var addRow = function (label, val) {
        if (val == null || val === "" || val === "Unknown") return;
        var li = document.createElement("li");
        li.innerHTML = "<strong>" + label + ":</strong> " + escapeHtml(String(val));
        s.appendChild(li);
      };
      addRow("Patch", info.patch_id);
      addRow("Plant spp", info.substrate);
      addRow("Height (m)", info.height);
      addRow("Location", info.location_description);
      addRow("Discovered", info.discovery_date);
      addRow("Last check", info.last_check);
      addRow("Status", info.last_status);
    }

    var il = document.getElementById("niIntervals");
    if (il) {
      il.innerHTML = "";
      var ivs = (info.intervals || []).slice().reverse();
      if (!ivs.length) {
        var none = document.createElement("li");
        none.textContent = "No interval checks yet.";
        il.appendChild(none);
      } else {
        ivs.forEach(function (iv) {
          var parts = niIntervalParts(iv);
          var li = document.createElement("li");
          li.appendChild(document.createTextNode(parts.line));
          if (parts.sub) {
            var sub = document.createElement("ul");
            var sli = document.createElement("li");
            sli.textContent = parts.sub;
            sub.appendChild(sli);
            li.appendChild(sub);
          }
          il.appendChild(li);
        });
      }
    }

    niBuildMap(nestId);

    // "Add GPS point" only when the nest has no location yet.
    var gpsBtn = document.getElementById("niAddGpsBtn");
    if (gpsBtn) gpsBtn.style.display = niCoords(nestId) ? "none" : "";

    showScreen("nestinfo");
  };

  var niModifyBtn = document.getElementById("niModifyBtn");
  if (niModifyBtn) niModifyBtn.addEventListener("click", function () {
    if (window.fieldOpenNestModify) window.fieldOpenNestModify(niCurrentNest);
  });
  var niAddIntervalBtn = document.getElementById("niAddIntervalBtn");
  if (niAddIntervalBtn) niAddIntervalBtn.addEventListener("click", function () {
    if (window.fieldAddInterval) window.fieldAddInterval(niCurrentNest);
  });
  var niAddGpsBtn = document.getElementById("niAddGpsBtn");
  if (niAddGpsBtn) niAddGpsBtn.addEventListener("click", function () {
    startNewNestPoint(niCurrentNest);
  });

  if (niBarBack) niBarBack.addEventListener("click", function () { showScreen("nests"); });
  if (niBarMain) niBarMain.addEventListener("click", function () { showScreen("main"); });
  if (niBarMap) niBarMap.addEventListener("click", function () {
    var c = niCoords(niCurrentNest);
    if (c) zoomToPoint(c.lat, c.lng); else closeMenu();
  });
  var niIntervalToggle = document.getElementById("niIntervalToggle");
  if (niIntervalToggle) niIntervalToggle.addEventListener("click", function () {
    var body = document.getElementById("niIntervals");
    if (body) { body.hidden = !body.hidden; niIntervalToggle.classList.toggle("is-open", !body.hidden); }
  });

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

      var isNestType = (type === "Nest");
      list.slice().sort(function (a, b) { return nestCompare(a.name, b.name); }).forEach(function (p) {
        body.appendChild(makePointLi(
          p.name,
          null,
          null,
          function () { startNavigation({ latitude: p.lat, longitude: p.lng, point_name: p.name }); },
          isNestType
            ? function () { window.fieldViewNest(p.name); }
            : function () { zoomToPoint(p.lat, p.lng); },
          "View"
        ));
      });

      li.appendChild(btn);
      li.appendChild(body);
      listEl.appendChild(li);
    });
  }

  // An app-created nest that lives only in the local cache (not yet in the
  // baked-in map data).

  function localNestByName(key) {
    var arr = loadWaypoints();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].point_class === "Nest" && arr[i].point_name === key) return arr[i];
    }
    return null;
  }

  window.fieldModifyNavPoint = function (key) {
    var pts = window.fieldNavPoints || [];
    var p = null;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].point_id === key || pts[i].name === key) { p = pts[i]; break; }
    }
    if (window.fieldMap) window.fieldMap.closePopup();
    if (p) { startModify(navPointToPoint(p), "nav"); return; }
    var w = localNestByName(key);
    if (w) { startModify(w, "waypoint"); return; }
    startNewNestPoint(key);
  };

  window.fieldNavigateNavPoint = function (key) {
    var pts = window.fieldNavPoints || [];
    var p = null;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].point_id === key || pts[i].name === key) { p = pts[i]; break; }
    }
    if (window.fieldMap) window.fieldMap.closePopup();
    if (p) { startNavigation({ latitude: p.lat, longitude: p.lng, point_name: p.name }); return; }
    var w = localNestByName(key);
    if (w) { startNavigation(w); return; }
    var c = liveNestCoords[key];
    if (c && c.lat != null && c.lng != null) {
      startNavigation({ latitude: c.lat, longitude: c.lng, point_name: key });
      return;
    }
    window.alert("No saved location for " + key + " yet -- use Modify to add one.");
  };

  // Open a nest's accordion (and its parent patch accordion when the grouped
  // view is active) using the same class/display toggles accordion.js uses.



  // View a nest: show the Nests page, open that nest's accordion (opening its
  // parent patch accordion first when grouped), reveal its detail block, and
  // scroll it into view. Resilient when the nest can't be found.


  // Open the Modify sub-menu for a nest: stash the id and show the screen. The
  // screen fills the shown id from modifyNestId when it opens.


  // Modify sub-menu Cancel returns to the Nests page. The four action buttons
  // are inert for now (wired in a later task).

  var nmCancelBtn = document.getElementById("nmCancelBtn");
  if (nmCancelBtn) nmCancelBtn.addEventListener("click", function () {
    showScreen("nests");
  });

  // The four Modify sub-menu actions.

  var nmAddInt = document.getElementById("nmAddInterval");
  if (nmAddInt) nmAddInt.addEventListener("click", function () {
    openIntervalData({ nestId: modifyNestId, mode: "add" });
  });
  var nmModInt = document.getElementById("nmModifyInterval");
  if (nmModInt) nmModInt.addEventListener("click", function () {
    modifyIntervalPick(modifyNestId);
  });
  var nmModDisc = document.getElementById("nmModifyDiscovery");
  if (nmModDisc) nmModDisc.addEventListener("click", function () {
    modifyDiscovery(modifyNestId);
  });
  var nmModWp = document.getElementById("nmModifyWaypoint");
  if (nmModWp) nmModWp.addEventListener("click", function () {
    if (window.fieldModifyNavPoint) window.fieldModifyNavPoint(modifyNestId);
  });
  var nmMakeArt = document.getElementById("nmMakeArtificial");
  if (nmMakeArt) nmMakeArt.addEventListener("click", function () {
    if (!modifyNestId) return;
    if (!window.confirm("Reassign " + modifyNestId +
        " as an artificial nest? This adds a discovery row (Artificial nest) " +
        "and a first interval check with 2 host eggs.")) return;
    makeArtificialNest(modifyNestId);
  });

  // Delete buttons on the discovery + interval forms (edit mode only).

  var ndDeleteBtn = document.getElementById("ndDeleteBtn");
  if (ndDeleteBtn) ndDeleteBtn.addEventListener("click", function () {
    if (!nestDataCtx || nestDataCtx.mode !== "edit") return;
    if (!window.confirm("Delete this nest's discovery row from the sheet?")) return;
    var st = document.getElementById("nestDataStatus");
    if (st) st.textContent = "Deleting…";
    deleteSheetRow("nest_level", nestDataCtx.sheetRow,
      function () { showUploadModal("Nest data deleted."); closeMenu(); },
      function (msg) { if (st) st.textContent = msg; });
  });

  var intervalDeleteBtn = document.getElementById("intervalDeleteBtn");
  if (intervalDeleteBtn) intervalDeleteBtn.addEventListener("click", function () {
    if (!intervalCtx || intervalCtx.mode !== "edit") return;
    if (!window.confirm("Delete this interval check from the sheet?")) return;
    var st = document.getElementById("intervalStatus");
    if (st) st.textContent = "Deleting…";
    deleteSheetRow("interval_level", intervalCtx.sheetRow,
      function () { showUploadModal("Interval check deleted."); closeMenu(); },
      function (msg) { if (st) st.textContent = msg; });
  });

  // Test nests created in the app go straight to Drive; the (server-rendered)
  // Nests page won't include them until the pipeline ingests them. Inject them
  // into their test-patch group client-side from the live Drive list (with
  // coords, so Navigate works on any device), merged with this device's cache.

  var liveNestCoords = {};   // nest_id -> { lat, lng } from the relay

  function testPatchForName(nm) {
    if (/^NSP\d+$/.test(nm)) return "test_snedgen_park";
    if (/^NLB\d+$/.test(nm)) return "test_long_branch";
    return null;
  }

  function injectLocalNests() {
    var merged = {};   // name -> { name, lat, lng, time }
    loadWaypoints().forEach(function (w) {
      if (w.point_class === "Nest" && testPatchForName(w.point_name)) {
        merged[w.point_name] =
          { name: w.point_name, lat: w.latitude, lng: w.longitude, time: w.time };
      }
    });
    renderTestNests(merged);   // show whatever the cache has right away

    fetchLiveNestIds(function (liveIds, liveNests) {
      if (!liveNests) return;   // offline / unavailable -- keep the cache view
      liveNests.forEach(function (n) {
        if (!testPatchForName(n.id)) return;
        if (n.lat != null && n.lng != null) liveNestCoords[n.id] = { lat: n.lat, lng: n.lng };
        if (!merged[n.id]) merged[n.id] = { name: n.id, lat: n.lat, lng: n.lng, time: null };
      });
      renderTestNests(merged);
    });
  }

  function renderTestNests(merged) {
    var byPatch = { test_snedgen_park: [], test_long_branch: [] };
    Object.keys(merged).forEach(function (name) {
      var patch = testPatchForName(name);
      if (patch) byPatch[patch].push(merged[name]);
    });
    Object.keys(byPatch).forEach(function (patch) {
      var head = document.querySelector('.patch-accordion[data-patch="' + patch + '"]');
      var panel = head && head.nextElementSibling;
      var group = panel && panel.querySelector('.nest-accordion-group');
      if (!group) return;

      // Drop any earlier injection, then note which nests are already rendered.
      Array.prototype.forEach.call(
        group.querySelectorAll('[data-local-nest]'),
        function (el) { el.parentNode.removeChild(el); }
      );
      var existing = {};
      Array.prototype.forEach.call(
        group.querySelectorAll(':scope > .accordion'),
        function (a) {
          var st = a.querySelector('strong');
          if (st) existing[st.textContent.replace(/\.\s*$/, "")] = true;
        }
      );

      byPatch[patch]
        .filter(function (n) { return !existing[n.name]; })
        .sort(function (a, b) { return a.name < b.name ? -1 : 1; })
        .forEach(function (n) { appendLocalNest(group, n); });

      var total = group.querySelectorAll(':scope > .accordion').length;
      var cc = head.querySelector('.patch-count-current');
      var ca = head.querySelector('.patch-count-all');
      if (cc) cc.textContent = total;
      if (ca) ca.textContent = total;
    });
  }

  function appendLocalNest(group, n) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "accordion";
    btn.setAttribute("data-current", "true");
    btn.setAttribute("data-local-nest", n.name);
    btn.innerHTML = "<strong>" + escapeHtml(n.name) + ".</strong> Created in app";

    var panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("data-current", "true");
    panel.setAttribute("data-local-nest", n.name);
    panel.style.display = "none";
    panel.innerHTML =
      "<ul><li><strong>Status</strong>: created in app — awaiting field data</li>" +
      "<li><strong>Recorded</strong>: " + escapeHtml(n.time || "—") + "</li></ul>" +
      '<button type="button" class="field-popup-btn" onclick="window.fieldNavigateNavPoint(\'' +
        escapeHtml(n.name) + '\')">Navigate to</button>' +
      '<button type="button" class="field-popup-btn" onclick="window.fieldOpenNestModify(\'' +
        escapeHtml(n.name) + '\')">Modify</button>';

    group.appendChild(btn);
    group.appendChild(panel);

    btn.addEventListener("click", function () {
      this.classList.toggle("active");
      var pnl = this.nextElementSibling;
      if (!pnl || !pnl.classList.contains("panel")) return;
      pnl.style.display = (pnl.style.display === "block") ? "none" : "block";
    });
  }

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
      if (window.confirm("Clear cached waypoints? (Points still waiting to reach Drive are kept so they can upload when you reconnect.)")) {
        // Remove every cached waypoint's marker from the map. Still-pending
        // points stay in the cache + the manager (off the map) so they can still
        // upload.
        arr.forEach(function (w) { removeWaypointMarker(w.point_id); });
        var keep = arr.filter(isPending).map(function (w) { w.visible = false; return w; });
        storeWaypoints(keep);
        renderWaypoints();
        retryPendingUploads();
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

  var ACC_START = 15;  // m: initial accuracy gate (reject fixes worse than this)
  var ACC_FLOOR = 5;   // m: tightest the gate gets as the GPS settles
  var GATE_MULT = 1.8; // gate ~ best-seen accuracy * this (down to ACC_FLOOR)
  var WIN_MS = 3000;   // ms: averaging window (longer = more averaging but lag)
  var SEG_MIN = 1.5;   // m: net movement before a new vertex commits
  var STILL_RMS = 0.75;
  var STILL_ENTER_MS = 3000;
  var STILL_EXIT_MS = 1800;
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

  // Shared handle so showScreen()/closeMenu() (siblings in this IIFE) can drive
  // the concealment live camera without reaching inside its own IIFE.
  var concealCam = null;

  // Start the live camera when the concealment screen is showing, stop it when
  // it isn't. One continuous stream for the whole 4-photo session -- never
  // stopped/restarted between shots, only when leaving the screen.
  function syncConcealCamera() {
    if (!concealCam) return;
    var showing = overlay.classList.contains("is-open") &&
      activeScreen() === "concealment";
    if (showing) concealCam.start();
    else concealCam.stop();
  }

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

    // Live-camera elements (in-app getUserMedia preview).
    var live = document.getElementById("concealLive");
    var video = document.getElementById("concealVideo");
    var shutterBtn = document.getElementById("concealShutterBtn");
    var liveBearingEl = document.getElementById("concealLiveBearing");

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
      var have = (typeof window.fieldBearing === "number");
      if (bearingEl) {
        bearingEl.textContent = have ? "Bearing: " + window.fieldBearing + "°" : "Bearing: --";
      }
      // Same value, overlaid on the live preview so it stays visible while aiming.
      if (liveBearingEl) {
        liveBearingEl.textContent = have ? window.fieldBearing + "°" : "--°";
      }
    }, 250);

    // ---- Live in-app camera (getUserMedia) --------------------------------

    // iOS Safari/WKWebView does NOT expose focus/exposure lock to JS
    // (ImageCapture / applyConstraints focusMode/exposureMode are unsupported),
    // so we don't attempt a hardware AE/AF lock -- it wouldn't work. The win is
    // purely the continuous single stream (no per-shot relaunch) + the compass
    // overlay staying visible.

    var stream = null;
    var starting = false;

    function supportsLive() {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
        window.HTMLCanvasElement && video && live && shutterBtn);
    }

    // Fall back to the native <input capture> camera. Shown when getUserMedia is
    // missing, throws, or permission is denied.
    function useNativeFallback(msg) {
      stopStream();
      if (live) live.hidden = true;
      if (captureBtn) captureBtn.hidden = false;
      if (msg) status(msg);
    }

    function stopStream() {
      if (video) { try { video.pause(); } catch (e) {} video.srcObject = null; }
      if (stream) {
        stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
        stream = null;
      }
    }

    function startStream() {
      if (!supportsLive()) { useNativeFallback("Live camera unavailable -- using device camera."); return; }
      if (stream || starting) return;   // already up / coming up: keep the one session
      starting = true;
      status("Starting camera…");
      var constraints = { audio: false, video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 3840 }, height: { ideal: 2160 } } };
      function attach(s) {
        starting = false;
        stream = s;
        video.srcObject = s;
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
        if (live) live.hidden = false;
        if (captureBtn) captureBtn.hidden = true;
        status("");
      }
      navigator.mediaDevices.getUserMedia(constraints).then(attach).catch(function () {
        // Retry once at a lower resolution before giving up to the native camera.
        navigator.mediaDevices.getUserMedia({ audio: false,
          video: { facingMode: { ideal: "environment" } } }).then(attach).catch(function () {
          starting = false;
          useNativeFallback("Camera blocked -- using device camera. Allow camera access for the live view.");
        });
      });
    }

    // Exposed to showScreen()/closeMenu() via the concealCam handle.
    concealCam = {
      start: function () { startStream(); },
      stop: function () { stopStream(); }
    };
    // Release the camera if the app is backgrounded/hidden.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopStream();
      else if (typeof syncConcealCamera === "function") syncConcealCamera();
    });
    window.addEventListener("pagehide", stopStream);

    // Grab the current live frame -> a JPEG Blob (the "original") + open the
    // circle editor, exactly as the native-photo path does.
    function captureLiveFrame() {
      if (!selectedNest) { status("Choose a nest first."); return; }
      if (!stream || !video.videoWidth) { status("Camera not ready yet."); return; }
      capturedBearing = (typeof window.fieldBearing === "number") ? window.fieldBearing : null;
      var w = video.videoWidth, h = video.videoHeight;
      var grab = document.createElement("canvas");
      grab.width = w; grab.height = h;
      grab.getContext("2d").drawImage(video, 0, 0, w, h);
      // Match the native flow: a full-quality JPEG File used as `originalFile`.
      var complete = function (blob) {
        if (!blob) { status("Couldn't capture frame."); return; }
        blob.name = "conceal_" + ts() + ".jpg";
        loadIntoEditor(blob);
      };
      if (grab.toBlob) grab.toBlob(complete, "image/jpeg", 0.92);
      else complete(dataURLtoBlob(grab.toDataURL("image/jpeg", 0.92)));
    }

    function dataURLtoBlob(u) {
      var parts = u.split(","), mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
      var bin = atob(parts[1]), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var b = new Blob([arr], { type: mime });
      return b;
    }

    if (shutterBtn) shutterBtn.addEventListener("click", captureLiveFrame);

    // Native fallback: capture the current bearing, then open the OS camera.
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

    // Load a captured photo (native File or live-frame Blob) into the circle
    // editor. Same downstream contract either way: `originalFile` is the
    // untouched full-quality image, `canvas` is the reduced/circled version.
    function loadIntoEditor(f) {
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
    }

    camera.addEventListener("change", function () {
      var f = camera.files && camera.files[0];
      loadIntoEditor(f);
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

