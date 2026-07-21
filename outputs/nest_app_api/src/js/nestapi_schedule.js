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

  // ---- weather-day shift (read-only mirror of the GUI schedule editor) ------
  //
  // The field-day flags drive a plan->date alignment: when a day is a weather
  // cancellation (field = FALSE) its plan bumps forward onto the next field day,
  // spilling into Sunday. Only helper + weather + the receiving date's own times
  // stay pinned to the calendar date; everything else travels with the plan.
  // Same deterministic assignment as snedgen-gui/schedule.js (see assign.py).

  var PINNED_FIELDS = [
    "helper", "weather", "field", "arrive", "sunrise",
    "departure_time", "scbi_departure_time", "point_count_time"
  ];

  function isoOf(d) {
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());

    if (m.length < 2) m = "0" + m;
    if (day.length < 2) day = "0" + day;
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function mondayIso(isoS) {
    var d = new Date(isoS + "T00:00:00");
    var dow = (d.getDay() + 6) % 7;

    d.setDate(d.getDate() - dow);
    return isoOf(d);
  }

  function addDaysIso(isoS, n) {
    var d = new Date(isoS + "T00:00:00");

    d.setDate(d.getDate() + n);
    return isoOf(d);
  }

  // { displayDate -> homeDate whose plan shows there | null }. Past dates are
  // frozen to their own plan; the rest place onto field-eligible dates from
  // today forward, Sunday included.
  function computeAssignment(dates, byDate, today) {
    var plans = [];
    var i;

    for (i = 0; i < 6; i++) {
      if (byDate[dates[i]] && byDate[dates[i]].length) plans.push(dates[i]);
    }

    var assign = {};
    var remaining = [];

    plans.forEach(function (hd) {
      if (hd < today) assign[hd] = hd;
      else remaining.push(hd);
    });

    var k = 0;

    dates.forEach(function (d) {
      if (d < today) {
        if (!(d in assign)) assign[d] = null;
        return;
      }
      var rs = byDate[d];

      if (rs && rs.length && !isFieldDay(rs[0])) {
        assign[d] = null;
        return;
      }
      if (k < remaining.length) {
        assign[d] = remaining[k];
        k += 1;
      } else {
        assign[d] = null;
      }
    });
    return assign;
  }

  // The rows shown on a display date: the assigned plan's rows, with the pinned
  // fields overlaid from the display date's own row.
  function displayRowsFor(displayDate, assign, byDate) {
    var homeDate = assign[displayDate];

    if (!homeDate) return [];

    var planRows = byDate[homeDate] || [];
    var pinnedSrc = (byDate[displayDate] && byDate[displayDate][0]) || null;

    return planRows.map(function (pr) {
      var out = {};
      var key;

      for (key in pr) {
        if (Object.prototype.hasOwnProperty.call(pr, key)) out[key] = pr[key];
      }
      if (pinnedSrc) {
        PINNED_FIELDS.forEach(function (k2) { out[k2] = pinnedSrc[k2]; });
      }
      out.date = displayDate;
      return out;
    });
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

    // Group ALL rows by date (weather-cancelled days still hold their plan),
    // then apply the weather-day shift: each display date shows the plan now
    // assigned to it, or nothing if a cancellation moved its plan forward.
    var byDate = {};
    if (Array.isArray(rows)) {
      rows.forEach(function (r) {
        var d = r.date;
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(r);
      });
    }

    var allDates = Object.keys(byDate).sort();
    if (!allDates.length) {
      host.innerHTML = "<p>The schedule is currently unavailable.</p>";
      return;
    }

    var weekMon = mondayIso(allDates[0]);
    var week = [];
    var wi;
    for (wi = 0; wi < 7; wi++) week.push(addDaysIso(weekMon, wi));

    var assign = computeAssignment(week, byDate, isoOf(new Date()));
    var order = week.filter(function (d) { return assign[d]; });

    if (!order.length) {
      host.innerHTML = "<p>No field days scheduled this week.</p>";
      return;
    }

    var panels = order
      .map(function (d) { return dayPanel(d, displayRowsFor(d, assign, byDate)); })
      .join("");
    host.innerHTML =
      '<div class="accordion-group" data-open-today="true">' + panels + "</div>";

    if (typeof window.fieldInitAccordions === "function") {
      try { window.fieldInitAccordions(host); } catch (e) {}
    }
  }

  window.fieldRenderSchedule = renderSchedule;
})();
