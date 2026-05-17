
# GPX to .geojson

# setup -------------------------------------------------------------------

library(sf)
library(tidyverse)

# Garmin file location when I plug it in:

garmin_dir <- "../../../../Volumes/GARMIN/Garmin/GPX"

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

cat_points <- 
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

names(cat_points) %>% 
  map(
    ~ cat_points %>% 
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

# upload patches to garmin ------------------------------------------------

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
