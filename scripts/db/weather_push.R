#!/usr/bin/env Rscript

# weather_push.R ------------------------------------------------------------
# Fetch the NWS forecast and push per-date weather JSON to the API's `weather`
# table. This is the ONLY recurring schedule job left: check_nests and
# predator_cameras are now live DB views (server/v_schedule.sql), and weather is
# the one schedule input that cannot be derived from the DB.
#
# It needs no DB pull and no SSH key -- it fetches the public NWS API and POSTs
# to the public app API with the token -- so it runs anywhere with internet,
# e.g. the daily GitHub Action, without the credentials the old updater needed.
#
#   Rscript scripts/db/weather_push.R

suppressPackageStartupMessages({
  library(tidyverse)
  library(httr)
})

source("scripts/utils/functions/time_and_date_functions.R")
source("scripts/utils/functions/weather_functions.R")
source("scripts/db/schedule_weather.R")   # weather_json()

api_url <- "https://snednestudy.duckdns.org"
api_token <- "a5d11ba12d29bdb83b0a5e4806fe111dbb740d6001499c2cdc171440cb05f357"

# 1. Refresh the forecast from the NWS API (writes data/weather.rds).

read_rds("data/weather.rds") %>%
  update_weather(
    .coords_yx = get_nws_coords("data/spatial/patches.geojson"),
    .outpath = "data/weather.rds"
  )

# 2. Shape it into one JSON object per date -- the exact shape the schedule
#    screen renders: { detailed, summary, hourly:[{time,forecast,temp,rain}] }.

weather_rows <-
  read_rds("data/weather.rds") %>%
  weather_json()

if (is.null(weather_rows) || nrow(weather_rows) == 0) {
  message("weather_push: nothing to push.")
  quit(status = 0)
}

# 3. POST to the weather table; the server upserts by date.

resp <-
  POST(
    str_c(api_url, "/weather"),
    add_headers(Authorization = str_c("Bearer ", api_token)),
    body = list(rows = weather_rows),
    encode = "json"
  )

if (status_code(resp) >= 300) {
  stop(
    "weather_push: POST /weather failed (HTTP ", status_code(resp), "): ",
    content(resp, "text", encoding = "UTF-8"),
    call. = FALSE
  )
}

message("weather_push: pushed ", nrow(weather_rows), " day(s) of weather.")
