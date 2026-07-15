#!/usr/bin/env Rscript

# nightly_load.R ------------------------------------------------------------
# Batch-loads the Google-Sheets-derived tables that do NOT flow through the
# realtime API -- point counts (point_count + interval) and visits -- from the
# processed field_data.rds into the DB. Coverboards are pending a schema
# decision (photo_id / notes on coverboard_obs); see the TODO at the end.
#
# Strategy: truncate-and-reload. These tables are fully re-derived from the
# sheets each night, so we replace them wholesale inside one transaction. Any
# patches / observers they reference are upserted first so the FKs hold.
#
# Usage:
#   Rscript nightly_load.R [db_path] [--repo <repo_root>]
#     db_path   default: $NEST_DB_PATH or ./nest_study.sqlite
#     --repo    R-project root holding data/field_data.rds (default: three
#               levels up from this script)

suppressPackageStartupMessages({
  library(DBI)
  library(RSQLite)
  library(dplyr)
  library(tidyr)
  library(purrr)
  library(stringr)
  library(readr)
  library(lubridate)
})

# ---------------------------------------------------------------------------
# 0. Args + paths
# ---------------------------------------------------------------------------

args <- commandArgs(trailingOnly = TRUE)

repo_root <- NULL
repo_idx <- which(args == "--repo")
if (length(repo_idx) == 1 && length(args) >= repo_idx + 1) {
  repo_root <- args[[repo_idx + 1]]
  args <- args[-c(repo_idx, repo_idx + 1)]
}

db_path <-
  if (length(args) >= 1) {
    args[[1]]
  } else {
    Sys.getenv("NEST_DB_PATH", unset = "nest_study.sqlite")
  }

script_dir <-
  commandArgs(FALSE) %>%
  str_subset("^--file=") %>%
  str_remove("^--file=") %>%
  dirname()
if (length(script_dir) == 0) {
  script_dir <- "."
}

if (is.null(repo_root)) {
  # server/ -> migrate_to_db/ -> brian_sandbox/ -> repo root

  repo_root <-
    normalizePath(
      file.path(
        script_dir,
        "..",
        "..",
        ".."
      ),
      mustWork = FALSE
    )
}

field_data_path <- file.path(repo_root, "data", "field_data.rds")

if (!file.exists(db_path)) {
  stop(
    "db not found: ",
    db_path,
    " (run server/init_db.R first)",
    call. = FALSE
  )
}
if (!file.exists(field_data_path)) {
  stop(
    "field_data.rds not found: ",
    field_data_path,
    call. = FALSE
  )
}

message("nightly_load: db   = ", db_path)
message("nightly_load: repo = ", repo_root)

field_data <- read_rds(field_data_path)

# ---------------------------------------------------------------------------
# 1. Small helpers
# ---------------------------------------------------------------------------

# YYYY-MM-DD from a Date / datetime / string column.

as_date_str <-
  function(.x) {
    if (inherits(.x, c("Date", "POSIXct"))) {
      return(format(as_date(.x), "%Y-%m-%d"))
    }
    str_sub(
      as.character(.x),
      1,
      10
    )
  }

# HH:MM from a time-ish column.

as_time_str <-
  function(.x) {
    if (inherits(.x, "POSIXct")) {
      return(format(.x, "%H:%M"))
    }
    str_extract(as.character(.x), "[0-2]?[0-9]:[0-5][0-9]")
  }

# First interval's value (observer is constant per visit; weather varies in a
# few visits, and the event-level column keeps interval 1's value).

first_chr <-
  function(.df, .col) {
    if (is.null(.df) || nrow(.df) == 0) {
      return(NA_character_)
    }
    as.character(.df[[.col]][1])
  }

# ---------------------------------------------------------------------------
# 2. Reshape point counts -> point_count (event) + count_interval (obs)
# ---------------------------------------------------------------------------

# One point_count event per row that actually carries interval data. The
# surrogate id is assigned before filtering so it stays stable across the two
# derived frames.

pc_base <-
  field_data$point_counts %>%
  mutate(point_count_id = row_number()) %>%
  filter(
    map_lgl(interval_data, ~ !is.null(.x) && nrow(.x) > 0)
  )

pc_events <-
  pc_base %>%
  mutate(
    observer_id = map_chr(interval_data, ~ first_chr(.x, "observer")),
    weather = map_chr(interval_data, ~ first_chr(.x, "weather"))
  ) %>%
  transmute(
    point_count_id,
    observer_id,
    patch_id = as.character(patch_id),
    count_date = as_date_str(date),
    weather,
    start_time = as_time_str(start_time)
  )

