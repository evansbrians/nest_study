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
# - scripts/spatial/convert_gpx_geojson.R (because you need to plug in your garmin)
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

# download and pre-process field data -------------------------------------

source("scripts/utils/updater.R")

# render the schedule app + printable schedule ----------------------------

quarto::quarto_render("outputs/schedule/index.qmd")

tryCatch(
  quarto::quarto_render("outputs/print-outs/schedule_pdf.qmd"),
  error = function(e) {
    message("Skipping the printable schedule PDF: ", conditionMessage(e))
  }
)

# update the Google Earth file --------------------------------------------

source("scripts/spatial/update_google_earth.R")

# render the phone / web field map ----------------------------------------

quarto::quarto_render("outputs/nest_app/field_map.qmd")

# Re-externalize the data files so the served shell stays small and the daily
# diff is just field_data.js:

source("scripts/utils/externalize_field_data.R")
externalize_field_data()

# update the printable PNG maps -------------------------------------------

source("scripts/spatial/update_map_print-outs.R")
