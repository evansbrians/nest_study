
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

  // Patch geometry (window.fieldPatches) is static shell data, so it is present
  // as soon as field_patches.js has parsed. window.fieldToday is NO LONGER baked
  // -- it is built from the LIVE schedule (GET /schedule -> rebuildFieldToday),
  // so it simply does not exist yet on first paint. Waiting on it here would
  // gate the dropdown on a network round-trip; instead build it now from what we
  // have, and rebuild when the schedule lands (nestapi_wiring fires the event).

  if (window.fieldPatches) {
    rebuildPatchDropdown();
  } else {
    var pt = 0;
    var piv = setInterval(function () {
      if (window.fieldPatches || ++pt > 50) { clearInterval(piv); rebuildPatchDropdown(); }
    }, 100);
  }
  // The live schedule decides which patches are "today", so the dropdown has to
  // be rebuilt once it arrives (and on each later change-feed refresh).
  window.addEventListener("fieldtoday:changed", function () {
    try { rebuildPatchDropdown(); } catch (e) {}
  });

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

  var artCandToggle = document.getElementById("artCandToggle");
  if (artCandToggle) {
    artCandToggle.addEventListener("change", function () {
      window.postMessage({ type: "setArtCand", on: artCandToggle.checked }, "*");
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
  // Map one waypoint GeoJSON Feature -> a /gps_points POST body (per the app
  // wiring map's waypoint field table). Coordinates come from the geometry;
  // everything else from feature.properties.
  function featureToGpsPoint(f) {
    var props = (f && f.properties) || {};
    var coords = (f && f.geometry && f.geometry.coordinates) || [];
    return {
      point_id: props.point_id,             // client UUID (required, preserved)
      point_name: props.point_name,         // nest id or user-entered name
      // DB point_class(code) is lowercase (nest/other/landmark); the app carries
      // capitalized labels internally, so normalize at the API boundary only.
      point_class: (props.point_class || "").toLowerCase().replace(/\s+/g, "_"),
      datetime: props.time,
      longitude: coords[0],
      latitude: coords[1],
      elevation: (props.elevation != null) ? props.elevation : (coords[2] != null ? coords[2] : null),
      horizontal_accuracy: (props.horizontal_accuracy != null) ? props.horizontal_accuracy : null,
      bearing: (props.bearing != null) ? props.bearing : null,
      note: props.note || null,
      color: props.color || null,
      nav_photo_name: props.photo_name || null,
      nav_photo: props.photo || null        // base64 data-url or null
    };
  }

  // Enqueue every feature in a FeatureCollection for /gps_points and confirm
  // immediately, uploading in the BACKGROUND. Optimistic: writing to the local
  // IndexedDB queue is near-instant (even with a base64 photo), so the field
  // save never blocks on a cellular round-trip. The queue flushes to the server
  // via flushSoon (idempotency keys + temp-id remap make re-sends safe).
  function uploadFcToApi(target, fc, say, onSuccess) {
    var feats = (fc && fc.features) || [];
    var chain = Promise.resolve();
    feats.forEach(function (f) {
      var body = featureToGpsPoint(f);
      // Temp waypoints are device-only -- never persist them to the DB.
      if (String(body.point_class || "").toLowerCase() === "temp") return;
      var idem = NestApi.api.newIdemKey();
      chain = chain.then(function () {
        return NestApi.queue.enqueue({
          kind: "createGpsPoint", tempId: body.point_id,
          endpoint: "/gps_points", method: "POST", body: body, idemKey: idem
        });
      });
    });
    chain.then(function () {
      say("Saved.");
      if (typeof onSuccess === "function") onSuccess();
      if (typeof flushSoon === "function") flushSoon();
    }).catch(function () {
      // A local-queue write failing is rare; still ack so the tech isn't blocked.
      if (typeof onSuccess === "function") onSuccess();
    });
  }

  // GeoJSON backups go to the REST API. (The legacy Google Drive relay branch
  // was only reachable without a token, and the token is now mandatory.)
  function uploadToDrive(target, filename, fc, onStatus, onSuccess) {
    function say(m) { if (typeof onStatus === "function") onStatus(m); }
    uploadFcToApi(target, fc, say, onSuccess);
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

  // Replaces window.confirm, which is a SILENT no-op here: the app ships in a
  // WKWebView with no uiDelegate, so confirm() shows nothing and just returns
  // false -- every guarded button did nothing at all. Callback-based because a
  // web modal cannot block the way confirm() does.

  function fieldConfirm(msg, onYes) {
    var overlay = document.getElementById("fieldConfirmModal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "fieldConfirmModal";
      overlay.className = "field-upload-modal-overlay";
      var box = document.createElement("div");
      box.className = "field-upload-modal";
      var text = document.createElement("div");
      text.className = "field-upload-modal-text";
      var row = document.createElement("div");
      row.className = "field-confirm-modal-buttons";
      var no = document.createElement("button");
      no.type = "button";
      no.className = "field-button";
      no.textContent = "Cancel";
      var yes = document.createElement("button");
      yes.type = "button";
      yes.className = "field-button field-confirm-yes";
      yes.textContent = "Yes";
      row.appendChild(no);
      row.appendChild(yes);
      box.appendChild(text);
      box.appendChild(row);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      overlay._textEl = text;
      overlay._yesEl = yes;

      // Cancel on the button OR on a backdrop tap; a tap inside the box must
      // not count as either answer.

      box.addEventListener("click", function (e) { e.stopPropagation(); });
      overlay.addEventListener("click", function () { hideConfirm(overlay); });
      no.addEventListener("click", function () { hideConfirm(overlay); });
    }
    overlay._textEl.textContent = msg;

    // Re-bind Yes each call: the handler closes over THIS call's onYes, and a
    // stale one left over would fire the previous button's action.

    var fresh = overlay._yesEl.cloneNode(true);
    overlay._yesEl.parentNode.replaceChild(fresh, overlay._yesEl);
    overlay._yesEl = fresh;
    fresh.addEventListener("click", function () {
      hideConfirm(overlay);
      if (typeof onYes === "function") onYes();
    });
    overlay.classList.add("is-visible");
  }

  function hideConfirm(overlay) {
    overlay.classList.remove("is-visible");
  }

  // Like fieldConfirm, but the question IS the choice: it shows one button per
  // option and hands the picked value to onPick, instead of a yes/no. Cancel or
  // a backdrop tap dismisses without picking. Buttons are rebuilt each call so
  // labels and handlers always match this invocation.

  function fieldChoose(msg, options, onPick) {
    var overlay = document.getElementById("fieldChooseModal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "fieldChooseModal";
      overlay.className = "field-upload-modal-overlay";
      var box = document.createElement("div");
      box.className = "field-upload-modal";
      var text = document.createElement("div");
      text.className = "field-upload-modal-text";
      var row = document.createElement("div");
      row.className = "field-confirm-modal-buttons";
      box.appendChild(text);
      box.appendChild(row);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      overlay._textEl = text;
      overlay._rowEl = row;
      box.addEventListener("click", function (e) { e.stopPropagation(); });
      overlay.addEventListener("click", function () { hideConfirm(overlay); });
    }
    overlay._textEl.textContent = msg;

    var row = overlay._rowEl;
    row.innerHTML = "";
    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "field-button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", function () { hideConfirm(overlay); });
    row.appendChild(cancel);
    options.forEach(function (opt) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "field-button field-confirm-yes";
      b.textContent = opt.label;
      b.addEventListener("click", function () {
        hideConfirm(overlay);
        if (typeof onPick === "function") onPick(opt.value);
      });
      row.appendChild(b);
    });
    overlay.classList.add("is-visible");
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

  // Run the captured photo through the circle-the-nest annotator, then hand the
  // (possibly annotated) image back. Degrades to a straight pass-through if the
  // annotator module isn't present, so the save flow never breaks.

  function annotateThen(dataUrl, apply) {
    if (dataUrl && window.fieldAnnotatePhoto) window.fieldAnnotatePhoto(dataUrl, apply);
    else apply(dataUrl, { annotated: false });
  }

  // Save an image to the phone's photo library. Prefer the Web Share API with a
  // File (lets the user drop it straight into Photos); fall back to an <a
  // download>. Best-effort -- any failure is swallowed so it never interrupts
  // the in-app save.

  function fieldDownloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 4000);
  }

  function fieldSaveImageToPhone(dataUrl, name) {
    if (!dataUrl) return;
    var filename = name || ("nest-" + Date.now() + ".jpg");
    try {
      var parts = String(dataUrl).split(",");
      var mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
      var bin = atob(parts[1]);
      var len = bin.length, bytes = new Uint8Array(len);
      for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      var blob = new Blob([bytes], { type: mime });

      if (navigator.share && navigator.canShare) {
        var file = new File([blob], filename, { type: mime });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: filename }).catch(function () {
            fieldDownloadBlob(blob, filename);
          });
          return;
        }
      }
      fieldDownloadBlob(blob, filename);
    } catch (e) {
      try {
        var a = document.createElement("a");
        a.href = dataUrl; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      } catch (e2) {}
    }
  }

  // Full-screen nest-photo viewer. Built once on demand and reused; a Back
  // button in its bottom bar hides it, returning to the nest-info page that
  // remains rendered underneath.

  var fieldPhotoViewer = null;
  function fieldOpenPhotoViewer(src) {
    if (!src) return;
    if (!fieldPhotoViewer) {
      var ov = document.createElement("div");
      ov.className = "field-photo-viewer";
      ov.style.cssText =
        "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;" +
        "background:rgba(0,0,0,0.95);";
      var stage = document.createElement("div");
      stage.style.cssText =
        "flex:1 1 auto;display:flex;align-items:center;justify-content:center;" +
        "overflow:auto;min-height:0;padding:8px;";
      var im = document.createElement("img");
      im.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;display:block;";
      stage.appendChild(im);
      var bar = document.createElement("div");
      bar.style.cssText = "flex:0 0 auto;display:flex;justify-content:center;padding:12px;";
      var back = document.createElement("button");
      back.type = "button";
      back.textContent = "Back";
      back.className = "field-bar-menu-btn";
      back.style.cssText =
        "padding:14px 28px;border:none;border-radius:8px;font:600 1.05rem sans-serif;" +
        "color:#fff;background:#333;";
      back.addEventListener("click", function () { fieldPhotoViewer.style.display = "none"; });
      bar.appendChild(back);
      ov.appendChild(stage);
      ov.appendChild(bar);
      document.body.appendChild(ov);
      fieldPhotoViewer = ov;
      fieldPhotoViewer._img = im;
    }
    fieldPhotoViewer._img.src = src;
    fieldPhotoViewer.style.display = "flex";
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

  // Wrap a photo for an <img src>. App-created photos are already data: URLs; the
  // API returns RAW base64 (no prefix), which as a bare src renders the blue
  // "broken image" box -- wrap those. Non-image junk (ids/filenames) -> null.
  function wpPhotoDataUri(photo) {
    if (!photo) return null;
    var s = String(photo).trim();
    if (!s) return null;
    if (/^data:image\//i.test(s)) return s;
    var clean = s.replace(/\s+/g, "");
    if (clean.length > 100 && /^[A-Za-z0-9+/=]+$/.test(clean)) {
      return "data:image/jpeg;base64," + clean;
    }
    return null;
  }

  // Lazy per-point nav photo: the /gps_points list no longer carries photo bytes
  // (just a has_nav_photo flag), so a popup fetches its point's photo on open.
  // Results (incl. "no photo") are cached so re-opening doesn't refetch.
  var _wpPhotoCache = {};
  function wpFillPhotoSlot(slot, uri) {
    if (!slot || !uri || slot.getAttribute("data-loaded")) return;
    slot.setAttribute("data-loaded", "1");
    var im = document.createElement("img");
    im.src = uri;
    im.style.maxWidth = "170px";
    im.style.marginTop = "6px";
    im.style.borderRadius = "4px";
    // Tap the popup photo to open it full-screen (like the nest page).
    im.style.cursor = "zoom-in";
    im.addEventListener("click", function () {
      if (typeof fieldOpenPhotoViewer === "function") fieldOpenPhotoViewer(uri);
    });
    slot.appendChild(im);
  }
  function wpApiOnline() {
    return !!(window.NestApi && NestApi.settings && NestApi.settings.hasCreds() &&
      NestApi.api && NestApi.api.isOnline() && NestApi.api.getGpsPointPhoto);
  }
  function wpLazyLoadPhoto(pointId, slot) {
    if (!pointId || !slot || !wpApiOnline()) return;
    var cached = _wpPhotoCache[pointId];
    if (cached === false || cached === "pending") return;
    if (typeof cached === "string") { wpFillPhotoSlot(slot, cached); return; }
    _wpPhotoCache[pointId] = "pending";
    NestApi.api.getGpsPointPhoto(pointId).then(function (r) {
      var uri = wpPhotoDataUri(r && r.nav_photo);
      _wpPhotoCache[pointId] = uri || false;
      if (uri) wpFillPhotoSlot(slot, uri);
    }).catch(function () { _wpPhotoCache[pointId] = undefined; });
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
    var img = wpPhotoDataUri(w.photo);
    if (img) {
      html += '<br><img src="' + img +
        '" class="wp-popup-photo" style="max-width:170px;margin-top:6px;' +
        'border-radius:4px;cursor:zoom-in">';
    } else if (w.hasPhoto && w.point_id) {
      // Filled on popupopen via a lazy GET /gps_points/<id>/photo.
      html += '<br><div class="wp-photo-slot" data-point="' +
        escapeHtml(String(w.point_id)) + '"></div>';
    }
    return html;
  }

  // True if this waypoint is really a nest -- by class ("Nest"/"nest") OR by its
  // name matching a known nest id (window.fieldApiNests). Nests are drawn solely
  // by the API overlay (nestapi_map.js) with the proper status icon; their
  // waypoint pin (a circle) must never coexist, or the nest shows two markers.
  function isNestWaypoint(w) {
    if (!w) return false;
    if (String(w.point_class).toLowerCase() === "nest") return true;
    var nm = w.point_name;
    if (nm == null) return false;
    var nests = window.fieldApiNests || [];
    for (var i = 0; i < nests.length; i++) {
      if (nests[i] && String(nests[i].nest_id) === String(nm)) return true;
    }
    return false;
  }

  function addWaypointMarker(w) {
    var map = window.fieldMap;
    if (!map || typeof L === "undefined") return;
    // The API overlay owns nest markers. Never draw a nest's waypoint pin, and
    // remove any pin that was drawn before the point became a known nest (the
    // guard only PREVENTS adding; a pin already on the map has to be removed) so
    // a nest never shows two markers: a circle pin + the nest icon.
    if (isNestWaypoint(w)) { removeWaypointMarker(w.point_id); return; }
    if (wpMarkers[w.point_id]) return;
    // Hidden via the manager

    if (w.visible === false) return;
    var m = L.marker([w.latitude, w.longitude], { icon: wpIcon(wpColorHex(w)) });

    // Temp points are scratch marks the tech just dropped and will act on now,
    // so they are ALWAYS relevant: the patch/today filter must never hide one.
    // Everything else in this group hides with the patches it sits in.

    m._alwaysShow = (w.point_class === "Temp");

    // Into the layerManager's "Waypoints" group rather than straight onto the
    // map, so map_weather.js's applyFilter() sweeps these like every other point
    // layer -- a waypoint outside today's patches now hides with them. Added
    // directly to the map, they were invisible to the filter and always showed.
    // The manager's per-point toggle still governs membership (add/remove here);
    // the filter only governs whether a member is currently on the map, so the
    // two compose instead of fighting.
    if (map.layerManager && typeof map.layerManager.addLayer === "function") {
      try {
        map.layerManager.addLayer(m, "marker", "wp-" + w.point_id, "Waypoints");
      } catch (e) {
        m.addTo(map);
      }
    } else {
      m.addTo(map);
    }
    m.bindPopup(wpPopupHtml(w));
    m.on("popupopen", function (ev) {
      var el = ev.popup.getElement();
      var slot = el && el.querySelector(".wp-photo-slot");
      if (slot) wpLazyLoadPhoto(slot.getAttribute("data-point"), slot);
      // Tap an already-shown popup photo to open it full-screen (nest-page style).
      var inlineImg = el && el.querySelector(".wp-popup-photo");
      if (inlineImg) {
        inlineImg.addEventListener("click", function () {
          if (typeof fieldOpenPhotoViewer === "function") fieldOpenPhotoViewer(inlineImg.src);
        });
      }
    });
    wpMarkers[w.point_id] = m;
    // Let the zoom scaler size the new icon to match

    map.fire("zoomend");
  }

  function removeWaypointMarker(id) {
    var m = wpMarkers[id];
    var map = window.fieldMap;
    if (m && map) {
      // Remove from the layerManager GROUP, not just the map. Removing it from
      // the map alone would leave it a member of "Waypoints", and the next
      // applyFilter() sweep would put it straight back -- silently undoing the
      // manager's hide.
      if (map.layerManager && typeof map.layerManager.removeLayer === "function") {
        try { map.layerManager.removeLayer("marker", "wp-" + id); } catch (e) {}
      }
      if (map.hasLayer(m)) map.removeLayer(m);
    }
    delete wpMarkers[id];
  }

  // Update an on-map marker in place (position, color, popup) after an edit.

  function refreshWaypointMarker(w) {
    // A nest that gained discovery data is now owned by the API overlay -- drop
    // any lingering waypoint pin instead of refreshing it (no two markers).
    if (isNestWaypoint(w)) { removeWaypointMarker(w.point_id); return; }
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
        if (!dataUrl) { currentPhoto = null; addStatus("Couldn't read that photo."); return; }
        // Let the user circle the nest, then save the annotated bytes and also
        // drop a copy into the phone's photo library.
        annotateThen(dataUrl, function (annotated, meta) {
          currentPhoto = annotated;
          if (wpPhotoPreview) {
            wpPhotoPreview.innerHTML = "";
            var im = document.createElement("img");
            im.src = annotated;
            im.className = "field-photo-thumb";
            wpPhotoPreview.appendChild(im);
          }
          if (meta && meta.annotated) fieldSaveImageToPhone(annotated, null);
          addStatus("Photo attached.");
        });
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
    // Live GET /nests (window.fieldApiNests) is the id source of truth; the baked
    // fieldNestIds list is a last-resort fallback used only until the API set has
    // loaded (offline first boot).
    var apiNests = window.fieldApiNests;
    if (apiNests && apiNests.length) {
      apiNests.forEach(function (n) { if (n) add(n.nest_id); });
    } else {
      (window.fieldNestIds || []).forEach(add);   // all baked nests, incl. no-GPS
    }
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

  // The marker rows are window.fieldMapMarkers (GET /map_points, the
  // v_map_point view): ONE row per GPS point. A point is a different level of
  // observation from a nest -- two nests (an NQ and its host N twin) can share
  // one point -- so a nest resolves to its point by FOREIGN KEY, never by name.

  function usablePoint(r) {
    return !!r && r.lat != null && r.lng != null &&
           !isNaN(r.lat) && !isNaN(r.lng);
  }

  // point_id -> its row (v_map_point exposes gps_point.point_id as `idx`).

  function mapPointById(pointId) {
    var rows = window.fieldMapMarkers || [];

    if (!pointId) return null;

    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].idx === pointId && usablePoint(rows[i])) {
        return rows[i];
      }
    }
    return null;
  }

  // Name -> row. Only valid for things a name DOES identify (a GPS point's own
  // name); do not use it to find a nest's point.

  function mapPointByName(name) {
    var rows = window.fieldMapMarkers || [];

    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].name === name && usablePoint(rows[i])) {
        return rows[i];
      }
    }
    return null;
  }

  // THE nest -> point lookup: follow nest.gps_point_id to the point's row.
  // Falls back to a cached waypoint's point_id for a nest created offline that
  // the API has not returned yet.

  function mapPointForNest(nestId) {
    var nests = window.fieldApiNests || [];

    for (var i = 0; i < nests.length; i++) {
      if (nests[i] && nests[i].nest_id === nestId && nests[i].gps_point_id) {
        return mapPointById(nests[i].gps_point_id);
      }
    }

    var arr = loadWaypoints();

    for (var j = 0; j < arr.length; j++) {
      if (arr[j].point_name === nestId && arr[j].point_id) {
        return mapPointById(arr[j].point_id);
      }
    }
    return null;
  }

  // True when `name` already belongs to a GPS point somewhere the app knows
  // about: a map point, a cached waypoint, or a live nest. Used to block
  // naming a brand-new nest the same as an existing GPS point.
  function nestNameHasGpsPoint(name) {
    name = String(name || "");
    if (!name) return false;
    var pts = window.fieldNavPoints || [];
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].name === name && pts[i].lat != null && pts[i].lng != null &&
          !isNaN(pts[i].lat) && !isNaN(pts[i].lng)) return true;
    }
    if (mapPointByName(name)) return true;

    var arr = loadWaypoints();
    for (var j = 0; j < arr.length; j++) {
      if (arr[j].point_name === name && arr[j].latitude != null &&
          arr[j].longitude != null) return true;
    }
    var c = liveNestCoords[name];
    if (c && c.lat != null && c.lng != null) return true;
    return false;
  }

  // Nest IDs now come from window.fieldApiNests (GET /nests), which is
  // authoritative, so the old JSONP relay read is retired. Kept as a no-op that
  // reports "no live list" so callers fall back to fieldApiNests + local data.
  function fetchLiveNestIds(cb) {
    cb(null, null);
  }

  // Pre-fill the name field with the suggested next nest number, but only for a
  // fresh new-nest entry (not the measure-existing or Modify flows). Fills the
  // offline best guess immediately, then upgrades from the live list unless the
  // user has started editing.

  // The id source is unified on the live GET /nests set (window.fieldApiNests,
  // read by nextNestNumber/usedNestNumbers), so no JSONP relay round-trip is
  // needed; baked fieldNestIds is the offline fallback inside usedNestNumbers.
  function suggestNestId() {
    if (newNestId || editWp || !wpName || !wpClass || wpClass.value !== "Nest") return;
    syncNamePrefix();
    var prefix = currentPrefix();
    wpName.value = padNest(nextNestNumber(prefix, null));
    wpName.dataset.autofill = "1";
    var live = !!(window.fieldApiNests && window.fieldApiNests.length);
    addStatus("Suggested " + prefix + wpName.value +
      (live ? " from the live nest list." : " (from cached data)."));
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
    ["American goldfinch", "AGOL"], ["Blue jay", "BLJA"],
    ["Brown thrasher", "BRTH"], ["Common yellowthroat", "COYE"],
    ["Eastern towhee", "EATO"], ["Field sparrow", "FISP"],
    ["Gray catbird", "GRCA"], ["Indigo bunting", "INBU"],
    ["Northern cardinal", "NOCA"], ["Northern mockingbird", "NOMO"],
    ["Prairie warbler", "PRWA"], ["Red-winged blackbird", "RWBL"],
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
    // Tapping the photo control launches the OS camera/picker, which backgrounds
    // (and on iOS often reloads) the PWA. Flush the discovery draft synchronously
    // FIRST so the species/height/etc. entered so far survive that -- otherwise a
    // reload lands the tech back on the map with a blank form.
    ["pointerdown", "click"].forEach(function (evt) {
      ndPhoto.addEventListener(evt, function () {
        if (window.fieldFlushNestDraft) window.fieldFlushNestDraft();
      });
    });
    // Whenever the app is hidden (backgrounded, screen off, camera opened),
    // flush any in-progress discovery + interval draft so an iOS eviction can't
    // lose it.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) return;
      if (window.fieldFlushNestDraft) window.fieldFlushNestDraft();
      if (window.fieldFlushIntervalDraft) window.fieldFlushIntervalDraft();
    });
    ndPhoto.addEventListener("change", function () {
      var file = ndPhoto.files && ndPhoto.files[0];
      var preview = ndEl("ndPhotoPreview");
      if (preview) preview.innerHTML = "";
      var status = ndEl("nestDataStatus");
      if (!file) { nestPhoto = null; nestPhotoName = null; return; }
      if (status) status.textContent = "Processing photo...";
      compressImage(file, 1024, 0.55, function (dataUrl) {
        if (!dataUrl) {
          nestPhoto = null; nestPhotoName = null;
          if (status) status.textContent = "Couldn't read that photo.";
          return;
        }
        // Circle-the-nest step: the annotated image is what gets saved to the
        // app, and (on Done) a copy is pushed to the phone's photo library.
        annotateThen(dataUrl, function (annotated, meta) {
          nestPhoto = annotated;
          if (preview) {
            preview.innerHTML = "";
            var im = document.createElement("img");
            im.src = annotated;
            im.className = "field-photo-thumb";
            preview.appendChild(im);
          }
          if (meta && meta.annotated) fieldSaveImageToPhone(annotated, nestPhotoName || null);
          if (window.fieldSaveNestDraft) window.fieldSaveNestDraft();
          if (status) status.textContent = "Photo attached.";
        });
      });
    });
  }

  buildNestChoices();
  wireNestPicker("ndPatchBtn", "ndPatchId", "Choose a patch", "Patch", false, null);
  wireNestPicker("ndSpeciesBtn", "ndSpecies", "Choose species", "Choose species", false, syncNestOther);
  wireNestPicker("ndDiscoveryStageBtn", "ndDiscoveryStage", "Discovery stage", "— select —", false, null);
  wireNestPicker("ndCameraOrControlBtn", "ndCameraOrControl", "Camera or control", "Control", false, null);
  wireNestPicker("ndSubstrateBtn", "ndSubstrate", "Substrate", "Choose substrate", true, syncNestOther);

  // No in-app dictation: the app ships in a WKWebView, which exposes
  // webkitSpeechRecognition but cannot grant it microphone permission, so
  // start() failed and the mic button silently did nothing. The keyboard's own
  // mic key dictates into these fields on both iOS and Android.


  var ndSaveBtn = ndEl("nestDataSaveBtn");
  if (ndSaveBtn) ndSaveBtn.addEventListener("click", saveNestData);

  var ndCancelBtn = ndEl("nestDataCancelBtn");
  if (ndCancelBtn) ndCancelBtn.addEventListener("click", function () {
    if (window.fieldClearNestDraft) window.fieldClearNestDraft();
    closeMenu();
  });

  // Auto-save the in-progress discovery form to storage as fields change, so an
  // iOS PWA eviction (e.g. when the camera opens) can't lose the entry. Covers
  // text inputs, checkboxes, and native selects; the big pickers + photo nudge
  // the save from their own handlers.
  var ndScreenEl = document.querySelector('.field-screen[data-name="nestdata"]');
  if (ndScreenEl) {
    ndScreenEl.addEventListener("input", function () {
      if (window.fieldSaveNestDraft) window.fieldSaveNestDraft();
    });
    ndScreenEl.addEventListener("change", function () {
      if (window.fieldSaveNestDraft) window.fieldSaveNestDraft();
    });
  }

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
  if (ivCancelBtn) ivCancelBtn.addEventListener("click", function () {
    if (window.fieldClearIntervalDraft) window.fieldClearIntervalDraft();
    closeMenu();
  });

  // Auto-save the in-progress interval check to storage as fields change, so an
  // iOS PWA eviction can't lose it. All native inputs/selects, so one delegated
  // pair of listeners on the screen covers every field.
  var ivScreenEl = document.querySelector('.field-screen[data-name="intervaldata"]');
  if (ivScreenEl) {
    ivScreenEl.addEventListener("input", function () {
      if (window.fieldSaveIntervalDraft) window.fieldSaveIntervalDraft();
    });
    ivScreenEl.addEventListener("change", function () {
      if (window.fieldSaveIntervalDraft) window.fieldSaveIntervalDraft();
    });
  }

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

  // Rebuild the local waypoint store from the server's gps_points so waypoints
  // recorded on ANY device show on every device by default (they're already in
  // the DB). Called by nestapi_wiring on boot + change-feed with the raw GeoJSON.
  // Restores EVERY user waypoint class -- Other / Landmark / Path crossing /
  // Boundary, plus any future class -- so a point in the DB is never silently
  // missing on another tech's phone (bug: points missing on Tara's phone).
  // Skipped: nests (drawn by the API nest overlay), Temp (device-only, never in
  // the DB), and infra points (coverboards / trail cams / point counts) which
  // have baked map markers + their own Waypoint-manager section -- a pin here too
  // would double them.
  var WP_CLASS_LABEL = {
    other: "Other", landmark: "Landmark",
    path_crossing: "Path crossing", boundary: "Boundary"
  };
  var WP_CLASS_SKIP = {
    nest: true, temp: true,
    coverboard: true, trailcam: true, point_count: true
  };
  function wpClassFromCode(code) {
    code = String(code || "").toLowerCase();
    if (WP_CLASS_SKIP[code]) return null;
    return WP_CLASS_LABEL[code] ||
      (code
        ? code.replace(/_/g, " ").replace(/\b\w/g, function (ch) { return ch.toUpperCase(); })
        : "Other");
  }
  window.fieldMergeApiWaypoints = function (gpsFC) {
    var feats = (gpsFC && gpsFC.features) || [];
    if (!feats.length) return;
    var arr = loadWaypoints();
    var have = {};
    arr.forEach(function (w) { if (w.point_id) have[String(w.point_id)] = true; });
    var added = 0;
    feats.forEach(function (f) {
      var props = (f && f.properties) || {};
      var coords = (f && f.geometry && f.geometry.coordinates) || [];
      var pid = props.point_id;
      if (!pid || have[String(pid)]) return;
      var cls = wpClassFromCode(props.point_class);
      if (!cls) return;                               // skip nests + Temp + infra
      var lng = coords[0], lat = coords[1];
      if (lat == null || lng == null) return;
      var wp = {
        point_id: pid,
        point_name: props.point_name || pid,
        point_class: cls,
        latitude: lat,
        longitude: lng,
        elevation: (props.elevation != null) ? props.elevation : null,
        horizontal_accuracy: (props.horizontal_accuracy != null) ? props.horizontal_accuracy : null,
        bearing: (props.bearing != null) ? props.bearing : null,
        note: props.note || "",
        color: props.color || WP_DEFAULT_COLOR,
        photo: props.nav_photo || null,               // usually null now (lazy)
        hasPhoto: !!(props.has_nav_photo || props.nav_photo),
        photo_name: props.nav_photo_name || null,
        time: props.datetime || "",
        visible: true,
        uploaded: true,                               // already in the DB
        _fromServer: true
      };
      arr.push(wp);
      have[String(pid)] = true;
      addWaypointMarker(wp);
      added++;
    });
    if (added > 0) storeWaypoints(arr);
  };

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
  // Jump the main map to a point and close the menu over it. `zoom` defaults to
  // 19 (the old fixed behaviour); the nest-info map passes 18.
  function zoomToPoint(lat, lng, zoom) {
    if (lat == null || lng == null) return;
    if (window.fieldMap) {
      window.fieldMap.setView([lat, lng], (zoom == null) ? 19 : zoom);
    }
    closeMenu();
  }

  // ---- Nest info page ---------------------------------------------------

  var niCurrentNest = null;

  function niCoords(nestId) {
    var p = mapPointForNest(nestId);
    if (p) return { lat: p.lat, lng: p.lng };

    var arr = loadWaypoints();

    for (var j = 0; j < arr.length; j++) {
      if (arr[j].point_name === nestId && arr[j].latitude != null) {
        return { lat: arr[j].latitude, lng: arr[j].longitude };
      }
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
    // No third branch here: GET /gps_points deliberately no longer ships
    // nav_photo bytes (only a has_nav_photo flag), so the old fallback that
    // read them could never fire. NestApiData.resolveNestPhoto covers this.

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
    return { line: (iv.check_date || "?") + ": " + host, sub: sub };
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

    // Same marker as the main map: the icon off this nest's point row. A shared
    // point resolves to one nest (artificial wins), so an N twin shows its NQ's
    // icon here -- exactly what the main map shows for that point.

    var p = mapPointForNest(nestId);
    var ic = (p && window.fieldIcons) ? window.fieldIcons[p.icon] : null;
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

    // Tapping this mini-map jumps to the MAIN map, centred on the nest at z18.
    // (The mini-map is deliberately non-interactive -- dragging/zoom disabled --
    // so a tap has no other meaning, and "show me this nest on the real map" is
    // what you'd want it to do.)
    map.on("click", function () { zoomToPoint(c.lat, c.lng, 18); });
    host.style.cursor = "pointer";

    host._nimap = map;
    setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 250);
  }

  // Put a photo (already a valid data URI) into the nest-info photo slot.
  function niSetInfoPhoto(ph, photo) {
    if (!ph || !photo) return;
    ph.innerHTML = "";
    var im = document.createElement("img");
    im.src = photo;
    im.className = "nest-info-photo-img";
    im.style.cursor = "zoom-in";
    im.addEventListener("click", function () { fieldOpenPhotoViewer(photo); });
    ph.appendChild(im);
    ph.style.display = "";
  }

  // Lazy-fetch a nest's photo for the info page, through the SAME resolver the
  // map popups use (NestApiData.resolveNestPhoto): memory -> IndexedDB -> the
  // gps point's nav_photo -> a disk photo from the `photo` table. This page used
  // to look at nav_photo alone, so a nest whose photo lives in the photo table
  // (e.g. NQ060) appeared in its popup but not on its page -- two resolvers, two
  // answers. One resolver, one answer.
  function niLazyInfoPhoto(nestId, ph) {
    if (!window.NestApiData ||
        typeof window.NestApiData.resolveNestPhoto !== "function") return;
    window.NestApiData.resolveNestPhoto(nestId).then(function (uri) {
      if (uri) niSetInfoPhoto(ph, uri);
    }).catch(function () {});
  }

  window.fieldOpenNestInfo = function (nestId) {
    ensureMenuOpen();
    niCurrentNest = nestId;
    var info = (window.fieldNestInfo && window.fieldNestInfo[nestId]) || {};

    // Formatted for display here, at the edge, from the stored code.

    var spLabel = apiNestSpecies(info);
    var t = document.getElementById("niTitle");
    if (t) t.textContent = nestId +
      (spLabel && spLabel !== "Unknown" ? " — " + spLabel : "");

    var ph = document.getElementById("niPhoto");
    if (ph) {
      ph.innerHTML = "";
      ph.style.display = "none";
      var photo = wpPhotoDataUri(niFindPhoto(nestId));
      if (photo) {
        niSetInfoPhoto(ph, photo);
      } else {
        // The /gps_points list no longer inlines photos; fetch this nest's
        // GPS-point photo lazily so the info page still shows it.
        niLazyInfoPhoto(nestId, ph);
      }
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
      addRow("Plant spp", info.substrates);
      addRow("Height (m)", info.height_m);
      addRow("Location", info.location_description);
      addRow("Discovered", info.discovery_date);
      addRow("Last check", info.last_check);
      addRow("Status", info.last_status);
    }

    // Render the interval-check history into #niIntervals (newest first).
    function niRenderIntervals(list) {
      var il = document.getElementById("niIntervals");
      if (!il) return;
      il.innerHTML = "";
      var ivs = (list || []).slice().reverse();
      if (!ivs.length) {
        var none = document.createElement("li");
        none.textContent = "No interval checks yet.";
        il.appendChild(none);
        return;
      }
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

    // Show whatever the summary carried right away (its single latest check),
    // then fetch the nest's FULL interval history from the API and re-render.
    // The /nests summary only provides the one latest check, so without this the
    // info page never shows a nest's earlier checks -- and for a concluded nest
    // (is_current 0) that lone check was all you'd ever see. Cache the full set
    // into fieldNestInfo so a reopen is instant and the merge keeps it (richer).
    niRenderIntervals(info.intervals || []);
    if (window.NestApi && NestApi.api &&
        typeof NestApi.api.getNestIntervals === "function" && NestApi.api.isOnline()) {
      NestApi.api.getNestIntervals(nestId).then(function (rows) {
        if (!Array.isArray(rows) || niCurrentNest !== nestId) return;
        var full = rows.map(function (iv) {
          return {
            check_date: iv.check_date || null,
            host_eggs: iv.host_eggs,
            host_young: iv.host_young,
            bhco_eggs: iv.bhco_eggs,
            bhco_young: iv.bhco_young
          };
        }).sort(function (a, b) {
          var ka = a.check_date || "", kb = b.check_date || "";
          return ka < kb ? -1 : (ka > kb ? 1 : 0);
        });
        if (window.fieldNestInfo && window.fieldNestInfo[nestId]) {
          window.fieldNestInfo[nestId].intervals = full;
        }
        niRenderIntervals(full);
      }).catch(function () {});
    }

    niBuildMap(nestId);

    showScreen("nestinfo");
  };

  // Nest-info page: Navigate + Modify only. All modify actions (incl. Add nest
  // discovery / Re-record GPS) live on the Modify screen, reached via Modify.
  var niNavigateBtn = document.getElementById("niNavigateBtn");
  if (niNavigateBtn) niNavigateBtn.addEventListener("click", function () {
    var c = niCoords(niCurrentNest);
    if (c) {
      startNavigation({ latitude: c.lat, longitude: c.lng, point_name: niCurrentNest });
    } else {
      showUploadModal("No GPS location for " + niCurrentNest + " yet.");
    }
  });
  var niModifyBtn = document.getElementById("niModifyBtn");
  if (niModifyBtn) niModifyBtn.addEventListener("click", function () {
    if (window.fieldOpenNestModify) window.fieldOpenNestModify(niCurrentNest);
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

  // ---- Nests page: merge live API nests -----------------------------------
  //
  // The Nests page (list + per-nest info) is baked from the Sheets data, so
  // nests entered through the app (VM DB only) never appear there. These helpers
  // fold window.fieldApiNests (GET /nests) into both window.fieldNestInfo (the
  // per-nest detail source fieldOpenNestInfo reads) and the baked list DOM.

  function apiNum(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  // Latest-check host summary in the field convention (mirrors niIntervalParts).
  function apiHostStatus(eggs, young) {
    var he = Number(eggs) || 0, hy = Number(young) || 0;
    if (he > 0 && hy > 0) return he + " Eggs & " + hy + " nestlings";
    if (he > 0) return he + " Eggs";
    if (hy > 0) return hy + " Nestlings";
    return "Empty";
  }

  // The API serves the common name under TWO names: `species` (GET /nests, via
  // v_current_nest) and `species_common` (GET /nests/<id>). Until the server
  // settles on one, this is the single place that reconciles them -- not four
  // scattered bridges. Falls back to the code so a nest is never label-less.

  function apiNestSpecies(n) {
    return n.species_common || n.species || n.species_other ||
      n.species_code || "Unknown";
  }

  // One API nest row -> the shape window.fieldOpenNestInfo reads. The list load
  // (GET /nests) carries only the latest check, so intervals holds at most that
  // one entry; a nest's richer baked history is preserved in the merge below.
  function apiNestToInfo(n) {
    var intervals = [];
    if (n.last_check) {
      intervals.push({
        check_date: n.last_check,
        host_eggs: apiNum(n.last_eggs),
        host_young: apiNum(n.last_young),
        bhco_eggs: null,
        bhco_young: null
      });
    }

    // Carries the API's own names. This used to rename species_code/height_m/
    // substrates into a second dialect, which is how the info page and the
    // discovery form ended up disagreeing about what a nest's species is
    // called. Species is formatted for display at render, not stored renamed.

    return {
      species_code: n.species_code || null,
      species_common: n.species_common || n.species || null,
      species_other: n.species_other || null,
      patch_id: n.patch_id || null,
      substrates: n.substrates || null,
      height_m: (n.height_m == null || n.height_m === "") ? null : String(n.height_m),
      location_description: n.location_description || null,
      discovery_date: n.discovery_date || null,
      last_check: n.last_check || null,
      last_status: n.last_check ? apiHostStatus(n.last_eggs, n.last_young) : null,
      intervals: intervals
    };
  }

  // Populate window.fieldNestInfo purely from the live API (GET /nests) -- the
  // nest detail page reads window.fieldNestInfo[id]. There is no baked nest data
  // any more, so the API is the single source of truth; this removes the old
  // baked-vs-API merge that could serve stale data (the NQ045 bug). The one
  // thing we preserve is a fuller interval history the info page already fetched
  // live, since the /nests summary carries only the latest check.
  function fieldMergeApiNestInfo() {
    var nests = window.fieldApiNests || [];
    if (!window.fieldNestInfo) window.fieldNestInfo = {};
    var storeInfo = window.fieldNestInfo;
    nests.forEach(function (n) {
      if (!n || !n.nest_id) return;
      var api = apiNestToInfo(n);
      var prev = storeInfo[n.nest_id];
      if (prev && prev.intervals && prev.intervals.length > api.intervals.length) {
        api.intervals = prev.intervals;
      }
      storeInfo[n.nest_id] = api;
    });
  }

  // ---- Nests page: inject API nests into the list -------------------------

  function apiNestIsToday(patch) {
    var tp = (window.fieldToday && window.fieldToday.patches) || [];
    return tp.indexOf(patch) >= 0;
  }

  // A single nest button, matching the baked nests.R markup (.field-nest-btn
  // opening the info page). Flagged data-api-injected so a later run can drop it.
  function apiMakeNestBtn(n) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "field-nest-btn";
    btn.setAttribute("data-current", n.is_current ? "true" : "false");
    btn.setAttribute("data-patch", n.patch_id || "");
    btn.setAttribute("data-nest", n.nest_id);
    btn.setAttribute("data-today", apiNestIsToday(n.patch_id) ? "true" : "false");
    btn.setAttribute("data-api-injected", "1");
    var strong = document.createElement("strong");
    strong.textContent = n.nest_id + ".";
    btn.appendChild(strong);
    btn.appendChild(document.createTextNode(" " + apiNestSpecies(n)));
    var id = n.nest_id;
    btn.addEventListener("click", function () { window.fieldOpenNestInfo(id); });
    return btn;
  }

  // Create a patch accordion group (header + panel) for a patch the baked page
  // doesn't have, matching nests.R. Its toggle is wired here rather than via
  // fieldInitAccordions so the baked accordions aren't double-bound. Returns the
  // inner .nest-btn-group to append nest buttons into. `label` is the friendly
  // header text (test patches); it defaults to the raw patch id.
  function apiCreatePatchGroup(root, patch, anyCurrent, label) {
    var dc = anyCurrent ? "true" : "false";
    var dt = apiNestIsToday(patch) ? "true" : "false";
    var head = document.createElement("button");
    head.className = "accordion patch-accordion";
    head.setAttribute("data-current", dc);
    head.setAttribute("data-patch", patch);
    head.setAttribute("data-today", dt);
    head.setAttribute("data-api-injected", "1");
    var strong = document.createElement("strong");
    strong.textContent = label || patch;
    head.appendChild(strong);
    head.appendChild(document.createTextNode(" ("));
    var cc = document.createElement("span");
    cc.className = "patch-count-current";
    cc.textContent = "0";
    var ca = document.createElement("span");
    ca.className = "patch-count-all";
    ca.textContent = "0";
    head.appendChild(cc);
    head.appendChild(ca);
    head.appendChild(document.createTextNode(" nests)"));

    var panel = document.createElement("div");
    panel.className = "panel patch-panel";
    panel.setAttribute("data-current", dc);
    panel.setAttribute("data-today", dt);
    panel.setAttribute("data-api-injected", "1");
    panel.style.display = "none";
    var grp = document.createElement("div");
    grp.className = "nest-btn-group";
    panel.appendChild(grp);

    head.addEventListener("click", function () {
      head.classList.toggle("active");
      panel.style.display = (panel.style.display === "block") ? "none" : "block";
    });

    root.appendChild(head);
    root.appendChild(panel);
    return grp;
  }

  // Recompute every patch header's counts from its current buttons, so injected
  // rows are reflected and re-runs stay consistent (idempotent).
  function apiUpdatePatchCounts(root) {
    if (!root) return;
    var heads = root.querySelectorAll(":scope > .patch-accordion");
    Array.prototype.forEach.call(heads, function (head) {
      var panel = head.nextElementSibling;
      if (!panel) return;
      var btns = panel.querySelectorAll(".field-nest-btn");
      var cur = 0;
      Array.prototype.forEach.call(btns, function (b) {
        if (b.getAttribute("data-current") === "true") cur++;
      });
      var cc = head.querySelector(".patch-count-current");
      var ca = head.querySelector(".patch-count-all");
      if (cc) cc.textContent = String(cur);
      if (ca) ca.textContent = String(btns.length);
    });
  }

  // Test patches (home testing) sit LAST on the Nests page, with friendly
  // labels, and are always shown even when they hold no nests -- mirroring the
  // ordering nests.R bakes in.
  var API_TEST_PATCH_LABELS = {
    test_snedgen_park: "Test: Snedgen Park",
    test_long_branch: "Test: Long branch"
  };
  var API_TEST_PATCH_ORDER = ["test_snedgen_park", "test_long_branch"];

  function apiPatchIsTest(patch) {
    return String(patch || "").indexOf("test_") === 0;
  }

  // Patch render order matching nests.R: real patches alphabetically, then the
  // test patches in fixed label order (always present, even with no nests).
  function apiOrderedPatches(byPatch) {
    var real = Object.keys(byPatch).filter(function (p) {
      return !API_TEST_PATCH_LABELS.hasOwnProperty(p);
    }).sort();
    return real.concat(API_TEST_PATCH_ORDER);
  }

  // Wire the "close others in the group" behavior across a rebuilt patch-
  // accordion group. page_glue.js binds this to the baked accordions at
  // DOMContentLoaded, so replacing that DOM drops it; the per-header open/close
  // toggle is wired by apiCreatePatchGroup, and this second listener (registered
  // after it, so it sees the panel already toggled open) collapses the siblings.
  function apiWireCloseOthers(groupRoot) {
    if (!groupRoot) return;
    var accs = groupRoot.querySelectorAll(":scope > .accordion");
    Array.prototype.forEach.call(accs, function (acc) {
      acc.addEventListener("click", function () {
        var tp = acc.nextElementSibling;
        if (!tp || !tp.classList.contains("panel") ||
            tp.style.display !== "block") return;
        Array.prototype.forEach.call(accs, function (other) {
          if (other === acc) return;
          var p = other.nextElementSibling;
          if (p && p.classList.contains("panel") &&
              p.style.display === "block") {
            p.style.display = "none";
            other.classList.remove("active");
          }
        });
      });
    });
  }

  // Full, API-driven rebuild of the Nests-page list from window.fieldApiNests.
  // Clears BOTH views of all nest content (baked + previously injected) and
  // regenerates every patch group and nest button, so a nest re-homes to its
  // CURRENT patch when its patch_id changes in the DB. Self-wires the accordion
  // open/close + close-others behavior (lost when the baked DOM is replaced) and
  // recomputes patch counts. Idempotent -- safe to call on every reRender. Gated
  // on the API set being present: with no live nests it leaves the baked list in
  // place as the offline fallback rather than blanking the page.
  // Nests discovered on THIS device (point_class "Nest" in the waypoint cache)
  // that a live GET /nests hasn't reflected yet -- surfaced as lightweight rows
  // so a just-entered nest appears on the Nests page immediately instead of
  // vanishing until the change-feed round-trips. species_code UNKN keeps the
  // discovery blank; is_current 1 groups it with live nests.
  function localCreatedNests() {
    var out = [];
    loadWaypoints().forEach(function (w) {
      if (!w || w.point_class !== "Nest" || !w.point_name) return;
      out.push({
        nest_id: w.point_name,
        patch_id: (testPatchForName(w.point_name) || w.patch_id || null),
        species_code: w.species_code || "UNKN",
        is_current: 1,
        _localCreated: true
      });
    });
    return out;
  }

  // The patch a nest is GROUPED under. Test-site nests must land under the
  // "Test: ..." group, not their raw patch name: the DB stores their patch_id as
  // "snedgen_park" / "long_branch", but the app keys/labels test patches as
  // "test_snedgen_park" / "test_long_branch". Recognize a test nest by its id
  // (NSP##/NLB##) OR by that raw patch name, and map it to the test key.
  function apiNestPatchKey(n) {
    var byName = testPatchForName(n && n.nest_id);
    if (byName) return byName;
    var raw = String((n && n.patch_id) || "").toLowerCase();
    if (raw === "snedgen_park") return "test_snedgen_park";
    if (raw === "long_branch") return "test_long_branch";
    return (n && n.patch_id) || "Unknown";
  }

  function fieldRenderNestsFromApi() {
    var doc = document.getElementById("nestsDoc");
    if (!doc) return;
    // Start from the live API set, then fold in any app-created nests the API
    // hasn't caught up to yet (deduped by nest_id) so mobile point-entry nests
    // show on the Nests page right away.
    var nests = (window.fieldApiNests || []).slice();
    var haveId = {};
    nests.forEach(function (n) { if (n && n.nest_id) haveId[n.nest_id] = true; });
    localCreatedNests().forEach(function (ln) {
      if (ln.nest_id && !haveId[ln.nest_id]) { haveId[ln.nest_id] = true; nests.push(ln); }
    });
    if (!nests.length) return;   // offline / not loaded: keep the baked fallback

    var groupRoot = doc.querySelector("#nest-view-patch .patch-accordion-group");
    var allGroup = doc.querySelector("#nest-view-all .nest-btn-group");
    if (!groupRoot && !allGroup) return;

    // Bucket every live nest by its CURRENT patch (re-homing on patch_id change).
    // A missing patch mirrors nests.R's replace_na -> "Unknown".
    var byPatch = {};
    nests.forEach(function (n) {
      if (!n || !n.nest_id) return;
      var p = apiNestPatchKey(n);
      (byPatch[p] = byPatch[p] || []).push(n);
    });

    // Sort within a patch, and the flat all-view, by nest_id (matching the
    // split()-by-nest_id ordering nests.R uses).
    function byNestId(a, b) {
      var ka = (a && a.nest_id) || "", kb = (b && b.nest_id) || "";
      return ka < kb ? -1 : (ka > kb ? 1 : 0);
    }
    Object.keys(byPatch).forEach(function (p) { byPatch[p].sort(byNestId); });

    // Clear ALL prior nest content (baked + previously injected) from both views.
    if (groupRoot) groupRoot.innerHTML = "";
    if (allGroup) allGroup.innerHTML = "";

    // Grouped view: one accordion per patch, in nests.R order. Nests in a test
    // patch are always current (nests.R forces is_current there), so the group
    // and its buttons flag current regardless of the DB value.
    if (groupRoot) {
      apiOrderedPatches(byPatch).forEach(function (patch) {
        var list = byPatch[patch] || [];
        var isTest = apiPatchIsTest(patch);
        var anyCurrent = isTest ||
          list.some(function (n) { return !!n.is_current; });
        var label = API_TEST_PATCH_LABELS[patch] || patch;
        var grp = apiCreatePatchGroup(groupRoot, patch, anyCurrent, label);
        list.forEach(function (n) {
          var btn = apiMakeNestBtn(n);
          if (isTest) btn.setAttribute("data-current", "true");
          grp.appendChild(btn);
        });
      });
      apiUpdatePatchCounts(groupRoot);
      // Re-attach the close-others behavior across the rebuilt group.
      apiWireCloseOthers(groupRoot);
    }

    // Flat "all" view: every nest, sorted by id, carrying the same live flags.
    if (allGroup) {
      nests.slice().filter(function (n) { return n && n.nest_id; })
        .sort(byNestId)
        .forEach(function (n) {
          var btn = apiMakeNestBtn(n);
          if (apiPatchIsTest(n.patch_id)) btn.setAttribute("data-current", "true");
          allGroup.appendChild(btn);
        });
    }
  }

  // Merge API nests into the detail map + rebuild the list. Exposed so the wiring
  // layer (or a manual refresh) can call it; also folded into window.fieldRefresh.
  // The list rebuild (fieldRenderNestsFromApi) is fully API-driven and re-homes a
  // nest to its current patch group. The page_glue group/current/today toggles are
  // CSS classes on #nestsDoc + the view containers, which persist across a button
  // rebuild, so the user's current filter view is preserved without re-triggering
  // it; the rebuilt buttons/headers carry the same data-current/data-patch/
  // data-today attributes those filters key off.
  function fieldRefreshNests() {
    try { fieldMergeApiNestInfo(); } catch (e) {}
    try { fieldRenderNestsFromApi(); } catch (e) {}
  }
  window.fieldRefreshNests = fieldRefreshNests;

  // Coarse re-render hook for the API wiring layer (nestapi_wiring.js), which
  // lives outside this IIFE and so can't reach renderWaypoints directly. Called
  // after a boot data-load or a change-feed batch repopulates the globals.
  window.fieldRefresh = function () {
    try { if (typeof renderWaypoints === "function") renderWaypoints(); } catch (e) {}
    fieldRefreshNests();
  };

  // Infra nav-points (coverboards + trail cameras) come from the live
  // v_map_point rows, so the Waypoint manager reflects live data. The baked
  // fieldNavPoints are the fallback when the rows are absent (offline boot).

  var NAV_TYPE_FROM_CLASS = { coverboard: "Coverboard", trailcam: "Trail camera" };

  function apiNavInfraPoints() {
    var mp = window.fieldMapMarkers || [];
    var out = [];
    mp.forEach(function (p) {
      if (!p) return;
      var type = NAV_TYPE_FROM_CLASS[String(p["class"] || "").toLowerCase()];
      if (!type) return;
      if (p.lat == null || p.lng == null || isNaN(p.lat) || isNaN(p.lng)) return;
      out.push({
        point_id: p.idx || null,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        type: type,
        point_class: String(p["class"]).toLowerCase(),
        note: p.note || null,
        photo: null
      });
    });
    return out;
  }

  // The baked nav points with coverboards/trail cameras swapped for the live API
  // set. Nests stay baked here (drawn by the API nest overlay elsewhere). Falls
  // back to the baked infra when the API carries none.
  function navPointsForManager() {
    var baked = window.fieldNavPoints || [];
    var infra = apiNavInfraPoints();
    if (!infra.length) return baked;
    var kept = baked.filter(function (p) {
      return !NAV_TYPE_FROM_CLASS[String((p && p.point_class) || "").toLowerCase()];
    });
    return kept.concat(infra);
  }

  function renderNavPoints() {
    if (!listEl) return;
    var pts = navPointsForManager();
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

  // Direct entry point to the add-interval flow for a nest (the map popup calls
  // this for parity with the Modify sub-menu's "Add interval check"). Guarded so
  // a missing id or an un-ready form never throws.
  window.fieldAddInterval = function (nestId) {
    if (!nestId) return;
    if (typeof openIntervalData !== "function") return;
    openIntervalData({ nestId: nestId, mode: "add" });
  };
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

    // The prompt IS the camera/control decision now -- picking either one both
    // confirms the action and sets the designation, so there is no separate
    // yes/no step and no dropdown to set beforehand.

    fieldChoose(
      "Make an artificial nest at " + modifyNestId + "'s point — camera or " +
        "control? Adds an Artificial nest discovery and a first check with " +
        "2 host eggs.",
      [
        { label: "Control", value: "Control" },
        { label: "Camera", value: "Camera" }
      ],
      function (choice) { makeArtificialNest(modifyNestId, choice); }
    );
  });
  var nmAddNestDisc = document.getElementById("nmAddNestDiscovery");
  if (nmAddNestDisc) nmAddNestDisc.addEventListener("click", function () {
    if (window.fieldAddNestAtPoint) window.fieldAddNestAtPoint(modifyNestId);
  });
  var nmAddGps = document.getElementById("nmAddGps");
  if (nmAddGps) nmAddGps.addEventListener("click", function () {
    startNewNestPoint(modifyNestId);
  });
  var nmReRec = document.getElementById("nmReRecordGps");
  if (nmReRec) nmReRec.addEventListener("click", function () {
    if (window.fieldReRecordNestPoint) window.fieldReRecordNestPoint(modifyNestId);
  });

  // ---- Delete a nest / its intervals / its GPS point (Modify nest menu) ----
  // Each enqueues a DELETE to the API (optimistic; the queue flushes + syncs),
  // then refreshes the map/list. The three server routes cascade appropriately;
  // the GPS-point route also refuses a shared point, but the button is hidden in
  // that case (see fieldOpenNestModify) so it never gets that far.

  // A nest's GPS point id, and whether that point carries a second nest -- both
  // by FK (gps_point_id) off the live GET /nests list, never by name.

  function nestPointId(nestId) {
    var nests = window.fieldApiNests || [];
    for (var i = 0; i < nests.length; i++) {
      if (nests[i] && nests[i].nest_id === nestId) {
        return nests[i].gps_point_id || null;
      }
    }
    return null;
  }

  function pointSharedByTwoNests(nestId) {
    var pid = nestPointId(nestId);
    if (!pid) return false;
    var nests = window.fieldApiNests || [];
    var count = 0;
    for (var i = 0; i < nests.length; i++) {
      if (nests[i] && nests[i].gps_point_id === pid) count++;
    }
    return count > 1;
  }
  window.fieldPointSharedByTwoNests = pointSharedByTwoNests;

  // Everything the Modify menu needs to decide which buttons apply, whether the
  // target is a full nest or a bare gps_point (a waypoint with no nest data).
  // The point is resolved by id (works when there is no nest, e.g. a stray
  // point); `shared` counts nests on that point; `hasIntervals` reads the
  // latest-check the nests list already carries.

  function modifyContext(id) {
    var nests = window.fieldApiNests || [];
    var nestRow = null;
    for (var i = 0; i < nests.length; i++) {
      if (nests[i] && nests[i].nest_id === id) { nestRow = nests[i]; break; }
    }
    var pt = mapPointForNest(id) || mapPointByName(id);
    var pid = pt ? pt.idx : (nestRow ? nestRow.gps_point_id : null);
    var shareCount = 0;
    if (pid) {
      for (var j = 0; j < nests.length; j++) {
        if (nests[j] && nests[j].gps_point_id === pid) shareCount++;
      }
    }
    return {
      pointId: pid,
      hasCoords: !!pt || !!(nestRow && nestRow.gps_point_id),
      isNest: !!nestRow,
      hasIntervals: !!(nestRow && nestRow.last_check != null && nestRow.last_check !== ""),
      shared: shareCount > 1
    };
  }
  window.fieldModifyContext = modifyContext;

  function enqueueDelete(kind, endpoint, tempId) {
    return NestApi.queue.enqueue({
      kind: kind,
      tempId: tempId || undefined,
      endpoint: endpoint,
      method: "DELETE",
      body: null,
      idemKey: NestApi.api.newIdemKey()
    });
  }

  function afterDelete(msg) {
    flushSoon();
    if (window.fieldRefresh) window.fieldRefresh();
    showUploadModal(msg);
    closeMenu();
  }

  var nmDelInt = document.getElementById("nmDeleteIntervals");
  if (nmDelInt) nmDelInt.addEventListener("click", function () {
    if (!modifyNestId) return;
    fieldConfirm(
      "Delete ALL interval checks for " + modifyNestId +
        "? The nest and its point stay.",
      function () {
        enqueueDelete(
          "deleteNestIntervals",
          "/nests/" + encodeURIComponent(modifyNestId) + "/intervals",
          modifyNestId
        );
        afterDelete("Interval data deleted for " + modifyNestId + ".");
      }
    );
  });

  var nmDelDisc = document.getElementById("nmDeleteDiscovery");
  if (nmDelDisc) nmDelDisc.addEventListener("click", function () {
    if (!modifyNestId) return;
    fieldConfirm(
      "Delete " + modifyNestId + "'s discovery data (and its interval checks)? " +
        "The GPS point stays.",
      function () {
        enqueueDelete(
          "deleteNest",
          "/nests/" + encodeURIComponent(modifyNestId),
          modifyNestId
        );
        afterDelete("Discovery data deleted for " + modifyNestId + ".");
      }
    );
  });

  var nmDelGps = document.getElementById("nmDeleteGps");
  if (nmDelGps) nmDelGps.addEventListener("click", function () {
    if (!modifyNestId) return;
    var ctx = modifyContext(modifyNestId);
    if (!ctx.pointId) {
      showUploadModal("No GPS point on record for " + modifyNestId + ".");
      return;
    }
    var bare = !ctx.isNest;
    var msg = bare
      ? "Delete waypoint " + modifyNestId + "? This removes the GPS point. This " +
        "cannot be undone."
      : "Delete " + modifyNestId + "'s GPS point? This removes the point AND the " +
        "nest's discovery and interval data. This cannot be undone.";
    fieldConfirm(msg, function () {
      enqueueDelete(
        "deletePoint",
        "/gps_points/" + encodeURIComponent(ctx.pointId),
        ctx.pointId
      );
      afterDelete((bare ? "Waypoint" : "GPS point") + " deleted for " + modifyNestId + ".");
    });
  });

  // Delete buttons on the discovery + interval forms (edit mode only).

  var ndDeleteBtn = document.getElementById("ndDeleteBtn");
  if (ndDeleteBtn) ndDeleteBtn.addEventListener("click", function () {
    if (!nestDataCtx || nestDataCtx.mode !== "edit") return;
    fieldConfirm("Delete this nest's discovery row?", function () {
      var st = document.getElementById("nestDataStatus");
      if (st) st.textContent = "Deleting…";
      deleteSheetRow("nest_level", nestDataCtx.sheetRow,
        function () { showUploadModal("Nest data deleted."); closeMenu(); },
        function (msg) { if (st) st.textContent = msg; });
    });
  });

  var intervalDeleteBtn = document.getElementById("intervalDeleteBtn");
  if (intervalDeleteBtn) intervalDeleteBtn.addEventListener("click", function () {
    if (!intervalCtx || intervalCtx.mode !== "edit") return;
    fieldConfirm("Delete this interval check?", function () {
      var st = document.getElementById("intervalStatus");
      if (st) st.textContent = "Deleting…";
      deleteSheetRow("interval_level", intervalCtx.sheetRow,
        function () { showUploadModal("Interval check deleted."); closeMenu(); },
        function (msg) { if (st) st.textContent = msg; });
    });
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
      fieldConfirm(
        "Clear cached waypoints? (Points still waiting to upload are kept so " +
          "they can go up when you reconnect.)",
        function () {

          // Remove every cached waypoint's marker from the map. Still-pending
          // points stay in the cache + the manager (off the map) so they can
          // still upload.

          arr.forEach(function (w) { removeWaypointMarker(w.point_id); });
          var keep = arr
            .filter(isPending)
            .map(function (w) { w.visible = false; return w; });
          storeWaypoints(keep);
          renderWaypoints();
          retryPendingUploads();
        }
      );
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

      clearTrackRecovery();

      // The 1s tick is the single backup hook: it already runs for the whole
      // recording, so it covers every place a vertex gets pinned. The
      // length check keeps it to one write per new vertex, not one per second.

      if (clockIv) clearInterval(clockIv);
      clockIv = setInterval(function () {
        updateReadout();
        if (committed.length !== _recoverySaved) saveTrackRecovery();
      }, 1000);

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
    saveTrackRecovery();
    trackStatus("Stopped — " + committed.length + " vertices, " +
      fmtDist(trackDistance(committed)) + ".");
    updateTrackUI();
  }

  // Back the track up the moment the page is hidden: that is precisely when iOS
  // reclaims a WKWebView's memory, and the reload that follows is what lost the
  // track in the field.

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) saveTrackRecovery();
  });

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

  // All drawn tracks live in one feature group, registered with the widget's
  // layerManager so the main layers control owns the Tracks checkbox alongside
  // Nests / Coverboards / Trail Cameras / Point Counts.

  var tracksGroup = null;

  function ensureTracksGroup() {
    if (!tracksGroup && window.L && window.L.featureGroup) {
      tracksGroup = window.L.featureGroup();

      var map = window.fieldMap;

      if (map && map.layerManager &&
          typeof map.layerManager.addLayer === "function") {
        try {
          map.layerManager.addLayer(
            tracksGroup,
            "shape",
            "tracks-group",
            "Tracks"
          );
        } catch (e) {
          tracksGroup.addTo(map);
        }
      } else if (map) {
        tracksGroup.addTo(map);
      }
    }
    return tracksGroup;
  }

  function loadTracks() {
    try { return JSON.parse(localStorage.getItem(TRACKS_KEY)) || []; }
    catch (e) { return []; }
  }
  function storeTracks(arr) {
    try { localStorage.setItem(TRACKS_KEY, JSON.stringify(arr)); return true; }
    catch (e) { return false; }
  }

  // ---- crash recovery for the IN-PROGRESS track -------------------------
  // `committed` lived only in memory, so anything that reloaded the page --
  // an iOS memory-pressure jettison, a crash, a stray refresh -- silently
  // threw away the whole walk. Vertices are mirrored here as they are pinned,
  // and offered back on the next boot.

  var RECOVERY_KEY = "fieldTrackRecovery";
  var _recoverySaved = -1;

  // Deliberately not gated on `tracking`: a stopped-but-unsaved track is just
  // as losable, and that is the window where someone is standing still fiddling
  // with the name field.

  function saveTrackRecovery() {
    if (!committed.length) return;
    try {
      localStorage.setItem(RECOVERY_KEY, JSON.stringify({
        committed: committed,
        startMs: startMs,
        patch_id: trackPatchId,
        name: (trackNameEl && trackNameEl.value) || trackAutoName || "",
        note: (trackNoteEl && trackNoteEl.value) || "",
        activity: trackActivity(),
        saved_at: new Date().toISOString()
      }));
      _recoverySaved = committed.length;
    } catch (e) {

      // A full quota is exactly when a long track matters most, so say so
      // rather than failing mute.

      trackStatus("Warning: couldn't back up this track (storage full).");
    }
  }

  function clearTrackRecovery() {
    _recoverySaved = -1;
    try { localStorage.removeItem(RECOVERY_KEY); } catch (e) {}
  }

  function loadTrackRecovery() {
    try { return JSON.parse(localStorage.getItem(RECOVERY_KEY)) || null; }
    catch (e) { return null; }
  }

  // ---- track sync (shared across devices via the API) -------------------
  // Tracks live in localStorage per device; these mirror creates/edits/deletes
  // to the server so a track recorded on one phone appears on the others. All
  // optimistic (enqueue + flush in the background); no-ops without an API token.

  function trackSyncEnabled() {
    return typeof apiEnabled === "function" && apiEnabled() && window.NestApi;
  }
  function trackApiBody(t) {
    return {
      track_id: t.id,
      name: t.name,
      activity: t.activity || "other",
      patch_id: t.patch_id || null,
      length_m: t.length || 0,
      note: t.note || null,
      points: t.points || []
    };
  }
  function enqueueTrackOp(op) {
    op.idemKey = NestApi.api.newIdemKey();
    NestApi.queue.enqueue(op)
      .then(function () { if (typeof flushSoon === "function") flushSoon(); })
      .catch(function () {});
  }
  function syncTrackCreate(t) {
    if (!trackSyncEnabled()) return;
    enqueueTrackOp({
      kind: "createTrack", tempId: t.id,
      endpoint: "/tracks", method: "POST", body: trackApiBody(t)
    });
  }
  function syncTrackUpdate(t) {
    if (!trackSyncEnabled()) return;
    enqueueTrackOp({
      kind: "updateTrack", tempId: t.id,
      endpoint: "/tracks/" + encodeURIComponent(t.id), method: "PATCH",
      body: {
        name: t.name,
        note: t.note || null,
        activity: t.activity || "other",
        patch_id: t.patch_id || null
      }
    });
  }
  function syncTrackDelete(id) {
    if (!trackSyncEnabled()) return;
    enqueueTrackOp({
      kind: "deleteTrack", tempId: id,
      endpoint: "/tracks/" + encodeURIComponent(id), method: "DELETE", body: null
    });
  }

  // Merge server tracks into the local store (called by nestapi_wiring after a
  // GET /tracks). New tracks are added hidden (visible:false) so they populate
  // the manager without cluttering the map; the user toggles them on.
  window.fieldMergeApiTracks = function (serverTracks) {
    if (!Array.isArray(serverTracks) || !serverTracks.length) return;
    var local = loadTracks();
    var have = {};
    local.forEach(function (t) { have[String(t.id)] = true; });
    var added = 0;
    serverTracks.forEach(function (st) {
      var id = st && st.track_id;
      if (!id || have[String(id)]) return;
      local.push({
        id: id,
        name: st.name || id,
        time: st.created_at || "",
        note: st.note || "",
        points: Array.isArray(st.points) ? st.points : [],
        length: st.length_m || 0,
        visible: false,
        activity: st.activity || "other",
        patch_id: st.patch_id || null,
        _fromServer: true
      });
      added++;
    });
    if (added > 0) {
      storeTracks(local);
      renderTrackList();
    }
  };

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
    var line = window.L.polyline(trackLatLngs(t), SAVED_STYLE)
      .bindPopup(trackPopupHtml(t));
    savedLayers[t.id] = line;
    var grp = ensureTracksGroup();
    if (grp) grp.addLayer(line);
    else line.addTo(window.fieldMap);
  }
  // Update an on-map track's popup after edits

  function refreshSavedTrack(t) {
    if (savedLayers[t.id]) savedLayers[t.id].setPopupContent(trackPopupHtml(t));
  }
  function hideSavedTrack(id) {
    if (savedLayers[id]) {
      if (tracksGroup) tracksGroup.removeLayer(savedLayers[id]);
      else if (window.fieldMap) window.fieldMap.removeLayer(savedLayers[id]);
    }
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
        fieldConfirm(
          "Are you sure? This will delete the previous track!",
          function () {
            trackMenu.hidden = true;
            startRecordNew(t);
          }
        );
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
        syncTrackUpdate(t);
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
        syncTrackUpdate(t);
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
        syncTrackDelete(t.id);
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

  // Persist a track locally, enqueue it to the server (createTrack -> POST
  // /tracks, optimistic) so it appears on other devices, and draw it. The DB is
  // the shared source of truth; the local store + queued POST are the backups,
  // so we do NOT auto-download a GeoJSON here (that file landed in the user's
  // Drive on every save and wasn't shareable). An explicit "Download (GeoJSON)"
  // button in the track manager still exports one on demand.

  // The single funnel for both save paths (normal + averaged), so it is also
  // the one place the crash-recovery copy is retired -- only ever AFTER the
  // track is safely in storage.

  function commitSavedTrack(t) {
    var arr = loadTracks();
    arr.push(t);
    if (!storeTracks(arr)) {
      trackStatus("Couldn't save the track — storage is full.");
      return;
    }
    clearTrackRecovery();
    syncTrackCreate(t);   // share to the server (optimistic; no-op without token)
    drawSavedTrack(t);
    renderTrackList();
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
            visible: true,
            activity: orig.activity || "other",
            patch_id: orig.patch_id || null
          };
          if (activeLine && window.fieldMap) window.fieldMap.removeLayer(activeLine);
          activeLine = null; committed = [];
          // commitSavedTrack enqueues createTrack -> POST /tracks so the
          // averaged track is shared to the server (appears on other devices).
          commitSavedTrack(at);
          if (trackNameEl) trackNameEl.value = "";
          if (trackNoteEl) trackNoteEl.value = "";
          trackStatus(trackSyncEnabled()
            ? "Saved averaged track \"" + at.name + "\" and queued to the server."
            : "Saved averaged track \"" + at.name + "\".");
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
      // commitSavedTrack persists locally AND enqueues createTrack -> POST
      // /tracks (optimistic, flushed in the background) so the track reaches the
      // server and shows up on other devices via getTracks. We deliberately do
      // NOT fan the track's vertices out to /gps_points here: that old path
      // treated each vertex as a waypoint (bad data) and popped a misleading
      // "uploaded" modal while the real cross-device save is the track itself.
      commitSavedTrack(t);
      showUploadModal(trackSyncEnabled()
        ? "Track \"" + t.name + "\" saved and queued to the server."
        : "Track \"" + t.name + "\" saved on this device.");
      if (replaceTarget) {
        var replacedId = replaceTarget;
        hideSavedTrack(replacedId);
        var keepTracks = loadTracks().filter(function (x) { return x.id !== replacedId; });
        storeTracks(keepTracks);
        replaceTarget = null;
        // The old track was already shared; remove it server-side too.
        syncTrackDelete(replacedId);
        renderTrackList();
      }
      if (trackNameEl) trackNameEl.value = "";
      if (trackNoteEl) trackNoteEl.value = "";
      trackStatus(trackSyncEnabled()
        ? "Track saved and queued to the server."
        : "Track saved on this device.");
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
      clearTrackRecovery();
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
    ensureTracksGroup();
  });
  renderTrackList();
  updateReadout();
  updateTrackUI();

  // Recover a track the last run was in the middle of. It comes back STOPPED,
  // not recording: the GPS gap since the crash is unknown, so resuming would
  // draw a straight line across wherever the walk actually went. The vertices
  // are restored and the user saves or clears them.

  function restoreTrackInProgress() {
    var rec = loadTrackRecovery();
    if (!rec || !rec.committed || rec.committed.length < 2) {
      if (rec) clearTrackRecovery();
      return;
    }
    whenMapReady(function (map) {
      committed = rec.committed;
      live = null;
      tracking = false;
      startMs = rec.startMs || 0;
      trackPatchId = rec.patch_id || "patch-none";
      trackAutoName = rec.name || "";
      if (trackNameEl && rec.name) trackNameEl.value = rec.name;
      if (trackNoteEl && rec.note) trackNoteEl.value = rec.note;
      if (trackActivityEl && rec.activity) trackActivityEl.value = rec.activity;
      activeLine = window.L
        .polyline(
          committed.map(function (p) { return [p.lat, p.lng]; }),
          TRACK_STYLE
        )
        .addTo(map);
      updateReadout();
      updateTrackUI();
      trackStatus(
        "Recovered an unsaved track (" + committed.length + " vertices, " +
        fmtDist(trackDistance(committed)) + ") from " +
        String(rec.saved_at || "").slice(11, 16) +
        ". Save it or clear it."
      );
      showUploadModal(
        "Recovered a track the app lost (" + committed.length +
        " vertices). It's on the map under Tracks — save or clear it."
      );
    });
  }

  restoreTrackInProgress();

  // ---- Concealment photos ------------------------------------------------

  // Nest-concealment photos are captured in the standalone Concealment Camera
  // app (native iOS), which locks focus at ~1 m and stamps the compass bearing
  // -- neither of which the in-app web camera can do (iOS Safari/WKWebView does
  // not expose focus lock to JS). This screen just picks the nest and hands off
  // to that app via its custom URL scheme; the native app owns capture, bearing,
  // and (separately) upload.

  (function () {
    var nestBtn = document.getElementById("concealNestBtn");
    var launchBtn = document.getElementById("concealLaunchBtn");
    var statusEl = document.getElementById("concealStatus");
    if (!launchBtn) return;

    // The custom URL scheme the Concealment Camera app registers (see its
    // project.yml / Info.plist CFBundleURLTypes).
    var CONCEAL_APP_URL = "concealcam://capture";

    var selectedNest = null;

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

    // Hand off to the native Concealment Camera app, passing the chosen nest id
    // as the label so its filename / EXIF carry it. If the app isn't installed
    // the deep link simply does nothing, so nudge the tech after a moment.
    launchBtn.addEventListener("click", function () {
      if (!selectedNest) { status("Choose a nest first."); return; }
      status("Opening Concealment Camera…");
      var url = CONCEAL_APP_URL + "?label=" + encodeURIComponent(selectedNest.name);
      // Hand the API token across too so the camera app never needs its own
      // Settings/token entry -- it stores what we pass and uploads with it. Uses
      // the same per-user token this app already holds (revocable server-side).
      var token = (window.NestApi && window.NestApi.settings &&
                   typeof window.NestApi.settings.getToken === "function")
        ? window.NestApi.settings.getToken() : "";
      if (token) url += "&token=" + encodeURIComponent(token);
      window.location.href = url;
      setTimeout(function () {
        status("If nothing opened, install / enable the Concealment Camera app.");
      }, 1500);
    });
  })();

