#!/usr/bin/env Rscript

# schedule_load.R ----------------------------------------------------------
# WORKSTATION job. Reads Tara's Google Sheet via prep_schedule_data() (the creds
# live here, not on the VM), builds one schedule_day row per date/patch_order
# with a per-day `weather` JSON, and pushes it to the API, which truncate-
# reloads schedule_day.
#
# Pushes the current week PLUS the next --weeks weeks (default 3) so the app
# advances to the new week on its own each Monday, with no timed weekly push.
#
# Paths are relative to the nest_study project root, which is always the
# working directory (RStudio project / Rscript run from the root).
#
#   Rscript scripts/db/schedule_load.R --api <url> [--token <tok>]
#                                      [--weeks <n>] [--dry-run]

suppressPackageStartupMessages({
  library(tidyverse)
})

# options ------------------------------------------------------------------

args <- commandArgs(trailingOnly = TRUE)

flag_value <-
  function(.flag, .default = NULL) {
    at <- match(.flag, args)

    if (is.na(at) || at >= length(args)) {
      .default
    } else {
      nth(args, at + 1L)
    }
  }

default_token <-
  Sys.getenv(
    "NEST_API_TOKEN",
    unset = ""
  )

api_url <- flag_value("--api")
api_token <- flag_value("--token", default_token)
dry_run <- "--dry-run" %in% args

# Weeks BEYOND the current one to also push, so the app (which selects the week
# containing today) rolls over on its own each Monday.

weeks_raw <- flag_value("--weeks", "3")

weeks_ahead <-
  suppressWarnings(
    as.integer(weeks_raw)
  )

weeks_ahead <-
  if (is.na(weeks_ahead) || weeks_ahead < 0) 3L else weeks_ahead

functions_dir <- "scripts/utils/functions"

walk(
  c(
    "time_and_date_functions.R",
    "utility_functions.R",
    "scheduling_functions.R"
  ),
  ~ source(
      file.path(functions_dir, .x)
    )
)

source("scripts/db/schedule_weather.R")

# build the serving rows, then attach weather ------------------------------

serving_cols <-
  c(
    "week",
    "date",
    "day",
    "helper",
    "arrive",
    "sunrise",
    "patch_order",
    "patch_count",
    "boards",
    "search_patch_1",
    "search_patch_2",
    "field",
    "notes",
    "helper_patch_1",
    "tns_patch_1",
    "helper_patch_2",
    "tns_patch_2",
    "check_nests",
    "predator_cameras",
    "departure_time",
    "scbi_departure_time",
    "point_count_time"
  )

id_cols <-
  c(
    "week",
    "date",
    "patch_order"
  )

character_cols <-
  setdiff(serving_cols, id_cols)

# Each target date anchors one Monday-based week. A week that cannot be built
# yet (e.g. beyond the season) is skipped, never blocking the current week.
# .mark_tall_nests stays FALSE -- the app adds the giraffe client-side.

build_week <-
  function(.target_date) {
    tryCatch(
      prep_schedule_data(
        .target_date = .target_date,
        .mark_tall_nests = FALSE
      ),
      error = function(.e) {
        message(
          "schedule_load: week of ",
          .target_date,
          " skipped (",
          conditionMessage(.e),
          ")"
        )
        NULL
      }
    )
  }

target_dates <- today() + (0:weeks_ahead) * 7

schedule_rows <-
  target_dates %>%
  map(build_week) %>%
  compact() %>%
  list_rbind() %>%
  mutate(
    week = as.integer(
      get_sampling_week(
        as_date(date)
      )
    ),
    date = format(
      as_date(date),
      "%Y-%m-%d"
    ),
    patch_order = as.integer(patch_order),
    across(
      all_of(character_cols),
      as.character
    )
  ) %>%
  distinct(
    date,
    patch_order,
    .keep_all = TRUE
  ) %>%
  select(
    all_of(serving_cols)
  ) %>%
  arrange(date, patch_order)

