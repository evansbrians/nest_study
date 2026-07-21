#* nest_study realtime API -- plumber service
#*
#* Implements the REST + live-push contract in ../api.md over the SQLite DB.
#* Reads/writes are plain REST; live push is a LONG-POLL endpoint (see
#* /changes and the README for the SSE-vs-long-poll decision).
#*
#* Style: this file follows the team R style guide where plumber's `#*`
#* annotation syntax allows (snake_case, `<-`, `=` for args, 2-space indent,
#* TRUE/FALSE spelled out).

suppressPackageStartupMessages({
  library(plumber)
  library(DBI)
  library(RSQLite)
  library(jsonlite)
  library(digest)
  library(stringr)
})

# ---------------------------------------------------------------------------
# Configuration + shared helpers
# ---------------------------------------------------------------------------

# DB path + photo dir are overridable via env vars (systemd sets them).

db_path <- Sys.getenv("NEST_DB_PATH", unset = "nest_study.sqlite")
photo_dir <- Sys.getenv("NEST_PHOTO_DIR", unset = "photos")

if (!dir.exists(photo_dir)) {
  dir.create(
    photo_dir,
    recursive = TRUE,
    showWarnings = FALSE
  )
}

# One connection per request would be cleanest, but SQLite + a single R
# process is fine sharing one connection because plumber serializes requests
# (R is single-threaded). We open it once and enforce the pragmas.

db_connect <-
  function() {
    con <- dbConnect(RSQLite::SQLite(), db_path)
    dbExecute(con, "PRAGMA foreign_keys = ON;")
    dbExecute(con, "PRAGMA busy_timeout = 5000;")
    con
  }

con <- db_connect()

# Recorded GPS tracks (walked paths), shared across devices. Points are stored
# as a JSON array (each {lat,lng,t,acc}); tracks are whole-object reads/writes so
# a normalized point table isn't worth it. Auto-created so a redeploy provisions
# it without a migration. No FKs (a track's patch is a soft label).

dbExecute(
  con,
  "CREATE TABLE IF NOT EXISTS track (
     track_id     TEXT PRIMARY KEY,
     name         TEXT,
     activity     TEXT,
     patch_id     TEXT,
     length_m     REAL,
     note         TEXT,
     points_json  TEXT,
     created_by   TEXT,
     created_at   TEXT NOT NULL DEFAULT (datetime('now'))
   );"
)

# Ensure the current IACUC pick-list species exist so a nest create's
# species_code FK resolves (additive; historical codes like AMGO/PRAW/SOSP are
# kept). Auto-applied on redeploy -- mirrors seed.sql.

dbExecute(
  con,
  "INSERT OR IGNORE INTO species (species_code, common_name, is_artificial) VALUES
     ('AGOL','American goldfinch',0),
     ('BLJA','Blue jay',0),
     ('BRTH','Brown thrasher',0),
     ('COYE','Common yellowthroat',0),
     ('EATO','Eastern towhee',0),
     ('FISP','Field sparrow',0),
     ('GRCA','Gray catbird',0),
     ('INBU','Indigo bunting',0),
     ('NOCA','Northern cardinal',0),
     ('NOMO','Northern mockingbird',0),
     ('PRWA','Prairie warbler',0),
     ('RWBL','Red-winged blackbird',0),
     ('WEVI','White-eyed vireo',0),
     ('YBCH','Yellow-breasted chat',0);"
)

# Small JSON error helper: set status + return a tidy body.

err <-
  function(
    .res,
    .status,
    .message
  ) {
    .res$status <- .status
    list(error = .message)
  }

now_utc <-
  function() {
    now_ct <-
      as.POSIXct(
        Sys.time(),
        tz = "UTC"
      )
    format(now_ct, "%Y-%m-%dT%H:%M:%SZ")
  }

# SHA-256 hex of a bearer token (matches api_token.token_hash).

hash_token <-
  function(.token) {
    digest(
      .token,
      algo = "sha256",
      serialize = FALSE
    )
  }

# Run a read query, omitting params when empty (RSQLite rejects an empty
# params list on a query that has no placeholders).

db_read <-
  function(.con, .sql, .params = list()) {
    if (length(.params) == 0) {
      dbGetQuery(.con, .sql)
    } else {
      dbGetQuery(.con, .sql, params = .params)
    }
  }

# Run a code block inside a DB transaction. The block is passed as a function so
# an early return() inside it exits the FUNCTION (letting the transaction
# commit), not the request handler. A bare return() inside dbWithTransaction({})
# does a non-local exit that skips dbCommit and leaves the transaction open.

with_txn <-
  function(.con, .f) {
    dbWithTransaction(.con, .f())
  }

# Log a change_event and return its new event_id. Called inside a txn.

log_change <-
  function(
    .con,
    .entity,
    .entity_id,
    .action,
    .changed_by
  ) {
    dbExecute(
      .con,
      "INSERT INTO change_event (entity, entity_id, action, changed_by, changed_at)
         VALUES (?, ?, ?, ?, ?)",
      params = list(
        .entity,
        as.character(.entity_id),
        .action,
        .changed_by,
        now_utc()
      )
    )
    dbGetQuery(.con, "SELECT last_insert_rowid() AS id")$id
  }

# Record the idempotency key. Returns TRUE if this is the first time we've
# seen the key (caller should apply the write), FALSE if it's a replay.

record_idempotency <-
  function(
    .con,
    .key,
    .entity,
    .entity_id
  ) {
    # no key supplied -> not deduped (client's choice)

    if (is.null(.key) || !nzchar(.key)) {
      return(TRUE)
    }
    existing <-
      dbGetQuery(
        .con,
        "SELECT idempotency_key FROM write_log WHERE idempotency_key = ?",
        params = list(.key)
      )
    if (nrow(existing) > 0) {
      return(FALSE)
    }
    dbExecute(
      .con,
      "INSERT INTO write_log (idempotency_key, entity, entity_id, applied_at)
         VALUES (?, ?, ?, ?)",
      params = list(
        .key,
        .entity,
        as.character(.entity_id),
        now_utc()
      )
    )
    TRUE
  }

# Pull the idempotency key off the request headers (case-insensitive).

idem_key <-
  function(.req) {
    hn <- names(.req$HEADERS)
    i <- which(str_to_lower(hn) == "x-idempotency-key")
    if (length(i) == 0) return(NULL)
    .req$HEADERS[[i[[1]]]]
  }

# base64 -> raw bytes (nav photos, disk photos sent as base64).

b64_to_raw <-
  function(.b64) {
    if (is.null(.b64) || !nzchar(.b64)) return(NULL)

    # strip a data-URL prefix if present ("data:image/jpeg;base64,....")

    .b64 <-
      str_remove(
        .b64,
        "^data:[^,]*,"
      )
    jsonlite::base64_dec(.b64)
  }

# Resolve a substrate value (a substrate_id OR a human label) to its
# substrate_id. Tolerant so the app can send whatever the picker holds and the
# DB substrate table stays the single source of truth. Unrecognized free text
# (a plant not in the list) falls back to 'unknown' rather than FK-failing.

resolve_substrate <-
  function(.con, .value) {
    if (is.null(.value) || is.na(.value) || !nzchar(.value)) {
      return(NULL)
    }
    by_id <-
      dbGetQuery(
        .con,
        "SELECT substrate_id FROM substrate WHERE substrate_id = ?",
        params = list(.value)
      )
    if (nrow(by_id) > 0) {
      return(by_id$substrate_id[[1]])
    }
    by_label <-
      dbGetQuery(
        .con,
        "SELECT substrate_id FROM substrate WHERE lower(label) = lower(?)",
        params = list(.value)
      )
    if (nrow(by_label) > 0) {
      return(by_label$substrate_id[[1]])
    }
    "unknown"
  }

# Ensure a patch row exists, creating it on first use. The app's patch list is a
# controlled dropdown, but the DB patch table was derived only from Tara's real
# nests -- so the test sites (Long Branch / Snedgen Park) and any brand-new patch
# aren't there yet and would trip the nest.patch_id foreign key. Returns the
# patch_id, or NULL for a blank / "patch-none" sentinel.

ensure_patch <-
  function(.con, .patch_id) {
    if (is.null(.patch_id) ||
        is.na(.patch_id) ||
        !nzchar(.patch_id) ||
        identical(.patch_id, "patch-none")) {
      return(NULL)
    }
    hit <-
      dbGetQuery(
        .con,
        "SELECT patch_id FROM patch WHERE patch_id = ?",
        params = list(.patch_id)
      )
    if (nrow(hit) > 0) {
      return(.patch_id)
    }
    is_test <-
      if (str_detect(.patch_id, "long_branch|snedgen_park|^test_")) 1L else 0L
    label <-
      str_to_title(str_replace_all(.patch_id, "_", " "))
    dbExecute(
      .con,
      "INSERT OR IGNORE INTO patch (patch_id, label, is_test) VALUES (?, ?, ?)",
      params = list(
        .patch_id,
        label,
        is_test
      )
    )
    .patch_id
  }

# ---------------------------------------------------------------------------
# CORS filter -- runs BEFORE auth so the browser's cross-origin preflight
# (OPTIONS) is answered without a token. The API is token-gated, so allowing
# any origin is safe (a real request still needs a valid bearer token).
# ---------------------------------------------------------------------------

#* @filter cors
function(req, res) {
  res$setHeader("Access-Control-Allow-Origin", "*")

  # Preflight: answer OPTIONS here (before auth) with the allowed methods and
  # headers, echoing the requested headers when the browser sends them.

  if (identical(req$REQUEST_METHOD, "OPTIONS")) {
    res$setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, DELETE, OPTIONS"
    )
    hn <- names(req$HEADERS)
    ri <- which(str_to_lower(hn) == "access-control-request-headers")
    requested <- if (length(ri) > 0) req$HEADERS[[ri[[1]]]] else NULL
    res$setHeader(
      "Access-Control-Allow-Headers",
      if (is.null(requested)) {
        "Authorization, Content-Type, X-Idempotency-Key"
      } else {
        requested
      }
    )
    res$setHeader("Access-Control-Max-Age", "600")
    res$status <- 200L
    return(list())
  }

  plumber::forward()
}

# ---------------------------------------------------------------------------
# Auth filter -- runs before every route.
# ---------------------------------------------------------------------------

#* @filter auth
function(req, res) {
  # Health check + the docs are open; everything else needs a token.

  open_paths <-
    c(
      "/",
      "/__docs__/",
      "/openapi.json",
      "/healthz"
    )
  if (req$PATH_INFO %in% open_paths ||
      str_starts(req$PATH_INFO, "/__docs__")) {
    return(plumber::forward())
  }

  # Look the header up by name. req$HEADERS is a named character vector, so a
  # direct [["authorization"]] THROWS "subscript out of bounds" when the header
  # is absent (e.g. an unauthenticated request) -- match by lowercased name
  # instead so a missing header yields a clean 401, not a 500.

  hn <- names(req$HEADERS)
  i <- which(str_to_lower(hn) == "authorization")
  auth <- if (length(i) > 0) req$HEADERS[[i[[1]]]] else NULL
  if (is.null(auth) || !str_detect(auth, "^Bearer ")) {
    res$status <- 401
    return(list(error = "missing bearer token"))
  }

  token <-
    str_remove(
      auth,
      "^Bearer "
    )
  th <- hash_token(token)
  row <-
    dbGetQuery(
      con,
      "SELECT observer_id, revoked_at FROM api_token WHERE token_hash = ?",
      params = list(th)
    )
  if (nrow(row) == 0) {
    res$status <- 401
    return(list(error = "invalid token"))
  }
  if (!is.na(row$revoked_at[[1]])) {
    res$status <- 401
    return(list(error = "revoked token"))
  }

  # Stash the resolved observer so writes can auto-fill created_by/changed_by.

  req$observer_id <- row$observer_id[[1]]
  plumber::forward()
}

# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

#* @get /healthz
#* @serializer unboxedJSON list(digits = 9)
function() {
  list(ok = TRUE, time = now_utc())
}

# ===========================================================================
# READS
# ===========================================================================

