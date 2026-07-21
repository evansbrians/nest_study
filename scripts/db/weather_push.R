#!/usr/bin/env Rscript

# weather_push.R ------------------------------------------------------------

# Push per-date weather JSON to the API weather table -- the only recurring
# schedule job left, since check_nests and predator_cameras are now DB views. It
# needs no DB or SSH access (fetches NWS, POSTs the token), so it runs in CI.

suppressPackageStartupMessages({
  library(glue)
  library(sf)
  library(httr)
  library(tidyverse)
})

source("scripts/utils/functions/time_and_date_functions.R")
source("scripts/utils/functions/utility_functions.R")
source("scripts/utils/functions/weather_functions.R")
source("scripts/db/schedule_weather.R")

api_url <- "https://snednestudy.duckdns.org"

api_token <- "a5d11ba12d29bdb83b0a5e4806fe111dbb740d6001499c2cdc171440cb05f357"

# refresh the forecast ------------------------------------------------------

read_rds("data/weather.rds") %>%
  update_weather(
    .coords_yx = get_nws_coords("data/spatial/patches.geojson"),
    .outpath = "data/weather.rds"
  )

# build one JSON per date and push ------------------------------------------

weather_rows <-
  read_rds("data/weather.rds") %>%
  weather_json()

if (is.null(weather_rows) || nrow(weather_rows) == 0) {
  message("weather_push: nothing to push.")
  quit(status = 0)
}

response <-
  POST(
    str_c(api_url, "/weather"),
    add_headers(
      Authorization = str_c("Bearer ", api_token)
    ),
    body =
      list(rows = weather_rows),
    encode = "json"
  )

if (status_code(response) >= 300) {
  error_body <-
    content(
      response,
      as = "text",
      encoding = "UTF-8"
    )

  stop(
    "weather_push: POST /weather failed (HTTP ",
    status_code(response),
    "): ",
    error_body,
    call. = FALSE
  )
}

message(
  "weather_push: pushed ",
  nrow(weather_rows),
  " day(s) of weather."
)
