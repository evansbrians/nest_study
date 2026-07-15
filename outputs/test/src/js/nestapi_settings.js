// nestapi_settings.js -- persistent API base URL + bearer token.
// Attaches NestApi.settings to the shared global namespace.
window.NestApi = window.NestApi || {};

(function (NestApi) {
  "use strict";

  var DEFAULT_URL = "https://snednestudy.duckdns.org";
  var URL_KEY = "nestApiUrl";
  var TOKEN_KEY = "nestApiToken";

  function readLS(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function writeLS(key, value) {
    try {
      if (value === null || value === undefined) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, value);
      }
    } catch (e) {
      // storage unavailable (private mode etc.) -- degrade quietly
    }
  }

  function stripTrailingSlash(u) {
    if (typeof u !== "string") return u;
    return u.replace(/\/+$/, "");
  }

  NestApi.settings = {
    DEFAULT_URL: DEFAULT_URL,

    // Base URL for the API (no trailing slash). Falls back to the default.
    getUrl: function () {
      var u = readLS(URL_KEY);
      return stripTrailingSlash(u && u.length ? u : DEFAULT_URL);
    },

    setUrl: function (u) {
      writeLS(URL_KEY, stripTrailingSlash(u));
    },

    // Per-device bearer token (raw, sent as "Bearer <token>").
    getToken: function () {
      return readLS(TOKEN_KEY) || "";
    },

    setToken: function (t) {
      writeLS(TOKEN_KEY, t);
    },

    // True when a non-empty token is stored (URL always has a default).
    hasCreds: function () {
      var t = NestApi.settings.getToken();
      return !!(t && t.length);
    }
  };
})(window.NestApi);
