
# setup -------------------------------------------------------------------

library(glue)
library(here)
library(googlesheets4)
library(sf)
library(httr)
library(DBI)
library(RSQLite)
library(tidyverse)

source("scripts/utils/functions/time_and_date_functions.R")
source("scripts/utils/functions/utility_functions.R")
source("scripts/utils/functions/db_functions.R")
source("scripts/utils/functions/scheduling_functions.R")
source("scripts/utils/functions/weather_functions.R")

# The URL and API token used by the schedule push and DB pull:

api_url <- "https://snednestudy.duckdns.org"
api_token <- "a5d11ba12d29bdb83b0a5e4806fe111dbb740d6001499c2cdc171440cb05f357"

# The sheets that are still hand-entered:

urls <-
  c(
    coverboards = "1XkozYdl1UfBVF9lMcP9ZjmTHflzF3q7l-NU6t2U11o4",
    point_counts = "10ZsdRqT-oS_C92CpD-RA79QO52DFSHKbT1mwxUZsEIo",
    visits = "1Pd4OYDbRkV3DMDlZU1kFfW2ci2izmtpq8eXY7MvYENY",
    predator_cameras = "1exlfw40PfefcOLRxf7WUyCi9TOJ3yydKbAXcJNmABfc"
  ) %>%
  map(
    ~ file.path(
      "https://docs.google.com/spreadsheets/d",
      .x
    )
  )

# sheet-entered field data ------------------------------------------------

## coverboards ------------------------------------------------------------

coverboards <-
  
  # Read data:
  
  read_sheet(
    urls$coverboards
  ) %>%
  
  # Process data:
  
  mutate(
    date = as_date(date)
  ) %>%
  select(
    patch_id,
    date,
    observer = observer_initials,
    board_num,
    time:notes
  ) %>%
  nest(count_data = species:notes) %>%
  nest(board_data = observer:count_data)

## point counts -----------------------------------------------------------

point_counts <-
  
  # Read data:
  
  read_sheet(
    urls$point_counts,
    col_types = "c"
  ) %>%
  mutate(
    across(
      `< 25 m`:`> 100 m`,
      ~ as.numeric(.x)
    )
  ) %>%
  
  # Process data:
  
  pivot_longer(
    `< 25 m`:`> 100 m`,
    names_to = "distance",
    values_to = "count"
  ) %>%
  mutate(
    count = replace_na(count, 0)
  ) %>%
  select(
    patch_id:date,
    start_time,
    interval,
    weather,
    observer,
    species:count
  ) %>%
  nest(count_data = species:count) %>%
  nest(interval_data = interval:count_data)

## visits -----------------------------------------------------------------

visits <-
  
  # Read data:
  
  read_sheet(
    urls$visits
  ) %>%
  filter(
    !if_all(
      date:helper,
      ~ is.na(.x)
    )
  ) %>%
  mutate(
    date = as_date(date)
  ) %>%
  
  # Process data:
  
  pivot_longer(
    point_count:patch_maintenance,
    names_to = "activity",
    values_to = "status"
  ) %>%
  select(
    date,
    helper,
    patch,
    notes,
    activity:status
  ) %>%
  nest(activities = activity:status) %>%
  nest(patch_level = patch:activities)

## camera maintenance -----------------------------------------------------

predator_cameras <-
  
  # Read data:
  
  urls$predator_cameras %>%
  read_sheet() %>%
  mutate(
    date = as_date(date)
  ) %>%
  
  # Process data:
  
  nest(maintenance_activities = date:notes)

# weather forecast --------------------------------------------------------

# Refresh the forecast before the schedule push below, which reads it back in:

read_rds("data/weather.rds") %>%
  update_weather(
    .coords_yx = get_nws_coords("data/spatial/patches.geojson"),
    .outpath = "data/weather.rds"
  )

# sheet field data -> file ------------------------------------------------

# Write the sheet-derived tables first:

field_data <-
  lst(
    point_counts,
    coverboards,
    visits,
    predator_cameras
  )

write_rds(field_data, "data/field_data.rds")

# refresh the local analysis DB from the VM -------------------------------

# Replace the local DB with a fresh snapshot of the VM's live app data (nests,
# gps points, intervals, photos, tracks, schedule), then re-layer the sheet
# batch tables (point counts / visits) from the field_data.rds just written.

message("Refreshing local DB from the VM...")

db_refreshed <-
  system2("bash", "scripts/utils/refresh_local_db.sh") == 0

if (db_refreshed) {
  system2(
    "Rscript",
    c(
      "scripts/db/nightly_load.R",
      "nest_study.sqlite"
    )
  )
} else {
  warning(
    "refresh_local_db.sh failed -- local DB left unchanged; using its prior state."
  )
}

# database-entered field data ---------------------------------------------

# Now that the DB holds the latest app-entered data, pull the nests (in the
# field_data `nests` shape) and re-derive the spatial point files from
# gps_point. This replaces the old Google-Sheet nest read and the Google Drive
# waypoint ingest.

con <- connect_nest_db("nest_study.sqlite")

## nests ------------------------------------------------------------------

nests <- get_db_nests(con)

# Fold the nests into field_data and re-write it, so the field map app and the
# schedule (via get_current_nests) read database-sourced nests:

field_data$nests <- nests

write_rds(field_data, "data/field_data.rds")

## gps points -------------------------------------------------------------

# Rebuild data/spatial/<class>_locations.geojson from the gps_point table:

write_spatial_from_db(con)

dbDisconnect(con)

# push the schedule to the web API ----------------------------------------

message("Pushing schedule to the web API...")

schedule_push_status <-
  system2(
    "Rscript",
    c(
      "scripts/db/schedule_load.R",
      "--api", api_url,
      "--token", api_token
    )
  )

if (schedule_push_status != 0) {
  warning(
    "schedule_load.R failed, the app is stuck on the previous schedule."
  )
}

# render the printable PDF schedule ---------------------------------------

# The daily printable schedule (outputs/print-outs/schedule_pdf.pdf), built from
# the current-nests and schedule data written above.

tryCatch(
  quarto::quarto_render("outputs/print-outs/schedule_pdf.qmd"),
  error = function(e) {
    message(
      "Skipping the printable schedule PDF: ", 
      conditionMessage(e)
    )
  }
)

# Let's hold onto field data and clear the rest from the global environment:

ls() %>%
  keep(
    ~ !str_detect(.x, "field_data|autopush")
  ) %>%
  walk(
    ~ rm(
      list = .x,
      envir = .GlobalEnv
    )
  )

# update GE and map printouts ---------------------------------------------

# Google Earth:

source("scripts/spatial/update_google_earth.R")

# PNG maps (printed maps):

source("scripts/spatial/update_map_print-outs.R")

# Add, commit, and push to github:

# autopush_updates()
