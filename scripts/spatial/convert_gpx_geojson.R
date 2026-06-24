
# Download and save points from the Garmin

# setup -------------------------------------------------------------------

# Start by assigning a location for the Garmin and checking if the device
# exists (allows the script to error out before doing anything else):

garmin_dir <- "/Volumes/GARMIN/Garmin/GPX"

if (!dir.exists(garmin_dir)) {
  stop("No Garmin device detected!")
}

# Libraries:

library(sf)
library(tidyverse)

source("scripts/utils/functions/utility_functions.R")

# read and pre-process GPS files ------------------------------------------

raw_points <- 
  list.files(
    garmin_dir,
    full.names = TRUE
  ) %>% 
  keep(
    ~ str_detect(.x, "gpx$")
  ) %>% 
  map_df(
    ~ st_read(
      .x,
      quiet = TRUE
    ) %>% 
      select(
        name,
        elevation = ele,
        datetime = time
      )
  )

# assign points -----------------------------------------------------------

categorized_points <- 
  c(
    coverboard_locations = "_cb_",
    point_count_locations = "point",
    trailcam_locations = "trailcam",
    nest_locations = "^N"
  ) %>% 
  map(
    ~ raw_points %>% 
      filter(
        str_detect(name, .x)
      )
  )

# save as geojson ---------------------------------------------------------

names(categorized_points) %>% 
  map(
    ~ categorized_points %>% 
      pluck(.x) %>% 
      write_sf(
        file.path(
          "data/spatial",
          .x
        ) %>% 
          str_c(".geojson"),
        delete_dsn = TRUE
      )
  )

# read and save tracks ----------------------------------------------------

# Read archived tracks:

tracks <- 
  file.path(
    garmin_dir,
    "Archive"
  ) %>% 
  list.files(
    full.names = TRUE,
    pattern = "gpx$"
  ) %>% 
  map_df(
    ~ st_read(
      .x,
      quiet = TRUE,
      layer = "tracks"
    ) %>% 
      select(name)
  )

# Save to file:

write_sf(
  tracks, 
  "data/spatial/tracks.geojson",
  delete_dsn = TRUE
)

# end session -------------------------------------------------------------

# Update git:

autopush_updates()

# Clear global environment:

rm(
  list = ls()
)