#* All controlled vocabularies in one payload (app caches for dropdowns).
#* @get /lookups
#* @serializer unboxedJSON list(digits = 9)
function() {
  list(
    patches = dbReadTable(con, "patch"),
    observers = dbReadTable(con, "observer"),
    species = dbReadTable(con, "species"),
    substrates = dbReadTable(con, "substrate"),
    adult_present_codes = dbReadTable(con, "adult_present_code"),
    adult_activity_codes = dbReadTable(con, "adult_activity_code"),
    nest_status_codes = dbReadTable(con, "nest_status_code"),
    young_status_codes = dbReadTable(con, "young_status_code"),
    discovery_stage_codes = dbReadTable(con, "discovery_stage_code"),
    nest_fate_codes = dbReadTable(con, "nest_fate_code"),
    point_classes = dbReadTable(con, "point_class"),

    # Added for the data-entry GUI (see snedgen-gui/PAGE_CONTRACT.md):
    # the point-count species type-ahead, the coverboard species dropdown, and
    # the two count_interval CHECK vocabularies (mirrored here so no client
    # hardcodes them).

    species_engine = dbReadTable(con, "species_engine"),
    coverboard_species = db_read(
      con,
      "SELECT species, COALESCE(label, species) AS label
         FROM coverboard_species
        UNION
       SELECT DISTINCT species, species
         FROM coverboard_obs
        WHERE species IS NOT NULL
          AND species NOT IN (SELECT species FROM coverboard_species)
        ORDER BY species"
    ),
    count_distances = c(
      "< 25 m",
      "25-50 m",
      "50-75 m",
      "75-100 m",
      "> 100 m"
    ),
    count_detections = c("A", "V", "B")
  )
}

#* All nests (discovery-level). Filters: ?patch, ?current, ?since (delta).
#* @get /nests
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  patch = "",
  current = "",
  since = ""
) {
  if (
    nzchar(current) &&
      str_to_lower(current) %in% c(
        "1",
        "true",
        "yes"
      )
  ) {
    # v_current_nest mirrors get_current_nests(); join nest for the columns the
    # map/app need to place + label a marker (point, species, artificial flag).

    q <-
      "SELECT v.*, n.gps_point_id, n.species_code, n.species_other,
              n.discovery_date, n.artificial_candidate,
              lc.host_eggs  AS last_eggs,  lc.host_young  AS last_young,
              lc.bhco_eggs  AS last_bhco_eggs, lc.bhco_young AS last_bhco_young
         FROM v_current_nest v
         JOIN nest n ON n.nest_id = v.nest_id
         LEFT JOIN v_nest_latest_check lc ON lc.nest_id = v.nest_id"
    params <- list()
    if (nzchar(patch)) {
      q <- str_c(q, "WHERE v.patch_id = ?", sep = " ")
      params <- list(patch)
    }
    return(
      db_read(con, q, params)
    )
  }

  if (nzchar(since)) {
    # deltas: nests touched by a change_event after <since>

    return(
      dbGetQuery(
        con,
        "SELECT n.* FROM nest n
           WHERE n.nest_id IN (
             SELECT entity_id FROM change_event
               WHERE entity = 'nest' AND event_id > ?
           )",
        params = list(as.integer(since))
      )
    )
  }

  # All nests, enriched for the map: latest-check + max egg/young counts (for the
  # brood-status icon), plus concluded / is_current flags (for fade). Mirrors
  # what make_field_map.R computes so the JS overlay can pick icon + opacity.

  q <-
    "SELECT n.*,
            sp.common_name AS species_common,
            lc.check_date  AS last_check,
            lc.host_eggs   AS last_eggs, lc.host_young AS last_young,
            mx.max_eggs, mx.max_young,
            sub.substrates,
            CASE WHEN n.nest_fate IS NOT NULL THEN 1 ELSE 0 END AS concluded,
            CASE WHEN cur.nest_id IS NOT NULL THEN 1 ELSE 0 END AS is_current
       FROM nest n
       LEFT JOIN species sp ON sp.species_code = n.species_code
       LEFT JOIN v_nest_latest_check lc ON lc.nest_id = n.nest_id
       LEFT JOIN (
         SELECT nest_id,
                MAX(host_eggs)  AS max_eggs,
                MAX(host_young) AS max_young
           FROM interval_check
          GROUP BY nest_id
       ) mx ON mx.nest_id = n.nest_id
       LEFT JOIN (
         SELECT ns.nest_id,
                group_concat(s.label, ', ') AS substrates
           FROM nest_substrate ns
           JOIN substrate s ON s.substrate_id = ns.substrate_id
          GROUP BY ns.nest_id
       ) sub ON sub.nest_id = n.nest_id
       LEFT JOIN v_current_nest cur ON cur.nest_id = n.nest_id"
  params <- list()
  if (nzchar(patch)) {
    q <- str_c(q, "WHERE n.patch_id = ?", sep = " ")
    params <- list(patch)
  }
  q <- str_c(q, "ORDER BY n.nest_id", sep = " ")
  db_read(con, q, params)
}

#* One nest + substrates + intervals + gps point + photos.
#* @get /nests/<id>
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  id
) {
  nest <-
    dbGetQuery(
      con,
      "SELECT * FROM nest WHERE nest_id = ?",
      params = list(id)
    )
  if (nrow(nest) == 0) {
    return(
      err(
        res,
        404,
        "nest not found"
      )
    )
  }
  substrates <-
    dbGetQuery(
      con,
      "SELECT s.substrate_id, s.label
         FROM nest_substrate ns JOIN substrate s USING (substrate_id)
         WHERE ns.nest_id = ?",
      params = list(id)
    )
  intervals <-
    dbGetQuery(
      con,
      "SELECT * FROM interval_check WHERE nest_id = ?
         ORDER BY check_date, check_time",
      params = list(id)
    )
  gps <- NULL
  if (!is.na(nest$gps_point_id[[1]])) {
    gp <-
      dbGetQuery(
        con,
        "SELECT point_id, point_name, point_class, patch_id, latitude, longitude,
                elevation, horizontal_accuracy, bearing, note, color,
                nav_photo, nav_photo_name, datetime
           FROM gps_point WHERE point_id = ?",
        params = list(nest$gps_point_id[[1]])
      )
    if (nrow(gp) > 0) {
      gps <- gps_row_to_list(gp[1, ])
    }
  }
  photos <-
    dbGetQuery(
      con,
      "SELECT photo_id, kind, bearing, filename, taken_at FROM photo
         WHERE nest_id = ?",
      params = list(id)
    )
  list(
    nest = as.list(nest[1, ]),
    substrates = substrates,
    intervals = intervals,
    gps_point = gps,
    photos = photos
  )
}

#* Interval checks for a nest.
#* @get /nests/<id>/intervals
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  id
) {
  dbGetQuery(
    con,
    "SELECT * FROM interval_check WHERE nest_id = ?
       ORDER BY check_date, check_time",
    params = list(id)
  )
}

# gps_point row (a 1-row data.frame) -> a plain list with the nav_photo as
# base64 so it can travel inline in JSON.

gps_row_to_list <-
  function(.row) {
    out <- as.list(.row)
    np <- .row$nav_photo[[1]]
    if (is.list(np)) np <- np[[1]]
    if (!is.null(np) && length(np) > 0 && !all(is.na(np))) {
      out$nav_photo <- jsonlite::base64_enc(np)
    } else {
      out$nav_photo <- NULL
    }
    out
  }

#* GPS points as a GeoJSON FeatureCollection. Filter: ?class=nest etc.
#* Built by hand (no sf dependency on the server).
#* @get /gps_points
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  class = ""
) {
  # Do NOT read the nav_photo blobs here: base64-ing a photo for every point made
  # this response many MB and slow on cell (it gated the whole app boot). Ship a
  # `has_nav_photo` flag instead; the map lazy-fetches the bytes per point via
  # GET /gps_points/<id>/photo only when a popup that needs one is opened.
  q <- "SELECT point_id, point_name, point_class, patch_id, latitude, longitude,
               elevation, horizontal_accuracy, bearing, n_samples, note, color,
               (nav_photo IS NOT NULL) AS has_nav_photo, nav_photo_name, datetime
          FROM gps_point"
  params <- list()
  if (nzchar(class)) {
    q <- str_c(q, "WHERE point_class = ?", sep = " ")
    params <- list(class)
  }
  rows <-
    db_read(con, q, params)

  features <- vector("list", nrow(rows))
  for (i in seq_len(nrow(rows))) {
    r <- rows[i, ]
    props <-
      list(
        point_id = r$point_id[[1]],
        point_name = r$point_name[[1]],
        point_class = r$point_class[[1]],
        patch_id = r$patch_id[[1]],
        elevation = r$elevation[[1]],
        horizontal_accuracy = r$horizontal_accuracy[[1]],
        bearing = r$bearing[[1]],
        note = r$note[[1]],
        color = r$color[[1]],
        has_nav_photo = isTRUE(as.logical(r$has_nav_photo[[1]])),
        nav_photo_name = r$nav_photo_name[[1]],
        datetime = r$datetime[[1]]
      )
    features[[i]] <-
      list(
        type = "Feature",
        geometry = list(
          type = "Point",
          coordinates = list(r$longitude[[1]], r$latitude[[1]])
        ),
        properties = props
      )
  }
  list(type = "FeatureCollection", features = features)
}

#* One GPS point's nav photo as base64 (lazy-loaded by the map popups so the
#* /gps_points list can stay photo-free and fast).
#* @get /gps_points/<id>/photo
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  row <-
    db_read(
      con,
      "SELECT nav_photo, nav_photo_name FROM gps_point WHERE point_id = ?",
      list(id)
    )
  if (nrow(row) == 0) return(err(res, 404, "point not found"))
  np <- row$nav_photo[[1]]
  if (is.list(np)) np <- np[[1]]
  b64 <- NULL
  if (!is.null(np) && length(np) > 0 && !all(is.na(np))) {
    b64 <- jsonlite::base64_enc(np)
  }
  list(
    point_id = id,
    nav_photo = b64,
    nav_photo_name = row$nav_photo_name[[1]]
  )
}

#* Predator cameras + latest maintenance.
#* @get /predator_cameras
#* @serializer unboxedJSON list(digits = 9)
function() {
  dbGetQuery(
    con,
    "SELECT pc.camera_id, pc.patch_id, pc.gps_point_id,
            m.event_date AS last_maintenance,
            m.install, m.replace_sd, m.replace_batteries, m.notes
       FROM predator_camera pc
       LEFT JOIN (
         SELECT cm.*
           FROM camera_maintenance cm
           JOIN (
             SELECT camera_id, MAX(event_date) AS mx
               FROM camera_maintenance GROUP BY camera_id
           ) t ON cm.camera_id = t.camera_id AND cm.event_date = t.mx
       ) m ON m.camera_id = pc.camera_id"
  )
}

#* A disk-stored photo (raw bytes). Nav thumbnails come inline with points.
#* @get /photos/<id>
function(
  req,
  res,
  id
) {
  row <-
    dbGetQuery(
      con,
      "SELECT filename FROM photo WHERE photo_id = ?",
      params = list(as.integer(id))
    )
  if (nrow(row) == 0) {
    res$status <- 404
    return(list(error = "photo not found"))
  }
  path <-
    file.path(
      photo_dir,
      basename(row$filename[[1]])
    )
  if (!file.exists(path)) {
    res$status <- 404
    return(list(error = "photo file missing on disk"))
  }

  # guess a content type from the extension

  ext <-
    str_to_lower(
      tools::file_ext(path)
    )
  ct <-
    switch(
      ext,
      jpg = "image/jpeg",
      jpeg = "image/jpeg",
      png = "image/png",
      gif = "image/gif",
      "application/octet-stream"
    )
  res$setHeader("Content-Type", ct)
  res$body <-
    readBin(
      path,
      "raw",
      n = file.info(path)$size
    )
  res
}

#* Materialized daily schedule (loaded by scripts/db/schedule_load.R). Serves one
#* week of schedule_day rows as JSON; the app groups by date to build the
#* accordion. Filters: ?week=<n> (sampling week) or ?date=YYYY-MM-DD (its
#* week). Both absent -> the most-recent week present.
#* @get /schedule
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  date = "",
  week = ""
) {
  # Resolve the sampling week: explicit ?week=, else the week that owns ?date=,
  # else the week that owns TODAY (the loader now materializes several weeks
  # ahead, so "newest week" would be a future week -- the sensible default is the
  # CURRENT week), falling back to the newest week only if today has no row.

  target_week <- NA_integer_
  if (nzchar(week)) {
    target_week <- suppressWarnings(as.integer(week))
  } else {
    lookup_date <-
      if (nzchar(date)) {
        date
      } else {
        format(Sys.time(), "%Y-%m-%d", tz = "America/New_York")
      }
    row <-
      db_read(
        con,
        "SELECT week FROM schedule_day WHERE date = ? LIMIT 1",
        list(lookup_date)
      )
    if (nrow(row) == 0 && !nzchar(date)) {
      row <-
        db_read(
          con,
          "SELECT MAX(week) AS week FROM schedule_day"
        )
    }
    if (nrow(row) > 0) target_week <- row$week[[1]]
  }

  if (is.na(target_week)) {
    return(
      err(
        res,
        404,
        "no schedule available for that week"
      )
    )
  }

  # Serve v_schedule, not schedule_day: check_nests and predator_cameras are
  # derived live there (and weather joined), so they are always current instead
  # of as-fresh-as-the-last-push. Same column names, so the JSON is identical.

  db_read(
    con,
    "SELECT * FROM v_schedule WHERE week = ? ORDER BY date, patch_order",
    list(target_week)
  )
}

