// nestapi_queue.js -- offline write queue with temp-id -> real-id remap.
// Attaches NestApi.queue to the shared global namespace.
// Depends on NestApi.store (queue object store) and NestApi.api.
window.NestApi = window.NestApi || {};

(function (NestApi) {
  "use strict";

  var STORE = "queue";

  // An op is:
  //   { kind, tempId?, endpoint, method, body, idemKey, deps?, created_at }
  // kind is one of the api method names it maps to (createNest, addInterval,
  // updateNest, updateInterval, deleteInterval, createGpsPoint,
  // updateGpsPoint, createArtificial, uploadPhoto). endpoint/method/body are
  // the literal request; tempId (if present) is the client placeholder id the
  // server will replace on success.

  // Is this a network/connectivity error (retry later) rather than a real
  // server rejection (drop, since replaying won't help)? A thrown ApiError has
  // a numeric .status; anything without one is treated as a network failure.
  function isNetworkError(err) {
    if (!err) return false;
    if (typeof err.status === "number") return false; // got an HTTP response
    return true; // TypeError from fetch, abort, DNS, offline, etc.
  }

  // Deep-replace every occurrence of tempId with realId inside a value
  // (strings, arrays, plain objects). Returns a new value.
  function remapValue(value, tempId, realId) {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
      return value === tempId ? realId : value;
    }
    if (Array.isArray(value)) {
      return value.map(function (v) {
        return remapValue(v, tempId, realId);
      });
    }
    if (typeof value === "object") {
      var out = {};
      Object.keys(value).forEach(function (k) {
        out[k] = remapValue(value[k], tempId, realId);
      });
      return out;
    }
    return value;
  }

  // Apply a tempId -> realId remap across an op's endpoint + body (and its
  // deps list). Mutates and returns the op.
  function remapOp(op, tempId, realId) {
    if (!tempId || !realId) return op;
    if (typeof op.endpoint === "string") {
      // path segments are URL-encoded; remap both raw and encoded forms.
      op.endpoint = op.endpoint
        .split(encodeURIComponent(tempId))
        .join(encodeURIComponent(realId))
        .split(tempId)
        .join(realId);
    }
    op.body = remapValue(op.body, tempId, realId);
    if (Array.isArray(op.deps)) {
      op.deps = op.deps.map(function (d) {
        return d === tempId ? realId : d;
      });
    }
    return op;
  }

  // Pull the server-assigned real nest_id out of a create response.
  function realNestIdFromResult(result) {
    if (!result) return null;
    var nest = result.nest;
    if (nest) {
      // plumber returns nest as a 1-row frame serialized to an object with
      // scalar fields (unboxedJSON), so nest.nest_id is the id.
      if (typeof nest.nest_id === "string") return nest.nest_id;
      if (Array.isArray(nest.nest_id) && nest.nest_id.length) {
        return nest.nest_id[0];
      }
    }
    if (typeof result.nest_id === "string") return result.nest_id;
    return null;
  }

  // Send one op through NestApi.api using its kind. Returns the server result.
  function sendOp(op) {
    var api = NestApi.api;
    switch (op.kind) {
      case "createNest":
        return api.createNest(op.body, op.idemKey);
      case "updateNest":
        return api.updateNest(idFromEndpoint(op, "/nests/"), op.body, op.idemKey);
      case "addInterval":
        return api.addInterval(
          nestIdFromIntervalsEndpoint(op),
          op.body,
          op.idemKey
        );
      case "updateInterval":
        return api.updateInterval(
          idFromEndpoint(op, "/intervals/"),
          op.body,
          op.idemKey
        );
      case "deleteInterval":
        return api.deleteInterval(idFromEndpoint(op, "/intervals/"), op.idemKey);
      case "createGpsPoint":
        return api.createGpsPoint(op.body, op.idemKey);
      case "updateGpsPoint":
        return api.updateGpsPoint(
          idFromEndpoint(op, "/gps_points/"),
          op.body,
          op.idemKey
        );
      case "createArtificial":
        return api.createArtificial(
          nestIdFromArtificialEndpoint(op),
          op.body,
          op.idemKey
        );
      case "uploadPhoto":
        return api.uploadPhoto(op.body, op.idemKey);
      case "createTrack":
        return api.createTrack(op.body, op.idemKey);
      case "updateTrack":
        return api.updateTrack(idFromEndpoint(op, "/tracks/"), op.body, op.idemKey);
      case "deleteTrack":
        return api.deleteTrack(idFromEndpoint(op, "/tracks/"), op.idemKey);
      default:
        // Fall back to a raw request against the recorded endpoint/method.
        return api.request(op.endpoint, {
          method: op.method,
          body: op.body,
          idemKey: op.idemKey
        });
    }
  }

  // Helpers that pull the (possibly-remapped) id back out of the endpoint,
  // so remapOp only has to touch op.endpoint/op.body to redirect a write.
  function idFromEndpoint(op, prefix) {
    var p = op.endpoint || "";
    var i = p.indexOf(prefix);
    if (i === -1) return "";
    var rest = p.slice(i + prefix.length);
    var slash = rest.indexOf("/");
    var seg = slash === -1 ? rest : rest.slice(0, slash);
    return decodeURIComponent(seg);
  }

  function nestIdFromIntervalsEndpoint(op) {
    // /nests/<id>/intervals
    return idFromEndpoint(op, "/nests/");
  }

  function nestIdFromArtificialEndpoint(op) {
    // /nests/<id>/artificial
    return idFromEndpoint(op, "/nests/");
  }

  NestApi.queue = {
    isNetworkError: isNetworkError,
    remapOp: remapOp,

    // enqueue(op) -> the stored op with its assigned queue id.
    enqueue: function (op) {
      var record = {
        kind: op.kind,
        tempId: op.tempId || null,
        endpoint: op.endpoint,
        method: op.method,
        body: op.body,
        idemKey: op.idemKey || NestApi.api.newIdemKey(),
        deps: op.deps || null,
        created_at: op.created_at || new Date().toISOString()
      };
      return NestApi.store.put(STORE, record).then(function (id) {
        record.id = id;
        return record;
      });
    },

    // list() -> queued ops in FIFO (autoIncrement key) order.
    list: function () {
      return NestApi.store.getAll(STORE).then(function (rows) {
        return rows.sort(function (a, b) {
          return a.id - b.id;
        });
      });
    },

    // pending() -> count of queued ops.
    pending: function () {
      return NestApi.queue.list().then(function (rows) {
        return rows.length;
      });
    },

    // flush() -> { sent, remaining, remaps }. Processes ops FIFO. On a
    // successful create carrying a tempId, captures the real nest_id and
    // remaps it into every later queued op before sending them. Succeeded ops
    // are deleted from the store. On a network error, stops and leaves the
    // rest queued (idempotency keys make re-sends safe).
    flush: async function () {
      var ops = await NestApi.queue.list();
      var sent = 0;
      var remaps = {};

      for (var i = 0; i < ops.length; i++) {
        var op = ops[i];

        // Apply any remaps discovered earlier in this flush pass to the op
        // about to be sent (covers deps captured mid-flush).
        Object.keys(remaps).forEach(function (t) {
          remapOp(op, t, remaps[t]);
        });

        var result;
        try {
          result = await sendOp(op);
        } catch (err) {
          if (isNetworkError(err)) {
            // Stop the whole flush; leave this and the rest for retry.
            return {
              sent: sent,
              remaining: ops.length - sent,
              remaps: remaps,
              stoppedOn: op.id,
              error: err
            };
          }
          // Server rejected it (4xx/5xx). Drop it so it doesn't wedge the
          // queue, but keep going with the rest.
          await NestApi.store.del(STORE, op.id);
          sent++; // counts as processed/removed
          op._rejected = err;
          continue;
        }

        // Success: if this op created an entity under a tempId, capture the
        // real id and remap it into the remaining queued ops (in-memory and
        // persisted) so their bodies/endpoints point at the real nest.
        if (op.tempId && (op.kind === "createNest" || op.kind === "createArtificial")) {
          var realId = realNestIdFromResult(result);
          if (realId && realId !== op.tempId) {
            remaps[op.tempId] = realId;
            for (var j = i + 1; j < ops.length; j++) {
              remapOp(ops[j], op.tempId, realId);
              // persist the remapped op so a later flush uses the real id too
              await NestApi.store.put(STORE, ops[j]);
            }
          }
        }

        await NestApi.store.del(STORE, op.id);
        sent++;
      }

      return { sent: sent, remaining: 0, remaps: remaps };
    }
  };
})(window.NestApi);
