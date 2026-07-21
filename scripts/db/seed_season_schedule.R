#!/usr/bin/env Rscript

# seed_season_schedule.R ----------------------------------------------------

# One-time: seed the season's backbone schedule rows from season_schedule.rds so
# v_schedule has every week to decorate and no recurring push is needed. Safe to
# re-run -- POST /schedule upserts, preserving GUI edits on existing weeks.

suppressPackageStartupMessages({
  library(glue)
  library(httr)
  library(tidyverse)
})

source("scripts/utils/functions/time_and_date_functions.R")
source("scripts/utils/functions/utility_functions.R")
source("scripts/utils/functions/scheduling_functions.R")

api_url <- "https://snednestudy.duckdns.org"

api_token <- "a5d11ba12d29bdb83b0a5e4806fe111dbb740d6001499c2cdc171440cb05f357"

season <- read_rds(here::here("data/season_schedule.rds"))

weeks <- sort(unique(season$week))

# post each week's backbone -------------------------------------------------

post_week <-
  function(.week) {
    rows <-
      get_modify_schedule(.week = .week) %>%
      mutate(
        week = as.integer(get_sampling_week(as_date(date))),
        date = format(as_date(date), "%Y-%m-%d")
      )

    response <-
      POST(
        str_c(api_url, "/schedule"),
        add_headers(
          Authorization = str_c("Bearer ", api_token)
        ),
        body =
          list(rows = rows),
        encode = "json"
      )

    if (status_code(response) >= 300) {
      stop(
        "seed: POST /schedule failed for week ",
        .week,
        call. = FALSE
      )
    }

    parsed <- content(response)

    detail <-
      if (is.null(parsed$inserted)) {
        ""
      } else {
        glue(" (inserted {parsed$inserted}, updated {parsed$updated})")
      }

    message(
      glue("  week {.week}: HTTP {status_code(response)}{detail}")
    )
  }

message("Seeding ", length(weeks), " week(s) of backbone schedule...")

walk(weeks, post_week)

message("Season backbone seeded.")
