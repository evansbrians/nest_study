# nest_study realtime API — server

An R **plumber** REST API over a **SQLite** (WAL) database, with a live-push
channel and per-user token auth, fronted by **Caddy** (auto-HTTPS) and run as a
**systemd** service on a small Linux VM. Implements the contract in
[`../api.md`](../api.md) against [`../schema.sql`](../schema.sql) +
[`../seed.sql`](../seed.sql).

Everything here lives under `server/`. Nothing outside `server/` is modified.

## Files

| file | what |
|---|---|
| `init_db.R` | build `nest_study.sqlite` from `../schema.sql` + `../seed.sql`; sets `foreign_keys=ON`, `journal_mode=WAL` |
| `plumber.R` | the API: auth filter, reads, writes, live push |
| `entrypoint.R` | boots plumber on `127.0.0.1:8000` |
| `mint_token.R` | mint / revoke / list per-user bearer tokens |
| `nightly_load.R` | **stub** for the nightly Sheets→DB batch (point counts, coverboards, visits) |
| `Caddyfile` | auto-HTTPS reverse proxy → the plumber port |
| `nest-api.service` | systemd unit for the API |
| `nest-api-nightly.{service,timer}` | systemd timer for the nightly batch |
| `provision.sh` | one-shot fresh-Ubuntu-VM setup |
| `photos/` | disk store for larger (non-nav) photos |

## Run locally

You need R with: `plumber`, `DBI`, `RSQLite`, `jsonlite`, `digest`.

```sh
cd server
Rscript init_db.R                       # creates ./nest_study.sqlite
Rscript mint_token.R mint BSE "laptop"  # prints a token ONCE — copy it
Rscript entrypoint.R                     # serves http://127.0.0.1:8000
```

Smoke test (in another shell):

```sh
curl http://127.0.0.1:8000/healthz
TOKEN=<the token you copied>
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/lookups
```

Interactive docs (Swagger) are at `http://127.0.0.1:8000/__docs__/`.

### Re-initializing the DB

`init_db.R` uses the plain `CREATE TABLE` / `INSERT` in the design SQL, so it
**refuses to run against an already-built DB** (guards against clobbering live
data). To rebuild from scratch:

```sh
rm -f nest_study.sqlite nest_study.sqlite-wal nest_study.sqlite-shm
Rscript init_db.R
```

## Deploy to the VM

On a clean Ubuntu 22.04/24.04 VM:

1. Copy this repo (at least `migrate_to_db/`) onto the VM.
2. Edit the `CONFIG` block at the top of `provision.sh` (`DOMAIN`, `ACME_EMAIL`).
3. Point the domain's DNS A/AAAA record at the VM; open ports 80 + 443.
4. Run it:

   ```sh
   sudo bash server/provision.sh
   ```

   This installs R + packages, installs Caddy, deploys to `/opt/nest-api`,
   runs `init_db.R`, installs + starts the systemd units, and writes the
   Caddyfile. Then mint the first token(s) (it prints the exact command).

`provision.sh` builds GeoJSON **by hand** in `plumber.R`, so **`sf` is not
installed on the server** — that avoids the heavy GDAL/GEOS/PROJ stack. The R
analysis against a nightly snapshot can use `sf` on a workstation instead.

## Tokens

Tokens are per-user (attribution) and per-device (revocation). The DB stores
only the SHA-256 **hash**; the plaintext is shown once at mint time.

```sh
# mint (creates the observer row if missing); copy the printed token now
Rscript mint_token.R mint BSE "Brian iPhone"

# list stored tokens (hashes only)
Rscript mint_token.R list

# revoke a lost/retired device by its hash
Rscript mint_token.R revoke <token_hash>
```

On the VM, prefix with the service user + DB path, e.g.:

```sh
cd /opt/nest-api/server
sudo -u nestapi NEST_DB_PATH=/opt/nest-api/server/nest_study.sqlite \
  Rscript mint_token.R mint TNS "Tara iPhone"
```

## Auth, attribution, idempotency

- **Auth filter** (`@filter auth`): reads `Authorization: Bearer <token>`,
  SHA-256-hashes it, looks up `api_token` (rejects missing/unknown/revoked),
  resolves to `observer_id`, and stashes it on the request. Writes auto-fill
  `created_by` / `changed_by` from it — no "observer" field on write bodies.
  Open paths: `/healthz`, `/` and the Swagger docs.
- **Idempotency**: every write reads `X-Idempotency-Key`. On first sight the key
  is recorded in `write_log` and the write proceeds; a **repeat key is a no-op**
  that returns the original entity (`replayed: true`). Makes the phone's offline
  queue safe to replay. Keyless writes are allowed but not deduped.
- **Every successful write** also inserts a `change_event`
  (`entity`,`entity_id`,`action`,`changed_by`) — that row drives live push.

## Server-side ID allocation (the concurrency guarantee)

`POST /nests` (and the artificial-nest route) allocate `nest_id` **server-side**,
mirroring the app's `nextNestNumber`: the **lowest free number (gap)** in the
prefix namespace (`N` / `NQ` / `NLB` / `NSP`), 1–999, zero-padded to 3 digits
(`N001`, `NQ042`). All of this runs **inside one SQLite write transaction**:

