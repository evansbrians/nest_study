# `window.NestApi` — JS API layer reference

Self-contained offline-first client for the nest_study realtime API
(`api.md`). Five plain `.js` files, concatenated into the page in any order —
each starts with `window.NestApi = window.NestApi || {};` and hangs one piece
off the shared namespace. Targets modern mobile browsers (async/await, fetch,
IndexedDB). No build step, no framework.

Load-order note: `nestapi_client`, `nestapi_queue`, and `nestapi_sync` call
into the other pieces **at call time**, not at load time, so concatenation
order does not matter.

---

## `NestApi.settings` — credentials (`nestapi_settings.js`)

Backed by `localStorage` (keys `nestApiUrl`, `nestApiToken`).

| Member | Signature | Returns / effect |
|---|---|---|
| `getUrl()` | `() => string` | Base URL, trailing slash stripped. Defaults to `https://snednestudy.duckdns.org`. |
| `setUrl(u)` | `(string) => void` | Persists the base URL (trailing slashes stripped). |
| `getToken()` | `() => string` | Stored bearer token, or `""`. |
| `setToken(t)` | `(string) => void` | Persists the bearer token. |
| `hasCreds()` | `() => boolean` | `true` when a non-empty token is stored. |
| `DEFAULT_URL` | `string` | `"https://snednestudy.duckdns.org"`. |

`localStorage` access is wrapped in try/catch, so private-mode failures degrade
quietly (reads return defaults, writes no-op).

---

## `NestApi.api` — REST client (`nestapi_client.js`)

`fetch` wrapper: adds `Authorization: Bearer <token>` (from settings),
`Accept: application/json`, `Content-Type: application/json` on requests with a
body, and `X-Idempotency-Key: <key>` when a key is passed. Base URL comes from
`NestApi.settings.getUrl()`.

**Errors:** any non-2xx response throws `NestApi.api.ApiError` with:
- `.status` — the HTTP status code (number)
- `.message` — the server's `error` field if present, else `"HTTP <n> for <path>"`
- `.body` — the parsed JSON (or text) body

A thrown-by-`fetch` failure (offline, DNS, abort/timeout) has **no** `.status`
— that is how the queue distinguishes "retry later" from "server rejected it".

### Helpers

| Member | Signature | Notes |
|---|---|---|
| `ApiError` | constructor | `new ApiError(message, status, body)`. |
| `newIdemKey()` | `() => string` | RFC-4122 v4 UUID (uses `crypto.randomUUID` when available). |
| `isOnline()` | `() => boolean` | Wraps `navigator.onLine` (true if unknown). |
| `request(path, opts)` | `async` | Low-level. `opts = { method, body, idemKey, headers, timeoutMs }`. Resolves to the parsed body, throws `ApiError` on non-2xx. |

### Reads (all `async`, resolve to parsed JSON)

| Method | HTTP | Returns |
|---|---|---|
| `getLookups()` | `GET /lookups` | `{ patches, observers, species, substrates, adult_present_codes, adult_activity_codes, nest_status_codes, young_status_codes, discovery_stage_codes, nest_fate_codes, point_classes }` |
| `getNests({patch, current, since} = {})` | `GET /nests` | Array of nest rows. `patch` → `?patch=`; `current` truthy → `?current=true`; `since` → `?since=<event_id>` (deltas). |
| `getNest(id)` | `GET /nests/<id>` | `{ nest, substrates, intervals, gps_point, photos }`. |
| `getNestIntervals(id)` | `GET /nests/<id>/intervals` | Array of interval checks. |
| `getGpsPoints(pointClass)` | `GET /gps_points?class=<c>` | GeoJSON `FeatureCollection`. Omit `pointClass` for all. |
| `getPredatorCameras()` | `GET /predator_cameras` | Array of cameras + latest maintenance. |
| `getChanges(since, waitSeconds)` | `GET /changes?since=<id>&wait=<s>` | `{ since, last_event_id, events: [...] }`. Long-poll: blocks server-side up to `wait` (default 25) seconds. Client abort timeout is `wait + 15`s. |

### Writes (all `async`; each takes an optional `idemKey`)

| Method | HTTP | Notes |
|---|---|---|
| `createNest(body, idemKey)` | `POST /nests` | Body has discovery fields **without** `nest_id`; server allocates the id and returns `{ nest, event_id }` (or `{ replayed, nest }`). Optional `prefix` (`N`/`NQ`/`NLB`/`NSP`, default `N`), `gps_point_id`, `substrates: []`. |
| `updateNest(id, body, idemKey)` | `PATCH /nests/<id>` | Edit discovery fields → `{ nest, event_id }`. |
| `addInterval(nestId, body, idemKey)` | `POST /nests/<nestId>/intervals` | Server assigns `check_id` → `{ interval, event_id }`. |
| `updateInterval(checkId, body, idemKey)` | `PATCH /intervals/<checkId>` | Edit a check → `{ interval, event_id }`. |
| `deleteInterval(checkId, idemKey)` | `DELETE /intervals/<checkId>` | → `{ deleted, check_id, event_id }`. |
| `createGpsPoint(body, idemKey)` | `POST /gps_points` | Body carries client UUID `point_id` (required) + optional base64 `nav_photo` → `{ point, event_id }`. |
| `updateGpsPoint(id, body, idemKey)` | `PATCH /gps_points/<id>` | Re-record / rename / recolor → `{ point_id, event_id }`. |
| `createArtificial(nestId, body, idemKey)` | `POST /nests/<nestId>/artificial` | New `NQ` nest sharing source nest's `gps_point_id`, species Artificial, first interval `host_eggs=2` → `{ nest, first_interval_check_id, event_id }`. |
| `uploadPhoto(body, idemKey)` | `POST /photos` | Base64 `image` + metadata (`kind`, `nest_id`/`point_id`, `bearing`, optional `filename`/`ext`) → `{ photo, event_id }`. |

