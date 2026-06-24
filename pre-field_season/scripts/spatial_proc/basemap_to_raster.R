
# setup -------------------------------------------------------------------

library(maptiles)
library(tmap)
library(sf)
library(tidyverse)

source("scripts/utils/functions/utility_functions.R")

# Get patches, coverboard, trailcam, and point count locations:

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

# raster and raster processing --------------------------------------------

# Get the full-color raster from ESRI for each patch

photo_list <-
  patches %>% 
  st_buffer(25) %>% 
  split(.$name) %>% 
  map(
    ~ maptiles::get_tiles(
      x = .x,
      zoom = 19,
      provider = "Esri.WorldImagery",
      crop = TRUE
    ) %>% 
      terra::project("EPSG:4326")
  )

# Make grayscale (multiplies each band with the value and sums bands):

photo_list_grayscale <-
  photo_list %>% 
  map(
    ~ .x %>% 
      sum(
        c(
          0.299,
          0.587,
          0.114
        )
      )
  )

# write to file -----------------------------------------------------------

photo_list_grayscale %>% 
  imap(
    \(.x, .name) {
      terra::writeRaster(
        .x,
        file.path(
          "data/spatial/aerial_images",
          str_c(.name, ".tif")
        ),
        overwrite = TRUE
      )
    }
  )
