// Data entry / modification: waypoint add+modify, nest discovery, interval,
// pickers. Assembled into the single field-map IIFE at build.

  function ndEl(id) { return document.getElementById(id); }

  function buildNestChoices() {
    var sp = ndEl("ndSpecies");
    if (sp && !sp.options.length) {
      sp.add(new Option("— choose species —", ""));
      NEST_SPECIES.forEach(function (s) {
        sp.add(new Option(s[0] + " (" + s[1] + ")", s[1]));
      });
      sp.add(new Option("Other…", "__other__"));
    }
    var su = ndEl("ndSubstrate");
    if (su && !su.options.length) {
      NEST_SUBSTRATES.forEach(function (name) { su.add(new Option(name, name)); });
      su.add(new Option("Other…", "__other__"));
    }
  }

  function openFieldPicker(selectEl, title, multi, onApply) {
    if (!selectEl) return;
    var overlay = document.createElement("div");
    overlay.className = "field-patch-overlay";
    var inner = document.createElement("div");
    inner.className = "field-patch-overlay-inner";
    var t = document.createElement("div");
    t.className = "field-patch-overlay-title";
    t.textContent = title || "Choose";
    inner.appendChild(t);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    Array.prototype.forEach.call(selectEl.options, function (opt) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "field-patch-overlay-row";
      if (opt.selected) row.className += " is-selected";
      row.textContent = opt.textContent;
      row.addEventListener("click", function () {
        if (multi) {
          opt.selected = !opt.selected;
          row.classList.toggle("is-selected", opt.selected);
        } else {
          Array.prototype.forEach.call(selectEl.options, function (o) { o.selected = false; });
          opt.selected = true;
          selectEl.dispatchEvent(new Event("change"));
          if (onApply) onApply();
          close();
        }
      });
      inner.appendChild(row);
    });
    if (multi) {
      var done = document.createElement("button");
      done.type = "button";
      done.className = "field-patch-overlay-row field-picker-done";
      done.textContent = "Done";
      done.addEventListener("click", function () {
        selectEl.dispatchEvent(new Event("change"));
        if (onApply) onApply();
        close();
      });
      inner.appendChild(done);
    }
    overlay.appendChild(inner);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  function pickerLabel(selectEl, btnEl, placeholder, multi) {
    if (!selectEl || !btnEl) return;
    if (multi) {
      var chosen = [];
      Array.prototype.forEach.call(selectEl.options, function (o) {
        if (o.selected) chosen.push(o.textContent);
      });
      btnEl.textContent = chosen.length ? chosen.join(", ") : placeholder;
    } else {
      var opt = selectEl.options[selectEl.selectedIndex];
      btnEl.textContent = (opt && opt.value !== "") ? opt.textContent : placeholder;
    }
  }

  function wireNestPicker(btnId, selectId, title, placeholder, multi, extra) {
    var btn = ndEl(btnId), sel = ndEl(selectId);
    if (!btn || !sel) return;
    btn.addEventListener("click", function () {
      openFieldPicker(sel, title, multi, function () {
        pickerLabel(sel, btn, placeholder, multi);
        if (extra) extra();
      });
    });
  }

  function syncNestOther() {
    var sp = ndEl("ndSpecies"), spOther = ndEl("ndSpeciesOtherField");
    if (sp && spOther) spOther.style.display = (sp.value === "__other__") ? "" : "none";
    var su = ndEl("ndSubstrate"), suOther = ndEl("ndSubstrateOtherField");
    if (su && suOther) {
      var hasOther = false;
      Array.prototype.forEach.call(su.options, function (o) {
        if (o.selected && o.value === "__other__") hasOther = true;
      });
      suOther.style.display = hasOther ? "" : "none";
    }
  }

  function defaultPatchForNest(nestId, lat, lng) {
    var id = String(nestId || "");
    if (/^NLB\d/i.test(id)) return "long_branch";
    if (/^NSP\d/i.test(id)) return "snedgen_park";
    return closestPatch(lat, lng, 1e9);
  }

  function fillNestPatchOptions(selected) {
    var sel = ndEl("ndPatchId");
    if (!sel) return;
    sel.innerHTML = "";
    var names = window.fieldPatches ? Object.keys(window.fieldPatches).sort() : [];
    if (selected && selected !== "patch-none" && names.indexOf(selected) < 0) {
      names.unshift(selected);
    }
    names.forEach(function (n) {
      var o = document.createElement("option");
      o.value = n; o.textContent = n;
      if (n === selected) o.selected = true;
      sel.appendChild(o);
    });
    var none = document.createElement("option");
    none.value = "patch-none"; none.textContent = "(none / unknown)";
    if (selected === "patch-none" || !names.length) none.selected = true;
    sel.appendChild(none);
    pickerLabel(sel, ndEl("ndPatchBtn"), "Patch", false);
  }

  function resetNestFields() {
    if (ndEl("ndSpecies")) ndEl("ndSpecies").selectedIndex = 0;
    var su = ndEl("ndSubstrate");
    if (su) Array.prototype.forEach.call(su.options, function (o) { o.selected = false; });
    ndEl("ndSpeciesOther").value = "";
    ndEl("ndSubstrateOther").value = "";
    ndEl("ndDiscoveryStage").value = "";
    ndEl("ndSelfieStick").checked = false;
    ndEl("ndArtificialCandidate").checked = false;
    ndEl("ndCameraOrControl").value = "Control";
    ndEl("ndCameraDeploymentDate").value = "";
    ndEl("ndCameraDateWrap").style.display = "none";
    ndEl("ndHeight").value = "";
    ndEl("ndLocationDescription").value = "";
    if (ndEl("ndNote")) ndEl("ndNote").value = "";
    if (ndEl("ndPhoto")) ndEl("ndPhoto").value = "";
    if (ndEl("ndPhotoPreview")) ndEl("ndPhotoPreview").innerHTML = "";
    nestPhoto = null;
    nestPhotoName = null;
    syncNestOther();
    pickerLabel(ndEl("ndSpecies"), ndEl("ndSpeciesBtn"), "Choose species", false);
    pickerLabel(ndEl("ndSubstrate"), ndEl("ndSubstrateBtn"), "Choose substrate", true);
    pickerLabel(ndEl("ndDiscoveryStage"), ndEl("ndDiscoveryStageBtn"), "— select —", false);
    pickerLabel(ndEl("ndCameraOrControl"), ndEl("ndCameraOrControlBtn"), "Control", false);
    var st = ndEl("nestDataStatus");
    if (st) st.textContent = "";
  }

  function openNestData(nestId, lat, lng, date, pointId) {
    nestDataCtx = { nestId: nestId, lat: lat, lng: lng, date: date, pointId: pointId, mode: "add" };
    buildNestChoices();
    resetNestFields();
    ndEl("ndNestId").textContent = nestId;
    ndEl("ndGpsPoint").textContent = nestId;
    ndEl("ndDiscoveryDate").textContent = isoClean(date).slice(0, 10);
    fillNestPatchOptions(defaultPatchForNest(nestId, lat, lng));
    toggleNestEditChrome(false);
    showScreen("nestdata");
  }

  function collectNestRecord() {
    var spSel = ndEl("ndSpecies");
    var spVal = spSel ? spSel.value : "";
    var species = (spVal === "__other__")
      ? ndEl("ndSpeciesOther").value.trim()
      : spVal;

    var subs = [];
    var su = ndEl("ndSubstrate");
    if (su) Array.prototype.forEach.call(su.options, function (o) {
      if (!o.selected) return;
      if (o.value === "__other__") {
        var t = ndEl("ndSubstrateOther").value.trim();
        if (t) subs.push(t);
      } else subs.push(o.value);
    });

    var cam = ndEl("ndCameraOrControl").value;
    var heightVal = ndEl("ndHeight").value.trim();

    return {
      nest_id: nestDataCtx ? nestDataCtx.nestId : null,
      species: species || null,
      patch_id: ndEl("ndPatchId").value,
      discovery_date: nestDataCtx ? (typeof nestDataCtx.date === "string" ? nestDataCtx.date.slice(0, 10) : isoClean(nestDataCtx.date).slice(0, 10)) : null,
      discovery_stage: ndEl("ndDiscoveryStage").value || null,
      selfie_stick: ndEl("ndSelfieStick").checked,
      artificial_candidate: ndEl("ndArtificialCandidate").checked,
      camera_or_control: cam,
      camera_deployment_date: cam === "Camera" ? (ndEl("ndCameraDeploymentDate").value || null) : null,
      height: heightVal ? Number(heightVal) : null,
      substrate: subs.length ? subs.join(", ") : null,
      gps_point: nestDataCtx ? nestDataCtx.nestId : null,
      location_description: ndEl("ndLocationDescription").value.trim() || null
    };
  }

  function uploadNestRow(row, onSuccess, onError) {
    relayPost({ action: "nest_row", row: row }, onSuccess, onError);
  }

  function saveNestData() {
    var rec = collectNestRecord();
    var status = ndEl("nestDataStatus");
    if (!rec.species) {
      if (status) status.textContent = "Pick a species (or type one under Other) first.";
      return;
    }
    if (status) status.textContent = "Saving nest data…";
    if (window.console && console.log) console.log("[nest_level row]", rec);

    // Edit mode: overwrite the existing sheet row and return to the map.

    if (nestDataCtx && nestDataCtx.mode === "edit") {
      updateSheetRow("nest_level", nestDataCtx.sheetRow, rec,
        function () { showUploadModal("Nest data updated for " + rec.nest_id + "."); closeMenu(); },
        function (msg) { if (status) status.textContent = msg; });
      return;
    }

    // The form stays open on failure so the record isn't lost -- Tara can Save
    // again once there's signal.

    uploadNestRow(
      rec,
      function () {

        // The note + photo were captured here but belong to the waypoint saved
        // a screen earlier. Attach them to that waypoint and re-upload it so the
        // Drive copy carries the photo/note.

        var pointId = nestDataCtx ? nestDataCtx.pointId : null;
        var note = ndEl("ndNote") ? ndEl("ndNote").value.trim() : "";
        var photo = nestPhoto || null;
        if (pointId) {
          var updated = updateWaypoint(pointId, function (w) {
            w.note = note;
            w.photo = photo;
            w.photo_name = photo
              ? String(w.point_name).replace(/[^\w-]+/g, "_") + "_" +
                isoClean(new Date()).replace(/:/g, "-") + ".jpg"
              : null;
          });
          if (updated) {
            refreshWaypointMarker(updated);
            uploadToDrive("individual_points",
              updated.point_name + "_" + syncTimestamp() + ".geojson",
              waypointsFC([updated]), null, null);
          }
        }

        // The interval-check form is the acknowledgement; skip the modal.

        openIntervalData({ nestId: nestDataCtx ? nestDataCtx.nestId : null, mode: "add" });
      },
      function (msg) {
        if (status) status.textContent = msg;
      }
    );
  }

  function ivEl(id) { return document.getElementById(id); }

  function ivState() {
    var r = overlay.querySelector('input[name="ivCurrentState"]:checked');
    return r ? r.value : "Empty";
  }

  function applyIntervalState() {
    var active = ivState() === "Active";
    ivEl("ivActiveFields").style.display = active ? "" : "none";
    ivEl("ivEmptyFields").style.display = active ? "none" : "";
    applyIntervalAdult();
  }

  function applyIntervalAdult() {
    var wrap = ivEl("ivAdultActivityWrap");
    if (wrap) wrap.style.display = (ivEl("ivAdultPresent").value === "N") ? "none" : "";
  }

  function resetIntervalFields() {
    var radios = overlay.querySelectorAll('input[name="ivCurrentState"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].checked = (radios[i].value === "Empty");
    }
    ivEl("ivObserver").value = "TNS";
    ivEl("ivNotes").value = "";
    ivEl("ivAdultPresent").value = "N";
    ivEl("ivAdultActivity").value = "BC";
    ivEl("ivHostEggs").value = "0";
    ivEl("ivHostYoung").value = "0";
    ivEl("ivBhcoEggs").value = "0";
    ivEl("ivBhcoYoung").value = "0";
    ivEl("ivNestStatus").value = "IN";
    ivEl("ivYoungStatus").value = "NO";
    ivEl("ivObserverActive").value = "TNS";
    ivEl("ivNotesActive").value = "";
    var st = ivEl("intervalStatus");
    if (st) st.textContent = "";
  }

  function openIntervalData(opts) {
    opts = opts || {};
    var mode = opts.mode || "add";
    var now = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var dateStr = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    var timeStr = pad(now.getHours()) + ":" + pad(now.getMinutes());
    intervalCtx = { nestId: opts.nestId, date: dateStr, mode: mode, sheetRow: null };
    resetIntervalFields();
    ivEl("ivNestId").textContent = opts.nestId || "--";
    ivEl("ivDate").textContent = dateStr;
    ivEl("ivTime").textContent = timeStr;
    intervalCtx.time = timeStr;
    applyIntervalState();
    toggleIntervalEditChrome(false);
    showScreen("intervaldata");
  }

  function collectIntervalRecord() {
    var active = ivState() === "Active";
    var adult = active ? ivEl("ivAdultPresent").value : "";

    // Always include every interval_level column (blank when Empty) so an
    // update fully overwrites the row -- e.g. switching Active -> Empty clears
    // the adult/egg fields rather than leaving stale values behind.

    return {
      nest_id: intervalCtx ? intervalCtx.nestId : null,
      date: intervalCtx ? intervalCtx.date : null,
      time: intervalCtx ? intervalCtx.time : null,
      current_state: ivState(),
      adult_present: active ? adult : "",
      adult_activity: (active && adult !== "N") ? ivEl("ivAdultActivity").value : "",
      host_eggs: active ? Number(ivEl("ivHostEggs").value) : "",
      host_young: active ? Number(ivEl("ivHostYoung").value) : "",
      bhco_eggs: active ? Number(ivEl("ivBhcoEggs").value) : "",
      bhco_young: active ? Number(ivEl("ivBhcoYoung").value) : "",
      nest_status: active ? ivEl("ivNestStatus").value : "",
      young_status: active ? ivEl("ivYoungStatus").value : "",
      observer: active ? ivEl("ivObserverActive").value : ivEl("ivObserver").value,
      notes: (active ? ivEl("ivNotesActive").value : ivEl("ivNotes").value).trim()
    };
  }

  function saveIntervalData() {
    var rec = collectIntervalRecord();
    var status = ivEl("intervalStatus");
    if (status) status.textContent = "Saving…";
    if (window.console && console.log) console.log("[interval_level row]", rec);
    if (intervalCtx && intervalCtx.mode === "edit") {
      updateSheetRow("interval_level", intervalCtx.sheetRow, rec,
        function () { showUploadModal("Interval check updated."); closeMenu(); },
        function (msg) { if (status) status.textContent = msg; });
      return;
    }
    uploadIntervalRow(rec,
      function () { showUploadModal("Interval check saved for " + intervalCtx.nestId + "."); closeMenu(); },
      function (msg) { if (status) status.textContent = msg; });
  }

  function showNestDataPrompt(onYes, onNo) {
    var ov = document.getElementById("fieldNestPrompt");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "fieldNestPrompt";
      ov.className = "field-confirm-overlay";
      var box = document.createElement("div");
      box.className = "field-confirm";
      var text = document.createElement("div");
      text.className = "field-confirm-text";
      text.textContent = "Add nest discovery data?";
      var row = document.createElement("div");
      row.className = "field-confirm-actions";
      var yes = document.createElement("button");
      yes.type = "button";
      yes.className = "field-button";
      yes.textContent = "Yes";
      var no = document.createElement("button");
      no.type = "button";
      no.className = "field-button field-button--danger";
      no.textContent = "No";
      row.appendChild(yes);
      row.appendChild(no);
      box.appendChild(text);
      box.appendChild(row);
      ov.appendChild(box);
      document.body.appendChild(ov);
      ov._yes = yes;
      ov._no = no;
    }
    ov._yes.onclick = function () { ov.classList.remove("is-visible"); if (onYes) onYes(); };
    ov._no.onclick = function () { ov.classList.remove("is-visible"); if (onNo) onNo(); };
    ov.classList.add("is-visible");
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

    // Modify always edits the point's own note/photo in place, so keep those
    // fields visible regardless of class.

    var noteField = document.getElementById("wpNoteField");
    var photoField = document.getElementById("wpPhotoField");
    if (noteField) noteField.style.display = "";
    if (photoField) photoField.style.display = "";
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
    // Every new Nest waypoint goes to the discovery form -- whether its id came
    // from the Nests page (forNest) or was auto-named here (wp.point_name).
    var isNestPoint = (wp.point_class === "Nest");
    if (wp.point_class === "Temp") {
      showUploadModal(wp.point_name + " added (temporary -- not saved).");
    } else {
      uploadToDrive("individual_points", wp.point_name + "_" + syncTimestamp() + ".geojson", waypointsFC([wp]), null, function () {
        markUploaded([wp.point_id]);
        // The nest-discovery form is the acknowledgement for nest points.
        if (!isNestPoint) {
          showUploadModal(forNest ? ("Location saved for " + forNest + ".") : (wp.point_name + " uploaded to Drive."));
        }
      });
    }
    addWaypointMarker(wp);
    renderWaypoints();
    resetAddForm();
    addStatus("");

    // For a nest point, go straight to the nest-discovery form; the GPS
    // location, datetime, and the saved waypoint id are carried into it so the
    // note/photo captured there can be attached back to this waypoint.

    if (isNestPoint) {
      openNestData(wp.point_name, a.lat, a.lng, now, wp.point_id);
    } else {

      // Back to the map view (closeMenu also stops the GPS averaging watch).

      closeMenu();
    }
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
    syncNotedPhotoFields();
  }

  // ---- Sheet CRUD via the Apps Script relay -----------------------------

  function relayPost(payload, onSuccess, onError) {
    if (!WP_SYNC.relayUrl || WP_SYNC.relayUrl.indexOf("PASTE") === 0) {
      if (onError) onError("Sheet sync isn't set up yet.");
      return;
    }
    if (!navigator.onLine) {
      if (onError) onError("No signal — reconnect, then try again.");
      return;
    }
    payload.secret = WP_SYNC.secret;
    payload.study = WP_SYNC.study;
    fetch(WP_SYNC.relayUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function () {
      if (onSuccess) onSuccess();
    }).catch(function () {
      if (onError) onError("Send failed — try again.");
    });
  }

  function uploadIntervalRow(row, onSuccess, onError) {
    relayPost({ action: "interval_row", row: row }, onSuccess, onError);
  }

  function updateSheetRow(sheet, rowNum, values, onSuccess, onError) {
    relayPost({ action: "update_row", sheet: sheet, row: rowNum, values: values }, onSuccess, onError);
  }

  function deleteSheetRow(sheet, rowNum, onSuccess, onError) {
    relayPost({ action: "delete_row", sheet: sheet, row: rowNum }, onSuccess, onError);
  }

  // Live read of a nest's discovery row + interval rows (each with its sheet
  // row number) over the no-cors JSONP channel, mirroring fetchLiveNestIds.

  function fetchNestDetail(nestId, cb) {
    if (!WP_SYNC.relayUrl || WP_SYNC.relayUrl.indexOf("PASTE") === 0 || !navigator.onLine) {
      cb(null); return;
    }
    var name = "__nestDetail_" + Date.now();
    var s = document.createElement("script");
    var done = false;
    function settle() { if (s.parentNode) s.parentNode.removeChild(s); }
    window[name] = function (data) {
      if (done) return;
      done = true;
      settle();
      try { cb(data); } finally { try { delete window[name]; } catch (e) { window[name] = undefined; } }
    };
    setTimeout(function () { if (!done) { done = true; settle(); cb(null); } }, 12000);
    s.onerror = function () { if (!done) { done = true; settle(); cb(null); } };
    s.src = WP_SYNC.relayUrl + "?action=nest_detail&secret=" + encodeURIComponent(WP_SYNC.secret) +
      "&study=" + encodeURIComponent(WP_SYNC.study) +
      "&nest_id=" + encodeURIComponent(nestId) + "&callback=" + name;
    document.body.appendChild(s);
  }

  function sheetTruthy(v) {
    return v === true || v === 1 || v === "1" ||
      (typeof v === "string" && v.toLowerCase() === "true");
  }
  function numText(v) { return (v == null || v === "") ? "0" : String(v); }

  // Lightweight busy overlay (reuses the confirm-overlay styling).

  function showBusy(msg) {
    var ov = document.getElementById("fieldBusy");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "fieldBusy";
      ov.className = "field-confirm-overlay";
      var box = document.createElement("div");
      box.className = "field-confirm";
      var t = document.createElement("div");
      t.className = "field-confirm-text";
      box.appendChild(t);
      ov.appendChild(box);
      document.body.appendChild(ov);
      ov._t = t;
    }
    ov._t.textContent = msg || "Working…";
    ov.classList.add("is-visible");
  }
  function hideBusy() {
    var ov = document.getElementById("fieldBusy");
    if (ov) ov.classList.remove("is-visible");
  }

  // ---- Modify entry points (from the nest Modify sub-menu) ---------------

  function modifyDiscovery(nestId) {
    showBusy("Loading nest data…");
    fetchNestDetail(nestId, function (detail) {
      hideBusy();
      if (!detail) { showUploadModal("Couldn't load nest data — check signal."); return; }
      if (!detail.discovery) { showUploadModal("No discovery row yet for " + nestId + "."); return; }
      openNestDataEdit(nestId, detail.discovery.data, detail.discovery.row);
    });
  }

  function modifyIntervalPick(nestId) {
    showBusy("Loading interval checks…");
    fetchNestDetail(nestId, function (detail) {
      hideBusy();
      if (!detail) { showUploadModal("Couldn't load — check signal."); return; }
      var list = detail.intervals || [];
      if (!list.length) { showUploadModal("No interval checks yet for " + nestId + "."); return; }
      openIntervalPicker(nestId, list);
    });
  }

  function openIntervalPicker(nestId, list) {
    var overlay = document.createElement("div");
    overlay.className = "field-patch-overlay";
    var inner = document.createElement("div");
    inner.className = "field-patch-overlay-inner";
    var t = document.createElement("div");
    t.className = "field-patch-overlay-title";
    t.textContent = "Which check to modify?";
    inner.appendChild(t);
    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    list.forEach(function (item) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "field-patch-overlay-row";
      var d = item.data || {};
      row.textContent = (d.date || "?") + "  " + (d.time || "");
      row.addEventListener("click", function () {
        close();
        openIntervalDataEdit(nestId, item.data, item.row);
      });
      inner.appendChild(row);
    });
    overlay.appendChild(inner);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  // ---- Discovery: edit-mode open + pre-fill -----------------------------

  function toggleNestEditChrome(isEdit) {
    var wp = ndEl("ndWaypointFields");
    if (wp) wp.style.display = isEdit ? "none" : "";
    var del = ndEl("ndDeleteBtn");
    if (del) del.style.display = isEdit ? "" : "none";
    var save = ndEl("nestDataSaveBtn");
    if (save) save.textContent = isEdit ? "Update nest data" : "Save nest data";
  }

  function fillNestForm(data) {
    data = data || {};
    var sp = ndEl("ndSpecies");
    var spVal = (data.species != null) ? String(data.species) : "";
    if (sp) {
      var known = false;
      Array.prototype.forEach.call(sp.options, function (o) { if (o.value === spVal) known = true; });
      if (spVal && known) sp.value = spVal;
      else if (spVal) { sp.value = "__other__"; ndEl("ndSpeciesOther").value = spVal; }
      else sp.selectedIndex = 0;
    }
    fillNestPatchOptions(data.patch_id || "patch-none");
    ndEl("ndDiscoveryStage").value = data.discovery_stage || "";
    ndEl("ndSelfieStick").checked = sheetTruthy(data.selfie_stick);
    ndEl("ndArtificialCandidate").checked = sheetTruthy(data.artificial_candidate);
    var cam = (String(data.camera_or_control || "Control") === "Camera") ? "Camera" : "Control";
    ndEl("ndCameraOrControl").value = cam;
    ndEl("ndCameraDeploymentDate").value =
      data.camera_deployment_date ? String(data.camera_deployment_date).slice(0, 10) : "";
    ndEl("ndCameraDateWrap").style.display = (cam === "Camera") ? "" : "none";
    ndEl("ndHeight").value = (data.height != null && data.height !== "") ? String(data.height) : "";
    var su = ndEl("ndSubstrate");
    var subs = String(data.substrate || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    var others = [];
    if (su) {
      Array.prototype.forEach.call(su.options, function (o) { o.selected = false; });
      subs.forEach(function (nm) {
        var matched = false;
        Array.prototype.forEach.call(su.options, function (o) { if (o.value === nm) { o.selected = true; matched = true; } });
        if (!matched) others.push(nm);
      });
      if (others.length) {
        Array.prototype.forEach.call(su.options, function (o) { if (o.value === "__other__") o.selected = true; });
        ndEl("ndSubstrateOther").value = others.join(", ");
      }
    }
    ndEl("ndLocationDescription").value = data.location_description || "";
    syncNestOther();
    pickerLabel(ndEl("ndSpecies"), ndEl("ndSpeciesBtn"), "Choose species", false);
    pickerLabel(ndEl("ndSubstrate"), ndEl("ndSubstrateBtn"), "Choose substrate", true);
    pickerLabel(ndEl("ndDiscoveryStage"), ndEl("ndDiscoveryStageBtn"), "— select —", false);
    pickerLabel(ndEl("ndCameraOrControl"), ndEl("ndCameraOrControlBtn"), "Control", false);
  }

  function openNestDataEdit(nestId, data, row) {
    nestDataCtx = { nestId: nestId, mode: "edit", sheetRow: row, date: (data && data.discovery_date) || null };
    buildNestChoices();
    resetNestFields();
    ndEl("ndNestId").textContent = nestId;
    ndEl("ndGpsPoint").textContent = (data && data.gps_point) || nestId;
    ndEl("ndDiscoveryDate").textContent =
      (data && data.discovery_date) ? String(data.discovery_date).slice(0, 10) : "--";
    fillNestForm(data);
    toggleNestEditChrome(true);
    showScreen("nestdata");
  }

  // ---- Interval: edit-mode open + pre-fill ------------------------------

  function toggleIntervalEditChrome(isEdit) {
    var del = ivEl("intervalDeleteBtn");
    if (del) del.style.display = isEdit ? "" : "none";
    var save = ivEl("intervalSaveBtn");
    if (save) save.textContent = isEdit ? "Update interval data" : "Save interval data";
  }

  function fillIntervalForm(data) {
    data = data || {};
    var active = !!(data.adult_present || data.nest_status || data.young_status ||
      (data.host_eggs != null && data.host_eggs !== ""));
    var radios = overlay.querySelectorAll('input[name="ivCurrentState"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].checked = (radios[i].value === (active ? "Active" : "Empty"));
    }
    if (active) {
      ivEl("ivAdultPresent").value = data.adult_present || "N";
      ivEl("ivAdultActivity").value = data.adult_activity || "BC";
      ivEl("ivHostEggs").value = numText(data.host_eggs);
      ivEl("ivHostYoung").value = numText(data.host_young);
      ivEl("ivBhcoEggs").value = numText(data.bhco_eggs);
      ivEl("ivBhcoYoung").value = numText(data.bhco_young);
      ivEl("ivNestStatus").value = data.nest_status || "IN";
      ivEl("ivYoungStatus").value = data.young_status || "NO";
      ivEl("ivObserverActive").value = data.observer || "TNS";
      ivEl("ivNotesActive").value = data.notes || "";
    } else {
      ivEl("ivObserver").value = data.observer || "TNS";
      ivEl("ivNotes").value = data.notes || "";
    }
    applyIntervalState();
  }

  function openIntervalDataEdit(nestId, data, row) {
    intervalCtx = {
      nestId: nestId, mode: "edit", sheetRow: row,
      date: (data && data.date) || null, time: (data && data.time) || null
    };
    resetIntervalFields();
    ivEl("ivNestId").textContent = nestId;
    ivEl("ivDate").textContent = (data && data.date) || "--";
    ivEl("ivTime").textContent = (data && data.time) || "--";
    fillIntervalForm(data);
    toggleIntervalEditChrome(true);
    showScreen("intervaldata");
  }
