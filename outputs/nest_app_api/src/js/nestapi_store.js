// nestapi_store.js -- promise-wrapped IndexedDB cache.
// Attaches NestApi.store to the shared global namespace.
window.NestApi = window.NestApi || {};

(function (NestApi) {
  "use strict";

  var DB_NAME = "nest_study";
  var DB_VERSION = 1;

  // store name -> keyPath / options used in onupgradeneeded.
  var STORES = {
    nests: { keyPath: "nest_id" },
    gps_points: { keyPath: "point_id" },
    lookups: { keyPath: "name" },
    meta: { keyPath: "k" },
    queue: { keyPath: "id", autoIncrement: true }
  };

  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB not available"));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        Object.keys(STORES).forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, STORES[name]);
          }
        });
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error("failed to open IndexedDB"));
      };
      req.onblocked = function () {
        // Another tab holds an older version open; surface as an error.
        reject(new Error("IndexedDB open blocked by another connection"));
      };
    });
    return dbPromise;
  }

  // Run fn(store) inside a transaction and resolve with `result` once the
  // transaction completes (so writes are durable before we resolve).
  function tx(storeName, mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(storeName, mode);
        var store = transaction.objectStore(storeName);
        var result;
        try {
          result = fn(store);
        } catch (e) {
          reject(e);
          return;
        }
        transaction.oncomplete = function () {
          resolve(result);
        };
        transaction.onerror = function () {
          reject(transaction.error || new Error("transaction failed"));
        };
        transaction.onabort = function () {
          reject(transaction.error || new Error("transaction aborted"));
        };
      });
    });
  }

  // Wrap a single IDBRequest so its .result is what the tx resolves with.
  function reqValue(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  NestApi.store = {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    open: openDb,

    // put(store, obj) -> the key written (or the object's key)
    put: function (storeName, obj) {
      return tx(storeName, "readwrite", function (store) {
        return reqValue(store.put(obj));
      }).then(function (val) {
        return val;
      });
    },

    // get(store, key) -> the object, or undefined
    get: function (storeName, key) {
      var out;
      return tx(storeName, "readonly", function (store) {
        reqValue(store.get(key)).then(function (v) {
          out = v;
        });
      }).then(function () {
        return out;
      });
    },

    // getAll(store) -> array of every object in the store
    getAll: function (storeName) {
      var out;
      return tx(storeName, "readonly", function (store) {
        reqValue(store.getAll()).then(function (v) {
          out = v;
        });
      }).then(function () {
        return out || [];
      });
    },

    // del(store, key) -> undefined
    del: function (storeName, key) {
      return tx(storeName, "readwrite", function (store) {
        store.delete(key);
      });
    },

    // clear(store) -> undefined
    clear: function (storeName) {
      return tx(storeName, "readwrite", function (store) {
        store.clear();
      });
    },

    // getMeta(k) -> the stored value (unwrapped), or undefined
    getMeta: function (k) {
      return NestApi.store.get("meta", k).then(function (row) {
        return row ? row.v : undefined;
      });
    },

    // setMeta(k, v) -> undefined
    setMeta: function (k, v) {
      return NestApi.store.put("meta", { k: k, v: v });
    }
  };
})(window.NestApi);
