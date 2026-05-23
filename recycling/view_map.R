# This script is just for viewing the map

# Warning: There was a known bug in version 4.2, so make sure to upgrade to 4.3
# prior to running this script!

# setup -------------------------------------------------------------------

library(tmap)
library(sf)
library(tidyverse)

tmap_mode("view")

# Read all shapefiles and assign names:

list.files(
  "data/spatial",
  pattern = "geojson$",
  full.names = TRUE
) %>% 
  set_names(
    str_remove_all(., ".*/|\\..*")
  ) %>% 
  map(
    ~ st_read(.x, quiet = TRUE)
  ) %>% 
  list2env(.GlobalEnv)

# Read land cover:

land_cover <-
  terra::rast("data/spatial/lc_scbi.tif")

# map ---------------------------------------------------------------------

tm_basemap("Esri.WorldImagery") +
  tm_view(set_view = 15) +
  
  # Raster file works, but I commented it out because it greatly increases the
  # load time:
  
  # tm_shape(land_cover) +
  # tm_raster() +
  
  # Patches:
  
  tm_shape(
    patches,
    group = "Patches"
  ) +
  tm_polygons(
    col = "yellow",
    fill_alpha = 0.4
  ) + 
  
  # Point counts:
  
  tm_shape(
    point_count_locations
  ) +
  tm_symbols(
    fill = "red",
    col = "black",
    size = 0.5,
    fill_alpha = 1
  ) +
  
  # Trailcams:
  
  tm_shape(
    trailcam_locations
  ) +
  tm_symbols(
    fill = "blue", 
    col = "black",
    size = 0.5,
    fill_alpha = 1
  ) +
  
  # Coverboards
  
  tm_shape(
    coverboards_gps
  ) +
  tm_symbols(
    fill = "yellow", 
    col = "black",
    size = 0.5,
    fill_alpha = 1
  ) +
  tm_shape(temp) + tm_dots()
  
