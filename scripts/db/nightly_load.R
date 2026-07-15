#!/usr/bin/env Rscript

# nightly_load.R -----------------------------------------------------------
# WORKSTATION job, run by scripts/utils/updater.R. Batch-loads the tables that
# do NOT flow through the realtime API -- point counts, coverboards and visits
# -- from the processed data/field_data.rds into the local DB.
#
# It lives here (not on the VM) because field_data.rds is built on a
# workstation from the Google Sheets; the VM has neither the file nor the creds.
#
# Strategy: truncate-and-reload. These tables are fully re-derived from the
# sheets each run, so they are replaced wholesale inside one transaction. The
# patches and observers they reference are upserted first so the FKs hold.
#
# Paths are relative to the nest_study project root, which is always the
# working directory (RStudio project / Rscript run from the root).
#
# Usage:
#   Rscript scripts/db/nightly_load.R [db_path]
#     db_path   default: $NEST_DB_PATH or ./nest_study.sqlite

suppressPackageStartupMessages({
  library(DBI)
  library(RSQLite)
  library(tidyverse)
})

# 0. args + paths ----------------------------------------------------------

args <- commandArgs(trailingOnly = TRUE)

default_db <-
  Sys.getenv(
    "NEST_DB_PATH",
    unset = "nest_study.sqlite"
  )

db_path <- first(args, default = default_db)

message("nightly_load: db = ", db_path)

field_data <- read_rds("data/field_data.rds")

# 1. small helpers ---------------------------------------------------------

date_classes <- c("Date", "POSIXct")

# YYYY-MM-DD from a Date / datetime / string column.

as_date_str <-
  function(.x) {
    if (inherits(.x, date_classes)) {
      .x %>%
        as_date() %>%
        format("%Y-%m-%d")
    } else {
      .x %>%
        as.character() %>%
        str_sub(1, 10)
    }
  }

# HH:MM from a time-ish column.

as_time_str <-
  function(.x) {
    if (inherits(.x, "POSIXct")) {
      format(.x, "%H:%M")
    } else {
      .x %>%
        as.character() %>%
        str_extract("[0-2]?[0-9]:[0-5][0-9]")
    }
  }

# The first interval's value: observer is constant per visit, and where weather
# varies the event-level column keeps interval 1's value. Only ever called on
# pc_base rows, which are already filtered to those with interval data.

first_chr <-
  function(.df, .col) {
    .df %>%
      pull(.col) %>%
      first() %>%
      as.character()
  }

has_rows <-
  function(.x) {
    !is.null(.x) && nrow(.x) > 0
  }

# 2. reshape point counts --------------------------------------------------

# One point_count event per row that carries interval data. The surrogate id is
# assigned BEFORE filtering so it stays stable across both derived frames.

pc_base <-
  field_data$point_counts %>%
  mutate(point_count_id = row_number()) %>%
  filter(
    map_lgl(interval_data, has_rows)
  )

pc_events <-
  pc_base %>%
  mutate(
    observer_id = map_chr(
      interval_data,
      ~ first_chr(.x, "observer")
    ),
    weather = map_chr(
      interval_data,
      ~ first_chr(.x, "weather")
    )
  ) %>%
  mutate(
    point_count_id = point_count_id,
    observer_id = observer_id,
    patch_id = as.character(patch_id),
    count_date = as_date_str(date),
    weather = weather,
    start_time = as_time_str(start_time),
    .keep = "none"
  )

pc_obs <-
  pc_base %>%
  select(point_count_id, interval_data) %>%
  unnest(interval_data) %>%
  select(
    point_count_id,
    interval,
    count_data
  ) %>%
  unnest(count_data) %>%
  mutate(
    point_count_id = point_count_id,
    interval = as.integer(interval),
    species = as.character(species),
    distance = as.character(distance),
    detection = as.character(detection),
    count = as.integer(
      replace_na(count, 0)
    ),
    .keep = "none"
  )

# 3. reshape visits --------------------------------------------------------