#* Replace the materialized schedule (workstation push from Google Sheets).
#* The VM has no googlesheets4 credentials, so prep_schedule_data() runs on a
#* workstation (scripts/db/schedule_load.R --api ...) and posts the finished rows
#* here. Body: { rows: [ {week,date,day,...}, ... ] } with schedule_day columns.
#* Upserts on (date, patch_order): new rows are inserted in full (seeding a
#* week), existing rows get ONLY the loader-owned derived columns refreshed
#* (check_nests, predator_cameras, weather) so GUI edits are never clobbered.
#* @post /schedule
#* @serializer unboxedJSON list(digits = 9)
function(req, res) {
  body <-
    req$body %||%
    tryCatch(
      jsonlite::fromJSON(req$postBody),
      error = function(.e) list()
    )

  rows <- body$rows
  if (is.null(rows)) {
    return(
      err(
        res,
        400,
        "rows (array of schedule_day objects) is required"
      )
    )
  }

  cols <-
    c(
      "week", "date", "day", "helper", "arrive", "sunrise", "patch_order",
      "patch_count", "boards", "search_patch_1", "search_patch_2", "field",
      "notes", "helper_patch_1", "tns_patch_1", "helper_patch_2", "tns_patch_2",
      "check_nests", "predator_cameras", "departure_time", "scbi_departure_time",
      "point_count_time", "weather",

      # GUI-era extras (absent from the sheet loader's frame -> filled NA
      # below, which is correct: a sheet push replaces the whole table).

      "search_patch_3", "tns_patch_3", "helper_patch_3",
      "search_patch_4", "tns_patch_4", "helper_patch_4"
    )

  df <- as.data.frame(rows, stringsAsFactors = FALSE)
  if (nrow(df) == 0) {
    return(
      err(
        res,
        400,
        "rows is empty"
      )
    )
  }

  # Tolerate missing columns (fill NA), drop extras, pin column order + types.
  for (.c in cols) {
    if (is.null(df[[.c]])) df[[.c]] <- NA
  }
  df <- df[, cols, drop = FALSE]
  df$week <- suppressWarnings(as.integer(df$week))
  df$patch_order <- suppressWarnings(as.integer(df$patch_order))
  for (.c in setdiff(cols, c("week", "patch_order"))) {
    df[[.c]] <- as.character(df[[.c]])
  }

  # Derived, loader-owned columns -- everything else on schedule_day is now
  # GUI-owned (Tara maintains helper, times, search patches, tasks, notes and
  # the field-day flag live in the GUI). So this is an UPSERT keyed on
  # (date, patch_order): a row that does not exist yet is inserted in full
  # (seeding a new/future week), but an existing row has ONLY these derived
  # columns refreshed -- an updater run can never clobber a GUI edit again.

  loaded <- 0L
  inserted <- 0L
  updated <- 0L
  with_txn(con, function() {
    for (.i in seq_len(nrow(df))) {
      one <- df[.i, , drop = FALSE]
      hit <-
        dbGetQuery(
          con,
          "SELECT schedule_day_id FROM schedule_day
             WHERE date = ? AND patch_order = ?",
          params = list(one$date, one$patch_order)
        )
      if (nrow(hit) == 0) {
        dbAppendTable(con, "schedule_day", one)
        inserted <<- inserted + 1L
      } else {
        dbExecute(
          con,
          "UPDATE schedule_day
              SET check_nests = ?, predator_cameras = ?, weather = ?
            WHERE schedule_day_id = ?",
          params =
            list(
              one$check_nests,
              one$predator_cameras,
              one$weather,
              hit$schedule_day_id[[1]]
            )
        )
        updated <<- updated + 1L
      }
    }
    loaded <<- nrow(df)
  })

  list(loaded = loaded, inserted = inserted, updated = updated)
}

#* Upsert per-date weather JSON. Fed by scripts/db/weather_push.R -- an off-box
#* NWS fetch that needs no DB/SSH access, just this POST -- so it can run in the
#* daily GitHub Action. Body: { rows: [ {date, weather}, ... ] }. v_schedule
#* joins this table by date; weather is the only schedule input not derivable
#* from the DB.
#* @post /weather
#* @serializer unboxedJSON list(digits = 9)
function(req, res) {
  body <-
    req$body %||%
    tryCatch(
      jsonlite::fromJSON(req$postBody),
      error = function(.e) list()
    )

  rows <- body$rows
  if (is.null(rows)) {
    return(err(res, 400, "rows (array of {date, weather}) is required"))
  }

  df <- as.data.frame(rows, stringsAsFactors = FALSE)
  if (nrow(df) == 0 || is.null(df$date)) {
    return(err(res, 400, "rows must contain date and weather"))
  }
  df$date <- as.character(df$date)
  df$weather <-
    if (is.null(df$weather)) NA_character_ else as.character(df$weather)

  upserted <- 0L
  with_txn(con, function() {
    for (.i in seq_len(nrow(df))) {
      dbExecute(
        con,
        "INSERT INTO weather (date, weather) VALUES (?, ?)
           ON CONFLICT(date) DO UPDATE SET weather = excluded.weather",
        params = list(df$date[[.i]], df$weather[[.i]])
      )
      upserted <<- upserted + 1L
    }
  })
  list(upserted = upserted)
}

# ===========================================================================
# LIVE PUSH -- long-poll (see README for the SSE-vs-long-poll decision).
# ===========================================================================

#* Long-poll for new change_events since <since>. Blocks briefly (up to
#* ~25s) waiting for new rows, then returns whatever it has (possibly empty).
#* The client passes the last event_id it saw (or Last-Event-ID header) and
#* re-calls immediately on return -- so every client sees each other's edits
#* within ~1s. This replaces SSE because R/plumber is single-threaded and a
#* held-open SSE stream blocks the one worker; a bounded long-poll does not.
#* @get /changes
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  since = "0",
  wait = "25"
) {
  hn <- names(req$HEADERS)
  li <- which(str_to_lower(hn) == "last-event-id")
  if (length(li) > 0 && nzchar(req$HEADERS[[li[[1]]]])) {
    since <- req$HEADERS[[li[[1]]]]
  }
  since_id <- suppressWarnings(as.integer(since))
  if (is.na(since_id)) since_id <- 0L
  wait_s <- suppressWarnings(as.numeric(wait))
  if (is.na(wait_s)) wait_s <- 25
  wait_s <- max(0, min(wait_s, 2))

  fetch <-
    function() {
      dbGetQuery(
        con,
        "SELECT event_id, entity, entity_id, action, changed_by, changed_at
           FROM change_event WHERE event_id > ? ORDER BY event_id",
        params = list(since_id)
      )
    }

  deadline <- Sys.time() + wait_s
  repeat {
    rows <- fetch()
    if (nrow(rows) > 0 || Sys.time() >= deadline) {
      last_id <- if (nrow(rows) > 0) max(rows$event_id) else since_id
      return(
        list(
          since = since_id,
          last_event_id = last_id,
          events = rows
        )
      )
    }

    # poll the DB twice a second while blocking

    Sys.sleep(0.5)
  }
}

#* SSE-style stream alias. Kept as a thin wrapper over the long-poll so a
#* client written against /events still works: it returns one batch and the
#* EventSource-style client re-connects. (True streaming SSE intentionally
#* not used -- see README.)
#* @get /events
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  since = "0"
) {
  res$setHeader("X-Push-Mode", "long-poll")

  # Delegate: same shape as /changes with a short wait so a browser
  # EventSource-like poller gets a prompt answer.

  hn <- names(req$HEADERS)
  li <- which(str_to_lower(hn) == "last-event-id")
  if (length(li) > 0 && nzchar(req$HEADERS[[li[[1]]]])) {
    since <- req$HEADERS[[li[[1]]]]
  }
  since_id <- suppressWarnings(as.integer(since))
  if (is.na(since_id)) since_id <- 0L
  rows <-
    dbGetQuery(
      con,
      "SELECT event_id, entity, entity_id, action, changed_by, changed_at
         FROM change_event WHERE event_id > ? ORDER BY event_id",
      params = list(since_id)
    )
  last_id <- if (nrow(rows) > 0) max(rows$event_id) else since_id
  list(
    since = since_id,
    last_event_id = last_id,
    events = rows
  )
}

# ===========================================================================
# WRITES  (each wrapped in a transaction)
# ===========================================================================

# --- server-side nest-id allocation ----------------------------------------
# Mirrors the app's nextNestNumber: lowest free number (gap) within a prefix
# namespace, 1..999, zero-padded to 3 digits. Prefixes: N, NQ, NLB, NSP.

next_nest_id <-
  function(.con, .prefix) {
    # Escape the prefix for the LIKE and pull existing numbers for this exact
    # prefix. We match nest_id = <prefix><digits> only (not longer prefixes:
    # 'N' must not swallow 'NQ042'), so filter in R with a precise regex.

    rows <- dbGetQuery(.con, "SELECT nest_id FROM nest")
    rx <-
      str_c(
        "^",
        .prefix,
        "([0-9]+)$"
      )
    used <- integer(0)
    if (nrow(rows) > 0) {
      keep <- str_detect(rows$nest_id, rx)
      nums <-
        suppressWarnings(
          as.integer(
            str_replace(
              rows$nest_id[keep],
              rx,
              "\\1"
            )
          )
        )
      used <- nums[!is.na(nums) & nums >= 1 & nums <= 999]
    }
    used_set <- unique(used)
    mx <- if (length(used_set) > 0) max(used_set) else 0
    n <- 1L
    while (n <= mx && n %in% used_set) {
      n <- n + 1L
    }
    sprintf(
      "%s%03d",
      .prefix,
      n
    )
  }

valid_prefix <-
  function(.p) {
    .p %in% c(
      "N",
      "NQ",
      "NLB",
      "NSP"
    )
  }

