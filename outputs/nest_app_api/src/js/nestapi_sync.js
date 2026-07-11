// nestapi_sync.js -- long-poll change-feed loop.
// Attaches NestApi.sync to the shared global namespace.
// Depends on NestApi.api.getChanges and NestApi.store (meta cursor).
window.NestApi = window.NestApi || {};

(function (NestApi) {
  "use strict";

  var CURSOR_KEY = "changeCursor";
  var WAIT_SECONDS = 25; // matches the server's long-poll window
  var BACKOFF_MS = 3000; // pause after an error before re-arming

  var running = false;
  var currentCursor = 0;
  var stopFns = { timer: null };

  function sleep(ms) {
    return new Promise(function (resolve) {
      stopFns.timer = setTimeout(resolve, ms);
    });
  }

  // Run the poll loop. onChange(events) is called only for non-empty batches.
  async function loop(onChange) {
    while (running) {
      var batch;
      try {
        batch = await NestApi.api.getChanges(currentCursor, WAIT_SECONDS);
      } catch (err) {
        if (!running) break;
        // Network hiccup / timeout / offline -- back off and retry.
        await sleep(BACKOFF_MS);
        continue;
      }

      if (!running) break;

      if (batch && typeof batch.last_event_id === "number") {
        if (batch.last_event_id !== currentCursor) {
          currentCursor = batch.last_event_id;
          try {
            await NestApi.store.setMeta(CURSOR_KEY, currentCursor);
          } catch (e) {
            // cache write failed; keep the in-memory cursor and carry on
          }
        }
      }

      var events = batch && batch.events ? batch.events : [];
      if (events && events.length && typeof onChange === "function") {
        try {
          onChange(events);
        } catch (e) {
          // never let a handler error kill the loop
        }
      }
      // re-arm immediately (getChanges already blocked server-side)
    }
  }

  NestApi.sync = {
    CURSOR_KEY: CURSOR_KEY,
    WAIT_SECONDS: WAIT_SECONDS,

    isRunning: function () {
      return running;
    },

    cursor: function () {
      return currentCursor;
    },

    // start(onChange) -> Promise. Reads the persisted cursor (default 0),
    // then runs the long-poll loop until stop() is called. Safe to call once;
    // a second call while running is a no-op.
    start: async function (onChange) {
      if (running) return;
      running = true;
      var saved = 0;
      try {
        var v = await NestApi.store.getMeta(CURSOR_KEY);
        if (typeof v === "number") saved = v;
        else if (v !== undefined && v !== null && !isNaN(Number(v))) {
          saved = Number(v);
        }
      } catch (e) {
        saved = 0;
      }
      currentCursor = saved;
      // fire and forget; callers can ignore the returned promise
      return loop(onChange);
    },

    // stop() -> halts the loop after the current iteration.
    stop: function () {
      running = false;
      if (stopFns.timer) {
        clearTimeout(stopFns.timer);
        stopFns.timer = null;
      }
    }
  };
})(window.NestApi);
