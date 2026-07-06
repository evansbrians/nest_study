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

  function openAccordion(btn) {
    if (!btn) return;
    btn.classList.add("active");
    var panel = btn.nextElementSibling;
    if (panel && panel.classList.contains("panel")) panel.style.display = "block";
  }

  function findNestAccordion(nestId) {
    var groups = document.querySelectorAll("#nestsDoc .nest-view");
    for (var g = 0; g < groups.length; g++) {
      if (groups[g].offsetParent === null) continue;
      var accs = groups[g].querySelectorAll(".accordion");
      for (var i = 0; i < accs.length; i++) {
        var st = accs[i].querySelector("strong");
        if (st && st.textContent.replace(/\.\s*$/, "") === nestId) return accs[i];
      }
    }
    return null;
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
    showScreen("nestmodify");
  };

  // Jump straight to a fresh interval-check for a nest (from a map popup).
  window.fieldAddInterval = function (nestId) {
    ensureMenuOpen();
    openIntervalData({ nestId: nestId, mode: "add" });
  };