# weather_json() always returns a data frame (empty if there is no weather), so
# the join always yields a `weather` column -- NA where a day has none.

weather_by_date <-
  "data/weather.rds" %>%
  read_rds() %>%
  weather_json()

schedule_rows <-
  left_join(
    schedule_rows,
    weather_by_date,
    by = "date"
  )

# verification summary (eyeball before it lands) ---------------------------

has_value <-
  function(.x) {
    trimmed <-
      .x %>%
      as.character() %>%
      replace_na("") %>%
      str_trim()

    trimmed != "" & trimmed != "-"
  }

show_val <-
  function(.x) {
    trimmed <-
      .x %>%
      as.character() %>%
      str_trim()

    if_else(
      has_value(.x),
      trimmed,
      "-"
    )
  }

show_ok <-
  function(.x) {
    if_else(
      has_value(.x),
      "ok",
      "MISSING"
    )
  }

# "<patch> [tns:ok help:MISSING]" for one of the day's two search patches.

patch_summary <-
  function(
    .patch,
    .tns,
    .helper
  ) {
    str_c(
      show_val(.patch),
      " [tns:",
      show_ok(.tns),
      " help:",
      show_ok(.helper),
      "]"
    )
  }

day_lines <-
  schedule_rows %>%
  distinct(
    date,
    field,
    search_patch_1,
    search_patch_2,
    tns_patch_1,
    tns_patch_2,
    helper_patch_1,
    helper_patch_2
  ) %>%
  arrange(date) %>%
  mutate(
    line = str_c(
      "  ",
      date,
      " field=",
      show_val(field),
      " | p1=",
      patch_summary(
        search_patch_1,
        tns_patch_1,
        helper_patch_1
      ),
      " | p2=",
      patch_summary(
        search_patch_2,
        tns_patch_2,
        helper_patch_2
      )
    )
  )

message(
  "schedule_load: ",
  nrow(day_lines),
  " day(s) built:"
)
walk(day_lines$line, message)

days_with_weather <-
  schedule_rows %>%
  filter(
    has_value(weather)
  ) %>%
  distinct(date) %>%
  nrow()

total_days <- n_distinct(schedule_rows$date)

message(
  "schedule_load: weather present for ",
  days_with_weather,
  "/",
  total_days,
  " day(s)"
)

if (dry_run) {
  message(
    "schedule_load: --dry-run set; nothing written (",
    nrow(schedule_rows),
    " rows)."
  )
  quit(
    save = "no",
    status = 0
  )
}

# push to the api (workstation -> vm) --------------------------------------

if (is.null(api_url)) {
  stop(
    "--api <url> is required (or use --dry-run to build without pushing)",
    call. = FALSE
  )
}

if (!nzchar(api_token)) {
  stop(
    "API push requires --token <tok> or $NEST_API_TOKEN",
    call. = FALSE
  )
}

endpoint <-
  api_url %>%
  str_remove("/+$") %>%
  str_c("/schedule")

auth_header <-
  httr::add_headers(
    Authorization = str_c("Bearer ", api_token)
  )

payload <-
  jsonlite::toJSON(
    list(rows = schedule_rows),
    auto_unbox = TRUE,
    na = "null",
    digits = NA
  )

resp <-
  httr::POST(
    endpoint,
    auth_header,
    httr::content_type_json(),
    body = payload,
    encode = "raw"
  )

body_txt <-
  httr::content(
    resp,
    as = "text",
    encoding = "UTF-8"
  )

status <- httr::status_code(resp)

if (!status %in% 200:299) {
  stop(
    "schedule_load: API push failed [",
    status,
    "]: ",
    body_txt,
    call. = FALSE
  )
}

message(
  "schedule_load: pushed ",
  nrow(schedule_rows),
  " rows -> ",
  endpoint,
  " | ",
  body_txt
)
