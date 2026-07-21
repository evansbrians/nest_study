# Daily build for GitHub Actions
#
# Without our input, this will use GitHub Actions to automate many of the elements of
# scripts/dashboard.R that do not require inputs:

# - Rebuild the schedules
# - Render the printable schedule
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

# download and pre-process field data -------------------------------------

source("scripts/utils/updater.R")

# render the printable schedule -------------------------------------------

tryCatch(
  quarto::quarto_render("outputs/print-outs/schedule_pdf.qmd"),
  error = function(e) {
    message("Skipping the printable schedule PDF: ", conditionMessage(e))
  }
)

# update the Google Earth file --------------------------------------------

source("scripts/spatial/update_google_earth.R")

# update the printable PNG maps -------------------------------------------

source("scripts/spatial/update_map_print-outs.R")
