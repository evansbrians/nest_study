# Daily build for GitHub Actions
#
# Without our input, this will use GitHub Actions to automate many of the elements of
# scripts/dashboard.R that do not require inputs:

# - Rebuild the schedules
# - Render the schedule app (though you can still modify) 
# - Render the printable schedule (as above)
# - The Google Earth file
# - The field map apps
# - The printable PNG maps

# The workflow commits whatever this regenerates.
#
# *Not* included here:
# - scripts/convert_gpx_geojson.R (because you need to plug in your garmin)
# - Printing

# setup -------------------------------------------------------------------

library(glue)
library(here)
library(tidyverse)

# Authenticate to Google Sheets: This is modified from our original because
# I used a GitHub secret to store the key.

sa_key <- Sys.getenv("GOOGLE_SHEETS_KEY", "")

if (nzchar(sa_key)) {
  googlesheets4::gs4_auth(path = sa_key)
} else {
  googlesheets4::gs4_auth()
}

# Helper functions:

source("scripts/functions.R")

# download and pre-process field data -------------------------------------

source("scripts/google_data_processing.R")

# update the nest-checking file -------------------------------------------

source("scripts/get_nests_to_check.R")

# update the predator camera maintenance schedule -------------------------

source("scripts/camera_maintenance_schedule.R")

# render the schedule app + printable schedule ----------------------------

quarto::quarto_render("outputs/schedule/index.qmd")
quarto::quarto_render("outputs/print-outs/schedule_pdf.qmd")

# update the Google Earth file --------------------------------------------

source("scripts/update_google_earth.R")

# render the phone / web field map ----------------------------------------

quarto::quarto_render("scripts/nest_app/field_map.qmd")

# Publish the rendered map to both served locations.

file.path(
  "outputs",
  c("map_sandbox", "field_map"),
  "index.html"
) %>%
  file.copy(
    "scripts/nest_app/index.html",
    .,
    overwrite = TRUE
  )

# update the printable PNG maps -------------------------------------------

source("scripts/update_map_print-outs.R")
