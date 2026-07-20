// Page navigation: screen/menu switching + nest view/modify entry points.
// Assembled into the single field-map IIFE at build (see field_map.qmd).

  function activeScreen() {
    var a = overlay.querySelector(".field-screen.is-active");
    return a ? a.dataset.name : null;
  }

  function updateBar() {
    var open = overlay.classList.contains("is-open");
    var onMap = !open;
    var onNestInfo = open && activeScreen() === "nestinfo";
    var onSub = open && activeScreen() !== "main" && !onNestInfo;

    hideEl(menuBtn, !onMap);
    hideEl(accEl, !onMap);
    hideEl(brgEl, !onMap);
    hideEl(mapBtn, !open || onNestInfo);   // "Map" shows when menu open (except nest info)
    hideEl(mainMenuBtn, !onSub);           // "Main Menu" only on sub-screens
    hideEl(sidebarBackBtn, !onSub);        // desktop sidebar back-to-menu (CSS-gated)

    // Nest info page uses its own Back / Main menu / Map bar buttons.

    hideEl(niBarBack, !onNestInfo);
    hideEl(niBarMain, !onNestInfo);
    hideEl(niBarMap, !onNestInfo);

    // Desktop: the main menu is a narrow sidebar, but a sub-page takes over the
    // full screen (like the phone app). CSS-gated to wide screens.

    overlay.classList.toggle("field-fullscreen", onSub || onNestInfo);
  }

  function showScreen(name) {
    var screens = overlay.querySelectorAll(".field-screen");
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle("is-active", screens[i].dataset.name === name);
    }
    updateBar();

    // Auto-start/stop averaging based on whether Add Waypoint is showing.

    if (typeof syncAveraging === "function") syncAveraging();

    // Let the concealment module open/close its live camera as its screen
    // is entered/left (one continuous stream while the screen is showing).

    if (typeof syncConcealCamera === "function") syncConcealCamera();
  }

  function openMenu() {
    overlay.classList.add("is-open");
    menuBtn.setAttribute("aria-expanded", "true");
    showScreen("main");
  }

  function closeMenu() {
    overlay.classList.remove("is-open");
    menuBtn.setAttribute("aria-expanded", "false");

    // On desktop the sidebar is permanent; return it to the main nav rather
    // than leaving the last sub-screen showing.

    if (isWide) showScreen("main");
    updateBar();
    if (typeof syncAveraging === "function") syncAveraging();
    if (typeof syncConcealCamera === "function") syncConcealCamera();
  }

  // Open the menu overlay without changing the current screen -- used by map
  // popup / marker actions, which fire while the menu is closed.
  function ensureMenuOpen() {
    overlay.classList.add("is-open");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "true");
  }

  // View now opens the dedicated Nest info page.
  window.fieldViewNest = function (nestId) {
    if (window.fieldOpenNestInfo) window.fieldOpenNestInfo(nestId);
  };

  window.fieldOpenNestModify = function (nestId) {
    ensureMenuOpen();
    modifyNestId = nestId;
    var idEl = document.getElementById("nmNestId");
    if (idEl) idEl.textContent = nestId || "--";

    // Show only the buttons that apply to THIS target -- a full nest and a bare
    // gps_point (a stray waypoint with no nest data) need different menus.
    // fieldModifyContext resolves the point + what data exists.

    var ctx = (window.fieldModifyContext && window.fieldModifyContext(nestId)) || {};
    var show = function (id, on) {
      var el = document.getElementById(id);
      if (el) el.style.display = on ? "" : "none";
    };

    // Location: no point -> Add GPS; has a point -> Re-record + Modify waypoint.

    show("nmAddGps", !ctx.hasCoords);
    show("nmReRecordGps", ctx.hasCoords);
    show("nmModifyWaypoint", ctx.hasCoords);

    // Discovery: a nest exists -> Modify + Delete; a bare point -> Add.

    show("nmModifyDiscovery", ctx.isNest);
    show("nmDeleteDiscovery", ctx.isNest);
    show("nmAddNestDiscovery", ctx.hasCoords && !ctx.isNest);

    // Interval data lives UNDER a nest (interval_check.nest_id FK), so Add/Modify
    // interval only make sense once discovery exists. Modify + Delete need a
    // recorded check.

    show("nmAddInterval", ctx.isNest);
    show("nmModifyInterval", ctx.hasIntervals);
    show("nmDeleteIntervals", ctx.hasIntervals);

    // Reassigning to an artificial nest acts on an existing nest.

    show("nmMakeArtificial", ctx.isNest);

    // Delete the point itself -- needs a point and sole ownership (a point shared
    // by an N + NQ twin is refused; the server enforces this too). Label reflects
    // whether it carries a nest.

    var delGps = document.getElementById("nmDeleteGps");
    if (delGps) {
      delGps.textContent = ctx.isNest ? "Delete GPS point" : "Delete waypoint";
      delGps.style.display = (ctx.hasCoords && !ctx.shared) ? "" : "none";
    }

    showScreen("nestmodify");
  };

  // Jump straight to a fresh interval-check for a nest (from a map popup).
  window.fieldAddInterval = function (nestId) {
    ensureMenuOpen();
    openIntervalData({ nestId: nestId, mode: "add" });
  };
