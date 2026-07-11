// Page glue: doc injectors, nest-view toggles, offline-tile patch, nest
// detail maps, and accordion group behavior. Extracted from field_map.qmd
// inline <script> blocks; injected at end of body by the qmd.

(function(){var el=document.getElementById("speciesInfoDoc");if(el&&window.fieldSpeciesHTML)el.innerHTML=window.fieldSpeciesHTML;})();

(function(){var el=document.getElementById("nestsDoc");if(el&&window.fieldNestsHTML)el.innerHTML=window.fieldNestsHTML;})();

document.addEventListener("DOMContentLoaded", function () {
  var doc = document.getElementById("nestsDoc");
  if (!doc) return;
  var groupToggle = document.getElementById("nestGroupToggle");
  var currentToggle = document.getElementById("nestCurrentToggle");
  var todayToggle = document.getElementById("nestTodayToggle");
  var allView = document.getElementById("nest-view-all");
  var patchView = document.getElementById("nest-view-patch");

  // Flag every nest + patch element as "today" if its patch is on today's
  // schedule (window.fieldToday.patches), so the Today's-nests filter can act.
  var todayPatches = {};
  ((window.fieldToday && window.fieldToday.patches) || []).forEach(function (p) {
    todayPatches[String(p)] = true;
  });
  var marked = doc.querySelectorAll("[data-patch]");
  for (var i = 0; i < marked.length; i++) {
    marked[i].setAttribute(
      "data-today",
      todayPatches[marked[i].getAttribute("data-patch")] ? "true" : "false"
    );
  }

  function applyGroup() {
    var grouped = groupToggle.checked;
    if (allView) allView.style.display = grouped ? "none" : "block";
    if (patchView) patchView.style.display = grouped ? "block" : "none";
  }

  function applyCurrent() {
    if (currentToggle.checked) doc.classList.add("show-current-only");
    else doc.classList.remove("show-current-only");
  }

  function applyToday() {
    if (todayToggle && todayToggle.checked) doc.classList.add("show-today-only");
    else doc.classList.remove("show-today-only");
  }

  if (groupToggle) groupToggle.addEventListener("change", applyGroup);
  if (currentToggle) currentToggle.addEventListener("change", applyCurrent);
  if (todayToggle) todayToggle.addEventListener("change", applyToday);

  applyGroup();
  applyCurrent();
  applyToday();
});

(function () {
  function offlinePatch(layer) {
    if (layer._offlinePatched) return;
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
  }

  function nestPoint(nestId) {
    var pts = window.fieldMapPoints || [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.name === nestId && p.lat != null && p.lng != null &&
          !isNaN(p.lat) && !isNaN(p.lng)) {
        return p;
      }
    }
    return null;
  }

  function buildNestMap(container, nestId) {
    if (!window.L) return null;
    var pts = window.fieldMapPoints || [];
    var target = nestPoint(nestId);
    if (!target) return null;
    var center = [target.lat, target.lng];
    var map = window.L.map(container, { attributionControl: false });
    map.setView(center, 19);

    var tiles = window.L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 21 }
    );
    offlinePatch(tiles);
    tiles.addTo(map);

    if (window.fieldPatches) {
      Object.keys(window.fieldPatches).forEach(function (pn) {
        window.fieldPatches[pn].forEach(function (ring) {
          window.L.polygon(ring, {
            color: "#0000ff", weight: 1.5, opacity: 0.5,
            fillColor: "#ffffff", fillOpacity: 0.2
          }).addTo(map);
        });
      });
    }

    (window.fieldPaths || []).forEach(function (line) {
      window.L.polyline(line, {
        color: "#ffff00", weight: 3, opacity: 0.7, dashArray: "2, 5"
      }).addTo(map);
    });

    pts.forEach(function (p) {
      var op = (p.name === nestId) ? 1 : 0.3;
      var ic = window.fieldIcons && window.fieldIcons[p.icon_id];
      var marker;
      if (ic) {
        marker = window.L.marker([p.lat, p.lng], {
          opacity: op,
          icon: window.L.icon({
            iconUrl: ic.iconUrl,
            iconSize: [ic.iconWidth, ic.iconHeight],
            iconAnchor: [ic.iconAnchorX, ic.iconAnchorY]
          })
        });
      } else {
        marker = window.L.circleMarker([p.lat, p.lng], {
          radius: 5, color: "#333333", weight: 1,
          opacity: op, fillOpacity: op
        });
      }
      marker.addTo(map);
    });

    setTimeout(function () {
      map.invalidateSize();
      map.setView(center, 19);
    }, 60);
    return map;
  }

  var containers = document.querySelectorAll("#nestsDoc .nest-detail-map");
  for (var i = 0; i < containers.length; i++) {
    (function (container) {
      var nestId = container.getAttribute("data-nest");
      if (!nestPoint(nestId)) { container.style.display = "none"; return; }
      var panel = container.closest(".panel");
      if (!panel) return;
      var button = panel.previousElementSibling;
      if (!button) return;
      button.addEventListener("click", function () {
        setTimeout(function () {
          if (panel.style.display !== "block") return;
          if (!container._nestMap) {
            container._nestMap = buildNestMap(container, nestId);
          } else {
            container._nestMap.invalidateSize();
          }
        }, 60);
      });
    })(containers[i]);
  }
})();

(function(){var el=document.getElementById("scheduleDoc");if(el&&window.fieldScheduleHTML)el.innerHTML=window.fieldScheduleHTML;})();

document.addEventListener("DOMContentLoaded", function () {
  var groups = document.querySelectorAll(".accordion-group");
  for (var g = 0; g < groups.length; g++) {
    (function (group) {
      var accs = group.querySelectorAll(":scope > .accordion");
      for (var i = 0; i < accs.length; i++) {
        (function (acc) {
          acc.addEventListener("click", function () {
            var tp = acc.nextElementSibling;
            if (!tp || !tp.classList.contains("panel") ||
                tp.style.display !== "block") return;
            for (var j = 0; j < accs.length; j++) {
              if (accs[j] === acc) continue;
              var p = accs[j].nextElementSibling;
              if (p && p.classList.contains("panel") &&
                  p.style.display === "block") {
                p.style.display = "none";
                accs[j].classList.remove("active");
              }
            }
          });
        })(accs[i]);
      }
    })(groups[g]);
  }
});
