
# setup -------------------------------------------------------------------

library(glue)
library(here)
library(sf)
library(httr)
library(DBI)
library(RSQLite)
library(tidyverse)

source("scripts/utils/functions/time_and_date_functions.R")
source("scripts/utils/functions/utility_functions.R")
source("scripts/utils/functions/db_functions.R")
source("scripts/utils/functions/scheduling_functions.R")

# refresh the local analysis DB from the VM -------------------------------

# Replace the local DB with a fresh snapshot of the API data:

message("Refreshing local DB from the VM...")

db_refreshed <-
  system2("bash", "scripts/utils/refresh_local_db.sh") == 0

# A failed refresh is FATAL, not a warning:

if (!db_refreshed) {
  stop(
    "refresh_local_db.sh failed, so the local DB is stale.\n",
    "  The nests, spatial files, and printable schedule below all derive from\n",
    "  it, so this run would build them from old data.\n",
    "  Fix the refresh and re-run. If the key is the problem, set NEST_SSH_KEY.",
    call. = FALSE
  )
}

# database-entered field data ---------------------------------------------

# Connect to the db:

con <- connect_nest_db(here::here("data", "nest_study.sqlite"))

## gps points -------------------------------------------------------------

# Rebuild data/spatial/<class>_locations.geojson from the gps_point table:

write_spatial_from_db(con)

dbDisconnect(con)

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

# Clear the rest from the global environment, keeping autopush_updates():

ls() %>%
  keep(
    ~ !str_detect(.x, "autopush")
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