1. scan existing `nest_id`s for the prefix, compute the lowest gap;
2. `INSERT` the nest under that id;
3. the `PRIMARY KEY` guard makes a race impossible — if two requests pick the
   same number, one commit wins and the loser **retries** (up to 25×) and takes
   the next gap.

Because SQLite serializes writers, steps 1–3 are atomic, so no client ever
guesses an id and the multi-device collision cannot happen.

## Live push — **long-poll** (decision + rationale)

**Chosen: long-poll (`GET /changes?since=<event_id>`), not streaming SSE.**

**Why.** plumber runs on **one single-threaded R process** (via `httpuv`). A
true held-open SSE stream occupies that one worker for the connection's whole
lifetime, so a couple of subscribed phones would **block all other requests** —
reads and writes would stall behind the streams. There is no clean, supported
way in stock plumber to multiplex a long-lived SSE stream alongside normal
request handling without an async/promises setup that is fragile at best.

A **bounded long-poll** gives the same "everyone sees each other's edits within
~1 second" behavior at this scale (2–4 clients) without that risk:

- `GET /changes?since=<event_id>` returns all `change_event`s after `<since>`.
  If there are none yet it **blocks briefly** (default up to ~25 s, polling the
  DB twice a second) and returns as soon as a new event lands — or empty on
  timeout. The client immediately re-calls with the new `last_event_id`.
- It honors `Last-Event-ID` (mapped to `?since=`) for **gap-free catch-up**
  after a disconnect, exactly like the SSE contract intended.
- A thin `GET /events?since=` alias returns one batch immediately (no block),
  so a simple EventSource-style poller also works.

The client stays dumb: writes go over REST; the push only says *"event N
happened on entity X — go refetch it."* The DB remains the single source of
truth. Caddy's proxy timeouts are set to 120 s so a 25 s poll is never cut off.

**If true SSE is wanted later**, the clean path is to run plumber behind an
async worker (e.g. `future`/`promises`) or move the push to a tiny dedicated
process; not needed for a 2–4 person field crew.

## Endpoint map

**Reads**

| method + path | returns |
|---|---|
| `GET /healthz` | liveness (open, no auth) |
| `GET /lookups` | all controlled vocabularies in one payload |
| `GET /nests` | all nests; `?patch=`, `?current=true` (uses `v_current_nest`), `?since=<event_id>` |
| `GET /nests/:id` | nest + substrates + intervals + gps point (nav photo inline, base64) + photos |
| `GET /nests/:id/intervals` | interval checks for a nest |
| `GET /gps_points` | GeoJSON `FeatureCollection` (built by hand); `?class=` |
| `GET /predator_cameras` | cameras + latest maintenance |
| `GET /photos/:id` | raw image bytes from disk |
| `GET /schedule?date=` | **stub (501)** — TODO: port `scheduling_functions.R` |
| `GET /changes?since=` | **long-poll** live push (also honors `Last-Event-ID`) |
| `GET /events?since=` | immediate one-batch alias of the above |

**Writes** (each in a transaction; each logs a `change_event` + `write_log`)

| method + path | effect |
|---|---|
| `POST /nests` | server allocates `nest_id` (lowest gap / prefix), returns the row |
| `PATCH /nests/:id` | edit discovery fields |
| `POST /nests/:id/intervals` | add interval check (surrogate `check_id`) |
| `PATCH /intervals/:check_id` | edit a check |
| `DELETE /intervals/:check_id` | delete a check |
| `POST /gps_points` | waypoint (client UUID `point_id`); `nav_photo` base64 → in-DB blob |
| `PATCH /gps_points/:id` | re-record / rename / recolor (and replace `nav_photo`) |
| `POST /nests/:id/artificial` | new `NQ` nest sharing source's `gps_point_id`, species `ARNE`, first interval `host_eggs=2` — one txn |
| `POST /photos` | base64 image → disk file + `photo` row |

### Request notes

- **Bodies are JSON.** `POST /nests` takes discovery fields **without**
  `nest_id`, plus optional `prefix` (default `"N"`), `gps_point_id`, and a
  `substrates` array.
- **Nav thumbnails**: send `nav_photo` as base64 on `POST/PATCH /gps_points`;
  they are stored in `gps_point.nav_photo` (BLOB) and returned **inline**
  (base64) with point reads (`GET /gps_points`, `GET /nests/:id`).
- **Larger photos** (originals, 4-direction concealment): `POST /photos` with a
  base64 `image` + `kind` + `nest_id`/`point_id`/`bearing`; stored on disk in
  `photos/`, served by `GET /photos/:id`.

## Nightly batch (stub)

`nightly_load.R` is a clearly-marked stub; `nest-api-nightly.timer` runs it at
02:30 daily. The batch tables (`point_count`, `coverboard`, `visit`) are loaded
here (reusing the sheet-reading code from `scripts/utils/updater.R`), **not**
through the API. Columns are pinned when that job is actually built.

## What was validated vs. not

- **Validated**: `../schema.sql` + `../seed.sql` apply cleanly (checked with a
  SQLite engine on a throwaway DB — all 24 tables + 2 views create, FK check
  passes, seed loads). R files were paren/brace-balance checked and self-
  reviewed.
- **Not run here**: R was not available in the build sandbox, so the plumber
  app, the systemd units, Caddy, and `provision.sh` were **not executed**.
  Run the local smoke test above on a machine with R before deploying.
