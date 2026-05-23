
# Upload patch boundaries to the Garmin

# setup -------------------------------------------------------------------

library(sf)
library(tidyverse)

# Garmin file location when I plug it in:

garmin_dir <- "Volumes/GARMIN/Garmin/GPX"

# upload to garmin --------------------------------------------------------

# Patches

patches_gpx <- 
  st_read(
    "data/spatial/patches.geojson",
    quiet = TRUE
  ) %>% 
  st_cast("MULTILINESTRING")

st_write(
  patches_gpx,
  file.path(
    garmin_dir,
    "patches"
  ) %>% 
    str_c(".gpx"),
  driver = "GPX",
  dataset_options = "GPX_USE_EXTENSIONS=YES"
)

# Trailcam points:

trailcams <- 
  st_read(
    "data/spatial/trailcam_locations.geojson"
  ) %>% 
  st_transform(4326)

st_write(
  trailcams,
  file.path(
    garmin_dir,
    "trailcams"
  ) %>% 
    str_c(".gpx"),
  driver = "GPX",
  dataset_options = "GPX_USE_EXTENSIONS=YES",
  delete_dsn = TRUE
)