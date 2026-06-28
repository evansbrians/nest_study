
# Dashboard script for daily updates

# setup -------------------------------------------------------------------

library(glue)
library(here)
library(tidyverse)

system("git pull")

# download and pre-process field data -------------------------------------

source("scripts/utils/updater.R")

# download data points from garmin ----------------------------------------

source("scripts/spatial/convert_gpx_geojson.R")

# update the app ----------------------------------------------------------

# This part renders the phone apps (currently ios but soon to be in ios *and*
# Android!) and web pages:

quarto::quarto_render("outputs/nest_app/field_map.qmd")

file.path(
  "outputs",
  "map_sandbox",
  "index.html"
) %>% 
  file.copy(
    "outputs/nest_app/index.html",
    .,
    overwrite = TRUE
  )

autopush_updates()

autopush_updates()

# update the scheduling document ------------------------------------------

# Update and render:

quarto::quarto_render("outputs/print-outs/schedule_pdf.qmd")

# Push changes:

autopush_updates()

# update GE and map printouts ---------------------------------------------

# Google Earth:

source("scripts/spatial/update_google_earth.R")

# PNG maps (printed maps):

source("scripts/spatial/update_map_print-outs.R")

# printing ----------------------------------------------------------------

# Print maps:

list.files(
  here("outputs/print-outs/patch_maps"),
  pattern = "\\.png$",
  full.names = TRUE
) %>% 
  walk(
    ~ glue("lp '{.x}'") %>% 
      system()
  )

# Print schedule:

here("outputs/print-outs/schedule_pdf.pdf") %>% 
  {glue("lp {.}")} %>% 
  system()

# Print datasheets:

source("scripts/utils/functions/utility_functions.R")

print_datasheets(
  # .datasheet = "coverboards",
  .datasheet = "nest_monitoring",
  # .datasheet = "nest_searching",
  # .datasheet = "point_counts",
  .copies = 1
)
