
# Download and save points from the Garmin

# setup -------------------------------------------------------------------

library(sf)
library(tidyverse)

# Garmin file location:

garmin_dir <- "/Volumes/GARMIN/Garmin/GPX"

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

# clear global environment ------------------------------------------------

rm(
  list = ls()
)
