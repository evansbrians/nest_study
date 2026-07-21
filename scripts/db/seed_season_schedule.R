#!/usr/bin/env Rscript

# seed_season_schedule.R ----------------------------------------------------
# One-time: seed the whole season's BACKBONE schedule rows from
# season_schedule.rds into schedule_day, so v_schedule has every week to
# decorate and no recurring schedule push is ever needed again. After this,
# Tara edits the GUI-owned weekly columns and the views derive the rest
# (check_nests, predator_cameras) live; weather_push.R fills weather.
#
# Backbone only: get_modify_schedule() emits date/day/patch_order/patch_count/
# boards/arrive/sunrise plus blank GUI-owned defaults. It does NOT compute
# check_nests / predator_cameras / weather -- those are the view's job now.
#
# Safe to re-run and safe on weeks that already exist: POST /schedule upserts on
# (date, patch_order). A brand-new (future) week is inserted in full; an existing
# week keeps every GUI-entered value (the upsert only rewrites the derived
# columns, which v_schedule ignores anyway). RUN THIS AFTER deploying v_schedule
# + the GET /schedule repoint, so those now-vestigial columns don't matter.
#
#   Rscript scripts/db/seed_season_schedule.R

suppressPackageStartupMessages({
  library(tidyverse)
  library(httr)
})

source("scripts/utils/functions/time_and_date_functions.R")
source("scripts/utils/functions/utility_functions.R")
source("scripts/utils/functions/scheduling_functions.R")

api_url <- "https://snednestudy.duckdns.org"
api_token <- "a5d11ba12d29bdb83b0a5e4806fe111dbb740d6001499c2cdc171440cb05f357"

season <- read_rds(here::here("data/season_schedule.rds"))
weeks <- sort(unique(season$week))

message("Seeding ", length(weeks), " week(s) of backbone schedule...")

post_week <- function(.week) {
  rows <-
    get_modify_schedule(.week = .week) %>%
    mutate(
      week = as.integer(get_sampling_week(as_date(date))),
      date = format(as_date(date), "%Y-%m-%d")
    )

  resp <-
    POST(
      str_c(api_url, "/schedule"),
      add_headers(Authorization = str_c("Bearer ", api_token)),
      body = list(rows = rows),
      encode = "json"
    )

  status <- status_code(resp)
  parsed <- tryCatch(content(resp), error = function(.e) NULL)

  message(
    "  week ", .week, ": HTTP ", status,
    if (!is.null(parsed$inserted)) {
      str_c(" (inserted ", parsed$inserted, ", updated ", parsed$updated, ")")
    } else {
      ""
    }
  )

  if (status >= 300) {
    stop("seed: POST /schedule failed for week ", .week, call. = FALSE)
  }
}

walk(weeks, post_week)

message("Season backbone seeded. v_schedule now has every week to decorate.")