#* Create a nest; server allocates the id (lowest gap per prefix), retries on
#* collision under the PK guard. Body: discovery fields WITHOUT nest_id, plus
#* "prefix" (default "N") and optional "gps_point_id", "substrates" (array).
#* @post /nests
#* @serializer unboxedJSON list(digits = 9)
function(req, res) {
  body <- req$body
  if (is.null(body)) {
    body <-
      tryCatch(
        jsonlite::fromJSON(req$postBody),
        error = function(.e) list()
      )
  }
  prefix <- if (!is.null(body$prefix) && nzchar(body$prefix)) body$prefix else "N"
  if (!valid_prefix(prefix)) {
    return(
      err(
        res,
        400,
        "invalid prefix (use N, NQ, NLB, NSP)"
      )
    )
  }
  observer <- req$observer_id
  key <- idem_key(req)

  result <- NULL
  conflict_id <- NULL
  with_txn(con, function() {
    if (!record_idempotency(
      con,
      key,
      "nest",
      NA
    )) {
      # replay: return the nest recorded under this key

      prev <-
        dbGetQuery(
          con,
          "SELECT entity_id FROM write_log WHERE idempotency_key = ?",
          params = list(key)
        )
      result <<-
        list(
          replayed = TRUE,
          nest = dbGetQuery(
            con,
            "SELECT * FROM nest WHERE nest_id = ?",
            params = list(prev$entity_id[[1]])
          )
        )
      return(invisible(NULL))
    }

    # Resolve the patch once (create the test-site / new patch if needed) so the
    # nest.patch_id foreign key can't fail inside the allocation retry loop --
    # where any error is treated as an id collision and masked as "could not
    # allocate a free nest_id".

    resolved_patch <- ensure_patch(con, body$patch_id %||% NA)

    # Insert one nest row under the given id.

    do_insert_nest <-
      function(.nid) {
        dbExecute(
          con,
          "INSERT INTO nest
             (nest_id, patch_id, species_code, species_other, discovery_date,
              discovery_stage, selfie_stick, artificial_candidate,
              camera_or_control, camera_deployment_date, height_m,
              location_description, nest_fate, nest_fate_description,
              gps_point_id, created_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          params = list(
            .nid,
            resolved_patch %||% NA,
            body$species_code %||% NA,
            body$species_other %||% NA,
            body$discovery_date %||% NA,
            body$discovery_stage %||% NA,
            as.integer(body$selfie_stick %||% 0),
            as.integer(body$artificial_candidate %||% 0),
            body$camera_or_control %||% NA,
            body$camera_deployment_date %||% NA,
            body$height_m %||% NA,
            body$location_description %||% NA,
            body$nest_fate %||% NA,
            body$nest_fate_description %||% NA,
            body$gps_point_id %||% NA,
            observer,
            now_utc()
          )
        )
      }

    # The nest_id IS the waypoint's name (client-suggested), so honor it directly
    # -- the point_name and nest_id must stay identical. If that id is already
    # taken it's a real conflict (idempotent replays are handled above), so 409.
    # Only when the client sends no id do we fall back to server allocation.

    client_nest_id <- body$nest_id %||% NA
    inserted_id <- NULL
    if (!is.na(client_nest_id) && nzchar(client_nest_id)) {
      taken <-
        dbGetQuery(
          con,
          "SELECT 1 FROM nest WHERE nest_id = ?",
          params = list(client_nest_id)
        )
      if (nrow(taken) > 0) {
        conflict_id <<- client_nest_id
        return(invisible(NULL))
      }
      do_insert_nest(client_nest_id)
      inserted_id <- client_nest_id
    } else {
      for (attempt in seq_len(25)) {
        nid <- next_nest_id(con, prefix)
        ok <-
          tryCatch(
            {
              do_insert_nest(nid)
              TRUE
            },
            error = function(.e) FALSE
          )
        if (ok) {
          inserted_id <- nid
          break
        }
      }
      if (is.null(inserted_id)) {
        stop("could not allocate a free nest_id after retries")
      }
    }

    # multi-select substrates

    subs <- body$substrates
    if (!is.null(subs) && length(subs) > 0) {
      for (s in subs) {
        sid <- resolve_substrate(con, s)
        if (!is.null(sid)) {
          dbExecute(
            con,
            "INSERT OR IGNORE INTO nest_substrate (nest_id, substrate_id)
               VALUES (?, ?)",
            params = list(inserted_id, sid)
          )
        }
      }
    }

    ev <-
      log_change(
        con,
        "nest",
        inserted_id,
        "insert",
        observer
      )

    # attach the real entity_id to the idempotency row

    if (!is.null(key) && nzchar(key)) {
      dbExecute(
        con,
        "UPDATE write_log SET entity_id = ? WHERE idempotency_key = ?",
        params = list(inserted_id, key)
      )
    }
    result <<-
      list(
        nest = dbGetQuery(
          con,
          "SELECT * FROM nest WHERE nest_id = ?",
          params = list(inserted_id)
        ),
        event_id = ev
      )
  })
  if (!is.null(conflict_id)) {
    return(
      err(
        res,
        409,
        str_c("nest_id already exists: ", conflict_id)
      )
    )
  }
  res$status <- 201
  result
}

#* Edit a nest's discovery fields.
#* @patch /nests/<id>
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  id
) {
  body <-
    req$body %||%
    tryCatch(
      jsonlite::fromJSON(req$postBody),
      error = function(.e) list()
    )
  observer <- req$observer_id
  key <- idem_key(req)

  editable <-
    c(
      "patch_id",
      "species_code",
      "species_other",
      "discovery_date",
      "discovery_stage",
      "selfie_stick",
      "artificial_candidate",
      "camera_or_control",
      "camera_deployment_date",
      "height_m",
      "location_description",
      "nest_fate",
      "nest_fate_description",
      "gps_point_id"
    )
  body_fields <- names(body)
  fields <- intersect(body_fields, editable)

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(
      con,
      key,
      "nest",
      id
    )) {
      result <<- list(replayed = TRUE, nest_id = id)
      return(invisible(NULL))
    }
    exists <-
      dbGetQuery(
        con,
        "SELECT 1 FROM nest WHERE nest_id = ?",
        params = list(id)
      )
    if (nrow(exists) == 0) {
      stop("nest not found")
    }
    if (length(fields) > 0) {
      set_sql <-
        str_flatten(
          str_c(fields, " = ?"),
          collapse = ", "
        )
      params <- c(lapply(fields, function(.f) body[[.f]] %||% NA), list(id))
      dbExecute(
        con,
        str_c(
          "UPDATE nest SET ",
          set_sql,
          " WHERE nest_id = ?"
        ),
        params = params
      )
    }

    # Substrate replacement -- presence-gated. Only touch nest_substrate when the
    # body actually carries a "substrates" key: a PATCH that never mentions
    # substrates (e.g. a scalar-only edit) must leave them alone, but a PATCH that
    # includes the key -- even an empty array (user cleared them all) -- REPLACES
    # the set. Delete-then-reinsert mirrors how a multi-select edit form works.
    # Each statement stays atomic (no interleaved open result sets) per the
    # RSQLite gotcha handled elsewhere in this file.

    if ("substrates" %in% names(body)) {
      dbExecute(
        con,
        "DELETE FROM nest_substrate WHERE nest_id = ?",
        params = list(id)
      )
      subs <- body$substrates
      if (!is.null(subs) && length(subs) > 0) {
        for (s in subs) {
          sid <- resolve_substrate(con, s)
          if (!is.null(sid)) {
            dbExecute(
              con,
              "INSERT OR IGNORE INTO nest_substrate (nest_id, substrate_id)
                 VALUES (?, ?)",
              params = list(id, sid)
            )
          }
        }
      }
    }
    ev <-
      log_change(
        con,
        "nest",
        id,
        "update",
        observer
      )
    result <<-
      list(
        nest = dbGetQuery(
          con,
          "SELECT * FROM nest WHERE nest_id = ?",
          params = list(id)
        ),
        event_id = ev
      )
  })
  if (is.null(result)) {
    return(
      err(
        res,
        404,
        "nest not found"
      )
    )
  }
  result
}

#* Add one interval check to a nest; server assigns check_id.
#* @post /nests/<id>/intervals
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  id
) {
  body <-
    req$body %||%
    tryCatch(
      jsonlite::fromJSON(req$postBody),
      error = function(.e) list()
    )
  observer <- req$observer_id
  key <- idem_key(req)

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(
      con,
      key,
      "interval_check",
      NA
    )) {
      prev <-
        dbGetQuery(
          con,
          "SELECT entity_id FROM write_log WHERE idempotency_key = ?",
          params = list(key)
        )
      result <<-
        list(
          replayed = TRUE,
          interval = dbGetQuery(
            con,
            "SELECT * FROM interval_check WHERE check_id = ?",
            params = list(as.integer(prev$entity_id[[1]]))
          )
        )
      return(invisible(NULL))
    }
    nest_exists <-
      dbGetQuery(
        con,
        "SELECT 1 FROM nest WHERE nest_id = ?",
        params = list(id)
      )
    if (nrow(nest_exists) == 0) {
      stop("nest not found")
    }
    dbExecute(
      con,
      "INSERT INTO interval_check
         (nest_id, check_date, check_time, current_state, observer_id,
          adult_present, adult_activity, host_eggs, host_young, host_dead_young,
          bhco_eggs, bhco_young, bhco_dead_young, nest_status, young_status,
          notes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      params = list(
        id,
        body$check_date %||% NA,
        body$check_time %||% NA,
        body$current_state %||% "Active",
        body$observer_id %||% observer,
        body$adult_present %||% NA,
        body$adult_activity %||% NA,
        as.integer(body$host_eggs %||% 0),
        as.integer(body$host_young %||% 0),
        as.integer(body$host_dead_young %||% 0),
        as.integer(body$bhco_eggs %||% 0),
        as.integer(body$bhco_young %||% 0),
        as.integer(body$bhco_dead_young %||% 0),
        body$nest_status %||% NA,
        body$young_status %||% NA,
        body$notes %||% NA,
        now_utc()
      )
    )
    cid <- dbGetQuery(con, "SELECT last_insert_rowid() AS id")$id
    ev <-
      log_change(
        con,
        "interval_check",
        cid,
        "insert",
        observer
      )
    if (!is.null(key) && nzchar(key)) {
      dbExecute(
        con,
        "UPDATE write_log SET entity_id = ? WHERE idempotency_key = ?",
        params = list(cid, key)
      )
    }
    result <<-
      list(
        interval = dbGetQuery(
          con,
          "SELECT * FROM interval_check WHERE check_id = ?",
          params = list(cid)
        ),
        event_id = ev
      )
  })
  res$status <- 201
  result
}

#* Edit an interval check (addressed by surrogate check_id).
#* @patch /intervals/<check_id>
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  check_id
) {
  body <-
    req$body %||%
    tryCatch(
      jsonlite::fromJSON(req$postBody),
      error = function(.e) list()
    )
  observer <- req$observer_id
  key <- idem_key(req)
  cid <- as.integer(check_id)

  editable <-
    c(
      "check_date",
      "check_time",
      "current_state",
      "observer_id",
      "adult_present",
      "adult_activity",
      "host_eggs",
      "host_young",
      "host_dead_young",
      "bhco_eggs",
      "bhco_young",
      "bhco_dead_young",
      "nest_status",
      "young_status",
      "notes"
    )
  body_fields <- names(body)
  fields <- intersect(body_fields, editable)

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(
      con,
      key,
      "interval_check",
      cid
    )) {
      result <<- list(replayed = TRUE, check_id = cid)
      return(invisible(NULL))
    }
    exists <-
      dbGetQuery(
        con,
        "SELECT 1 FROM interval_check WHERE check_id = ?",
        params = list(cid)
      )
    if (nrow(exists) == 0) {
      stop("interval not found")
    }
    if (length(fields) > 0) {
      set_sql <-
        str_flatten(
          str_c(fields, " = ?"),
          collapse = ", "
        )
      params <- c(lapply(fields, function(.f) body[[.f]] %||% NA), list(cid))
      dbExecute(
        con,
        str_c(
          "UPDATE interval_check SET ",
          set_sql,
          " WHERE check_id = ?"
        ),
        params = params
      )
    }
    ev <-
      log_change(
        con,
        "interval_check",
        cid,
        "update",
        observer
      )
    result <<-
      list(
        interval = dbGetQuery(
          con,
          "SELECT * FROM interval_check WHERE check_id = ?",
          params = list(cid)
        ),
        event_id = ev
      )
  })
  if (is.null(result)) {
    return(
      err(
        res,
        404,
        "interval not found"
      )
    )
  }
  result
}

#* Delete an interval check.
#* @delete /intervals/<check_id>
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  check_id
) {
  observer <- req$observer_id
  key <- idem_key(req)
  cid <- as.integer(check_id)

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(
      con,
      key,
      "interval_check",
      cid
    )) {
      result <<-
        list(
          replayed = TRUE,
          check_id = cid,
          deleted = TRUE
        )
      return(invisible(NULL))
    }
    exists <-
      dbGetQuery(
        con,
        "SELECT nest_id FROM interval_check WHERE check_id = ?",
        params = list(cid)
      )
    if (nrow(exists) == 0) {
      stop("interval not found")
    }
    dbExecute(
      con,
      "DELETE FROM interval_check WHERE check_id = ?",
      params = list(cid)
    )
    ev <-
      log_change(
        con,
        "interval_check",
        cid,
        "delete",
        observer
      )
    result <<-
      list(
        deleted = TRUE,
        check_id = cid,
        event_id = ev
      )
  })
  if (is.null(result)) {
    return(
      err(
        res,
        404,
        "interval not found"
      )
    )
  }
  result
}

