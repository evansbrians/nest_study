
# Dashboard script for daily updates

# setup -------------------------------------------------------------------

library(tidyverse)

googlesheets4::gs4_auth()

# map print-outs ----------------------------------------------------------

source("scripts/update_map_print-outs.R")

# download data points from garmin ----------------------------------------

source("scripts/convert_gpx_geojson.R")

# print-outs --------------------------------------------------------------


# read and pre-process data -----------------------------------------------

source("scripts/google_data_processing.R")

# update google earth map -------------------------------------------------

source("scripts/update_google_earth.R")