---

## `NestApi.store` — IndexedDB cache (`nestapi_store.js`)

Promise-wrapped IndexedDB, db `nest_study` version 1. Object stores (created in
`onupgradeneeded`):

| Store | keyPath | Notes |
|---|---|---|
| `nests` | `nest_id` | |
| `gps_points` | `point_id` | |
| `lookups` | `name` | store each vocabulary as `{ name, ... }` |
| `meta` | `k` | key/value rows `{ k, v }` |
| `queue` | `id` | `autoIncrement` (offline write queue) |

| Method | Signature | Returns |
|---|---|---|
| `open()` | `async` | The opened `IDBDatabase` (cached singleton). |
| `put(store, obj)` | `async` | The written key. |
| `get(store, key)` | `async` | The object, or `undefined`. |
| `getAll(store)` | `async` | Array of every object (empty array if none). |
| `del(store, key)` | `async` | `undefined`. |
| `clear(store)` | `async` | `undefined`. |
| `getMeta(k)` | `async` | The stored value (unwrapped from `{ k, v }`), or `undefined`. |
| `setMeta(k, v)` | `async` | `undefined`. |

Every method resolves only after the IndexedDB transaction **completes** (so a
resolved `put` is durable). Rejects if IndexedDB is unavailable or blocked.

---

## `NestApi.queue` — offline write queue (`nestapi_queue.js`)

Built on `store` (the `queue` object store) + `api`. An **op** is:

```js
{ kind, tempId?, endpoint, method, body, idemKey, deps?, created_at }
```

- `kind` — the `NestApi.api` write method name it maps to (`createNest`,
  `updateNest`, `addInterval`, `updateInterval`, `deleteInterval`,
  `createGpsPoint`, `updateGpsPoint`, `createArtificial`, `uploadPhoto`).
- `tempId` — for offline-created nests: the client placeholder id the server
  replaces with a real `nest_id` on success.
- `endpoint` / `method` / `body` — the literal request (used for remap + as a
  raw fallback for unknown kinds).
- `idemKey` — auto-generated if omitted, so re-sends are safe.

| Method | Signature | Returns |
|---|---|---|
| `enqueue(op)` | `async` | The stored op (with assigned `id` and a filled-in `idemKey`). |
| `list()` | `async` | Queued ops in FIFO order (by autoIncrement `id`). |
| `pending()` | `async` | Count of queued ops (number). |
| `flush()` | `async` | `{ sent, remaining, remaps, stoppedOn?, error? }`. |
| `remapOp(op, tempId, realId)` | sync | Deep-replaces `tempId` with `realId` in the op's `endpoint`, `body`, and `deps`. Exposed for tests. |
| `isNetworkError(err)` | sync | `true` when `err` has no numeric `.status` (i.e. a connectivity failure, not an HTTP rejection). |

**`flush()` behaviour** (the core temp-id remap):
1. Processes queued ops FIFO.
2. When a `createNest` / `createArtificial` op carrying a `tempId` succeeds, it
   reads the server's real `nest_id` from the response and **remaps** that
   `tempId → realId` into every later queued op (their `body` and `endpoint`),
   persisting the rewrite, before those ops are sent.
3. Succeeded ops are deleted from the store.
4. On a **network error** it stops immediately and leaves the current op plus
   the rest queued (`stoppedOn` = that op's id, `error` set); idempotency keys
   make the eventual retry safe.
5. On a **server rejection** (4xx/5xx, i.e. an `ApiError` with `.status`) it
   drops that op (so it can't wedge the queue) and continues with the rest.

`remaps` in the result is a `{ tempId: realId }` map of everything remapped
during the pass — useful for updating the local cache.

---

## `NestApi.sync` — live change feed (`nestapi_sync.js`)

Long-poll loop over `api.getChanges`. Persists the cursor in
`store` meta under key `changeCursor`.

| Method | Signature | Notes |
|---|---|---|
| `start(onChange)` | `async` | Reads the persisted cursor (`getMeta('changeCursor')`, default `0`), then loops: `getChanges(cursor, 25)` → on a non-empty batch calls `onChange(events)` → stores `last_event_id` via `setMeta('changeCursor', ...)` → re-arms immediately. Backs off ~3s on error. No-op if already running. |
| `stop()` | `() => void` | Halts the loop after the current iteration. |
| `isRunning()` | `() => boolean` | Loop state. |
| `cursor()` | `() => number` | Current in-memory `last_event_id`. |
| `WAIT_SECONDS` | `number` | `25` (matches server window). |
| `CURSOR_KEY` | `string` | `"changeCursor"`. |

`onChange(events)` is invoked **only** for non-empty batches; a handler that
throws will not kill the loop. The intended reaction (per `api.md`) is to
refetch the affected entities and update the IndexedDB cache + UI.