#* Delete a nest: its discovery row plus its interval checks, substrates and
#* nest-level photos. The gps_point is KEPT -- a twin nest may still use it, and
#* a point with no nest is a valid waypoint.
#* @delete /nests/<nest_id>
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  nest_id
) {
  observer <- req$observer_id
  key <- idem_key(req)
  nid <- nest_id

  exists <-
    dbGetQuery(
      con,
      "SELECT nest_id FROM nest WHERE nest_id = ?",
      params = list(nid)
    )
  if (nrow(exists) == 0) {
    return(err(res, 404, "nest not found"))
  }

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(con, key, "nest", nid)) {
      result <<-
        list(replayed = TRUE, nest_id = nid, deleted = TRUE)
      return(invisible(NULL))
    }
    dbExecute(con, "DELETE FROM interval_check WHERE nest_id = ?", params = list(nid))
    dbExecute(con, "DELETE FROM nest_substrate WHERE nest_id = ?", params = list(nid))
    dbExecute(con, "DELETE FROM photo          WHERE nest_id = ?", params = list(nid))
    dbExecute(con, "DELETE FROM nest           WHERE nest_id = ?", params = list(nid))
    ev <- log_change(con, "nest", nid, "delete", observer)
    result <<-
      list(deleted = TRUE, nest_id = nid, event_id = ev)
  })
  result
}

#* Delete ALL interval checks for a nest, keeping the nest and its point.
#* @delete /nests/<nest_id>/intervals
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  nest_id
) {
  observer <- req$observer_id
  key <- idem_key(req)
  nid <- nest_id

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(con, key, "interval_check", nid)) {
      result <<-
        list(replayed = TRUE, nest_id = nid, deleted = TRUE)
      return(invisible(NULL))
    }
    n <-
      dbGetQuery(
        con,
        "SELECT COUNT(*) AS n FROM interval_check WHERE nest_id = ?",
        params = list(nid)
      )$n
    dbExecute(con, "DELETE FROM interval_check WHERE nest_id = ?", params = list(nid))
    ev <- log_change(con, "interval_check", nid, "delete_all", observer)
    result <<-
      list(deleted = TRUE, nest_id = nid, checks_deleted = n, event_id = ev)
  })
  result
}

#* Delete a GPS point and everything on it (its nest + that nest's children,
#* plus point-level photos and predator_camera). REFUSED 409 when two nests
#* share the point -- the client hides the button then; this enforces it so a
#* stale client can't slip a shared-point delete through. Single-threaded server,
#* so the pre-txn guard has no race.
#* @delete /gps_points/<point_id>
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  point_id
) {
  observer <- req$observer_id
  key <- idem_key(req)
  pid <- point_id

  exists <-
    dbGetQuery(
      con,
      "SELECT point_id FROM gps_point WHERE point_id = ?",
      params = list(pid)
    )
  if (nrow(exists) == 0) {
    return(err(res, 404, "point not found"))
  }
  nests <-
    dbGetQuery(
      con,
      "SELECT nest_id FROM nest WHERE gps_point_id = ?",
      params = list(pid)
    )
  if (nrow(nests) > 1) {
    return(err(res, 409, "point is shared by two nests; delete a nest instead"))
  }

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(con, key, "gps_point", pid)) {
      result <<-
        list(replayed = TRUE, point_id = pid, deleted = TRUE)
      return(invisible(NULL))
    }
    for (nid in nests$nest_id) {
      dbExecute(con, "DELETE FROM interval_check WHERE nest_id = ?", params = list(nid))
      dbExecute(con, "DELETE FROM nest_substrate WHERE nest_id = ?", params = list(nid))
      dbExecute(con, "DELETE FROM photo          WHERE nest_id = ?", params = list(nid))
      dbExecute(con, "DELETE FROM nest           WHERE nest_id = ?", params = list(nid))
    }
    dbExecute(con, "DELETE FROM photo           WHERE point_id     = ?", params = list(pid))
    dbExecute(con, "DELETE FROM predator_camera WHERE gps_point_id = ?", params = list(pid))
    dbExecute(con, "DELETE FROM gps_point       WHERE point_id     = ?", params = list(pid))
    ev <- log_change(con, "gps_point", pid, "delete", observer)
    result <<-
      list(
        deleted = TRUE,
        point_id = pid,
        nests_deleted = as.list(nests$nest_id),
        event_id = ev
      )
  })
  result
}

#* Create a GPS point (waypoint). Client supplies point_id (UUID). Optional
#* nav_photo (base64) stored in-DB.
#* @post /gps_points
#* @serializer unboxedJSON list(digits = 9)
function(req, res) {
  body <-
    req$body %||%
    tryCatch(
      jsonlite::fromJSON(req$postBody),
      error = function(.e) list()
    )
  observer <- req$observer_id
  key <- idem_key(req)

  point_id <- body$point_id
  if (is.null(point_id) || !nzchar(point_id)) {
    return(
      err(
        res,
        400,
        "point_id (client UUID) is required"
      )
    )
  }

  nav_raw <- b64_to_raw(body$nav_photo)

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(
      con,
      key,
      "gps_point",
      point_id
    )) {
      result <<-
        list(
          replayed = TRUE,
          point = dbGetQuery(
            con,
            "SELECT * FROM gps_point WHERE point_id = ?",
            params = list(point_id)
          )
        )
      return(invisible(NULL))
    }
    inserted <- tryCatch({
      dbExecute(
        con,
        "INSERT INTO gps_point
           (point_id, point_name, point_class, patch_id, latitude, longitude,
            elevation, horizontal_accuracy, bearing, n_samples, note, color,
            nav_photo, nav_photo_name, datetime, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params = list(
          point_id,
          body$point_name %||% NA,
          body$point_class %||% NA,
          body$patch_id %||% NA,
          as.numeric(body$latitude %||% NA),
          as.numeric(body$longitude %||% NA),
          body$elevation %||% NA,
          body$horizontal_accuracy %||% NA,
          body$bearing %||% NA,
          body$n_samples %||% NA,
          body$note %||% NA,
          body$color %||% NA,
          if (is.null(nav_raw)) NA else list(nav_raw),
          body$nav_photo_name %||% NA,
          body$datetime %||% now_utc(),
          observer,
          now_utc()
        )
      )
      TRUE
    }, error = function(.e) {
      # A same-named point already exists under a different id (a retry, or a
      # re-created point) -> the (point_name, point_class) UNIQUE constraint.
      # Replay the existing row instead of 500-ing so point/artificial-nest
      # creation is reliable. Any other error is real -> re-raise.
      if (grepl("UNIQUE constraint failed: gps_point.point_name",
                conditionMessage(.e), fixed = TRUE)) FALSE else stop(.e)
    })

    if (!inserted) {
      result <<- list(
        replayed = TRUE,
        point = dbGetQuery(
          con,
          "SELECT point_id, point_name, point_class, patch_id, latitude,
                  longitude, elevation, horizontal_accuracy, bearing,
                  n_samples, note, color, nav_photo_name, datetime
             FROM gps_point WHERE point_name = ? AND point_class = ? LIMIT 1",
          params = list(body$point_name %||% NA, body$point_class %||% NA)
        )
      )
      return(invisible(NULL))
    }

    ev <-
      log_change(
        con,
        "gps_point",
        point_id,
        "insert",
        observer
      )
    result <<-
      list(
        point = dbGetQuery(
          con,
          "SELECT point_id, point_name, point_class, patch_id, latitude,
                  longitude, elevation, horizontal_accuracy, bearing,
                  n_samples, note, color, nav_photo_name, datetime
             FROM gps_point WHERE point_id = ?",
          params = list(point_id)
        ),
        event_id = ev
      )
  })
  res$status <- 201
  result
}

#* Re-record / rename / recolor a GPS point.
#* @patch /gps_points/<id>
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  id
) {
  body <-
    req$body %||%
    tryCatch(
      jsonlite::fromJSON(req$postBody),
      error = function(.e) list()
    )
  observer <- req$observer_id
  key <- idem_key(req)

  editable <-
    c(
      "point_name",
      "point_class",
      "patch_id",
      "latitude",
      "longitude",
      "elevation",
      "horizontal_accuracy",
      "bearing",
      "n_samples",
      "note",
      "color",
      "nav_photo_name",
      "datetime"
    )
  body_fields <- names(body)
  fields <- intersect(body_fields, editable)
  nav_raw <- b64_to_raw(body$nav_photo)

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(
      con,
      key,
      "gps_point",
      id
    )) {
      result <<- list(replayed = TRUE, point_id = id)
      return(invisible(NULL))
    }
    exists <-
      dbGetQuery(
        con,
        "SELECT 1 FROM gps_point WHERE point_id = ?",
        params = list(id)
      )
    if (nrow(exists) == 0) {
      stop("gps point not found")
    }
    if (length(fields) > 0) {
      set_sql <-
        str_flatten(
          str_c(fields, " = ?"),
          collapse = ", "
        )
      params <- c(lapply(fields, function(.f) body[[.f]] %||% NA), list(id))
      dbExecute(
        con,
        str_c(
          "UPDATE gps_point SET ",
          set_sql,
          " WHERE point_id = ?"
        ),
        params = params
      )
    }
    if (!is.null(nav_raw)) {
      dbExecute(
        con,
        "UPDATE gps_point SET nav_photo = ? WHERE point_id = ?",
        params = list(list(nav_raw), id)
      )
    }
    ev <-
      log_change(
        con,
        "gps_point",
        id,
        "update",
        observer
      )
    result <<- list(point_id = id, event_id = ev)
  })
  if (is.null(result)) {
    return(
      err(
        res,
        404,
        "gps point not found"
      )
    )
  }
  result
}

#* Place an artificial nest at an existing nest's location. Creates a new NQ
#* nest sharing source nest :id's gps_point_id, species = Artificial nest, and
#* a first interval with host_eggs = 2 -- all in one transaction.
#* @post /nests/<id>/artificial
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  id
) {
  body <-
    req$body %||%
    tryCatch(
      jsonlite::fromJSON(req$postBody),
      error = function(.e) list()
    )
  observer <- req$observer_id
  key <- idem_key(req)

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(
      con,
      key,
      "nest",
      NA
    )) {
      prev <-
        dbGetQuery(
          con,
          "SELECT entity_id FROM write_log WHERE idempotency_key = ?",
          params = list(key)
        )
      result <<-
        list(
          replayed = TRUE,
          nest = dbGetQuery(
            con,
            "SELECT * FROM nest WHERE nest_id = ?",
            params = list(prev$entity_id[[1]])
          )
        )
      return(invisible(NULL))
    }
    src <-
      dbGetQuery(
        con,
        "SELECT patch_id, gps_point_id FROM nest WHERE nest_id = ?",
        params = list(id)
      )
    if (nrow(src) == 0) {
      stop("source nest not found")
    }

    # allocate an NQ id with retry

    inserted_id <- NULL
    for (attempt in seq_len(25)) {
      # Honor a client-requested NQ id (e.g. N057 -> NQ057) on the first attempt
      # when it's well-formed; on a collision the tryCatch falls through and the
      # next attempt auto-allocates the next free NQ number.
      nid <-
        if (attempt == 1 &&
            !is.null(body$nest_id) &&
            grepl("^NQ[0-9]+$", body$nest_id)) {
          body$nest_id
        } else {
          next_nest_id(con, "NQ")
        }
      today_date <- Sys.Date()
      today_str <- format(today_date, "%Y-%m-%d")
      ok <-
        tryCatch(
          {
            dbExecute(
              con,
              "INSERT INTO nest
                 (nest_id, patch_id, species_code, discovery_date, gps_point_id,
                  artificial_candidate, created_by, created_at)
               VALUES (?,?,?,?,?,?,?,?)",
              params = list(
                nid,
                src$patch_id[[1]],
                "ARNE",                 # Artificial nest (seed species code)
                body$discovery_date %||% today_str,
                src$gps_point_id[[1]],  # SHARED point, not moved
                1L,
                observer,
                now_utc()
              )
            )
            TRUE
          },
          error = function(.e) FALSE
        )
      if (ok) {
        inserted_id <- nid
        break
      }
    }
    if (is.null(inserted_id)) {
      stop("could not allocate a free NQ nest_id after retries")
    }

    # first interval: host_eggs = 2

    today_date <- Sys.Date()
    today_str <- format(today_date, "%Y-%m-%d")
    dbExecute(
      con,
      "INSERT INTO interval_check
         (nest_id, check_date, check_time, current_state, observer_id,
          host_eggs, created_at)
       VALUES (?,?,?,?,?,?,?)",
      params = list(
        inserted_id,
        body$check_date %||% today_str,
        body$check_time %||% NA,
        "Active",
        observer,
        2L,
        now_utc()
      )
    )
    cid <- dbGetQuery(con, "SELECT last_insert_rowid() AS id")$id

    ev <-
      log_change(
        con,
        "nest",
        inserted_id,
        "insert",
        observer
      )
    log_change(
      con,
      "interval_check",
      cid,
      "insert",
      observer
    )
    if (!is.null(key) && nzchar(key)) {
      dbExecute(
        con,
        "UPDATE write_log SET entity_id = ? WHERE idempotency_key = ?",
        params = list(inserted_id, key)
      )
    }
    result <<-
      list(
        nest = dbGetQuery(
          con,
          "SELECT * FROM nest WHERE nest_id = ?",
          params = list(inserted_id)
        ),
        first_interval_check_id = cid,
        event_id = ev
      )
  })
  res$status <- 201
  result
}