pc_obs <-
  pc_base %>%
  select(point_count_id, interval_data) %>%
  unnest(interval_data) %>%
  select(point_count_id, interval, count_data) %>%
  unnest(count_data) %>%
  transmute(
    point_count_id,
    interval = as.integer(interval),
    species = as.character(species),
    distance = as.character(distance),
    detection = as.character(detection),
    count = as.integer(replace_na(count, 0))
  )

# ---------------------------------------------------------------------------
# 3. Reshape visits -> visit
# ---------------------------------------------------------------------------

visit_rows <-
  field_data$visits %>%
  select(date, helper, patch_level) %>%
  unnest(patch_level) %>%
  unnest(activities) %>%
  transmute(
    visit_date = as_date_str(date),
    patch_id = as.character(patch),
    helper = as.character(helper),
    activity = as.character(activity),
    status = as.character(status),
    notes = as.character(notes)
  )

# ---------------------------------------------------------------------------
# 4. Reshape coverboards -> coverboard_check (board) + coverboard_obs (species)
# ---------------------------------------------------------------------------

# One coverboard_check per board per visit; the surrogate id is assigned on the
# unnested board rows so it stays stable across the two derived frames.

cb_base <-
  field_data$coverboards %>%
  select(patch_id, date, board_data) %>%
  unnest(board_data) %>%
  mutate(coverboard_check_id = row_number())

cb_checks <-
  cb_base %>%
  transmute(
    coverboard_check_id,
    patch_id = as.character(patch_id),
    board_num = as.integer(board_num),
    check_date = as_date_str(date),
    check_time = as_time_str(time),
    observer_id = as.character(observer),
    notes = NA_character_
  )

cb_obs <-
  cb_base %>%
  select(coverboard_check_id, count_data) %>%
  unnest(count_data) %>%
  transmute(
    coverboard_check_id,
    species = as.character(species),
    count = as.integer(replace_na(num_observed, 0)),
    photo_id = as.character(photo_id),
    notes = as.character(notes)
  )

# ---------------------------------------------------------------------------
# 5. Load into the DB (truncate + reload, one transaction)
# ---------------------------------------------------------------------------

con <- dbConnect(RSQLite::SQLite(), db_path)
on.exit(dbDisconnect(con), add = TRUE)
invisible(dbExecute(con, "PRAGMA foreign_keys = ON;"))

# Patches / observers referenced by these tables must exist (FK). Upsert any
# new ones; rows already present (e.g. from the nest migration) are untouched.

ensure_patches <-
  c(pc_events$patch_id, visit_rows$patch_id, cb_checks$patch_id) %>%
  discard(is.na) %>%
  unique()

ensure_observers <-
  c(pc_events$observer_id, cb_checks$observer_id) %>%
  discard(is.na) %>%
  unique()

invisible(dbWithTransaction(con, {

  # Children first, then parents.

  dbExecute(con, "DELETE FROM count_interval")
  dbExecute(con, "DELETE FROM point_count")
  dbExecute(con, "DELETE FROM coverboard_obs")
  dbExecute(con, "DELETE FROM coverboard_check")
  dbExecute(con, "DELETE FROM visit")

  walk(
    ensure_patches,
    ~ dbExecute(
      con,
      "INSERT OR IGNORE INTO patch (patch_id, label) VALUES (?, ?)",
      params = list(.x, .x)
    )
  )
  walk(
    ensure_observers,
    ~ dbExecute(
      con,
      "INSERT OR IGNORE INTO observer (observer_id) VALUES (?)",
      params = list(.x)
    )
  )

  dbAppendTable(con, "point_count", pc_events)
  dbAppendTable(con, "count_interval", pc_obs)
  dbAppendTable(con, "coverboard_check", cb_checks)
  dbAppendTable(con, "coverboard_obs", cb_obs)
  dbAppendTable(con, "visit", visit_rows)
}))

# ---------------------------------------------------------------------------
# 6. Report
# ---------------------------------------------------------------------------

message("nightly_load: point_count      = ", nrow(pc_events))
message("nightly_load: count_interval   = ", nrow(pc_obs))
message("nightly_load: coverboard_check = ", nrow(cb_checks))
message("nightly_load: coverboard_obs   = ", nrow(cb_obs))
message("nightly_load: visit            = ", nrow(visit_rows))
message("nightly_load: done.")
