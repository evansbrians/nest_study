
# Dashboard script for daily updates

# setup -------------------------------------------------------------------

library(glue)
library(here)
library(tidyverse)

googlesheets4::gs4_auth()

# download data points from garmin ----------------------------------------

source("scripts/convert_gpx_geojson.R")

# download and pre-process field data -------------------------------------

source("scripts/google_data_processing.R")

# update the nest-checking file -------------------------------------------

source("scripts/get_nests_to_check.R")

# update the scheduling app and document ----------------------------------

source("scripts/functions.R")

# Update and render:

quarto::quarto_render("pages/schedule/index.qmd")
quarto::quarto_render("outputs/print-outs/schedule_pdf.qmd")

# Push changes:

autopush_updates()

# update maps -------------------------------------------------------------

# Google Earth:

source("scripts/update_google_earth.R")

# Leaflet (map app):

source("scripts/leaflet_map.R")

# PNG maps (printed maps):

source("scripts/update_map_print-outs.R")

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