#* All recorded tracks (walked paths), shared across devices. points is parsed
#* back to an array of {lat,lng,t,acc}.
#* @get /tracks
#* @serializer unboxedJSON list(digits = 9)
function(req, res) {
  rows <- db_read(con, "SELECT * FROM track ORDER BY created_at")
  out <- vector("list", nrow(rows))
  for (i in seq_len(nrow(rows))) {
    r <- rows[i, ]
    pj <- r$points_json[[1]]
    pts <-
      if (is.null(pj) || is.na(pj) || !nzchar(pj)) {
        list()
      } else {
        tryCatch(
          jsonlite::fromJSON(pj, simplifyDataFrame = FALSE),
          error = function(.e) list()
        )
      }
    out[[i]] <-
      list(
        track_id = r$track_id[[1]],
        name = r$name[[1]],
        activity = r$activity[[1]],
        patch_id = r$patch_id[[1]],
        length_m = r$length_m[[1]],
        note = r$note[[1]],
        points = pts,
        created_by = r$created_by[[1]],
        created_at = r$created_at[[1]]
      )
  }
  out
}

#* Create a track. Idempotent on track_id (client UUID) + the idempotency key.
#* Body: track_id, name, activity, patch_id, length_m, note, points (array).
#* @post /tracks
#* @serializer unboxedJSON list(digits = 9)
function(req, res) {
  body <-
    req$body %||%
    tryCatch(
      jsonlite::fromJSON(req$postBody),
      error = function(.e) list()
    )
  observer <- req$observer_id
  key <- idem_key(req)

  track_id <- body$track_id
  if (is.null(track_id) || !nzchar(track_id)) {
    return(
      err(
        res,
        400,
        "track_id (client UUID) is required"
      )
    )
  }
  points_json <-
    tryCatch(
      jsonlite::toJSON(body$points, auto_unbox = TRUE, digits = NA),
      error = function(.e) "[]"
    )

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(con, key, "track", track_id)) {
      result <<- list(replayed = TRUE, track_id = track_id)
      return(invisible(NULL))
    }
    dbExecute(
      con,
      "INSERT OR IGNORE INTO track
         (track_id, name, activity, patch_id, length_m, note, points_json,
          created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)",
      params = list(
        track_id,
        body$name %||% NA,
        body$activity %||% NA,
        body$patch_id %||% NA,
        as.numeric(body$length_m %||% NA),
        body$note %||% NA,
        as.character(points_json),
        observer,
        now_utc()
      )
    )
    result <<- list(track_id = track_id)
  })
  res$status <- 201
  result
}

#* Edit a track's name / note / activity / patch (points optional).
#* @patch /tracks/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  body <-
    req$body %||%
    tryCatch(
      jsonlite::fromJSON(req$postBody),
      error = function(.e) list()
    )
  sets <- c()
  params <- list()
  if (!is.null(body$name)) {
    sets <- c(sets, "name = ?")
    params <- c(params, list(body$name))
  }
  if (!is.null(body$note)) {
    sets <- c(sets, "note = ?")
    params <- c(params, list(body$note))
  }
  if (!is.null(body$activity)) {
    sets <- c(sets, "activity = ?")
    params <- c(params, list(body$activity))
  }
  if (!is.null(body$patch_id)) {
    sets <- c(sets, "patch_id = ?")
    params <- c(params, list(body$patch_id))
  }
  if (!is.null(body$points)) {
    sets <- c(sets, "points_json = ?")
    params <-
      c(
        params,
        list(
          as.character(
            jsonlite::toJSON(body$points, auto_unbox = TRUE, digits = NA)
          )
        )
      )
  }
  if (length(sets) == 0) {
    return(list(track_id = id))
  }
  params <- c(params, list(id))
  dbExecute(
    con,
    str_c("UPDATE track SET ", str_flatten(sets, collapse = ", "), " WHERE track_id = ?"),
    params = params
  )
  list(track_id = id)
}

#* Delete a track.
#* @delete /tracks/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  dbExecute(con, "DELETE FROM track WHERE track_id = ?", params = list(id))
  list(track_id = id, deleted = TRUE)
}

#* Upload a larger (non-nav) photo: stored on disk, row in photo. Body is
#* base64 "image" + metadata (kind, nest_id / point_id, bearing, filename).
#* @post /photos
#* @serializer unboxedJSON list(digits = 9)
function(req, res) {
  body <-
    req$body %||%
    tryCatch(
      jsonlite::fromJSON(req$postBody),
      error = function(.e) list()
    )
  observer <- req$observer_id
  key <- idem_key(req)

  raw <- b64_to_raw(body$image)
  if (is.null(raw)) {
    return(
      err(
        res,
        400,
        "image (base64) is required"
      )
    )
  }
  kind <- body$kind %||% "original"

  # build a safe disk filename

  ext <- body$ext %||% "jpg"
  now_time <- Sys.time()
  timestamp_str <- format(now_time, "%Y%m%d%H%M%S")
  base <-
    body$filename %||%
    str_c(
      kind,
      "_",
      timestamp_str,
      "_",
      str_sub(
        digest(raw, algo = "crc32"),
        1,
        8
      ),
      ".",
      ext
    )
  base <- basename(base)
  disk_path <- file.path(photo_dir, base)

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(
      con,
      key,
      "photo",
      NA
    )) {
      prev <-
        dbGetQuery(
          con,
          "SELECT entity_id FROM write_log WHERE idempotency_key = ?",
          params = list(key)
        )
      result <<-
        list(
          replayed = TRUE,
          photo = dbGetQuery(
            con,
            "SELECT * FROM photo WHERE photo_id = ?",
            params = list(as.integer(prev$entity_id[[1]]))
          )
        )
      return(invisible(NULL))
    }
    writeBin(raw, disk_path)
    dbExecute(
      con,
      "INSERT INTO photo (kind, nest_id, point_id, bearing, filename, taken_at,
                          created_at)
       VALUES (?,?,?,?,?,?,?)",
      params = list(
        kind,
        body$nest_id %||% NA,
        body$point_id %||% NA,
        body$bearing %||% NA,
        base,
        body$taken_at %||% now_utc(),
        now_utc()
      )
    )
    pid <- dbGetQuery(con, "SELECT last_insert_rowid() AS id")$id
    ev <-
      log_change(
        con,
        "photo",
        pid,
        "insert",
        observer
      )
    if (!is.null(key) && nzchar(key)) {
      dbExecute(
        con,
        "UPDATE write_log SET entity_id = ? WHERE idempotency_key = ?",
        params = list(pid, key)
      )
    }
    result <<-
      list(
        photo = dbGetQuery(
          con,
          "SELECT * FROM photo WHERE photo_id = ?",
          params = list(pid)
        ),
        event_id = ev
      )
  })
  res$status <- 201
  result
}

# ---------------------------------------------------------------------------
# `%||%` -- coalesce helper (NULL / empty -> default). Kept at file end so it
# is defined when routes run.
# ---------------------------------------------------------------------------

`%||%` <-
  function(.x, .y) {
    if (is.null(.x)) return(.y)
    if (length(.x) == 1 && is.na(.x)) return(.y)
    if (is.character(.x) && length(.x) == 1 && !nzchar(.x)) return(.y)
    .x
  }
# /map_points route -- append to /opt/nest-api/server/plumber.R, then restart.
#
#   sudo cp /opt/nest-api/server/plumber.R /opt/nest-api/server/plumber.R.bak-$(date +%F)
#   sudo tee -a /opt/nest-api/server/plumber.R < map_points_route.R > /dev/null
#   sudo systemctl restart nest-api
#
# Uses the same global `con` the other routes use, and sits behind the same auth
# filter, so it needs no special handling. Backed by the v_map_point view: the DB
# decides how every marker renders (icon / opacity / size / status), instead of
# the client re-deriving it. Install v_map_point.sql first.

#* One row per map marker, carrying everything needed to draw it:
#* idx, name, class, lat, lng, ref_id, status, icon, opacity, size.
#* Optional ?class= filters to a single point class (nest / coverboard /
#* trailcam / point_count / landmark / other), mirroring /gps_points?class=.
#* Opacity/size reflect TODAY's schedule (advancing to the next field day when
#* today isn't one) -- see v_map_point.sql.
#* @get /map_points
#* @serializer unboxedJSON list(digits = 9)
function(req, res, class = NULL) {
  if (is.null(class) || !nzchar(class)) {
    dbGetQuery(con, "SELECT * FROM v_map_point")
  } else {
    dbGetQuery(
      con,
      "SELECT * FROM v_map_point WHERE class = ?",
      params = list(class)
    )
  }
}

# ===========================================================================
# GUI DATA-ENTRY ROUTES -- coverboards, point counts, visits, camera
# maintenance, schedule days. Added for snedgen-gui (its
# PAGE_CONTRACT.md defines this surface). Same auth filter, same txn +
# change_event + idempotency conventions as the field-app routes above.
#
# NOTE nightly_load.R truncate-reloads point_count / count_interval /
# coverboard_check / coverboard_obs / visit from the Sheets pipeline. Once
# the GUI is the entry path for a table, STOP loading that table nightly or
# GUI-entered rows are wiped at the next run.
# ===========================================================================

# --- additive migrations, applied at boot (redeploy-safe) -------------------

# The GUI's Edit-day popup writes up to four search patches; the sheet-era
# schedule_day stops at two. Guarded by PRAGMA table_info so this is a no-op
# once applied.

gui_schedule_extra_cols <-
  c(
    "search_patch_3", "tns_patch_3", "helper_patch_3",
    "search_patch_4", "tns_patch_4", "helper_patch_4"
  )

gui_existing_cols <-
  dbGetQuery(con, "PRAGMA table_info(schedule_day)")$name

for (.c in setdiff(gui_schedule_extra_cols, gui_existing_cols)) {
  dbExecute(
    con,
    str_c("ALTER TABLE schedule_day ADD COLUMN ", .c, " TEXT")
  )
}

# Per-date weather JSON, fed by scripts/db/weather_push.R (an off-box NWS fetch)
# and joined into v_schedule. Weather is the one schedule input that cannot be
# derived from the DB, so it lands in its own tiny table.

dbExecute(
  con,
  "CREATE TABLE IF NOT EXISTS weather (
     date     TEXT PRIMARY KEY,
     weather  TEXT
   )"
)

# Coverboard species vocabulary. /lookups unions this with the DISTINCT
# species already recorded in coverboard_obs, so the dropdown works before
# anyone curates the table.

dbExecute(
  con,
  "CREATE TABLE IF NOT EXISTS coverboard_species (
     species  TEXT PRIMARY KEY,
     label    TEXT
   );"
)

# Some DBs were provisioned before species_engine landed in schema.sql; the
# /lookups read must not 500 on them.

dbExecute(
  con,
  "CREATE TABLE IF NOT EXISTS species_engine (
     species_code  TEXT PRIMARY KEY,
     species_name  TEXT NOT NULL
   );"
)

# --- shared helpers ---------------------------------------------------------

# A 1-row data.frame -> a plain list, dropping NA columns so a create
# response serializes cleanly (jsonlite renders a length-1 NA as "NA").

gui_row <-
  function(.df) {
    l <- as.list(.df[1, ])
    Filter(
      function(.v) !(length(.v) == 1 && is.na(.v)),
      l
    )
  }

gui_body <-
  function(.req) {
    .req$body %||%
      tryCatch(
        jsonlite::fromJSON(.req$postBody),
        error = function(.e) list()
      )
  }

# WHERE builder for the list routes' optional filters.
# .clauses: named list of sql-fragment -> value; empty values are dropped.

gui_where <-
  function(.clauses) {
    keep <-
      Filter(
        function(.v) !is.null(.v) && !is.na(.v) && nzchar(as.character(.v)),
        .clauses
      )
    if (length(keep) == 0) {
      return(list(sql = "", params = list()))
    }
    list(
      sql = str_c(" WHERE ", str_flatten(names(keep), collapse = " AND ")),
      params = unname(as.list(keep))
    )
  }