visit_rows <-
  field_data$visits %>%
  select(
    date,
    helper,
    patch_level
  ) %>%
  unnest(patch_level) %>%
  unnest(activities) %>%
  mutate(
    visit_date = as_date_str(date),
    patch_id = as.character(patch),
    helper = as.character(helper),
    activity = as.character(activity),
    status = as.character(status),
    notes = as.character(notes),
    .keep = "none"
  )

# 4. reshape coverboards ---------------------------------------------------

# One coverboard_check per board per visit. The surrogate id is assigned on the
# unnested board rows so it stays stable across both derived frames.

cb_base <-
  field_data$coverboards %>%
  select(
    patch_id,
    date,
    board_data
  ) %>%
  unnest(board_data) %>%
  mutate(coverboard_check_id = row_number())

cb_checks <-
  cb_base %>%
  mutate(
    coverboard_check_id = coverboard_check_id,
    patch_id = as.character(patch_id),
    board_num = as.integer(board_num),
    check_date = as_date_str(date),
    check_time = as_time_str(time),
    observer_id = as.character(observer),
    notes = NA_character_,
    .keep = "none"
  )

cb_obs <-
  cb_base %>%
  select(coverboard_check_id, count_data) %>%
  unnest(count_data) %>%
  mutate(
    coverboard_check_id = coverboard_check_id,
    species = as.character(species),
    count = as.integer(
      replace_na(num_observed, 0)
    ),
    photo_id = as.character(photo_id),
    notes = as.character(notes),
    .keep = "none"
  )

# 5. load into the db ------------------------------------------------------

con <-
  dbConnect(
    RSQLite::SQLite(),
    db_path
  )

on.exit(
  dbDisconnect(con),
  add = TRUE
)

invisible(
  dbExecute(con, "PRAGMA foreign_keys = ON;")
)

# Patches / observers these tables reference must exist (FK). Upsert the new
# ones; rows already present (e.g. from the nest migration) are untouched.

ensure_patches <-
  c(
    pc_events$patch_id,
    visit_rows$patch_id,
    cb_checks$patch_id
  ) %>%
  discard(is.na) %>%
  unique()

ensure_observers <-
  c(pc_events$observer_id, cb_checks$observer_id) %>%
  discard(is.na) %>%
  unique()

# Children before parents, so the FKs never dangle mid-transaction.

reload_order <-
  c(
    "count_interval",
    "point_count",
    "coverboard_obs",
    "coverboard_check",
    "visit"
  )

invisible(
  dbWithTransaction(con, {

    walk(
      reload_order,
      ~ dbExecute(
          con,
          str_c("DELETE FROM ", .x)
        )
    )

    # DBI binds parameter VECTORS, so each upsert is one call, not one per row.

    if (length(ensure_patches) > 0) {
      dbExecute(
        con,
        "INSERT OR IGNORE INTO patch (patch_id, label) VALUES (?, ?)",
        params = list(ensure_patches, ensure_patches)
      )
    }

    if (length(ensure_observers) > 0) {
      dbExecute(
        con,
        "INSERT OR IGNORE INTO observer (observer_id) VALUES (?)",
        params = list(ensure_observers)
      )
    }

    dbAppendTable(
      con,
      "point_count",
      pc_events
    )
    dbAppendTable(
      con,
      "count_interval",
      pc_obs
    )
    dbAppendTable(
      con,
      "coverboard_check",
      cb_checks
    )
    dbAppendTable(
      con,
      "coverboard_obs",
      cb_obs
    )
    dbAppendTable(
      con,
      "visit",
      visit_rows
    )
  })
)

# 6. report ----------------------------------------------------------------

loaded_counts <-
  tibble(
    table = reload_order,
    rows = c(
      nrow(pc_obs),
      nrow(pc_events),
      nrow(cb_obs),
      nrow(cb_checks),
      nrow(visit_rows)
    )
  ) %>%
  arrange(table)

report_line <-
  function(.table, .rows) {
    padded <-
      str_pad(
        .table,
        16,
        "right"
      )

    message(
      "nightly_load: ",
      padded,
      " = ",
      .rows
    )
  }

walk2(
  loaded_counts$table,
  loaded_counts$rows,
  report_line
)

message("nightly_load: done.")
