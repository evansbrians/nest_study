
# Script for making map print-outs of each patch

# setup -------------------------------------------------------------------

library(maptiles)
library(tmap)
library(sf)
library(tidyverse)

source("scripts/utils/functions/spatial_functions.R")
source("scripts/utils/functions/utility_functions.R")

tmap_mode("plot")

# Get patch, coverboard, trailcam, and point count locations:

list.files(
  "data/spatial",
  pattern = "geojson$",
  full.names = TRUE
) %>% 
  set_names_from_path() %>% 
  map(
    ~ st_read(.x, quiet = TRUE) %>% 
      st_transform(3857)
  ) %>% 
  list2env(.GlobalEnv)

# Read in the images:

background_images <-
  list.files(
    "data/spatial/aerial_images",
    full.names = TRUE
  ) %>% 
  set_names(
    str_remove(
      basename(.),
      ".tif"
    )
  ) %>% 
  map(
    ~ terra::rast(.x)
  )

# create and save maps ----------------------------------------------------

names(background_images) %>% 
  map(
    ~ create_map(.patch = .x) %>% 
      tmap_save(
        filename = 
          str_c(
            "outputs/print-outs/patch_maps/",
            .x,
            ".png"
          )
      )
  )