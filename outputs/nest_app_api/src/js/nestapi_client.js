// nestapi_client.js -- fetch wrapper + one async method per API endpoint.
// Attaches NestApi.api to the shared global namespace.
// Depends on NestApi.settings (nestapi_settings.js) for base URL + token.
window.NestApi = window.NestApi || {};

(function (NestApi) {
  "use strict";

  // Thrown on any non-2xx response. Carries the HTTP status and the parsed
  // (or raw) error body so callers can branch on 401 vs 404 vs 5xx.
  function ApiError(message, status, body) {
    this.name = "ApiError";
    this.message = message;
    this.status = status;
    this.body = body;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  // RFC 4122 v4 UUID. Uses crypto when available, falls back to Math.random.
  function newIdemKey() {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
    var buf;
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      buf = new Uint8Array(16);
      crypto.getRandomValues(buf);
    } else {
      buf = new Uint8Array(16);
      for (var i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
    }
    buf[6] = (buf[6] & 0x0f) | 0x40; // version 4
    buf[8] = (buf[8] & 0x3f) | 0x80; // variant 10xx
    var hex = [];
    for (var j = 0; j < 256; j++) hex[j] = (j + 0x100).toString(16).slice(1);
    return (
      hex[buf[0]] + hex[buf[1]] + hex[buf[2]] + hex[buf[3]] + "-" +
      hex[buf[4]] + hex[buf[5]] + "-" +
      hex[buf[6]] + hex[buf[7]] + "-" +
      hex[buf[8]] + hex[buf[9]] + "-" +
      hex[buf[10]] + hex[buf[11]] + hex[buf[12]] +
      hex[buf[13]] + hex[buf[14]] + hex[buf[15]]
    );
  }

  function isOnline() {
    return typeof navigator === "undefined" ? true : navigator.onLine !== false;
  }

  // Encode a query object into "?a=1&b=2", skipping null/undefined/"" values.
  function qs(params) {
    if (!params) return "";
    var parts = [];
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === null || v === undefined || v === "") return;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  // Core request. opts: { method, body, idemKey, headers, timeoutMs }.
  async function request(path, opts) {
    opts = opts || {};
    var base = NestApi.settings.getUrl();
    var url = base + path;

    var headers = {
      Accept: "application/json"
    };
    var token = NestApi.settings.getToken();
    if (token) headers.Authorization = "Bearer " + token;
    if (opts.idemKey) headers["X-Idempotency-Key"] = opts.idemKey;

    var init = { method: opts.method || "GET", headers: headers };

    if (opts.body !== undefined && opts.body !== null) {
      headers["Content-Type"] = "application/json";
      init.body =
        typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    }
    if (opts.headers) {
      Object.keys(opts.headers).forEach(function (k) {
        headers[k] = opts.headers[k];
      });
    }

    // Optional timeout via AbortController (used by the long-poll).
    var controller = null;
    var timer = null;
    if (opts.timeoutMs && typeof AbortController !== "undefined") {
      controller = new AbortController();
      init.signal = controller.signal;
      timer = setTimeout(function () {
        controller.abort();
      }, opts.timeoutMs);
    }

    var res;
    try {
      res = await fetch(url, init);
    } finally {
      if (timer) clearTimeout(timer);
    }

    var ct = res.headers.get("content-type") || "";
    var payload = null;
    if (ct.indexOf("application/json") !== -1) {
      payload = await res.json().catch(function () {
        return null;
      });
    } else {
      payload = await res.text().catch(function () {
        return null;
      });
    }

    if (!res.ok) {
      var msg =
        payload && payload.error
          ? payload.error
          : "HTTP " + res.status + " for " + path;
      throw new ApiError(msg, res.status, payload);
    }
    return payload;
  }

  NestApi.api = {
    ApiError: ApiError,
    newIdemKey: newIdemKey,
    isOnline: isOnline,
    request: request,

    // ----- Reads -----------------------------------------------------------

    // GET /lookups -> { patches, observers, species, substrates, ... }
    getLookups: function () {
      return request("/lookups");
    },

    // GET /nests  (?patch, ?current=true, ?since=<event_id>) -> array of nests
    getNests: function (opts) {
      opts = opts || {};
      var params = {};
      if (opts.patch) params.patch = opts.patch;
      if (opts.current) params.current = "true";
      if (opts.since !== undefined && opts.since !== null) {
        params.since = opts.since;
      }
      return request("/nests" + qs(params));
    },

    // GET /nests/<id> -> { nest, substrates, intervals, gps_point, photos }
    getNest: function (id) {
      return request("/nests/" + encodeURIComponent(id));
    },

    // GET /nests/<id>/intervals -> array of interval checks
    getNestIntervals: function (id) {
      return request("/nests/" + encodeURIComponent(id) + "/intervals");
    },

    // GET /gps_points  (?class=nest etc.) -> GeoJSON FeatureCollection.
    // The list carries has_nav_photo (a flag), NOT the photo bytes; fetch a
    // point's photo lazily with getGpsPointPhoto below.
    getGpsPoints: function (pointClass) {
      var params = {};
      if (pointClass) params["class"] = pointClass;
      return request("/gps_points" + qs(params));
    },

    // GET /gps_points/<id>/photo -> { point_id, nav_photo (base64|null),
    // nav_photo_name }. Lazy per-point photo for map popups.
    getGpsPointPhoto: function (id) {
      return request("/gps_points/" + encodeURIComponent(id) + "/photo");
    },

    // GET /predator_cameras -> array of cameras + latest maintenance
    getPredatorCameras: function () {
      return request("/predator_cameras");
    },

    // GET /schedule (?date=YYYY-MM-DD or ?week=<n>) -> schedule_day rows for a
    // sampling week; the app groups by date and renders the accordion.
    getSchedule: function (opts) {
      opts = opts || {};
      var params = {};
      if (opts.date) params.date = opts.date;
      if (opts.week !== undefined && opts.week !== null) params.week = opts.week;
      return request("/schedule" + qs(params));
    },

    // GET /changes?since=<event_id>&wait=<seconds>  (long-poll, blocks ~wait s)
    // -> { since, last_event_id, events: [...] }
    getChanges: function (since, waitSeconds) {
      var params = { since: since === undefined || since === null ? 0 : since };
      if (waitSeconds !== undefined && waitSeconds !== null) {
        params.wait = waitSeconds;
      }
      // Give fetch a little slack past the server's wait window.
      var wait = waitSeconds === undefined || waitSeconds === null ? 25 : waitSeconds;
      return request("/changes" + qs(params), {
        timeoutMs: (Number(wait) + 15) * 1000
      });
    },

    // ----- Writes ----------------------------------------------------------

    // POST /nests  (body: discovery fields WITHOUT nest_id; server allocates id)
    createNest: function (body, idemKey) {
      return request("/nests", {
        method: "POST",
        body: body || {},
        idemKey: idemKey
      });
    },

    // PATCH /nests/<id>  (edit discovery fields)
    updateNest: function (id, body, idemKey) {
      return request("/nests/" + encodeURIComponent(id), {
        method: "PATCH",
        body: body || {},
        idemKey: idemKey
      });
    },

    // POST /nests/<id>/intervals  (add one interval check; server assigns check_id)
    addInterval: function (nestId, body, idemKey) {
      return request("/nests/" + encodeURIComponent(nestId) + "/intervals", {
        method: "POST",
        body: body || {},
        idemKey: idemKey
      });
    },

    // PATCH /intervals/<check_id>  (edit a check)
    updateInterval: function (checkId, body, idemKey) {
      return request("/intervals/" + encodeURIComponent(checkId), {
        method: "PATCH",
        body: body || {},
        idemKey: idemKey
      });
    },

    // DELETE /intervals/<check_id>
    deleteInterval: function (checkId, idemKey) {
      return request("/intervals/" + encodeURIComponent(checkId), {
        method: "DELETE",
        idemKey: idemKey
      });
    },

    // POST /gps_points  (body carries client UUID point_id; optional nav_photo)
    createGpsPoint: function (body, idemKey) {
      return request("/gps_points", {
        method: "POST",
        body: body || {},
        idemKey: idemKey
      });
    },

    // PATCH /gps_points/<id>  (re-record / rename / recolor)
    updateGpsPoint: function (id, body, idemKey) {
      return request("/gps_points/" + encodeURIComponent(id), {
        method: "PATCH",
        body: body || {},
        idemKey: idemKey
      });
    },

    // POST /nests/<id>/artificial  (new NQ nest sharing source nest's gps point)
    createArtificial: function (nestId, body, idemKey) {
      return request("/nests/" + encodeURIComponent(nestId) + "/artificial", {
        method: "POST",
        body: body || {},
        idemKey: idemKey
      });
    },

    // POST /photos  (base64 image + metadata: kind, nest_id/point_id, bearing)
    uploadPhoto: function (body, idemKey) {
      return request("/photos", {
        method: "POST",
        body: body || {},
        idemKey: idemKey
      });
    },

    // GET /tracks  -> [{ track_id, name, activity, patch_id, length_m, note,
    //                     points:[{lat,lng,t,acc}], created_by, created_at }]
    getTracks: function () {
      return request("/tracks");
    },

    // POST /tracks  (body carries client track_id + points array)
    createTrack: function (body, idemKey) {
      return request("/tracks", {
        method: "POST",
        body: body || {},
        idemKey: idemKey
      });
    },

    // PATCH /tracks/<id>  (rename / note / activity / patch / points)
    updateTrack: function (id, body, idemKey) {
      return request("/tracks/" + encodeURIComponent(id), {
        method: "PATCH",
        body: body || {},
        idemKey: idemKey
      });
    },

    // DELETE /tracks/<id>
    deleteTrack: function (id, idemKey) {
      return request("/tracks/" + encodeURIComponent(id), {
        method: "DELETE",
        idemKey: idemKey
      });
    }
  };
})(window.NestApi);
