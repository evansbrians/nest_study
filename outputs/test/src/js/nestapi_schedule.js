// nestapi_schedule.js --------------------------------------------------------
// Renders the daily schedule from structured GET /schedule rows (schedule_day)
// into #scheduleDoc, reusing the schedule CSS + accordion.js. Data-driven: any
// schedule Tara pushes to the DB renders here with no app re-render. Mirrors the
// markup the R schedule.R produced (morning times, point counts, nest-search).

(function () {
  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Blank / missing / "-" -> "-"; otherwise the trimmed value.
  function dash(v) {
    if (v === null || v === undefined) return "-";
    var s = String(v).trim();
    return s === "" ? "-" : s;
  }

  function isVal(v) {
    if (v === null || v === undefined) return false;
    var s = String(v).trim();
    return s !== "" && s !== "-";
  }

  // pretty_patch(): underscores -> spaces, sentence case ("grassland_b" ->
  // "Grassland b").
  function prettyPatch(v) {
    if (v === null || v === undefined) return "-";
    var s = String(v).replace(/_/g, " ").trim();
    if (s === "") return "-";
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  function dateLabel(iso) {
    var d = new Date(iso + "T12:00:00");
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric"
    });
  }

  function morningTable(r) {
    return (
      '<table class="schedule-table morning-table">' +
      "<thead><tr>" +
      "<th>Home departure</th><th>Arrival</th><th>Sunrise</th><th>SCBI departure</th>" +
      "</tr></thead><tbody><tr>" +
      "<td>" + esc(dash(r.departure_time)) + "</td>" +
      "<td>" + esc(dash(r.arrive)) + "</td>" +
      "<td>" + esc(dash(r.sunrise)) + "</td>" +
      "<td>" + esc(dash(r.scbi_departure_time)) + "</td>" +
      "</tr></tbody></table>"
    );
  }

  // {nest_id -> selfie_stick truthy} from window.fieldApiNests, rebuilt per
  // render so app-created nests are included.
  var selfieLookup = {};
  function buildSelfieLookup() {
    selfieLookup = {};
    var nests = window.fieldApiNests || [];
    for (var i = 0; i < nests.length; i++) {
      var n = nests[i];
      if (n && n.nest_id != null && (n.selfie_stick === 1 || n.selfie_stick === true)) {
        selfieLookup[String(n.nest_id)] = true;
      }
    }
  }

  // The DB loader stores check_nests with .mark_tall_nests = FALSE, so append
  // the giraffe here (matching scheduling_functions.R str_c(nest_id, "\U1F992")).
  // check_nests is a comma-separated id list, each segment possibly carrying
  // trailing text -- mark the leading id token when it's a selfie-stick nest.
  function markCheckNests(v) {
    if (!isVal(v)) return dash(v);
    return String(v)
      .split(",")
      .map(function (seg) {
        var s = seg.trim();
        if (s === "") return "";
        var m = /^(\S+)([\s\S]*)$/.exec(s);
        var id = m ? m[1] : s;
        var rest = m ? m[2] : "";
        return selfieLookup[id] ? id + "🦒" + rest : s;
      })
      .filter(function (s) { return s !== ""; })
      .join(", ");
  }

  function predCountsTable(rows) {
    var body = rows
      .slice()
      .sort(function (a, b) {
        return (Number(a.patch_order) || 0) - (Number(b.patch_order) || 0);
      })
      .map(function (r) {
        return (
          "<tr>" +
          "<td>" + esc(dash(r.point_count_time)) + "</td>" +
          "<td>" + esc(prettyPatch(r.patch_count)) + "</td>" +
          "<td>" + esc(dash(r.boards)) + "</td>" +
          "<td>" + esc(markCheckNests(r.check_nests)) + "</td>" +
          "<td>" + esc(dash(r.predator_cameras)) + "</td>" +
          "</tr>"
        );
      })
      .join("");
    return (
      '<table class="schedule-table">' +
      "<thead><tr>" +
      "<th>Time</th><th>Patch</th><th>Boards</th><th>Nests</th><th>Cams</th>" +
      "</tr></thead><tbody>" + body + "</tbody></table>"
    );
  }

  // Each search patch keeps its own TNS/helper activity (slot-bound), so a blank
  // search_patch_1 can never shift patch 2's activities onto the wrong row.
  function searchingTable(r) {
    var slots = [
      { patch: r.search_patch_1, tns: r.tns_patch_1, help: r.helper_patch_1 },
      { patch: r.search_patch_2, tns: r.tns_patch_2, help: r.helper_patch_2 }
    ].filter(function (s) {
      return isVal(s.patch);
    });
    if (!slots.length) return "";

    var hasHelper = dash(r.helper) !== "-";
    var rowsHtml = slots
      .map(function (s) {
        var patchCell =
          '<td class="sched-patch" rowspan="' +
          (hasHelper ? "2" : "1") +
          '">' + esc(prettyPatch(s.patch)) + "</td>";
        if (hasHelper) {
          return (
            "<tr>" + patchCell + "<td>TNS</td><td>" + esc(dash(s.tns)) + "</td></tr>" +
            "<tr><td>" + esc(dash(r.helper)) + "</td><td>" + esc(dash(s.help)) + "</td></tr>"
          );
        }
        return "<tr>" + patchCell + "<td>TNS</td><td>" + esc(dash(s.tns)) + "</td></tr>";
      })
      .join("");

    return (
      '<table class="schedule-table">' +
      "<thead><tr><th>Patch</th><th>Person</th><th>Activities</th></tr></thead>" +
      "<tbody>" + rowsHtml + "</tbody></table>"
    );
  }

  function searchingLine(r) {
    var patches = [r.search_patch_1, r.search_patch_2].filter(isVal).map(prettyPatch);
    if (!patches.length) return "";
    return (
      "<p><strong>Nest searching: </strong>" +
      patches.map(esc).join(" → ") +
      "</p>"
    );
  }

  function noteList(notes) {
    if (!isVal(notes)) return "";
    var items = String(notes)
      .split("\n")
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s !== ""; })
      .map(function (s) { return "<li>" + esc(s) + "</li>"; })
      .join("");
    if (!items) return "";
    return '<p><strong>Notes:</strong></p><ul class="schedule-notes">' + items + "</ul>";
  }

  // Weather block from the row's `weather` JSON string. Mirrors weather_section()
  // in scheduling_functions.R: a "Weather: <detailed>" narrative + a
  // "High …°F · Chance of rain …%" summary line (both always visible), then a
  // collapsible hourly table. New shape is an object
  // { detailed, summary, hourly:[{time,forecast,temp,rain}] }; older cached rows
  // were a bare hourly array, still handled. Renders nothing when absent.
  function weatherSection(r) {
    if (!isVal(r.weather)) return "";
    var w;
    try {
      w = JSON.parse(r.weather);
    } catch (e) {
      return "";
    }

    var detailed = "";
    var summary = "";
    var hours;
    if (Array.isArray(w)) {
      hours = w;
    } else if (w && typeof w === "object") {
      detailed = w.detailed || "";
      summary = w.summary || "";
      hours = Array.isArray(w.hourly) ? w.hourly : [];
    } else {
      return "";
    }

    var head = "";
    if (isVal(detailed)) {
      head += "<p><strong>Weather: </strong>" + esc(detailed) + "</p>";
    }
    if (isVal(summary)) {
      head += '<p class="weather-summary">' + esc(summary) + "</p>";
    }

    var body = hours
      .map(function (h) {
        if (!h) return "";
        return (
          "<tr>" +
          "<td>" + esc(dash(h.time)) + "</td>" +
          "<td>" + esc(dash(h.forecast)) + "</td>" +
          "<td>" + esc(dash(h.temp)) + "</td>" +
          "<td>" + esc(dash(h.rain)) + "</td>" +
          "</tr>"
        );
      })
      .join("");
    var hourlyBlock = body
      ? '<div class="accordion-group">' +
        '<button type="button" class="accordion">Hourly forecast</button>' +
        '<div class="panel">' +
        '<table class="schedule-table">' +
        "<thead><tr><th>Time</th><th>Forecast</th><th>Temp</th><th>Rain</th></tr></thead>" +
        "<tbody>" + body + "</tbody></table>" +
        "</div></div>"
      : "";

    return head + hourlyBlock;
  }

  function dayPanel(iso, rows) {
    var r = rows[0];
    var parts = [];
    parts.push("<p><em>Helper: " + esc(dash(r.helper)) + "</em></p>");
    parts.push(morningTable(r));
    parts.push(
      "<p><strong>Point count times, coverboards, and nests to check:</strong></p>"
    );
    parts.push(predCountsTable(rows));
    parts.push(searchingLine(r));
    parts.push(searchingTable(r));
    parts.push(noteList(r.notes));
    parts.push(weatherSection(r));
    return (
      '<button type="button" class="accordion" data-date="' + esc(iso) + '">' +
      esc(dateLabel(iso)) + "</button>" +
      '<div class="panel">' + parts.join("") + "</div>"
    );
  }

  function isFieldDay(r) {
    return r.field === true || String(r.field) === "TRUE";
  }

  // Render precedence (replaces the old "richness score" guard, which could let
  // a cache render outrank and permanently block a live render at a week
  // transition -- schedule and map then showed different weeks). Rules: a LIVE
  // render always beats a CACHE render, and a later live render beats an earlier
  // one (ordered by the increasing request seq the caller passes in opts.seq).
  // Cache renders never overwrite a live render.
  var _liveRendered = false;
  var _lastLiveSeq = 0;

  function renderSchedule(rows, opts) {
    var host = document.getElementById("scheduleDoc");
    if (!host) return;

    opts = opts || {};
    if (opts.cache) {
      if (_liveRendered) return;               // never downgrade live -> cache
    } else {
      var seq = opts.seq || 0;
      if (seq && seq < _lastLiveSeq) return;   // a newer live render already applied
      if (seq) _lastLiveSeq = seq;
      _liveRendered = true;
    }

    buildSelfieLookup();

    // Group by date (field days only, matching the R schedule), date-ordered.
    var byDate = {};
    var order = [];
    if (Array.isArray(rows)) {
      rows.forEach(function (r) {
        if (!isFieldDay(r)) return;
        var d = r.date;
        if (!byDate[d]) { byDate[d] = []; order.push(d); }
        byDate[d].push(r);
      });
    }
    order.sort();

    if (!order.length) {
      host.innerHTML = (Array.isArray(rows) && rows.length)
        ? "<p>No field days scheduled this week.</p>"
        : "<p>The schedule is currently unavailable.</p>";
      return;
    }

    var panels = order
      .map(function (d) { return dayPanel(d, byDate[d]); })
      .join("");
    host.innerHTML =
      '<div class="accordion-group" data-open-today="true">' + panels + "</div>";

    if (typeof window.fieldInitAccordions === "function") {
      try { window.fieldInitAccordions(host); } catch (e) {}
    }
  }

  window.fieldRenderSchedule = renderSchedule;
})();
