
# Upload patch boundaries to the Garmin

# setup -------------------------------------------------------------------

library(sf)
library(tidyverse)

source("scripts/functions.R")

# Garmin file location:

garmin_dir <- "/Volumes/GARMIN/Garmin/GPX"

# Read in spatial files:

spatial_files <- 
  list.files(
    "data/spatial/",
    pattern = "geojson$",
    full.names = TRUE
  ) %>% 
  set_names_from_path() %>% 
  map(
    ~ st_read(.x, quiet = TRUE)
  )

# patches -----------------------------------------------------------------

spatial_files$patches %>% 
  st_cast("MULTILINESTRING") %>% 
  st_write(
    file.path(
      garmin_dir,
      "patches"
    ) %>% 
      str_c(".gpx"),
    driver = "GPX",
    dataset_options = "GPX_USE_EXTENSIONS=YES",
    delete_dsn = TRUE
  )

# trailcams, coverboards, point counts, nests -----------------------------

names(spatial_files) %>% 
  str_subset(
    "patches",
    negate = TRUE
  ) %>% 
  map(
    ~ spatial_files %>% 
      pluck(.x) %>% 
      st_transform(4326) %>% 
      st_write(
        file.path(
          garmin_dir,
          .x
        ) %>% 
          str_c(".gpx"),
        driver = "GPX",
        dataset_options = "GPX_USE_EXTENSIONS=YES",
        delete_dsn = TRUE
      )
  )

# trails ------------------------------------------------------------------

spatial_files$tracks %>% 
  st_write(
    file.path(
      garmin_dir,
      "trails"
    ) %>% 
      str_c(".gpx"),
    driver = "GPX",
    dataset_options = "GPX_USE_EXTENSIONS=YES",
    delete_dsn = TRUE
  )

