// Page navigation: screen/menu switching + nest view/modify entry points.
// Assembled into the single field-map IIFE at build (see field_map.qmd).

  function activeScreen() {
    var a = overlay.querySelector(".field-screen.is-active");
    return a ? a.dataset.name : null;
  }

  function updateBar() {
    var open = overlay.classList.contains("is-open");
    var onMap = !open;
    var onSub = open && activeScreen() !== "main";

    hideEl(menuBtn, !onMap);
    hideEl(accEl, !onMap);
    hideEl(brgEl, !onMap);
    hideEl(mapBtn, !open);          // "Map" shows whenever the menu is open
    hideEl(mainMenuBtn, !onSub);    // "Main Menu" only on sub-screens
    hideEl(sidebarBackBtn, !onSub); // desktop sidebar back-to-menu (CSS-gated)

    // Desktop: the main menu is a narrow sidebar, but a sub-page takes over the
    // full screen (like the phone app). CSS-gated to wide screens.

    overlay.classList.toggle("field-fullscreen", onSub);
  }

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

    // On desktop the sidebar is permanent; return it to the main nav rather
    // than leaving the last sub-screen showing.

    if (isWide) showScreen("main");
    updateBar();
    if (typeof syncAveraging === "function") syncAveraging();
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

  window.fieldViewNest = function (nestId) {
    showScreen("nests");
    var btn = findNestAccordion(nestId);
    if (!btn) return;
    var patchPanel = btn.closest(".patch-panel");
    if (patchPanel) {
      var patchBtn = patchPanel.previousElementSibling;
      if (patchBtn && patchBtn.classList.contains("patch-accordion")) openAccordion(patchBtn);
    }
    openAccordion(btn);
    var panel = btn.nextElementSibling;
    var detail = panel &&
      panel.querySelector('.nest-view-detail[data-nest="' + nestId + '"]');
    if (detail) detail.style.display = "block";
    (detail || btn).scrollIntoView({ behavior: "smooth", block: "start" });
  };

  window.fieldOpenNestModify = function (nestId) {
    modifyNestId = nestId;
    var idEl = document.getElementById("nmNestId");
    if (idEl) idEl.textContent = nestId || "--";
    showScreen("nestmodify");
  };