# Generic single-row PATCH: intersect the body with the editable set, update,
# log the change, return the fresh row (NULL when the id is unknown).

gui_patch_row <-
  function(
    .req,
    .entity,
    .table,
    .id_col,
    .id,
    .editable
  ) {
    body <- gui_body(.req)
    observer <- .req$observer_id
    key <- idem_key(.req)
    fields <- intersect(names(body), .editable)

    result <- NULL
    with_txn(con, function() {
      if (!record_idempotency(con, key, .entity, .id)) {
        result <<- list(replayed = TRUE)
        return(invisible(NULL))
      }
      exists <-
        dbGetQuery(
          con,
          str_c("SELECT 1 FROM ", .table, " WHERE ", .id_col, " = ?"),
          params = list(.id)
        )
      if (nrow(exists) == 0) {
        return(invisible(NULL))
      }
      if ("patch_id" %in% fields) {
        ensure_patch(con, body$patch_id %||% NA)
      }
      if (length(fields) > 0) {
        set_sql <-
          str_flatten(
            str_c(fields, " = ?"),
            collapse = ", "
          )
        params <-
          c(
            lapply(fields, function(.f) body[[.f]] %||% NA),
            list(.id)
          )
        dbExecute(
          con,
          str_c(
            "UPDATE ", .table, " SET ", set_sql,
            " WHERE ", .id_col, " = ?"
          ),
          params = params
        )
      }
      ev <- log_change(con, .entity, .id, "update", observer)
      result <<-
        list(
          row = dbGetQuery(
            con,
            str_c("SELECT * FROM ", .table, " WHERE ", .id_col, " = ?"),
            params = list(.id)
          ),
          event_id = ev
        )
    })
    result
  }

# Generic single-row DELETE (children handled by the caller or by ON DELETE
# CASCADE -- foreign_keys is ON). Returns NULL when the id is unknown.

gui_delete_row <-
  function(
    .req,
    .entity,
    .table,
    .id_col,
    .id
  ) {
    observer <- .req$observer_id
    key <- idem_key(.req)

    exists <-
      dbGetQuery(
        con,
        str_c("SELECT 1 FROM ", .table, " WHERE ", .id_col, " = ?"),
        params = list(.id)
      )
    if (nrow(exists) == 0) {
      return(NULL)
    }

    result <- NULL
    with_txn(con, function() {
      if (!record_idempotency(con, key, .entity, .id)) {
        result <<- list(replayed = TRUE, deleted = TRUE)
        return(invisible(NULL))
      }
      dbExecute(
        con,
        str_c("DELETE FROM ", .table, " WHERE ", .id_col, " = ?"),
        params = list(.id)
      )
      ev <- log_change(con, .entity, .id, "delete", observer)
      result <<- list(deleted = TRUE, event_id = ev)
    })
    result
  }

# --- coverboards ------------------------------------------------------------

#* Coverboard checks. Filters: ?from, ?to (check_date), ?patch_id.
#* @get /coverboard_checks
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  from = "",
  to = "",
  patch_id = ""
) {
  w <-
    gui_where(
      list(
        "check_date >= ?" = from,
        "check_date <= ?" = to,
        "patch_id = ?" = patch_id
      )
    )
  db_read(
    con,
    str_c(
      "SELECT * FROM coverboard_check",
      w$sql,
      " ORDER BY check_date DESC, patch_id, board_num"
    ),
    w$params
  )
}

#* Create a coverboard check.
#* @post /coverboard_checks
#* @serializer unboxedJSON list(digits = 9)
function(req, res) {
  body <- gui_body(req)
  observer <- req$observer_id
  key <- idem_key(req)

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(con, key, "coverboard_check", NA)) {
      result <<- list(replayed = TRUE)
      return(invisible(NULL))
    }
    ensure_patch(con, body$patch_id %||% NA)
    dbExecute(
      con,
      "INSERT INTO coverboard_check
         (patch_id, board_num, check_date, check_time, observer_id, notes)
       VALUES (?,?,?,?,?,?)",
      params = list(
        body$patch_id %||% NA,
        as.integer(body$board_num %||% NA),
        body$check_date %||% NA,
        body$check_time %||% NA,
        body$observer_id %||% observer,
        body$notes %||% NA
      )
    )
    cid <- dbGetQuery(con, "SELECT last_insert_rowid() AS id")$id
    ev <- log_change(con, "coverboard_check", cid, "insert", observer)
    if (!is.null(key) && nzchar(key)) {
      dbExecute(
        con,
        "UPDATE write_log SET entity_id = ? WHERE idempotency_key = ?",
        params = list(cid, key)
      )
    }
    result <<-
      gui_row(
        dbGetQuery(
          con,
          "SELECT * FROM coverboard_check WHERE coverboard_check_id = ?",
          params = list(cid)
        )[1, ]
      )
  })
  res$status <- 201
  result
}

#* Edit a coverboard check.
#* @patch /coverboard_checks/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  out <-
    gui_patch_row(
      req,
      "coverboard_check",
      "coverboard_check",
      "coverboard_check_id",
      as.integer(id),
      c(
        "patch_id", "board_num", "check_date", "check_time", "observer_id",
        "notes"
      )
    )
  if (is.null(out)) return(err(res, 404, "coverboard check not found"))
  out
}

#* Delete a coverboard check (its observations cascade).
#* @delete /coverboard_checks/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  out <-
    gui_delete_row(
      req,
      "coverboard_check",
      "coverboard_check",
      "coverboard_check_id",
      as.integer(id)
    )
  if (is.null(out)) return(err(res, 404, "coverboard check not found"))
  out
}

#* Observations under one check.
#* @get /coverboard_checks/<id>/obs
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  dbGetQuery(
    con,
    "SELECT * FROM coverboard_obs WHERE coverboard_check_id = ?
       ORDER BY species",
    params = list(as.integer(id))
  )
}

#* Add an observation to a check.
#* @post /coverboard_checks/<id>/obs
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  body <- gui_body(req)
  observer <- req$observer_id
  key <- idem_key(req)
  check_id <- as.integer(id)

  parent <-
    dbGetQuery(
      con,
      "SELECT 1 FROM coverboard_check WHERE coverboard_check_id = ?",
      params = list(check_id)
    )
  if (nrow(parent) == 0) {
    return(err(res, 404, "coverboard check not found"))
  }

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(con, key, "coverboard_obs", NA)) {
      result <<- list(replayed = TRUE)
      return(invisible(NULL))
    }
    dbExecute(
      con,
      "INSERT INTO coverboard_obs
         (coverboard_check_id, species, count, photo_id, notes)
       VALUES (?,?,?,?,?)",
      params = list(
        check_id,
        body$species %||% NA,
        as.integer(body$count %||% 0),
        body$photo_id %||% NA,
        body$notes %||% NA
      )
    )
    oid <- dbGetQuery(con, "SELECT last_insert_rowid() AS id")$id
    ev <- log_change(con, "coverboard_obs", oid, "insert", observer)
    if (!is.null(key) && nzchar(key)) {
      dbExecute(
        con,
        "UPDATE write_log SET entity_id = ? WHERE idempotency_key = ?",
        params = list(oid, key)
      )
    }
    result <<-
      gui_row(
        dbGetQuery(
          con,
          "SELECT * FROM coverboard_obs WHERE obs_id = ?",
          params = list(oid)
        )[1, ]
      )
  })
  res$status <- 201
  result
}

#* Edit an observation.
#* @patch /coverboard_obs/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  out <-
    gui_patch_row(
      req,
      "coverboard_obs",
      "coverboard_obs",
      "obs_id",
      as.integer(id),
      c("species", "count", "photo_id", "notes")
    )
  if (is.null(out)) return(err(res, 404, "observation not found"))
  out
}

#* Delete an observation.
#* @delete /coverboard_obs/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  out <-
    gui_delete_row(
      req,
      "coverboard_obs",
      "coverboard_obs",
      "obs_id",
      as.integer(id)
    )
  if (is.null(out)) return(err(res, 404, "observation not found"))
  out
}

# --- point counts -----------------------------------------------------------

#* Point counts. Filters: ?from, ?to (count_date), ?patch_id.
#* @get /point_counts
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  from = "",
  to = "",
  patch_id = ""
) {
  w <-
    gui_where(
      list(
        "count_date >= ?" = from,
        "count_date <= ?" = to,
        "patch_id = ?" = patch_id
      )
    )
  db_read(
    con,
    str_c(
      "SELECT * FROM point_count",
      w$sql,
      " ORDER BY count_date DESC, start_time"
    ),
    w$params
  )
}

#* Create a point count (header row; counts go to /point_counts/<id>/intervals).
#* @post /point_counts
#* @serializer unboxedJSON list(digits = 9)
function(req, res) {
  body <- gui_body(req)
  observer <- req$observer_id
  key <- idem_key(req)

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(con, key, "point_count", NA)) {
      result <<- list(replayed = TRUE)
      return(invisible(NULL))
    }
    ensure_patch(con, body$patch_id %||% NA)
    dbExecute(
      con,
      "INSERT INTO point_count
         (observer_id, patch_id, count_date, weather, start_time)
       VALUES (?,?,?,?,?)",
      params = list(
        body$observer_id %||% observer,
        body$patch_id %||% NA,
        body$count_date %||% NA,
        body$weather %||% NA,
        body$start_time %||% NA
      )
    )
    pid <- dbGetQuery(con, "SELECT last_insert_rowid() AS id")$id
    ev <- log_change(con, "point_count", pid, "insert", observer)
    if (!is.null(key) && nzchar(key)) {
      dbExecute(
        con,
        "UPDATE write_log SET entity_id = ? WHERE idempotency_key = ?",
        params = list(pid, key)
      )
    }
    result <<-
      gui_row(
        dbGetQuery(
          con,
          "SELECT * FROM point_count WHERE point_count_id = ?",
          params = list(pid)
        )[1, ]
      )
  })
  res$status <- 201
  result
}

#* Edit a point count header.
#* @patch /point_counts/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  out <-
    gui_patch_row(
      req,
      "point_count",
      "point_count",
      "point_count_id",
      as.integer(id),
      c("observer_id", "patch_id", "count_date", "weather", "start_time")
    )
  if (is.null(out)) return(err(res, 404, "point count not found"))
  out
}

#* Delete a point count (its count rows cascade).
#* @delete /point_counts/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  out <-
    gui_delete_row(
      req,
      "point_count",
      "point_count",
      "point_count_id",
      as.integer(id)
    )
  if (is.null(out)) return(err(res, 404, "point count not found"))
  out
}

#* Count rows (long: one per interval x species x detection x distance).
#* @get /point_counts/<id>/intervals
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  dbGetQuery(
    con,
    "SELECT * FROM count_interval WHERE point_count_id = ?
       ORDER BY interval, species, detection, distance",
    params = list(as.integer(id))
  )
}

#* REPLACE this count's rows. Body: { rows: [ {interval, species, detection,
#* distance, count}, ... ] }. One transaction: the GUI saves the whole grid at
#* once (mirrors the sheet), so a partial write must be impossible.
#* @post /point_counts/<id>/intervals
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  body <- gui_body(req)
  observer <- req$observer_id
  key <- idem_key(req)
  pc_id <- as.integer(id)

  parent <-
    dbGetQuery(
      con,
      "SELECT 1 FROM point_count WHERE point_count_id = ?",
      params = list(pc_id)
    )
  if (nrow(parent) == 0) {
    return(err(res, 404, "point count not found"))
  }

  rows <- body$rows
  df <-
    if (is.null(rows)) {
      data.frame()
    } else {
      as.data.frame(rows, stringsAsFactors = FALSE)
    }

  # Validate against the CHECK constraints up front so the whole batch is
  # rejected with a message, not half-inserted then 500.

  if (nrow(df) > 0) {
    ok_interval <-
      !is.na(suppressWarnings(as.integer(df$interval))) &
        as.integer(df$interval) %in% 1:3
    ok_distance <-
      df$distance %in% c("< 25 m", "25-50 m", "50-75 m", "75-100 m", "> 100 m")
    ok_detection <- df$detection %in% c("A", "V", "B")
    bad <- sum(!(ok_interval & ok_distance & ok_detection))
    if (bad > 0) {
      return(
        err(
          res,
          400,
          str_c(bad, " row(s) have an invalid interval/distance/detection")
        )
      )
    }
    known <-
      dbGetQuery(con, "SELECT species_code FROM species_engine")$species_code
    unknown <- setdiff(unique(df$species), known)
    if (length(unknown) > 0) {
      return(
        err(
          res,
          400,
          str_c(
            "unknown species code(s): ",
            str_flatten(unknown, collapse = ", ")
          )
        )
      )
    }
  }

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(con, key, "count_interval", pc_id)) {
      result <<- list(replayed = TRUE)
      return(invisible(NULL))
    }
    dbExecute(
      con,
      "DELETE FROM count_interval WHERE point_count_id = ?",
      params = list(pc_id)
    )
    if (nrow(df) > 0) {
      for (i in seq_len(nrow(df))) {
        dbExecute(
          con,
          "INSERT INTO count_interval
             (point_count_id, interval, species, distance, detection, count)
           VALUES (?,?,?,?,?,?)",
          params = list(
            pc_id,
            as.integer(df$interval[[i]]),
            df$species[[i]],
            df$distance[[i]],
            df$detection[[i]],
            as.integer(df$count[[i]])
          )
        )
      }
    }
    # change_event.action is CHECKed to insert/update/delete; a whole-grid
    # replace is an update of the count's rows.

    ev <- log_change(con, "count_interval", pc_id, "update", observer)
    result <<- list(saved = nrow(df), event_id = ev)
  })
  result
}

