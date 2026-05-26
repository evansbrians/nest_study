
# Dashboard script for daily updates

# setup -------------------------------------------------------------------

library(glue)
library(here)
library(tidyverse)

googlesheets4::gs4_auth()

# download data points from garmin ----------------------------------------

source("scripts/convert_gpx_geojson.R")

# read and pre-process data -----------------------------------------------

source("scripts/google_data_processing.R")

# update google earth map -------------------------------------------------

source("scripts/update_google_earth.R")

# update leaflet map ------------------------------------------------------

source("scripts/leaflet_map.R")

# map print-outs ----------------------------------------------------------

# Update:

source("scripts/update_map_print-outs.R")

# Print:

list.files(
  here("outputs/print-outs/patch_maps"),
  pattern = "\\.png$",
  full.names = TRUE
) %>% 
  walk(
    ~ system(
      glue("lp '{.x}'")
    )
  )



