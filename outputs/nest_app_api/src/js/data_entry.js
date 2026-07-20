// Data entry / modification: waypoint add+modify, nest discovery, interval,
// pickers. Assembled into the single field-map IIFE at build.

  function ndEl(id) { return document.getElementById(id); }

  // Species/substrate pickers are decoupled from the baked arrays: when the DB
  // lookups (GET /lookups, cached on window.fieldApiLookups) are present they are
  // the source of truth; the hardcoded NEST_SPECIES/NEST_SUBSTRATES are only the
  // offline-first-boot fallback. The special options (Unknown / Artificial nest /
  // Other) keep the exact values the write path expects, so only the bird + plant
  // lists come from the API.

  // Bird choices from the lookups: [{ code, name }] alphabetical by common name,
  // minus the special/sentinel codes (added around the list). Duplicate common
  // names (historical + IACUC codes for the same bird) collapse to the last seed
  // code, matching the baked pick-list. Returns null when no lookups are loaded.
  function speciesChoicesFromLookups() {
    var rows = window.fieldApiLookups && window.fieldApiLookups.species;
    if (!Array.isArray(rows) || !rows.length) return null;
    var byName = {};
    rows.forEach(function (r) {
      if (!r || !r.species_code || !r.common_name) return;
      var code = String(r.species_code).toUpperCase();
      if (code === "UNKN" || code === "ARNE" || code === "OTHER") return;
      byName[r.common_name] = { code: code, name: String(r.common_name) };
    });
    var out = Object.keys(byName).map(function (k) { return byName[k]; });
    if (!out.length) return null;
    out.sort(function (a, b) {
      var an = a.name.toLowerCase(), bn = b.name.toLowerCase();
      return an < bn ? -1 : (an > bn ? 1 : 0);
    });
    return out;
  }

  // Plant substrate labels from the lookups, alphabetical, minus Unknown (added
  // first). Values stay the display label -- the write path resolves label-or-id
  // to substrate_id. Returns null when no lookups are loaded.
  function substrateChoicesFromLookups() {
    var rows = window.fieldApiLookups && window.fieldApiLookups.substrates;
    if (!Array.isArray(rows) || !rows.length) return null;
    var out = [];
    rows.forEach(function (r) {
      var label = r && r.label;
      if (!label) return;
      if (String(label).toLowerCase() === "unknown") return;
      out.push(String(label));
    });
    if (!out.length) return null;
    out.sort(function (a, b) {
      var al = a.toLowerCase(), bl = b.toLowerCase();
      return al < bl ? -1 : (al > bl ? 1 : 0);
    });
    return out;
  }

  function buildSpeciesOptions(sp, apiChoices) {
    sp.innerHTML = "";
    sp.add(new Option("— choose species —", ""));
    // Order: Unknown, Artificial nest, then birds A->Z, then Other. Labels are
    // common names only; the value is the 4-letter code for birds and a plain
    // word for the special options.
    sp.add(new Option("Unknown", "Unknown"));
    sp.add(new Option("Artificial nest", "Artificial nest"));
    if (apiChoices) {
      apiChoices.forEach(function (s) { sp.add(new Option(s.name, s.code)); });
    } else {
      NEST_SPECIES.forEach(function (s) { sp.add(new Option(s[0], s[1])); });
    }
    sp.add(new Option("Other…", "__other__"));
    sp.dataset.source = apiChoices ? "api" : "baked";
  }

  function buildSubstrateOptions(su, apiChoices) {
    su.innerHTML = "";
    su.add(new Option("Unknown", "Unknown"));
    if (apiChoices) {
      apiChoices.forEach(function (name) { su.add(new Option(name, name)); });
    } else {
      NEST_SUBSTRATES.forEach(function (name) { su.add(new Option(name, name)); });
    }
    su.add(new Option("Other…", "__other__"));
    su.dataset.source = apiChoices ? "api" : "baked";
  }

  // Build the species + substrate pickers. Rebuilt (not just built-once) when the
  // API lookups arrive after an initial baked build, so the first boot's fallback
  // lists are replaced by the live vocabularies without a reload.
  function buildNestChoices() {
    var sp = ndEl("ndSpecies");
    if (sp) {
      var spApi = speciesChoicesFromLookups();
      var wantSp = spApi ? "api" : "baked";
      if (!sp.options.length || sp.dataset.source !== wantSp) buildSpeciesOptions(sp, spApi);
    }
    var su = ndEl("ndSubstrate");
    if (su) {
      var suApi = substrateChoicesFromLookups();
      var wantSu = suApi ? "api" : "baked";
      if (!su.options.length || su.dataset.source !== wantSu) buildSubstrateOptions(su, suApi);
    }
    buildCodedSelects();
  }

  // Coded-vocabulary <select>s (discovery stage, adult present/activity, nest &
  // young status, presumed fate) are decoupled from their baked <option> lists the
  // same way the species/substrate pickers are: when the DB code tables (GET
  // /lookups, cached on window.fieldApiLookups) are present they are the source of
  // truth; the baked options are only the offline-first-boot fallback. The option
  // VALUE stays the DB code -- exactly what collect*/reset*Record read+write -- so
  // only the label + the set/order come from the API. Each spec maps a <select> id
  // to its /lookups key (rows shaped { code, label }).
  var CODED_SELECTS = [
    { id: "ndDiscoveryStage", table: "discovery_stage_codes" },
    { id: "ivAdultPresent", table: "adult_present_codes" },
    { id: "ivAdultActivity", table: "adult_activity_codes" },
    { id: "ivNestStatus", table: "nest_status_codes" },
    { id: "ivYoungStatus", table: "young_status_codes" },
    { id: "ivPresumedFate", table: "nest_fate_codes" }
  ];

  // Rows for one code table as [{ code, label }] in DB (seed) order, or null when
  // no lookups are loaded (-> keep the baked <option>s).
  function codeRowsFromLookups(table) {
    var rows = window.fieldApiLookups && window.fieldApiLookups[table];
    if (!Array.isArray(rows) || !rows.length) return null;
    var out = [];
    rows.forEach(function (r) {
      if (!r || r.code == null || r.code === "") return;
      out.push({ code: String(r.code), label: String(r.label != null ? r.label : r.code) });
    });
    return out.length ? out : null;
  }

  // Repopulate one coded <select> from its code table, preserving any leading
  // blank/placeholder option ("— select —", "— none (still active) —") the baked
  // list carried and the current selection when it survives the rebuild.
  function buildCodedSelect(sel, rows) {
    var prev = sel.value;
    var lead = [];
    Array.prototype.forEach.call(sel.options, function (o) {
      if (o.value === "") lead.push({ text: o.textContent, value: o.value });
    });
    sel.innerHTML = "";
    lead.forEach(function (o) { sel.add(new Option(o.text, o.value)); });
    rows.forEach(function (r) { sel.add(new Option(r.label, r.code)); });
    sel.dataset.source = "api";
    var has = false;
    Array.prototype.forEach.call(sel.options, function (o) { if (o.value === prev) has = true; });
    if (has) sel.value = prev;
  }

  // (Re)build the coded selects from the API code tables. Rebuilt-once-per-source
  // (like buildNestChoices) so a baked first-boot list is replaced when lookups
  // arrive; no-ops on a missing element or a missing/empty lookup table, leaving
  // the baked <option>s in place as the offline fallback.
  function buildCodedSelects() {
    CODED_SELECTS.forEach(function (spec) {
      var sel = ndEl(spec.id);
      if (!sel) return;
      var rows = codeRowsFromLookups(spec.table);
      if (!rows) {
        if (!sel.dataset.source) sel.dataset.source = "baked";
        return;
      }
      if (sel.dataset.source !== "api") buildCodedSelect(sel, rows);
    });
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
        // Picker changes the hidden <select> programmatically (no input event),
        // so nudge the discovery draft save here.
        if (typeof scheduleNestDraftSave === "function") scheduleNestDraftSave();
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

  // --- discovery draft persistence ---------------------------------------
  // iOS can evict a backgrounded PWA -- notably when the camera launches for the
  // nest photo -- and cold-reload on return, wiping an in-progress discovery
  // form. To survive that, mirror the form's fields to localStorage as they
  // change (keyed by nest id) and restore them the next time this nest's ADD
  // form opens. The draft is cleared once the nest saves, or the form is
  // cancelled. Edit mode (openNestDataEdit) never drafts.

  var ND_DRAFT_PREFIX = "nestDiscoveryDraft:";
  var _ndDraftKey = null;
  var _ndDraftTimer = null;

  function ndDraftKeyFor(nestId) { return ND_DRAFT_PREFIX + String(nestId || ""); }

  function ndSelectedSubstrates() {
    var su = ndEl("ndSubstrate");
    if (!su) return [];
    return Array.prototype.filter.call(su.options, function (o) { return o.selected; })
      .map(function (o) { return o.value; });
  }

  function collectNestDraft() {
    return {
      species: ndEl("ndSpecies") ? ndEl("ndSpecies").value : "",
      speciesOther: ndEl("ndSpeciesOther") ? ndEl("ndSpeciesOther").value : "",
      patch: ndEl("ndPatchId") ? ndEl("ndPatchId").value : "",
      stage: ndEl("ndDiscoveryStage") ? ndEl("ndDiscoveryStage").value : "",
      selfie: ndEl("ndSelfieStick") ? ndEl("ndSelfieStick").checked : false,
      artcand: ndEl("ndArtificialCandidate") ? ndEl("ndArtificialCandidate").checked : false,
      camctl: ndEl("ndCameraOrControl") ? ndEl("ndCameraOrControl").value : "Control",
      camdate: ndEl("ndCameraDeploymentDate") ? ndEl("ndCameraDeploymentDate").value : "",
      height: ndEl("ndHeight") ? ndEl("ndHeight").value : "",
      substrate: ndSelectedSubstrates(),
      substrateOther: ndEl("ndSubstrateOther") ? ndEl("ndSubstrateOther").value : "",
      location: ndEl("ndLocationDescription") ? ndEl("ndLocationDescription").value : "",
      note: ndEl("ndNote") ? ndEl("ndNote").value : "",
      photo: nestPhoto || null,
      photoName: nestPhotoName || null
    };
  }

  function nestDraftHasContent(d) {
    if (!d) return false;
    return !!(d.species || d.speciesOther || d.stage || d.height ||
      (d.substrate && d.substrate.length) || d.substrateOther ||
      d.location || d.note || d.photo || d.selfie || d.artcand ||
      (d.camctl && d.camctl !== "Control") || d.camdate);
  }

  function saveNestDraft() {
    if (!_ndDraftKey) return;
    try {
      var d = collectNestDraft();
      if (nestDraftHasContent(d)) localStorage.setItem(_ndDraftKey, JSON.stringify(d));
      else localStorage.removeItem(_ndDraftKey);
    } catch (e) {}
  }

  // Debounced so rapid typing writes once things settle.
  function scheduleNestDraftSave() {
    if (_ndDraftTimer) clearTimeout(_ndDraftTimer);
    _ndDraftTimer = setTimeout(function () { _ndDraftTimer = null; saveNestDraft(); }, 400);
  }
  window.fieldSaveNestDraft = scheduleNestDraftSave;

  // Synchronous flush -- write the current form to storage RIGHT NOW, not on the
  // 400 ms debounce. Called the instant the photo control is tapped (before the
  // camera can background/evict the PWA) and when the app is hidden, so opening
  // the camera can never lose the species/height/etc. entered so far.
  function flushNestDraft() {
    if (_ndDraftTimer) { clearTimeout(_ndDraftTimer); _ndDraftTimer = null; }
    saveNestDraft();
  }
  window.fieldFlushNestDraft = flushNestDraft;

  function clearNestDraft() {
    if (_ndDraftTimer) { clearTimeout(_ndDraftTimer); _ndDraftTimer = null; }
    if (_ndDraftKey) { try { localStorage.removeItem(_ndDraftKey); } catch (e) {} }
  }
  window.fieldClearNestDraft = clearNestDraft;

  function loadNestDraft(nestId) {
    try {
      var raw = localStorage.getItem(ndDraftKeyFor(nestId));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function applyNestDraft(d) {
    if (!d) return;
    if (d.species && ndEl("ndSpecies")) ndEl("ndSpecies").value = d.species;
    if (ndEl("ndSpeciesOther")) ndEl("ndSpeciesOther").value = d.speciesOther || "";
    if (d.patch && ndEl("ndPatchId")) ndEl("ndPatchId").value = d.patch;
    if (ndEl("ndDiscoveryStage")) ndEl("ndDiscoveryStage").value = d.stage || "";
    if (ndEl("ndSelfieStick")) ndEl("ndSelfieStick").checked = !!d.selfie;
    if (ndEl("ndArtificialCandidate")) ndEl("ndArtificialCandidate").checked = !!d.artcand;
    if (ndEl("ndCameraOrControl")) ndEl("ndCameraOrControl").value = d.camctl || "Control";
    if (ndEl("ndCameraDeploymentDate")) ndEl("ndCameraDeploymentDate").value = d.camdate || "";
    if (ndEl("ndCameraDateWrap")) ndEl("ndCameraDateWrap").style.display = (d.camctl === "Camera") ? "" : "none";
    if (ndEl("ndHeight")) ndEl("ndHeight").value = d.height || "";
    if (ndEl("ndLocationDescription")) ndEl("ndLocationDescription").value = d.location || "";
    if (ndEl("ndNote")) ndEl("ndNote").value = d.note || "";
    var su = ndEl("ndSubstrate");
    if (su && d.substrate) {
      Array.prototype.forEach.call(su.options, function (o) {
        o.selected = d.substrate.indexOf(o.value) >= 0;
      });
    }
    if (ndEl("ndSubstrateOther")) ndEl("ndSubstrateOther").value = d.substrateOther || "";
    if (d.photo) {
      nestPhoto = d.photo;
      nestPhotoName = d.photoName || null;
      var preview = ndEl("ndPhotoPreview");
      if (preview) {
        preview.innerHTML = "";
        var im = document.createElement("img");
        im.src = d.photo; im.className = "field-photo-thumb";
        preview.appendChild(im);
      }
    }
    // Re-sync the picker button labels + conditional "Other" rows so the visible
    // UI matches the restored hidden <select> values.
    syncNestOther();
    pickerLabel(ndEl("ndSpecies"), ndEl("ndSpeciesBtn"), "Choose species", false);
    pickerLabel(ndEl("ndSubstrate"), ndEl("ndSubstrateBtn"), "Choose substrate", true);
    pickerLabel(ndEl("ndDiscoveryStage"), ndEl("ndDiscoveryStageBtn"), "— select —", false);
    pickerLabel(ndEl("ndCameraOrControl"), ndEl("ndCameraOrControlBtn"), "Control", false);
    pickerLabel(ndEl("ndPatchId"), ndEl("ndPatchBtn"), "Patch", false);
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
    // Add flow: the discovery date is fixed to the waypoint's capture date.
    toggleNdDateEdit(false, null);
    // Restore any in-progress draft for this nest (survives an iOS reload).
    _ndDraftKey = ndDraftKeyFor(nestId);
    var draft = loadNestDraft(nestId);
    if (nestDraftHasContent(draft)) {
      applyNestDraft(draft);
      var st = ndEl("nestDataStatus");
      if (st) st.textContent = "Restored your in-progress entry.";
    }
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
      // Raw array for the API (server resolves each label-or-id to substrate_id).
      substrates: subs.slice(),
      gps_point: nestDataCtx ? nestDataCtx.nestId : null,
      // The waypoint's client UUID (gps_point.point_id) -- the API's FK target
      // for linking the nest to its point. Distinct from gps_point (nest id).
      gps_point_id: nestDataCtx ? nestDataCtx.pointId : null,
      location_description: ndEl("ndLocationDescription").value.trim() || null
    };
  }

  function uploadNestRow(row, onSuccess, onError) {
    relayPost({ action: "nest_row", row: row }, onSuccess, onError);
  }

  function saveNestData() {
    // Edit mode: adopt the (possibly corrected) discovery date before collecting
    // so it rides into the record's discovery_date (and thence the PATCH).
    if (nestDataCtx && nestDataCtx.mode === "edit") {
      var ndDe = ndEl("ndDiscoveryDateEdit");
      if (ndDe && ndDe.value) nestDataCtx.date = ndDe.value;
    }
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
      var editNestId = nestDataCtx.nestId;
      updateSheetRow("nest_level", nestDataCtx.sheetRow, rec,
        function () {

          // A newly-picked photo replaces the nest's picture. nestPhoto is set
          // only when the user chooses one (the existing photo is lazy-loaded,
          // not prefilled here), so this uploads exactly when they picked a new
          // one -- the same POST /photos the add path uses.

          if (nestPhoto) uploadNestPhoto(editNestId, nestPhoto, null);
          showUploadModal("Nest data updated for " + rec.nest_id + ".");
          window.fieldFinishSubForm();
        },
        function (msg) { if (status) status.textContent = msg; });
      return;
    }

    // The form stays open on failure so the record isn't lost -- Tara can Save
    // again once there's signal.

    uploadNestRow(
      rec,
      function () {

        // Adopt any server-allocated nest id (relayPostApi writes it back onto
        // rec) so the follow-on interval + photo target the same nest -- online
        // or, via the queue's temp-id remap, once an offline create flushes.
        if (nestDataCtx && rec.nest_id) nestDataCtx.nestId = rec.nest_id;

        // The note + photo were captured here but belong to the waypoint saved
        // a screen earlier. Attach them to that waypoint and re-upload it so the
        // server copy carries the photo/note.

        var pointId = nestDataCtx ? nestDataCtx.pointId : null;
        var note = ndEl("ndNote") ? ndEl("ndNote").value.trim() : "";
        var photo = nestPhoto || null;

        // Also link the discovery photo to the NEST itself (POST /photos, kind
        // 'original') so it lives on the nest page + map popup, not just on the
        // waypoint's nav thumbnail. Uses the nest id (temp id remapped on flush).
        if (photo) uploadNestPhoto(nestDataCtx ? nestDataCtx.nestId : null, photo, null);

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
            savePointToApi("individual_points",
              updated.point_name + "_" + syncTimestamp() + ".geojson",
              waypointsFC([updated]), null, null);
          }
        }

        // Saved: the draft is no longer needed.
        clearNestDraft();

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
    ivEl("ivHostEggs").value = "";
    ivEl("ivHostYoung").value = "";
    ivEl("ivBhcoEggs").value = "";
    ivEl("ivBhcoYoung").value = "";
    ivEl("ivNestStatus").value = "CN";
    ivEl("ivYoungStatus").value = "NO";
    ivEl("ivObserverActive").value = "TNS";
    ivEl("ivNotesActive").value = "";
    var pf = ivEl("ivPresumedFate");
    if (pf) pf.value = "";
    var st = ivEl("intervalStatus");
    if (st) st.textContent = "";
  }

  // --- interval draft persistence ----------------------------------------
  // Same iOS-eviction safeguard as the discovery form: mirror the in-progress
  // interval-check form to localStorage (keyed by nest id), restore it when the
  // nest's ADD-check form reopens, and clear it on save/cancel. Edit mode never
  // drafts. The interval form is all native inputs/selects, so one delegated
  // input/change listener on the screen captures every change.

  var IV_DRAFT_PREFIX = "nestIntervalDraft:";
  var _ivDraftKey = null;
  var _ivDraftTimer = null;

  function ivDraftKeyFor(nestId) { return IV_DRAFT_PREFIX + String(nestId || ""); }

  function collectIntervalDraft() {
    return {
      state: ivState(),
      date: ivEl("ivDateEdit") ? ivEl("ivDateEdit").value : "",
      time: ivEl("ivTimeEdit") ? ivEl("ivTimeEdit").value : "",
      observer: ivEl("ivObserver") ? ivEl("ivObserver").value : "",
      notes: ivEl("ivNotes") ? ivEl("ivNotes").value : "",
      adultPresent: ivEl("ivAdultPresent") ? ivEl("ivAdultPresent").value : "",
      adultActivity: ivEl("ivAdultActivity") ? ivEl("ivAdultActivity").value : "",
      hostEggs: ivEl("ivHostEggs") ? ivEl("ivHostEggs").value : "",
      hostYoung: ivEl("ivHostYoung") ? ivEl("ivHostYoung").value : "",
      bhcoEggs: ivEl("ivBhcoEggs") ? ivEl("ivBhcoEggs").value : "",
      bhcoYoung: ivEl("ivBhcoYoung") ? ivEl("ivBhcoYoung").value : "",
      nestStatus: ivEl("ivNestStatus") ? ivEl("ivNestStatus").value : "",
      youngStatus: ivEl("ivYoungStatus") ? ivEl("ivYoungStatus").value : "",
      observerActive: ivEl("ivObserverActive") ? ivEl("ivObserverActive").value : "",
      notesActive: ivEl("ivNotesActive") ? ivEl("ivNotesActive").value : "",
      presumedFate: ivEl("ivPresumedFate") ? ivEl("ivPresumedFate").value : ""
    };
  }

  function intervalDraftHasContent(d) {
    if (!d) return false;
    return !!(d.state === "Active" || d.notes || d.notesActive || d.presumedFate ||
      d.hostEggs || d.hostYoung || d.bhcoEggs || d.bhcoYoung ||
      (d.observer && d.observer !== "TNS") ||
      (d.adultPresent && d.adultPresent !== "N"));
  }

  function saveIntervalDraft() {
    if (!_ivDraftKey) return;
    try {
      var d = collectIntervalDraft();
      if (intervalDraftHasContent(d)) localStorage.setItem(_ivDraftKey, JSON.stringify(d));
      else localStorage.removeItem(_ivDraftKey);
    } catch (e) {}
  }

  function scheduleIntervalDraftSave() {
    if (_ivDraftTimer) clearTimeout(_ivDraftTimer);
    _ivDraftTimer = setTimeout(function () { _ivDraftTimer = null; saveIntervalDraft(); }, 400);
  }
  window.fieldSaveIntervalDraft = scheduleIntervalDraftSave;

  function clearIntervalDraft() {
    if (_ivDraftTimer) { clearTimeout(_ivDraftTimer); _ivDraftTimer = null; }
    if (_ivDraftKey) { try { localStorage.removeItem(_ivDraftKey); } catch (e) {} }
  }
  window.fieldClearIntervalDraft = clearIntervalDraft;

  // Synchronous flush of the interval draft (mirrors the discovery one), for the
  // app-backgrounded safety net.
  function flushIntervalDraft() {
    if (_ivDraftTimer) { clearTimeout(_ivDraftTimer); _ivDraftTimer = null; }
    saveIntervalDraft();
  }
  window.fieldFlushIntervalDraft = flushIntervalDraft;

  function loadIntervalDraft(nestId) {
    try {
      var raw = localStorage.getItem(ivDraftKeyFor(nestId));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function applyIntervalDraft(d) {
    if (!d) return;
    if (d.state) {
      var radios = overlay.querySelectorAll('input[name="ivCurrentState"]');
      for (var i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === d.state);
    }
    if (d.observer && ivEl("ivObserver")) ivEl("ivObserver").value = d.observer;
    if (ivEl("ivNotes")) ivEl("ivNotes").value = d.notes || "";
    if (d.adultPresent && ivEl("ivAdultPresent")) ivEl("ivAdultPresent").value = d.adultPresent;
    if (d.adultActivity && ivEl("ivAdultActivity")) ivEl("ivAdultActivity").value = d.adultActivity;
    if (ivEl("ivHostEggs")) ivEl("ivHostEggs").value = d.hostEggs || "";
    if (ivEl("ivHostYoung")) ivEl("ivHostYoung").value = d.hostYoung || "";
    if (ivEl("ivBhcoEggs")) ivEl("ivBhcoEggs").value = d.bhcoEggs || "";
    if (ivEl("ivBhcoYoung")) ivEl("ivBhcoYoung").value = d.bhcoYoung || "";
    if (d.nestStatus && ivEl("ivNestStatus")) ivEl("ivNestStatus").value = d.nestStatus;
    if (d.youngStatus && ivEl("ivYoungStatus")) ivEl("ivYoungStatus").value = d.youngStatus;
    if (d.observerActive && ivEl("ivObserverActive")) ivEl("ivObserverActive").value = d.observerActive;
    if (ivEl("ivNotesActive")) ivEl("ivNotesActive").value = d.notesActive || "";
    if (ivEl("ivPresumedFate")) ivEl("ivPresumedFate").value = d.presumedFate || "";
    // Re-sync the state-dependent field groups to the restored state.
    applyIntervalState();
  }

  function openIntervalData(opts) {
    opts = opts || {};
    var mode = opts.mode || "add";
    var now = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var dateStr = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
    var timeStr = pad(now.getHours()) + ":" + pad(now.getMinutes());
    intervalCtx = { nestId: opts.nestId, date: dateStr, mode: mode, sheetRow: null };
    buildCodedSelects();
    resetIntervalFields();
    ivEl("ivNestId").textContent = opts.nestId || "--";
    intervalCtx.time = timeStr;
    applyIntervalState();
    toggleIntervalEditChrome(false);
    // Add flow: pre-fill the date/time inputs with "now", but leave them editable
    // so the user can correct them by hand (saveIntervalData reads the inputs).
    toggleIvDateTimeEdit(true, dateStr, timeStr);
    // Restore any in-progress draft for this nest (survives an iOS reload).
    _ivDraftKey = ivDraftKeyFor(opts.nestId);
    var draft = loadIntervalDraft(opts.nestId);
    if (intervalDraftHasContent(draft)) {
      applyIntervalDraft(draft);
      var st = ivEl("intervalStatus");
      if (st) st.textContent = "Restored your in-progress check.";
    }
    showScreen("intervaldata");
  }

  function collectIntervalRecord() {
    var active = ivState() === "Active";
    var rec = {
      nest_id: intervalCtx ? intervalCtx.nestId : null,
      date: intervalCtx ? intervalCtx.date : null,
      time: intervalCtx ? intervalCtx.time : null,
      current_state: ivState(),
      observer: active ? ivEl("ivObserverActive").value : ivEl("ivObserver").value,
      notes: (active ? ivEl("ivNotesActive").value : ivEl("ivNotes").value).trim()
    };
    if (active) {
      var adult = ivEl("ivAdultPresent").value;
      rec.adult_present = adult;
      rec.adult_activity = (adult !== "N") ? ivEl("ivAdultActivity").value : "";
      rec.host_eggs = Number(ivEl("ivHostEggs").value);
      rec.host_young = Number(ivEl("ivHostYoung").value);
      rec.bhco_eggs = Number(ivEl("ivBhcoEggs").value);
      rec.bhco_young = Number(ivEl("ivBhcoYoung").value);
      rec.nest_status = ivEl("ivNestStatus").value;
      rec.young_status = ivEl("ivYoungStatus").value;
    } else {

      // Inactive/Empty check: record a standard "complete nest, no birds" row.

      rec.adult_present = "N";
      rec.adult_activity = "";
      rec.host_eggs = 0;
      rec.host_young = 0;
      rec.host_dead_young = 0;
      rec.bhco_eggs = 0;
      rec.bhco_young = 0;
      rec.bhco_dead_young = 0;
      rec.nest_status = "CN";
      rec.young_status = "NO";
    }
    // Presumed fate (Success/Failure/Unknown or "") -- concludes the NEST, not
    // the check, so it's applied to nest.nest_fate on save (see saveIntervalData).
    rec.presumed_fate = ivEl("ivPresumedFate") ? ivEl("ivPresumedFate").value : "";
    return rec;
  }

  // A presumed fate on the interval concludes the nest: patch nest.nest_fate so
  // it drops out of "current" and fades on the map. API path only (patchNestFields
  // no-ops on the Sheets path); the fate still rides in the interval row there.
  function applyPresumedFate(rec) {
    if (rec && rec.presumed_fate && rec.nest_id) {
      patchNestFields(rec.nest_id, { nest_fate: rec.presumed_fate });
    }
  }

  function saveIntervalData() {
    // Adopt the (possibly hand-edited) date + time before collecting so they ride
    // into the record -- the POST's check_date/check_time on a new check, or the
    // PATCH's on an edit. Both flows show the editable inputs, so read them either
    // way (they are pre-filled with "now" when a new check opens).
    if (intervalCtx) {
      var ivDe = ivEl("ivDateEdit"), ivTe = ivEl("ivTimeEdit");
      if (ivDe && ivDe.value) intervalCtx.date = ivDe.value;
      if (ivTe && ivTe.value) intervalCtx.time = ivTe.value;
    }
    var rec = collectIntervalRecord();
    var status = ivEl("intervalStatus");
    if (status) status.textContent = "Saving…";
    if (window.console && console.log) console.log("[interval_level row]", rec);
    if (intervalCtx && intervalCtx.mode === "edit") {
      updateSheetRow("interval_level", intervalCtx.sheetRow, rec,
        function () { applyPresumedFate(rec); showUploadModal("Interval check updated."); window.fieldFinishSubForm(); },
        function (msg) { if (status) status.textContent = msg; });
      return;
    }
    uploadIntervalRow(rec,
      function () { clearIntervalDraft(); applyPresumedFate(rec); showUploadModal("Interval check saved for " + intervalCtx.nestId + "."); window.fieldFinishSubForm(); },
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

  // The artificial (NQ) nest's id is DERIVED from its source nest: take the
  // numeric part of the source id and re-prefix it "NQ" (N057 -> NQ057),
  // preserving the digits/zero-padding. Returns null when no number can be
  // pulled, or when an NQ nest with that id already exists (the live set or this
  // session's quick adds) -- the caller then lets the server allocate instead.
  function artificialIdFromNest(sourceNestId) {
    var m = /(\d+)$/.exec(String(sourceNestId == null ? "" : sourceNestId));
    if (!m) return null;
    var candidate = "NQ" + m[1];
    var apiN = window.fieldApiNests || [];
    for (var i = 0; i < apiN.length; i++) {
      if (apiN[i] && apiN[i].nest_id === candidate) return null;
    }
    if (localSessionNestIds.indexOf(candidate) >= 0) return null;
    return candidate;
  }

  // The source nest's carry-over discovery fields (location note, height,
  // substrate list) pulled from the live GET /nests set. GET /nests serves
  // substrates as a comma-joined label string, so split it back into the array
  // the write path (PATCH /nests) expects. Only present keys are returned.
  function artificialCarryFields(sourceNestId) {
    var apiN = window.fieldApiNests || [];
    var src = null;
    for (var i = 0; i < apiN.length; i++) {
      if (apiN[i] && apiN[i].nest_id === sourceNestId) { src = apiN[i]; break; }
    }
    var carry = {};
    if (!src) return carry;
    if (src.location_description != null && src.location_description !== "") {
      carry.location_description = src.location_description;
    }
    if (src.height_m != null && src.height_m !== "") {
      carry.height_m = Number(src.height_m);
    }
    if (src.substrates != null && String(src.substrates).trim() !== "") {
      carry.substrates = String(src.substrates).split(",")
        .map(function (x) { return x.trim(); }).filter(Boolean);
    }
    return carry;
  }

  // Artificial (NQ) nests: an old, inactive nest that already has a GPS point is
  // reassigned as an artificial nest. This auto-fills the discovery row (species
  // "Artificial nest") and a first interval record with 2 host eggs added, with
  // no data-entry pages -- Tara just confirms.
  // Guards a double-tap of "Make artificial nest" from enqueuing two creates
  // (which would place two NQ nests -- the second auto-allocated by the server --
  // at the same point). Cleared once the (fast, local) enqueue settles.
  var _artInFlight = false;

  function makeArtificialNest(nestId, camOrControl) {
    if (!nestId) return;
    if (_artInFlight) return;
    _artInFlight = true;

    // Camera-vs-control designation, chosen in the prompt that launched this
    // (see fieldChoose). Default Control if somehow unset; editable later from
    // the nest's discovery page either way.

    var artCam = (camOrControl === "Camera") ? "Camera" : "Control";

    // API path: one server call creates a NEW NQ nest that SHARES this nest's
    // GPS point + a first interval (2 host eggs). The server allocates the NQ
    // id and leaves the original nest intact -- so the point ends up with two
    // nests. (The Sheets fallback below is the legacy reassign-in-place path.)
    if (apiEnabled()) {
      // Optimistic: enqueue + confirm instantly, sync in the background. The new
      // NQ nest's id is DERIVED from this nest's number (N057 -> NQ057) and sent
      // as the requested nest_id; the server honors it (see report) or, failing
      // that, allocates its own -- either way the follow-up PATCH below rides the
      // queue's temp-id remap onto the id the server actually created.
      var idemArt = NestApi.api.newIdemKey();
      var artId = artificialIdFromNest(nestId);
      var artCarry = artificialCarryFields(nestId);
      var artBody = { camera_or_control: artCam };
      if (artId) artBody.nest_id = artId;
      NestApi.queue.enqueue({
        kind: "createArtificial", tempId: nestId,
        endpoint: "/nests/" + encodeURIComponent(nestId) + "/artificial",
        method: "POST", body: artBody, idemKey: idemArt
      }).then(function () {
        // Carry the source nest's location note / height / substrates onto the
        // new NQ nest. tempId (= source id) is remapped to the server-allocated
        // NQ id, so this PATCH -- enqueued AFTER the create, FIFO -- lands on the
        // new nest. PATCH /nests accepts location_description, height_m, substrates.
        if (Object.keys(artCarry).length) {
          NestApi.queue.enqueue({
            kind: "updateNest", tempId: nestId,
            endpoint: "/nests/" + encodeURIComponent(nestId), method: "PATCH",
            body: artCarry, idemKey: NestApi.api.newIdemKey()
          });
        }
        flushSoon();
        _artInFlight = false;
        showUploadModal("Artificial nest " + (artId ? artId + " " : "") +
          "placed at " + nestId + "'s point (2 host eggs).");
        closeMenu();
      }).catch(function (e) {
        _artInFlight = false;
        showUploadModal("Couldn't set up artificial nest: " + ((e && e.message) || "unknown error"));
      });
      return;
    }

    var c = (typeof niCoords === "function") ? niCoords(nestId) : null;
    var lat = c ? c.lat : null, lng = c ? c.lng : null;
    var today = fmtTime(new Date()).slice(0, 10);
    var now = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var timeStr = pad(now.getHours()) + ":" + pad(now.getMinutes());

    var discovery = {
      nest_id: nestId,
      species: "Artificial nest",
      patch_id: defaultPatchForNest(nestId, lat, lng),
      discovery_date: today,
      discovery_stage: null,
      selfie_stick: false,
      artificial_candidate: true,
      camera_or_control: artCam,
      camera_deployment_date: null,
      height: null,
      substrate: null,
      gps_point: nestId,
      location_description: null
    };

    var interval = {
      nest_id: nestId,
      date: today,
      time: timeStr,
      current_state: "Active",
      observer: "TNS",
      notes: "Artificial nest set up (auto-filled).",
      adult_present: "N",
      adult_activity: "",
      host_eggs: 2,          // 2 host eggs added per artificial nest
      host_young: 0,
      bhco_eggs: 0,
      bhco_young: 0,
      nest_status: "CN",
      young_status: "NO"
    };

    showBusy("Setting up artificial nest…");
    uploadNestRow(discovery, function () {
      uploadIntervalRow(interval, function () {
        hideBusy();
        _artInFlight = false;
        showUploadModal(nestId + " set up as an artificial nest (2 host eggs).");
        closeMenu();
      }, function (msg) {
        hideBusy();
        _artInFlight = false;
        showUploadModal("Discovery saved, but the interval failed: " + msg);
      });
    }, function (msg) {
      hideBusy();
      _artInFlight = false;
      showUploadModal("Couldn't set up artificial nest: " + msg);
    });
  }

  function startNewNestPoint(nestId) {
    resetAddForm();
    newNestId = nestId;
    // This nest already exists (already discovered) -- we're only attaching a
    // GPS location to it. Save must NOT route through the discovery/interval
    // pages (that would create a duplicate nest). See saveAveraged.
    newNestExisting = true;
    if (wpName) { wpName.value = nestId; wpName.readOnly = true; }
    if (wpNamePrefix) wpNamePrefix.style.display = "none";
    var clab = (wpClass && wpClass.closest) ? wpClass.closest(".field-field-label") : null;
    if (clab) clab.style.display = "none";
    showScreen("addwaypoint");
    addStatus("No saved location for " + nestId + " \u2014 hold still; Save when the bar settles.");
  }

  // The GPS point UUID for a nest, so a new nest can SHARE it. API nests carry
  // gps_point_id; fall back to a cached waypoint named with the nest id.
  function pointIdForNest(nestId) {
    var apiN = window.fieldApiNests || [];
    for (var i = 0; i < apiN.length; i++) {
      if (apiN[i] && apiN[i].nest_id === nestId && apiN[i].gps_point_id) {
        return apiN[i].gps_point_id;
      }
    }
    var arr = loadWaypoints();
    for (var j = 0; j < arr.length; j++) {
      if (arr[j].point_name === nestId && arr[j].point_id) return arr[j].point_id;
    }
    return null;
  }

  // Nest ids created via this session's quick adds, tracked so two back-to-back
  // "add nest at this point" actions don't land on the same suggested id (the
  // server-side create is enqueued, not yet reflected in window.fieldApiNests).
  var localSessionNestIds = [];

  // Next nest id within a prefix's namespace ("N" / "NLB" / "NSP"), computed from
  // the CURRENT set of existing nests -- window.fieldApiNests (the live GET /nests
  // set), this device's saved nest waypoints, and this session's quick adds -- so
  // a suggestion never collides with an id already in use. Takes the MAX numeric
  // suffix + 1 (e.g. N115 -> N116) and preserves the zero-pad width the existing
  // ids use, falling back to a 3-digit pad when the namespace is empty.
  function suggestNextNestId(prefix) {
    var rx = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\d+)$");
    var max = 0, width = 0;
    function consider(id) {
      var m = rx.exec(String(id == null ? "" : id));
      if (!m) return;
      var n = parseInt(m[1], 10);
      if (n > max) { max = n; width = m[1].length; }
    }
    (window.fieldApiNests || []).forEach(function (nst) { if (nst) consider(nst.nest_id); });
    if (typeof loadWaypoints === "function") {
      loadWaypoints().forEach(function (w) {
        if (w && w.point_class === "Nest") consider(w.point_name);
      });
    }
    localSessionNestIds.forEach(consider);
    var num = max + 1;
    var pad = width || 3;
    var suffix = String(num);
    while (suffix.length < pad) suffix = "0" + suffix;
    return prefix + suffix;
  }

  // Does a discovery record already exist for this nest id? GET /nests only
  // returns nests that have a row in the `nest` table (i.e. discovery was saved),
  // so presence in window.fieldApiNests means "this nest is complete". A nest
  // point whose discovery entry was interrupted mid-form has a GPS point but no
  // such row, so it is absent here.
  function nestHasDiscovery(nestId) {
    var apiN = window.fieldApiNests || [];
    for (var i = 0; i < apiN.length; i++) {
      if (apiN[i] && apiN[i].nest_id === nestId) return true;
    }
    return false;
  }

  // Add discovery at an EXISTING nest's GPS point. Two cases:
  //  * The point has NO discovery record yet (e.g. discovery entry was interrupted
  //    mid-form, leaving only the GPS point) -> fill it in under the point's OWN
  //    id. This completes the original nest rather than minting a new one.
  //  * The point already HAS a discovery record -> this is a genuine SECOND nest
  //    sharing the point (a bird building over a previous nest). Open the form for
  //    a fresh id in the same SITE namespace (N / NLB / NSP -- never NQ), pre-
  //    linked to the shared point; on save it gets its own id, same gps_point_id.
  function addNestAtExistingPoint(sourceNestId) {
    if (!sourceNestId) return;
    var pointId = pointIdForNest(sourceNestId);
    var c = (typeof niCoords === "function") ? niCoords(sourceNestId) : null;
    if (!pointId || !c) {
      showUploadModal("Can't add a nest here yet — this nest's GPS point isn't loaded. Try again once synced.");
      return;
    }
    if (!nestHasDiscovery(sourceNestId)) {
      // Reuse the point's own id. If a record somehow does exist but wasn't
      // loaded, the server's PK guard rejects the duplicate (409) -- no dupe.
      openNestData(sourceNestId, c.lat, c.lng, new Date(), pointId);
      return;
    }
    var pfx = /^NLB/.test(sourceNestId) ? "NLB" : (/^NSP/.test(sourceNestId) ? "NSP" : "N");
    var newId = suggestNextNestId(pfx);
    localSessionNestIds.push(newId);   // claim it so the next quick add skips past
    openNestData(newId, c.lat, c.lng, new Date(), pointId);
  }
  window.fieldAddNestAtPoint = addNestAtExistingPoint;

  // Re-record the GPS location of an existing nest's point (from the nest-info
  // page, for server-side nests that have no local waypoint). Opens the Modify
  // screen against a synthesized point; saving PATCHes that point in place
  // (source "nest" so saveModify skips local-waypoint bookkeeping).
  function reRecordNestPoint(nestId) {
    if (!nestId) return;
    var pointId = pointIdForNest(nestId);
    var c = (typeof niCoords === "function") ? niCoords(nestId) : null;
    if (!pointId || !c) {
      showUploadModal("Can't re-record — this nest's GPS point isn't loaded. Try again once synced.");
      return;
    }
    startModify({
      point_id: pointId,
      point_name: nestId,
      point_class: "Nest",
      latitude: c.lat,
      longitude: c.lng,
      note: "",
      color: (typeof WP_DEFAULT_COLOR !== "undefined") ? WP_DEFAULT_COLOR : null,
      photo: null
    }, "nest");
    if (wpName) wpName.readOnly = true;   // re-recording must keep the nest id
  }
  window.fieldReRecordNestPoint = reRecordNestPoint;

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
    [["replace", "Record new location"], ["average", "Average with new reading"]]
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
    editWp = { id: point.point_id, source: source, point: point, mode: "replace" };
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
    setMode("replace");

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

  // Optimistically move a re-recorded nest's marker: rewrite the matching
  // v_map_point row (by point_id -> idx, else by name) so the icon jumps to
  // the new spot at once instead of waiting for the /map_points refetch below.

  function moveApiMapPoint(pointId, name, lat, lng) {
    var pts = window.fieldMapMarkers || [];

    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!p) continue;
      if ((pointId && p.idx === pointId) || (name && p.name === name)) {
        p.lat = lat;
        p.lng = lng;
      }
    }
    // A new nest/point just landed -- re-pull /map_points so its marker shows
    // now, rather than on the next change-feed poll.
    if (window.NestApiWiring && typeof window.NestApiWiring.refreshMapPoints === "function") {
      window.NestApiWiring.refreshMapPoints();
    }
  }

  function saveModify() {
    if (editWp.mode !== "keep" && (!avg || !samples.length)) {
      addStatus("No location samples yet -- give it a moment, or choose Keep.");
      return;
    }
    var a = avg;
    var mode = editWp.mode;   // keep / replace / average (for the save message)
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
    if (apiEnabled()) {
      // Existing point -> PATCH in place (preserves point_id + all nest links).
      // The confirmation names what the save DID: a fresh reading vs an average
      // of the previous, else a plain update (keep / note / colour edits).

      patchGpsPoint(w.point_id, gpsPatchBody(w), function () {
        if (src === "waypoint") markUploaded([w.point_id]);
        var msg = (mode === "replace")
          ? "New waypoint for this location saved!"
          : (mode === "average")
            ? "Waypoint averaged for the previous location!"
            : w.point_name + " updated.";
        showUploadModal(msg);
      });
      // Re-recording a server-side nest's point: move its live marker right away
      // (the PATCH is enqueued, so a /gps_points refetch could be far off).
      if (src === "nest") moveApiMapPoint(w.point_id, w.point_name, w.latitude, w.longitude);
    } else {
      savePointToApi("individual_points", w.point_name + "_" + syncTimestamp() + ".geojson", waypointsFC([w]), null, function () {
        if (src === "waypoint") markUploaded([w.point_id]);
        showUploadModal(w.point_name + " saved.");
      });
    }
    renderWaypoints();
    resetAddForm();
    addStatus("");
    window.fieldFinishSubForm();
  }

  function saveAveraged() {
    if (editWp) { saveModify(); return; }
    if (!avg || !samples.length) {
      addStatus("No location samples yet -- give it a moment.");
      return;
    }

    // Duplicate-name safeguard: block a BRAND-NEW nest (not an existing nest
    // getting its GPS via startNewNestPoint) from taking the name of a point
    // that already has a GPS location. Checked before averaging is torn down so
    // Tara can just fix the name and Save again.
    var forNest = newNestId;
    var forExistingNest = newNestExisting;   // attaching GPS to an existing nest
    var isNestClass = forNest ? true : !!(wpClass && wpClass.value === "Nest");
    var intendedName = forNest ? forNest : currentName(fmtTime(new Date()));
    if (isNestClass && !forExistingNest && nestNameHasGpsPoint(intendedName)) {
      addStatus("A GPS point named " + intendedName + " already exists. " +
        "Pick a different nest number, or use that nest's Modify to update it.");
      return;
    }

    var a = avg;               // snapshot the average before restarting
    stopAveraging();
    newNestId = null;
    newNestExisting = false;

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
    // A brand-new Nest waypoint goes to the discovery form. A Nest waypoint that
    // is just attaching GPS to an ALREADY-discovered nest (forExistingNest, set
    // by startNewNestPoint) must NOT -- it would create a duplicate discovery.
    var isNestPoint = (wp.point_class === "Nest");
    var goDiscovery = isNestPoint && !forExistingNest;
    if (wp.point_class === "Temp") {
      showUploadModal(wp.point_name + " added (temporary -- not saved).");
    } else {
      savePointToApi("individual_points", wp.point_name + "_" + syncTimestamp() + ".geojson", waypointsFC([wp]), null, function () {
        markUploaded([wp.point_id]);
        // The nest-discovery form is the acknowledgement for brand-new nests;
        // everything else (incl. GPS-only for an existing nest) confirms here.
        if (!goDiscovery) {
          if (forExistingNest && forNest) {
            // Attaching a GPS point to an already-discovered nest: link the new
            // point to the nest (gps_point_id). The point was just created, so it
            // exists on the server (or is queued before this PATCH when offline).
            patchNestFields(forNest, { gps_point_id: wp.point_id }, function () {
              showUploadModal("Location saved for " + forNest + " and linked to the nest.");
            });
          } else {
            showUploadModal(forNest ? ("Location saved for " + forNest + ".") : (wp.point_name + " saved."));
          }
        }
      });
    }
    addWaypointMarker(wp);
    renderWaypoints();
    resetAddForm();
    addStatus("");

    // For a brand-new nest point, offer the discovery form -- but allow saving
    // JUST the point (e.g. a nest too high to work). "No" keeps the point (its
    // id, location, note/photo) and returns to the map; discovery can be added
    // later from the nest's Modify screen.

    if (goDiscovery) {
      showNestDataPrompt(
        function () {
          openNestData(wp.point_name, a.lat, a.lng, now, wp.point_id);
        },
        function () {
          showUploadModal(wp.point_name + " saved (point only).");
          closeMenu();
        }
      );
    } else {

      // Back to the map view (closeMenu also stops the GPS averaging watch).

      closeMenu();
    }
  }

  function resetAddForm() {
    newNestId = null;
    newNestExisting = false;
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

  // True when a REST API token is configured; gates every backend call so an
  // un-configured build behaves exactly like the old legacy relay path.
  function apiEnabled() {
    return !!(window.NestApi && NestApi.settings && NestApi.settings.hasCreds());
  }

  // Debounced, non-blocking background flush of the write queue. Called after
  // every optimistic save so queued writes reach the server WITHOUT blocking the
  // UI. Coalesces bursts (rapid multi-saves) into a single flush pass.
  var _flushTimer = null;
  var _flushing = false;
  function flushSoon() {
    if (!apiEnabled() || !NestApi.api.isOnline()) return;
    if (_flushTimer || _flushing) return;
    _flushTimer = setTimeout(function () {
      _flushTimer = null;
      _flushing = true;
      NestApi.queue.flush()
        .catch(function () {})
        .then(function () {
          _flushing = false;
          // Saves that landed mid-flush aren't in that pass -- sweep again.
          NestApi.queue.pending()
            .then(function (n) { if (n > 0) flushSoon(); })
            .catch(function () {});
        });
    }, 120);
  }

  // ---- API body mappers -------------------------------------------------
  // collect*Record() speaks the Google-Sheets field vocabulary (date/time,
  // species, height, "" for blank). The REST API speaks the DB schema
  // (check_date, species_code, height_m, NULL for blank, coded FKs). Translate
  // at the boundary so the shared collectors + the Sheets path stay untouched.

  function nullIfBlank(v) { return (v == null || v === "") ? null : v; }

  function intervalRowToApi(row) {
    return {
      check_date: nullIfBlank(row.date),
      check_time: nullIfBlank(row.time),
      current_state: row.current_state,            // 'Active' | 'Empty'
      observer_id: nullIfBlank(row.observer),      // form observer (TNS/BSE/CMS/JLS)
      adult_present: nullIfBlank(row.adult_present),
      adult_activity: nullIfBlank(row.adult_activity),
      host_eggs: Number(row.host_eggs) || 0,
      host_young: Number(row.host_young) || 0,
      host_dead_young: Number(row.host_dead_young) || 0,
      bhco_eggs: Number(row.bhco_eggs) || 0,
      bhco_young: Number(row.bhco_young) || 0,
      bhco_dead_young: Number(row.bhco_dead_young) || 0,
      nest_status: nullIfBlank(row.nest_status),
      young_status: nullIfBlank(row.young_status),
      notes: nullIfBlank(row.notes)
    };
  }

  function nestRowToApi(row) {
    var sp = row.species;
    var speciesCode = null, speciesOther = null;
    if (sp === "Unknown") speciesCode = "UNKN";
    else if (sp === "Artificial nest") speciesCode = "ARNE";
    else if (typeof sp === "string" && /^[A-Za-z]{4}$/.test(sp)) speciesCode = sp.toUpperCase();
    else if (sp) speciesOther = sp;              // free-text "Other" -> text, code NULL
    var out = {
      // "patch-none" is the app's "(none / unknown)" sentinel, not a real
      // patch_id -- send NULL so it doesn't trip the patch foreign key.
      patch_id: (row.patch_id && row.patch_id !== "patch-none") ? row.patch_id : null,
      species_code: speciesCode,
      species_other: speciesOther,
      discovery_date: nullIfBlank(row.discovery_date),
      discovery_stage: nullIfBlank(row.discovery_stage),  // Building/Incubation/Nestling
      selfie_stick: row.selfie_stick ? 1 : 0,
      artificial_candidate: row.artificial_candidate ? 1 : 0,
      camera_or_control: nullIfBlank(row.camera_or_control),  // 'Camera' | 'Control'
      camera_deployment_date: nullIfBlank(row.camera_deployment_date),
      height_m: (row.height != null && row.height !== "") ? Number(row.height) : null,
      location_description: nullIfBlank(row.location_description)
      // DEFERRED (WRITE_AUDIT.md): substrates (needs label -> substrate_id).
      // Omitted so a nest still saves cleanly instead of tripping a foreign key.
    };
    // Link the nest to its waypoint by the point's client UUID -- ONLY on create
    // (the point is created/enqueued before the nest, and point_id is a stable
    // client id, so no temp-id remap is needed). Omit in edit mode (no pointId)
    // so a PATCH never wipes the existing link.
    // The nest_id IS the waypoint's name -- send it so the server uses it
    // verbatim (point_name and nest_id must not diverge). Prefix is a fallback
    // the server only uses if no id is sent.
    if (nullIfBlank(row.nest_id)) out.nest_id = row.nest_id;
    var pm = /^(NLB|NSP|NQ|N)/.exec(String(row.nest_id || ""));
    if (pm) out.prefix = pm[1];
    if (nullIfBlank(row.gps_point_id)) out.gps_point_id = row.gps_point_id;
    // Substrates: send the array of picked values (labels or free text). The
    // server resolves each to a substrate_id. Both create (POST /nests) and edit
    // (PATCH /nests/:id) honor it: PATCH is presence-gated, so a body WITH the
    // key replaces the set (an empty array clears them all), while a body WITHOUT
    // the key leaves nest_substrate untouched. We therefore send it whenever the
    // record actually carries a substrates array -- including an empty one, so an
    // edit that clears every substrate reaches the server as an explicit replace.
    if (Array.isArray(row.substrates)) {
      out.substrates = row.substrates;
    }
    return out;
  }

  // Route one backend write to the REST API instead of the Apps Script relay.
  // Mirrors the app_wiring_map action -> endpoint table. On a network failure
  // (offline / thrown-by-fetch) the op is enqueued and reported as success
  // (optimistic); the queue flushes on reconnect. A server rejection surfaces
  // to onError. Discovery/interval/photo ops carry the nest's (temp) id so the
  // queue's temp-id remap can rewrite them once the server allocates a real id.
  function relayPostApi(payload, onSuccess, onError) {
    var action = payload.action;
    var row = payload.row || {};
    var idem = NestApi.api.newIdemKey();

    function ok() { if (onSuccess) onSuccess(); }
    function fail(e) {
      var msg = (e && e.message) ? e.message : "Send failed — try again.";
      if (onError) onError(msg);
    }

    // action -> { kind, endpoint, method, body, tempId? } for both the online
    // call and the offline queue op.
    var op = null;
    if (action === "nest_row") {
      op = {
        kind: "createNest", method: "POST", endpoint: "/nests",
        body: nestRowToApi(row), tempId: row.nest_id || null
      };
    } else if (action === "interval_row") {
      op = {
        kind: "addInterval", method: "POST",
        endpoint: "/nests/" + encodeURIComponent(row.nest_id) + "/intervals",
        body: intervalRowToApi(row), tempId: row.nest_id || null
      };
    } else if (action === "update_row" && payload.sheet === "nest_level") {
      var nid = (payload.values && payload.values.nest_id) || payload.row;
      op = {
        kind: "updateNest", method: "PATCH",
        endpoint: "/nests/" + encodeURIComponent(nid),
        body: nestRowToApi(payload.values || {}), tempId: nid || null
      };
    } else if (action === "update_row") {
      // interval_level: payload.row is the check_id (see updateSheetRow calls).
      op = {
        kind: "updateInterval", method: "PATCH",
        endpoint: "/intervals/" + encodeURIComponent(payload.row),
        body: intervalRowToApi(payload.values || {})
      };
    } else if (action === "delete_row" && payload.sheet === "interval_level") {
      op = {
        kind: "deleteInterval", method: "DELETE",
        endpoint: "/intervals/" + encodeURIComponent(payload.row),
        body: null
      };
    } else if (action === "delete_row") {
      op = {
        kind: "deleteNest", method: "DELETE",
        endpoint: "/nests/" + encodeURIComponent(payload.row),
        body: null
      };
    } else {
      if (onError) onError("Unsupported action: " + action);
      return;
    }

    // Optimistic save: write to the local queue (instant + durable in IndexedDB),
    // ack the UI immediately, and push to the server in the BACKGROUND. Field
    // saves must feel instant, so the round-trip no longer blocks the UI. Client-
    // assigned ids (nest_id, point UUID) mean the server response isn't needed
    // to continue; the queue flushes (with temp-id remap + idempotency) on its
    // own. Enqueue is local, so this resolves in a few ms even with a photo.
    NestApi.queue.enqueue({
      kind: op.kind, tempId: op.tempId || undefined,
      endpoint: op.endpoint, method: op.method, body: op.body, idemKey: idem
    }).then(function () { ok(); flushSoon(); }).catch(fail);
  }

  // Surgical PATCH of specific nest columns WITHOUT the full-record overwrite
  // relayPostApi("update_row") would do. Used to attach a GPS point to an
  // existing nest (and similar targeted updates). API path only: on the Sheets
  // path the point_name == nest_id convention links a point implicitly, so
  // there's nothing to patch. Offline-safe (enqueues like any other write).
  function patchNestFields(nestId, fields, onDone) {
    function done() { if (onDone) onDone(); }
    if (!apiEnabled() || !nestId || !fields) { done(); return; }
    var idem = NestApi.api.newIdemKey();
    var op = {
      kind: "updateNest", tempId: nestId,
      endpoint: "/nests/" + encodeURIComponent(nestId), method: "PATCH",
      body: fields, idemKey: idem
    };
    NestApi.queue.enqueue(op).then(function () { done(); flushSoon(); }).catch(done);
  }

  // Re-record / rename / recolor an EXISTING gps_point: PATCH it in place so the
  // point_id (and every nest.gps_point_id link) is preserved. A re-upload via
  // createGpsPoint would POST the same point_id and collide on the primary key.
  // API path only; offline-safe. Maps the app's flat waypoint to the DB body
  // (lowercase point_class code, DB field names; nav_photo only if a new one).
  function gpsPatchBody(w) {
    var body = {
      point_name: w.point_name,
      point_class: (w.point_class || "").toLowerCase().replace(/\s+/g, "_"),
      latitude: w.latitude,
      longitude: w.longitude,
      elevation: (w.elevation != null) ? w.elevation : null,
      horizontal_accuracy: (w.horizontal_accuracy != null) ? w.horizontal_accuracy : null,
      bearing: (w.bearing != null) ? w.bearing : null,
      note: w.note || null,
      color: w.color || null,
      nav_photo_name: w.photo_name || null,
      datetime: w.time
    };
    if (w.photo) body.nav_photo = w.photo;   // only when a new photo was taken
    return body;
  }

  function patchGpsPoint(pointId, body, onDone) {
    function done() { if (onDone) onDone(); }
    if (!apiEnabled() || !pointId) { done(); return; }
    var idem = NestApi.api.newIdemKey();
    var op = {
      kind: "updateGpsPoint", tempId: pointId,
      endpoint: "/gps_points/" + encodeURIComponent(pointId), method: "PATCH",
      body: body, idemKey: idem
    };
    NestApi.queue.enqueue(op).then(function () { done(); flushSoon(); }).catch(done);
  }

  // Upload a discovery photo and link it to its nest. POST /photos wants the
  // raw base64 (no data-URL prefix) plus kind + nest_id; the app captures a data
  // URL (compressImage), so strip the prefix here. Enqueued AFTER the nest
  // create so it sits later in FIFO order: the queue's temp-id remap rewrites
  // body.nest_id from the temp id to the server id once the create flushes.
  // API path only + offline-safe (like every other write here).
  function uploadNestPhoto(nestId, dataUrl, onDone) {
    function done() { if (onDone) onDone(); }
    if (!apiEnabled() || !nestId || !dataUrl) { done(); return; }
    var comma = String(dataUrl).indexOf(",");
    var b64 = (comma >= 0) ? String(dataUrl).slice(comma + 1) : String(dataUrl);
    if (!b64) { done(); return; }
    var idem = NestApi.api.newIdemKey();
    var op = {
      kind: "uploadPhoto", tempId: nestId,
      endpoint: "/photos", method: "POST",
      body: { image: b64, kind: "original", nest_id: nestId, ext: "jpg" },
      idemKey: idem
    };
    NestApi.queue.enqueue(op).then(function () { done(); flushSoon(); }).catch(done);
  }

  // All backend writes go to the REST API. (The legacy Apps Script relay branch
  // was only reachable without a token, and the token is now mandatory.)
  function relayPost(payload, onSuccess, onError) {
    relayPostApi(payload, onSuccess, onError);
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
    // API path: GET /nests/:id -> { nest, substrates, intervals, gps_point,
    // photos }. Adapt to the JSONP callback's { discovery:{data,row},
    // intervals:[{data,row}] } shape the edit forms expect. The interval "row"
    // slot carries the surrogate check_id (not a sheet row) so the existing
    // updateSheetRow/deleteSheetRow call sites reference it unchanged.
    if (apiEnabled()) {
      if (!NestApi.api.isOnline()) { cb(null); return; }
      NestApi.api.getNest(nestId).then(function (detail) {
        if (!detail || !detail.nest) { cb(null); return; }
        var disc = detail.nest;

        // The response splits one nest across siblings; flatten substrates onto
        // the record under its OWN name. This renames nothing -- the forms read
        // the schema vocabulary, so there is nothing left to translate.

        disc.substrates = detail.substrates;

        var ivs = (detail.intervals || []).map(function (iv) {
          return { data: iv, row: iv.check_id };
        });
        cb({ discovery: { data: disc, row: disc.nest_id }, intervals: ivs });
      }).catch(function () { cb(null); });
      return;
    }
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

  // Build the discovery-form `data` object straight from data we already hold
  // in memory (no network): the boot-loaded nest rows (window.fieldApiNests,
  // full discovery fields) preferred, else the baked/summary nest-info map
  // (window.fieldNestInfo). Returns null only if we truly know nothing about
  // this nest. Mirrors the field->form vocabulary bridging fetchNestDetail does.
  function discoveryDataFromCache(nestId) {
    var apiN = window.fieldApiNests || [];
    for (var i = 0; i < apiN.length; i++) {
      var n = apiN[i];
      if (n && n.nest_id === nestId) {
        var d = {};
        Object.keys(n).forEach(function (k) { d[k] = n[k]; });

        // The API row already speaks the vocabulary the form reads, so it is
        // passed through untouched. gps_point is display-only chrome, not data.

        if ((d.gps_point == null || d.gps_point === "") && d.gps_point_id != null) {
          d.gps_point = d.gps_point_id;
        }
        return d;
      }
    }
    var info = (window.fieldNestInfo && window.fieldNestInfo[nestId]) || null;
    if (info) {
      return {
        species_code: info.species_code,
        patch_id: info.patch_id,
        substrates: info.substrates,
        height_m: info.height_m,
        location_description: info.location_description,
        discovery_date: info.discovery_date
      };
    }
    return null;
  }

  // Cache of full nest details (GET /nests/<id>) keyed by nest_id, so the second
  // open of a nest's Modify screens is instant and a background refresh can fill
  // any fields the cached summary was missing.
  var _nestDetailCache = Object.create(null);

  // Open the discovery-edit form IMMEDIATELY from cached data (never blocks on
  // the network). In the background, fetch the authoritative detail and, if the
  // form is still showing this nest, re-fill it with any richer fields.
  function modifyDiscovery(nestId) {
    var cached = _nestDetailCache[nestId];
    if (cached && cached.discovery) {
      openNestDataEdit(nestId, cached.discovery.data, cached.discovery.row);
    } else {
      var data = discoveryDataFromCache(nestId);
      if (!data) { showUploadModal("No discovery data yet for " + nestId + " — try again once synced."); return; }
      openNestDataEdit(nestId, data, nestId);
    }
    // Background top-up: never awaited, never shows a busy overlay.
    if (apiEnabled() && NestApi.api.isOnline()) {
      fetchNestDetail(nestId, function (detail) {
        if (!detail || !detail.discovery) return;
        _nestDetailCache[nestId] = detail;
        // Only re-fill if the user is still on this nest's discovery form.
        if (nestDataCtx && nestDataCtx.nestId === nestId && nestDataCtx.mode === "edit") {
          fillNestForm(detail.discovery.data);
        }
      });
    }
  }

  // The interval PICKER + edit only need each check's rows (date/time/observer +
  // counts) and its surrogate check_id -- NOT the nest's gps_point photo (which
  // GET /nests/<id> base64-encodes inline) or its substrates. Fetch the lean
  // GET /nests/<id>/intervals instead, so opening "Modify interval" is fast on
  // cell. Bridges the schema field names (check_date/check_time/observer_id) onto
  // the form names the edit form reads, and tags each row with its surrogate
  // check_id -- matching the { data, row } shape fetchNestDetail produced.
  function fetchNestIntervalsLight(nestId, cb) {
    if (!apiEnabled() || !NestApi.api.isOnline()) { cb(null); return; }
    NestApi.api.getNestIntervals(nestId).then(function (rows) {
      if (!Array.isArray(rows)) { cb(null); return; }
      var ivs = rows.map(function (iv) {
        return { data: iv, row: iv.check_id };
      });
      cb(ivs);
    }).catch(function () { cb(null); });
  }

  function modifyIntervalPick(nestId) {
    // Show the picker instantly from cache when we have it; otherwise fetch the
    // lean intervals endpoint once (and cache it), with a light busy state only
    // on that first, uncached open. The lean fetch avoids the heavy full-detail
    // GET /nests/<id> (which dragged the point's base64 nav_photo along and made
    // this slow). Cache is merged (not replaced) so a discovery-detail entry, if
    // present, survives.
    var cached = _nestDetailCache[nestId];
    if (cached && cached.intervals) {
      var have = cached.intervals;
      if (!have.length) { showUploadModal("No interval checks yet for " + nestId + "."); return; }
      openIntervalPicker(nestId, have);
      // Still refresh in the background so newly-added checks appear.
      if (apiEnabled() && NestApi.api.isOnline()) {
        fetchNestIntervalsLight(nestId, function (ivs) {
          if (ivs) {
            _nestDetailCache[nestId] = _nestDetailCache[nestId] || {};
            _nestDetailCache[nestId].intervals = ivs;
          }
        });
      }
      return;
    }
    showBusy("Loading interval checks…");
    fetchNestIntervalsLight(nestId, function (ivs) {
      hideBusy();
      if (!ivs) { showUploadModal("Couldn't load — check signal."); return; }
      _nestDetailCache[nestId] = _nestDetailCache[nestId] || {};
      _nestDetailCache[nestId].intervals = ivs;
      if (!ivs.length) { showUploadModal("No interval checks yet for " + nestId + "."); return; }
      openIntervalPicker(nestId, ivs);
    });
  }

  // Let the live-sync wiring drop a stale full-detail entry when the change feed
  // reports this nest (or one of its checks) was edited on another device, so
  // the next Modify open re-fetches fresh instead of serving a stale cache.
  window.NestApiData = window.NestApiData || {};
  window.NestApiData.invalidateNest = function (nestId) {
    if (nestId && _nestDetailCache[nestId]) delete _nestDetailCache[nestId];
  };
  // Drop every cached nest detail. Used when the change feed reports an
  // interval_check edit: the event carries the check's surrogate id, not the
  // parent nest, so we can't target one nest -- clear all (refilled on demand).
  window.NestApiData.invalidateAllNests = function () {
    Object.keys(_nestDetailCache).forEach(function (k) {
      delete _nestDetailCache[k];
    });
  };

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
      row.textContent = (d.check_date || "?") + "  " + (d.check_time || "");
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

  // Editable discovery-date control, injected once next to the read-only
  // "Discovery date" span. Only shown when MODIFYING an existing nest (the add
  // flow keeps the date fixed to the waypoint's capture date); the span itself
  // is hidden in edit mode so the two never both show. Returns the <input>.
  function ensureNdDateInput() {
    var inp = ndEl("ndDiscoveryDateEdit");
    if (inp) return inp;
    var span = ndEl("ndDiscoveryDate");
    if (!span || !span.parentNode) return null;
    inp = document.createElement("input");
    inp.type = "date";
    inp.id = "ndDiscoveryDateEdit";
    inp.className = "field-input";
    inp.style.display = "none";
    span.parentNode.appendChild(inp);
    return inp;
  }

  function toggleNdDateEdit(isEdit, dateStr) {
    var span = ndEl("ndDiscoveryDate");
    var inp = ensureNdDateInput();
    if (span) span.style.display = isEdit ? "none" : "";
    if (inp) {
      inp.style.display = isEdit ? "" : "none";
      if (isEdit) inp.value = dateStr ? String(dateStr).slice(0, 10) : "";
    }
  }

  // Editable date + time controls for interval checks. They live in the qmd
  // markup (ids ivDateEdit / ivTimeEdit) and are used by BOTH the new-check and
  // edit flows; this also injects them as a fallback should the markup be missing
  // (legacy path -- anchored next to any "Date"/"Time" spans). Returns { date,
  // time } inputs.
  function ensureIvDateTimeInputs() {
    var out = { date: ivEl("ivDateEdit"), time: ivEl("ivTimeEdit") };
    if (out.date && out.time) return out;
    var dSpan = ivEl("ivDate"), tSpan = ivEl("ivTime");
    if (dSpan && dSpan.parentNode && !out.date) {
      out.date = document.createElement("input");
      out.date.type = "date";
      out.date.id = "ivDateEdit";
      out.date.className = "field-input";
      out.date.style.display = "none";
      dSpan.parentNode.appendChild(out.date);
    }
    if (tSpan && tSpan.parentNode && !out.time) {
      out.time = document.createElement("input");
      out.time.type = "time";
      out.time.id = "ivTimeEdit";
      out.time.className = "field-input";
      out.time.style.display = "none";
      tSpan.parentNode.appendChild(out.time);
    }
    return out;
  }

  function toggleIvDateTimeEdit(isEdit, dateStr, timeStr) {
    var dSpan = ivEl("ivDate"), tSpan = ivEl("ivTime");
    var ins = ensureIvDateTimeInputs();
    if (dSpan) dSpan.style.display = isEdit ? "none" : "";
    if (tSpan) tSpan.style.display = isEdit ? "none" : "";
    if (ins.date) {
      ins.date.style.display = isEdit ? "" : "none";
      if (isEdit) ins.date.value = dateStr ? String(dateStr).slice(0, 10) : "";
    }
    if (ins.time) {
      ins.time.style.display = isEdit ? "" : "none";
      if (isEdit) ins.time.value = timeStr ? String(timeStr).slice(0, 5) : "";
    }
  }

  // One reader for the two shapes `substrates` ships in: a comma string (GET
  // /nests) or an array of {substrate_id,label} (GET /nests/<id>).

  function substrateLabels(value) {
    if (value == null || value === "") return [];

    if (Array.isArray(value)) {
      return value
        .map(function (s) { return (s && s.label != null) ? String(s.label) : String(s); })
        .filter(Boolean);
    }
    return String(value)
      .split(",")
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
  }

  // Reads the SCHEMA vocabulary (species_code, height_m, substrates) -- the same
  // names the API and DB use. There is deliberately no second dialect: the two
  // bridges that used to translate into a "form vocabulary" disagreed (one
  // mapped species_code, the other didn't), and whichever ran last won, which is
  // how a filled species dropdown silently blanked itself.

  function fillNestForm(data) {
    data = data || {};
    var sp = ndEl("ndSpecies");
    var spVal = (data.species_code != null) ? String(data.species_code) : "";

    // Bird options are keyed by CODE ("INBU"), but the two specials are keyed by
    // NAME, because speciesChoicesFromLookups drops UNKN/ARNE/OTHER and adds
    // them back by hand. Map the codes onto those names or they miss and fall
    // into the free-text "Other" box.

    if (spVal === "ARNE") spVal = "Artificial nest";
    else if (spVal === "UNKN") spVal = "Unknown";

    if (sp) {
      var known = false;
      Array.prototype.forEach.call(sp.options, function (o) { if (o.value === spVal) known = true; });

      // A genuine free-text species lives in species_other; fall back to the
      // raw value so an unrecognised code is still shown rather than dropped.

      var spOther = (data.species_other != null && data.species_other !== "")
        ? String(data.species_other) : "";

      if (spVal && known) sp.value = spVal;
      else if (spOther || spVal) {
        sp.value = "__other__";
        ndEl("ndSpeciesOther").value = spOther || spVal;
      } else sp.selectedIndex = 0;
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
    ndEl("ndHeight").value =
      (data.height_m != null && data.height_m !== "") ? String(data.height_m) : "";
    var su = ndEl("ndSubstrate");

    // `substrates` arrives as a comma string from GET /nests but as an array of
    // {substrate_id,label} from GET /nests/<id>. Accept both here rather than
    // reintroducing a per-caller bridge; normalise to labels.

    var subs = substrateLabels(data.substrates);
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
    // Edit mode never drafts -- clear the key so the screen's input listeners
    // don't persist edits as an add-draft.
    _ndDraftKey = null;
    buildNestChoices();
    resetNestFields();
    ndEl("ndNestId").textContent = nestId;
    ndEl("ndGpsPoint").textContent = (data && data.gps_point) || nestId;
    ndEl("ndDiscoveryDate").textContent =
      (data && data.discovery_date) ? String(data.discovery_date).slice(0, 10) : "--";
    fillNestForm(data);
    toggleNestEditChrome(true);
    // Modifying a nest: let the user correct the discovery date.
    toggleNdDateEdit(true, (data && data.discovery_date) || null);
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

    // interval_check STORES current_state ('Active'/'Empty'), so trust it. Only
    // infer for legacy rows that predate the column: an Active check with empty
    // counts would otherwise reopen as Empty, silently contradicting the record.

    var active = (data.current_state != null && data.current_state !== "")
      ? (String(data.current_state) === "Active")
      : !!(data.adult_present || data.nest_status || data.young_status ||
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
      ivEl("ivNestStatus").value = data.nest_status || "CN";
      ivEl("ivYoungStatus").value = data.young_status || "NO";
      ivEl("ivObserverActive").value = data.observer_id || "TNS";
      ivEl("ivNotesActive").value = data.notes || "";
    } else {
      ivEl("ivObserver").value = data.observer_id || "TNS";
      ivEl("ivNotes").value = data.notes || "";
    }
    applyIntervalState();
  }

  function openIntervalDataEdit(nestId, data, row) {
    intervalCtx = {
      nestId: nestId,
      mode: "edit",
      sheetRow: row,
      date: (data && data.check_date) || null,
      time: (data && data.check_time) || null
    };
    // Edit mode never drafts.
    _ivDraftKey = null;
    resetIntervalFields();
    ivEl("ivNestId").textContent = nestId;
    fillIntervalForm(data);
    toggleIntervalEditChrome(true);
    // Modifying a check: let the user correct its date + time.
    toggleIvDateTimeEdit(
      true,
      (data && data.check_date) || null,
      (data && data.check_time) || null
    );
    showScreen("intervaldata");
  }