# --- visits -----------------------------------------------------------------

#* Visits. Filters: ?from, ?to (visit_date), ?patch_id.
#* @get /visits
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  from = "",
  to = "",
  patch_id = ""
) {
  w <-
    gui_where(
      list(
        "visit_date >= ?" = from,
        "visit_date <= ?" = to,
        "patch_id = ?" = patch_id
      )
    )
  db_read(
    con,
    str_c(
      "SELECT * FROM visit",
      w$sql,
      " ORDER BY visit_date DESC, patch_id"
    ),
    w$params
  )
}

#* Create a visit.
#* @post /visits
#* @serializer unboxedJSON list(digits = 9)
function(req, res) {
  body <- gui_body(req)
  observer <- req$observer_id
  key <- idem_key(req)

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(con, key, "visit", NA)) {
      result <<- list(replayed = TRUE)
      return(invisible(NULL))
    }
    ensure_patch(con, body$patch_id %||% NA)
    dbExecute(
      con,
      "INSERT INTO visit
         (visit_date, patch_id, helper, activity, status, notes)
       VALUES (?,?,?,?,?,?)",
      params = list(
        body$visit_date %||% NA,
        body$patch_id %||% NA,
        body$helper %||% NA,
        body$activity %||% NA,
        body$status %||% NA,
        body$notes %||% NA
      )
    )
    vid <- dbGetQuery(con, "SELECT last_insert_rowid() AS id")$id
    ev <- log_change(con, "visit", vid, "insert", observer)
    if (!is.null(key) && nzchar(key)) {
      dbExecute(
        con,
        "UPDATE write_log SET entity_id = ? WHERE idempotency_key = ?",
        params = list(vid, key)
      )
    }
    result <<-
      gui_row(
        dbGetQuery(
          con,
          "SELECT * FROM visit WHERE visit_id = ?",
          params = list(vid)
        )[1, ]
      )
  })
  res$status <- 201
  result
}

#* Edit a visit.
#* @patch /visits/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  out <-
    gui_patch_row(
      req,
      "visit",
      "visit",
      "visit_id",
      as.integer(id),
      c("visit_date", "patch_id", "helper", "activity", "status", "notes")
    )
  if (is.null(out)) return(err(res, 404, "visit not found"))
  out
}

#* Delete a visit.
#* @delete /visits/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  out <-
    gui_delete_row(
      req,
      "visit",
      "visit",
      "visit_id",
      as.integer(id)
    )
  if (is.null(out)) return(err(res, 404, "visit not found"))
  out
}

# --- predator cameras + maintenance ----------------------------------------

#* Register a camera. camera_id is the human-typed primary key.
#* @post /predator_cameras
#* @serializer unboxedJSON list(digits = 9)
function(req, res) {
  body <- gui_body(req)
  observer <- req$observer_id
  key <- idem_key(req)

  camera_id <- body$camera_id
  if (is.null(camera_id) || !nzchar(camera_id)) {
    return(err(res, 400, "camera_id is required"))
  }
  taken <-
    dbGetQuery(
      con,
      "SELECT 1 FROM predator_camera WHERE camera_id = ?",
      params = list(camera_id)
    )
  if (nrow(taken) > 0) {
    return(err(res, 409, str_c("camera_id already exists: ", camera_id)))
  }

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(con, key, "predator_camera", camera_id)) {
      result <<- list(replayed = TRUE, camera_id = camera_id)
      return(invisible(NULL))
    }
    ensure_patch(con, body$patch_id %||% NA)
    dbExecute(
      con,
      "INSERT INTO predator_camera (camera_id, patch_id, gps_point_id)
       VALUES (?,?,?)",
      params = list(
        camera_id,
        body$patch_id %||% NA,
        body$gps_point_id %||% NA
      )
    )
    ev <- log_change(con, "predator_camera", camera_id, "insert", observer)
    result <<-
      gui_row(
        dbGetQuery(
          con,
          "SELECT * FROM predator_camera WHERE camera_id = ?",
          params = list(camera_id)
        )[1, ]
      )
  })
  res$status <- 201
  result
}

#* Edit a camera (patch / point). camera_id itself is immutable: the
#* maintenance log references it.
#* @patch /predator_cameras/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  out <-
    gui_patch_row(
      req,
      "predator_camera",
      "predator_camera",
      "camera_id",
      id,
      c("patch_id", "gps_point_id")
    )
  if (is.null(out)) return(err(res, 404, "camera not found"))
  out
}

#* Delete a camera and its whole maintenance log (cascade).
#* @delete /predator_cameras/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  out <-
    gui_delete_row(
      req,
      "predator_camera",
      "predator_camera",
      "camera_id",
      id
    )
  if (is.null(out)) return(err(res, 404, "camera not found"))
  out
}

#* One camera's maintenance log.
#* @get /predator_cameras/<id>/maintenance
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  dbGetQuery(
    con,
    "SELECT * FROM camera_maintenance WHERE camera_id = ?
       ORDER BY event_date DESC",
    params = list(id)
  )
}

#* Add a maintenance event.
#* @post /predator_cameras/<id>/maintenance
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  body <- gui_body(req)
  observer <- req$observer_id
  key <- idem_key(req)

  parent <-
    dbGetQuery(
      con,
      "SELECT 1 FROM predator_camera WHERE camera_id = ?",
      params = list(id)
    )
  if (nrow(parent) == 0) {
    return(err(res, 404, "camera not found"))
  }

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(con, key, "camera_maintenance", NA)) {
      result <<- list(replayed = TRUE)
      return(invisible(NULL))
    }
    dbExecute(
      con,
      "INSERT INTO camera_maintenance
         (camera_id, event_date, install, replace_sd, replace_batteries, notes)
       VALUES (?,?,?,?,?,?)",
      params = list(
        id,
        body$event_date %||% NA,
        as.integer(body$install %||% 0),
        as.integer(body$replace_sd %||% 0),
        as.integer(body$replace_batteries %||% 0),
        body$notes %||% NA
      )
    )
    mid <- dbGetQuery(con, "SELECT last_insert_rowid() AS id")$id
    ev <- log_change(con, "camera_maintenance", mid, "insert", observer)
    if (!is.null(key) && nzchar(key)) {
      dbExecute(
        con,
        "UPDATE write_log SET entity_id = ? WHERE idempotency_key = ?",
        params = list(mid, key)
      )
    }
    result <<-
      gui_row(
        dbGetQuery(
          con,
          "SELECT * FROM camera_maintenance WHERE maintenance_id = ?",
          params = list(mid)
        )[1, ]
      )
  })
  res$status <- 201
  result
}

#* Edit a maintenance event.
#* @patch /camera_maintenance/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  out <-
    gui_patch_row(
      req,
      "camera_maintenance",
      "camera_maintenance",
      "maintenance_id",
      as.integer(id),
      c("event_date", "install", "replace_sd", "replace_batteries", "notes")
    )
  if (is.null(out)) return(err(res, 404, "maintenance event not found"))
  out
}

#* Delete a maintenance event.
#* @delete /camera_maintenance/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  out <-
    gui_delete_row(
      req,
      "camera_maintenance",
      "camera_maintenance",
      "maintenance_id",
      as.integer(id)
    )
  if (is.null(out)) return(err(res, 404, "maintenance event not found"))
  out
}

# --- schedule days (row-level CRUD for the GUI's week view) -----------------

# These routes give the GUI the (date, patch_order) grain it edits. The GET
# reads v_schedule -- same live check_nests / predator_cameras / weather the
# field app sees via GET /schedule -- while the id and editable base columns
# pass through, so PATCH/POST/DELETE still act on schedule_day.

#* Schedule rows. Filters: ?from, ?to (date), ?week.
#* @get /schedule_days
#* @serializer unboxedJSON list(digits = 9)
function(
  req,
  res,
  from = "",
  to = "",
  week = ""
) {
  w <-
    gui_where(
      list(
        "date >= ?" = from,
        "date <= ?" = to,
        "week = ?" = week
      )
    )
  db_read(
    con,
    str_c(
      "SELECT * FROM v_schedule",
      w$sql,
      " ORDER BY date, patch_order"
    ),
    w$params
  )
}

gui_schedule_editable <-
  c(
    "week", "date", "day", "helper", "arrive", "sunrise", "patch_order",
    "patch_count", "boards", "search_patch_1", "search_patch_2",
    "search_patch_3", "search_patch_4", "field", "notes",
    "helper_patch_1", "tns_patch_1", "helper_patch_2", "tns_patch_2",
    "helper_patch_3", "tns_patch_3", "helper_patch_4", "tns_patch_4",
    "check_nests", "predator_cameras", "departure_time",
    "scbi_departure_time", "point_count_time", "weather"
  )

#* Create one schedule row. Body: any schedule_day columns; date is required.
#* day and week are derived from date when absent.
#* @post /schedule_days
#* @serializer unboxedJSON list(digits = 9)
function(req, res) {
  body <- gui_body(req)
  observer <- req$observer_id
  key <- idem_key(req)

  if (is.null(body$date) || !nzchar(body$date)) {
    return(err(res, 400, "date (YYYY-MM-DD) is required"))
  }

  # Derive the weekday label; inherit week from any sibling row of that week's
  # dates already present (the sampling-week numbering lives in the loader).

  d <- as.Date(body$date)
  if (is.null(body$day) || !nzchar(body$day %||% "")) {
    body$day <- format(d, "%a")
  }

  fields <- intersect(names(body), gui_schedule_editable)

  result <- NULL
  with_txn(con, function() {
    if (!record_idempotency(con, key, "schedule_day", NA)) {
      result <<- list(replayed = TRUE)
      return(invisible(NULL))
    }
    cols_sql <- str_flatten(fields, collapse = ", ")
    ph <- str_flatten(rep("?", length(fields)), collapse = ",")
    dbExecute(
      con,
      str_c(
        "INSERT INTO schedule_day (", cols_sql, ") VALUES (", ph, ")"
      ),
      params = lapply(fields, function(.f) body[[.f]] %||% NA)
    )
    sid <- dbGetQuery(con, "SELECT last_insert_rowid() AS id")$id
    ev <- log_change(con, "schedule_day", sid, "insert", observer)
    if (!is.null(key) && nzchar(key)) {
      dbExecute(
        con,
        "UPDATE write_log SET entity_id = ? WHERE idempotency_key = ?",
        params = list(sid, key)
      )
    }
    result <<-
      gui_row(
        dbGetQuery(
          con,
          "SELECT * FROM schedule_day WHERE schedule_day_id = ?",
          params = list(sid)
        )[1, ]
      )
  })
  res$status <- 201
  result
}

#* Edit one schedule row (the GUI fans a day-level edit across its rows).
#* @patch /schedule_days/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  out <-
    gui_patch_row(
      req,
      "schedule_day",
      "schedule_day",
      "schedule_day_id",
      as.integer(id),
      gui_schedule_editable
    )
  if (is.null(out)) return(err(res, 404, "schedule row not found"))
  out
}

#* Delete one schedule row.
#* @delete /schedule_days/<id>
#* @serializer unboxedJSON list(digits = 9)
function(req, res, id) {
  out <-
    gui_delete_row(
      req,
      "schedule_day",
      "schedule_day",
      "schedule_day_id",
      as.integer(id)
    )
  if (is.null(out)) return(err(res, 404, "schedule row not found"))
  out
}
